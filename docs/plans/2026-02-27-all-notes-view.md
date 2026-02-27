# All Notes View Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an "All Notes" toolbar button that loads every Markdown file in the vault into the card view, with full persistence across restarts.

**Architecture:** Introduce `ALL_NOTES_PATH = "__all__"` as an internal sentinel constant. Extend `FolderCardView` to accept this sentinel as a virtual folder path, bypassing folder validation and collecting all vault `.md` files. Extend settings with `lastViewMode` for persistence. Wire a new toolbar button in Svelte to dispatch the action.

**Tech Stack:** TypeScript (strict), Svelte 4, Obsidian Plugin API

---

### Task 1: Add `ALL_NOTES_PATH` constant and `lastViewMode` to types/settings

**Files:**
- Modify: `src/view/types.ts`
- Modify: `src/settings.ts`

**Step 1: Add constant to `types.ts`**

In `src/view/types.ts`, add after the imports at the top:

```typescript
export const ALL_NOTES_PATH = "__all__";
```

**Step 2: Add `lastViewMode` to `PluginSettings` in `src/settings.ts`**

Add `lastViewMode: "folder" | "all-notes"` to the `PluginSettings` interface:

```typescript
export type ViewMode = "folder" | "all-notes";

export interface PluginSettings {
  sort: { field: SortField; direction: SortDirection };
  filter: { tags: string[] };
  includeSubfolders: boolean;
  defaultView: DefaultViewMode;
  lastFolderPath: string | null;
  lastViewMode: ViewMode;
}
```

Add the same optional field to `PartialPluginSettings`:

```typescript
export interface PartialPluginSettings {
  sort?: { field?: SortField; direction?: SortDirection };
  filter?: { tags?: string[] };
  includeSubfolders?: boolean;
  defaultView?: DefaultViewMode;
  lastFolderPath?: string | null;
  lastViewMode?: ViewMode;
}
```

Add to `DEFAULT_SETTINGS`:

```typescript
lastViewMode: "folder",
```

Add normalization helper and update `normalizeSettings`:

```typescript
function normalizeViewMode(value: unknown): ViewMode {
  return value === "all-notes" ? "all-notes" : "folder";
}

// inside normalizeSettings return:
lastViewMode: normalizeViewMode(data.lastViewMode),
```

**Step 3: Run type check**

```bash
npm run check
```
Expected: no errors.

**Step 4: Commit**

```bash
git add src/view/types.ts src/settings.ts
git commit -m "feat: add ALL_NOTES_PATH constant and lastViewMode setting"
```

---

### Task 2: Extend `FolderCardView` — load path for all-notes

**Files:**
- Modify: `src/view/FolderCardView.ts`

**Step 1: Import `ALL_NOTES_PATH`**

Add to the existing import from `./types`:

```typescript
import type { ..., } from "./types";
import { ALL_NOTES_PATH } from "./types";
```

**Step 2: Update `handleFolderSelection` to accept `ALL_NOTES_PATH`**

The current method starts with:
```typescript
const folder = this.app.vault.getAbstractFileByPath(request.folderPath);
if (!(folder instanceof TFolder)) {
  return { action: "rejected_invalid", ... };
}
```

Change to allow the sentinel to bypass folder validation:

```typescript
async handleFolderSelection(request: FolderSelectionRequest): Promise<SelectionResult> {
  const isAllNotes = request.folderPath === ALL_NOTES_PATH;
  const folder = isAllNotes
    ? null
    : this.app.vault.getAbstractFileByPath(request.folderPath);

  if (!isAllNotes && !(folder instanceof TFolder)) {
    return {
      action: "rejected_invalid",
      folderPath: request.folderPath,
      generationChanged: false,
      preserveUiState: true,
    };
  }

  const forceRefresh = request.forceRefresh ?? false;
  const loadKey = this.serializeLoadKey(this.buildLoadKey(request.folderPath));

  // ... rest unchanged (uses request.folderPath string directly in runLoad)
```

**Step 3: Refactor `runLoad` and `loadFolder` to accept a path string instead of `TFolder`**

Change signatures:

