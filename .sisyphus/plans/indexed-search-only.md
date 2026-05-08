# Indexed Search Only Migration

## TL;DR
> **Summary**: Remove fallback search as a runtime and architectural path, making indexed search the only real search implementation. This is a contract migration across search result types, service lifecycle, view projection, status UX, startup recovery, tests, and docs.
> **Deliverables**:
> - Indexed-only search contract with no `orderedPaths: null` fallback semantics.
> - Removed `NoIndexSearchService` runtime path and fallback filtering from pipeline/view code.
> - Explicit search readiness/status UX for building, restoring, rebuild-required, error, and storage-unavailable states.
> - Startup restore/rebuild/recovery flow that stays Obsidian-lifecycle-safe.
> - Markdown indexed by title + content only; non-Markdown indexed by basename/title only; no path tokens for any file type.
> - Lightweight user-facing status/rebuild/clear commands, developer/test observability, tests, and docs.
> **Effort**: Large
> **Parallel**: YES - 4 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 5 → Task 8 → Final Verification Wave

## Context
### Original Request
Prometheus planning task for Card Workspace. Product decision: remove fallback search because it differs too much from formal indexed search and creates user confusion. Make indexed search the only real search path. Do not write code. Inspect the existing repo and produce a concrete implementation plan. Scope: strengthen indexed search after removing fallback. Cover search status/readiness UX, startup restore/rebuild/recovery, query semantics/ranking, non-markdown title-only indexing policy, observability/debuggability, architecture simplifications, tests/docs migration. If product decisions from 柯楠 are needed, stop and list explicit decision questions instead of assuming. Return the plan plus required decision questions.

### Interview Summary
- Confirmed: fallback search removal is a product decision.
- Confirmed: indexed search becomes the only real search path.
- Confirmed: planning-only session; no source code edits.
- Confirmed: product decisions from 柯楠 must be surfaced explicitly rather than assumed.
- Resolved by 柯楠: blocked unavailable search state with explicit status/no result list; editable preserved query that auto-runs when ready; non-Markdown title-only inclusion; no path tokens for any file type; healthy restored index can answer during background refresh; automatic rebuild + lightweight notice with manual fallback commands; preserve MiniSearch behavior with minimal ranking principles/tests; first-run auto-index after `workspace.onLayoutReady`; lightweight user-facing status/rebuild/clear commands plus developer/test observability; no heavy debug UI.

### Research Summary
- Search lifecycle and fallback service wiring live in `src/main.ts:483-754` and `src/main.ts:762-783`.
- Formal index engine lives in `src/search/SearchIndexManager.ts:42-667`.
- Indexed query boundary lives in `src/search/IndexedSearchService.ts:9-164`, currently returning `orderedPaths: null` while building/error.
- Explicit fallback implementation lives in `src/search/NoIndexSearchService.ts:9-105`.
- Search contract docs and types live in `src/search/types.ts:1-157`, including nullable ordered-path semantics.
- Searchable document preparation lives in `src/search/document-preparation.ts:28-127`.
- View query ownership, status derivation, debounce, and stale-result guards live in `src/view/FolderCardView.ts:423-450`, `src/view/FolderCardView.ts:868-909`, and `src/view/FolderCardView.ts:1940-2147`.
- Projection fallback filtering and non-Markdown title-only补回 live in `src/view/pipeline.ts:46-93` and `src/view/pipeline.ts:127-130`.
- Status UI is bridged through `src/view/panel-model.ts:8-36`, `src/view/FolderCardPanel.svelte:71-183`, and `src/view/Toolbar.svelte:35-82`, `src/view/Toolbar.svelte:174-180`.
- Search is not persisted in settings: `src/settings.ts:15-61`, `src/settings.ts:114-155`.
- Tests currently encode fallback behavior in `src/search/IndexedSearchService.test.ts:121-244`, `src/view/pipeline.test.ts:265-429`, `src/view/FolderCardView.test.ts:368-569`, `src/view/card-context-actions.test.ts:970-1170`, and `src/view/Toolbar.svelte.test.ts:385-429`.
- Index/restore/persistence tests exist in `src/search/SearchIndexManager.test.ts:113-382` and `src/search/IndexStore.test.ts:81-240`.
- Docs encode fallback/index architecture in `docs/architecture.md:7-405`, `docs/START_HERE.md:5-65`, `docs/decisions/2026-04-18-phase3-search-architecture-readiness.md:5-89`, and `docs/decisions/2026-04-18-close-phase3-indexed-search-capability.md:5-85`.

### Oracle Review (gaps addressed)
- Treat as a search contract migration, not deletion-only cleanup.
- Guard against ghost fallback: no `orderedPaths: null` or equivalent pipeline fallback may remain for non-empty queries.
- Fail closed for non-empty queries when the index is unavailable; keep empty-query browsing unaffected.
- Preserve candidate-bounded indexed search, tag → search → pin ordering, stale-generation guards, and Obsidian lifecycle discipline.
- Make rebuild-required and IndexedDB/storage failure states explicit.
- Move any approved non-Markdown search behavior into index preparation, not pipeline补回.

### Metis Review (gaps addressed)
- Added state-matrix task for empty vs non-empty queries across ready/restoring/building/rebuild-required/error/storage-unavailable.
- Added explicit product-decision checkpoints for UX, non-Markdown, ranking, first-run, and debug behavior; these are now resolved by 柯楠 and encoded below.
- Added scope guardrails to avoid adding new syntax, telemetry, settings, or ranking features unless explicitly approved.
- Added automated QA scenarios for unavailable queries, empty-query browsing, startup restore/corruption, rebuild recovery, non-Markdown policy, ranking determinism, folder mutation recovery, and debug observability.

## Applied Product Decisions from 柯楠
No unresolved product decisions remain for this plan.

1. **Unavailable non-empty query UX**: Use a blocked search state with explicit index status and no result list. Do not show zero results. Do not show stale previous results.
2. **Search input availability**: Keep search input editable while unavailable. Preserve the typed query and auto-run it once the index becomes ready.
3. **Index fields**: Markdown files are searchable by title + content only. Non-Markdown files are included in search by basename/title only. Do not index path tokens for any file type. Do not index non-Markdown full text/content.
4. **Restored index during rebuild**: A healthy restored persisted index may answer queries while background rebuild/refresh is pending.
5. **Recovery UX**: Use automatic rebuild + lightweight notice, with manual rebuild/recover commands as fallback.
6. **Ranking semantics**: Preserve current MiniSearch behavior for now. Document minimal product ranking principles and add tests around title/content behavior. No ranking redesign in this migration.
7. **First-run behavior**: Auto-start indexing after `workspace.onLayoutReady`.
8. **Debug surface scope**: Provide lightweight user-facing status/rebuild/clear commands plus developer/test observability. No heavy debug UI.

## Work Objectives
### Core Objective
Make indexed search the only runtime search path by removing fallback search contracts, code paths, UI labels, tests, and docs while strengthening index readiness, recovery, ranking clarity, and observability.

