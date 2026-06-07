# Decision: 启动首屏 preview 预热前移到 folder load

## Background

启动 Obsidian 后，卡片列表常常先出现，而首屏多张 Markdown 卡片还停留在 `Loading preview...`。当前链路先提交未水合的 `baseCards`，再由 `FolderCardPanel.svelte` 的 viewport effect 触发 `hydrateRange()`，因此用户会看到首屏逐张补 preview。

## Trigger signal

用户明确要求缩短插件启动时首屏 preview 的空窗，并提供了实际启动截图作为问题证据。

## Decision

我们把启动 preview 水合从“面板渲染后按 viewport 触发”前移到 `FolderCardView.loadFolder()` 的 `loading=true` 阶段：

1. `loadFolder()` 在提交首个非 loading state 之前，先对当前 pipeline 投影后的前 12 张可见卡片执行同步预热。
2. 预热目标必须通过 `deriveVisibleCardsFrom(records)` 计算，而不是简单读取排序后的 `baseCards` 前缀；这样 tag filter、search gate 和 pin reorder 与首屏真实可见结果保持一致。
3. 启动预热默认一次并发整批提交；普通 `hydrateRange()` 仍保留 batch 控制，但只在整个请求范围完成后 `pushState()` 一次。
4. `pendingHydration` 继续作为去重 contract，避免启动预热与面板 mount 后的 `hydrate-range` 事件对同一路径重复读取。
5. `markdown-utils.ts` 对空字符串和纯空白 Markdown 增加 `empty` 快路径，避免无意义的后续解析。

## Why this option

- 它减少了用户真正看到的首屏 `Loading preview...` 时间，而不是只换文案或骨架屏。
- 它不改变 `FolderCardView` / `panel-model` 的状态 ownership，也不破坏 viewport-driven lazy hydration。
- 它复用现有 generation guard 和 pipeline 语义，避免把“性能优化”变成另一套并行可见性逻辑。
- 它比引入持久化 preview cache 风险小得多，不需要处理缓存失效、版本迁移或内容哈希策略。

## Impact

- 启动首个稳定 cards state 现在更晚一点提交，但提交时首屏前 12 张可见卡片通常已经带 preview。
- 滚动范围 hydration 的中间 `pushState()` 被移除，减少一次请求内的重复派生与重渲染。
- 纯空白 Markdown 会更早走 `empty` 路径，但最终用户可见语义不变。

## Cost and risk

- 启动阶段最多并发 12 个 `cachedRead()`；这没有扩大读取范围，只把原先 5/5/2 的串行批次改成一次性并发。
- 如果未来有人把预热目标改回 `baseCards` 前 N 张，会重新引入 pin / filter / search gate 下的错读问题。
- 这不是 preview cache；冷启动 I/O 仍然存在，只是被压缩到了统一 loading 阶段。

## Alternatives considered

### 只改 UI，把 `Loading preview...` 换成骨架屏

拒绝。它改善感知但不减少真实等待，还会掩盖真正的启动瓶颈。

### 引入持久化 preview cache

拒绝。需要额外定义失效策略、存储边界和迁移规则，明显超出这次问题范围。

### 在收集文件时边枚举边读取 preview

拒绝。排序、tag filter、search gate 和 pin reorder 还没跑完，无法确定真实首屏目标。

### 对整个 folder scope 做 eager hydration

拒绝。会破坏当前视口驱动的惰性水合约束，对大 vault 不可接受。

## Follow-up actions

- 固定等待前 12 张 preview 的策略已被 `2026-06-01-startup-preview-wait-budget` 调整为 6 张候选卡片 + 120ms 等待预算。
- 如果未来考虑 preview cache，必须单独写决策记录，明确失效与一致性策略。

## Supersedes / related records

- Superseded in part by: `docs/decisions/2026-06-01-startup-preview-wait-budget.md`
- Related: `docs/decisions/2026-05-31-collapse-scope-model-to-root-default-folder-only.md`
- Related: `docs/decisions/2026-04-18-close-phase3-indexed-search-capability.md`

## Related files

- `src/view/FolderCardView.ts`
- `src/view/markdown-utils.ts`
- `src/view/card-context-actions.test.ts`
- `src/view/markdown-utils.test.ts`
- `docs/architecture.md`
- `AGENTS.md`
