# Card Context Menu Files Parity

## TL;DR
> **Summary**: Bring the card right-click menu into Files-menu parity for the requested file actions, while keeping the existing card-specific clipboard action under the clearer name `Copy note content`.
> **Deliverables**:
> - Exact card-menu contract for desktop vs non-desktop and markdown vs non-markdown cards
> - `Make a copy`, `Move file to...`, `Copy path` submenu, `Open in default app`, `Show in system explorer`, `Check file stats`, `Rename...`, and `Delete`
> - Icon mapping aligned with the official Files menu as closely as public APIs allow
> - TDD coverage for submenu behavior, duplicate/delete flows, desktop shell guards, and modal workflows
> **Effort**: Large
> **Parallel**: YES - 2 waves
> **Critical Path**: 1 → 2 → 4 → 5 → 6 → 7

## Context
### Original Request
- Add the following file actions to the card right-click menu so it matches Obsidian’s official **Files** context menu as closely as practical: `Make a copy`, `Move file to...`, `Copy path` and its submenu actions, `Open in default app`, `Show in system explorer`, `Check file stats`, `Rename...`, `Delete`.
- Keep action icons aligned with the official Files menu.
- The current card action named `Copy` must be renamed because it copies note content, not file duplicates.
- Screenshot `2026_04_25_22_42_57.jpg` is the UX reference.

### Interview Summary
- Test strategy: **TDD**.
- Parity standard: **behavior parity first**; use public/plugin-safe APIs even if the exact internal Files implementation is not reusable.
- Existing `Copy` action should be renamed to **`Copy note content`**.

### Metis Review (gaps addressed)
- Resolved menu-structure ambiguity by treating the screenshot as the ordering baseline for the **requested subset only**; omitted Files-menu items such as `Bookmark...` and `Merge entire file with...` stay out of scope.
- Resolved platform ambiguity by making shell-backed actions (`Open in default app`, `Show in system explorer`) **desktop-only** and hiding them when the app cannot resolve an absolute filesystem path.
- Resolved `Copy path` ambiguity with these concrete submenu entries:
  - `as Obsidian URL`
  - `from vault folder`
  - `from system root` (desktop/path-capable only)
- Resolved `Check file stats` ambiguity with a plugin-owned modal backed by `TFile.stat`; there is no public built-in file-stats UI API to open directly.
- Resolved non-markdown ambiguity by applying file actions to all supported card-backed `TFile`s, while showing `Copy note content` **only for markdown cards**.

## Work Objectives
### Core Objective
Implement the requested Files-style card context-menu actions with stable, testable routing and no ambiguity about labels, icons, separators, submenu contents, or platform guards.

### Deliverables
- Expanded card-menu action contract in `src/view/FolderCardView.ts`.
- Submenu-capable menu test harness in `src/view/card-context-actions.test.ts`.
- Verified duplication contract in `src/view/note-ops.ts` / `src/view/note-ops.test.ts`.
- New desktop-shell helper module for filesystem-path resolution and Electron shell calls.
- New rename and file-stats modal flows using existing Obsidian `Modal`/`Setting` patterns.
- Final parity regression coverage for desktop/non-desktop and markdown/non-markdown menu variants.

### Definition of Done (verifiable conditions with commands)
- `npx vitest run src/view/note-ops.test.ts src/view/desktop-shell.test.ts src/view/card-context-actions.test.ts`
- `npm run check`
- `npm run build`
- `npm test`
- All commands above exit with code `0`.

### Must Have
- Exact top-level menu order on **desktop markdown cards**:
  1. `Open in new tab`
  2. `Open to the right`
  3. `Open in new window`
  4. separator
  5. `Make a copy`
  6. `Move file to...`
  7. `Copy path` → submenu
  8. `Copy note content`
  9. separator
  10. `Open in default app`
  11. `Show in system explorer`
  12. `Check file stats`
  13. separator
  14. `Rename...`
  15. `Delete`
- Exact top-level menu order on **desktop non-markdown cards**: same as above, but omit `Copy note content` and close separators cleanly.
- Exact top-level menu order on **non-desktop markdown cards**: omit `Open in default app` and `Show in system explorer`; `Copy path` submenu omits `from system root`.
- `Copy path` submenu labels and icons:
  - `as Obsidian URL` → `link`
  - `from vault folder` → `folder`
  - `from system root` → `hard-drive`
- Exact icon mapping for top-level items:
  - `Make a copy` → `copy`
  - `Move file to...` → `folder-input`
  - `Copy path` → `clipboard`
  - `Copy note content` → `documents`
  - `Open in default app` → `external-link`
  - `Show in system explorer` → `folder-open`
  - `Check file stats` → `info`
  - `Rename...` → `pencil`
  - `Delete` → `trash`
