# Architecture

## 架构目标与设计原则

这个插件不是独立 Web 应用，而是 Obsidian 里的右侧卡片工作台。当前架构由六个原则驱动：

1. **性能优先。** 避免整 vault 重扫、避免无边界重建、避免破坏虚拟滚动和 generation guard。
2. **本地优先。** 文件处理、索引存储、搜索执行、设置持久化都发生在本地运行时。
3. **宿主拥有生命周期。** 插件级资源、命令、通知、搜索服务和重建调度都归 `main.ts`。
4. **视图拥有运行时查询。** 当前 view 的 query、debounce、候选卡片和搜索状态归 `FolderCardView.ts`。
5. **`pipeline.ts` 统一可见结果。** 不管搜索来自 fallback 还是 indexed，最终投影都必须走同一条纯函数链路。
6. **索引能力沿现有边界扩展。** 搜索能力已经落地，但后续演进仍应在 `IndexStore`、`SearchIndexManager`、`IndexedSearchService` 这一层推进，而不是把索引逻辑散回 UI 或 settings。

## 系统总览

```text
Obsidian 事件源
  ├─ 文件管理器点击
  ├─ file-open
  └─ vault create/modify/delete/rename
          ↓
src/main.ts
  ├─ 视图注册 / 激活
  ├─ 设置加载与保存
  ├─ 搜索服务与命令生命周期
  ├─ vault mutation 转发
  └─ rebuild 调度与降级通知
          ↓
src/view/FolderCardView.ts
  ├─ 收集文件 / 排序 / 构建 baseCards
  ├─ generation / hydration / 刷新编排
  ├─ runtime-only searchQuery / debounce / searchStatus
  ├─ SearchService query 协调
  ├─ 运行 pipeline -> visibleCards
  └─ 更新 panel-model
          ↓
src/view/panel-model.ts
  └─ 面板订阅状态边界
          ↓
src/view/FolderCardPanel.svelte / Toolbar.svelte / CardItem.svelte
  └─ UI 展示、交互回调、命中高亮、紧凑状态标签
          ↓
src/view/pipeline.ts
  └─ tag filter -> search filter -> pin reorder

src/search/IndexStore.ts
  └─ IndexedDB 持久化索引与元数据

src/search/SearchIndexManager.ts
  └─ restore / full build / mutation apply / health snapshots

src/search/IndexedSearchService.ts
  └─ candidate-bounded 查询与 indexed ordering 输出
```

## 运行时拓扑与外部依赖

当前运行时依赖来自五层：

- `obsidian` API，负责插件生命周期、视图容器、Vault、MetadataCache、命令注册和通知。
- Svelte 5 兼容模式运行时，负责面板渲染和交互回调。
- `IndexedDB`，由 `IndexStore` 使用，负责本地持久化索引快照。
- `MiniSearch`，负责内存中的文本索引和查询执行。
- esbuild + esbuild-svelte，负责构建 `main.js`。

当前没有网络依赖，没有外部服务。搜索能力已经是本地 indexed 架构，不再只是 no-index 接缝，但它仍保留 fallback 路径以应对构建中、恢复失败或初始化失败。

## 技术选择及原因

### TypeScript + strict

这里的价值是把 ownership 和契约钉死。`searchQuery` 不进 settings，`SearchServiceSnapshot` 明确暴露健康状态，`SearchQueryResult` 明确区分 `null` 和空数组，这些都是防止后续演进时把语义做混。

### Svelte 5 兼容模式，宿主继续做协调

组件负责展示、输入和局部 UI 效果，但不拥有插件级资源，也不拥有搜索真值。这样可以把 Obsidian 生命周期和 UI 表面分开，减少组件内隐藏副作用。

### IndexedDB + MiniSearch

Phase 3 最重要的变化，是搜索不再只是 readiness seam，而是形成了可恢复、可重建、可增量更新的本地索引链路。

- `IndexStore` 负责持久化，不负责 query。
- `SearchIndexManager` 负责 restore、build 和 mutation，不负责 view 状态。
- `IndexedSearchService` 负责把 manager 能力转换成 view 可消费的 contract。

这种分层让索引、查询、宿主 wiring 三种职责分开，不容易因为后续需求把一层写成全能对象。

### `pipeline.ts` 继续做唯一可见卡片投影链路

即使 indexed 查询已经返回排序结果，服务层也只返回 `orderedPaths`。最终可见卡片仍由 pipeline 从当前候选卡片集合里投影出来。这避免了服务直接控制 UI，也避免 pin、tag filter 和搜索结果各走各的顺序逻辑。

## 模块关系与职责边界

### `src/main.ts`

负责插件级职责：

