# Decision: 将卡片默认打开行为对齐 Obsidian Files，并收回默认打开配置

## Background

`Card Workspace` 一直把卡片视图放在右侧边栏，但“默认点击卡片应该怎么打开笔记”这件事此前混进了两套语义：

- 一套是 **默认点击规则**，也就是用户左键、Enter、Space 时插件应该怎样像宿主一样选择 leaf。
- 另一套是 **显式打开动作**，也就是用户从“更多”菜单里主动点选 `new tab`、`split right`、`new window` 等目标。

旧实现把这两层混在同一个 `defaultOpenDestination` setting 里，又把 `Open in main editor` 暴露在更多菜单中。这带来三个长期问题：

1. 默认点击不再像 Obsidian `Files`，而是被插件自己的持久化配置接管。
2. 默认点击和显式菜单动作共用一套 UI 和持久化 plumbing，导致维护时很容易一起漂移。
3. “更多”菜单里出现 `Open in main editor`，让一个本来应该属于默认点击语义的动作再次变成显式选项，增加了产品表面和测试面。

## Trigger signal

本次需求明确要求：

1. 从卡片右上角“更多”菜单移除 `Open in main editor`。
2. 删除设置页里的默认卡片打开方式，并删除对应的 settings 字段与逻辑。
3. 默认点击卡片时直接对齐主编辑区语义：先检查当前窗口 `rootSplit` 中最近使用的 root leaf；如果它可承载文件且未 pin 则复用，若它不可承载文件则回退到活动 root Markdown leaf，再回退到现有 root Markdown leaf；只有选中的目标 leaf 已 pin 或完全没有合适 root leaf 时才打开 new tab。
4. 将 `Open split right` 文案改为 `Open to the right`。
5. 将 `Open in new window` 的图标改为 `picture-in-picture-2`。

这不是纯文案调整，而是一次对“默认点击语义归谁负责”的架构收敛。

## Decision

我们采用以下正式合约：

1. **默认卡片点击不再是设置项。** 左键 / Enter / Space 的默认打开行为从 `PluginSettings` 中移除，改由 `main.ts` 直接执行宿主对齐规则。
2. **默认卡片点击对齐主编辑区 recent-root fallback 语义。** `openNoteFromCard(path)` 在 `destination` 缺省时，先检查当前窗口 `rootSplit` 内最近使用的 root leaf；如果它可承载文件且未 pin，则直接复用；如果它不可承载文件，则回退到活动 root Markdown leaf，再回退到现有 root Markdown leaf；只有最终目标 leaf 已 pin，或者根本没有合适的 root leaf 时，才改为 `getLeaf(true)` 打开一个 new tab。
3. **显式打开动作继续保留，但只存在于“更多”菜单。** 卡片更多菜单只保留 `Open in new tab`、`Open to the right`、`Open in new window`。
4. **设置层与面板状态层移除默认打开 destination。** `defaultOpenDestination` 不再出现在 `PluginSettings`、`CardWorkspaceSettingTab.ts`、`panel-model.ts`、`FolderCardPanel.svelte`、`CardItem.svelte` 中。
5. **内部 `current-area` route 仍可保留给插件内部显式调用。** 这用于像 `createNoteInCurrentFolder()` 这样的非卡片默认点击场景，但它不再是用户可配置项，也不再是卡片更多菜单项。
6. **菜单文案与图标同步收敛。** `split-right` 的用户文案改为 `Open to the right`，`new-window` 的图标改为 `picture-in-picture-2`。

## Why this option

- **把默认点击语义交还给 runtime，而不是 setting。** 这样默认点击行为才能稳定对齐 Obsidian 公开 API 能表达的主编辑区 recent-root fallback 语义，而不是被插件持久化配置分叉。
- **把“默认规则”和“显式动作”分层。** 默认点击是一条固定宿主对齐规则；更多菜单表达的是用户主动选择的例外动作。这两者不该共用一个总控 setting。
- **减少状态面和测试面。** 删除 `defaultOpenDestination` 后，settings、panel model、CardItem props、view fallback 逻辑都能一起变简单。
- **避免重复表达“主编辑区打开”。** 既然默认点击已经明确是主编辑区优先，就没必要在更多菜单里再保留 `Open in main editor`。
- **继续保留内部显式主编辑区路径。** 这样插件内部需要“明确在主编辑区打开”的调用方仍然有稳定 route，而不会逼迫默认点击语义承担所有场景。