- `Copy note content` keeps its existing title+body clipboard behavior via `copyNoteToClipboard(...)`, but only appears for markdown cards.
- `Make a copy` uses `duplicateFile(...)` and keeps the file in the same folder with ` copy` / ` copy N` naming.
- `Move file to...` keeps using `FolderPickerModal` and `moveFile(...)`, but its label becomes `Move file to...` and failure notice wording becomes file-neutral.
- `Delete` uses `app.fileManager.promptForDeletion(file)` and only calls `app.fileManager.trashFile(file)` when confirmed.
- `Rename...` opens a custom modal titled `Rename file` with a single text input prefilled with `file.name`.
- `Check file stats` opens a custom modal titled `File stats` with these fields in order:
  - `Path: <file.path>`
  - `Created: <ISO string>`
  - `Modified: <ISO string>`
  - `Size: <N> bytes`
- `Copy path` success notices are exact:
  - `Copied Obsidian URL`
  - `Copied vault-relative path`
  - `Copied system path`
- New failure notices are exact:
  - `Failed to make a copy: <error>`
  - `Failed to move file: <error>`
  - `Failed to rename file: <error>`
  - `Failed to delete file: <error>`
  - `Failed to open file in default app: <error>`
  - `Failed to show file in system explorer: <error>`
  - `Failed to copy path`

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Do **not** add unrequested Files-menu items such as `Bookmark...`, `Merge entire file with...`, or `Open in Float Preview`.
- Do **not** refactor the toolbar, bulk actions, or unrelated panel contracts.
- Do **not** add top-level `electron` imports; load Electron shell lazily inside desktop-only helpers.
- Do **not** show shell-backed actions when the plugin cannot derive an absolute filesystem path.
- Do **not** leave doubled/trailing separators after conditional menu items are omitted.
- Do **not** rename `Copy note content` into a file-action label or let it appear on non-markdown cards.
- Do **not** replace `app.fileManager.renameFile(...)` with raw vault renames for user-facing rename/move flows.
- Do **not** use locale-dependent date formatting in file-stats assertions; use deterministic ISO strings.
- Do **not** add success notices for duplicate/move/rename/delete/shell actions unless a failing test proves user feedback is required.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: **TDD** with Vitest (`node` + `jsdom` projects in `vitest.config.ts:8-42`)
- QA policy: Every task includes happy-path and failure/edge scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.txt`

## Execution Strategy
### Parallel Execution Waves
> Target: maximize parallel work before `FolderCardView.ts` integration; serialize same-file menu wiring later.

Wave 1: foundations that can proceed largely in parallel
- Task 1 — submenu/separator/platform-aware test harness
- Task 2 — duplication helper contract
- Task 3 — desktop shell/path helper module

Wave 2: serialized `FolderCardView.ts` integration
- Task 4 — file mutation actions (`Make a copy`, `Move file to...`, `Rename...`, `Delete`)
- Task 5 — clipboard actions (`Copy path`, `Copy note content`)
- Task 6 — desktop shell actions + file stats modal
- Task 7 — final parity matrix + regression cleanup

### Dependency Matrix (full, all tasks)
- 1 blocks 4, 5, 6, 7
- 2 blocks 4
- 3 blocks 5, 6
- 4 blocks 5, 6, 7
- 5 blocks 7
- 6 blocks 7
- 7 blocks final verification wave

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 3 tasks → `quick`, `unspecified-low`
- Wave 2 → 4 tasks → `quick`, `unspecified-low`, `unspecified-high`

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Upgrade the card context-menu test harness for separators, submenus, and platform toggles

  **What to do**: Update `src/view/card-context-actions.test.ts` so its mock menu layer can represent the real Files-style contract that this feature needs. Add `MockMenu.addSeparator()`, submenu support on `MockMenuItem` via `setSubmenu()`, and a stable way to inspect nested menu structure without breaking the existing `menuInstances` top-level assertions. Extend the local Obsidian mock surface used by this test so desktop-path availability and `fileManager.promptForDeletion(...)` can be controlled explicitly per test case. Keep the existing helpers (`clickLatestModalButton`, `setLatestModalTextInput`, `flushAsyncWork`) intact and extend them only where new modal flows require it.
  **Must NOT do**: Do not introduce a generic reusable mock framework outside this test file; do not let submenu construction inflate the top-level `menuInstances` count; do not weaken current assertions around `fce-card-context-menu` DOM class handling.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: one test file, tightly scoped harness enhancement
  - Skills: `[]`
  - Omitted: `obsidian-plugin-docs` - API research is already complete

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4, 5, 6, 7 | Blocked By: none

  **References**:
  - Pattern: `src/view/card-context-actions.test.ts:138-176` - current flat `MockMenu` / `MockMenuItem` structure to extend
  - Pattern: `src/view/card-context-actions.test.ts:203-342` - current modal/setting mock patterns to reuse for rename and stats dialogs
  - Pattern: `src/view/card-context-actions.test.ts:1921-2065` - current menu-contract and copy-route assertions to preserve while expanding
  - Pattern: `src/view/card-context-actions.test.ts:2067-2149` - current move workflow coverage that should stay green after relabeling to file wording
  - External: `https://docs.obsidian.md/Plugins/User%20interface#context-menus` - menu API baseline

  **Acceptance Criteria** (agent-executable only):
  - [ ] The mock menu supports `addSeparator()` and `setSubmenu()` well enough for exact top-level and nested-label assertions.
  - [ ] Submenu menus do not create false positives in top-level `menuInstances` count assertions.
  - [ ] Tests can explicitly toggle desktop path support and deletion confirmation outcomes.
  - [ ] Existing `openCardContextMenu` trigger tests still pass after the harness upgrade.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: submenu-capable harness supports Files-style contract assertions
    Tool: Bash
    Steps: Run `npx vitest run src/view/card-context-actions.test.ts -t "supports separators and submenu inspection for the card context menu"`
    Expected: Vitest passes; the test can assert top-level separators plus nested submenu titles without breaking existing menu-instance tracking.
    Evidence: .sisyphus/evidence/task-1-menu-harness.txt

  Scenario: existing trigger behavior survives harness expansion
    Tool: Bash
    Steps: Run `npx vitest run src/view/card-context-actions.test.ts -t "openCardContextMenu shows the shared menu with destination items for contextmenu trigger"`
    Expected: Vitest passes; top-level menu rendering still uses `showAtMouseEvent(...)` and applies `fce-card-context-menu`.
    Evidence: .sisyphus/evidence/task-1-menu-harness-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/card-context-actions.test.ts`

- [x] 2. Lock the duplication helper contract used by `Make a copy`

  **What to do**: Extend `src/view/note-ops.test.ts` to cover `duplicateFile(...)` explicitly, then tighten or adjust `src/view/note-ops.ts` only if the new tests expose a real gap. The tests must prove that duplicates stay in the same parent folder, use ` copy` / ` copy N` naming, preserve extensions, and return the standard `NoteOpResult` shape on success/failure. Add at least one non-markdown example such as `.canvas` so the helper is verified for all supported card-backed files, not only markdown.
  **Must NOT do**: Do not move duplicate logic into `FolderCardView.ts`; do not change `moveFile(...)`, `trashFile(...)`, or `deleteFileUsingObsidianPreference(...)` unless duplicate-helper tests prove a shared bug.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: focused helper contract work in one TS module and one test file
  - Skills: `[]`
  - Omitted: `git-master` - no git operation requested

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4 | Blocked By: none

  **References**:
  - Pattern: `src/view/note-ops.ts:46-130` - existing move/delete/trash/duplicate helper cluster
  - Pattern: `src/view/note-ops.ts:115-130` - current `duplicateFile(...)` implementation
  - Pattern: `src/view/note-ops.test.ts:95-105` - test file factory for constructing `TFile` fixtures
  - Pattern: `src/view/note-ops.test.ts:228-352` - current result-shape and partial-failure assertion style
  - External: `https://docs.obsidian.md/Plugins/Vault` - vault create/read/copy semantics baseline

  **Acceptance Criteria** (agent-executable only):
  - [ ] `duplicateFile(...)` is directly covered by unit tests.
  - [ ] A collision case proves the helper creates ` copy N` names instead of overwriting.
  - [ ] A non-markdown example proves extension preservation.
  - [ ] Failure cases return `{ ok: false, error, path }` without throwing.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: duplicateFile creates same-folder copies with unique names
    Tool: Bash
    Steps: Run `npx vitest run src/view/note-ops.test.ts -t "duplicateFile creates a same-folder copy and resolves name collisions"`
    Expected: Vitest passes; the helper creates `copy` / `copy 1` names and never overwrites an existing file.
    Evidence: .sisyphus/evidence/task-2-duplicate-helper.txt

  Scenario: duplicateFile keeps non-markdown extensions and returns failures cleanly
    Tool: Bash
    Steps: Run `npx vitest run src/view/note-ops.test.ts -t "duplicateFile preserves non-markdown extensions and returns a failure result on create errors"`
    Expected: Vitest passes; `.canvas` or equivalent keeps its extension and thrown errors become `{ ok: false, ... }`.
    Evidence: .sisyphus/evidence/task-2-duplicate-helper-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/note-ops.ts`, `src/view/note-ops.test.ts`

- [x] 3. Add a desktop-shell helper module for absolute-path resolution and Electron shell calls

  **What to do**: Create `src/view/desktop-shell.ts` and `src/view/desktop-shell.test.ts` to isolate all desktop-only path and shell behavior. The module must expose a small, explicit API only for this feature: `canResolveSystemPath(app)`, `getSystemPath(app, filePath)`, `openInDefaultApp(app, filePath)`, and `showInSystemExplorer(app, filePath)`. Use `Platform.isDesktopApp` plus a runtime guard for `app.vault.adapter.getFullPath(...)` to determine path capability. Load Electron shell lazily inside the helper (not at module top-level), and return `{ ok: false, error }` on failures instead of throwing.
  **Must NOT do**: Do not add top-level `import "electron"`; do not expose a generic shell wrapper unrelated to these two actions; do not hardcode vault root paths.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: small new helper module with pure node-side tests
  - Skills: `[]`
  - Omitted: `obsidian-plugin-docs` - the API decision is already settled

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5, 6 | Blocked By: none

  **References**:
  - Pattern: `esbuild.config.mjs:7-17` - `electron` is already externalized and must stay lazily loaded
  - Pattern: `src/main.ts:205-213` - existing desktop-only guard style for `Open in new window`
  - External: `https://www.electronjs.org/docs/latest/api/shell` - `shell.openPath(...)` / `shell.showItemInFolder(...)`
  - External: `https://docs.obsidian.md/Reference/TypeScript+API/FileSystemAdapter` - public absolute-path adapter API

  **Acceptance Criteria** (agent-executable only):
  - [ ] Non-desktop or adapter-without-`getFullPath` returns `false` / `null` from the path-capability helpers.
  - [ ] Desktop-capable resolution returns the absolute filesystem path for a vault-relative file path.
  - [ ] `openInDefaultApp(...)` calls `shell.openPath(...)` exactly once with the resolved absolute path.
  - [ ] `showInSystemExplorer(...)` calls `shell.showItemInFolder(...)` exactly once with the resolved absolute path.
  - [ ] Helper failures return `{ ok: false, error }` and do not throw into callers.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: desktop helper resolves an absolute path and opens the file in the OS default app
    Tool: Bash
    Steps: Run `npx vitest run src/view/desktop-shell.test.ts -t "openInDefaultApp resolves the system path and calls shell.openPath"`
    Expected: Vitest passes; the test proves desktop guard success and exact `shell.openPath(...)` invocation.
    Evidence: .sisyphus/evidence/task-3-desktop-shell.txt

  Scenario: desktop helper fails gracefully when shell/path support is unavailable
    Tool: Bash
    Steps: Run `npx vitest run src/view/desktop-shell.test.ts -t "returns a failure result when desktop shell support is unavailable"`
    Expected: Vitest passes; helper returns `{ ok: false, ... }` and no unhandled throw occurs.
    Evidence: .sisyphus/evidence/task-3-desktop-shell-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/desktop-shell.ts`, `src/view/desktop-shell.test.ts`

- [x] 4. Implement the file-mutation section of the card menu

  **What to do**: Expand `src/view/FolderCardView.ts` so the card context menu and route layer support `Make a copy`, `Move file to...`, `Rename...`, and `Delete`. Keep menu construction local to `FolderCardView`, but split it into small private helpers inside the same file if needed to keep the larger Files-style contract readable. Rename the existing menu label `Move to…` to exact text `Move file to...`. Reuse `duplicateFile(...)` for `Make a copy`, keep `FolderPickerModal` for move, add a new `RenameFileModal` class in `FolderCardView.ts` for `Rename...`, and use `app.fileManager.promptForDeletion(file)` followed by `app.fileManager.trashFile(file)` for `Delete`. Update move failure wording from note-specific to file-specific.
  **Must NOT do**: Do not replace `FolderPickerModal`; do not use `vault.delete(...)` for the requested delete action; do not implement rename as inline DOM editing inside the card.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: medium complexity flow work concentrated in one runtime file plus tests
  - Skills: `[]`
  - Omitted: `frontend-ui-ux` - this is behavior parity, not a visual redesign

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 5, 6, 7 | Blocked By: 1, 2

  **References**:
  - Pattern: `src/view/FolderCardView.ts:810-849` - current menu opening logic that must remain stable
  - Pattern: `src/view/FolderCardView.ts:896-1002` - current menu item registration, route dispatch, copy, and move flow seams to extend
  - Pattern: `src/FolderPickerModal.ts:45-80` - existing folder-picker contract to keep for move
  - Pattern: `src/view/note-ops.ts:46-130` - existing move, duplicate, and delete helper contracts
  - Pattern: `src/view/FolderCardView.ts:67-127` - existing modal style via `BulkActionConfirmModal`
  - Test: `src/view/card-context-actions.test.ts:2067-2149` - current move tests to preserve while adjusting menu text and failure wording
  - External: `https://docs.obsidian.md/Reference/TypeScript+API/FileManager` - rename/trash/prompt-deletion API surface

  **Acceptance Criteria** (agent-executable only):
  - [ ] `CardMenuAction` expands to cover `make-copy`, `move`, `rename`, and `delete` without breaking existing open-destination routes.
  - [ ] `Make a copy` re-resolves the live file from `notePath`, no-ops when missing, and calls `duplicateFile(...)` exactly once when present.
  - [ ] `Move file to...` keeps `FolderPickerModal` behavior but uses exact label `Move file to...` and exact failure notice `Failed to move file: <error>`.
  - [ ] `Rename...` opens a modal titled `Rename file`, pre-populates `file.name`, and calls `app.fileManager.renameFile(...)` with a sibling path built from the same parent folder.
  - [ ] `Delete` prompts first, only calls `trashFile(...)` when confirmed, and no-ops cleanly when the file is missing or the prompt is cancelled.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Make a copy and rename routes operate on the clicked file only
    Tool: Bash
    Steps: Run `npx vitest run src/view/card-context-actions.test.ts -t "make-copy and rename routes re-resolve the clicked file and call the expected helpers exactly once"`
    Expected: Vitest passes; duplicate and rename flows act on the clicked card file, not stale state.
    Evidence: .sisyphus/evidence/task-4-file-mutations.txt

  Scenario: delete respects confirmation and move failure uses file wording
    Tool: Bash
    Steps: Run `npx vitest run src/view/card-context-actions.test.ts -t "delete prompts before trashing and move failures use file-neutral notices"`
    Expected: Vitest passes; cancelled deletion is a no-op and move failures show `Failed to move file: ...`.
    Evidence: .sisyphus/evidence/task-4-file-mutations-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/FolderCardView.ts`, `src/view/card-context-actions.test.ts`

- [x] 5. Implement the clipboard section: `Copy path` submenu and markdown-only `Copy note content`

  **What to do**: Add the `Copy path` parent item and its child routes into `src/view/FolderCardView.ts`, then rename the existing `Copy` action to exact label `Copy note content`. Build `obsidian://open?vault=<vault>&file=<path>` using `this.app.vault.getName()` plus `encodeURIComponent(...)`, copy `file.path` for the vault-relative variant, and use the new desktop-shell helper to resolve the `from system root` variant. Only include `from system root` when `canResolveSystemPath(this.app)` is true. Only include `Copy note content` when `fileKind === "markdown"` for the target card. On any copy-path clipboard failure, show exact notice `Failed to copy path`; on success, use the exact success notices from the Must Have section.
  **Must NOT do**: Do not replace `copyNoteToClipboard(...)` with path-copy logic; do not show `Copy note content` on `.base`, `.canvas`, or `.excalidraw` cards; do not add a markdown-link submenu entry because it was not requested.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: route wiring plus conditional menu structure in one runtime file
  - Skills: `[]`
  - Omitted: `obsidian-plugin-docs` - clipboard/path decisions are already made

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 7 | Blocked By: 1, 3, 4

  **References**:
  - Pattern: `src/view/FolderCardView.ts:944-964` - current `copy` route and `copyCardNote(...)` seam to rename, not replace
  - Pattern: `src/view/note-ops.ts:152-164` - existing content-copy behavior that remains the implementation for `Copy note content`
  - Pattern: `src/view/file-kind.ts:3-28` - current file-kind contract used to gate markdown-only menu items
  - Pattern: `src/view/CardItem.svelte:297-340` - card file-kind is already part of card UI state and should align with route gating
  - External: `https://docs.obsidian.md/Reference/TypeScript+API/Vault/getName` - vault name for Obsidian URL construction
  - External: `https://docs.obsidian.md/Reference/TypeScript+API/FileManager` - file-path and link-related API background

  **Acceptance Criteria** (agent-executable only):
  - [ ] Top-level parent item `Copy path` exists with exact child entries and child icons in the required order.
  - [ ] `Copy note content` replaces the old `Copy` label and only appears for markdown cards.
  - [ ] Desktop-capable menus include `from system root`; non-desktop menus omit it without leaving bad separators.
  - [ ] Obsidian URL generation percent-encodes the vault name and file path.
  - [ ] Copy-path success/failure notices use the exact required strings.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: desktop markdown cards expose the full Copy path submenu plus Copy note content
    Tool: Bash
    Steps: Run `npx vitest run src/view/card-context-actions.test.ts -t "desktop markdown cards render Copy path with all variants and Copy note content"`
    Expected: Vitest passes; submenu labels/icons and markdown-only content-copy visibility match the plan exactly.
    Evidence: .sisyphus/evidence/task-5-copy-path.txt

  Scenario: non-desktop and non-markdown cards hide unsupported copy variants
    Tool: Bash
    Steps: Run `npx vitest run src/view/card-context-actions.test.ts -t "non-desktop and non-markdown cards omit unsupported copy actions cleanly"`
    Expected: Vitest passes; `from system root` and `Copy note content` disappear in the appropriate variants without corrupting menu structure.
    Evidence: .sisyphus/evidence/task-5-copy-path-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/FolderCardView.ts`, `src/view/card-context-actions.test.ts`, `src/view/desktop-shell.ts`

- [x] 6. Implement the desktop shell section and the `Check file stats` modal

  **What to do**: Add `Open in default app`, `Show in system explorer`, and `Check file stats` into `src/view/FolderCardView.ts` using the exact labels and icons defined above. `Open in default app` and `Show in system explorer` must use the new desktop-shell helper and appear only when `canResolveSystemPath(this.app)` is true. Add a `FileStatsModal` class inside `FolderCardView.ts` using the same Obsidian `Modal`/`Setting` style already used elsewhere in the file. The stats modal must render deterministic ISO timestamps derived from `file.stat.ctime` / `file.stat.mtime`, plus exact byte count.
  **Must NOT do**: Do not attempt to open a non-public built-in stats view; do not show shell actions on platforms without desktop path support; do not use locale-sensitive timestamp strings in assertions.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: focused route/modal work with one new helper dependency
  - Skills: `[]`
  - Omitted: `frontend-ui-ux` - this is modal behavior parity, not bespoke design

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 7 | Blocked By: 1, 3, 4

  **References**:
  - Pattern: `src/view/FolderCardView.ts:67-127` - in-file modal conventions to mirror
  - Pattern: `src/main.ts:205-213` - existing desktop-only runtime pattern to keep consistent with new shell notices
  - Pattern: `src/view/card-context-actions.test.ts:535-554` - reusable modal button/text-input helpers; extend for stats assertions rather than inventing a new harness
  - Pattern: `src/view/card-context-actions.test.ts:2525-2543` - modal title/content assertion style already used in this repo
  - External: `https://www.electronjs.org/docs/latest/api/shell` - shell APIs used behind the helper
  - External: `https://docs.obsidian.md/Reference/TypeScript+API/FileStats` - public stats fields

  **Acceptance Criteria** (agent-executable only):
  - [ ] Desktop-capable menus include `Open in default app` and `Show in system explorer`; non-desktop menus omit them.
  - [ ] Shell routes call the desktop-shell helper exactly once and map helper failures to the required notices.
  - [ ] `Check file stats` opens a modal titled `File stats` with exact field order and ISO timestamp formatting.
  - [ ] Stats and shell routes no-op cleanly when the target file disappears before execution.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: shell-backed menu actions call the desktop helper only when supported
    Tool: Bash
    Steps: Run `npx vitest run src/view/card-context-actions.test.ts src/view/desktop-shell.test.ts -t "desktop shell actions are visible only when system-path resolution is available"`
    Expected: Vitest passes; unsupported environments omit the actions and supported ones call the desktop-shell helper exactly once.
    Evidence: .sisyphus/evidence/task-6-shell-actions.txt

  Scenario: file stats modal shows deterministic data and shell failures surface exact notices
    Tool: Bash
    Steps: Run `npx vitest run src/view/card-context-actions.test.ts -t "file stats modal renders ISO timestamps and shell failures map to exact notices"`
    Expected: Vitest passes; modal content is deterministic and shell failures use the exact configured strings.
    Evidence: .sisyphus/evidence/task-6-shell-actions-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/FolderCardView.ts`, `src/view/card-context-actions.test.ts`, `src/view/desktop-shell.ts`, `src/view/desktop-shell.test.ts`

- [x] 7. Finalize the full menu parity matrix and clean up remaining route regressions

  **What to do**: Finish `src/view/card-context-actions.test.ts` so the menu contract is asserted end-to-end for the full parity matrix: desktop markdown, desktop non-markdown, and non-desktop markdown. Add exact assertions for top-level order, icon names, separator placement, submenu structure, and conditional omission of unsupported items. Then make only the minimum code changes needed to bring `FolderCardView.ts`, `desktop-shell.ts`, and any touched helpers to green. Keep this task focused on parity closure rather than adding new features.
  **Must NOT do**: Do not broaden scope into UI redesign or unrelated runtime cleanup; do not leave tests proving only a subset of labels or icons when the plan requires exact full-contract assertions.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: parity closure and regression cleanup across a small touched set
  - Skills: `[]`
  - Omitted: `review-work` - formal review happens in the final verification wave

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: final verification wave | Blocked By: 1, 4, 5, 6

  **References**:
  - Pattern: `src/view/card-context-actions.test.ts:1921-2043` - current menu-contract assertion block to replace with the full matrix
  - Pattern: `src/view/card-context-actions.test.ts:2046-2149` - current route-coverage style for single-action behavior assertions
  - Pattern: `src/view/FolderCardView.ts:810-849` - menu trigger handling that must remain unchanged after parity expansion
  - Pattern: `src/view/FolderCardView.ts:1240-1284` - supported-card collection already includes non-markdown cards and must align with menu gating logic

  **Acceptance Criteria** (agent-executable only):
  - [ ] A desktop-markdown regression test asserts the full top-level label/icon/separator contract exactly.
  - [ ] A desktop-non-markdown regression test proves `Copy note content` is omitted while other file actions remain.
  - [ ] A non-desktop regression test proves shell actions and `from system root` are omitted without broken separators.
  - [ ] Both contextmenu-triggered and button-triggered opening still apply the `fce-card-context-menu` class.
  - [ ] `npx vitest run src/view/note-ops.test.ts src/view/desktop-shell.test.ts src/view/card-context-actions.test.ts` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: desktop markdown parity contract is exact
    Tool: Bash
    Steps: Run `npx vitest run src/view/card-context-actions.test.ts -t "desktop markdown cards render the full Files-style menu contract exactly"`
    Expected: Vitest passes; labels, icons, separators, submenu entries, and card-specific `Copy note content` all match the plan exactly.
    Evidence: .sisyphus/evidence/task-7-parity-matrix.txt

  Scenario: non-desktop and non-markdown variants stay tidy
    Tool: Bash
    Steps: Run `npx vitest run src/view/card-context-actions.test.ts -t "conditional menu variants omit unsupported items without leaving malformed separators"`
    Expected: Vitest passes; unsupported actions disappear cleanly and both trigger modes still work.
    Evidence: .sisyphus/evidence/task-7-parity-matrix-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/FolderCardView.ts`, `src/view/card-context-actions.test.ts`, `src/view/desktop-shell.ts`, `src/view/desktop-shell.test.ts`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
