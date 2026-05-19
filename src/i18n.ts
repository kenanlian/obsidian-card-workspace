import * as Obsidian from "obsidian";

export type UiLanguage = "en" | "zh";

export interface LocalizedOption<TValue extends string = string> {
  value: TValue;
  label: string;
}

export interface SettingTabStrings {
  enableFileExplorerFolderClicksName: string;
  enableFileExplorerFolderClicksDesc: string;
  defaultCardOpenBehaviorName: string;
  defaultCardOpenBehaviorDesc: string;
  cardCornerRadiusName: string;
  cardCornerRadiusDesc: string;
  previewLinesName: string;
  previewLinesDesc: (min: number, max: number) => string;
}

export interface ToolbarStrings {
  searchStatus: {
    buildingRestoring: string;
    building: string;
    rebuildVersionDrift: string;
    rebuildCorrupt: string;
    rebuildFolderChanged: string;
    rebuildRequired: string;
    storageUnavailable: string;
    error: string;
    unavailable: string;
    ready: string;
    idle: string;
  };
  sortOptions: {
    mtimeDesc: string;
    mtimeAsc: string;
    ctimeDesc: string;
    ctimeAsc: string;
  };
  actions: {
    toolbarAriaLabel: string;
    pickFolder: string;
    pickFolderTitle: string;
    selectFolder: string;
    allNotes: string;
    allNotesTitle: string;
    newNote: string;
    newNoteTitle: string;
    sort: string;
    sortTitle: string;
    filter: string;
    filterTitle: string;
    bulk: string;
    bulkTitle: string;
    toggleSearch: string;
  };
  bulkSummary: (count: number) => string;
  tagSummary: (count: number) => string;
  bulkActionLabels: {
    selectAll: string;
    clearSelection: string;
    moveSelected: string;
    deleteSelected: string;
    mergeSelected: string;
    exitBulkMode: string;
  };
  folderMenu: {
    allNotesScope: string;
    folderScope: string;
    includeSubfolders: string;
    directFolderOnly: string;
    subfoldersSrLabel: string;
    expand: string;
    collapse: string;
  };
  search: {
    placeholder: string;
    inputLabel: string;
    clear: string;
  };
  filter: {
    noTagsFound: string;
  };
}

export interface CardItemStrings {
  searchCount: (count: number) => string;
  searchCountAria: (count: number) => string;
  bulkCheckboxAdd: string;
  bulkCheckboxRemove: string;
  pin: string;
  unpin: string;
  moreActions: string;
  placeholderLoading: string;
  placeholderEmpty: string;
}

export interface FolderPickerStrings {
  selectFolderTitle: string;
}

export interface PanelStrings {
  loadingCards: string;
  searchBlockedTitle: string;
  searchBlockedStatusPrefix: string;
}

export interface FileKindStrings {
  markdown: string;
  base: string;
  canvas: string;
  excalidraw: string;
}

export interface NoteOpsStrings {
  fileNotFoundAfterMove: string;
  copiedToClipboard: (basename: string) => string;
  failedToCopyToClipboard: string;
  noFilesToMerge: string;
  mergedNotesDefaultTitle: string;
}

export interface DesktopShellStrings {
  unavailable: string;
  unknownError: string;
}

