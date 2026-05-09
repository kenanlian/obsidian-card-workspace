# Search Hit Count Badges

## TL;DR
> **Summary**: Add Omnisearch-style per-card search hit counts for indexed search results, shown as a muted inline badge in each card title row. Counts are full searchable-text literal occurrence counts computed in the search runtime, threaded to Svelte as render metadata, and never stored on `NoteCardRecord`.
> **Deliverables**:
> - Runtime-internal `matchCountsByPath` search metadata from indexed query execution.
> - View/panel state threading that keeps counts separate from card records.
> - Card title-row badge UI and styles inspired by Omnisearch.
> - Tests-after coverage in each implementation area for search counting, stale/blocked state clearing, and component rendering.
> **Effort**: Medium
> **Parallel**: YES - 4 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Final Verification

## Context

### Original Request
User requested search feature planning: after the user enters search keywords, each card should show how many matches/hits occur inside that card. The plan must read/understand current search and card rendering code, evaluate data flow, UI position, performance impact, edge cases, and produce an executable scheme. User explicitly said not to modify code during planning.

### Interview Summary
- Product semantics confirmed: count matches over the full searchable text basis used by the current indexed search, not just visible card preview and not distinct query terms.
- UI recommendation accepted by default: muted inline badge in the card title row, immediately after the title in `.fce-card-title-group`, before card actions.
- Test strategy confirmed: tests-after.
- Planning-only constraint: Prometheus must not edit source files; Sisyphus will execute this plan.

### Metis Review (gaps addressed)
- Metis identified the main risk as semantic drift between MiniSearch result reasons and badge count semantics.
- This plan resolves that by defining V1 badge count as non-overlapping literal occurrences of unique normalized whitespace query tokens in the cached full searchable document text (`title + content`), not MiniSearch score and not advanced parser diagnostics.
- Metis recommended adding `matchCountsByPath`, not repurposing `scoresByPath`; this plan follows that.
- Metis warned against vault rereads and render-time counting; this plan requires counting from cached/indexed search documents once per query.
- Metis identified stale-count leaks; this plan requires counts to be cleared on empty, pending, blocked, reset, stale, and error states.

## Work Objectives

### Core Objective
When an indexed search query returns matching cards, each rendered matching card displays an Omnisearch-style `N match` / `N matches` badge that reflects literal occurrences in the full searchable text for that note.

### Deliverables
- Search result metadata field `matchCountsByPath?: Record<string, number>` in runtime search contracts.
- Search-layer count helper using the same normalized indexed text source as search documents.
- `FolderCardView` state handling for `searchMatchCountsByPath` that respects generation/stale-result guards.
- `PanelModelState.searchMatchCountsByPath` render metadata, separate from `NoteCardRecord`.
- `CardItem` prop and title-row badge markup.
- CSS under `.folder-card-view` for a muted inline count badge.
- Tests-after coverage for counting, data threading, stale/blocked clearing, and badge rendering within the relevant implementation tasks.

### Definition of Done (verifiable conditions with commands)
- `npm run check` passes.
- `npm run build` passes.
- `npm test` passes.
- New tests prove badge counts come from full searchable content, not preview-only content.
- No source file reads occur during query-time count computation beyond existing indexed/cached data paths.
- No match-count metadata is added to `NoteCardRecord`.

