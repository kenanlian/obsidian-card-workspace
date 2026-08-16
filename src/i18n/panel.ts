import type { UiLanguage } from "./types";

export interface PanelStrings {
  loadingCards: string;
  searchBlockedTitle: string;
  searchBlockedStatusPrefix: string;
}

export const panelStrings: Record<UiLanguage, PanelStrings> = {
  en: {
    loadingCards: "Loading folder cards...",
    searchBlockedTitle: "Search is currently blocked",
    searchBlockedStatusPrefix: "Index status:",
  },
  zh: {
    loadingCards: "正在加载文件夹卡片...",
    searchBlockedTitle: "搜索当前不可用",
    searchBlockedStatusPrefix: "索引状态：",
  },
};
