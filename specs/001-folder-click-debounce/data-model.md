# Data Model — 同一文件夹重复点击短路与重复渲染防抖

## 1) FolderSelectionRequest

表示一次来自文件管理器的目录点击意图。

| Field | Type | Required | Description |
|---|---|---|---|
| requestId | number | Yes | 递增意图序号，用于异步流程“最后点击生效”判定 |
| folderPath | string | Yes | 目标目录路径 |
| source | "explorer-click" \| "programmatic" | Yes | 触发来源 |
| requestedAtMs | number | Yes | 触发时间戳（毫秒） |
| forceRefresh | boolean | No (default false) | 是否绕过同目录短路 |

**Validation Rules**
- `folderPath` 不能为空，且必须能解析为 `TFolder`。
- `requestId` 必须严格递增。

## 2) FolderLoadKey

用于判定“是否同一逻辑刷新目标”。

| Field | Type | Required | Description |
|---|---|---|---|
| folderPath | string | Yes | 当前目录 |
| includeSubfolders | boolean | Yes | 是否递归子目录 |
| sortField | "ctime" \| "mtime" | Yes | 排序字段 |
| sortDirection | "asc" \| "desc" | Yes | 排序方向 |

**Derived Value**
- `key = ${folderPath}::${includeSubfolders}::${sortField}::${sortDirection}`

**Validation Rules**
- key 完全相同且 `forceRefresh=false` 时必须短路为 `noop`。

## 3) FolderLoadSnapshot

视图层稳定态快照（一次成功加载后）。

| Field | Type | Required | Description |
|---|---|---|---|
| folderPath | string \| null | Yes | 当前展示目录 |
| loadKey | string \| null | Yes | 最近一次成功应用的加载键 |
| generation | number | Yes | 异步失效保护代号 |
| cards | NoteCardRecord[] | Yes | 当前卡片数据 |
| selectedPath | string \| null | Yes | 当前选中文件 |
| loading | boolean | Yes | 当前是否在刷新中 |

**Validation Rules**
- `generation` 仅在真实刷新启动时递增；`noop` 不得递增。
- `loading=true` 时若同 key 新请求且非强制，必须复用 in-flight。

## 4) RefreshQueueState

刷新并发控制状态。

| Field | Type | Required | Description |
|---|---|---|---|
| inFlightKey | string \| null | Yes | 当前执行中的刷新键 |
| inFlight | boolean | Yes | 是否有刷新在执行 |
| queuedRequest | FolderSelectionRequest \| null | Yes | 排队中的最新请求（latest-wins） |
| refreshQueued | boolean | Yes | vault 事件是否触发了待处理刷新 |

**Validation Rules**
- 任一时刻只允许 1 个 in-flight 刷新任务。
- in-flight 期间收到多个不同 key 请求时，仅保留最后一个。

## 5) VaultMutationEvent

来自 Obsidian vault 的本地变更事件。

| Field | Type | Required | Description |
|---|---|---|---|
| eventType | "create" \| "modify" \| "delete" \| "rename" | Yes | 事件类型 |
| path | string | Yes | 变更后路径（delete 为删除目标） |
| oldPath | string \| null | No | rename 前路径 |
| isFolder | boolean | Yes | 是否目录 |
| isMarkdown | boolean | Yes | 是否 Markdown 文件 |

**Validation Rules**
- 仅在“当前目录范围内”且文件类型相关（Markdown 或目录结构变化）时触发刷新排队。
- `rename` 事件若命中当前目录重命名，需同步更新 `selectedFolderPath`。

## Relationships

- `FolderSelectionRequest` 生成/更新 `RefreshQueueState`。
- `FolderLoadKey` 决定 `FolderLoadSnapshot` 是否进入 `noop` 或 `reload`。
- `VaultMutationEvent` 仅通过过滤函数影响 `RefreshQueueState.refreshQueued`。
- `FolderLoadSnapshot.cards` 与 `selectedPath` 共同决定 UI 稳定展示。

## State Transitions

### Selection/Refresh State Machine

1. `Idle` -> `Loading`
   - 条件：新 key 请求，或同 key 且 `forceRefresh=true`。
2. `Loading` -> `Hydrating`
   - 条件：文件列表构建完成并推送基础卡片。
3. `Hydrating` -> `Ready`
   - 条件：视口请求范围内 hydration 完成。
4. `Loading/Hydrating` -> `Loading`（queued latest）
   - 条件：in-flight 期间收到不同 key 新请求。
5. `Ready` -> `Ready`（noop）
   - 条件：同 key 且 `forceRefresh=false`。
6. Any -> `Idle`
   - 条件：视图关闭或插件卸载并清理队列。
