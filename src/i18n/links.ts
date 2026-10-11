import type { UiLanguage } from "./types";

export interface LinksStrings {
  referenceCount: (count: number) => string;
  paragraphCount: (count: number) => string;
  remainingReferences: (count: number) => string;
  showReferences: string;
  collapseReferences: string;
  openTarget: string;
  referencesUnavailable: string;
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
    referenceCount: (count) => `${count} ${count === 1 ? "reference" : "references"}`,
    paragraphCount: (count) => `${count} references in this paragraph`,
    remainingReferences: (count) => `Show ${count} more ${count === 1 ? "context" : "contexts"}`,
    showReferences: "Show reference contexts",
    collapseReferences: "Collapse references",
    openTarget: "Open target location",
    referencesUnavailable: "Reference context unavailable",
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
    referenceCount: (count) => `引用 ${count} 次`,
    paragraphCount: (count) => `本段 ${count} 次`,
    remainingReferences: (count) => `查看其余 ${count} 个引用片段`,
    showReferences: "查看引用上下文",
    collapseReferences: "收起引用",
    openTarget: "打开目标位置",
    referencesUnavailable: "暂无可用的引用上下文",
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
