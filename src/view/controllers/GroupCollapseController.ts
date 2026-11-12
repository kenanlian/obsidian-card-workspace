import type { GroupDimension, GroupSpec } from "../../card-grouping-settings";
import { scopeIdentity, type CardScope } from "../scope";
import type { DisposeReport } from "../view-context";

const EMPTY_KEYS: ReadonlySet<string> = new Set<string>();

function runtimeKey(scope: CardScope, spec: GroupSpec | GroupDimension): string {
  const dimension = typeof spec === "string" ? spec : spec.dimension;
  return JSON.stringify([scopeIdentity(scope), dimension,
    dimension === "property" && typeof spec !== "string" ? spec.propertyKey : null,
    (dimension === "ctime" || dimension === "mtime") && typeof spec !== "string" ? spec.timeGranularity ?? "day" : null]);
}

/**
 * Per-view collapse state, keyed by scope identity, dimension, and property key.
 *
 * Never persisted and never routed through `SettingsStore`: it is discarded
 * with the view. An unseen configuration therefore reads as an
 * empty set, which is simultaneously "a newly grouped view is fully expanded",
 * "switching dimension or property starts expanded", and "switching scope away and back
 * restores what was collapsed".
 */
export class GroupCollapseController {
  private readonly collapsedByRuntimeKey = new Map<string, Set<string>>();

  getCollapsedKeys(scope: CardScope, spec: GroupSpec | GroupDimension): ReadonlySet<string> {
    return this.collapsedByRuntimeKey.get(runtimeKey(scope, spec)) ?? EMPTY_KEYS;
  }

  toggle(scope: CardScope, spec: GroupSpec | GroupDimension, key: string): void {
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

  collapseAll(scope: CardScope, spec: GroupSpec | GroupDimension, keys: readonly string[]): void {
    const mapKey = runtimeKey(scope, spec);
    if (keys.length === 0) {
      this.collapsedByRuntimeKey.delete(mapKey);
      return;
    }
    this.collapsedByRuntimeKey.set(mapKey, new Set(keys));
  }

  expandAll(scope: CardScope, spec: GroupSpec | GroupDimension): void {
    this.collapsedByRuntimeKey.delete(runtimeKey(scope, spec));
  }

  dispose(): DisposeReport {
    this.collapsedByRuntimeKey.clear();
    return {};
  }
}
