- 2026-04-18 Task 1 hardening: `orderedPaths: null` is explicitly fallback filtering, while `orderedPaths: []` is explicitly indexed-ready zero results; pipeline tests now lock both branches.
- Canonical searchable document shape is contract-locked as `{ path, title, normalizedTitle, content, excerpt, folderPath, mtime, ctime }` and tags remain excluded from indexed fields in Phase 3.
- MiniSearch Phase 3 contract is now frozen in code-facing constant/tests: index `title+content`, store `path+title+excerpt`, lowercase normalization, `prefix:true`, `fuzzy:false`, `combineWith:"AND"`, title/content boost 3:1.
- 2026-04-18 Task 2 harnessing: search-layer tests are fully environment-isolated with memory adapters/stubs and no real IndexedDB or repo fixture dependency.
- Search harnesses now lock per-vault metadata namespace behavior, restore drift/corruption recovery outcomes, manager rebuild escalation semantics, and service candidate-bounded ordered path contract behavior.
- 2026-04-18 Task 3: `IndexStore` persistence now stores one per-vault record in IndexedDB (`folder-card-explorer-search` / `searchIndexes`) as `{ metadata, serializedIndexJson }`, with typed no-throw outcomes for restore/write/clear.
- 2026-04-18 Task 4: `SearchIndexManager` now runs async `IndexStore.restore(...)` + `MiniSearch.loadJSONAsync(...)` and emits explicit `building -> ready` or `building -> rebuild-required` health snapshots.
- Task 4 manager now supports explicit full-build input via `documentSource.readAllDocuments()` and persists rebuilt snapshots through `IndexStore.write(...)` using `toJSON()` payloads.
- Incremental mutation handling now covers create/modify/delete/file rename plus safe folder-prefix rewrite, while unsafe folder rename escalates to `rebuild-required` without silently serving stale paths.
- Mutations arriving during full build are queued and reconciled after build completion, avoiding nested rebuild storms and ensuring deterministic post-build mutation replay.
- 2026-04-18 Task 4 follow-up: persistence control flow now returns explicit success/failure so rebuild and `markRebuilt()` do not emit false `ready` snapshots after `IndexStore.write()` failure.
- 2026-04-18 Task 5: canonical `SearchableDocument` prep now reuses `stripMarkdownToText()` for both full index body (`content`) and clipped search/fallback-compatible `excerpt`, keeping indexed and fallback text normalization aligned.
- Task 5 mutation helpers now classify `create`/`modify`/`delete` directly for markdown files and classify renames explicitly into `file`, `folder-safe-prefix-rewrite`, or `folder-rebuild-required` paths for deterministic manager behavior.
- 2026-04-18 Task 6: `IndexedSearchService` now mirrors manager snapshots, forwards vault mutations, and enforces service-side candidate bounding (including maxCandidatePaths cap) before returning indexed ordering.
- Task 6 query contract is now explicit in tests: ready => `indexed-ordering` with `orderedPaths` array; building/error => fallback-safe `orderedPaths: null`.

- 2026-04-18 Task 7: Host lifecycle now owns indexed search startup (`IndexStore`/`SearchIndexManager`/`IndexedSearchService`), registers command-palette rebuild/recover commands, and keeps a fallback-safe `NoIndexSearchService` path when indexed init fails.

- 2026-04-18 Task 10: `FolderCardPanel.svelte` must pass runtime `searchQuery` through to `CardItem.svelte`; title highlighting is safest as escaped HTML output, while excerpt highlighting can stay scope-tight by decorating existing `previewHtml` text nodes only with `<mark class="fce-search-hit">`.

- 2026-04-18 Task 9: pipeline search projection now explicitly locks `orderedPaths !== null` as authoritative indexed ordering (candidate-bounded by current cards), keeps `orderedPaths: null` fallback filtering in existing sorted-card order, preserves `orderedPaths: []` as explicit zero results, and confirms tag -> search -> pin sequencing with pin reorder affecting only survivors.

- 2026-04-18 Task 11 cleanup: evidence artifacts were added for the already-verified green regression matrix and repo gates (`task-11-search-regression.txt`, `task-11-check.txt`, `task-11-build.txt`, `task-11-test.txt`), with `Toolbar.svelte` accessibility warnings recorded as non-failing warnings.

- 2026-04-18T22:38:58+08:00: Added Task 10 evidence artifacts ( and ) after verification gap discovery, capturing exact 10:38:56 PM [vite-plugin-svelte] no Svelte config found at /home/kenan/Secret-Projects/obsidian-cards-explorer - using default configuration.