### Must Have
- Count semantics: non-overlapping literal occurrences of unique normalized whitespace query tokens in full searchable document text. Example: query `alpha beta alpha` counts occurrences for `alpha` and `beta` once each, then sums them.
- Include title and normalized markdown content in the counted searchable text.
- Hide badge for empty query, blocked/unavailable search, zero/absent count, and stale search results.
- Badge wording: `1 match`, otherwise `${count} matches`.
- Accessibility: badge must have an explicit `aria-label` such as `3 matches in this note`.
- Counts must not affect search ordering, filtering, pinning, selection, hydration, or virtualization.
- Use Obsidian theme variables and keep selectors scoped under `.folder-card-view`.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- MUST NOT mutate source files outside normal Sisyphus execution of this plan.
- MUST NOT store counts on `NoteCardRecord`; existing comments say score details must not leak into render-facing card types.
- MUST NOT repurpose `scoresByPath` for counts; add `matchCountsByPath`.
- MUST NOT compute counts inside `CardItem.svelte`, preview highlight functions, or any Svelte render loop.
- MUST NOT reread vault files during each query just to compute counts.
- MUST NOT add network behavior, external dependencies, ESLint, Prettier, or benchmark tooling.
- MUST NOT change MiniSearch ranking/search result ordering to accommodate badges.
- MUST NOT migrate the component model or add new rune-based state; follow existing local component conventions in touched Svelte files.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + Vitest node/jsdom projects.
- QA policy: Every task has agent-executed scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`
- Required validation after implementation: `npm run check`, `npm run build`, `npm test`.

## Execution Strategy

### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: Task 1 search contract/count metadata foundation.
Wave 2: Task 2 view/panel state threading, then Task 3 UI badge/styles after the panel prop name is available.
Wave 3: Task 4 cross-layer regression hardening after Tasks 1-3.
Wave 4: Task 5 validation, edge-case audit, and cleanup after tests are in place.

### Dependency Matrix (full, all tasks)
- Task 1: Blocks Tasks 2, 4, 5.
- Task 2: Blocked by Task 1; blocks Tasks 3, 4, 5.
- Task 3: Blocked by Tasks 1-2; blocks Tasks 4, 5.
- Task 4: Blocked by Tasks 1-3; blocks Task 5.
- Task 5: Blocked by Tasks 1-4.
- Final Verification F1-F4: Blocked by Tasks 1-5.

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 1 task → `deep`.
- Wave 2 → 2 tasks → `quick` + `visual-engineering`.
- Wave 3 → 1 task → `deep`.
- Wave 4 → 1 task → `quick`.

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Add search-layer match count metadata

  **What to do**: Add a runtime search result field named `matchCountsByPath?: Record<string, number>` to the search query contract. Update the indexed search implementation so `SearchIndexManager` can return both `orderedPaths` and match counts for matched paths. Count non-overlapping literal occurrences of unique normalized whitespace query tokens in the same cached searchable document basis used by indexing: title plus normalized markdown content. Preserve existing ordered path behavior exactly. Use a new internal result interface rather than changing public render-facing card types. If the current manager only has MiniSearch documents and no document cache available, add/extend an in-memory document lookup during index build/update; do not reread vault files during query execution.
  **Must NOT do**: Do not repurpose `scoresByPath`. Do not expose counts on `NoteCardRecord`. Do not alter ranking, filtering, `SEARCH_OPTIONS`, or MiniSearch query behavior. Do not count preview HTML. Do not add a dependency.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: requires preserving search architecture and async/index invariants.
  - Skills: [] - no extra skill required; work is internal TypeScript/search logic.
  - Omitted: [`obsidian-plugin-docs`] - no new Obsidian API usage is required.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [2, 3, 4, 5] | Blocked By: []

  **References** (executor has NO interview context - be exhaustive):
  - Contract: `src/search/types.ts:158-164` - `SearchQueryResult` currently has `orderedPaths` and unused `scoresByPath`; add `matchCountsByPath` here and document it as runtime metadata.
  - Search wrapper: `src/search/IndexedSearchService.ts:82-130` - wraps manager output into query result; thread `matchCountsByPath` only when `execution === "indexed-ready"`.
  - Search manager: `src/search/SearchIndexManager.ts:348-372` - currently returns `Promise<string[]>`; replace with or wrap an internal structured result preserving `orderedPaths`.
  - Search document prep: `src/search/document-preparation.ts:29-44` - searchable docs include `title` and `content` from markdown normalization.
  - Search text normalization: `src/search/markdown-search-text.ts:3-32` - basis for indexed content; counting must be compatible with this normalized content.
  - Guardrail: `src/view/types.ts:33-46` - score details must remain internal and not be surfaced on card records.
  - Tests: `src/search/SearchIndexManager.test.ts` and `src/search/IndexedSearchService.test.ts` - follow existing search behavior fixtures and snapshot patterns.
  - External UX precedent: `https://github.com/scambier/obsidian-omnisearch/blob/eb6bbd48873886e2daf58d0436d25be106a65ffc/src/components/ResultItemVault.svelte#L182-L188` - Omnisearch displays `note.matches.length` with singular/plural wording.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/search/SearchIndexManager.test.ts src/search/IndexedSearchService.test.ts` passes after adding tests.
  - [ ] A test proves a document with title `Alpha` and content containing `alpha` twice returns `matchCountsByPath[path] === 3` for query `alpha`.
  - [ ] A test proves counts are non-overlapping: query `aa` against counted text `aaa` returns `1`, not `2`.
  - [ ] A test proves `orderedPaths` remains identical to pre-change ordering for existing search fixtures.
  - [ ] Static review confirms no code path rereads vault file contents during `query()` solely for counts.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Search manager returns ordered paths plus full-text counts
    Tool: Bash
    Steps: Run `npx vitest run src/search/SearchIndexManager.test.ts -t "match count"` after adding a targeted test name containing "match count".
    Expected: The targeted test passes and assertion output shows full searchable text counts include title and normalized content.
    Evidence: .sisyphus/evidence/task-1-search-match-counts.txt

  Scenario: Existing indexed search behavior is not reordered
    Tool: Bash
    Steps: Run `npx vitest run src/search/SearchIndexManager.test.ts src/search/IndexedSearchService.test.ts`.
    Expected: All existing and new search tests pass; no snapshot or order regression occurs except intentional metadata additions.
    Evidence: .sisyphus/evidence/task-1-search-regression.txt
  ```

  **Commit**: NO | Message: `feat(search): add indexed match count metadata` | Files: [`src/search/types.ts`, `src/search/SearchIndexManager.ts`, `src/search/IndexedSearchService.ts`, `src/search/SearchIndexManager.test.ts`, `src/search/IndexedSearchService.test.ts`]

- [x] 2. Thread match counts through FolderCardView and panel state

  **What to do**: Add private runtime state in `FolderCardView` named `searchMatchCountsByPath` using a plain object or readonly record shape compatible with Svelte props. Clear it on query change before a new result arrives, reset, empty query, blocked/unavailable service, error, and any non-current/stale result path. On successful current `indexed-ready` query, assign `result.matchCountsByPath ?? {}`. Add `searchMatchCountsByPath: Record<string, number>` to `PanelModelState`, initialize it in `buildPanelModelState()`, and update it in both `pushState()` and `pushSelectionState()` so panel subscribers never retain stale counts.
  **Must NOT do**: Do not mutate cards to attach counts. Do not change `deriveVisibleCards()` filtering semantics except to keep using `orderedPaths`. Do not bypass `isSearchRequestCurrent()`. Do not include counts in persisted settings.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: focused state-threading change after Task 1 contract exists.
  - Skills: [] - no extra skill required.
  - Omitted: [`obsidian-plugin-docs`] - no new Obsidian API usage is required.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [3, 4, 5] | Blocked By: [1]

  **References** (executor has NO interview context - be exhaustive):
  - View state: `src/view/FolderCardView.ts:424-447` - add `searchMatchCountsByPath` near existing search state.
  - Query change/reset: `src/view/FolderCardView.ts:2052-2088` - clear counts on query changes and resets.
  - Search execution: `src/view/FolderCardView.ts:2090-2144` - assign counts only after `isSearchRequestCurrent()` passes and result is indexed-ready.
  - Panel state build: `src/view/FolderCardView.ts:2598-2625` - initialize panel state field.
  - Panel mutation: `src/view/FolderCardView.ts:2628-2701` - update field in both state push paths.
  - Panel contract: `src/view/panel-model.ts:15-46` - add `searchMatchCountsByPath` separate from `cards`.
  - Search filtering: `src/view/pipeline.ts:45-75` - must remain ordered-path filtering only.
  - Tests: `src/view/FolderCardView.test.ts` - host state, debounce, stale-result, lifecycle patterns.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/FolderCardView.test.ts` passes with new state-threading tests.
  - [ ] A test proves a successful indexed-ready result exposes counts through panel state without modifying card objects.
  - [ ] A test proves counts clear immediately after search reset/empty query.
  - [ ] A test proves stale search results cannot overwrite current counts.
  - [ ] A test proves blocked/unavailable search status exposes an empty counts record.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Panel model receives counts from current indexed search
    Tool: Bash
    Steps: Run `npx vitest run src/view/FolderCardView.test.ts -t "match counts"` after adding targeted tests with "match counts" in their names.
    Expected: Tests pass and assert `panelState.searchMatchCountsByPath[path]` equals the search service metadata for the current query.
    Evidence: .sisyphus/evidence/task-2-panel-counts.txt

  Scenario: Stale or reset query does not leak old counts
    Tool: Bash
    Steps: Run `npx vitest run src/view/FolderCardView.test.ts -t "stale"` and ensure the new stale-count test is included or separately targeted.
    Expected: Tests pass; after reset or newer query, old path counts are absent from panel state.
    Evidence: .sisyphus/evidence/task-2-stale-counts.txt
  ```

  **Commit**: NO | Message: `feat(view): thread search match counts to panel state` | Files: [`src/view/FolderCardView.ts`, `src/view/panel-model.ts`, `src/view/FolderCardView.test.ts`]

- [x] 3. Render Omnisearch-style title-row badge in card UI

  **What to do**: Pass each card's count from `FolderCardPanel.svelte` to `CardItem.svelte` via a new prop, e.g. `searchMatchCount={panelState.searchMatchCountsByPath[card.path] ?? 0}`. In `CardItem.svelte`, render a badge immediately after the `<h4>` inside `.fce-card-title-group` when `searchQuery.trim().length > 0 && searchMatchCount > 0`. Badge text must be `1 match` or `${searchMatchCount} matches`; add `aria-label` with the same count plus `in this note`. Style `.fce-card-search-count` near existing card header styles in `styles.css` as a muted inline pill/text that does not steal focus and does not compete with pin/more actions.
  **Must NOT do**: Do not place the badge in `.fce-card-actions`. Do not render `0 matches`. Do not compute counts from `previewHtml` in Svelte. Do not add click handlers. Do not migrate component syntax or add new rune-based state.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: UI placement/styling must preserve card layout and native Obsidian feel.
  - Skills: [] - no extra skill required; do not use browser automation unless existing test harness requires it.
  - Omitted: [`frontend-ui-ux`] - enough design direction is specified; no freeform redesign needed.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [4, 5] | Blocked By: [1, 2]

  **References** (executor has NO interview context - be exhaustive):
  - Panel render loop: `src/view/FolderCardPanel.svelte:603-620` - pass the per-card count to `CardItem` here.
  - Card props/highlight: `src/view/CardItem.svelte:24-57` - add `searchMatchCount` prop and derived display text if helpful.
  - Card title row: `src/view/CardItem.svelte:292-326` - render badge after `<h4>{@html highlightedTitleHtml}</h4>` and before `.fce-card-actions`.
  - Card header styles: `styles.css:498-546` - add scoped badge style next to `.fce-card-title-group`, `.fce-card h4`, and `.fce-search-hit`.
  - Existing component tests: `src/view/FolderCardPanel.svelte.test.ts`, `src/view/Toolbar.svelte.test.ts` - use jsdom DOM assertion patterns.
  - External UX precedent: `https://github.com/scambier/obsidian-omnisearch/blob/eb6bbd48873886e2daf58d0436d25be106a65ffc/assets/styles.css#L43-L46` - Omnisearch counter is small and muted.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/FolderCardPanel.svelte.test.ts` passes after adding badge rendering coverage.
  - [ ] DOM test verifies `1 match` singular text for count `1`.
  - [ ] DOM test verifies plural text for count `2` or greater.
  - [ ] DOM test verifies no badge is rendered when count is `0`, missing, or query is empty.
  - [ ] Static CSS review confirms selector is scoped under `.folder-card-view` and uses theme variables such as `var(--fce-text-muted)`, `var(--fce-surface-alt)`, or Obsidian variables.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Matching card displays title-row count badge
    Tool: Bash
    Steps: Run `npx vitest run src/view/FolderCardPanel.svelte.test.ts -t "match badge"` after adding a targeted test name containing "match badge".
    Expected: Rendered card DOM contains text `3 matches` in a `.fce-card-search-count` element with `aria-label="3 matches in this note"`.
    Evidence: .sisyphus/evidence/task-3-badge-render.txt

  Scenario: Empty or zero-count state suppresses badge
    Tool: Bash
    Steps: Run `npx vitest run src/view/FolderCardPanel.svelte.test.ts -t "match badge"` with the zero/empty cases included.
    Expected: No `.fce-card-search-count` element exists for empty query or count 0.
    Evidence: .sisyphus/evidence/task-3-badge-hidden.txt
  ```

  **Commit**: NO | Message: `feat(ui): render card search match badges` | Files: [`src/view/FolderCardPanel.svelte`, `src/view/CardItem.svelte`, `styles.css`, `src/view/FolderCardPanel.svelte.test.ts`]

- [x] 4. Harden cross-layer regression coverage and integration seams

  **What to do**: Audit the feature after Tasks 1-3 and close any cross-layer integration gaps with focused fixes plus tests-after coverage. Ensure search-layer tests cover occurrence semantics and candidate path filtering; view tests cover state clearing/stale guards; component tests cover badge rendering. Add or update mocks only where existing test seams require it. Tests should prove count metadata is render-facing but not part of `NoteCardRecord`.
  **Must NOT do**: Do not remove existing tests to make new tests pass. Do not create a new test framework. Do not add flaky timer assumptions beyond existing fake timer patterns. Do not require manual Obsidian interaction.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: cross-layer tests must lock down semantics and regressions.
  - Skills: [] - no extra skill required.
  - Omitted: [`playwright`] - current repo has jsdom/unit tests and no browser E2E harness.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: [5] | Blocked By: [1, 2, 3]

  **References** (executor has NO interview context - be exhaustive):
  - Search tests: `src/search/SearchIndexManager.test.ts`, `src/search/IndexedSearchService.test.ts` - add count assertions and blocked/result metadata cases.
  - View tests: `src/view/FolderCardView.test.ts` - follow stale-result protection and panel state patterns.
  - Component tests: `src/view/FolderCardPanel.svelte.test.ts` - verify DOM badge output.
  - Pure pipeline tests: `src/view/pipeline.test.ts` - should not need count-specific changes; run to verify no projection regression.
  - Row projection tests: `src/view/row-projection.test.ts` - run to guard virtualization assumptions.
  - Markdown/search text tests: `src/view/markdown-utils.test.ts` and any search text tests if present - use existing normalization expectations rather than inventing incompatible rules.
  - Vitest config: `vitest.config.ts` - node/jsdom projects already exist; do not change unless tests require an existing alias update.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/search/SearchIndexManager.test.ts src/search/IndexedSearchService.test.ts src/view/FolderCardView.test.ts src/view/FolderCardPanel.svelte.test.ts src/view/pipeline.test.ts src/view/row-projection.test.ts` passes.
  - [ ] Tests cover multi-token query behavior exactly as defined: count non-overlapping occurrences for each normalized token and sum them once per token occurrence, with duplicate query tokens deduped.
  - [ ] Tests cover case-insensitive counting.
  - [ ] Tests cover content outside visible preview contributing to badge count.
  - [ ] Tests cover absence of badge for blocked/unavailable/empty/zero states.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Cross-layer targeted regression suite passes
    Tool: Bash
    Steps: Run `npx vitest run src/search/SearchIndexManager.test.ts src/search/IndexedSearchService.test.ts src/view/FolderCardView.test.ts src/view/FolderCardPanel.svelte.test.ts src/view/pipeline.test.ts src/view/row-projection.test.ts`.
    Expected: All targeted tests pass with new count, state, and badge assertions.
    Evidence: .sisyphus/evidence/task-4-targeted-tests.txt

  Scenario: Full Vitest suite passes after feature tests
    Tool: Bash
    Steps: Run `npm test`.
    Expected: Full test suite passes without skipped or newly failing tests.
    Evidence: .sisyphus/evidence/task-4-full-tests.txt
  ```

  **Commit**: NO | Message: `test(search): cover per-card match badges` | Files: [`src/search/SearchIndexManager.test.ts`, `src/search/IndexedSearchService.test.ts`, `src/view/FolderCardView.test.ts`, `src/view/FolderCardPanel.svelte.test.ts`]

- [x] 5. Run final validation and edge-case audit

  **What to do**: Run the repository-required validation commands and perform a source audit for scope/architecture guardrails. Confirm counts are not on `NoteCardRecord`, pipeline remains filtering-only, UI selectors are scoped, and no query-time vault rereads or render-time count loops were introduced. Capture command outputs as evidence. Fix any validation failures directly within the feature scope, then rerun failed commands.
  **Must NOT do**: Do not add lint/format tooling. Do not broaden the feature to search snippets, navigation between matches, in-card match locations, or Omnisearch parity beyond the count badge. Do not mark final verification complete without user approval after F1-F4.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: validation and focused cleanup after implementation/tests.
  - Skills: [] - no extra skill required.
  - Omitted: [`git-master`] - do not commit unless the user separately requests a commit.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: [F1, F2, F3, F4] | Blocked By: [1, 2, 3, 4]

  **References** (executor has NO interview context - be exhaustive):
  - Required commands: `AGENTS.md` requires `npm run check`, `npm run build`, and `npm test` after changes.
  - Architecture guardrail: `src/view/types.ts:33-46` - score/count metadata must not be surfaced on card records.
  - Pipeline guardrail: `src/view/pipeline.ts:45-75` - search filter remains ordered-path projection only.
  - UI guardrail: `styles.css:451-546` and new badge style - selectors must stay under `.folder-card-view`.
  - Svelte guardrail: `AGENTS.md` says keep legacy-compatible component syntax and do not introduce Svelte runes unless explicitly migrating; current files may contain project-compatible syntax, but do not migrate component model.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npm run check` passes.
  - [ ] `npm run build` passes.
  - [ ] `npm test` passes.
  - [ ] Source audit confirms no `searchMatchCount` or `matchCountsByPath` field was added to `NoteCardRecord`.
  - [ ] Source audit confirms count computation is not performed in `CardItem.svelte` render/highlight functions.
  - [ ] Source audit confirms no new dependency was added to `package.json`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Repository validation commands pass
    Tool: Bash
    Steps: Run `npm run check && npm run build && npm test`.
    Expected: All three commands exit 0.
    Evidence: .sisyphus/evidence/task-5-validation.txt

  Scenario: Architecture guardrails remain intact
    Tool: Bash
    Steps: Run targeted source searches or TypeScript symbol inspection for `NoteCardRecord`, `matchCountsByPath`, `searchMatchCount`, and `CardItem.svelte` count logic.
    Expected: Counts are present only in search runtime/view/panel render metadata and UI props; `NoteCardRecord` has no count field; `CardItem.svelte` displays but does not compute counts.
    Evidence: .sisyphus/evidence/task-5-guardrail-audit.txt
  ```

  **Commit**: NO | Message: `chore(search): validate match count badges` | Files: []

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- Commit after all tasks and final validation pass.
- Suggested commit message: `feat(search): show per-card match counts`
- Include only source/test/style changes required by this plan plus evidence if repository policy expects it.

## Success Criteria
- Searching for a term with multiple full-note occurrences shows correct `N match(es)` badges on matching cards.
- A match in content outside the visible preview contributes to the badge count.
- Empty, blocked, unavailable, stale, or zero-count states show no badge.
- Existing search ordering, tag filtering, pin ordering, virtualization, selection, and hydration behavior remain unchanged.
- `npm run check`, `npm run build`, and `npm test` all pass.
