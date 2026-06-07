# START HERE

## 这个项目现在在解决什么问题？

`Card Workspace` 是一个 Obsidian 插件。它把文件管理器里的文件夹选择转换成左侧侧边栏里的卡片流，让用户在当前笔记上下文中浏览、筛选、置顶、搜索并打开一组文件卡片。当前支持的正式卡片文件类型是 `markdown`、`base`、`canvas` 和 `excalidraw`；其中只有 Markdown 继续参与全文预览与全文索引，其余类型以文件标题、图标和占位摘要进入工作台。

当前项目的核心目标是维护一套已经闭环的、基于本地索引的卡片工作台。`Phase 3 search capability` 已经完成，插件全面转向 **indexed-only** 搜索架构。不再支持非索引降级搜索，以确保搜索结果的权威性和一致性。

## 当前处于什么阶段？

项目处于**稳定发布态**。当前重点是 indexed-only 搜索架构的完整落地与混合文件类型卡片语义收敛。具体版本号请查看 `manifest.json` 或 release tags。

- 已完成：版本元数据同步与发布契约校验链路。
- 已完成：`main.ts` 持有 plugin-global 搜索生命周期，负责 indexed 服务初始化、快照订阅、命令注册和 rebuild 调度。
- 已完成：`FolderCardView.ts` 统一收集受支持卡片文件，并根据 `IndexedSearchService` 的状态矩阵决策是否呈现搜索结果。
- 已完成：`SearchIndexManager` 和 `IndexStore` 实现了基于 IndexedDB 的索引恢复、全量构建、增量更新和 unsafe 重名保护。
- 已完成：插件全面移除 fallback 搜索路径，当索引未就绪时，非空查询会被明确阻塞，避免呈现不可靠的结果。
- 已完成：`CardItem.svelte` / `FolderCardPanel.svelte` 现在会为非 Markdown 卡片显示文件类型图标与占位摘要，让这些文件能以稳定 UI 合约进入卡片流。
- 已完成：卡片 hover preview 继续走 Obsidian 官方 `hover-link` 路径，但触发表面已从“仅标题”扩展为卡片的 title / excerpt / meta 三块非控件区域。
- 已完成：Markdown 卡片的轻量 preview 采用拍平强调语法的文本抽取，并在共享预算内按源码顺序保留多个文本块与代码块。
- 已完成：folder load 现在会在 `loading=true` 阶段按当前 pipeline 投影预热首屏前 6 张可见卡片，但最多等待 120ms；快路径仍直接展示带 preview 的首屏卡片，慢路径会先提交稳定卡片状态，再由后台 hydration 补齐 preview。
- 已完成：卡片默认点击对齐主编辑区 recent-root fallback 语义，不再由设置驱动，而是由 `main.ts` 统一根据当前 leaf 状态决定。
- 已完成：批量删除与单卡右键 `Delete` 统一遵循 Obsidian `Files & Links` 的删除偏好。
- 已完成：标准仓库验证仍是 `npm run check`、`npm run build`、`npm test`；而 release workflow 会在此基础上额外执行 `npm run check:svelte`。
- 已完成：仓库具备最小 GitHub Release 支持，通过裸 semver tag 触发 draft release 生成。
- 已完成：版本发布前的元数据对齐工具链已稳固，支持同步版本号并校验发布契约。
- 已完成：scope 模型已收敛为 folder-only。插件启动与会话恢复默认进入 `根目录 / + includeSubfolders=true`；`lastFolderPath=""` 现在是 vault root 的正式持久化表示，不再保留 `All notes` 或“未选择文件夹”运行态。
- 已完成：`Folder scope / 文件夹范围` 树菜单现在支持 inline 文件夹管理。每行在 hover / focus 时显示 `create child`、`move`、`delete` 图标；root 仅允许新建子文件夹；move / delete 继续走 Obsidian 官方 folder picker / deletion flow。

## 回来看代码前先记住这 3 件事

1. **搜索查询全面转向 Indexed-Only 模式。** 降级搜索路径已彻底移除。真值仍在 `FolderCardView.ts`，但执行依赖于 `SearchIndexManager` 的就绪状态。
2. **`pipeline.ts` 仍是唯一投影路径。** 搜索服务返回 indexed ordering，但最终哪些卡片可见、顺序如何变化，仍由 pipeline 负责 (Tag -> Search -> Pin)；启动预热也必须先跑这条链路，再决定限时预热哪 6 张首屏候选卡片。
3. **索引阻塞规则：非就绪即阻塞。** 当索引处于 building、error 或 rebuild-required 状态时，非空查询结果为 `null` (阻塞显示)；空查询（浏览模式）始终可用。
4. **启动 preview 预热有数量和时间边界。** 这次优化没有引入 preview cache，也没有改成全量 eager hydration；首屏预热只覆盖 6 张候选卡片，并且最多等待 120ms，超出首屏的卡片仍按 viewport 事件懒加载。
5. **混合文件类型支持不等于全文索引扩容。** `markdown` 继续参与全文预览和全文索引，`base` / `canvas` / `excalidraw` 仅参与标题级匹配。
6. **默认卡片点击已经固定为 main-editor-area fallback 行为。** 这一语义不再是设置项，而是由 `main.ts` 统一控制。

## 哪些配置值最重要

- `sort.field` / `sort.direction`：控制卡片排序。
- `filter.tags`：标签筛选条件，语义是 **AND**。
- `pinnedPaths`：置顶笔记路径列表，只影响顺序。
- `includeSubfolders`：folder scope 下的数据采集开关。
- `Files & Links` 删除偏好（Obsidian 宿主配置）：不在插件设置内，但会直接影响删除行为。

需要特别注意：**没有 `searchQuery` 配置项，也没有默认卡片打开方式配置项。**

## 当前风险 / 阻塞 / 下一步

- **F3 已关闭，但真实宿主手动验证仍是已知空白。** 这是用户批准的收尾条件。
- **indexed 搜索的边界不能被随意打破。** 降级搜索路径严禁恢复，除非有明确的架构调整指令。
- **unsafe folder rename 会触发 rebuild-required。** 这是保证路径真实性的保守策略。
- **`Toolbar.svelte` a11y warnings 由 `npm run check:svelte` 跟踪。** 若存在残余 warning，应在发布前清理。
- **最小 GitHub Release 已落地，但 GitHub 仓库权限仍是外部前置条件。**

## 接下来先读哪里

1. `docs/START_HERE.md`
2. `docs/architecture.md`
3. `docs/decisions/2026-05-31-startup-preview-hydration-prewarm.md`
4. `docs/decisions/2026-05-31-collapse-scope-model-to-root-default-folder-only.md`
5. `docs/decisions/2026-04-18-close-phase3-indexed-search-capability.md`
6. `src/main.ts`
7. `src/view/FolderCardView.ts`
8. `src/search/SearchIndexManager.ts`
9. `src/search/IndexedSearchService.ts`
10. `src/view/pipeline.ts`
11. `src/view/file-kind.ts`

(End of file)
