# Phase 3 Search Capability Implementation

## TL;DR
> **Summary**: 在当前 readiness seam 已完成的基础上，把搜索从 fallback-first 升级为可恢复、可增量更新、可解释的 indexed search，同时保持 `main.ts` / `FolderCardView.ts` / `pipeline.ts` 的既有职责边界不变。
> **Deliverables**:
> - MiniSearch + IndexedDB 的正式 indexed search 后端（含 restore / rebuild / corruption recovery）
> - `IndexStore` / `SearchIndexManager` / `IndexedSearchService` 与现有 `SearchService` seam 对接
> - create / modify / delete / rename 的自动增量索引更新
> - command-palette-only 的索引重建入口
> - Toolbar 搜索状态、即时查询、pipeline relevance/fallback 语义与基础高亮闭环
> - 面向 `src/search/*`、`src/main.ts`、`src/view/*` 的 TDD 与 repo gates
> **Effort**: Large
> **Parallel**: YES - 2 waves
> **Critical Path**: Task 1 → Task 3 → Task 6 → Task 7 → Task 8 → Task 11

## Context
### Original Request
现在真正开始实现 `docs/plan/v1-development-plan.md` 中的 Phase 3，并基于当前项目状态为它制定包含功能、UI 和交互的执行计划。

### Interview Summary
- 当前仓库已经完成 phase3 search architecture readiness；本次计划不重做 readiness seam，而是在其上落真正的 indexed search。
- 用户确认：搜索采用**即时搜索**；索引入口采用**仅命令面板**；结果策略采用**index ready 按相关性排序、fallback 保持当前 sort**；解释性采用**标题/摘要基础高亮**；测试策略采用 **TDD**。
- 用户期望日常情况下索引自动跟随 create / modify / delete / rename 增量更新；全量 rebuild 仅用于首次构建、版本漂移、损坏恢复、恢复失败和手动命令。

### Metis Review (gaps addressed)
- Phase 3 必须补齐 plugin-global index health 与 per-view query state 的双通道状态模型，避免 command-triggered build/recovery 对视图不可见。
- 必须显式区分 `orderedPaths: null`（走 fallback）与 `orderedPaths: []`（indexed ready 但零结果）。
- 必须把 folder subtree rename 与 file rename 的更新语义单独定义，避免“重建是例外”目标在实现时被悄悄打破。
- 基础高亮必须限制在 title / excerpt 既有渲染面，不引入 snippet engine、分数面板或 query persistence。

## Work Objectives
### Core Objective
实现一个以 `SearchService` 为入口、以 `pipeline.ts` 为唯一可见投影链路的正式搜索系统：支持 MiniSearch + IndexedDB 持久化索引、自动增量更新、恢复与重建、即时查询、相关性排序、fallback 降级和基础高亮，同时不破坏虚拟滚动、generation guard、pin/tag 语义与宿主边界。

### Deliverables
- `src/search/` 下完整的 indexed search 模块：`IndexStore`、`SearchIndexManager`、`IndexedSearchService`、相关类型与测试
- `src/main.ts` 中的 search lifecycle、snapshot fanout、rebuild command、recovery path
- `src/view/FolderCardView.ts` 中的 per-view query/status integration、debounced instant search、stale-result protection
- `src/view/pipeline.ts` 中的 indexed relevance ordering + fallback sort semantics
- `src/view/Toolbar.svelte` / `src/view/CardItem.svelte` 的搜索状态展示与 title/excerpt 基础高亮
- 覆盖 restore、schema mismatch、corruption recovery、mutation updates、UI status/highlight 的 TDD 套件

### Definition of Done (verifiable conditions with commands)
- [ ] `npx vitest run src/search/IndexStore.test.ts src/search/SearchIndexManager.test.ts src/search/IndexedSearchService.test.ts` exits `0`.
- [ ] `npx vitest run src/main.test.ts` exits `0` with search command, lifecycle, restore/rebuild, and mutation-forwarding coverage.
- [ ] `npx vitest run src/view/pipeline.test.ts src/view/card-context-actions.test.ts src/view/Toolbar.svelte.test.ts src/view/CardItem.svelte.test.ts` exits `0` with indexed-mode, status, and highlight coverage.
- [ ] `npm run check` exits `0`.
- [ ] `npm run build` exits `0`.
- [ ] `npm test` exits `0`.

