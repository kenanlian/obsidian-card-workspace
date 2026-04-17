# Phase 2 Bulk Organization Work Plan

## TL;DR
> **Summary**: Complete Phase 2 by adding an explicit Bulk mode, path-based multi-selection, batch move/trash/delete workflows, and a merge flow with explicit reorder support, while preserving the existing `selectedPath` editor-sync model and the current `FolderCardView` → Svelte event architecture.
> **Deliverables**:
> - Explicit toolbar-driven Bulk mode with count, select-all, clear, action routing, and exit behavior
> - Separate runtime `selectedPaths` state that never replaces `selectedPath`
> - Path-stable selection across sort/pin reorder, deterministic reconciliation across filter/scope/refresh/mutation changes
> - Batch move, trash, delete, and merge UI flows backed by existing `note-ops.ts` primitives
> - Explicit merge reorder UI using up/down controls, actual merged-content preview, and keep-vs-trash source-note choice
> - Direct Vitest coverage for batch helpers plus integration-style event-contract coverage for bulk workflows
> **Effort**: Large
> **Parallel**: YES - 2 waves
> **Critical Path**: Task 1 → Task 2 → Task 4 → Task 6 → Task 7/8/9 → Task 10

## Context
### Original Request
为 `docs/plan/v1-development-plan.md` 中的 Phase 2「补齐批量整理能力」生成可直接执行的工作计划。

### Interview Summary
- Bulk entry is fixed to **explicit Bulk mode** via the existing toolbar `bulk` action; normal mode keeps “click card → open note”.
- Merge stays **in Phase 2** and includes **explicit reorder support** rather than only inheriting current visible order.
- Test strategy is **TDD**.
- Current architecture is preserved: `FolderCardView.ts` remains the state owner; Svelte components remain presentation and event surfaces.
- `selectedPath` keeps editor-sync highlighting; `selectedPaths` is introduced as a separate session-scoped bulk-selection state.

### Research Findings
- `src/view/Toolbar.svelte:32-39` already exposes `{ id: "bulk" }`, but `src/view/FolderCardView.ts:124-147` does not handle it yet.
- `src/view/FolderCardView.ts:49`, `src/view/FolderCardView.ts:323-329`, and `src/view/FolderCardView.ts:1057-1076` show that single-note highlight is centralized in `selectedPath` and propagated through `pushState()`.
- `src/view/FolderCardPanel.svelte:311-354` and `src/view/CardItem.svelte:5-43` confirm today’s card flow is single-item only (`open-note`, `card-context-menu`, `pin-toggle`).
- `src/view/note-ops.ts:159-259` already provides `batchMoveFiles()`, `batchTrashFiles()`, `batchDeleteFiles()`, and `mergeNotes()`, but there is no user-facing bulk orchestration layer.
- `src/view/card-context-actions.test.ts:1-39`, `src/view/card-context-actions.test.ts:301-315`, `src/view/card-context-actions.test.ts:401-488`, and `src/view/card-context-actions.test.ts:492-763` provide the strongest existing integration harness for new bulk event-contract tests.

### Metis Review (gaps addressed)
- Lock selection domain and lifecycle explicitly: select-all applies to `visibleCards`, not `baseCards` or only rendered rows.
- Keep `selectedPath` and `selectedPaths` isolated so editor sync never clears or replaces bulk selection.
- Reconcile bulk selection deterministically after filter/scope/refresh/mutation changes instead of letting hidden or deleted paths linger.
- Keep failure reporting summarized and actionable: successful paths are removed from selection; failed paths remain selected for retry.
- Once merge enters explicit reorder mode, merge order must switch to the modal’s ordered list and no longer depend on live pin/sort changes.

## Work Objectives
### Core Objective
Deliver a complete Phase 2 bulk-organization workflow inside the card wall so users can intentionally enter Bulk mode, select notes by path, run batch move/trash/delete/merge actions, and recover cleanly from partial failures without breaking existing Obsidian-native open-note and active-note highlighting behavior.

### Deliverables
- `FolderCardView` bulk runtime state (`bulkMode`, `selectedPaths`, selection anchor, reconciliation rules)
- Toolbar bulk strip with count, select-all, clear, move, trash, delete, merge, and exit actions
- Card-level bulk affordances and event contract extensions through `FolderCardPanel.svelte`
- `note-ops`-backed batch move/trash/delete UI flows with confirmations and result summaries
- Merge modal with ordered-list review, up/down reorder controls, title, target folder, separator, actual merged-content preview, and source-cleanup choice
- New Vitest coverage for selection helpers, direct note-ops behavior, and integration wiring

### Defaults Applied
- Inside Bulk mode, primary card click toggles selection only; opening notes remains a normal-mode behavior.
- `Select all` always targets the full current `visibleCards` projection, not only the currently rendered virtual rows.
- Exiting Bulk mode clears `selectedPaths` and the range anchor.
- Folder change, `All Notes` switch, and `includeSubfolders` change clear selection immediately but do **not** auto-exit Bulk mode.
- Merge reorder UX uses explicit up/down controls in a dedicated modal-owned ordered list; drag-and-drop is out of scope.
- Confirmation/result dialogs should use native-feeling Obsidian patterns (`Menu`, `Modal`, `Notice`) rather than custom floating frameworks, consistent with official UI guidance in `.agents/skills/obsidian-plugin-docs/references/ui.md:158-199` and the existing `FolderPickerModal` usage.

