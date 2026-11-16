import type { GroupSpec } from "../card-grouping-settings";
import type { DefaultViewMode, LinksSortSpec, PluginSettings } from "../settings";
import type { TaskGroupSpec, TaskSortSpec } from "../task-view-settings";
import type { CardScope } from "./scope";
import { resolveSourceCapabilities } from "./source-capabilities";
import { resolveViewConfig, type ResolvedViewConfig } from "./view-config";
import type { ViewContext } from "./view-context";

/** Browse choices belong to a stream; authored membership and pins remain shared. */
export interface StreamBrowseState {
  filter: PluginSettings["filter"];
  sort: LinksSortSpec;
  group: GroupSpec;
  viewMode: DefaultViewMode;
  taskSort: TaskSortSpec;
  taskGroup: TaskGroupSpec;
}

export function createStreamBrowseState(scope: CardScope, sharedSettings: PluginSettings): StreamBrowseState {
  const config = resolveViewConfig(scope, sharedSettings);
  return {
    filter: { tags: [], properties: [] },
    sort: { ...config.sort },
    group: { ...config.group },
    viewMode: config.viewMode,
    taskSort: { ...config.taskSort },
    taskGroup: { ...config.taskGroup },
  };
}

export function getBrowseFilter(context: ViewContext): PluginSettings["filter"] {
  return context.browse?.get().filter ?? context.getSettings().filter;
}

export function getStreamViewConfig(context: ViewContext, scope = context.store.getScope()): ResolvedViewConfig {
  const shared = resolveViewConfig(scope, context.getSettings());
  const browse = context.browse?.get();
  if (!browse) return shared;
  return {
    ...shared,
    sort: browse.sort,
    group: browse.group,
    viewMode: resolveSourceCapabilities(scope).taskView ? browse.viewMode : "cards",
    taskSort: browse.taskSort,
    taskGroup: browse.taskGroup,
  };
}

/** Matches SettingsStore's partial-filter merge without creating a settings overlay. */
export async function setBrowseFilter(
  context: ViewContext,
  partialFilter: Partial<PluginSettings["filter"]>,
  options?: { skipViewUpdate: boolean },
): Promise<void> {
  if (!context.browse) {
    await context.saveSettings({ filter: partialFilter }, options);
    return;
  }
  context.browse.update({ filter: { ...getBrowseFilter(context), ...partialFilter } });
  if (!options?.skipViewUpdate) await context.requestUpdate("reproject", "settings-change");
}

/** Desktop folder traversal follows the captured scope, mobile follows its device setting. */
export function getBrowseIncludeSubfolders(context: ViewContext): boolean {
  const scope = context.store.getScope();
  return context.browse && scope.kind === "folder" ? scope.includeSubfolders : context.getSettings().includeSubfolders;
}

/** Source changes reset defaults; changing a folder's recursion keeps its browse choices. */
export function isSameBrowseSource(left: CardScope, right: CardScope): boolean {
  switch (left.kind) {
    case "folder": return right.kind === "folder" && left.path === right.path;
    case "box": return right.kind === "box" && left.boxId === right.boxId;
    case "links": return right.kind === "links" && left.notePath === right.notePath && left.direction === right.direction;
  }
}
