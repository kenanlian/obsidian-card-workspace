import { isTimeGroupDimension, isTimeGroupGranularity, normalizeGroupSpec, type GroupSpec } from "../../card-grouping-settings";
import { normalizePropertyKey } from "../../property-filter-settings";
import type { DefaultViewMode, LinksSortField, SortDirection } from "../../settings";
import {
  normalizeTaskGroupSpec,
  normalizeTaskSortSpec,
  type TaskGroupSpec,
  type TaskSortSpec,
} from "../../task-view-settings";
import { compareCards } from "../card-sort";
import {
  taskGroupCollapseSpec,
  type GroupCollapseController,
  type GroupCollapseSpec,
} from "../controllers/GroupCollapseController";
import type { SourceCapabilities } from "../source-capabilities";
import type { CardBoxDefinition } from "../types";
import { groupTransitionRequiresReload } from "../update-intent";
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
  /** When omitted, collapse and sort still reproject. */
  isScopeSettled?: () => boolean;
  groupCollapse: GroupCollapseController;
  getGroupSegmentKeys: () => readonly string[];
  /** Entering task mode leaves bulk mode; the following settings update publishes it. */
  exitBulkMode?: () => void;
}

function taskSortsEqual(left: TaskSortSpec, right: TaskSortSpec): boolean {
  return left.field === right.field && left.direction === right.direction;
}

