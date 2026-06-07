# Architecture

本文件是当前架构的**唯一详细说明**。`AGENTS.md` 只保留开发约束、命令、测试入口和少量必须记住的架构速记；模块职责、运行链路、状态归属和架构不变量都以这里为准。

配套模式文档：

- `docs/state-and-runtime-patterns.md`：运行时状态归属、防陈旧与投影规则
- `docs/data-and-persistence-patterns.md`：设置、索引、持久化边界与搜索契约
- `docs/ui-patterns.md`：host/Svelte UI 边界、虚拟化、hydration 与交互约束

## 架构目标

`Card Workspace` 是一个 Obsidian 桌面插件。它把 folder scope 映射成左侧 sidebar 中的卡片流，让用户在当前 vault 上下文中浏览、筛选、搜索、置顶和打开文件。

当前架构围绕以下目标收敛：

- **本地优先。** 文件读取、设置持久化、索引存储和搜索执行都发生在本地运行时。
- **宿主拥有插件生命周期。** `main.ts` 持有插件级资源、命令、设置、搜索服务初始化、vault mutation 转发和 rebuild 调度。
- **视图拥有每实例运行时状态。** `FolderCardView.ts` 持有当前 folder scope、`baseCards` / `visibleCards`、hydration、bulk state、`searchQuery` 和 `searchStatus`。
- **投影链路单一。** `pipeline.ts` 是唯一的 visible-card projection，固定顺序为 `tag filter -> search filter -> pin reorder`。
- **搜索是 indexed-only。** 搜索以 `IndexedDB` + `MiniSearch` 为基础，不再支持非索引 fallback；索引未就绪时，非空查询被明确阻塞。
- **文件类型是显式领域边界。** 当前正式卡片文件类型为 `markdown`、`base`、`canvas`、`excalidraw`；它们共享卡片流，但不共享完全对称的预览与搜索能力。

## 系统总览

```text
Obsidian events
  ├─ file explorer / workspace actions
  └─ vault create/modify/delete/rename
          ↓
src/main.ts
  ├─ plugin lifecycle
  ├─ settings I/O
  ├─ search service bootstrap / restore / rebuild scheduling
  └─ vault mutation fanout
          ↓
src/view/FolderCardView.ts
  ├─ folder scope resolution
  ├─ supported file collection + baseCards
  ├─ hydration / refresh / bulk runtime state
  ├─ runtime searchQuery / searchStatus
  ├─ query coordination
  └─ pipeline input assembly
          ↓
src/view/pipeline.ts
  └─ tag filter -> search filter -> pin reorder
          ↓
src/view/panel-model.ts
  └─ host-to-Svelte state bridge
          ↓
src/view/FolderCardPanel.svelte + Toolbar.svelte + CardItem.svelte
  └─ presentation + user intent surface

src/search/IndexStore.ts
  └─ IndexedDB persisted index snapshots
          ↓
src/search/SearchIndexManager.ts
  └─ restore / build / mutation / health snapshots
          ↓
src/search/IndexedSearchService.ts
  └─ candidate-bounded query contract for FolderCardView
```

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
| `src/main.ts` | 插件 lifecycle、settings、view 注册与激活、搜索服务初始化、vault mutation 转发、rebuild 调度、默认卡片打开语义 | 持有 per-view query、直接计算 `visibleCards` |
| `src/view/FolderCardView.ts` | folder scope、受支持文件收集、`baseCards` / `visibleCards`、refresh/hydration、防陈旧、bulk state、`searchQuery` / `searchStatus`、query 协调 | 持有插件级 lifecycle、直接操作 `IndexedDB`、拥有全局索引真值 |
| `src/view/file-kind.ts` | `markdown` / `base` / `canvas` / `excalidraw` 解析、图标、占位摘要 contract | 决定 view 状态、实现索引或 UI 生命周期 |
| `src/view/pipeline.ts` | 唯一 visible-card projection：`tag filter -> search filter -> pin reorder` | 决定插件生命周期、直接读写 Vault、绕开前序过滤恢复卡片 |
| `src/view/panel-model.ts` | 宿主到 Svelte 的状态桥与稳定投影 | 保存长期真值、持有默认打开语义、持有搜索索引真值 |
| Svelte UI (`FolderCardPanel.svelte` / `Toolbar.svelte` / `CardItem.svelte`) | 展示 cards、接收用户交互、把 intent 回传宿主 | 持有 plugin lifecycle、拥有搜索状态真值、拥有索引状态 |
| `src/search/IndexStore.ts` | IndexedDB 持久化、恢复、写入、清理 | 执行查询、决定 UI 状态 |
| `src/search/SearchIndexManager.ts` | restore、full build、mutation apply、health snapshots、unsafe rename 保护 | 持有 view query、直接产出 UI |
| `src/search/IndexedSearchService.ts` | 把 manager 快照翻译为 query contract、限制 candidate paths、返回 indexed ordering 或 blocked state | 拥有 view state、伪造非 Markdown 全文索引 |

