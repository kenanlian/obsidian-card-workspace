# V1 Development Plan

## TL;DR

这份计划把 `docs/roadmap/v1-product-roadmap.md` 细化为 **后续 AI agent 可直接执行的 V1 开发计划**。它的目标不是重复路线图，而是明确：**当前基线已经做到哪里、后续阶段该按什么顺序推进、每一段应该改哪些文件、必须守住哪些约束、以及怎样判断真的做完了。**

这份文档是 V1 执行阶段的 **canonical execution plan**。

### 方向理解时的阅读顺序

1. `AGENTS.md`
2. `docs/architecture.md`
3. `docs/roadmap/v1-product-roadmap.md`
4. 本文档
5. `dev_plan.md`

### 真正开始执行时的优先级

1. 本文档
2. `docs/roadmap/v1-product-roadmap.md`
3. `AGENTS.md`
4. `docs/architecture.md`
5. `dev_plan.md`（仅作历史拆分参考，不再作为执行入口）

> 注意：路线图里引用的 `docs/dev-feature/task-18...task-30` 目前仓库中并不存在。后续执行不要等待这些文件出现；本文档已经把这些缺失引用收口成一个自包含计划。

> [!CAUTION]
> **本文档中的 Phase 3 搜索规划已属于历史存档，不再代表当前实现。**
>
> 仓库当前正式行为以 `AGENTS.md`、`docs/architecture.md`、`docs/decisions/2026-04-18-close-phase3-indexed-search-capability.md` 和 `docs/decisions/2026-05-08-adopt-indexed-only-search-architecture.md` 为准。
> 本文档后文若提到 fallback / 降级搜索，仅用于保留当时的规划背景；当前产品已经转向 **indexed-only** 搜索，不再支持非索引模式下的非空查询 fallback。

---

## 1. 计划目标与适用范围

这份计划服务于一个明确目标：

> **把 Card Workspace 推进成一个以响应式 card wall 为核心的 Obsidian 侧边栏工作台。**

它覆盖 V1 剩余开发，不覆盖已完成能力的重做，也不覆盖 V2 方向探索。

### 这份计划解决什么问题

- 给未来 AI agent 一个 **不依赖缺失文档** 的执行入口。
- 把产品语言拆成 **可实现、可验证、可停手** 的工程任务。
- 明确哪些能力已经存在，避免重复开发。
- 把文件落点、依赖顺序、风险和验收门槛写清楚。

### 明确不解决什么

- 不把插件扩展成 `Notebook Navigator` 风格的综合导航平台。
- 不把卡片墙升级为多编辑器宿主。
- 不引入网络服务、云索引、远程同步或外部后端。
- 不在没有规模证据之前提前复制重型 provider/service/cache 架构。

---

## 2. 当前基线（已实现，不要重做）

后续 agent 必须把下面这些能力视为 **当前稳定基线**。除非任务明确要求修改，否则不要重构或替换它们。

### 2.1 产品层已具备的能力

- 文件管理器点击联动右侧 `FOLDER_CARD_VIEW`
- 面板内 folder picker
- `All Notes` 视图
- 新建笔记
- 排序（`mtime` / `ctime` + `asc` / `desc`）
- 标签筛选
- 置顶（pin/unpin）
- 单卡片复制全文到剪贴板
- 单卡片移动到目标文件夹

### 2.2 架构层已具备的能力

- `FolderCardView.ts` 是运行时协调中心
- `pipeline.ts` 已经是统一可见卡片投影挂点
- generation-based stale-result protection
- 视口驱动 hydration
- 虚拟滚动
- scroll anchoring
- debounced vault observers
- 增量刷新主路径

### 2.3 工具层已具备但用户工作流还未闭环的能力

- `src/view/note-ops.ts` 已有 `batchMoveFiles()`
- `src/view/note-ops.ts` 已有 `batchTrashFiles()`
- `src/view/note-ops.ts` 已有 `batchDeleteFiles()`
- `src/view/note-ops.ts` 已有 `mergeNotes()`
- `src/view/pipeline.ts` 已保留 `applySearchFilter()` 挂点，但当前仍是 pass-through
- `src/settings.ts` 已持久化 `includeSubfolders`，但 Toolbar 没有显式入口
- `src/view/Toolbar.svelte` 已有 `bulk` action 占位，但 `FolderCardView.ts` 还没有对应工作流

