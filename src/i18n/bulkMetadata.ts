export interface BulkMetadataStrings {
  tagsTitle: string; propertiesTitle: string; addTags: string; removeTags: string;
  setProperties: string; removeProperties: string; addRow: string; removeRow: string; name: string; type: string; value: string;
  itemType: string; listItem: string;
  remove: string; add: string; apply: string; applying: string; cancel: string;
  targetCount: (count: number) => string; incomplete: string; descendants: string; invalid: string;
  result: (changed: number, noop: number, failed: number) => string;
  retry: string; types: Record<"text" | "list" | "number" | "checkbox" | "date" | "datetime", string>;
}
export const bulkMetadataStrings: Record<"en" | "zh", BulkMetadataStrings> = {
  en: {
    tagsTitle: "Bulk tag operations", propertiesTitle: "Bulk property operations", addTags: "Add tags", removeTags: "Remove tags",
    setProperties: "Set properties", removeProperties: "Remove properties", addRow: "Add property", removeRow: "Delete this row", name: "Property name", type: "Type", value: "Value",
    itemType: "List item type", listItem: "Add a list item",
    remove: "Remove", add: "Add", apply: "Apply", applying: "Applying…", cancel: "Cancel",
    targetCount: (count) => `Applies to ${count} Markdown ${count === 1 ? "note" : "notes"}`, incomplete: "Metadata is not ready for every note. Suggestions may be incomplete; you can still enter new names and values.",
    descendants: "Removing a parent tag also removes its child tags. Removals run before additions.", invalid: "Complete the values and resolve duplicate or conflicting names before applying.",
    result: (changed, noop, failed) => `${changed} modified; ${noop} unchanged; ${failed} failed.`,
    retry: "Failed notes may have been partially modified. Apply again to retry only the failed notes.",
    types: { text: "Text", list: "List", number: "Number", checkbox: "Checkbox", date: "Date", datetime: "Date & time" },
  },
  zh: {
    tagsTitle: "批量标签操作", propertiesTitle: "批量属性操作", addTags: "添加标签", removeTags: "移除标签",
    setProperties: "设置属性", removeProperties: "移除属性", addRow: "增加属性", removeRow: "删除此行", name: "属性名", type: "类型", value: "值",
    itemType: "列表项类型", listItem: "添加列表项",
    remove: "移除", add: "添加", apply: "应用", applying: "正在应用…", cancel: "取消",
    targetCount: (count) => `将作用于 ${count} 篇 Markdown 笔记`, incomplete: "部分笔记的元数据尚未就绪，建议可能不完整；仍可手动输入新名称和值。",
    descendants: "移除父标签时也会移除其子标签。先移除，再添加。", invalid: "请完成值输入，并解决重复名称或添加／移除冲突后再应用。",
    result: (changed, noop, failed) => `已修改 ${changed} 篇；无需修改 ${noop} 篇；失败 ${failed} 篇。`,
    retry: "失败笔记可能已部分修改。再次应用只会重试失败笔记。",
    types: { text: "文本", list: "列表", number: "数字", checkbox: "复选框", date: "日期", datetime: "日期时间" },
  },
};
