# Repository Guidelines

## Project Overview

**Card Workspace** (also "Folder Card Explorer") is a desktop-only Obsidian plugin that renders a folder's or card box's notes as a virtualized card stream in the **left sidebar**. It provides indexed full-text search, tag filtering, pin reordering, bulk operations, favorites, nav/card context menus, card-to-editor drag insert, and its own two-column navigation pane for folders, tags, and boxes.

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

Enumerable implementation details (settings keys, panel fields, module methods, file line counts) live in TypeScript types and `src/architecture.test.ts`, not in these docs.

## Architecture Quick Reference

- **Detailed source of truth**: `docs/architecture.md`
- **Plugin ownership**: `src/main.ts` is the plugin shell and assembly point (`SettingsStore`, `SearchCoordinator`, `EditorDropController`, `VaultEventBus`) plus default card open behavior
- **Per-view ownership**: `src/view/FolderCardView.ts` is `ItemView` lifecycle plus `createViewModules` assembly; per-domain work lives in `src/view/controllers/`, `src/view/actions/`, and `src/view/menus/`
- **Runtime scope**: `CardScope` on the view store is `{ kind: "folder"; path; includeSubfolders } | { kind: "box"; boxId }`. Settings `lastFolderPath` / `activeBoxId` are session-restore projections. Vault root is folder scope with `path === ""`
- **Projection rule**: `src/view/pipeline.ts` is the only visible-card projection path. Folders: `tag filter -> search filter -> pin reorder`. Boxes skip the browse tag filter
- **UI boundary**: `src/view/panel-model.ts` bridges grouped host state into Svelte; `FolderCardPanel.svelte`, `NavigationPane.svelte`, `Toolbar.svelte`, and `CardItem.svelte` render/publish intent only
- **Search boundary**: indexed-only search via `IndexStore` + `SearchIndexManager` + `IndexedSearchService`; non-empty queries stay blocked until the index is ready
- **Settings**: `SettingsStore` owns three-layer persistence; `getFlat()` is the flattened `PluginSettings` read view; `schemaVersion` is 2

## Current Project Status