### 2.4 需要冻结的现有语义

- tag filter 继续保持 **AND semantics**
- pin 继续只影响顺序，不绕过 tag filter / search filter
- `selectedPath` 继续只表示“当前活动笔记 / 编辑器同步高亮”
- 后续 Phase 2 新增的 `selectedPaths` 仅用于 bulk selection，不能替代 `selectedPath`
- `includeSubfolders` 只作用于 folder scope；在 `All Notes` 模式下视为无效

---

## 3. 执行总原则

### 3.1 必须保留的架构约束

1. **性能优先**
   - 不能回退到整列表渲染
   - 不能移除视口驱动 hydration
   - 不能破坏 generation 防陈旧结果模型

2. **本地优先**
   - 所有搜索、索引、缓存、批量处理都必须保持本地执行
   - 不引入网络请求作为主工作流依赖

3. **原生感优先**
   - 主模式仍然是“点击卡片 -> 主显示区打开笔记”
   - 尽量复用 Obsidian 的 `ItemView`、`WorkspaceLeaf`、`Menu`、`Notice`、`FuzzySuggestModal`、`Vault`、`FileManager`

4. **边界清晰**
   - `FolderCardView.ts` 继续作为状态汇聚点
   - Svelte 组件继续负责展示和事件抛出，不变成业务状态源
   - 搜索必须接入 `pipeline.ts`，而不是另起一个平行可见性系统

### 3.2 Obsidian 运行时约束

- 自定义 view 继续通过 `ItemView` 生命周期接入
- 不要持有裸 view 引用；优先通过 `workspace.getLeavesOfType()` + `instanceof` 使用 view
- vault 观察者继续放在 `onLayoutReady()` 后注册
- 右侧 leaf 继续复用 `getRightLeaf(false)` 语义，不制造额外布局分叉

### 3.3 V1 边界约束

以下方向保持 **out of scope**：

- 多 pane 导航器布局
- property tree / calendar / vault profile
- 以插件接管整个文件浏览体验为目标
- 卡片内完整编辑器嵌入
- 需要长期维护的重量级跨模块基础设施提前建设

---

## 4. 全局验证规则

每个阶段、每个原子任务都必须遵守以下验证规则：

### 4.1 阶段内最小验证

- 优先运行与改动文件最相关的测试
- 至少做一轮针对该任务的功能级验证

### 4.2 阶段完成验证

每完成一个任务切片，至少要执行：

```bash
npm run check
npm run build
npm test
```

### 4.3 完成判定标准

只有当以下条件同时满足时，任务才算完成：

- 相关测试通过
- repo 全量 `check/build/test` 通过
- 没有破坏已有架构约束
- 新能力已经从“底层函数存在”升级为“用户可见工作流闭环”
- 文档中的 acceptance criteria 已全部满足

### 4.4 禁止性完成语句

以下表述不能作为完成证据：

- “应该能工作”
- “UI 看起来差不多”
- “逻辑已经接上了”
- “剩下的可以后面补”

---

## 5. 交付顺序与依赖图

## 推荐顺序

1. Phase 1：响应式 card wall 与范围入口闭环
2. Phase 2：多选与批量整理工作流
3. Phase 3：搜索服务与索引能力
4. Phase 4：快速预览增强、视觉收尾与 i18n/a11y

## 依赖图

```text
Phase 1
  └─ 稳定 card wall 形态与 scope/filter 入口
       ↓
Phase 2
  └─ 基于路径的多选与批量整理闭环
       ↓
Phase 3
  └─ SearchService / IndexStore / Search UI 接入 pipeline
       ↓
Phase 4
  └─ 快速预览增强、视觉一致化、i18n / a11y 收尾
```

并行允许范围：

- Phase 3 的搜索 spike 可以在 Phase 2 后半段提前启动
- 同一 phase 内可以拆成多个原子切片，但不能越过 hard dependency

## 历史任务映射表

为避免后续 agent 在 `roadmap` / `dev_plan` / 本文档之间对错编号，统一按下表映射理解：