```typescript
private async runLoad(folderPath: string, loadKey: string): Promise<void> {
  const task = this.loadFolder(folderPath, loadKey);
  this.inFlight = task;
  this.inFlightKey = loadKey;
  try {
    await task;
  } finally {
    if (this.inFlight === task) {
      this.inFlight = null;
      this.inFlightKey = null;
    }
  }
}

private async loadFolder(folderPath: string, loadKey: string): Promise<void> {
  this.folderPath = folderPath;
  this.loading = true;
  this.cards = [];
  this.generation += 1;
  this.pendingHydration.clear();
  this.pushState();

  const buildGeneration = this.generation;
  const settings = this.plugin.getSettings();

  try {
    const files = this.collectMarkdownFiles(folderPath, settings.includeSubfolders);
    // ... rest unchanged
  } finally {
    // ... unchanged
  }
}
```

Update the call site in `handleFolderSelection`:
```typescript
await this.runLoad(request.folderPath, loadKey);
```

Also update `setFolder` which currently passes `folder` directly — change to pass `folder.path`.

**Step 4: Update `collectMarkdownFiles` to handle `ALL_NOTES_PATH`**

Change its signature from `(root: TFolder, ...)` to `(folderPath: string, ...)`:

```typescript
private collectMarkdownFiles(folderPath: string, includeSubfolders: boolean): TFile[] {
  const isAllNotes = folderPath === ALL_NOTES_PATH;
  const root = isAllNotes
    ? this.app.vault.getRoot()
    : this.app.vault.getAbstractFileByPath(folderPath);

  if (!(root instanceof TFolder)) {
    return [];
  }

  if (!isAllNotes && !includeSubfolders) {
    const directFiles: TFile[] = [];
    for (const child of root.children) {
      if (child instanceof TFile && child.extension.toLowerCase() === "md") {
        directFiles.push(child);
      }
    }
    return directFiles;
  }

  // recursive (all-notes always recurses)
  const result: TFile[] = [];
  const stack: TFolder[] = [root];
  while (stack.length > 0) {
    const folder = stack.pop();
    if (!folder) continue;
    for (const child of folder.children) {
      if (child instanceof TFolder) { stack.push(child); continue; }
      if (child instanceof TFile && child.extension.toLowerCase() === "md") {
        result.push(child);
      }
    }
  }
  return result;
}
```

**Step 5: Update `isPathInScope` to handle `ALL_NOTES_PATH`**

```typescript
private isPathInScope(path: string, includeSubfolders: boolean): boolean {
  if (!this.folderPath) return false;

  // All-notes mode: every markdown file is in scope
  if (this.folderPath === ALL_NOTES_PATH) return true;

  // ... existing logic unchanged
}
```

**Step 6: Update `pushState` display name**

```typescript
private pushState(): void {
  const displayFolderPath = this.folderPath === ALL_NOTES_PATH
    ? "All Notes"
    : (this.folderPath ?? "");

  this.component?.$set({
    cards: this.cards,
    folderPath: displayFolderPath,
    selectedPath: this.selectedPath,
    loading: this.loading,
    generation: this.generation,
  });
}
```

**Step 7: Update `handleVaultMutation` — `shouldRefreshForVaultEvent` already handles all-notes via `isPathInScope`; verify `rewritePathAfterRename` short-circuits correctly for `ALL_NOTES_PATH`**

In `handleVaultMutation`, the rename path-rewrite calls `rewritePathAfterRename(this.folderPath, ...)`. Since `ALL_NOTES_PATH` (`"__all__"`) will never equal any real vault path, the rename rewrite returns it unchanged — no change needed.

**Step 8: Run type check**

```bash
npm run check
```
Expected: no errors.

**Step 9: Commit**

```bash
git add src/view/FolderCardView.ts
git commit -m "feat: extend FolderCardView to support ALL_NOTES_PATH sentinel"
```

---

### Task 3: Extend `main.ts` — `selectAllNotes`, session persistence

**Files:**
- Modify: `src/main.ts`

**Step 1: Import `ALL_NOTES_PATH`**

```typescript
import { ALL_NOTES_PATH } from "./view/types";
```

**Step 2: Add `selectAllNotes()` public method**

```typescript
async selectAllNotes(): Promise<void> {
  const request = this.createSelectionRequest(ALL_NOTES_PATH, "panel-picker");
  await this.activateView();
  if (request.requestId !== this.latestHandledRequestId) {
    return;
  }
  this.dispatchSelectionRequest(request);
  this.selectedFolderPath = ALL_NOTES_PATH;
  await this.saveData(
    mergeSettings(this.settings, { lastViewMode: "all-notes" }),
  );
  this.settings = mergeSettings(this.settings, { lastViewMode: "all-notes" });
}
```

