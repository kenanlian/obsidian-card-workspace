- Replaced nullable `orderedPaths` fallback semantics with explicit indexed-only execution states (`indexed-ready`, `indexed-building`, `indexed-rebuild-required`, `indexed-storage-unavailable`, `indexed-error`, `indexed-unavailable`) across search contracts, view runtime state, and pipeline tests.
- `applySearchFilter()` now filters only for `execution: "indexed-ready"`; blocked non-empty queries preserve the current folder-card projection, while empty queries still bypass search filtering entirely.
- Task 2 enriched `SearchIndexHealthSnapshot` with explicit readiness, persistence health, rebuild reason, last error, and last successful restore/build metadata so indexed query gating and recovery logic no longer infer state from `detail` strings.
- `SearchIndexManager` now preserves restore/build/mutation safeguards while surfacing explicit storage-unavailable, read-failed, load-failed, folder-rebuild-required, and write-failed health states; `main.ts` mutation recovery now keys off `rebuildReason` instead of message matching.
- Task 3 removed `NoIndexSearchService` and the runtime fallback swap: `main.ts` now keeps the indexed service bound on startup failure and pushes explicit indexed error health through `SearchIndexManager.markInitializationFailure()`, while view/tests consume indexed blocked states without local candidate filtering.
- Task 4 added a lightweight local observability seam in `main.ts` that derives `queriesAllowed` directly from the indexed snapshot and formats Notice-safe status text without exposing note contents or adding a debug panel.
- Search lifecycle commands now stay index-focused and local-only: status reports readiness/persistence/document counts plus last restore/build/error, while clear/reset uses `SearchIndexManager.clearAndReset()` before triggering a full rebuild.
- Obsidian command surfaces should be registered in `onload()` with `addCommand()`, and conditional availability should use `checkCallback()`; editor-specific commands only appear when an active editor exists, so search-status/rebuild/clear actions should stay command-palette friendly and not depend on a custom panel.
- Heavy startup work should be deferred to `workspace.onLayoutReady()`, and vault event listeners like `vault.on('create')` should be registered there via `registerEvent()` to avoid reacting during vault initialization.
- `addStatusBarItem()` is useful only as a supplemental desktop indicator; Obsidian mobile does not support custom status bar items, so any status text must remain optional and non-essential.
- Task 5 tightened the projection contract so non-empty queries with any non-ready indexed execution (`indexed-building`, `indexed-rebuild-required`, `indexed-storage-unavailable`, `indexed-error`, `indexed-unavailable`) now render an explicit empty blocked-search projection, while `FolderCardView` preserves the typed query and only forwards `orderedPaths` when execution is `indexed-ready`.
- **Panel Bridge**: `panel-model.ts` relies on Svelte 5's `$derived` bindings downstream in Svelte 4 compatibility mode. When adding new state fields for UI presentation, it requires expanding `PanelModelState`, projecting it from `FolderCardView`, and deriving new reactive combinations in components like `Toolbar.svelte`.
- **Search Blocked Projection**: A search is determined to be "blocked" locally by the UI if `cards.length === 0` (which implies zero returned results) AND `searchQuery.length > 0` AND the state is neither `idle` nor `ready`. In this state, distinguishing "No results found" vs "Search blocked" correctly utilizes the detailed snapshot health rather than inferring from string combinations.
- Task 7 moved the non-Markdown policy fully into indexed document preparation: supported non-Markdown files now produce title-only searchable documents, Markdown files still read content, and the plugin’s vault scan branches by file kind so cachedRead is only used for Markdown.
- Task 8 hardened startup search lifecycle so `onload()` still restores the indexed service promptly, but any heavy rebuild or post-restore document-state sync is deferred until `workspace.onLayoutReady()`, preserving query-capable restored indexes while keeping Obsidian startup safe.
- Task 8 also added plugin-owned single-flight/idempotency guards for recover/rebuild flows: repeated pre-layout recovery requests no-op once a startup rebuild is already queued, and vault observers are registered exactly once after layout ready via `registerEvent()`.
- Task 9 locked current indexed query semantics with regression tests at the real MiniSearch boundary: candidate lists bound the searchable result set, `indexed-ready` with `orderedPaths: []` is a true zero-match outcome distinct from blocked states, Markdown matches can come from title or content, supported non-Markdown files remain basename/title-only, and folder/path tokens do not create matches.
- Task 10 cleanup kept indexed-only behavior intact while removing leftover search-fallback terminology from generic helper names and legacy test labels; repository checks passed with the only remaining noise being pre-existing Svelte a11y warnings in Toolbar.svelte.
- The environment here does not have the configured TypeScript/oxlint LSP servers installed, so `npm run check` and `npm test` were the reliable verification sources for this cleanup task.

## 2026-05-08: Indexed-Only 架构文档迁移总结