4 review tasks run in PARALLEL. ALL must pass. Present consolidated results to user and get explicit "okay" before completing.

Do NOT auto-proceed after verification. Wait for the user's explicit approval before marking work complete.
Never mark F1-F4 as checked before getting the user's okay. Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

Shared touched-file scope for F1-F4:
- `src/view/FolderCardView.ts`
- `src/view/card-context-actions.test.ts`
- `src/view/note-ops.ts`
- `src/view/note-ops.test.ts`
- `src/view/desktop-shell.ts`
- `src/view/desktop-shell.test.ts`

- [x] F1. Plan Compliance Audit

  **What to do**: Run a plan-vs-implementation audit with `oracle` against the touched files and verify every acceptance criterion from Tasks 1-7, including exact menu labels/order/separators/icons, `Copy path` submenu entries, exact notice strings, markdown-only `Copy note content` gating, desktop-only shell-action visibility, and deterministic `File stats` modal fields.
  **Must NOT do**: Do not approve partial parity; do not ignore any mismatch in labels, icon IDs, separators, submenu entries, or conditional visibility rules.

  **Recommended Agent Profile**:
  - Category: `oracle` - Reason: strict correctness audit against the plan contract
  - Skills: `[]`
  - Omitted: `review-work` - this is one targeted audit, not the multi-agent review skill

  **Parallelization**: Can Parallel: YES | Final Wave | Blocks: user approval | Blocked By: Tasks 1-7

  **References**:
  - Plan: `.sisyphus/plans/card-context-menu-files-parity.md` - source of truth for all contract checks
  - Pattern: `src/view/FolderCardView.ts` - runtime menu construction and route handling
  - Pattern: `src/view/card-context-actions.test.ts` - automated parity contract assertions

  **Acceptance Criteria**:
  - [ ] Reviewer returns `APPROVE`.
  - [ ] Reviewer reports zero unmet Task 1-7 acceptance criteria.
  - [ ] Reviewer cites file-specific evidence for all checks.

  **QA Scenarios**:
  ```
  Scenario: oracle verifies the final implementation against the plan contract
    Tool: task(subagent_type="oracle")
    Steps: Run `task(subagent_type="oracle", load_skills=[], run_in_background=false, prompt="Audit the implementation against .sisyphus/plans/card-context-menu-files-parity.md. Verify every Task 1-7 acceptance criterion, exact menu labels/order/separators/icons, Copy path submenu entries, exact notices, markdown-only Copy note content gating, desktop-only shell-action visibility, and deterministic File stats modal fields. Return only APPROVE or REJECT, followed by file-specific evidence and the unmet criteria list.")`
    Expected: Response starts with `APPROVE` and lists no unmet criteria.
    Evidence: .sisyphus/evidence/f1-plan-compliance.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: review only

- [x] F2. Code Quality Review

  **What to do**: Run a high-effort code-quality review over the touched files. Check strict typing, stale-file guards, lazy Electron loading, modal cleanup, route clarity, duplication avoidance, and test quality. Reject any implementation that matches behavior but violates repo patterns or leaves brittle tests.
  **Must NOT do**: Do not approve implementations with vague test assertions, top-level Electron imports, missing guard clauses, or unnecessary refactors outside the plan scope.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: hands-on code quality and maintainability review
  - Skills: `[]`
  - Omitted: `oracle` - plan compliance is already handled by F1

  **Parallelization**: Can Parallel: YES | Final Wave | Blocks: user approval | Blocked By: Tasks 1-7

  **References**:
  - Pattern: `AGENTS.md` - repo style, strict typing, and architectural boundaries
  - Pattern: `src/view/FolderCardView.ts:810-1002` - runtime menu and modal patterns
  - Pattern: `src/view/note-ops.ts:46-164` - helper result-shape and guard style

  **Acceptance Criteria**:
  - [ ] Reviewer returns `APPROVE`.
  - [ ] Reviewer reports no high-severity code-quality findings.
  - [ ] Reviewer confirms tests assert exact labels/icons/separators/notices rather than vague presence checks.

  **QA Scenarios**:
  ```
  Scenario: high-effort reviewer checks maintainability and repo-pattern compliance
    Tool: task(category="unspecified-high")
    Steps: Run `task(category="unspecified-high", load_skills=[], run_in_background=false, prompt="Review the touched files for code quality and maintainability. Check strict typing, stale-file guards, lazy Electron loading, modal cleanup, route clarity, duplication avoidance, test quality, and adherence to existing repo patterns. Return only APPROVE or REJECT, then list file-specific issues ordered by severity.")`
    Expected: Response starts with `APPROVE` and contains no high-severity findings.
    Evidence: .sisyphus/evidence/f2-code-quality.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: review only