- 设置读写与会话恢复。
- 注册和激活 `FOLDER_CARD_VIEW`。
- 初始化 `IndexStore`、`SearchIndexManager`、`IndexedSearchService`，并在失败时回退到 `NoIndexSearchService`。
- 注册 command palette 的 rebuild 或 recover 命令。
- 注册 vault observers，并把 mutation 转发给视图和搜索服务。
- 订阅搜索健康快照，在必要时调度一次 plugin-owned rebuild，并避免重复 fanout。

它不拥有 per-view query，也不直接决定 `visibleCards`。

### `src/view/FolderCardView.ts`

这是每个视图实例的运行时协调中枢，当前负责：

- `baseCards`、`visibleCards`、selectedPath、bulk state。
- generation、防陈旧、hydration、刷新队列。
- 当前视图的 `searchQuery`、`searchStatus`、候选路径约束和 debounce。
- 向 `SearchService` 发 query，并把结果转成 pipeline 输入。
- 组装 `PipelineContext`，再调用 `runPipeline()`。
- 把 cards、filter、pin、bulk、search 状态写入 `panel-model`。

关键边界是：**query 仍只由 `FolderCardView.ts` 持有。** indexed 搜索的存在没有改变这一点。

### `src/view/panel-model.ts`

这是宿主到面板的正式状态桥。它承载 cards、selection、filter、pin、bulk state，也承载 `searchQuery` 和 `searchStatus`。它不保存长期状态，只负责稳定投影。

### `src/view/FolderCardPanel.svelte` / `src/view/Toolbar.svelte` / `src/view/CardItem.svelte`

这些组件负责：

- 显示 query、compact status label 和命中结果。
- 把搜索输入变化回传给 `FolderCardView.ts`。
- 在标题和摘录表面做安全高亮。
- 继续处理 viewport、虚拟滚动和工具栏交互。

它们不是搜索状态源，也不参与索引构建。

### `src/view/pipeline.ts`

这里继续承担唯一投影职责：

- `applyTagFilter()` 处理 metadata 级筛选。
- `applySearchFilter()` 在 `orderedPaths !== null` 时采用 indexed ordering，在 `orderedPaths === null` 时回退到本地 fallback filtering。
- `applyPinReorder()` 只对保留下来的卡片做重排。

这里必须保持 `tag -> search -> pin` 的固定顺序。

### `src/search/IndexStore.ts`

这是持久化边界。它把每个 vault 的索引记录存入 IndexedDB，并对恢复、写入、清理返回 typed、no-throw 的结果。它不做查询，也不决定健康状态。

### `src/search/SearchIndexManager.ts`

这是索引编排器。它负责：

- 从 `IndexStore.restore(...)` 恢复历史索引。
- 触发 full build 并持久化 `toJSON()` 结果。
- 应用 create、modify、delete、rename 等增量 mutation。
- 把 folder rename 分类为 `file`、`folder-safe-prefix-rewrite`、`folder-rebuild-required`。
- 发布 `building`、`ready`、`rebuild-required`、错误等健康快照。

它不拥有 view query，也不直接产出 UI。

### `src/search/IndexedSearchService.ts`

这是服务查询边界。它镜像 manager 快照，负责：

- 把 manager 的健康状态翻译成查询 contract。
- 在当前候选路径范围内裁剪结果，避免跨 view 泄漏无关路径。
- 在可用时返回 indexed ordering。
- 在构建中、恢复失败或不可用时返回 `orderedPaths: null`，让调用方继续 fallback。

## 关键流程设计

### 1. 文件夹选择与基础卡片生成

主流程没有改变：

1. `main.ts` 生成选择请求并激活右侧视图。
2. `FolderCardView.ts` 采集文件、排序、生成 `baseCards`。
3. 结果进入 `pipeline.ts`，得到 `visibleCards`。

### 2. 搜索 query 进入运行时

当前搜索主流程是：

1. 面板接收用户输入。
2. `FolderCardView.ts` 更新 runtime-only `searchQuery`，按当前视图范围做 debounce。
3. 视图向 plugin-owned `SearchService` 发起 query，请求里带上 query、scope 和当前 candidate paths。
4. `IndexedSearchService` 若处于 ready，则返回 candidate-bounded `orderedPaths`。
5. 若服务返回 `orderedPaths: null`，视图继续走 fallback filtering。
6. `pipeline.ts` 按 `tag -> search -> pin` 顺序投影 `visibleCards`。
7. `panel-model` 把最新 cards、query、status 投影给面板。

### 3. 索引恢复、构建与增量更新

索引层主流程是：

