import type { UiLanguage } from "./types";

export interface NavigationVisibilityStrings {
  heading: string;
  description: string;
  sections: { favorites: string; folders: string; tags: string; properties: string; boxes: string; links: string };
  hideFolder: string;
  hideTag: string;
  hideSection: string;
  manageFolders: string;
  manageTags: string;
  manage: string;
  search: string;
  hideMatches: string;
  restoreMatches: string;
  restoreAll: string;
  missing: string;
  inherited: (parent: string) => string;
  hidden: string;
  empty: string;
  allHidden: string;
  saveFailed: string;
  saveFailedNotice: string;
}

export const navigationVisibilityStrings: Record<UiLanguage, NavigationVisibilityStrings> = {
  en: {
    heading: "Navigation", description: "Hide navigation entries only. Cards, search, filters, and existing favorites stay available.",
    sections: { favorites: "Show Favorites", folders: "Show Folders", tags: "Show Tags", properties: "Show Properties", boxes: "Show Card boxes", links: "Show Links" },
    hideFolder: "Hide this folder", hideTag: "Hide this tag", hideSection: "Hide this section",
    manageFolders: "Hidden folders", manageTags: "Hidden tags", manage: "Manage", search: "Search all vault entries…",
    hideMatches: "Hide matching entries", restoreMatches: "Restore matching entries", restoreAll: "Restore all",
    missing: "Not currently found in the vault", inherited: (parent) => `Hidden by ${parent}. Restore the parent first.`,
    hidden: "Hide in navigation", empty: "No matching entries", allHidden: "All navigation sections are hidden. Restore them in Card Workspace settings.",
    saveFailedNotice: "Could not save navigation visibility. Retry from Navigation settings.",
    saveFailed: "Could not save navigation settings. Your draft is kept; try Done again.",
  },
  zh: {
    heading: "导航", description: "仅隐藏导航条目；卡片、搜索、筛选和已有收藏仍可使用。",
    sections: { favorites: "显示收藏", folders: "显示文件夹", tags: "显示标签", properties: "显示属性", boxes: "显示卡片盒", links: "显示链接" },
    hideFolder: "隐藏此文件夹", hideTag: "隐藏此标签", hideSection: "隐藏此分区",
    manageFolders: "隐藏的文件夹", manageTags: "隐藏的标签", manage: "管理", search: "搜索全库条目…",
    hideMatches: "隐藏匹配项", restoreMatches: "恢复匹配项", restoreAll: "全部恢复",
    missing: "当前在仓库中未找到", inherited: (parent) => `因 ${parent} 隐藏，请先恢复父项。`,
    hidden: "在导航中隐藏", empty: "没有匹配的条目", allHidden: "所有导航分区均已隐藏，请从 Card Workspace 插件设置中恢复。",
    saveFailedNotice: "无法保存导航可见性，请从插件的导航设置中重试。",
    saveFailed: "无法保存导航设置。草稿已保留，请再次点击“完成”重试。",
  },
};
