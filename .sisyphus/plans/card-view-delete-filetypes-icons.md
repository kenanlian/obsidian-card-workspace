# Card View Delete + File Types + Icons

## TL;DR
> **Summary**: Consolidate the bulk destructive UI into one Obsidian-preference-respecting delete action, expand card eligibility beyond plain markdown, and add stable file-type affordances without introducing new settings or real non-markdown previews.
> **Deliverables**:
> - One bulk `Delete selected` action wired to Obsidian `FileManager.trashFile(...)`
> - Card support for `.md`, `.base`, `.canvas`, `.excalidraw`, and `.excalidraw.md`
> - Placeholder previews for non-markdown card kinds with exact per-type copy
> - File-type icon in the card header action cluster for each supported kind
> - Updated Vitest coverage for toolbar/runtime, hydration, incremental updates, panel empty state, pipeline search fallback, and card rendering
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

## Context
### Original Request
- Merge the current bulk `trash` and `delete` buttons into one `delete` button.
- That delete action must behave like Obsidian’s built-in file deletion and follow the user’s **Files & Links** preference automatically.
- Show `.base` and `.canvas` files in cards in addition to existing markdown-oriented content.
- Only real markdown documents get text previews; other supported file kinds show a placeholder preview string.
- Add a file-type icon in the card title/header area that differs by file kind.

### Interview Summary
- Test strategy: **TDD**.
- Icon strategy: **built-in Obsidian/lucide icon mapping**.
- Placeholder strategy: **per-type English copy**.
- No plugin setting may be added for delete/trash behavior.

### Metis Review (gaps addressed)
- Resolved Excalidraw ambiguity by treating both literal `.excalidraw` files and `.excalidraw.md` paths as `excalidraw` cards.
- Resolved header-layout ambiguity by keeping the file-type icon in the **top-right action cluster**, before the pin button or bulk checkbox, so the UI still matches the user’s “right upper corner” request.
- Resolved search ambiguity by making non-markdown cards **title-searchable only**; placeholder copy must not become searchable content.
- Contained scope so merge cleanup keeps its current dedicated trash behavior; only the user-facing bulk delete button changes semantics.

## Work Objectives
### Core Objective
Implement the requested card-view UX changes with no behavior gaps: one delete button, expanded supported file kinds, exact placeholder previews for non-markdown cards, and visible per-kind icons.

### Deliverables
- Shared file-kind resolution contract used by runtime, UI, and tests.
- Refactored bulk action state/UI to remove `trash` as a user-facing bulk button.
- New preference-respecting delete helper for the bulk delete flow.
- Card loading/hydration/incremental refresh support for `.base`, `.canvas`, `.excalidraw`, and `.excalidraw.md`.
- Updated card header rendering and CSS for file-type icons.
- Updated empty-state copy and search fallback behavior.

### Definition of Done (verifiable conditions with commands)
- `npx vitest run src/view/file-kind.test.ts src/view/note-ops.test.ts src/view/Toolbar.svelte.test.ts src/view/card-context-actions.test.ts src/view/CardItem.svelte.test.ts src/view/FolderCardPanel.svelte.test.ts src/view/pipeline.test.ts src/view/FolderCardView.test.ts`
- `npm run check`
- `npm run build`
- `npm test`
- All commands above exit with code `0`.

### Must Have
- Only one bulk destructive action remains visible: `Delete selected`.
- That action calls `app.fileManager.trashFile(file)` through a dedicated batch helper.
- `.md`, `.base`, `.canvas`, `.excalidraw`, and `.excalidraw.md` become eligible card kinds.
- Card titles continue to use `file.basename`; do not add extra suffix-stripping rules for supported file kinds.
- Only `markdown` cards call `cachedRead(...)` + `buildLightPreview(...)`.
- Exact placeholder copy:
  - `base` → `This is a base file.`
  - `canvas` → `This is a canvas file.`
  - `excalidraw` → `This is an excalidraw file.`
- Exact icon mapping:
  - `markdown` → `file-text`
  - `base` → `database`
  - `canvas` → `layout-dashboard`
  - `excalidraw` → `pen-tool`
