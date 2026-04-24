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
- 已完成：批量删除不再承诺永久删除，而是改为遵循 Obsidian `Files & Links` 的删除偏好。
- 已完成：标准仓库验证仍是 `npm run check`、`npm run build`、`npm test`。
- 已关闭：F3 的真实 Obsidian 手动 QA 因环境缺少可运行宿主而未执行，用户已明确豁免，因此当前阶段的完成条件仍以仓库验证和文档收尾为准。

## 回来看代码前先记住这 3 件事

1. **搜索查询仍是 runtime-only，而且是 per-view。** `searchQuery` 不写入 `PluginSettings`，真值仍在 `FolderCardView.ts`。
2. **`pipeline.ts` 仍是唯一投影路径。** 搜索服务可以给出 indexed ordering，但最终哪些卡片可见、顺序如何变化，仍由 pipeline 决定。
3. **混合文件类型支持不等于全文索引扩容。** `markdown` 继续参与全文预览和全文索引，`base` / `canvas` / `excalidraw` 进入卡片流时只提供标题、图标和占位摘要；`orderedPaths: null` 仍表示 fallback filtering，`orderedPaths: []` 仍表示 indexed 搜索已执行且结果为零。
4. **轻量 preview 不是完整 Markdown renderer。** 当前只保留 heading、inline code、fenced code 等弱提示；粗体和斜体语法会被归一化成普通文本，不再输出 `<strong>` / `<em>`。

## 系统大致怎么拼起来的

- `src/main.ts`
  - 插件入口与全局运行时外壳。
  - 负责视图注册、设置读写、vault 事件转发、indexed 搜索服务初始化、恢复与 rebuild 命令。
- `src/view/FolderCardView.ts`
  - 每个视图实例的运行时协调器。
  - 负责收集受支持卡片文件、维护 `baseCards` / `visibleCards` / `fileKind`、selection、generation、防陈旧刷新、hydration，以及当前 view 的搜索 query 和状态。
- `src/view/file-kind.ts`
  - 卡片文件类型语义边界。
  - 负责解析 `markdown` / `base` / `canvas` / `excalidraw`，并提供图标和占位摘要合约。
  - 文件类型图标继续使用 Obsidian 官方 Lucide icon name；当前 `base -> layout-list`，`excalidraw -> pen-tool`。
- `src/view/pipeline.ts`
  - 唯一的可见卡片投影层。
  - 负责把 tag filter、search filter、pin reorder 组合成稳定输出，同时保持“Markdown 全文匹配 + 非 Markdown 标题匹配”的搜索边界。
- `src/search/IndexStore.ts`
  - IndexedDB 持久化边界。
  - 保存每个 vault 的索引元数据和序列化索引体。
- `src/search/SearchIndexManager.ts`
  - 索引编排器。
  - 负责 restore、full build、增量 mutation 应用、健康快照和 `rebuild-required` 判定。
- `src/search/IndexedSearchService.ts`
  - 服务层查询边界。
  - 负责消费 manager 快照、裁剪 candidate paths、返回 indexed ordering，或在不可用时回退。
- `src/view/FolderCardPanel.svelte` / `src/view/Toolbar.svelte` / `src/view/CardItem.svelte`
  - 展示与交互表面。
  - 负责可收起的搜索输入、上下文摘要、一级 toolbar 按钮高亮态、icon-only bulk strip、批量模式复选框，以及标题和摘录命中高亮。

## 一条主流程怎么走

以“用户在当前视图输入搜索词”为例：

1. `Toolbar.svelte` 把 query 变化回传给 `FolderCardView.ts`。
2. `FolderCardView.ts` 更新 runtime-only `searchQuery`，按当前视图范围做 debounce，并向搜索服务发起查询。
3. `IndexedSearchService` 根据当前健康状态决定返回 indexed ordering，或返回 `orderedPaths: null` 让调用方继续 fallback。
4. `pipeline.ts` 先执行 tag filter，再执行 search filter，最后执行 pin reorder；其中 Markdown 可走全文匹配，非 Markdown 只在标题命中时被补入结果。
5. `FolderCardPanel.svelte` 和 `CardItem.svelte` 接收最新 cards、compact status、高亮结果、文件类型图标/占位摘要和 bulk selection 状态，UI 更新。

以“用户批量删除选中文件”为例：

