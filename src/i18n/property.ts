import type { UiLanguage } from "./types";

/**
 * Property navigation/filtering strings (C9). Cancel/Done reuse the existing
 * semantically identical `box` domain copy.
 */
export interface PropertyStrings {
  sectionLabel: string;
  chooseVisible: string;
  searchPlaceholder: string;
  clearFilters: string;
  hideThisProperty: string;
  addToFilter: string;
  removeFromFilter: string;
  filterByOnlyThisValue: string;
  emptyNoProperties: string;
  partialWarning: string;
  unavailable: string;
  sectionEmpty: string;
  valueUnassigned: string;
  valueTrue: string;
  valueFalse: string;
  typeText: string;
  typeNumber: string;
  typeBoolean: string;
  activeFilterSummary: (count: number) => string;
  emptyPropertyFilter: string;
}

export const propertyStrings: Record<UiLanguage, PropertyStrings> = {
  en: {
    sectionLabel: "Properties",
    chooseVisible: "Choose visible properties",
    searchPlaceholder: "Search properties…",
    clearFilters: "Clear property filters",
    hideThisProperty: "Hide this property",
    addToFilter: "Add to filter",
    removeFromFilter: "Remove from filter",
    filterByOnlyThisValue: "Filter by only this value",
    emptyNoProperties: "No properties found",
    partialWarning: "Some property metadata is still loading",
    unavailable: "Property metadata is unavailable",
    sectionEmpty: "No properties selected — choose which properties to show",
    valueUnassigned: "Unassigned",
    valueTrue: "True",
    valueFalse: "False",
    typeText: "Text",
    typeNumber: "Number",
    typeBoolean: "Boolean",
    activeFilterSummary: (count: number) =>
      count === 1 ? "1 property filter active" : `${count} property filters active`,
    emptyPropertyFilter: "No notes match the current property filters.",
  },
  zh: {
    sectionLabel: "属性",
    chooseVisible: "选择可见属性",
    searchPlaceholder: "搜索属性…",
    clearFilters: "清除属性筛选",
    hideThisProperty: "隐藏此属性",
    addToFilter: "加入筛选",
    removeFromFilter: "从筛选中移除",
    filterByOnlyThisValue: "仅按此值筛选",
    emptyNoProperties: "未发现属性",
    partialWarning: "部分属性元数据仍在加载",
    unavailable: "属性元数据暂不可用",
    sectionEmpty: "尚未选择属性——请选择要显示的属性",
    valueUnassigned: "未分配",
    valueTrue: "是",
    valueFalse: "否",
    typeText: "文本",
    typeNumber: "数字",
    typeBoolean: "布尔值",
    activeFilterSummary: (count: number) => `已启用 ${count} 个属性筛选`,
    emptyPropertyFilter: "没有笔记符合当前属性筛选。",
  },
};
