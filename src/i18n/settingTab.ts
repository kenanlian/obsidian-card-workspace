import type { UiLanguage } from "./types";

export type SettingsPageId = "appearance" | "cards-preview" | "navigation" | "opening-dragging" | "notes-templates" | "tasks" | "quick-input" | "default-icons";

export interface SettingTabStrings {
  pages: Record<SettingsPageId, { name: string; desc: string }>;
  groups: Record<"text" | "style" | "content" | "references" | "images" | "hover" | "sections" | "entries" | "opening" | "dragging" | "newNotes" | "templateFiles" | "saving" | "fields" | "window" | "shortcut" | "tasks" | "taskDisplay" | "taskColors", string>;
  taskColorNames: Record<"created" | "done" | "due" | "overdue", string>;
  taskColorsDesc: string;
  back: string;
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
  boxNewNoteFolderName: string;
  boxNewNoteFolderDesc: string;
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
  skipLeadingTagsName: string;
  skipLeadingTagsDesc: string;
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
  enhancedTaskEditingName: string;
  enhancedTaskEditingDesc: string;
  autoCreatedDateName: string;
  autoCreatedDateDesc: string;
  autoDoneDateName: string;
  autoDoneDateDesc: string;
  taskDateButtonsName: string;
  taskDateButtonsDesc: string;
  taskDateButtonsOptions: Record<"compact" | "full", string>;
  taskDateButtonStyleName: string;
  taskDateButtonStyleDesc: string;
  taskDateButtonStyleOptions: Record<"chips" | "dots", string>;
  taskDateHideSourceName: string;
  taskDateHideSourceDesc: string;
  taskCompletedStyleName: string;
  taskCompletedStyleDesc: string;
  taskCompletedStyles: Record<"none" | "strikethrough" | "muted", string>;
  taskCardShowFileName: string;
  taskCardShowFileDesc: string;
}

