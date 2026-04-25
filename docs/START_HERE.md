# START HERE

## 这个项目现在在解决什么问题？

`Card Workspace` 是一个 Obsidian 插件。它把文件管理器里的文件夹选择转换成右侧侧边栏里的卡片流，让用户在当前笔记上下文中浏览、筛选、置顶、搜索并打开一组文件卡片。当前支持的正式卡片文件类型是 `markdown`、`base`、`canvas` 和 `excalidraw`；其中只有 Markdown 继续参与全文预览与全文索引，其余类型以文件标题、图标和占位摘要进入工作台。

当前项目的核心目标不是再搭搜索接缝，而是维护一套已经闭环的卡片工作台。`Phase 3 search capability` 已经完成，插件现在同时具备 fallback 搜索路径和 indexed 搜索路径，后续工作应围绕维护、演进和手动验证条件补齐，而不是重新设计搜索 ownership。

## 当前处于什么阶段？

项目处于 **Phase 3 搜索能力已完成后的长期维护态，当前焦点转向混合文件类型卡片支持与交互语义收敛** 的阶段。

- 已完成：`main.ts` 持有 plugin-global 搜索生命周期，负责 indexed 服务初始化、快照订阅、命令注册和降级回退。
- 已完成：`FolderCardView.ts` 不再只收集 Markdown 文件，而是统一收集 `markdown`、`base`、`canvas`、`excalidraw` 四类受支持卡片文件，并在视图运行时维护 `fileKind`。
- 已完成：`CardItem.svelte` / `FolderCardPanel.svelte` 现在会为非 Markdown 卡片显示文件类型图标与占位摘要，让这些文件能以稳定 UI 合约进入卡片流。
- 已完成：Markdown 卡片的轻量 preview 继续保留 heading / inline code / code block 等弱提示，但 `**bold**` / `*italic*` 这类强调语法现在会被拍平成普通文本，不再依赖浏览器默认的 `<strong>` / `<em>` 视觉效果。
- 已完成：非 Markdown 卡片标题图标继续走 Obsidian 官方 `setIcon(...)` 路径；`base` 当前映射为 `layout-list`，`excalidraw` 当前映射为 `pen-tool`，不再引入截图或自定义图片资产。
- 已完成：`pipeline.ts` 和搜索服务正式锁定了“Markdown 继续做全文搜索；非 Markdown 只参与标题级匹配”的非对称搜索语义。
- 已完成：卡片默认点击现在直接对齐主编辑区 recent-root fallback 语义：优先复用当前窗口 `rootSplit` 中最近使用且可承载文件的未 pin leaf；如果最近 root leaf 不可承载文件，则回退到活动 root Markdown leaf，再回退到现有 root Markdown leaf；只有目标 leaf 已 pin 或根本没有合适 root leaf 时，才打开 new tab。
- 已完成：卡片右上角更多菜单现在只保留三个显式打开动作：`Open in new tab`、`Open to the right`、`Open in new window`；其中 `Open in new window` 图标改为 `picture-in-picture-2`，`Open in main editor` 已从菜单移除。
- 已完成：批量删除不再承诺永久删除，而是改为遵循 Obsidian `Files & Links` 的删除偏好。
- 已完成：标准仓库验证仍是 `npm run check`、`npm run build`、`npm test`。
- 已关闭：F3 的真实 Obsidian 手动 QA 因环境缺少可运行宿主而未执行，用户已明确豁免，因此当前阶段的完成条件仍以仓库验证和文档收尾为准。

## 回来看代码前先记住这 3 件事

1. **搜索查询仍是 runtime-only，而且是 per-view。** `searchQuery` 不写入 `PluginSettings`，真值仍在 `FolderCardView.ts`。
2. **`pipeline.ts` 仍是唯一投影路径。** 搜索服务可以给出 indexed ordering，但最终哪些卡片可见、顺序如何变化，仍由 pipeline 决定。
3. **混合文件类型支持不等于全文索引扩容。** `markdown` 继续参与全文预览和全文索引，`base` / `canvas` / `excalidraw` 进入卡片流时只提供标题、图标和占位摘要；`orderedPaths: null` 仍表示 fallback filtering，`orderedPaths: []` 仍表示 indexed 搜索已执行且结果为零。
4. **默认卡片点击已经固定为 main-editor-area fallback 行为。** 普通点击会先尝试复用当前窗口 `rootSplit` 内最近使用且可承载文件的未 pin leaf；如果最近 root leaf 不可承载文件，则回退到活动 root Markdown leaf，再回退到现有 root Markdown leaf；只有选中的目标 leaf 已 pin 或完全没有合适 root leaf 时，才打开一个 new tab。不要再把默认打开理解成可配置项。
5. **轻量 preview 不是完整 Markdown renderer。** 当前只保留 heading、inline code、fenced code 等弱提示；粗体和斜体语法会被归一化成普通文本，不再输出 `<strong>` / `<em>`。