## Impact

- `src/main.ts` 现在既负责显式 destination route，也负责默认卡片点击的 Files-like leaf 选择。
- `src/settings.ts` 不再持久化 `defaultOpenDestination`。
- `src/CardWorkspaceSettingTab.ts` 只保留 preview lines 设置。
- `src/view/panel-model.ts`、`src/view/FolderCardPanel.svelte`、`src/view/CardItem.svelte` 不再携带默认打开 destination。
- `src/view/FolderCardView.ts` 把默认点击和显式菜单动作分开处理：默认点击直接 `openNoteFromCard(path)`，菜单动作才带 `OpenDestination`。
- `src/view/card-context-actions.test.ts`、`src/view/CardItem.svelte.test.ts`、`src/view/FolderCardView.test.ts`、`src/main.test.ts`、`src/settings.test.ts` 等测试都改为锁定新的 contract。

## Cost and risk

- **默认点击语义现在更强依赖宿主 root leaf 语义。** 当前实现通过 `getMostRecentLeaf(rootSplit)`、root Markdown fallback 和 pinned 状态来逼近主编辑区语义；Obsidian 公开 API 不提供“第二近 recent root leaf”，因此这里的 recent-root 语义本身带有 API 边界。如果宿主未来改变相关 API 行为，需要先更新这一层测试假设。
- **`current-area` 仍作为内部 key 存在。** 这会让维护者看到一个不再用户暴露的 route；文档必须明确它只是内部显式调用路径。
- **真实桌面宿主手动 QA 仍然缺失。** 当前行为由仓库测试锁定，但还没有在真实 Obsidian 桌面环境里补一次交互级验证。

## Alternatives considered

- **方案 A：保留 setting，但把默认值改成 Files-like。** 未采用，因为这仍然会让默认点击行为被用户配置劫持，无法真正收回为宿主对齐 contract。
- **方案 B：删除 setting，但继续在更多菜单保留 `Open in main editor`。** 未采用，因为这会把默认点击语义又重新暴露成一个显式动作，产品表面仍然冗余。
- **方案 C：彻底删除 `current-area` 内部 route。** 未采用，因为插件内部仍存在需要显式在主编辑区打开的非默认点击调用方。
- **方案 D：默认点击一律 `getLeaf(true)` 新开 tab。** 未采用，因为这不符合 Obsidian `Files` 的默认复用语义，也违背了本次需求。

## Follow-up actions

- 在真实 Obsidian 桌面宿主里补一次 end-to-end QA，确认 pinned / unpinned most recent root leaf（含 markdown / canvas / base / excalidraw）的默认点击行为与当前测试假设一致。
- 如果未来要新增更多显式打开动作，继续保持“默认点击规则”和“显式菜单动作”分层，不要重新引入总控 setting。
- 如果未来真的要彻底移除 `current-area` 内部 route，先盘点插件内所有显式主编辑区打开调用方，再做有计划的替换。

## Supersedes / related records

- Related: `docs/decisions/2026-03-24-panel-owned-card-projection-and-interactions.md`
- Related: `docs/decisions/2026-04-23-toolbar-ui-optimization.md`
- Related: `docs/decisions/2026-04-24-support-mixed-file-kind-cards-with-markdown-only-indexing.md`

## Related files

- `src/main.ts`
- `src/main.test.ts`
- `src/settings.ts`
- `src/settings.test.ts`
- `src/CardWorkspaceSettingTab.ts`
- `src/CardWorkspaceSettingTab.test.ts`
- `src/view/FolderCardView.ts`
- `src/view/FolderCardView.test.ts`
- `src/view/panel-model.ts`
- `src/view/FolderCardPanel.svelte`
- `src/view/CardItem.svelte`
- `src/view/CardItem.svelte.test.ts`
- `src/view/card-context-actions.test.ts`
- `AGENTS.md`
- `docs/architecture.md`
