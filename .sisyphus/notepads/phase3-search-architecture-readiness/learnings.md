
## Task 1 Analysis: Search Ownership Model & Typed Contract Boundaries

### 1. PipelineContext — Current Shape & Unsafe Cast

**File**: `src/view/pipeline.ts:6-9`

```typescript
export interface PipelineContext {
  app: App;
  settings: PluginSettings;
}
```

**Critical finding**: `PipelineContext` currently carries only `app` and `settings`. It does NOT include any search query, search status, or explicit pinned-paths field. The `applyPinReorder` step accesses `pinnedPaths` via an **unsafe cast** at line 54:

```typescript
const pinnedPaths = (context.settings as unknown as { pinnedPaths?: string[] }).pinnedPaths;
```

This cast exists because `PluginSettings` (in `src/settings.ts:13-27`) declares `pinnedPaths: string[]` as a top-level field, but `PipelineContext` only types `settings` as `PluginSettings` — so the cast is technically unnecessary but reveals that the pipeline step is reaching through settings to get runtime projection data. This is the exact seam that needs hardening: `PipelineContext` should carry `pinnedPaths` as an explicit, typed input rather than relying on a settings cast.

**No search query field exists** in `PipelineContext` or `PluginSettings`. Search query is entirely absent from the current type contracts.

### 2. applySearchFilter — Pass-Through Stub

**File**: `src/view/pipeline.ts:41-44`

```typescript
/** Search filter step — pass-through until Task 22/27 implement search. */
export function applySearchFilter(cards: NoteCardRecord[], _context: PipelineContext): NoteCardRecord[] {
  return cards;
}
```

This is a pure pass-through. It receives `PipelineContext` but ignores it entirely. The underscore-prefixed `_context` parameter signals it's unused. The `DEFAULT_PIPELINE_STEPS` array at line 78-82 places it between `applyTagFilter` and `applyPinReorder`, which is the correct order for the tag → search → pin reorder pipeline.

**Test coverage**: `src/view/pipeline.test.ts:243-258` — only tests that it returns cards unchanged (identity) and that it stays pass-through when `includeSubfolders` changes. No real search behavior is tested.

### 3. matchesSearchQuery — Exists But Not Wired

**File**: `src/view/metadata-utils.ts:93-125`

```typescript
export function matchesSearchQuery(
  file: TFile,
  query: string,
  cachedContent: string | null = null,
): boolean {
  if (!query || query.trim().length === 0) return true;
  const normalizedQuery = query.toLowerCase().trim();
  const titleMatch = file.basename.toLowerCase().includes(normalizedQuery);
  if (titleMatch) return true;
  if (cachedContent !== null) return cachedContent.toLowerCase().includes(normalizedQuery);
  return false;
}
```

This function exists but is **never called** from the pipeline or any other runtime path. It has **no direct unit tests**. The function signature takes a `TFile` and optional `cachedContent`, which means the pipeline would need to provide both the card's file reference and optionally hydrated content to use it. This is the natural candidate for the fallback search implementation inside `applySearchFilter`.

### 4. FolderCardView — Runtime Coordinator Responsibilities

**File**: `src/view/FolderCardView.ts`

The view class holds these runtime state fields (lines 335-357):

- `folderPath: string | null` — current folder
- `folderLoadKey: string | null` — serialization of load scope
- `baseCards: NoteCardRecord[]` — unfiltered cards
- `visibleCards: NoteCardRecord[]` — pipeline output
- `selectedPath: string | null` — single selection
- `bulkMode: boolean` — bulk mode toggle
- `selectedPaths: Set<string>` — bulk selection
- `bulkAnchorPath: string | null` — range anchor
- `loading: boolean` — loading state
- `generation: number` — stale-result protection
- `pendingHydration: Set<string>` — hydration tracking
- `requestSeq: number` — request serialization
- `inFlight/inFlightKey/inFlightLoadScope` — request dedup
- `queuedRequest: FolderSelectionRequest | null` — request queue
- `refreshQueued: boolean` — refresh dedup

**No search query state exists** in the view. The `deriveVisibleCards()` method at line 1504-1509 constructs a `PipelineContext` and runs the pipeline:

```typescript
private deriveVisibleCards(): NoteCardRecord[] {
  const context: PipelineContext = {
    app: this.app,
    settings: this.plugin.getSettings(),
  };
  return runPipeline(this.baseCards, DEFAULT_PIPELINE_STEPS, context);
}
```

