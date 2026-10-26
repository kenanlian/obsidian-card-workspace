import type { UiLanguage } from "./types";

export interface SettingTabStrings {
  fileVisibilityName: string;
  fileVisibilityDesc: string;
  fileVisibilityOptions: Record<"documents" | "supported" | "all", string>;
  behaviorHeading: string;
  appearanceHeading: string;
  defaultCardOpenBehaviorName: string;
  defaultCardOpenBehaviorDesc: string;
  locateLinkCardOnOpenName: string;
  locateLinkCardOnOpenDesc: string;
  dragInsertActionName: string;
  dragInsertActionDesc: string;
  enableHeadingDragInsertName: string;
  enableHeadingDragInsertDesc: string;
  newNoteTemplateName: string;
  newNoteTemplateDesc: string;
  cardCornerRadiusName: string;
  cardCornerRadiusDesc: string;
  uiFontSizeName: string;
  uiFontSizeDesc: string;
  uiDensityName: string;
  uiDensityDesc: string;
  cardStyleName: string;
  cardStyleDesc: string;
  cardImageModeName: string;
  cardImageModeDesc: string;
  cardImageFitName: string;
  cardImageFitDesc: string;
  imageOff: string;
  imageRight: string;
  imageInline: string;
  imageContain: string;
  imageCover: string;
  previewLinesName: string;
  previewLinesDesc: (min: number, max: number) => string;
  backlinkSnippetCountName: string;
  backlinkSnippetCountDesc: string;
  allReferenceSnippets: string;
  searchPreviewSnippetCountName: string;
  searchPreviewSnippetCountDesc: string;
  hoverPreviewWidthName: string;
  hoverPreviewHeightName: string;
  hoverPreviewDimensionDesc: (min: number, max: number, defaultValue: number) => string;
  showNavItemCountsName: string;
  showNavItemCountsDesc: string;
}

