# Architecture

## 架构目标与设计原则

这个插件不是独立 Web 应用，而是 Obsidian 里的右侧卡片工作台。当前架构由六个原则驱动：

1. **性能优先**。不能退回整列表渲染、整 vault 重扫、或绕开 generation guard 的异步回写。
2. **本地优先**。文件处理、metadata 判断、搜索 fallback、设置持久化都留在本地运行时。
3. **宿主拥有真值**。Obsidian 生命周期、设置、vault 观察、运行时搜索状态都归宿主协调层，不归 Svelte 组件。
4. **`pipeline.ts` 统一投影**。哪些卡片可见，顺序如何变化，仍只通过一条纯函数链路决定。
5. **搜索先锁接缝，再补索引实现**。本次 phase3 做的是 readiness seam，不是直接落完整全文索引系统。
6. **扩展要沿现有边界前进**。后续 indexed search 也应接入 `SearchService` + `FolderCardView` + `pipeline.ts`，不要另起平行状态系统。

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
  ├─ SearchService 生命周期
  ├─ vault mutation 转发
  └─ 会话恢复
          ↓
src/view/FolderCardView.ts
  ├─ 收集文件 / 排序 / 构建 baseCards
  ├─ generation / hydration / 刷新编排
  ├─ runtime-only searchQuery / searchStatus
  ├─ SearchService query 协调
  ├─ 运行 pipeline → visibleCards
  └─ 更新 panel-model
          ↓
src/view/panel-model.ts
  └─ 面板订阅状态边界
          ↓
src/view/FolderCardPanel.svelte / Toolbar.svelte / CardItem.svelte
  └─ UI 展示、交互回调、viewport 相关逻辑
          ↓
src/view/pipeline.ts
  └─ tag filter -> search filter -> pin reorder
