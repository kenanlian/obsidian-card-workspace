# Architecture

## 架构目标与设计原则

这个插件的架构目标不是“做一个漂亮的卡片列表”，而是把 Obsidian 里原本分散的浏览动作，收敛成一个**响应快、状态可恢复、可以继续扩展**的侧边栏工作台。

当前架构由四个核心原则驱动：

1. **性能优先**：大量笔记场景下不能退化成整列表渲染或频繁全量刷新。
2. **本地优先**：所有文件读取、metadata 判断、设置持久化都留在 Obsidian 本地运行时。
3. **原生交互感**：尽量复用 Obsidian 的 View、Menu、Tooltip、Vault、MetadataCache 机制，而不是另起一套 Web 应用式框架。
4. **模块边界清晰**：Obsidian 运行时绑定、纯数据投影、Svelte 视图展示、笔记操作工具分层，避免未来搜索/批量能力把当前结构拖垮。

## 系统总览

```text
Obsidian 事件源
  ├─ 文件管理器点击
  ├─ file-open
  └─ vault create/modify/delete/rename
          ↓
src/main.ts (Plugin 入口)
  ├─ 视图注册 / 激活
  ├─ 设置加载与保存
  ├─ 外部事件转选择/刷新请求
  └─ 会话恢复
          ↓
src/view/FolderCardView.ts (运行时中枢)
  ├─ 收集文件 / 排序 / 构建 baseCards
  ├─ 增量刷新 / generation 防陈旧
  ├─ 生成 folder tree / available tags
  ├─ 管理 scope / filter / includeSubfolders 的持久化真值
  ├─ 运行 pipeline → visibleCards
  └─ pushState 给 Svelte 面板
          ↓
src/view/FolderCardPanel.svelte (视口层)
  ├─ row-projected 响应式布局
  ├─ 虚拟滚动
  ├─ 滚动锚定
  ├─ hydrate-range 事件
  └─ 组合 Toolbar + CardItem
          ↓
src/view/Toolbar.svelte / CardItem.svelte
  └─ 用户交互入口与事件抛出
```

## 运行时拓扑与外部依赖

运行时依赖几乎全部来自 Obsidian 宿主：

- `obsidian` API：`Plugin`、`ItemView`、`TFile`、`TFolder`、`FuzzySuggestModal`、`Menu`、`Notice`、`MetadataCache` 等。
- Svelte 5：仅用于视图展示与交互编排；当前通过 legacy component API compatibility 继续兼容现有宿主接入方式。
- esbuild + esbuild-svelte：构建 `main.js`。
- Vitest：单元测试与视图事件契约测试。

当前没有网络依赖、没有外部服务、没有持久化数据库。未来搜索方案文档指向 IndexedDB + MiniSearch，但这仍是规划，不是当前运行时事实。

## 技术选择及原因

### TypeScript + strict

项目把设置、事件、刷新动作和卡片记录都显式类型化，这是为了让后续的搜索、批量、多视图状态扩展可以继续在边界上受约束，而不是靠运行时猜测。

### Svelte 5 只负责视图，不负责主状态

当前没有把 Svelte 当成全局状态容器。主要原因是插件要和 Obsidian 运行时深度耦合：Vault 事件、文件打开、菜单、视图激活、设置持久化都更适合由 `FolderCardView` 统一管理。升级到 Svelte 5 后，这一点没有改变：Svelte 组件仍保持“接 props + 发事件”的轻状态角色，降低了视图层和宿主 API 的耦合。

这次迁移刻意采用 **Svelte 5 编译器/运行时 + `compatibility.componentApi = 4`** 的方式，保留 `FolderCardView.ts` 里的 `new Component(...)`、`$on(...)`、`$set(...)`、`$destroy()` 接口。这样做的目的不是长期停留在 legacy 语法，而是把“框架升级”和“组件源码改写为 runes/callback props”拆成两步，先确保现有 Obsidian 宿主接入面稳定。

### 纯函数 pipeline 负责可见卡片投影

`src/view/pipeline.ts` 把“哪些卡片应该显示、显示顺序如何变化”从 `FolderCardView` 的运行时逻辑中抽离出来。这样做的价值不是现在省代码，而是为后续搜索、复杂过滤器、pin 规则和结果排序提供稳定挂点。

## 模块关系与职责边界

### `src/main.ts`

拥有插件级职责：

- 读取和保存 `PluginSettings`
- 注册 `FOLDER_CARD_VIEW`
- 监听文件管理器点击与 `file-open`
- 在 `onLayoutReady` 后注册 vault 观察者并恢复会话
- 把“外部事件”转换为视图可消费的选择请求和刷新请求

它**不应该**承担卡片投影、过滤规则、虚拟滚动、单卡 UI 逻辑。

### `src/view/FolderCardView.ts`

拥有视图级运行时状态：