### Deliverables
- New search result/readiness contract with explicit unavailable states and no fallback sentinel.
- Removed `NoIndexSearchService` runtime path and all fallback service selection.
- Simplified projection pipeline that consumes indexed ordering only for non-empty search.
- Search status UX that distinguishes ready, restoring, building, rebuild-required, error, and storage-unavailable states.
- Startup restore/rebuild/recovery flow aligned with Obsidian load-time guidance.
- Non-Markdown title-only indexing implemented; no path tokens for any file type.
- Lightweight status/rebuild/clear commands and developer/test health observability.
- Updated test suite and docs with fallback terminology removed.

### Definition of Done (verifiable conditions with commands)
- `npm run check` passes.
- `npm run build` passes.
- `npm test` passes.
- Targeted migration tests pass:
  ```bash
  npx vitest run src/search/IndexedSearchService.test.ts src/view/pipeline.test.ts src/view/FolderCardView.test.ts src/view/Toolbar.svelte.test.ts src/search/SearchIndexManager.test.ts src/search/IndexStore.test.ts src/view/card-context-actions.test.ts
  ```
- No runtime source file contains fallback-search behavior for non-empty queries:
  - no import/reference to `NoIndexSearchService` outside deleted-file history or intentionally removed tests,
  - no production pipeline branch that filters by query when indexed results are unavailable,
  - no production `orderedPaths: null` contract used to trigger local filtering.
- Docs no longer describe fallback search as intended behavior.

### Must Have
- Indexed search is the only search path for non-empty queries.
- Empty-query folder browsing remains unaffected during all index states.
- Candidate-bounded query behavior remains: indexed results are intersected with the current folder/card candidate set rather than global-searching the vault UI.
- Tag → search → pin projection order remains intact.
- Generation/stale-result protection remains intact.
- Search readiness derives from `SearchIndexManager`/search service state, not ad-hoc view guesses.
- Startup work remains deferred and cleanup-safe per Obsidian plugin lifecycle guidance.
- Every removed fallback behavior has a replacement test expectation.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Must not implement a hidden local scan/filter backup under a different name.
- Must not leave `orderedPaths: null` as a production fallback trigger.
- Must not add network behavior or telemetry.
- Must not add new search syntax, fuzzy-query language, path-token indexing, or ranking redesign.
- Must not add lint/format tooling.
- Must not migrate Svelte components to runes.
- Must not make empty-query browsing depend on search index readiness.
- Must not require manual Obsidian QA as the only verification; all acceptance checks must be agent-executable.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after migration using existing Vitest node/jsdom projects.
- QA policy: Every task has agent-executed scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`.
- Required global commands after implementation:
  ```bash
  npm run check
  npm run build
  npm test
  npx vitest run src/search/IndexedSearchService.test.ts src/view/pipeline.test.ts src/view/FolderCardView.test.ts src/view/Toolbar.svelte.test.ts src/search/SearchIndexManager.test.ts src/search/IndexStore.test.ts src/view/card-context-actions.test.ts
  ```

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: Task 1 contract/state matrix, Task 2 index manager lifecycle/readiness, Task 3 service/runtime fallback removal, Task 4 observability command/snapshot contract.

Wave 2: Task 5 view/pipeline projection migration, Task 6 UI status/readiness UX, Task 7 non-Markdown indexing policy, Task 8 startup restore/rebuild/recovery.

Wave 3: Task 9 query semantics/ranking tests, Task 10 architecture simplification cleanup, Task 11 docs migration, Task 12 status/rebuild/clear commands and debug observability finalization.

Wave 4: Task 13 integrated regression sweep, Task 14 fallback-removal audit.

### Dependency Matrix (full, all tasks)
- Task 1 blocks Tasks 3, 5, 6, 9, 10, 13, 14.
- Task 2 blocks Tasks 3, 6, 8, 12, 13.
- Task 3 blocks Tasks 5, 10, 13, 14.
- Task 4 blocks Task 12.
- Task 5 blocks Tasks 6, 9, 13, 14.
- Task 6 blocks Tasks 13, 14.
- Task 7 blocks Tasks 9, 13.
- Task 8 blocks Tasks 12, 13.
- Task 9 blocks Task 13.
- Task 10 blocks Task 14.
- Task 11 blocks Task 14.
- Task 12 blocks Task 13.
- Task 13 blocks Task 14.
- Task 14 blocks Final Verification Wave.

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 4 tasks → deep, quick, unspecified-high.
- Wave 2 → 4 tasks → deep, visual-engineering, quick, unspecified-high.
- Wave 3 → 4 tasks → deep, quick, writing, unspecified-high.
- Wave 4 → 2 tasks → unspecified-high, deep.

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Replace fallback-capable search result contract with indexed-only state matrix

  **What to do**: Update `src/search/types.ts` and dependent type usage so non-empty search results cannot mean "fallback to local filtering". Replace or narrow `orderedPaths: null` semantics with explicit query execution states such as ready, restoring, building, rebuild-required, error, storage-unavailable, and not-initialized. Define a state matrix in comments/tests for empty query vs non-empty query across each state. Encode resolved behavior: non-empty unavailable query is a blocked state with explicit index status and no result list; search input remains editable and the preserved query auto-runs when ready; a healthy restored persisted index may answer while background rebuild/refresh is pending; first-run index build auto-starts after `workspace.onLayoutReady`.
  **Must NOT do**: Do not preserve nullable ordered paths as a production fallback trigger. Do not show unavailable search as zero results or stale previous results.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Cross-cutting type contract affects service, view, pipeline, and tests.
  - Skills: [] - No special skill required.
  - Omitted: [`obsidian-plugin-docs`] - This task is internal TypeScript contract work, not API lookup.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: Tasks 3, 5, 6, 9, 10, 13, 14 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/search/types.ts:1-157` - Existing status/execution/result semantics and nullable `orderedPaths` contract.
  - Pattern: `src/search/IndexedSearchService.ts:9-164` - Existing query result production boundary.
  - Pattern: `src/view/types.ts:9-37` - Pipeline input contract and `orderedPaths: null` vs `[]` semantics.
  - Pattern: `src/view/pipeline.ts:46-93` - Existing behavior that treats null as fallback filtering.
  - Test: `src/search/IndexedSearchService.test.ts:121-244` - Existing tests that assert fallback-safe execution while building/error.
  - Test: `src/view/pipeline.test.ts:265-429` - Existing tests for fallback filtering, indexed ordering, zero-result semantics.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/search/IndexedSearchService.test.ts src/view/pipeline.test.ts` passes with updated indexed-only expectations.
  - [ ] `npm run check` passes with no type errors from the new search result contract.
  - [ ] A content search for `orderedPaths: null` in `src/` finds no production fallback trigger; any remaining occurrence must be a test proving removal or a comment explicitly saying it is invalid legacy behavior.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Non-empty query cannot request fallback filtering
    Tool: Bash
    Steps: Run `npx vitest run src/search/IndexedSearchService.test.ts -t "unavailable"` after adding/renaming focused tests for building/error/rebuild-required query states.
    Expected: Tests assert query `"project brief"` returns an explicit unavailable state, not local-filtered ordered paths and not `orderedPaths: null`.
    Evidence: .sisyphus/evidence/task-1-indexed-contract.txt

  Scenario: Empty query remains outside search filtering
    Tool: Bash
    Steps: Run `npx vitest run src/view/pipeline.test.ts -t "empty query"` after updating pipeline tests.
    Expected: Empty query preserves unfiltered folder cards even if search status is unavailable.
    Evidence: .sisyphus/evidence/task-1-empty-query.txt
  ```

  **Commit**: YES | Message: `refactor(search): make query contract indexed-only` | Files: `src/search/types.ts`, `src/view/types.ts`, related tests