### Definition of Done (verifiable conditions with commands)
- [ ] `npx vitest run src/view/bulk-selection.test.ts` exits `0` and covers toggle, shift-range, select-all, reconcile, and rename migration behavior.
- [ ] `npx vitest run src/view/note-ops.test.ts` exits `0` and covers all-success + partial-failure paths for move/trash/delete plus merge preview/merge execution behavior.
- [ ] `npx vitest run src/view/card-context-actions.test.ts` exits `0` and verifies bulk mode entry, selection state transitions, action routing, result reconciliation, and `selectedPath` independence.
- [ ] `npm run check` exits `0`.
- [ ] `npm run build` exits `0`.
- [ ] `npm test` exits `0`.

### Must Have
- Bulk mode is entered and exited only via the existing toolbar `bulk` action.
- Outside Bulk mode, cards keep current click-to-open behavior.
- Inside Bulk mode, single click toggles bulk selection; Shift+click adds an inclusive range based on current `visibleCards` order.
- `selectedPaths` is runtime-only and never persisted to settings.
- `Select all` selects all current `visibleCards` after filter + pin reorder + sort, not only virtualized rows currently rendered.
- Sorting and pin reorder preserve selection by path; filter and scope changes reconcile selection to still-visible paths.
- Folder changes, switching between folder scope and `All Notes`, and toggling `includeSubfolders` clear bulk selection immediately but keep Bulk mode active until the user exits it.
- Vault rename in scope migrates selected path old→new; delete or move-out-of-scope removes the path from `selectedPaths`.
- Batch move has no destructive confirmation but must show summarized results.
- Batch trash and batch delete always require an explicit confirmation modal before execution.
- Partial failures keep failed paths selected; succeeded paths are removed from selection.
- Merge defaults to current selected paths in current visible order, then hands control to a modal-owned ordered list with explicit up/down reorder controls.
- Merge preview reuses the same markdown assembly contract as final merge execution.
- Merge offers `Keep source notes` (default) and `Trash source notes after merge` as an explicit per-run choice.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Must not replace `selectedPath` with bulk selection or persist `selectedPaths` into `settings.ts`.
- Must not use array indexes or DOM positions as the authoritative selection key.
- Must not add a new global store, cross-phase orchestration layer, or new Svelte component test infrastructure.
- Must not let pinning bypass filters or let merge order continue to mutate with live sort/pin changes after the merge modal opens.
- Must not silently trash/delete files.
- Must not auto-open notes when clicking cards inside Bulk mode.
- Must not add drag-and-drop reorder, keyboard-navigation overhauls, or search/indexing work under this phase.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: **TDD** with Vitest
- QA policy: Every task includes agent-executed scenarios with exact commands and evidence paths.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.txt`
- UI verification method: rely on existing Node-based event-contract harnesses (`card-context-actions.test.ts`) plus direct module tests; do not block on browser automation or new jsdom/Svelte testing setup.

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. Shared contracts and helper logic are front-loaded to maximize parallel execution later.

Wave 1: contract + state foundations
- Task 1: Bulk selection helper contract + tests
- Task 2: FolderCardView bulk runtime state + pushState contract
- Task 3: Toolbar/Card/Panel bulk event surface + visual-state contract
- Task 4: Selection state machine over `visibleCards`
- Task 5: Selection lifecycle reconciliation across refresh/mutation/scope changes

Wave 2: workflow delivery + hardening
- Task 6: Bulk toolbar strip, counts, enablement, and action routing
- Task 7: Batch move workflow
- Task 8: Batch trash/delete workflows
- Task 9: Merge workflow with explicit reorder and preview
- Task 10: Phase 2 regression hardening + repo gates

### Dependency Matrix (full, all tasks)
- **1**: — → 2, 4, 5, 7, 8, 9
- **2**: 1 → 3, 4, 5, 6, 10
- **3**: 2 → 6, 10
- **4**: 1, 2 → 5, 6, 7, 8, 9, 10
- **5**: 1, 2, 4 → 7, 8, 9, 10
- **6**: 2, 3, 4 → 7, 8, 9, 10
- **7**: 1, 4, 5, 6 → 10
- **8**: 1, 4, 5, 6 → 10
- **9**: 1, 4, 5, 6 → 10
- **10**: 2, 3, 4, 5, 7, 8, 9 → FINAL

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 5 tasks → `quick` (1, 3), `unspecified-high` (2, 4), `deep` (5)
- Wave 2 → 5 tasks → `visual-engineering` (6), `unspecified-high` (7, 8), `deep` (9), `quick` (10)

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Define and lock the bulk-selection helper contract

  **What to do**: Define a dedicated helper module for path-based bulk-selection operations (for example `src/view/bulk-selection.ts`) and cover it with TDD-first tests before any UI wiring. The helper must own pure operations for `toggleSelection(path)`, `rangeSelect(anchorPath, targetPath, orderedVisiblePaths)`, `selectAll(orderedVisiblePaths)`, `clearSelection()`, `reconcileToVisiblePaths(orderedVisiblePaths)`, `migrateRenamedPath(oldPath, newPath)`, and `pruneRemovedPath(path)`. The returned shape must be deterministic and easy for `FolderCardView` to consume, including next selected paths, next anchor path, and whether the operation changed state.

  **Must NOT do**: Do not expose array-index-based APIs. Do not depend on Svelte or Obsidian runtime objects. Do not embed UI strings or modal concerns in the helper. Do not mutate the input `Set` or arrays in place.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: isolated pure-state contract with straightforward TDD.
  - Skills: `[]`
  - Omitted: [`frontend-ui-ux`] - no presentation work yet.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 2, 4, 5, 7, 8, 9 | Blocked By: none

  **References**:
  - Pattern: `src/view/pipeline.test.ts` - existing pure-function test style for deterministic list transformations.
  - Pattern: `src/view/row-projection.test.ts` - compact helper-level testing style for ordered-array logic.
  - API/Type: `src/view/types.ts:35-42` - current snapshot typing that Phase 2 will need to extend once helper outputs are wired into view state.
  - Contract: `docs/plan/v1-development-plan.md:371-396` - T34 requirements for `selectedPaths`, shift range, all-clear, and path stability.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/bulk-selection.test.ts` exits `0`.
  - [ ] Tests prove range selection is inclusive and based on current `visibleCards` order.
  - [ ] Tests prove `selectAll` selects all ordered visible paths, not only virtualized/rendered subsets.
  - [ ] Tests prove reconcile removes no-longer-visible paths while preserving surviving ones.
  - [ ] Tests prove rename migration moves selection and anchor from old path to new path.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: RED->GREEN coverage for core selection operations
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/bulk-selection.test.ts`
      2. Assert the suite contains tests for `toggle`, `range select`, `select all`, `clear`, and `reconcile`
      3. Save output to `.sisyphus/evidence/task-1-bulk-selection.txt`
    Expected: Command exits 0 and proves helper contract behavior end to end
    Evidence: .sisyphus/evidence/task-1-bulk-selection.txt

  Scenario: Rename and removal edge handling stays path-based
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/bulk-selection.test.ts -t "migrates renamed path and prunes removed path"`
      2. Save output to `.sisyphus/evidence/task-1-bulk-selection-rename.txt`
    Expected: Test passes and confirms path migration/removal do not depend on indexes
    Evidence: .sisyphus/evidence/task-1-bulk-selection-rename.txt
  ```

  **Commit**: NO | Message: `test(view): lock bulk selection helper contract` | Files: `src/view/bulk-selection.ts`, `src/view/bulk-selection.test.ts`

- [x] 2. Add bulk runtime state to `FolderCardView` without disturbing `selectedPath`

  **What to do**: Extend `FolderCardView.ts` to own `bulkMode: boolean`, `selectedPaths: Set<string>`, and a `bulkAnchorPath: string | null`. Update initial `onOpen()` props and every `pushState()` call site so the panel always receives `bulkMode`, `selectedPaths` as a serializable string array, `selectedCount`, and action enablement booleans. Extend any relevant types (including `FolderLoadSnapshot`) so `selectedPath` remains the editor-sync state and bulk state remains separate. Ensure `setSelectedFile()` still only updates `selectedPath` and never clears `selectedPaths`.

  **Must NOT do**: Do not persist bulk state into plugin settings. Do not let `selectedPath` or `selectedPaths` shadow each other. Do not introduce a new store or observer layer. Do not skip any `pushState()` path discovered via references.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: high-leverage state-owner work touching multiple update paths.
  - Skills: `[]`
  - Omitted: [`refactor`] - the shape change is controlled and bounded; no broad architecture rewrite desired.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 3, 4, 5, 6, 10 | Blocked By: 1

  **References**:
  - Pattern: `src/view/FolderCardView.ts:86-149` - initial panel prop injection and event subscription registration.
  - Pattern: `src/view/FolderCardView.ts:323-329` - `selectedPath` update seam that must stay editor-driven.
  - Pattern: `src/view/FolderCardView.ts:1057-1076` - `pushState()` as the single state fan-out seam.
  - API/Type: `src/view/types.ts:35-42` - current `FolderLoadSnapshot` contract that must expand to include bulk state.
  - Test: `src/view/card-context-actions.test.ts:214-240` - panel mock shape and initial prop capture patterns.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/card-context-actions.test.ts -t "bulk runtime state"` exits `0`.
  - [ ] Tests prove `setSelectedFile()` updates `selectedPath` without clearing an existing bulk selection.
  - [ ] Tests prove `pushState()` serializes `selectedPaths`, `selectedCount`, and `bulkMode` consistently after state changes.
  - [ ] Types compile with `selectedPath` and `selectedPaths` both present.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: selectedPath remains independent from bulk selection
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/card-context-actions.test.ts -t "selectedPath stays independent from bulk selection"`
      2. Save output to `.sisyphus/evidence/task-2-selectedpath-independence.txt`
    Expected: Test passes and proves editor-sync highlighting does not clear bulk state
    Evidence: .sisyphus/evidence/task-2-selectedpath-independence.txt

  Scenario: pushState includes the full bulk runtime payload
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/card-context-actions.test.ts -t "pushState includes bulk runtime payload"`
      2. Save output to `.sisyphus/evidence/task-2-pushstate-bulk.txt`
    Expected: Test passes and verifies panel `$set` receives `bulkMode`, `selectedPaths`, and `selectedCount`
    Evidence: .sisyphus/evidence/task-2-pushstate-bulk.txt
  ```

  **Commit**: NO | Message: `feat(view): add bulk runtime state` | Files: `src/view/FolderCardView.ts`, `src/view/types.ts`, `src/view/card-context-actions.test.ts`

- [x] 3. Extend Toolbar, Panel, and Card event surfaces for explicit Bulk mode

  **What to do**: Extend the Svelte prop/event contracts so the existing toolbar `bulk` button toggles explicit Bulk mode, the toolbar can render a bulk-specific action strip, and cards can emit bulk-selection events without becoming state owners. Add panel/card props for `bulkMode`, `bulkSelected`, and selection counts. Define new events such as `bulk-toggle`, `bulk-select-card`, and `bulk-action` only if they materially reduce ambiguity; otherwise prefer reusing `toolbar-action` with precise action IDs. Add a visually distinct class for bulk-selected cards that coexists with `.is-selected` editor highlighting.

  **Must NOT do**: Do not make `CardItem.svelte` or `Toolbar.svelte` own the authoritative selection set. Do not remove current `open-note`, `card-context-menu`, or `pin-toggle` events. Do not rely on component-local lists to infer selected counts.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: bounded event-contract and presentational prop work.
  - Skills: [`frontend-ui-ux`] - needed to keep bulk strip and card affordances legible within existing toolbar/card hierarchy.
  - Omitted: [`playwright`] - no browser automation harness is needed for the contract work itself.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 6, 10 | Blocked By: 2

  **References**:
  - Pattern: `src/view/Toolbar.svelte:32-39` - existing toolbar action registry with dormant `bulk` action.
  - Pattern: `src/view/Toolbar.svelte:123-167` - current toolbar action dispatch strategy to extend, not replace.
  - Pattern: `src/view/FolderCardPanel.svelte:311-354` - event forwarding seam between Toolbar/CardItem and FolderCardView.
  - Pattern: `src/view/CardItem.svelte:23-43` - current click, context menu, and pin event surfaces.
  - Style: `styles.css:51-57`, `styles.css:316-394` - current toolbar/card state classes to extend for bulk mode visuals.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/card-context-actions.test.ts -t "registers bulk subscriptions"` exits `0`.
  - [ ] Tests prove toolbar bulk entry routes through the existing toolbar action seam.
  - [ ] Tests prove card bulk-selected styling state can coexist with single-note selected styling state via props.
  - [ ] Build passes with new Svelte props/events and no TypeScript regressions.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: onOpen registers bulk-related event subscriptions
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/card-context-actions.test.ts -t "registers bulk subscriptions"`
      2. Save output to `.sisyphus/evidence/task-3-bulk-subscriptions.txt`
    Expected: Test passes and confirms the panel mock captures all required bulk event handlers
    Evidence: .sisyphus/evidence/task-3-bulk-subscriptions.txt

  Scenario: Svelte prop shape compiles with bulk state additions
    Tool: Bash
    Steps:
      1. Run `npm run check`
      2. Save output to `.sisyphus/evidence/task-3-bulk-props-check.txt`
    Expected: Type-check passes with updated Toolbar/Panel/Card props and event signatures
    Evidence: .sisyphus/evidence/task-3-bulk-props-check.txt
  ```

  **Commit**: NO | Message: `feat(ui): expose explicit bulk mode contracts` | Files: `src/view/Toolbar.svelte`, `src/view/FolderCardPanel.svelte`, `src/view/CardItem.svelte`, `styles.css`, `src/view/card-context-actions.test.ts`