- 当前文件夹/视图模式
- `baseCards` / `visibleCards`
- generation、in-flight 请求、队列刷新
- folder tree、available tags、selectedPath
- 卡片 hydration 与 vault mutation 响应

它是当前系统最重要的协调器。未来要扩展搜索、批量、多选，也应优先以它为状态汇聚点，而不是把状态散落到多个 Svelte 组件。

### `src/view/FolderCardPanel.svelte`

拥有纯视口职责：

- 根据 viewport width 计算列数并将扁平 `cards` 投影成 rows
- 计算可见窗口
- 发出 `hydrate-range`
- 维护滚动位置、测量 row 高度、执行滚动锚定
- 组合 Toolbar 与 CardItem

它不拥有 vault 数据源，也不直接调用设置持久化。

当前它虽然由 Svelte 5 编译，但仍维持原先的 props / 事件协议，以便继续被 `FolderCardView` 作为类组件实例管理。

### `src/view/row-projection.ts`

承载纯计算层的响应式 wall 几何逻辑：

- 根据可用宽度推导 `columnCount`
- 将扁平 card 序列稳定分组成 rows
- 将 visible rows 反向映射为扁平 `hydrate-range`
- 复用 binary-search 友好的 offset lookup

它不触碰 Svelte state，也不触碰 Obsidian runtime。

### `src/view/Toolbar.svelte` / `src/view/CardItem.svelte`

- `Toolbar.svelte`：顶部动作入口、排序菜单、文件夹菜单、标签筛选菜单，以及当前 scope / tag filter / `includeSubfolders` 的紧凑状态提示。
- `CardItem.svelte`：单卡片展示、键盘/鼠标打开、右键菜单入口、pin toggle。

这两个组件是交互表面层，不应演化成业务状态源。

### `src/settings.ts`

统一定义设置 schema、默认值和 normalize/merge 行为。它的作用是把“用户数据脏输入”挡在运行时逻辑之外。

### `src/view/metadata-utils.ts`

提供标签抽取、frontmatter 访问、搜索辅助。这里的约束值得特别注意：

- 标签统一做小写归一化并去掉前导 `#`
- `matchesTagFilter()` 使用 **AND 语义**
- 搜索辅助目前只提供基础 substring 匹配，不代表最终搜索方案

### `src/view/note-ops.ts`

承载与单条/批量文件动作相关的可复用函数，如复制、移动、删除、merge。它是动作工具层，不负责 UI 确认、选中状态或视图刷新编排。

## 关键流程设计

### 1. 文件夹选择与视图激活

入口有三类：

- 文件管理器点击
- 面板内 `Pick folder`
- `All Notes`

流程统一收敛为：

1. `main.ts` 生成选择请求并确保右侧视图已激活。
2. `FolderCardView` 处理选择请求，决定是否保留 UI 状态、是否强制刷新。
3. 重新采集文件、排序、生成 `baseCards`。
4. 根据设置和 pipeline 产出 `visibleCards`，再把 `folderPath`、`activeFilterTags`、`includeSubfolders`、`isAllNotesScope` 等真实状态同步给 Svelte 面板。

### 1.1 范围提示与 `includeSubfolders` 开关

T32 之后，顶部 Toolbar 的范围相关语义统一遵守下面这条链路：

1. `FolderCardView` 仍然持有真实范围状态：当前是 folder scope 还是 `All Notes`、`includeSubfolders` 是否开启、tag filter 是否生效。
2. `pushState()` 和 `onOpen()` 会把 `includeSubfolders` 与 `isAllNotesScope` 作为 props 传给 `FolderCardPanel.svelte` / `Toolbar.svelte`。
3. `Toolbar.svelte` 只负责把这些状态显示成紧凑 summary，并且**只在 folder scope 下**显示 `includeSubfolders` toggle。
4. 用户点击 toggle 时，Toolbar 只抛出 `include-subfolders-change`；真正决定是否合法、是否持久化、是否触发刷新的人仍是 `FolderCardView`。

这样做的核心目的是避免两个错觉：

- 不让 `All Notes` 看起来像是也支持“关闭子文件夹”。
- 不让 Svelte 组件自己维护一个和设置层分叉的范围真值。

### 2. 卡片 hydration

卡片并不是一次性把全部正文预览都读出来。实际流程是：

1. 初次加载时先构建轻量卡片记录。
2. 面板依据当前 rows 的可见范围发出 `hydrate-range`。
3. `FolderCardView` 对窗口范围内卡片批量执行 hydration。
4. generation 变化时，旧结果会被丢弃，避免异步回写污染新状态。

这个流程是性能模型的核心，不应被“为了简单”而移除。

### 3. Vault 增量刷新

插件不是每次文件变化都整文件夹重建，而是：

- 先由 `main.ts` 在 `onLayoutReady` 后注册观察者
- 再通过 debounce 聚合高频变更
- `FolderCardView` 优先尝试增量处理，必要时再退回刷新队列

