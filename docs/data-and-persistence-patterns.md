# Data and Persistence Patterns

## Purpose

Use this file for data boundaries: what lives in the vault, plugin settings, IndexedDB, search snapshots, and runtime projections. For architecture-level ownership, read `docs/architecture.md`.

Enumerable settings-key catalogs belong in `PluginSettings`, the `SettingsStore` layer types, and `src/architecture.test.ts`, not here.

## Data Layers

| Layer | Owner | Contents | Notes |
| :--- | :--- | :--- | :--- |
| Vault files | Obsidian vault | source notes and supported non-markdown card files | plugin reads via Obsidian APIs; vault is always source of truth |
| Plugin settings | `SettingsStore` + `src/settings.ts` | three-layer disk document; flattened `PluginSettings` read view | persisted recovery data only; see ownership table below |
| IndexedDB search store | `src/search/IndexStore.ts` | serialized index payload, metadata, schema/version-gated restore state | no view query state |
| Search runtime snapshots | `SearchCoordinator` / `SearchIndexManager` / `IndexedSearchService` | readiness, health, query execution status, bounded ordered paths, match counts | plugin-global lifecycle, view-consumed |
| Runtime card projections | view store + `pipeline.ts` | `CardScope`, `baseCards`, `visibleCards`, derived empty states, render-facing search metadata | recomputed; not persisted |

## Persistence three-layer ownership

Disk format after the next settings write is v2 JSON:

```text
{ schemaVersion, preferences, workspace, userData }
```

Reads stay on the flattened `PluginSettings` view (`SettingsStore.getFlat()`). Callers do not branch on layer shape at the read site.

| Layer | Owns | Why it is a separate layer |
| :--- | :--- | :--- |
| `preferences` | Cross-session display and behavior defaults (sort defaults, preview budget, open/drag behavior, and similar) | Independent of which folder or box is open; not rewritten by vault reconcile |
| `workspace` | Session/layout restore: folder/box *projections*, nav chrome, active tag filter | These are snapshots of runtime UI, not authored collections. `lastFolderPath` and `activeBoxId` recover a session; they are not the runtime `CardScope` |
| `userData` | User-authored collections: card boxes, favorites, pinned paths | Vault mutations must reconcile these independently of layout chrome |

Do not persist runtime-only values: search query, card arrays, selection / bulk state, search readiness or health snapshots, hydration progress.

## Schema version and migration

`SETTINGS_SCHEMA_VERSION` is `2`. `migrateSettings` accepts three inputs:

- **v2** — three-layer document with `schemaVersion === 2`; flattened then normalized. v2 → v2 is idempotent.
- **v1** — current flat `PluginSettings`-shaped object (no `schemaVersion`, or not `2`).
- **v0** — historical flat object that may still contain `lastViewMode: "all-notes"`, which migrates to vault-root folder scope (`lastFolderPath = ""`).

Missing keys take `DEFAULT_SETTINGS`. Unrecognized top-level keys are dropped.

The first v2 write happens on the **next** settings write, not at startup. `SettingsStore.init()` loads and migrates into memory only.

Startup also applies a launch override: memory `activeBoxId` is forced to `null` so boxes collapse to browse mode. That override is not written until some later real settings change.

## Write serialization

`saveData` is a whole-document overwrite. `SettingsStore` therefore:

- updates the in-memory snapshot **synchronously** and increments `revision` before awaiting disk
- guarantees that a later `getFlat()` in the same tick already sees the new value
- allows at most one in-flight `save()`
- serializes the *latest* memory snapshot when a write actually starts, not the snapshot captured at enqueue time
- writes again if a higher `revision` appeared during the in-flight save, until `persistedRevision === revision`
- on write failure: does not advance `persistedRevision`, does not roll back memory, and propagates the error

Workspace-shaped patches may debounce before joining that same serialized queue. Preferences and userData patches enqueue immediately.

`getFlat()` remains the compatibility read view for the rest of the plugin. Layer split is a persistence concern, not a second settings API that views must speak.

## Boundary Values and Semantics

- `lastFolderPath = ""` means vault root. It is not a missing value.
- Runtime truth is `CardScope` on the view store. `lastFolderPath` / `activeBoxId` are session-restore projections written after a real scope migration.
- Startup restores **folder** scope only and keeps `activeBoxId = null`.
- `includeSubfolders` controls data collection inside the selected folder scope. Changing it is a `reload` (candidate set changes).
- `pinnedPaths` only affects ordering after upstream filters pass (`reproject`).
- `filter.tags` is AND semantics on folder scope. Box scope skips the browse tag filter because membership is already resolved at load.
- Empty-query browsing is not a search execution state; it stays on the browse path.

## Search Contracts

### Shared token policy

- Root `src/search-tokenization.ts` is the stateless Han/non-Han boundary shared by index/query term generation, literal occurrence counts, and Svelte highlighting.
- `src/search/minisearch-options.ts` is the search-layer assembly point for MiniSearch constructor, restore, and query options. `SearchIndexManager` remains the lifecycle, mutation, and query owner.
- Markdown leading frontmatter remains wholly excluded from indexed content. Inline tags remain searchable only as ordinary body text; no `tags` field is added, and tag navigation/filtering continues through Obsidian metadata.

### `IndexStore`

- Persists and restores serialized index payloads.
- Applies exact schema/tokenizer/plugin metadata checks. Tokenizer-version drift rejects the incompatible payload and enters the existing rebuild-required path even if best-effort stale-record clearing fails.
- Clears bad or drifted state when restore is unsafe.
- Continues to write one whole MiniSearch snapshot per vault; the record shape and persistence model are unchanged.
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

- Vault mutation is the source event; persistent index state and userData collections follow vault truth.
- `VaultEventBus` order is: `lastFolderPath` reconcile → boxes → favorites → tag prune → search (isolated) → views. Views self-subscribe and debounce their own reload.
- File create/modify/delete should prefer incremental index updates.
- Tokenizer policy changes require a metadata version bump so old postings rebuild before non-empty queries resume.
- Unsafe folder rename should prefer `rebuild-required` over speculative path rewriting.
- Folder rename of the persisted browse path rewrites `lastFolderPath` on the plugin, not via a view's `CardScope`.
- View projections are disposable and should be rebuilt from current vault + query inputs.
- Persist only data needed to recover settings or the search index; never persist render snapshots.

## Common Failure Modes

- Treating `""` as "no folder selected" instead of vault root.
- Treating `lastFolderPath` / `activeBoxId` as runtime scope instead of session projections.
- Persisting runtime-only fields such as `searchQuery` or selection.
- Writing v2 on startup instead of on the next real settings write.
- Reintroducing fallback search when the index is blocked.
- Restoring an index built with incompatible tokenizer metadata, or changing whole-snapshot persistence as part of a tokenizer-only rollout.
- Indexing frontmatter values or adding a tag field when the intended content lane is title + extracted Markdown body.
- Letting pin order or search metadata become stored card truth.
- Accidentally indexing non-markdown content as if it were markdown.
- Letting two in-flight `saveData` calls overwrite each other instead of going through the serialized queue.

## Change Checklist

- Did the change keep vault data, settings layers, index state, and runtime projections separate?
- Are persisted settings still recovered through `migrateSettings` and read through `getFlat()`?
- Does a new settings field have a layer home, a migration default, and an update-intent grade?
- Does search behavior still block non-ready non-empty queries?
- Are `pinnedPaths` and tag filters still projection inputs, not stored card mutations?
- Did file-kind semantics stay asymmetric between markdown and non-markdown?
