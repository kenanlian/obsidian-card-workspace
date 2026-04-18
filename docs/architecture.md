# Architecture

## 架构目标与设计原则

这个插件的架构目标不是做一个独立 Web 应用，而是在 Obsidian 运行时里提供一个响应快、状态可恢复、可以持续扩展的卡片工作台。

当前设计由五个原则驱动：

1. **性能优先**，大量笔记场景下不能退化成整列表渲染或频繁全量刷新。
2. **本地优先**，文件读取、metadata 判断、设置持久化都留在 Obsidian 本地运行时。
3. **原生交互感**，优先复用 Obsidian 的 View、Menu、Vault、MetadataCache 等宿主能力。
4. **宿主与面板解耦**，Obsidian 运行时状态留在宿主，Svelte 组件负责渲染和回调。
5. **标准 Svelte 5 接缝**，项目已经离开 compatibility 过渡态，新的视图改动都应沿着 `mount/unmount + panel-model + callback props` 这条接缝扩展。

## 系统总览

```text
Obsidian 事件源
  ├─ 文件管理器点击
  ├─ file-open
  └─ vault create/modify/delete/rename
          ↓
src/main.ts
  ├─ 视图注册 / 激活
  ├─ 设置加载与保存
  ├─ 外部事件转选择/刷新请求
  └─ 会话恢复
          ↓
src/view/FolderCardView.ts
  ├─ 收集文件 / 排序 / 构建 baseCards
  ├─ 增量刷新 / generation 防陈旧
  ├─ 管理 scope / filter / pin / bulk state
  ├─ 运行 pipeline → visibleCards
  ├─ 维护 panel-model
  └─ mount/unmount 根面板
          ↓
src/view/panel-model.ts
  └─ 宿主持有、面板订阅的状态边界
          ↓
src/view/FolderCardPanel.svelte
  ├─ 订阅 panel-model
  ├─ row-projected 响应式布局
  ├─ 虚拟滚动
  ├─ 滚动锚定
  └─ 组合 Toolbar + CardItem
          ↓
src/view/Toolbar.svelte / CardItem.svelte
  └─ 交互表面与 callback props
```

## 运行时拓扑与外部依赖

运行时依赖主要来自三层：

- `obsidian` API，负责插件生命周期、视图容器、Vault、MetadataCache、菜单、提示等宿主能力。
- Svelte 5 运行时，负责面板渲染和交互编排。当前使用标准 `mount/unmount` 接缝，不再启用 `compatibility.componentApi = 4`。
- esbuild + esbuild-svelte，负责把插件打包成 `main.js`。

验证依赖也已经固定下来：

- `vitest.config.ts` 分成 node 和 jsdom 两个 project。node lane 保留纯逻辑和 mock 驱动测试，jsdom lane 负责真实 `.svelte.test.ts` 和宿主接缝测试。
- `.github/workflows/ci.yml` 在 Node 20 上执行 `npx svelte-check --tsconfig ./tsconfig.json`、`npm run check`、`npm run build`、`npm test`。

当前没有网络依赖，没有外部服务，没有持久化数据库。未来搜索方案仍可能引入 IndexedDB + MiniSearch，但这还不是当前运行时事实。

## 技术选择及原因

### TypeScript + strict

设置、卡片记录、排序和批量操作状态都保持显式类型，是为了让后续搜索和批量能力继续沿着边界演进，而不是把状态形状散落到多个组件里。

### 标准 Svelte 5，但主状态仍归宿主

项目已经完成从 legacy class API 到标准 Svelte 5 宿主接缝的迁移，但并没有把 Svelte 变成全局状态容器。原因很直接，Vault 事件、设置持久化、视图生命周期、文件打开动作都属于 Obsidian 宿主语义，由 `FolderCardView.ts` 汇总更稳。

这次迁移后的核心变化不是“让组件更现代”这么简单，而是把宿主和组件的责任重新固定成下面的形式：

- `FolderCardView.ts` 负责状态真值、异步刷新、Obsidian API 交互。
- `panel-model` 负责把宿主真值变成一份可订阅的面板状态。
- Svelte 根面板和叶子组件负责把状态渲染出来，并通过 callback props 把用户动作送回宿主。

