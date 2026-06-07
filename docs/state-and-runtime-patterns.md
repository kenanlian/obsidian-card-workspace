# State and Runtime Patterns

## Purpose

Use this file for runtime ownership, async safety, and projection rules. For full architecture and module boundaries, read `docs/architecture.md`.

## Ownership Map

| Owner | Canonical state | Must not own |
| :--- | :--- | :--- |
| `src/main.ts` | plugin lifecycle, settings lifecycle, search service lifecycle, vault mutation fanout, default card open behavior | per-view `searchQuery`, `visibleCards`, Svelte-local interaction state |
| `src/view/FolderCardView.ts` | folder scope, `baseCards`, `visibleCards`, bulk state, hydration bookkeeping, `searchQuery`, `searchStatus`, generation guards | plugin-global lifecycle, IndexedDB persistence, search index truth |
| `src/view/panel-model.ts` | render snapshot pushed from host: cards, loading, selection, sort/filter/search display state | long-lived truth independent of `FolderCardView` |
| `FolderCardPanel.svelte` / `Toolbar.svelte` / `CardItem.svelte` | ephemeral UI state only: focus, hover, menus, local input presentation | plugin lifecycle, index lifecycle, durable search/query truth |

## Runtime State Taxonomy

- **Plugin-global** — singleton resources in `main.ts`: settings, search service, vault observers, commands.
- **Per-view runtime** — one `FolderCardView` instance per view: scope, card arrays, bulk selection, hydration queue, query state.
- **Panel projection** — `PanelModelState` snapshot for Svelte render; updated only by `panelModel.mutate()`.
- **Component-local ephemeral** — DOM interaction details that can be dropped and recomputed.

Rule: if losing the value should not change persisted behavior or cross-view behavior, keep it out of plugin settings and out of plugin-global state.

## Canonical Flows

### Folder load

1. `FolderCardView` resolves folder scope.
2. Collect supported files.
3. Build `baseCards`.
4. Run `pipeline.ts` to derive `visibleCards`.
5. Push one render snapshot through `panel-model.ts`.
6. Hydrate preview content in bounded follow-up work.

### Search query

1. UI sends query intent to `FolderCardView`.
2. View debounces runtime query updates.
3. View calls `SearchService.query()` only for non-empty queries.
4. Search result returns ordered paths or blocked execution state.
5. View re-runs `pipeline.ts` and pushes the next panel snapshot.

### Vault mutation

1. `main.ts` receives Obsidian mutation.
2. `main.ts` forwards it to views and search service.
3. `FolderCardView` applies incremental update or queues reload.
4. `SearchIndexManager` applies incremental mutation or marks `rebuild-required`.

### Hydration

1. Visible prefix is chosen from pipeline-projected cards.
2. Startup prewarm hydrates only the first 6 visible candidates.
3. Wait budget is capped at 120ms.
4. Remaining preview work stays viewport-driven and lazy.

## Async Safety Rules

- Every async view operation is generation-guarded. If generation changed, drop the result.
- Debounced search and debounced vault refresh are boundaries; do not let stale completions mutate current state.
- Keep pending-work handles explicit (`pendingSearchRebuild`, hydration queues, recovery jobs).
- `main.ts` owns service bootstrap/recovery/rebuild sequencing; views consume snapshots, not service internals.
- If search readiness changes during a query, prefer blocked/empty projection over mixed stale output.

## Projection Rules

- `src/view/pipeline.ts` is the only visible-card projection path.
- Fixed order: `tag filter -> search filter -> pin reorder`.
- Pinning never bypasses tag or search filtering.
- Startup prewarm, reloads, query changes, and mutation updates all project through the same pipeline.

## Common Failure Modes

- Updating `visibleCards` directly instead of through `pipeline.ts`.
- Putting `searchQuery` into persisted settings.
- Letting a stale async result win after folder switch, reload, or query change.
- Moving durable state into Svelte components.
- Hydrating from raw `baseCards` order instead of visible projected order.

## Change Checklist

- Did ownership stay with the current canonical file?
- Does every visible-card change still pass through `pipeline.ts`?
- Are async results generation-guarded and stale-safe?
- Did panel updates stay host-driven through `panelModel.mutate()`?
- Did startup hydration keep the `6 cards / 120ms` bounds?
