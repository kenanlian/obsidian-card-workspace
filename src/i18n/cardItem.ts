import type { UiLanguage } from "./types";

export interface CardItemStrings {
  searchCount: (count: number) => string;
  searchCountAria: (count: number) => string;
  bulkCheckboxAdd: string;
  bulkCheckboxRemove: string;
  pin: string;
  unpin: string;
  moreActions: string;
  dragInsert: string;
  placeholderLoading: string;
  placeholderEmpty: string;
  imageLoading: string;
  imageFailed: string;
  searchBodyUnavailable: string;
  searchSnippetsExpand: (count: number) => string;
  searchSnippetsMore: string;
  searchSnippetsCollapse: string;
  taskProgressAria: (completed: number, total: number) => string;
}

export const cardItemStrings: Record<UiLanguage, CardItemStrings> = {
  en: {
    searchCount: (count: number) => (count === 1 ? "1 match" : `${count} matches`),
    searchCountAria: (count: number) =>
      count === 1 ? "1 match in this note" : `${count} matches in this note`,
    bulkCheckboxAdd: "Add note to bulk selection",
    bulkCheckboxRemove: "Deselect note from bulk selection",
    pin: "Pin note",
    unpin: "Unpin note",
    moreActions: "More actions",
    dragInsert: "Insert here",
    placeholderLoading: "Loading preview...",
    placeholderEmpty: "No previewable text near the top.",
    imageLoading: "Loading image", imageFailed: "Image unavailable",
    searchBodyUnavailable: "Body preview unavailable",
    searchSnippetsExpand: (count: number) => `${count} more matching ${count === 1 ? "passage" : "passages"}`,
    searchSnippetsMore: "Show 20 more matches",
    searchSnippetsCollapse: "Collapse matches",
    taskProgressAria: (completed: number, total: number) =>
      `${completed} of ${total} ${total === 1 ? "task" : "tasks"} complete`,
  },
  zh: {
    searchCount: (count: number) => `${count} 次命中`,
    searchCountAria: (count: number) => `本笔记中有 ${count} 次命中`,
    bulkCheckboxAdd: "加入批量选择",
    bulkCheckboxRemove: "从批量选择中移除",
    pin: "固定笔记",
    unpin: "取消固定",
    moreActions: "更多操作",
    dragInsert: "在此处插入",
    placeholderLoading: "正在加载预览...",
    placeholderEmpty: "顶部附近没有可预览的文本。",
    imageLoading: "图片加载中", imageFailed: "图片不可用",
    searchBodyUnavailable: "正文预览不可用",
    searchSnippetsExpand: (count: number) => `还有 ${count} 条命中片段`,
    searchSnippetsMore: "再显示 20 处命中",
    searchSnippetsCollapse: "收起命中",
    taskProgressAria: (completed: number, total: number) =>
      `${total} 个任务中已完成 ${completed} 个`,
  },
};
