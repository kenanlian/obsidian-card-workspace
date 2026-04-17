# Decision: 让 preview 裁切预算与归一化 preview 表面保持一致

## Background

`preview-normalization` 落地后，卡片 preview 已经统一到 Scheme B / weak cues：

- heading / paragraph / list / quote 使用同一字号与 line-height
- code preview 保留轻量 cue
- `previewLines` 同时驱动 parser 预算与 excerpt 裁切

但在真实 Obsidian 中又暴露出一个新的表现问题：某些卡片 preview 的最后一行会被切掉下半部分。

问题并不在 virtualization 本身，而在 preview 的“逻辑预算”和“物理高度预算”之间重新出现了错位：

- `src/view/markdown-utils.ts` 负责按 `previewLines` 生成轻量 preview HTML
- `styles.css` 里的 `.fce-excerpt` 负责按 `previewLines` 做物理高度裁切
- excerpt 内部却仍存在没有计入预算的垂直开销，例如段间距以及 code block 的额外 box chrome

## Trigger signal

在 Obsidian 手动测试中，用户观察到标准 preview 的最后一行被裁切，说明“统一摘要预览”虽然在逻辑上成立，但在真实渲染表面上仍不够一致。

## Decision

我们采用以下约束和实现方向：

1. 不改变 row virtualization、hydration、scroll anchoring 的总体结构。
2. 保持 `previewLines` 继续作为 preview 的唯一高度预算来源。
3. 让 preview HTML 与 excerpt CSS 使用同一种可预算表面：
   - excerpt 内部的段落不再依赖额外 `margin`
   - code preview 不再使用带额外垂直 padding / border 的 `<pre>` 表面
   - code 仍保留 light background cue，但必须是 height-neutral 的弱提示形式
4. sparse / empty 语义不变：真实短内容仍进入标准 preview 槽位，真正空内容仍显示 empty state。

## Why this option

这个方案比“只微调一点 CSS 公式”更稳，也比“重做 preview 结构或 virtualization”更小。

- **它直接修正根因。** 问题不是单次计算误差，而是 excerpt 内部存在预算外垂直开销。
- **它保持了 Scheme B 的方向。** code cue 仍然存在，但不再靠更重的 block chrome 来表达。
- **它不扩大 blast radius。** 修复集中在 preview 生成与 excerpt 样式，不触碰 hydration / row measurement 主流程。

## Impact

受影响的层次如下：

- `src/view/markdown-utils.ts`
  - code preview 的输出表面从 `<pre>` 收敛为与文本同预算的段落型表面。
- `styles.css`
  - `.fce-excerpt` 内部不再使用会额外占高的段间距。
  - code preview 的 light background cue 改为不引入额外垂直预算的样式。
- 测试
  - parser regression 和 view integration regression 现在会锁定这条约束，避免以后把 clipping 问题带回来。

## Cost and risk

- code preview 的视觉存在感会比带 padding / border 的 block 更弱。
- 后续如果有人想重新加回段间距、代码块边框或更厚的内边距，必须先重新评估 `previewLines` 的物理预算，而不是直接改 CSS。
- 这不是“永远禁止所有 excerpt 装饰”，而是要求任何垂直装饰都必须被纳入预算模型。

## Alternatives considered

### 方案 A：只调整 `.fce-excerpt` 的 `max-block-size` 公式

未采用。这样会把 margin / padding 常量硬编码进 clamp 公式，短期可用，但后续样式稍有变化就容易再次失配。

### 方案 B：改用更复杂的浏览器 line clamp 方案处理混合 block

未采用。当前 preview 仍有混合内容和 code cue，直接依赖更复杂的 CSS clamp 技巧会让行为更难预测，也没有必要扩大实现复杂度。

### 方案 C：调整 virtualization / row measurement 逻辑来兜底

未采用。虚拟列表测量的是已经渲染出来的卡片高度，不是 clipping 的根因；从那里修只会把问题向下游推。

## Follow-up actions

1. 后续如果继续调整 preview 视觉风格，优先检查 excerpt 内部是否重新引入了预算外垂直开销。
2. 如果产品以后要求更强的 code cue，需要先决定是否扩展 `previewLines` 的物理预算模型，而不是直接恢复旧的 `<pre>` 盒子。
3. 继续保留 parser / integration regression，确保 sparse / empty / code / settings-refresh 行为不被这类视觉修复意外破坏。

## Supersedes / related records

- Related: `2026-04-04-row-projected-responsive-card-wall.md`
- Related: `2026-04-09-toolbar-scope-summary-and-folder-only-subfolder-toggle.md`

## Related files

- `src/view/markdown-utils.ts`
- `src/view/markdown-utils.test.ts`
- `src/view/card-context-actions.test.ts`
- `src/view/CardItem.svelte`
- `styles.css`
