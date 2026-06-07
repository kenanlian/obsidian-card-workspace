# Decision: 在 folder scope 菜单中显式暴露 vault root 选项

## Background

当前 Toolbar 同时提供 `All notes` 和 `Select folder` 两个范围入口，但 `Select folder` 实际只能进入根目录下的具体子文件夹。结果是：

- 用户无法显式选择“vault 根目录本身”这个 folder scope。
- `All notes` 会直接显示全库结果，缺少“只看根目录直系文件”的浏览模式。
- 从数据语义看，`vault root + includeSubfolders=false` 与 `vault root + includeSubfolders=true` 都已经是现有模型能表达的状态，只是 UI 没有把它暴露出来。

## Trigger signal

用户明确要求补齐“显示根目录中的笔记”这一缺失选项，并要求推荐交互方案后直接实施。

## Decision

我们采用以下交互合约：

1. `All notes` 继续保留为独立一级按钮，表达“直接看全库”。
2. `Select folder` 弹出菜单顶部新增一个显式 root 选项，文案为 `Root /`（中文环境下为 `根目录 /`）。
3. 该 root 选项是一个**不可展开的顶层菜单项**，带独立 house icon。
4. 其他一级文件夹继续保持 `depth=0`；不会因为 root 项出现而整体右缩进一层。
5. root 仍然属于 folder scope，因此继续受 `includeSubfolders` 控制：
   - 关闭时仅显示 vault 根目录直系文件
   - 开启时结果可与 `All notes` 等价
6. 即便结果与 `All notes` 等价，UI 仍保持 folder scope 语义，不自动切换或高亮 `All notes`。

## Why this option

- **语义一致**：root 本质上是 folder scope 的一个边界值，不是第三套新模式。
- **交互稳定**：保留 `All notes` 快捷入口，同时补齐缺失的 root-only 浏览路径。
- **视觉克制**：root 是可选项，不是假树根容器，因此不会制造一层额外缩进噪音。
- **实现贴合现有架构**：`FolderCardView`、`collectSupportedFiles()` 与现有 `includeSubfolders` 模型本来就能表达这一状态。

## Impact

- `src/view/FolderCardView.ts`：folder tree 现在会把 vault root 作为首个可选顶层节点输出。
- `src/view/Toolbar.svelte`：folder menu 为 root 节点渲染专门 label 与 icon，并在按钮文字上显式展示 root scope。
- `styles.css`：新增 root 节点 icon 的轻量样式。
- 测试：`Toolbar.svelte.test.ts` 与 `FolderCardView.test.ts` 锁定 root 节点的展示、缩进和 tree 输出契约。

## Cost and risk

- root 选中且递归开启时，结果与 `All notes` 等价；因此必须保持状态表达清晰，避免 UI 自动折叠成 `All notes`。
- 新 icon 依赖 Obsidian 当前 Lucide 集合；测试已锁定 icon name contract。

## Alternatives considered

- **把 root 合并进 `All notes` 二级状态**：未采用，因为会把“全库 scope”和“根目录 folder scope”混为一谈。
- **把 root 作为真正树根容器并让所有一级文件夹整体缩进**：未采用，因为会增加一层没有信息增量的假层级。
- **新增独立 `Root` 一级按钮**：未采用，因为 root 仍是 folder scope，不值得升格为并列一级模式。

## Related files

- `src/view/FolderCardView.ts`
- `src/view/Toolbar.svelte`
- `src/view/Toolbar.svelte.test.ts`
- `src/view/FolderCardView.test.ts`
- `styles.css`