1. `Toolbar.svelte` 发出 `bulk-delete-selected` 动作。
2. `FolderCardView.ts` 收集当前仍然存活的选中文件，并弹出确认文案，明确说明删除将遵循 Obsidian 的 `Files & Links` 偏好。
3. `note-ops.ts` 通过 `app.fileManager.trashFile(...)` 执行删除，让宿主决定是进系统回收站还是永久删除。
4. 视图根据成功/失败结果刷新卡片和提示，不再自己承诺“永久删除”的固定行为。

以“vault 发生 unsafe folder rename”为例：

1. `main.ts` 把 mutation 同时转发给视图和搜索服务。
2. `SearchIndexManager` 若无法安全做路径前缀改写，则发布 `rebuild-required` 快照。
3. `main.ts` 只调度一次 plugin-owned rebuild，不重复扇出快照。
4. 视图仍通过单一路径接收搜索快照，避免重复通知和状态漂移。

## 怎么运行与做基本验证

安装依赖：

```bash
npm install
```

标准验证：

```bash
npm run check
npm run build
npm test
```

开发观察构建：

```bash
npm run dev
```

当前阶段要明确区分两类验证：

- **仓库验证** 已完成，标准命令通过。
- **真实 Obsidian 手动 QA** 未执行，不是因为实现未完成，而是因为当前环境没有可运行的 Obsidian 宿主，且用户已明确豁免 F3 的这项要求。

## 哪些配置值最重要

- `sort.field` / `sort.direction`：控制卡片排序。
- `filter.tags`：标签筛选条件，语义是 **AND**。
- `pinnedPaths`：置顶笔记路径列表，只影响顺序。
- `includeSubfolders`：folder scope 下的数据采集开关，会决定是否递归收集受支持文件类型。
- `Files & Links` 删除偏好（Obsidian 宿主配置）：不在插件设置内，但会直接影响 bulk delete 的最终行为。
- `lastFolderPath` / `lastViewMode`：会话恢复使用。

需要特别注意：**没有 `searchQuery` 配置项。** 搜索 query 仍是当前视图的运行时状态，不属于插件设置。

## 当前风险 / 阻塞 / 下一步

- **F3 已关闭，但真实宿主手动验证仍是已知空白。** 这是用户批准的收尾条件，不是架构未知项。
- **indexed 搜索已经存在，但边界不能被随意打破。** 后续改动必须继续尊重 `main.ts`、`FolderCardView.ts`、`pipeline.ts`、`SearchIndexManager` 之间的 ownership。
- **混合文件类型卡片有明确边界。** 当前正式支持的是 `markdown`、`base`、`canvas`、`excalidraw`；不要把“支持进卡片流”误写成“都支持全文索引和预览”。
- **文件类型图标 contract 也有明确边界。** 标题图标应优先使用 Obsidian 官方 Lucide icon name，而不是把截图、栅格图片或自定义图像资产塞进 `file-kind.ts`。
- **`orderedPaths` contract 不能漂移。** `null` 与空数组代表不同语义，测试和文档都已锁定。
- **bulk delete 现在依赖宿主删除偏好。** 如果后续要改文案或行为，必须继续以 Obsidian `fileManager.trashFile` 作为真相来源，而不是插件自己定义删除语义。
- **unsafe folder rename 会触发 rebuild-required。** 这是刻意选择的保守策略，用来避免脏路径继续对外服务。
- **`Toolbar.svelte` 仍有已知非阻塞 a11y warnings。** 当前主要在 folder menu item 与展开 chevron 的非语义点击元素上；这不是本次 UI 优化的阻塞项，但仍是后续整理点。

## 接下来先读哪里

1. `docs/START_HERE.md`
2. `docs/architecture.md`
3. `docs/decisions/2026-04-24-support-mixed-file-kind-cards-with-markdown-only-indexing.md`
4. `docs/decisions/2026-04-24-keep-file-kind-icons-on-official-obsidian-lucide-icons.md`
5. `docs/decisions/2026-04-23-toolbar-ui-optimization.md`
5. `docs/decisions/2026-04-18-close-phase3-indexed-search-capability.md`
6. `docs/decisions/2026-04-18-phase3-search-architecture-readiness.md`
7. `src/view/file-kind.ts`
8. `src/main.ts`
9. `src/view/FolderCardView.ts`
10. `src/view/CardItem.svelte`
11. `src/view/pipeline.ts`
12. `src/search/SearchIndexManager.ts`
13. `src/search/IndexedSearchService.ts`
