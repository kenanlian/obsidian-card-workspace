## 2026-04-18 Task 1 — bulk-selection helper
- Defined a pure helper contract in `src/view/bulk-selection.ts` returning `{ selectedPaths, anchorPath, changed }` for every operation.
- Kept operations path-based and deterministic by deriving range and reconcile results strictly from `orderedVisiblePaths`.
- Covered non-mutation guarantees in tests by asserting caller-owned `Set` values are unchanged after operations.


## 2026-04-18 Task 2 — selectedPath independence and bulk runtime payload
- `FolderCardView` now owns runtime-only bulk state (`bulkMode`, `selectedPaths`, `bulkAnchorPath`) while keeping `selectedPath` as editor-sync state.
- Both `onOpen()` initial props and `pushState()` payloads now include serializable bulk payload fields (`selectedPaths` array, `selectedCount`, and explicit bulk action booleans).
- `pushState` computes bulk action enablement from current selection plus pinned paths so Svelte can consume booleans directly without becoming state owner.


## 2026-04-18 Task 3 — bulk UI contract surface
- Kept the top-level bulk entry on the existing `toolbar-action` seam and introduced precise bulk action IDs (`bulk-select-all`, `bulk-clear-selection`, `bulk-move-selected`, `bulk-trash-selected`, `bulk-delete-selected`, `bulk-merge-selected`) so later tasks can add behavior without changing event channels.
- `FolderCardPanel.svelte` now forwards bulk runtime props to `Toolbar.svelte` and derives per-card `bulkSelected` state from the runtime-owned `selectedPaths` array instead of introducing Svelte-owned selection state.
- `CardItem.svelte` preserves `open-note`, `card-context-menu`, and `pin-toggle` while adding an explicit `bulk-select-card` affordance plus a separate `is-bulk-selected` class so bulk selection and editor-sync highlighting can coexist visually.
- Reused `bulkAnchorPath` in the toolbar bulk strip summary so the panel contract stays explicit without leaving an unused exported prop warning behind.


## 2026-04-18 Task 4 — bulk click state machine integration
- `FolderCardView` now routes `toolbar-action` IDs (`bulk`, `bulk-select-all`, `bulk-clear-selection`) through helper-backed runtime transitions while preserving existing non-bulk actions.
- Bulk click handling now uses only `visibleCards` path order for range/select-all by deriving ordered paths from `this.visibleCards` and delegating to `toggleSelection`, `rangeSelect`, `selectAll`, and `clearSelection`.
- `pushState()` now reconciles bulk selection against current visible paths before serializing panel payload, so hidden/filtered paths cannot remain in runtime selection state.
- `CardItem.svelte` keeps normal open-note behavior intact while switching root click/keyboard activation to `bulk-select-card` dispatch when `bulkMode` is enabled.
- Added integration coverage for mode distinction, shift-range visible ordering, and select-all/clear state transitions via existing `mockState.panelEventHandlers` seams.


## 2026-04-18 Task 5 — lifecycle reconciliation for bulk selection
- Scope transitions are now treated explicitly via a load-scope comparison (`folderPath` + `includeSubfolders`), so folder/all-notes/include-subfolders changes clear only `selectedPaths` + `bulkAnchorPath` while keeping `bulkMode` active.
- Full reloads no longer clear card state before reconciliation, allowing sort/pin/filter-driven reorder flows to preserve still-visible path selections and anchor continuity.
- Incremental vault mutations now reconcile bulk state directly: in-scope renames migrate selected/anchor paths old→new, while deletes and move-out-of-scope renames prune removed paths immediately before `pushState()` serialization.
- `cleanupLifecycle()` now resets runtime bulk selection/anchor so cancelled reload sessions cannot leak stale selected paths into later renders.

- Follow-up fix: queued scope changes now clear bulk selection immediately even when another load is already in flight by reconciling before the `inFlight` early return and pushing state right away when clear occurs.
- Added an in-flight regression test that asserts `queued_latest` still clears `selectedPaths`/`bulkAnchorPath` synchronously while preserving `bulkMode`.


