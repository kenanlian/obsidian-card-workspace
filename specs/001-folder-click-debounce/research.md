# Phase 0 Research — 同一文件夹重复点击短路与重复渲染防抖

## Decision 1: 点击链路采用“插件层意图序号 + 视图层短路”双层模型

- **Decision**: 在 `main.ts` 维护递增点击意图序号（intent sequence）防止异步激活视图后乱序提交；在 `FolderCardView.ts` 对同一加载键(`folderPath + settings`)执行早返回短路。
- **Rationale**: 仅插件层判断同路径会忽略多叶子视图状态差异，且无法解决视图内部 in-flight 重复问题；双层模型可同时保证顺序正确与渲染去重。
- **Alternatives considered**:
  - 只做插件层 `selectedFolderPath` 相等短路：实现简单，但无法覆盖视图并发与状态稳定性。
  - 只做视图层短路：可减少重绘，但无法阻止 `activateView()` 后旧点击回写。

## Decision 2: 视图刷新采用 single-flight + latest-wins 排队

- **Decision**: 为 `setFolder`/`refresh` 统一到请求入口，维护 `inFlight` 与 `queuedRequest`；同键且非强制时复用 in-flight，不创建新任务；不同键在 in-flight 期间仅保留最后一个请求。
- **Rationale**: 可在不牺牲目录切换正确性的前提下避免任务堆积，满足“同目录重复点击不重复刷新、不同目录快速切换仍生效”。
- **Alternatives considered**:
  - 允许并发多个刷新：最容易导致 generation 抖动和无效 I/O。
  - 全部请求串行排队：正确但会放大延迟，体验不佳。

## Decision 3: Vault 事件采用统一过滤 + 防抖 drain 队列

- **Decision**: `create/modify/delete/rename` 走统一过滤函数，按“当前目录 + includeSubfolders + Markdown 文件类型”判断是否相关；相关事件仅置位 `refreshQueued`，由防抖函数触发 `drainRefreshQueue()`，并确保 refresh 不重入。
- **Rationale**: 目录内批量文件变更会产生事件风暴，简单 debounce 仍可能在 refresh 进行中重复进入；队列 drain 可把 burst 变更合并为最少次数的有效刷新。
- **Alternatives considered**:
  - 每个事件直接 `view.refresh()`：实现简单但成本最高。
  - 只 debounce 不做 in-flight 互斥：仍可能出现重叠刷新。

## Decision 4: UI 稳定性契约为“同目录短路不触发破坏性状态更新”

- **Decision**: 同目录短路时不执行 `cards=[]`、不 `generation++`、不 push 整数组副本；`setSelectedFile` 仅更新 `selectedPath` 相关状态。
- **Rationale**: 当前闪动来自预清空与 generation 变化导致虚拟列表重置；保证 noop 真正无状态破坏，可维持滚动位置与选中稳定。
- **Alternatives considered**:
  - 保持现有预清空并加 loading skeleton：视觉可控但仍有闪动与重排。
  - 通过延迟动画掩盖重建：治标不治本。

## Decision 5: 生命周期清理必须显式取消延迟任务

- **Decision**: 在插件卸载与视图关闭路径清理 pending debounce / queued refresh / hydration pending 集合，避免延迟回调在上下文失效后触发。
- **Rationale**: FR-007 明确要求上下文切换后不误触发刷新；无显式取消会造成“幽灵刷新”。
- **Alternatives considered**:
  - 仅依赖 `registerEvent` 自动清理：无法覆盖已排队但未执行的 debouncer。
  - 忽略清理依赖 generation 保护：仍可能造成无意义唤醒与日志噪声。

## Clarification Resolution Status

- `NEEDS CLARIFICATION: 同目录重复点击如何去重且不丢目录切换` → 已通过 Decision 1/2 解决。
- `NEEDS CLARIFICATION: vault 事件风暴下如何保证自动刷新正确且不重叠` → 已通过 Decision 3 解决。
- `NEEDS CLARIFICATION: 同目录短路如何避免 UI 闪动/滚动重置` → 已通过 Decision 4 解决。
- `NEEDS CLARIFICATION: unload/close 如何保证不误触发` → 已通过 Decision 5 解决。

## Final Constitution Audit (Post-Implementation)

- **Performance First**: 已落地 load-key 同键短路、single-flight + latest-wins 队列、插件层 debounced vault 刷新，避免重复 `setFolder` 重建与并发刷新。
- **Local-first & Privacy**: 全部变更保持在 Obsidian 本地 API 与内存状态中，无新增网络调用。
- **Native Feel**: 文件管理器点击与 Obsidian 交互语义保持不变，仅在重复点击时短路并保留现有卡片/滚动/选中稳定性。
- **Modular Design**: `main.ts` 聚焦点击意图时序、vault 事件归一化与生命周期；`FolderCardView.ts` 聚焦 load-key、队列与刷新状态机；Svelte 渲染层未引入业务耦合。
