# Architecture

本文件是当前架构的**唯一详细说明**。`AGENTS.md` 只保留开发约束、命令、测试入口和少量必须记住的架构速记；模块职责、运行链路、状态归属和架构不变量都以这里为准。

可枚举的实现细节（设置键、面板字段、模块方法、文件行数）由 `src/architecture.test.ts` 与 TypeScript 类型承担，不在本文复述。

配套模式文档：

- `docs/state-and-runtime-patterns.md`：运行时状态归属、`AsyncEpoch` / 分级更新、controller 所有权与 `dispose`
- `docs/data-and-persistence-patterns.md`：三层持久化、迁移、写入串行化与搜索契约
- `docs/ui-patterns.md`：host/Svelte UI 边界、分组发布、虚拟化、hydration 与 modal 路由

## 架构目标

`Card Workspace` 是一个 Obsidian 桌面插件。它把当前 `CardScope`（文件夹或卡片盒）映射成左侧 sidebar 中的卡片流，让用户在当前 vault 上下文中浏览、筛选、搜索、置顶和打开文件。

当前架构围绕以下目标收敛：

- **本地优先。** 文件读取、设置持久化、索引存储和搜索执行都发生在本地运行时。
- **插件外壳与装配分离。** `main.ts` 只持有插件 lifecycle 与装配：`SettingsStore`、`SearchCoordinator`、`EditorDropController`、`VaultEventBus`。它不持有 per-view query，也不直接计算 `visibleCards`。
- **视图是生命周期与装配点。** `FolderCardView.ts` 是 `ItemView` 生命周期加上 `createViewModules` 装配；按域的工作落在 `src/view/controllers/`、`src/view/actions/`、`src/view/menus/`。
- **运行时作用域是显式联合类型。** 真值是视图持有的 `CardScope`。设置里的 `lastFolderPath` / `activeBoxId` 只是会话恢复用的持久化投影。
- **投影链路单一。** `pipeline.ts` 是唯一的 visible-card projection。文件夹作用域固定顺序为 `tag filter -> search filter -> pin reorder`；盒子作用域在加载时已解析成员集，只跑 `search -> pin`。
- **更新按强度分级。** 设置变化走 `patch < reproject < rehydrate < reload`，而不是每次全量重载。
- **搜索是 indexed-only。** 搜索以 `IndexedDB` + `MiniSearch` 为基础，不再支持非索引 fallback；索引未就绪时，非空查询被明确阻塞。
- **文件类型是显式领域边界。** 当前正式卡片文件类型为 `markdown`、`base`、`canvas`、`excalidraw`；它们共享卡片流，但不共享完全对称的预览与搜索能力。

## 系统总览

```text
Obsidian events
  ├─ workspace actions
  └─ vault create/modify/delete/rename
          ↓
src/main.ts                          插件外壳与装配
  ├─ SettingsStore                   三层持久化 + 扁平读取视图
  ├─ SearchCoordinator               搜索服务生命周期
  ├─ EditorDropController            卡片拖入编辑器
  └─ VaultEventBus                   有序扇出（见下方 vault 链路）
          ↓
src/view/FolderCardView.ts           ItemView 生命周期 + createViewModules
  ├─ controllers/                    scope / projection / search / hydration / bulk / nav
  ├─ actions/                        file / folder / box / tag / favorite / merge
  ├─ menus/                          card + nav context menus
  └─ modals/                         FormModal 子类；由 host / actions 路由打开
          ↓
src/view/pipeline.ts
  └─ folder: tag filter -> search filter -> pin reorder
     box:    search filter -> pin reorder
          ↓
src/view/panel-model.ts
  └─ 分组状态桥；一次 batch 只通知一次
          ↓
Svelte UI
  FolderCardPanel.svelte
    ├─ NavigationPane.svelte + TreeSection.svelte
    ├─ Toolbar.svelte
    └─ CardItem.svelte

src/search/IndexStore.ts
  └─ IndexedDB persisted index snapshots
          ↓
src/search/SearchIndexManager.ts
  └─ restore / build / mutation / health snapshots
          ↓
src/search/IndexedSearchService.ts
  └─ candidate-bounded query contract
```