### 关键发现
- 架构已完全移除 fallback 路径：在 `pipeline.ts` 中，非就绪状态下的非空查询现在统一返回 `null` (阻塞)，而不再尝试降级过滤。
- 状态矩阵精准化：`SearchQueryExecutionState` 涵盖了 `indexed-ready`, `indexed-building`, `indexed-rebuild-required`, `indexed-storage-unavailable`, `indexed-error`, `indexed-unavailable`。
- 投影契约锁死：`orderedPaths: null` 的语义已从 "fallback" 变更为 "blocked/unavailable"。`orderedPaths: []` 明确代表 "ready and zero results"。

### 文档同步
- `docs/architecture.md`：更新了 11-16 号原则，固化了索引生命周期和模块职责。
- `docs/START_HERE.md`：移除了 fallback 描述，更新了 Phase 3 维护态的焦点。
- `docs/decisions/`：新增了 `2026-05-08-adopt-indexed-only-search-architecture.md` 并更新了 Phase 3 关闭记录。


## 2026-05-08: 文档收敛与历史追溯清理

### 关键进展
- **历史决策显式标记**：对 `2026-04-18-phase3-search-architecture-readiness.md` 进行了大规模修订，通过 [!CAUTION] 块和内联标记将其标记为已作废/Superseded。
- **职责模型纠正**：纠正了关于非 Markdown 文件“补回”的错误描述。现在明确所有卡片（包括 title-only 的非 Markdown 文件）都由索引层统一产出结果。
- **契约一致性**：移除了文档中残留的 `orderedPaths: null` 降级触发语义，统一为“非就绪即阻塞”模型。
- **清理无用引用**：明确了 `NoIndexSearchService` 已从仓库物理删除，而非仅仅是逻辑弃用。

### 经验教训
- 在进行大规模架构变更时，历史决策文档如果不及时标记为 Superseded，会给新加入的维护者带来极大的认知负担。
- 搜索结果的“补回”逻辑从 `pipeline.ts` 移动到索引层是架构简化的关键，文档必须同步反映这一权属变更。
- Task 12 finalized the command-palette lifecycle surface in `src/main.ts`: status/recover/rebuild/clear labels now consistently describe the local search index lifecycle, and `clearAndResetSearchIndex()` gained its own single-flight promise guard so repeated reset requests cannot stack duplicate clear/rebuild work while preserving the existing startup/layout idempotency behavior.

- Task 13 regression sweep passed cleanly on 2026-05-08: the exact indexed-only focused suite (`IndexedSearchService`, `pipeline`, `FolderCardView`, `Toolbar`, `SearchIndexManager`, `IndexStore`, `card-context-actions`) and the full repo validation (`npm run check`, `npm run build`, `npm test`) all exited 0 with no migration fixes required; only the already-known non-fatal `src/view/Toolbar.svelte` a11y warnings appeared during build/test.

- Task 14 fallback-removal audit confirmed production runtime is indexed-only: `src/search/NoIndexSearchService.ts` remains deleted, `src/search/IndexedSearchService.ts` returns blocked indexed states instead of local fallback results, `src/view/pipeline.ts` only consumes `orderedPaths` for `execution: "indexed-ready"`, and `orderedPaths: null` no longer appears in `src/`.
- Audit classification pattern: raw `fallback` matches in this repo are not automatically search regressions. Acceptable survivors include host leaf-selection wording such as recent-root fallback and generic math/anchoring names like `fallbackIndex`; search-related matches must be retired docs/negative-history only.
- Task 14 also found one doc drift outside runtime code: `docs/plan/v1-development-plan.md` still described fallback search as active planning without a strong historical warning, and `docs/architecture.md` understated ready-state non-Markdown title-only indexed matches. Adding explicit historical framing plus the correct indexed matching description keeps audit/docs/tests aligned for final reviewers.

- When a persisted MiniSearch index is restored before runtime document metadata is reconciled, mutation safety should key off the index's own live ids (`has`, `documentCount`, and stored path metadata) rather than `documentsByPath`; that preserves query-capable startup restore without a vault scan while still allowing pre-sync delete/file-rename and safe folder-prefix rewrites to discard stale restored paths correctly.
- If a fire-and-forget indexed vault mutation returns `rebuildRequired`, the manager must also emit matching rebuild-required snapshot health in the same path; otherwise higher-level recovery logic that listens to health snapshots can miss required rebuild scheduling even when the mutation helper detected the failure.

## Release v0.1.2 Documentation & Metadata Update
- Successfully synchronized package.json, manifest.json, and versions.json to v0.1.2 using `npm run release:prepare -- 0.1.2`.
- Manually updated package-lock.json root and packages section to align with package.json version 0.1.2 (from 0.1.0).
- Updated README.md, docs/START_HERE.md, and docs/architecture.md to reflect v0.1.2 status and indexed-only search architecture.
- Verified that all release metadata matches and passes `npm run release:check -- 0.1.2`.
- Confirmed documentation accurately describes the removal of fallback search paths and the adoption of recent-root fallback semantics for card clicks.
