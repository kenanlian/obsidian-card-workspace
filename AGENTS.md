# Repository Guidelines

## Project Overview

**Card Workspace** (also "Folder Card Explorer") is a desktop-only Obsidian plugin that renders a folder's notes as a virtualized card stream in the **left sidebar**. It provides indexed full-text search, tag filtering, pin reordering, bulk operations, favorites, nav/card context menus, card-to-editor drag insert, and its own two-column navigation pane for folders, tags, and boxes.

- **Plugin ID**: `card-workspace`
- **Version**: `1.0.2` (source of truth: `manifest.json`)
- **License**: MIT
- **Min Obsidian**: `1.9.0`
- **Runtime dependency**: `minisearch` ^7.2.0 (bundled)
- **Desktop only**: `manifest.json` declares `isDesktopOnly: true`

## Documentation Map

- `AGENTS.md` — first read; repo workflow, commands, testing entry points, implementation constraints, and current architecture guardrails
- `docs/architecture.md` — detailed architecture source of truth: module boundaries, runtime flows, state ownership, invariants
- `docs/state-and-runtime-patterns.md` — runtime ownership, async safety, projection rules, change checklist
- `docs/data-and-persistence-patterns.md` — settings, vault/indexed data boundaries, search readiness, mutation persistence rules
- `docs/ui-patterns.md` — host/Svelte interaction patterns, virtualization, hydration, styling, modal/confirmation guidance

## Architecture Quick Reference

- **Detailed source of truth**: `docs/architecture.md`
- **Plugin ownership**: `src/main.ts` owns plugin lifecycle, settings, search service lifecycle, vault mutation fanout, and default card open behavior
- **Per-view ownership**: `src/view/FolderCardView.ts` owns folder scope, `baseCards` / `visibleCards`, hydration, bulk state, and runtime search state
- **Projection rule**: `src/view/pipeline.ts` is the only visible-card projection path, in fixed order: `tag filter -> search filter -> pin reorder`
- **UI boundary**: `src/view/panel-model.ts` bridges host state into Svelte; `FolderCardPanel.svelte`, `Toolbar.svelte`, and `CardItem.svelte` render/publish intent only
- **Search boundary**: indexed-only search via `IndexStore` + `SearchIndexManager` + `IndexedSearchService`; non-empty queries stay blocked until the index is ready

## Current Project Status

- Search architecture is **indexed-only**. Do not restore fallback search paths without an explicit architecture change.
- `pipeline.ts` remains the only visible-card projection path.
- Non-ready indexed states (`building`, `error`, `rebuild-required`) block non-empty queries.
- Supported card file kinds are `markdown`, `base`, `canvas`, and `excalidraw`.
- Markdown keeps full preview and full-text indexing; the other supported kinds remain title/placeholder-oriented.
- Startup preview prewarm is limited to the first 6 visible candidates and a 120ms wait budget.
- `lastFolderPath = ""` is the persisted vault-root folder scope.
- Default card open behavior is owned by `main.ts`.
## Key Directories

| Directory | Purpose |
|-----------|---------|
| `src/` | All source code |
| `src/view/` | Obsidian view layer, Svelte components, and view utilities |
| `src/search/` | Local search subsystem (MiniSearch + IndexedDB) |
| `src/__mocks__/` | Vitest mocks for `obsidian` and `FolderCardPanel.svelte` |
| `scripts/` | Release scripts (`sync-version.mjs`, `check-release.mjs`) |
| `styles.css` | Single flat CSS file (design tokens, Obsidian theme integration) |
| `docs/` | Developer docs: `architecture.md`, `state-and-runtime-patterns.md`, `data-and-persistence-patterns.md`, `ui-patterns.md`, `decisions/` |
| `.github/workflows/` | CI (`ci.yml`) and release (`release.yml`) automation |

## Development Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies |
| `npm run dev` | Watch build with inline sourcemaps and Svelte dev mode |
| `npm run build` | Production build (`main.js`, no sourcemaps) |
| `npm run check` | TypeScript type check (`tsc --noEmit`) |
| `npm run check:svelte` | Svelte type check (`svelte-check --tsconfig ./tsconfig.json`) |
| `npm test` | Full Vitest suite (node + jsdom projects) |
| `npm run test:node` | Node-only tests (logic, settings, note-ops, search) |
| `npm run test:component` | jsdom/Svelte tests (Toolbar, FolderCardView, CardItem) |
| `npm run test:watch` | Vitest watch mode |
| `npm run release:prepare -- "x.y.z" [minAppVersion]` | Sync version across all manifest files |
| `npm run release:check -- "x.y.z"` | Validate version consistency |

### CI validation chain

For normal changes, run:
```
npm run check && npm run build && npm test
```

CI/release also requires `npm run check:svelte` before the chain.

## Code Conventions & Common Patterns

### TypeScript & Svelte

- **TypeScript strict**: `strict: true`, `moduleResolution: "Bundler"`, `isolatedModules: true`
- **Svelte 5 only**: components use `$props`, `$state`, `$derived`, `$effect` runes
- **Host seam**: `FolderCardView` dynamically imports the Svelte panel and uses `mount()` / `unmount()` — never `new`, `$set`, `$on`, or `$destroy`
- **Host-owned state**: keep the source of truth in `FolderCardView` / `panel-model`; do not move it into Svelte components

