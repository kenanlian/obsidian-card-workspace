# START HERE

## 这个项目现在在解决什么问题？

`Folder Card Explorer` 是一个 Obsidian 插件。它把文件管理器里的文件夹选择，转换成右侧侧边栏里的卡片流浏览体验，让用户能在当前笔记上下文里快速预览、筛选、置顶、搜索并打开一组笔记。

现在的重点不是继续做 Svelte 迁移，而是把卡片工作台补到可持续演进的产品状态。`phase3 search architecture readiness` 已经完成，这意味着搜索已经接到正式运行时接缝里，但当前仍是 **readiness seam**，不是完整全文索引方案。

## 当前处于什么阶段？

项目处于 **Svelte 5 宿主接缝稳定，phase3 搜索架构 readiness 已完成，准备进入后续搜索能力扩展** 的阶段。

- 已完成：`main.ts` 拥有 plugin-owned `SearchService` 生命周期，默认实例是 `NoIndexSearchService`。
- 已完成：`FolderCardView.ts` 持有 per-view、runtime-only 的 `searchQuery` 与 `searchStatus`，并把状态桥接到 `panel-model`。
- 已完成：`pipeline.ts` 不再把搜索当成 placeholder，当前正式链路是 `baseCards -> tag filter -> search filter -> pin reorder -> visibleCards`。
- 已完成：当前构建和测试通过，标准验证结果是 `npm run check`、`npm run build`、`npm test` 通过。
- 当前边界：还没有引入 IndexedDB、MiniSearch、rebuild commands、worker、ranking/tokenizer，也没有把 query 持久化到 settings。

## 回来看代码前先记住这 3 件事

1. **搜索查询是 runtime-only，而且是 per-view。** `searchQuery` 不写入 `PluginSettings`，也不是 plugin-global 状态。当前真值在 `FolderCardView.ts`，面板只消费投影状态。
2. **`pipeline.ts` 仍是唯一可见卡片投影链路。** 搜索已经接到这条链上，但 pin 仍只负责重排，不绕过 tag filter 或 search filter。
3. **`SearchService` 现在只是 fallback-first、no-index seam。** `main.ts` 持有服务生命周期，`orderedPaths: null` 代表继续使用本地 fallback filtering，不代表已有索引实现。

## 系统大致怎么拼起来的

- `src/main.ts`
  - 插件入口与运行时外壳。
  - 负责视图注册、设置读写、vault 事件转发、`SearchService` 初始化与销毁。
- `src/view/FolderCardView.ts`
  - 视图级运行时协调器。
  - 负责 `baseCards`、`visibleCards`、selection、generation、hydration、bulk state，以及当前 view 的 `searchQuery` / `searchStatus`。
- `src/view/panel-model.ts`
  - 宿主持有的面板状态边界。
  - 把 cards、filter、pin、bulk、search 等运行时状态投影给 Svelte 面板。
- `src/view/FolderCardPanel.svelte` 与 `src/view/Toolbar.svelte`
  - 展示与交互表面。
  - 负责把 query/status 显示出来，并把用户输入回传给 `FolderCardView.ts`。
- `src/view/pipeline.ts`
  - 纯函数投影层。
  - 继续负责 tag filter、search filter、pin reorder 的组合顺序。
- `src/search/types.ts` / `src/search/NoIndexSearchService.ts`
  - 搜索服务接缝。
  - 当前提供 lifecycle-safe、fallback-first、no-index 的最小实现。

## 一条主流程怎么走

以“用户在当前视图里输入搜索词”为例：

1. `Toolbar.svelte` 把 query 变化回传给 `FolderCardView.ts`。
2. `FolderCardView.ts` 更新 runtime-only `searchQuery`，先把运行时状态切到 `fallback` 或 `idle`。
3. `FolderCardView.ts` 向 plugin-owned `SearchService` 发起 query，请求里带上 query、scope 和当前 candidate paths。
4. 如果服务返回 `orderedPaths: null`，视图继续走本地 fallback filtering。
5. `runPipeline()` 仍按 `tag -> search -> pin` 顺序投影 `visibleCards`。
6. `panel-model` 把新的 cards、`searchQuery`、`searchStatus` 推给面板，UI 随之更新。

## 怎么运行与做基本验证

安装依赖：

```bash
npm install
```

标准验证：

```bash
npm run check
npm run build
npm test
```

本次文档对应的代码状态里，这三条命令已经通过。

开发观察构建：

```bash
npm run dev
```

## 当前最重要的配置值

- `sort.field` / `sort.direction`：控制卡片排序。
- `filter.tags`：标签筛选条件，语义是 **AND**。
- `pinnedPaths`：置顶笔记路径列表，只影响顺序。
- `includeSubfolders`：folder scope 下的数据采集开关。
- `lastFolderPath` / `lastViewMode`：会话恢复使用。

要特别注意，**没有 `searchQuery` 配置项**。这不是遗漏，而是当前架构边界。

## 当前风险 / 阻塞 / 下一步

- **搜索 readiness 已完成，但完整索引搜索还没开始。** 当前只有 no-index seam 和 fallback-first 行为，不能把它说成已完成全文搜索。
- **`SearchService` 仍是最小实现。** 还没有 IndexedDB、MiniSearch、worker、ranking/tokenizer，也没有 rebuild commands。
- **查询状态仍归 `FolderCardView.ts` 单独持有。** 这是当前刻意保留的边界，后续如果引入 indexed mode，也要先尊重这个 ownership。
- **`Toolbar.svelte` 仍有已知非阻塞 a11y warnings。** 这不影响当前 build/test 通过，但仍是明确待办。
- **后续工作重点** 应是把 indexed search 能力接到现有 seam，而不是重新发明并行搜索链路。

## 接下来先读哪里

1. `docs/architecture.md`
2. `docs/decisions/2026-04-18-phase3-search-architecture-readiness.md`
3. `docs/decisions/2026-04-18-finish-svelte-5-host-and-component-seam.md`
4. `src/main.ts`
5. `src/view/FolderCardView.ts`
6. `src/view/panel-model.ts`
7. `src/view/pipeline.ts`
8. `src/search/types.ts`
