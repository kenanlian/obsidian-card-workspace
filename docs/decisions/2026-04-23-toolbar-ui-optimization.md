# Decision: Toolbar UI 优化：可收起搜索行、持续高亮态与批量选择表面收敛

## Background

在 Phase 3 搜索能力落地后，Toolbar 与卡片表面承载了更多交互职责（搜索输入、状态反馈、标签筛选、子文件夹切换、批量操作、批量选择等）。原有布局开始显得拥挤：

- `Subfolders` 仍是一个视觉上偏突兀的独立芯片，不像一级按钮体系的一部分。
- bulk strip 继续依赖文字按钮，占用横向空间，且和第一行按钮语言不统一。
- `Bulk actions`、`All notes`、`Filter cards`、`Toggle search` 等入口虽然有状态语义，但高亮反馈不够稳定和明确。
- 批量模式下卡片右上角同时出现 `Select` 按钮和 pin 按钮，视觉中心不清晰，也浪费了真正的右上角动作槽位。

为了提升交互效率并保持“Native Feel”，需要把这些能力重新收敛进统一的一级按钮与卡片动作模型里，而不是继续追加不同风格的小控件。

## Trigger signal

`top-toolbar-ui-optimization` 任务的目标是继续简化顶部工具栏，并把批量模式与子文件夹切换的交互表面统一到更紧凑、更原生的 Obsidian 风格中。

## Decision

我们实施了以下 UI 合约优化：

1. **搜索仍保持第一行显式切换，但维持清晰激活反馈**：
   - 搜索输入框继续采用可收起设计。
   - 第一行放大镜按钮继续作为搜索入口。
   - 当搜索行展开，或 query 仍然生效时，按钮保持高亮，避免“当前到底是否还在搜索”的状态漂移。

2. **上下文摘要继续保持紧凑，只保留真正需要解释的状态**：
   - 仍然不恢复 `Scope:` 这类冗余文案。
   - 摘要行只在 tag filter 或异常搜索状态存在时显示。
   - 批量模式的主要反馈不再依赖摘要行，而改由 bulk strip 和一级按钮高亮共同承担。

3. **`Subfolders` 不再作为独立芯片，而是升级为一级 icon button**：
   - 放到 `Folder scope` 后面，成为 scope modifier，而不是另起一种控件语言。
   - 使用 `folder-tree` 图标表达递归子文件夹语义。
   - 仅在 folder scope 下显示；在 `All Notes` 下继续隐藏。
   - 开启时通过和其他一级按钮一致的背景高亮表达激活状态。

4. **一级按钮的“激活态”成为稳定视觉合约**：
   - `All notes`、`Filter cards`、`Bulk actions`、`Toggle search`、`Subfolders` 都在对应状态生效期间维持高亮。
   - 这使 toolbar 成为当前 view 状态的主视觉指示器，而不仅是一次性触发入口。

5. **bulk strip 改为 icon-only action bar，摘要右移**：
   - `Select all`、`Clear selection`、`Move selected`、`Trash selected`、`Delete selected`、`Merge selected` 和 `Exit bulk mode` 全部收敛为 icon-only buttons。
   - 每个按钮通过 tooltip 和 `aria-label` 补足语义，而不是继续用文本 pill 占空间。
   - 动作按钮放在左侧，`{n} selected` 摘要放在右侧，形成更稳定的读写顺序：先操作，再确认数量。

6. **批量选择入口从卡片内文字按钮收敛为右上角复选框**：
   - bulk mode 下，原先的 `Select` / `Selected` 按钮被原生 checkbox 替代。
   - 复选框占用 pin 的真实右上角动作槽位，减少卡片头部的横向噪音。
   - bulk mode 下 pin 按钮临时隐藏，退出 bulk mode 后恢复。

7. **保持架构边界**：
   - 改动只影响 `Toolbar.svelte`、`CardItem.svelte`、`styles.css` 和对应测试。
   - `FolderCardView.ts`、`panel-model.ts`、bulk selection runtime ownership 均不变。
   - 搜索真值、批量选择真值与 pipeline/data-flow 契约未受影响。

## Why this option

- **统一控件语言**：`Subfolders` 和 bulk strip 都改用和一级按钮一致的 icon-first 语言，避免一个 toolbar 里混杂多种按钮体系。
- **让状态可见而不是靠记忆**：持续高亮把“当前 view 正在发生什么”直接放在一级按钮层表达，不要求用户记住自己是否仍处于 bulk/filter/search 状态。
- **释放横向空间**：Obsidian 右侧栏通常偏窄，icon-only bulk strip 比文本按钮更适合长期并存。
- **把批量选择入口收回真正的动作槽位**：右上角 checkbox 比卡片内的 `Select` 文案更直接，也更接近用户对任务选择表面的预期。
- **架构解耦**：这次改变只重塑展示与交互表面，没有把新的真值 ownership 下沉到 Svelte 组件里。

## Impact

- **`src/view/Toolbar.svelte`**: 第一行按钮顺序调整，`Subfolders` 进入一级按钮区，bulk strip 改成 icon-only buttons，持续高亮逻辑显式锁定。
- **`src/view/CardItem.svelte`**: bulk mode 选择入口改为右上角 checkbox，并在该模式下隐藏 pin 按钮。
- **`styles.css`**: toolbar selected background、bulk strip icon button、card bulk checkbox 等样式更新。
- **测试**: `src/view/Toolbar.svelte.test.ts` 与 `src/view/CardItem.svelte.test.ts` 现在锁定按钮顺序、tooltip/icon contract、checkbox 行为和 pin 隐藏行为。

## Cost and risk

- **发现性**：bulk strip 改成 icon-only 后，功能理解更依赖 tooltip 与图标直觉，因此测试和实现都必须保证 tooltip 稳定存在。
- **视觉噪音**：摘要行的动态显示与 bulk strip 的出现仍可能导致卡片流轻微垂直跳动，目前通过现有虚拟滚动与布局稳定性对冲。
- **a11y 债务仍存在**：folder menu item 与 chevron 仍保留既有非语义点击元素 warnings，这次没有扩大范围去一起重做。

## Alternatives considered

- **方案 A：继续保留 `Subfolders` 芯片与 bulk 文本按钮**：未采用，因为它们会让 toolbar 的一级入口和模式入口继续维持两套视觉语言，状态感也更弱。
- **方案 B：在 bulk mode 下同时保留 pin 与选择入口**：未采用，因为右上角动作槽位过于拥挤，也会让用户在“批量选择优先”与“单卡动作优先”之间产生冲突。
- **方案 C：把一级按钮状态继续只做弱高亮或仅靠文案提示**：未采用，因为这会让模式类状态继续缺少稳定的面板级反馈。

## Follow-up actions

- 持续关注 `Toolbar.svelte` 中的 Svelte a11y 警告（主要存在于文件夹菜单的非语义标签中）。
- 在真实宿主环境下验证 icon-only bulk strip 的可理解性、tooltip 表现，以及 bulk checkbox 在不同主题下的可见性。

## Supersedes / related records

- Supersedes: `2026-04-09-toolbar-scope-summary-and-folder-only-subfolder-toggle.md` (关于 Subfolders UI 和摘要的部分)
- Related: `2026-04-18-close-phase3-indexed-search-capability.md`

## Related files

- `src/view/Toolbar.svelte`
- `src/view/CardItem.svelte`
- `src/view/Toolbar.svelte.test.ts`
- `src/view/CardItem.svelte.test.ts`
- `styles.css`