### 纯函数 pipeline 继续负责可见卡片投影

`src/view/pipeline.ts` 仍然是“哪些卡片显示，显示顺序如何变化”的唯一挂点。Svelte 5 迁移没有改变这个边界，因为搜索、标签过滤和 pin 重排都需要稳定的宿主级投影链路。

## 模块关系与职责边界

### `src/main.ts`

负责插件级职责：

- 读取和保存 `PluginSettings`
- 注册 `FOLDER_CARD_VIEW`
- 监听文件管理器点击与 `file-open`
- 在 `onLayoutReady` 后注册 vault 观察者并恢复会话
- 把外部事件转换成视图可消费的选择请求和刷新请求

它不拥有卡片投影、Svelte 状态或虚拟滚动逻辑。

### `src/view/FolderCardView.ts`

负责视图级运行时状态：

- 当前文件夹或视图模式
- `baseCards`、`visibleCards`
- generation、in-flight 请求、刷新队列
- available tags、selectedPath、批量选择状态
- card hydration 与 vault mutation 响应
- `panel-model` 创建、更新和销毁
- 根面板 `mount/unmount`

它是系统最重要的协调器，也是宿主与 Svelte 面板的唯一正式接缝。

### `src/view/panel-model.ts`

这是迁移完成后新增的稳定边界。

- 它由宿主持有，不由 Svelte 组件创建。
- 它暴露 `getState()`、`subscribe(...)`、`mutate(...)`。
- 它替代旧的 `$set(...)` prop 推送，让普通状态更新不需要 remount。

这个边界很重要，因为它把“宿主真值”和“面板渲染状态”隔开了。后续扩展搜索、批量操作或新的工具栏状态时，优先往这里加字段和变更语义，而不是回到散乱 prop 推送。

### `src/view/FolderCardPanel.svelte`

根面板现在是标准 Svelte 5 组件，负责：

- 订阅 `panelModel`
- 根据 viewport width 计算列数并投影 rows
- 计算可见窗口并触发 hydration 回调
- 维护滚动位置、row 高度测量和滚动锚定
- 组合 `Toolbar.svelte` 与 `CardItem.svelte`

它不直接访问 Obsidian API，也不拥有持久化真值。

### `src/view/Toolbar.svelte`

负责顶部动作入口、排序菜单、文件夹菜单、标签筛选菜单，以及当前 scope / tag filter / `includeSubfolders` 的紧凑状态提示。它已经迁移到 `$props()` 和 callback props，不再作为事件总线或状态源。

### `src/view/CardItem.svelte`

负责单卡片展示、打开笔记、键盘和鼠标交互、右键菜单入口、pin toggle。它同样已经迁移到标准 Svelte 5 组件契约。

### `src/view/row-projection.ts`

负责纯计算层几何逻辑：

- 根据可用宽度推导 `columnCount`
- 将扁平 card 序列稳定分组成 rows
- 将 visible rows 反向映射为扁平 `hydrate-range`
- 复用 binary-search 友好的 offset lookup

它不接触宿主状态，不接触 Svelte 运行时。

### `src/view/metadata-utils.ts` 与 `src/view/note-ops.ts`

- `metadata-utils.ts` 负责标签抽取、frontmatter 访问、搜索辅助。`matchesTagFilter()` 继续使用 **AND** 语义。
- `note-ops.ts` 负责复制、移动、删除、merge 等动作函数，不负责 UI 确认和视图编排。

## 关键流程设计

### 1. 文件夹选择与视图激活

入口仍有三类：文件管理器点击、面板内 `Pick folder`、`All Notes`。

统一流程是：

1. `main.ts` 生成选择请求并确保右侧视图已激活。
2. `FolderCardView` 处理选择请求，决定是否保留 UI 状态、是否强制刷新。
3. 重新采集文件、排序、生成 `baseCards`。
4. 根据设置和 pipeline 产出 `visibleCards`。
5. `FolderCardView` 把最新状态写入 `panel-model`。
6. 根面板和叶子组件据此更新 UI，并通过 callback props 把新动作回传给宿主。

### 2. 卡片 hydration

正文预览仍然不是一次性全量读取：

