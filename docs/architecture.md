# Architecture

## 架构目标与设计原则

这个插件不是独立 Web 应用，而是 Obsidian 里的右侧卡片工作台。当前架构由六个原则驱动：

1. **性能优先。** 避免整 vault 重扫、避免无边界重建、避免破坏虚拟滚动和 generation guard。
2. **本地优先。** 文件处理、索引存储、搜索执行、设置持久化都发生在本地运行时。
3. **宿主拥有生命周期。** 插件级资源、命令、通知、搜索服务和重建调度都归 `main.ts`。
4. **视图拥有运行时查询。** 当前 view 的 query、debounce、候选卡片和搜索状态归 `FolderCardView.ts`。
5. **`pipeline.ts` 统一可见结果。** 不管搜索来自 fallback 还是 indexed，最终投影都必须走同一条纯函数链路。
6. **卡片文件类型是显式领域概念。** `markdown`、`base`、`canvas`、`excalidraw` 都可以进入卡片流，但它们的预览、图标和搜索能力并不完全相同。
7. **默认卡片点击遵循主编辑区 recent-root fallback 语义。** 左键 / Enter / Space 的默认打开行为不再由设置驱动，而由 `main.ts` 直接决定：先尝试复用 `getMostRecentLeaf(rootSplit)` 返回的可承载文件 root leaf；若最近 root leaf 不可承载文件，则回退到 root Markdown leaf；只有目标 leaf 已 pin 或没有合适目标时，才新开一个 tab。

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
  ├─ 搜索服务与命令生命周期
  ├─ vault mutation 转发
  └─ rebuild 调度与降级通知
          ↓
src/view/FolderCardView.ts
  ├─ 收集受支持文件 / 解析 fileKind / 构建 baseCards
  ├─ generation / hydration / 刷新编排
  ├─ runtime-only searchQuery / debounce / searchStatus
  ├─ SearchService query 协调
  ├─ 运行 pipeline -> visibleCards
  └─ 更新 panel-model
          ↓
src/view/file-kind.ts
  ├─ 解析 markdown/base/canvas/excalidraw
  └─ 提供文件图标与占位摘要约定
          ↓
src/view/panel-model.ts
  └─ 面板订阅状态边界
          ↓
src/view/FolderCardPanel.svelte / Toolbar.svelte / CardItem.svelte
  └─ UI 展示、交互回调、命中高亮、文件类型图标与占位摘要、可收起搜索行、一级按钮高亮态、icon-only bulk strip、批量复选框
          ↓
src/view/pipeline.ts
  └─ tag filter -> search filter (markdown full-text + non-markdown title-only) -> pin reorder

src/search/IndexStore.ts
  └─ IndexedDB 持久化索引与元数据

src/search/SearchIndexManager.ts
  └─ restore / full build / mutation apply / health snapshots

src/search/IndexedSearchService.ts
  └─ candidate-bounded 查询与 indexed ordering 输出
