# Search-Related Test Coverage and Fallback Blind Spots

## Analysis Date: 2026-04-18

### 1. Pipeline Tests (`src/view/pipeline.test.ts`)

**Currently tested:**
- `runPipeline` chaining, empty input, identity with DEFAULT_PIPELINE_STEPS (lines 46-91)
- `applyTagFilter` with AND semantics, empty tags, tag passing, order preservation (lines 97-237)
- `applyPinReorder` with empty input, no pins, pin ordering, relative order, non-bypass semantics, duplicate pins (lines 264-495)
- `DEFAULT_PIPELINE_STEPS` ordering: tag → search → pin (lines 501-516)

**Search filter blind spots:**
- `applySearchFilter` is tested ONLY as a pass-through stub (lines 243-258). Two tests confirm it returns cards unchanged, including when `includeSubfolders` changes. This is the **primary blind spot** — no test validates actual search filtering behavior.
- No test for: empty query restoring full projection, title matching, content matching, pinned cards filtered out by search before pin reorder, interaction between search and tag filters.
- The `PipelineContext` type (line 6-9) has no `searchQuery` field. The context only carries `app` and `settings`, so there is no typed seam for passing search state into the pipeline.

### 2. Metadata Utils (`src/view/metadata-utils.ts`)

**`matchesSearchQuery` function (lines 105-125):**
- Empty/whitespace query returns `true` (pass-through) — line 110-112
- Title matching: case-insensitive substring on `file.basename` — line 115
- Content matching: only if `cachedContent` is provided; falls back to `false` if not — lines 120-124
- **No test file exists** (`metadata-utils.test.ts` does not exist). This is a **critical gap** — the core fallback search function has zero direct test coverage.

**`matchesTagFilter` function (lines 56-63):**
- Tested indirectly through `pipeline.test.ts` mocks, but has no direct unit tests either.

**`getFileTags` and `collectAllTags` (lines 15-47):**
- No direct tests. These are used by `matchesTagFilter` and by `FolderCardView.deriveAvailableTags()`.

### 3. Toolbar Tests (`src/view/Toolbar.svelte.test.ts`)

**Currently tested (lines 137-251):**
- Filter-change event emission with normalized tags (line 150-169)
- Sort-change event emission (lines 171-189)
- Include-subfolders-change, folder selection, and toolbar actions (lines 191-219)
- Menu cleanup on unmount (lines 221-250)

**Search-related blind spots:**
- **No search query input/change/reset events are tested** — there is no `onSearchChange`, `onSearchQueryChange`, or `onSearchReset` callback in the Toolbar props interface (lines 26-50 of `Toolbar.svelte`).
- **No search status rendering** — the Toolbar has no search input UI, no search status indicator, and no search-related props.
- The `ToolbarProps` interface (lines 26-50 of `Toolbar.svelte`) has no search-related fields at all.

### 4. Card Context Actions Tests (`src/view/card-context-actions.test.ts`)

**Currently tested (lines 551-2084):**
- Event contract verification: open-note, card-context-menu, filter-change, pin-toggle, include-subfolders-change, sort-change, select-folder, toolbar-action, hydrate-range (lines 564-1326)
- Bulk mode state machine, selection, shift-range (lines 946-1066)
- Preview settings refresh and generation safety (lines 1357-1448+)
- onClose cleanup (lines 1327-1355)

**Search-related blind spots:**
- **No search query event subscription** — the mock panel's `CALLBACK_PROP_TO_EVENT` mapping (lines 31-42 of the mock) has no `onSearchQueryChange` or `onSearchReset` entry.
- **No search status propagation test** — `buildPanelModelState()` (lines 1908-1930 of FolderCardView.ts) pushes no search query or search status to the panel model.
- The `PanelModelState` interface (lines 4-30 of `panel-model.ts`) has no `searchQuery` or `searchStatus` fields.

### 5. Settings Tests (`src/settings.test.ts`)

**Currently tested (lines 1-366):**
- `normalizeSettings` for pinnedPaths, includeSubfolders, lastViewMode, previewLines
- `mergeSettings` for pinnedPaths updates, previewLines, field preservation

**Search-related blind spots:**
- **No search query field in `PluginSettings`** — this is correct per the plan (search must be runtime-only), but there is no test proving that search query is NOT persisted.
- The `PluginSettings` interface (lines 13-27 of `settings.ts`) has no `searchQuery` field, confirming the current boundary is clean.