- [x] 4. Implement the bulk selection state machine over current `visibleCards`

  **What to do**: Wire the helper from Task 1 into `FolderCardView` so entering Bulk mode enables click-to-toggle behavior, Shift+click performs inclusive range selection using the current `visibleCards` order, and `Select all` / `Clear selection` update both selection and anchor deterministically. Bulk clicks in normal mode must still open the note; only inside Bulk mode should click switch to selection. Keep pin/sort interactions compatible by recomputing `visibleCards` first and then applying path-based selection against the reordered list.

  **Must NOT do**: Do not compute ranges from `baseCards` or from DOM row indexes. Do not allow Shift+click to select hidden/filtered notes. Do not leave toolbar action states enabled when selection count is zero.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: the central behavioral state machine spans view logic and panel wiring.
  - Skills: `[]`
  - Omitted: [`frontend-ui-ux`] - interaction behavior is the core; visuals are already handled in Task 3/6.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 5, 6, 7, 8, 9, 10 | Blocked By: 1, 2

  **References**:
  - Pattern: `src/view/FolderCardView.ts:1040-1042` - `visibleCards` derives from `runPipeline()` and is the authoritative order basis.
  - Pattern: `src/view/FolderCardView.ts:1057-1076` - `pushState()` is where selection count and enablement must be recomputed.
  - Pattern: `docs/plan/v1-development-plan.md:375-379` - shift range must use current `visibleCards` order, not base cards or DOM indexes.
  - Test: `src/view/card-context-actions.test.ts:725-763` - existing style for toolbar-driven behavioral assertions.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/card-context-actions.test.ts -t "bulk selection state machine"` exits `0`.
  - [ ] Tests prove normal mode card click still routes to `plugin.openNoteFromCard()`.
  - [ ] Tests prove Bulk mode click toggles selection without opening the note.
  - [ ] Tests prove Shift+click selects an inclusive range based on current visible order.
  - [ ] Tests prove select-all and clear-selection update `selectedCount` and action enablement correctly.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Normal mode and Bulk mode click behavior stay distinct
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/card-context-actions.test.ts -t "normal mode and bulk mode click behavior stay distinct"`
      2. Save output to `.sisyphus/evidence/task-4-click-distinction.txt`
    Expected: Test passes and proves open-note is suppressed only inside Bulk mode
    Evidence: .sisyphus/evidence/task-4-click-distinction.txt

  Scenario: Shift-range selection uses visible order
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/card-context-actions.test.ts -t "shift-range selection uses visible order"`
      2. Save output to `.sisyphus/evidence/task-4-shift-range.txt`
    Expected: Test passes with concrete ordered paths and inclusive range results
    Evidence: .sisyphus/evidence/task-4-shift-range.txt
  ```

  **Commit**: NO | Message: `feat(view): implement bulk selection state machine` | Files: `src/view/FolderCardView.ts`, `src/view/FolderCardPanel.svelte`, `src/view/CardItem.svelte`, `src/view/card-context-actions.test.ts`