| 历史任务 | 本文档任务 |
|---|---|
| Task 18 | T34 |
| Task 19 | T35 |
| Task 20 | T36 |
| Task 21 + Task 22 | T37 |
| Task 23 + Task 24 | T38 |
| Task 25 + Task 26 | T39 |
| Task 27 | T40 |
| Task 28 + Task 29 | T42 |
| Task 30 | T43 |

说明：

- 本文档有意把部分历史任务合并为更适合执行的切片。
- 如果后续执行发现某个合并切片过大，应在该 phase 内继续向下拆分，但不要改回旧编号体系。

---

## 6. Phase 1：把 card wall 工作台做完整

### 6.1 目标

- 把当前单列卡片流升级为 **响应式 card wall**
- 统一 folder / `All Notes` / tag filter / `includeSubfolders` 的范围入口
- 保持“点击卡片 -> 主显示区打开笔记”为默认主模式
- 在不破坏现有性能模型的前提下完成布局升级

### 6.2 当前事实

- `src/view/FolderCardPanel.svelte` 当前仍是单列虚拟列表模型
- `src/view/scroll-anchoring.ts` 当前是 1D 滚动锚定模型
- `src/view/Toolbar.svelte` 已有 folder picker、`All notes`、sort、filter
- `src/settings.ts` 已有 `includeSubfolders` 持久化
- `src/view/FolderCardView.ts` 已在 load key 和采集逻辑里使用 `includeSubfolders`

### 6.3 文件落点

- `src/view/FolderCardPanel.svelte`
- `src/view/scroll-anchoring.ts`
- `src/view/FolderCardView.ts`
- `src/view/Toolbar.svelte`
- `src/settings.ts`
- `styles.css`
- `src/view/scroll-anchoring.test.ts`
- 与布局/状态事件相关的 view tests

### 6.4 原子任务

#### T31. 响应式 wall virtualization 方案定稿与最小实现

**要做什么**

- 采用 **row-projected virtualization** 作为唯一推荐路径：先把当前单卡片 1D 虚拟列表抽象成“按行投影”的 2D 近似模型，再做多列布局
- 保证 sidebar 宽度变化时，列数与可见区域计算可稳定更新
- 保住 scroll anchoring 的“用户未主动滚动时才补偿”约束
- 先完成 row abstraction（row records / row heights / row index mapping），再做 CSS 多列化

**必须不要做什么**

- 不要为了省事退回非虚拟化整列表
- 不要引入 masonry 式不可预测高度布局
- 不要把高度测量逻辑拆散到多个状态源
- 不要先改 CSS 再补虚拟化模型

**验收标准**

- 将侧边栏从窄宽度拖到宽宽度时，卡片能从单列稳定过渡到多列
- 在拖动宽度前后持续滚动，列表不出现白屏、明显错位、选区跳闪
- 可见区域外的卡片仍不被整量渲染；hydration 仍只在视口附近触发
- 至少更新 `src/view/scroll-anchoring.test.ts`

**最小手动验证**

- 在一个有大量卡片的 folder scope 中打开视图
- 滚动到中段后拖动右侧 sidebar 宽度
- 继续滚动并确认锚定、可见区渲染、hydration 请求都没有明显回退

#### T32. 范围切换入口统一与 Toolbar 信息层次重构

**要做什么**

- 把 folder picker、`All Notes`、tag filter、`includeSubfolders` 组织成一致的 scope/filter 入口
- 补齐 `includeSubfolders` 的面板内显式入口
- 提升 Toolbar 当前 action 层级，让用户能看懂“当前范围是什么、当前过滤条件是什么”
- 保持 tag filter 的 **AND semantics** 不变
- 明确 `includeSubfolders` 在 `All Notes` 模式下不生效，不做伪切换

**必须不要做什么**

- 不要把搜索框提前塞进 Phase 1
- 不要把 Toolbar 变成复杂工作台控制台
- 不要把 UI 状态持久化到不该持久化的位置

**验收标准**

- 用户在视图内部就能完成常见范围切换
- `includeSubfolders` 切换后能正确触发 refresh 并持久化
- Toolbar 上能直接看出当前 scope、当前 tag filter 是否激活、以及 `includeSubfolders` 是否开启

**最小手动验证**

