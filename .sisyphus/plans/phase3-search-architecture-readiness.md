# Phase 3 Search Architecture Readiness Review

## TL;DR
> **Summary**: The current architecture is good enough to enter Phase 3 only after a narrow seam-hardening pass. The repo should preserve `FolderCardView` as the runtime coordinator and `pipeline.ts` as the single visible-card projection path, while introducing an explicit search state bridge and a plugin-owned search service boundary.
> **Deliverables**:
> - Explicit search ownership model covering `main.ts`, `FolderCardView.ts`, `panel-model.ts`, `Toolbar.svelte`, and `pipeline.ts`
> - Runtime-only per-view search query/status bridge that does not persist into plugin settings
> - Replaced `applySearchFilter()` stub with tested fallback semantics based on `matchesSearchQuery()`
> - Minimal `SearchService` contract and lifecycle seam that future IndexedDB/MiniSearch work can plug into
> - Guardrails and regression tests that prevent `FolderCardView` bloat, duplicate filtering systems, and premature IndexedDB complexity
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: Task 1 → Task 2 → Task 4 → Task 5 → Task 6

## Context
### Original Request
在开始 `docs/plan/v1-development-plan.md` 的 Phase 3 前，先进行一次架构审查，判断当前架构是否需要调整或改进来承接搜索服务与索引能力。

### Interview Summary
- Phase 1 和 Phase 2 已基本完成；本次重点不是回头重构已完成功能，而是判断 Phase 3 之前是否要做前置加固。
- 审查目标是“最小必要调整”，不是为搜索提前引入一整套重型基础设施。
- 结论必须能指导后续执行者：哪些边界必须先补、哪些可以放进 Phase 3 内部完成、哪些明确禁止。

### Research Findings
- `src/view/FolderCardView.ts` 已是单一运行时协调中心，持有 `baseCards` / `visibleCards` / `selectedPath` / `bulkMode` / `selectedPaths` / hydration / generation / in-flight request 等状态，且通过 `pushState()` 汇聚到 panel model。
- `src/view/pipeline.ts:42-44` 仍把 `applySearchFilter()` 实现为 pass-through；`DEFAULT_PIPELINE_STEPS` 已保留“tag → search → pin reorder”顺序，适合作为唯一搜索投影入口。
- `src/view/metadata-utils.ts:93-125` 已有 `matchesSearchQuery()`，但尚未接入 pipeline，且没有直接单测。
- `src/view/Toolbar.svelte`、`src/view/FolderCardPanel.svelte`、`src/view/panel-model.ts` 尚无 search query / search status 状态桥接。
- `src/main.ts` 已拥有 plugin lifecycle、vault observers、settings I/O、debounced refresh，但没有后台 service lifecycle、rebuild command、IndexedDB 模式或对应测试基线。

### Metis Review (gaps addressed)
- 审查必须先锁定 ownership model：谁拥有 query state、谁执行搜索、谁拥有 index freshness、谁负责 lifecycle/disposal。
- 必须保持 `FolderCardView` 为运行时 coordinator，但不能再把搜索内部细节继续塞进该类。
- 必须保持 `pipeline.ts` 为唯一投影路径；搜索不能成为第二套可见卡片系统。
- 必须给出明确 defer 清单，防止 Phase 3 演变成 ranking / worker / persistence framework 的超范围工程。
- 若引入 plugin-owned service，必须同时定义失败语义、teardown 规则、多 view 访问方式与测试策略。

## Work Objectives
### Core Objective
Make the codebase structurally ready for Phase 3 search work by adding only the seams required for scoped search and future indexing, without broad refactors or premature persistence infrastructure.

### Deliverables
- A locked search ownership model and responsibilities matrix
- Runtime-only, per-view search query and status flow from toolbar to pipeline
- A typed `PipelineContext` that accepts explicit search inputs and explicit pinned-path inputs without unsafe casts
- Direct tests for search fallback semantics in `metadata-utils.ts` and `pipeline.ts`
- A minimal plugin-owned `SearchService` contract and injection seam compatible with later `IndexStore` / MiniSearch work
- A deferred-scope list that keeps IndexedDB, rebuild commands, ranking, and worker offloading out of the pre-Phase-3 seam hardening pass

