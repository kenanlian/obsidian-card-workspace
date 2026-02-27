# Panel Folder Picker — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to pick a folder from within the plugin panel via a fuzzy search modal, and persist the last-selected folder across restarts.

**Architecture:** A new `FolderPickerModal` class extends Obsidian's `FuzzySuggestModal<TFolder>` to enumerate all vault folders. The existing toolbar `pick-folder` button triggers it via a new event listener. Settings are extended with `lastFolderPath` for persistence, and the plugin restores the folder on startup.

**Tech Stack:** TypeScript (strict), Obsidian API (`FuzzySuggestModal`, `TFolder`), Svelte 4

---

### Task 1: Extend `FolderSelectionSource` type

**Files:**
- Modify: `src/view/types.ts:16`

**Step 1: Add `"panel-picker"` to the union type**

In `src/view/types.ts`, change line 16 from:

```ts
export type FolderSelectionSource = "explorer-click" | "programmatic";
```

to:

```ts
export type FolderSelectionSource = "explorer-click" | "programmatic" | "panel-picker";
```

**Step 2: Verify**

```bash
npm run check
```

Expected: PASS (no consumers pattern-match exhaustively on this type).

**Step 3: Commit**

```bash
git add src/view/types.ts
git commit -m "types: add panel-picker to FolderSelectionSource"
```

---

### Task 2: Add `lastFolderPath` to settings

**Files:**
- Modify: `src/settings.ts:7-17` (PluginSettings interface)
- Modify: `src/settings.ts:19-29` (PartialPluginSettings interface)
- Modify: `src/settings.ts:31-41` (DEFAULT_SETTINGS)
- Modify: `src/settings.ts:67-86` (normalizeSettings)
- Modify: `src/settings.ts:88-101` (mergeSettings)

**Step 1: Add `lastFolderPath` field to `PluginSettings`**

Add after line 16 (`defaultView: DefaultViewMode;`):

```ts
  lastFolderPath: string | null;
```

**Step 2: Add optional field to `PartialPluginSettings`**

Add after line 28 (`defaultView?: DefaultViewMode;`):

```ts
  lastFolderPath?: string | null;
```

**Step 3: Add default value to `DEFAULT_SETTINGS`**

Add after line 40 (`defaultView: "cards",`):

```ts
  lastFolderPath: null,
```

**Step 4: Add normalization to `normalizeSettings`**

Add after line 84 (`defaultView: normalizeDefaultView(data.defaultView),`):

```ts
    lastFolderPath:
      typeof data.lastFolderPath === "string" && data.lastFolderPath.length > 0
        ? data.lastFolderPath
        : null,
```

**Step 5: Update `mergeSettings` to pass through `lastFolderPath`**

The current `mergeSettings` does a shallow spread of `current` and `patch`, then
deep-merges `sort` and `filter`. Since `lastFolderPath` is a flat field (not
nested), the existing `...current, ...patch` spread already handles it correctly.
No change needed in `mergeSettings`.

**Step 6: Verify**

```bash
npm run check
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/settings.ts
git commit -m "settings: add lastFolderPath for folder persistence"
```

---

### Task 3: Create `FolderPickerModal`

**Files:**
- Create: `src/FolderPickerModal.ts`

**Step 1: Write the modal class**

Create `src/FolderPickerModal.ts` with the following content:

```ts
import { App, FuzzySuggestModal, TFolder } from "obsidian";

export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
  private folders: TFolder[];
  private onSelect: (folder: TFolder) => void;

  constructor(app: App, onSelect: (folder: TFolder) => void) {
    super(app);
    this.onSelect = onSelect;
    this.folders = this.collectAllFolders();
    this.setPlaceholder("Type to search folders...");
  }

  getItems(): TFolder[] {
    return this.folders;
  }

  getItemText(folder: TFolder): string {
    return folder.path === "/" ? "/" : folder.path;
  }

  onChooseItem(folder: TFolder): void {
    this.onSelect(folder);
  }

  private collectAllFolders(): TFolder[] {
    const result: TFolder[] = [];
    const stack: TFolder[] = [this.app.vault.getRoot()];
    while (stack.length > 0) {
      const current = stack.pop()!;
      result.push(current);
      for (const child of current.children) {
        if (child instanceof TFolder) {
          stack.push(child);
        }
      }
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }
}
```