- [x] 5. Reconcile bulk selection across filter, scope, and vault mutation changes

  **What to do**: Define and implement lifecycle rules for bulk state. When filters or pin reorder change the visible order, preserve still-visible paths and re-anchor if needed. When folder scope changes, switching between folder and `All Notes`, or `includeSubfolders` changes reload the dataset, clear `selectedPaths` and `bulkAnchorPath` but keep `bulkMode` on so the user can continue bulk work in the new scope. When a selected file is renamed in scope, migrate old path to new path. When it is removed, deleted, or moved out of scope, drop it. After `cleanupLifecycle()` and any forced full reload, do not allow stale selected paths to survive.

  **Must NOT do**: Do not leave hidden paths selected after filter narrowing. Do not silently turn Bulk mode off on refresh. Do not rely on manual full refresh to fix selection drift.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: reconciliation spans refresh, mutation, and state-lifetime edges.
  - Skills: `[]`
  - Omitted: [`review-work`] - this is still implementation planning, not post-implementation review.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 7, 8, 9, 10 | Blocked By: 1, 2, 4

  **References**:
  - Pattern: `src/view/FolderCardView.ts:305-320` - lifecycle cleanup path that must also clean stale bulk state.
  - Pattern: `src/view/FolderCardView.ts:781-877` - rename/delete incremental mutation logic where path migration/pruning must be inserted.
  - Pattern: `src/view/FolderCardView.ts:1079-1113` - filter and include-subfolders settings-change seams that trigger visibility changes.
  - Constraint: `docs/plan/v1-development-plan.md:389-396` - selection must remain correct across sort/filter/pin changes, while `selectedPath` still drives active-note highlight.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/card-context-actions.test.ts -t "bulk selection reconciliation"` exits `0`.
  - [ ] Tests prove filter narrowing prunes hidden paths while preserving still-visible selections.
  - [ ] Tests prove scope changes clear bulk selection but keep Bulk mode active.
  - [ ] Tests prove rename migrates selected paths and delete/move-out-of-scope prunes them.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Filter and scope changes reconcile selection predictably
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/card-context-actions.test.ts -t "filter and scope changes reconcile bulk selection"`
      2. Save output to `.sisyphus/evidence/task-5-filter-scope-reconcile.txt`
    Expected: Test passes and proves hidden paths are removed while bulk mode itself survives
    Evidence: .sisyphus/evidence/task-5-filter-scope-reconcile.txt

  Scenario: Rename/delete mutations update selectedPaths
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/card-context-actions.test.ts -t "rename and delete mutations update selectedPaths"`
      2. Save output to `.sisyphus/evidence/task-5-mutation-reconcile.txt`
    Expected: Test passes and proves selected path migration/pruning works through existing mutation handlers
    Evidence: .sisyphus/evidence/task-5-mutation-reconcile.txt
  ```

  **Commit**: NO | Message: `fix(view): reconcile bulk selection across lifecycle changes` | Files: `src/view/FolderCardView.ts`, `src/view/card-context-actions.test.ts`, `src/view/bulk-selection.ts`