### Definition of Done (verifiable conditions with commands)
- [ ] `npx vitest run src/view/pipeline.test.ts` exits `0` and covers real search-filter behavior instead of pass-through-only behavior.
- [ ] `npx vitest run src/view/Toolbar.svelte.test.ts` exits `0` and covers search input/query-reset/status surfacing behavior.
- [ ] `npx vitest run src/view/card-context-actions.test.ts` exits `0` and verifies the view stays the sole runtime coordinator for query changes and search refresh.
- [ ] `npx vitest run src/view/metadata-utils.test.ts` exits `0` and covers title/content fallback search semantics.
- [ ] `npx vitest run src/main.test.ts` exits `0` if plugin-level search-service lifecycle wiring is introduced in this pass.
- [ ] `npm run check` exits `0`.
- [ ] `npm run build` exits `0`.
- [ ] `npm test` exits `0`.

### Must Have
- Search query remains runtime-only and per-view; it must not be persisted into `PluginSettings`.
- `pipeline.ts` remains the only place that decides visible-card search filtering behavior.
- `FolderCardView.ts` remains coordinator only; search execution/index internals must sit behind a separate seam.
- Fallback search semantics must be explicit: empty query restores normal projection, title matches work without an index, and content matching outside index-backed mode is clearly bounded.
- Pinning must continue to affect order only and must never bypass tag/search filters.
- Any search status exposed to UI must use a finite, documented state model that stays compatible with future indexed mode.
- If a plugin-owned `SearchService` is introduced, it must have explicit init/dispose semantics and a no-index/fallback-safe mode.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Must not introduce a second filtering path outside `pipeline.ts`.
- Must not persist live query text to `settings.ts` or reuse settings persistence on every keystroke.
- Must not broaden this pass into fuzzy ranking, tokenizer tuning, worker offloading, global search platform work, or generic service frameworks.
- Must not do a broad cleanup refactor of `FolderCardView.ts`; only extract the seam needed for search readiness.
- Must not commit to IndexedDB/MiniSearch implementation details before the service contract, failure behavior, and test seam are in place.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: **TDD** with Vitest.
- QA policy: Every task includes agent-executed scenarios with exact commands and evidence paths.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.txt`
- UI verification method: prefer existing Svelte/component Vitest harnesses plus `card-context-actions.test.ts`; avoid browser-only validation for this seam-hardening pass.

## Execution Strategy
### Parallel Execution Waves
> Shared contracts and test seams go first; service/lifecycle work follows only after state flow and pipeline semantics are locked.

Wave 1: contract and state seams
- Task 1: Lock explicit search ownership and type contracts
- Task 2: Add the per-view query/status bridge through panel + toolbar + view
- Task 3: Replace fallback-search blind spots with direct metadata/pipeline tests

Wave 2: service boundary and integration hardening
- Task 4: Introduce the minimal plugin-owned `SearchService` contract and no-index adapter seam
- Task 5: Wire service access and lifecycle boundaries without committing to IndexedDB/rebuild infra
- Task 6: Run search-readiness regression hardening and repo gates

### Dependency Matrix (full, all tasks)
- **1**: — → 2, 3, 4, 5, 6
- **2**: 1 → 5, 6
- **3**: 1 → 5, 6
- **4**: 1 → 5, 6
- **5**: 1, 2, 3, 4 → 6
- **6**: 1, 2, 3, 4, 5 → FINAL

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 3 tasks → `unspecified-high` (1, 2), `quick` (3)
- Wave 2 → 3 tasks → `deep` (4), `unspecified-high` (5), `quick` (6)

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Lock the search ownership model and typed contract boundaries

  **What to do**: Define the explicit ownership matrix that Phase 3 must follow and encode it directly in the code-facing contracts. Extend `src/view/types.ts` and/or the local search contract types so responsibilities are unambiguous: `main.ts` owns plugin lifecycle and service wiring, `FolderCardView.ts` owns per-view runtime coordination and query changes, `panel-model.ts` carries query/status to Svelte, `Toolbar.svelte` emits query-change/reset intent only, and `pipeline.ts` owns visible-card search filtering. Replace any unsafe context casts by expanding `PipelineContext` to include explicitly typed search inputs and pinned-path data. If a dedicated `src/search/types.ts` is introduced, keep it minimal and purpose-built.

  **Must NOT do**: Do not add IndexedDB, MiniSearch, tokenizer, ranking, or rebuild implementation details here. Do not make `Toolbar.svelte` or `panel-model.ts` a second state owner. Do not turn `PipelineContext` into a generic bag of unrelated runtime state.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: high-leverage contract work spanning multiple integration seams and future Phase 3 decisions.
  - Skills: `[]`
  - Omitted: [`refactor`] - this is a narrow boundary lock, not a broad structural rewrite.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2, 3, 4, 5, 6 | Blocked By: none

  **References**:
  - Pattern: `src/view/pipeline.ts` - existing projection seam and current `PipelineContext` shape.
  - Pattern: `src/view/FolderCardView.ts` - current coordinator responsibilities and `deriveVisibleCards()` call path.
  - Pattern: `src/view/panel-model.ts` - current state bridge between the coordinator and Svelte components.
  - Pattern: `src/view/Toolbar.svelte` - current UI event-emission-only role.
  - Contract: `docs/plan/v1-development-plan.md:486-527` - T37/T38 requirements around `SearchService`, ordered paths, and store boundaries.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/pipeline.test.ts` exits `0` after `PipelineContext` is expanded and all tests are updated.
  - [ ] TypeScript compiles with an explicit typed search contract and no unsafe `pinnedPaths` cast in the pipeline path.
  - [ ] No search query field is added to `PluginSettings` or settings persistence tests.
  - [ ] The ownership model is reflected in code comments/types such that query state, service lifecycle, and projection responsibilities are not ambiguous.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Pipeline contract is explicit and type-safe
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/pipeline.test.ts`
      2. Run `npm run check`
      3. Save outputs to `.sisyphus/evidence/task-1-pipeline-contract.txt` and `.sisyphus/evidence/task-1-typecheck.txt`
    Expected: Tests and typecheck pass with explicit search-related pipeline inputs and no unsafe cast regressions
    Evidence: .sisyphus/evidence/task-1-pipeline-contract.txt

  Scenario: Search query remains out of persisted settings
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/settings.test.ts`
      2. Save output to `.sisyphus/evidence/task-1-settings-boundary.txt`
    Expected: Settings tests pass unchanged, confirming search query was not folded into persisted settings
    Evidence: .sisyphus/evidence/task-1-settings-boundary.txt
  ```

  **Commit**: NO | Message: `refactor(search): lock runtime ownership contracts` | Files: `src/view/types.ts`, `src/view/pipeline.ts`, optional `src/search/types.ts`, affected tests

- [x] 2. Add the per-view search query and status bridge through panel, toolbar, and coordinator

  **What to do**: Introduce runtime-only search query/status fields through `src/view/panel-model.ts`, `src/view/FolderCardPanel.svelte`, `src/view/Toolbar.svelte`, and `src/view/FolderCardView.ts`. The coordinator must own the authoritative per-view query value and update flow; Svelte components must only render current query/status and emit user intent (`query change`, `clear query`, possibly focus/open events if truly needed). Define a finite search status model compatible with future indexed mode, e.g. `idle`, `fallback`, `ready`, `building`, `error`, but keep initial semantics narrow and explicit. Query changes must trigger a cheap projection refresh path rather than settings persistence.

  **Must NOT do**: Do not persist query text. Do not build query debouncing into multiple layers. Do not let toolbar-local state become the source of truth after mount. Do not add a separate search results list or bypass `pushState()`/panel-model flow.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: touches the central coordinator/UI seam and must preserve existing runtime ownership patterns.
  - Skills: []
  - Omitted: [`frontend-ui-ux`] - this is contract/state wiring first, not a visual redesign.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 5, 6 | Blocked By: 1

  **References**:
  - Pattern: `src/view/FolderCardView.ts` - current `pushState()` and event subscription architecture.
  - Pattern: `src/view/Toolbar.svelte` - current sort/filter/bulk input emission patterns.
  - Pattern: `src/view/FolderCardPanel.svelte` - event forwarding seam to the coordinator.
  - Test: `src/view/Toolbar.svelte.test.ts` - current contract harness for UI intent emissions.
  - Test: `src/view/card-context-actions.test.ts` - existing integration harness for coordinator/event-path verification.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/Toolbar.svelte.test.ts` exits `0` with search query input/change/reset coverage.
  - [ ] `npx vitest run src/view/card-context-actions.test.ts` exits `0` with coverage proving query changes are coordinator-owned and propagate through panel state.
  - [ ] Clearing the query restores the normal visible-card projection path without a full settings reload.
  - [ ] Search status values are explicit and serializable through panel-model without introducing a second state owner.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Toolbar emits query changes and reset through the existing contract surface
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/Toolbar.svelte.test.ts -t "search query"`
      2. Save output to `.sisyphus/evidence/task-2-toolbar-search.txt`
    Expected: Tests pass and prove query change/reset stays UI-intent-only
    Evidence: .sisyphus/evidence/task-2-toolbar-search.txt

  Scenario: View remains the single runtime source of truth for active query
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/card-context-actions.test.ts -t "search query stays coordinator owned"`
      2. Save output to `.sisyphus/evidence/task-2-view-search-ownership.txt`
    Expected: Tests pass and show the query is stored and refreshed through `FolderCardView`, not component-local state
    Evidence: .sisyphus/evidence/task-2-view-search-ownership.txt
  ```

  **Commit**: NO | Message: `feat(search): add per-view query state bridge` | Files: `src/view/FolderCardView.ts`, `src/view/panel-model.ts`, `src/view/FolderCardPanel.svelte`, `src/view/Toolbar.svelte`, affected tests

- [x] 3. Replace fallback-search blind spots with direct metadata and pipeline tests

  **What to do**: Add direct unit coverage for `src/view/metadata-utils.ts`, especially `matchesSearchQuery()`, and update `src/view/pipeline.test.ts` so `applySearchFilter()` is validated as a real filtering step rather than a pass-through placeholder. Lock exact fallback semantics: empty query returns all cards, title matches work without cached content, content matches require supplied cached content or later service-backed data, and non-matching pinned cards remain filtered out before pin reorder is applied. Keep tests small and deterministic.

  **Must NOT do**: Do not introduce IndexedDB test infrastructure in this task. Do not over-test future ranking/tokenization behavior. Do not hide fallback limitations behind vague assertions.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: targeted TDD around pure functions and existing test harnesses.
  - Skills: []
  - Omitted: [`playwright`] - no browser verification needed for pure fallback semantics.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5, 6 | Blocked By: 1

  **References**:
  - Pattern: `src/view/pipeline.test.ts` - existing pipeline transformation test style.
  - Pattern: `src/settings.test.ts` - compact table-style unit coverage approach.
  - API/Type: `src/view/metadata-utils.ts` - current `matchesSearchQuery()` behavior.
  - Contract: `docs/plan/v1-development-plan.md:553-584` - T40 fallback semantics and search/tag/pin interaction constraints.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/metadata-utils.test.ts` exits `0`.
  - [ ] `npx vitest run src/view/pipeline.test.ts` exits `0` with real `applySearchFilter()` expectations.
  - [ ] Tests prove empty query resets to full projection and pinned non-matches do not survive filtering.
  - [ ] Tests prove title-only fallback works without requiring a built index.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Direct fallback search semantics are locked at the utility layer
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/metadata-utils.test.ts`
      2. Save output to `.sisyphus/evidence/task-3-metadata-search.txt`
    Expected: Test suite passes and covers title/content/empty-query behavior explicitly
    Evidence: .sisyphus/evidence/task-3-metadata-search.txt

  Scenario: Pipeline applies search before pin reorder and preserves filter invariants
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/pipeline.test.ts -t "search"`
      2. Save output to `.sisyphus/evidence/task-3-pipeline-search.txt`
    Expected: Search-focused pipeline tests pass and confirm pinning never bypasses search filtering
    Evidence: .sisyphus/evidence/task-3-pipeline-search.txt
  ```

  **Commit**: NO | Message: `test(search): lock fallback search semantics` | Files: `src/view/metadata-utils.test.ts`, `src/view/pipeline.test.ts`, minimal supporting source files

- [x] 4. Introduce the minimal plugin-owned `SearchService` contract and no-index adapter seam

  **What to do**: Create a minimal search service boundary under `src/search/` that future Phase 3 work can extend without redesigning ownership later. The service must be plugin-owned, expose explicit lifecycle and query-facing methods, and support a no-index/fallback mode from day one. Define only the contract necessary now: initialization/readiness state, disposal, query capability or ordered-path lookup seam, optional status subscription, and vault-mutation entrypoints if needed by the later Phase 3 implementation. If an interface plus a lightweight in-memory/fallback implementation is enough, prefer that over a premature persistent implementation.

  **Must NOT do**: Do not implement IndexedDB, MiniSearch, schema migrations, rebuild commands, or background worker orchestration in this task. Do not let the service own UI state. Do not push view-specific query text into a plugin-global singleton.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: architecture-sensitive service-boundary design with long downstream impact.
  - Skills: []
  - Omitted: [`git-master`] - no git workflow work is needed for the contract design itself.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 5, 6 | Blocked By: 1

  **References**:
  - Pattern: `src/main.ts` - existing plugin lifecycle owner that should host service init/dispose.
  - Pattern: `src/view/FolderCardView.ts` - current coordinator that should consume, not implement, search internals.
  - Contract: `docs/plan/v1-development-plan.md:490-520` - T37/T38 expectations for `SearchService`, ordered paths, and storage/engine boundaries.
  - External: `.agents/skills/obsidian-plugin-docs/references/events.md` - lifecycle/event cleanup guidance for Obsidian plugins.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npm run check` exits `0` with the new search service contract in place.
  - [ ] The service contract supports explicit init/dispose and a no-index/fallback-safe mode.
  - [ ] No persistence/storage implementation is introduced yet.
  - [ ] The service API does not require `FolderCardView` to manage index freshness internals directly.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Search service contract compiles without persistence coupling
    Tool: Bash
    Steps:
      1. Run `npm run check`
      2. Save output to `.sisyphus/evidence/task-4-search-service-check.txt`
    Expected: Typecheck passes with a plugin-owned search service interface and no IndexedDB dependency introduced
    Evidence: .sisyphus/evidence/task-4-search-service-check.txt

  Scenario: Search service remains view-agnostic
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/card-context-actions.test.ts -t "search service integration boundary"`
      2. Save output to `.sisyphus/evidence/task-4-search-service-boundary.txt`
    Expected: Tests pass and prove the view consumes service outputs without becoming the index engine
    Evidence: .sisyphus/evidence/task-4-search-service-boundary.txt
  ```

  **Commit**: NO | Message: `refactor(search): add plugin-owned service seam` | Files: `src/search/*`, affected `src/main.ts`/`src/view/*` wiring, tests

