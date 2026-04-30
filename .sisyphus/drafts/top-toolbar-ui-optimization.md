# Draft: Top Toolbar UI Optimization

## Requirements (confirmed)
- 顶部范围信息只保留一处：保留文件夹按钮 + 文件夹名称，删除摘要区里的 Scope 文本。
- 摘要区删除 Scope / Tag filter / Status / Subfolders 常驻文本。
- 摘要区仅在有意义时显示：有 tag 筛选时显示 tag 筛选状态；索引异常或特殊状态时显示状态 badge。
- 一级按钮结构保持现状：folder / all-notes / new-note / sort / filter / bulk。
- 搜索改成一级按钮触发展开：新增或改成放大镜一级按钮，点击后在按钮下方展开搜索框，再次点击收起。
- 搜索框右侧使用 x 图标清空，而不是文字 Clear。
- 状态 badge 只在 building / fallback / error 时显示；idle / ready 不显示。
- Bulk 区改成紧凑操作条：左侧仅保留“3 selected”这类选中数，右侧保留批量动作按钮。
- Bulk 区删除 Bulk mode / Range anchor ready/idle / 长提示文案，并收紧 bulk 按钮尺寸。
- Subfolders 保留为一级按钮区旁边的小型 toggle/chip，文案为 Subfolders，不显示 On / Off，选中态高亮表示包含子文件夹，未选中表示仅当前文件夹。

## Technical Decisions
- 顶部区域的主要实现与结构调整应以 `src/view/Toolbar.svelte` 为核心。
- 顶部状态与交互流由 `src/view/FolderCardView.ts` 通过 `panel-model.ts` 驱动，经 `FolderCardPanel.svelte` 传入 `Toolbar.svelte`。
- 搜索框收起时保留现有关键词并继续生效。
- 点击放大镜展开搜索框后自动聚焦输入框。
- Bulk 计数文案采用 `3 selected` 样式。

## Research Findings
- `src/view/Toolbar.svelte` 负责 folder button/name、summary、search、status、subfolder toggle、一级按钮与 bulk strip 的主要渲染。
- `src/view/FolderCardView.ts` 负责 `onSearchQueryChange`、`onIncludeSubfoldersChange`、toolbar action、folder selection 与 bulk/search 状态转换。
- `src/view/panel-model.ts` 与 `src/view/types.ts` 提供 toolbar 所需状态契约与类型。
- `styles.css` 持有 toolbar、toggle、chip、bulk 区与 icon button 的样式模式。
- 现有测试覆盖充分：`src/view/Toolbar.svelte.test.ts` 为主回归套件，`src/view/FolderCardView.test.ts` 覆盖 view 层 wiring，`src/view/bulk-selection.test.ts` / `src/view/pipeline.test.ts` / 搜索相关测试可支撑行为验证。

## Open Questions
- 暂无阻塞性问题。

## Scope Boundaries
- INCLUDE: 顶部信息呈现、搜索展开方式、bulk 区压缩、subfolder toggle 表达。
- EXCLUDE: 一级按钮分级重构、超出顶部区域的功能行为重写。