export const settingTabStrings: Record<UiLanguage, SettingTabStrings> = {
  en: {
    fileVisibilityName: "Show file types",
    fileVisibilityDesc: "Apply to folders, boxes and links. Supported formats follow Obsidian and installed plugins; refresh after changing plugins. All formats may open in external apps.",
    fileVisibilityOptions: { documents: "Documents only", supported: "Common formats", all: "All formats" },
    behaviorHeading: "Behavior",
    appearanceHeading: "Appearance",
    defaultCardOpenBehaviorName: "Default card open behavior",
    defaultCardOpenBehaviorDesc:
      "Choose what happens when you click a card directly. Right-click menu actions stay available separately.",
    locateLinkCardOnOpenName: "Jump to link location when opening a link card",
    locateLinkCardOnOpenDesc: "Open a backlinks or outgoing-links card at its previewed link location. With Remember Cursor Position enabled, an older position may appear briefly before the link location is restored. Other cursor-restoring plugins depend on their implementation. This may save the new position as the note's last position.",
    dragInsertActionName: "Card drag insert behavior",
    dragInsertActionDesc: "Choose what happens when a card is dropped into a Markdown editor.",
    enableHeadingDragInsertName: "Enable section drag insertion",
    enableHeadingDragInsertDesc: "Choose a heading section when dropping a Markdown card. Uses the selected drag insert behavior; whole-note insertion stays available.",
    newNoteTemplateName: "New note content",
    newNoteTemplateDesc:
      "Choose what the toolbar's create-note action writes into a new note: an empty tags property, or nothing at all.",
    cardCornerRadiusName: "Card corner radius",
    cardCornerRadiusDesc: "Adjust how square or rounded each card border feels in the panel.",
    uiFontSizeName: "Font size",
    uiFontSizeDesc: "Scale text in the cards, toolbar, and navigation pane relative to Obsidian's interface font size.",
    uiDensityName: "Density",
    uiDensityDesc: "Adjust spacing between and inside cards, and the height of navigation rows and the search box.",
    cardStyleName: "Card style",
    cardStyleDesc: "Choose how each card is framed: default cards, a minimal outline, list rows separated by lines, flat color blocks, or a left accent bar.",
    cardImageModeName: "Card images",
    cardImageModeDesc: "Show image files and the first supported local image in a note body. Images load near the viewport and thumbnails are cached locally.",
    cardImageFitName: "Image fit",
    cardImageFitDesc: "Show the whole image or crop it to fill the image area.",
    imageOff: "Off", imageRight: "Right thumbnail", imageInline: "Below title",
    imageContain: "Show whole image", imageCover: "Crop to fill",
    previewLinesName: "Preview lines",
    backlinkSnippetCountName: "Default backlink reference snippets",
    backlinkSnippetCountDesc: "Show 1, 2, 3, or all reference contexts by default. Remaining contexts can be expanded in each card.",
    allReferenceSnippets: "All",
    searchPreviewSnippetCountName: "Maximum search hit snippets in each card preview",
    searchPreviewSnippetCountDesc: "Choose the maximum number of body hit snippets shown during search. Each snippet occupies two lines.",
    hoverPreviewWidthName: "Card hover preview width",
    hoverPreviewHeightName: "Card hover preview height",
    hoverPreviewDimensionDesc: (min, max, defaultValue) =>
      `Size in pixels (${min}–${max}; default ${defaultValue}). Applies to page previews opened from cards; shrinks to fit the window. Requires the Page preview core plugin.`,
    previewLinesDesc: (min: number, max: number) =>
      `Choose how many normalized summary lines each card preview can show (${min}-${max}).`,
    showNavItemCountsName: "Show item counts in navigation",
    showNavItemCountsDesc:
      "Show how many cards each folder and tag contributes in the navigation pane. Folder counts follow the include-subfolders toggle, and tag counts include child tags.",
  },
  zh: {
    fileVisibilityName: "显示文件类型",
    fileVisibilityDesc: "适用于文件夹、卡片盒和链接列表。常规格式跟随 Obsidian 和已安装插件，变更插件后请刷新；全部格式可能通过外部应用打开。",
    fileVisibilityOptions: { documents: "仅文档", supported: "常规格式", all: "全部格式" },
    behaviorHeading: "行为",
    appearanceHeading: "外观",
    defaultCardOpenBehaviorName: "卡片默认打开方式",
    defaultCardOpenBehaviorDesc: "选择直接点击卡片时的行为。右键菜单操作仍可单独使用。",
    locateLinkCardOnOpenName: "双链卡片点击定位",
    locateLinkCardOnOpenDesc: "打开反链或出链卡片时跳到预览的链接位置。启用 Remember Cursor Position 时可能短暂显示旧位置，随后回到链接位置；其他恢复光标插件的行为取决于其实现。跳转后，新位置可能被记为笔记的上次位置。",
    dragInsertActionName: "卡片拖拽插入行为",
    dragInsertActionDesc: "选择将卡片拖入 Markdown 编辑器时的处理方式。",
    enableHeadingDragInsertName: "启用章节拖拽插入",
    enableHeadingDragInsertDesc: "拖入 Markdown 卡片时选择标题章节，沿用当前拖拽插入方式，并保留整篇笔记入口。",
    newNoteTemplateName: "新建笔记内容",
    newNoteTemplateDesc: "选择工具栏“创建笔记”生成的笔记内容：带一个空的 tags 属性，或完全空白。",
    cardCornerRadiusName: "卡片圆角",
    cardCornerRadiusDesc: "调整面板中每张卡片边框的方正或圆润程度。",
    uiFontSizeName: "字体大小",
    uiFontSizeDesc: "以 Obsidian 界面字号为基准，缩放卡片、工具栏和导航栏中的文字。",
    uiDensityName: "紧凑程度",
    uiDensityDesc: "调整卡片之间与卡片内部的间距，以及导航行和搜索框的高度。",
    cardStyleName: "卡片样式",
    cardStyleDesc: "选择卡片的外框：默认卡片、极简边框、以分隔线区分的列表、扁平色块，或左侧强调条。",
    cardImageModeName: "卡片图片",
    cardImageModeDesc: "显示图片文件，以及笔记正文中第一张受支持的本地图片。图片在浏览区域附近按需加载，缩略图在本地缓存。",
    cardImageFitName: "图片显示方式",
    cardImageFitDesc: "完整显示图片，或裁切铺满图片区域。",
    imageOff: "关闭", imageRight: "右侧缩略图", imageInline: "标题下方内联图片",
    imageContain: "完整显示", imageCover: "裁切铺满",
    previewLinesName: "预览行数",
    backlinkSnippetCountName: "反链默认显示的引用片段数",
    backlinkSnippetCountDesc: "默认显示 1、2、3 条或全部引用上下文，可在每张卡片中展开其余引用。",
    allReferenceSnippets: "全部",
    searchPreviewSnippetCountName: "每张卡片预览最多显示的命中片段",
    searchPreviewSnippetCountDesc: "搜索时最多显示多少个正文命中片段，每个片段占两行。",
    hoverPreviewWidthName: "卡片悬浮预览宽度",
    hoverPreviewHeightName: "卡片悬浮预览高度",
    hoverPreviewDimensionDesc: (min, max, defaultValue) =>
      `尺寸单位为像素（${min}–${max}，默认 ${defaultValue}）。适用于从卡片打开的页面预览，会随窗口大小收缩。需启用核心插件“页面预览”。`,
    previewLinesDesc: (min: number, max: number) => `选择每张卡片预览可显示的规范化摘要行数（${min}-${max}）。`,
    showNavItemCountsName: "在导航栏显示条目计数",
    showNavItemCountsDesc:
      "在导航栏中显示每个文件夹和标签包含的卡片数量。文件夹计数会跟随“包含子文件夹”开关变化，标签计数包含其子标签。",
  },
};
