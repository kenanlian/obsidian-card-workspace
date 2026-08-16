import type { UiLanguage } from "./types";

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
    nameAsc: string;
    nameDesc: string;
  };
  actions: {
    toolbarAriaLabel: string;
    pickFolder: string;
    pickFolderTitle: string;
    selectFolder: string;
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
    addTagSelected: string;
    removeTagSelected: string;
    deleteSelected: string;
    mergeSelected: string;
  };
  folderMenu: {
    folderScope: string;
    rootFolder: string;
    includeSubfolders: string;
    directFolderOnly: string;
    subfoldersSrLabel: string;
    expand: string;
    collapse: string;
    createChildFolder: string;
    moveFolder: string;
    deleteFolder: string;
  };
  navPane: {
    ariaLabel: string;
    collapsePane: string;
    expandPane: string;
    backToCards: string;
    expandAll: string;
    collapseAll: string;
    resizeHandle: string;
    foldersSection: string;
    tagsSection: string;
    boxesSection: string;
    favoritesSection: string;
    favoritesEmpty: string;
    favoriteMissing: string;
    newFolderAtRoot: string;
    collapseSection: string;
    expandSection: string;
    tagsDisabledInBox: string;
    boxesEmpty: string;
    exitBox: string;
    folderCountsTooltip: (files: number, folders: number) => string;
    tagCountsTooltip: (files: number, subtags: number) => string;
    boxCountsTooltip: (files: number) => string;
  };
  scope: {
    ariaLabel: string;
    separator: string;
  };
  search: {
    placeholder: string;
    inputLabel: string;
    clear: string;
  };
  filter: {
    title: string;
    noTagsFound: string;
    selectedTagSummary: (tag: string) => string;
    selectedTagClearLabel: string;
    clear: string;
    cancel: string;
    apply: string;
  };
}