这让文件新增、修改、重命名、删除在大多数情况下都能维持更平滑的体验。

### 4. 可见卡片投影

当前投影链路为：

```text
baseCards
  -> applyTagFilter
  -> applySearchFilter   // 目前仍是占位
  -> applyPinReorder
  -> visibleCards
```

这里最重要的约束是：

- tag filter 是 metadata 层过滤，不依赖全文索引
- search 未来要插入同一链路，而不是绕开它单独排序
- pin 只重排当前输入，不恢复被上游过滤掉的卡片

## 数据流与状态映射

### 插件级持久化状态

来源：`PluginSettings`

- `sort`
- `filter.tags`
- `pinnedPaths`
- `includeSubfolders`
- `defaultView`
- `lastFolderPath`
- `lastViewMode`

这些状态由 `main.ts` 读写，并通过 `getSettings()` / `saveSettings()` 提供给 `FolderCardView` 使用。

其中 `includeSubfolders` 需要特别记住：

- 它是**持久化范围设置**，不是瞬时 UI 勾选框。
- 它只对 folder scope 生效；在 `All Notes` 下只是被保留，不应该被渲染成一个误导性的当前状态。

### 视图级运行时状态

来源：`FolderCardView`

- `folderPath`
- `baseCards`
- `visibleCards`
- `availableTags`
- `selectedPath`
- `generation`
- `loading`
- in-flight / queued refresh 状态

### 展示级瞬时状态

来源：Svelte 组件

- 滚动位置、可见窗口、测量高度
- 排序/筛选/文件夹菜单的展开状态
- 当前用户滚动锁定窗口

这些状态可以被重建，不应持久化到插件设置。

Toolbar 里的 summary 文案和 `includeSubfolders` 按钮也属于这一层：它们是对上层真值的展示，不是新的状态源。

## 关键约束与假设

1. **generation-based staleness 是必需约束。** 所有异步加载都可能在用户快速切换文件夹后变成陈旧结果。
2. **虚拟滚动现在依赖 row projection + row height measurement。** 如果未来引入高度波动更大的内容，必须同步维护 row 级滚动锚定与 resize anchoring 逻辑。
3. **标签筛选使用 AND 语义。** 这是当前测试和实现共同约束，不应随意改成 OR。
4. **置顶只影响顺序，不改变可见性。** 这保证筛选规则是主规则，置顶是次规则。
5. **当前搜索是规划中的能力，不应在文档里当成已实现。**
6. **当前 Svelte 5 迁移停留在 compatibility 模式。** 后续如果要改成 `$props` / callback props / runes，应当作为单独的结构性演进处理，而不是顺手夹带在功能开发里。
7. **`includeSubfolders` 只在 folder scope 下有 UI 语义。** `All Notes` 必须隐藏这个开关，而不是展示一个看起来可切换的伪状态。
8. **preview 的逻辑预算和物理裁切预算必须保持一致。** `src/view/markdown-utils.ts` 负责把 preview 归一化成可预算的轻量 HTML，`styles.css` 里的 `.fce-excerpt` 负责按 `previewLines` 做物理裁切；excerpt 内部如果重新引入未计入预算的段间距、代码块 padding 或 border，就会重新制造最后一行 clipping。

## 历史问题与当前折中

- 早期插件重点是“文件夹点击后显示卡片”，后续才逐步补齐面板内闭环交互。
- 最近一轮实现把 folder picker、context actions、tag filter、pin state，以及 Toolbar 中的范围提示和 `includeSubfolders` 控制都接入了同一视图状态体系，这让结构更稳定，但 `FolderCardView.ts` 也因此继续变大。
- preview-normalization 落地后，又补了一次 clipping 修复：code preview 不再使用带额外 box chrome 的 `<pre>` 表面，excerpt 内部也不再依赖未计入 `previewLines` 预算的段间距。这个折中保持了 Scheme B 的 weak-cue 风格，但也新增了一条维护约束：不要在 excerpt 内部随意恢复垂直装饰性间距。
- 目前批量与搜索还没进入主干实现，因此一些基础能力已在工具层或计划文档中存在，但用户可见工作流尚未完整闭环。

## 优化与演进方向

1. 在现有 pipeline 挂点上接入真正的搜索服务，而不是在视图层做临时过滤分支。
2. 为批量操作补齐多选状态源和确认/错误反馈链路。
3. 在保持原生感的前提下再做视觉一致化与无障碍收尾，并处理当前 `Toolbar.svelte` 的 a11y warnings。

## 相关决策

- `docs/decisions/2026-03-24-panel-owned-card-projection-and-interactions.md`
- `docs/decisions/2026-04-03-migrate-to-svelte-5-with-legacy-component-api.md`
- `docs/decisions/2026-04-04-row-projected-responsive-card-wall.md`
- `docs/decisions/2026-04-09-toolbar-scope-summary-and-folder-only-subfolder-toggle.md`
