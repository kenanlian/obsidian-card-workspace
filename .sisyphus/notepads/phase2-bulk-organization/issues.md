## 2026-04-18 Task 1 — bulk-selection helper
- No implementation blockers.
- Environment note: `python` command is unavailable in this workspace; direct file edits were used instead.


## 2026-04-18 Task 2 — selectedPath independence and bulk runtime payload
- No implementation blockers.
- `npm run build` reports pre-existing Svelte a11y warnings in `src/view/Toolbar.svelte`; build still completes successfully.
- Task 2 correction pass: restored `opencode.json` and replaced pin/unpin bulk enablement keys with bulk workflow action keys (`canBulkMoveSelected`, `canBulkTrashSelected`, `canBulkDeleteSelected`, `canBulkMergeSelected`) to match Phase 2 payload expectations.


## 2026-04-18 Task 3 — bulk UI contract surface
- No implementation blockers.
- `npm run build` still reports the same pre-existing `src/view/Toolbar.svelte` a11y warnings around the folder menu tree items; the new bulk contract changes did not add new build warnings.


## 2026-04-18 Task 4 — bulk click state machine integration
- No implementation blockers.
- Mid-run full suite exposed two regressions (new test relying on empty visible set; older independence test assuming Set identity); both were corrected by aligning fixtures to visible-card reconciliation behavior.
- `npm run build` continues to report the same pre-existing `src/view/Toolbar.svelte` a11y warnings; no new build warnings were introduced.


## 2026-04-18 Task 5 — lifecycle reconciliation for bulk selection
- No implementation blockers.
- While wiring helper insertion, a symbol-level insert initially landed inside `onMoveTargetChosen`; the method block was immediately repaired and validated via LSP diagnostics + tests.
- `npm run build` still reports the same pre-existing `src/view/Toolbar.svelte` a11y warnings; Task 5 changes did not introduce additional build warnings.

- Follow-up issue root cause: Task 5 clear logic executed only in the non-inflight path, so `queued_latest` requests skipped immediate clearing until the queued load eventually started.
- Test harness note: the new in-flight regression needed an explicit `notes` folder mock from `getAbstractFileByPath` to avoid `rejected_invalid` short-circuiting before queue logic.


## 2026-04-18 Task 6 — explicit bulk toolbar strip
- No implementation blockers.
- CSS-file LSP diagnostics are unavailable in this workspace because the configured `biome` server is not installed; TypeScript/Svelte diagnostics remained clear.
- `npm run build` is still expected to emit the pre-existing `src/view/Toolbar.svelte` folder-menu a11y warnings; this task intentionally avoids broadening into that unrelated cleanup.

- Task 6 follow-up issue note: the original toolbar enablement test skipped the exactly-one-selected state, which left `canBulkMergeSelected` under-verified despite correct runtime logic.


## 2026-04-18 Task 7 — batch move workflow via batchMoveFiles
- No implementation blockers.
- The branch did not contain `src/view/note-ops.test.ts`; Task 7 added this file to satisfy targeted helper test coverage and expected command path.
- Initial `npm run check` failed on strict test typings for mocked `TFile` values; fixed by tightening test casts and constructor usage while preserving runtime assertions.
- `npm run build` continues to emit the same pre-existing `Toolbar.svelte` a11y warnings, unchanged by Task 7 scope.

## 2026-04-18 Task 7 follow-up — already-target stale reconciliation
- Regression root cause: `onBulkMoveTargetChosen()` returned early in the all-already-target branch without updating `selectedPaths`, leaving stale missing paths selected.
- Fix was kept minimal in-view by reusing precomputed `filesAlreadyInTarget` + ordered selection filtering before emitting the no-op notice.

## 2026-04-18 Task 8 — batch trash/delete confirmation workflow
- No implementation blockers.
- Initial integration tests assumed `window.confirm`; the test runtime has no `window`, so confirmation stubbing was switched to `globalThis.confirm` and view logic now checks `globalThis.confirm` directly.
- LSP reports existing `await`-no-effect hints in `card-context-actions.test.ts`; no errors were introduced by Task 8 changes.

## 2026-04-18 Task 8 follow-up — modal confirmation test seam
- Failure root cause was test drift: Task 8 tests still asserted `globalThis.confirm` while runtime confirmation now uses `BulkActionConfirmModal`.
- The initial modal-click assertion raced asynchronous completion and observed only pre-confirm stale-path reconciliation; fixed by awaiting an extra microtask after simulated modal button clicks.
- Current LSP output remains warning-only (`await` no-effect hints already present in this test file); no new TypeScript errors introduced.

## 2026-04-18 Task 9 — merge workflow with reorder/preview/optional trash
- Initial merge-workflow test harness failed because modal-render capture reused `previewText`, colliding with the runtime modal state field; fixed by separating rendered preview capture (`renderedPreviewText`) from modal runtime state in mocks.
- Another merge test race/behavior issue was resolved by explicitly flushing async microtasks around modal interactions and by pinning merge mock behavior per scenario (`fail` first, then success override).
- Build verification remains green with the same pre-existing `Toolbar.svelte` a11y warnings, unchanged by Task 9 scope.

- 2026-04-18 QA limitation: no Obsidian desktop executable discovered in PATH (`obsidian`/`obsidian-desktop` not found), so true hands-on UI runtime execution could not be performed in this environment.
- `npm run build` emitted existing/introduced Svelte a11y warnings in `src/view/Toolbar.svelte` around interactive role/click handlers; build still succeeds.

## 2026-04-18 Final-wave context-mining rerun
- No new blockers found for F2/F3/F4 evidence completeness in the current repository state.