### State management

- **PanelModel**: simple observable bridge between imperative host and declarative Svelte
  ```ts
  // src/view/panel-model.ts
  const model = createPanelModel(initialState);
  model.subscribe(listener);  // Svelte panel subscribes
  model.mutate(fn);           // FolderCardView pushes state
  ```
- **Snapshot pattern**: `SearchService` and `IndexStore` use snapshot + `Set<listener>`; snapshots are cloned before emission
- **Generation guards**: all async view operations track `this.generation` to discard stale results (selection, search, hydration)
- **Settings**: owned by plugin; views read on load; `saveSettings()` triggers `requestRefreshForViews`

### Naming

- **Classes**: `PascalCase` (e.g., `FolderCardView`, `SearchIndexManager`)
- **Functions**: `camelCase`
- **Callbacks**: `on` prefix (e.g., `onOpenNote`, `onToolbarAction`)
- **Handlers**: `handle` prefix (e.g., `handleVaultMutation`, `handleFolderSelection`)
- **Builders**: `build` prefix (e.g., `buildLightPreview`, `buildTagTree`)
- **Resolvers**: `resolve` prefix (e.g., `resolveCardFileKindFromPath`, `resolveUiLanguage`)
- **Type prefixes**: `Search*`, `Folder*`, `Bulk*`, `Card*`, `NoteOp*` for domain-specific types

### Async & error handling

- **Async**: explicit `async/await` with generation tracking and pending-operation guards (e.g., `pendingSearchRebuild`, `pendingSearchRecovery`)
- **File operations**: typed result unions with `outcome: 'ok' | 'error'` (`NoteOpResult`, `BatchOpSummary`, `MergeOpResult`)
- **Search errors**: caught with `console.warn`; no global error boundary
- **Debouncing**: `debounce(..., 250, false)` for vault changes; `120ms` for search query changes

### Obsidian-specific rules

- Prefer `app.vault`, `cachedRead()`, and FileManager/Vault APIs over lower-level adapter access
- Keep `onload()` light; expensive vault/watcher work belongs behind `workspace.onLayoutReady()`
- Register plugin-owned events and DOM listeners with Obsidian cleanup helpers
- `manifest.json` is desktop-only; do not add mobile assumptions without updating that contract

### CSS

- Single flat file (`styles.css`, ~1,289 lines) — no preprocessor, no Tailwind
- Design tokens: `--fce-*` custom properties scoped under `.folder-card-view` that map to Obsidian theme variables (`--background-primary`, `--text-normal`, `--interactive-accent`, etc.)
- BEM-like classes: `.fce-toolbar`, `.fce-card`, `.fce-search-hit`, `.fce-preview-code`

## Important Files

| File | Role |
|------|------|
| `src/main.ts` | Plugin entry point — lifecycle, settings, search wiring, vault observers, command registration, view activation, drag-insert handling (~1,605 lines) |
| `src/view/FolderCardView.ts` | Per-view runtime coordinator — folder loading, card arrays, pipeline, search, bulk state, hydration, context menus, modals (~5,663 lines) |
| `src/view/FolderCardPanel.svelte` | Svelte 5 root — virtualized scrolling, row projection, hydration callbacks, scroll anchoring (~781 lines) |
| `src/view/NavigationPane.svelte` | Svelte 5 navigation column — folder/tag/box trees, favorites section, resize handle |
| `src/view/Toolbar.svelte` | Svelte 5 toolbar — scope label, sort, tag filter, search, bulk mode (~732 lines) |
| `src/view/CardItem.svelte` | Svelte 5 card — preview HTML, search highlighting, pin toggle, bulk checkbox, drag source (~548 lines) |
| `src/view/panel-model.ts` | Host-to-Svelte observable state bridge |
| `src/view/pipeline.ts` | Sole visible-card projection: tag filter → search filter → pin reorder |
| `src/view/types.ts` | View-layer type definitions (~20 interfaces, Phase 3 ownership docs) |
| `src/settings.ts` | Settings types, `DEFAULT_SETTINGS`, `normalizeSettings`, `mergeSettings` |
| `src/i18n.ts` | i18n strings (`en` / `zh`) — ~1,439 lines |
| `src/search/SearchIndexManager.ts` | Core search index manager — MiniSearch lifecycle, incremental mutations (~1,103 lines) |
| `src/search/IndexedSearchService.ts` | SearchService adapter — query bounding, blocked-state gating |
| `src/search/IndexStore.ts` | IndexedDB persistence with schema-version checks |
| `src/search/types.ts` | Search subsystem contracts (`PHASE3_MINISEARCH_CONTRACT`) |
| `src/view/note-ops.ts` | File operations — move, delete, trash, duplicate, merge, batch variants |
| `src/view/favorites.ts` | Favorites entries — normalize, toggle, reorder, prune, vault-mutation reconciliation |
| `src/view/card-boxes.ts` | Card box definitions — create, rename, rule seeding, sort specs |
| `src/view/nav-context-menu.ts` | Navigation pane context menus for folders, tags, and boxes |
| `src/view/markdown-utils.ts` | Markdown-to-HTML preview engine with allow-list sanitization |
| `src/electron.d.ts` | Ambient types for Electron `shell.openPath` / `shell.showItemInFolder` |
| `manifest.json` | Obsidian plugin manifest — version source of truth |
| `versions.json` | Version compatibility map (required by Obsidian plugin updater) |
| `esbuild.config.mjs` | Build config — CJS, ES2018, browser platform, externals |
| `tsconfig.json` | TypeScript strict config |
| `vitest.config.ts` | Dual-project Vitest config (node + jsdom) |
| `styles.css` | Flat CSS design system |
| `scripts/sync-version.mjs` | Release prep — syncs version across 4 files |
| `scripts/check-release.mjs` | Release validation — cross-file version check |

