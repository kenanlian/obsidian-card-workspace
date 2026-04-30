## 2026-04-25T16:28:14.909Z Task: initialization

- `src/view/FolderCardView.ts` is the runtime owner for the card context menu seam: `openCardContextMenu(...)`, `addCardContextMenuItems(...)`, and `routeCardMenuAction(...)` are the main integration points.
- `src/view/card-context-actions.test.ts` is the primary parity/regression harness and already covers menu triggering, routing, and event isolation.
- `src/view/FolderCardPanel.svelte.test.ts` and `src/view/CardItem.svelte.test.ts` already exercise context-menu emission paths from the component seam.
- Official/public guidance supports extending existing Obsidian menus through `workspace.on("file-menu", ...)`, using separators/submenus on `Menu`, and using `registerEvent(...)` for cleanup.
- For desktop-only file actions, use a runtime platform/path guard and lazy Electron shell loading rather than top-level `electron` imports.
- Desktop shell helper should center on path capability + `shell.openPath(...)` / `shell.showItemInFolder(...)` and return failure objects instead of throwing.
- `src/view/card-context-actions.test.ts` now has a submenu-capable `MockMenu`/`MockMenuItem` harness: separators are represented explicitly, submenu attachment keeps nested menus out of top-level `menuInstances`, and the fixture can toggle desktop/path/deletion branches per test.

## 2026-04-26T00:35:41.000Z Task: duplicate helper contract lock

- `src/view/note-ops.ts` already satisfies the duplicate contract shape: same-folder duplication, collision naming, extension preservation, and failure-result wrapping are all handled by the existing helper logic.
- The real gap for Task 2 was coverage in `src/view/note-ops.test.ts`, not production code.
- The test file needed a more flexible `createFile(...)` helper so non-markdown cases like `.canvas` could be exercised without masking extension behavior.

- 2026-04-26T00:37:50Z: Added src/view/desktop-shell.ts with canResolveSystemPath/getSystemPath/openInDefaultApp/showInSystemExplorer. The helper uses Platform.isDesktopApp, checks adapter.getFullPath at runtime, loads Electron shell lazily, and returns { ok: false, error } on failures.
- 2026-04-26T00:37:50Z: Added src/view/desktop-shell.test.ts covering the exact openPath happy path and unavailable-desktop failure path.


## 2026-04-26T00:50:00Z Task: file-mutation menu section (Task 4)

- `FolderCardView.ts` card context actions now include file-mutation routes: `make-copy`, `move`, `rename`, and `delete`, while preserving destination-open routes.
- `Move to…` was replaced with exact label `Move file to...`, and move failures now use file-neutral wording: `Failed to move file: <error>`.
- `Make a copy` re-resolves the live `TFile` from `notePath` and delegates to `duplicateFile(...)`; missing files no-op cleanly.
- Rename uses an in-file `RenameFileModal` titled `Rename file`, prefills `file.name`, and renames using sibling-path construction from the same parent folder.
- Delete flow now prompts with `app.fileManager.promptForDeletion(file)` and only calls `app.fileManager.trashFile(file)` when confirmation is true.

## 2026-04-26T01:09:30Z Task: clipboard section parity (Task 5)

- `FolderCardView.ts` now renders `Copy path` as a parent item with ordered submenu entries: `as Obsidian URL` (`link`), `from vault folder` (`folder`), and conditional `from system root` (`hard-drive`) when `canResolveSystemPath(...)` is true.
- `Copy note content` is now markdown-only via file-kind gating (`resolveCardFileKind(...)` + `isMarkdownCardKind(...)`) and still routes through `copyNoteToClipboard(...)` without behavior replacement.
- Obsidian URL copy uses `obsidian://open?vault=<vault>&file=<path>` with `encodeURIComponent(...)` for both vault name and file path.
- Copy-path notices are now exact and centralized via `copyPathWithNotice(...)`: success (`Copied Obsidian URL`, `Copied vault-relative path`, `Copied system path`) and failure (`Failed to copy path`).

## 2026-04-26T01:20:30Z Task: desktop shell section + file stats modal (Task 6)

- `FolderCardView.ts` now adds desktop-only context actions `Open in default app` (`external-link`) and `Show in system explorer` (`folder-open`) behind `canResolveSystemPath(...)`.
- `FolderCardView.ts` now adds `Check file stats` (`info`) for supported card files and routes it to an in-file `FileStatsModal` titled `File stats`.
- `FileStatsModal` renders deterministic stats ordering via Setting rows: `Path`, `Created`, `Modified`, `Size`, where timestamps are `new Date(file.stat.*).toISOString()` and size is `<N> bytes`.
- Shell actions route through `desktop-shell` helpers once per invocation (`openInDefaultApp`, `showInSystemExplorer`) and map failures to exact notices.
- Shell + stats actions re-resolve the target path and no-op safely when the file is missing at execution time.
## 2026-04-26T01:31:45Z Task: parity matrix closure (Task 7)

- Final parity assertions now validate exact top-level order, icon names, separators, and submenu entries for all required variants: desktop markdown, desktop non-markdown, and non-desktop markdown.
- `FolderCardView.ts` required only minimal runtime adjustment: explicit separators were added in `addCardContextMenuItems(...)` to match the Files-style contract.
- Trigger-mode regression safety remains intact: contextmenu and button trigger paths both still apply the `fce-card-context-menu` class.

## 2026-04-26T01:45:10Z Task: final-wave review fixes (path-resolved visibility)

- Menu visibility for shell-backed actions now requires both desktop capability and per-file concrete system-path resolution (`getSystemPath(...) !== null`), not capability alone.
- `Copy path -> from system root` now follows the same per-file path-resolution gating, so desktop files with `fullPath: null` only expose the two portable submenu variants.
- Existing parity contracts (labels/order/icons/separators/trigger class) remain intact; only visibility conditions changed for unavailable system paths.