1. 插件启动时，`main.ts` 初始化 store、manager 和 service。
2. manager 先尝试 restore 已持久化索引。
3. 若 restore 成功，发布 `ready` 快照并允许 indexed 查询。
4. 若 restore 失败、版本漂移或数据损坏，切到 full build 或 `rebuild-required` 路径。
5. vault mutation 到来时，manager 尝试做增量应用。
6. 对无法安全前缀改写的 folder rename，manager 直接发布 `rebuild-required`，避免继续服务脏路径。
7. `main.ts` 在 unsafe 快照上调度 plugin-owned rebuild，并保持单路径快照分发。

### 4. 可见卡片投影

当前正式链路是：

```text
baseCards
  -> applyTagFilter
  -> applySearchFilter
  -> applyPinReorder
  -> visibleCards
```

必须保持的语义：

- tag filter 先于 search filter。
- search filter 先于 pin reorder。
- pin 只改顺序，不恢复被前序步骤过滤掉的卡片。
- `orderedPaths: null` 表示 fallback filtering。
- `orderedPaths: []` 表示 indexed-ready 零结果。

## 数据流与状态映射

### 插件级持久化状态

来源是 `PluginSettings`：

- `sort`
- `filter.tags`
- `pinnedPaths`
- `includeSubfolders`
- `defaultView`
- `previewLines`
- `lastFolderPath`
- `lastViewMode`

这里 **没有 `searchQuery`**。这是当前明确的架构决定。

### 插件级搜索持久化状态

来源是 `IndexStore` 持久化记录：

- per-vault metadata
- `documentCount`
- `lastIndexedAt`
- `serializedIndexJson`

这层只负责索引恢复，不承担视图查询状态。

### 视图级运行时状态

来源是 `FolderCardView.ts`：

- `folderPath`
- `baseCards`
- `visibleCards`
- `selectedPath`
- `generation`
- bulk state
- `searchQuery`
- `searchStatus`
- 当前查询对应的 `orderedPaths`

搜索状态属于这一层，因为它和当前 view 的 scope、候选卡片、debounce 以及 generation 强相关。

### 面板订阅状态

来源是 `panel-model`：

- cards、selection、loading、generation
- sort、tag filter、pinnedPaths、previewLines
- bulk mode 及其派生能力
- `searchQuery`、`searchStatus`

面板读这些状态，但不拥有它们。

## 关键约束与假设

1. 不要把 `searchQuery` 写回 `PluginSettings`。
2. 不要让 `SearchService` 绕开 `pipeline.ts` 直接控制最终可见卡片。
3. 不要把 `orderedPaths: null` 和空数组的语义做混。
4. 不要让 folder rename 的 unsafe 路径继续静默服务旧索引，应明确升级到 `rebuild-required`。
5. 不要破坏 row projection、虚拟滚动、滚动锚定、hydrate-range、generation guards、debounced vault observers。
6. `Toolbar.svelte` 仍有已知非阻塞 a11y warnings，这属于后续 UI 收尾，不代表 Phase 3 未完成。
7. 当前没有真实 Obsidian 宿主内手动 QA 结果，F3 的关闭建立在用户批准豁免基础上，不应被文档误写成已完成 in-app 验证。

## 历史问题与折中

`2026-03-24` 的决策先把搜索预留在 pipeline 接缝里，当时真正重要的是统一投影链路。

`2026-04-18` 的 readiness 决策把 ownership、query contract 和 panel bridge 锁定下来，避免后续 indexed 搜索接入时状态失控。

Phase 3 的最终收尾又把这套接缝推进成真正可运行的 indexed 搜索架构。这里的折中很明确：

- 我们接受 indexed 搜索依赖本地 IndexedDB 和 MiniSearch。
- 我们保留 fallback 路径，不把单一搜索模式当成唯一真相。
- 我们对 unsafe folder rename 采用保守 rebuild-required 策略，而不是尝试高风险路径修补。
- 我们在缺少 Obsidian 宿主的环境里，以仓库验证通过和用户豁免作为 F3 关闭条件。

## 优化与演进机会

1. 在不改变 ownership 的前提下，继续补强 ranking、tokenizer 或 rebuild UX。
2. 为真实 Obsidian 宿主补 manual QA 流程，把当前豁免状态转换成已执行证据。
3. 单独处理 `Toolbar.svelte` 的 a11y warnings，减少 build/test 输出噪音。
4. 如后续继续扩展索引能力，优先补 manager 和 service 层，不要把索引细节散入 view 层。

## Related decisions

- `docs/decisions/2026-03-24-panel-owned-card-projection-and-interactions.md`
- `docs/decisions/2026-04-03-migrate-to-svelte-5-with-legacy-component-api.md`
- `docs/decisions/2026-04-04-row-projected-responsive-card-wall.md`
- `docs/decisions/2026-04-18-finish-svelte-5-host-and-component-seam.md`
- `docs/decisions/2026-04-18-phase3-search-architecture-readiness.md`
- `docs/decisions/2026-04-18-close-phase3-indexed-search-capability.md`
