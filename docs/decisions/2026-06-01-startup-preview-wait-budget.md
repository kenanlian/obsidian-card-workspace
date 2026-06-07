# Decision: 启动 preview 预热加入等待预算

## Background

`2026-05-31-startup-preview-hydration-prewarm` 把启动 preview 水合前移到 `FolderCardView.loadFolder()`，让用户首次看到卡片时更可能已经带有正文 preview。这个策略解决了“首屏逐张补 preview”的割裂感，但也把前 12 张卡片的 `cachedRead()` 与 `buildLightPreview()` 放进了首个非 loading state 的阻塞链路。

## Trigger signal

用户继续关注首屏加载时间，同时明确指出“直接先显示骨架再补内容”的体验不好。新的目标不是回退到纯 skeleton，而是在快路径保留完整 preview，在慢路径避免无限等待。

## Decision

启动 preview 预热从“固定等待前 12 张完成”调整为“限量 + 限时”：

1. `loadFolder()` 仍然先通过 `deriveVisibleCardsFrom(records)` 计算真实首屏候选，保持 tag filter、search gate 和 pin reorder 语义一致。
2. 启动预热目标从前 12 张缩小为前 6 张可见候选。
3. `loadFolder()` 最多等待 120ms 的启动 preview 预算。
4. 如果 6 张 preview 在预算内完成，首个非 loading state 仍直接带 preview。
5. 如果超过预算，先提交稳定卡片状态，后台 hydration 继续完成，并在 generation 仍然有效时再 `pushState()` 一次补齐 preview。
6. 后续滚动或面板上报的 `hydrateRange()` 仍负责视口范围内的懒水合。

## Why this option

- 它保留了之前预热策略的核心优点：快路径不会让用户看到空 preview。
- 它给慢文件、冷缓存和大 vault 一个明确上限，避免首屏被固定 12 张 preview 拖住。
- 它不引入新的 preview cache，也不改变 `FolderCardView` / `panel-model` / Svelte 面板的 ownership。
- 它继续复用 generation guard、`pendingHydration` 去重和 viewport-driven hydration。

## Impact

- 冷启动或慢磁盘上，首个稳定卡片状态可以更早出现。
- 快速读取路径下，用户仍会直接看到带 preview 的首屏卡片。
- 如果超时兜底触发，用户可能看到少量 preview 延后淡入，但卡片数量、排序和高度语义保持稳定。
- 固定“前 12 张预热”的文档约束被废弃，后续维护应按“6 张 + 120ms 预算”理解当前行为。

## Cost and risk

- 120ms 是经验预算，不是经过真实 Obsidian vault profile 得出的硬指标；后续可根据手动性能记录调整。
- 如果未来把数量调得过低，快路径完整感会下降；如果调得过高，首屏等待又会变长。
- 后台 hydration 完成后会额外 `pushState()` 一次，但只发生在启动预算超时且 generation 仍有效时。

## Alternatives considered

### 立即提交 metadata/skeleton，然后完全交给 viewport hydration

拒绝。它会重新暴露“卡片先空着，再逐张补 preview”的断裂体验。

### 继续固定等待前 12 张 preview

拒绝。体验稳定但首屏等待没有上限，慢 I/O 情况下感知启动时间过长。

### 先做 preview cache

暂缓。cache 对重复打开有价值，但不能解决冷启动第一轮读取与 preview 生成的阻塞预算问题。

## Follow-up actions

- 后续若有真实 vault profile，应记录 120ms 是否合适。
- 如果引入 preview cache，需要单独记录缓存 key、失效策略和迁移策略。
- 如要改动预热数量，必须同时更新 `AGENTS.md`、`docs/architecture.md` 和相关测试。

## Supersedes / related records

- Supersedes part of: `docs/decisions/2026-05-31-startup-preview-hydration-prewarm.md`
- Related: `docs/decisions/2026-05-31-collapse-scope-model-to-root-default-folder-only.md`

## Related files

- `src/view/FolderCardView.ts`
- `src/view/card-context-actions.test.ts`
- `docs/architecture.md`
- `AGENTS.md`
