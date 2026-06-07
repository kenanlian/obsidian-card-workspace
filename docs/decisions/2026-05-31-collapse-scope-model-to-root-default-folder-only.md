# Decision: 收敛 scope 模型为 root-default 的 folder-only 语义

## Background

当前产品已经移除了显式 `All Notes` 按钮，用户运行期只会在 folder picker 中切换具体文件夹或 `根目录 /`。但实现层仍同时保留了：

- `All Notes` 特殊 scope
- 启动专用的“未选择文件夹”空态
- vault root 使用空字符串 `""` 的 folder path

这三套语义叠加后，导致 root path `""` 被多处 falsy 判断误当成“未选择文件夹”，进而让根目录 scope 下的 refresh / vault mutation 路径失效。

## Trigger signal

用户确认：

- UI 已没有 `All Notes` 按钮
- “未选择文件夹”只在首次加载时短暂存在，之后无法回退
- 更合理的产品语义应是启动即进入可浏览范围，而不是停留在空态

## Decision

我们把 scope 模型收敛为 **folder-only**：

1. 运行期不再保留 `All Notes` 特殊 scope。
2. 运行期不再保留“未选择文件夹”状态。
3. 插件启动与会话恢复默认进入 `folder(root)`。
4. vault root 的唯一正式持久化表示为 `lastFolderPath = ""`。
5. `includeSubfolders=true` 时，`folder(root)` 成为默认的全库浏览态；但它仍然是 folder scope，而不是新的别名模式。
6. 旧数据里若仍保存 `lastViewMode = "all-notes"`，归一化时迁移为 `lastFolderPath = ""`。

## Why this option

- **状态更少**：去掉了只在启动阶段短暂存在、却不断污染判断分支的空态。
- **语义更稳**：root 是 folder scope 的边界值，不再和“未选择”或 `All Notes` 混用。
- **运行更可靠**：root path `""` 不再被 `!folderPath` / `!selectedFolderPath` 误伤，vault modify 刷新链路恢复一致。
- **产品更直接**：打开插件就看到内容，而不是先面对一个空的未选择状态。

## Impact

- `src/main.ts`
  - 删除 `selectAllNotes()` 运行时分支。
  - `selectedFolderPath` 默认收敛为 root path `""`。
  - 会话恢复统一按 `lastFolderPath` 恢复，默认值即 root。
- `src/view/FolderCardView.ts`
  - 删除 all-notes 特判。
  - root path `""` 作为合法 folder scope 参与 `refresh()`、`shouldRefreshForVaultEvent()`、`applyIncrementalMutation()`、`isPathInScope()`、`collectSupportedFiles()`。
- `src/settings.ts`
  - 删除 `lastViewMode` 持久化字段。
  - 保留对旧 `lastViewMode = "all-notes"` 数据的兼容迁移。
- `src/view/panel-model.ts` / `FolderCardPanel.svelte` / `Toolbar.svelte`
  - 不再桥接 `isAllNotesScope`。
  - `includeSubfolders` 在 root scope 下继续可用。

## Cost and risk

- 旧会话如果依赖 `lastViewMode = "all-notes"`，现在会被自动映射为 root recursive scope；结果集等价，但显示语义变为 `根目录 /`。
- 历史测试、文档与认知里提到的 `All Notes` 术语需要同步收口，避免未来再次引入双轨状态。

## Alternatives considered

- **保留“未选择文件夹”空态**：未采用，因为它没有稳定业务价值，却会持续和 root path `""` 冲突。
- **保留 `All Notes` 作为隐藏运行态**：未采用，因为 UI 已无入口，只会继续制造结果等价但身份不同的双轨语义。
- **把 root recursive 自动折叠回 `All Notes`**：未采用，因为这会把结果等价错误地提升为状态等价。

## Related files

- `src/main.ts`
- `src/settings.ts`
- `src/view/FolderCardView.ts`
- `src/view/panel-model.ts`
- `src/view/FolderCardPanel.svelte`
- `src/view/Toolbar.svelte`