## 哪些配置值最重要

- `sort.field` / `sort.direction`：控制卡片排序。
- `filter.tags`：标签筛选条件，语义是 **AND**。
- `pinnedPaths`：置顶笔记路径列表，只影响顺序。
- `includeSubfolders`：folder scope 下的数据采集开关，会决定是否递归收集受支持文件类型。
- `Files & Links` 删除偏好（Obsidian 宿主配置）：不在插件设置内，但会直接影响 bulk delete 的最终行为。
- `lastFolderPath` / `lastViewMode`：会话恢复使用。

需要特别注意：**没有 `searchQuery` 配置项，也没有默认卡片打开方式配置项。** 搜索 query 和默认点击打开语义都不属于插件设置。

## 当前风险 / 阻塞 / 下一步

- **F3 已关闭，但真实宿主手动验证仍是已知空白。** 这是用户批准的收尾条件，不是架构未知项。
- **indexed 搜索已经存在，但边界不能被随意打破。** 后续改动必须继续尊重 `main.ts`、`FolderCardView.ts`、`pipeline.ts`、`SearchIndexManager` 之间的 ownership。
- **混合文件类型卡片有明确边界。** 当前正式支持的是 `markdown`、`base`、`canvas`、`excalidraw`；不要把“支持进卡片流”误写成“都支持全文索引和预览”。
- **文件类型图标 contract 也有明确边界。** 标题图标应优先使用 Obsidian 官方 Lucide icon name，而不是把截图、栅格图片或自定义图像资产塞进 `file-kind.ts`。
- **`orderedPaths` contract 不能漂移。** `null` 与空数组代表不同语义，测试和文档都已锁定。
- **bulk delete 现在依赖宿主删除偏好。** 如果后续要改文案或行为，必须继续以 Obsidian `fileManager.trashFile` 作为真相来源，而不是插件自己定义删除语义。
- **默认卡片点击行为现在是固定 runtime contract。** 后续如果再改默认打开逻辑，必须同时检查 `main.ts`、`FolderCardView.ts`、`CardItem.svelte` 和对应测试，而不是只改菜单文案。
- **显式打开动作与默认点击语义已经分层。** 默认点击先看 `getMostRecentLeaf(rootSplit)`，再回退到 root Markdown leaf；更多菜单只表达显式动作。不要再把这两层重新混成一个 setting。
- **unsafe folder rename 会触发 rebuild-required。** 这是刻意选择的保守策略，用来避免脏路径继续对外服务。
- **`Toolbar.svelte` 仍有已知非阻塞 a11y warnings。** 当前主要在 folder menu item 与展开 chevron 的非语义点击元素上；这不是本次 UI 优化的阻塞项，但仍是后续整理点。

## 接下来先读哪里

1. `docs/START_HERE.md`
2. `docs/architecture.md`
3. `docs/decisions/2026-04-25-constrain-card-note-opens-to-main-editor-surfaces.md`
4. `docs/decisions/2026-04-24-support-mixed-file-kind-cards-with-markdown-only-indexing.md`
5. `docs/decisions/2026-04-24-keep-file-kind-icons-on-official-obsidian-lucide-icons.md`
6. `docs/decisions/2026-04-23-toolbar-ui-optimization.md`
7. `docs/decisions/2026-04-18-close-phase3-indexed-search-capability.md`
8. `docs/decisions/2026-04-18-phase3-search-architecture-readiness.md`
9. `src/view/file-kind.ts`
10. `src/main.ts`
11. `src/view/FolderCardView.ts`
12. `src/view/CardItem.svelte`
13. `src/view/pipeline.ts`
14. `src/search/SearchIndexManager.ts`
15. `src/search/IndexedSearchService.ts`