**Step 2: Verify**

```bash
npm run check
```

Expected: PASS (class is self-contained, no consumers yet).

**Step 3: Commit**

```bash
git add src/FolderPickerModal.ts
git commit -m "feat: add FolderPickerModal with fuzzy folder search"
```

---

### Task 4: Add `openFolderPicker()` to plugin and persist selection

**Files:**
- Modify: `src/main.ts`

**Step 1: Add import for `FolderPickerModal`**

At line 11 (after the `FolderCardView` import), add:

```ts
import { FolderPickerModal } from "./FolderPickerModal";
```

**Step 2: Add `openFolderPicker()` method**

Add the following public method to `FolderCardExplorerPlugin`, after the
`openNoteFromCard` method (after line 78):

```ts
  openFolderPicker(): void {
    new FolderPickerModal(this.app, (folder) => {
      void this.selectFolder(folder, "panel-picker");
    }).open();
  }
```

**Step 3: Extract folder selection + persistence into a shared helper**

Add the following private method after `openFolderPicker`:

```ts
  private async selectFolder(
    folder: TFolder,
    source: FolderSelectionSource,
  ): Promise<void> {
    const request = this.createSelectionRequest(folder.path, source);
    await this.activateView();
    if (request.requestId !== this.latestHandledRequestId) {
      return;
    }
    this.dispatchSelectionRequest(request);
    await this.saveData(
      mergeSettings(this.settings, { lastFolderPath: folder.path }),
    );
    this.settings = mergeSettings(this.settings, { lastFolderPath: folder.path });
  }
```

**Step 4: Refactor `onFileExplorerClick` to use `selectFolder`**

Replace the body of `onFileExplorerClick` (lines 104-127) with:

```ts
  private async onFileExplorerClick(event: MouseEvent): Promise<void> {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    const folderPath = this.extractFolderPathFromTarget(target);
    if (!folderPath) {
      return;
    }

    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      return;
    }

    await this.selectFolder(folder, "explorer-click");
  }
```

**Step 5: Add `FolderSelectionSource` to imports**

The import for `FolderSelectionSource` is already present on line 12 (as a type import).
It's imported as `import type { ... FolderSelectionSource ... }`. Since it's used
as a parameter type in `selectFolder`, the existing type import is sufficient.

**Step 6: Verify**

```bash
npm run check
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/main.ts
git commit -m "feat: add openFolderPicker and persist folder selection"
```

---

### Task 5: Wire `toolbar-action` event in `FolderCardView`

**Files:**
- Modify: `src/view/FolderCardView.ts:60-82` (onOpen method)

**Step 1: Add `toolbar-action` event listener in `onOpen()`**

After the existing `hydrate-range` listener (after line 81), add:

```ts
    this.component.$on("toolbar-action", (event: any) => {
      if (event.detail.action === "pick-folder") {
        this.plugin.openFolderPicker();
      }
    });
```

The complete `onOpen` method should now be:

```ts
  async onOpen(): Promise<void> {
    const target = (this.containerEl.children[1] as HTMLElement) ?? this.containerEl;
    target.empty();

    this.hostEl = target.createDiv({ cls: "folder-card-view" });
    this.component = new FolderCardPanel({
      target: this.hostEl,
      props: {
        cards: this.cards,
        folderPath: this.folderPath ?? "",
        selectedPath: this.selectedPath,
        loading: this.loading,
        generation: this.generation,
      },
    });

    this.component.$on("open-note", (event: any) => {
      this.plugin.openNoteFromCard(event.detail.path);
    });
    this.component.$on("hydrate-range", (event: any) => {
      void this.hydrateRange(event.detail.start, event.detail.end);
    });
    this.component.$on("toolbar-action", (event: any) => {
      if (event.detail.action === "pick-folder") {
        this.plugin.openFolderPicker();
      }
    });
  }
```

