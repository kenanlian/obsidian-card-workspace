# State and Runtime Patterns

## Purpose

Use this file for runtime ownership, async safety, graded updates, and projection rules. For full architecture and module boundaries, read `docs/architecture.md`.

Enumerable field lists, method lists, and line counts belong in TypeScript types and `src/architecture.test.ts`, not here.

## Ownership Map

| Owner | Canonical state | Must not own |
| :--- | :--- | :--- |
| `src/main.ts` | plugin lifecycle and assembly of `SettingsStore`, `SearchCoordinator`, `EditorDropController`, `VaultEventBus`; default card open behavior | per-view query, `visibleCards`, Svelte-local interaction state |
| `src/view/FolderCardView.ts` | `ItemView` lifecycle, `createViewModules` assembly, grouped panel publish, vault self-subscribe | plugin-global lifecycle, IndexedDB persistence, search index truth, inlined domain logic |
| `ViewStateStore` | runtime `CardScope`, `baseCards`, `visibleCards`, selected path | persisted settings, index snapshots |
| Controllers / actions | per-domain runtime (see table below) | a `FolderCardView` reference; casting `ViewContext` back to the view |
| `src/view/panel-model.ts` | grouped render snapshot pushed from the host | long-lived truth independent of the view |
| Svelte (`FolderCardPanel`, `NavigationPane`, `TreeSection`, `Toolbar`, `CardItem`) | ephemeral UI state only: focus, hover, menus, local input presentation | plugin lifecycle, index lifecycle, durable search/query truth |

## Controller ownership

Controllers talk to the host only through `ViewContext` and injected function deps. Shared mutable view state goes through `ViewStateStore`, not through the `ItemView` instance.

| Controller / action | Owns | Shares via `ViewEpochs` |
| :--- | :--- | :--- |
| `ScopeController` | current load, candidate collection, vault-refresh debounce, persisting scope projections after a real migration | `load` (bumped on a new scope load and on dispose) |
| `ProjectionController` | `pipeline.ts` projection and vault-derived tag caches | `vaultContent` (caches expire when vault content generation moves) |
| `SearchController` | runtime query, snapshot subscription, blocked/ready projection input | `load` (drop search results from a previous load) |
| `HydrationController` | preview hydration queue and startup prewarm | `load` (same generation as the load that produced the cards) |
| `BulkController` | selected paths, anchor, bulk enablement | — |
| `NavLayoutController` | folder/tag/box trees, favorites rows, pane width/collapse, nav counts | `navCount` (one clock per debounced count refresh) |
| `BoxActions` / `FavoriteActions` | box and favorite commands; they read runtime scope, not the persisted `activeBoxId` projection | — |

`ProjectionController` holds no timers or subscriptions, so it has no `dispose()`. Controllers that do hold timers, subscriptions, or in-flight work implement `dispose()`.

## Why `ViewEpochs` are shared

Handwritten per-field generation counters do not compose once load, hydration, and search live in different modules. `AsyncEpoch` is the shared primitive: `bump()` starts a generation, `token()` reads the current one, `isCurrent(token)` drops stale completions.

`ViewEpochs` exists because some clocks must be shared across ownership boundaries:

- **`load`** — one scope load and the hydration work for those cards are the same generation. A later load must invalidate in-flight hydrates and searches from the previous one.
- **`vaultContent`** — projection caches derived from vault metadata expire together, even though only `ProjectionController` reads them.
- **`navCount`** — navigation counts advance once per debounced refresh, not once per caller.

Controllers may still keep a *private* `AsyncEpoch` for work that never crosses a boundary (for example a search request clock). Private clocks do not replace `ViewEpochs.load` for load-scoped work.

## Runtime State Taxonomy

- **Plugin-global** — singleton resources assembled in `main.ts`: settings store, search coordinator, vault bus, commands.
- **Per-view runtime** — one `FolderCardView` plus its modules: `CardScope`, card arrays, bulk selection, hydration queue, query state.
- **Panel projection** — grouped `PanelModelState` snapshot for Svelte; groups are replaced wholesale through `batch` / `mutate`.
- **Component-local ephemeral** — DOM interaction details that can be dropped and recomputed.

Rule: if losing the value should not change persisted behavior or cross-view behavior, keep it out of plugin settings and out of plugin-global state.

## Graded update intents

Strength order: `patch < reproject < rehydrate < reload`. Multi-key changes take `maxIntent`. A no-op returns `null` and must not touch the view.