- Empty state copy becomes `No supported files found in this folder.`
- Non-markdown cards remain title-searchable only.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Do **not** add plugin settings for delete behavior.
- Do **not** call `vault.delete(...)` from the merged bulk delete action.
- Do **not** change merge cleanup semantics in `executeBulkMerge(...)`; keep its existing trash cleanup path unless a failing test proves a required collateral fix.
- Do **not** parse `.base`, `.canvas`, or `.excalidraw` content into text previews.
- Do **not** expand search indexing infrastructure beyond the targeted title-match fallback needed for non-markdown cards.
- Do **not** move the file-type icon to the left of the title text; keep it in the header action cluster.
- Do **not** leave stale `canBulkTrashSelected` / `bulk-trash-selected` symbols behind.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: **TDD** with Vitest (`node` + `jsdom` projects in `vitest.config.ts:8-42`)
- QA policy: Every task includes happy-path and failure/edge scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.txt`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. Extract shared dependencies first.

Wave 1: shared contracts + RED tests
- Task 1 — shared file-kind utility contract
- Task 2 — RED tests for preference-respecting delete helper
- Task 4 — RED tests for single bulk delete UI/runtime path
- Task 6 — RED tests for supported-file loading, placeholder previews, search fallback, and empty-state behavior

Wave 2: implementations + UI finalization
- Task 3 — implement preference-respecting delete helper
- Task 5 — implement single bulk delete UI/runtime consolidation
- Task 7 — implement supported-file runtime, hydration, incremental refresh, and search behavior
- Task 8 — implement file-type icon rendering/styles and finalize related tests

### Dependency Matrix (full, all tasks)
- 1 blocks 3, 5, 7, 8
- 2 blocks 3
- 3 blocks 5
- 4 blocks 5
- 5 has no downstream blockers beyond final verification
- 6 blocks 7 and 8
- 7 blocks 8
- 8 blocks final verification wave

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 4 tasks → `quick`, `unspecified-low`, `unspecified-high`
- Wave 2 → 4 tasks → `quick`, `unspecified-low`, `unspecified-high`, `visual-engineering`

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Add shared file-kind contract and helpers

  **What to do**: Create a new shared utility module under `src/view/` (recommended name: `file-kind.ts`) that centralizes all supported-card decisions. It must expose: `CardFileKind`, `resolveCardFileKindFromPath(path)`, `resolveCardFileKind(file)`, `isSupportedCardFile(file)`, `isMarkdownCardKind(kind)`, `getCardPlaceholderText(kind)`, and `getCardFileIcon(kind)`. The resolver must classify `.excalidraw.md` as `excalidraw` before the plain `.md` case. Update `src/view/types.ts` so `NoteCardRecord` stores `fileKind: CardFileKind`, card-level `previewMode` allows `"placeholder"`, and `VaultMutationEvent` stores `fileKind: CardFileKind | null` instead of `isMarkdown: boolean`.
  **Must NOT do**: Do not put file-kind logic directly into `FolderCardView.ts`, `CardItem.svelte`, or `main.ts`; do not invent additional file kinds; do not widen `src/view/markdown-utils.ts` preview contracts unless type-checking proves it is necessary.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: narrow shared-contract work across a few TS modules
  - Skills: `[]` - no special skill required
  - Omitted: `obsidian-plugin-docs` - Obsidian API research is already complete

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 3, 5, 7, 8 | Blocked By: none

  **References**:
  - Pattern: `src/view/types.ts:38-48` - current `NoteCardRecord` contract to extend with `fileKind`
  - Pattern: `src/view/types.ts:107-113` - current vault mutation boolean contract that must be generalized
  - Pattern: `src/view/FolderCardView.ts:1022-1036` - card records are created here and need the new shared kind resolver
  - Pattern: `src/main.ts:702-713` - vault mutation event payload currently hardcodes markdown-only semantics
  - Test: `src/view/note-ops.test.ts:1-89` - lightweight helper-test structure for a new `file-kind.test.ts`

  **Acceptance Criteria**:
  - [ ] `src/view/file-kind.ts` exists and exports the exact helper surface described above.
  - [ ] `resolveCardFileKindFromPath("sketch/idea.excalidraw.md")` resolves to `excalidraw`.
  - [ ] Mixed-case extensions are normalized (`DOC.MD`, `schema.BASE`, `map.CANVAS`).
  - [ ] `NoteCardRecord` and `VaultMutationEvent` no longer use markdown-only naming for supported-card decisions.
  - [ ] `npx vitest run src/view/file-kind.test.ts` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: file-kind matrix resolves every supported card kind
    Tool: Bash
    Steps: Run `npx vitest run src/view/file-kind.test.ts -t "resolves supported card kinds including .excalidraw.md and mixed-case extensions"`
    Expected: Vitest passes; assertions prove markdown/base/canvas/excalidraw detection and unsupported-file rejection.
    Evidence: .sisyphus/evidence/task-1-file-kind-contract.txt

  Scenario: unsupported paths stay unsupported
    Tool: Bash
    Steps: Run `npx vitest run src/view/file-kind.test.ts -t "returns null for unsupported file paths"`
    Expected: Vitest passes; files such as `media/image.png` and `notes/audio.mp3` are rejected.
    Evidence: .sisyphus/evidence/task-1-file-kind-contract-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/file-kind.ts`, `src/view/file-kind.test.ts`, `src/view/types.ts`