- [x] 2. Strengthen `SearchIndexManager` readiness, restore, rebuild, and health snapshots

  **What to do**: Ensure `src/search/SearchIndexManager.ts` exposes enough explicit state for indexed-only UX: restoring, building, ready, rebuild-required, error, storage unavailable/read failed/write failed, document count, last successful build/restore, last error, and rebuild reason. Preserve restore/build/persist/mutation behavior, folder rename safety, queued mutations, and generation guards. Add or update tests in `SearchIndexManager.test.ts` and `IndexStore.test.ts` for corrupt store, unavailable IndexedDB, rebuild-required state, recovery idempotency, and healthy restore.
  **Must NOT do**: Do not introduce fallback filtering when persistence or restore fails. Do not block Obsidian startup with synchronous vault scans.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Failure-state and lifecycle correctness is central to indexed-only reliability.
  - Skills: [] - No special skill required.
  - Omitted: [`obsidian-plugin-docs`] - Official lifecycle guidance is already captured in references; implementation is local.

  **Parallelization**: Can Parallel: PARTIAL | Wave 1 | Blocks: Tasks 3, 6, 8, 12, 13 | Blocked By: none

  **References**:
  - Pattern: `src/search/SearchIndexManager.ts:42-667` - Formal indexed engine, restore/build/persist/mutations, rebuild-required states.
  - Pattern: `src/search/IndexStore.ts:1-421` - IndexedDB persistence contract and restore/write/clear outcomes.
  - Pattern: `src/search/document-preparation.ts:28-127` - Document preparation and mutation classification.
  - Type: `src/search/types.ts:1-157` - Health snapshot and restore outcome types.
  - Test: `src/search/SearchIndexManager.test.ts:113-382` - Restore/build/rebuild/mutation behavior.
  - Test: `src/search/IndexStore.test.ts:81-240` - Store drift/corrupt/unavailable/write/clear behavior.
  - External: Obsidian docs guidance - heavy startup work should be deferred to `workspace.onLayoutReady`; vault listeners registered after layout ready with cleanup helpers.

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/search/SearchIndexManager.test.ts src/search/IndexStore.test.ts` passes.
  - [ ] Tests cover restore success, missing index, corrupt index, unavailable IndexedDB, write failure, rebuild-required folder rename, queued mutation recovery, and idempotent rebuild/recover command behavior.
  - [ ] Health snapshot contains enough fields for Task 6/12 UI and debug status without guessing in the view.

  **QA Scenarios**:
  ```
  Scenario: Corrupt persisted index reports explicit unavailable state
    Tool: Bash
    Steps: Run `npx vitest run src/search/IndexStore.test.ts -t "corrupt" src/search/SearchIndexManager.test.ts -t "restore"`.
    Expected: Corrupt restore transitions to rebuild-required/error health and never enables fallback search.
    Evidence: .sisyphus/evidence/task-2-corrupt-restore.txt

  Scenario: Folder rename mutation requires safe rebuild
    Tool: Bash
    Steps: Run `npx vitest run src/search/SearchIndexManager.test.ts -t "folder rename"`.
    Expected: Unsafe folder rename/move marks rebuild-required and preserves explicit status for UI/recovery.
    Evidence: .sisyphus/evidence/task-2-folder-rename.txt
  ```

  **Commit**: YES | Message: `fix(search): expose explicit index readiness states` | Files: `src/search/SearchIndexManager.ts`, `src/search/IndexStore.ts`, `src/search/types.ts`, search tests

- [x] 3. Remove `NoIndexSearchService` and fallback service selection from runtime

  **What to do**: Delete or retire `src/search/NoIndexSearchService.ts` and remove all imports/instantiation paths from `src/main.ts`. Update `src/search/IndexedSearchService.ts` so it is the only query service and returns explicit unavailable state when the index cannot answer. Remove fallback-specific notices/status strings from lifecycle code, replacing them with index-only recovery/readiness messages that are backed by `SearchIndexManager` health. Preserve restore/rebuild/recover commands, but reframe them as index lifecycle commands.
  **Must NOT do**: Do not replace `NoIndexSearchService` with another fallback implementation. Do not make `IndexedSearchService` scan candidates locally while unavailable.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Cross-file removal and lifecycle wiring changes need careful validation.
  - Skills: [] - No special skill required.
  - Omitted: [`obsidian-plugin-docs`] - Lifecycle guidance already captured; no additional docs lookup required.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: Tasks 5, 10, 13, 14 | Blocked By: Tasks 1, 2

  **References**:
  - Pattern: `src/main.ts:483-754` - Search lifecycle init, fallback to `NoIndexSearchService`, restore/rebuild/recover commands, health notices.
  - Pattern: `src/main.ts:762-783` - Mutation recovery scheduling and lifecycle tail.
  - Pattern: `src/search/NoIndexSearchService.ts:9-105` - Explicit no-index fallback mode to remove.
  - Pattern: `src/search/IndexedSearchService.ts:9-164` - Service query boundary to make indexed-only.
  - Test: `src/search/IndexedSearchService.test.ts:121-244` - Update fallback expectations.
  - Test: `src/main.test.ts` - Representative plugin lifecycle tests; inspect and update any search service expectations.

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/search/IndexedSearchService.test.ts src/main.test.ts` passes.
  - [ ] `NoIndexSearchService` has no production references; if file is deleted, no import path remains.
  - [ ] `IndexedSearchService` never returns a value that instructs the caller to perform local fallback filtering for a non-empty query.

  **QA Scenarios**:
  ```
  Scenario: Service unavailable does not filter candidates locally
    Tool: Bash
    Steps: Run `npx vitest run src/search/IndexedSearchService.test.ts -t "building"` with candidates `Notes/Meeting.md` and query `"meeting"`.
    Expected: Result reports building/unavailable and does not return locally matched `Notes/Meeting.md` as a fallback result.
    Evidence: .sisyphus/evidence/task-3-service-building.txt

  Scenario: Runtime has no no-index service path
    Tool: Bash
    Steps: Run `npm run check` after removing `NoIndexSearchService` references.
    Expected: TypeScript compiles without `NoIndexSearchService`; no runtime fallback service selection exists.
    Evidence: .sisyphus/evidence/task-3-noindex-removed.txt
  ```

  **Commit**: YES | Message: `refactor(search): remove no-index fallback service` | Files: `src/main.ts`, `src/search/IndexedSearchService.ts`, `src/search/NoIndexSearchService.ts`, related tests