- [x] 6. Build the explicit Bulk toolbar strip and action routing layer

  **What to do**: Turn the toolbar’s dormant `bulk` action into a real mode toggle and render a bulk action strip when active. The strip must show selected count, `Select all`, `Clear`, `Move`, `Trash`, `Delete`, `Merge`, and `Exit Bulk`. Action buttons must be disabled when selection count is zero; merge must be disabled when fewer than 2 notes are selected. Keep the existing scope/sort/filter controls visible enough to preserve context, but make current bulk state obvious.

  **Must NOT do**: Do not hide folder/scope context entirely. Do not expose destructive actions as enabled when nothing is selected. Do not overload the existing pin or filter controls with bulk actions.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: action hierarchy and state legibility matter here.
  - Skills: [`frontend-ui-ux`] - keep the bulk strip readable within Obsidian sidebar density.
  - Omitted: [`playwright`] - plan relies on existing repo test harness, not browser-driven UI tests.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 7, 8, 9, 10 | Blocked By: 2, 3, 4

  **References**:
  - Pattern: `src/view/Toolbar.svelte:60-72` - current summary lines that can be extended to surface bulk context.
  - Pattern: `styles.css:43-107` - existing toolbar button/toggle styling to extend for bulk strip states.
  - Contract: `docs/plan/v1-development-plan.md:389-391` - Toolbar must show bulk mode / count / clear selection.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/card-context-actions.test.ts -t "bulk toolbar actions and enablement"` exits `0`.
  - [ ] Tests prove entering Bulk mode exposes action routing and selected count state.
  - [ ] Tests prove zero-selection disables move/trash/delete/merge.
  - [ ] Tests prove merge enablement requires at least two selected notes.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Bulk toolbar actions expose correct enablement
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/card-context-actions.test.ts -t "bulk toolbar actions and enablement"`
      2. Save output to `.sisyphus/evidence/task-6-bulk-toolbar.txt`
    Expected: Test passes and confirms action availability matches selected count rules
    Evidence: .sisyphus/evidence/task-6-bulk-toolbar.txt

  Scenario: Exiting Bulk mode clears selection
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/card-context-actions.test.ts -t "exiting bulk mode clears selection"`
      2. Save output to `.sisyphus/evidence/task-6-bulk-exit.txt`
    Expected: Test passes and proves exit clears `selectedPaths`, resets anchor, and keeps normal mode click behavior
    Evidence: .sisyphus/evidence/task-6-bulk-exit.txt
  ```

  **Commit**: NO | Message: `feat(toolbar): add explicit bulk action strip` | Files: `src/view/Toolbar.svelte`, `src/view/FolderCardPanel.svelte`, `styles.css`, `src/view/card-context-actions.test.ts`