Vault 事件经 `VaultEventBus` 的同步顺序是：`lastFolderPath` reconcile → 盒子 reconcile → 收藏 reconcile → tag prune → 搜索（独立隔离）→ 各视图。视图在 `onOpen` 时自行订阅，并对本实例的 reload 去抖。

## 运行时依赖

产品运行时依赖只有以下几层：

- `obsidian` API：插件生命周期、workspace、Vault、MetadataCache、FileManager、事件注册。
- Svelte 5 runtime：面板渲染与交互 surface。
- `IndexedDB`：`IndexStore` 持久化索引与元数据。
- `MiniSearch`：内存索引与查询执行。

当前没有产品运行时网络依赖，也没有外部在线服务依赖。发布脚本、GitHub Actions 和 release metadata 校验属于仓库基础设施，不属于产品运行时架构。

## 模块职责边界

| 模块 | 负责什么 | 不负责什么 |
| :--- | :--- | :--- |
| `src/main.ts` | 插件 lifecycle、命令、view 注册与激活、把 `SettingsStore` / `SearchCoordinator` / `EditorDropController` / `VaultEventBus` 装配到一起、默认卡片打开语义 | 持有 per-view query、直接计算 `visibleCards`、内联搜索状态机或拖拽实现 |
| `src/services/SettingsStore.ts` | 内存快照、三层写入、串行落盘、`getFlat()` 扁平读取视图 | 解释更新意图该触发哪一档视图动作（那是 `update-intent.ts` + 视图） |
| `src/services/SearchCoordinator.ts` | 搜索服务 bootstrap / restore / rebuild、把 vault 事件转给索引（隔离失败） | 持有 view query、拥有 UI 状态 |
| `src/services/EditorDropController.ts` | 卡片到编辑器的拖入插入 | 卡片流投影 |
| `src/services/VaultEventBus.ts` | 按注册顺序发布 vault 事件，隔离单个 listener 抛错 | 决定某个域如何 reconcile |
| `src/view/FolderCardView.ts` | `ItemView` 开关、`createViewModules` 装配、按意图把分组状态推给 panel-model、订阅 vault 事件 | 把业务逻辑重新内联进自身；持有插件级 lifecycle；直接操作 IndexedDB |
| `src/view/view-modules.ts` | 为单个视图交叉接线 controllers / actions / menus | 成为第二份状态真值 |
| `src/view/controllers/` | 按域持有运行时：scope 加载、投影、搜索、hydration、bulk、导航布局 | 持有 `FolderCardView` 引用；把 `ViewContext` 反向转型回 view |
| `src/view/actions/` | 用户命令：文件/文件夹/盒子/标签/收藏/合并 | 拥有插件级设置真值或搜索索引 |
| `src/view/menus/` | 卡片与导航上下文菜单的构建 | 持有 canonical 卡片数组 |
| `src/view/modals/` | 独立 modal 实现（共享 `FormModal`）；由 host / actions 路由打开 | 成为 Svelte 组件的本地真值 |
| `src/view/scope.ts` | `CardScope` 联合类型与规范化 / 校验 | 持久化会话投影 |
| `src/view/pipeline.ts` | 唯一 visible-card projection；按 scope 选择步骤 | 决定插件生命周期、直接读写 Vault、绕开前序过滤恢复卡片 |
| `src/view/panel-model.ts` | 宿主到 Svelte 的分组状态桥；组整体替换、batch 单次通知 | 保存长期真值、持有默认打开语义、持有搜索索引真值 |
| `src/view/file-kind.ts` | `markdown` / `base` / `canvas` / `excalidraw` 解析、图标、占位摘要 contract | 决定 view 状态、实现索引或 UI 生命周期 |
| Svelte UI（`FolderCardPanel.svelte` / `NavigationPane.svelte` / `TreeSection.svelte` / `Toolbar.svelte` / `CardItem.svelte`） | 展示 cards 与导航树、接收用户交互、把 intent 回传宿主 | 持有 plugin lifecycle、拥有搜索状态真值、拥有索引状态 |
| 卡片盒域（`BoxActions` + `card-boxes.ts` + `BoxReconciler`） | 盒子定义、成员解析、进入/离开盒子作用域；userData 持久化 | 用设置里的 `activeBoxId` 推断运行时作用域 |
| 收藏域（`FavoriteActions` + `favorites.ts` + `FavoriteReconciler`） | 收藏条目、排序、vault 变更后的路径/标签收敛；userData 持久化 | 拥有卡片投影 |
| 导航布局（`NavLayoutController`） | 文件夹/标签/盒子树、收藏区、分栏宽度与折叠；workspace 持久化投影 | 拥有卡片候选集 |
| `src/i18n/` | 按域拆分的 UI 文案；调用方仍 `import` `../i18n` | 依赖 view / services / settings |
| `src/search/IndexStore.ts` | IndexedDB 持久化、恢复、写入、清理 | 执行查询、决定 UI 状态 |
| `src/search/SearchIndexManager.ts` | restore、full build、mutation apply、health snapshots、unsafe rename 保护 | 持有 view query、直接产出 UI |
| `src/search/IndexedSearchService.ts` | 把 manager 快照翻译为 query contract、限制 candidate paths、返回 indexed ordering 或 blocked state | 拥有 view state、伪造非 Markdown 全文索引 |