### 6. Coordinator Ownership (`src/view/FolderCardView.ts`)

**Current state:**
- `FolderCardView` owns `baseCards`, `visibleCards`, `selectedPath`, `bulkMode`, `selectedPaths`, `bulkAnchorPath`, `loading`, `generation`, `pendingHydration`, `inFlight`, `inFlightKey`, `inFlightLoadScope`, `queuedRequest`, `refreshQueued`, `folderPath`, `folderLoadKey`, `lastLoadedIncludeSubfolders` (lines 335-357).
- **No `searchQuery` or `searchStatus` field exists** on the coordinator.
- `deriveVisibleCards()` (lines 1504-1509) calls `runPipeline(this.baseCards, DEFAULT_PIPELINE_STEPS, context)` where context only has `app` and `settings` — no search query.
- `pushState()` (lines 1964-1996) and `buildPanelModelState()` (lines 1908-1930) push no search state to the panel model.

### 7. Panel Model (`src/view/panel-model.ts`)

**Current state:**
- `PanelModelState` (lines 4-30) has no `searchQuery` or `searchStatus` fields.
- The model is a simple observable state container with `mutate()` and `subscribe()`.
- No search-related state flows through this bridge.

### 8. Implicit Runtime-Only State Boundaries

**Proven by existing tests:**
- `card-context-actions.test.ts` proves that `filter-change` (tags) goes through `plugin.saveSettings()` — tags are persisted. This implicitly proves that any runtime-only state (like search query) must NOT go through `saveSettings`.
- `card-context-actions.test.ts` proves that `pin-toggle` also persists through `saveSettings()`.
- `card-context-actions.test.ts` proves that `sort-change` persists through `saveSettings()`.
- `card-context-actions.test.ts` proves that `include-subfolders-change` persists through `saveSettings()`.

**Not yet proven:**
- No test proves that a search query change does NOT persist to settings.
- No test proves that clearing a search query restores the full visible-card projection.
- No test proves that search filtering happens before pin reorder in the pipeline.

### 9. Summary of Gaps by Task Relevance

**Task 1 (Lock search ownership contracts):**
- `PipelineContext` needs a `searchQuery` field (or equivalent) — currently only has `app` and `settings`.
- `PanelModelState` needs `searchQuery` and `searchStatus` fields.
- `ToolbarProps` needs search-related callbacks and props.
- `FolderCardView` needs a `searchQuery` field and a query-change handler.
- The `PluginSettings` type correctly excludes search query — this boundary is clean.

**Task 2 (Add per-view query/status bridge):**
- No search query event exists in the panel mock's `CALLBACK_PROP_TO_EVENT` mapping.
- No search query prop exists in `FolderCardPanel.svelte` or `Toolbar.svelte`.
- No search status model (idle/fallback/ready/building/error) exists anywhere.

**Task 3 (Replace fallback-search blind spots with tests):**
- `metadata-utils.test.ts` does NOT exist — must be created.
- `matchesSearchQuery()` has zero direct tests.
- `applySearchFilter()` in `pipeline.test.ts` only tests pass-through behavior — needs real filtering tests.
- No test proves: empty query restores full projection, title matching without index, content matching with cached content, pinned non-matches filtered before pin reorder.
- `matchesTagFilter()` also has no direct unit tests (only tested through pipeline mocks).


## Task 3 Verification Note (2026-04-18)

- `npm run check` initially failed due to existing `PanelModelState` contract drift (`searchQuery` and `searchStatus` missing in `FolderCardPanel.svelte.test.ts` fixture and `FolderCardView` panel-state writes).
- Applied minimal support wiring only: populated `searchQuery`/`searchStatus` in those state construction/update paths so typecheck could pass without changing search feature scope.

## Task 6 Notes (2026-04-18)
- No blocking issues found during Task 6 gates.
- Existing build warnings remain non-blocking and unchanged from prior known baseline.

## F2 Issue Resolution (2026-04-18)
- Resolved: plugin-owned search instance leak on initialization failure.
- Root cause was missing `dispose()` call in the `initialize()` catch path after creating/storing service instance.
- Fix keeps lifecycle ownership in `main.ts`, disposes failing instance immediately, and retains fallback-safe `null` service state.
