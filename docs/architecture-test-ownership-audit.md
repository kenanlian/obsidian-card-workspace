# Architecture test ownership audit (V55b)

This tracked audit is the durable evidence for WP-35 / V55b. The original line
numbers refer to the files immediately before their migration. Moving a test was
allowed to change imports, fixtures, and the call entry needed to address the new
owner module; expected values, timing boundaries, and skip/delete status were not
changed.

The pre-migration V55 run recorded **59 files / 950 tests**, all green. The
post-migration V55 run also recorded **59 files / 950 tests**, all green.
`src/view/card-context-actions.test.ts` was deleted only after all 129 tests were
rehomed; no source file imports that deleted test module.

## Migrated describes and test groups

| Original describe or ungrouped group | Original location | Current owner | Assertions changed? |
| --- | --- | --- | --- |
| `FolderCardView card context actions` (parent wrapper) | `src/view/card-context-actions.test.ts:1090` | dissolved; children are mapped below | no |
| `Task 2: Event contract verification via real onOpen() subscriptions` | `src/view/card-context-actions.test.ts:1118` | `src/view/view-event-routing.test.ts` | no |
| `Task 2: Search query coordinator ownership` | `src/view/card-context-actions.test.ts:1335` | `src/view/view-event-routing.test.ts` | no |
| `Task 11: Event contract verification for pin-toggle persistence flow` (including bulk, include-subfolders, sort, select-folder, hydrate, prewarm, and onClose) | `src/view/card-context-actions.test.ts:1568` | `src/view/view-event-routing.test.ts` | no |
| `Task 6: preview settings refresh wiring and generation safety` | `src/view/card-context-actions.test.ts:2355` | `src/view/view-event-routing.test.ts` (still nested under Task 11) | no |
| Menu tests for `openCardContextMenu`, reduced/abort contracts, `routeCardMenuAction`, conditional variants, and destination clicks | `src/view/card-context-actions.test.ts:2685–3201` | `src/view/menus/card-context-menu.test.ts`, under `card context menu contract` | no |
| Tag tests for single tag, bulk add, bulk remove, and bulk-remove noop | `src/view/card-context-actions.test.ts:2836–3086` | `src/view/actions/tag-actions.test.ts`, under `TagActions single and bulk card workflows` | no |
| File tests for copy, move, make-copy, rename, and delete | `src/view/card-context-actions.test.ts:3204–3459` | `src/view/actions/file-actions.test.ts`, under `FileActions card copy/move/rename/delete` | no |
| `batch move workflow` | `src/view/card-context-actions.test.ts:3461` | `src/view/actions/merge-actions.test.ts` | no |
| `bulk delete workflows` | `src/view/card-context-actions.test.ts:3684` | `src/view/actions/merge-actions.test.ts` | no |
| `bulk delete workflows require confirmation` | `src/view/card-context-actions.test.ts:3718` | `src/view/actions/merge-actions.test.ts` | no |
| `merge workflow` | `src/view/card-context-actions.test.ts:3773` | `src/view/actions/merge-actions.test.ts` | no |
| `rename-driven incremental refresh after move` | `src/view/card-context-actions.test.ts:4326` | `src/view/view-event-routing.test.ts` | no |
| `Phase 2 regression hardening` | `src/view/card-context-actions.test.ts:4376` | `src/view/view-event-routing.test.ts` | no |
| `Phase 1 regression hardening` | `src/view/card-context-actions.test.ts:4676` | `src/view/view-event-routing.test.ts` | no |
| `note creation targets` | `src/view/card-context-actions.test.ts:5192` | `src/view/actions/folder-actions.test.ts` | no |
| `card box context menus` | `src/view/card-context-actions.test.ts:5225` | `src/view/actions/box-actions.test.ts` | no |
| `nav context menu wiring` | `src/view/card-context-actions.test.ts:5462` | `src/view/nav-context-menu.test.ts` | no |
| `CardWorkspacePlugin editor drop drag insert` (seven behavior tests) | `src/main.test.ts:597–831` | `src/services/EditorDropController.test.ts`, under `EditorDropController` | no; imports/fixtures and call entry changed to address the extracted controller |

The editor-drop migration is deliberately split at the ownership boundary. The
seven dragover/drop and insertion behaviors moved to
`src/services/EditorDropController.test.ts`. The plugin registration/forwarding
contract remains executable in `src/main.test.ts` under
`CardWorkspacePlugin editor drop registration`: it verifies that the registered
editor-extension dragover/drop handlers and the workspace `editor-drop` event
forward their original arguments to `EditorDropController`. Thus the original
mixed integration describe was moved, while its plugin-assembly seam was retained;
it is incorrect to state that no `main.test.ts` describe moved.

## Intentionally retained host and integration ownership

No describe was moved out of `src/view/FolderCardView.test.ts`. Its retained
describes exercise the jsdom/Svelte host boundary rather than one extracted
module:

| Retained describe | Ownership reason |
| --- | --- |
| `FolderCardView host contract` | View assembly, real jsdom panel mount, cleanup, search debounce, hover, folder-tree, and persistence seams. |
| `FolderCardView graded update intents` | Host-owned dispatch of graded `applyUpdateIntent` behavior. |
| `FolderCardView card box mode` | View assembly across box sorting, pinning, projection, and panel state. |
| `FolderCardView navigation scope activation` | Navigation/scope assembly crossing the panel and action boundary. |

After the editor-drop behavior migration, `src/main.test.ts` retains only plugin
assembly and plugin-owned routing describes: settings update intents, scope/event
bus dispatch, view activation, editor-drop registration, default open destination,
and indexed-search lifecycle.

The following node integration coverage remains intentionally outside a single
owner-module test:

| Location | Cross-module contract |
| --- | --- |
| `src/view/view-event-routing.test.ts` (file-level comment) | `FolderCardView` event routing through the node mock seam across search, hydration, bulk, and scope controllers. |
| `src/view/view-event-routing.test.ts` → `rename-driven incremental refresh after move` | Entry is `view.handleVaultMutation`, so this is broader than `applyIncrementalMutation`. |
| `src/view/view-event-routing.test.ts` → Phase 1 / Phase 2 | Host regressions spanning bulk, merge, projection, and panel events. |
| `src/view/nav-context-menu.test.ts` → folder favorite activation | Panel `favorite-activate` routes into folder scope; tag-favorite unit behavior remains in `FavoriteActions`. |

## Fixture-only migration changes and count reconciliation

- The shared node harness moved to `src/__mocks__/folder-card-view-harness.ts`.
- Consumers import the harness before registering `FolderCardView`, preserving the
  existing Obsidian, Svelte-panel, and mount mocks.
- Each consuming test owns the relative `note-ops` mock needed to intercept its
  production import.
- Formerly ungrouped tests received a destination `describe` name; their bodies and
  expectations were unchanged.

The 129 tests from `card-context-actions.test.ts` reconcile as follows:

| Current owner | Tests |
| --- | ---: |
| `view-event-routing.test.ts` | 73 |
| `actions/file-actions.test.ts` | 15 |
| `actions/tag-actions.test.ts` | 4 |
| `actions/merge-actions.test.ts` | 14 |
| `actions/folder-actions.test.ts` | 3 |
| `actions/box-actions.test.ts` | 9 |
| `menus/card-context-menu.test.ts` | 6 |
| `nav-context-menu.test.ts` | 5 |
| **Total** | **129** |

Together, the migration table, retained-boundary inventory, editor-drop split,
and exact count reconciliation provide the V55b assertion-ownership trail.
