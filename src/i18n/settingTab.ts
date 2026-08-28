import type { UiLanguage } from "./types";

export interface SettingTabStrings {
  defaultCardOpenBehaviorName: string;
  defaultCardOpenBehaviorDesc: string;
  dragInsertActionName: string;
  dragInsertActionDesc: string;
  newNoteTemplateName: string;
  newNoteTemplateDesc: string;
  cardCornerRadiusName: string;
  cardCornerRadiusDesc: string;
  previewLinesName: string;
  previewLinesDesc: (min: number, max: number) => string;
  showNavItemCountsName: string;
  showNavItemCountsDesc: string;
  navSectionOrderName: string;
  navSectionOrderDesc: string;
  navSectionOrderMoveUp: string;
  navSectionOrderMoveDown: string;
  navSectionOrderReset: string;
}

export const settingTabStrings: Record<UiLanguage, SettingTabStrings> = {
  en: {
    defaultCardOpenBehaviorName: "Default card open behavior",
    defaultCardOpenBehaviorDesc:
      "Choose what happens when you click a card directly. Right-click menu actions stay available separately.",
    dragInsertActionName: "Card drag insert behavior",
    dragInsertActionDesc: "Choose what happens when a card is dropped into a Markdown editor.",
    newNoteTemplateName: "New note content",
    newNoteTemplateDesc:
      "Choose what the toolbar's create-note action writes into a new note: an empty tags property, or nothing at all.",
    cardCornerRadiusName: "Card corner radius",
    cardCornerRadiusDesc: "Adjust how square or rounded each card border feels in the panel.",
    previewLinesName: "Preview lines",
    previewLinesDesc: (min: number, max: number) =>
      `Choose how many normalized summary lines each card preview can show (${min}-${max}).`,
    showNavItemCountsName: "Show item counts in navigation",
    showNavItemCountsDesc:
      "Show how many cards each folder and tag contributes in the navigation pane. Folder counts follow the include-subfolders toggle, and tag counts include child tags.",
    navSectionOrderName: "Navigation section order",
    navSectionOrderDesc:
      "Arrange the order of the navigation pane's sections. Collapse state is tracked separately and is unaffected.",
    navSectionOrderMoveUp: "Move up",
    navSectionOrderMoveDown: "Move down",
    navSectionOrderReset: "Restore default order",
  },
  zh: {
    defaultCardOpenBehaviorName: "卡片默认打开方式",
    defaultCardOpenBehaviorDesc: "选择直接点击卡片时的行为。右键菜单操作仍可单独使用。",
    dragInsertActionName: "卡片拖拽插入行为",
    dragInsertActionDesc: "选择将卡片拖入 Markdown 编辑器时的处理方式。",
    newNoteTemplateName: "新建笔记内容",
    newNoteTemplateDesc: "选择工具栏“创建笔记”生成的笔记内容：带一个空的 tags 属性，或完全空白。",
    cardCornerRadiusName: "卡片圆角",
    cardCornerRadiusDesc: "调整面板中每张卡片边框的方正或圆润程度。",
    previewLinesName: "预览行数",
    previewLinesDesc: (min: number, max: number) => `选择每张卡片预览可显示的规范化摘要行数（${min}-${max}）。`,
    showNavItemCountsName: "在导航栏显示条目计数",
    showNavItemCountsDesc:
      "在导航栏中显示每个文件夹和标签包含的卡片数量。文件夹计数会跟随“包含子文件夹”开关变化，标签计数包含其子标签。",
    navSectionOrderName: "导航区分区顺序",
    navSectionOrderDesc: "调整导航区各分区的上下顺序。折叠状态单独记录，不受影响。",
    navSectionOrderMoveUp: "上移",
    navSectionOrderMoveDown: "下移",
    navSectionOrderReset: "恢复默认顺序",
  },
};