- [x] 2. Write RED tests for preference-respecting delete helper

  **What to do**: Add or update `src/view/note-ops.test.ts` so it first fails against the current implementation and explicitly requires a new bulk-delete helper path that uses `app.fileManager.trashFile(file)` instead of `app.vault.delete(file)` or `app.vault.trash(file, true)`. Keep existing permanent delete helper coverage intact for any remaining internal permanent-delete helper.
  **Must NOT do**: Do not implement the helper in this task; do not delete permanent delete coverage if the underlying helper remains in the module.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: targeted unit-test RED pass in one test file
  - Skills: `[]`
  - Omitted: `git-master` - no git operation requested

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 3 | Blocked By: 1

  **References**:
  - Pattern: `src/view/note-ops.ts:64-94` - current permanent delete + trash helpers to contrast against the new behavior
  - Pattern: `src/view/note-ops.ts:180-221` - batch helper structure to mirror for the new preference-respecting path
  - Test: `src/view/note-ops.test.ts:146-209` - existing partial-failure assertions for trash/delete batch helpers
  - External: `https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Reference/TypeScript%20API/FileManager/trashFile.md` - official Obsidian contract for preference-respecting deletion
  - External: `https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Reference/TypeScript%20API/Vault/delete.md` - permanent delete contract to avoid for the merged bulk action

  **Acceptance Criteria**:
  - [ ] Tests fail before implementation because the new helper/path does not yet exist or still calls the wrong API.
  - [ ] The RED test asserts `fileManager.trashFile` is called once per file in order.
  - [ ] The RED test asserts `vault.delete` is not called for the new merged bulk-delete helper.
  - [ ] The RED test covers partial failure while continuing remaining files.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: RED test demands FileManager.trashFile for merged delete path
    Tool: Bash
    Steps: Run `npx vitest run src/view/note-ops.test.ts -t "uses fileManager.trashFile for preference-respecting batch delete"`
    Expected: Test is red before implementation, then passes after Task 3.
    Evidence: .sisyphus/evidence/task-2-delete-helper-red.txt

  Scenario: partial failure contract is explicit in RED test
    Tool: Bash
    Steps: Run `npx vitest run src/view/note-ops.test.ts -t "continues remaining files when one preference-respecting delete fails"`
    Expected: Test is red before implementation, then passes after Task 3.
    Evidence: .sisyphus/evidence/task-2-delete-helper-red-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/note-ops.test.ts`

- [x] 3. Implement preference-respecting bulk delete helper

  **What to do**: Add a new dedicated single-file + batch helper in `src/view/note-ops.ts` for the merged bulk delete UI path. Recommended names: `deleteFileUsingObsidianPreference(...)` and `batchDeleteFilesUsingObsidianPreference(...)`. Those helpers must call `app.fileManager.trashFile(file)` and return the existing `NoteOpResult`/`BatchOpSummary` shape. Leave `deleteFile(...)` and `batchDeleteFiles(...)` untouched unless removing them is proven safe by zero references. Keep merge cleanup using `batchTrashFiles(...)` unchanged.
  **Must NOT do**: Do not rewrite merge cleanup to use the new helper; do not change `batchTrashFiles(...)` semantics.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: focused helper implementation after RED tests
  - Skills: `[]`
  - Omitted: `obsidian-plugin-docs` - API decision already settled

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 5 | Blocked By: 1, 2

  **References**:
  - Pattern: `src/view/note-ops.ts:67-94` - existing single-file helper shape and typed result handling
  - Pattern: `src/view/note-ops.ts:182-221` - existing batch helper loop and summary accumulation
  - Pattern: `src/view/FolderCardView.ts:2130-2153` - merge cleanup still intentionally uses `batchTrashFiles(...)`
  - Test: `src/view/note-ops.test.ts:146-209` - partial-failure assertions to preserve
  - External: `https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Reference/TypeScript%20API/FileManager/trashFile.md` - target API contract

  **Acceptance Criteria**:
  - [ ] New helper(s) call `app.fileManager.trashFile(file)` and return typed summaries consistent with existing helpers.
  - [ ] `npx vitest run src/view/note-ops.test.ts` exits `0`.
  - [ ] No existing merge-related tests fail because merge cleanup still uses `batchTrashFiles(...)`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: merged bulk delete helper uses Obsidian preference-respecting API
    Tool: Bash
    Steps: Run `npx vitest run src/view/note-ops.test.ts -t "uses fileManager.trashFile for preference-respecting batch delete"`
    Expected: Pass; `fileManager.trashFile` is called for each file and `vault.delete` is not.
    Evidence: .sisyphus/evidence/task-3-delete-helper.txt

  Scenario: failure on one file does not stop later files
    Tool: Bash
    Steps: Run `npx vitest run src/view/note-ops.test.ts -t "continues remaining files when one preference-respecting delete fails"`
    Expected: Pass; succeeded + failed summaries match the exact failing path order.
    Evidence: .sisyphus/evidence/task-3-delete-helper-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/note-ops.ts`, `src/view/note-ops.test.ts`

