import type { GroupDimension, GroupSpec } from "../../card-grouping-settings";
import type { TaskGroupSpec } from "../../task-view-settings";
import { scopeIdentity, type CardScope } from "../scope";
import type { DisposeReport } from "../view-context";

const EMPTY_KEYS: ReadonlySet<string> = new Set<string>();

/** Task-stream grouping; collapse state is kept apart from the card stream's. */
export interface TaskGroupCollapseSpec {
  readonly stream: "tasks";
  readonly group: TaskGroupSpec;
}

export type GroupCollapseSpec = GroupSpec | GroupDimension | TaskGroupCollapseSpec;

export function taskGroupCollapseSpec(group: TaskGroupSpec): TaskGroupCollapseSpec {
  return { stream: "tasks", group };
}

function runtimeKey(scope: CardScope, spec: GroupCollapseSpec): string {
  if (typeof spec !== "string" && "stream" in spec) {
    // Card keys are bare JSON arrays, so the prefix keeps the namespaces disjoint.
    const { dimension, timeGranularity } = spec.group;
    return `tasks:${JSON.stringify([scopeIdentity(scope), dimension,
      dimension === "created" || dimension === "done" ? timeGranularity ?? "day" : null])}`;
  }
  const dimension = typeof spec === "string" ? spec : spec.dimension;
  return JSON.stringify([scopeIdentity(scope), dimension,
    dimension === "property" && typeof spec !== "string" ? spec.propertyKey : null,
    (dimension === "ctime" || dimension === "mtime") && typeof spec !== "string" ? spec.timeGranularity ?? "day" : null]);
}

/**
 * Per-view collapse state, keyed by stream, scope identity, dimension, and property key.
 *
 * Never persisted and never routed through `SettingsStore`: it is discarded
 * with the view. An unseen configuration therefore reads as an
 * empty set, which is simultaneously "a newly grouped view is fully expanded",
 * "switching dimension or property starts expanded", and "switching scope away and back
 * restores what was collapsed".
 */
export class GroupCollapseController {
  private readonly collapsedByRuntimeKey = new Map<string, Set<string>>();

  snapshot(): Record<string, string[]> {
    return Object.fromEntries([...this.collapsedByRuntimeKey].map(([key, values]) => [key, [...values]]));
  }
  restore(snapshot: Record<string, string[]>): void {
    this.collapsedByRuntimeKey.clear();
    for (const [key, values] of Object.entries(snapshot)) {
      if (Array.isArray(values)) this.collapsedByRuntimeKey.set(key, new Set(values.filter(value => typeof value === "string")));
    }
  }

  getCollapsedKeys(scope: CardScope, spec: GroupCollapseSpec): ReadonlySet<string> {
    return this.collapsedByRuntimeKey.get(runtimeKey(scope, spec)) ?? EMPTY_KEYS;
  }

  toggle(scope: CardScope, spec: GroupCollapseSpec, key: string): void {
    const mapKey = runtimeKey(scope, spec);
    const keys = this.collapsedByRuntimeKey.get(mapKey) ?? new Set<string>();
    if (keys.has(key)) {
      keys.delete(key);
    } else {
      keys.add(key);
    }

    if (keys.size === 0) {
      this.collapsedByRuntimeKey.delete(mapKey);
      return;
    }
    this.collapsedByRuntimeKey.set(mapKey, keys);
  }

  collapseAll(scope: CardScope, spec: GroupCollapseSpec, keys: readonly string[]): void {
    const mapKey = runtimeKey(scope, spec);
    if (keys.length === 0) {
      this.collapsedByRuntimeKey.delete(mapKey);
      return;
    }
    this.collapsedByRuntimeKey.set(mapKey, new Set(keys));
  }

  expandAll(scope: CardScope, spec: GroupCollapseSpec): void {
    this.collapsedByRuntimeKey.delete(runtimeKey(scope, spec));
  }

  dispose(): DisposeReport {
    this.collapsedByRuntimeKey.clear();
    return {};
  }
}
