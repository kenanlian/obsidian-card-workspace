# START HERE

## 这个项目现在在解决什么问题？

`Folder Card Explorer` 是一个 Obsidian 插件。它把文件管理器里的文件夹选择，转换成右侧侧边栏里的卡片流浏览体验，让用户能在当前笔记上下文里快速预览、筛选、排序、置顶并打开一组笔记。

现在的重点已经不是完成 Svelte 5 迁移本身。迁移已经收尾，项目重新回到产品能力推进阶段，接下来主要补批量操作、搜索，以及视觉和 a11y 收尾。

## 当前处于什么阶段？

项目处于 **Svelte 5 标准化迁移已完成，继续向完整工作台演进** 的阶段。

- 已完成：宿主侧 `FolderCardView.ts` 改用 `mount/unmount`，`FolderCardPanel.svelte`、`Toolbar.svelte`、`CardItem.svelte` 改到标准 Svelte 5 组件模式，`panel-model` 成为宿主与面板之间的状态边界。
- 已完成：`compatibility.componentApi = 4` 已从构建和测试配置移除，仓库不再依赖 legacy component API compatibility。
- 已完成：测试与验证链路补齐，Vitest 分成 node 和 jsdom 两条 lane，真实 `.svelte.test.ts` 运行时覆盖已经落地，`.github/workflows/ci.yml` 会在 Node 20 上执行 `npx svelte-check --tsconfig ./tsconfig.json`、`npm run check`、`npm run build`、`npm test`。
- 下一阶段：继续推进批量选择与批量操作、搜索接入、视觉一致性和 `Toolbar.svelte` 的 a11y 收尾。

## 回来看代码前先记住这 3 件事

1. **性能约束是真的。** 视图依赖 row-projected virtualization、视口驱动 hydration、generation 防陈旧结果、debounced vault 观察者。不要把任何能力改回全量重建和全量渲染。
2. **`FolderCardView` 仍是运行时中枢，但 Svelte 接缝已经换了。** 现在不是 `new / $set / $on / $destroy`，而是 `FolderCardView.ts` 用 `mount/unmount` 管理根面板，并通过 `src/view/panel-model.ts` 推送状态。Svelte 组件负责展示和交互回调，不是主状态源。
3. **可见卡片仍走统一投影链路。** 当前语义还是 `baseCards -> tag filter -> search placeholder -> pin reorder -> visibleCards`。置顶只改顺序，不绕过筛选。

## 系统大致怎么拼起来的

- `src/main.ts`
  - 插件入口。
  - 注册右侧视图、文件管理器点击监听、`file-open` 同步、vault 观察者、设置读写。
  - 负责把外部事件转换成视图选择请求和刷新请求。
- `src/view/FolderCardView.ts`
  - 运行时核心。
  - 负责收集 Markdown 文件、排序、构建 `baseCards`、维护选中项与 generation、处理增量刷新。
  - 负责创建 `panel-model`，并用 `mount/unmount` 把状态和回调接到根面板。
- `src/view/panel-model.ts`
  - 宿主持有的面板状态边界。
  - 把 `cards`、筛选状态、范围状态、批量操作状态等聚合成一份可订阅模型，替代旧的 `$set(...)` 推送。
- `src/view/FolderCardPanel.svelte`
  - 根面板与视口层。
  - 基于标准 Svelte 5 模式消费 `panelModel`，负责 row projection、虚拟滚动、滚动锚定、hydrate range 转发，并组合 `Toolbar.svelte` 与 `CardItem.svelte`。
- `src/view/Toolbar.svelte` 与 `src/view/CardItem.svelte`
  - 都已经迁移到标准 Svelte 5 组件契约，使用 `$props()`、callback props 和 runes 相关用法。
  - 前者承载顶部操作入口和范围摘要，后者承载单卡片 UI、打开笔记、右键菜单、pin toggle。
- `src/view/pipeline.ts`
  - 纯函数投影层，继续负责筛选和 pin 重排。搜索仍是占位。

## 一条主流程怎么走

以“用户在文件管理器点击一个文件夹”为例：

1. `src/main.ts` 监听文档点击，识别 `.nav-folder-title` 对应路径。
2. 插件激活或复用右侧 `FOLDER_CARD_VIEW`，把选择请求交给 `FolderCardView`。
3. `FolderCardView` 收集目标范围内 Markdown 文件，按设置排序并生成 `baseCards`。
4. `runPipeline()` 计算 `visibleCards`，并把标签、范围、批量选择、置顶等状态写入 `panel-model`。
5. `FolderCardPanel.svelte` 订阅模型，把卡片投影成 rows，只渲染窗口区，并通过回调把 `hydrate-range`、排序、筛选、范围切换等用户动作送回宿主。
6. 点击卡片后，插件在主编辑区域打开对应笔记，并把选中态同步回卡片视图。

## 怎么运行与做基本验证

安装依赖：

```bash
npm install
```

本地验证：

```bash
npx svelte-check --tsconfig ./tsconfig.json
npm run check
npm run build
npm test
```

如果只是开发观察构建：

```bash
npm run dev
```

需要留意的是，Vitest 现在分成两条 lane：

- node lane 继续跑纯逻辑和 mock 驱动测试。
- jsdom lane 负责真实 `.svelte.test.ts` 运行时测试，以及 `src/view/FolderCardView.test.ts` 这种宿主接缝验证。

## 当前最重要的配置值

- `sort.field` / `sort.direction`：控制卡片排序。
- `filter.tags`：标签筛选条件，语义是 **AND**。
- `pinnedPaths`：置顶笔记路径列表，只影响顺序。
- `includeSubfolders`：数据采集层开关，只在 folder scope 下对用户可见。
- `lastFolderPath` / `lastViewMode`：用于恢复上次会话。

## 当前风险 / 阻塞 / 下一步

- **迁移已经完成，不再把 compatibility mode 当成现状。** 之后如果继续改 Svelte 视图，默认按标准 Svelte 5 宿主/组件接缝扩展，不要重新引入 `new / $set / $on / $destroy` 语义。
- **搜索还没有真正接入。** `src/view/pipeline.ts` 的搜索步骤仍是占位，这会影响后续工作台能力的完整性。
- **批量操作还缺用户可见框架。** `note-ops.ts` 已有部分动作能力，但多选工作流和入口还没完成。
- **`Toolbar.svelte` 仍有非阻塞 a11y warnings。** 这不是迁移失败，只是后续视觉和可访问性收尾的明确待办。
- **产品重心已经切回功能演进。** 后续优先顺序是批量操作、搜索、视觉一致性、a11y，而不是继续做框架迁移。

## 接下来先读哪里

1. `docs/architecture.md`
2. `docs/decisions/2026-04-18-finish-svelte-5-host-and-component-seam.md`
3. `docs/decisions/2026-04-03-migrate-to-svelte-5-with-legacy-component-api.md`
4. `src/main.ts`
5. `src/view/FolderCardView.ts`
6. `src/view/panel-model.ts`
7. `src/view/FolderCardPanel.svelte`
8. `src/view/pipeline.ts`