This is the single projection path. Search query would need to flow into this context.

### 5. pushState() — Panel State Bridge

**File**: `src/view/FolderCardView.ts:1964-1996`

`pushState()` calls `deriveVisibleCards()`, then `reconcileBulkSelectionToVisibleCards()`, then `panelModel.mutate(...)` with a full state snapshot. The state pushed includes:

- `cards`, `folderPath`, `selectedPath`
- Bulk state: `bulkMode`, `selectedPaths`, `selectedCount`, `bulkAnchorPath`, `canBulk*`
- `loading`, `generation`
- Settings-derived: `sortField`, `sortDirection`, `activeFilterTags`, `pinnedPaths`, `previewLines`, `includeSubfolders`
- Derived: `availableTags`, `isAllNotesScope`, `tooltipSide`

**No search query or search status field** is pushed through this bridge. The `PanelModelState` interface (in `src/view/panel-model.ts:4-30`) has no search-related fields.

### 6. PanelModelState — Current Shape

**File**: `src/view/panel-model.ts:4-30`

```typescript
export interface PanelModelState {
  cards: NoteCardRecord[];
  folderPath: string;
  selectedPath: string | null;
  loading: boolean;
  generation: number;
  sortField: SortField;
  sortDirection: SortDirection;
  availableTags: string[];
  activeFilterTags: string[];
  pinnedPaths: string[];
  previewLines: number;
  folderTree: FolderTreeNode[];
  includeSubfolders: boolean;
  isAllNotesScope: boolean;
  tooltipSide: "left" | "right";
  bulkMode: boolean;
  selectedPaths: string[];
  selectedCount: number;
  bulkAnchorPath: string | null;
  canBulkSelectAll: boolean;
  canBulkClearSelection: boolean;
  canBulkMoveSelected: boolean;
  canBulkTrashSelected: boolean;
  canBulkDeleteSelected: boolean;
  canBulkMergeSelected: boolean;
}
```

No `searchQuery`, `searchStatus`, or any search-related field. This is the seam that needs extending for Task 2.

### 7. Toolbar.svelte — Current UI Event Surface

**File**: `src/view/Toolbar.svelte`

The `ToolbarProps` interface (lines 26-50) exposes these callbacks:
- `onToolbarAction` — for pick-folder, all-notes, new-note, sort, filter, bulk actions
- `onSortChange` — sort field/direction changes
- `onFilterChange` — tag filter changes
- `onIncludeSubfoldersChange` — subfolder toggle
- `onSelectFolder` — folder tree selection

**No search query input, search change callback, or search status display exists.** The toolbar has no search input field, no search status indicator, and no event emission for search queries.

### 8. FolderCardPanel.svelte — Event Forwarding Seam

**File**: `src/view/FolderCardPanel.svelte:20-77`

The `FolderCardPanelProps` interface defines event forwarding callbacks that match the toolbar's emissions:
- `onOpenNote`, `onBulkSelectCard`, `onCardContextMenu`, `onPinToggle`
- `onToolbarAction`, `onSortChange`, `onFilterChange`, `onIncludeSubfoldersChange`, `onSelectFolder`, `onHydrateRange`

**No search-related event forwarding exists.** This is the seam that needs extending for Task 2.

### 9. main.ts — Plugin Lifecycle Owner

**File**: `src/main.ts`

The plugin class (`FolderCardExplorerPlugin`) owns:
- Settings I/O (`loadSettings`, `saveSettings`, `getSettings`)
- View registration and lifecycle
- Vault observers (create, modify, delete, rename)
- Debounced refresh orchestration
- Selection request dispatch

**No search service, search index, or search lifecycle exists.** The plugin has no `src/search/` directory. No service initialization or disposal hooks exist for search.

### 10. PluginSettings — Persistence Boundary

**File**: `src/settings.ts:13-27`

```typescript
export interface PluginSettings {
  sort: { field: SortField; direction: SortDirection };
  filter: { tags: string[] };
  pinnedPaths: string[];
  includeSubfolders: boolean;
  defaultView: DefaultViewMode;
  previewLines: number;
  lastFolderPath: string | null;
  lastViewMode: ViewMode;
}
```

**No search query field.** This confirms the plan's requirement that search query must remain runtime-only and NOT be persisted into settings. The `filter.tags` field is the closest analog — it IS persisted — but search query must follow a different pattern (runtime-only, per-view).

## Task 4 Learnings: Minimal SearchService Contract Seam