export interface ViewStrings {
  displayName: string;
  allNotes: string;
  emptyFolder: string;
  emptySearchAllNotes: (query: string) => string;
  emptySearchAllNotesWithTags: (query: string) => string;
  emptySearchCurrentFolder: (query: string) => string;
  emptySearchCurrentFolderWithTags: (query: string) => string;
  bulkConfirm: {
    cancel: string;
  };
  rename: {
    title: string;
    nameLabel: string;
    cancel: string;
    rename: string;
    renaming: string;
  };
  move: {
    chooseFolder: string;
    noSelectedNotes: string;
    allAlreadyInTargetFolder: string;
    moved: (count: number) => string;
    failed: (count: number) => string;
    partial: (success: number, failed: number) => string;
  };
  bulkDelete: {
    noLiveFilesMessage: string;
    confirmTitle: string;
    confirmButtonText: string;
    confirmMessage: (count: number) => string;
    successMessage: (count: number) => string;
    failureMessage: (count: number) => string;
    partialMessage: (success: number, failed: number) => string;
  };
  merge: {
    title: string;
    sourceCount: (count: number) => string;
    mergedTitle: string;
    targetFolder: string;
    separator: string;
    chooseFolder: string;
    sourceOrder: string;
    up: string;
    down: string;
    sourceCleanup: string;
    keepSourceNotes: string;
    trashSourceNotesAfterMerge: string;
    preview: string;
    loadingPreview: string;
    failedToBuildPreview: (reason: string) => string;
    cancel: string;
    mergeNotes: string;
    merging: string;
    defaultMergedTitle: string;
    selectAtLeastTwoNotes: string;
    failedToMergeNotes: (reason: string) => string;
    mergedInto: (count: number, basename: string) => string;
    trashedSources: (count: number) => string;
    failedToTrashSources: (count: number) => string;
    trashedSourcesPartial: (success: number, failed: number) => string;
  };
  contextMenu: {
    openInCurrentWindow: string;
    openInNewTab: string;
    openToTheRight: string;
    openInNewWindow: string;
    makeCopy: string;
    moveFileTo: string;
    copyNoteContent: string;
    rename: string;
    delete: string;
  };
}

