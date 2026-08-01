# Data and Persistence Patterns

## Purpose

Use this file for data boundaries: what lives in the vault, plugin settings, IndexedDB, search snapshots, and runtime projections. For architecture-level ownership, read `docs/architecture.md`.

## Data Layers

| Layer | Owner | Contents | Notes |
| :--- | :--- | :--- | :--- |
| Vault files | Obsidian vault | source notes and supported non-markdown card files | plugin reads via Obsidian APIs; vault is always source of truth |
| Plugin settings | `src/settings.ts` + `main.ts` | sort, tag filter, pinned paths, scope options, open behavior, preview options | persisted plugin preferences only |
| IndexedDB search store | `src/search/IndexStore.ts` | serialized index payload, metadata, schema/version-gated restore state | no view query state |
| Search runtime snapshots | `SearchIndexManager` / `IndexedSearchService` | readiness, health, query execution status, bounded ordered paths, match counts | plugin-global lifecycle, view-consumed |
| Runtime card projections | `FolderCardView.ts` + `pipeline.ts` | `baseCards`, `visibleCards`, derived empty states, render-facing search metadata | recomputed; not persisted |

## Settings Contract

`PluginSettings` currently persists:

- `sort.field`
- `sort.direction`
- `filter.tags`
- `pinnedPaths`
- `includeSubfolders`
- `defaultView`
- `defaultCardOpenBehavior`
- `cardCornerRadius`
- `newNoteTemplate`
- `previewLines`
- `lastFolderPath`

Do not persist:

- `searchQuery`
- `visibleCards`
- selection / bulk state
- search readiness or health snapshots
- hydration progress

## Boundary Values and Semantics

- `lastFolderPath = ""` means vault root. It is not a missing value.
- `includeSubfolders` controls data collection inside the selected folder scope.
- `pinnedPaths` only affects ordering after upstream filters pass.
- `filter.tags` is AND semantics.
- Empty-query browsing is not a search execution state; it stays on the browse path.

## Search Contracts

### `IndexStore`

- Persists and restores serialized index payloads.
- Applies schema/version checks.
- Clears bad or drifted state when restore is unsafe.
- Does not execute queries.

### `SearchIndexManager`

- Owns restore, full rebuild, incremental mutation application, and health snapshots.
- Marks `rebuild-required` for unsafe rename/corruption cases.
- Returns candidate-bounded ordered paths for ready queries.

### `IndexedSearchService`

- Adapts manager state to the view-facing query contract.
- Bounds candidate paths before querying.
- Filters ordered results back to the bounded candidate set.
- Blocks non-empty queries outside ready indexed states.

## Indexed Search Readiness Matrix

| Query case | Result |
| :--- | :--- |
| empty query | browse path; cards remain available |
| non-empty + `ready` | indexed query runs; `orderedPaths` is authoritative |
| non-empty + `building` | blocked |
| non-empty + `rebuild-required` | blocked |
| non-empty + `error` | blocked |
| non-empty + storage unavailable/uninitialized | blocked |

Rule: blocked indexed states must not silently fall back to vault scanning.

## File-Kind Data Semantics

| Kind | Preview semantics | Search semantics |
| :--- | :--- | :--- |
| `markdown` | full lightweight preview extraction | full-text indexed title + content |
| `base` | title + icon + placeholder | title-oriented only |
| `canvas` | title + icon + placeholder | title-oriented only |
| `excalidraw` | title + icon + placeholder | title-oriented only |

Do not broaden non-markdown indexing accidentally. Mixed card support does not imply mixed full-text parity.

## Mutation and Persistence Rules

- Vault mutation is the source event; persistent index state follows vault truth.
- File create/modify/delete should prefer incremental index updates.
- Unsafe folder rename should prefer `rebuild-required` over speculative path rewriting.
- View projections are disposable and should be rebuilt from current vault + query inputs.
- Persist only data needed to recover settings or the search index; never persist render snapshots.

## Common Failure Modes

- Treating `""` as "no folder selected" instead of vault root.
- Persisting runtime-only fields such as `searchQuery` or selection.
- Reintroducing fallback search when the index is blocked.
- Letting pin order or search metadata become stored card truth.
- Accidentally indexing non-markdown content as if it were markdown.

## Change Checklist

- Did the change keep vault data, settings, index state, and runtime projections separate?
- Are persisted settings still limited to `PluginSettings` fields?
- Does search behavior still block non-ready non-empty queries?
- Are `pinnedPaths` and tag filters still projection inputs, not stored card mutations?
- Did file-kind semantics stay asymmetric between markdown and non-markdown?