**Step 2: Verify**

```bash
npm run check
```

Expected: PASS.

**Step 3: Commit**

```bash
git add src/view/FolderCardView.ts
git commit -m "feat: wire pick-folder toolbar action to folder picker modal"
```

---

### Task 6: Restore last folder on startup

**Files:**
- Modify: `src/main.ts` (onLayoutReady callback, lines 51-55)

**Step 1: Add folder restoration in `onLayoutReady`**

Replace the `onLayoutReady` callback (lines 51-55) with:

```ts
    this.app.workspace.onLayoutReady(() => {
      this.registerVaultObservers();
      const activeFile = this.app.workspace.getActiveFile();
      this.syncSelection(activeFile?.path ?? null);
      void this.restoreLastFolder();
    });
```

**Step 2: Add `restoreLastFolder()` method**

Add the following private method to the plugin class (after `loadSettings`):

```ts
  private async restoreLastFolder(): Promise<void> {
    const lastPath = this.settings.lastFolderPath;
    if (!lastPath) {
      return;
    }

    const folder = this.app.vault.getAbstractFileByPath(lastPath);
    if (!(folder instanceof TFolder)) {
      return;
    }

    const request = this.createSelectionRequest(folder.path, "programmatic");
    await this.activateView();
    if (request.requestId !== this.latestHandledRequestId) {
      return;
    }
    this.dispatchSelectionRequest(request);
  }
```

Note: `restoreLastFolder` does NOT call `selectFolder` (which would re-persist
the same path and trigger an unnecessary disk write). It directly creates a
selection request with source `"programmatic"`.

**Step 3: Verify**

```bash
npm run check
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: restore last selected folder on plugin startup"
```

---

### Task 7: Update Svelte description text

**Files:**
- Modify: `src/view/FolderCardPanel.svelte:200-205` (describeToolbarAction)

**Step 1: Update pick-folder description**

Replace the `pick-folder` branch in `describeToolbarAction` (lines 201-204):

```js
    if (actionId === "pick-folder") {
      return currentFolderPath
        ? "Current folder can be changed from File Explorer."
        : "Click a folder in File Explorer to load cards.";
    }
```

with:

```js
    if (actionId === "pick-folder") {
      return currentFolderPath
        ? "Click to change folder, or pick from File Explorer."
        : "Click to pick a folder, or select one in File Explorer.";
    }
```

**Step 2: Also update the empty-state prompt (line 250)**

Replace line 250:

```svelte
        <p class="fce-folder">Click a folder in File Explorer to preview notes.</p>
```

with:

```svelte
        <p class="fce-folder">Pick a folder to preview notes.</p>
```

**Step 3: Verify**

```bash
npm run check
```

Expected: PASS.

**Step 4: Commit**

```bash
git add src/view/FolderCardPanel.svelte
git commit -m "ui: update pick-folder description to reflect panel picker"
```

---

### Task 8: Final build verification

**Step 1: Run full type check**

```bash
npm run check
```

Expected: PASS with no errors.

**Step 2: Run production build**

```bash
npm run build
```

Expected: PASS, `main.js` output with no errors.

**Step 3: Manual smoke test checklist**

- [ ] Open Obsidian with the plugin loaded
- [ ] Click the `pick-folder` button in the toolbar -> fuzzy modal appears
- [ ] Type a folder name -> results filter correctly
- [ ] Select a folder -> cards load in the panel
- [ ] Click a different folder in File Explorer -> cards update
- [ ] Restart Obsidian -> last selected folder auto-loads
- [ ] Delete the last-selected folder, restart -> no crash, empty state shown

**Step 4: Commit (mark task complete)**

```bash
# Update dev_plan.md: mark Task 8 as done
git add dev_plan.md
git commit -m "docs: mark Task 8 as completed"
```