- [x] 4. Write RED tests for single bulk delete UI/runtime path

  **What to do**: Update `src/view/Toolbar.svelte.test.ts`, `src/view/card-context-actions.test.ts`, and any directly coupled type/fixture tests so they fail until the UI/runtime exposes exactly one destructive bulk action. Assert removal of `bulk-trash-selected`, `canBulkTrashSelected`, and trash-specific confirmation copy from the bulk toolbar path. Keep confirmation behavior mandatory.
  **Must NOT do**: Do not implement the runtime/UI changes in this task; do not relax confirmation requirements.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: coordinated RED changes across several existing tests
  - Skills: `[]`
  - Omitted: `review-work` - final verification wave handles review later

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5 | Blocked By: 1

  **References**:
  - Pattern: `src/view/Toolbar.svelte:167-175` - current dual destructive actions to collapse
  - Pattern: `src/view/FolderCardView.ts:500-553` - current toolbar action routing with separate trash/delete handlers
  - Pattern: `src/view/FolderCardView.ts:1941-2061` - current shared destructive confirmation pipeline
  - Pattern: `src/view/FolderCardView.ts:2173-2184` - current bulk capability flags including `canBulkTrashSelected`
  - Test: `src/view/Toolbar.svelte.test.ts:495-514` - current expected 7 buttons and dual destructive tooltips/icons
  - Test: `src/view/card-context-actions.test.ts:2271-2447` - current bulk trash/delete workflow coverage

  **Acceptance Criteria**:
  - [ ] RED tests require toolbar bulk buttons to drop from 7 to 6 total controls (5 action buttons + exit bulk mode).
  - [ ] RED tests require the only destructive action tooltip to be `Delete selected`.
  - [ ] RED tests require confirmation title/message/button text to reference delete semantics that follow Obsidian preferences, not permanent deletion.
  - [ ] RED tests require stale-selection reconciliation to remain intact.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: toolbar RED test removes trash action from the bulk strip
    Tool: Bash
    Steps: Run `npx vitest run src/view/Toolbar.svelte.test.ts -t "renders only one destructive bulk action"`
    Expected: Test is red before implementation, then passes after Task 5.
    Evidence: .sisyphus/evidence/task-4-toolbar-red.txt

  Scenario: runtime RED test requires Obsidian-preference delete confirmation flow
    Tool: Bash
    Steps: Run `npx vitest run src/view/card-context-actions.test.ts -t "bulk delete uses Obsidian preference-respecting confirmation and reconciles stale selection"`
    Expected: Test is red before implementation, then passes after Task 5.
    Evidence: .sisyphus/evidence/task-4-toolbar-red-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/Toolbar.svelte.test.ts`, `src/view/card-context-actions.test.ts`

- [x] 5. Implement single bulk delete toolbar/runtime consolidation

  **What to do**: Remove the bulk trash action from toolbar state, panel state, and runtime branching. Keep the action id `bulk-delete-selected` to minimize churn. Rewire `bulkDeleteSelected()` so it uses the new preference-respecting helper from Task 3. Replace the current permanent-delete confirmation copy with exact text:
  - title: `Delete selected notes?`
  - button: `Delete`
  - body: `Delete {count} selected note(s)? Obsidian will use your Files & Links delete preference.`
  Update notices to use `Deleted` / `delete` wording while preserving existing partial-failure reconciliation behavior.
  **Must NOT do**: Do not keep `bulk-trash-selected` as a hidden alias; do not use `Delete permanently` copy.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: coordinated runtime/UI refactor across TS + Svelte state
  - Skills: `[]`
  - Omitted: `frontend-ui-ux` - this is behavior/state work, not visual redesign

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: none | Blocked By: 1, 3, 4

  **References**:
  - Pattern: `src/view/Toolbar.svelte:167-175` - bulk action list to shrink
  - Pattern: `src/view/FolderCardPanel.svelte:107-117` and `src/view/FolderCardPanel.svelte:174-183` - panel state properties that currently include trash capability
  - Pattern: `src/view/panel-model.ts:22-31` - panel contract to simplify
  - Pattern: `src/view/FolderCardView.ts:1941-2061` - confirmation/reconcile/notice flow to preserve while swapping semantics
  - Pattern: `src/view/FolderCardView.ts:2173-2184` - bulk runtime flags to remove `canBulkTrashSelected`
  - Test: `src/view/Toolbar.svelte.test.ts:495-514` - expected button list and icons
  - Test: `src/view/card-context-actions.test.ts:2349-2447` - stale-selection and confirmation-denied behavior to keep

  **Acceptance Criteria**:
  - [ ] `Toolbar.svelte` exposes exactly one destructive bulk action.
  - [ ] `PanelModelState`, `BulkRuntimePanelState`, and related state propagation no longer include `canBulkTrashSelected`.
  - [ ] `FolderCardView.handleToolbarAction(...)` no longer branches on `bulk-trash-selected`.
  - [ ] `bulkDeleteSelected()` uses Task 3’s helper and exact confirmation copy.
  - [ ] `npx vitest run src/view/Toolbar.svelte.test.ts src/view/card-context-actions.test.ts` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: toolbar renders one destructive action and no trash action
    Tool: Bash
    Steps: Run `npx vitest run src/view/Toolbar.svelte.test.ts -t "renders only one destructive bulk action"`
    Expected: Pass; tooltip list contains `Delete selected` and does not contain `Trash selected`.
    Evidence: .sisyphus/evidence/task-5-toolbar-runtime.txt

  Scenario: stale selection is reconciled before confirmed delete flow
    Tool: Bash
    Steps: Run `npx vitest run src/view/card-context-actions.test.ts -t "bulk delete uses Obsidian preference-respecting confirmation and reconciles stale selection"`
    Expected: Pass; modal copy matches the exact delete wording and stale selections are trimmed before success/failure notices.
    Evidence: .sisyphus/evidence/task-5-toolbar-runtime-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/Toolbar.svelte`, `src/view/FolderCardPanel.svelte`, `src/view/panel-model.ts`, `src/view/types.ts`, `src/view/FolderCardView.ts`, `src/view/Toolbar.svelte.test.ts`, `src/view/card-context-actions.test.ts`

