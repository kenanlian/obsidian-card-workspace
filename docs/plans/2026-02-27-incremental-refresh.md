# Task 7: Incremental Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace full-folder rebuilds on vault mutations with per-event surgical updates to the `cards` array, preserving hydrated preview content for unaffected cards.

**Architecture:** Add `applyIncrementalMutation(event)` to `FolderCardView` that handles each vault event type in place. `handleVaultMutation` calls it first; if it returns `true`, `shouldRefresh: false` is returned so `debouncedRefresh` is never called. A binary-search helper finds the correct sorted insertion position for `create` and scope-entry `rename`.

**Tech Stack:** TypeScript strict, Obsidian plugin API (TFile / TFolder), Svelte 4 `$set` for UI push.

---

### Task 1: Add `IncrementalMutationResult` type and extend `VaultMutationResult`

**Files:**
- Modify: `src/view/types.ts`

**Step 1: Add the new type and extend the existing result type**

Open `src/view/types.ts` and make these two changes:

1. After the `VaultMutationQueueAction` type, add:

```ts
export type IncrementalAction =
  | "inserted"
  | "removed"
  | "updated"
  | "hydration_reset"
  | "skipped_not_found"
  | "skipped_no_folder"
  | "skipped_folder_event"
  | "deferred_full_reload";

export interface IncrementalMutationResult {
  handled: boolean;
  action: IncrementalAction;
}
```

2. Add `incrementalResult: IncrementalMutationResult | null` to `VaultMutationResult`:

```ts
export interface VaultMutationResult {
  shouldRefresh: boolean;
  queueAction: VaultMutationQueueAction;
  selectedFolderPathAfterRename: string | null;
  incrementalResult: IncrementalMutationResult | null;
}
```

**Step 2: Verify TypeScript check passes**

Run: `npm run check`
Expected: No errors (existing callers of `VaultMutationResult` will need `incrementalResult` added — fix any errors in the same step by adding `incrementalResult: null` to the two return sites in `FolderCardView.ts::handleVaultMutation`).

**Step 3: Fix existing return sites in `FolderCardView.ts`**

In `handleVaultMutation`, both return statements need `incrementalResult: null` added:

```ts
// first return (shouldRefresh: false)
return {
  shouldRefresh: false,
  queueAction: "ignored",
  selectedFolderPathAfterRename,
  incrementalResult: null,
};

// second return (shouldRefresh: true)
return {
  shouldRefresh: true,
  queueAction,
  selectedFolderPathAfterRename,
  incrementalResult: null,
};
```

**Step 4: Verify again**

Run: `npm run check`
Expected: No type errors.

**Step 5: Commit**

```bash
git add src/view/types.ts src/view/FolderCardView.ts
git commit -m "types: add IncrementalMutationResult and extend VaultMutationResult"
```

---

### Task 2: Add binary-search sorted-insert helper

**Files:**
- Modify: `src/view/FolderCardView.ts`

**Step 1: Add `findSortedInsertIndex` private method**

Add this method to `FolderCardView`, after `compareCards`:

```ts
private findSortedInsertIndex(newCard: NoteCardRecord): number {
  let low = 0;
  let high = this.cards.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const existingCard = this.cards[mid];
    if (!existingCard) {
      break;
    }
    const cmp = this.compareCards(
      existingCard,
      newCard,
      this.plugin.getSettings().sort.field,
      this.plugin.getSettings().sort.direction,
    );
    if (cmp <= 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}
```

**Step 2: Verify**

Run: `npm run check`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/view/FolderCardView.ts
git commit -m "feat: add binary-search sorted-insert helper to FolderCardView"
```

---

### Task 3: Implement `applyIncrementalMutation` — `delete` case

**Files:**
- Modify: `src/view/FolderCardView.ts`

**Step 1: Add the method skeleton and handle `delete`**

Add a new private method after `findSortedInsertIndex`:

```ts
private applyIncrementalMutation(event: VaultMutationEvent): IncrementalMutationResult {
  if (!this.folderPath) {
    return { handled: false, action: "skipped_no_folder" };
  }

  if (event.isFolder) {
    // Folder-level events (other than rename path-rewrite already handled above)
    // are deferred to full reload for safety.
    return { handled: false, action: "skipped_folder_event" };
  }

  if (!event.isMarkdown) {
    return { handled: false, action: "skipped_folder_event" };
  }

  if (event.eventType === "delete") {
    const targetPath = event.path;
    const index = this.cards.findIndex((c) => c.path === targetPath);
    if (index === -1) {
      return { handled: true, action: "skipped_not_found" };
    }
    this.pendingHydration.delete(index);
    // Rebuild pendingHydration indices for cards after the removed one
    const shifted = new Set<number>();
    for (const idx of this.pendingHydration) {
      shifted.add(idx > index ? idx - 1 : idx);
    }
    this.pendingHydration = shifted;
    this.cards.splice(index, 1);
    return { handled: true, action: "removed" };
  }

  return { handled: false, action: "deferred_full_reload" };
}
```

Also add the import for `IncrementalMutationResult` at the top of the file if it is not already imported (it is in `types.ts`):

```ts
import type {
  CleanupResult,
  FolderLoadKey,
  FolderSelectionRequest,
  IncrementalMutationResult,
  NoteCardRecord,
  RefreshRequest,
  RefreshResult,
  SelectionResult,
  VaultMutationEvent,
  VaultMutationResult,
} from "./types";
```

**Step 2: Verify**

Run: `npm run check`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/view/FolderCardView.ts
git commit -m "feat: implement incremental delete in applyIncrementalMutation"
```

