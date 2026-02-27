# Design: Task 9 — "All Notes" View

**Date:** 2026-02-27  
**Status:** Approved

## Summary

Add an "All Notes" toolbar button that loads every Markdown file in the vault into the card view, without requiring the user to select a folder first. Uses a sentinel constant `ALL_NOTES_PATH = "__all__"` as an internal marker so the existing folder-based load path requires minimal changes.

---

## 1. Constant & Settings

### New constant
Export `ALL_NOTES_PATH = "__all__"` from `src/view/types.ts`. Used everywhere a folder path is expected to distinguish the all-notes mode from a real folder path.

### Settings change
Add `lastViewMode: "folder" | "all-notes"` to `PluginSettings` with default `"folder"`.  
`PartialPluginSettings` gets the same optional field.  
`normalizeSettings` normalizes the new field.  
`mergeSettings` merges it correctly.

---

## 2. Toolbar Button

In `FolderCardPanel.svelte`, insert a new entry in `TOOLBAR_ACTIONS` immediately after `pick-folder`:

```js
{ id: "all-notes", label: "All notes", title: "All notes", icon: "library" }
```

Clicking it dispatches `toolbar-action` with `action: "all-notes"`.  
`fce-toolbar-content` area: leave existing placeholder structure untouched for now.  
`describeToolbarAction` gets a new branch for `"all-notes"`: `"Showing all Markdown notes in the vault."` (placeholder, consistent with existing style).

---

## 3. FolderCardView Changes

### `handleFolderSelection`
When `request.folderPath === ALL_NOTES_PATH`, skip the `vault.getAbstractFileByPath` folder validation and proceed directly to `runLoad`. Pass a virtual `TFolder`-shaped sentinel or refactor `runLoad` to accept a path string — see implementation note below.

> **Implementation note:** `runLoad` currently takes a `TFolder`. For the all-notes case, refactor `runLoad` to accept `folderPath: string` and look up the folder only when needed, or introduce a separate `runAllNotesLoad` method that shares the same lock/state machinery.

### `collectMarkdownFiles`
Add a branch: when `folderPath === ALL_NOTES_PATH`, recurse from `vault.getRoot()` with `includeSubfolders` forced `true`, collecting all `.md` files vault-wide.

### `isPathInScope`
When `this.folderPath === ALL_NOTES_PATH`, return `true` for any `.md` file path.

### `shouldRefreshForVaultEvent`
When `this.folderPath === ALL_NOTES_PATH`, all markdown create/modify/delete/rename events trigger refresh (folder events still ignored for incremental, deferred to full reload).

### `pushState` display name
Pass `folderPath` to the Svelte component as `"All Notes"` when `this.folderPath === ALL_NOTES_PATH`, so the `fce-folder` line shows the right label.

### `folderLoadKey` serialization
`serializeLoadKey` / `buildLoadKey` already uses `folderPath` as a string key — `ALL_NOTES_PATH` serializes naturally with no special casing needed.

---

## 4. main.ts Changes

### New method: `selectAllNotes()`
Public method on `FolderCardExplorerPlugin`:
1. Build a `FolderSelectionRequest` with `folderPath: ALL_NOTES_PATH`.
2. Call `activateView()`.
3. Dispatch the selection request to views.
4. Persist `lastViewMode: "all-notes"` (clear `lastFolderPath` or leave it — last folder is preserved so switching back works).

### `openFolderPicker` / `selectFolder`
When a folder is selected via picker or explorer click, persist `lastViewMode: "folder"` alongside `lastFolderPath`.

### Rename `restoreLastFolder` → `restoreLastSession`
Check `lastViewMode` first:
- `"all-notes"` → call `selectAllNotes()`.
- `"folder"` (default) → run existing `lastFolderPath` restore logic.

### `requestRefreshForViews`
Current guard: `if (!this.selectedFolderPath) return`. When in all-notes mode, `selectedFolderPath` will be `ALL_NOTES_PATH` (non-null), so no change needed here.

### `onFileExplorerClick` / `selectFolder`
After a successful folder selection, save `lastViewMode: "folder"` to settings (so switching from all-notes back to a folder persists correctly on next restart).

---

## 5. Svelte UI (FolderCardPanel.svelte)

- `TOOLBAR_ACTIONS`: insert `all-notes` button after `pick-folder`.
- `activeToolbarDescription`: add `"all-notes"` branch.
- `fce-folder` display: driven by the `folderPath` prop. Since `FolderCardView` substitutes `"All Notes"` before calling `$set`, Svelte needs no special logic — it just renders what it receives.
- `fce-count`: unchanged — `{cards.length} notes` works for all-notes mode too.
- Button selected state: handled automatically by `activeToolbarAction === action.id`.

---

## 6. What Is NOT Changed

- Virtualized scroll logic — unchanged.
- Hydration batch logic — unchanged.
- Incremental mutation logic for folder events — unchanged (still defers to full reload).
- `includeSubfolders` setting — ignored when in all-notes mode (all-notes always recurses full vault).
- Existing toolbar placeholder content (`fce-toolbar-title`, `fce-toolbar-description`) — untouched.

---

## Out of Scope

- Filtering/sorting within all-notes view (covered by Task 11–12).
- Persisting scroll position per view mode.