- 在 folder scope 中切换 `includeSubfolders`，确认卡片结果变化并在刷新后保持
- 切到 `All Notes` 时，`includeSubfolders` 不制造误导性状态变化
- 选择多个 tags 后，结果仍按 AND 语义过滤

#### T33. Phase 1 回归加固

**要做什么**

- 补齐响应式 layout、scope 切换、`includeSubfolders` 的测试与回归验证
- 明确新的布局实现没有破坏现有主流程：folder click、panel picker、all notes、sort、filter、pin、open note

**验收标准**

- 相关测试新增或更新，优先覆盖 `src/view/scroll-anchoring.test.ts`、`src/view/pipeline.test.ts` 与现有 view interaction tests
- `npm run check && npm run build && npm test` 全通过

### 6.5 Phase 1 stop conditions

出现以下情况必须停手并先做方案修正：

- 多列布局要求推翻当前虚拟化主模型才能成立
- `FolderCardView.ts` 不可避免地同时吸收大量布局状态与 UI 状态
- `includeSubfolders` 入口设计与现有 folder scope 语义冲突

---

## 7. Phase 2：补齐批量整理能力

### 7.1 目标

- 建立基于路径的多选状态
- 完成范围选中、全选/取消选择、选中计数
- 把已有 batch move/delete/merge 底层能力接成用户可见工作流

### 7.2 当前事实

- `src/view/note-ops.ts` 已有 `batchMoveFiles()` / `batchTrashFiles()` / `batchDeleteFiles()` / `mergeNotes()`
- `src/view/Toolbar.svelte` 已有 `bulk` action 占位
- `src/view/CardItem.svelte` 目前只有单卡打开/置顶交互，没有 checkbox 或批量选中态
- 仓库当前没有多选状态模型

### 7.3 文件落点

- `src/view/FolderCardView.ts`
- `src/view/FolderCardPanel.svelte`
- `src/view/CardItem.svelte`
- `src/view/Toolbar.svelte`
- `src/view/types.ts`
- `src/view/note-ops.ts`
- `styles.css`
- 新增/更新与批量动作相关的 tests

### 7.4 原子任务

#### T34. 多选状态框架

**要做什么**

- 建立 `selectedPaths: Set<string>` 级别的状态模型
- 支持单选切换、Shift 范围选中、全选、清空选中、选中计数
- 保证排序、筛选、置顶变化后，选中状态不会因为索引变化漂移
- 明确 `selectedPath` 与 `selectedPaths` 是两套状态：前者保持 editor sync，后者只服务 bulk mode
- Shift 范围选中基于当前 `visibleCards` 顺序，而不是 `baseCards` 或 DOM 下标

**必须不要做什么**

- 不要用数组下标作为选中主键
- 不要把多选状态持久化到 settings
- 不要让 Svelte 组件成为多选状态源

**验收标准**

- 排序/筛选/置顶变化后，选中集合仍正确
- 能清楚看见哪些卡片被选中
- Toolbar 能展示 bulk mode / count / clear selection

**最小手动验证**

- 先选中若干卡片，再切换 sort / tag filter / pin，确认 bulk selection 不漂移
- 打开主编辑区中的某篇笔记，确认 active note 高亮仍由 `selectedPath` 单独驱动

#### T35. 批量移动与批量删除工作流

**要做什么**

- 将 `batchMoveFiles()` / `batchTrashFiles()` / `batchDeleteFiles()` 接入 UI
- 提供确认链路、失败汇总、完成后清空选中状态
- 与 Obsidian 原生回收机制语义对齐
- 保持现有单卡片 move/copy/context actions 不回归

**必须不要做什么**

- 不要静默批量删除
- 不要在出现部分失败时丢失失败明细
- 不要让完成后的列表状态失真

**验收标准**

- 用户可以从 card wall 内完成批量移动/删除
- 成功与失败结果可见
- 操作后列表与选中状态正确刷新

**最小手动验证**

- 选中多个文件执行 batch move，确认成功项与失败项可区分
- 执行 trash / delete 时必须出现确认
- 批量动作完成后，列表、选中数和当前高亮都处于一致状态

#### T36. 批量合并工作流

**要做什么**