- [x] 4. Define lightweight observability command and health data contract

  **What to do**: Implement local observability around the index-only lifecycle with lightweight user-facing commands and developer/test snapshots. Minimum technical contract: expose status, document count, last restore/build result, last error, rebuild-required reason, persistence health, and whether queries are allowed. Add or adjust lightweight commands for search-index status, rebuild, and clear/reset. Keep any notice lightweight; do not add heavy debug UI.
  **Must NOT do**: Do not add network telemetry. Do not add a heavy debug panel/UI. Do not create a status bar as the only recovery/debug access because status bar is desktop-only.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Needs careful boundary between product UX and developer diagnostics.
  - Skills: [`obsidian-plugin-docs`] - Use official commands/settings/status guidance for lightweight command surfaces.
  - Omitted: [] - Debug surface may touch Obsidian APIs.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: Task 12 | Blocked By: Task 2 for final health fields

  **References**:
  - Pattern: `src/main.ts:483-754` - Existing search health notices and commands.
  - Pattern: `src/settings.ts:15-61`, `src/settings.ts:114-155` - Settings shape and tab patterns; currently no search settings.
  - Pattern: `src/search/SearchIndexManager.ts:42-667` - Health snapshot source of truth.
  - External: Obsidian docs - `addStatusBarItem()` desktop-only, commands and settings are official alternate access paths, settings via `loadData()`/`saveData()`.

  **Acceptance Criteria**:
  - [ ] `npm run check` passes.
  - [ ] Tests cover status/rebuild/clear command behavior where existing harness supports it.
  - [ ] Health/debug snapshot tests assert all required fields are present and do not include vault content beyond paths/counts needed for local debugging.

  **QA Scenarios**:
  ```
  Scenario: Health snapshot reports query availability
    Tool: Bash
    Steps: Run `npx vitest run src/search/SearchIndexManager.test.ts -t "health"` after adding health assertions.
    Expected: Snapshot distinguishes ready from rebuild-required/error and includes document count plus last error/reason.
    Evidence: .sisyphus/evidence/task-4-health-snapshot.txt

  Scenario: Debug surface does not add telemetry
    Tool: Bash
    Steps: Run `npm run check` and inspect changed files in review for network APIs or remote endpoints.
    Expected: No fetch/XHR/network behavior added; debug remains local.
    Evidence: .sisyphus/evidence/task-4-no-telemetry.txt
  ```

  **Commit**: YES | Message: `feat(search): expose index health diagnostics` | Files: `src/search/SearchIndexManager.ts`, `src/search/types.ts`, optionally `src/main.ts`, `src/settings.ts`, tests

- [x] 5. Simplify view projection and remove pipeline fallback filtering

  **What to do**: Update `src/view/FolderCardView.ts`, `src/view/pipeline.ts`, and `src/view/types.ts` so the projection pipeline no longer performs local query filtering when indexed results are unavailable. Non-empty query + unavailable index must become a blocked search state with explicit index status and no result list. Search input remains editable in the panel/view model, the typed query is preserved, and the query auto-runs when the index transitions to ready. Empty query must continue to show folder cards normally. Preserve tag filtering, indexed ordering, pin reordering, virtualized assumptions, debounce, and stale-result guards.
  **Must NOT do**: Do not leave query text matching in `pipeline.ts` for fallback. Do not let pinning bypass search or tags.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: This is the highest-risk behavior migration for user-visible search results.
  - Skills: [] - No special skill required.
  - Omitted: [`frontend-ui-ux`] - UI copy/visual task is separate; this is logic and tests.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: Tasks 6, 9, 13, 14 | Blocked By: Tasks 1, 3

  **References**:
  - Pattern: `src/view/FolderCardView.ts:423-450` - Per-view query owner.
  - Pattern: `src/view/FolderCardView.ts:868-909` - Snapshot subscription/debounce/service query wiring.
  - Pattern: `src/view/FolderCardView.ts:1940-2147` - Search status derivation and stale-result guards.
  - Pattern: `src/view/pipeline.ts:46-93`, `src/view/pipeline.ts:127-130` - Current fallback filtering and tag/search/pin ordering.
  - Type: `src/view/types.ts:9-37` - Pipeline input contract.
  - Test: `src/view/pipeline.test.ts:265-429` - Fallback filtering/indexed ordering/non-Markdown补回 tests to migrate.
  - Test: `src/view/FolderCardView.test.ts:368-569` - Empty-state/status/debounce/snapshot/stale protections.
  - Test: `src/view/card-context-actions.test.ts:970-1170` - Live search query wiring, fallback status, error handling, stale async protection.

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/view/pipeline.test.ts src/view/FolderCardView.test.ts src/view/card-context-actions.test.ts` passes.
  - [ ] Non-empty query while unavailable does not locally match `Notes/Meeting.md` by title/body in pipeline/view code.
  - [ ] Empty query while unavailable still projects folder cards and preserves pin/tag behavior.

  **QA Scenarios**:
  ```
  Scenario: Unavailable index does not fallback-filter cards
    Tool: Bash
    Steps: Run `npx vitest run src/view/pipeline.test.ts -t "unavailable"` with cards `Notes/Meeting.md`, `Notes/Other.md`, query `"meeting"`, and unavailable search state.
    Expected: Pipeline/view does not return `Notes/Meeting.md`; the non-empty query enters blocked unavailable state with explicit index status and no result list.
    Evidence: .sisyphus/evidence/task-5-no-pipeline-fallback.txt

  Scenario: Empty query browsing unaffected
    Tool: Bash
    Steps: Run `npx vitest run src/view/FolderCardView.test.ts -t "empty query"` with unavailable index state.
    Expected: Folder cards still render/project without requiring the search index.
    Evidence: .sisyphus/evidence/task-5-empty-browse.txt
  ```

  **Commit**: YES | Message: `refactor(view): remove local search fallback filtering` | Files: `src/view/FolderCardView.ts`, `src/view/pipeline.ts`, `src/view/types.ts`, view tests

- [x] 6. Update search readiness/status UX copy and panel bridge

  **What to do**: Update `src/view/Toolbar.svelte`, `src/view/FolderCardPanel.svelte`, and `src/view/panel-model.ts` so UI no longer says fallback and clearly distinguishes ready/indexing/restoring/rebuild-required/error/storage-unavailable states. For non-empty unavailable searches, show blocked search state copy with explicit index status and no result list; keep search input editable and preserve the typed query for auto-run when ready. Ensure status messages avoid confusing "No results" with "index unavailable". Preserve Svelte legacy syntax and component API seam.
  **Must NOT do**: Do not introduce Svelte runes. Do not rely on hardcoded visual tokens; use existing CSS/theme style if new styling is required.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: User-facing status/readiness UX and component bridge.
  - Skills: [] - No special skill required.
  - Omitted: [`frontend-ui-ux`] - Available but not necessary unless visual redesign expands.

  **Parallelization**: Can Parallel: PARTIAL | Wave 2 | Blocks: Tasks 13, 14 | Blocked By: Tasks 1, 2, 5

  **References**:
  - Pattern: `src/view/Toolbar.svelte:35-82`, `src/view/Toolbar.svelte:174-180` - Current search status labels and toolbar summary visibility.
  - Pattern: `src/view/FolderCardPanel.svelte:71-183` - Panel prop bridge for query/status/reset/change events.
  - Pattern: `src/view/panel-model.ts:8-36` - Panel state bridge.
  - Pattern: `src/view/FolderCardView.ts:1940-2147` - Status derivation feeding panel.
  - Test: `src/view/Toolbar.svelte.test.ts:385-429` - Existing building/fallback/error status tests.
  - Test: `src/view/FolderCardPanel.svelte.test.ts` - Representative component bridge tests.

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/view/Toolbar.svelte.test.ts src/view/FolderCardPanel.svelte.test.ts src/view/FolderCardView.test.ts` passes.
  - [ ] No user-facing status string says "fallback".
  - [ ] Non-empty query unavailable state uses blocked-state copy, no result list, and does not present it as normal zero results or stale previous results.

  **QA Scenarios**:
  ```
  Scenario: Toolbar shows indexing instead of fallback
    Tool: Bash
    Steps: Run `npx vitest run src/view/Toolbar.svelte.test.ts -t "indexing"` after updating status tests.
    Expected: Building/restoring state renders explicit indexing/readiness copy and no fallback label.
    Evidence: .sisyphus/evidence/task-6-toolbar-indexing.txt

  Scenario: Error state prompts recovery without fake results
    Tool: Bash
    Steps: Run `npx vitest run src/view/FolderCardView.test.ts -t "search error"` with query `"project brief"`.
    Expected: View passes error/rebuild-required status to panel and does not show normal no-results copy.
    Evidence: .sisyphus/evidence/task-6-error-status.txt
  ```

  **Commit**: YES | Message: `fix(ui): clarify indexed search readiness states` | Files: `src/view/Toolbar.svelte`, `src/view/FolderCardPanel.svelte`, `src/view/panel-model.ts`, UI tests

