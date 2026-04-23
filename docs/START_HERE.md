# START HERE

## 这个项目现在在解决什么问题？

`Card Workspace` 是一个 Obsidian 插件。它把文件管理器里的文件夹选择转换成右侧侧边栏里的卡片流，让用户在当前笔记上下文中浏览、筛选、置顶、搜索并打开一组笔记。

当前项目的核心目标不是再搭搜索接缝，而是维护一套已经闭环的卡片工作台。`Phase 3 search capability` 已经完成，插件现在同时具备 fallback 搜索路径和 indexed 搜索路径，后续工作应围绕维护、演进和手动验证条件补齐，而不是重新设计搜索 ownership。

## 当前处于什么阶段？

项目处于 **Phase 3 搜索能力已完成并收尾，文档进入长期维护态** 的阶段。

- 已完成：`main.ts` 持有 plugin-global 搜索生命周期，负责 indexed 服务初始化、快照订阅、命令注册和降级回退。
- 已完成：`FolderCardView.ts` 持有 per-view 的 `searchQuery`、debounce、search status，并把结果统一送回 `pipeline.ts`。
- 已完成：`pipeline.ts` 仍是唯一可见卡片投影链路，正式语义是 `baseCards -> tag filter -> search filter -> pin reorder -> visibleCards`。
- 已完成：indexed 搜索相关能力已经具备 `IndexStore`、`SearchIndexManager`、`IndexedSearchService` 这条正式运行时链路。
- 已完成：标准仓库验证是 `npm run check`、`npm run build`、`npm test`。
- 已完成：Toolbar UI 优化，引入可收起搜索行、上下文摘要、一级按钮持续高亮、icon-only bulk strip，以及批量模式下位于卡片右上角的复选框选择入口。
- 已关闭：F3 的真实 Obsidian 手动 QA 因环境缺少可运行宿主而未执行，用户已明确豁免，因此 Phase 3 以仓库验证通过加文档收尾的状态关闭。

## 回来看代码前先记住这 3 件事

1. **搜索查询仍是 runtime-only，而且是 per-view。** `searchQuery` 不写入 `PluginSettings`，真值仍在 `FolderCardView.ts`。
2. **`pipeline.ts` 仍是唯一投影路径。** 搜索服务可以给出 indexed ordering，但最终哪些卡片可见、顺序如何变化，仍由 pipeline 决定。
3. **`orderedPaths` 的语义已经锁定。** `orderedPaths: null` 表示继续走 fallback filtering，`orderedPaths: []` 表示 indexed 搜索已执行且结果为零，不能混用。

## 系统大致怎么拼起来的

- `src/main.ts`
  - 插件入口与全局运行时外壳。
  - 负责视图注册、设置读写、vault 事件转发、indexed 搜索服务初始化、恢复与 rebuild 命令。
- `src/view/FolderCardView.ts`
  - 每个视图实例的运行时协调器。
  - 负责 `baseCards`、`visibleCards`、selection、generation、防陈旧刷新、hydration，以及当前 view 的搜索 query 和状态。
- `src/view/pipeline.ts`
  - 唯一的可见卡片投影层。
  - 负责把 tag filter、search filter、pin reorder 组合成稳定输出。
- `src/search/IndexStore.ts`
  - IndexedDB 持久化边界。
  - 保存每个 vault 的索引元数据和序列化索引体。
- `src/search/SearchIndexManager.ts`
  - 索引编排器。
  - 负责 restore、full build、增量 mutation 应用、健康快照和 `rebuild-required` 判定。
- `src/search/IndexedSearchService.ts`
  - 服务层查询边界。
  - 负责消费 manager 快照、裁剪 candidate paths、返回 indexed ordering，或在不可用时回退。
- `src/view/FolderCardPanel.svelte` / `src/view/Toolbar.svelte` / `src/view/CardItem.svelte`
  - 展示与交互表面。
  - 负责可收起的搜索输入、上下文摘要、一级 toolbar 按钮高亮态、icon-only bulk strip、批量模式复选框，以及标题和摘录命中高亮。

## 一条主流程怎么走

以“用户在当前视图输入搜索词”为例：

1. `Toolbar.svelte` 把 query 变化回传给 `FolderCardView.ts`。
2. `FolderCardView.ts` 更新 runtime-only `searchQuery`，按当前视图范围做 debounce，并向搜索服务发起查询。
3. `IndexedSearchService` 根据当前健康状态决定返回 indexed ordering，或返回 `orderedPaths: null` 让调用方继续 fallback。
4. `pipeline.ts` 先执行 tag filter，再执行 search filter，最后执行 pin reorder。
5. `FolderCardPanel.svelte` 和 `CardItem.svelte` 接收最新 cards、compact status、高亮结果和 bulk selection 状态，UI 更新。

以“vault 发生 unsafe folder rename”为例：

1. `main.ts` 把 mutation 同时转发给视图和搜索服务。
2. `SearchIndexManager` 若无法安全做路径前缀改写，则发布 `rebuild-required` 快照。
3. `main.ts` 只调度一次 plugin-owned rebuild，不重复扇出快照。
4. 视图仍通过单一路径接收搜索快照，避免重复通知和状态漂移。

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

开发观察构建：

```bash
npm run dev
```

当前阶段要明确区分两类验证：

- **仓库验证** 已完成，标准命令通过。
- **真实 Obsidian 手动 QA** 未执行，不是因为实现未完成，而是因为当前环境没有可运行的 Obsidian 宿主，且用户已明确豁免 F3 的这项要求。

## 哪些配置值最重要

- `sort.field` / `sort.direction`：控制卡片排序。
- `filter.tags`：标签筛选条件，语义是 **AND**。
- `pinnedPaths`：置顶笔记路径列表，只影响顺序。
- `includeSubfolders`：folder scope 下的数据采集开关。
- `lastFolderPath` / `lastViewMode`：会话恢复使用。

需要特别注意：**没有 `searchQuery` 配置项。** 搜索 query 仍是当前视图的运行时状态，不属于插件设置。

## 当前风险 / 阻塞 / 下一步

- **F3 已关闭，但真实宿主手动验证仍是已知空白。** 这是用户批准的收尾条件，不是架构未知项。
- **indexed 搜索已经存在，但边界不能被随意打破。** 后续改动必须继续尊重 `main.ts`、`FolderCardView.ts`、`pipeline.ts`、`SearchIndexManager` 之间的 ownership。
- **`orderedPaths` contract 不能漂移。** `null` 与空数组代表不同语义，测试和文档都已锁定。
- **unsafe folder rename 会触发 rebuild-required。** 这是刻意选择的保守策略，用来避免脏路径继续对外服务。
- **`Toolbar.svelte` 仍有已知非阻塞 a11y warnings。** 当前主要在 folder menu item 与展开 chevron 的非语义点击元素上；这不是本次 UI 优化的阻塞项，但仍是后续整理点。

## 接下来先读哪里

1. `docs/START_HERE.md`
2. `docs/architecture.md`
3. `docs/decisions/2026-04-23-toolbar-ui-optimization.md`
4. `docs/decisions/2026-04-18-close-phase3-indexed-search-capability.md`
5. `docs/decisions/2026-04-18-phase3-search-architecture-readiness.md`
6. `src/main.ts`
7. `src/view/FolderCardView.ts`
8. `src/view/Toolbar.svelte`
9. `src/view/pipeline.ts`
10. `src/search/SearchIndexManager.ts`
11. `src/search/IndexedSearchService.ts`