- 将 `mergeNotes()` 接入 UI
- 提供合并顺序、分隔符、目标标题、目标目录、预览和确认
- 明确“合并是否额外 trash 源文件”是单独选择，不要隐式处理
- 默认 merge 顺序以触发 merge 时的当前 `visibleCards` 顺序为准；若 UI 允许重排，应以用户显式重排结果为准

**必须不要做什么**

- 不要默认删除源文件
- 不要省略预览或确认
- 不要把排序后的可见顺序和真实 merge 顺序混淆

**验收标准**

- 用户能可靠完成多篇笔记合并
- merge 输出可预测，失败可解释

**最小手动验证**

- 对当前视图中的多篇笔记发起 merge，确认默认顺序与当前可见顺序一致
- 显式选择“合并后保留源文件”与“合并后 trash 源文件”时，行为有清楚分支

### 7.5 Phase 2 stop conditions

- 多选状态必须侵入多个组件并形成双向状态源
- 批量动作需要引入跨模块巨大 orchestrator 才能落地
- 合并顺序与当前卡片可见顺序语义无法一致定义

---

## 8. Phase 3：把搜索做成真正能力

> [!NOTE]
> 本节保留的是 Phase 3 规划时的历史方案，其中关于 fallback / 降级搜索的描述均已过时。
> 当前实现已经移除 fallback 搜索路径；索引未就绪时，非空查询会被明确阻塞，空查询浏览保持不变。

### 8.1 目标

- 把搜索从占位过滤推进成真正可依赖的 scoped search
- 搜索与 tag filter、pin reorder、默认排序正确组合
- 在索引未就绪时优雅降级，而不是不可用

### 8.2 当前事实

- `src/view/pipeline.ts` 中 `applySearchFilter()` 还是 pass-through
- `src/view/metadata-utils.ts` 已有基础 `matchesSearchQuery()`，只能作为 fallback
- 当前没有 `SearchService`、`IndexStore`、MiniSearch 管理器、搜索输入 UI
- 外部参考显示：`IndexedDB + MiniSearch` 在 Obsidian 插件中是成熟可行路线，Omnisearch 已验证该模式
- 当前 `package.json` 中还没有 `minisearch` 依赖；Phase 3 会正式引入新的搜索依赖与本地存储边界

### 8.3 文件落点

- `src/view/pipeline.ts`
- `src/view/FolderCardView.ts`
- `src/view/Toolbar.svelte`
- `src/view/metadata-utils.ts`
- 新增 `src/search/` 目录（建议）
- `src/main.ts`（必须承担 command 注册与 search lifecycle wiring）
- 新增/更新 search 相关 tests

### 8.4 原子任务

#### T37. Search spike 与契约定稿

**要做什么**

- 先验证 `IndexedDB + MiniSearch` 在当前插件上下文中的可接受性
- 明确 `SearchService` 契约：状态、查询结果、generation/ready/building/failed 语义
- 明确视图级临时搜索词不进入持久化 settings
- 明确 search contract 只把“过滤与重排输入”交给 `pipeline.ts`，不另建第二套 card visibility 系统
- 明确搜索结果以“ordered paths + optional score metadata”形式进入运行时，而不是直接污染 `NoteCardRecord`

**必须不要做什么**

- 不要未经 spike 直接把持久化搜索写进主流程
- 不要把搜索变成第二套可见卡片系统
- 不要把 CJK 高级分词一次性做满

**验收标准**

- 有清晰 go/no-go 结论
- `SearchService` 接口稳定，足以支撑后续实现

**内部依赖顺序**

1. Spike
2. `SearchService` contract
3. 数据落盘与索引管理器

#### T38. IndexStore 与 SearchIndexManager

**要做什么**

- 为 MiniSearch 建立序列化/反序列化、增量增删改、schema/version 管理能力
- 使用 per-vault 命名空间隔离 IndexedDB 数据
- 保持存储层与搜索引擎层边界清晰
- 建议在元数据中保留 `vaultId`、`schemaVersion`、`tokenizerVersion`、`pluginVersion`、`docCount`、`lastIndexedAt`

**验收标准**

- 可从空索引构建并持久化
- 可从持久化数据异步恢复
- schema/tokenizer 版本不匹配时能触发重建