- Added `src/search/types.ts` as a purpose-built seam with explicit `SearchService` lifecycle (`initialize`, `dispose`) plus query and mutation-forwarding contracts.
- Kept the service view-agnostic by requiring runtime callers to pass query/scope/candidate paths per request (`SearchQueryRequest`) rather than storing query text in the service.
- Locked fallback-safe semantics in the contract: `SearchQueryResult.orderedPaths` may be `null`, explicitly signaling callers to keep using local fallback filtering.
- Implemented `NoIndexSearchService` as an adapter that always returns `mode: "no-index"` and `orderedPaths: null`, avoiding any IndexedDB/MiniSearch coupling while still exposing lifecycle-safe state snapshots.

### 11. Unsafe Cast Inventory

The only unsafe cast in the pipeline path is:

**`src/view/pipeline.ts:54`**:
```typescript
const pinnedPaths = (context.settings as unknown as { pinnedPaths?: string[] }).pinnedPaths;
```

This cast is needed because `PipelineContext` doesn't explicitly carry `pinnedPaths` — it reaches through `settings` to get it. The fix for Task 1 is to add `pinnedPaths` as an explicit field on `PipelineContext` (or a dedicated search/pipeline input type), eliminating this cast.

### 12. Ownership Matrix (Current State)

| Responsibility | Current Owner | Notes |
|---|---|---|
| Plugin lifecycle & settings I/O | `main.ts` (`FolderCardExplorerPlugin`) | No search service wiring |
| Per-view runtime coordination | `FolderCardView.ts` | Owns baseCards, visibleCards, selection, generation, hydration |
| Visible-card projection | `pipeline.ts` (`runPipeline` + `DEFAULT_PIPELINE_STEPS`) | Single projection path; search is pass-through |
| Panel state bridge | `panel-model.ts` (`PanelModelState` + `PanelModel`) | No search fields |
| UI event emission | `Toolbar.svelte` | No search input/callbacks |
| UI event forwarding | `FolderCardPanel.svelte` | No search event forwarding |
| Tag filtering | `pipeline.ts:applyTagFilter` → `metadata-utils.ts:matchesTagFilter` | Working, tested |
| Search filtering | `pipeline.ts:applySearchFilter` | Pass-through stub |
| Pin reordering | `pipeline.ts:applyPinReorder` | Working, uses unsafe cast for pinnedPaths |
| Search query matching | `metadata-utils.ts:matchesSearchQuery` | Exists but unwired, untested |
| Settings persistence | `settings.ts` (`PluginSettings`) | No search query field (correct) |

### 13. Duplicate State Risks

- **pinnedPaths**: Currently stored in `PluginSettings` (persisted) AND passed through `PipelineContext.settings` via unsafe cast AND pushed to `PanelModelState.pinnedPaths` for UI rendering. The pipeline reads it from settings; the UI reads it from panel state. No duplication issue per se, but the unsafe cast in the pipeline is a type-safety gap.
- **No search query state exists yet**, so no duplication risk. But Task 2 must ensure search query lives in `FolderCardView` only (not in settings, not as toolbar-local state after mount).

### 14. Key Seams That Need Hardening for Task 1

1. **`PipelineContext` expansion** (`src/view/pipeline.ts:6-9`): Must add explicit `pinnedPaths: string[]` and `searchQuery: string` (or a structured search input) to eliminate the unsafe cast and prepare for real search filtering.

2. **`applySearchFilter` signature** (`src/view/pipeline.ts:42`): Must accept and use the expanded context to implement real fallback search using `matchesSearchQuery`.

3. **`applyPinReorder` unsafe cast elimination** (`src/view/pipeline.ts:54`): Replace `(context.settings as unknown as { pinnedPaths?: string[] }).pinnedPaths` with `context.pinnedPaths`.

4. **`deriveVisibleCards()` context construction** (`src/view/FolderCardView.ts:1504-1509`): Must include search query and pinned paths in the `PipelineContext` it constructs.

5. **`matchesSearchQuery` test gap** (`src/view/metadata-utils.ts:105-125`): No direct unit tests exist. Task 3 will address this.

6. **`PanelModelState` search gap** (`src/view/panel-model.ts:4-30`): No search query/status fields. Task 2 will address this.

7. **`Toolbar.svelte` search gap** (`src/view/Toolbar.svelte:26-50`): No search input, query change callback, or status display. Task 2 will address this.


## Task 1 Implementation Notes (2026-04-18)

