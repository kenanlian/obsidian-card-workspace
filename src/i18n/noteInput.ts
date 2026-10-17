import type { UiLanguage } from "./types";

export interface NoteInputStrings {
  templates: string;
  templatesEmpty: string;
  newTemplate: string;
  editTemplate: string;
  targetFolder: string;
  dateFormat: string;
  timeFormat: string;
  unregisterTemplate: string;
  templateName: string;
  templateNameDesc: string;
  renameTemplate: string;
  invalidTemplateName: string;
  targetFolderDesc: string;
  templateStorageFolder: string;
  templateStorageFolderDesc: string;
  invalidTemplateFolder: string;
  initialTemplateTitle: string;
  initialTemplateBody: string;
  editTitleRequired: string;
  apply: string;
  applying: string;
  templateUnavailable: string;
  templateNotFound: string;
  targetFolderRequired: string;
  targetFolderNotFound: string;
  targetConflict: string;
  templateTargetConflict: string;
  targetChanged: string;
  pendingSaveUnavailable: string;
  dateFormatUnavailable: string;
  targetNoteMissing: string;
  invalidFilename: string;
  create: string;
  cancel: string;
  quickInput: string;
  quickInputCommand: string;
  quickInputHeading: string;
  quickInputTemplateName: string;
  quickInputTemplateDesc: string;
  noTemplate: string;
  quickInputFolderName: string;
  quickInputFolderDesc: string;
  quickInputPositionName: string;
  quickInputPositionDesc: string;
  quickInputWidthName: string;
  quickInputHeightName: string;
  quickInputDimensionDesc: (min: number, max: number, defaultValue: number) => string;
  quickInputColorName: string;
  quickInputColorDesc: string;
  colorRandom: string;
  colorAccent: string;
  colorNames: Record<"red" | "orange" | "yellow" | "green" | "cyan" | "blue" | "purple" | "pink", string>;
  destinationUnavailable: string;
  insertStart: string;
  insertEnd: string;
  rootFolder: string;
  inputPlaceholder: string;
  send: string;
  sending: string;
  nativeEditorUnavailable: string;
  invalidQuickInputConfig: string;
  openQuickInputFailed: string;
  createFailed: (reason: string) => string;
  sendFailed: (reason: string) => string;
  saveTemplateFailed: (reason: string) => string;
  sent: (path: string) => string;
  noteCreated: (path: string) => string;
  noteOpened: (path: string) => string;
}