- [x] 7. Implement title/content-only indexing policy inside document preparation/indexing

  **What to do**: Implement the resolved indexing policy in `src/search/document-preparation.ts` and index build/mutation paths. Markdown files must be searchable by title + Markdown content only. Non-Markdown files must be included in search by basename/title only. No path tokens are indexed for any file type. Non-Markdown contents/full text are never read or indexed. Remove non-Markdown search compensation from `src/view/pipeline.ts`; all non-Markdown matches must come from indexed title documents.
  **Must NOT do**: Do not index path tokens for Markdown or non-Markdown files. Do not read non-Markdown file contents for content indexing. Do not keep pipeline补回.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Focused indexing-policy implementation with resolved product decision.
  - Skills: [] - No special skill required.
  - Omitted: [`obsidian-plugin-docs`] - Uses existing local document preparation patterns.

  **Parallelization**: Can Parallel: PARTIAL | Wave 2 | Blocks: Tasks 9, 13 | Blocked By: Task 5

  **References**:
  - Pattern: `src/search/document-preparation.ts:28-127` - Searchable-document shaping, Markdown text extraction, title normalization, mutation classification.
  - Pattern: `src/search/SearchIndexManager.ts:42-667` - Build/mutation paths that consume prepared documents.
  - Pattern: `src/view/pipeline.ts:127-130` - Existing non-Markdown title-only补回 to remove.
  - Test: `src/view/pipeline.test.ts:265-429` - Existing non-Markdown title-only behavior tests to migrate.
  - Test: `src/search/SearchIndexManager.test.ts:113-382` - Add/adjust tests for non-Markdown documents in index.

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/search/SearchIndexManager.test.ts src/view/pipeline.test.ts` passes.
  - [ ] Markdown query behavior covers title + content only and excludes path-token-only matches.
  - [ ] Non-Markdown search behavior is basename/title-only.
  - [ ] Non-Markdown file contents are not read/indexed.
  - [ ] Path-token-only queries do not match Markdown or non-Markdown files.

  **QA Scenarios**:
  ```
  Scenario: Non-Markdown title-only policy is enforced by index, not pipeline
    Tool: Bash
    Steps: Run targeted tests with `Assets/Project Brief.pdf`, query `"project brief"`, and indexed ready state.
    Expected: `Assets/Project Brief.pdf` matches title query through indexed ordering; result does not come from pipeline compensation.
    Evidence: .sisyphus/evidence/task-7-nonmarkdown-policy.txt

  Scenario: Non-Markdown rename updates search state
    Tool: Bash
    Steps: Run `npx vitest run src/search/SearchIndexManager.test.ts -t "rename"` with `Assets/Project Brief.pdf` renamed to `Assets/Archive.pdf`.
    Expected: Index mutation updates title-only document; old basename no longer matches, and path-token-only query does not match.
    Evidence: .sisyphus/evidence/task-7-nonmarkdown-rename.txt
  ```

  **Commit**: YES | Message: `feat(search): index non-markdown titles by policy` | Files: `src/search/document-preparation.ts`, `src/search/SearchIndexManager.ts`, `src/view/pipeline.ts`, tests

- [x] 8. Harden startup restore/rebuild/recovery flow for indexed-only search

  **What to do**: Update `src/main.ts` startup flow so index restore/build/rebuild/recover remains lazy and safe: keep `onload()` minimal, defer heavy startup work until `workspace.onLayoutReady`, register vault listeners after layout ready using cleanup helpers, and make recovery commands idempotent. First-run/no-index state must auto-start indexing after `workspace.onLayoutReady`. A healthy restored persisted index may answer queries while background rebuild/refresh is pending. Corrupted/unavailable/rebuild-required states should trigger automatic rebuild plus lightweight notice, with manual rebuild/recover commands as fallback. Ensure view activation with non-empty query before readiness produces blocked unavailable status rather than fallback results.
  **Must NOT do**: Do not perform blocking full-vault scans in `onload()`. Do not register vault create listeners early enough to consume vault initialization events unintentionally.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Obsidian lifecycle and recovery behavior has high regression risk.
  - Skills: [`obsidian-plugin-docs`] - Apply official lifecycle/event guidance.
  - Omitted: [] - Obsidian API guidance is relevant.

  **Parallelization**: Can Parallel: PARTIAL | Wave 2 | Blocks: Tasks 12, 13 | Blocked By: Tasks 2, 3

  **References**:
  - Pattern: `src/main.ts:483-754`, `src/main.ts:762-783` - Search lifecycle, restore/rebuild/recover commands, mutation recovery scheduling.
  - Pattern: `src/search/SearchIndexManager.ts:42-667` - Restore/build/rebuild/mutation behavior.
  - Pattern: `src/search/IndexStore.ts:1-421` - Persistence outcomes.
  - Test: `src/main.test.ts` - Plugin lifecycle test patterns.
  - Test: `src/search/SearchIndexManager.test.ts:113-382` - Recovery and mutation behavior.
  - External: Obsidian docs - `workspace.onLayoutReady`, delayed vault listeners, `registerEvent`, custom views lifecycle, deferred-view-safe leaf lookups.

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/main.test.ts src/search/SearchIndexManager.test.ts src/search/IndexStore.test.ts` passes.
  - [ ] First-run/no-index auto-starts indexing after `workspace.onLayoutReady`.
  - [ ] Healthy restored persisted index can answer queries while background rebuild/refresh is pending.
  - [ ] Corrupt index, unavailable IndexedDB, and rebuild-required states trigger automatic rebuild plus lightweight notice, with manual commands still available.
  - [ ] Recovery/rebuild commands can be run repeatedly without corrupting state or creating duplicate listeners.

  **QA Scenarios**:
  ```
  Scenario: First run auto-starts indexing after layout ready
    Tool: Bash
    Steps: Run `npx vitest run src/main.test.ts -t "first run search index"` after adding lifecycle test.
    Expected: No persisted index schedules/builds after `workspace.onLayoutReady`; non-empty query remains blocked unavailable until ready, then preserved query auto-runs.
    Evidence: .sisyphus/evidence/task-8-first-run.txt

  Scenario: Recovery command is idempotent after corrupt store
    Tool: Bash
    Steps: Run `npx vitest run src/main.test.ts -t "recover search index" src/search/IndexStore.test.ts -t "corrupt"`.
    Expected: Automatic rebuild plus repeated manual recover/rebuild command invocations produce one valid index lifecycle, lightweight notice behavior, and no fallback results.
    Evidence: .sisyphus/evidence/task-8-recovery-idempotent.txt
  ```

  **Commit**: YES | Message: `fix(search): harden indexed startup recovery` | Files: `src/main.ts`, `src/search/SearchIndexManager.ts`, lifecycle tests