- [x] 5. Wire lifecycle access and search refresh boundaries without committing to IndexedDB/rebuild infrastructure

  **What to do**: Integrate the minimal service seam into `src/main.ts` and `src/view/FolderCardView.ts` so lifecycle boundaries are explicit and future Phase 3 work can safely add index building later. `main.ts` should own service construction, init, and dispose; `FolderCardView.ts` should consume service status/results through the agreed seam; vault changes should have a clearly defined forwarding point if the service later needs them, but this task must stop short of implementing a full rebuild pipeline. If lifecycle wiring is introduced, add the smallest practical `src/main.test.ts` harness to verify init/dispose and failure-safe fallback behavior.

  **Must NOT do**: Do not add rebuild commands, IndexedDB restore/rebuild logic, progress UIs, or cross-vault namespace behavior here. Do not start indexing in `onload()` beyond whatever minimal no-index init the contract requires. Do not couple fallback query typing to plugin lifecycle mutations.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: lifecycle wiring touches the plugin host and central coordinator, with regression risk.
  - Skills: []
  - Omitted: [`refactor`] - the required change is bounded and should not become a general plugin cleanup.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 6 | Blocked By: 1, 2, 3, 4

  **References**:
  - Pattern: `src/main.ts` - existing `onload()`, `onunload()`, observer registration, and refresh orchestration.
  - Pattern: `src/view/FolderCardView.ts` - current request serialization, generation-based stale-result protection, and panel push flow.
  - Test: `src/view/card-context-actions.test.ts` - strongest existing coordinator regression harness.
  - Test gap: `src/main.ts` currently has no direct tests; add only the minimum needed if lifecycle logic is changed.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/card-context-actions.test.ts` exits `0` with query-change, rapid-refresh, and stale-result safety coverage.
  - [ ] `npx vitest run src/main.test.ts` exits `0` if `main.ts` gains service lifecycle logic.
  - [ ] Empty-query reset, rapid query changes, and folder switch during active search all preserve generation-based stale-result protection.
  - [ ] Service init failure degrades to fallback-safe behavior rather than making search unusable.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Rapid query and folder changes do not break coordinator invariants
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/card-context-actions.test.ts -t "search stale result protection"`
      2. Save output to `.sisyphus/evidence/task-5-search-stale-protection.txt`
    Expected: Tests pass and confirm overlapping query/folder changes cannot surface stale search results
    Evidence: .sisyphus/evidence/task-5-search-stale-protection.txt

  Scenario: Plugin lifecycle keeps search service disposable and failure-safe
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/main.test.ts`
      2. Save output to `.sisyphus/evidence/task-5-main-search-lifecycle.txt`
    Expected: Lifecycle tests pass when present, verifying init/dispose/fallback behavior in the plugin host
    Evidence: .sisyphus/evidence/task-5-main-search-lifecycle.txt
  ```

  **Commit**: NO | Message: `feat(search): wire lifecycle-safe service access` | Files: `src/main.ts`, `src/view/FolderCardView.ts`, optional `src/main.test.ts`, related tests