export interface AppStrings {
  appName: string;
  untitledNoteBaseName: string;
  hoverSourceDisplay: string;
  openCardWorkspaceViewCommand: string;
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

export interface UiStrings {
  settingTab: SettingTabStrings;
  toolbar: ToolbarStrings;
  cardItem: CardItemStrings;
  folderPicker: FolderPickerStrings;
  panel: PanelStrings;
  fileKind: FileKindStrings;
  noteOps: NoteOpsStrings;
  desktopShell: DesktopShellStrings;
  view: ViewStrings;
  app: AppStrings;
}

function safeGetLanguage(): string {
  const maybeGetLanguage = (Obsidian as { getLanguage?: () => string }).getLanguage;
  return typeof maybeGetLanguage === "function" ? maybeGetLanguage() : "en";
}

export function resolveUiLanguage(language: string = safeGetLanguage()): UiLanguage {
  return language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function isChineseLanguage(language: string = safeGetLanguage()): boolean {
  return resolveUiLanguage(language) === "zh";
}

const EN: UiStrings = {
  settingTab: {
    enableFileExplorerFolderClicksName: "Link File Explorer folder clicks to Card Workspace",
    enableFileExplorerFolderClicksDesc:
      "When enabled, clicking a folder in Obsidian's File Explorer also opens that folder in Card Workspace. Card Workspace itself still stays available from the sidebar and commands.",
    defaultCardOpenBehaviorName: "Default card open behavior",
    defaultCardOpenBehaviorDesc:
      "Choose what happens when you click a card directly. Right-click menu actions stay available separately.",
    cardCornerRadiusName: "Card corner radius",
    cardCornerRadiusDesc: "Adjust how square or rounded each card border feels in the panel.",
    previewLinesName: "Preview lines",
    previewLinesDesc: (min: number, max: number) =>
      `Choose how many normalized summary lines each card preview can show (${min}-${max}).`,
  },
  toolbar: {
    searchStatus: {
      buildingRestoring: "Restoring index",
      building: "Building index",
      rebuildVersionDrift: "Rebuild required (version drift)",
      rebuildCorrupt: "Rebuild required (corrupted)",
      rebuildFolderChanged: "Rebuild required (folder changed)",
      rebuildRequired: "Rebuild required",
      storageUnavailable: "Search storage unavailable",
      error: "Search error",
      unavailable: "Search unavailable",
      ready: "Index ready",
      idle: "Search idle",
    },
    sortOptions: {
      mtimeDesc: "Edited time (newest first)",
      mtimeAsc: "Edited time (oldest first)",
      ctimeDesc: "Created time (newest first)",
      ctimeAsc: "Created time (oldest first)",
    },
    actions: {
      toolbarAriaLabel: "Folder card actions",
      pickFolder: "Pick folder",
      pickFolderTitle: "Folder scope",
      selectFolder: "Select folder",
      allNotes: "All notes",
      allNotesTitle: "All notes",
      newNote: "New",
      newNoteTitle: "Create note",
      sort: "Sort",
      sortTitle: "Sort cards",
      filter: "Filter",
      filterTitle: "Filter cards",
      bulk: "Bulk",
      bulkTitle: "Bulk actions",
      toggleSearch: "Toggle search",
    },
    bulkSummary: (count: number) => (count === 1 ? "1 selected" : `${count} selected`),
    tagSummary: (count: number) => `Tag filter: ${count} active`,
    bulkActionLabels: {
      selectAll: "Select all",
      clearSelection: "Clear selection",
      moveSelected: "Move selected",
      deleteSelected: "Delete selected",
      mergeSelected: "Merge selected",
      exitBulkMode: "Exit bulk mode",
    },
    folderMenu: {
      allNotesScope: "All notes",
      folderScope: "Folder scope",
      includeSubfolders: "Including subfolders",
      directFolderOnly: "Direct folder only",
      subfoldersSrLabel: "Subfolders",
      expand: "Expand",
      collapse: "Collapse",
    },
    search: {
      placeholder: "Search notes",
      inputLabel: "Search notes",
      clear: "Clear search query",
    },
    filter: {
      noTagsFound: "No tags found",
    },
  },
  cardItem: {
    searchCount: (count: number) => (count === 1 ? "1 match" : `${count} matches`),
    searchCountAria: (count: number) =>
      count === 1 ? "1 match in this note" : `${count} matches in this note`,
    bulkCheckboxAdd: "Add note to bulk selection",
    bulkCheckboxRemove: "Deselect note from bulk selection",
    pin: "Pin note",
    unpin: "Unpin note",
    moreActions: "More actions",
    placeholderLoading: "Loading preview...",
    placeholderEmpty: "No previewable text near the top.",
  },
  folderPicker: {
    selectFolderTitle: "Select a folder",
  },
  panel: {
    loadingCards: "Loading folder cards...",
    searchBlockedTitle: "Search is currently blocked",
    searchBlockedStatusPrefix: "Index status:",
  },
  fileKind: {
    markdown: "Markdown",
    base: "This is a base file.",
    canvas: "This is a canvas file.",
    excalidraw: "This is an excalidraw file.",
  },
  noteOps: {
    fileNotFoundAfterMove: "File not found after move",
    copiedToClipboard: (basename: string) => `Copied "${basename}" to clipboard`,
    failedToCopyToClipboard: "Failed to copy to clipboard",
    noFilesToMerge: "No files to merge",
    mergedNotesDefaultTitle: "Merged notes",
  },
  desktopShell: {
    unavailable: "Desktop shell support is unavailable.",
    unknownError: "Unknown error",
  },
  view: {
    displayName: "Card Workspace",
    allNotes: "All Notes",
    emptyFolder: "No supported files found in this folder.",
    emptySearchAllNotes: (query: string) => `No results for “${query}” in all notes.`,
    emptySearchAllNotesWithTags: (query: string) => `No results for “${query}” in current tag scope.`,
    emptySearchCurrentFolder: (query: string) => `No results for “${query}” in current folder.`,
    emptySearchCurrentFolderWithTags: (query: string) => `No results for “${query}” in current folder and tag scope.`,
    bulkConfirm: {
      cancel: "Cancel",
    },
    rename: {
      title: "Rename file",
      nameLabel: "Name",
      cancel: "Cancel",
      rename: "Rename",
      renaming: "Renaming…",
    },
    move: {
      chooseFolder: "Choose…",
      noSelectedNotes: "No selected notes are available to move.",
      allAlreadyInTargetFolder: "All selected notes are already in the target folder.",
      moved: (count: number) => `Moved ${count} note${count === 1 ? "" : "s"}.`,
      failed: (count: number) => `Failed to move ${count} note${count === 1 ? "" : "s"}.`,
      partial: (success: number, failed: number) => `Moved ${success} note${success === 1 ? "" : "s"}; ${failed} failed.`,
    },
    bulkDelete: {
      noLiveFilesMessage: "No selected notes are available to delete.",
      confirmTitle: "Delete selected notes?",
      confirmButtonText: "Delete",
      confirmMessage: (count: number) => `Delete ${count} selected note${count === 1 ? "" : "s"}? Obsidian will use your Files & Links delete preference.`,
      successMessage: (count: number) => `Deleted ${count} note${count === 1 ? "" : "s"}.`,
      failureMessage: (count: number) => `Failed to delete ${count} note${count === 1 ? "" : "s"}.`,
      partialMessage: (success: number, failed: number) => `Deleted ${success} note${success === 1 ? "" : "s"}; ${failed} failed.`,
    },
    merge: {
      title: "Merge selected notes",
      sourceCount: (count: number) => `${count} source note${count === 1 ? "" : "s"}`,
      mergedTitle: "Merged title",
      targetFolder: "Target folder",
      separator: "Separator",
      chooseFolder: "Choose…",
      sourceOrder: "Source order",
      up: "Up",
      down: "Down",
      sourceCleanup: "Source cleanup",
      keepSourceNotes: "Keep source notes",
      trashSourceNotesAfterMerge: "Trash source notes after merge",
      preview: "Preview",
      loadingPreview: "Loading preview...",
      failedToBuildPreview: (reason: string) => `Failed to build preview: ${reason}`,
      cancel: "Cancel",
      mergeNotes: "Merge notes",
      merging: "Merging…",
      defaultMergedTitle: "Merged notes",
      selectAtLeastTwoNotes: "Select at least 2 available notes to merge.",
      failedToMergeNotes: (reason: string) => `Failed to merge notes: ${reason}`,
      mergedInto: (count: number, basename: string) => `Merged ${count} notes into "${basename}".`,
      trashedSources: (count: number) => `Trashed ${count} source note${count === 1 ? "" : "s"}.`,
      failedToTrashSources: (count: number) => `Failed to trash ${count} source note${count === 1 ? "" : "s"}.`,
      trashedSourcesPartial: (success: number, failed: number) => `Trashed ${success} source note${success === 1 ? "" : "s"}; ${failed} failed.`,
    },
    contextMenu: {
      openInCurrentWindow: "Open in current window",
      openInNewTab: "Open in new tab",
      openToTheRight: "Open to the right",
      openInNewWindow: "Open in new window",
      makeCopy: "Make a copy",
      moveFileTo: "Move file to...",
      copyNoteContent: "Copy note content",
      rename: "Rename...",
      delete: "Delete",
    },
  },
  app: {
    appName: "Card Workspace",
    untitledNoteBaseName: "Untitled",
    hoverSourceDisplay: "Card Workspace",
    openCardWorkspaceViewCommand: "Open Card Workspace view",
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
};

const ZH: UiStrings = {
  settingTab: {
    enableFileExplorerFolderClicksName: "将文件资源管理器中的文件夹点击关联到 Card Workspace",
    enableFileExplorerFolderClicksDesc:
      "启用后，在 Obsidian 文件资源管理器中点击文件夹时，也会在 Card Workspace 中打开该文件夹。Card Workspace 仍然可以从侧边栏和命令中进入。",
    defaultCardOpenBehaviorName: "卡片默认打开方式",
    defaultCardOpenBehaviorDesc: "选择直接点击卡片时的行为。右键菜单操作仍可单独使用。",
    cardCornerRadiusName: "卡片圆角",
    cardCornerRadiusDesc: "调整面板中每张卡片边框的方正或圆润程度。",
    previewLinesName: "预览行数",
    previewLinesDesc: (min: number, max: number) => `选择每张卡片预览可显示的规范化摘要行数（${min}-${max}）。`,
  },
  toolbar: {
    searchStatus: {
      buildingRestoring: "正在恢复索引",
      building: "正在构建索引",
      rebuildVersionDrift: "需要重建（版本不一致）",
      rebuildCorrupt: "需要重建（已损坏）",
      rebuildFolderChanged: "需要重建（文件夹已变化）",
      rebuildRequired: "需要重建",
      storageUnavailable: "搜索存储不可用",
      error: "搜索出错",
      unavailable: "搜索不可用",
      ready: "索引已就绪",
      idle: "搜索空闲",
    },
    sortOptions: {
      mtimeDesc: "编辑时间（从新到旧）",
      mtimeAsc: "编辑时间（从旧到新）",
      ctimeDesc: "创建时间（从新到旧）",
      ctimeAsc: "创建时间（从旧到新）",
    },
    actions: {
      toolbarAriaLabel: "卡片操作",
      pickFolder: "选择文件夹",
      pickFolderTitle: "文件夹范围",
      selectFolder: "选择文件夹",
      allNotes: "全部笔记",
      allNotesTitle: "全部笔记",
      newNote: "新建",
      newNoteTitle: "新建笔记",
      sort: "排序",
      sortTitle: "排序卡片",
      filter: "筛选",
      filterTitle: "筛选卡片",
      bulk: "批量",
      bulkTitle: "批量操作",
      toggleSearch: "切换搜索",
    },
    bulkSummary: (count: number) => (count === 1 ? "已选 1 项" : `已选 ${count} 项`),
    tagSummary: (count: number) => `标签筛选：已启用 ${count} 个`,
    bulkActionLabels: {
      selectAll: "全选",
      clearSelection: "清除选择",
      moveSelected: "移动所选",
      deleteSelected: "删除所选",
      mergeSelected: "合并所选",
      exitBulkMode: "退出批量模式",
    },
    folderMenu: {
      allNotesScope: "全部笔记",
      folderScope: "文件夹范围",
      includeSubfolders: "包含子文件夹",
      directFolderOnly: "仅当前文件夹",
      subfoldersSrLabel: "子文件夹",
      expand: "展开",
      collapse: "折叠",
    },
    search: {
      placeholder: "搜索笔记",
      inputLabel: "搜索笔记",
      clear: "清除搜索内容",
    },
    filter: {
      noTagsFound: "未找到标签",
    },
  },
  cardItem: {
    searchCount: (count: number) => `${count} 次命中`,
    searchCountAria: (count: number) => `本笔记中有 ${count} 次命中`,
    bulkCheckboxAdd: "加入批量选择",
    bulkCheckboxRemove: "从批量选择中移除",
    pin: "固定笔记",
    unpin: "取消固定",
    moreActions: "更多操作",
    placeholderLoading: "正在加载预览...",
    placeholderEmpty: "顶部附近没有可预览的文本。",
  },
  folderPicker: {
    selectFolderTitle: "选择文件夹",
  },
  panel: {
    loadingCards: "正在加载文件夹卡片...",
    searchBlockedTitle: "搜索当前不可用",
    searchBlockedStatusPrefix: "索引状态：",
  },
  fileKind: {
    markdown: "Markdown",
    base: "这是一个 Base 文件。",
    canvas: "这是一个 Canvas 文件。",
    excalidraw: "这是一个 Excalidraw 文件。",
  },
  noteOps: {
    fileNotFoundAfterMove: "移动后未找到文件",
    copiedToClipboard: (basename: string) => `已将“${basename}”复制到剪贴板`,
    failedToCopyToClipboard: "复制到剪贴板失败",
    noFilesToMerge: "没有可合并的文件",
    mergedNotesDefaultTitle: "合并笔记",
  },
  desktopShell: {
    unavailable: "桌面外壳功能不可用。",
    unknownError: "未知错误",
  },
  view: {
    displayName: "Card Workspace",
    allNotes: "全部笔记",
    emptyFolder: "此文件夹中没有找到受支持的文件。",
    emptySearchAllNotes: (query: string) => `在全部笔记中没有找到“${query}”的结果。`,
    emptySearchAllNotesWithTags: (query: string) => `在当前标签范围内没有找到“${query}”的结果。`,
    emptySearchCurrentFolder: (query: string) => `在当前文件夹中没有找到“${query}”的结果。`,
    emptySearchCurrentFolderWithTags: (query: string) => `在当前文件夹和标签范围内没有找到“${query}”的结果。`,
    bulkConfirm: {
      cancel: "取消",
    },
    rename: {
      title: "重命名文件",
      nameLabel: "名称",
      cancel: "取消",
      rename: "重命名",
      renaming: "正在重命名…",
    },
    move: {
      chooseFolder: "选择…",
      noSelectedNotes: "没有可移动的所选笔记。",
      allAlreadyInTargetFolder: "所有所选笔记都已在目标文件夹中。",
      moved: (count: number) => `已移动 ${count} 篇笔记。`,
      failed: (count: number) => `移动 ${count} 篇笔记失败。`,
      partial: (success: number, failed: number) => `已移动 ${success} 篇笔记；${failed} 篇失败。`,
    },
    bulkDelete: {
      noLiveFilesMessage: "没有可删除的所选笔记。",
      confirmTitle: "删除所选笔记？",
      confirmButtonText: "删除",
      confirmMessage: (count: number) => `要删除 ${count} 篇所选笔记吗？Obsidian 将使用你在“文件与链接”中的删除偏好设置。`,
      successMessage: (count: number) => `已删除 ${count} 篇笔记。`,
      failureMessage: (count: number) => `删除 ${count} 篇笔记失败。`,
      partialMessage: (success: number, failed: number) => `已删除 ${success} 篇笔记；${failed} 篇失败。`,
    },
    merge: {
      title: "合并所选笔记",
      sourceCount: (count: number) => `${count} 篇源笔记`,
      mergedTitle: "合并后标题",
      targetFolder: "目标文件夹",
      separator: "分隔符",
      chooseFolder: "选择…",
      sourceOrder: "源顺序",
      up: "上移",
      down: "下移",
      sourceCleanup: "源文件清理",
      keepSourceNotes: "保留源笔记",
      trashSourceNotesAfterMerge: "合并后将源笔记移入废纸篓",
      preview: "预览",
      loadingPreview: "正在加载预览...",
      failedToBuildPreview: (reason: string) => `生成预览失败：${reason}`,
      cancel: "取消",
      mergeNotes: "合并笔记",
      merging: "正在合并…",
      defaultMergedTitle: "合并笔记",
      selectAtLeastTwoNotes: "请至少选择 2 篇可用笔记进行合并。",
      failedToMergeNotes: (reason: string) => `合并笔记失败：${reason}`,
      mergedInto: (count: number, basename: string) => `已将 ${count} 篇笔记合并到“${basename}”。`,
      trashedSources: (count: number) => `已将 ${count} 篇源笔记移入废纸篓。`,
      failedToTrashSources: (count: number) => `将 ${count} 篇源笔记移入废纸篓失败。`,
      trashedSourcesPartial: (success: number, failed: number) => `已将 ${success} 篇源笔记移入废纸篓；${failed} 篇失败。`,
    },
    contextMenu: {
      openInCurrentWindow: "在当前窗口打开",
      openInNewTab: "在新标签页打开",
      openToTheRight: "在右侧分栏打开",
      openInNewWindow: "在新窗口打开",
      makeCopy: "创建副本",
      moveFileTo: "移动文件到...",
      copyNoteContent: "复制笔记内容",
      rename: "重命名...",
      delete: "删除",
    },
  },
  app: {
    appName: "Card Workspace",
    untitledNoteBaseName: "未命名",
    hoverSourceDisplay: "Card Workspace",
    openCardWorkspaceViewCommand: "打开 Card Workspace 视图",
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

function selectStrings<T>(language: string, english: T, chinese: T): T {
  return resolveUiLanguage(language) === "zh" ? chinese : english;
}

export function getUiStrings(language: string = safeGetLanguage()): UiStrings {
  return selectStrings(language, EN, ZH);
}

export function getSettingTabStrings(language: string = safeGetLanguage()): SettingTabStrings {
  return getUiStrings(language).settingTab;
}

export function getToolbarStrings(language: string = safeGetLanguage()): ToolbarStrings {
  return getUiStrings(language).toolbar;
}

export function getCardItemStrings(language: string = safeGetLanguage()): CardItemStrings {
  return getUiStrings(language).cardItem;
}

export function getAppStrings(language: string = safeGetLanguage()): AppStrings {
  return getUiStrings(language).app;
}

export function getDefaultCardOpenBehaviorOptions(language: string = safeGetLanguage()): LocalizedOption[] {
  const zh = resolveUiLanguage(language) === "zh";
  return [
    { value: "smart", label: zh ? "当前窗格 / 当前标签页" : "Current pane / current tab" },
    { value: "new-tab", label: zh ? "在新标签页中打开" : "Open in new tab" },
    { value: "split-right", label: zh ? "在右侧分栏打开" : "Open to the right" },
    { value: "new-window", label: zh ? "在新窗口中打开" : "Open in new window" },
  ];
}

export function getCardCornerRadiusOptions(language: string = safeGetLanguage()): LocalizedOption[] {
  const zh = resolveUiLanguage(language) === "zh";
  return [
    { value: "compact", label: zh ? "紧凑" : "Compact" },
    { value: "medium", label: zh ? "柔和" : "Softer" },
    { value: "rounded", label: zh ? "圆角" : "Rounded" },
  ];
}