- [x] 9. Formalize query semantics and ranking regression tests

  **What to do**: Preserve current MiniSearch semantics with no ranking redesign. Add deterministic tests for candidate-bounded search, zero-result semantics, tie behavior, Markdown title/content behavior, non-Markdown title-only behavior, and absence of path-token matches. Document minimal product ranking principles: indexed search is candidate-bounded; title and Markdown content are searchable for Markdown; only basename/title is searchable for non-Markdown; path-only matches are not supported; true zero results are distinct from unavailable blocked state. Ensure `orderedPaths: []` means indexed search ran and found zero matches, distinct from unavailable states.
  **Must NOT do**: Do not add new query syntax, path-token matching, or ranking heuristics. Do not allow fallback behavior to influence ranking tests.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Ranking tests must distinguish product semantics from implementation artifacts.
  - Skills: [] - No special skill required.
  - Omitted: [`librarian`] - Existing MiniSearch behavior should be preserved unless product asks for external docs.

  **Parallelization**: Can Parallel: PARTIAL | Wave 3 | Blocks: Task 13 | Blocked By: Tasks 1, 5, 7

  **References**:
  - Pattern: `src/search/SearchIndexManager.ts:42-667` - MiniSearch options and query behavior.
  - Pattern: `src/search/IndexedSearchService.ts:9-164` - Candidate-bounded ordering behavior.
  - Pattern: `src/search/document-preparation.ts:28-127` - Fields included in index.
  - Test: `src/search/IndexedSearchService.test.ts:121-244` - Existing ready indexed ordering/candidate-bounded tests.
  - Test: `src/view/pipeline.test.ts:265-429` - Existing zero-result and ranking contract tests.
  - Docs: `docs/architecture.md:258-303`, `docs/architecture.md:331-405` - Ranking/search architecture docs to update.

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/search/IndexedSearchService.test.ts src/view/pipeline.test.ts` passes.
  - [ ] Tests prove candidate-bounded behavior using query `"meeting"` with candidates excluding a globally matching card.
  - [ ] Tests prove `orderedPaths: []` or equivalent ready-zero state displays true zero results, not unavailable status.
  - [ ] Ranking/tie behavior is deterministic for `Notes/Meeting.md`, `Notes/Meeting Followup.md`, and `Notes/Other.md` under current MiniSearch behavior.
  - [ ] Tests prove Markdown content queries can match Markdown content and non-Markdown content/path-token queries do not match.

  **QA Scenarios**:
  ```
  Scenario: Candidate-bounded search excludes global non-candidates
    Tool: Bash
    Steps: Run `npx vitest run src/search/IndexedSearchService.test.ts -t "candidate"` with indexed docs inside and outside current folder.
    Expected: Only current candidate paths are ordered/returned; global matches outside candidates are excluded.
    Evidence: .sisyphus/evidence/task-9-candidate-bounded.txt

  Scenario: Ready zero results are distinct from unavailable
    Tool: Bash
    Steps: Run `npx vitest run src/view/pipeline.test.ts -t "zero results"` with ready index and query `"zz-no-match"`.
    Expected: UI/projection receives true zero-result semantics, not building/error/unavailable status.
    Evidence: .sisyphus/evidence/task-9-zero-results.txt

  Scenario: Title/content principles without path-token matching
    Tool: Bash
    Steps: Run `npx vitest run src/search/IndexedSearchService.test.ts -t "title content"` with `Notes/Meeting.md` containing body text `agenda roadmap` and `Assets/Project Brief.pdf` as a non-Markdown title-only document.
    Expected: Markdown title/content queries match; non-Markdown basename query matches; path-token-only query does not match either file type.
    Evidence: .sisyphus/evidence/task-9-title-content-no-path.txt
  ```

  **Commit**: YES | Message: `test(search): lock indexed ranking semantics` | Files: `src/search/IndexedSearchService.test.ts`, `src/view/pipeline.test.ts`, possibly search implementation/docs

- [x] 10. Remove fallback architecture leftovers and simplify dead branches

  **What to do**: After behavior migration, remove dead fallback branches, obsolete types, comments, imports, tests, and status labels. Use references/search to find `fallback`, `NoIndexSearchService`, `orderedPaths: null`, `fallback-filter`, and old status names. Simplify architecture so indexed query, unavailable state, and empty-query browsing are separate concepts. Keep compatibility only where needed for tests or migration comments.
  **Must NOT do**: Do not remove recovery/error handling just because it used to mention fallback. Do not broaden cleanup into unrelated refactors.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: Focused cleanup after primary migration.
  - Skills: [] - No special skill required.
  - Omitted: [`ai-slop-remover`] - This is semantic cleanup, not prose/code-smell cleanup.

  **Parallelization**: Can Parallel: PARTIAL | Wave 3 | Blocks: Task 14 | Blocked By: Tasks 1, 3

  **References**:
  - Pattern: `src/search/NoIndexSearchService.ts:9-105` - Remove/delete if no longer needed.
  - Pattern: `src/main.ts:483-754` - Remove fallback-specific lifecycle branches.
  - Pattern: `src/view/pipeline.ts:46-93` - Remove local fallback query filtering.
  - Pattern: `src/view/Toolbar.svelte:35-82` - Remove fallback labels.
  - Tests: fallback-related tests listed in research summary.

  **Acceptance Criteria**:
  - [ ] `npm run check` passes.
  - [ ] Content search for `NoIndexSearchService` returns no production references.
  - [ ] Content search for user-facing `fallback` in `src/` returns no runtime UI/status copy.
  - [ ] Remaining `fallback` mentions, if any, are only in migration tests/docs saying the behavior was removed.

  **QA Scenarios**:
  ```
  Scenario: No production fallback symbols remain
    Tool: Bash
    Steps: Run repository content searches for `NoIndexSearchService`, `fallback`, and `orderedPaths: null` in `src/`.
    Expected: No production code path can route non-empty queries to local fallback filtering.
    Evidence: .sisyphus/evidence/task-10-fallback-audit.txt

  Scenario: TypeScript rejects dead fallback references
    Tool: Bash
    Steps: Run `npm run check`.
    Expected: Type-check passes after removing obsolete service/types/imports.
    Evidence: .sisyphus/evidence/task-10-check.txt
  ```

  **Commit**: YES | Message: `refactor(search): remove fallback architecture leftovers` | Files: cleanup across `src/search`, `src/view`, tests

- [x] 11. Migrate architecture, start-here, and decision docs

  **What to do**: Update docs so indexed search is documented as the only real search path. Remove or rewrite fallback-first language from `docs/architecture.md`, `docs/START_HERE.md`, and relevant decision records. Add a concise search lifecycle section: restore → ready, build → ready, rebuild-required/error/storage-unavailable → unavailable until recovery. Document selected product decisions and state matrix. Keep docs aligned with actual tests and commands.
  **Must NOT do**: Do not imply fallback search still exists. Do not move docs outside existing docs structure unless project owner asks.

  **Recommended Agent Profile**:
  - Category: `writing` - Reason: Documentation migration and decision-record clarity.
  - Skills: [] - No special skill required.
  - Omitted: [`obsidian-plugin-docs`] - This is project architecture docs, not external API docs.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: Task 14 | Blocked By: Tasks 1, 5, 8, 9 for final semantics

  **References**:
  - Docs: `docs/architecture.md:7-13`, `docs/architecture.md:48-58`, `docs/architecture.md:73-79`, `docs/architecture.md:107-123`, `docs/architecture.md:127-220`, `docs/architecture.md:258-303`, `docs/architecture.md:331-405` - Current canonical fallback/index architecture docs.
  - Docs: `docs/START_HERE.md:5-7`, `docs/START_HERE.md:32-34`, `docs/START_HERE.md:49-65` - User-facing phase/status/invariant docs.
  - Docs: `docs/decisions/2026-04-18-phase3-search-architecture-readiness.md:5-89` - Readiness decision with fallback-first seam.
  - Docs: `docs/decisions/2026-04-18-close-phase3-indexed-search-capability.md:5-85` - Closure decision preserving fallback/recovery semantics.
  - README: `README.md:1-15` - High-level project summary; search details minimal.

  **Acceptance Criteria**:
  - [ ] `npm run check` and `npm test` still pass after docs changes.
  - [ ] Docs describe no fallback search as intended behavior.
  - [ ] Docs include selected product decisions and search lifecycle state matrix.
  - [ ] Docs list validation commands: `npm run check`, `npm run build`, `npm test`.

  **QA Scenarios**:
  ```
  Scenario: Docs no longer instruct fallback behavior
    Tool: Bash
    Steps: Search `docs/` for `fallback search`, `fallback filtering`, and `orderedPaths: null` after migration.
    Expected: Mentions are removed or explicitly described as retired legacy behavior; no active architecture instructions depend on fallback.
    Evidence: .sisyphus/evidence/task-11-docs-fallback-search.txt

  Scenario: Docs match testable lifecycle states
    Tool: Bash
    Steps: Compare docs lifecycle section to test names in `SearchIndexManager.test.ts`, `IndexedSearchService.test.ts`, and `FolderCardView.test.ts`.
    Expected: Each documented state has corresponding automated test coverage or explicit reason if not applicable.
    Evidence: .sisyphus/evidence/task-11-docs-state-matrix.txt
  ```

  **Commit**: YES | Message: `docs(search): document indexed-only lifecycle` | Files: `docs/architecture.md`, `docs/START_HERE.md`, docs decisions, optionally `README.md`

- [x] 12. Finalize lightweight status/rebuild/clear commands and debug observability

  **What to do**: Implement lightweight user-facing commands in `src/main.ts` for search-index status, rebuild/recover, and clear/reset index data, plus developer/test observability through health snapshots. Commands must be named and messaged as index lifecycle operations. If a minimal setting is needed for command/debug behavior, persist with existing `loadData()`/`saveData()` pattern and test defaults/migration; otherwise avoid new settings. If status bar is used, keep it supplemental and provide command alternatives because status bar is desktop-only.
  **Must NOT do**: Do not add heavy debug UI. Do not add telemetry. Do not make status bar the only user recovery path.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Product-facing recovery/debug behavior touches lifecycle and settings.
  - Skills: [`obsidian-plugin-docs`] - Apply command/settings/status official guidance.
  - Omitted: [] - Obsidian API usage may be needed.

  **Parallelization**: Can Parallel: PARTIAL | Wave 3 | Blocks: Task 13 | Blocked By: Tasks 4, 8

  **References**:
  - Pattern: `src/main.ts:483-754` - Existing restore/rebuild/recover commands/notices.
  - Pattern: `src/settings.ts:15-61`, `src/settings.ts:114-155` - Existing settings defaults/load/save patterns.
  - Test: `src/settings.test.ts` - Settings migration/default patterns.
  - Test: `src/main.test.ts` - Plugin command/lifecycle tests if present.
  - External: Obsidian docs - commands, settings, status bar desktop-only, `loadData()`/`saveData()`.

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/main.test.ts src/settings.test.ts` passes.
  - [ ] Status, rebuild/recover, and clear/reset commands are idempotent and clearly index-focused.
  - [ ] Any setting added has default/migration tests.
  - [ ] Debug/status output contains no note contents and no network behavior.

  **QA Scenarios**:
  ```
  Scenario: Rebuild command reports index lifecycle state
    Tool: Bash
    Steps: Run `npx vitest run src/main.test.ts -t "rebuild search index"` after command test updates.
    Expected: Command transitions rebuild-required/error state toward building/ready and never enables fallback search.
    Evidence: .sisyphus/evidence/task-12-rebuild-command.txt

  Scenario: Clear/reset command reports index lifecycle state
    Tool: Bash
    Steps: Run `npx vitest run src/main.test.ts -t "clear search index"` after command test updates.
    Expected: Command clears persisted index state, schedules/permits rebuild according to lifecycle, and does not enable fallback search.
    Evidence: .sisyphus/evidence/task-12-clear-command.txt
  ```

  **Commit**: YES | Message: `feat(search): align recovery commands with index lifecycle` | Files: `src/main.ts`, optionally `src/settings.ts`, related tests

