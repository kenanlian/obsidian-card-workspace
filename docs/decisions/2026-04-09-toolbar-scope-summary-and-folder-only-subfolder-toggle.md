# Decision: 统一 Toolbar 的范围提示，并把 `includeSubfolders` 限定为 folder-scope-only 控件

## Background

在 T31 完成后，响应式 card wall 已经稳定，但顶部 Toolbar 还存在一个明显的信息断层：

- `includeSubfolders` 已经进入 `settings`、load key、文件采集和 scope 判断。
- 用户却看不到这个开关当前是否生效，也无法在面板里直接切换。
- `All Notes` 作为特殊 scope 已经存在，但 Toolbar 对“当前到底是 folder scope 还是 all-notes scope”的提示仍不够清晰。

这会导致一个典型误解：用户可能以为自己在“当前文件夹 only”模式，实际却仍在递归包含子文件夹；或者反过来，把 `All Notes` 理解成某种“关闭子文件夹”的特殊状态。

## Trigger signal

T32 的目标是把 scope / filter 入口做成一个更完整的面板内闭环，同时不能破坏当前的架构边界：`FolderCardView` 继续做状态所有者，Svelte 组件继续只负责展示和事件抛出。

## Decision

我们采用以下方案：

1. `FolderCardView` 继续作为范围真值和持久化真值的唯一所有者。
2. `FolderCardView.onOpen()` 与 `pushState()` 会显式把 `includeSubfolders` 和 `isAllNotesScope` 传给 `FolderCardPanel.svelte` / `Toolbar.svelte`。
3. `Toolbar.svelte` 增加一行紧凑 summary，明确展示：
   - 当前 scope
   - tag filter 是否生效
   - 在 folder scope 下的 subfolder 状态
4. `Toolbar.svelte` 只在 **folder scope** 下显示 `includeSubfolders` 控件；在 `All Notes` 模式下隐藏，不展示一个看起来可以切换的伪 on/off 状态。
5. Toolbar 点击该控件时只抛出 `include-subfolders-change`；`FolderCardView` 负责校验 detail 是否为合法 boolean，并且只在非 `All Notes` 模式下才调用 `saveSettings()`。

## Why this option

这个方案同时满足了三个目标：

- **用户可见性**：当前范围与筛选状态终于能在面板顶部直接读出来。
- **语义正确性**：`All Notes` 不再看起来像是“子文件夹关闭”的一种变体。
- **架构稳定性**：没有把新的持久化判断塞进 Svelte 组件，也没有让 Toolbar 自己维护一个会与设置层分叉的状态副本。

## Impact

受影响的层次如下：

- `src/view/FolderCardView.ts`
  - 新增 `include-subfolders-change` 事件处理。
  - 在 `onOpen()` / `pushState()` 中传递 `includeSubfolders` 与 `isAllNotesScope`。
  - 继续保证 `FolderCardView` 是范围状态与设置持久化的唯一入口。
- `src/view/FolderCardPanel.svelte`
  - 继续只做 props 透传与事件转发。
- `src/view/Toolbar.svelte`
  - 新增紧凑 summary 和 folder-scope-only 的 subfolder toggle。
- 测试
  - 事件契约测试现在覆盖新 props 和 `include-subfolders-change` 的合法/非法路径。

## Cost and risk

- `Toolbar.svelte` 的视觉复杂度略有上升，需要后续 a11y/视觉收尾时继续审视。
- `FolderCardView` 继续承担更多 UI 真值编排职责，文件体积会继续增长。
- 如果未来 scope 类型继续增加（例如搜索结果、保存视图等），Toolbar summary 的信息密度还需要再设计，而不是无限追加文案。

## Alternatives considered

### 方案 A：在 Toolbar 里直接维护 `includeSubfolders` 本地状态

未采用。这样会把“设置真值”和“展示状态”拆开，增加状态漂移风险，也违反当前项目的边界约束。

### 方案 B：在 `All Notes` 下继续显示 toggle，但强制置灰或显示 Off

未采用。即便置灰，也会暗示这里存在一个真实的当前状态，而这会误导用户把 `All Notes` 理解成 folder scope 的某个子模式。

### 方案 C：把 scope / filter / subfolder 入口做成更大的二级面板

未采用。T32 的目标是做小而清晰的收口，不是重做 Toolbar 交互模型。

## Follow-up actions

1. 后续如实现 T33+，新的 scope 相关能力应继续复用 `FolderCardView -> pushState -> Toolbar` 这条状态链路。
2. Toolbar 的 a11y warnings 仍需在后续收尾任务中系统处理。
3. 如果未来引入搜索 scope 或保存视图，需要重新评估 summary 的信息分层，而不是简单把更多状态硬塞进同一行。

## Supersedes / related records

- Related: `2026-03-24-panel-owned-card-projection-and-interactions.md`
- Related: `2026-04-04-row-projected-responsive-card-wall.md`

## Related files

- `src/view/FolderCardView.ts`
- `src/view/FolderCardPanel.svelte`
- `src/view/Toolbar.svelte`
- `styles.css`
- `src/view/card-context-actions.test.ts`
