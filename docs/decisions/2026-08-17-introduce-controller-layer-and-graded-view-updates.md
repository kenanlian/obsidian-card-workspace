# Decision: 引入控制器层与分级视图更新

## Background

本轮架构重构把两个过载的宿主对象拆开：`main.ts` 收缩为插件外壳与装配，`FolderCardView.ts` 收缩为 `ItemView` 生命周期与 `createViewModules` 装配。按域的运行时落到 `src/view/controllers/`、`src/view/actions/`、`src/view/menus/`，插件级能力落到 `src/services/`。

拆分本身不改变用户可见行为。真正改动可见路径的是另外三件负载决定：设置变化不再一律全量重载；运行时作用域不再用重载的文件夹路径字符串（含 `__box__:` 编码）表达；持久化分成 preferences / workspace / userData 三层，同时保留扁平读取视图。

本 ADR **部分取代** `docs/decisions/2026-05-31-collapse-scope-model-to-root-default-folder-only.md` 的 folder-only 表述：All Notes 与“未选择文件夹”空态的收敛仍然成立；vault root 仍是 `lastFolderPath = ""` 的 folder-scope 边界值。运行时作用域现在是 **folder 或 box**，由 `CardScope` 联合类型表达，而不是“只有文件夹”。

## Trigger signal

- 任何设置写入都触发视图全量重载，导致改排序、置顶、折叠导航分区或拖动导航栏宽度时丢掉滚动位置和已加载 preview。
- 盒子作用域靠 `__box__:` 前缀塞进 folder-path 字符串，和 vault root 的空字符串、会话恢复投影缠在一起，无法在类型上区分“当前在看什么”。
- 扁平设置文档把偏好、会话布局和用户创作集合写在同一层，migrate / reconcile / 写入节流无法按层给出不同策略。
- 控制器拆分完成后，如果文档继续按 god-object 叙事，后续改动会把逻辑重新写回 `FolderCardView`。

## Decision

1. **分级更新意图取代单一全量重载。** 设置差异解析为 `patch < reproject < rehydrate < reload`。多键变化取 `maxIntent`；无实质差异返回 `null`。`reload` 只用于候选文件集合变化；`lastFolderPath` 与 `activeBoxId` 归 `patch`，因为它们是作用域加载完成之后才写入的会话投影。
2. **`CardScope` 取代重载的 folder-path 字符串 / `__box__:` 编码。** 运行时真值是视图 store 上的 `{ kind: "folder"; path; includeSubfolders } | { kind: "box"; boxId }`。设置里的 `lastFolderPath` / `activeBoxId` 只用于会话恢复。启动只恢复 folder scope，并强制 `activeBoxId = null`。
3. **持久化三层化，读取仍走扁平 `PluginSettings`。** 磁盘为带 `schemaVersion` 的 `{ preferences, workspace, userData }`。`SettingsStore.getFlat()` 是兼容读取视图。`migrateSettings` 接受 v2 / v1 扁平 / v0 `lastViewMode: "all-notes"`。首次 v2 写盘发生在下一次设置写入，而不是启动时。

配套但非本 ADR 三条主决定的落地：`PanelModelState` 按组整体替换且一次 batch 只通知一次；vault 事件经 `VaultEventBus` 按固定顺序扇出；持有定时器或在飞工作的 controller 实现 `dispose()`，由 `cleanupLifecycle` 按注册逆序调用。

## Why this option

- **分级更新把“必须重收文件”和“只改呈现”分开。** 置顶、标签筛选、排序、导航折叠与宽度不再打断 hydration 与滚动；候选集变化仍然走 `reload`。把 `lastFolderPath` / `activeBoxId` 放在 `patch` 避免同一 scope 被加载两次，也避免多视图互相覆盖会话投影。
- **显式 `CardScope` 去掉字符串重载。** 加载、投影、菜单可用性都读同一个联合类型，不再用前缀猜测“这是不是盒子”。folder-only ADR 要消灭的 All Notes / 未选择空态仍然没有回来；盒子是第三种产品对象，不是那两种被删掉的模式。
- **三层持久化让写入策略可以对齐数据寿命。** 偏好立即写、workspace 可去抖、userData 走 vault reconcile；调用方仍然只看扁平 `PluginSettings`，不必在每个读取点分支层结构。`getFlat()` 把迁移成本留在 store 边界上。

## Impact

- 设置写入的可见行为变为四档：只有 `includeSubfolders` 和活动盒子成员签名变化会重收文件；`previewLines` 只重建 preview HTML；其余 chrome 与会话投影只 `patch`。
- 运行时不得再从设置推断当前作用域。盒子启动不恢复，始终先回到 folder browse。
- 磁盘文档在下一次写入后变为 v2 三层 JSON；旧 v1 / v0 数据仍可被 `migrateSettings` 读入。
- `FolderCardView` 与 `main.ts` 不再是业务真值所在；后续功能默认加在 controller / action / service 上。
- 文档不再复述键清单与行数；边界由 `architecture.test.ts` 与类型强制。

## Cost and risk

- 四档意图表必须与 `PluginSettings` 的每个键保持同步；漏标一个键会静默走错档位。
- 三层磁盘格式与扁平读取并存，错误地在调用方缓存层结构或跳过 `getFlat()` 会造成双真值。
- 启动不恢复盒子是既有产品选择：用户上次停在盒子里，重开插件会先看到 folder browse。
- controller 若重新持有 `FolderCardView` 引用，拆分边界会立刻塌回 god object。

## Alternatives considered

- **继续用单一 `refresh()` 消化所有设置变化。** 未采用。实现简单，但会把纯呈现变化做成全量重载，这正是本轮要去掉的可见卡顿。
- **给盒子单独的 view type 或持久化 scope 枚举，而不是 `CardScope` 联合类型。** 未采用。卡片流、pipeline 和 panel 仍然是同一条 UI；需要的是作用域身份，不是第二套视图。
- **读取也改成三层 API，废弃扁平 `PluginSettings`。** 未采用。几乎每个调用点都要改，且与既有测试、设置页、i18n 读取缠在一起。层分裂是持久化策略，不是第二套领域模型。
- **启动时立即把内存中的 v2 文档写回磁盘。** 未采用。只读迁移不应产生写入；首次 v2 落盘跟下一次真实设置变化走。

## Related files

- `src/view/update-intent.ts`
- `src/view/scope.ts`
- `src/view/view-modules.ts`
- `src/view/FolderCardView.ts`
- `src/services/SettingsStore.ts`
- `src/settings.ts`
- `src/main.ts`
- `docs/architecture.md`
- `docs/decisions/2026-05-31-collapse-scope-model-to-root-default-folder-only.md`