---

### Task 4: Implement `applyIncrementalMutation` — `create` case

**Files:**
- Modify: `src/view/FolderCardView.ts`

**Step 1: Add `create` handler inside `applyIncrementalMutation`, before the final fallthrough**

Insert after the `delete` block and before the final `return { handled: false, ... }`:

```ts
if (event.eventType === "create") {
  const settings = this.plugin.getSettings();
  if (!this.isPathInScope(event.path, settings.includeSubfolders)) {
    return { handled: true, action: "skipped_not_found" };
  }

  // Avoid duplicates (e.g. rapid create+modify)
  const alreadyExists = this.cards.some((c) => c.path === event.path);
  if (alreadyExists) {
    return { handled: true, action: "skipped_not_found" };
  }

  const file = this.app.vault.getAbstractFileByPath(event.path);
  if (!(file instanceof TFile)) {
    return { handled: false, action: "deferred_full_reload" };
  }

  const newCard: NoteCardRecord = {
    file,
    path: file.path,
    title: file.basename,
    ctime: file.stat.ctime,
    mtime: file.stat.mtime,
    excerpt: "",
    previewHtml: "",
    previewMode: "empty",
    hydrated: false,
  };

  const insertIndex = this.findSortedInsertIndex(newCard);
  this.cards.splice(insertIndex, 0, newCard);

  // Shift pendingHydration indices for cards after insertion point
  const shifted = new Set<number>();
  for (const idx of this.pendingHydration) {
    shifted.add(idx >= insertIndex ? idx + 1 : idx);
  }
  this.pendingHydration = shifted;

  // Hydrate the new card immediately
  void this.hydrateCard(insertIndex, this.generation).then(() => {
    if (this.generation === this.generation) {
      this.pushState();
    }
  });

  return { handled: true, action: "inserted" };
}
```

Note: `TFile` is already imported at the top of `FolderCardView.ts`.

**Step 2: Verify**

Run: `npm run check`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/view/FolderCardView.ts
git commit -m "feat: implement incremental create in applyIncrementalMutation"
```

---

### Task 5: Implement `applyIncrementalMutation` — `modify` case

**Files:**
- Modify: `src/view/FolderCardView.ts`

**Step 1: Add `modify` handler inside `applyIncrementalMutation`**

Insert after the `create` block:

```ts
if (event.eventType === "modify") {
  const index = this.cards.findIndex((c) => c.path === event.path);
  if (index === -1) {
    return { handled: true, action: "skipped_not_found" };
  }

  const card = this.cards[index];
  if (!card) {
    return { handled: true, action: "skipped_not_found" };
  }

  // Reset hydration so viewport pass re-reads content
  card.hydrated = false;
  card.previewHtml = "";
  card.previewMode = "empty";
  this.pendingHydration.delete(index);

  return { handled: true, action: "hydration_reset" };
}
```

**Step 2: Verify**

Run: `npm run check`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/view/FolderCardView.ts
git commit -m "feat: implement incremental modify (hydration reset) in applyIncrementalMutation"
```

---

### Task 6: Implement `applyIncrementalMutation` — `rename` (file) case

**Files:**
- Modify: `src/view/FolderCardView.ts`

**Step 1: Add `rename` file handler**

Insert after the `modify` block:

```ts
if (event.eventType === "rename" && !event.isFolder) {
  const settings = this.plugin.getSettings();
  const oldIndex = event.oldPath
    ? this.cards.findIndex((c) => c.path === event.oldPath)
    : -1;

  const newInScope = this.isPathInScope(event.path, settings.includeSubfolders);

  if (oldIndex !== -1) {
    if (!newInScope) {
      // File moved out of scope — remove it
      const shifted = new Set<number>();
      for (const idx of this.pendingHydration) {
        if (idx !== oldIndex) {
          shifted.add(idx > oldIndex ? idx - 1 : idx);
        }
      }
      this.pendingHydration = shifted;
      this.cards.splice(oldIndex, 1);
      return { handled: true, action: "removed" };
    }

    // Update in-place
    const card = this.cards[oldIndex];
    if (!card) {
      return { handled: false, action: "deferred_full_reload" };
    }

    const file = this.app.vault.getAbstractFileByPath(event.path);
    if (!(file instanceof TFile)) {
      return { handled: false, action: "deferred_full_reload" };
    }

    card.file = file;
    card.path = file.path;
    card.title = file.basename;
    return { handled: true, action: "updated" };
  }

  // Old path not in cards — file may have moved into scope
  if (newInScope) {
    const alreadyExists = this.cards.some((c) => c.path === event.path);
    if (!alreadyExists) {
      const file = this.app.vault.getAbstractFileByPath(event.path);
      if (!(file instanceof TFile)) {
        return { handled: false, action: "deferred_full_reload" };
      }

      const newCard: NoteCardRecord = {
        file,
        path: file.path,
        title: file.basename,
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
        excerpt: "",
        previewHtml: "",
        previewMode: "empty",
        hydrated: false,
      };

      const insertIndex = this.findSortedInsertIndex(newCard);
      this.cards.splice(insertIndex, 0, newCard);

      const shifted = new Set<number>();
      for (const idx of this.pendingHydration) {
        shifted.add(idx >= insertIndex ? idx + 1 : idx);
      }
      this.pendingHydration = shifted;

      void this.hydrateCard(insertIndex, this.generation).then(() => {
        this.pushState();
      });

      return { handled: true, action: "inserted" };
    }
  }

  return { handled: true, action: "skipped_not_found" };
}
```

