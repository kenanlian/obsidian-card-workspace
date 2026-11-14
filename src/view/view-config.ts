/**
 * Pure view-configuration resolver over `(scope, settings)`.
 *
 * Returns the sort, pin, grouping, and task-view settings that apply to the
 * current scope. Never reads App, MetadataCache, vault, or view runtime state,
 * and never computes arrangement: `group` carries the dimension *names* rather
 * than computed groups. Arrangement ownership and task-view availability come
 * from the exhaustive capability resolver (C6), so a future source must declare
 * both there explicitly. A scope with `taskView === false` is forced
 * to card mode.
 */
import { findCardBox } from "./card-boxes";
import { resolveSourceCapabilities } from "./source-capabilities";
import type { CardScope } from "./scope";
import type { GroupSpec } from "../card-grouping-settings";
import type { DefaultViewMode, LinksSortSpec, PluginSettings } from "../settings";
import { DEFAULT_TASK_GROUP, DEFAULT_TASK_SORT, type TaskGroupSpec, type TaskSortSpec } from "../task-view-settings";

export interface ResolvedViewConfig {
  sort: LinksSortSpec;
  pinnedPaths: string[];
  group: GroupSpec;
  viewMode: DefaultViewMode;
  taskSort: TaskSortSpec;
  taskGroup: TaskGroupSpec;
}

export function resolveViewConfig(
  scope: CardScope,
  settings: PluginSettings,
): ResolvedViewConfig {
  const capabilities = resolveSourceCapabilities(scope);
  const global: ResolvedViewConfig = {
    sort: scope.kind === "links" ? settings.linksSort[scope.direction] : settings.sort,
    pinnedPaths: settings.pinnedPaths,
    group: settings.group,
    viewMode: capabilities.taskView ? settings.defaultView : "cards",
    taskSort: settings.taskSort,
    taskGroup: settings.taskGroup,
  };
  if (capabilities.arrangementOwner.kind !== "box") {
    return global;
  }

  // A missing Box definition falls back to the global arrangement config.
  const box = findCardBox(settings.boxes ?? [], capabilities.arrangementOwner.boxId);
  if (!box) {
    return global;
  }
  return {
    sort: box.sort,
    pinnedPaths: box.pinnedPaths,
    group: box.group,
    viewMode: global.viewMode,
    taskSort: box.taskSort ?? DEFAULT_TASK_SORT,
    taskGroup: box.taskGroup ?? DEFAULT_TASK_GROUP,
  };
}