export const noteInputStrings: Record<UiLanguage, NoteInputStrings> = {
  en: {
    templates: "Templates", templatesEmpty: "No templates registered", newTemplate: "New template",
    editTemplate: "Edit template", targetFolder: "New note folder",
    dateFormat: "Date format", timeFormat: "Time format", unregisterTemplate: "Remove from templates",
    templateName: "Template name", templateNameDesc: "Shown in navigation and template choices. This name is not used as the filename of created notes.",
    renameTemplate: "Rename template", invalidTemplateName: "Enter a template name.",
    targetFolderDesc: "Notes created with this template are saved in this folder. Leave empty for the vault root.",
    templateStorageFolder: "Template storage folder",
    templateStorageFolderDesc: "Stores all template files. Applying a different folder moves existing templates there, preserving their filenames and content. Conflicting files are never overwritten. A missing folder is created automatically.",
    invalidTemplateFolder: "Enter a valid, non-hidden vault folder path.",
    initialTemplateTitle: "Edit the template title here, use {{date}} and {{time}} for the current date and time",
    initialTemplateBody: "> Edit the template body here, use {{date}} and {{time}} for the current date and time.",
    editTitleRequired: "Edit the template title before using this template.", apply: "Apply", applying: "Applying…",
    templateUnavailable: "Template unavailable", templateNotFound: "The registered Markdown template is missing.",
    targetFolderRequired: "Choose a fixed destination folder for this template first.",
    targetFolderNotFound: "The destination folder is missing.", targetConflict: "The target path is occupied by another file or folder.",
    targetChanged: "The target changed after an uncertain save. Check the note before sending this draft again.",
    pendingSaveUnavailable: "The editor with this draft's unsaved insertion is no longer available. Check the target note before resending.",
    dateFormatUnavailable: "The host date formatter is unavailable.", targetNoteMissing: "The target note is missing.",
    templateTargetConflict: "The target note cannot be the template itself.", invalidFilename: "Enter a valid Markdown filename.",
    create: "Create", cancel: "Cancel",
    quickInput: "Quick input", quickInputCommand: "Open quick input", quickInputHeading: "Quick input",
    quickInputTemplateName: "Quick input template", quickInputTemplateDesc: "Use a registered template's fixed destination and filename. Missing templates must be selected again.",
    noTemplate: "No template", quickInputFolderName: "Quick input folder", quickInputFolderDesc: "Used when no template is selected. Leave empty for the vault root.",
    quickInputPositionName: "Insert position", quickInputPositionDesc: "Insert after frontmatter at the start, or append to the end of the note.",
    quickInputWidthName: "Quick input width", quickInputHeightName: "Quick input height",
    quickInputDimensionDesc: (min, max, defaultValue) =>
      `Size in pixels (${min}–${max}; default ${defaultValue}) for each new draft. Resizing a draft only affects that draft; it shrinks to fit the window.`,
    quickInputColorName: "Quick input frame color",
    quickInputColorDesc: "Random picks a different theme color for each new draft.",
    colorRandom: "Random", colorAccent: "Accent color",
    colorNames: { red: "Red", orange: "Orange", yellow: "Yellow", green: "Green", cyan: "Cyan", blue: "Blue", purple: "Purple", pink: "Pink" },
    destinationUnavailable: "Destination unavailable",
    insertStart: "Start of note", insertEnd: "End of note", rootFolder: "Vault root",
    inputPlaceholder: "Write a note…", send: "Send", sending: "Sending…",
    nativeEditorUnavailable: "The native Markdown editor is unavailable in this Obsidian version.",
    invalidQuickInputConfig: "Quick input settings refer to an unavailable template or folder.",
    openQuickInputFailed: "Could not open quick input.",
    createFailed: (reason) => `Could not create the note: ${reason}`,
    sendFailed: (reason) => `Could not send. Your draft is kept: ${reason}`,
    saveTemplateFailed: (reason) => `Could not save template settings: ${reason}`,
    sent: (path) => `Sent to ${path}`, noteCreated: (path) => `Created ${path}`, noteOpened: (path) => `Opened ${path}`,
  },
  zh: {
    templates: "模板", templatesEmpty: "尚未注册模板", newTemplate: "新建模板",
    editTemplate: "编辑模板", targetFolder: "新建笔记文件夹", dateFormat: "日期格式", timeFormat: "时间格式", unregisterTemplate: "从模板中移除",
    templateName: "模板名称", templateNameDesc: "用于在导航区和模板选择中显示，不作为使用模板创建的笔记文件名。",
    renameTemplate: "重命名模板", invalidTemplateName: "请输入模板名称。",
    targetFolderDesc: "使用此模板创建的笔记将保存在此文件夹中，留空表示仓库根目录。",
    templateStorageFolder: "模板存储文件夹",
    templateStorageFolderDesc: "所有模板文件保存在此文件夹中。应用新的文件夹后，现有模板会自动迁移过去，保留原文件名和正文，不覆盖同名文件。文件夹不存在时会自动创建。",
    invalidTemplateFolder: "请输入有效的非隐藏仓库文件夹路径。",
    initialTemplateTitle: "请在此处编辑模板标题，支持通过{{date}}和{{time}}来显示当前日期和时间",
    initialTemplateBody: "> 请在此处编辑模板正文，支持通过{{date}}和{{time}}来显示当前日期和时间。",
    editTitleRequired: "请先编辑模板标题，再使用此模板。", apply: "应用", applying: "应用中…",
    templateUnavailable: "模板不可用",
    templateNotFound: "已注册的 Markdown 模板文件不存在。", targetFolderRequired: "请先为此模板选择固定目标文件夹。",
    targetFolderNotFound: "目标文件夹不存在。", targetConflict: "目标路径已被其他文件或文件夹占用。",
    targetChanged: "保存结果不确定后，目标笔记又有变化。请先检查笔记，再重新发送草稿。",
    pendingSaveUnavailable: "包含本次未保存内容的编辑器已不可用。请先检查目标笔记，再重新发送。",
    dateFormatUnavailable: "无法使用宿主日期格式化能力。", targetNoteMissing: "目标笔记不存在。",
    templateTargetConflict: "目标笔记不能是模板文件本身。", invalidFilename: "请输入有效的 Markdown 文件名。",
    create: "创建", cancel: "取消", quickInput: "快速输入", quickInputCommand: "打开快速输入",
    quickInputHeading: "快速输入", quickInputTemplateName: "快速输入模板", quickInputTemplateDesc: "使用已注册模板的固定目标和文件名；模板丢失后需要重新选择。",
    noTemplate: "不使用模板", quickInputFolderName: "快速输入文件夹", quickInputFolderDesc: "未选择模板时使用，留空表示仓库根目录。",
    quickInputPositionName: "插入位置", quickInputPositionDesc: "在笔记开头的属性之后插入，或追加到笔记末尾。",
    quickInputWidthName: "快速输入窗口宽度", quickInputHeightName: "快速输入窗口高度",
    quickInputDimensionDesc: (min, max, defaultValue) =>
      `每个新草稿的尺寸，单位为像素（${min}–${max}，默认 ${defaultValue}）。拖拽调整只影响当前草稿，会随窗口大小收缩。`,
    quickInputColorName: "快速输入边框颜色",
    quickInputColorDesc: "选择“随机”时，每个新草稿使用一种与上次不同的主题颜色。",
    colorRandom: "随机", colorAccent: "强调色",
    colorNames: { red: "红色", orange: "橙色", yellow: "黄色", green: "绿色", cyan: "青色", blue: "蓝色", purple: "紫色", pink: "粉色" },
    destinationUnavailable: "目标不可用",
    insertStart: "笔记开头", insertEnd: "笔记末尾", rootFolder: "仓库根目录", inputPlaceholder: "记录笔记…", send: "发送", sending: "发送中…",
    nativeEditorUnavailable: "当前 Obsidian 版本无法使用原生 Markdown 编辑器。",
    invalidQuickInputConfig: "快速输入设置引用了不可用的模板或文件夹。", openQuickInputFailed: "无法打开快速输入。",
    createFailed: (reason) => `无法创建笔记：${reason}`, sendFailed: (reason) => `无法发送，草稿已保留：${reason}`,
    saveTemplateFailed: (reason) => `无法保存模板设置：${reason}`, sent: (path) => `已发送到 ${path}`, noteCreated: (path) => `已创建 ${path}`, noteOpened: (path) => `已打开 ${path}`,
  },
};