1. 初次加载先构建轻量卡片记录。
2. 面板依据当前可见 rows 请求 `hydrate-range`。
3. `FolderCardView` 对窗口范围内卡片批量执行 hydration。
4. generation 变化时，旧结果会被丢弃，避免异步回写污染新状态。

这个流程是性能模型核心，Svelte 5 迁移没有改变它。

### 3. Vault 增量刷新

文件变化不会直接触发整视图重建，而是：

- `main.ts` 在 `onLayoutReady` 后注册观察者
- debounce 聚合高频变更
- `FolderCardView` 优先尝试增量处理，必要时再退回刷新队列

这条链路必须继续保持，因为它直接决定大 vault 场景下的交互平滑度。

### 4. 可见卡片投影

当前投影链路仍然是：

```text
baseCards
  -> applyTagFilter
  -> applySearchFilter
  -> applyPinReorder
  -> visibleCards
```

关键约束没有变：

- tag filter 是 metadata 层过滤，不依赖全文索引
- search 将来要插入同一链路，而不是绕开它
- pin 只重排当前输入，不恢复被过滤掉的卡片

## 数据流与状态映射

### 插件级持久化状态

来源是 `PluginSettings`：

- `sort`
- `filter.tags`
- `pinnedPaths`
- `includeSubfolders`
- `defaultView`
- `lastFolderPath`
- `lastViewMode`

这些状态由 `main.ts` 读写，并供 `FolderCardView` 在刷新和会话恢复时使用。

### 视图级运行时状态

来源是 `FolderCardView`：

- `folderPath`
- `baseCards`
- `visibleCards`
- `availableTags`
- `selectedPath`
- `generation`
- `loading`
- 批量选择相关状态
- in-flight / queued refresh 状态

### 面板订阅状态

来源是 `panel-model`。它是宿主把运行时状态投影给面板的正式载体，字段包括：

- cards、selectedPath、loading、generation
- 排序、标签筛选、pin 状态
- `folderTree`、`includeSubfolders`、`isAllNotesScope`
- bulk mode 和选中统计

这里最重要的判断标准是，凡是会影响 Obsidian runtime、持久化或异步刷新的真值，都先归宿主，再通过模型投影给面板。

## 关键约束与假设

1. 不要重新引入 `compatibility.componentApi = 4`，除非出现经过验证的硬阻塞。
2. 不要把 `panel-model` 退化回零散 `$set(...)` 式 prop 推送，也不要用普通状态更新触发 remount。
3. 不要破坏 row projection、虚拟滚动、滚动锚定、hydrate-range、generation guards、debounced vault observers。
4. `includeSubfolders` 只在 folder scope 下有可见语义，`All Notes` 不应该显示误导性的 toggle 状态。
5. node 和 jsdom 两条测试 lane 都是正式验证面，不能只保一边。

## 历史问题与折中

`2026-04-03` 的决策把项目带到 “Svelte 5 运行时，但保留 legacy component API compatibility” 的过渡阶段。那次选择降低了首轮升级风险，但也明确留下第二阶段迁移。

现在第二阶段已经完成。项目不再处在兼容层过渡态，而是进入标准 Svelte 5 宿主/组件接缝。当前仍保留的已知问题主要是 `Toolbar.svelte` 的非阻塞 a11y warnings，它们属于后续 UI 和可访问性收尾，不属于迁移未完成。

## 优化与演进机会

1. 把搜索从占位步骤接到 `pipeline.ts` 的正式链路。
2. 在 `panel-model` 边界上扩展多选和批量操作，而不是把新状态塞回叶子组件。
3. 系统处理 `Toolbar.svelte` 的 a11y warnings，避免长期带着非阻塞告警前进。
4. 继续强化 runtime 测试，让新交互优先落在 jsdom 真实组件验证面上。

## Related decisions

- `docs/decisions/2026-03-24-panel-owned-card-projection-and-interactions.md`
- `docs/decisions/2026-04-03-migrate-to-svelte-5-with-legacy-component-api.md`
- `docs/decisions/2026-04-04-row-projected-responsive-card-wall.md`
- `docs/decisions/2026-04-09-toolbar-scope-summary-and-folder-only-subfolder-toggle.md`
- `docs/decisions/2026-04-18-finish-svelte-5-host-and-component-seam.md`
