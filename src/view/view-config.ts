/**
 * Pure view-configuration resolver over `(scope, settings)`.
 *
 * Returns only the sort and pin settings that apply to the current scope.
 * Never reads App, MetadataCache, vault, or view runtime state, and never
 * computes arrangement. A later phase extends the return shape with grouping
 * dimension *names* rather than computed groups.
 */
import { findCardBox } from "./card-boxes";
import { isBoxScope, type CardScope } from "./scope";
import type { PluginSettings } from "../settings";
import type { CardBoxSortSpec } from "./types";

export interface ResolvedViewConfig {
  sort: CardBoxSortSpec;
  pinnedPaths: string[];
}

export function resolveViewConfig(
  scope: CardScope,
  settings: PluginSettings,
): ResolvedViewConfig {
  const box = isBoxScope(scope) ? findCardBox(settings.boxes ?? [], scope.boxId) : null;
  return box
    ? { sort: box.sort, pinnedPaths: box.pinnedPaths }
    : { sort: settings.sort, pinnedPaths: settings.pinnedPaths };
}