- [x] 7. Deliver the batch move workflow on top of `batchMoveFiles()`

  **What to do**: Add a batch move flow that starts from selected paths, resolves them to current `TFile`s in the same explicit order as the current selection list, opens the existing `FolderPickerModal`, executes `batchMoveFiles()`, and summarizes succeeded vs failed results. After execution, remove successful paths from selection, keep failed paths selected, and trigger the normal refresh/mutation path so the list stays accurate. If the selection resolves to zero live files, show a graceful no-op result and clear stale selections.

  **Must NOT do**: Do not reimplement move logic in the view layer. Do not permanently clear failed selections. Do not silently ignore missing files without reconciling the selection set.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: orchestration across selection resolution, modal, note-ops, and result handling.
  - Skills: [`obsidian-plugin-docs`] - reuse native modal/notice/menu expectations.
  - Omitted: [`frontend-ui-ux`] - the modal already exists; emphasis is orchestration.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 10 | Blocked By: 1, 4, 5, 6

  **References**:
  - Pattern: `src/view/FolderCardView.ts:420-455` - existing single-note move orchestration to mirror structurally.
  - API/Type: `src/view/note-ops.ts:159-177` - `batchMoveFiles()` summary contract.
  - Pattern: `src/FolderPickerModal.ts:45-80` - existing native folder picker to reuse.
  - Test: `src/view/card-context-actions.test.ts:112-123` - current picker mock pattern.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/note-ops.test.ts -t "batchMoveFiles"` exits `0`.
  - [ ] `npx vitest run src/view/card-context-actions.test.ts -t "batch move workflow"` exits `0`.
  - [ ] Tests prove selected paths resolve to ordered `TFile`s before calling `batchMoveFiles()`.
  - [ ] Tests prove successful moves are cleared from selection while failed items remain selected.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: batchMoveFiles handles partial failures directly
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/note-ops.test.ts -t "batchMoveFiles collects succeeded and failed results"`
      2. Save output to `.sisyphus/evidence/task-7-batch-move-unit.txt`
    Expected: Test passes and proves the helper reports partial success/failure correctly
    Evidence: .sisyphus/evidence/task-7-batch-move-unit.txt

  Scenario: bulk move workflow reconciles selection after execution
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/card-context-actions.test.ts -t "bulk move workflow reconciles selection after execution"`
      2. Save output to `.sisyphus/evidence/task-7-batch-move-integration.txt`
    Expected: Test passes and proves success paths clear while failures stay selected
    Evidence: .sisyphus/evidence/task-7-batch-move-integration.txt
  ```

  **Commit**: NO | Message: `feat(view): wire batch move workflow` | Files: `src/view/FolderCardView.ts`, `src/view/note-ops.test.ts`, `src/view/card-context-actions.test.ts`

- [x] 8. Deliver batch trash and batch delete with mandatory confirmations

  **What to do**: Add explicit confirmation UI for bulk trash and bulk delete. Trash and delete must be separate actions with separate copy reflecting severity. Execution must resolve selected paths to live `TFile`s, call `batchTrashFiles()` or `batchDeleteFiles()`, summarize counts and failed paths, clear successful selections, and keep failed paths selected. If nothing live remains selected at confirm time, abort gracefully and reconcile selection.

  **Must NOT do**: Do not collapse trash and permanent delete into one ambiguous action. Do not execute destructive actions without confirmation. Do not emit one notice per file.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: destructive action UX plus selection reconciliation requires careful handling.
  - Skills: [`obsidian-plugin-docs`] - keep confirmation flow aligned with Obsidian-native expectations.
  - Omitted: [`frontend-ui-ux`] - hierarchy is already set by Task 6.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 10 | Blocked By: 1, 4, 5, 6

  **References**:
  - API/Type: `src/view/note-ops.ts:182-220` - `batchTrashFiles()` and `batchDeleteFiles()` summary contracts.
  - Pattern: `src/view/FolderCardView.ts:451-454` - existing failure Notice pattern to extend into summarized bulk reporting.
  - Constraint: `docs/plan/v1-development-plan.md:407-423` - destructive actions need visible confirmation and visible success/failure outcomes.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/note-ops.test.ts -t "batchTrashFiles|batchDeleteFiles"` exits `0`.
  - [ ] `npx vitest run src/view/card-context-actions.test.ts -t "bulk trash and delete workflows"` exits `0`.
  - [ ] Tests prove confirmation is required before helper execution.
  - [ ] Tests prove partial failures keep failed paths selected and summarize outcomes once.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: batch trash/delete helpers report partial failure summaries
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/note-ops.test.ts -t "batchTrashFiles|batchDeleteFiles"`
      2. Save output to `.sisyphus/evidence/task-8-trash-delete-unit.txt`
    Expected: Tests pass and prove both helpers collect succeeded/failed results correctly
    Evidence: .sisyphus/evidence/task-8-trash-delete-unit.txt

  Scenario: destructive bulk actions require confirmation
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/card-context-actions.test.ts -t "bulk trash and delete workflows require confirmation"`
      2. Save output to `.sisyphus/evidence/task-8-trash-delete-confirm.txt`
    Expected: Test passes and proves no destructive helper runs before explicit confirmation
    Evidence: .sisyphus/evidence/task-8-trash-delete-confirm.txt
  ```

  **Commit**: NO | Message: `feat(view): add confirmed bulk trash delete workflows` | Files: `src/view/FolderCardView.ts`, `src/view/note-ops.test.ts`, `src/view/card-context-actions.test.ts`