## 核心运行流程

### 1. folder scope 到 panel

1. `FolderCardView.ts` 根据当前 folder scope 收集受支持文件，并通过 `file-kind.ts` 解析 `fileKind`。
2. 视图构建 `baseCards`，对 Markdown 准备轻量 preview 路径，对非 Markdown 使用稳定占位摘要。
3. 视图组装 `PipelineContext`，经 `pipeline.ts` 计算 `visibleCards`。
4. 结果通过 `panel-model.ts` 投影给 Svelte UI。

### 2. query 到搜索投影

1. UI 把 query intent 回传给 `FolderCardView.ts`。
2. `FolderCardView.ts` 持有 runtime-only `searchQuery`，并向 `IndexedSearchService` 发起带 candidate paths 的查询。
3. `IndexedSearchService` 在 `indexed-ready` 时返回当前候选范围内的 `orderedPaths`；非 ready 时返回 blocked execution state。
4. `pipeline.ts` 基于搜索输入做统一投影，继续保证 `tag -> search -> pin` 的固定顺序。

### 3. vault mutation 到 refresh / index update

1. Obsidian vault 事件先进入 `main.ts`。
2. `main.ts` 把 mutation 转发给视图和搜索服务，并在需要时调度 plugin-owned rebuild。
3. `FolderCardView.ts` 决定当前 scope 是否需要 refresh / hydration 更新。
4. `SearchIndexManager` 尝试增量更新；对无法安全处理的 rename 等情况发布 `rebuild-required`。

默认打开语义、hover preview、删除偏好和上下文菜单都属于宿主集成点：它们影响模块边界，但不改变上述主运行链路。

## 状态与数据归属

### 持久化设置：`PluginSettings`

- `sort`
- `filter.tags`
- `pinnedPaths`
- `includeSubfolders`
- `defaultView`
- `previewLines`
- `lastFolderPath`

其中 `lastFolderPath = ""` 是 vault root 的正式持久化表示；`includeSubfolders=true` 时形成默认的全库浏览态。

### 持久化索引：`IndexStore`

- per-vault metadata
- `documentCount`
- `lastIndexedAt`
- serialized index payload

这层只承载索引恢复与持久化，不承载 view query。

### 视图运行时：`FolderCardView.ts`

- 当前 folder scope
- `baseCards` / `visibleCards`
- selection / bulk state
- generation / hydration bookkeeping
- `searchQuery`
- `searchStatus`
- 当前 query 对应的 search projection input

### 面板订阅态：`panel-model.ts`

- cards、selection、loading、generation
- sort、tag filter、pin state、previewLines
- bulk mode 及其派生状态
- `searchQuery`、`searchStatus`

两个关键边界：

- `searchQuery` 不进入 settings。
- UI 不拥有默认打开语义，也不拥有搜索真值。

## 架构不变量

- `main.ts` 持有 plugin lifecycle 与 search lifecycle。
- `FolderCardView.ts` 持有 per-view query 和运行时真值。
- `pipeline.ts` 是唯一 visible-card projection。
- 搜索是 indexed-only；索引未就绪时，非空查询必须阻塞显示。
- Markdown 继续参与全文索引；`base`、`canvas`、`excalidraw` 目前只参与标题级匹配。
- pin 只重排通过前序过滤后的卡片，不绕过 filter 或 search constraint。
- 启动 preview 预热必须针对 pipeline-projected visible prefix，而不是原始 `baseCards` 前缀。
- 当前启动预热预算是前 6 张可见候选、最多等待 120ms；超时后由后台 hydration 补齐。
- Svelte 组件只负责 presentation 和 intent surface，不持有插件级状态或索引状态。
- scope 模型已收敛为 folder-only；vault root 不是特殊模式，而是 `lastFolderPath = ""` 的边界值。