## 作用域模型：`CardScope`

运行时唯一真相是视图 `ViewStateStore` 上的 `CardScope`：

```ts
type CardScope =
  | { kind: "folder"; path: string; includeSubfolders: boolean }
  | { kind: "box"; boxId: string };
```

约束：

- Vault root 是 folder scope 的边界值：`path === ""`。它不是特殊模式，也不是缺失值。
- 不存在 All Notes 作用域，也不存在“未选择文件夹”状态。
- 设置中的 `lastFolderPath` / `activeBoxId` 是会话恢复用的持久化投影，在作用域**已经加载完成之后**写入。任何加载、投影、菜单可用性判断都不得再读这两项来推断当前作用域。
- 启动只恢复 **folder** scope，并强制内存中的 `activeBoxId = null`（不为此单独落盘）。盒子不会在启动时被恢复。
- 文件夹作用域写入投影 `{ lastFolderPath, activeBoxId: null }`；盒子作用域只写 `{ activeBoxId }`，不动 `lastFolderPath`。维护性重载（同一 scope 的 refresh / vault reload）不写投影，以免多视图互相覆盖。

## 四档更新意图

强度由弱到强：`patch < reproject < rehydrate < reload`。多键同时变化取 `maxIntent`；无实质差异返回 `null`，视图不做任何动作。强档包含弱档的可见效果。

| 档位 | 语义 | 何时发生 |
| :--- | :--- | :--- |
| `reload` | 候选文件集合本身变了，必须重新收集 | `includeSubfolders`；活动盒子的成员签名变化 |
| `reproject` | 同一批卡片，只变顺序或可见性 | `filter.tags`、`pinnedPaths`、`sort`；活动盒子的 `sort` / `pinnedPaths` |
| `rehydrate` | 预览 HTML 必须按新的行数预算重建 | 仅 `previewLines` |
| `patch` | 纯呈现 / 导航 chrome，不重收文件、不重跑预览 | 其余变更，**包括** `lastFolderPath` 与 `activeBoxId`（它们是已经完成的 scope 加载的持久化投影；判成 `reload` 会把同一个作用域再加载一遍） |

设置意图（这四档）与面板发布范围（替换哪些 group）是两个轴。hydration 完成、搜索快照到达这类运行时事件没有对应的设置意图，走 `publishGroups`。

## 核心运行流程

### 1. CardScope 到 panel

1. `ScopeController` 按当前 `CardScope` 收集受支持文件（文件夹走 vault 收集，盒子走盒子成员解析），并通过 `file-kind.ts` 解析 `fileKind`。
2. 视图构建 `baseCards`，对 Markdown 准备轻量 preview 路径，对非 Markdown 使用稳定占位摘要。
3. `ProjectionController` 组装 `PipelineContext`，经 `pipeline.ts` 按 scope 选择步骤，计算 `visibleCards`。
4. `FolderCardView` 按组把快照交给 `panel-model.ts`；Svelte UI 只渲染与回传 intent。