- [x] 13. Run integrated indexed-only regression suite and fix failures

  **What to do**: Run the targeted migration suite plus full project checks. Fix failures that indicate fallback assumptions, stale state races, startup lifecycle regressions, Svelte status bridge mismatches, or docs/type drift. Capture command output evidence. Do not broaden scope beyond failures caused by this migration.
  **Must NOT do**: Do not skip failing tests. Do not use `--update`-style snapshot changes unless the test is intentionally migrated and reviewed.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Integrated QA and regression repair across node/jsdom tests.
  - Skills: [] - No special skill required.
  - Omitted: [`playwright`] - Current repo verification is Vitest/build/type-check, not browser automation.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: Task 14 | Blocked By: Tasks 5, 6, 7, 8, 9, 12

  **References**:
  - Config: `vitest.config.ts` - Node/jsdom project split and aliases.
  - Config: `package.json` - Validation scripts.
  - Tests: all search/view/settings/main tests listed in research summary.
  - AGENTS.md validation: after code/docs changes run `npm run check`, `npm run build`, `npm test`.

  **Acceptance Criteria**:
  - [ ] `npm run check` passes.
  - [ ] `npm run build` passes.
  - [ ] `npm test` passes.
  - [ ] Targeted command passes:
    ```bash
    npx vitest run src/search/IndexedSearchService.test.ts src/view/pipeline.test.ts src/view/FolderCardView.test.ts src/view/Toolbar.svelte.test.ts src/search/SearchIndexManager.test.ts src/search/IndexStore.test.ts src/view/card-context-actions.test.ts
    ```

  **QA Scenarios**:
  ```
  Scenario: Full project validation passes
    Tool: Bash
    Steps: Run `npm run check && npm run build && npm test`.
    Expected: All commands exit 0.
    Evidence: .sisyphus/evidence/task-13-full-validation.txt

  Scenario: Targeted search migration suite passes
    Tool: Bash
    Steps: Run the targeted `npx vitest run ...` command listed in acceptance criteria.
    Expected: All targeted tests exit 0 and cover indexed-only states.
    Evidence: .sisyphus/evidence/task-13-targeted-suite.txt
  ```

  **Commit**: YES | Message: `test(search): validate indexed-only migration` | Files: failure fixes only