```

## 运行时拓扑与外部依赖

当前运行时依赖来自五层：

- `obsidian` API，负责插件生命周期、视图容器、Vault、MetadataCache、命令注册和通知。
- Svelte 5 兼容模式运行时，负责面板渲染和交互回调。
- Obsidian `FileManager`，负责遵循宿主 `Files & Links` 删除偏好执行文件删除。
- `IndexedDB`，由 `IndexStore` 使用，负责本地持久化索引快照。
- `MiniSearch`，负责内存中的文本索引和查询执行。
- esbuild + esbuild-svelte，负责构建 `main.js`。
- GitHub Actions release workflow，负责在 push 裸 semver tag（例如 `0.1.1`，而不是 `v0.1.1`）时复用仓库校验链路，并把 `main.js`、`manifest.json`、`styles.css` 发布成 draft GitHub Release。

当前没有产品运行时网络依赖，没有外部服务。搜索能力已经是本地 indexed 架构，不再只是 no-index 接缝，但它仍保留 fallback 路径以应对构建中、恢复失败或初始化失败。GitHub Release 自动化只属于仓库发布基础设施，不属于插件运行时依赖。

## 技术选择及原因

### TypeScript + strict

这里的价值是把 ownership 和契约钉死。`searchQuery` 不进 settings，`SearchServiceSnapshot` 明确暴露健康状态，`SearchQueryResult` 明确区分 `null` 和空数组，`NoteCardRecord.fileKind` 明确卡片文件类型，这些都是防止后续演进时把语义做混。

### 显式 `file-kind` 解析层

这次变化让“哪些文件可以成为卡片”不再藏在 `file.extension === "md"` 这种局部判断里，而是收敛到 `src/view/file-kind.ts`：

- 统一解析 `markdown`、`base`、`canvas`、`excalidraw`。
- 把文件类型图标和占位摘要从 UI 组件中抽离成稳定 contract。
- 让文件类型图标继续停留在 Obsidian 官方 Lucide icon name 这一层，而不是把截图或自定义图片资产塞进 card title icon slot。
- 让 `main.ts`、`FolderCardView.ts`、`pipeline.ts`、`CardItem.svelte` 用同一份类型语义协作，而不是各自猜测扩展名。

### Svelte 5 兼容模式，宿主继续做协调

组件负责展示、输入和局部 UI 效果，但不拥有插件级资源，也不拥有搜索真值。这样可以把 Obsidian 生命周期和 UI 表面分开，减少组件内隐藏副作用。

### Tag-driven GitHub Release automation

发布链路现在采用最小仓库基础设施，而不是引入 `semantic-release`、`release-please` 或 npm publish：

- `.github/workflows/release.yml` 只在 push 裸 semver tag 时触发，例如 `0.1.1`，而不是 `v0.1.1`。
- workflow 会复用仓库当前的 `check:svelte`、`check`、`build`、`test` 校验链路，而不是发明第二套发布专用验证。
- `scripts/check-release.mjs` 负责校验 Git tag、`package.json.version`、`manifest.json.version`、`versions.json[version]` 与 `manifest.json.minAppVersion` 的对齐关系。
- `scripts/sync-version.mjs` 负责把版本 bump 的多文件更新收敛成一个显式命令，减少手工漏改风险。

因此，release 前的本地 sanity-check 不应只跑仓库常规三件套，还应补上 `npm run check:svelte`，否则维护者可能在本地通过 `check/build/test` 后，仍在 tag workflow 中被 Svelte 校验拦下。

这里的核心设计目标不是“全自动语义化发版”，而是把 Obsidian 插件对 release assets 和版本对齐的硬约束固化进仓库本身，同时保持发布行为足够可见、可控。

### IndexedDB + MiniSearch

Phase 3 最重要的变化，是搜索不再只是 readiness seam，而是形成了可恢复、可重建、可增量更新的本地索引链路。

- `IndexStore` 负责持久化，不负责 query。
- `SearchIndexManager` 负责 restore、build 和 mutation，不负责 view 状态。
- `IndexedSearchService` 负责把 manager 能力转换成 view 可消费的 contract。

现在又补充了一条明确边界：**全文索引仍然只覆盖 Markdown 文档。** 这不是遗漏，而是刻意选择：

- `base`、`canvas`、`excalidraw` 可以进卡片流，但当前没有稳定、低成本的正文抽取 contract。
- 因此 indexed 搜索继续对 Markdown 负责全文排序；非 Markdown 卡片只在标题命中时参与最终结果。
- 这避免了为了“统一搜索表面”而把脆弱的内容解析逻辑提前散进 view 或 service 层。

### `pipeline.ts` 继续做唯一可见卡片投影链路

即使 indexed 查询已经返回排序结果，服务层也只返回 `orderedPaths`。最终可见卡片仍由 pipeline 从当前候选卡片集合里投影出来。这避免了服务直接控制 UI，也避免 pin、tag filter 和搜索结果各走各的顺序逻辑。

## 模块关系与职责边界

### `src/main.ts`

负责插件级职责：

- 设置读写与会话恢复。
- 注册和激活 `FOLDER_CARD_VIEW`。
- 初始化 `IndexStore`、`SearchIndexManager`、`IndexedSearchService`，并在失败时回退到 `NoIndexSearchService`。
- 注册 command palette 的 rebuild 或 recover 命令。
- 注册 vault observers，并把 mutation 转发给视图和搜索服务。
- 在转发搜索 mutation 时，用 `file-kind` 语义判断 rename / create / delete 是否仍应被视为 Markdown 索引文档变化。
- 订阅搜索健康快照，在必要时调度一次 plugin-owned rebuild，并避免重复 fanout。
- 作为卡片默认打开语义的唯一真相来源，决定何时复用最近 root file-capable leaf、何时回退到 root Markdown leaf、何时新建 tab，以及何时执行显式 split / popout。

它不拥有 per-view query，也不直接决定 `visibleCards`。

### `src/view/FolderCardView.ts`

这是每个视图实例的运行时协调中枢，当前负责：

- `baseCards`、`visibleCards`、selectedPath、bulk state。
- generation、防陈旧、hydration、刷新队列。
- 当前视图的 `searchQuery`、`searchStatus`、候选路径约束和 debounce。
- 收集当前 folder / all-notes scope 下的受支持文件，并把 `fileKind` 写入 `NoteCardRecord`。
- 对 Markdown 卡片执行正文读取和预览构建；对非 Markdown 卡片注入占位摘要。
- 轻量 preview 只保留少数可预算的弱提示：heading、inline code、fenced code；粗体和斜体语法会在 `markdown-utils.ts` 中被拍平成普通文本，不再输出 `<strong>` / `<em>`。
- 轻量 preview 现在会在共享 `previewLines` 预算内，按源码顺序保留文本块与 fenced code block；代码块不再因为前面已经出现正文而被统一跳过。
- 向 `SearchService` 发 query，并把结果转成 pipeline 输入。
- 组装 `PipelineContext`，再调用 `runPipeline()`。
- 把 cards、filter、pin、bulk、search 状态写入 `panel-model`。
- 把 bulk delete 与单卡右键 `Delete` 都路由到遵循 Obsidian 删除偏好的实现，而不是插件自定义的永久删除语义。
- 把默认卡片点击与“更多”菜单显式动作分层：默认点击只上报 `path`，显式菜单动作才传具体 `OpenDestination`。
- 把卡片右键菜单收敛为最小文件操作面，不再暴露 path copy、系统壳打开或 file stats 这类高噪音动作。
- 把允许的卡片 hover 表面统一转成 `hover-link` payload，再交给 Obsidian workspace 触发宿主 popover。

关键边界是：**query 仍只由 `FolderCardView.ts` 持有。** indexed 搜索的存在没有改变这一点。

### `src/view/panel-model.ts`

这是宿主到面板的正式状态桥。它承载 cards、selection、loading、generation，以及从 `FolderCardView.ts` 桥接而来的空状态提示信息；同时也承载 `searchQuery` 和 `searchStatus`。它不保存长期状态，只负责稳定投影。默认卡片打开方式已经不再经过这层状态桥。

### `src/view/FolderCardPanel.svelte` / `src/view/Toolbar.svelte` / `src/view/CardItem.svelte`

这些组件负责：

- 显示可收起的搜索行、搜索输入和命中结果。
- 在标题和摘录表面做安全高亮。
- 为卡片标题区显示文件类型图标。
- 标题图标继续通过 `setIcon(...)` 渲染 Obsidian 官方 icon name；当前 `base` 使用 `layout-list`，`excalidraw` 使用 `pen-tool`。
- 为非 Markdown 卡片显示稳定占位摘要，而不是假装存在正文预览。
- 在摘要行展示紧凑的上下文信息（仅在过滤或异常状态下）。
- 用持续高亮表达 `All notes`、`Filter cards`、`Bulk actions`、`Toggle search`、`Subfolders` 等一级按钮的当前激活状态。
- 在 bulk mode 下把批量操作带收敛成 icon-only controls，并把每张卡片的选择入口放到右上角复选框槽位，同时临时隐藏 pin 按钮。
- 在 title / excerpt / meta 这三块非控件区域发射 hover payload，让宿主 Page Preview 体系决定是否显示 popover；按钮、菜单和 bulk checkbox 不参与这条路径。
- 把搜索输入变化回传给 `FolderCardView.ts`。
- 继续处理 viewport、虚拟滚动和工具栏交互。

它们不是搜索状态源，也不参与索引构建。`CardItem.svelte` 的默认点击事件现在只上报 `path`，不再把默认打开目标塞进 props 或 payload。

### `src/view/pipeline.ts`

这里继续承担唯一投影职责：

- `applyTagFilter()` 处理 metadata 级筛选。
- `applySearchFilter()` 在 `orderedPaths !== null` 时采用 indexed ordering，但会把标题命中的非 Markdown 卡片补回结果列表；在 `orderedPaths === null` 时继续走当前排序下的 fallback filtering。
- fallback filtering 仍主要服务 Markdown 内容匹配；非 Markdown 不在这里伪造全文能力。
- `applyPinReorder()` 只对保留下来的卡片做重排。

这里必须保持 `tag -> search -> pin` 的固定顺序。

### `src/search/IndexStore.ts`

这是持久化边界。它把每个 vault 的索引记录存入 IndexedDB，并对恢复、写入、清理返回 typed、no-throw 的结果。它不做查询，也不决定健康状态。

### `src/search/SearchIndexManager.ts`

这是索引编排器。它负责：

- 从 `IndexStore.restore(...)` 恢复历史索引。
- 触发 full build 并持久化 `toJSON()` 结果。
- 应用 create、modify、delete、rename 等增量 mutation。
- 把 folder rename 分类为 `file`、`folder-safe-prefix-rewrite`、`folder-rebuild-required`。
- 发布 `building`、`ready`、`rebuild-required`、错误等健康快照。

它不拥有 view query，也不直接产出 UI。

### `src/search/IndexedSearchService.ts`

这是服务查询边界。它镜像 manager 快照，负责：

- 把 manager 的健康状态翻译成查询 contract。
- 在当前候选路径范围内裁剪结果，避免跨 view 泄漏无关路径。
- 在可用时返回 Markdown 文档的 indexed ordering。
- 在构建中、恢复失败或不可用时返回 `orderedPaths: null`，让调用方继续 fallback。

它不负责为非 Markdown 文件伪造全文索引；这部分能力当前故意留在标题级匹配。

### Release metadata and publishing flow

当前发布链路是：

1. 维护者先用 `npm run release:prepare -- <version> [minAppVersion]` 同步 `package.json`、`manifest.json`、`versions.json`。
2. 本地或 CI 用 `npm run release:check -- <version>` 校验版本 contract。
3. 维护者在版本 bump commit 上创建与 `manifest.json.version` 完全一致的 annotated 裸 semver tag。
4. `.github/workflows/release.yml` 在 tag push 后执行 `check:svelte`、`check`、`build`、`test`。
5. 校验通过后，workflow 用 `gh release create` 生成 draft GitHub Release，并上传 `main.js`、`manifest.json`、`styles.css`。

这条链路的关键边界是：**版本号仍由维护者显式决定，workflow 只负责验证和发布，不负责替你推断下一个版本号，也不负责 changelog 生成。**

## 关键流程设计

### 1. 文件夹选择与基础卡片生成

主流程相较早期的变化是：卡片候选集不再等于 Markdown 文件列表，而是等于受支持文件列表。

- `FolderCardView.ts` 根据 scope 收集 `markdown`、`base`、`canvas`、`excalidraw` 四类受支持文件，并根据现有运行时状态计算仅用于展示的空状态文案（例如搜索无结果时的提示）。
- 视图为每个文件解析 `fileKind`，构建 `baseCards`。
- Markdown 卡片继续读取正文并生成预览；非 Markdown 卡片直接使用占位摘要。
- 结果进入 `pipeline.ts`，得到 `visibleCards`。
- `FolderCardPanel.svelte` 在 `cards.length === 0` 时渲染从 `panel-model` 桥接而来的空状态文案。

### 2. 卡片 hover preview 触发

当前正式链路不是插件自己渲染 preview popover，而是借用宿主 Page Preview：

1. `CardItem.svelte` 只在 title / excerpt / meta 这三块非控件区域监听鼠标进入。
2. 组件把 `path`、当前 DOM 元素和 `MouseEvent` 作为 `CardHoverLinkPayload` 上报。
3. `FolderCardView.ts` 继续作为唯一桥接层，把它转成 `workspace.trigger("hover-link", ...)`。
4. Obsidian 或对应文件类型插件决定最终是否展示 popover，以及展示什么内容。

这条链路的关键约束是：**插件只负责发射 `hover-link`，不自己实现第二套卡片 hover 预览器。**

### 3. 搜索 query 进入运行时

当前搜索主流程是：

1. 面板接收用户输入。
2. `FolderCardView.ts` 更新 runtime-only `searchQuery`，按当前视图范围做 debounce。
3. 视图向 plugin-owned `SearchService` 发起 query，请求里带上 query、scope 和当前 candidate paths。
4. `IndexedSearchService` 若处于 ready，则返回 Markdown 文档的 candidate-bounded `orderedPaths`。
5. 若服务返回 `orderedPaths: null`，视图继续走 fallback filtering。
6. `pipeline.ts` 按 `tag -> search -> pin` 顺序投影 `visibleCards`；其中非 Markdown 卡片只在标题命中时被纳入搜索结果。
7. `panel-model` 把最新 cards、query、status 投影给面板。

### 4. 索引恢复、构建与增量更新

索引层主流程是：

1. 插件启动时，`main.ts` 初始化 store、manager 和 service。
2. manager 先尝试 restore 已持久化索引。
3. 若 restore 成功，发布 `ready` 快照并允许 indexed 查询。
4. 若 restore 失败、版本漂移或数据损坏，切到 full build 或 `rebuild-required` 路径。
5. vault mutation 到来时，manager 尝试做增量应用。
6. 对无法安全前缀改写的 folder rename，manager 直接发布 `rebuild-required`，避免继续服务脏路径。
7. `main.ts` 在 unsafe 快照上调度 plugin-owned rebuild，并保持单路径快照分发。

### 5. 可见卡片投影

当前正式链路是：

```text
baseCards
  -> applyTagFilter
  -> applySearchFilter
  -> applyPinReorder
  -> visibleCards