## 2026-04-18 Task 6 — explicit bulk toolbar strip
- `Toolbar.svelte` now keeps scope/tag/subfolder context visible while adding a dedicated bulk strip that makes mode state explicit with a selected-count pill, selection hint, and direct bulk controls.
- `Exit Bulk` reuses the existing `toolbar-action` seam by dispatching the existing `bulk` action, so no new runtime event channel or `FolderCardView` workflow wiring was needed for this step.
- `FolderCardPanel.svelte` now applies bulk-mode shell/list classes so the active mode reads clearly without hiding the surrounding browsing context.
- Added targeted panel-harness integration tests for zero-selection enablement and exit behavior so later workflow tasks can build on a stable action contract.

- Task 6 follow-up: the toolbar enablement test now exercises an explicit one-selected-note state before `bulk-select-all`, proving move/trash/delete enable at 1 selection while merge stays disabled until 2+ notes are selected.


## 2026-04-18 Task 7 — batch move workflow via batchMoveFiles
- `FolderCardView` now handles `toolbar-action` = `bulk-move-selected` by reusing `FolderPickerModal` and routing execution through `batchMoveFiles()` instead of duplicating move logic.
- Bulk move resolves selected paths to live `TFile` instances in current `selectedPaths` insertion order, preserving explicit user selection order and skipping stale paths before execution.
- Post-execution reconciliation keeps only retryable paths selected (`failed` + same-folder skips), removes succeeded paths, and recalculates `bulkAnchorPath` from remaining ordered failures.
- Zero live-file resolution is treated as a graceful no-op: stale bulk selection is cleared and a single notice is surfaced so runtime state cannot retain dead paths.
- Added helper-level `batchMoveFiles` partial-failure test coverage and integration coverage for ordered resolution plus post-run selection reconciliation.

## 2026-04-18 Task 7 follow-up — already-target stale reconciliation
- The `movableFiles.length === 0` branch now reconciles selection state before returning, keeping only live already-target paths in selection order and clearing stale missing paths deterministically.
- Added a focused regression test for the already-target + stale edge case to ensure stale selection entries are not silently preserved.

## 2026-04-18 Task 8 — batch trash/delete confirmation workflow
- `FolderCardView` now routes `toolbar-action` IDs `bulk-trash-selected` and `bulk-delete-selected` through dedicated flows that require explicit confirmation before destructive helpers run.
- Trash and permanent delete keep separate confirmation copy and summary notices so severity remains explicit (`Move ... to trash?` vs `Permanently delete ... This cannot be undone.`).
- Both flows reuse `batchTrashFiles()` / `batchDeleteFiles()` and preserve selection-order semantics by resolving `selectedPaths` to live `TFile` instances in insertion order.
- Stale paths are reconciled deterministically: if no live files remain at confirm time, selection and anchor are cleared and execution no-ops with one summary notice.
- Post-execution reconciliation now keeps only failed paths selected (retry set), clears successful paths, and recalculates `bulkAnchorPath` from remaining ordered failures.
- Added helper-level partial-failure tests for `batchTrashFiles` and `batchDeleteFiles`, plus integration coverage for confirmation gating and destructive-flow reconciliation.

## 2026-04-18 Task 8 follow-up — modal confirmation test seam
- Updated `card-context-actions.test.ts` to drive the real modal confirmation flow via `MockModal` + `MockSetting` button handlers instead of `globalThis.confirm` stubs.
- Added explicit modal assertions (title/message/button path) and click simulation so tests verify helpers do not run before confirmation and do run after clicking the destructive action.
- Kept ordered live-file resolution, failure-only reselection, and single-summary notice assertions intact for the trash/delete workflows.

## 2026-04-18 Task 9 — merge workflow with reorder/preview/optional trash
- Implemented `bulk-merge-selected` orchestration in `FolderCardView` using a new Obsidian-native `BulkMergeModal` with explicit up/down reordering, merged title, target folder picker, separator input, preview, and source cleanup choice (`keep` default, optional `trash`).
- Merge launch now freezes source order from current `visibleCards` order intersected with selected paths; later pin/sort/filter changes do not mutate modal-owned order.
- Preview generation and final merge execution both use the same ordered file list and separator, preserving merge contract parity.
- Merge success now emits a dedicated summary notice; optional post-merge trash runs only after successful merge and emits a separate trash summary with retry selection reconciliation for trash failures.
- Added merge helper coverage in `note-ops.test.ts` and merge workflow integration coverage in `card-context-actions.test.ts` for reorder impact, preview/execution parity, and merge-success-gated trash behavior.


