import type { UiLanguage } from "./types";

export interface AppStrings {
  appName: string;
  untitledNoteBaseName: string;
  hoverSourceDisplay: string;
  openCardWorkspaceViewCommand: string;
  ribbonTooltip: string;
  showSearchStatusCommand: string;
  recoverSearchIndexCommand: string;
  rebuildSearchIndexCommand: string;
  clearResetSearchIndexCommand: string;
  openInNewWindowDesktopOnly: string;
  searchIndexRequiresRecovery: string;
  searchIndexReady: string;
  searchIndexUnavailable: string;
  searchIndexResetFailed: string;
  searchIndexClearedAndRebuilding: string;
  searchIndexUnavailableNotice: string;
  searchIndexLifecycleTitle: string;
  searchIndexStatusLabel: string;
  searchIndexQueryAvailabilityLabel: string;
  searchIndexReadinessLabel: string;
  searchIndexPersistenceLabel: string;
  searchIndexDocumentsLabel: string;
  searchIndexLastOutcomeLabel: string;
  searchIndexLastRestoreLabel: string;
  searchIndexLastBuildLabel: string;
  searchIndexRebuildReasonLabel: string;
  searchIndexLastErrorLabel: string;
  searchIndexAvailable: string;
  searchIndexBlocked: string;
  searchIndexUnknown: string;
  searchIndexNone: string;
  failedToCopyFile: (reason: string) => string;
  fileNameCannotBeEmpty: string;
  failedToRenameFile: (reason: string) => string;
  failedToDeleteFile: (reason: string) => string;
  failedToMoveFile: (reason: string) => string;
}

export const appStrings: Record<UiLanguage, AppStrings> = {
  en: {
    appName: "Card Workspace",
    untitledNoteBaseName: "Untitled",
    hoverSourceDisplay: "Card Workspace",
    openCardWorkspaceViewCommand: "Open Card Workspace view",
    ribbonTooltip: "Open Card Workspace",
    showSearchStatusCommand: "Show Card Workspace local search index lifecycle status",
    recoverSearchIndexCommand: "Recover Card Workspace local search index lifecycle",
    rebuildSearchIndexCommand: "Rebuild Card Workspace local search index from notes",
    clearResetSearchIndexCommand: "Clear and reset Card Workspace local search index state",
    openInNewWindowDesktopOnly: "Open in new window is available on desktop only.",
    searchIndexRequiresRecovery: "Card Workspace search index requires recovery.",
    searchIndexReady: "Card Workspace search index is ready.",
    searchIndexUnavailable: "Card Workspace local search index is unavailable.",
    searchIndexResetFailed: "Card Workspace local search index reset failed.",
    searchIndexClearedAndRebuilding: "Card Workspace local search index cleared. Rebuilding from notes...",
    searchIndexUnavailableNotice: "Card Workspace local search index lifecycle is not initialized yet.",
    searchIndexLifecycleTitle: "Card Workspace local search index lifecycle",
    searchIndexStatusLabel: "Status",
    searchIndexQueryAvailabilityLabel: "Query availability",
    searchIndexReadinessLabel: "Readiness",
    searchIndexPersistenceLabel: "Persistence",
    searchIndexDocumentsLabel: "Documents",
    searchIndexLastOutcomeLabel: "Last outcome",
    searchIndexLastRestoreLabel: "Last restore",
    searchIndexLastBuildLabel: "Last build",
    searchIndexRebuildReasonLabel: "Rebuild reason",
    searchIndexLastErrorLabel: "Last error",
    searchIndexAvailable: "available",
    searchIndexBlocked: "blocked",
    searchIndexUnknown: "unknown",
    searchIndexNone: "none",
    failedToCopyFile: (reason: string) => `Failed to copy file: ${reason}`,
    fileNameCannotBeEmpty: "File name cannot be empty",
    failedToRenameFile: (reason: string) => `Failed to rename file: ${reason}`,
    failedToDeleteFile: (reason: string) => `Failed to delete file: ${reason}`,
    failedToMoveFile: (reason: string) => `Failed to move file: ${reason}`,
  },
  zh: {
    appName: "Card Workspace",
    untitledNoteBaseName: "未命名",
    hoverSourceDisplay: "Card Workspace",
    openCardWorkspaceViewCommand: "打开 Card Workspace 视图",
    ribbonTooltip: "打开 Card Workspace",
    showSearchStatusCommand: "显示 Card Workspace 本地搜索索引生命周期状态",
    recoverSearchIndexCommand: "恢复 Card Workspace 本地搜索索引生命周期",
    rebuildSearchIndexCommand: "从笔记重建 Card Workspace 本地搜索索引",
    clearResetSearchIndexCommand: "清除并重置 Card Workspace 本地搜索索引状态",
    openInNewWindowDesktopOnly: "仅桌面版支持在新窗口打开。",
    searchIndexRequiresRecovery: "Card Workspace 搜索索引需要恢复。",
    searchIndexReady: "Card Workspace 搜索索引已就绪。",
    searchIndexUnavailable: "Card Workspace 本地搜索索引不可用。",
    searchIndexResetFailed: "Card Workspace 本地搜索索引重置失败。",
    searchIndexClearedAndRebuilding: "Card Workspace 本地搜索索引已清除，正在根据笔记重建...",
    searchIndexUnavailableNotice: "Card Workspace 本地搜索索引生命周期尚未初始化。",
    searchIndexLifecycleTitle: "Card Workspace 本地搜索索引生命周期",
    searchIndexStatusLabel: "状态",
    searchIndexQueryAvailabilityLabel: "查询可用性",
    searchIndexReadinessLabel: "就绪状态",
    searchIndexPersistenceLabel: "持久化",
    searchIndexDocumentsLabel: "文档数",
    searchIndexLastOutcomeLabel: "上次结果",
    searchIndexLastRestoreLabel: "上次恢复",
    searchIndexLastBuildLabel: "上次构建",
    searchIndexRebuildReasonLabel: "重建原因",
    searchIndexLastErrorLabel: "最近错误",
    searchIndexAvailable: "可用",
    searchIndexBlocked: "已阻止",
    searchIndexUnknown: "未知",
    searchIndexNone: "无",
    failedToCopyFile: (reason: string) => `复制文件失败：${reason}`,
    fileNameCannotBeEmpty: "文件名不能为空",
    failedToRenameFile: (reason: string) => `重命名文件失败：${reason}`,
    failedToDeleteFile: (reason: string) => `删除文件失败：${reason}`,
    failedToMoveFile: (reason: string) => `移动文件失败：${reason}`,
  },
};