### 2. query 到搜索投影

1. UI 把 query intent 回传给宿主，由 `SearchController` 持有 runtime-only `searchQuery`。
2. `SearchController` 向 `IndexedSearchService` 发起带 candidate paths 的查询。
3. 服务在 `indexed-ready` 时返回当前候选范围内的 `orderedPaths`；非 ready 时返回 blocked execution state。
4. `pipeline.ts` 基于搜索输入做统一投影；文件夹仍保证 `tag -> search -> pin`，盒子保证 `search -> pin`。

### 3. vault mutation 到 refresh / index update

1. Obsidian vault 事件进入 `main.ts`，再交给 `VaultEventBus`。
2. Bus 按固定顺序通知：持久化 `lastFolderPath` reconcile、盒子、收藏、tag prune、搜索（`try/catch` 隔离）、然后是已订阅的视图。
3. 每个 `FolderCardView` 自行判断当前 scope 是否需要 refresh，并对 reload 去抖。
4. `SearchIndexManager` 尝试增量更新；对无法安全处理的 rename 等情况发布 `rebuild-required`。

默认打开语义、hover preview、删除偏好和上下文菜单都属于宿主集成点：它们影响模块边界，但不改变上述主运行链路。

## 状态与数据归属

### 持久化设置（三层，扁平读取）

磁盘格式是带 `schemaVersion` 的三层 JSON：`preferences` / `workspace` / `userData`。运行时读取仍走扁平的 `PluginSettings`（`SettingsStore.getFlat()`）。具体字段以类型定义为准，本文不枚举键。

| 层 | 归属直觉 | 为什么单独一层 |
| :--- | :--- | :--- |
| `preferences` | 跨会话的显示与行为默认值（排序默认、预览行数、打开方式等） | 与“此刻在看哪个文件夹/盒子”无关 |
| `workspace` | 会话/布局恢复：folder/box 投影、导航 chrome、当前标签筛选 | 它们是运行时 UI 的投影，不是用户创作的数据 |
| `userData` | 用户创作的集合：盒子、收藏、置顶路径 | 随 vault 变更需要独立 reconcile |

`searchQuery`、卡片数组、选择/bulk、搜索健康、hydration 进度都不进入设置。

### 持久化索引：`IndexStore`

这层只承载索引恢复与持久化（per-vault metadata、序列化 payload、schema/version 门闩），不承载 view query。

### 视图运行时

- `ViewStateStore`：当前 `CardScope`、`baseCards` / `visibleCards`、选中路径
- controllers：bulk、hydration 队列、runtime search query / status、导航树
- `ViewEpochs`：跨 controller 共享的防陈旧时钟（见 `docs/state-and-runtime-patterns.md`）

两个关键边界：

- `searchQuery` 不进入 settings。
- UI 不拥有默认打开语义，也不拥有搜索真值。

## 架构不变量

- `main.ts` 是插件外壳与装配点；搜索生命周期与编辑器拖拽不内联在外壳里。
- `FolderCardView.ts` 是 `ItemView` 生命周期与模块装配点；按域的真值在 controllers / actions。
- 运行时作用域是 `CardScope`；vault root 是 `path === ""` 的 folder scope。
- `pipeline.ts` 是唯一 visible-card projection；盒子跳过 browse tag filter。
- 搜索是 indexed-only；索引未就绪时，非空查询必须阻塞显示。
- Markdown 继续参与全文索引；`base`、`canvas`、`excalidraw` 目前只参与标题级匹配。
- pin 只重排通过前序过滤后的卡片，不绕过 filter 或 search constraint。
- 启动 preview 预热必须针对 pipeline-projected visible prefix，而不是原始 `baseCards` 前缀。
- 当前启动预热预算是前 6 张可见候选、最多等待 120ms；超时后由后台 hydration 补齐。
- Svelte 组件只负责 presentation 和 intent surface，不持有插件级状态或索引状态。
- 面板 group 整体替换；一次 batch 只通知一次；未发布的 group 保持同一对象引用。