- [x] 9. Deliver merge workflow with explicit reorder, preview, and optional post-merge trash

  **What to do**: Implement a dedicated merge workflow starting from selected paths. On launch, freeze the initial ordered selection list from current `visibleCards` order, then allow users to reorder the list explicitly with up/down controls inside a merge modal. The modal must collect merged title, target folder, separator, and source-cleanup choice (`keep` default, optional `trash after merge`). It must render an actual textual preview assembled from the same ordered file list and separator that the final merge execution will use. On confirm, call `mergeNotes()` with the modal-owned ordered files. If the user selected post-merge trash, then call `batchTrashFiles()` only after merge succeeds. Summarize merge success and any follow-up trash failures separately.

  **Must NOT do**: Do not use drag-and-drop reorder. Do not allow merge when fewer than two notes are selected. Do not implicitly trash source notes. Do not let live pin/sort/filter changes keep mutating merge order after the modal opens.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: this is the most complex workflow, combining ordered data, modal state, preview generation, and post-success branching.
  - Skills: [`obsidian-plugin-docs`, `frontend-ui-ux`] - native modal expectations plus clear ordered-list UX.
  - Omitted: [`playwright`] - no browser automation harness required for plan acceptance.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 10 | Blocked By: 1, 4, 5, 6

  **References**:
  - API/Type: `src/view/note-ops.ts:233-259` - `mergeNotes()` contract and current keep-source default.
  - Pattern: `src/FolderPickerModal.ts:45-80` - existing modal style and Obsidian-native dialog precedent.
  - Constraint: `docs/plan/v1-development-plan.md:427-448` - merge requires order, separator, target title/folder, preview, confirmation, and explicit keep-vs-trash branching.
  - UI constraint: `styles.css:316-394` - current card styling baseline if a modal-scoped ordered list reuses card-like affordances.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/note-ops.test.ts -t "mergeNotes"` exits `0`.
  - [ ] `npx vitest run src/view/card-context-actions.test.ts -t "merge workflow"` exits `0`.
  - [ ] Tests prove explicit reorder changes the ordered file list passed into `mergeNotes()`.
  - [ ] Tests prove merge preview is assembled from the exact same ordered files and separator as final execution.
  - [ ] Tests prove optional source-note trashing only runs after a successful merge.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: mergeNotes helper creates merged file and reports failure cleanly
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/note-ops.test.ts -t "mergeNotes"`
      2. Save output to `.sisyphus/evidence/task-9-merge-unit.txt`
    Expected: Tests pass for zero-file rejection, successful merge creation, unique path behavior, and error propagation
    Evidence: .sisyphus/evidence/task-9-merge-unit.txt

  Scenario: merge workflow honors explicit reorder and post-merge source handling
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/card-context-actions.test.ts -t "merge workflow honors explicit reorder and post-merge source handling"`
      2. Save output to `.sisyphus/evidence/task-9-merge-integration.txt`
    Expected: Test passes and proves modal-owned order drives merge execution and optional trashing only happens after merge success
    Evidence: .sisyphus/evidence/task-9-merge-integration.txt
  ```

  **Commit**: NO | Message: `feat(view): add bulk merge workflow` | Files: `src/view/FolderCardView.ts`, `src/view/note-ops.test.ts`, `src/view/card-context-actions.test.ts`, merge-related modal/component files if added`

- [x] 10. Harden Phase 2 regressions and run repo-wide validation

  **What to do**: Add final regression coverage that proves Phase 2 did not break existing single-note behaviors (open note, context menu, pinning, filter changes, include-subfolders, all-notes transitions) and that zero-selection, stale-selection, and selection-after-success edge cases behave predictably. Add or extend tests in `card-context-actions.test.ts` and any new helper tests to make the full Phase 2 state machine executable under Vitest. Then run repo-wide `check/build/test`.

  **Must NOT do**: Do not treat passing helper tests as sufficient. Do not skip regression coverage for legacy single-note behavior. Do not leave evidence capture to the final review wave only.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: focused regression additions plus repo gates.
  - Skills: `[]`
  - Omitted: [`review-work`] - final verification wave handles multi-agent review after implementation.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: FINAL | Blocked By: 2, 3, 4, 5, 7, 8, 9

  **References**:
  - Test: `src/view/card-context-actions.test.ts:1481-1519` - existing regression style across all-notes transitions.
  - Test: `src/view/card-context-actions.test.ts:492-763` - existing event-isolation coverage style to preserve.
  - Repo gate: `AGENTS.md` Required Validation - must run `npm run check`, `npm run build`, `npm test`.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/card-context-actions.test.ts` exits `0`.
  - [ ] `npm run check` exits `0`.
  - [ ] `npm run build` exits `0`.
  - [ ] `npm test` exits `0`.
  - [ ] Regression tests prove non-bulk open-note, context menu, pinning, tag filtering, and include-subfolders behaviors still work after entering/exiting Bulk mode.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Full integration regression suite passes
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/card-context-actions.test.ts`
      2. Save output to `.sisyphus/evidence/task-10-card-context-regression.txt`
    Expected: Command exits 0 and all bulk + legacy interaction tests pass together
    Evidence: .sisyphus/evidence/task-10-card-context-regression.txt

  Scenario: Repo gates remain green after Phase 2
    Tool: Bash
    Steps:
      1. Run `npm run check`
      2. Run `npm run build`
      3. Run `npm test`
      4. Save outputs to `.sisyphus/evidence/task-10-check.txt`, `.sisyphus/evidence/task-10-build.txt`, and `.sisyphus/evidence/task-10-test.txt`
    Expected: All three commands exit 0
    Evidence: .sisyphus/evidence/task-10-check.txt
  ```

  **Commit**: NO | Message: `test(view): harden phase2 regression coverage` | Files: `src/view/card-context-actions.test.ts`, `src/view/note-ops.test.ts`, `src/view/bulk-selection.test.ts`, related evidence outputs

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 verification steps run after all implementation tasks. ALL must pass. Present consolidated results to the user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Comprehensive review orchestration via `/review-work`

  **What to do**: Run the OpenCode `/review-work` command against the completed Phase 2 implementation. This is the mandatory environment-native review mechanism for final sign-off and must be treated as the canonical multi-review pass.

  **Tool / Command**:
  - OpenCode command: `/review-work`

  **Acceptance Criteria**:
  - [ ] `/review-work` completes successfully.
  - [ ] Review output confirms no unresolved critical issues remain.
  - [ ] Review output explicitly covers bulk entry, selection semantics, batch workflows, merge workflow, and repo gates.

  **QA Scenario**:
  ```
  Scenario: `/review-work` completes with no unresolved critical findings
    Tool: OpenCode command
    Steps:
      1. Run `/review-work`
      2. Save the full review output to `.sisyphus/evidence/final-f1-review-work.txt`
      3. If the review reports blocking issues, fix them, rerun `/review-work`, and overwrite the evidence file with the passing result
    Expected: Final `/review-work` run reports no unresolved critical/blocking issues
    Evidence: .sisyphus/evidence/final-f1-review-work.txt
  ```

