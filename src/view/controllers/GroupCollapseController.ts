import type { GroupDimension } from "../../card-grouping-settings";
import { scopeIdentity, type CardScope } from "../scope";
import type { DisposeReport } from "../view-context";

const EMPTY_KEYS: ReadonlySet<string> = new Set<string>();

function runtimeKey(scope: CardScope, dimension: GroupDimension): string {
  return `${scopeIdentity(scope)}::${dimension}`;
}

/**
 * Per-view collapse state, keyed by scope identity plus dimension.
 *
 * Never persisted and never routed through `SettingsStore`: it is discarded
 * with the view. An unseen `(scope, dimension)` pair therefore reads as an
 * empty set, which is simultaneously "a newly grouped view is fully expanded",
 * "switching dimension starts expanded", and "switching scope away and back
 * restores what was collapsed".
 */
export class GroupCollapseController {
  private readonly collapsedByRuntimeKey = new Map<string, Set<string>>();

  getCollapsedKeys(scope: CardScope, dimension: GroupDimension): ReadonlySet<string> {
    return this.collapsedByRuntimeKey.get(runtimeKey(scope, dimension)) ?? EMPTY_KEYS;
  }

  toggle(scope: CardScope, dimension: GroupDimension, key: string): void {
    const mapKey = runtimeKey(scope, dimension);
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

  collapseAll(scope: CardScope, dimension: GroupDimension, keys: readonly string[]): void {
    const mapKey = runtimeKey(scope, dimension);
    if (keys.length === 0) {
      this.collapsedByRuntimeKey.delete(mapKey);
      return;
    }
    this.collapsedByRuntimeKey.set(mapKey, new Set(keys));
  }

  expandAll(scope: CardScope, dimension: GroupDimension): void {
    this.collapsedByRuntimeKey.delete(runtimeKey(scope, dimension));
  }

  dispose(): DisposeReport {
    this.collapsedByRuntimeKey.clear();
    return {};
  }
}