function taskGroupsEqual(left: TaskGroupSpec, right: TaskGroupSpec): boolean {
  return left.dimension === right.dimension && left.timeGranularity === right.timeGranularity;
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
    if (this.deps.isScopeSettled?.() === false) return;
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
    const scope = this.deps.context.store.getScope();
    const nextField: LinksSortField = scope.kind === "links" && detail.field === "reference-count"
      ? "reference-count" : detail.field === "ctime" || detail.field === "name" ? detail.field : "mtime";
    const nextDirection: SortDirection = detail.direction === "asc" ? "asc" : "desc";
    if (scope.kind === "links") {
      const settings = this.deps.context.getSettings();
      const current = settings.linksSort[scope.direction];
      if (current.field !== nextField || current.direction !== nextDirection) {
        await this.deps.saveSettings({ linksSort: { ...settings.linksSort, [scope.direction]: { field: nextField, direction: nextDirection } } });
      }
      return;
    }
    // Reference count is a Links-only field.
    if (nextField === "reference-count") return;
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
    propertyKey?: unknown;
    timeGranularity?: unknown;
    orderBy?: unknown;
    orderDirection?: unknown;
  }): Promise<void> {
    const current = this.resolveGroupSpec();
    const dimension = detail.dimension === "property" ? "property"
      : coerceGroupField("dimension", detail.dimension, current.dimension);
    const key = dimension === "property"
      ? normalizePropertyKey(detail.propertyKey ?? current.propertyKey)
      : null;
    if (dimension === "property" && (key === null || !this.deps.context.getSettings().visiblePropertyKeys.includes(key))) return;
    const group: GroupSpec = {
      dimension,
      ...(key === null ? {} : { propertyKey: key }),
      ...(isTimeGroupDimension(dimension) ? { timeGranularity: isTimeGroupGranularity(detail.timeGranularity)
        ? detail.timeGranularity : current.timeGranularity ?? "day" as const } : {}),
      orderBy: coerceGroupField("orderBy", detail.orderBy, current.orderBy),
      orderDirection: coerceGroupField("orderDirection", detail.orderDirection, current.orderDirection),
    };

    if (
      group.dimension === current.dimension &&
      group.orderBy === current.orderBy &&
      group.orderDirection === current.orderDirection && group.propertyKey === current.propertyKey && group.timeGranularity === current.timeGranularity
    ) {
      return;
    }

    if (this.resolveArrangementOwner().kind === "box") {
      await this.deps.updateActiveBox((box) => ({ ...box, group }));
      // Re-sorting the loaded records is not enough for the task dimension:
      // their summaries are still unresolved, so the records must be rebuilt.
      if (groupTransitionRequiresReload(current, group)) {
        await this.deps.context.requestUpdate("reload", "settings-change");
        return;
      }
      this.sortAndReprojectCards();
      return;
    }

    await this.deps.saveSettings({ group });
  }

  private resolveTaskConfig(): { viewMode: DefaultViewMode; taskSort: TaskSortSpec; taskGroup: TaskGroupSpec } {
    const config = resolveViewConfig(this.deps.context.store.getScope(), this.deps.context.getSettings());
    return {
      viewMode: config.viewMode === "tasks" ? "tasks" : "cards",
      taskSort: normalizeTaskSortSpec(config.taskSort),
      taskGroup: normalizeTaskGroupSpec(config.taskGroup),
    };
  }

  /**
   * Persists the stream mode to its owner: the active Box definition, or the
   * global `defaultView` for folders. Sources without task view ignore it.
   */
  async setViewMode(mode: DefaultViewMode): Promise<void> {
    if (!this.deps.resolveCapabilities().taskView) return;
    if (this.resolveTaskConfig().viewMode === mode) return;
    if (mode === "tasks") this.deps.exitBulkMode?.();
    const owner = this.resolveArrangementOwner();
    if (owner.kind === "box") {
      await this.deps.updateActiveBox((box) => ({ ...box, viewMode: mode }));
      return;
    }
    await this.deps.saveSettings({ defaultView: mode });
  }

  toggleViewMode(): Promise<void> {
    return this.setViewMode(this.resolveTaskConfig().viewMode === "tasks" ? "cards" : "tasks");
  }

  async setTaskSort(spec: TaskSortSpec): Promise<void> {
    if (!this.deps.resolveCapabilities().taskView) return;
    const next = normalizeTaskSortSpec(spec);
    if (taskSortsEqual(this.resolveTaskConfig().taskSort, next)) return;
    const owner = this.resolveArrangementOwner();
    if (owner.kind === "box") {
      await this.deps.updateActiveBox((box) => ({ ...box, taskSort: next }));
      return;
    }
    await this.deps.saveSettings({ taskSort: next });
  }

  async setTaskGroup(spec: TaskGroupSpec): Promise<void> {
    if (!this.deps.resolveCapabilities().taskView) return;
    const next = normalizeTaskGroupSpec(spec);
    if (taskGroupsEqual(this.resolveTaskConfig().taskGroup, next)) return;
    const owner = this.resolveArrangementOwner();
    if (owner.kind === "box") {
      await this.deps.updateActiveBox((box) => ({ ...box, taskGroup: next }));
      return;
    }
    await this.deps.saveSettings({ taskGroup: next });
  }

  /** Panel intent: `{ mode: "cards" | "tasks" }`; anything else is ignored. */
  onViewModeChange(detail: { mode?: unknown }): Promise<void> {
    return detail.mode === "cards" || detail.mode === "tasks" ? this.setViewMode(detail.mode) : Promise.resolve();
  }

  /** Panel intent; an omitted or unrecognized field keeps its current value. */
  onTaskSortChange(detail: { field?: unknown; direction?: unknown }): Promise<void> {
    const current = this.resolveTaskConfig().taskSort;
    const candidate = normalizeTaskSortSpec({ field: detail.field, direction: detail.direction });
    return this.setTaskSort({
      field: candidate.field === detail.field ? candidate.field : current.field,
      direction: candidate.direction === detail.direction ? candidate.direction : current.direction,
    });
  }

  /** Panel intent; granularity applies to `created` / `done` and falls back to the current one. */
  onTaskGroupChange(detail: { dimension?: unknown; timeGranularity?: unknown }): Promise<void> {
    const current = this.resolveTaskConfig().taskGroup;
    const dimension = normalizeTaskGroupSpec({ dimension: detail.dimension }).dimension === detail.dimension
      ? detail.dimension as TaskGroupSpec["dimension"]
      : current.dimension;
    return this.setTaskGroup(normalizeTaskGroupSpec({
      dimension,
      timeGranularity: isTimeGroupGranularity(detail.timeGranularity) ? detail.timeGranularity : current.timeGranularity,
    }));
  }

  private resolveCollapseSpec(): GroupCollapseSpec {
    const tasks = this.resolveTaskConfig();
    return tasks.viewMode === "tasks" ? taskGroupCollapseSpec(tasks.taskGroup) : this.resolveGroupSpec();
  }

  /** Collapse state is runtime-only: never persisted, never a settings write. */
  onGroupCollapseCommand(detail: { command?: unknown; key?: unknown }): void {
    const spec = this.resolveCollapseSpec();
    const collapse = this.deps.groupCollapse;
    const scope = this.deps.context.store.getScope();

    switch (detail.command) {
      case "toggle":
        if (typeof detail.key !== "string" || detail.key.length === 0) {
          return;
        }
        collapse.toggle(scope, spec, detail.key);
        break;
      case "collapse-all":
        collapse.collapseAll(scope, spec, this.deps.getGroupSegmentKeys());
        break;
      case "expand-all":
        collapse.expandAll(scope, spec);
        break;
      default:
        return;
    }

    if (this.deps.isScopeSettled?.() === false) return;
    this.deps.reprojectCards();
    this.deps.reconcileToVisibleCards();
    this.deps.publishGroups("cards", "bulk");
  }

  async movePinnedCard(path: string, delta: -1 | 1): Promise<void> {
    const owner = this.resolveArrangementOwner();
    const pins = owner.kind === "box" ? owner.box.pinnedPaths : this.deps.context.getSettings().pinnedPaths;
    const index = pins.indexOf(path), target = index + delta;
    if (index < 0 || target < 0 || target >= pins.length) return;
    const next = [...pins]; [next[index], next[target]] = [next[target], next[index]];
    if (owner.kind === "box") await this.deps.updateActiveBox(box => ({ ...box, pinnedPaths: next }));
    else await this.deps.saveSettings({ pinnedPaths: next });
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