#### T39. 构建、增量更新、健康恢复

**要做什么**

- 接入 vault create/modify/delete/rename 生命周期
- 实现初次构建、后续启动恢复、索引损坏清空与重建
- 注册必要的 rebuild command / 状态提示
- `main.ts` 负责 command 与生命周期注册，`FolderCardView.ts` 负责消费 search status / query state

**必须不要做什么**

- 不要在 `onload()` 里执行重索引
- 不要阻塞主线程到让 Obsidian 明显卡顿
- 不要把失败恢复留给用户手工猜测

**验收标准**

- 索引可建立、恢复、损坏后重建
- 失败状态可见，可恢复

**最小手动验证**

- 冷启动一次构建索引，再重启插件，确认能恢复已有索引
- 人为触发 rebuild command，确认状态变化清楚且可回到 ready

#### T40. 搜索 UI 与 pipeline 接入

**要做什么**

- 给 Toolbar 增加搜索输入入口
- 将搜索结果接入 `pipeline.ts`
- 在索引未 ready 时降级到基础 `matchesSearchQuery()`
- 定义搜索结果排序如何覆盖默认排序
- 明确 fallback 只保证标题命中；若未提供 cached content，不承诺正式全文召回率

**必须不要做什么**

- 不要让 pin 越过 search/tag filter
- 不要把搜索关键词持久化到 plugin settings
- 不要把 fallback 当成正式大规模搜索方案

**验收标准**

- 搜索成为 card wall 的真实主入口之一
- 索引未 ready 时仍可工作，但仅提供降级语义下的有限召回

**内部依赖顺序**

1. `IndexStore` / `SearchIndexManager`
2. 构建与增量更新
3. 健康恢复与 rebuild
4. Toolbar 搜索 UI 与 pipeline integration

**最小手动验证**

- 输入一个只在标题命中的搜索词，fallback 必须可用
- 输入一个依赖全文内容命中的搜索词，在 index ready 前后对比结果差异，确认降级语义被明确提示

### 8.5 Phase 3 stop conditions

- SearchService 设计要求大规模重写 `FolderCardView` 与 pipeline 边界
- IndexedDB 恢复耗时或稳定性明显不可接受
- fallback 与正式搜索语义差异过大，导致用户预期混乱

---

## 9. Phase 4：预览增强、视觉收尾与 i18n/a11y

### 9.1 目标

- 提供合理的快速预览增强能力
- 完成视觉一致化
- 补齐基础 i18n、键盘导航和 ARIA 基线

### 9.2 当前事实

- `src/view/CardItem.svelte` 当前只支持内嵌 excerpt 预览
- `src/view/markdown-utils.ts` 已能生成轻量 preview HTML
- 仓库当前文案中英混用，尚无 i18n 基础设施
- 现有组件已具备一部分 ARIA，但没有完整键盘导航模型

### 9.3 文件落点

- `src/view/CardItem.svelte`
- `src/view/FolderCardPanel.svelte`
- `src/view/Toolbar.svelte`
- `src/view/markdown-utils.ts`
- `styles.css`
- 可能新增 `src/i18n/`（如选择抽离字符串）
- 新增/更新 preview / i18n / a11y tests

### 9.4 原子任务

#### T41. 快速预览增强

**要做什么**

- 在不改变主模式的前提下提供轻量 preview 增强
- 优先考虑 hover/temporary preview/popover 这类“次级查看模式”
- 保持需要深度阅读和编辑时仍交给原生 leaf

**必须不要做什么**

- 不要把 card wall 变成长期编辑宿主
- 不要在卡片内嵌完整编辑器
- 不要引入复杂焦点管理到失控程度

**验收标准**

- 快速预览可增强浏览，但不破坏主工作流

#### T42. 视觉一致化

**要做什么**

- 统一 Toolbar、card、empty state、hover、selected、spacing、层级
- 继续优先使用 Obsidian theme variables

**必须不要做什么**

- 不要进行整套主题重做
- 不要引入和 Obsidian 原生风格冲突的大量自定义视觉 token

**验收标准**

- 视觉风格整体一致，可长期驻留使用

#### T43. i18n 与 a11y 基线

**要做什么**

