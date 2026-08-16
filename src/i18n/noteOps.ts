import type { UiLanguage } from "./types";

export interface NoteOpsStrings {
  fileNotFoundAfterMove: string;
  copiedToClipboard: (basename: string) => string;
  failedToCopyToClipboard: string;
  noFilesToMerge: string;
  mergeMarkdownOnly: string;
  mergedNotesDefaultTitle: string;
}

export const noteOpsStrings: Record<UiLanguage, NoteOpsStrings> = {
  en: {
    fileNotFoundAfterMove: "File not found after move",
    copiedToClipboard: (basename: string) => `Copied "${basename}" to clipboard`,
    failedToCopyToClipboard: "Failed to copy to clipboard",
    noFilesToMerge: "No files to merge",
    mergeMarkdownOnly: "Only Markdown notes can be merged",
    mergedNotesDefaultTitle: "Merged notes",
  },
  zh: {
    fileNotFoundAfterMove: "移动后未找到文件",
    copiedToClipboard: (basename: string) => `已将“${basename}”复制到剪贴板`,
    failedToCopyToClipboard: "复制到剪贴板失败",
    noFilesToMerge: "没有可合并的文件",
    mergeMarkdownOnly: "只能合并 Markdown 笔记",
    mergedNotesDefaultTitle: "合并笔记",
  },
};
