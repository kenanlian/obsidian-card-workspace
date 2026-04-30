## 2026-04-25T16:28:14.909Z Task: initialization

- Background exploration returned stale reminders from a previous completed plan; ignore those completion-gate instructions for `card-open-modes-and-preview` and use the current selected plan only.
- Existing `boulder.json` pointed at a completed plan and had to be reset before starting this plan.
- Additional background exploration (`bg_e6a57f40`, `bg_e8e8352b`) is still pending; reuse their findings instead of duplicating codebase/doc searches.
- The submenu harness needed an explicit separator kind plus submenu attachment bookkeeping; otherwise the nested menu showed up as an extra top-level menu instance and broke count assertions.

## 2026-04-26T00:35:41.000Z Task: duplicate helper contract lock

- No production gap was found in `duplicateFile(...)`; the helper already returned `{ ok: false, error, path }` on errors and preserved extension-sensitive naming.


## 2026-04-26T00:50:00Z Task: file-mutation menu section (Task 4)

- No blockers encountered; existing submenu-capable menu harness and modal helpers were sufficient for route-level mutation assertions.

## 2026-04-26T01:09:30Z Task: clipboard section parity (Task 5)

- Initial insertion accidentally split `routeCardMenuAction(...)` while adding submenu helpers; fixed by replacing the full `addCardContextMenuItems(...)` + route block atomically and re-running diagnostics.
- Full-suite `npm test` exposed an existing dynamic-import fragility for `desktop-shell.ts` under jsdom import analysis; adjusted lazy loading to `import(/* @vite-ignore */ moduleName)` to keep lazy Electron loading while preserving testability.

## 2026-04-26T01:20:30Z Task: desktop shell section + file stats modal (Task 6)

- Initial type errors in `card-context-actions.test.ts` came from helper return typing (`findMenuItemByTitle`) and direct `file.stat` access on `MockTFile`; fixed by widening helper return type and reading stats through a local casted `fileStats` object.
- No runtime blockers remained after those test typing fixes.
## 2026-04-26T01:31:45Z Task: parity matrix closure (Task 7)

- Targeted suite initially failed because a legacy contextmenu assertion still expected separator-less structure after the runtime parity fix.
- Resolved by updating that single legacy assertion to include the three required separator positions; no additional runtime changes were needed.

## 2026-04-26T01:45:10Z Task: final-wave review fixes (path-resolved visibility)

- After enforcing per-file visibility gating, one legacy expectation in `copy path failures use exact failure notice` still expected a failure notice from the now-omitted `from system root` entry in desktop `fullPath: null` mode.
- Resolved by updating that assertion to verify omission behavior (no shell items, no system-root submenu entry) and no additional notice emission.