- `PipelineContext` now accepts explicit runtime-only `search.query` and explicit `pinnedPaths` inputs.
- `applyPinReorder()` no longer reaches through `settings` with an unsafe cast; it consumes `context.pinnedPaths` only.
- `FolderCardView.deriveVisibleCards()` is the single context-construction seam and now passes view-owned `searchQuery` plus pinned paths into `runPipeline()`.
- Ownership model is captured in `src/view/types.ts` as `SearchOwnershipContract`, documenting boundaries across `main.ts`, `FolderCardView.ts`, `panel-model.ts`, `Toolbar.svelte`, and `pipeline.ts`.
- `pipeline.test.ts` now uses typed context helpers (`withPinnedPaths`) and removes all `as unknown as PipelineContext` cast usage.


## Task 3 Implementation Notes (2026-04-18)

- Added direct `matchesSearchQuery()` unit coverage in `src/view/metadata-utils.test.ts` for empty/whitespace query pass-through, title-only fallback, content fallback with supplied text, content miss without supplied text, and case-insensitive behavior.
- Replaced pass-through search expectations in `src/view/pipeline.test.ts` with real filtering assertions using `context.search.query` and deterministic per-card excerpts.
- Locked search-before-pin invariant with a dedicated pipeline test: pinned cards that fail search are removed before `applyPinReorder()` and are not reintroduced.
- Wired `applySearchFilter()` in `src/view/pipeline.ts` to use `matchesSearchQuery()` with query from `PipelineContext.search.query` and fallback content from non-empty card excerpts.


## Task 2 Implementation Notes (2026-04-18)

- `PanelModelState` now carries runtime-only `searchQuery` and finite `searchStatus` (`idle | fallback | ready | building | error`) so toolbar/panel rendering stays contract-driven and indexed-mode compatible.
- `FolderCardView` remains the sole query owner: it handles `onSearchQueryChange` and `onSearchQueryReset`, computes status via `getSearchStatus()`, and refreshes cards through existing `pushState()` projection flow (no settings writes).
- `FolderCardPanel.svelte` and `Toolbar.svelte` now bridge search state/intent explicitly (`search-query-change`, `search-query-reset`) without introducing toolbar-owned query source-of-truth state.
- Mocks and tests were extended to prove coordinator ownership and panel propagation: `Toolbar.svelte.test.ts` covers query/status rendering and intent callbacks; `card-context-actions.test.ts` covers view-owned query updates, reset behavior, and non-persistence.


## Task 5 Retry Notes (2026-04-18)

- `main.ts` now owns the search lifecycle explicitly: it constructs `NoIndexSearchService`, initializes it during `onload()`, exposes `getSearchService()` for views, disposes it on plugin cleanup/unload, and forwards vault mutation events through a bounded `toSearchVaultMutation()` seam.
- Init failures are now failure-safe: if service initialization throws, plugin logs a warning, clears the service reference, and runtime search remains usable via pipeline fallback semantics.
- `FolderCardView` now consumes service query/status outputs without owning indexing internals: query text stays view-owned, service query runs with scope/candidate paths, `orderedPaths` feed pipeline search input when available, and `mode: "no-index"` / `orderedPaths: null` maps to `fallback` status.
- Stale-result protection now covers async service responses: request sequence + generation + folder path + query matching prevent old responses from overriding empty-query resets, rapid query changes, or folder switches.
- Added `src/main.test.ts` to lock plugin-host behavior (init success, init failure fallback, mutation forwarding, dispose-on-unload), and updated `card-context-actions.test.ts` to validate meaningful service seam consumption and stale-result safety.

## Task 6 Regression Hardening (2026-04-18)
- Added one minimal combined interplay regression in `src/view/pipeline.test.ts` to prove tag + search filtering both execute before pin reorder in the default pipeline path.
- Existing suites already covered query reset, coordinator-owned runtime query state, no settings persistence on query changes, fallback-safe service-unavailable behavior (`orderedPaths: null`), and lifecycle cleanup via `onClose` handler cleanup assertions.
- Targeted readiness suite command and all repo gates passed; build still reports existing non-blocking Svelte warnings.

## F2 Failure-Path Disposal Fix (2026-04-18)
- `initializeSearchService()` now disposes the just-created `NoIndexSearchService` instance when `initialize()` throws, then clears `this.searchService` to preserve fallback-first null state.
- Added regression coverage in `src/main.test.ts` to prove disposal occurs on init failure and that disposal runs while the instance is still plugin-owned before fallback settles to `plugin.getSearchService() === null`.