- [x] F2. Repo gate verification

  **What to do**: Re-run the required repository gates on the final Phase 2 branch and save their exact outputs. This is the hard executable proof that the implementation is buildable and test-clean.

  **Tool / Command**:
  - Bash
  - Required commands:
    - `npm run check`
    - `npm run build`
    - `npm test`

  **Acceptance Criteria**:
  - [ ] `npm run check` exits `0`.
  - [ ] `npm run build` exits `0`.
  - [ ] `npm test` exits `0`.

  **QA Scenario**:
  ```
  Scenario: Repo gates are all green
    Tool: Bash
    Steps:
      1. Run `npm run check` and save output to `.sisyphus/evidence/final-f2-check.txt`
      2. Run `npm run build` and save output to `.sisyphus/evidence/final-f2-build.txt`
      3. Run `npm test` and save output to `.sisyphus/evidence/final-f2-test.txt`
    Expected: All three commands exit 0
    Evidence: .sisyphus/evidence/final-f2-check.txt
  ```

- [x] F3. Phase-2-specific verification replay

  **What to do**: Re-run the three Phase 2 anchor suites that prove feature behavior itself: bulk-selection helper tests, direct note-op tests, and integration/event-contract tests. This is separate from repo gates so the final evidence bundle shows feature-level proof explicitly.

  **Tool / Command**:
  - Bash
  - Required commands:
    - `npx vitest run src/view/bulk-selection.test.ts`
    - `npx vitest run src/view/note-ops.test.ts`
    - `npx vitest run src/view/card-context-actions.test.ts`

  **Acceptance Criteria**:
  - [ ] All three commands exit `0`.
  - [ ] Evidence exists for bulk selection semantics, note-op behavior, and integration/event routing.

  **QA Scenario**:
  ```
  Scenario: Phase 2 verification suites all pass
    Tool: Bash
    Steps:
      1. Run `npx vitest run src/view/bulk-selection.test.ts` and save output to `.sisyphus/evidence/final-f3-bulk-selection.txt`
      2. Run `npx vitest run src/view/note-ops.test.ts` and save output to `.sisyphus/evidence/final-f3-note-ops.txt`
      3. Run `npx vitest run src/view/card-context-actions.test.ts` and save output to `.sisyphus/evidence/final-f3-card-context.txt`
    Expected: All three commands exit 0
    Evidence: .sisyphus/evidence/final-f3-bulk-selection.txt
  ```

- [x] F4. Scope fidelity audit

  **What to do**: Audit the changed file set against the plan boundaries and confirm that no Phase 3/4 or unrelated architecture work leaked into the implementation. This audit must explicitly check for forbidden files/areas such as `src/search/`, persisted `selectedPaths` in settings, drag-and-drop reorder work, and unrelated keyboard-navigation or preview-system rewrites.

  **Tool / Command**:
  - Bash
  - Required commands:
    - `git diff --name-only -- src/ styles.css`
    - `git diff --name-only -- docs/`

  **Acceptance Criteria**:
  - [ ] Changed file set stays inside the plan’s allowed Phase 2 touchpoints.
  - [ ] No search/index files, settings persistence for `selectedPaths`, drag-and-drop reorder files, or unrelated phase files appear in the diff.

  **QA Scenario**:
  ```
  Scenario: Changed files remain within Phase 2 scope
    Tool: Bash
    Steps:
      1. Run `git diff --name-only -- src/ styles.css` and save output to `.sisyphus/evidence/final-f4-src-diff.txt`
      2. Inspect the changed paths against the plan’s allowed touchpoints: `src/view/FolderCardView.ts`, `src/view/FolderCardPanel.svelte`, `src/view/CardItem.svelte`, `src/view/Toolbar.svelte`, `src/view/types.ts`, `src/view/note-ops.ts`, new Phase-2-specific helpers/tests, and `styles.css`
      3. Confirm no forbidden paths such as `src/search/`, unrelated settings persistence changes for `selectedPaths`, or out-of-scope phase files appear
      4. Save the scope-audit summary to `.sisyphus/evidence/final-f4-scope-fidelity.txt`
    Expected: Diff stays within planned Phase 2 file scope and contains no forbidden Phase 3/4 or unrelated architecture work
    Evidence: .sisyphus/evidence/final-f4-scope-fidelity.txt
  ```

## Commit Strategy
- Default: **NO commits unless the user explicitly requests commits during execution.**
- If the user later requests commits, use task-scoped conventional messages that match the task’s suggested message.
- Never batch unrelated Phase 2 tasks into one commit.

## Success Criteria
- Phase 2 bulk mode is discoverable from the existing toolbar and does not change normal card-open behavior outside the mode.
- Bulk selection is path-based, stable across reorder, and deterministic across scope and mutation changes.
- Batch move/trash/delete/merge all surface confirmation or result reporting consistent with the chosen action severity.
- Merge order, preview, and source-note cleanup are explicit and predictable.
- All targeted Vitest suites and repo gates pass.