- Search architecture is **indexed-only**. Do not restore fallback search paths without an explicit architecture change.
- `pipeline.ts` remains the only visible-card projection path.
- Non-ready indexed states (`building`, `error`, `rebuild-required`) block non-empty queries.
- Supported card file kinds are `markdown`, `base`, `canvas`, and `excalidraw`.
- Markdown keeps full preview and full-text indexing; the other supported kinds remain title/placeholder-oriented.
- Startup preview prewarm is limited to the first 6 visible candidates and a 120ms wait budget.
- `lastFolderPath = ""` is the persisted vault-root folder scope.
- Startup restores **folder** scope only and forces `activeBoxId = null`.
- Default card open behavior is owned by `main.ts`.

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `src/` | All source code |
| `src/view/` | Obsidian view host, Svelte components, and view utilities |
| `src/view/controllers/` | Per-view runtime: scope, projection, search, hydration, bulk, nav layout |
| `src/view/actions/` | User commands: file, folder, box, tag, favorite, merge |
| `src/view/menus/` | Card and navigation context-menu builders |
| `src/view/modals/` | `FormModal` subclasses; host/actions route into them |
| `src/services/` | Plugin-level assembly: settings, search coordinator, editor drop, vault bus, reconcilers |
| `src/search/` | Local search subsystem (MiniSearch + IndexedDB) |
| `src/i18n/` | Domain-split UI strings; callers still import `../i18n` |
| `src/__mocks__/` | Vitest mocks for `obsidian` and `FolderCardPanel.svelte`, plus the shared FolderCardView node harness |
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
| `npm run lint` | `oxlint --config .oxlintrc.json src` |
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
npm run lint && npm run check && npm run check:svelte && npm run build && npm test
```

CI already runs this chain with lint first.

## Code Conventions & Common Patterns

### TypeScript & Svelte

- **TypeScript strict**: `strict: true`, `moduleResolution: "Bundler"`, `isolatedModules: true`
- **Svelte 5 only**: components use `$props`, `$state`, `$derived`, `$effect` runes
- **Host seam**: `FolderCardView` dynamically imports the Svelte panel and uses `mount()` / `unmount()` — never `new`, `$set`, `$on`, or `$destroy`
- **Host-owned state**: keep the source of truth in the view store / `panel-model`, assembled through `createViewModules`; do not move it into Svelte components

### State management

- **PanelModel**: grouped observable bridge between imperative host and declarative Svelte. Groups are replaced wholesale; `batch` notifies once; unpublished groups keep identity
  ```ts
  // src/view/panel-model.ts
  const model = createPanelModel(initialState);
  model.subscribe(listener);  // Svelte panel subscribes
  model.mutate(fn);           // replace assigned groups
  model.batch(fn);            // nested calls still notify once
  ```
- **Snapshot pattern**: `SearchService` and `IndexStore` use snapshot + `Set<listener>`; snapshots are cloned before emission
- **Generation guards**: async view operations use `AsyncEpoch` / `ViewEpochs` to discard stale results (selection, load, search, hydration)
- **Settings**: owned by `SettingsStore`; views read `getFlat()`; `saveSettings()` applies a graded update intent to open views

### Naming

- **Classes**: `PascalCase` (e.g., `FolderCardView`, `SearchIndexManager`)
- **Functions**: `camelCase`
- **Callbacks**: `on` prefix (e.g., `onOpenNote`, `onToolbarAction`)
- **Handlers**: `handle` prefix (e.g., `handleVaultMutation`, `handleFolderSelection`)
- **Builders**: `build` prefix (e.g., `buildLightPreview`, `buildTagTree`)
- **Resolvers**: `resolve` prefix (e.g., `resolveCardFileKindFromPath`, `resolveUiLanguage`)
- **Type prefixes**: `Search*`, `Folder*`, `Bulk*`, `Card*`, `NoteOp*` for domain-specific types

### Async & error handling

- **Async**: explicit `async/await` with epoch guards and pending-operation guards (e.g., `pendingSearchRebuild`, `pendingSearchRecovery`)
- **File operations**: typed result unions with `outcome: 'ok' | 'error'` (`NoteOpResult`, `BatchOpSummary`, `MergeOpResult`)
- **Search errors**: caught with `console.warn`; no global error boundary
- **Debouncing**: `debounce(..., 250, false)` for vault changes; `120ms` for search query changes

### Obsidian-specific rules

- Prefer `app.vault`, `cachedRead()`, and FileManager/Vault APIs over lower-level adapter access
- Keep `onload()` light; expensive vault/watcher work belongs behind `workspace.onLayoutReady()`
- Register plugin-owned events and DOM listeners with Obsidian cleanup helpers
- `manifest.json` is desktop-only; do not add mobile assumptions without updating that contract

### CSS

- Single flat file (`styles.css`) — no preprocessor, no Tailwind
- Design tokens: `--fce-*` custom properties scoped under `.folder-card-view` that map to Obsidian theme variables (`--background-primary`, `--text-normal`, `--interactive-accent`, etc.)
- BEM-like classes: `.fce-toolbar`, `.fce-card`, `.fce-search-hit`, `.fce-preview-code`

## Important Files

| File | Role |
|------|------|
| `src/main.ts` | Plugin shell — lifecycle, command registration, view activation, and assembly of settings/search/drop/vault-bus |
| `src/services/SettingsStore.ts` | Three-layer settings persistence, serialized writes, flattened `getFlat()` read view |
| `src/services/SearchCoordinator.ts` | Search service lifecycle, restore/rebuild, vault-to-index forwarding |
| `src/services/VaultEventBus.ts` | Ordered vault-event fanout; views self-subscribe |
| `src/view/FolderCardView.ts` | `ItemView` lifecycle and `createViewModules` assembly; grouped panel publish |
| `src/view/view-modules.ts` | Cross-wires controllers, actions, and menus for one view |
| `src/view/scope.ts` | `CardScope` union and folder/box helpers |
| `src/view/update-intent.ts` | Four-grade settings update intents |
| `src/view/FolderCardPanel.svelte` | Svelte 5 root — virtualized scrolling, row projection, hydration callbacks, scroll anchoring |
| `src/view/NavigationPane.svelte` | Svelte 5 navigation column — folder/tag/box trees, favorites section, resize handle |
| `src/view/Toolbar.svelte` | Svelte 5 toolbar — scope label, sort, tag filter, search, bulk mode |
| `src/view/CardItem.svelte` | Svelte 5 card — preview HTML, search highlighting, pin toggle, bulk checkbox, drag source |
| `src/view/panel-model.ts` | Host-to-Svelte grouped state bridge |
| `src/view/pipeline.ts` | Sole visible-card projection: tag filter → search filter → pin reorder (boxes skip tag filter) |
| `src/view/types.ts` | View-layer type definitions |
| `src/settings.ts` | `PluginSettings`, `DEFAULT_SETTINGS`, `schemaVersion`, `migrateSettings`, `mergeSettings` |
| `src/i18n/` | i18n strings (`en` / `zh`), domain-split; callers still import `../i18n` |
| `src/search/SearchIndexManager.ts` | Core search index manager — MiniSearch lifecycle, incremental mutations |
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
- `oxlint` is wired via `npm run lint` and CI
- `typescript-language-server` is a devDependency for editor LSP support

## Testing & QA

### Test split

Vitest 4 with two named projects:

1. **`node` project** — pure logic tests
   - Environment: `node`
   - Includes: `src/**/*.test.ts` **excluding** `*.svelte.test.ts` and `FolderCardView.test.ts`
   - Aliases: `obsidian` → `src/__mocks__/obsidian.ts`, `./FolderCardPanel.svelte` → `src/__mocks__/FolderCardPanel.svelte.ts`
   - Shared FolderCardView node harness lives under `src/__mocks__/`
   - Good for: settings, note-ops, search subsystem, markdown-utils, pipeline, view-event routing, actions, menus

2. **`jsdom` project** — DOM/Svelte tests
   - Environment: `jsdom`
   - Includes: `*.svelte.test.ts` and `FolderCardView.test.ts`
   - Uses `@sveltejs/vite-plugin-svelte` with `conditions: ['browser']`
   - Good for: Toolbar, FolderCardView, CardItem, NavigationPane, scroll anchoring, row projection

### Mock seam

- `src/__mocks__/obsidian.ts` — shared minimal stubs for `App`, `Vault`, `Modal`, `TFolder`, `setIcon`, `setTooltip`, `getAllTags`
- `src/__mocks__/FolderCardPanel.svelte.ts` — mock Svelte component that captures callback props into `__mockState.panelEventHandlers`
- Shared FolderCardView node harness under `src/__mocks__/` — node tests assemble a view without the jsdom project
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

Node integration that used to sit in a single card-context test file now lives next to the module: `src/view/view-event-routing.test.ts` for host routing, `src/view/actions/*.test.ts` for commands, and `src/view/menus/card-context-menu.test.ts` for the card menu.

### Key testing patterns

- **Event contract verification**: views register callbacks on `onOpen()`; tests fire them via mock state and assert downstream effects
- **Stale-protection testing**: create pending promises, advance epoch/snapshot state, then resolve and verify old results are discarded
- **Debounce testing**: `vi.useFakeTimers()` + `vi.advanceTimersByTime(119)` (should not fire) then `+1` (should fire)
- **Confirmation modal testing**: inspect modal structure via mock state arrays, simulate clicks via `clickLatestModalButton`
- **Batch operation testing**: verify partial-failure continuation, selection reconciliation, and notice accumulation
- **i18n coverage**: many tests verify both `en` and `zh` string paths via `getUiStrings('en')` / `getUiStrings('zh')`

### Performance invariants (do not break)

- Stale async guards must drop stale selection, search, and hydration results
- Viewport-driven lazy hydration and row-projected virtualization in `FolderCardPanel.svelte`
- `debounce(..., 250, false)` refresh behavior for vault changes
- Vault `create`/`modify`/`delete`/`rename` observers registered after `workspace.onLayoutReady()`
- Vault events go through `VaultEventBus`; views self-subscribe and debounce their own reload
- Pinning only reorders cards; it does not bypass active filters or search constraints
- Non-ready indexed-search states intentionally block non-empty queries and project zero cards

### Release workflow

1. Tags are **bare semver** (`x.y.z`), not `vX.Y.Z`
2. `npm run release:prepare -- "x.y.z" [minAppVersion]` syncs `package.json`, `package-lock.json`, `manifest.json`, and `versions.json`
3. `npm run release:check -- "x.y.z"` validates consistency
4. GitHub `release.yml` triggers on semver tag pushes, runs the full CI chain, creates a draft release with `main.js`, `manifest.json`, and `styles.css`
