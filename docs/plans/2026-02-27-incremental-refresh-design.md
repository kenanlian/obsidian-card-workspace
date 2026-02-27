# Design: Task 7 — Incremental Refresh

**Date:** 2026-02-27  
**Status:** Approved

## Problem

The current vault-change → `loadFolder()` path clears the entire `cards` array on every mutation event (debounced to 250ms). This discards all hydrated preview content, causing unnecessary re-reads and visible flicker.

## Goal

On file create / delete / rename / modify events, apply the minimum surgical change to `cards` in place, preserving hydrated content for unaffected cards. Fall back to full reload only when incremental handling is not safe.

## Chosen Approach: Per-Event Incremental Operations

### Event Handlers

| Event | Precondition | Incremental Action |
|-------|-------------|-------------------|
| `create` | File is `.md` and in scope | Insert new `NoteCardRecord` at sorted position; queue hydration |
| `delete` | `oldPath` or `path` matches an existing card | Splice that card out of `cards` |
| `rename` (file) | `oldPath` matches an existing card | Update `path`, `title`, `file` on the card; if new path leaves scope, remove; if new path enters scope with no existing card, insert |
| `modify` | `path` matches an existing card | Reset `hydrated = false`, remove from `pendingHydration`; hydration will re-trigger on next viewport pass |
| `rename` (folder) | Folder rename affecting `folderPath` | Continue using existing `rewritePathAfterRename` + full reload (avoids recursive-move complexity) |

### Sorted Insert

For `create` and scope-entry `rename`, the new card is inserted at the correct sorted position using a binary search over the existing `cards` array with `compareCards()`.

### Architecture

**New method in `FolderCardView`:**

```ts
applyIncrementalMutation(event: VaultMutationEvent): boolean
```

Returns `true` if the event was handled incrementally (caller skips `debouncedRefresh`).  
Returns `false` if incremental handling was skipped (caller proceeds with full refresh as today).

**Changed in `handleVaultMutation`:**

```
if (applyIncrementalMutation(event)) {
  pushState();
  return { shouldRefresh: false, ... };
}
// else: existing shouldRefresh = true path
```

**`main.ts`:** No changes needed — the `shouldRefresh` field in `VaultMutationResult` already gates `debouncedRefresh`.

### Invariants Preserved

- **generation-based stale check**: Incremental mutations do **not** bump `generation`. Hydration calls already carry `generation` and check staleness.
- **pendingHydration**: On `modify`, the card's index is removed from `pendingHydration` before resetting `hydrated`, so the next `hydrateRange` call picks it up cleanly.
- **folderLoadKey**: Not changed by incremental mutations, preventing spurious reload triggers.
- **Debounce**: The 250ms `debouncedRefresh` is only called when `shouldRefresh: true`, which incremental events no longer set.

## Out of Scope

- Folder-level create/delete (these are rare and safe to full-reload).
- Settings changes (sort order change still requires full reload).
- "All notes" view (Task 9, not yet implemented).
