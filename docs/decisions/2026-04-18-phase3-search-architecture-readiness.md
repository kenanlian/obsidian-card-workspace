# Decision: 完成 phase3 搜索架构 readiness 接缝 (已作废/Superseded)

> [!CAUTION]
> **此决策已被 [2026-05-08-adopt-indexed-only-search-architecture.md](./2026-05-08-adopt-indexed-only-search-architecture.md) 取代。**
> 
> 以下内容仅作为历史存档，记录 Readiness 阶段的状态。
> 当前系统已**彻底移除** `NoIndexSearchService` 与降级搜索路径，全面转向 **Indexed-Only** 模式。

## 背景

项目已经有统一的卡片投影链路，也已经完成 Svelte 5 宿主接缝收尾，但搜索相关认知仍停在旧状态：

- 文档仍把 `applySearchFilter()` 当成 placeholder。
- 搜索 query 没有明确的运行时归属说明。
- 面板状态桥缺少稳定的 query/status 表达。
- 插件层没有被文档明确描述为搜索生命周期 owner。

如果继续在这个前提下推进，未来很容易直接把 IndexedDB、MiniSearch 或 worker 塞进系统，却没有先把 ownership 和接缝固定下来。

## 触发信号

- `PipelineContext` 现在显式携带 runtime-only `search` 输入和 `pinnedPaths`。
- `PanelModelState` 现在携带 `searchQuery` 与 `searchStatus`。
- `FolderCardView.ts` 已形成 query/status bridge，并把 query 保持在视图运行时。
- `main.ts` 已拥有 plugin-owned `NoIndexSearchService` (已移除) 生命周期与初始化失败回退。
- `applySearchFilter()` 已支持 fallback search (已作废)，并保持 search-before-pin invariant。
- 当前代码验证已经通过 `npm run check`、`npm run build`、`npm test`。

## 决策

我们正式把当前搜索状态定义为：**phase3 search architecture readiness 已完成。**

这次决策包含五个具体结论：

1. 搜索 query 是 runtime-only、per-view 状态，当前 owner 是 `FolderCardView.ts`。
2. `panel-model` 是搜索 query/status 进入 Svelte 面板的正式桥，不是临时 props 通道。
3. `pipeline.ts` 继续是唯一可见卡片投影链路，搜索必须在这条链上完成，而不是另起平行结果通道。
4. `SearchService` 由 `main.ts` plugin-owned 持有，Readiness 阶段实现是 fallback-first、no-index seam (当前已转向 Indexed-Only)。
5. 这次只完成 readiness seam，不引入 IndexedDB、MiniSearch、rebuild commands、worker、ranking/tokenizer，也不把 query 持久化到 settings。

## 为什么选这个方向

### 1. 先把 ownership 锁清楚

搜索最容易失控的地方不是匹配算法，而是状态归属。先明确 query 在 view 里、生命周期在 plugin 里、投影在 pipeline 里，后续再加索引实现才不会互相覆盖责任。

### 2. 先保正确性和退化路径 (注意：退化路径已在 Indexed-Only 架构中移除)

Readiness 阶段 `SearchService` 可以返回 `orderedPaths: null`，视图就继续使用本地 fallback filtering。这个设计让系统在没有索引时仍能工作，也避免初始化失败直接让搜索断掉。 (当前系统已改为在索引未就绪时阻塞非空查询)

### 3. 避免过早承诺索引方案

如果现在直接把 IndexedDB、MiniSearch、worker、排序策略一起引入，文档和代码会一次跨太多层。先把 readiness 做完，后续每一步更容易验证。

## 影响

### 正面影响

- 文档、代码和测试现在都能一致说明当前搜索边界。
- 后续 indexed search 有了正式接入口，不需要回头重做状态归属。
- 搜索失败或服务不可用时，系统仍能退回 fallback 路径。 (此特性在 Indexed-Only 架构中已被移除，改为阻塞展示)

### 结构性影响

- `FolderCardView.ts` 现在是 query/status 的单一运行时 owner。
- `PanelModelState` 必须继续承载 `searchQuery` 与 `searchStatus`。
- `SearchService` 的未来扩展要服从 `main.ts` 生命周期管理。

## 成本与风险

1. 当前搜索仍不是完整全文索引能力，用户可见能力上限有限。
2. `FolderCardView.ts` 的协调职责继续增长，后续可能需要再拆细搜索编排。
3. 如果未来 indexed adapter 试图直接产出 UI 结果，而不是回到 pipeline，会破坏现在的单链路假设。
4. `Toolbar.svelte` 仍有已知非阻塞 a11y warnings，验证输出还不算完全干净。

## 备选方案

### 方案 A：直接引入 IndexedDB + MiniSearch

没有采用。这样会把契约设计、索引存储、重建策略、worker 边界和排序语义一次绑死，风险太高。

### 方案 B：继续维持 placeholder 文档，等完整搜索落地后再统一补写

没有采用。真实代码已经不是 placeholder 状态，继续拖延只会让维护者在错误前提下工作。

### 方案 C：把 query 持久化到 `PluginSettings`

没有采用。搜索 query 属于短期 view intent，不是跨会话配置。把它持久化会污染设置边界，也会增加会话恢复歧义。

## 后续动作

1. 设计 indexed adapter 时，沿用现有 `SearchService` contract，不改变 runtime ownership。
2. 只有在索引策略和重建语义明确后，再评估 IndexedDB、MiniSearch、worker 和 rebuild commands。
3. 保持 `tag -> search -> pin` invariant，并为 indexed mode 补更细的投影测试。
4. 单独处理 `Toolbar.svelte` 的 a11y warnings。

## Supersedes / related records

- 相关记录：`docs/decisions/2026-03-24-panel-owned-card-projection-and-interactions.md`
- 相关记录：`docs/decisions/2026-04-18-finish-svelte-5-host-and-component-seam.md`
- 这条记录不表示“全文搜索已完成”，它只声明 readiness seam 已完成。

## Related files

- `AGENTS.md`
- `docs/architecture.md`
- `src/main.ts`
- `src/view/FolderCardView.ts`
- `src/view/panel-model.ts`
- `src/view/pipeline.ts`
- `src/search/types.ts`
- `src/search/NoIndexSearchService.ts` (已从仓库删除)