- [x] F3. Automated Validation Run

  **What to do**: Execute the targeted parity tests and the required repo-wide validation commands. Capture each command result in the evidence files and fail this task if any command exits non-zero.
  **Must NOT do**: Do not skip failing commands; do not treat partial test success as a pass.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: disciplined validation execution and evidence capture
  - Skills: `[]`
  - Omitted: `playwright` - browser automation is not applicable to this Obsidian plugin test path unless a separate harness exists

  **Parallelization**: Can Parallel: YES | Final Wave | Blocks: user approval | Blocked By: Tasks 1-7

  **References**:
  - Pattern: `vitest.config.ts:8-42` - test project layout
  - Pattern: `AGENTS.md` - required final validation commands

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/view/note-ops.test.ts src/view/desktop-shell.test.ts src/view/card-context-actions.test.ts` exits `0`.
  - [ ] `npm run check` exits `0`.
  - [ ] `npm run build` exits `0`.
  - [ ] `npm test` exits `0`.

  **QA Scenarios**:
  ```
  Scenario: targeted parity tests all pass
    Tool: Bash
    Steps: Run `npx vitest run src/view/note-ops.test.ts src/view/desktop-shell.test.ts src/view/card-context-actions.test.ts`
    Expected: Command exits `0`.
    Evidence: .sisyphus/evidence/f3-targeted-tests.txt

  Scenario: repository-wide required validations all pass
    Tool: Bash
    Steps: Run `npm run check && npm run build && npm test`
    Expected: Combined command exits `0`.
    Evidence: .sisyphus/evidence/f3-repo-validation.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: validation only