export const settingTabStrings: Record<UiLanguage, SettingTabStrings> = {
  en: {
    pages: {
      "appearance": {
        "name": "Interface appearance",
        "desc": "Fonts, spacing, card styles and colors"
      },
      "cards-preview": {
        "name": "Cards and previews",
        "desc": "File types, summaries, images and hover previews"
      },
      "navigation": {
        "name": "Navigation",
        "desc": "Sections, item counts and hidden entries"
      },
      "opening-dragging": {
        "name": "Opening and dragging",
        "desc": "Card opening, link locations and editor insertion"
      },
      "notes-templates": {
        "name": "New notes and templates",
        "desc": "Initial content, destinations and template storage"
      },
      "tasks": { name: "Task view", desc: "Task cards, editing and date colors" },
      "quick-input": {
        "name": "Quick input",
        "desc": "Saving rules, input fields, window and shortcut"
      },
      "default-icons": {
        "name": "Default icons",
        "desc": "Icons for navigation entries and file cards"
      }
    },
    groups: {
      "text": "Text and spacing",
      "style": "Card style",
      "content": "Displayed content",
      "references": "References and search",
      "images": "Images",
      "hover": "Hover preview",
      "sections": "Visible sections",
      "entries": "Navigation entries",
      "opening": "Card opening",
      "dragging": "Drag insertion",
      "newNotes": "New notes",
      "templateFiles": "Template files",
      "saving": "Saving and appending",
      "fields": "Input fields",
      "window": "Window appearance",
      "shortcut": "Shortcut",
      "tasks": "Task editing", "taskDisplay": "Task cards", "taskColors": "Date colors"
    },
    taskColorNames: { created: "Created date color", done: "Completed date color", due: "Due date color", overdue: "Overdue color" },
    taskColorsDesc: "Choose a theme color. Applies to task cards and editor date buttons.",
    back: "Back",
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
    boxNewNoteFolderName: "Folder for new notes in card boxes",
    boxNewNoteFolderDesc: "Notes created from a card box are saved here and manually added to that box. Defaults to the vault root. Leave empty or enter / for the root.",
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
    skipLeadingTagsName: "Skip leading tags",
    skipLeadingTagsDesc: "Skip tag-only lines at the start of a note in card previews, leaving more room for the body.",
    previewLinesName: "Preview lines",
    backlinkSnippetCountName: "Default backlink reference snippets",
    backlinkSnippetCountDesc: "Show 1, 2, 3, or all reference contexts by default. Remaining contexts can be expanded in each card.",
    allReferenceSnippets: "All",
    searchPreviewSnippetCountName: "Default search hit snippets in each card preview",
    searchPreviewSnippetCountDesc: "Choose the number of body hit snippets shown by default during search. Each snippet occupies two lines. Remaining snippets can be expanded in each card.",
    hoverPreviewWidthName: "Card hover preview width",
    hoverPreviewHeightName: "Card hover preview height",
    hoverPreviewDimensionDesc: (min, max, defaultValue) =>
      `Size in pixels (${min}–${max}; default ${defaultValue}). Applies to page previews opened from cards; shrinks to fit the window. Requires the Page preview core plugin.`,
    previewLinesDesc: (min: number, max: number) =>
      `Choose how many normalized summary lines each card preview can show (${min}-${max}).`,
    showNavItemCountsName: "Show item counts in navigation",
    showNavItemCountsDesc:
      "Show how many cards each folder and tag contributes in the navigation pane. Folder counts follow the include-subfolders toggle, and tag counts include child tags.",
    enhancedTaskEditingName: "Enhanced task editing",
    enhancedTaskEditingDesc: "In Live Preview, show created, completed and due date buttons at the end of task lines. The \"Insert task or convert lines to tasks\" command stays available either way.",
    autoCreatedDateName: "Add created date to new tasks",
    autoCreatedDateDesc: "The \"Insert task or convert lines to tasks\" command adds today's created date (\u2795) when it creates or converts a task. With enhanced task editing on, a task created in the editor by pressing Enter, typing a checkbox, or a checkbox command gets it immediately when its checkbox appears, even before any task text is entered.",
    autoDoneDateName: "Add completion date when checking off tasks",
    autoDoneDateDesc: "Add today's completion date (\u2705) when a task is checked on a task card or in the editor, and remove it when the task is unchecked. The editor applies it only while enhanced task editing is on. An existing completion date, such as one written by the Tasks plugin, is kept.",
    taskDateButtonsName: "Task date buttons",
    taskDateButtonsDesc: "Compact shows unset dates only on the hovered or current line. Full always shows all three buttons.",
    taskDateButtonsOptions: { compact: "Compact", full: "Full" },
    taskDateButtonStyleName: "Task date button style",
    taskDateButtonStyleDesc: "Chips look like the date chips on task cards and show the date when task date text is hidden. Dots keep one small dot per date. Both use the date colors configured below.",
    taskDateButtonStyleOptions: { chips: "Chips", dots: "Dots" },
    taskDateHideSourceName: "Hide task date text",
    taskDateHideSourceDesc: "In Live Preview, hide task date text and show dates only through the date buttons at the end of the line. The line being edited still shows the text. The note itself is unchanged.",
    taskCompletedStyleName: "Completed task appearance",
    taskCompletedStyleDesc: "Choose the text style for completed tasks on task cards.",
    taskCompletedStyles: { none: "No style", strikethrough: "Strikethrough", muted: "Muted text" },
    taskCardShowFileName: "Show source note on task cards",
    taskCardShowFileDesc: "Show the note each task comes from at the bottom of its task card. Subtask progress is shown either way.",
  },
  zh: {
    pages: {
      "appearance": {
        "name": "界面外观",
        "desc": "字体、间距、卡片样式与颜色"
      },
      "cards-preview": {
        "name": "卡片与预览",
        "desc": "文件类型、摘要、图片与悬浮预览"
      },
      "navigation": {
        "name": "导航栏",
        "desc": "分区显示、条目计数与隐藏条目"
      },
      "opening-dragging": {
        "name": "打开与拖拽",
        "desc": "点击打开、链接定位与编辑器插入"
      },
      "notes-templates": {
        "name": "新建与模板",
        "desc": "新建内容、保存位置与模板文件夹"
      },
      "tasks": { name: "任务视图", desc: "任务卡片、任务编辑与日期颜色" },
      "quick-input": {
        "name": "快速输入",
        "desc": "保存规则、输入字段、窗口与快捷键"
      },
      "default-icons": {
        "name": "默认图标",
        "desc": "导航条目与各类文件卡片的图标"
      }
    },
    groups: {
      "text": "文字与间距",
      "style": "卡片样式",
      "content": "显示内容",
      "references": "引用与搜索",
      "images": "图片",
      "hover": "悬浮预览",
      "sections": "分区显示",
      "entries": "条目显示",
      "opening": "点击打开",
      "dragging": "拖拽插入",
      "newNotes": "新建笔记",
      "templateFiles": "模板文件",
      "saving": "保存与追加",
      "fields": "输入字段",
      "window": "窗口外观",
      "shortcut": "快捷键",
      "tasks": "任务编辑", "taskDisplay": "任务卡片", "taskColors": "日期颜色"
    },
    taskColorNames: { created: "创建日期颜色", done: "完成日期颜色", due: "截止日期颜色", overdue: "逾期颜色" },
    taskColorsDesc: "选择主题颜色，同时应用于任务卡片和编辑器日期按钮。",
    back: "返回",
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
    boxNewNoteFolderName: "卡片盒新建笔记保存位置",
    boxNewNoteFolderDesc: "从卡片盒新建的笔记保存在此文件夹，并手动加入该卡片盒。默认为仓库根目录；留空或填写 / 使用根目录。",
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
    skipLeadingTagsName: "预览跳过顶部标签",
    skipLeadingTagsDesc: "卡片预览跳过笔记开头仅包含标签的行，为正文留出更多空间。",
    previewLinesName: "预览行数",
    backlinkSnippetCountName: "反链默认显示的引用片段数",
    backlinkSnippetCountDesc: "默认显示 1、2、3 条或全部引用上下文，可在每张卡片中展开其余引用。",
    allReferenceSnippets: "全部",
    searchPreviewSnippetCountName: "每张卡片预览默认显示的命中片段数",
    searchPreviewSnippetCountDesc: "搜索时默认显示多少个正文命中片段，每个片段占两行，可在每张卡片中展开其余命中片段。",
    hoverPreviewWidthName: "卡片悬浮预览宽度",
    hoverPreviewHeightName: "卡片悬浮预览高度",
    hoverPreviewDimensionDesc: (min, max, defaultValue) =>
      `尺寸单位为像素（${min}–${max}，默认 ${defaultValue}）。适用于从卡片打开的页面预览，会随窗口大小收缩。需启用核心插件“页面预览”。`,
    previewLinesDesc: (min: number, max: number) => `选择每张卡片预览可显示的规范化摘要行数（${min}-${max}）。`,
    showNavItemCountsName: "在导航栏显示条目计数",
    showNavItemCountsDesc:
      "在导航栏中显示每个文件夹和标签包含的卡片数量。文件夹计数会跟随“包含子文件夹”开关变化，标签计数包含其子标签。",
    enhancedTaskEditingName: "增强任务编辑",
    enhancedTaskEditingDesc: "在实时预览中，于任务行末显示创建、完成与截止日期按钮。“插入任务或将所选行转为任务”命令始终可用。",
    autoCreatedDateName: "新任务添加创建日期",
    autoCreatedDateDesc: "“插入任务或将所选行转为任务”命令创建或转换任务时，添加今天的创建日期（\u2795）。开启增强任务编辑时，在编辑器中通过回车、输入复选框或复选框命令新建的任务，也会在复选框出现时立即添加，无需输入内容或回车。",
    autoDoneDateName: "勾选任务时添加完成日期",
    autoDoneDateDesc: "在任务卡片或编辑器中勾选任务时添加今天的完成日期（\u2705），取消勾选时移除。编辑器中仅在开启增强任务编辑时生效。已有的完成日期（例如 Tasks 插件写入的）会保留。",
    taskDateButtonsName: "任务日期按钮",
    taskDateButtonsDesc: "紧凑：未设置的日期仅在鼠标悬停行或当前行显示。完整：始终显示全部三个按钮。",
    taskDateButtonsOptions: { compact: "紧凑", full: "完整" },
    taskDateButtonStyleName: "任务日期按钮样式",
    taskDateButtonStyleDesc: "标签：与任务卡片上的日期标签一致，隐藏任务日期文本时直接显示日期。圆点：每个日期一个小圆点。两种样式均使用下方设置的日期颜色。",
    taskDateButtonStyleOptions: { chips: "标签", dots: "圆点" },
    taskDateHideSourceName: "隐藏任务日期文本",
    taskDateHideSourceDesc: "在实时预览中隐藏任务日期文本，只通过行末的日期按钮显示日期。正在编辑的行仍显示文本，笔记原文不受影响。",
    taskCompletedStyleName: "已完成任务效果",
    taskCompletedStyleDesc: "选择任务卡片中已完成任务的文字效果。",
    taskCompletedStyles: { none: "无样式", strikethrough: "删除线", muted: "字体变淡" },
    taskCardShowFileName: "在任务卡片上显示所属笔记",
    taskCardShowFileDesc: "在任务卡片底部显示任务所在的笔记。子任务进度始终显示。",
  },
};
