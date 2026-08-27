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
  taskIncompleteAria: (count: number) => string;
  taskAllCompleteAria: string;
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
    taskIncompleteAria: (count: number) =>
      count === 1 ? "1 incomplete task" : `${count} incomplete tasks`,
    taskAllCompleteAria: "All tasks complete",
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
    taskIncompleteAria: (count: number) => `${count} 个未完成任务`,
    taskAllCompleteAria: "任务已全部完成",
  },
};