```

必须保持的语义：

- tag filter 先于 search filter。
- search filter 先于 pin reorder。
- pin 只改顺序，不恢复被前序步骤过滤掉的卡片。
- `orderedPaths: null` 表示 fallback filtering。
- `orderedPaths: []` 表示 indexed-ready 零结果。
- Markdown 卡片可参与全文级匹配。
- 卡片内轻量 preview 与 hover popover 是两条不同 contract：前者由 `markdown-utils.ts` 生成并只服务卡片表面，后者由 `hover-link` 交给宿主或对应插件决定。 
- `base`、`canvas`、`excalidraw` 当前只参与标题级匹配，不伪装成全文命中。
- 卡片右键菜单的动作集现在被刻意压缩；如果未来要恢复系统层动作，必须先证明它们属于高频工作流，而不是调试或边缘操作。

### 6. 单卡删除与批量删除统一遵循宿主偏好

当前删除链路分成两个入口，但共享同一条宿主偏好语义：

1. 单卡右键 `Delete` 由 `FolderCardView.ts` 先走确认，再委托到 `note-ops.ts` 的偏好删除 helper。
2. 工具栏 `bulk-delete-selected` 由 `FolderCardView.ts` 做 live file 过滤、确认提示与结果汇总，再批量委托到同一类 helper。
3. `note-ops.ts` 最终通过 `app.fileManager.trashFile(...)` 执行删除。
4. 最终是移动到系统回收站还是永久删除，由 Obsidian `Files & Links` 偏好决定。

这里的关键约束是：插件不再维护“单删一套、批删一套”的删除语义，更不再把 `Delete` 固定解释为永久删除。

### 7. 默认卡片点击与显式打开动作分层

当前打开链路把“默认点击”和“显式动作”拆成两层：

1. `CardItem.svelte` 的默认点击、Enter、Space 只上报 `path`。
2. `FolderCardView.ts` 收到默认打开事件后，直接调用 `plugin.openNoteFromCard(path)`，不再从 settings 或 panel state 推导默认 destination。
3. `main.ts` 的 `openNoteFromCard(path, destination?)` 在 `destination` 缺省时执行 main-editor-area 规则：先检查 `getMostRecentLeaf(rootSplit)`；如果这个最近 root leaf 可承载文件，则复用它，若它已 pin，则改为 `getLeaf(true)` 新开一个 tab。
4. 如果最近 root leaf 不可承载文件，则回退到活动 root Markdown leaf，再回退到现有 root Markdown leaf；仍然没有合适目标时才新建一个 new tab。
5. “更多”菜单只保留最小显式动作集合：三个打开动作 `new-tab`、`split-right`、`new-window`，加上 `make-copy`、`move`、`copy-note-content`（仅 Markdown）、`rename`、`delete`。
6. `split-right` 仍只从现有 root editor leaf 派生；`new-window` 继续委托给 `openPopoutLeaf()`，若宿主不支持则只给出 desktop-only notice。
7. `Copy path`、系统壳打开与 `Check file stats` 已从卡片菜单层移除，避免把宿主外壳细节和低频诊断动作继续塞进主交互面。

这里的关键约束是：**默认点击语义不再是设置项，而是宿主对齐策略；显式菜单动作才是用户主动选择的 destination。**

## 数据流与状态映射

### 插件级持久化状态

来源是 `PluginSettings`：

- `sort`
- `filter.tags`
- `pinnedPaths`
- `includeSubfolders`
- `defaultView`
- `previewLines`
- `lastFolderPath`
- `lastViewMode`

这里 **没有 `searchQuery`**。这是当前明确的架构决定。

### 插件级搜索持久化状态

来源是 `IndexStore` 持久化记录：

- per-vault metadata
- `documentCount`
- `lastIndexedAt`
- `serializedIndexJson`

这层只负责索引恢复，不承担视图查询状态。

### 视图级运行时状态

来源是 `FolderCardView.ts`：

- `folderPath`
- `baseCards`
- `visibleCards`
- `selectedPath`
- `generation`
- bulk state
- `searchQuery`
- `searchStatus`
- 当前查询对应的 `orderedPaths`
- 每张卡片的 `fileKind`

搜索状态属于这一层，因为它和当前 view 的 scope、候选卡片、debounce 以及 generation 强相关。

### 面板订阅状态

来源是 `panel-model`：

- cards、selection、loading、generation
- sort、tag filter、pinnedPaths、previewLines
- bulk mode 及其派生能力
- `searchQuery`、`searchStatus`

面板读这些状态，但不拥有它们。默认点击语义已经不在这层存储。

## 关键约束与假设

- `hover-link` 是当前唯一允许的卡片 hover preview 集成路径；不要在 `CardItem.svelte` 或 `FolderCardView.ts` 旁边再长出一套自建 popover。
- `previewLines` 是文本块与 fenced code block 共享的顺序预算；任何想调整 preview 样式或抽取规则的改动，都必须同时评估解析层和 excerpt CSS 的物理预算。 


1. 不要把 `searchQuery` 写回 `PluginSettings`。
2. 不要让 `SearchService` 绕开 `pipeline.ts` 直接控制最终可见卡片。
3. 不要把“支持进卡片流”和“支持全文索引”混成一回事；当前只有 Markdown 继续承担全文预览与全文索引。
4. 不要把轻量 preview 当成完整 Markdown renderer；强调语法当前已被刻意拍平成普通文本，避免浏览器默认 `<strong>` / `<em>` 样式重新进入卡片摘要。
5. 不要让 `orderedPaths: null` 和空数组的语义做混。
6. 不要让 folder rename 的 unsafe 路径继续静默服务旧索引，应明确升级到 `rebuild-required`。
7. 不要破坏 row projection、虚拟滚动、滚动锚定、hydrate-range、generation guards、debounced vault observers。
8. 文件类型标题图标优先保持在 Obsidian 官方 Lucide icon name contract 内，不要把截图、栅格图片或自定义图像注入 card title icon slot。
9. bulk delete 的最终行为必须继续尊重 Obsidian `fileManager.trashFile` 和宿主偏好，不要在插件里重新发明删除语义。
10. `Toolbar.svelte` 仍有已知非阻塞 a11y warnings，这属于后续 UI 收尾，不代表 Phase 3 未完成。
11. 当前没有真实 Obsidian 宿主内手动 QA 结果，F3 的关闭建立在用户批准豁免基础上，不应被文档误写成已完成 in-app 验证。
12. 默认卡片点击不是持久化设置；真正的默认打开语义现在直接由 `main.ts` 统一控制，而且目标是主编辑区里最近使用、可承载文件的 root leaf。不能把 leaf 选择或默认 destination 再散回 Svelte 组件、panel-model 或 settings。
13. GitHub Release tag 必须是与 `manifest.json.version` 完全一致的裸 semver；为避免仓库内版本漂移，当前也要求 `package.json.version` 与 `versions.json[version]` 一起对齐。不要只改一个文件就直接打 tag。
14. Release workflow 依赖 GitHub Actions 的 `contents: write` 与仓库级 `Read and write` workflow permissions；如果权限不满足，问题应先归因为仓库设置，而不是脚本或插件运行时。

## 历史问题与折中

`2026-03-24` 的决策先把搜索预留在 pipeline 接缝里，当时真正重要的是统一投影链路。

`2026-04-18` 的 readiness 决策把 ownership、query contract 和 panel bridge 锁定下来，避免后续 indexed 搜索接入时状态失控。

Phase 3 的最终收尾又把这套接缝推进成真正可运行的 indexed 搜索架构。这里的折中很明确：

- 我们接受 indexed 搜索依赖本地 IndexedDB 和 MiniSearch。
- 我们保留 fallback 路径，不把单一搜索模式当成唯一真相。
- 我们接受混合文件类型卡片与 Markdown-only 全文搜索并存的非对称模型，而不是为了“统一”提前引入脆弱的多格式正文抽取。
- 我们对 unsafe folder rename 采用保守 rebuild-required 策略，而不是尝试高风险路径修补。
- 我们把 bulk delete 委托给 Obsidian 删除偏好，而不是在插件里硬编码“永久删除”。
- 我们在缺少 Obsidian 宿主的环境里，以仓库验证通过和用户豁免作为 F3 关闭条件。

## 优化与演进机会

1. 在不改变 ownership 的前提下，继续补强 ranking、tokenizer 或 rebuild UX。
2. 如果未来要让 `base`、`canvas`、`excalidraw` 参与更深层搜索，应先定义稳定的内容抽取 contract，再考虑扩展 manager / service，而不是直接在 UI 层拼解析。
3. 为真实 Obsidian 宿主补 manual QA 流程，把当前豁免状态转换成已执行证据。
4. 单独处理 `Toolbar.svelte` 的 a11y warnings，尤其是 folder menu item 与 chevron 的键盘可达性，减少 build/test 输出噪音。
5. 如后续继续扩展索引能力，优先补 manager 和 service 层，不要把索引细节散入 view 层。
6. 如果未来要补 changelog、自动版本推断或发布 PR，优先在当前 tag-driven workflow 外侧增加能力，不要破坏已经固定的版本对齐和 release asset contract。

## Related decisions

- `docs/decisions/2026-03-24-panel-owned-card-projection-and-interactions.md`
- `docs/decisions/2026-04-03-migrate-to-svelte-5-with-legacy-component-api.md`
- `docs/decisions/2026-04-04-row-projected-responsive-card-wall.md`
- `docs/decisions/2026-04-18-finish-svelte-5-host-and-component-seam.md`
- `docs/decisions/2026-04-18-phase3-search-architecture-readiness.md`
- `docs/decisions/2026-04-18-close-phase3-indexed-search-capability.md`
- `docs/decisions/2026-04-23-toolbar-ui-optimization.md`
- `docs/decisions/2026-04-24-support-mixed-file-kind-cards-with-markdown-only-indexing.md`
- `docs/decisions/2026-04-24-keep-file-kind-icons-on-official-obsidian-lucide-icons.md`
- `docs/decisions/2026-04-25-constrain-card-note-opens-to-main-editor-surfaces.md`
- `docs/decisions/2026-04-25-adopt-tag-driven-github-release-automation.md`
