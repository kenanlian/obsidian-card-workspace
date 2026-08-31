import type { UiLanguage } from "./types";

export interface SortGroupStrings {
  title: string;
  sortFieldHeading: string;
  sortDirectionHeading: string;
  groupHeading: string;
  groupOrderHeading: string;
  directionAsc: string;
  directionDesc: string;
  fieldMtime: string;
  fieldCtime: string;
  fieldName: string;
  dimensionNone: string;
  dimensionFolder: string;
  dimensionTag: string;
  dimensionBoxRule: string;
  dimensionTask: string;
  dimensionBoxRuleUnavailable: string;
  orderDefault: string;
  orderName: string;
  orderCount: string;
  collapseAll: string;
  expandAll: string;
  groupHeaderAria: (label: string, count: number) => string;
  groupCount: (count: number) => string;
  bucketVaultRoot: string;
  bucketNoTag: string;
  bucketTaskIncomplete: string;
  bucketTaskComplete: string;
  bucketNoTask: string;
  bucketManual: string;
}

export const sortGroupStrings: Record<UiLanguage, SortGroupStrings> = {
  en: {
    title: "Sort & group",
    sortFieldHeading: "Sort by",
    sortDirectionHeading: "Order",
    groupHeading: "Group by",
    groupOrderHeading: "Group order",
    directionAsc: "Ascending",
    directionDesc: "Descending",
    fieldMtime: "Edited time",
    fieldCtime: "Created time",
    fieldName: "Filename",
    dimensionNone: "None",
    dimensionFolder: "Folder",
    dimensionTag: "Tag",
    dimensionBoxRule: "Card box rule",
    dimensionTask: "Task status",
    dimensionBoxRuleUnavailable: "Only available inside a card box",
    orderDefault: "Default",
    orderName: "Name",
    orderCount: "Card count",
    collapseAll: "Collapse all",
    expandAll: "Expand all",
    groupHeaderAria: (label: string, count: number) =>
      count === 1 ? `${label}, 1 card` : `${label}, ${count} cards`,
    groupCount: (count: number) => `${count}`,
    bucketVaultRoot: "Vault root",
    bucketNoTag: "No tag",
    bucketTaskIncomplete: "Incomplete tasks",
    bucketTaskComplete: "All tasks complete",
    bucketNoTask: "No tasks",
    bucketManual: "Manually added",
  },
  zh: {
    title: "排序与分组",
    sortFieldHeading: "排序依据",
    sortDirectionHeading: "顺序",
    groupHeading: "分组依据",
    groupOrderHeading: "分组顺序",
    directionAsc: "升序",
    directionDesc: "降序",
    fieldMtime: "编辑时间",
    fieldCtime: "创建时间",
    fieldName: "文件名",
    dimensionNone: "不分组",
    dimensionFolder: "文件夹",
    dimensionTag: "标签",
    dimensionBoxRule: "卡片盒规则",
    dimensionTask: "任务状态",
    dimensionBoxRuleUnavailable: "仅在卡片盒内可用",
    orderDefault: "默认",
    orderName: "名称",
    orderCount: "卡片数量",
    collapseAll: "全部折叠",
    expandAll: "全部展开",
    groupHeaderAria: (label: string, count: number) => `${label}，${count} 张卡片`,
    groupCount: (count: number) => `${count}`,
    bucketVaultRoot: "库根",
    bucketNoTag: "无标签",
    bucketTaskIncomplete: "有未完成",
    bucketTaskComplete: "全部完成",
    bucketNoTask: "无任务",
    bucketManual: "手动添加",
  },
};