**Step 3: Update `selectFolder` to persist `lastViewMode: "folder"`**

In the existing `selectFolder` method, change the `saveData` call to also save `lastViewMode`:

```typescript
await this.saveData(
  mergeSettings(this.settings, {
    lastFolderPath: folder.path,
    lastViewMode: "folder",
  }),
);
this.settings = mergeSettings(this.settings, {
  lastFolderPath: folder.path,
  lastViewMode: "folder",
});
```

**Step 4: Rename `restoreLastFolder` → `restoreLastSession` and handle all-notes mode**

```typescript
private async restoreLastSession(): Promise<void> {
  if (this.settings.lastViewMode === "all-notes") {
    await this.selectAllNotes();
    return;
  }

  const lastPath = this.settings.lastFolderPath;
  if (!lastPath) return;

  const folder = this.app.vault.getAbstractFileByPath(lastPath);
  if (!(folder instanceof TFolder)) return;

  const request = this.createSelectionRequest(folder.path, "programmatic");
  await this.activateView();
  if (request.requestId !== this.latestHandledRequestId) return;
  this.dispatchSelectionRequest(request);
}
```

**Step 5: Update call site in `onload`**

Change:
```typescript
void this.restoreLastFolder();
```
To:
```typescript
void this.restoreLastSession();
```

**Step 6: Wire toolbar action in `FolderCardView.onOpen`**

In `FolderCardView.ts`, update the `toolbar-action` event handler to handle `"all-notes"`:

```typescript
this.component.$on("toolbar-action", (event: any) => {
  if (event.detail.action === "pick-folder") {
    this.plugin.openFolderPicker();
  } else if (event.detail.action === "all-notes") {
    void this.plugin.selectAllNotes();
  }
});
```

**Step 7: Run type check**

```bash
npm run check
```
Expected: no errors.

**Step 8: Commit**

```bash
git add src/main.ts src/view/FolderCardView.ts
git commit -m "feat: add selectAllNotes and restoreLastSession to main plugin"
```

---

### Task 4: Add toolbar button in `FolderCardPanel.svelte`

**Files:**
- Modify: `src/view/FolderCardPanel.svelte`

**Step 1: Insert `all-notes` into `TOOLBAR_ACTIONS` after `pick-folder`**

```javascript
const TOOLBAR_ACTIONS = [
  { id: "pick-folder", label: "Pick folder", title: "Folder scope", icon: "folder-open" },
  { id: "all-notes",  label: "All notes",  title: "All notes",    icon: "library"     },
  { id: "new-note",   label: "New",         title: "Create note",  icon: "file-plus"   },
  { id: "sort",       label: "Sort",        title: "Sort cards",   icon: "arrow-up-down"},
  { id: "filter",     label: "Filter",      title: "Filter cards", icon: "list-filter" },
  { id: "bulk",       label: "Bulk",        title: "Bulk actions", icon: "check-check" },
];
```

**Step 2: Add `"all-notes"` branch to `describeToolbarAction`**

```javascript
function describeToolbarAction(actionId, currentFolderPath) {
  if (actionId === "pick-folder") { ... }   // unchanged
  if (actionId === "all-notes") {
    return "Showing all Markdown notes in the vault.";
  }
  // ... rest unchanged
}
```

**Step 3: Run build to verify Svelte compiles**

```bash
npm run build
```
Expected: `main.js` produced with no errors.

**Step 4: Run full validation**

```bash
npm run check && npm run build && npm test
```
Expected: all pass.

**Step 5: Commit**

```bash
git add src/view/FolderCardPanel.svelte
git commit -m "feat: add All Notes toolbar button to FolderCardPanel"
```

---

### Task 5: Final validation and mark Task 9 complete

**Step 1: Run full validation suite**

```bash
npm run check && npm run build && npm test
```
Expected: all pass.

**Step 2: Mark Task 9 complete in `dev_plan.md`**

Change line 10:
```
- [ ] Task 9. [P1] "全部笔记"视图——覆盖全局浏览场景，提升插件主入口价值。
```
To:
```
- [x] Task 9. [P1] "全部笔记"视图——覆盖全局浏览场景，提升插件主入口价值。
```

**Step 3: Commit**

```bash
git add dev_plan.md
git commit -m "docs: mark Task 9 as completed"
```