- [x] 14. Perform fallback-removal audit and docs/test consistency sweep

  **What to do**: Audit the repository for fallback remnants and consistency. Search production code, tests, and docs for `fallback`, `NoIndexSearchService`, `orderedPaths: null`, and old status labels. Confirm any remaining references are intentional retired-behavior notes or negative tests. Confirm docs, tests, and implementation agree on every product decision. Run `npm run check`, `npm run build`, and `npm test` after final audit fixes.
  **Must NOT do**: Do not leave ambiguous comments that make fallback seem supported. Do not mark final verification tasks complete; those are separate review agents.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: Cross-artifact consistency audit across source, tests, and docs.
  - Skills: [] - No special skill required.
  - Omitted: [`review-work`] - Final verification wave separately handles multi-agent review.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: Final Verification Wave | Blocked By: Tasks 10, 11, 13

  **References**:
  - Production search files: `src/main.ts`, `src/search/*.ts`, `src/view/FolderCardView.ts`, `src/view/pipeline.ts`, `src/view/Toolbar.svelte`, `src/view/FolderCardPanel.svelte`.
  - Tests: search/view/settings/main tests listed above.
  - Docs: `docs/architecture.md`, `docs/START_HERE.md`, decision records, `README.md`.
  - Validation commands: `npm run check`, `npm run build`, `npm test`.

  **Acceptance Criteria**:
  - [ ] Production code contains no active fallback search path.
  - [ ] Tests contain no positive expectation that local fallback filtering is valid for non-empty queries.
  - [ ] Docs contain no active fallback search guidance.
  - [ ] Final validation commands pass.

  **QA Scenarios**:
  ```
  Scenario: Repository fallback audit passes
    Tool: Bash
    Steps: Search repo for `fallback`, `NoIndexSearchService`, `orderedPaths: null`, `fallback filtering`, and old UI labels.
    Expected: No active production/test/doc instruction preserves fallback as supported behavior; any remaining mention is explicitly historical or negative-test-only.
    Evidence: .sisyphus/evidence/task-14-fallback-audit.txt

  Scenario: Final validation after audit passes
    Tool: Bash
    Steps: Run `npm run check && npm run build && npm test`.
    Expected: All commands exit 0 after audit fixes.
    Evidence: .sisyphus/evidence/task-14-final-validation.txt
  ```

  **Commit**: YES | Message: `chore(search): audit indexed-only migration` | Files: final cleanup only

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- Use small commits by task or tightly coupled task groups.
- Recommended commit order:
  1. `refactor(search): make query contract indexed-only`
  2. `fix(search): expose explicit index readiness states`
  3. `refactor(search): remove no-index fallback service`
  4. `refactor(view): remove local search fallback filtering`
  5. `fix(ui): clarify indexed search readiness states`
  6. `feat(search): index non-markdown titles`
  7. `fix(search): harden indexed startup recovery`
  8. `test(search): lock indexed ranking semantics`
  9. `docs(search): document indexed-only lifecycle`
  10. `chore(search): audit indexed-only migration`
- Do not commit `.sisyphus/evidence/` unless the repository convention explicitly tracks evidence.

## Success Criteria
- Indexed search is the only implementation path for non-empty queries.
- No fallback filtering remains in service, view, pipeline, UI, tests, or active docs.
- Search unavailable/readiness states are explicit and not confused with true zero results.
- Empty-query folder card browsing continues regardless of index health.
- Startup restore/build/recover remains lifecycle-safe and deterministic.
- Non-Markdown basename/title-only behavior is tested; path-token-only and non-Markdown content matches are not supported.
- Current MiniSearch ranking behavior is preserved with deterministic title/content tests and no ranking redesign.
- Observability/debug behavior is local-only, lightweight, command-based for users, and snapshot/test-based for developers.
- Required commands pass: `npm run check`, `npm run build`, `npm test`, and targeted Vitest suite.
