# START HERE

## 这个项目现在在解决什么问题？

`Folder Card Explorer` 是一个 Obsidian 插件。它把“在文件管理器里点文件夹”这件事，转换成右侧侧边栏里的卡片流浏览体验，让用户可以在不离开当前笔记上下文的情况下快速预览、筛选、排序、置顶并打开一组笔记。

当前它已经不只是“文件夹点击 → 卡片预览”原型，而是进入了**可持续扩展的功能型 MVP**：基础浏览链路稳定，响应式 card wall、范围入口收口、设置持久化、增量刷新和卡片级操作已经成型，后续工作主要集中在批量操作、搜索索引和视觉/可访问性收尾。

## 当前处于什么阶段？

项目处于 **功能骨架已稳定、继续向完整工作台演进** 的阶段。

- 已实现：文件夹点击联动、右侧视图、**row-projected 响应式 card wall**、虚拟滚动、懒加载 hydration、增量刷新、面板内文件夹选择、`All Notes`、新建笔记、排序、标签筛选、置顶、卡片右键操作、复制、单条移动，以及 **Toolbar 内可见的 scope / tag filter / includeSubfolders 状态提示**。
- 已规划但未落地：批量选择/批量操作、搜索索引（Plan E / IndexedDB + MiniSearch）、视觉一致化、i18n / a11y。

## 回来看代码前先记住这 3 件事

1. **性能约束是真的，不是装饰。** 视图现在依赖 row-projected virtualization、视口驱动 hydration、generation 防陈旧结果、约 250ms debounce 的 vault 观察者。不要轻易把任何功能改回“全量重建 + 全量渲染”。
2. **`FolderCardView` 是运行时中枢，Svelte 组件不是状态源。** 项目现在运行在 **Svelte 5 + legacy component API compatibility** 上，但 `FolderCardPanel.svelte` / `Toolbar.svelte` / `CardItem.svelte` 仍保持“负责展示和事件抛出”的角色；真正的数据采集、状态推进、Obsidian API 交互、设置持久化都在 `src/view/FolderCardView.ts` 和 `src/main.ts`。T32 之后连 `includeSubfolders` 这样的范围开关也只是由 Toolbar 抛事件、再由 `FolderCardView` 决定是否持久化和刷新。
3. **筛选与置顶已经进入统一投影链路。** 当前可见卡片不是“原始列表”，而是 `baseCards -> tag filter -> search placeholder -> pin reorder -> visibleCards`。置顶只改变顺序，不绕过筛选。

## 系统大致怎么拼起来的

- `src/main.ts`
  - 插件入口。
  - 注册右侧视图、文件管理器点击监听、`file-open` 同步、vault 观察者、设置读写。
  - 负责把“外部事件”转成视图选择请求和刷新请求。
- `src/view/FolderCardView.ts`
  - 运行时核心。
  - 负责收集 Markdown 文件、排序、构建文件夹树、维护 `baseCards` / `visibleCards` / 选中项 / generation、处理增量刷新、推送状态到面板。
- `src/view/FolderCardPanel.svelte`
  - 负责响应式 row projection、虚拟滚动、滚动锚定、可见范围计算、向上抛出 `hydrate-range` / `sort-change` / `filter-change` / `include-subfolders-change` / `pin-toggle` 等事件。
  - 当前由 Svelte 5 编译，但通过 `compatibility.componentApi = 4` 继续兼容宿主侧 `new / $on / $set / $destroy` 接口。
- `src/view/row-projection.ts`
  - 负责 card -> row 的纯计算：列数、顺序分行、hydrate range 映射、offset lookup。
- `src/view/Toolbar.svelte` 与 `src/view/CardItem.svelte`
  - 前者承载顶部操作入口和菜单，并用一行紧凑 summary 明示当前 scope、tag filter 是否生效，以及在 folder scope 下的 `includeSubfolders` 状态；后者承载单卡片 UI、打开笔记、右键菜单、pin/unpin。
- `src/view/pipeline.ts`
  - 纯函数投影层。当前已接入 tag filter 和 pin reorder，搜索步骤仍是 pass-through 占位。
- `src/settings.ts`
  - 统一设置 schema 与归一化入口，当前关键字段包括 `sort`、`filter.tags`、`pinnedPaths`、`includeSubfolders`、`lastFolderPath`、`lastViewMode`。
- `src/view/metadata-utils.ts` / `src/view/note-ops.ts`
  - 前者处理 metadata/tag/search 基础能力，后者处理复制、移动、删除、批量操作等笔记级动作。

## 一条主流程怎么走

以“用户在文件管理器点击一个文件夹”为例：

