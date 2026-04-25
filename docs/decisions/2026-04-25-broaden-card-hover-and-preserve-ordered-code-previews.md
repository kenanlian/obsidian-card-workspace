# Decision: 扩大卡片 hover 触发表面，并按顺序保留轻量 preview 中的代码块

## Background

`Card Workspace` 之前对卡片预览有两条过于收窄的本地约束：

1. 卡片 hover preview 只会从标题区域发射，而且只对 `markdown` 生效。
2. `buildLightPreview()` 只有在“文档开头第一个可预览块就是 fenced code block”时才会输出代码预览；一旦先进入正文文本路径，后续代码块会被统一跳过。

这两条约束都不是宿主平台的硬限制，而是本仓库在实现上做的保守收窄。它们带来的问题也都很直接：

- 用户必须把鼠标精确停在标题上，才能触发卡片 hover preview。
- `base`、`canvas`、`excalidraw` 已经进入卡片流，但卡片 hover 仍被锁死在 Markdown-only 语义上。
- 对于“正文 + 代码块 + 正文 + 代码块”这类真实笔记，卡片轻量 preview 会错误地丢掉后续代码块，导致预览顺序与源码顺序脱节。

## Trigger signal

用户明确报告了两个行为缺陷：

1. 按住 `Ctrl` 时的 hover preview 只在卡片标题上有效，而且只对 Markdown 笔记有效。
2. 如果文档开头是正文，后面的 fenced code block 会从卡片 preview 中消失；若前几行预算里有多个代码块，也不会被保留。

在本地代码与测试中，这两个现象都得到确认，因此需要把它们从“偶然实现细节”提升为新的正式约束。

## Decision

我们采用以下正式合约：

1. **卡片 hover preview 继续走宿主 `hover-link` 路径。** 插件不自建第二套 popover，不绕过 Obsidian Page Preview。
2. **hover 触发表面扩大为卡片的非控件内容区域。** 当前正式允许的表面是 `title`、`excerpt`、`meta`；pin、more-actions、bulk checkbox 等控件不参与这条路径。
3. **卡片 hover 不再被本地逻辑锁死在 Markdown-only。** 只要文件已经是正式受支持的卡片类型，就允许发射 `hover-link`；最终能否显示 preview，以及显示质量，仍由宿主或对应插件决定。
4. **轻量 preview 继续保持 lightweight contract。** 不引入完整 Markdown renderer，不做 AST 级重写。
5. **`previewLines` 改为文本块与 fenced code block 共享的顺序预算。** `buildLightPreview()` 现在按源码顺序保留 preview block，而不是在正文开始后统一跳过后续代码块。
6. **代码块继续复用现有轻量样式。** fenced code block 仍输出 `<p class="fce-preview-code"><code>...</code></p>` 这条既有表面，不恢复 `<pre>` 盒子。
7. **code-first 行为保持稳定。** 如果第一个可预览块本身就是代码块，预览仍可继续走现有的 `mode: "code"` 语义。

## Why this option

- **保持宿主一致性。** hover preview 已经有稳定的 `hover-link` 集成路径，没有必要在插件里并行实现一个自定义浮层系统。
- **扩大命中面，但不扩大噪音。** 把 hover 触发从标题扩展到 `title / excerpt / meta`，能显著降低“必须精确悬停标题”的摩擦，同时继续避开按钮与 checkbox 这类交互控件。
- **修正顺序语义，而不是堆例外。** preview 的根问题不是“缺少第一个后续代码块特判”，而是块级顺序预算不完整；按源码顺序统一抽取文本块和代码块，才能覆盖一个或多个后续代码块的真实场景。
- **不破坏现有性能模型。** 方案继续沿用现有 line scanner 与 excerpt clamp 约束，不引入完整 renderer，也不触碰 virtualization / hydration 主结构。

## Impact

- `src/view/CardItem.svelte`
  - hover payload 的发射从“仅标题、仅 Markdown”收敛为“允许的非控件卡片表面”。
- `src/view/FolderCardView.ts`
  - 继续只做 `hover-link` 桥接，不增加新的 popover ownership。
- `src/view/markdown-utils.ts`
  - 预览抽取不再在正文开始后统一跳过 fenced code block。
  - `previewLines` 现在是文本块和代码块共享的顺序预算。
- `src/view/markdown-utils.test.ts` / `src/view/CardItem.svelte.test.ts` / `src/view/FolderCardView.test.ts`
  - 新测试锁定了多代码块顺序保留、非 Markdown hover 发射和动作控件排除语义。

## Cost and risk

- **hover 结果质量仍不完全由插件控制。** 即使插件已经发射 `hover-link`，`base`、`canvas`、`excalidraw` 的最终 popover 展示仍可能受宿主或对应插件能力影响。
- **preview 预算变得更显式。** 文本块与代码块现在共享同一 `previewLines` 预算，后续如果有人想加强代码样式或增加额外 block 装饰，必须先重新检查 excerpt 的物理预算。
- **不能把这次变更误解为 richer preview 的开始。** 当前仍是轻量摘要，不应借机把图片、表格、复杂块语法或完整 Markdown 渲染一起塞回卡片表面。

## Alternatives considered

- **方案 A：继续保持标题-only / Markdown-only hover。** 未采用，因为这只是把实现上的保守约束继续暴露给用户。
- **方案 B：在插件里自建 hover preview popover。** 未采用，因为这会复制宿主已有能力，并把文件类型兼容性问题从宿主转移到插件自身。
- **方案 C：只为正文后的第一个代码块补例外。** 未采用，因为用户已明确要求在共享预算内保留多个代码块；只补一个特判会让顺序语义继续不完整。
- **方案 D：引入完整 Markdown parser / renderer 重做 preview。** 未采用，因为这会扩大复杂度和性能成本，也超出当前卡片轻量摘要 contract。

## Follow-up actions

- 在真实 Obsidian 宿主里补一次 hover 手动 QA，重点确认 `base`、`canvas`、`excalidraw` 在 title / excerpt / meta 表面的 popover 表现。
- 如果未来要增强非 Markdown 的 hover 体验，优先评估宿主或对应插件的现有能力，而不是直接在 `CardItem.svelte` 旁边扩展自定义 popover。
- 如果未来要继续增强轻量 preview，先定义新的预算 contract，再讨论更强的样式或更多 block 类型，而不是直接给 `markdown-utils.ts` 加特判。

## Supersedes / related records

- Related: `2026-04-16-align-preview-clamp-budget-with-normalized-preview-surface.md`
- Related: `2026-04-24-support-mixed-file-kind-cards-with-markdown-only-indexing.md`
- Related: `2026-04-25-constrain-card-note-opens-to-main-editor-surfaces.md`

## Related files

- `src/view/CardItem.svelte`
- `src/view/CardItem.svelte.test.ts`
- `src/view/FolderCardView.ts`
- `src/view/FolderCardView.test.ts`
- `src/view/markdown-utils.ts`
- `src/view/markdown-utils.test.ts`
- `docs/START_HERE.md`
- `docs/architecture.md`
