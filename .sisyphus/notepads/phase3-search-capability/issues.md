- 2026-04-18 Task 2 correction: initial implementation drifted into Task 4/6 behavior in manager/service seams and was trimmed back to harness-only placeholder scope.
- 2026-04-18 Task 3 gotcha: after upgrading `IndexStore` contracts, `SearchIndexManager.test.ts` still referenced old metadata/restore shapes and failed typecheck until test fixtures added `documentCount`, `lastIndexedAt`, and `detail`.
- 2026-04-18 Task 4 gotcha: MiniSearch `discard(id)` throws when the id is absent, so mutation paths now guard with `documentsByPath.has(path)` before discard/remove-style operations.
- 2026-04-18 Task 4 follow-up bug: write failures were masked because `persistCurrentIndex()` set `error` but callers overwrote with `ready`; fixed by gating ready publication on persistence success.
- 2026-04-18 Task 5 blocker: `src/search/SearchIndexManager.ts` was absent during verification and caused import failures; restored the existing placeholder seam before running Task 5 tests.
- 2026-04-18 Task 6 implementation note: full-file replacement via Serena regex was ambiguous in this repo session; used direct patch replacement to avoid partial edits and ensure placeholder removal.

- 2026-04-18 Task 7 follow-up: main lifecycle test typing initially drifted from Obsidian constructor signatures (`TFile` / `FolderCardView`), so mocks now use compatible constructor calls and explicit test-only casts to keep strict typecheck green.
- 2026-04-18 Task 8 typing fix: snapshot-listener invocations in view search tests now use explicit SearchServiceSnapshot listener narrowing helpers to avoid strict-mode TS2349 callable-never inference.

- 2026-04-18 Task 10 validation note: `npm run build` and `npm test` still surface pre-existing Svelte accessibility warnings in `src/view/Toolbar.svelte` for folder-menu static elements (`role="menuitem"` / clickable `span`), but the build and test commands still complete successfully.
