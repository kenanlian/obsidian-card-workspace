# Decision: 将卡片工作流统一到面板内交互与投影链路

## 背景

项目最初的核心价值是：监听文件管理器中的文件夹点击，并在右侧侧边栏展示对应笔记卡片流。这个基础模型成立后，新的需求开始集中出现：

- 不想只能依赖文件管理器点击来切换范围
- 需要在卡片流里直接做排序、筛选、置顶和卡片级操作
- 需要把设置和视图状态稳定保存下来，避免每次都从零开始
- 未来还要继续接入搜索和批量操作

如果这些能力继续以“零散按钮 + 零散逻辑”的方式追加，系统会很快变成若干互相绕开的状态分支。

## 触发信号

2026-03-09 到 2026-03-10 这一轮提交连续引入了几类互相关联的能力：

- `FolderPickerModal`：面板内可搜索的文件夹选择
- 卡片右键动作：复制、移动等单卡片操作入口
- `pinnedPaths` 持久化：置顶状态从瞬时 UI 变成设置层事实
- `pipeline.ts`：标签筛选与置顶重排的统一投影链路
- `FolderCardPanel.svelte` / `Toolbar.svelte` / `CardItem.svelte`：更多交互都从面板内发起

这些变化共同表明：插件已经从“被动响应文件夹点击”演化成“面板内可操作的浏览工作台”。

## 决策

我们将当前系统理解为：

1. **面板拥有主要交互入口**，不再把文件管理器点击当成唯一入口。
2. **`FolderCardView` 作为单一运行时协调层**，统一吸收设置、视图状态、vault 事件与 Svelte 事件。
3. **可见卡片通过 pipeline 投影得到**，而不是在多个位置分散地做过滤和重排。
4. **置顶属于排序层规则，不属于可见性层规则**；它只能重排，不能绕过筛选。

## 为什么选这个方向

### 1. 让未来功能继续落在既有边界上

搜索、批量、多选、健康状态等后续能力都需要一个稳定挂点。把它们接到 `FolderCardView` + pipeline，比把逻辑塞进多个 Svelte 组件更容易维护。

### 2. 让设置持久化与当前视图状态形成清晰分工

像 `sort`、`filter.tags`、`pinnedPaths`、`lastFolderPath` 这类状态应当跨会话保存；而滚动位置、菜单开合、可见窗口属于瞬时 UI 状态。当前分层让这两类状态的边界比较清楚。

### 3. 保住性能模型

一旦交互能力增多，如果没有统一投影层，很容易回到“每个功能都自己改卡片数组”的模式，最终破坏虚拟滚动、增量刷新和 generation 防陈旧的整体假设。

## 影响

### 正面影响

- 面板内交互变成一等能力，用户不必反复回到文件管理器
- 过滤、置顶、后续搜索可以在同一条链路中组合
- 设置层和视图层职责更清晰，恢复会话也更自然

### 结构性影响

- `FolderCardView.ts` 继续承担更多协调职责，成为明显的核心文件
- Svelte 组件更像“事件表面层”，需要避免让它们偷偷持有业务状态
- 规划文档中的搜索与批量任务现在有了更明确的接入位置

## 成本与风险

1. **核心文件膨胀风险**：`FolderCardView.ts` 体量会继续增长，未来可能需要再拆出独立状态/服务模块。
2. **计划文档与已实现能力混淆风险**：仓库里已有大量 `docs/dev-feature/` 文档，容易让后来者误判哪些功能已落地。
3. **搜索接入风险**：`applySearchFilter()` 仍是占位实现，如果后续搜索没有尊重现有 pipeline 与 generation 模型，容易引入性能或一致性问题。

## 备选方案

### 方案 A：继续以文件管理器点击为主，面板仅负责展示

没有采用。这样会让插件始终依赖外部入口，无法形成完整浏览工作流，也会让 `All Notes`、面板内 folder picker、卡片级动作变成附属分支。

### 方案 B：把更多状态直接下放到 Svelte 组件

没有采用。这样虽然短期改起来快，但会让 Obsidian API 交互、设置持久化和异步刷新逻辑散落到多个 UI 文件中，未来更难验证一致性。

### 方案 C：不引入 pipeline，继续在视图逻辑里手写过滤/重排顺序

没有采用。搜索、置顶、标签筛选、多选排序一旦同时存在，这种方式会很快失控。

## 后续动作

1. 在后续搜索实现中，把真实搜索逻辑接入 `applySearchFilter()` 所在链路。
2. 完成 `includeSubfolders` 的面板入口，减少“设置存在但用户不可见”的割裂。
3. 批量选择与批量动作继续以 `FolderCardView` 为状态协调层，不另起平行状态系统。
4. 如果 `FolderCardView.ts` 继续膨胀，优先考虑拆分为“状态推进/刷新编排/动作路由”子模块。

## Supersedes / related records

- 不覆盖旧决策记录；这是第一次正式把当前结构变化写入 `docs/decisions/`。
- 相关规划文档：`docs/plans/2026-02-27-panel-folder-picker*.md`、`docs/dev-feature/task-12-filter-pipeline.md`、`docs/dev-feature/task-14-tag-filter.md`、`docs/dev-feature/task-17-pin-notes.md`

## Related files

- `src/main.ts`
- `src/view/FolderCardView.ts`
- `src/view/FolderCardPanel.svelte`
- `src/view/Toolbar.svelte`
- `src/view/CardItem.svelte`
- `src/view/pipeline.ts`
- `src/settings.ts`
