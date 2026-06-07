# Decision: 支持混合文件类型卡片，同时保持全文索引只覆盖 Markdown

## Background

项目最初的卡片流基本等同于 Markdown 笔记列表：文件收集、预览构建、搜索语义和空状态文案都默认“卡片 = Markdown”。

随着工作台逐渐承担更多浏览职责，这个默认前提开始限制体验：

- 用户在文件夹里看到的不只有 `.md`，还包括 `.base`、`.canvas`、`.excalidraw` 这类 Obsidian 工作文件。
- 如果这些文件完全不进入卡片流，右侧工作台对真实文件夹上下文的表达会不完整。
- 但如果为了“一致”把这些类型也强行纳入全文预览和全文索引，又会把不稳定的正文抽取逻辑提前散入运行时边界。

与此同时，批量删除的确认语义也暴露出另一个问题：插件之前把 `Delete` 文案写成了固定的“永久删除”，但真正的宿主行为应该由 Obsidian `Files & Links` 偏好决定。

## Trigger signal

当前分支引入了 `file-kind` 解析层，并把卡片收集范围从“只看 Markdown”扩展为“支持多种正式卡片文件类型”。这使我们必须明确回答两个问题：

1. 哪些文件可以进入卡片流？
2. 进入卡片流是否等于进入全文索引与正文预览？

## Decision

我们采用以下正式合约：

1. **卡片流支持混合文件类型。** 当前正式支持的卡片文件类型是 `markdown`、`base`、`canvas`、`excalidraw`。
2. **`file-kind` 成为显式领域边界。** 文件类型解析、图标映射、占位摘要文案统一收敛到 `src/view/file-kind.ts`，不再由各模块各自猜扩展名。
3. **全文索引继续只覆盖 Markdown。** `IndexedSearchService`、`SearchIndexManager` 和相关 mutation 语义仍只把 Markdown 视为全文索引文档。
4. **非 Markdown 卡片只提供轻量表面。** 它们进入卡片流时提供标题、文件类型图标和占位摘要，不伪装成拥有稳定正文预览。
5. **搜索采用非对称语义。** Markdown 保持全文级匹配；`base`、`canvas`、`excalidraw` 当前只参与标题级匹配。
6. **批量删除遵循宿主偏好。** bulk delete 通过 `app.fileManager.trashFile(...)` 执行，最终是移动到回收站还是永久删除，由 Obsidian `Files & Links` 偏好决定。

## Why this option

- **让工作台更接近真实文件夹上下文。** 用户在文件管理器里看到的关键工作文件，现在可以稳定进入卡片流，而不是被 Markdown-only 假设硬过滤掉。
- **避免过早引入脆弱解析。** `base`、`canvas`、`excalidraw` 的正文抽取和高质量全文索引都还没有稳定 contract；此时强行统一只会把复杂性扩散到 view、service 和测试层。
- **保留现有搜索架构的清晰边界。** 搜索服务继续只对 Markdown 全文索引负责，非 Markdown 文件作为 title-only 记录进入索引；pipeline 最终消费权威的 indexed 结果，边界清楚且容易验证。
- **让删除行为回到宿主真相。** 删除语义应该由 Obsidian 自己决定，插件不应在确认文案里擅自承诺“永久删除”。

## Impact

- `src/view/file-kind.ts` 成为新的类型语义中心，统一解析卡片文件类型、图标和占位摘要。
- `src/view/FolderCardView.ts` 不再只收集 Markdown 文件，而是收集全部受支持类型，并按 `fileKind` 决定预览与 hydration 行为。
- `src/view/CardItem.svelte` 和 `styles.css` 现在会显示文件类型图标，并为非 Markdown 卡片渲染占位摘要。
- `src/view/pipeline.ts` 明确锁定“Markdown 全文匹配 + 非 Markdown 标题匹配”的搜索合约。
- `src/main.ts` 与搜索 mutation 转发逻辑现在按 `fileKind` 判断索引相关 rename / create / delete 的语义，而不是只看扩展名分支里的单点判断。
- `src/view/note-ops.ts` 与 bulk delete 流程改为遵循 Obsidian 删除偏好。

## Cost and risk

- **搜索表面不完全对称。** 用户会看到非 Markdown 文件能出现在卡片流里，但它们目前不能像 Markdown 一样参与全文命中；这需要文档和测试明确锁定。
- **后续扩展压力会增大。** 一旦未来要让 `base`、`canvas`、`excalidraw` 参与更深层搜索，必须先定义内容抽取 contract，而不是直接在现有路径里堆分支。
- **删除文案必须持续保持诚实。** 只要最终行为仍依赖宿主偏好，UI 和测试就不能再次退回“永久删除”的固定文案。

## Alternatives considered

- **方案 A：继续保持 Markdown-only 卡片流。** 未采用，因为它会让工作台持续丢失真实文件夹上下文中的重要文件类型。
- **方案 B：让所有支持类型都参与全文索引。** 未采用，因为当前没有稳定、低成本、可维护的跨格式正文抽取 contract。
- **方案 C：对非 Markdown 完全不支持搜索。** 未采用，因为标题级匹配成本低、收益高，而且能保持搜索结果对用户更可理解。
- **方案 D：bulk delete 继续写成永久删除。** 未采用，因为这与 Obsidian 的宿主行为真相不一致。

## Follow-up actions

- 如果未来要扩展非 Markdown 文件的搜索能力，先定义每种文件类型的内容抽取 contract，再评估 `SearchIndexManager` / `IndexedSearchService` 的演进路径。
- 在真实 Obsidian 宿主内补一次 mixed file-kind 卡片流与 bulk delete 文案的手动 QA。
- 保持相关测试继续锁定 `orderedPaths` contract、非 Markdown 标题匹配和宿主删除偏好语义。

## Supersedes / related records

- Related: `docs/decisions/2026-04-18-phase3-search-architecture-readiness.md`
- Related: `docs/decisions/2026-04-18-close-phase3-indexed-search-capability.md`
- Related: `docs/decisions/2026-04-23-toolbar-ui-optimization.md`

## Related files

- `src/main.ts`
- `src/view/file-kind.ts`
- `src/view/FolderCardView.ts`
- `src/view/CardItem.svelte`
- `src/view/pipeline.ts`
- `src/view/note-ops.ts`
- `AGENTS.md`
- `docs/architecture.md`