### Must Have
- 搜索 query 继续保持 runtime-only、per-view，不写入 `PluginSettings`。
- `main.ts` 继续是 search service lifecycle owner；`FolderCardView.ts` 继续是 per-view query/status owner；`Toolbar.svelte` 继续是 intent-only；`pipeline.ts` 继续是唯一投影路径。
- 后端采用 **MiniSearch + IndexedDB**；restore 必须使用异步加载路径，避免主线程长时间阻塞。
- 创建、修改、删除、单文件重命名必须自动增量更新索引；folder/subtree rename 优先做 prefix rewrite，失败时只允许调度一次后台 rebuild。
- `orderedPaths: null` 代表 fallback；`orderedPaths: []` 代表 indexed ready 的零结果；两者测试必须分开。
- active query 时：tag filter 先筛、search 再筛、pin 最后只改顺序；indexed mode 采用 relevance 顺序，fallback mode 保持当前 sort。
- Toolbar 必须显示 index health / query status，但不得出现 rebuild 按钮或 settings toggle。
- 基础高亮仅作用于 title 和现有 excerpt 渲染面；不生成新 snippet，不显示分数，不展示命中来源面板。
- 索引损坏、schema/tokenizer/plugin version 漂移、restore 失败时，系统必须自动降级到 fallback search 并暴露可恢复状态。

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- 不新增第二套 visible-card 或 search-result state system。
- 不把 query 持久化到 `settings.ts`，也不为每次输入写 settings。
- 不添加 Toolbar rebuild CTA、settings 中的搜索模式开关、或新的全局搜索面板。
- 不引入 worker、CJK 高级分词、snippet engine、score badge、search analytics、query history、saved search。
- 不让 indexed service 搜索当前视图候选集之外的路径。
- 不在 `onload()` 中执行同步全量重建；首次无索引时只能后台构建并保持 fallback 可用。

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: **TDD** with Vitest (node + jsdom).
- QA policy: 每个任务都必须同时包含实现与自动验证；UI 改动优先走现有 Svelte/Vitest harness，不依赖人工点击验证。
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.txt`
- Search-specific parity policy: indexed / fallback / empty-query / zero-result / error-recovery 语义必须各有独立断言，不得用模糊“search works”覆盖。

## Execution Strategy
### Parallel Execution Waves
> Wave 1 先把后端契约、存储、索引管理和 mutation 语义锁死；Wave 2 再接 service、plugin lifecycle、view pipeline、UI/highlight 与回归验证。

Wave 1: backend and contract foundation
- Task 1: Finalize indexed-search contract, doc schema, ranking, status, and rename semantics
- Task 2: Add MiniSearch dependency and dedicated `src/search/*` test harness
- Task 3: Implement `IndexStore` with per-vault IndexedDB persistence and version metadata
- Task 4: Implement `SearchIndexManager` build / restore / serialize / recover flow
- Task 5: Implement canonical searchable document extraction and incremental mutation classification

Wave 2: service, lifecycle, pipeline, UI, and regression closure
- Task 6: Implement `IndexedSearchService` on top of the manager
- Task 7: Wire `main.ts` lifecycle, snapshot fanout, rebuild command, and recovery notices
- Task 8: Wire `FolderCardView.ts` instant search, snapshot consumption, and stale-result guards
- Task 9: Lock pipeline semantics for relevance ordering, fallback sort, and candidate-path bounding
- Task 10: Implement Toolbar status behavior and CardItem basic highlighting
- Task 11: Run Phase 3 search regression matrix and repo gates

### Dependency Matrix (full, all tasks)
- **1**: — → 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
- **2**: 1 → 3, 4, 6, 11
- **3**: 1, 2 → 4, 6, 7, 11
- **4**: 1, 2, 3 → 6, 7, 8, 11
- **5**: 1, 2 → 4, 6, 9, 10, 11
- **6**: 1, 2, 3, 4, 5 → 7, 8, 9, 10, 11
- **7**: 1, 3, 4, 6 → 8, 10, 11
- **8**: 1, 4, 6, 7 → 9, 10, 11
- **9**: 1, 5, 6, 8 → 10, 11
- **10**: 1, 5, 7, 8, 9 → 11
- **11**: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 → FINAL

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 5 tasks → `deep` (1, 3, 4), `quick` (2), `unspecified-high` (5)
- Wave 2 → 6 tasks → `deep` (6, 7), `unspecified-high` (8, 9, 11), `visual-engineering` (10)

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Finalize the indexed-search contract, document schema, ranking semantics, and rename/recovery rules

  **What to do**: Lock the implementation-facing contract before any storage or service code changes. Update `src/search/types.ts` and adjacent runtime types so the system has explicit meanings for query execution state, index health snapshot, mutation classification, restore/rebuild outcomes, and result ordering. Define the canonical searchable document shape used by MiniSearch as `{ path, title, normalizedTitle, content, excerpt, folderPath, mtime, ctime }` and explicitly do **not** index tags in Phase 3 because tag filtering already has its own pipeline lane. Freeze the Phase 3 MiniSearch configuration: index fields `title` and `content`, store fields `path`, `title`, `excerpt`, lowercase term normalization, `prefix: true`, `fuzzy: false`, `combineWith: "AND"`, and title boost higher than content (3:1). Define that active indexed search returns candidate-bounded `orderedPaths` in relevance order and optional score metadata for internal/internal-test use only; fallback search continues to use current sort order. Define explicit semantics for create / modify / delete / file rename / folder rename / corruption / schema mismatch / tokenizer version mismatch. Folder/subtree rename is in scope for automatic handling: the first path is safe prefix rewrite across affected docs; if the manager cannot safely prove consistency, it must schedule one background rebuild and expose `building`/`fallback` rather than silently serving stale data.

  **Must NOT do**: Do not implement MiniSearch or IndexedDB in this task. Do not add UI decisions to `Toolbar.svelte`. Do not expose score metadata to rendering. Do not persist query text or add settings toggles.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: this task freezes the contracts every later search/index task depends on.
  - Skills: []
  - Omitted: [`refactor`] - this is contract hardening, not broad cleanup.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 | Blocked By: none

  **References**:
  - Pattern: `src/search/types.ts` - existing `SearchService`, `SearchQueryRequest`, `SearchQueryResult`, `SearchServiceSnapshot`, `SearchStatus` seam
  - Pattern: `src/view/types.ts` - existing `PipelineSearchInput` and ownership commentary
  - Pattern: `src/view/pipeline.ts` - current `applySearchFilter()` null-vs-array behavior
  - Pattern: `src/main.ts` - plugin lifecycle owner for service construction and mutation forwarding
  - Contract: `docs/plan/v1-development-plan.md:486-579` - T37-T40 goals and invariants
  - Decision: `docs/decisions/2026-04-18-phase3-search-architecture-readiness.md:25-33` - readiness seam already fixed; Phase 3 must extend rather than redesign it

  **Acceptance Criteria** (agent-executable only):
  - [ ] `src/search/types.ts` and adjacent runtime types encode explicit meanings for fallback vs indexed zero-result (`orderedPaths: null` vs `[]`).
  - [ ] Contract comments/types define that `main.ts` owns plugin-global index health and `FolderCardView.ts` owns per-view query state.
  - [ ] Folder rename handling is explicitly specified in types/tests as either safe prefix rewrite or rebuild-required fallback path.
  - [ ] MiniSearch field/boost/tokenization/search-option choices are explicitly fixed in code comments/tests so the implementer does not need to choose them later.
  - [ ] No search fields are added to `PluginSettings` or settings UI types.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Search contract semantics compile and remain settings-free
    Tool: Bash
    Steps:
      1. Run `npm run check`
      2. Run `npx vitest run src/settings.test.ts src/main.test.ts`
      3. Save outputs to `.sisyphus/evidence/task-1-typecheck.txt` and `.sisyphus/evidence/task-1-settings-boundary.txt`
    Expected: Typecheck passes, settings tests remain search-query-free, and lifecycle tests still compile against the explicit contract
    Evidence: .sisyphus/evidence/task-1-typecheck.txt

  Scenario: Pipeline contract keeps fallback and indexed-zero semantics distinct
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/pipeline.test.ts -t "search"`
      2. Save output to `.sisyphus/evidence/task-1-pipeline-contract.txt`
    Expected: Search-focused pipeline tests pass and explicitly differentiate `orderedPaths: null` from `orderedPaths: []`
    Evidence: .sisyphus/evidence/task-1-pipeline-contract.txt
  ```

  **Commit**: YES | Message: `refactor(search): lock indexed search contract` | Files: `src/search/types.ts`, `src/view/types.ts`, minimal affected tests

- [x] 2. Add MiniSearch dependency and establish dedicated search-layer TDD harnesses

  **What to do**: Introduce the MiniSearch dependency and create the test scaffolding that will drive the backend implementation. Add `src/search/IndexStore.test.ts`, `src/search/SearchIndexManager.test.ts`, and `src/search/IndexedSearchService.test.ts` to lock persistence metadata, async restore behavior, mutation application, corruption handling, rebuild semantics, and query result ordering before deeper implementation begins. The executor must still follow TDD inside the task (write the failing specs first), but the task is not complete until the harness and its minimal compile-safe helpers are green. Ensure test helpers model per-vault namespaces, schema/tokenizer/plugin version metadata, and fake persistence payloads without touching real repo files.

  **Must NOT do**: Do not implement the production classes yet beyond minimal compile seams. Do not add IndexedDB code directly to `main.ts` in this task. Do not broaden tests into worker/ranking/CJK scenarios.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: focused setup work that creates the executable red-phase skeleton.
  - Skills: []
  - Omitted: [`playwright`] - pure node-layer test harness work.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 3, 4, 6, 11 | Blocked By: 1

  **References**:
  - Pattern: `vitest.config.ts` - current dual-project Vitest setup
  - Pattern: `src/main.test.ts` - plugin lifecycle mock patterns for service tests
  - Pattern: `src/view/pipeline.test.ts` - concise pure-function TDD style already used in repo
  - External: `https://lucaong.github.io/minisearch/` - official MiniSearch API surface
  - External: librarian findings - `loadJSONAsync` and `toJSON()`/restore path should be preferred for large restores

  **Acceptance Criteria** (agent-executable only):
  - [ ] MiniSearch is added as a dependency and the repo still typechecks/builds.
  - [ ] New `src/search/*.test.ts` files exist and pass with compile-safe harness helpers in place.
  - [ ] Tests cover namespace metadata, schema/version drift, async restore, and corruption/recovery cases at the spec level.
  - [ ] No test relies on real IndexedDB state shared across files or user environment.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Search-layer happy path harness is established
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/search/IndexStore.test.ts src/search/SearchIndexManager.test.ts src/search/IndexedSearchService.test.ts`
      2. Save output to `.sisyphus/evidence/task-2-search-harness.txt`
    Expected: Test runner discovers the new suites and they pass with the minimal harness/helpers required for later backend work
    Evidence: .sisyphus/evidence/task-2-search-harness.txt

  Scenario: Search-layer edge case harness stays environment-isolated
    Tool: Bash
    Steps:
      1. Run `npm run check`
      2. Save output to `.sisyphus/evidence/task-2-typecheck.txt`
    Expected: Typecheck passes with the new dependency and test files present, proving the harness does not depend on unstable real IndexedDB state
    Evidence: .sisyphus/evidence/task-2-typecheck.txt
  ```

  **Commit**: YES | Message: `test(search): scaffold indexed search harnesses` | Files: `package.json`, lockfile, `src/search/*.test.ts`, optional helpers

- [x] 3. Implement `IndexStore` with per-vault IndexedDB persistence and version metadata

  **What to do**: Create `src/search/IndexStore.ts` as the storage boundary responsible for serializing/deserializing the MiniSearch index payload and metadata into IndexedDB under a per-vault namespace. Use one IndexedDB database named `folder-card-explorer-search` with one object store `searchIndexes`; each record key is a stable `vaultId` string supplied by plugin runtime, and each record value is `{ metadata, serializedIndexJson }`. Store and validate at minimum `vaultId`, `schemaVersion`, `tokenizerVersion`, `pluginVersion`, `docCount`, and `lastIndexedAt`. `vaultId` must be derived by the plugin from vault base path when available and fall back to vault name only when no stable base path is exposed. Expose read/write/clear primitives, corruption detection, and version-mismatch signaling without embedding search logic. Use async restore primitives and design for graceful fallback if IndexedDB is unavailable or quota/construction errors occur. All persistence errors must surface as typed outcomes the service layer can convert into `fallback` + rebuild-needed states.

  **Must NOT do**: Do not let `IndexStore` know about Svelte, view scope, or query text. Do not trigger rebuilds or notices from inside the store. Do not persist per-query caches or UI state.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: persistence boundary and corruption semantics have long-lived impact.
  - Skills: []
  - Omitted: [`git-master`] - no git-specific work required.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 4, 6, 7, 11 | Blocked By: 1, 2

  **References**:
  - Contract: `src/search/types.ts` - snapshot and restore outcome types from Task 1
  - External: MiniSearch docs - `toJSON()` / `loadJSONAsync()` persistence APIs
  - External: librarian findings - IndexedDB quota/error and async restore guidance
  - Pattern: `src/settings.ts` - normalized persisted metadata style in repo

  **Acceptance Criteria** (agent-executable only):
  - [ ] `IndexStore` can persist and restore a serialized index + metadata for one vault namespace.
  - [ ] Version mismatch returns a typed rebuild-needed outcome instead of unsafe restore.
  - [ ] Corrupt payloads are detected and can be cleared via the storage API.
  - [ ] IndexedDB unavailable/error cases degrade to typed failure results without throwing uncaught errors into plugin lifecycle code.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: IndexStore persists, restores, and rejects stale schema payloads
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/search/IndexStore.test.ts`
      2. Save output to `.sisyphus/evidence/task-3-index-store.txt`
    Expected: Store tests pass for happy-path restore, schema mismatch, corruption detection, and clear/reset paths
    Evidence: .sisyphus/evidence/task-3-index-store.txt

  Scenario: Storage layer remains compile-safe for plugin integration
    Tool: Bash
    Steps:
      1. Run `npm run check`
      2. Save output to `.sisyphus/evidence/task-3-index-store-check.txt`
    Expected: Typecheck passes with the new persistence boundary and result types
    Evidence: .sisyphus/evidence/task-3-index-store-check.txt
  ```

  **Commit**: YES | Message: `feat(search): add persistent index store` | Files: `src/search/IndexStore.ts`, related types/tests

- [x] 4. Implement `SearchIndexManager` build, restore, incremental update, and recovery flow

  **What to do**: Create `src/search/SearchIndexManager.ts` as the engine-facing coordinator over MiniSearch and `IndexStore`. Responsibilities: initial empty/build state, async restore via `loadJSONAsync`, full rebuild from canonical docs, safe incremental add/update/remove operations, prefix rewrite for file/folder rename where possible, dirty/rebuild-needed tracking, and automatic clear+rebuild scheduling on corruption or version drift. Keep query-independent index state here, including snapshot generation for `building` / `ready` / `error`, rebuild reasons, and doc counts. Define one canonical background-work model: plugin-owned manager can build in chunks/yields and publish snapshots; it must never require a view to be open. Mutations received while a full build is running must be coalesced into a pending queue/dirty flag and reconciled once the build completes, rather than starting nested rebuilds.

  **Must NOT do**: Do not own UI notices or command registration here. Do not read Obsidian vault files directly from random call sites; use explicit inputs/adapters. Do not let rename failures silently serve stale paths.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: central backend orchestrator with the highest correctness risk in Phase 3.
  - Skills: []
  - Omitted: [`refactor`] - must stay tightly scoped to search module.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 6, 7, 8, 11 | Blocked By: 1, 2, 3, 5

  **References**:
  - Pattern: `src/search/NoIndexSearchService.ts` - existing minimal service behavior to preserve for fallback paths
  - Pattern: `src/main.ts` - current mutation forwarding and service lifecycle seam
  - External: MiniSearch docs - async restore and serialization support
  - External: librarian findings - `loadJSONAsync`, vacuuming, quota handling, async restore pitfalls

  **Acceptance Criteria** (agent-executable only):
  - [ ] Manager can restore from persisted payload asynchronously and publish `building -> ready` snapshots.
  - [ ] Manager can full-build from canonical docs and persist the result.
  - [ ] Manager can incrementally apply create / modify / delete / file rename, and either safely rewrite or escalate folder rename.
  - [ ] Corrupt or version-incompatible state clears persisted data and schedules rebuild while leaving search fallback-capable.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Manager restore/build/recovery paths are locked by tests
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/search/SearchIndexManager.test.ts`
      2. Save output to `.sisyphus/evidence/task-4-index-manager.txt`
    Expected: Tests pass for async restore, full build, incremental mutations, folder rename escalation, and corruption recovery
    Evidence: .sisyphus/evidence/task-4-index-manager.txt

  Scenario: Search module still passes low-level compile validation
    Tool: Bash
    Steps:
      1. Run `npm run check`
      2. Save output to `.sisyphus/evidence/task-4-index-manager-check.txt`
    Expected: Typecheck passes with manager snapshots and mutation result types
    Evidence: .sisyphus/evidence/task-4-index-manager-check.txt
  ```

  **Commit**: YES | Message: `feat(search): add index manager lifecycle` | Files: `src/search/SearchIndexManager.ts`, related tests/types

- [x] 5. Implement canonical searchable document extraction and mutation classification

  **What to do**: Add the pure document-preparation layer used by builds and incremental updates. This layer must convert Obsidian notes into one canonical searchable representation that aligns with current fallback semantics closely enough for user expectations: title text, normalized title tokens, full plain-text note body for indexing, and excerpt/plain-text content derived from the same or compatible source as existing card previews/search fallback. Build the indexed body from `vault.cachedRead(file)` + the existing markdown-to-text normalization path; modify events must re-read only the affected file. Define and test mutation classification helpers that map vault events into `add/update/remove/file-rename/folder-rename/rebuild-required` decisions with explicit inputs. Keep excerpt/highlight source compatibility in mind so title/excerpt highlighting later can reuse indexed or locally prepared text without generating new preview systems.

  **Must NOT do**: Do not implement UI highlighting here. Do not add a second markdown parsing pipeline unrelated to current preview/search helpers if existing utilities can be reused safely. Do not start indexing tags unless the contract from Task 1 explicitly includes them.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: bridges data extraction, mutation semantics, and later UI consistency.
  - Skills: []
  - Omitted: [`obsidian-plugin-docs`] - this is internal data-shaping work, not host API guidance.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4, 6, 9, 10, 11 | Blocked By: 1, 2

  **References**:
  - Pattern: `src/view/metadata-utils.ts` - current fallback search semantics
  - Pattern: `src/view/markdown-utils.ts` - existing preview text/html derivation constraints
  - Pattern: `src/view/CardItem.svelte` - current title/excerpt render surfaces
  - Pattern: `src/main.ts` - current create/modify/delete/rename mutation forwarding shapes

  **Acceptance Criteria** (agent-executable only):
  - [ ] Canonical searchable docs can be built from note inputs without requiring view state.
  - [ ] Mutation classification distinguishes file rename from folder/subtree rename and can signal rebuild-required explicitly.
  - [ ] Prepared title/content fields are compatible with both MiniSearch indexing and later title/excerpt highlighting.
  - [ ] Extraction/parsing tests cover empty content, markdown-heavy content, and rename edge cases.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Search document extraction stays aligned with fallback semantics
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/search/SearchIndexManager.test.ts -t "document extraction" src/view/metadata-utils.test.ts`
      2. Save output to `.sisyphus/evidence/task-5-search-docs.txt`
    Expected: Tests pass and show canonical search docs preserve expected title/content searchability
    Evidence: .sisyphus/evidence/task-5-search-docs.txt

  Scenario: Mutation classification is explicit and deterministic
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/search/SearchIndexManager.test.ts -t "mutation"`
      2. Save output to `.sisyphus/evidence/task-5-mutation-classification.txt`
    Expected: Tests pass for create, modify, delete, file rename, and folder rename classification paths
    Evidence: .sisyphus/evidence/task-5-mutation-classification.txt
  ```

  **Commit**: YES | Message: `feat(search): add canonical search documents` | Files: `src/search/*`, minimal utility/test files

- [x] 6. Implement `IndexedSearchService` on top of the manager and preserve fallback-safe querying

  **What to do**: Add `src/search/IndexedSearchService.ts` as the production `SearchService` implementation that wraps `SearchIndexManager`. The service must expose the existing seam: `initialize()`, `dispose()`, `query()`, `handleVaultMutation()`, `subscribe()`, and `getSnapshot()`. `query()` must always accept `candidatePaths` and never return paths outside that set. When the manager is not ready, restoring, rebuilding, or in error, the service must return the correct typed result so `FolderCardView.ts` can fall back cleanly (`orderedPaths: null` with the appropriate status). When ready, it must return candidate-bounded relevance-ordered paths and optional internal score metadata. Snapshot emission must be plugin-global and independent of any view. Use `NoIndexSearchService` as the fallback-safe behavioral baseline for non-ready states.

  **Must NOT do**: Do not let the service own per-view query text. Do not bypass candidate-path filtering even if MiniSearch returns global hits. Do not expose MiniSearch classes directly to `main.ts` or view code.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: this is the stable seam between plugin lifecycle, index manager, and all views.
  - Skills: []
  - Omitted: [`git-master`] - architecture/runtime work only.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 7, 8, 9, 10, 11 | Blocked By: 1, 2, 3, 4, 5

  **References**:
  - Pattern: `src/search/NoIndexSearchService.ts` - current seam and expected fallback-safe behavior
  - Contract: `src/search/types.ts` - service interface and snapshot/result types
  - Pattern: `src/main.ts` - current `initializeSearchService()` / `getSearchService()` / mutation forwarding
  - Pattern: `src/view/FolderCardView.ts` - current `refreshSearchProjection()` expectations around `query()` results

  **Acceptance Criteria** (agent-executable only):
  - [ ] `IndexedSearchService` satisfies the existing `SearchService` contract without changing view ownership boundaries.
  - [ ] Query results are bounded to `candidatePaths` and return relevance-ordered paths only when the manager is ready.
  - [ ] Non-ready, restore, rebuild, and error states degrade to typed fallback-safe query outcomes.
  - [ ] Service snapshots are subscribable and usable by plugin/view wiring without leaking MiniSearch internals.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Indexed search service contract passes all low-level behavior tests
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/search/IndexedSearchService.test.ts`
      2. Save output to `.sisyphus/evidence/task-6-indexed-service.txt`
    Expected: Tests pass for initialize/query/subscribe/dispose, candidate-path bounding, fallback-safe non-ready states, and ordered result output
    Evidence: .sisyphus/evidence/task-6-indexed-service.txt

  Scenario: Existing plugin/view code still compiles against the service seam
    Tool: Bash
    Steps:
      1. Run `npm run check`
      2. Save output to `.sisyphus/evidence/task-6-indexed-service-check.txt`
    Expected: Typecheck passes with `IndexedSearchService` satisfying the existing `SearchService` interface
    Evidence: .sisyphus/evidence/task-6-indexed-service-check.txt
  ```

  **Commit**: YES | Message: `feat(search): add indexed search service` | Files: `src/search/IndexedSearchService.ts`, related tests/exports

- [x] 7. Wire `main.ts` lifecycle, snapshot fanout, rebuild command, and recovery notices

  **What to do**: Replace the plugin’s default `NoIndexSearchService` construction path with the new indexed service while preserving safe fallback if initialization fails. `main.ts` must remain the only owner of service construction, initialization, disposal, and vault mutation forwarding. Service initialization must attempt async restore immediately during plugin startup; if no valid persisted index exists, `main.ts` must schedule a background full build after layout is ready rather than blocking `onload()`. Add exactly two command-palette-only search commands: `rebuild-folder-card-search-index` / `Rebuild Folder Card Explorer search index` and `recover-folder-card-search-index` / `Recover Folder Card Explorer search index`. Commands must route through the plugin-owned service/manager, not directly touch view code. Add a plugin-global snapshot fanout path so open views can observe `building` / `ready` / `error` changes even when no query is active. Recovery notices should be concise, stateful, and only emitted at actual failure/recovery boundaries.

  **Must NOT do**: Do not add Toolbar buttons or settings toggles. Do not kick off synchronous full rebuild on plugin `onload()`. Do not let notices spam on every mutation. Do not make commands require an open view.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: touches host lifecycle, commands, and cross-view status propagation.
  - Skills: [`obsidian-plugin-docs`] - lifecycle/command patterns and cleanup guidance
  - Omitted: [`frontend-ui-ux`] - this task is host wiring, not visual design.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 8, 10, 11 | Blocked By: 1, 3, 4, 6

  **References**:
  - Pattern: `src/main.ts` - command registration, lifecycle ownership, observer wiring
  - Pattern: `src/main.test.ts` - existing plugin lifecycle and mutation-forwarding test style
  - Docs: `.agents/skills/obsidian-plugin-docs/references/ui.md` - Obsidian command patterns
  - Docs: `.agents/skills/obsidian-plugin-docs/references/events.md` - lifecycle and cleanup guidance

  **Acceptance Criteria** (agent-executable only):
  - [ ] Plugin initializes the indexed service, degrades safely to fallback on init failure, and disposes cleanly on unload.
  - [ ] Command palette exposes exactly the two planned rebuild/recovery entrypoints and they route through plugin-owned search lifecycle only.
  - [ ] Open views can receive plugin-global snapshot changes without requiring a live query.
  - [ ] Recovery notices appear on actual corruption/rebuild boundaries and are not emitted per-keystroke or per-mutation.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Plugin lifecycle and command registration honor indexed search ownership
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/main.test.ts`
      2. Save output to `.sisyphus/evidence/task-7-main-lifecycle.txt`
    Expected: Tests pass for indexed service initialization, fallback degradation, command registration, mutation forwarding, snapshot fanout, and disposal
    Evidence: .sisyphus/evidence/task-7-main-lifecycle.txt

  Scenario: Repo still builds with search commands and lifecycle wiring
    Tool: Bash
    Steps:
      1. Run `npm run build`
      2. Save output to `.sisyphus/evidence/task-7-main-build.txt`
    Expected: Production build succeeds with the new plugin-owned search lifecycle and commands
    Evidence: .sisyphus/evidence/task-7-main-build.txt
  ```

  **Commit**: YES | Message: `feat(search): wire plugin lifecycle and rebuild commands` | Files: `src/main.ts`, `src/main.test.ts`, search exports/types as needed

- [x] 8. Wire `FolderCardView.ts` instant search, snapshot consumption, and stale-result guards

  **What to do**: Extend the view coordinator so per-view search remains runtime-only but now consumes plugin-global service snapshots and indexed query results. Add one debounced instant-search path in `FolderCardView.ts` (not `Toolbar.svelte`) with a 120ms debounce so typing remains responsive while avoiding over-querying the service. Maintain the existing `searchRequestSeq` and generation-based stale-result protection, but strengthen it so snapshot updates, rapid query changes, folder changes, and rebuild transitions cannot surface stale ordered paths. Map plugin-global snapshot state plus current query into view-facing `searchStatus` semantics: empty query can still show build/error readiness, active query can show fallback/ready/building/error appropriately. Reset query must clear ordered paths, preserve plugin-global index health awareness, and restore normal projection without reloading settings.

  **Must NOT do**: Do not move query ownership into `Toolbar.svelte` or plugin settings. Do not allow snapshot subscriptions to leak after view close. Do not trigger vault-wide rebuilds from user typing.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: central runtime coordination with multiple asynchronous inputs and stale-result risk.
  - Skills: []
  - Omitted: [`refactor`] - retain current coordinator role; only add required search runtime logic.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 9, 10, 11 | Blocked By: 1, 4, 6, 7

  **References**:
  - Pattern: `src/view/FolderCardView.ts` - current `searchQuery`, `searchStatus`, `refreshSearchProjection()`, `loadFolder()`, `pushState()` flow
  - Pattern: `src/view/panel-model.ts` - bridge for `searchQuery` / `searchStatus`
  - Test: `src/view/card-context-actions.test.ts` - strongest integration harness for query ownership and interaction behavior
  - Guardrail: Oracle findings - request id + load generation must both gate async search result application

  **Acceptance Criteria** (agent-executable only):
  - [ ] Query stays per-view and runtime-only while the view can still reflect plugin-global build/error state.
  - [ ] Rapid typing, folder switches, and rebuild transitions cannot surface stale indexed results.
  - [ ] One debounced query path exists in the view coordinator only.
  - [ ] Resetting or clearing query restores normal projection without losing global index-health visibility.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: View preserves coordinator ownership and stale-result safety
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/card-context-actions.test.ts -t "search"`
      2. Save output to `.sisyphus/evidence/task-8-view-search.txt`
    Expected: Tests pass for debounced query handling, query reset, folder-switch overlap, snapshot/status mapping, and stale-result dropping
    Evidence: .sisyphus/evidence/task-8-view-search.txt

  Scenario: Host seam remains intact after view search wiring
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/FolderCardView.test.ts`
      2. Save output to `.sisyphus/evidence/task-8-view-host.txt`
    Expected: Existing host-contract tests still pass with no subscription or lifecycle regressions
    Evidence: .sisyphus/evidence/task-8-view-host.txt
  ```

  **Commit**: YES | Message: `feat(search): integrate indexed search into view runtime` | Files: `src/view/FolderCardView.ts`, related tests/panel model if needed

- [x] 9. Lock pipeline semantics for indexed relevance ordering, fallback sort, and filter invariants

  **What to do**: Update `src/view/pipeline.ts` so indexed-mode and fallback-mode semantics are precise and permanently test-backed. When `orderedPaths` is non-null, `applySearchFilter()` must return only the matched cards present in `candidatePaths`, in the exact relevance order provided by the service. When `orderedPaths` is `null`, fallback must continue to filter in the current sorted card order. `tag -> search -> pin` must remain invariant across both modes. Pinning must continue to reorder only the surviving matches. Empty query must restore unfiltered projection. Zero indexed results must return zero cards rather than silently dropping into fallback. If score metadata is carried, keep it internal/runtime-only and do not make `pipeline.ts` depend on rendering concerns.

  **Must NOT do**: Do not let pipeline access plugin settings directly for search state. Do not let pin or tag filters be bypassed by ranked search. Do not merge highlight rendering concerns into pipeline types.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: pure projection semantics with high downstream correctness impact.
  - Skills: []
  - Omitted: [`playwright`] - pure runtime/pure-function behavior.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 10, 11 | Blocked By: 1, 5, 6, 8

  **References**:
  - Pattern: `src/view/pipeline.ts` - existing `applyTagFilter()` / `applySearchFilter()` / `applyPinReorder()` chain
  - Test: `src/view/pipeline.test.ts` - current search and pin invariants
  - Contract: `docs/plan/v1-development-plan.md:555-567` - search/tag/pin constraints
  - Guardrail: Metis findings - `orderedPaths: null` and `[]` must remain distinct

  **Acceptance Criteria** (agent-executable only):
  - [ ] Indexed results preserve service-provided relevance order inside matched candidate cards.
  - [ ] Fallback results preserve the existing sort order and continue to use local query matching.
  - [ ] Tag filtering always precedes search; pin reorder always happens after search filtering.
  - [ ] `orderedPaths: []` yields zero visible cards; `orderedPaths: null` yields fallback filtering.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Pipeline enforces indexed vs fallback semantics precisely
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/pipeline.test.ts`
      2. Save output to `.sisyphus/evidence/task-9-pipeline.txt`
    Expected: Tests pass for indexed relevance ordering, fallback sort preservation, tag-search-pin invariant, and null-vs-empty result behavior
    Evidence: .sisyphus/evidence/task-9-pipeline.txt

  Scenario: Search utility semantics still support fallback mode
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/metadata-utils.test.ts`
      2. Save output to `.sisyphus/evidence/task-9-metadata-utils.txt`
    Expected: Fallback search utility tests pass unchanged or with explicitly documented extensions
    Evidence: .sisyphus/evidence/task-9-metadata-utils.txt
  ```

  **Commit**: YES | Message: `feat(search): finalize pipeline ranking semantics` | Files: `src/view/pipeline.ts`, related tests/types

- [x] 10. Implement Toolbar status behavior and CardItem basic title/excerpt highlighting

  **What to do**: Complete the user-facing search surface without violating scope. `Toolbar.svelte` must keep the existing search input as the primary entry and display current search/index state with the exact compact labels `Search idle`, `Building index`, `Index ready`, `Fallback search`, and `Search error`. It must not grow rebuild buttons or mode toggles. `CardItem.svelte` must add basic, query-driven highlighting for title and the existing excerpt render surface only. Highlighting must be token-based on the whitespace-split query, case-insensitive, and wrap matches with `<mark class="fce-search-hit">...</mark>`; no highlight when query is empty. Prefer a runtime-only highlight representation that does not mutate note source or create a new preview pipeline; if excerpt HTML must be decorated, constrain the transform narrowly and test it against empty/no-query cases. The highlight system must work in both fallback and indexed mode, using the current query text rather than score metadata.

  **Must NOT do**: Do not add score badges, match-count chips, snippet generation, or search settings UI. Do not make highlighting depend on the index backend being ready. Do not introduce unsafe broad HTML rewriting without narrow tests.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: this task blends UI status clarity, render-surface constraints, and limited interaction polish.
  - Skills: []
  - Omitted: [`frontend-ui-ux`] - the surface is intentionally narrow and already design-constrained by repo patterns.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 11 | Blocked By: 1, 5, 7, 8, 9

  **References**:
  - Pattern: `src/view/Toolbar.svelte` - existing search input and status label surface
  - Pattern: `src/view/Toolbar.svelte.test.ts` - existing query emit/reset tests
  - Pattern: `src/view/CardItem.svelte` - existing title + preview/excerpt rendering surface
  - Pattern: `src/view/CardItem.svelte.test.ts` - current behavior-focused component tests
  - Guardrail: Metis review - highlight scope must stay title/excerpt-only; no snippet engine

  **Acceptance Criteria** (agent-executable only):
  - [ ] Toolbar shows the exact planned status labels for `idle`, `building`, `ready`, `fallback`, and `error`.
  - [ ] Toolbar contains no rebuild button or settings-like search controls.
  - [ ] CardItem highlights query matches in title and excerpt when query is non-empty.
  - [ ] No highlighting appears when query is empty, and non-matching cards/excerpts are not mutated.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Toolbar search status remains compact and command-only for rebuild actions
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/Toolbar.svelte.test.ts`
      2. Save output to `.sisyphus/evidence/task-10-toolbar.txt`
    Expected: Tests pass for status rendering, query input/reset behavior, and absence of rebuild UI controls
    Evidence: .sisyphus/evidence/task-10-toolbar.txt

  Scenario: CardItem applies basic title/excerpt highlighting only when query is active
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/CardItem.svelte.test.ts`
      2. Save output to `.sisyphus/evidence/task-10-card-highlight.txt`
    Expected: Tests pass for title highlighting, excerpt highlighting, empty-query no-op behavior, and unchanged non-match rendering
    Evidence: .sisyphus/evidence/task-10-card-highlight.txt
  ```

  **Commit**: YES | Message: `feat(search): add status UI and basic highlighting` | Files: `src/view/Toolbar.svelte`, `src/view/CardItem.svelte`, related tests/styles if needed

- [x] 11. Run the full Phase 3 search regression matrix and repo gates

  **What to do**: Finish with a regression pass that proves the whole Phase 3 stack works together and did not regress the current workbench model. Update/add only the remaining tests needed to cover the full matrix: initial build, startup restore, create/modify/delete/file rename while a query is active, folder rename escalation/rebuild path, corruption/schema mismatch recovery, query reset, index-not-ready fallback, indexed relevance ordering, and basic highlighting. Then run repo-wide validation. If the implementation reveals that any missing behavior still demands workerization, settings persistence, or a second projection path, stop and raise a scope exception instead of extending Phase 3 ad hoc.

  **Must NOT do**: Do not silently absorb Phase 4 polish work. Do not mark complete if only happy-path tests pass. Do not skip the rebuild/corruption/folder-rename failure paths.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: integration/regression hardening across plugin host, search backend, runtime coordinator, and UI.
  - Skills: []
  - Omitted: [`review-work`] - this plan already reserves a dedicated final verification wave.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: FINAL | Blocked By: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10

  **References**:
  - Test: `src/search/IndexStore.test.ts`, `src/search/SearchIndexManager.test.ts`, `src/search/IndexedSearchService.test.ts`
  - Test: `src/main.test.ts`
  - Test: `src/view/pipeline.test.ts`, `src/view/card-context-actions.test.ts`, `src/view/Toolbar.svelte.test.ts`, `src/view/CardItem.svelte.test.ts`
  - Contract: `docs/plan/v1-development-plan.md:529-590` - build/update/recovery/UI acceptance expectations
  - Decision: `docs/architecture.md:83-86` - indexed results must still re-enter `runPipeline()`

  **Acceptance Criteria** (agent-executable only):
  - [ ] All targeted search-layer, plugin, view, pipeline, and UI suites pass.
  - [ ] `npm run check`, `npm run build`, and `npm test` all pass.
  - [ ] Regression tests explicitly cover corruption recovery, rename edge cases, fallback/indexed parity boundaries, and highlighting no-op behavior on empty query.
  - [ ] The repo is ready to proceed to Phase 4 without another search-architecture rewrite.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Full Phase 3 search regression matrix passes
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/search/IndexStore.test.ts src/search/SearchIndexManager.test.ts src/search/IndexedSearchService.test.ts src/main.test.ts src/view/pipeline.test.ts src/view/card-context-actions.test.ts src/view/Toolbar.svelte.test.ts src/view/CardItem.svelte.test.ts`
      2. Save output to `.sisyphus/evidence/task-11-search-regression.txt`
    Expected: All targeted suites pass, covering restore, rebuild, mutation updates, runtime coordination, ranking, and highlighting
    Evidence: .sisyphus/evidence/task-11-search-regression.txt

  Scenario: Repo-wide gates confirm Phase 3 search completion
    Tool: Bash
    Steps:
      1. Run `npm run check`
      2. Run `npm run build`
      3. Run `npm test`
      4. Save outputs to `.sisyphus/evidence/task-11-check.txt`, `.sisyphus/evidence/task-11-build.txt`, and `.sisyphus/evidence/task-11-test.txt`
    Expected: All repo-wide gates pass with indexed search fully integrated
    Evidence: .sisyphus/evidence/task-11-check.txt
  ```

  **Commit**: YES | Message: `test(search): harden phase3 regression matrix` | Files: affected tests only

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- Commit 1: search backend foundation (`src/search/*`, dependency, low-level tests)
- Commit 2: lifecycle + runtime integration (`src/main.ts`, `src/view/FolderCardView.ts`, `src/view/pipeline.ts`, related tests)
- Commit 3: UI/highlight/regression closure (`src/view/Toolbar.svelte`, `src/view/CardItem.svelte`, final tests)
- Do not create task-by-task micro-commits; keep each commit reviewable and boundary-aligned.

## Success Criteria
- 搜索成为 card wall 的真实入口之一：index ready 时结果按相关性排序；index unavailable 时 fallback 仍可用且可解释。
- 当前 repo 在不重构 readiness seam 的前提下，具备可恢复、可重建、可增量更新的 indexed search。
- `main.ts` / `FolderCardView.ts` / `pipeline.ts` 的边界在代码与测试里都被加固，而不是被搜索功能侵蚀。
- UI 只补足搜索能力所需的状态和高亮，不越界进入 Phase 4 的视觉 / i18n / a11y 收尾。
