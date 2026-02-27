# Panel Folder Picker — Design Document

## Problem

The plugin currently requires users to click a folder in Obsidian's File Explorer
to load cards. This creates a dependency on the File Explorer sidebar being open
and visible, and feels disconnected from the plugin's own UI. Additionally, the
selected folder is lost on plugin reload because it is only stored in memory.

## Decision

Use Obsidian's native `FuzzySuggestModal<TFolder>` triggered by the existing
`pick-folder` toolbar button. The modal lists all vault folders with fuzzy search.
The File Explorer click path is preserved as an alternate entry point.

Persist `lastFolderPath` to `PluginSettings` so the selected folder auto-restores
on plugin restart.

## Rejected Alternatives

**Inline folder tree** — Higher implementation cost (~200-350 lines Svelte +
custom ARIA tree), occupies toolbar-content space, requires manual keyboard
navigation. Deferred as a potential future enhancement.

## Data Flow

```
pick-folder button click
  → Svelte dispatches toolbar-action { action: "pick-folder" }
  → FolderCardView listens for toolbar-action, calls plugin.openFolderPicker()
  → FolderPickerModal.open()
  → User selects TFolder
  → onChooseItem callback
  → plugin creates FolderSelectionRequest(source: "panel-picker")
  → existing handleFolderSelection() pipeline
  → plugin.saveSettings({ lastFolderPath: folder.path })
```

## Changes

| File | Change |
|---|---|
| `src/view/types.ts` | Add `"panel-picker"` to `FolderSelectionSource` |
| `src/settings.ts` | Add `lastFolderPath: string \| null` to `PluginSettings` |
| `src/FolderPickerModal.ts` | New file: `FuzzySuggestModal<TFolder>` |
| `src/main.ts` | Add `openFolderPicker()`; persist path on selection; restore on startup |
| `src/view/FolderCardView.ts` | Listen for `toolbar-action` event in `onOpen()` |
| `src/view/FolderCardPanel.svelte` | Update `pick-folder` description text |