## Runtime/Tooling Preferences

- **Package manager**: npm (lockfile: `package-lock.json`)
- **Runtime**: Node.js (for build/test; plugin runs inside Obsidian/Electron)
- **Bundle**: esbuild → `main.js` (CJS, ~800KB), entry `src/main.ts`
- **Externals** (provided by Obsidian runtime, never bundled):
  - `obsidian`
  - `electron`
  - `@codemirror/state`
  - `@codemirror/view`
  - `@codemirror/language`
- **No ESLint / No Prettier** — do not add unless explicitly requested
- `oxlint` is installed as a devDependency but not wired into any script or CI
- `typescript-language-server` is a devDependency for editor LSP support

## Testing & QA

### Test split

Vitest 4 with two named projects:

1. **`node` project** — pure logic tests
   - Environment: `node`
   - Includes: `src/**/*.test.ts` **excluding** `*.svelte.test.ts` and `FolderCardView.test.ts`
   - Aliases: `obsidian` → `src/__mocks__/obsidian.ts`, `./FolderCardPanel.svelte` → `src/__mocks__/FolderCardPanel.svelte.ts`
   - Good for: settings, note-ops, search subsystem, markdown-utils, pipeline

2. **`jsdom` project** — DOM/Svelte tests
   - Environment: `jsdom`
   - Includes: `*.svelte.test.ts` and `FolderCardView.test.ts`
   - Uses `@sveltejs/vite-plugin-svelte` with `conditions: ['browser']`
   - Good for: Toolbar, FolderCardView, CardItem, scroll anchoring, row projection

### Mock seam

- `src/__mocks__/obsidian.ts` — shared minimal stubs for `App`, `Vault`, `Modal`, `TFolder`, `setIcon`, `setTooltip`, `getAllTags`
- `src/__mocks__/FolderCardPanel.svelte.ts` — mock Svelte component that captures callback props into `__mockState.panelEventHandlers`
- `vi.hoisted()` — mutable mock state shared across `vi.mock()` factories and test bodies
- Module-level `vi.mock()` for `obsidian`, `note-ops`, `FolderPickerModal`, and search modules per test file

### Running tests

```bash
# Full suite
npm test

# Single file
npx vitest run src/view/markdown-utils.test.ts

# Single test by name
npx vitest run src/view/markdown-utils.test.ts -t "buildLightPreview handles code fences"

# Node-only
npm run test:node

# Component/jsdom only
npm run test:component
```

### Key testing patterns

- **Event contract verification**: views register callbacks on `onOpen()`; tests fire them via mock state and assert downstream effects
- **Stale-protection testing**: create pending promises, advance generation/snapshot state, then resolve and verify old results are discarded
- **Debounce testing**: `vi.useFakeTimers()` + `vi.advanceTimersByTime(119)` (should not fire) then `+1` (should fire)
- **Confirmation modal testing**: inspect modal structure via mock state arrays, simulate clicks via `clickLatestModalButton`
- **Batch operation testing**: verify partial-failure continuation, selection reconciliation, and notice accumulation
- **i18n coverage**: many tests verify both `en` and `zh` string paths via `getUiStrings('en')` / `getUiStrings('zh')`

### Performance invariants (do not break)

- Stale async guards must drop stale selection, search, and hydration results
- Viewport-driven lazy hydration and row-projected virtualization in `FolderCardPanel.svelte`
- `debounce(..., 250, false)` refresh behavior for vault changes
- Vault `create`/`modify`/`delete`/`rename` observers registered after `workspace.onLayoutReady()`
- Pinning only reorders cards; it does not bypass active filters or search constraints
- Non-ready indexed-search states intentionally block non-empty queries and project zero cards

### Release workflow

1. Tags are **bare semver** (`x.y.z`), not `vX.Y.Z`
2. `npm run release:prepare -- "x.y.z" [minAppVersion]` syncs `package.json`, `package-lock.json`, `manifest.json`, and `versions.json`
3. `npm run release:check -- "x.y.z"` validates consistency
4. GitHub `release.yml` triggers on semver tag pushes, runs the full CI chain, creates a draft release with `main.js`, `manifest.json`, and `styles.css`
