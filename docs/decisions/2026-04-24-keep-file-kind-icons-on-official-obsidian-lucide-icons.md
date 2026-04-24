# Decision: 将文件类型标题图标保持在官方 Obsidian Lucide 图标集内

## Background

`base`、`canvas`、`excalidraw` 进入卡片流之后，`src/view/file-kind.ts` 开始承担“文件类型 -> 标题图标”这一层 UI contract。

这带来了一个新的实现选择：

- 是继续使用 Obsidian 官方 `setIcon(...)` 路径，通过 Lucide icon name 表达文件类型语义；
- 还是把截图、栅格图片或自定义图像资产直接塞进卡片标题图标槽位。

这次用户给出了两张 JPG 作为视觉参考，但真实诉求并不是把图片本身嵌进 UI，而是希望我们根据截图里的样式，在 Obsidian 官方使用的图标集里找到同款或最接近的 icon。

## Trigger signal

实现过程中一度出现了“把 JPG 截图转成 data URI 并直接注入标题图标”的中间方案。这个方案虽然能在视觉上接近截图，但会改变 `file-kind.ts` 的 contract：图标值不再是官方 icon name，而是图片资产。

在用户明确要求“去 Obsidian 官方使用的图标集中找到一样的 icon”之后，我们需要把这个边界重新钉死。

## Decision

我们正式采用以下合约：

1. **文件类型标题图标继续使用 Obsidian 官方 `setIcon(...)` 路径。**
2. **`src/view/file-kind.ts` 提供的图标值继续是官方 Lucide icon name，而不是图片 data URI、自定义 `<img>` 或截图资产。**
3. **当前 `base` 使用 `layout-list`。** 这是对截图中“列表 / 方形 bullet + 行文本”风格的原生收敛。
4. **当前 `excalidraw` 使用 `pen-tool`。** 这是对截图中“铅笔 + 尺子交叉”风格的原生收敛。
5. **`CardItem.svelte` 的标题图标渲染继续保持统一的 `setIcon(node, iconName)` 路径。** 不为单个文件类型引入额外图片分支。

## Why this option

- **更符合用户真实意图。** 用户要的是“官方图标集中同款样式”，不是把参考图直接缩成图标。
- **保持 native feel。** Obsidian 标题行图标天然围绕 Lucide icon name 和 `setIcon(...)` 工作；沿用官方路径可以保持尺寸、对齐和主题一致性。
- **避免把资产管理引入 `file-kind` contract。** 一旦图标值变成图片 data URI，`file-kind.ts` 就不再只是“语义 -> icon name”映射，而会承担静态资产负载。
- **减少 bundle 噪音和 review 成本。** 大段 base64 栅格资源会放大 diff，也让后续代码审阅和调整图标选择变得更困难。
- **避免局部渲染特判。** `CardItem.svelte` 不需要为了两个文件类型单独处理 `<img>` 或 `innerHTML` 分支。

## Impact

- `src/view/file-kind.ts` 继续是文件类型图标语义边界，但其返回值保持为官方 icon name。
- `src/view/CardItem.svelte` 的 `applyIcon(...)` 回到统一的 `setIcon(...)` 逻辑。
- `CardItem.svelte.test.ts` 与 `file-kind.test.ts` 现在锁定的是官方 icon name：`base -> layout-list`，`excalidraw -> pen-tool`。
- 后续如果继续调整图标风格，应先在官方可用图标名范围内收敛，而不是直接引入自定义图片资产。

## Cost and risk

- **只能近似匹配截图样式，不能像图片替换那样做到像素级一致。** 这是选择原生 icon contract 的代价。
- **图标名可用性依赖 Obsidian 所带 Lucide 版本。** 如果宿主版本不包含某个图标名，需要在同一官方图标集内回退到次优候选。
- **`base` 图标仍是语义近似。** 当前选择 `layout-list`；如果未来用户想让它更像 task/list bullet，也可以再在官方候选里继续微调。

## Alternatives considered

- **方案 A：把 JPG 截图直接转成 data URI 注入标题图标。** 未采用，因为这不符合用户后续澄清，也会破坏原生 icon contract。
- **方案 B：裁切 JPG 中的 icon 本体后作为自定义图片图标。** 未采用，因为用户明确要求从官方图标集中找同款，而不是继续使用图片资产。
- **方案 C：保留原来的 `database` / `pen-tool`。** 未采用，因为它们与截图风格的语义和视觉相似度都偏低。

## Follow-up actions

- 在真实 Obsidian 宿主里确认 `layout-list` 与 `pen-tool` 在当前版本都能正常解析和显示。
- 如果后续用户还要继续微调图标风格，优先继续在官方候选 icon name 内收敛，而不是改回图片方案。

## Supersedes / related records

- Related: `docs/decisions/2026-04-24-support-mixed-file-kind-cards-with-markdown-only-indexing.md`
- Related: `docs/decisions/2026-04-23-toolbar-ui-optimization.md`

## Related files

- `src/view/file-kind.ts`
- `src/view/CardItem.svelte`
- `src/view/CardItem.svelte.test.ts`
- `src/view/file-kind.test.ts`
- `docs/START_HERE.md`
- `docs/architecture.md`