- [x] 6. Write RED tests for supported-file cards, placeholder previews, search fallback, and empty-state copy

  **What to do**: Add RED coverage across `src/view/card-context-actions.test.ts`, `src/view/CardItem.svelte.test.ts`, `src/view/FolderCardPanel.svelte.test.ts`, `src/view/pipeline.test.ts`, and if needed `src/view/FolderCardView.test.ts`, to require: supported-file collection beyond markdown, exact placeholder text for non-markdown cards, title-only search fallback for non-markdown cards, icon metadata on card records/rendering, and the new empty-state copy.
  **Must NOT do**: Do not implement runtime behavior in this task; do not let placeholder copy become the search content.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: coordinated RED work across runtime, Svelte, and pipeline tests
  - Skills: `[]`
  - Omitted: `playwright` - browser automation is unnecessary for this repo-level TDD scope

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 7, 8 | Blocked By: 1

  **References**:
  - Pattern: `src/view/FolderCardView.ts:1138-1181` - current markdown-only collection logic to replace
  - Pattern: `src/view/FolderCardView.ts:1477-1507` - current markdown-only hydration path to short-circuit for non-markdown cards
  - Pattern: `src/main.ts:437-452` and `src/main.ts:702-713` - markdown-only search/index and mutation semantics that must be updated only as needed
  - Pattern: `src/view/pipeline.ts:53-79` - fallback search behavior where non-markdown cards must remain title-searchable only
  - Pattern: `src/view/CardItem.svelte:257-295` - current header/preview rendering logic
  - Pattern: `src/view/FolderCardPanel.svelte:547-550` - current markdown-specific empty-state copy
  - Test: `src/view/FolderCardPanel.svelte.test.ts:74-111` - empty-state + populated render structure
  - Test: `src/view/CardItem.svelte.test.ts:250-285` - current title/preview highlight assertions
  - Test: `src/view/pipeline.test.ts:44-56` - simple `NoteCardRecord` fixture shape used in search pipeline tests
  - Test: `src/view/card-context-actions.test.ts:2625-3374` - incremental mutation coverage to extend for new card kinds

  **Acceptance Criteria**:
  - [ ] RED tests require `.base`, `.canvas`, `.excalidraw`, and `.excalidraw.md` cards to be included while `image.png` remains excluded.
  - [ ] RED tests require exact placeholder text strings for non-markdown cards.
  - [ ] RED tests require non-markdown cards to skip the generic `No previewable text near the top.` fallback.
  - [ ] RED tests require empty-state copy to become `No supported files found in this folder.`
  - [ ] RED tests require non-markdown cards to match title search only, not placeholder text.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: RED test demands supported file kinds and new empty-state copy
    Tool: Bash
    Steps: Run `npx vitest run src/view/FolderCardPanel.svelte.test.ts src/view/card-context-actions.test.ts -t "supports base canvas and excalidraw cards"`
    Expected: Test is red before implementation, then passes after Task 7.
    Evidence: .sisyphus/evidence/task-6-supported-files-red.txt

  Scenario: RED test blocks placeholder text from becoming searchable content
    Tool: Bash
    Steps: Run `npx vitest run src/view/pipeline.test.ts src/view/CardItem.svelte.test.ts -t "non-markdown cards remain title-searchable only"`
    Expected: Test is red before implementation, then passes after Tasks 7-8.
    Evidence: .sisyphus/evidence/task-6-supported-files-red-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/card-context-actions.test.ts`, `src/view/CardItem.svelte.test.ts`, `src/view/FolderCardPanel.svelte.test.ts`, `src/view/pipeline.test.ts`, `src/view/FolderCardView.test.ts`

- [x] 7. Implement supported-file collection, placeholder hydration, incremental refresh, and search behavior

  **What to do**: Replace markdown-only card eligibility with the shared resolver from Task 1. Rename `collectMarkdownFiles(...)` to `collectSupportedFiles(...)`. When building or inserting `NoteCardRecord`s, populate `fileKind` and keep `title: file.basename` unchanged. In `hydrateCard(...)`, short-circuit non-markdown kinds so they never call `cachedRead(...)`; instead set `previewHtml` to `<p class="fce-preview-placeholder">{exact placeholder}</p>`, set card-level `previewMode` to `placeholder`, leave `excerpt` empty, and mark the card hydrated. For `markdown` cards, keep the existing `buildLightPreview(...)` path. Update vault mutation handling to use `event.fileKind` plus `resolveCardFileKindFromPath(event.oldPath)` so supported non-markdown create/modify/delete/rename events update incrementally. In `main.ts`, keep indexed search document bodies markdown-only, but use the shared file-kind resolver so `.excalidraw.md` is excluded from markdown indexing and so vault mutation events carry `fileKind`. In `pipeline.ts`, when `orderedPaths !== null`, preserve indexed markdown ordering and append title-matching non-markdown cards not already included in the current sorted card order; do not use placeholder text as cached content.
  **Must NOT do**: Do not read non-markdown files for previews; do not expand search indexing to body-search `.base`, `.canvas`, or `excalidraw` cards.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: cross-cutting runtime changes spanning view, pipeline, main, and tests
  - Skills: `[]`
  - Omitted: `refactor` - the change is bounded enough for direct implementation

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 8 | Blocked By: 1, 6

  **References**:
  - Pattern: `src/view/FolderCardView.ts:1022-1036` - base card-record construction path
  - Pattern: `src/view/FolderCardView.ts:1138-1181` - current markdown-only collection function to generalize
  - Pattern: `src/view/FolderCardView.ts:1277-1298` and `src/view/FolderCardView.ts:1396-1415` - incremental insert paths that must populate `fileKind`
  - Pattern: `src/view/FolderCardView.ts:1477-1507` - hydration path to short-circuit for non-markdown cards
  - Pattern: `src/view/FolderCardView.ts:1071-1088` and `src/view/FolderCardView.ts:1230-1238` - markdown-only vault-event gates to replace
  - Pattern: `src/main.ts:437-452` - markdown-only search document source that must keep plain markdown only
  - Pattern: `src/main.ts:702-713` - vault mutation event builder to switch to `fileKind`
  - Pattern: `src/view/pipeline.ts:53-79` - search filter behavior to extend for non-markdown title matches
  - Test: `src/view/card-context-actions.test.ts:2625-3374` - rename/create/delete incremental expectations to preserve and extend
  - Test: `src/view/pipeline.test.ts:44-56` - card fixture updates needed for `fileKind`

  **Acceptance Criteria**:
  - [ ] Supported card collection includes `notes/doc.md`, `boards/schema.base`, `boards/map.canvas`, `sketches/idea.excalidraw`, and `sketches/idea.excalidraw.md`, but excludes `media/image.png`.
  - [ ] Non-markdown cards hydrate without `cachedRead(...)`.
  - [ ] `previewMode: "placeholder"` is used for non-markdown cards and `excerpt` stays empty.
  - [ ] Incremental create/modify/delete/rename flows handle supported non-markdown cards without falling back unnecessarily.
  - [ ] Indexed search remains markdown-body-driven, but non-markdown title matches still appear when a query is active.
  - [ ] `npx vitest run src/view/card-context-actions.test.ts src/view/pipeline.test.ts src/view/FolderCardPanel.svelte.test.ts src/view/FolderCardView.test.ts` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: supported files become cards without reading non-markdown bodies
    Tool: Bash
    Steps: Run `npx vitest run src/view/card-context-actions.test.ts -t "supports base canvas and excalidraw cards without non-markdown cachedRead"`
    Expected: Pass; supported files become cards, unsupported files do not, and non-markdown previews use exact placeholder copy.
    Evidence: .sisyphus/evidence/task-7-supported-files.txt

  Scenario: active search still finds non-markdown cards by title only
    Tool: Bash
    Steps: Run `npx vitest run src/view/pipeline.test.ts -t "appends title-matching non-markdown cards when indexed markdown results exist"`
    Expected: Pass; matching `.base/.canvas/.excalidraw` titles appear, but placeholder words alone do not make cards searchable.
    Evidence: .sisyphus/evidence/task-7-supported-files-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/FolderCardView.ts`, `src/view/types.ts`, `src/view/pipeline.ts`, `src/main.ts`, `src/view/file-kind.ts`, `src/view/card-context-actions.test.ts`, `src/view/pipeline.test.ts`, `src/view/FolderCardPanel.svelte.test.ts`, `src/view/FolderCardView.test.ts`

