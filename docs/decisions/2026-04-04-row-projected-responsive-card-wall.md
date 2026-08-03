# Decision: 用 row-projected virtualization 将卡片流升级为响应式 card wall

## 背景

V1 Phase 1 的核心目标，不再只是“把文件夹里的笔记列出来”，而是把右侧侧边栏推进成一个可以长期驻留使用的 card wall workbench。

在这一步之前，`FolderCardPanel.svelte` 仍然基于**单列 1D 虚拟列表**：

- 用单卡片 `positions[]` 计算可见窗口
- 以单卡片高度测量驱动滚动锚定
- `hydrate-range` 直接按单卡片窗口发给 `FolderCardView`

这套模型在单列时成立，但一旦侧边栏宽度变化并需要稳定切换到多列布局，原有“单卡片 = 虚拟化单位”的假设就会开始失真：

- 同一行里的卡片需要共享一个垂直位置
- 宽度变化会重排卡片到不同的行
- 如果仍按卡片单独测量和补偿滚动，滚动锚定会更容易漂移或跳闪

## 触发信号

- 当时的 V1 开发计划（仅保留在本地，未纳入版本控制）中的 T31 明确要求采用 **row-projected virtualization** 作为唯一推荐路径。
- 产品路线已经把 V1 的第一优先级定义为“把单列卡片流升级成响应式 card wall”。
- 现有性能约束不能退回整列表渲染，也不能破坏 viewport-driven hydration 与 generation 防陈旧模型。

## 决策

我们将响应式 card wall 的实现固定为以下方案：

1. **继续由 `FolderCardView` 持有扁平 `cards` / `visibleCards` / `generation` / hydration orchestration。**
2. **在 `FolderCardPanel.svelte` 内部新增 panel-local row projection 层**，根据 viewport width 计算 `columnCount`，把扁平卡片序列投影成稳定顺序的 rows。
3. **虚拟化单位从 card 切换为 row**：可见窗口、padding、滚动锚定都按 row 计算。
4. **高度测量从单卡片切换为 row wrapper**，避免多个高度来源同时竞争 scroll anchoring。
5. **`hydrate-range` 继续保持扁平 card index 合同不变**，只是在 panel 内把可见 rows 再映射回连续 card range。
6. **布局使用显式 grid rows，不使用 CSS columns 或 masonry。**

## 为什么选这个方向

### 1. 在不改运行时主边界的前提下支持多列

这一步的真正变化是“视口层如何投影和渲染”，而不是“谁拥有主状态”。把 row projection 留在 panel 内，可以保住 `FolderCardView` 作为单一运行时协调层的角色。

### 2. 保住已有性能模型

row-projected virtualization 允许我们继续保留：

- top/bottom padding 虚拟窗口
- 可见区附近才 hydration
- generation 防陈旧
- resize / hydration 时的滚动锚定

也就是说，能力升级发生在虚拟化模型内部，而不是以牺牲虚拟化为代价换多列样式。

### 3. 让响应式布局的行为可预测

显式 rows + stable chunking 能保证卡片顺序始终以扁平 `visibleCards` 为准。这样 pin、tag filter、后续 search 都不会因为布局变化而改变语义。

## 影响

### 正面影响

- card wall 现在可以随 sidebar 宽度在 1 列到多列之间稳定切换
- 虚拟化和 hydration 仍然存在，没有回退成整量渲染
- 未来继续做 T32/T33 时，不需要再推翻这套布局基础

### 结构性影响

- `FolderCardPanel.svelte` 现在不仅拥有滚动位置，还拥有 viewport width -> row projection -> visible rows 这一层瞬时布局状态
- `scroll-anchoring.ts` 的语义从 card index 转向 row index，同时补充了 resize 时按 anchor card 恢复滚动位置的逻辑
- 新增了 `row-projection.ts` 作为纯计算 helper，用来承接列数、rows、hydrate range 的可测试逻辑

## 成本与风险

1. **Panel 复杂度上升。** 视口层现在同时负责宽度观测、row projection、row measurement 和 row virtualization，需要继续警惕把业务状态混进去。
2. **Resize anchoring 仍有边界情况。** 如果后续卡片内容高度波动更大，行高变化和列数变化叠加时仍可能出现更难调的滚动体验。
3. **现有 a11y 警告仍未处理。** 这次没有进入 `Toolbar.svelte` 的可访问性收尾，后续应在 Phase 4 或相关切片中解决。

## 备选方案

### 方案 A：退回整列表渲染，直接用 CSS grid 做多列

没有采用。这样能更快得到“看起来像多列”的结果，但会直接破坏当前仓库最重要的性能约束。

### 方案 B：继续按 card 作为虚拟化单位，只在 CSS 上做多列包装

没有采用。这样会让滚动位置、行高和 padding 计算失去统一几何模型，宽度变化时很难稳定锚定。

### 方案 C：把布局状态提升到 `FolderCardView`

没有采用。这会把 viewport width、row measurement 等瞬时 UI 状态推入运行时主协调层，违反当前架构边界。

## 后续动作

1. 在 T32 中继续补齐 scope/filter 的 Toolbar 信息层次，但不要破坏新的 row-projected wall 基础。
2. 在 T33 或后续回归里增加更贴近真实 resize 行为的验证，尤其关注中段滚动时的列数切换。
3. 在 Phase 4 处理当前已知的 `Toolbar.svelte` a11y warnings，而不是在 T31 顺手混入。

## Supersedes / related records

- 相关记录：`docs/decisions/2026-03-24-panel-owned-card-projection-and-interactions.md`
- 相关记录：`docs/decisions/2026-04-03-migrate-to-svelte-5-with-legacy-component-api.md`

## Related files

- `src/view/FolderCardPanel.svelte`
- `src/view/row-projection.ts`
- `src/view/row-projection.test.ts`
- `src/view/scroll-anchoring.ts`
- `src/view/scroll-anchoring.test.ts`
- `styles.css`