| Intent | Semantic | Typical causes |
| :--- | :--- | :--- |
| `reload` | The candidate file set itself changed | `includeSubfolders`; active box membership signature |
| `reproject` | Same cards; order or visibility changed | `filter.tags`, `pinnedPaths`, `sort`; active box `sort` / `pinnedPaths` |
| `rehydrate` | Preview HTML must be rebuilt | `previewLines` only |
| `patch` | Presentation / chrome only | Remaining settings, including `lastFolderPath` and `activeBoxId` |

`lastFolderPath` and `activeBoxId` stay `patch` because they are persisted projections written *after* the runtime scope load already happened. Treating them as `reload` would load the same scope twice.

Settings intent and panel publish scope are separate axes. Runtime events (hydration finished, search snapshot arrived) call `publishGroups` directly.

## Canonical Flows

### Scope load

1. `ScopeController` resolves the current `CardScope`.
2. Collect supported files (folder walk or box membership).
3. Build `baseCards`.
4. `ProjectionController` runs `pipeline.ts` (`tag -> search -> pin` for folders; `search -> pin` for boxes).
5. The host replaces the affected panel groups in one batch.
6. `HydrationController` hydrates preview content in bounded follow-up work, guarded by `epochs.load`.

### Search query

1. UI sends query intent to the host; `SearchController` owns the runtime query.
2. Query updates are debounced.
3. Non-empty queries call `SearchService.query()`.
4. The result is ordered paths or a blocked execution state.
5. Projection re-runs `pipeline.ts` and the host publishes the search/cards groups.

### Vault mutation

1. `main.ts` receives the Obsidian mutation and publishes it on `VaultEventBus`.
2. Plugin listeners run first, in order: `lastFolderPath` reconcile → boxes → favorites → tag prune → search (isolated).
3. Each view, which self-subscribed on open, decides whether its current scope needs work and debounces its own reload.
4. `SearchIndexManager` applies an incremental mutation or marks `rebuild-required`.

### Hydration

1. Visible prefix is chosen from pipeline-projected cards.
2. Startup prewarm hydrates only the first 6 visible candidates.
3. Wait budget is capped at 120ms.
4. Remaining preview work stays viewport-driven and lazy.
5. Completions that fail `epochs.load.isCurrent(token)` are dropped.

## Async Safety Rules

- Every async view operation is generation-guarded. If the relevant epoch moved, drop the result. This covers selection, load, search, and hydration.
- Debounced search and debounced vault refresh are boundaries; do not let stale completions mutate current state.
- Keep pending-work handles explicit (rebuild/recovery jobs, hydration queues, vault-refresh timers).
- `main.ts` owns service bootstrap/recovery/rebuild sequencing; views consume snapshots, not service internals.
- If search readiness changes during a query, prefer blocked/empty projection over mixed stale output.

The old handwritten `this.generation` field is gone. The *rules* are unchanged: a completion from a previous load, query, or hydrate must not win.

## `dispose()` contract

`FolderCardView.cleanupLifecycle` unsubscribes the view from the vault bus, then calls `dispose()` on controllers in reverse construction order (scope → nav → bulk → search → hydration).

Each `dispose()` must:

- clear timers and subscriptions
- drop queued work
- `bump()` the epochs it owns so in-flight writes fail `isCurrent`
- return the `DisposeReport` fields it is responsible for; the view aggregates them

`cleanupLifecycle` is idempotent across repeated close calls.

## Projection Rules

- `src/view/pipeline.ts` is the only visible-card projection path.
- Folder order: `tag filter -> search filter -> pin reorder`.
- Box order: `search filter -> pin reorder`. Box membership is resolved at load, so the browse tag filter does not run.
- Pinning never bypasses tag or search filtering.
- Startup prewarm, reloads, query changes, and mutation updates all project through the same pipeline.

## Common Failure Modes

- Updating `visibleCards` directly instead of through `pipeline.ts`.
- Putting `searchQuery` into persisted settings.
- Letting a stale async result win after a scope switch, reload, or query change.
- Inferring runtime scope from `lastFolderPath` / `activeBoxId` instead of `CardScope`.
- Moving durable state into Svelte components.
- Hydrating from raw `baseCards` order instead of visible projected order.
- Holding a `FolderCardView` reference inside a controller or action.

## Change Checklist

- Did ownership stay with the current canonical module (controller/action/service), not the `ItemView` shell?
- Does every visible-card change still pass through `pipeline.ts`?
- Are async results epoch-guarded and stale-safe?
- Did panel updates stay host-driven through grouped `batch` / `publishGroups`?
- Did `dispose()` run in reverse order and bump the epochs it owns?
- Did startup hydration keep the `6 cards / 120ms` bounds?