- 收敛硬编码文案，建立最小可维护的字符串管理方式
- 补齐键盘导航、ARIA、focus states、必要的 screen-reader 语义
- 至少让 Toolbar 与 card wall 主流程可被键盘可靠操作
- 键盘导航至少覆盖：Toolbar 主要入口、卡片聚焦、打开笔记、pin toggle、bulk mode 关键操作

**必须不要做什么**

- 不要把国际化基础设施做成大工程
- 不要只加 ARIA 属性而不验证键盘流

**验收标准**

- 文案抽离达到可持续维护水平
- 关键交互具备基本键盘可达性
- 主要交互元素具备与实际行为一致的 ARIA 语义

**最小手动验证**

- 只用键盘完成一次：切换 scope、聚焦卡片、打开笔记、切换 pin 或 bulk 模式
- 用 screen reader 友好的方式检查主要按钮、卡片与状态信息没有明显语义缺失

### 9.5 Phase 4 stop conditions

- 预览增强要求引入长期编辑状态
- i18n 设计要求大范围重构所有组件协议
- 键盘导航与现有虚拟滚动模型发生根本冲突

---

## 10. 文件触点矩阵

| 文件 | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|---|---|---|---|---|
| `src/main.ts` | 低 | 低 | 中 | 低 |
| `src/settings.ts` | 中 | 低 | 低 | 低 |
| `src/view/FolderCardView.ts` | 高 | 高 | 高 | 中 |
| `src/view/FolderCardPanel.svelte` | 高 | 中 | 低 | 中 |
| `src/view/Toolbar.svelte` | 高 | 高 | 高 | 高 |
| `src/view/CardItem.svelte` | 中 | 高 | 低 | 高 |
| `src/view/pipeline.ts` | 低 | 低 | 高 | 低 |
| `src/view/note-ops.ts` | 低 | 中 | 低 | 低 |
| `src/view/scroll-anchoring.ts` | 高 | 低 | 低 | 低 |
| `styles.css` | 高 | 中 | 低 | 高 |

---

## 11. 后续 AI agent 的执行规范

### 每次开始前先读

1. `AGENTS.md`
2. `docs/architecture.md`
3. `docs/roadmap/v1-product-roadmap.md`
4. 本文档
5. 目标 phase 涉及的核心源码文件

### 每次实施时要遵守

- 一次只做一个原子任务
- 不跳过依赖
- 不因为“顺手”重构无关模块
- 不把缺失的 `docs/dev-feature/*` 当作阻塞理由
- 每次改完都跑 `npm run check && npm run build && npm test`
- 仅在需要追溯历史拆分时查看 `dev_plan.md`，不要把它重新当成主计划

### 遇到以下情况必须停下

- 发现计划与当前代码真实结构严重不符
- 发现一个任务需要跨 phase 大范围重构
- 发现性能模型、主工作流或原生感边界会被破坏
- 发现文档里 acceptance criteria 无法被客观验证

---

## 12. V1 完成标准

当以下条件全部成立时，可视为 V1 基本完成：

- card wall 已从单列流升级为稳定可用的响应式工作台
- 文件夹 / `All Notes` / 标签 / 搜索形成统一范围与过滤体验
- 多选、批量移动/删除/合并形成完整用户闭环
- 搜索已成为真实可依赖入口，而不是占位过滤
- 默认主工作流仍保持 Obsidian 原生感
- 快速预览增强没有越界成编辑宿主
- 视觉一致化、基础 i18n 和 a11y 达到可发布水平

---

## 13. 附：已知风险清单

1. **响应式 card wall 的虚拟化复杂度高**
   - 现有模型是单列 1D，升级多列时最容易出问题

2. **`FolderCardView.ts` 持续膨胀**
   - 后续任务应优先避免把布局状态、多选状态、搜索状态、批量动作编排无脑继续塞进同一文件

3. **搜索预期高于实际实现**
   - 用户一旦看到搜索框，就会预期速度、准确性、解释性都稳定

4. **快速预览边界失控**
   - 预览是增强能力，不是新的编辑宿主

5. **历史规划文档引用缺失**
   - `docs/dev-feature/*` 缺失容易诱发 AI agent 自行脑补，因此本文档必须被当作唯一执行来源