- [x] F4. Scope Fidelity Check

  **What to do**: Run a scope audit that compares the final implementation to the original user request and this plan’s `Must NOT Have` boundaries. Confirm that only the requested Files-style actions were added, `Copy` was renamed to `Copy note content`, no unrelated toolbar/bulk/UI redesign work landed, and platform/file-kind gating matches the plan.
  **Must NOT do**: Do not approve implementations that add extra Files-menu items, alter bulk-action behavior, or broaden the scope beyond the requested card context-menu parity work.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: careful scope-diff analysis across request, plan, and touched files
  - Skills: `[]`
  - Omitted: `oracle` - detailed plan-contract compliance is already covered by F1

  **Parallelization**: Can Parallel: YES | Final Wave | Blocks: user approval | Blocked By: Tasks 1-7

  **References**:
  - Plan: `.sisyphus/plans/card-context-menu-files-parity.md` - original request and Must NOT Have boundaries
  - Pattern: `src/view/FolderCardView.ts` - main implementation scope surface
  - Pattern: `src/view/card-context-actions.test.ts` - regression proof of intended scope

  **Acceptance Criteria**:
  - [ ] Reviewer returns `APPROVE`.
  - [ ] Reviewer reports an empty out-of-scope delta.
  - [ ] Reviewer confirms no extra Files-menu items, bulk-action changes, or unrelated UI redesigns were introduced.

  **QA Scenarios**:
  ```
  Scenario: deep reviewer confirms the diff stays inside the approved scope
    Tool: task(category="deep")
    Steps: Run `task(category="deep", load_skills=[], run_in_background=false, prompt="Compare the final implementation against the original user request and the plan scope boundaries. Confirm that only the requested Files-style actions were added, that Copy was renamed to Copy note content, that no unrelated toolbar/bulk/UI redesign work was introduced, and that platform/file-kind gating matches the plan. Return only APPROVE or REJECT, followed by a concise in-scope/out-of-scope delta report.")`
    Expected: Response starts with `APPROVE` and reports an empty out-of-scope delta.
    Evidence: .sisyphus/evidence/f4-scope-fidelity.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: review only

Wave completion rule:
- F1-F4 must all pass before results are presented.
- Any `REJECT` / `FAIL` sends work back to implementation with the reviewer findings attached.
- After fixes, re-run the entire F1-F4 wave; do not rerun only a subset.

## Commit Strategy
- Do **not** create commits unless the user explicitly requests them.
- If the user later requests a commit, make one final commit after Tasks 1-7 and the mandatory validation commands all pass.
- Recommended commit message if requested: `feat(card-menu): add Files-style file actions to card context menu`

## Success Criteria
- The card right-click menu exposes every requested Files-style action with the exact labels, order, separators, submenu entries, and icon mapping defined in this plan.
- `Copy note content` is clearly distinguished from file duplication and only appears on markdown cards.
- Desktop-only actions are hidden when system-path resolution is unavailable.
- Duplication, move, rename, delete, clipboard, shell, and file-stats flows all have targeted automated coverage.
- `npm run check`, `npm run build`, and `npm test` all pass after implementation.