## 2026-04-18 Task 10 — Phase 2 regression hardening and repo-wide validation
- Added a dedicated `Phase 2 regression hardening` block in `src/view/card-context-actions.test.ts` to prove legacy single-note behavior still works after bulk mode transitions (open note + card context menu).
- Added targeted regression coverage that bulk-mode enter/exit does not break filter-change, pin-toggle, include-subfolders-change, or toolbar `all-notes` routing.
- Added explicit zero-selection no-op assertions for bulk move/trash/delete/merge actions to keep behavior predictable and side-effect free.
- Added stale-selection + post-success reconciliation coverage for destructive bulk actions (pre-confirm stale pruning and selection clear after successful trash).
- Added post-success selection-state coverage for merge (`cleanupMode=keep`) to verify `selectedPaths` clears while `selectedPath` remains stable.
- Verified required gates: targeted `npx vitest run src/view/card-context-actions.test.ts`, plus full `npm run check`, `npm run build`, and `npm test` all pass (build still shows pre-existing `Toolbar.svelte` a11y warnings).

- 2026-04-18 QA: High-fidelity verification without Obsidian desktop used repo gates plus focused bulk suites.
- `bulk-selection.test.ts` validates toggle/range/select-all/reconcile/rename-prune semantics for path-stable multi-selection.
- `card-context-actions.test.ts` (86 passing tests) gives strong behavioral coverage for bulk mode entry/exit, selection transitions, destructive confirmations, merge reorder/preview, and selectedPath isolation.
- Full repo gates (`npm run check`, `npm run build`, `npm test`) passed, indicating no type/build/test regressions from Phase 2 changes.

- 2026-04-18 review: Phase 2 bulk organization implementation appears complete against the plan and stated constraints. Verified explicit bulk mode, visible-order range selection, scope-change clearing without exiting bulk mode, confirmation-gated trash/delete, frozen merge ordering with preview parity, and selectedPath/selectedPaths independence. Non-blocking watchpoint: merge preview assembly is duplicated between FolderCardView.ts and note-ops.ts, so future edits should keep both paths synchronized.


## 2026-04-18 Task 11 — Final Verification Wave follow-up fixes
- Added a lightweight `pushSelectionState()` path in `FolderCardView` for selection-only bulk updates, so bulk click/toggle/clear/reselection flows no longer re-run `deriveVisibleCards()` or `deriveAvailableTags()` on every state change.
- Kept reconciliation semantics intact by still reconciling `selectedPaths`/`bulkAnchorPath` against the current `visibleCards` order before each lightweight panel update.
- Left full `pushState()` behavior unchanged for card-data-changing paths (load, incremental mutation, hydration, sort) so pipeline/tag recomputation still happens when card content/scope actually changes.
- Hardened merge path construction in `note-ops.mergeNotes()` by normalizing merge titles (`/` and `\` collapsed to spaces, trim/collapse whitespace, fallback to `Merged notes`), ensuring merged files cannot escape the chosen target folder via separators.
- Added focused regressions: bulk selection-only updates avoid pipeline/tag recomputation in `card-context-actions.test.ts`, and merge-title separator/fallback hardening in `note-ops.test.ts`.
- Verified required gates: `npx vitest run src/view/card-context-actions.test.ts`, `npx vitest run src/view/note-ops.test.ts`, `npm run check`, and `npm run build` all pass (with existing non-blocking `Toolbar.svelte` a11y warnings).

## 2026-04-18 Final-wave context-mining rerun
- Re-checked the current final-wave evidence set and confirmed `final-f2-*`, `final-f3-*`, and `final-f4-*` artifacts now exist under `.sisyphus/evidence/`.
- Verified F2/F3 outputs show successful command runs (`check`, `build`, `test`, and three Phase-2 anchor suites) in the current evidence snapshot.
- Confirmed F4 scope evidence aligns with current tracked source diff (`src/view/*` + `styles.css`) and no `docs/` tracked changes.
- The earlier blocker "missing final-wave evidence" is resolved in current context; remaining final-wave dependency is only fresh F1 review output generation.
