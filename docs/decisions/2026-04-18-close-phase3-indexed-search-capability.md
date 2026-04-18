# Decision: 关闭 Phase 3，并把搜索接缝收敛为正式 indexed 架构

## 背景

项目先后完成了卡片投影统一、Svelte 5 宿主接缝稳定，以及 `phase3 search architecture readiness`。但 readiness 只回答了 ownership 和 contract 问题，没有把索引恢复、增量更新、服务查询和插件级 rebuild 调度写成长期文档事实。

如果继续让文档停在 readiness 状态，后续维护者会误以为搜索仍只是 no-index seam，或者会忽视 `IndexStore`、`SearchIndexManager`、`IndexedSearchService` 这条已经落地的正式运行时链路。

## 触发信号

- 索引持久化已经通过 `IndexStore` 落到 IndexedDB。
- `SearchIndexManager` 已负责 restore、full build、mutation apply 和健康快照。
- `IndexedSearchService` 已负责 candidate-bounded 查询与 indexed ordering 输出。
- `main.ts` 已拥有 indexed 搜索生命周期、命令注册、降级回退和 rebuild 调度。
- `FolderCardView.ts` 继续持有 per-view query、status 和 debounce，没有把搜索真值上提到 plugin settings。
- `pipeline.ts` 已锁定 `orderedPaths: null` 与 `orderedPaths: []` 的不同语义，并保持 `tag -> search -> pin` 不变。
- 最终仓库验证命令通过，真实 Obsidian 手动 QA 因环境受限未执行，用户已明确批准豁免并要求关闭 F3。

## 决策

我们正式把当前搜索状态定义为：**Phase 3 search capability 已完成并关闭。**

这项决策包含六个结论：

1. 搜索能力现在是正式 indexed 架构，不再只是 no-index readiness seam。
2. `main.ts` 继续拥有 plugin-global 生命周期、快照订阅、命令和 rebuild 调度。
3. `FolderCardView.ts` 继续拥有 per-view runtime query、status、debounce 和候选卡片范围。
4. `pipeline.ts` 继续是唯一可见卡片投影路径，indexed ordering 只能作为输入，不能绕开 pipeline。
5. `orderedPaths: null` 与 `orderedPaths: []` 的语义视为稳定 contract，后续实现不得改写。
6. F3 的关闭建立在仓库验证通过和用户批准豁免真实 Obsidian 手动 QA 之上，文档必须明确这一点。

## 为什么选这个方向

### 1. 现在的系统理解已经改变了

搜索不再只是“未来可插入索引”的边界，而是已经有持久化、恢复、增量更新和查询服务的完整本地链路。文档必须反映这个事实。

### 2. ownership 没变，但能力已经变了

Phase 3 成功的地方，不是重新设计 view 和 plugin 的边界，而是在不破坏 ownership 的前提下把 indexed 搜索补进去。这是后续继续演进时最需要保护的认知。

### 3. 关闭条件需要被明确记录

这次收尾不是“手动 QA 已完成”，而是“仓库验证已完成，真实宿主手动 QA 被用户豁免”。不把这件事写清楚，后续维护者会对验证证据做出错误假设。

## 影响

### 正面影响

- 长期文档现在能正确描述 indexed 搜索的真实结构。
- 后续改动更容易沿现有 ownership 前进，不容易回到平行状态系统。
- F3 的关闭条件被明确记录，后续不会把环境限制误读成实现缺口。

### 结构性影响

- `IndexStore`、`SearchIndexManager`、`IndexedSearchService` 成为搜索能力的正式长期边界。
- `main.ts` 和 `FolderCardView.ts` 的职责划分继续有效。
- `pipeline.ts` 的单链路投影假设进一步被锁定。

## 成本与风险

1. 当前仍缺少真实 Obsidian 宿主内的手动验证证据。
2. indexed 搜索能力已经增加系统层次，后续若把细节散进 view 或 UI，复杂度会很快失控。
3. 对 unsafe folder rename 采用 `rebuild-required` 的保守策略，会带来重建成本，但这是为了避免脏索引继续提供结果。
4. `Toolbar.svelte` 的非阻塞 a11y warnings 仍存在，虽然不阻塞关闭，但会继续出现在验证输出里。

## 备选方案

### 方案 A：继续沿用 readiness 文档，不为最终关闭补决策记录

没有采用。这样会让长期文档继续低估当前搜索能力，也会漏掉 F3 关闭条件的关键背景。

### 方案 B：把搜索完成态写成“已完成完整手动 QA”

没有采用。这与当前环境证据不符，也会误导后续维护者。

### 方案 C：把 query 上提到 plugin settings，统一做跨视图持久化

没有采用。当前搜索 query 仍是 view-local intent，把它持久化会破坏既有 ownership，也会混淆 indexed 搜索和用户会话偏好。

## 后续动作

1. 在真实 Obsidian 宿主可用时补一次手动 QA，并把证据沉淀到长期文档或后续决策中。
2. 后续若扩展 ranking、tokenizer 或 rebuild UX，继续沿 `IndexStore`、`SearchIndexManager`、`IndexedSearchService` 分层推进。
3. 单独清理 `Toolbar.svelte` 的 a11y warnings，不在本决策里混入 UI 收尾改动。

## 替代 / 相关记录

- 相关记录：`docs/decisions/2026-03-24-panel-owned-card-projection-and-interactions.md`
- 相关记录：`docs/decisions/2026-04-18-finish-svelte-5-host-and-component-seam.md`
- 相关记录：`docs/decisions/2026-04-18-phase3-search-architecture-readiness.md`
- 本记录不推翻 readiness 决策，而是声明该接缝已被推进为正式 indexed 搜索架构，并记录 Phase 3 的关闭条件。

## 相关文件

- `docs/START_HERE.md`
- `docs/architecture.md`
- `src/main.ts`
- `src/view/FolderCardView.ts`
- `src/view/pipeline.ts`
- `src/search/IndexStore.ts`
- `src/search/SearchIndexManager.ts`
- `src/search/IndexedSearchService.ts`
