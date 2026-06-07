# Decision: 收缩卡片右键菜单并统一删除偏好语义

## Background

卡片右键菜单在最近几轮迭代后承载了越来越多的低频动作，包括 path copy 子菜单、系统默认应用打开、系统文件管理器定位和 file stats 查看。这些动作一方面把主交互面做得过重，另一方面其中部分实现已经出现 bug，继续保留会让 `FolderCardView.ts` 背负更多宿主外壳细节和测试负担。

与此同时，删除语义已经出现分叉：批量删除明确遵循 Obsidian `Files & Links` 删除偏好，而单卡右键 `Delete` 仍走独立执行路径。即使两者最终都可能落到 `trashFile(...)`，这种分叉也会让未来维护者误以为单删和批删可以独立演化。

## Trigger signal

用户明确要求移除以下卡片右键菜单功能：

- `Copy path` 及其子菜单
- `Open in default app`
- `Open in system explorer`
- `Check file stats`

并要求单卡右键 `Delete` 与批量删除一样，直接按照用户在 `Files and links` 中的设置执行删除。

## Decision

我们采用了两条收敛策略：

1. **收缩卡片右键菜单表面**
   - 从卡片菜单中移除 `Copy path` 子菜单、系统壳打开动作和 `Check file stats`。
   - 保留的动作收敛为：三个显式打开动作、`Make a copy`、`Move file to...`、`Copy note content`（仅 Markdown）、`Rename...`、`Delete`。
   - 菜单分隔符同步简化，避免留下“空分组”或视觉上无意义的断裂。

2. **统一删除执行语义**
   - 单卡右键 `Delete` 继续保留单卡确认入口，但确认后的实际执行改为复用与批量删除同类的 preference-aware helper。
   - 最终删除仍由 Obsidian `app.fileManager.trashFile(...)` 决定，因此系统回收站、Obsidian `.trash` 或永久删除都以宿主 `Files & Links` 设置为准。

## Why this option

- **降低主交互噪音**：卡片右键菜单应该优先承载高频文件操作，而不是把诊断和宿主外壳动作堆进来。
- **减少宿主耦合面**：移除 system explorer / default app / path copy 后，`FolderCardView.ts` 不再需要继续维护一组和卡片流主职责弱相关的系统壳逻辑。
- **统一用户心智**：用户不需要理解“为什么单删和批删长得像删除，但底层语义不同”。
- **复用已有真相来源**：批量删除已经锁定了以 Obsidian 删除偏好为准的 contract，单删对齐到这条路径是最低风险方案。

## Impact

- **`src/view/FolderCardView.ts`**：右键菜单动作集缩小，相关分发分支与死代码被移除；单删改为委托 preference-aware delete helper。
- **`src/view/note-ops.ts`**：继续作为删除偏好 helper 的真相来源，未新增第二套删除语义。
- **`src/view/card-context-actions.test.ts`**：菜单契约和删除契约改为锁定新的最小表面与统一删除路径。
- **用户可见行为**：卡片右键菜单更短，单卡删除与批量删除都遵循 Obsidian 宿主删除设置。

## Cost and risk

- **低频动作消失**：如果有人依赖 path copy 或系统壳打开，这些能力现在需要通过 Obsidian 其他表面完成，而不再从卡片菜单直接进入。
- **测试基线变化**：菜单结构测试必须同步收缩，否则会继续把已删除功能视为正式 contract。
- **未来恢复门槛提高**：如果之后想把某个系统层动作放回卡片菜单，需要重新证明其频率和价值，而不是因为“以前有”就恢复。

## Alternatives considered

- **只隐藏菜单入口，保留底层路由和 helper**：未采用，因为这会留下死代码和误导性的维护面。
- **让单删也复用批量删除 modal**：未采用，因为用户要求的是删除语义一致，而不是单卡 UI 完全复制批量交互。
- **继续保留系统层动作，仅修 bug**：未采用，因为这会延续一个已经偏重的菜单面，而不是回到更清晰的主工作流。

## Follow-up actions

- 在真实宿主环境中确认单卡 `Delete`、批量删除和 `Files & Links` 设置三者的联动体验仍符合预期。
- 如果未来再次讨论卡片菜单扩容，先评估动作是否属于高频卡片工作流，再决定是否恢复。

## Supersedes / related records

- Related: `2026-04-23-toolbar-ui-optimization.md`
- Related: `2026-04-25-constrain-card-note-opens-to-main-editor-surfaces.md`

## Related files

- `src/view/FolderCardView.ts`
- `src/view/note-ops.ts`
- `src/view/card-context-actions.test.ts`
- `docs/START_HERE.md`
- `docs/architecture.md`