1. `src/main.ts` 监听文档点击，识别 `.nav-folder-title` 对应路径。
2. 插件激活或复用右侧 `FOLDER_CARD_VIEW`，向视图分发选择请求。
3. `FolderCardView` 收集目标范围内 Markdown 文件，按设置排序并生成 `baseCards`。
4. `runPipeline()` 计算 `visibleCards`；同时派生可用标签、选中态、置顶态等 UI 状态。
5. `FolderCardPanel.svelte` 根据滚动位置和当前宽度把卡片投影成 rows，只渲染窗口区 rows，并把可见 rows 再映射成卡片范围请求 hydration。
6. 点击卡片后，插件在主编辑区域打开对应笔记，并把选中态同步回卡片视图。

## 怎么运行与做基本验证

安装依赖：

```bash
npm install
```

开发与验证：

```bash
npm run check
npm run build
npm test
```

如果只是本地开发观察插件构建：

```bash
npm run dev
```

## 当前最重要的配置值

- `sort.field` / `sort.direction`：控制卡片排序。
- `filter.tags`：标签筛选条件；当前语义是 **AND**。
- `pinnedPaths`：置顶笔记路径列表；只影响顺序，不恢复已被过滤的卡片。
- `includeSubfolders`：数据采集层开关，默认 `true`。现在它已经通过 Toolbar 中的 folder-scope-only 控件接入，但在 `All Notes` 模式下不会显示伪造的 on/off 状态。
- `lastFolderPath` / `lastViewMode`：用于恢复上次会话。

## 当前风险 / 阻塞 / 下一步

- **搜索还没有真正接入。** `src/view/pipeline.ts` 的 `applySearchFilter()` 仍是占位实现；后续实现以 `docs/plan/v1-development-plan.md` 为主，不再依赖缺失的 `docs/dev-feature/` 任务文档。
- **Phase 1 已完成（T31/T32/T33）。** 响应式 card wall、范围入口提示与回归加固均已落地；下一步应继续推进 Phase 2 的多选与批量操作能力。
- **`includeSubfolders` 现在有 UI 入口，但语义只在 folder scope 下成立。** 未来如果继续扩展范围切换，必须保留“`All Notes` 不展示误导性 toggle 状态”这个约束。
- **批量操作仍停留在计划层。** `note-ops.ts` 已有部分批量能力，但多选框架和用户可见入口尚未完成。
- **产品路线需要统一口径。** 当前已补充 `docs/roadmap/v1-product-roadmap.md`，后续应按“card-wall-first workbench”边界推进，而不是滑向综合导航平台。
- **现有规划文档很多，且混合了“已实现”和“未来任务”。** 回来看项目时，不要从缺失的 `docs/dev-feature/` 路径开始；先读本文件、`docs/architecture.md`，再读 `docs/plan/v1-development-plan.md`。
- **`Toolbar.svelte` 仍有已知 a11y warnings。** 当前 `npm run build` 会给出若干可访问性告警，但不影响 T31 的 check/build/test 通过；这部分应在后续 a11y 收尾任务中系统处理。
- **preview 裁切预算现在有额外约束。** `previewLines` 不只是 parser 的逻辑预算，也是 excerpt 的物理高度预算。`styles.css` 中 `.fce-excerpt` 内部不要再随意加会额外占高的 `margin`、`padding`、`border`，否则很容易重新出现最后一行被裁切的问题。
- **Svelte 已升级到 5，但还没有做 runes 级源码迁移。** 现阶段的设计目标是先把运行时与构建链路升级到 Svelte 5，同时保留现有组件语法与宿主集成接口，避免把框架升级和视图模型重写绑在一次改动里。

## 接下来先读哪里

1. `docs/architecture.md` —— 建立稳定的系统模型。
2. `docs/decisions/2026-04-03-migrate-to-svelte-5-with-legacy-component-api.md` —— 理解为什么这次只升级到 Svelte 5 运行时/编译器，而不同时重写成 runes 模式。
3. `docs/decisions/2026-03-24-panel-owned-card-projection-and-interactions.md` —— 理解最近一轮结构性变化的原因。
4. `docs/decisions/2026-04-04-row-projected-responsive-card-wall.md` —— 理解为什么响应式多列是通过 row projection 落地，而不是回退到整列表或 masonry。
5. `docs/decisions/2026-04-09-toolbar-scope-summary-and-folder-only-subfolder-toggle.md` —— 理解为什么 `includeSubfolders` 现在只在 folder scope 下显示，以及为什么状态归属仍然在 `FolderCardView`。
6. `docs/roadmap/v1-product-roadmap.md` —— 先理解 V1 想把产品推进到哪里，以及明确不做什么。
7. `docs/plan/v1-development-plan.md` —— 需要继续推进 V1 实现时，优先按这里的阶段、依赖和验收标准执行。
8. `src/main.ts` → `src/view/FolderCardView.ts` → `src/view/FolderCardPanel.svelte` → `src/view/row-projection.ts` —— 按运行链路阅读代码。
9. `docs/explore/README.md` 与 `docs/explore/notebook-navigator.md` —— 需要外部对标与方案参考时再读。
10. `dev_plan.md` —— 只在你要追溯历史任务拆分时再读，不要把缺失的 `docs/dev-feature/` 当成当前执行入口。
