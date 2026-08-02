# Navigation pane context menus and a plugin-owned Favorites section

## Context

The left navigation pane (`src/view/NavigationPane.svelte`) has three sections — Folders, Tags, Boxes — and only the Boxes section has a right-click menu today. This change gives every section a header menu and a row menu, adds a fourth **Favorites** section pinned above the other three, and adds the file/folder operations those menus need (create note/canvas/base in a folder, duplicate a folder, rename a folder, search in a folder, copy path, reveal in system explorer).

Favorites is plugin-owned state persisted in settings (not Obsidian's Bookmarks core plugin, which has no public API). A favorite is a pure navigation shortcut to a folder, a card file, a tag, or a card box — it never becomes a browsable card scope of its own.

End state: right-clicking any nav header, any nav row, or any card offers the operations listed in *Step 12*; favorited items appear in a Favorites section at the top of the pane, survive renames, and disappear on delete.

## Approach

Steps are ordered so `npm run check && npm run build && npm test` passes after each one. Steps 1–7 are independent of each other except where noted and may be done in parallel; steps 8 onward are serial.

---

### Step 1 — Raise `minAppVersion` to 1.9.0

Obsidian's Bases core plugin and the `.base` file format shipped in Obsidian 1.9.0 (2025-05-21 desktop changelog). The "New base" menu item needs it.

Edit two files together — `scripts/check-release.mjs` line 63 asserts `versions.json[manifest.version] === manifest.minAppVersion`, so changing only the manifest breaks `npm run release:check`:

- `manifest.json`: `"minAppVersion": "1.5.0"` → `"1.9.0"`.
- `versions.json`: the `"0.6.1"` entry (the current `manifest.version`) `"1.5.0"` → `"1.9.0"`.

Do **not** add a new key to `versions.json`. The next `npm run release:prepare` inherits the new value automatically via `sync-version.mjs` line 42 (`nextMinAppVersion ?? manifestJson.minAppVersion`).

`src/release-support.test.ts` builds its own temp fixtures and does not read the real `manifest.json`/`versions.json`, so no test changes are needed.

---

### Step 2 — Shared types: favorites, unified nav menu payload, narrowed folder action

All edits in `src/view/types.ts`.

**2a.** Append after `CardBoxDefinition` (currently ends line 82):

```ts
export type FavoriteKind = "folder" | "file" | "tag" | "box";

/**
 * A navigation shortcut. `ref` is kind-dependent:
 * - `folder`: normalized folder path (`""` = vault root)
 * - `file`:   vault-relative file path
 * - `tag`:    tag normalized by `normalizeTagPath` (no leading `#`)
 * - `box`:    `CardBoxDefinition.id`
 */
export interface FavoriteEntry {
  kind: FavoriteKind;
  ref: string;
}
```

**2b.** Replace `BoxContextMenuPayload` (lines 247–250) with the unified payload:

```ts
export type NavSectionId = "favorites" | "folders" | "tags" | "boxes";

/**
 * Tree expansion lives in `NavigationPane.svelte` component state, so the host
 * receives it — and the commands to change it — as a bridge on the payload.
 * Tag fields are only meaningful for `section: "tags"`, `scope: "item"`.
 */
export interface NavMenuBridge {
  hasExpandedFolders: boolean;
  hasExpandedTags: boolean;
  toggleAllFolders: () => void;
  toggleAllTags: () => void;
  tagHasChildren: boolean;
  tagExpanded: boolean;
  toggleTagExpansion: () => void;
}

export interface NavContextMenuPayload {
  section: NavSectionId;
  scope: "header" | "item";
  /** Folder UI path (`"/"` for root), normalized tag, or box id. Absent when `scope` is `"header"`. */
  itemId?: string;
  /** Present only for `section: "favorites"`, `scope: "item"`. */
  favorite?: FavoriteEntry;
  bridge: NavMenuBridge;
  mouseEvent: MouseEvent;
}
```

**2c.** Narrow `FolderManagementAction` (line 240) to `export type FolderManagementAction = "create-child-folder";`. The nav menu calls host methods directly, so the `move-folder` / `delete-folder` payload actions become a rival path with no emitter. Two dependent edits in the same step:

- `src/view/FolderCardView.ts` `handleFolderActionRequest` (lines 1612–1630): delete the `move-folder` and `delete-folder` branches, leaving only the `create-child-folder` branch.
- `src/view/FolderCardView.test.ts` test `"routes folder action intents to the matching handlers"` (lines 1470–1483): drop the two removed dispatches and their `moveSpy`/`deleteSpy` assertions, keeping only `create-child-folder`.

---

### Step 3 — `src/view/favorites.ts` (new, pure)

Mirrors `src/view/card-boxes.ts`: pure functions, returns the **same array reference** when nothing changes so callers can skip persistence. Import only `normalizeTagPath` from `./tag-tree` (which has no runtime `obsidian` import) plus types — no runtime `obsidian` import, which keeps it testable in the `node` Vitest project without `vi.mock`.

```ts
import { normalizeTagPath } from "./tag-tree";
import type { FavoriteEntry, FavoriteKind } from "./types";

/** Display grouping order for the Favorites section. */
export const FAVORITE_KIND_ORDER: readonly FavoriteKind[] = ["folder", "file", "tag", "box"];

export function isFavoriteKind(value: unknown): value is FavoriteKind;

/** Returns `null` when the ref cannot be used for this kind. `""` is a valid folder ref (vault root). */
export function normalizeFavoriteRef(kind: FavoriteKind, ref: string): string | null;

export function isFavorite(favorites: FavoriteEntry[], kind: FavoriteKind, ref: string): boolean;
export function addFavorite(favorites: FavoriteEntry[], kind: FavoriteKind, ref: string): FavoriteEntry[];
export function removeFavorite(favorites: FavoriteEntry[], kind: FavoriteKind, ref: string): FavoriteEntry[];
export function toggleFavorite(favorites: FavoriteEntry[], kind: FavoriteKind, ref: string): FavoriteEntry[];
export function moveFavorite(favorites: FavoriteEntry[], kind: FavoriteKind, ref: string, delta: -1 | 1): FavoriteEntry[];
export function sortFavoritesByKind(favorites: FavoriteEntry[]): FavoriteEntry[];
export function pruneFavoriteBoxes(favorites: FavoriteEntry[], boxIds: string[]): FavoriteEntry[];

export interface FavoriteVaultMutation {
  eventType: "create" | "modify" | "delete" | "rename";
  path: string;
  oldPath: string | null;
  isFolder: boolean;
}

export function reconcileFavoritesForVaultMutation(
  favorites: FavoriteEntry[],
  event: FavoriteVaultMutation,
): FavoriteEntry[];
```

Behavior each function must implement:

- `normalizeFavoriteRef`: `folder` → trim, `"/"` → `""`, strip a trailing `/`, always valid (including `""`). `file` → trim, `null` when empty. `tag` → `normalizeTagPath(ref)`, `null` when the result is empty. `box` → trim, `null` when empty.
- `addFavorite`: normalizes first; returns the same reference when the ref is invalid or already present; otherwise appends and returns `sortFavoritesByKind` of the result.
- `removeFavorite`: same reference when absent.
- `moveFavorite`: reorders **within the same kind group only**. Collect the array indices of entries whose `kind` matches, find the target's position `p` in that list, and swap the array slots at `indices[p]` and `indices[p + delta]`. Same reference when the target is missing or `p + delta` is out of range.
- `sortFavoritesByKind`: stable sort by `FAVORITE_KIND_ORDER`; insertion order preserved inside each group.
- `pruneFavoriteBoxes`: drops `box` entries whose ref is not in `boxIds`.
- `reconcileFavoritesForVaultMutation`:

| event | `folder` entries | `file` entries | `tag` / `box` entries |
| :--- | :--- | :--- | :--- |
| `rename`, `isFolder: true` | prefix-rewrite `oldPath` → `path` | prefix-rewrite | untouched |
| `rename`, `isFolder: false` | untouched | exact match → `path` | untouched |
| `delete`, `isFolder: true` | drop entries at or under `path` | drop entries under `path` | untouched |
| `delete`, `isFolder: false` | untouched | drop entries equal to `path` | untouched |
| `create` / `modify` | — | — | same reference returned |

  Copy the `rewritePath` / `isUnderPath` helpers from `src/view/card-boxes.ts` lines 220–233 (`path === oldPath ? newPath : path.startsWith(oldPath + "/") ? …`). A `folder` entry with ref `""` must never match a rename or delete — the `""` ref neither equals `"Projects"` nor starts with `"Projects/"`, so the copied helpers already handle it.

  Tag entries are deliberately never dropped: a tag stops existing when its last note loses it, which is usually temporary. It renders as a missing row instead (Step 10).

**Tests** — `src/view/favorites.test.ts` (node project). Follow the `makeBox()` + per-field assertion style of `src/view/card-boxes.test.ts` lines 151–223, including a `expect(next).toBe(favorites)` identity check for the no-op case. Cover: ref normalization per kind including `"/"` → `""` and `"#Work/AI"` → `"work/ai"`; add/remove idempotency; `moveFavorite` staying inside its kind group and refusing to cross a group boundary; `sortFavoritesByKind` grouping; every row of the reconciliation table; `""` folder ref surviving an unrelated folder rename and delete.

---

### Step 4 — Settings (depends on Step 3)

All edits in `src/settings.ts`.

- Import `normalizeFavoriteRef`, `isFavoriteKind`, `sortFavoritesByKind` from `./view/favorites`, and `FavoriteEntry` as a type from `./view/types`. No cycle: `settings.ts` → `favorites.ts` → `tag-tree.ts`; `types.ts` imports from `../settings` type-only.
- `PluginSettings` (after `boxes`, line 129): `favorites: FavoriteEntry[];`. After `boxSectionCollapsed` (line 135): `favoritesSectionCollapsed: boolean;`.
- `PartialPluginSettings`: the same two as optional.
- `DEFAULT_SETTINGS`: `favorites: []`, `favoritesSectionCollapsed: false`.
- Add next to `normalizeBoxes`:

```ts
function normalizeFavorites(value: unknown): FavoriteEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: FavoriteEntry[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isFavoriteKind(entry.kind) || typeof entry.ref !== "string") {
      continue;
    }
    const ref = normalizeFavoriteRef(entry.kind, entry.ref);
    if (ref === null) {
      continue;
    }
    const dedupeKey = `${entry.kind}\u0000${ref}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    result.push({ kind: entry.kind, ref });
  }
  return sortFavoritesByKind(result);
}
```

  `ref === null` is the validity check, not falsiness — `""` is a legal folder ref.
- Wire both into the `normalizeSettings` return object: `favorites: normalizeFavorites(data.favorites),` and `favoritesSectionCollapsed: normalizeBooleanSetting(data.favoritesSectionCollapsed, DEFAULT_SETTINGS.favoritesSectionCollapsed),`.

**Tests** — `src/settings.test.ts`, new `describe("favorites settings normalization")` matching the `describe("card box settings normalization")` style at lines 531–568: defaults to `[]`; drops non-objects, unknown kinds, non-string refs, and empty tag refs; dedupes `kind + ref`; keeps the `""` folder ref; regroups a mixed input into folder → file → tag → box order.

---

### Step 5 — i18n strings (independent)

`src/i18n.ts` is 1257 lines: interfaces 3–407, `const EN` 422–813, `const ZH` 815–1194. `tsc` enforces en/zh parity through `const EN: UiStrings` / `const ZH: UiStrings`, so every key below must land in the interface **and** both literals. There is no runtime parity test.

**5a. `ToolbarStrings.navPane`** (interface line 85, `EN` 501, `ZH` 891) — component-rendered labels only:

| key | en | zh |
| :--- | :--- | :--- |
| `favoritesSection` | `Favorites` | `收藏` |
| `favoritesEmpty` | `No favorites yet — right-click an item to add one` | `还没有收藏 — 右键任意条目即可添加` |
| `favoriteMissing` | `(missing)` | `（已失效）` |
| `newFolderAtRoot` | `New folder in vault root` | `在库根目录新建文件夹` |

**5b. `ViewStrings.folderManagement`** (interface 316, `EN` 736, `ZH` 1117) — append:

| key | en | zh |
| :--- | :--- | :--- |
| `renameTitle` | `Rename folder` | `重命名文件夹` |
| `rename` | `Rename` | `重命名` |
| `renaming` | `Renaming…` | `正在重命名…` |
| `renameFailed: (reason: string) => string` | `` `Failed to rename folder: ${reason}` `` | `` `重命名文件夹失败：${reason}` `` |
| `unchangedName` | `Folder name is unchanged.` | `文件夹名称未变化。` |
| `duplicateConfirmTitle` | `Copy folder` | `复制文件夹` |
| `duplicateConfirmBody: (count: number) => string` | `` `Copy this folder and its ${count} files?` `` | `` `复制此文件夹及其中的 ${count} 个文件？` `` |
| `duplicateConfirm` | `Copy` | `复制` |
| `duplicateFailed: (reason: string) => string` | `` `Failed to copy folder: ${reason}` `` | `` `复制文件夹失败：${reason}` `` |
| `createFileFailed: (reason: string) => string` | `` `Failed to create file: ${reason}` `` | `` `创建文件失败：${reason}` `` |

**5c. New `ViewStrings.navMenu`** — declare the interface member immediately after `contextMenu` (interface line 331) and place the literal blocks after `contextMenu` in both `EN` (after line 765) and `ZH`:

| key | en | zh |
| :--- | :--- | :--- |
| `newNote` | `New note` | `新建笔记` |
| `newFolder` | `New folder` | `新建文件夹` |
| `newCanvas` | `New canvas` | `新建白板` |
| `newBase` | `New base` | `新建数据库` |
| `newNoteAtRoot` | `New note in vault root` | `在库根目录新建笔记` |
| `newFolderAtRoot` | `New folder in vault root` | `在库根目录新建文件夹` |
| `newCanvasAtRoot` | `New canvas in vault root` | `在库根目录新建白板` |
| `newBaseAtRoot` | `New base in vault root` | `在库根目录新建数据库` |
| `duplicateFolder` | `Make a copy` | `创建副本` |
| `renameFolder` | `Rename...` | `重命名...` |
| `findInFolder` | `Search in folder` | `在文件夹中查找` |
| `copyPath` | `Copy path` | `复制路径` |
| `copyVaultPath` | `Vault path` | `库内相对路径` |
| `copySystemPath` | `System path` | `系统绝对路径` |
| `revealInSystemExplorer` | `Show in system explorer` | `在系统资源管理器中显示` |
| `expandAllFolders` | `Expand all folders` | `展开全部文件夹` |
| `collapseAllFolders` | `Collapse all folders` | `折叠全部文件夹` |
| `expandAllTags` | `Expand all tags` | `展开全部标签` |
| `collapseAllTags` | `Collapse all tags` | `折叠全部标签` |
| `addTagToFilter` | `Add tag to filter` | `将此标签加入筛选` |
| `removeTagFromFilter` | `Remove tag from filter` | `从筛选中移除此标签` |
| `filterByOnlyThisTag` | `Filter by this tag only` | `仅按此标签筛选` |
| `expandSubtags` | `Expand subtags` | `展开子标签` |
| `collapseSubtags` | `Collapse subtags` | `折叠子标签` |
| `newNoteWithTag` | `New note with this tag` | `新建带此标签的笔记` |
| `copyTag` | `Copy tag` | `复制标签文本` |
| `clearTagFilter` | `Clear tag filter` | `清除标签筛选` |
| `openThisBox` | `Open card box` | `打开此卡片盒` |
| `exitThisBox` | `Exit card box` | `退出此卡片盒` |
| `restoreExcludedCards: (count: number) => string` | `` `Restore ${count} removed notes` `` | `` `恢复已移出的 ${count} 篇笔记` `` |
| `favorite` | `Add to favorites` | `收藏` |
| `unfavorite` | `Remove from favorites` | `取消收藏` |
| `moveFavoriteUp` | `Move up` | `上移` |
| `moveFavoriteDown` | `Move down` | `下移` |
| `clearFavorites` | `Clear favorites` | `清空收藏` |
| `clearFavoritesConfirmTitle` | `Clear favorites` | `清空收藏` |
| `clearFavoritesConfirmBody: (count: number) => string` | `` `Remove all ${count} favorites? Your notes and folders are not affected.` `` | `` `确定移除全部 ${count} 项收藏？你的笔记和文件夹不受影响。` `` |
| `clearFavoritesConfirm` | `Clear` | `清空` |

Section expand/collapse items reuse the existing `toolbar.navPane.collapseSection` / `expandSection`. Box items reuse `box.createBox`, `box.saveScopeAsBox`, `box.addScopeToBox`, `box.addScopeToThisBox`, `box.configure`, `box.rename`, `box.duplicate`, `box.delete`. Folder move/delete reuse `toolbar.folderMenu.moveFolder` / `deleteFolder`; include-subfolders reuses `toolbar.folderMenu.includeSubfolders`. New canvas/base files reuse `app.untitledNoteBaseName` as their stem.

---

### Step 6 — Export two helpers from `src/view/note-ops.ts` (independent)

- Change `function resolveUniquePath` (line 575) to `export function resolveUniquePath`. It already handles extension-less names (`dotIndex === -1` → `stem = fileName`, `ext = ""`), so `resolveUniquePath(app, "Projects copy", "Work")` yields `Work/Projects copy`, then `Work/Projects copy 1`.
- Add a path-copy helper next to `copyTitleToClipboard` (line 274), reusing the existing private `copyTextToClipboard` (line 259) so the Notice and failure handling stay identical:

```ts
/** Copy an arbitrary path string, echoing it in the success Notice. */
export async function copyPathToClipboard(
  path: string,
  strings: NoteOpsStrings = getUiStrings("en").noteOps,
): Promise<boolean> {
  return await copyTextToClipboard(path, path, strings);
}
```

---

### Step 7 — `src/main.ts`: folder-targeted note creation and favorites reconciliation (depends on Steps 3–4)

**7a.** Replace `createNoteInCurrentFolder` / `buildNewNoteContent` / `resolveNewNoteFolderPath` (lines 210–224) with:

```ts
  async createNoteInCurrentFolder(): Promise<void> {
    await this.createNoteInFolder(this.selectedFolderPath);
  }

  async createNoteInFolder(folderPath: string, tags: string[] = []): Promise<void> {
    const fullPath = this.generateUniqueNotePath(folderPath);
    const file = await this.app.vault.create(fullPath, this.buildNewNoteContent(tags));
    await this.openNoteFromCard(file.path, "new-tab");
  }

  private buildNewNoteContent(tags: string[] = []): string {
    if (tags.length > 0) {
      return `---\ntags:\n${tags.map((tag) => `  - ${tag}\n`).join("")}---\n\n`;
    }

    return this.settings.newNoteTemplate === "tags-frontmatter" ? NEW_NOTE_TAGS_FRONTMATTER : "";
  }
```

  Delete `resolveNewNoteFolderPath` — `createNoteInCurrentFolder` was its only caller. An explicit `tags` argument deliberately overrides `newNoteTemplate: "blank"`; otherwise "New note with this tag" would silently produce an untagged note.

  Callers must pass a **normalized** folder path (`""` for root); `generateUniqueNotePath` builds its prefix as `folderPath ? folderPath + "/" : ""`.

**7b.** Import `reconcileFavoritesForVaultMutation` from `./view/favorites` next to the existing `reconcileBoxForVaultMutation` import (line 43), and add a method modeled on `reconcileBoxesForVaultMutation` (lines 1424–1454):

```ts
  private reconcileFavoritesForVaultMutation(event: VaultMutationEvent): void {
    const favorites = this.settings.favorites;
    if (favorites.length === 0) {
      return;
    }

    if (event.eventType !== "rename" && event.eventType !== "delete") {
      return;
    }

    const nextFavorites = reconcileFavoritesForVaultMutation(favorites, {
      eventType: event.eventType,
      path: event.path,
      oldPath: event.oldPath,
      isFolder: event.isFolder,
    });

    if (nextFavorites === favorites) {
      return;
    }

    this.settings = { ...this.settings, favorites: nextFavorites };
    void this.saveData(this.settings);
  }
```

  Call it from `dispatchVaultMutation` (line 1398) on the line immediately after `this.reconcileBoxesForVaultMutation(event);`. Use `saveData` directly, not `saveSettings` — matching the boxes path, which avoids the `requestRefreshForViews` round-trip inside a vault-event handler. When both boxes and favorites change, two `saveData` writes happen; that is acceptable and already how the file behaves under concurrent settings writes.

**Tests** — `src/main.test.ts`: assert `createNoteInFolder("Projects", ["work"])` writes `---\ntags:\n  - work\n---\n\n` even when `settings.newNoteTemplate === "blank"` (mirror the existing blank-template test at line 1263), and that `createNoteInCurrentFolder` still targets `selectedFolderPath`.

---

### Step 8 — Panel state channel: favorites rows, section collapse, search focus (depends on Steps 2–4)

Every field added here is required, so all four files change together or `npm run check` fails.

**8a. `src/view/panel-model.ts`** — add next to `BoxSummary`:

```ts
export interface FavoriteRowModel {
  kind: FavoriteKind;
  ref: string;
  label: string;
  icon: string;
  count: number;
  selected: boolean;
  missing: boolean;
  disabled: boolean;
}
```

  and to `PanelModelState`, after `boxSectionCollapsed`:

```ts
  favorites: FavoriteRowModel[];
  favoritesSectionCollapsed: boolean;
  /** Monotonic nonce; each increment asks the toolbar to open and focus its search input. */
  searchFocusToken: number;
```

**8b. `src/view/FolderCardView.ts`** — add `favorites: this.buildFavoriteRowModels()`, `favoritesSectionCollapsed: settings.favoritesSectionCollapsed`, and `searchFocusToken: this.searchFocusToken` to `buildPanelModelState()` (lines 4538–4577), and the same three assignments inside the `pushState()` mutate block (line 4628, which already pushes `showNavItemCounts` and the other section-collapse flags). Add the field `private searchFocusToken = 0;` to the class block at lines 813–858. `buildFavoriteRowModels()` is written in Step 10; until then have it return `[]` so this step compiles on its own.

  Also extend `onToggleNavSection` (lines 4792–4806) with a leading branch:

```ts
    if (section === "favorites") {
      await this.plugin.saveSettings({ favoritesSectionCollapsed: !settings.favoritesSectionCollapsed });
      return;
    }
```

**8c. `src/view/FolderCardPanel.svelte`** — add the three fields to `EMPTY_PANEL_STATE` (lines 107–151) as `favorites: []`, `favoritesSectionCollapsed: false`, `searchFocusToken: 0`; add `const favorites = $derived(panelState.favorites);` and matching deriveds; replace the local `type NavSection = "folders" | "tags" | "boxes";` (line 81) with an import of `NavSectionId` from `./types`.

**8d. `src/view/Toolbar.svelte`** — add `searchFocusToken?: number;` to `ToolbarProps` with a destructured default of `0`, pass it from `FolderCardPanel.svelte` (`searchFocusToken={panelState.searchFocusToken}` in the `<Toolbar>` block at line 680), and add after the `searchExpanded` declaration (line 242):

```ts
  // Plain `let`, not `$state`: the effect writes it, and a reactive read would
  // re-run the effect for no reason.
  let handledSearchFocusToken = 0;

  $effect(() => {
    if (searchFocusToken === handledSearchFocusToken) {
      return;
    }

    handledSearchFocusToken = searchFocusToken;
    if (searchFocusToken === 0) {
      return;
    }

    searchExpanded = true;
    closeSortMenu();
    tick().then(() => {
      searchInputEl?.focus();
    });
  });
```

**Tests** — `src/view/Toolbar.svelte.test.ts`: mount with `searchFocusToken: 0`, confirm the search input is absent; remount (or update props) with `1` and assert after `await tick()` that `.fce-search-input` exists and is `document.activeElement`.

---

### Step 9 — NavigationPane: Favorites section, unified context-menu emission, root-targeted header button (depends on Step 8)

**9a. Clean cutover of the box-menu callback.** `BoxContextMenuPayload` and `onBoxContextMenu` are gone as of Step 2. Update every reference — `rg -n "BoxContextMenuPayload|onBoxContextMenu|box-context-menu|boxContextMenuEvents|openBoxContextMenu"` must return only the new names afterwards:

| file | change |
| :--- | :--- |
| `src/view/NavigationPane.svelte` | prop `onBoxContextMenu` → `onNavContextMenu?: (payload: NavContextMenuPayload) => void` |
| `src/view/FolderCardPanel.svelte` | prop + `handleBoxContextMenu` → `handleNavContextMenu`; pass through to `<NavigationPane>` |
| `src/view/FolderCardView.ts` | mount prop (line 1488) → `onNavContextMenu: (detail: NavContextMenuPayload) => { this.openNavContextMenu(detail); }` |
| `src/__mocks__/FolderCardPanel.svelte.ts` | `PanelProps` entry and `CALLBACK_PROP_TO_EVENT` entry → `onNavContextMenu: "nav-context-menu"` |
| `src/view/card-context-actions.test.ts` | its local `callbackPropToEvent` (lines 79–93) → `onNavContextMenu: "nav-context-menu"`; also add the missing `onFolderAction: "folder-action"` entry so nav tests can fire folder actions |
| `src/view/NavigationPane.svelte.test.ts` | `NavCallbacks` / `Captured` / `createCaptured` → `onNavContextMenu` + `navContextMenuEvents` |

**9b. Emission helper** in `NavigationPane.svelte`, replacing `requestBoxSectionMenu` / `requestBoxRowMenu` (lines 400–409):

```ts
  function buildBridge(tagNode: VisibleTagTreeNode | null): NavMenuBridge {
    return {
      hasExpandedFolders: expandedFolderPaths.size > 0,
      hasExpandedTags: expandedTagPaths.size > 0,
      toggleAllFolders: () => toggleAllFolderExpansion(),
      toggleAllTags: () => toggleAllTagExpansion(),
      tagHasChildren: tagNode?.hasChildren ?? false,
      tagExpanded: tagNode !== null && expandedTagPaths.has(tagNode.tag),
      toggleTagExpansion: () => {
        if (tagNode !== null) {
          toggleTagExpansionByPath(tagNode.tag);
        }
      },
    };
  }

  function requestNavMenu(
    event: MouseEvent,
    section: NavSectionId,
    scope: "header" | "item",
    options: { itemId?: string; favorite?: FavoriteEntry; tagNode?: VisibleTagTreeNode } = {},
  ): void {
    event.preventDefault();
    event.stopPropagation();
    onNavContextMenu?.({
      section,
      scope,
      itemId: options.itemId,
      favorite: options.favorite,
      bridge: buildBridge(options.tagNode ?? null),
      mouseEvent: event,
    });
  }
```

  `stopPropagation` on row handlers is what keeps a row right-click from also reaching the section-body handler — the existing box row handler already relies on this and `NavigationPane.svelte.test.ts` already asserts the single-emission behavior for boxes.

  Extract two helpers so the bridge and the existing UI both drive the same state: `toggleAllFolderExpansion()` / `toggleAllTagExpansion()` split out of `toggleExpandAll()` (lines 149–158, which keeps calling both so the pane header button is unchanged), and `toggleTagExpansionByPath(tag)` split out of `toggleTagExpansion(event, tag)` (lines 341–350).

**9c. Wire the handlers** on all four sections:

- Folders: `TreeSection` gets `onHeaderContextMenu={(event) => requestNavMenu(event, "folders", "header")}`; the `div.fce-folder-menu` (line 520) gets the same via `oncontextmenu`; each folder `div.fce-popup-row` (line 526) gets `oncontextmenu={(event) => requestNavMenu(event, "folders", "item", { itemId: node.path })}`.
- Tags: identical, with `itemId: node.tag` and `tagNode: node` on rows. The body handler goes on `div.fce-tag-menu` (line 584) so the `.fce-tree-empty` state is right-clickable.
- Boxes: header + `div.fce-nav-box-list` (line 660) → `"boxes"` / `"header"`; each `.fce-nav-box-item` → `"boxes"` / `"item"` with `itemId: box.id`.
- Favorites: as below.

**9d. Favorites section.** New props `favorites?: FavoriteRowModel[]` (default `[]`), `favoritesSectionCollapsed?: boolean` (default `false`), `onFavoriteActivate?: (payload: { favorite: FavoriteEntry }) => void`; all three forwarded from `FolderCardPanel.svelte`. Render a `TreeSection` as the **first** child of `div.fce-nav-pane-sections` (line 507), with `title={strings.navPane.favoritesSection}`, `icon="star"`, `collapsed={favoritesSectionCollapsed}`, `onToggle={() => toggleSection("favorites")}`, and `onHeaderContextMenu={(event) => requestNavMenu(event, "favorites", "header")}`.

  Body: `<div class="fce-tree-menu fce-nav-tree fce-favorites-menu" role="tree" oncontextmenu={(event) => requestNavMenu(event, "favorites", "header")}>`; empty state `<div class="fce-tree-empty">{strings.navPane.favoritesEmpty}</div>`. Each row is flat — no indent arithmetic, no chevron:

```svelte
<div
  class="fce-popup-row fce-tree-row {row.selected ? 'is-selected' : ''} {row.missing ? 'is-missing' : ''} {row.disabled ? 'is-disabled' : ''}"
  style="padding-left: var(--fce-nav-indent-step);"
  oncontextmenu={(event) => requestNavMenu(event, "favorites", "item", { favorite: { kind: row.kind, ref: row.ref } })}
>
  <div class="fce-popup-row-leading">
    <span class="fce-tree-item-icon is-static" aria-hidden="true">
      <span class="fce-tree-item-glyph" use:applyIcon={row.icon}></span>
    </span>
  </div>
  <div class="fce-popup-row-content">
    <button
      type="button"
      class="fce-tree-button"
      disabled={row.disabled}
      onclick={() => onFavoriteActivate?.({ favorite: { kind: row.kind, ref: row.ref } })}
      use:applyTooltip={row.missing ? `${row.label} ${strings.navPane.favoriteMissing}` : row.label}
    >
      <span class="fce-tree-label">{row.label}</span>
      {#if row.count > 0}
        <span class="fce-nav-row-count">{row.count}</span>
      {/if}
    </button>
  </div>
</div>
```

  Key the `{#each}` on `` `${row.kind}:${row.ref}` ``.

**9e. Retarget the pane header "+" button.** Rename `createFolderInCurrentScope` (lines 160–162) to `createFolderAtRoot` and emit `onFolderAction?.({ action: "create-child-folder", path: "/" })`. Change the button's `aria-label`, `use:applyTooltip`, and screen-reader span (lines 481–490) from `strings.folderMenu.createChildFolder` to `strings.navPane.newFolderAtRoot`, so it no longer reads identically to the folder-row "New folder" item while targeting something different.

**9f. `NavSection` type.** Delete the local `type NavSection` (line 18) and import `NavSectionId` from `./types`; update `toggleSection` and the `onToggleNavSection` prop signature.

---

### Step 10 — FolderCardView: favorite row models and the new operations (depends on Steps 3–9)

All in `src/view/FolderCardView.ts`. These are private methods with no menu entry point yet; the menu is wired in Step 12.

**10a. `buildFavoriteRowModels(): FavoriteRowModel[]`** — replaces the Step 8b placeholder. Reads `this.plugin.getSettings().favorites`, plus `showNavItemCounts`, `this.deriveTagCounts()`, and `this.buildBoxPanelFields().boxSummaries`, and maps each entry:

| kind | `label` | `icon` | `count` (only when `showNavItemCounts`) | `selected` | `missing` | `disabled` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `folder` | `""` → `strings.toolbar.folderMenu.rootFolder`, else the last `/` segment | `""` → `"house"`, else `PLAIN_FOLDER_ICON` | always `0` | `!isBoxMode() && ref === normalizeActiveFolderScopePath()` | `resolveFolderFromUiPath(ref) === null` | `false` |
| `file` | segment after the last `/`, with a trailing `.md`, `.canvas`, or `.base` removed | `getCardFileIcon(resolveCardFileKindFromPath(ref) ?? "markdown")` | always `0` | `ref === this.selectedPath` | not a `TFile` in the vault | `false` |
| `tag` | `` `#${ref}` `` | `"tag"` | `tagCounts[ref] ?? 0` | active filter tags contain `ref` | `ref` absent from `deriveAvailableTags()` | `isBoxMode()` |
| `box` | box name, falling back to `ref` | `"box"` | `boxSummaries` entry's `cardCount` | `ref === activeBoxId` | `findCardBox(boxes, ref) === null` | `false` |

  Folder and file rows carry no count on purpose: `buildPanelModelState` sets `folderTree: []` and the tree is built separately by the debounced `refreshFolderTreeState`, so producing folder counts here would mean a second full vault walk on every state push.

  Stripping only those three suffixes leaves `Foo.excalidraw` for `Foo.excalidraw.md`, which is exactly Obsidian's `TFile.basename`.

**10b. `handleFavoriteActivate({ favorite })`** — wired as the `onFavoriteActivate` mount prop:

- `folder` → `void this.selectFolderFromNav(ref)` (already exits box mode and returns to the cards pane in single-pane layout).
- `file` → `void this.plugin.openNoteFromCard(ref)` (plugin owns default open behavior).
- `tag` → return early when `this.isBoxMode()`; otherwise toggle `ref` in `settings.filter.tags` and `void this.plugin.saveSettings({ filter: { tags: nextTags } })`.
- `box` → `this.handleBoxCommand({ command: ref === activeBoxId ? "exit" : "switch", boxId: ref })`.

**10c. Favorites mutations.**

```ts
  private async persistFavorites(favorites: FavoriteEntry[]): Promise<void> {
    await this.plugin.saveSettings({ favorites });
  }
```

  `toggleFavoriteEntry(kind, ref)`, `moveFavoriteEntry(kind, ref, delta)` call the Step 3 pure functions against `this.plugin.getSettings().favorites` and persist only when the returned reference differs. `clearFavorites()` goes through `requestDestructiveConfirmation` (lines 4268–4280) with `navMenu.clearFavoritesConfirmTitle`, `clearFavoritesConfirmBody(count)`, `clearFavoritesConfirm`, then persists `[]`.

  Extend `persistBoxes` (lines 977–986) to prune orphaned box favorites — it is the single funnel for box persistence, so this covers deletion and any future removal path:

```ts
  private async persistBoxes(boxes: CardBoxDefinition[], activeBoxId?: string | null): Promise<void> {
    const favorites = pruneFavoriteBoxes(
      this.plugin.getSettings().favorites,
      boxes.map((box) => box.id),
    );
    if (activeBoxId === undefined) {
      await this.plugin.saveSettings({ boxes, favorites });
      return;
    }
    await this.plugin.saveSettings({ boxes, activeBoxId, favorites });
  }
```

**10d. File creation in a target folder.** All three resolve the folder through the existing `resolveFolderFromUiPath` (lines 2560–2566) and `new Notice(folderNotFound)` when it is gone.

```ts
  private async createNoteIn(folderUiPath: string, tags: string[] = []): Promise<void>   // → plugin.createNoteInFolder(folder.path, tags)
  private async createCanvasIn(folderUiPath: string): Promise<void>
  private async createBaseIn(folderUiPath: string): Promise<void>
```

  Canvas and base share one private helper that uses the newly exported `resolveUniquePath`:

```ts
  private async createSupportedFileIn(
    folderUiPath: string,
    extension: "canvas" | "base",
    content: string,
  ): Promise<void> {
    const folder = this.resolveFolderFromUiPath(folderUiPath);
    if (!(folder instanceof TFolder)) {
      new Notice(this.getFolderManagementStrings().folderNotFound);
      return;
    }

    const fileName = `${this.strings.app.untitledNoteBaseName}.${extension}`;
    const targetPath = resolveUniquePath(this.app, fileName, folder.path);
    try {
      const created = await this.app.vault.create(targetPath, content);
      await this.plugin.openNoteFromCard(created.path, "new-tab");
    } catch (error) {
      new Notice(this.getFolderManagementStrings().createFileFailed(String(error)));
    }
  }
```

  Content literals — canvas: `{"nodes":[],"edges":[]}`; base:

```
views:
  - type: table
    name: Table
```

  (a trailing newline included). Both match the documented formats — JSON Canvas nodes/edges arrays, and the Bases YAML schema whose `views` entries carry `type` and `name`. Obsidian rewrites the base file on first save; that is expected.

**10e. `duplicateFolder(folderUiPath)`.** Uses `vault.copy`, which copies a folder recursively in a single call (`copy<T extends TAbstractFile>(file: T, newPath: string): Promise<T>`, available since Obsidian 1.8.7 — below the 1.9.0 floor set in Step 1). No per-file loop, therefore no `BatchOpSummary`.

- Resolve the folder; return with `folderNotFound` when missing; return silently when `folder.path === ""` (the vault root is not duplicable).
- Count files recursively over `folder.children`; when the total exceeds `50`, gate on `requestDestructiveConfirmation({ title: duplicateConfirmTitle, message: duplicateConfirmBody(count), confirmButtonText: duplicateConfirm })` and abort on `false`.
- `const targetPath = resolveUniquePath(this.app, `${folder.name} copy`, folder.parent?.path ?? "");` — matching the `" copy"` convention `duplicateFile` already uses (note-ops lines 174–190).
- `await this.app.vault.copy(folder, targetPath);` then `this.refreshFolderTreeState();`. On throw, `new Notice(duplicateFailed(String(error)))`.

**10f. `renameFolder(folderUiPath)`.** Generalize `CreateFolderModal` (lines 740–810) rather than duplicating 70 lines: give its constructor an options object `{ title: string; submitLabel: string; submittingLabel: string; initialName?: string }` alongside the existing `folderManagement` strings, seed `this.nextName = options.initialName ?? ""` and pre-fill the text field with it, and read the title/labels from options instead of `strings.createChildTitle` / `create` / `creating`. Update the single existing callsite (lines 2575–2582) to pass `{ title: strings.createChildTitle, submitLabel: strings.create, submittingLabel: strings.creating }`.

  Rename then opens the same modal with `{ title: renameTitle, submitLabel: rename, submittingLabel: renaming, initialName: folder.name }` and submits through a shared move/rename primitive so both entry points get the same validation and scope repair:

```ts
  private async renameFolderTo(folder: TFolder, nextPath: string): Promise<boolean> {
    const strings = this.getFolderManagementStrings();
    try {
      await this.app.fileManager.renameFile(folder, nextPath);
      this.refreshFolderTreeState();
      await this.refreshFolderScopeAfterFolderRename(folder.path, nextPath);
      return true;
    } catch (error) {
      new Notice(strings.moveFailed(String(error)));
      return false;
    }
  }
```

  Rewrite `onFolderMoveTargetChosen` (lines 2631–2665) to end in `await this.renameFolderTo(folder, this.buildSiblingPath(targetFolder.path, folder.name))`, keeping its existing `sameTarget` and `invalidMoveTarget` guards. The rename submit handler validates: empty → `emptyName`; contains `/` or `\` → `invalidName`; equal to `folder.name` → `unchangedName` and return `false` (keep the modal open); otherwise `renameFolderTo(folder, buildSiblingPath(folder.parent?.path ?? "", trimmedName))` with `renameFailed` as the catch message. Return `true` on success so the modal closes.

  Calling `refreshFolderScopeAfterFolderRename` on both paths is what stops the view from pointing at a dead path after renaming the folder that is currently in scope.

**10g. `findInFolder(folderUiPath)`.**

```ts
  private async findInFolder(folderUiPath: string): Promise<void> {
    await this.selectFolderFromNav(folderUiPath);
    this.resetSearchQuery();
    this.searchFocusToken += 1;
    this.pushState();
  }
```

  Order is load-bearing. `selectFolderFromNav` runs `returnToCardsViewIfSinglePane()` first, so in the single-pane layout the main pane is visible again (`.fce-shell.is-single.is-nav-visible .fce-main-pane { display: none; }`, styles.css line 51) before the toolbar is asked to focus its input; focusing a `display: none` input is a no-op. `resetSearchQuery` already calls `pushState`, and the extra `pushState` publishes the bumped token afterwards. Deliberately does **not** change `includeSubfolders`, and does not relax the indexed-search gate — a non-empty query typed into the focused box stays blocked while the index is not ready, exactly as it is elsewhere.

**10h. Path and shell helpers.**

```ts
  private async copyFavoritePath(ref: string, mode: "vault" | "system"): Promise<void>
  private async revealInSystemExplorer(ref: string): Promise<void>
```

  `"vault"` copies `ref` verbatim (`""` for the vault root becomes `"/"` so the Notice is not empty); `"system"` copies `getSystemPath(this.app, ref)` and shows `new Notice(this.strings.desktopShell.unavailable)` when it returns `null`. Both go through `copyPathToClipboard(text, this.strings.noteOps)`. Reveal calls `showInSystemExplorer(this.app, ref, this.strings.desktopShell)` and `new Notice(result.error)` on `ok: false`. Import `canResolveSystemPath`, `getSystemPath`, `showInSystemExplorer` from `./desktop-shell` — currently exported and fully tested but never wired into the view.

**10i. Tag helpers.** `addTagToFilter(tag)`, `removeTagFromFilter(tag)`, `filterByOnlyTag(tag)`, `clearTagFilter()` all compute the next array and call `this.plugin.saveSettings({ filter: { tags: nextTags } })`. `copyTag(tag)` → `copyPathToClipboard(`#${tag}`, this.strings.noteOps)`. `createNoteWithTag(tag)` → `this.createNoteIn(this.getDisplayFolderPath(), [tag])`.

**10j. `restoreBoxExcluded(boxId)`** → `restoreExcludedPaths(box)` from `./card-boxes` (already imported by `BoxConfigModal`; add it to this file's import list) then `persistBoxes(upsertCardBox(boxes, restored))`.

---

### Step 11 — `src/view/nav-context-menu.ts` (new) (depends on Steps 2, 5)

Pure menu construction, `import type { Menu } from "obsidian"` **only** — a type-only import is erased at runtime, so the `node` Vitest project can test this module with a hand-rolled mock menu and no `vi.mock("obsidian")` (the shared `src/__mocks__/obsidian.ts` has no `Menu` stub).

```ts
export interface NavMenuDeps {
  strings: UiStrings;
  isBoxMode: boolean;
  includeSubfolders: boolean;
  activeFilterTags: string[];
  availableTagsAreFilterable: boolean;
  canResolveSystemPath: boolean;
  favorites: FavoriteEntry[];
  boxes: CardBoxDefinition[];
  activeBoxId: string | null;
  boxExcludedCount: (boxId: string) => number;
  sectionCollapsed: Record<NavSectionId, boolean>;
  actions: NavMenuActions;
}

/** Returns false when no items were added; the caller then skips showing the menu. */
export function buildNavContextMenu(menu: Menu, payload: NavContextMenuPayload, deps: NavMenuDeps): boolean;

/** Menu-item title that `markMenuItemAsDanger` should highlight, or null. */
export function resolveNavMenuDangerLabel(payload: NavContextMenuPayload, deps: NavMenuDeps): string | null;
```

`NavMenuActions` is a flat record of the Step 10 operations, all `(…) => void`: `createNote`, `createFolder`, `createCanvas`, `createBase` (each taking a folder UI path), `duplicateFolder`, `moveFolder`, `renameFolder`, `deleteFolder`, `findInFolder`, `copyPath(ref, "vault" | "system")`, `revealInSystemExplorer(ref)`, `toggleIncludeSubfolders`, `toggleSection(section)`, `addTagToFilter`, `removeTagFromFilter`, `filterByOnlyTag`, `clearTagFilter`, `createNoteWithTag`, `copyTag`, `boxCommand(command, boxId?)`, `restoreBoxExcluded(boxId)`, `toggleFavorite(kind, ref)`, `moveFavorite(kind, ref, delta)`, `clearFavorites`, and `cardMenu(menu, notePath)` which delegates to the host's existing `addCardContextMenuItems`.

Build items with the established `menu.addItem((item) => item.setTitle(…).setIcon(…).onClick(…))` shape (`FolderCardView.addCardContextMenuItems`, lines 1985–2127). Use `item.setChecked(…)` and `item.setDisabled(…)` where noted; both exist on `MenuItem` in the installed `obsidian` 1.12.3 typings. `setSubmenu` is **not** in those typings, so copy the runtime-probe pattern from `appendAddScopeToBoxMenu` (lines 1250–1267) for the copy-path submenu.

The nine menus, in exact order. `sep` = `menu.addSeparator()`.

**A. `folders` / `header`**

| # | title | icon | condition / state | action |
| :-- | :-- | :-- | :-- | :-- |
| 1 | `navMenu.newNoteAtRoot` | `square-pen` | | `createNote("/")` |
| 2 | `navMenu.newFolderAtRoot` | `folder-plus` | | `createFolder("/")` |
| 3 | `navMenu.newCanvasAtRoot` | `layout-dashboard` | | `createCanvas("/")` |
| 4 | `navMenu.newBaseAtRoot` | `layout-list` | | `createBase("/")` |
| 5 | sep | | | |
| 6 | `bridge.hasExpandedFolders ? navMenu.collapseAllFolders : navMenu.expandAllFolders` | `chevrons-down-up` / `chevrons-up-down` | | `bridge.toggleAllFolders()` |
| 7 | `folderMenu.includeSubfolders` | `folder-tree` | `setChecked(deps.includeSubfolders)`, `setDisabled(deps.isBoxMode)` | `toggleIncludeSubfolders()` |
| 8 | sep | | | |
| 9 | `sectionCollapsed.folders ? navPane.expandSection : navPane.collapseSection` | `chevron-right` / `chevron-down` | | `toggleSection("folders")` |

**B. `folders` / `item` where `itemId === "/"`** — items 1–4 as above but with the un-suffixed `navMenu.newNote` / `newFolder` / `newCanvas` / `newBase` titles and the same `"/"` target; `sep`; `navMenu.findInFolder` (`search`) → `findInFolder("/")`; `navMenu.revealInSystemExplorer` (`folder-symlink`) → `revealInSystemExplorer("")`, **omitted entirely** when `!deps.canResolveSystemPath`.

Nothing else: the vault root cannot be copied, moved, renamed, or deleted, and `deleteFolder` / `openMoveFolderPickerForFolder` already return early for it, so offering those items would be a silent no-op.

**C. `folders` / `item`, any other `itemId`**

| # | title | icon | condition | action |
| :-- | :-- | :-- | :-- | :-- |
| 1–4 | `navMenu.newNote` / `newFolder` / `newCanvas` / `newBase` | `square-pen` / `folder-plus` / `layout-dashboard` / `layout-list` | | `create*(itemId)` |
| 5 | sep | | | |
| 6 | `navMenu.duplicateFolder` | `copy` | | `duplicateFolder(itemId)` |
| 7 | `folderMenu.moveFolder` | `folder-input` | | `moveFolder(itemId)` |
| 8 | `navMenu.findInFolder` | `search` | | `findInFolder(itemId)` |
| 9 | favorite toggle | `star` / `star-off` | see below | `toggleFavorite("folder", itemId)` |
| 10 | sep | | | |
| 11 | `navMenu.copyPath` | `clipboard-copy` | submenu | see below |
| 12 | `navMenu.revealInSystemExplorer` | `folder-symlink` | omit when `!canResolveSystemPath` | `revealInSystemExplorer(itemId)` |
| 13 | sep | | | |
| 14 | `navMenu.renameFolder` | `pencil` | | `renameFolder(itemId)` |
| 15 | `folderMenu.deleteFolder` | `trash` | danger | `deleteFolder(itemId)` |

  The favorite toggle is a shared helper `appendFavoriteToggleItem(menu, deps, kind, ref)` used by menus C, E, G, and the card menu; its title is `isFavorite(deps.favorites, kind, ref) ? navMenu.unfavorite : navMenu.favorite` with icon `star-off` / `star`.

  Copy-path is a submenu with `navMenu.copyVaultPath` → `copyPath(itemId, "vault")` and `navMenu.copySystemPath` → `copyPath(itemId, "system")`, the second omitted when `!canResolveSystemPath`. When the runtime probe finds no `setSubmenu`, fall back to `item.onClick(() => actions.copyPath(itemId, "vault"))` — same shape as the existing add-to-box fallback.

**D. `tags` / `header`** — when `deps.isBoxMode`, emit only the section-toggle item (the tag section is disabled in box mode and everything else would be inert). Otherwise:

1. `navMenu.clearTagFilter` (`filter-x`), `setDisabled(deps.activeFilterTags.length === 0)` → `clearTagFilter()`
2. sep
3. `bridge.hasExpandedTags ? navMenu.collapseAllTags : navMenu.expandAllTags` (`chevrons-down-up` / `chevrons-up-down`) → `bridge.toggleAllTags()`
4. sep
5. `sectionCollapsed.tags ? navPane.expandSection : navPane.collapseSection` → `toggleSection("tags")`

**E. `tags` / `item`** — return `false` immediately when `deps.isBoxMode`. Let `isActive = deps.activeFilterTags.some((tag) => normalizeTagPath(tag) === itemId)`.

1. `isActive ? navMenu.removeTagFromFilter : navMenu.addTagToFilter` (`tag`), `setChecked(isActive)` → `removeTagFromFilter(itemId)` / `addTagToFilter(itemId)` — a dynamic title, because a one-way "add" item would do nothing when the tag is already filtered
2. `navMenu.filterByOnlyThisTag` (`filter`), `setDisabled(isActive && deps.activeFilterTags.length === 1)` → `filterByOnlyTag(itemId)`
3. sep + `bridge.tagExpanded ? navMenu.collapseSubtags : navMenu.expandSubtags` (`chevron-down` / `chevron-right`) → `bridge.toggleTagExpansion()` — both **only** when `bridge.tagHasChildren`
4. sep
5. `navMenu.newNoteWithTag` (`square-pen`) → `createNoteWithTag(itemId)`
6. `navMenu.copyTag` (`clipboard-copy`) → `copyTag(itemId)`
7. favorite toggle for `("tag", itemId)`

**F. `boxes` / `header`**

1. `box.createBox` (`box`) → `boxCommand("create")`
2. `box.saveScopeAsBox` (`package-plus`) — only when `!isBoxMode` → `boxCommand("save-scope-as-box")`
3. `box.addScopeToBox` (`package-check`) with a submenu of every box name → `boxCommand("add-scope-to-box", id)`, plus a trailing separator and `box.addToNewBox`; only when `!isBoxMode && boxes.length > 0`. Same submenu-probe fallback as elsewhere. This preserves `addBoxCreationMenuItems` (lines 2150–2173) behavior exactly.
4. sep
5. `sectionCollapsed.boxes ? navPane.expandSection : navPane.collapseSection` → `toggleSection("boxes")`

**G. `boxes` / `item`** — return `false` when `findCardBox(deps.boxes, itemId) === null` (keeps the existing guard at line 2176). Let `isActive = itemId === deps.activeBoxId`.

1. `isActive ? navMenu.exitThisBox : navMenu.openThisBox` (`log-out` / `box`) → `boxCommand(isActive ? "exit" : "switch", itemId)` — the dynamic title exists because "open" on the already-open box is a no-op and box mode otherwise has no exit affordance in the menu
2. `box.configure` (`settings-2`) → `boxCommand("configure", itemId)`
3. `box.addScopeToThisBox` (`list-plus`) — only when `!isBoxMode` → `boxCommand("add-scope-to-box", itemId)`
4. `navMenu.restoreExcludedCards(count)` (`undo-2`) — only when `deps.boxExcludedCount(itemId) > 0` → `restoreBoxExcluded(itemId)`
5. favorite toggle for `("box", itemId)`
6. sep
7. `box.rename` (`pencil`) → `boxCommand("rename", itemId)`
8. `box.duplicate` (`copy`) → `boxCommand("duplicate", itemId)`
9. sep
10. `box.delete` (`trash-2`), danger → `boxCommand("delete", itemId)`

**H. `favorites` / `header`**

1. `navMenu.clearFavorites` (`star-off`), `setDisabled(deps.favorites.length === 0)` → `clearFavorites()`
2. sep
3. `sectionCollapsed.favorites ? navPane.expandSection : navPane.collapseSection` → `toggleSection("favorites")`

**I. `favorites` / `item`** — return `false` when `payload.favorite` is absent. Compute the entry's position inside its kind group from `deps.favorites`.

1. `navMenu.unfavorite` (`star-off`) → `toggleFavorite(kind, ref)`
2. `navMenu.moveFavoriteUp` (`arrow-up`), `setDisabled(groupIndex === 0)` → `moveFavorite(kind, ref, -1)`
3. `navMenu.moveFavoriteDown` (`arrow-down`), `setDisabled(groupIndex === groupSize - 1)` → `moveFavorite(kind, ref, 1)`
4. sep
5. then the item's home menu appended verbatim, so favorites never introduce a fourth vocabulary:
   - `folder` with `ref === ""` → menu **B** with folder path `"/"`
   - `folder` otherwise → menu **C** items 1–15 with `itemId = ref`
   - `file` → `deps.actions.cardMenu(menu, ref)`
   - `tag` → menu **E** items 1–7 with `itemId = ref`; when `deps.isBoxMode`, append nothing and stop after item 4
   - `box` → menu **G** items 1–10 with `itemId = ref`

`resolveNavMenuDangerLabel` returns `strings.toolbar.folderMenu.deleteFolder` for a non-root folder item, `strings.box.delete` for a box item, the kind-appropriate one of those (or `strings.view.contextMenu.delete` for `file`, `null` for `tag`) for a favorites item, and `null` otherwise. It exists because `markMenuItemAsDanger` (lines 1939–1952) matches on the item's rendered title text, so passing the wrong label silently leaves the delete row unstyled.

**Tests** — `src/view/nav-context-menu.test.ts` (node project). Define a local mock menu with `items`, `addItem`, `addSeparator`, and a `setSubmenu`-capable item, modeled on `MockMenu` / `getTopLevelMenuSignature` / `getMenuStructure` in `src/view/card-context-actions.test.ts` (lines 165–285, 959–1008). Assert the exact ordered `{ title, icon }` signature including separators for all nine menus in `en`; assert the box-mode variants (tag header reduced to one item, tag row returning `false`, box header hiding scope items); assert the dynamic titles flip (`addTagToFilter` ↔ `removeTagFromFilter`, `openThisBox` ↔ `exitThisBox`); assert `setDisabled` on the four gated items; assert both copy-path branches (submenu present and probe-absent fallback); assert `canResolveSystemPath: false` removes the reveal item and the system-path submenu entry; spot-check one menu in `zh` via `getUiStrings("zh")`; assert `resolveNavMenuDangerLabel` for each payload shape.

---

### Step 12 — Wire the menu into FolderCardView and add the card-menu favorite item (depends on Steps 10, 11)

`src/view/FolderCardView.ts`:

- Delete `openBoxContextMenu` (lines 2129–2148), `addBoxCreationMenuItems` (2150–2173), and `addBoxItemMenuItems` (2175–2233). `buildNavContextMenu` menus F and G replace them exactly; `appendAddScopeToBoxMenu` stays and is called from the new module through `actions.boxCommand`, or is inlined into the module's menu F — keep it in the view and expose it as an extra action `appendAddScopeSubmenu(menu)` so the submenu-probe logic lives in one place.
- Add:

```ts
  private openNavContextMenu(payload: NavContextMenuPayload): void {
    if (!this.isMouseEventLike(payload.mouseEvent)) {
      return;
    }

    const deps = this.buildNavMenuDeps();
    const menu = new Menu();
    if (!buildNavContextMenu(menu, payload, deps)) {
      return;
    }

    menu.showAtMouseEvent(payload.mouseEvent);

    const menuDom = this.getMenuDom(menu);
    if (menuDom) {
      this.decorateCardContextMenu(menuDom, resolveNavMenuDangerLabel(payload, deps));
    }
  }
```

  Change `decorateCardContextMenu` (lines 1934–1937) to accept `string | null` and skip `markMenuItemAsDanger` when it is `null`; keep adding the `fce-card-context-menu` class so the existing danger styling applies to nav menus too.
- `buildNavMenuDeps()` assembles the Step 11 `NavMenuDeps` from `this.strings`, `this.isBoxMode()`, settings, `canResolveSystemPath(this.app)`, `this.getBoxExcludedCount(boxId)` (derive from `findCardBox(...)?.excludedPaths.length ?? 0`), and an `actions` object bound to the Step 10 methods plus `cardMenu: (menu, notePath) => this.addCardContextMenuItems(menu, notePath)`.
- In `addCardContextMenuItems`, insert the favorite toggle immediately after `this.appendAddToBoxMenu(menu, [notePath]);` (line 2045) using the same shared helper, keyed `("file", notePath)`.

**Tests** — extend `src/view/card-context-actions.test.ts`: fire `mockState.panelEventHandlers["nav-context-menu"]` with each payload shape and assert `menuInstances` receives `showAtMouseEvent`; assert an unknown box id produces no menu; assert the card menu now contains the favorite item at the expected index; assert `dom.classList.add` still receives `"fce-card-context-menu"` and that `getDangerMenuTitles` returns the folder-delete label for a folder-row menu.

---

### Step 13 — styles.css

- Add `.fce-favorites-menu` to the two existing selector groups so favorites rows inherit folder/tag row treatment: line 719–720 (`.fce-folder-menu .fce-tree-row.is-selected, .fce-tag-menu .fce-tree-row.is-selected`) and line 735–736 (`.fce-tree-row-check`).
- Append next to the other `.fce-nav-tree` rules (after line 271):

```css
.folder-card-view .fce-favorites-menu .fce-tree-row.is-missing {
  opacity: 0.55;
}

.folder-card-view .fce-favorites-menu .fce-tree-row.is-disabled {
  opacity: 0.5;
  pointer-events: none;
}
```

No new custom properties; rows reuse `--fce-nav-row-height`, `--fce-nav-row-radius`, and `--fce-nav-indent-step`.

---

### Step 14 — Nav pane component tests (depends on Step 9)

`src/view/NavigationPane.svelte.test.ts`, following the existing `mountNav` / `createCaptured` / `disposeMountedComponent` harness (lines 95–186):

- Add `favorites` to the default mount props with one row of each kind, and assert the Favorites section renders first among `.fce-tree-section`, with four rows, the right icons via `data-icon`, and the `is-selected` / `is-missing` classes.
- Assert the empty state renders `strings.navPane.favoritesEmpty` when `favorites: []`.
- Assert `onFavoriteActivate` fires with the right `{ kind, ref }` for each row, and that a `disabled` row's button does not fire.
- For each of the four sections, dispatch `new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 20 })` on the section header, on the section body container, and on one row; assert exactly three payloads with `scope` `"header"`, `"header"`, `"item"` and the right `section` / `itemId` / `favorite` — the row case must produce exactly **one** payload, proving `stopPropagation` prevents the body handler from also firing.
- Assert the tag-row payload carries `bridge.tagHasChildren === true` for a parent tag and `false` for a leaf, and that invoking `bridge.toggleAllFolders()` then re-reading a fresh payload flips `bridge.hasExpandedFolders`.
- Update the existing `"emits create-child-folder for the current scope"` test (lines 435–445) to expect `{ action: "create-child-folder", path: "/" }` and to locate the button by the new `strings.navPane.newFolderAtRoot` label; rename it to reflect the root target.
- Update the two box-context-menu tests to the `onNavContextMenu` shape.

## Critical files & anchors

| File | Anchor | Why it disambiguates |
| :--- | :--- | :--- |
| `src/view/FolderCardView.ts` | `addCardContextMenuItems` (1985–2127), `appendAddScopeToBoxMenu` (1250–1267), `requestDestructiveConfirmation` (4268–4280), `CreateFolderModal` (740–810) | The menu-item, submenu-probe, confirmation, and modal idioms every new surface must copy; the file is 4893 lines, so navigate by symbol |
| `src/view/card-boxes.ts` | `reconcileBoxForVaultMutation` (275–292) and its `rewritePath` / `isUnderPath` helpers (220–233) | `favorites.ts` is a deliberate structural twin, including the same-reference-on-no-change contract |
| `src/main.ts` | `dispatchVaultMutation` (1398–1422) and `reconcileBoxesForVaultMutation` (1424–1454) | Exact insertion point and persistence idiom (`saveData`, not `saveSettings`) for favorites reconciliation |
| `src/view/NavigationPane.svelte` | `requestBoxSectionMenu` / `requestBoxRowMenu` (400–409) and the boxes `TreeSection` wiring (650–684) | The only working example of header + body + row context-menu wiring, which the other three sections copy |
| `src/__mocks__/obsidian.ts` | whole file | Has no `Menu`, `Notice`, `TFile`, `Setting`, or `Platform` stub — this is why `nav-context-menu.ts` and `favorites.ts` must avoid runtime `obsidian` imports to stay testable in the `node` project |

## Verification

```bash
npm run check && npm run check:svelte && npm run build && npm test
npm run release:check          # must stay green after the Step 1 version-metadata edit
```

Targeted while iterating:

```bash
npx vitest run src/view/favorites.test.ts src/settings.test.ts
npx vitest run src/view/nav-context-menu.test.ts
npx vitest run src/view/NavigationPane.svelte.test.ts src/view/Toolbar.svelte.test.ts
npx vitest run src/view/card-context-actions.test.ts src/view/FolderCardView.test.ts
```

Manual pass in Obsidian (`npm run dev`, reload the plugin, open the Card Workspace view in the left sidebar) — each check names an input and the observable output:

1. **Folder row menu.** Right-click a non-root folder → 15 rows in the Step 11 menu C order, with "Delete" red. Choose "New base" → an `Untitled.base` file appears in that folder and opens; its content is the three-line `views:` YAML and Obsidian renders a Bases table rather than an error.
2. **Duplicate.** Right-click a folder holding ≥ 51 files → "Make a copy" shows the confirmation with the real file count; confirm → a sibling `<name> copy` folder appears with the full subtree, and the nav tree updates without a manual refresh.
3. **Rename in scope.** Select a folder as the current scope, right-click it → "Rename...", submit a new name → the card list stays populated and the toolbar scope label shows the new name (this is the `refreshFolderScopeAfterFolderRename` path).
4. **Search in folder, single pane.** Narrow the view until the layout collapses to one pane, switch to the nav pane, right-click a folder → "Search in folder": the pane flips back to cards, the search box opens, and the caret is in it.
5. **Favorites lifecycle.** Favorite a folder, a note, a tag, and a box → all four appear under Favorites grouped in that order. Rename the folder in Obsidian's own file explorer → the favorite follows the rename. Delete the note → its favorite disappears. Remove the tag from its last note → the tag favorite stays, dimmed. Delete the box → its favorite disappears.
6. **Favorites row menu.** Right-click the favorited note → "Remove from favorites", "Move up", "Move down", separator, then the full card menu. "Move up" on the first item in a group is greyed out.
7. **No silent no-ops.** With a tag already in the filter, right-click it → the first item reads "Remove tag from filter" and unchecking it clears the filter. With a box open, right-click that box → the first item reads "Exit card box" and leaves box mode. In box mode, right-click the Tags header → only "Expand section"/"Collapse section" is offered.
8. **Root row.** Right-click the root row → exactly the four "New …" items, "Search in folder", and "Show in system explorer". Reveal opens the OS file manager at the vault. If `getFullPath("")` returns nothing on this platform, the item is absent rather than failing — see the contingency below.

## Assumptions & contingencies

- **`.base` default content** is `views:\n  - type: table\n    name: Table\n`, matching the documented Bases schema. If Obsidian 1.9+ refuses to open that file, write an empty string instead and let Obsidian populate it on first edit; do not add schema keys speculatively.
- **`getSystemPath(app, "")` returning the vault root** is unverified — confirm first. If it returns `null` or an empty string, `canResolveSystemPath`-gated items simply do not render for the root row, which is the intended degradation; no code change needed. If it returns the path but `shell.showItemInFolder` reveals the vault's *parent* in a way that feels wrong, switch the root row's item to `openInDefaultApp(this.app, "")` (already exported from `desktop-shell.ts`) so it opens the vault folder itself.
- **Favorites carry no folder/file counts.** If counts are wanted there later, the folder tree must be reachable from `buildPanelModelState`, which today deliberately publishes `folderTree: []` and lets the debounced `refreshFolderTreeState` fill it.
- **The expansion bridge passes closures across the host/component seam.** This is the one deviation from "components emit intent only" and it is deliberate: tree expansion is component-local state under `docs/ui-patterns.md`, and a second token channel for four commands would cost more than it saves. If a future change moves expansion state into the host, delete `NavMenuBridge` and read the state from `NavMenuDeps` instead.
- **`versions.json["0.6.1"]` is rewritten in place** rather than adding a new version entry, because `check-release.mjs` ties `versions.json[manifest.version]` to `manifest.minAppVersion` and this change ships before the next release. If you would rather not touch a shipped mapping, run `npm run release:prepare -- "0.7.0" 1.9.0` instead and let the script add a fresh entry.