export const toolbarStrings: Record<UiLanguage, ToolbarStrings> = {
  en: {
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
      nameAsc: "Filename (A to Z)",
      nameDesc: "Filename (Z to A)",
    },
    actions: {
      toolbarAriaLabel: "Folder card actions",
      pickFolder: "Pick folder",
      pickFolderTitle: "Folder scope",
      selectFolder: "Select folder",
      newNote: "New",
      newNoteTitle: "Create note",
      sort: "Sort",
      sortTitle: "Sort cards",
      filter: "Tags",
      filterTitle: "Tag filter",
      bulk: "Bulk",
      bulkTitle: "Bulk actions",
      toggleSearch: "Toggle search",
    },
    bulkSummary: (count: number) => (count === 1 ? "1 selected" : `${count} selected`),
    tagSummary: (count: number) => (count === 1 ? "1 tag selected" : `${count} tags selected`),
    bulkActionLabels: {
      selectAll: "Select all",
      clearSelection: "Clear selection",
      moveSelected: "Move selected",
      addTagSelected: "Add tag to selected",
      removeTagSelected: "Remove tag from selected",
      deleteSelected: "Delete selected",
      mergeSelected: "Merge selected",
    },
    folderMenu: {
      folderScope: "Folder scope",
      rootFolder: "Root /",
      includeSubfolders: "Including subfolders",
      directFolderOnly: "Direct folder only",
      subfoldersSrLabel: "Subfolders",
      expand: "Expand",
      collapse: "Collapse",
      createChildFolder: "Create child folder",
      moveFolder: "Move folder",
      deleteFolder: "Delete folder",
    },
    navPane: {
      ariaLabel: "Navigation",
      collapsePane: "Collapse navigation",
      expandPane: "Expand navigation",
      backToCards: "Back to cards",
      expandAll: "Expand all",
      collapseAll: "Collapse all",
      resizeHandle: "Resize navigation",
      foldersSection: "Folders",
      tagsSection: "Tags",
      boxesSection: "Boxes",
      favoritesSection: "Favorites",
      favoritesEmpty: "No favorites yet — right-click an item to add one",
      favoriteMissing: "(missing)",
      newFolderAtRoot: "New folder in vault root",
      collapseSection: "Collapse section",
      expandSection: "Expand section",
      tagsDisabledInBox: "Tag filter is unavailable in a box",
      boxesEmpty: "No card boxes yet — right-click to create one",
      exitBox: "Exit box",
      folderCountsTooltip: (files: number, folders: number) =>
        `${files} file${files === 1 ? "" : "s"}, ${folders} folder${folders === 1 ? "" : "s"}`,
      tagCountsTooltip: (files: number, subtags: number) =>
        `${files} file${files === 1 ? "" : "s"}, ${subtags} subtag${subtags === 1 ? "" : "s"}`,
      boxCountsTooltip: (files: number) => `${files} file${files === 1 ? "" : "s"}`,
    },
    scope: {
      ariaLabel: "Current scope",
      separator: " · ",
    },
    search: {
      placeholder: "Search notes",
      inputLabel: "Search notes",
      clear: "Clear search query",
    },
    filter: {
      title: "Tag filter",
      noTagsFound: "No tags found",
      selectedTagSummary: (tag: string) => `${tag} tag selected`,
      selectedTagClearLabel: "Clear selected tag",
      clear: "Clear",
      cancel: "Cancel",
      apply: "Apply",
    },
  },
  zh: {
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
      nameAsc: "文件名（A 到 Z）",
      nameDesc: "文件名（Z 到 A）",
    },
    actions: {
      toolbarAriaLabel: "卡片操作",
      pickFolder: "选择文件夹",
      pickFolderTitle: "文件夹范围",
      selectFolder: "选择文件夹",
      newNote: "新建",
      newNoteTitle: "创建笔记",
      sort: "排序",
      sortTitle: "排序卡片",
      filter: "标签",
      filterTitle: "标签筛选",
      bulk: "批量",
      bulkTitle: "批量操作",
      toggleSearch: "切换搜索",
    },
    bulkSummary: (count: number) => (count === 1 ? "已选 1 项" : `已选 ${count} 项`),
    tagSummary: (count: number) => (count === 1 ? "已选 1 个标签" : `已选 ${count} 个标签`),
    bulkActionLabels: {
      selectAll: "全选",
      clearSelection: "清除选择",
      moveSelected: "移动所选",
      addTagSelected: "为所选添加标签",
      removeTagSelected: "移除所选标签",
      deleteSelected: "删除所选",
      mergeSelected: "合并所选",
    },
    folderMenu: {
      folderScope: "文件夹范围",
      rootFolder: "根目录 /",
      includeSubfolders: "包含子文件夹",
      directFolderOnly: "仅当前文件夹",
      subfoldersSrLabel: "子文件夹",
      expand: "展开",
      collapse: "折叠",
      createChildFolder: "新建子文件夹",
      moveFolder: "移动文件夹",
      deleteFolder: "删除文件夹",
    },
    navPane: {
      ariaLabel: "导航",
      collapsePane: "折叠导航栏",
      expandPane: "展开导航栏",
      backToCards: "返回卡片",
      expandAll: "全部展开",
      collapseAll: "全部折叠",
      resizeHandle: "调整导航栏宽度",
      foldersSection: "文件夹",
      tagsSection: "标签",
      boxesSection: "卡片盒",
      favoritesSection: "收藏",
      favoritesEmpty: "还没有收藏 — 右键任意条目即可添加",
      favoriteMissing: "（已失效）",
      newFolderAtRoot: "在库根目录新建文件夹",
      collapseSection: "折叠此区",
      expandSection: "展开此区",
      tagsDisabledInBox: "卡片盒模式下不可使用标签筛选",
      boxesEmpty: "还没有卡片盒 — 右键新建",
      exitBox: "退出卡片盒",
      folderCountsTooltip: (files: number, folders: number) =>
        `${files} 个文件, ${folders} 个文件夹`,
      tagCountsTooltip: (files: number, subtags: number) => `${files} 个文件, ${subtags} 个子标签`,
      boxCountsTooltip: (files: number) => `${files} 个文件`,
    },
    scope: {
      ariaLabel: "当前范围",
      separator: " · ",
    },
    search: {
      placeholder: "搜索笔记",
      inputLabel: "搜索笔记",
      clear: "清除搜索内容",
    },
    filter: {
      title: "标签筛选",
      noTagsFound: "未找到标签",
      selectedTagSummary: (tag: string) => `已选标签：${tag}`,
      selectedTagClearLabel: "清除所选标签",
      clear: "清除",
      cancel: "取消",
      apply: "应用",
    },
  },
};
