# AGENTS.md — Card Workspace

## Purpose
Obsidian plugin for browsing a folder as a virtualized card stream in the **left sidebar**. File Explorer folder-click linkage is optional and disabled by default.

## Stack that matters
- TypeScript `strict: true`
- Svelte 5 components and runtime
- esbuild bundle entry: `src/main.ts` -> `main.js` (CJS)
- Vitest split into `node` and `jsdom` projects
- Local search indexing via `minisearch` + IndexedDB-backed `src/search/*`

## Commands
- Install: `npm install`
- Watch build: `npm run dev`
- Build: `npm run build`
- Type check: `npm run check`
- Svelte check: `npm run check:svelte`
- Full test suite: `npm test`
- Node-only tests: `npm run test:node`
- jsdom/Svelte tests: `npm run test:component`
- Single file: `npx vitest run src/view/markdown-utils.test.ts`
- Single test: `npx vitest run src/view/markdown-utils.test.ts -t "buildLightPreview handles code fences"`

## Required verification
- For normal code/docs changes, run: `npm run check && npm run build && npm test`
- CI and release validation also run `npm run check:svelte` before the chain above.

## Release workflow facts
- Use `npm run release:prepare -- "$TAG"` to sync `package.json`, `package-lock.json`, `manifest.json`, and `versions.json`.
- Validate release metadata with `npm run release:check -- "$TAG"`.
- Release tags are bare semver (`x.y.z`), not `vX.Y.Z`.

## Architecture boundaries
- `src/main.ts`: plugin lifecycle, command registration, left-sidebar view activation, File Explorer click wiring, settings I/O, search service bootstrap/restore.
- `src/view/FolderCardView.ts`: runtime coordinator and source of truth for cards, selection, refresh, hydration, bulk actions, and search projection.
- `src/view/FolderCardPanel.svelte` + `Toolbar.svelte` + `CardItem.svelte`: presentation/event surface only.
- `src/view/panel-model.ts`: host-to-Svelte state bridge.
- `src/view/pipeline.ts`: visible-card projection steps like tag filtering, search filtering, and pin reordering.
- `src/search/*`: isolated local search subsystem with persistence, restore/rebuild logic, and query gating.

## Svelte / host seam
- This repo is **not** on the old class-component seam anymore.
- `FolderCardView` dynamically imports the panel and uses `mount()` / `unmount()`, not `new` / `$set` / `$on` / `$destroy`.
- Current Svelte components use Svelte 5 APIs like `$props`, `$state`, `$derived`, and `$effect`.
- Keep host-owned state in `FolderCardView` / `panel-model`; do not move the source of truth into Svelte components.

## Testing shape
- `vitest.config.ts` splits logic tests into the `node` project and Svelte / `FolderCardView` integration tests into the `jsdom` project.
- `src/__mocks__/obsidian.ts` and `src/__mocks__/FolderCardPanel.svelte.ts` are part of the intended testing seam.

## Performance and correctness invariants
Do not casually break these:
- request/generation guards that drop stale async selection, search, or hydration results
- viewport-driven lazy hydration and row-projected virtualization in `FolderCardPanel.svelte`
- `debounce(..., 250, false)` refresh behavior for vault changes
- vault `create`/`modify`/`delete`/`rename` observers being registered after `workspace.onLayoutReady()`
- pinning only reorders cards; it does not bypass active filters or search constraints
- non-ready indexed-search states intentionally block non-empty queries and project zero cards

## Obsidian-specific rules
- Prefer `app.vault`, `cachedRead()`, and FileManager/Vault APIs over lower-level adapter access.
- Keep `onload()` light; expensive vault/watcher work belongs behind `workspace.onLayoutReady()`.
- Register plugin-owned events and DOM listeners with Obsidian cleanup helpers.
- `manifest.json` declares this plugin as desktop-only; do not add mobile assumptions without updating that contract.

## Bundle/runtime constraints
These stay external in the bundle: `obsidian`, `electron`, `@codemirror/state`, `@codemirror/view`, `@codemirror/language`.

## Repo conventions worth preserving
- No ESLint or Prettier is configured; do not add tooling unless explicitly requested.
- `CLAUDE.md` just points back to this file, so keep this file as the canonical agent instruction source.
