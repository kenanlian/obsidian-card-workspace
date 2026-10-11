import type { UiLanguage } from "./types";

export interface ToolbarStrings {
  filtersPaused: string;
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
    newNote: string;
    newNoteTitle: string;
    sort: string;
    sortTitle: string;
    bulk: string;
    bulkTitle: string;
    toggleSearch: string;
  };
  bulkSummary: (count: number) => string;
  bulkActionLabels: {
    selectAll: string;
    clearSelection: string;
    moveSelected: string;
    editTagsSelected: string;
    editPropertiesSelected: string;
    deleteSelected: string;
    mergeSelected: string;
  };
  folderMenu: {
    rootFolder: string;
    includeSubfolders: string;
    expand: string;
    collapse: string;
    moveFolder: string;
    deleteFolder: string;
  };
  navPane: {
    ariaLabel: string;
    collapsePane: string;
    expandPane: string;
    backToCards: string;
    resizeHandle: string;
    resizeValue: (width: number) => string;
    resizeKeyboardHelp: string;
    filterLabel: string;
    filterPlaceholder: string;
    clearFilter: string;
    noResults: string;
    moreActions: (label: string) => string;
    createFolder: string;
    createBox: string;
    clearActiveTags: string;
    activeTagCount: (count: number) => string;
    activeFileDescription: string;
    foldersSection: string;
    tagsSection: string;
    boxesSection: string;
    favoritesSection: string;
    favoritesEmpty: string;
    favoriteMissing: string;
    collapseSection: string;
    expandSection: string;
    tagsFilterUnavailable: string;
    propertiesFilterUnavailable: string;
    boxesEmpty: string;
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
    history: string;
    deleteHistory: (query: string) => string;
    clearHistory: string;
  };
  filter: {
    noTagsFound: string;
  };
}

export const toolbarStrings: Record<UiLanguage, ToolbarStrings> = {
  en: {
    filtersPaused: "Tag/property filters are paused in this view",
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
      newNote: "New",
      newNoteTitle: "Create note",
      sort: "Sort",
      sortTitle: "Sort cards",
      bulk: "Bulk",
      bulkTitle: "Bulk actions",
      toggleSearch: "Toggle search",
    },
    bulkSummary: (count: number) => (count === 1 ? "1 selected" : `${count} selected`),
    bulkActionLabels: {
      selectAll: "Select all",
      clearSelection: "Clear selection",
      moveSelected: "Move selected",
      editTagsSelected: "Bulk tag operations",
      editPropertiesSelected: "Bulk property operations",
      deleteSelected: "Delete selected",
      mergeSelected: "Merge selected",
    },
    folderMenu: {
      rootFolder: "Root /",
      includeSubfolders: "Including subfolders",
      expand: "Expand",
      collapse: "Collapse",
      moveFolder: "Move folder",
      deleteFolder: "Delete folder",
    },
    navPane: {
      ariaLabel: "Navigation",
      collapsePane: "Collapse navigation",
      expandPane: "Expand navigation",
      backToCards: "Back to cards",
      resizeHandle: "Resize navigation",
      resizeValue: (width: number) => `Navigation width: ${width} pixels`,
      resizeKeyboardHelp: "Use arrow keys to resize navigation",
      filterLabel: "Filter navigation",
      filterPlaceholder: "Filter navigation…",
      clearFilter: "Clear navigation filter",
      noResults: "No navigation items found",
      moreActions: (label: string) => `More actions for ${label}`,
      createFolder: "Create folder",
      createBox: "Create card box",
      clearActiveTags: "Clear active tag filters",
      activeTagCount: (count: number) => `${count} active tag${count === 1 ? "" : "s"}`,
      activeFileDescription: "Active file",
      foldersSection: "Folders",
      tagsSection: "Tags",
      boxesSection: "Boxes",
      favoritesSection: "Favorites",
      favoritesEmpty: "No favorites yet — right-click an item to add one",
      favoriteMissing: "(missing)",
      collapseSection: "Collapse section",
      expandSection: "Expand section",
      tagsFilterUnavailable: "Tag filter is unavailable in this view",
      propertiesFilterUnavailable: "Property filter is unavailable in this view",
      boxesEmpty: "No card boxes yet — right-click to create one",
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
      history: "Search history",
      deleteHistory: (query) => `Delete history: ${query}`,
      clearHistory: "Clear history",
    },
    filter: {
      noTagsFound: "No tags found",
    },
  },
  zh: {
    filtersPaused: "标签/属性筛选已在当前视图暂停",
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
      newNote: "新建",
      newNoteTitle: "创建笔记",
      sort: "排序",
      sortTitle: "排序卡片",
      bulk: "批量",
      bulkTitle: "批量操作",
      toggleSearch: "切换搜索",
    },
    bulkSummary: (count: number) => (count === 1 ? "已选 1 项" : `已选 ${count} 项`),
    bulkActionLabels: {
      selectAll: "全选",
      clearSelection: "清除选择",
      moveSelected: "移动所选",
      editTagsSelected: "批量标签操作",
      editPropertiesSelected: "批量属性操作",
      deleteSelected: "删除所选",
      mergeSelected: "合并所选",
    },
    folderMenu: {
      rootFolder: "根目录 /",
      includeSubfolders: "包含子文件夹",
      expand: "展开",
      collapse: "折叠",
      moveFolder: "移动文件夹",
      deleteFolder: "删除文件夹",
    },
    navPane: {
      ariaLabel: "导航",
      collapsePane: "折叠导航栏",
      expandPane: "展开导航栏",
      backToCards: "返回卡片",
      resizeHandle: "调整导航栏宽度",
      resizeValue: (width: number) => `导航栏宽度：${width} 像素`,
      resizeKeyboardHelp: "使用方向键调整导航栏宽度",
      filterLabel: "筛选导航",
      filterPlaceholder: "筛选导航…",
      clearFilter: "清除导航筛选",
      noResults: "未找到导航项目",
      moreActions: (label: string) => `${label}的更多操作`,
      createFolder: "新建文件夹",
      createBox: "新建卡片盒",
      clearActiveTags: "清除启用的标签筛选",
      activeTagCount: (count: number) => `${count} 个启用的标签`,
      activeFileDescription: "当前文件",
      foldersSection: "文件夹",
      tagsSection: "标签",
      boxesSection: "卡片盒",
      favoritesSection: "收藏",
      favoritesEmpty: "还没有收藏 — 右键任意条目即可添加",
      favoriteMissing: "（已失效）",
      collapseSection: "折叠此区",
      expandSection: "展开此区",
      tagsFilterUnavailable: "当前视图不可使用标签筛选",
      propertiesFilterUnavailable: "当前视图不可使用属性筛选",
      boxesEmpty: "还没有卡片盒 — 右键新建",
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
      history: "搜索历史",
      deleteHistory: (query) => `删除历史：${query}`,
      clearHistory: "清空历史",
    },
    filter: {
      noTagsFound: "未找到标签",
    },
  },
};
