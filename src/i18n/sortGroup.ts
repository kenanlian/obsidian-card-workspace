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
  fieldReferenceCount: string;
  dimensionCtime: string;
  dimensionMtime: string;
  timeGranularity: string;
  timeGranularities: Record<"day" | "week" | "biweek" | "month" | "year" | "relative", string>;
  relativeBuckets: { today: string; yesterday: string; week: string; month: string; older: string; future: string; unknown: string };
  dimensionNone: string;
  dimensionFolder: string;
  dimensionTag: string;
  dimensionBoxRule: string;
  dimensionTask: string;
  dimensionProperty: string;
  enablePropertyHint: string;
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
  bucketPropertyUnassigned: string;
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
    fieldReferenceCount: "Reference count",
    dimensionCtime: "Created time",
    dimensionMtime: "Edited time",
    timeGranularity: "Time granularity",
    timeGranularities: { day: "Day", week: "Week", biweek: "Two weeks", month: "Month", year: "Year", relative: "Relative periods" },
    relativeBuckets: { today: "Today", yesterday: "Yesterday", week: "Past 7 days", month: "Past 30 days", older: "Older", future: "Future", unknown: "Unknown time" },
    dimensionNone: "None",
    dimensionFolder: "Folder",
    dimensionTag: "Tag",
    dimensionBoxRule: "Card box rule",
    dimensionTask: "Task status",
    dimensionProperty: "Property",
    enablePropertyHint: "Enable a property in navigation first",
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
    bucketPropertyUnassigned: "Unassigned",
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
    fieldReferenceCount: "引用次数",
    dimensionCtime: "创建时间",
    dimensionMtime: "编辑时间",
    timeGranularity: "时间粒度",
    timeGranularities: { day: "按天", week: "按周", biweek: "按双周", month: "按月", year: "按年", relative: "相对时间段" },
    relativeBuckets: { today: "今天", yesterday: "昨天", week: "过去 7 天", month: "过去 30 天", older: "更早", future: "未来", unknown: "未知时间" },
    dimensionNone: "不分组",
    dimensionFolder: "文件夹",
    dimensionTag: "标签",
    dimensionBoxRule: "卡片盒规则",
    dimensionTask: "任务状态",
    dimensionProperty: "属性",
    enablePropertyHint: "请先在导航栏启用属性",
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
    bucketPropertyUnassigned: "未赋值",
  },
};
