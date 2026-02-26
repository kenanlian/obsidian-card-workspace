# Implementation Plan: 同一文件夹重复点击短路与重复渲染防抖

**Branch**: `001-folder-click-debounce` | **Date**: 2026-02-26 | **Spec**: `C:\Users\kenan.lian\WPSSYNC\700 - Study\obsidian-cards-view-plugin\specs\001-folder-click-debounce\spec.md`
**Input**: Feature specification from `C:\Users\kenan.lian\WPSSYNC\700 - Study\obsidian-cards-view-plugin\specs\001-folder-click-debounce\spec.md`

## Summary

为文件夹点击与刷新链路增加“双层去重”：插件层使用点击意图序号保证快速切换目录时“最后一次点击生效”，视图层使用同目录短路 + 单飞(in-flight)刷新约束避免重复重建；同时保持当前卡片、滚动与选中状态稳定，并继续通过 vault 事件自动刷新当前目录。

## Technical Context

**Language/Version**: TypeScript 5.8 (`strict: true`), Svelte 4.2  
**Primary Dependencies**: Obsidian API (`Plugin`, `ItemView`, `debounce`, vault/workspace events), `esbuild`, `esbuild-svelte`  
**Storage**: N/A（本地 Obsidian vault 文件 + 运行时内存状态）  
**Testing**: `npm run check`, `npm run build` + 手动场景验证（当前无自动化测试框架）  
**Target Platform**: Obsidian Desktop Plugin Runtime  
**Project Type**: 单仓库桌面插件（Obsidian plugin）  
**Performance Goals**: 同目录 2 秒 10 次点击仅 1 次有效刷新；目录变更后 95% 场景 1 秒内反映；重复点击不触发闪动重置  
**Constraints**: 无网络访问；保持主线程可响应；保留 generation 失效保护与按视口 hydration 机制  
**Scale/Scope**: 面向单视图、上千 Markdown 文件目录的快速浏览场景；变更范围限定在 `src/main.ts` 与 `src/view/FolderCardView.ts`

所有前置不确定项（去重策略、事件过滤、防抖并发模型、UI 稳定性策略）已在 `research.md` 收敛，无未解决的 NEEDS CLARIFICATION。

## Constitution Check

*GATE: PASS（Phase 0 前）*

- **Performance First**: 识别热点为重复 `setFolder` 全量重建与并发 refresh；方案采用同目录短路、in-flight 单飞、队列合并与 debounced drain，避免重复主线程工作。
- **Local-first & Privacy**: 仅处理本地 vault 事件与本地状态，不新增网络请求、远端同步或外部遥测。
- **Native Feel**: 不改变 Obsidian 文件管理器点击语义；仅优化重复点击反馈与稳定性；继续沿用现有样式变量与视图行为。
- **Modular Design**: 点击意图/事件队列逻辑保留在插件 runtime 层；刷新键(key)/短路与加载状态机保留在 `FolderCardView` 领域层；Svelte 组件仅承载渲染。
- **Lifecycle Safety**: 继续通过 `registerEvent`/`registerDomEvent` 管理生命周期；在 unload/close 时取消 debounce 与挂起任务，防止延迟触发。

## Project Structure

### Documentation (this feature)

```text
C:\Users\kenan.lian\WPSSYNC\700 - Study\obsidian-cards-view-plugin\specs\001-folder-click-debounce\
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts\
│   └── folder-click-debounce.openapi.yaml
└── tasks.md  # Phase 2 由 /speckit.tasks 生成
```

### Source Code (repository root)

```text
src/
├── main.ts
├── settings.ts
└── view/
    ├── FolderCardView.ts
    ├── FolderCardPanel.svelte
    ├── markdown-utils.ts
    └── types.ts
styles.css
manifest.json
```

**Structure Decision**: 采用现有单插件结构，仅在 `main.ts`（事件聚合与触发策略）和 `FolderCardView.ts`（同目录短路/单飞加载）扩展，不引入新运行时层级。

## Phase 0 Research Output

- 产物：`C:\Users\kenan.lian\WPSSYNC\700 - Study\obsidian-cards-view-plugin\specs\001-folder-click-debounce\research.md`
- 覆盖：同目录短路键设计、in-flight 去重、vault 事件过滤、刷新队列、防闪动状态契约。

## Phase 1 Design Output

- 数据模型：`C:\Users\kenan.lian\WPSSYNC\700 - Study\obsidian-cards-view-plugin\specs\001-folder-click-debounce\data-model.md`
- 合同：`C:\Users\kenan.lian\WPSSYNC\700 - Study\obsidian-cards-view-plugin\specs\001-folder-click-debounce\contracts\folder-click-debounce.openapi.yaml`
- 快速验证：`C:\Users\kenan.lian\WPSSYNC\700 - Study\obsidian-cards-view-plugin\specs\001-folder-click-debounce\quickstart.md`

## Post-Design Constitution Check

*GATE: PASS（Phase 1 后复核）*

- **Performance First**: 设计中引入“同键 noop / 同键复用 in-flight / 不同键 latest-wins 排队”与防抖队列清空机制，满足无重复刷新目标。
- **Local-first & Privacy**: 合同与模型均声明 `local://` 语义，仅描述本地事件驱动，不包含外部 I/O。
- **Native Feel**: 保持文件夹点击触发视图激活；同目录重复点击时 UI 保持稳定（不清空 cards、不重置 generation）。
- **Modular Design**: 数据模型明确 `FolderSelectionRequest`、`FolderLoadSnapshot`、`RefreshQueueState` 职责边界，UI 与运行时职责分离。
- **Lifecycle Safety**: 设计明确在 `onunload`/`onClose` 执行 debounce cancel 与待处理请求清理，避免泄漏和幽灵刷新。

## Complexity Tracking

> 无宪章违规项；无需豁免说明。
