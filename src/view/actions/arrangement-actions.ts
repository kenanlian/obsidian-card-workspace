import { normalizeGroupSpec, type GroupSpec } from "../../card-grouping-settings";
import type { SortDirection, SortField } from "../../settings";
import { compareCards } from "../card-sort";
import type { GroupCollapseController } from "../controllers/GroupCollapseController";
import type { SourceCapabilities } from "../source-capabilities";
import type { CardBoxDefinition } from "../types";
import { resolveViewConfig } from "../view-config";
import type { ViewContext } from "../view-context";

/**
 * Unrecognized input falls back to the current value rather than the spec
 * default, so a malformed detail cannot silently reset the other two fields.
 */
function coerceGroupField<K extends keyof GroupSpec>(
  key: K,
  value: unknown,
  current: GroupSpec[K],
): GroupSpec[K] {
  const normalized = normalizeGroupSpec({ [key]: value })[key];
  return value === normalized ? normalized : current;
}

export interface ArrangementActionsDeps {
  context: ViewContext;
  /** Settings writes for global sort/group/pins. */
  saveSettings: ViewContext["saveSettings"];
  /** Active-Box definition, or null when the Box scope cannot be resolved. */
  getActiveBox: () => CardBoxDefinition | null;
  updateActiveBox: (mutate: (box: CardBoxDefinition) => CardBoxDefinition) => Promise<void>;
  /** Capability table for the runtime scope (C6). */
  resolveCapabilities: () => SourceCapabilities;
  publishGroups: ViewContext["publishGroups"];
  refreshLoadKeyForCurrentScope: () => void;
  reprojectCards: () => void;
  reconcileToVisibleCards: () => void;
  groupCollapse: GroupCollapseController;
  getGroupSegmentKeys: () => readonly string[];
}

/**
 * Owns sort, group, collapse, and pin intents plus the C8 atomic reorder seam.
 *
 * Does not own view state and must not receive a `FolderCardView` reference.
 * Callers remain responsible for panel publication after `sortAndReprojectCards`.
 */
export class ArrangementActions {
  constructor(private readonly deps: ArrangementActionsDeps) {}

  /**
   * Capability arrangement owner (C6), with the same missing-Box fallback
   * `resolveViewConfig` applies: a Box scope whose definition is gone arranges
   * from global settings rather than dropping the write.
   */
  private resolveArrangementOwner():
    | { readonly kind: "global" }
    | { readonly kind: "box"; readonly box: CardBoxDefinition } {
    const owner = this.deps.resolveCapabilities().arrangementOwner;
    if (owner.kind === "box") {
      const box = this.deps.getActiveBox();
      if (box) {
        return { kind: "box", box };
      }
    }
    return { kind: "global" };
  }

  /**
   * C8 atomic reorder seam. Exact order: resolve effective scope sort → copy-sort
   * base cards → replace base cards → refresh load key → reproject → reconcile bulk.
   */
  sortAndReprojectCards(): void {
    const { context, refreshLoadKeyForCurrentScope, reprojectCards, reconcileToVisibleCards } =
      this.deps;
    const { sort } = resolveViewConfig(context.store.getScope(), context.getSettings());
    context.store.replaceBaseCards(
      [...context.store.getBaseCards()].sort((left, right) =>
        compareCards(left, right, sort.field, sort.direction),
      ),
    );
    refreshLoadKeyForCurrentScope();
    reprojectCards();
    reconcileToVisibleCards();
  }

  async onSortChange(detail: {
    field?: unknown;
    direction?: unknown;
  }): Promise<void> {
    const nextField: SortField =
      detail.field === "ctime" || detail.field === "name" ? detail.field : "mtime";
    const nextDirection: SortDirection = detail.direction === "asc" ? "asc" : "desc";
    const owner = this.resolveArrangementOwner();

    if (owner.kind === "box") {
      if (
        owner.box.sort.field === nextField &&
        owner.box.sort.direction === nextDirection
      ) {
        return;
      }
      await this.deps.updateActiveBox((box) => ({
        ...box,
        sort: { field: nextField, direction: nextDirection },
      }));
      this.sortAndReprojectCards();
      return;
    }

    const currentSettings = this.deps.context.getSettings();

    if (
      currentSettings.sort.field === nextField &&
      currentSettings.sort.direction === nextDirection
    ) {
      return;
    }

    await this.deps.saveSettings({
      sort: {
        field: nextField,
        direction: nextDirection,
      },
    });
  }

  private resolveGroupSpec(): GroupSpec {
    return normalizeGroupSpec(
      resolveViewConfig(this.deps.context.store.getScope(), this.deps.context.getSettings()).group,
    );
  }

  async onGroupChange(detail: {
    dimension?: unknown;
    orderBy?: unknown;
    orderDirection?: unknown;
  }): Promise<void> {
    const current = this.resolveGroupSpec();
    const group: GroupSpec = {
      dimension: coerceGroupField("dimension", detail.dimension, current.dimension),
      orderBy: coerceGroupField("orderBy", detail.orderBy, current.orderBy),
      orderDirection: coerceGroupField("orderDirection", detail.orderDirection, current.orderDirection),
    };

    if (
      group.dimension === current.dimension &&
      group.orderBy === current.orderBy &&
      group.orderDirection === current.orderDirection
    ) {
      return;
    }

    if (this.resolveArrangementOwner().kind === "box") {
      await this.deps.updateActiveBox((box) => ({ ...box, group }));
      this.sortAndReprojectCards();
      return;
    }

    await this.deps.saveSettings({ group });
  }

  /** Collapse state is runtime-only: never persisted, never a settings write. */
  onGroupCollapseCommand(detail: { command?: unknown; key?: unknown }): void {
    const dimension = this.resolveGroupSpec().dimension;
    const collapse = this.deps.groupCollapse;
    const scope = this.deps.context.store.getScope();

    switch (detail.command) {
      case "toggle":
        if (typeof detail.key !== "string" || detail.key.length === 0) {
          return;
        }
        collapse.toggle(scope, dimension, detail.key);
        break;
      case "collapse-all":
        collapse.collapseAll(scope, dimension, this.deps.getGroupSegmentKeys());
        break;
      case "expand-all":
        collapse.expandAll(scope, dimension);
        break;
      default:
        return;
    }

    this.deps.reprojectCards();
    this.deps.reconcileToVisibleCards();
    this.deps.publishGroups("cards", "bulk");
  }

  async onPinToggle(detail: { path?: unknown; pinned?: unknown }): Promise<void> {
    const path = typeof detail.path === "string" ? detail.path : "";
    if (path.length === 0) {
      return;
    }

    const owner = this.resolveArrangementOwner();
    const currentPinnedPaths = owner.kind === "box" ? owner.box.pinnedPaths : this.deps.context.getSettings().pinnedPaths;
    const currentlyPinned = currentPinnedPaths.includes(path);
    const shouldPin = typeof detail.pinned === "boolean" ? detail.pinned : !currentlyPinned;

    if (shouldPin === currentlyPinned) {
      return;
    }

    const nextPinnedPaths = shouldPin
      ? [...currentPinnedPaths, path]
      : currentPinnedPaths.filter((pinnedPath) => pinnedPath !== path);

    if (owner.kind === "box") {
      await this.deps.updateActiveBox((box) => ({ ...box, pinnedPaths: nextPinnedPaths }));
      return;
    }

    await this.deps.saveSettings({
      pinnedPaths: nextPinnedPaths,
    });
  }
}