- [x] 6. Run Phase 3 readiness regression hardening and repo gates

  **What to do**: Perform the final readiness pass that proves the seam-hardening work did not regress existing invariants and that the repo is ready to start actual Phase 3 implementation. Update or add only the tests needed to cover search query reset, search + tag + pin interaction, fallback-safe behavior on service unavailability, and lifecycle cleanup. Then run the repo-wide gates. If this task reveals that IndexedDB/rebuild infrastructure is still needed immediately, stop and raise a scope exception rather than implementing it ad hoc.

  **Must NOT do**: Do not silently absorb new scope. Do not add broad performance engineering or ranking work under the banner of “hardening”. Do not mark readiness complete if tests only prove the happy path.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: bounded regression verification and repo-gate execution.
  - Skills: []
  - Omitted: [`review-work`] - this plan already includes a dedicated final verification wave; do not duplicate it here.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: FINAL | Blocked By: 1, 2, 3, 4, 5

  **References**:
  - Test: `src/view/pipeline.test.ts` - search/filter/pin invariant checks.
  - Test: `src/view/Toolbar.svelte.test.ts` - query UI contract checks.
  - Test: `src/view/card-context-actions.test.ts` - integration/regression harness.
  - Test: `src/settings.test.ts` - persistence boundary guard.
  - Contract: `docs/plan/v1-development-plan.md:543-590` - T39/T40 readiness, fallback, and stop-condition constraints.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npm run check` exits `0`.
  - [ ] `npm run build` exits `0`.
  - [ ] `npm test` exits `0`.
  - [ ] Search + tag + pin behavior is fully covered by automated tests, including non-match filtering and query reset.
  - [ ] The repo is ready to begin actual Phase 3 implementation without first requiring another pre-phase architecture rewrite.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Search readiness targeted suites all pass
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/metadata-utils.test.ts src/view/pipeline.test.ts src/view/Toolbar.svelte.test.ts src/view/card-context-actions.test.ts`
      2. Save output to `.sisyphus/evidence/task-6-search-readiness-suites.txt`
    Expected: Targeted readiness suites pass and cover query reset, filter interplay, and coordinator ownership
    Evidence: .sisyphus/evidence/task-6-search-readiness-suites.txt

  Scenario: Repo gates confirm readiness for real Phase 3 work
    Tool: Bash
    Steps:
      1. Run `npm run check`
      2. Run `npm run build`
      3. Run `npm test`
      4. Save outputs to `.sisyphus/evidence/task-6-check.txt`, `.sisyphus/evidence/task-6-build.txt`, and `.sisyphus/evidence/task-6-test.txt`
    Expected: All repo-wide gates pass with the search readiness seam in place
    Evidence: .sisyphus/evidence/task-6-check.txt
  ```

  **Commit**: NO | Message: `test(search): harden phase3 readiness gates` | Files: affected tests only

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- Keep this seam-hardening pass as one focused pre-Phase-3 branch or one tightly grouped sequence of commits; do not mix in unrelated cleanup.
- Do not create a commit for IndexedDB/MiniSearch persistence in this pass unless the user explicitly expands scope.
- If lifecycle wiring lands in `main.ts`, keep it in the same readiness branch so the contract and ownership changes remain reviewable together.

## Success Criteria
- Search readiness is achieved without creating a second state owner or a second projection path.
- The repo can enter Phase 3 with an explicit service seam instead of adding more responsibilities directly into `FolderCardView.ts`.
- Fallback search behavior is correct, test-backed, and compatible with future indexed mode.
- The plan leaves IndexedDB, rebuild commands, ranking, and worker concerns explicitly deferred unless later Phase 3 measurements justify them.