**Step 2: Verify**

Run: `npm run check`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/view/FolderCardView.ts
git commit -m "feat: implement incremental rename (file) in applyIncrementalMutation"
```

---

### Task 7: Wire `applyIncrementalMutation` into `handleVaultMutation`

**Files:**
- Modify: `src/view/FolderCardView.ts`

**Step 1: Call `applyIncrementalMutation` at the top of `handleVaultMutation`**

The current `handleVaultMutation` method body:

```ts
handleVaultMutation(event: VaultMutationEvent): VaultMutationResult {
  let selectedFolderPathAfterRename: string | null = null;
  if (event.eventType === "rename" && event.isFolder && event.oldPath) {
    const renamedPath = this.rewritePathAfterRename(this.folderPath, event.oldPath, event.path);
    if (renamedPath !== this.folderPath) {
      this.folderPath = renamedPath;
      this.folderLoadKey = renamedPath ? this.serializeLoadKey(this.buildLoadKey(renamedPath)) : null;
      selectedFolderPathAfterRename = renamedPath;
    }
  }

  if (!this.shouldRefreshForVaultEvent(event)) {
    return {
      shouldRefresh: false,
      queueAction: "ignored",
      selectedFolderPathAfterRename,
      incrementalResult: null,
    };
  }

  const queueAction = this.inFlight ? "deferred_while_inflight" : "enqueued";
  this.refreshQueued = true;

  return {
    shouldRefresh: true,
    queueAction,
    selectedFolderPathAfterRename,
    incrementalResult: null,
  };
}
```

Replace this method with the new version that tries incremental first:

```ts
handleVaultMutation(event: VaultMutationEvent): VaultMutationResult {
  let selectedFolderPathAfterRename: string | null = null;
  if (event.eventType === "rename" && event.isFolder && event.oldPath) {
    const renamedPath = this.rewritePathAfterRename(this.folderPath, event.oldPath, event.path);
    if (renamedPath !== this.folderPath) {
      this.folderPath = renamedPath;
      this.folderLoadKey = renamedPath ? this.serializeLoadKey(this.buildLoadKey(renamedPath)) : null;
      selectedFolderPathAfterRename = renamedPath;
    }
  }

  if (!this.shouldRefreshForVaultEvent(event)) {
    return {
      shouldRefresh: false,
      queueAction: "ignored",
      selectedFolderPathAfterRename,
      incrementalResult: null,
    };
  }

  // Attempt incremental update. Only fall back to full reload if not handled.
  if (!this.inFlight && !this.loading) {
    const incrementalResult = this.applyIncrementalMutation(event);
    if (incrementalResult.handled) {
      this.pushState();
      return {
        shouldRefresh: false,
        queueAction: "ignored",
        selectedFolderPathAfterRename,
        incrementalResult,
      };
    }
  }

  const queueAction = this.inFlight ? "deferred_while_inflight" : "enqueued";
  this.refreshQueued = true;

  return {
    shouldRefresh: true,
    queueAction,
    selectedFolderPathAfterRename,
    incrementalResult: null,
  };
}
```

**Step 2: Verify TypeScript check**

Run: `npm run check`
Expected: No errors.

**Step 3: Build**

Run: `npm run build`
Expected: Produces `main.js` with no errors.

**Step 4: Commit**

```bash
git add src/view/FolderCardView.ts
git commit -m "feat: wire applyIncrementalMutation into handleVaultMutation"
```

---

### Task 8: Final validation

**Step 1: Full check + build**

```bash
npm run check && npm run build
```

Expected: Both pass cleanly.

**Step 2: Manual smoke test in Obsidian**

1. Open the plugin in Obsidian, click a folder with several notes.
2. Create a new `.md` file in that folder — card should appear immediately without loader.
3. Modify the note content — card preview should reset and re-hydrate on scroll.
4. Rename the note — card title should update in place.
5. Delete the note — card should disappear.
6. Rename the folder itself — cards should remain after path update.

**Step 3: Commit (if any cleanup needed)**

```bash
git add -A
git commit -m "chore: post-integration cleanup for Task 7 incremental refresh"
```
