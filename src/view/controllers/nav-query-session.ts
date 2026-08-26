import type { PluginSettings } from "../../settings";
import type { NavSectionId } from "../types";

export interface NavigationQueryBaseline {
  expandedFolderPaths: readonly string[];
  expandedTagPaths: readonly string[];
  sectionCollapsed: Readonly<Record<NavSectionId, boolean>>;
}

export function captureNavigationQueryBaseline(settings: PluginSettings): NavigationQueryBaseline {
  return {
    expandedFolderPaths: [...(settings.expandedFolderPaths ?? [])],
    expandedTagPaths: [...(settings.expandedTagPaths ?? [])],
    sectionCollapsed: {
      favorites: settings.favoritesSectionCollapsed,
      folders: settings.folderSectionCollapsed,
      tags: settings.tagSectionCollapsed,
      boxes: settings.boxSectionCollapsed,
    },
  };
}

export function queryBaselinesEqual(
  left: NavigationQueryBaseline,
  right: NavigationQueryBaseline,
): boolean {
  return left.expandedFolderPaths.join("\0") === right.expandedFolderPaths.join("\0")
    && left.expandedTagPaths.join("\0") === right.expandedTagPaths.join("\0")
    && (Object.keys(left.sectionCollapsed) as NavSectionId[]).every(
      (section) => left.sectionCollapsed[section] === right.sectionCollapsed[section],
    );
}