```

## 运行时拓扑与外部依赖

当前运行时依赖来自四层：

- `obsidian` API，负责插件生命周期、视图容器、Vault、MetadataCache、Menu 等宿主能力。
- Svelte 5 运行时，负责面板渲染和交互编排。
- `SearchService` seam，负责把“未来可能有索引的搜索能力”和“当前 fallback 搜索”隔开。
- esbuild + esbuild-svelte，负责构建 `main.js`。

当前没有网络依赖，没有外部服务，没有数据库持久化。需要特别明确的是：**IndexedDB 和 MiniSearch 不是当前运行时事实。**

现在的搜索拓扑是：

- `main.ts` plugin-owned 持有 `SearchService` 实例。
- 默认实例是 `NoIndexSearchService`。
- 该服务可以初始化、销毁、接收 vault mutation，但 query 返回 `orderedPaths: null` 时，视图必须继续使用本地 fallback filtering。
- 这个 seam 已经可用，但它还没有变成索引、worker、ranking 或 tokenizer 系统。

## 技术选择及原因

### TypeScript + strict

这里的价值不是类型本身，而是把状态归属钉死。搜索 query 不进 settings，pin 输入显式进入 `PipelineContext`，`panel-model` 明确携带 `searchQuery` / `searchStatus`，这些都靠类型边界防止后续漂移。

### 标准 Svelte 5，宿主继续做协调

Svelte 5 迁移已经结束，但这不代表状态重心转去组件层。`FolderCardView.ts` 继续持有异步刷新、视图选择、搜索状态和 Obsidian API 交互，因为这些都属于宿主语义。

### SearchService 采用 fallback-first、no-index seam

本次 phase3 没直接引入 IndexedDB 或 MiniSearch，原因很实际：

- 先把 ownership、生命周期、query contract、panel bridge 固定下来，比先接索引更重要。
- 当前已有 `matchesSearchQuery()` 与 pipeline fallback 语义，可以在无索引条件下先保证正确性。
- 如果在边界还没稳定前就加入 worker、ranking、tokenizer、重建命令，后续更容易出现状态重复和职责混乱。

### `pipeline.ts` 继续做唯一可见卡片投影链路

搜索 readiness 并没有改变这个原则。即使未来服务返回 indexed order，真正决定 `visibleCards` 的地方仍是 `runPipeline()`，而不是服务直接控制面板结果。

## 模块关系与职责边界

### `src/main.ts`

负责插件级职责：

- 设置读写与会话恢复。
- 注册和激活 `FOLDER_CARD_VIEW`。
- 注册 vault observers，并把 mutation 同时转给视图与 `SearchService`。
- 初始化与销毁 plugin-owned `SearchService`。

它不拥有 per-view query，也不直接决定 `visibleCards`。

### `src/view/FolderCardView.ts`

这是运行时协调中枢，当前负责：

- `baseCards`、`visibleCards`、selectedPath、bulk state。
- generation、防陈旧、hydration、刷新队列。
- 当前视图的 `searchQuery`、`searchOrderedPaths`、`searchStatus`。
- 向 `SearchService` 发 query，并把结果转成 runtime status。
- 组装 `PipelineContext`，再调用 `runPipeline()`。
- 把 cards、filter、pin、bulk、search 状态写入 `panel-model`。

这里有个关键边界：**query 现在只由 `FolderCardView.ts` 持有。** `Toolbar.svelte` 不拥有搜索真值，`main.ts` 也不持久化它。

### `src/view/panel-model.ts`

这是宿主到面板的正式状态桥。当前除了 cards、selection、filter、pin、bulk state，还承载：

- `searchQuery`
- `searchStatus`

它的角色不是保存长期状态，而是让宿主真值以稳定结构投影给面板。

### `src/view/FolderCardPanel.svelte` / `src/view/Toolbar.svelte`

这两层负责展示和事件回传：

- 显示当前 query 与 status。
- 把搜索输入变化回传给 `FolderCardView.ts`。
- 继续处理 viewport、虚拟滚动、工具栏交互和卡片交互。

它们不是搜索状态源，也不直接决定搜索结果顺序。

### `src/view/pipeline.ts`

当前职责更明确了：

- `applyTagFilter()` 处理 metadata 级筛选。
- `applySearchFilter()` 处理 query 级筛选，优先消费 `orderedPaths`，否则回退到本地 fallback filtering。
- `applyPinReorder()` 只对当前已保留卡片做重排。

`PipelineContext` 现在显式携带 runtime-only `search` 输入和 `pinnedPaths`。这让 pipeline 不需要再穿透 settings 去猜测投影输入。

### `src/search/types.ts` / `src/search/NoIndexSearchService.ts`

这里定义了未来 indexed search 的正式接缝：

- `SearchQueryRequest` 由 view 传入 query、scope、candidate paths。
- `SearchQueryResult.orderedPaths` 为 `null` 时，调用方继续走 fallback。
- `NoIndexSearchService` 始终报告 `mode: "no-index"`，并返回 `orderedPaths: null`。

这说明当前服务的价值是 **统一契约和生命周期**，不是提供完整搜索能力。

## 关键流程设计

### 1. 文件夹选择与基础卡片生成

这条主流程没有改变：

1. `main.ts` 生成选择请求并激活右侧视图。
2. `FolderCardView.ts` 采集文件、排序、生成 `baseCards`。
3. 宿主把结果继续送入 pipeline，得到 `visibleCards`。

### 2. 搜索 query 进入运行时

当前搜索主流程是：

1. 面板接收用户输入。
2. `FolderCardView.ts` 更新 runtime-only `searchQuery`。
3. 视图先按当前 query 把状态标成 `fallback` 或 `idle`。
4. 视图向 plugin-owned `SearchService` 发起 query。
5. 若服务返回可用 `orderedPaths`，pipeline 以该顺序筛选结果。
6. 若服务返回 `orderedPaths: null` 或服务不可用，pipeline 继续使用本地 fallback filtering。
7. `panel-model` 把最新 cards、query、status 投影给面板。

这里最重要的设计点有两个：

- query 输入不持久化，避免把短期 UI 意图污染成跨会话设置。
- 搜索服务不直接输出 UI，仍需回到 `pipeline.ts` 完成可见卡片投影。

### 3. 可见卡片投影

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

### 4. Vault 增量刷新与搜索服务转发

vault mutation 会同时走两条路：

- 一条进入 `FolderCardView.ts`，决定是否刷新可见卡片。
- 一条转发给 `SearchService`，为未来 indexed mode 预留 mutation seam。

当前 `NoIndexSearchService` 对 mutation 是 no-op，但这个入口已经固定下来。

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

### 视图级运行时状态

来源是 `FolderCardView.ts`：

- `folderPath`
- `baseCards`
- `visibleCards`
- `selectedPath`
- `generation`
- bulk state
- `searchQuery`
- `searchOrderedPaths`
- `searchStatus`

搜索状态属于这一层，因为它跟当前 view 的 scope、generation 和候选卡片集合强相关。

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
3. 不要把 indexed mode 设想写成当前事实。当前只有 fallback-first、no-index seam。
4. 不要破坏 `tag -> search -> pin` 的投影顺序。
5. 不要破坏 row projection、虚拟滚动、滚动锚定、hydrate-range、generation guards、debounced vault observers。
6. `Toolbar.svelte` 仍有已知非阻塞 a11y warnings，这属于后续 UI 收尾，不代表本次 readiness 不完整。

## 历史问题与折中

`2026-03-24` 的决策已经把搜索预留在 pipeline 接缝里，但当时 `applySearchFilter()` 还是 placeholder。那时真正重要的是先建立统一投影链路。

`2026-04-18` 的 Svelte 5 宿主接缝收尾，给搜索 readiness 提供了稳定宿主边界。随后这次 phase3 选择继续沿既有边界前进，而不是直接跳到 IndexedDB + MiniSearch。

这个折中很明确：先把 service seam、runtime ownership、panel bridge、fallback 语义锁定，再考虑索引层。成本是当前搜索能力仍偏保守，但好处是后续扩展不会和宿主状态归属打架。

## 优化与演进机会

1. 在不改变 ownership 的前提下，为 `SearchService` 增加 indexed adapter。
2. 引入 IndexedDB 或 MiniSearch 前，先决定索引重建策略、worker 边界和 ranking/tokenizer 语义。
3. 如需 rebuild commands，也应挂在 plugin-owned service lifecycle 上，不要绕开 `main.ts`。
4. 单独处理 `Toolbar.svelte` 的 a11y warnings，保持验证输出更干净。

## Related decisions

- `docs/decisions/2026-03-24-panel-owned-card-projection-and-interactions.md`
- `docs/decisions/2026-04-03-migrate-to-svelte-5-with-legacy-component-api.md`
- `docs/decisions/2026-04-04-row-projected-responsive-card-wall.md`
- `docs/decisions/2026-04-18-finish-svelte-5-host-and-component-seam.md`
- `docs/decisions/2026-04-18-phase3-search-architecture-readiness.md`