[1m[46m RUN [49m[22m [36mv4.0.18 [39m[90m/home/kenan/Secret-Projects/obsidian-cards-explorer[39m

 [32m✓[39m [30m[43m node [49m[39m src/view/row-projection.test.ts [2m([22m[2m5 tests[22m[2m)[22m[32m 3[2mms[22m[39m
 [32m✓[39m [30m[43m node [49m[39m src/view/scroll-anchoring.test.ts [2m([22m[2m14 tests[22m[2m)[22m[32m 5[2mms[22m[39m
 [32m✓[39m [30m[43m node [49m[39m src/view/bulk-selection.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 5[2mms[22m[39m
 [32m✓[39m [30m[43m node [49m[39m src/search/IndexStore.test.ts [2m([22m[2m9 tests[22m[2m)[22m[32m 6[2mms[22m[39m
 [32m✓[39m [30m[43m node [49m[39m src/settings.test.ts [2m([22m[2m28 tests[22m[2m)[22m[32m 10[2mms[22m[39m
 [32m✓[39m [30m[43m node [49m[39m src/view/metadata-utils.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 5[2mms[22m[39m
 [32m✓[39m [30m[43m node [49m[39m src/search/IndexedSearchService.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 11[2mms[22m[39m
 [32m✓[39m [30m[43m node [49m[39m src/FolderCardExplorerSettingTab.test.ts [2m([22m[2m2 tests[22m[2m)[22m[32m 7[2mms[22m[39m
 [32m✓[39m [30m[43m node [49m[39m src/FolderPickerModal.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 17[2mms[22m[39m
 [32m✓[39m [30m[43m node [49m[39m src/view/markdown-utils.test.ts [2m([22m[2m42 tests[22m[2m)[22m[32m 17[2mms[22m[39m
 [32m✓[39m [30m[43m node [49m[39m src/view/note-ops.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 12[2mms[22m[39m
 [32m✓[39m [30m[43m node [49m[39m src/search/SearchIndexManager.test.ts [2m([22m[2m10 tests[22m[2m)[22m[32m 17[2mms[22m[39m
 [32m✓[39m [30m[43m node [49m[39m src/view/pipeline.test.ts [2m([22m[2m40 tests[22m[2m)[22m[32m 18[2mms[22m[39m
 [32m✓[39m [30m[43m node [49m[39m src/main.test.ts [2m([22m[2m8 tests[22m[2m)[22m[32m 14[2mms[22m[39m
 [32m✓[39m [30m[43m node [49m[39m src/view/card-context-actions.test.ts [2m([22m[2m90 tests[22m[2m)[22m[32m 88[2mms[22m[39m
10:38:57 PM [vite-plugin-svelte] src/view/Toolbar.svelte:669:6 Elements with the 'menuitem' interactive role must have a tabindex value
https://svelte.dev/e/a11y_interactive_supports_focus
10:38:57 PM [vite-plugin-svelte] src/view/Toolbar.svelte:669:6 Visible, non-interactive elements with a click event must be accompanied by a keyboard event handler. Consider whether an interactive element such as `<button type="button">` or `<a>` might be more appropriate
https://svelte.dev/e/a11y_click_events_have_key_events
10:38:57 PM [vite-plugin-svelte] src/view/Toolbar.svelte:680:10 Visible, non-interactive elements with a click event must be accompanied by a keyboard event handler. Consider whether an interactive element such as `<button type="button">` or `<a>` might be more appropriate
https://svelte.dev/e/a11y_click_events_have_key_events
10:38:57 PM [vite-plugin-svelte] src/view/Toolbar.svelte:680:10 `<span>` with a click handler must have an ARIA role
https://svelte.dev/e/a11y_no_static_element_interactions
 [32m✓[39m [30m[45m jsdom [49m[39m src/view/CardItem.svelte.test.ts [2m([22m[2m6 tests[22m[2m)[22m[32m 73[2mms[22m[39m
 [32m✓[39m [30m[45m jsdom [49m[39m src/view/Toolbar.svelte.test.ts [2m([22m[2m7 tests[22m[2m)[22m[32m 129[2mms[22m[39m
 [32m✓[39m [30m[45m jsdom [49m[39m src/view/FolderCardPanel.svelte.test.ts [2m([22m[2m1 test[22m[2m)[22m[32m 163[2mms[22m[39m
 [32m✓[39m [30m[45m jsdom [49m[39m src/view/FolderCardView.test.ts [2m([22m[2m4 tests[22m[2m)[22m[32m 241[2mms[22m[39m

[2m Test Files [22m [1m[32m19 passed[39m[22m[90m (19)[39m
[2m      Tests [22m [1m[32m299 passed[39m[22m[90m (299)[39m
[2m   Start at [22m 22:38:56
[2m   Duration [22m 1.44s[2m (transform 4.42s, setup 0ms, import 6.83s, tests 841ms, environment 1.80s)[22m outputs for Toolbar and CardItem tests.

- 2026-04-18T22:39:09+08:00: Added Task 10 evidence artifacts (`.sisyphus/evidence/task-10-toolbar.txt` and `.sisyphus/evidence/task-10-card-highlight.txt`) after verification gap discovery, capturing exact `npx vitest run` outputs for Toolbar and CardItem tests.
- 2026-04-18T22:53:00+08:00 Task 12 fix: `main.ts` now schedules one plugin-owned rebuild when snapshots enter mutation-specific unsafe `rebuild-required` (`Folder rename cannot be safely rewritten; full rebuild required.`), and removed redundant direct `view.onSearchSnapshot(...)` fanout so view delivery stays single-path via `subscribeSearchSnapshots(...)`; `src/main.test.ts` now covers mutation-triggered rebuild scheduling and single-delivery snapshot fanout regression.
- 2026-04-18T23:05:00+08:00 F3 retry learning: this repo has no runnable Obsidian host executable and no local preview/demo harness for manual UI validation, while Playwright bootstrap is also blocked by missing Chrome support, so true plugin manual QA here is environment-dependent, not implementation-dependent.
- 2026-04-18T23:10:00+08:00 F3 waiver: user explicitly said real Obsidian testing was not required and directly requested marking F3 complete without in-app runtime testing.
- 2026-04-18T23:30:00+08:00 Long-term docs were rolled forward from readiness wording to final Phase 3 closure wording: `docs/START_HERE.md`, `docs/architecture.md`, and a new decision record now describe the indexed search runtime as the stable current architecture, while explicitly preserving the user-approved waiver for real Obsidian manual QA.
