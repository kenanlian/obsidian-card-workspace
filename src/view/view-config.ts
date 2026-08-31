/**
 * Pure view-configuration resolver over `(scope, settings)`.
 *
 * Returns only the sort, pin, and grouping settings that apply to the current
 * scope. Never reads App, MetadataCache, vault, or view runtime state, and
 * never computes arrangement: `group` carries the dimension *names* rather than
 * computed groups.
 */
import { findCardBox } from "./card-boxes";
import { isBoxScope, type CardScope } from "./scope";
import type { GroupSpec } from "../card-grouping-settings";
import type { PluginSettings } from "../settings";
import type { CardBoxSortSpec } from "./types";

export interface ResolvedViewConfig {
  sort: CardBoxSortSpec;
  pinnedPaths: string[];
  group: GroupSpec;
}

export function resolveViewConfig(
  scope: CardScope,
  settings: PluginSettings,
): ResolvedViewConfig {
  const box = isBoxScope(scope) ? findCardBox(settings.boxes ?? [], scope.boxId) : null;
  return box
    ? { sort: box.sort, pinnedPaths: box.pinnedPaths, group: box.group }
    : { sort: settings.sort, pinnedPaths: settings.pinnedPaths, group: settings.group };
}