- [x] 8. Implement file-type icon rendering and finalize card/panel UI coverage

  **What to do**: Update `src/view/CardItem.svelte` so the header action cluster always renders a decorative file-type icon element first: `<span class="fce-card-file-icon" aria-hidden="true" data-file-kind={card.fileKind} use:applyIcon={...}></span>`. In bulk mode, render `file-type icon + checkbox`; outside bulk mode, render `file-type icon + pin button`. Keep the title text where it is. Update preview rendering so `previewMode === "empty"` keeps the generic empty message, while `previewMode === "placeholder"` renders the exact placeholder HTML. Add the minimum CSS in `styles.css` to size and color the new icon without breaking the current pin-button hover/selected behavior. Update tests to assert exact `data-icon` values and the persisted presence of the icon in bulk mode.
  **Must NOT do**: Do not make the file-type icon interactive; do not remove the existing pin button behavior; do not show the generic empty-preview string for placeholder cards.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: small but layout-sensitive Svelte + CSS refinement
  - Skills: `[]`
  - Omitted: `frontend-ui-ux` - not needed for this tightly specified UI adjustment

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: final verification | Blocked By: 1, 6, 7

  **References**:
  - Pattern: `src/view/CardItem.svelte:167-174` - existing `applyIcon(...)` action helper to reuse
  - Pattern: `src/view/CardItem.svelte:257-295` - header action cluster and preview rendering branch to extend
  - Pattern: `styles.css:499-567` - header/action/pin styles to preserve while inserting the file icon
  - Pattern: `styles.css:578-600` - preview/empty state styles where placeholder styling can piggyback
  - Test: `src/view/CardItem.svelte.test.ts:180-248` - top-right slot behavior for bulk checkbox and pin button
  - Test: `src/view/CardItem.svelte.test.ts:250-285` - title and preview assertions to extend for placeholder/icon rendering
  - Test: `src/view/FolderCardPanel.svelte.test.ts:74-111` - populated card rendering in the panel

  **Acceptance Criteria**:
  - [ ] Every rendered card includes `.fce-card-file-icon[data-file-kind]` with the exact mapped `data-icon`.
  - [ ] Bulk mode still shows the checkbox and keeps the file-type icon visible.
  - [ ] Normal mode still shows the pin button and keeps the file-type icon visible.
  - [ ] Placeholder cards render their exact placeholder sentence instead of `No previewable text near the top.`
  - [ ] `npx vitest run src/view/CardItem.svelte.test.ts src/view/FolderCardPanel.svelte.test.ts` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: file-type icons render with exact mappings in normal mode
    Tool: Bash
    Steps: Run `npx vitest run src/view/CardItem.svelte.test.ts -t "renders mapped file-type icons and keeps pin behavior in normal mode"`
    Expected: Pass; markdown/base/canvas/excalidraw cards expose `file-text`, `database`, `layout-dashboard`, and `pen-tool` respectively.
    Evidence: .sisyphus/evidence/task-8-card-icons.txt

  Scenario: bulk mode keeps icon visible while replacing pin with checkbox
    Tool: Bash
    Steps: Run `npx vitest run src/view/CardItem.svelte.test.ts -t "keeps the file-type icon visible in bulk mode while showing the checkbox"`
    Expected: Pass; icon remains present, pin is absent, checkbox works, and placeholder text is rendered for non-markdown cards.
    Evidence: .sisyphus/evidence/task-8-card-icons-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/CardItem.svelte`, `styles.css`, `src/view/CardItem.svelte.test.ts`, `src/view/FolderCardPanel.svelte.test.ts`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- Do **not** create git commits unless the user explicitly asks for them.
- If the user later requests a commit, prefer one final commit after Tasks 1-8 and before F1-F4 rerun.

## Success Criteria
- Bulk mode shows one destructive action only and that action follows Obsidian delete preferences.
- Supported cards include markdown, base, canvas, and excalidraw variants without introducing body previews for non-markdown files.
- File-type icons are visible in the card header action cluster in both normal and bulk modes.
- Empty-state, placeholder copy, and tests all reflect the broadened supported-file scope.
- Type-check, build, and full test suite all pass.
