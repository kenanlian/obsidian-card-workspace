# Creating notes, templates and quick input

The top **New note** button creates in the current folder, including the vault root. Selected tags and text, number or boolean property filters become YAML properties. When several values for a property are selected, the first actual value in the complete navigation order is used. A missing-only selection writes no property. Boxes and links use the most recently visited folder and leave paused browsing filters out.

The **Templates** section appears below Links by default. **New template** asks for a display name and the folder for notes created with the template. The folder input suggests existing vault folders; leave it empty for the vault root. The display name appears in navigation and template choices and does not determine created-note filenames. Creation opens the template in editing mode and selects its initial title. Replace the title to define created-note filenames; edit or delete the initial body guidance (it is actual template content).

In settings, **Template storage folder** applies to all template files and defaults to `Card Workspace Templates`. Its input suggests vault folders. Press **Apply** or Enter after choosing a path to migrate existing templates, preserving filenames, content, destinations and template choices. Missing storage folders are created automatically. Missing templates or filename conflicts stop migration; files are never overwritten or automatically renamed. Hidden folders are not supported. The row menu edits the file, renames its display name, changes the new-note folder or date/time formats, or removes registration without deleting the file. Registered files remain accessible in Obsidian's file browser and are excluded from Card Workspace cards and their counts.

Template note titles come from the template filename. An unchanged initial title must be edited before using the template. All `{{date}}` and `{{time}}` tokens in the title and content use one local time snapshot. Characters that cannot appear in filenames become `-`; date slashes do not create folders. Clicking again when the target exists opens that note without overwriting it. Opening a template note keeps the current card scope.

Use the search icon beside the paper-plane button on the right of the navigation header to expand the independent navigation filter; click again to clear and hide it. The filter uses the card search control's appearance without history suggestions. Its clear button clears the query and keeps focus; Escape keeps the query. The paper-plane button, or the **Open quick input** command, opens a new floating draft each time; several drafts can stay open in one window. Each draft is a compact card with a colored frame: drag the three-dot grip at the top to move it, or resize its edges/corners. The bottom of the frame shows where the draft will be saved (template or folder, plus insert position) and turns into a warning when that destination is unavailable. Clicking elsewhere keeps the draft; Cancel discards it. Enter inserts a newline and Ctrl/Cmd+Enter sends; composition input cannot send accidentally.

In settings, choose a registered template or a fixed quick-input folder, and whether to insert at the start or end. Start means after YAML properties. With a template, a new target receives the template and your input; an existing target receives only your input. Without a template, the filename is `quick-note YYYY-MM-DD HH-mm-ss`, with numbering for collisions. Tokens typed in your draft are kept literally. Success closes the draft and shows its saved path without opening the note. A failed submission retains the exact draft and captured configuration for retry; Cancel releases that draft. Missing references block sending.

Settings also set the size of each new draft (default 480 × 270 pixels) and its frame color: **Random** picks a theme color different from the previous draft, or choose the accent color or one fixed color. Resizing a draft only affects that draft; the next draft opens at the configured size where the last one was placed.

Quick input uses an internal native Markdown editor capability adapter. If the host does not provide compatible capabilities, opening shows a message. Automated tests cover the adapter seam; real Obsidian 1.11.4 and current-version compatibility still require host verification.

# 笔记创建、模板与快速输入

顶部“新建笔记”在当前文件夹创建，包括仓库根目录，并继承选中标签及文本、数字、布尔属性筛选。同一属性多选时取完整导航排序中第一个实际值；仅选“缺失”时不写该属性。盒子、链接范围使用最近浏览的文件夹，不继承暂停的筛选。

“模板”区默认位于双链下方。“新建模板”填写模板名称和新建笔记文件夹，文件夹输入框提供已有仓库文件夹建议，留空表示仓库根目录。模板名称用于导航和模板选择，不作为生成笔记的文件名。创建后直接进入模板编辑模式，并选中初始标题。修改标题来定义生成笔记的文件名；正文引导行属于实际内容，若希望正文为空，请删除该行。

设置中的“模板存储文件夹”统一应用于所有模板，默认 `Card Workspace Templates`，同样提供输入框和文件夹建议。选好路径后点击“应用”或按 Enter，现有模板自动迁移，保留文件名、正文、笔记目标文件夹和模板选择；存储目录不存在时自动创建。模板丢失或存在同名冲突时停止迁移，不覆盖文件、不自动改名。不支持隐藏目录。行菜单可编辑模板、重命名导航名称、修改新建笔记文件夹和日期／时间格式，以及取消登记。登记文件从插件卡片与数量统计中排除，仍可从 Obsidian 文件浏览器访问。取消登记保留原文件。

目标标题来自模板文件名，初始标题未修改时会提示先编辑；标题及正文中的全部 `{{date}}`、`{{time}}` 使用同一个本地时间快照。文件名禁用字符替换为 `-`，日期中的 `/` 不生成文件夹。目标已存在时直接打开，不覆盖内容；打开后保持卡片范围。

导航顶部右侧、纸飞机旁的搜索图标展开独立导航筛选，再次点击清空并收起。搜索框沿用卡片搜索的样式，不提供历史建议；清除按钮清空查询并保留焦点，Escape 保留查询。最右侧纸飞机或“打开快速输入”命令每次打开一个新的浮动草稿，同一窗口可同时保留多个草稿。草稿是带彩色边框的小卡片：拖动顶部三点手柄移动，拖动边角调整大小。边框底部显示保存位置（模板或文件夹及插入位置），目标不可用时变为警告提示。失焦保留，取消丢弃。Enter 换行，Ctrl/Cmd+Enter 发送，输入法组合期间不发送。

设置可选择模板、无模板时的固定保存文件夹及正文首尾插入位置。“正文开头”位于 YAML 属性之后。模板目标首次创建合成模板与输入，已有笔记仅插入本次输入；无模板时使用时间戳标题，重名编号。输入中的变量文本不替换。发送成功关闭并提示保存位置，不打开目标笔记；失败保留草稿及本次固定配置供重试，取消可释放草稿。引用缺失时禁止发送。

设置还可调整新草稿的窗口大小（默认 480 × 270 像素）和边框颜色：“随机”每次选用与上一个草稿不同的主题颜色，也可选择强调色或固定颜色。拖拽调整只影响当前草稿；下一个草稿在上次的位置以设置的大小打开。

原生 Markdown 编辑器使用独立的内部能力兼容适配层，宿主能力不兼容时提示不可用。自动测试覆盖适配接口，Obsidian 1.11.4 与当前版本的实际宿主验证仍待执行。
