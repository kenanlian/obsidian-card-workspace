# Decision: 完成 phase3 搜索架构迁移至 Indexed-Only 模式

## 背景

在 Phase 3 的演进过程中，我们已经建立了完整的本地索引搜索链路（IndexedDB + MiniSearch）。然而，为了确保搜索结果的一致性和权威性，我们决定进一步收敛架构：彻底移除 fallback 搜索路径，转向 **Indexed-Only** 搜索模式。

## 触发信号

- `src/search/types.ts` 中已明确定义了 `indexed-only` 的状态矩阵。
- `pipeline.ts` 已移除对 `orderedPaths: null` (fallback) 的显式支持。
- 产品决策要求：当索引不可用时（如 building, error, rebuild-required），非空查询应被明确阻塞，而非退回到不准确的随机过滤。
- `NoIndexSearchService` 已被彻底从代码库中**删除**，取而代之的是状态感知的 `IndexedSearchService`。

## 决策

我们正式把搜索架构迁移至：**Indexed-Only Search Architecture**。

这项决策包含以下关键点：

1. **移除降级路径**：系统不再支持非索引模式下的非空查询过滤。
2. **状态感知阻塞**：
   - `indexed-ready`: 索引就绪，查询执行，结果权威。
   - `indexed-building`/`indexed-rebuild-required`/`indexed-error`: 索引不可用，非空查询结果为 `null`（UI 呈现阻塞态）；空查询（浏览模式）不受影响。
3. **Markdown 优先全文索引**：全文索引（MiniSearch）仅覆盖 Markdown 文档。非 Markdown 文件（base/canvas/excalidraw）仅参与标题级匹配。
4. **Ownership 保持不变**：`main.ts` 拥有全局生命周期，`FolderCardView.ts` 拥有 per-view query 状态，`pipeline.ts` 负责最终投影。

## 为什么选这个方向

### 1. 消除搜索结果的二义性

在 fallback 模式下，用户很难区分“索引未就绪导致的随机结果”和“真实的搜索结果”。转向 Indexed-Only 后，搜索结果要么是权威的，要么是明确表示不可用的。

### 2. 简化投影链路

移除降级路径后，`pipeline.ts` 的逻辑变得更加纯粹，不再需要处理两套平行的过滤算法，降低了维护难度和潜在 Bug 风险。

### 3. 强化本地索引的权威地位

明确了索引是搜索能力的唯一来源，促使我们在索引恢复、增量更新和 rebuild 调度上投入更多关注，确保核心能力稳健。

## 影响

### 正面影响

- 用户体验的一致性：搜索结果不再随索引状态而产生随机波动。
- 架构清晰：文档、代码和测试现在统一围绕 indexed-only 模型。

### 风险与折中

- 在索引重建或初次构建期间，搜索功能将暂时不可用。我们接受这种短期的可用性牺牲，以换取结果的权威性。
- 对 unsafe folder rename 触发的 rebuild-required 策略保持保守，确保路径准确性。

## 后续动作

1. 更新所有相关架构文档，确保不再提及 fallback 搜索路径。
2. 确保 UI 层（Svelte）能够正确识别并反馈索引不可用状态（如显示“索引构建中...”）。
3. 持续优化索引构建性能，减少搜索不可用的窗口期。

## 相关记录

- `docs/decisions/2026-04-18-phase3-search-architecture-readiness.md`
- `docs/decisions/2026-04-18-close-phase3-indexed-search-capability.md`
- 本决策进一步明确了 Phase 3 的最终技术路径：从“具备索引能力”进化为“仅依赖索引”。
