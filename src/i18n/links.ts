import type { UiLanguage } from "./types";

export interface LinksStrings {
  sectionLabel: string;
  directionBacklinks: string;
  directionOutgoing: string;
  pinToNote: string;
  resumeFollow: string;
  saveSnapshot: string;
  emptyLinks: string;
  noActiveFileNotice: string;
  emptySnapshotNotice: string;
}

export const linksStrings: Record<UiLanguage, LinksStrings> = {
  en: {
    sectionLabel: "Links",
    directionBacklinks: "Backlinks",
    directionOutgoing: "Outgoing links",
    pinToNote: "Pin to this note",
    resumeFollow: "Resume following the active note",
    saveSnapshot: "Save as card box…",
    emptyLinks: "No linked notes",
    noActiveFileNotice: "Open a note first to view its links.",
    emptySnapshotNotice: "There are no linked notes to save.",
  },
  zh: {
    sectionLabel: "双链",
    directionBacklinks: "反链",
    directionOutgoing: "出链",
    pinToNote: "固定到当前笔记",
    resumeFollow: "恢复跟随当前笔记",
    saveSnapshot: "存为卡片盒…",
    emptyLinks: "无双链笔记",
    noActiveFileNotice: "请先打开一篇笔记以查看其链接。",
    emptySnapshotNotice: "没有可保存的双链笔记。",
  },
};
