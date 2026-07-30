# Navigation pane header toolbar, native-leaning restyle, and optional item counts

## Context

The left navigation pane (`src/view/NavigationPane.svelte`) has three defects. It renders no header in dual layout, so its top edge does not line up with the card pane's toolbar and there is no home for pane-level actions. The "include subfolders" toggle lives in the folder section's header-action slot, where it appears and disappears with scope and reads as a section setting rather than a scope modifier. And the pane paints `--fce-bg`, the same colour as the card canvas, so the two columns carry no visual hierarchy and the rows read as a flat text list rather than an Obsidian sidebar.

End state: the pane has a permanent header toolbar (back-to-cards in single layout; expand/collapse-all, new folder, and include-subfolders on the right) whose height matches the card pane's toolbar; the pane paints `--background-secondary` while the cards keep their existing `--fce-surface` so the columns read as chrome-vs-content; rows carry semantic leading icons and an accent selection marker; and folder rows can optionally show a card count that follows the include-subfolders state, behind a new setting.

## Approach

Three steps, landing in order. Each step leaves the tree building and the existing suite passing. Step 1 is independent of Steps 2 and 3. Step 2 depends on Step 1 only because it restyles DOM that Step 1 reshapes. Step 3 depends on Step 1 (it adds a prop to the same component) but not on Step 2.

### Step 1 — Permanent nav pane header toolbar

**1.1 Remove the section-action slot** (`src/view/TreeSection.svelte`)

Delete `actions?: Snippet;` from `TreeSectionProps` (line 11), the `actions,` binding in the destructure (line 21), and the `{#if actions}` block with its `<div class="fce-tree-section-actions">` wrapper (lines 47-51). Keep the `Snippet` import for `body`.

`rg -n 'TreeSection' src/` returns only `NavigationPane.svelte` and `TreeSection.svelte` — `NavigationPane` is the only consumer, and 1.2 removes its only `actions` usage.

**1.2 Rewrite the pane header** (`src/view/NavigationPane.svelte`)

Delete the `{#snippet actions()}` block on the folders `TreeSection` (lines 292-306) — the include-subfolders button moves into the header.

Delete `const hasFolderScope = $derived(folderPath.length > 0);` (line 90). This gate is stale: `getDisplayFolderPath()` (`FolderCardView.ts:4261`) returns `"/"` for the vault-root scope, but the persisted representation is `""`, and `docs/decisions/2026-05-31-collapse-scope-model-to-root-default-folder-only.md` records that root is a normal folder scope where `includeSubfolders` stays usable. Removing the gate fixes the toggle disappearing at vault root.

Change the guard in `toggleIncludeSubfolders()` (line 213) to `if (isBoxMode) { return; }` — drop the `!hasFolderScope` clause.

Add to `NavigationPaneProps` and the destructure, importing `FolderActionPayload` from `./types` next to the existing `FolderTreeNode` import:

```ts
onFolderAction?: (payload: FolderActionPayload) => void;
```

Add expansion state helpers. `collectExpandableTagPaths` already exists and is exported from `./tag-tree` (line 127) but is not yet imported here; add it to the existing import list. There is no folder equivalent, so add one locally next to `flattenVisibleTree`:

```ts
function collectExpandableFolderPaths(nodes: FolderTreeNode[]): string[] {
  const paths: string[] = [];

  function walk(items: FolderTreeNode[]): void {
    for (const node of items) {
      if (node.children.length > 0) {
        paths.push(node.path);
        walk(node.children);
      }
    }
  }

  walk(nodes);
  return paths;
}
```

Add the derived state and the three header handlers:

```ts
const expandableFolderPaths = $derived(collectExpandableFolderPaths(folderTree));
const expandableTagPaths = $derived(collectExpandableTagPaths(tagTree));
const hasExpandedNodes = $derived(expandedFolderPaths.size > 0 || expandedTagPaths.size > 0);

function toggleExpandAll(): void {
  if (hasExpandedNodes) {
    expandedFolderPaths = new Set();
    expandedTagPaths = new Set();
    return;
  }

  expandedFolderPaths = new Set(expandableFolderPaths);
  expandedTagPaths = new Set(expandableTagPaths);
}

function createFolderInCurrentScope(): void {
  onFolderAction?.({ action: "create-child-folder", path: folderPath });
}
```

The button acts on both trees because it sits in the pane header, not in a section header. Leave the tag-seeding `$effect` (lines 115-128) alone: it reads `expandedTagPaths`, so it has already run and set `seededTagExpansion` by the time a user can click, and when `activeFilterTags` is empty it returns before touching that state — collapse-all cannot be undone by it.

Replace the whole `{#if layoutMode === "single"}` header block (lines 269-282) with an unconditional header:

```svelte
<div class="fce-nav-pane-header">
  <div class="fce-nav-pane-header-group">
    {#if layoutMode === "single"}
      <button
        type="button"
        class="clickable-icon fce-nav-header-button"
        aria-label={strings.navPane.backToCards}
        onclick={() => onToggleNavPane?.()}
        use:applyIcon={"arrow-left"}
        use:applyTooltip={strings.navPane.backToCards}
      >
        <span class="fce-sr-only">{strings.navPane.backToCards}</span>
      </button>
    {/if}
  </div>
  <div class="fce-nav-pane-header-group">
    <button
      type="button"
      class="clickable-icon fce-nav-header-button"
      aria-label={hasExpandedNodes ? strings.navPane.collapseAll : strings.navPane.expandAll}
      onclick={toggleExpandAll}
      use:applyIcon={hasExpandedNodes ? "chevrons-down-up" : "chevrons-up-down"}
      use:applyTooltip={hasExpandedNodes ? strings.navPane.collapseAll : strings.navPane.expandAll}
    >
      <span class="fce-sr-only">{hasExpandedNodes ? strings.navPane.collapseAll : strings.navPane.expandAll}</span>
    </button>
    <button
      type="button"
      class="clickable-icon fce-nav-header-button"
      aria-label={strings.folderMenu.createChildFolder}
      onclick={createFolderInCurrentScope}
      use:applyIcon={"folder-plus"}
      use:applyTooltip={strings.folderMenu.createChildFolder}
    >
      <span class="fce-sr-only">{strings.folderMenu.createChildFolder}</span>
    </button>
    {#if !isBoxMode}
      <button
        type="button"
        class="clickable-icon fce-nav-header-button {includeSubfolders ? 'is-active' : ''}"
        aria-label={includeSubfolders ? strings.folderMenu.includeSubfolders : strings.folderMenu.directFolderOnly}
        aria-pressed={includeSubfolders}
        onclick={toggleIncludeSubfolders}
        use:applyIcon={"folder-tree"}
        use:applyTooltip={includeSubfolders ? strings.folderMenu.includeSubfolders : strings.folderMenu.directFolderOnly}
      >
        <span class="fce-sr-only">{strings.folderMenu.subfoldersSrLabel}</span>
      </button>
    {/if}
  </div>
</div>
```

The include-subfolders button is **hidden** in box mode, not disabled. `docs/decisions/2026-04-09-toolbar-scope-summary-and-folder-only-subfolder-toggle.md` explicitly rejected the greyed-out variant because a visible-but-inert toggle implies a real underlying state; a box carries its recursion per membership rule, so no global value applies. The new-folder button stays enabled in every mode — `folderPath` is always a valid scope, and `openCreateChildFolderModal` already reports a missing folder via `Notice`.

The `.fce-nav-header-button` class exists so the header can carry its own `is-active` colour without inheriting `.fce-toolbar-button`'s muted default; the `clickable-icon` class supplies Obsidian's icon-button sizing, exactly as `Toolbar.svelte` does.

**1.3 Revive the dead folder-action seam** (`src/view/FolderCardPanel.svelte`)

`onFolderAction` already exists end to end but is currently unwired to the nav pane: the prop and `handleFolderAction` forwarder are declared (lines 92, 159, 316-318) and `FolderCardView.onOpen()` still passes a handler (line 1414) that reaches `handleFolderActionRequest` (line 1541) and `openCreateChildFolderModal` (line 2390). Only the `<NavigationPane>` call site is missing it.

Add `onFolderAction={handleFolderAction}` to the `<NavigationPane>` props (the block at lines 637-660). No host-side change is needed.

**1.4 Header CSS** (`styles.css`)

Replace `.folder-card-view .fce-nav-pane-header` (lines 81-87) with:

```css
.folder-card-view .fce-nav-pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2px;
  padding: 6px;
  flex: 0 0 auto;
}

.folder-card-view .fce-nav-pane-header-group {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.folder-card-view .fce-nav-header-button {
  flex: 0 0 auto;
  aspect-ratio: 1;
  color: var(--fce-text-muted);
}

.folder-card-view .fce-nav-header-button.is-active {
  color: var(--fce-accent);
}
```

`padding: 6px` matches `.folder-card-view .fce-toolbar-buttons` (line 285) and `aspect-ratio: 1` matches `.folder-card-view .fce-toolbar-button` (lines 321-325), so both panes' top bars resolve to the same height without a hardcoded value.

Delete `.folder-card-view .fce-tree-section-actions` (lines 163-168) and `.folder-card-view .fce-nav-section-action.is-active` (lines 170-172) — both classes disappear with 1.1 and 1.2.

**1.5 i18n** (`src/i18n.ts`)

Add to the `navPane` block of `ToolbarStrings` (lines 83-97), after `backToCards`:

```ts
expandAll: string;
collapseAll: string;
```

`en` (lines 489-503): `expandAll: "Expand all",` and `collapseAll: "Collapse all",`. `zh` (lines 868-882): `expandAll: "全部展开",` and `collapseAll: "全部折叠",`. TypeScript enforces both locales. No new string is needed for the new-folder button — it reuses the existing `folderMenu.createChildFolder` ("Create child folder" / "新建子文件夹").

**1.6 Tests** (`src/view/NavigationPane.svelte.test.ts`)

- Add `onFolderAction` to `NavCallbacks` (line 25-33), a `folderActionEvents: FolderActionPayload[]` field to `Captured`, and the capturing callback in `createCaptured()`.
- Replace the test `"renders no pane header in dual layout"` (lines 271-278) with `"renders the header toolbar in dual layout"`: assert `.fce-nav-pane-header` is not null, that `button[aria-label="Back to cards"]` **is** null, and that `button[aria-label="Create child folder"]` is not null.
- Keep `"renders a back button in single layout that emits onToggleNavPane"` (lines 280-291) as is.
- The existing `"emits include-subfolders toggle from the folder section header action"` (lines 258-269) still passes unchanged because the `aria-label` is unchanged; rename it to `"emits include-subfolders toggle from the pane header"` and add a second mount with `folderPath: "/"` asserting the button is still present — this is the vault-root regression 1.2 fixes.
- Add `"hides the include-subfolders toggle in box mode"`: mount with `activeBoxId: "box-1"`, assert `button[aria-label="Including subfolders"]` is null.
- Add `"expands every folder and tag node, then collapses them"`: mount with the default tree plus a folder node that has children, click `button[aria-label="Expand all"]`, `await tick()`, assert a nested folder row is now rendered and the button's `aria-label` is `"Collapse all"`; click again and assert the nested row is gone.
- Add `"emits create-child-folder for the current scope"`: mount with `folderPath: "notes"`, click `button[aria-label="Create child folder"]`, assert `captured.folderActionEvents` equals `[{ action: "create-child-folder", path: "notes" }]`.

`createFolderTree()` (lines 48-54) currently returns only flat nodes; give `projects` a child (`{ name: "alpha", path: "projects/alpha", depth: 1, children: [] }`) so the expand-all test has something to reveal. Check the existing folder tests at lines 192-201 and 184-190 still pass after that change — they select by label text, so they do.

### Step 2 — Pane theming and row restyle

Depends on Step 1.

**2.1 Add the nav tokens** (`styles.css`)

Append to the `.folder-card-view` token block (lines 10-33):

```css
  --fce-nav-bg: var(--background-secondary);
  --fce-nav-icon-color: var(--text-muted);
  --fce-nav-row-selected-bg: color-mix(in srgb, var(--fce-accent) 10%, transparent);
  --fce-nav-row-selected-marker: var(--fce-accent);
  --fce-nav-count-color: var(--text-faint, var(--text-muted));
```

Change `.folder-card-view .fce-nav-pane` (lines 69-79) to `background: var(--fce-nav-bg);`. Leave `--fce-surface`, `--fce-surface-alt`, and every card rule untouched — cards keep `--background-secondary` and their existing `1px solid var(--fce-border)` border (line 817), and the columns separate on material (flat full-bleed chrome vs. rounded bordered surface) rather than on hue.

**2.2 Move the row icon into the click target** (`src/view/NavigationPane.svelte`)

Today the leading slot holds either a chevron, the root `house` icon, or an invisible placeholder, and the label sits alone in `.fce-tree-button`. Change it so the leading slot is chevron-only and every row gets a semantic icon inside the button.

Add the resolver next to `getFolderNodeLabel` (line 152):

```ts
function getFolderNodeIcon(node: FolderTreeNode): string {
  if (isRootFolderNode(node)) {
    return "house";
  }

  if (node.children.length > 0 && expandedFolderPaths.has(node.path)) {
    return "folder-open";
  }

  return "folder";
}
```

In the folder row (lines 313-345):

- `.fce-popup-row-leading` becomes the chevron button when `hasChildren`, otherwise `<span class="fce-tree-chevron is-placeholder" aria-hidden="true"></span>`. Delete the `{:else if isRootFolderNode(node)}` branch — the house icon moves into the button.
- Inside `.fce-tree-button`, render `<span class="fce-tree-node-icon" aria-hidden="true" use:applyIcon={getFolderNodeIcon(node)}></span>` before `.fce-tree-label`.
- Delete the whole `.fce-popup-row-trailing` block (lines 340-344). Folder selection is single-select and is now carried by the accent marker plus the active weight; the check mark is redundant.

In the tag row (lines 367-399):

- Inside `.fce-tree-button`, render `<span class="fce-tree-node-icon" aria-hidden="true" use:applyIcon={"hash"}></span>` before `.fce-tree-label`.
- Wrap the trailing block so it only renders when selected, dropping the `aria-hidden` attribute that only existed to blank it out:

```svelte
{#if isSelected}
  <div class="fce-popup-row-trailing">
    <span class="fce-popup-row-selected-indicator fce-tree-row-check" use:applyIcon={"check"}></span>
  </div>
{/if}
```

Tag rows keep the check because tag filtering is multi-select with `role="menuitemcheckbox"` and `aria-checked` (lines 386-387); folder rows are single-select, so the two selection languages stay deliberately different.

**2.3 Row visual layer** (`styles.css`)

`.fce-tree-menu .fce-tree-node-icon` (line 736) already sets `flex: 0 0 auto` and the icon box; add the nav-scoped colour and spacing next to the other `.fce-nav-tree` rules (after line 208):

```css
.folder-card-view .fce-nav-tree .fce-tree-node-icon {
  margin-inline-end: 6px;
  color: var(--fce-nav-icon-color);
}
```

Add `position: relative;` to `.folder-card-view .fce-nav-tree .fce-tree-row` (lines 185-193), then replace the selection rule (lines 199-203) with:

```css
.folder-card-view .fce-nav-tree .fce-tree-row.is-selected {
  background: var(--fce-nav-row-selected-bg);
  color: var(--fce-nav-row-active-color);
  font-weight: var(--nav-item-weight-active, 600);
}

.folder-card-view .fce-nav-tree .fce-tree-row.is-selected::before {
  content: "";
  position: absolute;
  inset-inline-start: 0;
  top: 3px;
  bottom: 3px;
  width: 2px;
  border-radius: 1px;
  background: var(--fce-nav-row-selected-marker);
}
```

This overrides `.fce-folder-menu .fce-tree-row.is-selected, .fce-tag-menu .fce-tree-row.is-selected` (lines 642-646) by specificity for the nav context only; leave that rule in place because the sort and box popup menus still consume it.

Change `.folder-card-view .fce-tree-section` (lines 112-114) to `padding-bottom: 8px;` so the three sections read as distinct groups now that rows carry icons.

**2.4 Component test** (`src/view/NavigationPane.svelte.test.ts`)

Add `"marks the selected folder row and leaves tag checks intact"`: mount with `folderPath: "notes"` and `activeFilterTags: ["work"]`; assert `.fce-folder-menu .fce-tree-row.is-selected` is not null and contains no `.fce-tree-row-check`, and that `.fce-tag-menu .fce-tree-row.is-selected .fce-tree-row-check` is not null.

### Step 3 — Optional folder item counts

Depends on Step 1. Independent of Step 2.

**3.1 New setting** (`src/settings.ts`)

Add `showNavItemCounts: boolean;` to `PluginSettings` (after `boxSectionCollapsed`, line 118) and `showNavItemCounts?: boolean;` to `PartialPluginSettings` (line 144). Add `showNavItemCounts: false,` to `DEFAULT_SETTINGS` (line 170) — off by default so existing installs keep their current pane. Add to `normalizeSettings` (after line 436):

```ts
showNavItemCounts: normalizeBooleanSetting(
  data.showNavItemCounts,
  DEFAULT_SETTINGS.showNavItemCounts,
),
```

`mergeSettings` routes through `normalizeSettings`, so it needs no change.

Test files construct full `PluginSettings` literals and are type-checked (`tsconfig.json` includes `src/**/*.ts`). `rg -n 'navPaneCollapsed' src/` returns exactly two such literals — `src/view/pipeline.test.ts:31` and `src/view/FolderCardView.test.ts:313` — plus real code in `src/settings.ts` and `src/view/FolderCardView.ts` and three assertion strings in `FolderCardView.test.ts` (1363, 1379, 1387). Add `showNavItemCounts: false` to the two literals only.

`src/settings.test.ts` holds no full-settings literal and no whole-object equality assertion, so it does not break; add two cases there anyway — `normalizeSettings({})` yields `showNavItemCounts === false`, and a non-boolean input (e.g. `"yes"`) also normalizes to `false`.

**3.2 Setting-tab toggle** (`src/i18n.ts`, `src/CardWorkspaceSettingTab.ts`)

Add `showNavItemCountsName: string;` and `showNavItemCountsDesc: string;` to `SettingTabStrings` (lines 10-21). `en`: `"Show item counts in navigation"` / `"Show how many cards each folder contributes in the navigation pane. The count follows the include-subfolders toggle."`. `zh`: `"在导航栏显示条目计数"` / `"在导航栏中显示每个文件夹包含的卡片数量。计数会跟随“包含子文件夹”开关变化。"`.

In `CardWorkspaceSettingTab.display()`, destructure `showNavItemCounts` from `this.plugin.getSettings()` (lines 27-33) and append a `Setting` after the `previewLines` slider (lines 99-110), following the `enableFileExplorerFolderClicks` toggle shape (lines 39-46):

```ts
new Setting(containerEl)
  .setName(strings.showNavItemCountsName)
  .setDesc(strings.showNavItemCountsDesc)
  .addToggle((toggle) => {
    toggle.setValue(showNavItemCounts).onChange(async (value) => {
      await this.plugin.saveSettings({ showNavItemCounts: value });
    });
  });
```

**3.3 Carry counts on the tree node** (`src/view/types.ts`)

Add to `FolderTreeNode` (lines 230-235):

```ts
  directCount: number;                // Supported card files directly in this folder; 0 when counting is disabled
  recursiveCount: number;             // directCount plus every descendant folder's recursiveCount; 0 when counting is disabled
```

Both fields are always present so no call site has to handle `undefined`.

**3.4 Compute counts** (`src/view/FolderCardView.ts`)

Rewrite `buildFolderTree()` (lines 3342-3373). `isSupportedCardFile` is already imported (line 70). Counting is gated so a disabled setting costs nothing:

```ts
private buildFolderTree(): FolderTreeNode[] {
  const vault = this.app.vault as unknown as { getRoot?: unknown };
  if (typeof vault.getRoot !== "function") {
    return [];
  }

  const countsEnabled = this.plugin.getSettings().showNavItemCounts;

  function countDirectFiles(folder: TFolder): number {
    if (!countsEnabled) {
      return 0;
    }

    let total = 0;
    for (const child of folder.children) {
      if (child instanceof TFile && isSupportedCardFile(child)) {
        total += 1;
      }
    }

    return total;
  }

  function buildNode(folder: TFolder, depth: number): FolderTreeNode {
    const subfolders = folder.children
      .filter((c): c is TFolder => c instanceof TFolder)
      .sort((a, b) => a.name.localeCompare(b.name));
    const children = subfolders.map((sf) => buildNode(sf, depth + 1));
    const directCount = countDirectFiles(folder);

    return {
      name: folder.name || "/",
      path: folder.path === "" ? "/" : folder.path,
      children,
      depth,
      directCount,
      recursiveCount: children.reduce((total, child) => total + child.recursiveCount, directCount),
    };
  }

  const root = this.app.vault.getRoot();
  const subfolders = root.children
    .filter((c): c is TFolder => c instanceof TFolder)
    .sort((a, b) => a.name.localeCompare(b.name));
  const topLevelNodes = subfolders.map((sf) => buildNode(sf, 0));
  const rootDirectCount = countDirectFiles(root);

  const rootNode: FolderTreeNode = {
    name: root.name || "/",
    path: "/",
    children: [],
    depth: 0,
    directCount: rootDirectCount,
    recursiveCount: topLevelNodes.reduce(
      (total, node) => total + node.recursiveCount,
      rootDirectCount,
    ),
  };

  return [rootNode, ...topLevelNodes];
}
```

The root entry keeps `children: []` — it is a flat sibling of the top-level folders in this tree, not their parent — but its `recursiveCount` deliberately spans the whole vault, because selecting it with include-subfolders on is the whole-vault scope.

Counts ignore the tag filter and the search query. They answer "how many cards does this folder scope hold", which is what the include-subfolders toggle beside them controls; folding filters in would make the number disagree with the card pane whenever a filter is active but a different folder is selected.

**3.5 Keep counts fresh** (`src/view/FolderCardView.ts`)

`refreshFolderTreeState()` (line 2376) runs on open (line 1435), after each folder mutation (lines 1675, 2428, 2482, 2515), and after every folder load (line 2710). File-level create/delete/rename currently never rebuild the tree, which would leave counts stale.

`handleVaultMutation` is called synchronously per event from `main.ts:1443` (only the follow-up `requestRefreshForViews` is debounced), so a bulk delete would otherwise trigger one full-vault walk per file. Add a debounced scheduler modelled on the existing `clearSearchDebounce` / `scheduleDebouncedSearchProjection` pair (lines 3441-3457), which uses `getViewWindow()` rather than a bare `window`:

```ts
private folderTreeDebounceTimer: ReturnType<Window["setTimeout"]> | null = null;

private static readonly FOLDER_TREE_DEBOUNCE_MS = 250;

private clearFolderTreeDebounce(): boolean {
  if (this.folderTreeDebounceTimer === null) {
    return false;
  }

  this.getViewWindow().clearTimeout(this.folderTreeDebounceTimer);
  this.folderTreeDebounceTimer = null;
  return true;
}

private scheduleFolderTreeRefresh(): void {
  this.clearFolderTreeDebounce();
  this.folderTreeDebounceTimer = this.getViewWindow().setTimeout(() => {
    this.folderTreeDebounceTimer = null;
    this.refreshFolderTreeState();
  }, FolderCardView.FOLDER_TREE_DEBOUNCE_MS);
}
```

Declare `folderTreeDebounceTimer` next to `searchDebounceTimer` (line 849) and the constant next to `SEARCH_DEBOUNCE_MS` (line 854). Call `this.clearFolderTreeDebounce();` in `cleanupLifecycle()` (line 1721) alongside `clearSearchDebounce()`; it does not feed the returned `CleanupResult`, so leave `cancelledDebounce` sourced from the search debounce only.

Extend the head of `handleVaultMutation` (lines 1673-1676):

```ts
if (event.isFolder) {
  this.refreshFolderTreeState();
} else if (
  this.plugin.getSettings().showNavItemCounts &&
  event.eventType !== "modify"
) {
  this.scheduleFolderTreeRefresh();
}
```

Folder events keep rebuilding synchronously — structure changes are rare and must appear at once. `modify` is excluded because it cannot change a count.

**3.6 Bridge the flag** (`src/view/panel-model.ts`, `src/view/FolderCardView.ts`, `src/view/FolderCardPanel.svelte`)

Add `showNavItemCounts: boolean;` to `PanelModelState` after `boxSectionCollapsed` (line 65). Set `showNavItemCounts: settings.showNavItemCounts,` in `buildPanelModelState()` (next to line 4325) and `state.showNavItemCounts = settings.showNavItemCounts;` in `pushState()` (next to line 4415). Do not add it to `pushSelectionState()` — that pusher deliberately carries only per-selection fields.

Add `showNavItemCounts: false,` to `EMPTY_PANEL_STATE` in `FolderCardPanel.svelte` (line 142) and to `createInitialPanelState()` in `src/view/FolderCardPanel.svelte.test.ts` (line 76). Add `const showNavItemCounts = $derived(panelState.showNavItemCounts);` next to the other derived reads (line 262) and pass `{showNavItemCounts}` to `<NavigationPane>`.

Toggling the setting reaches the pane through `saveSettings` → `requestRefreshForViews` → `refresh()` → the load path's `refreshFolderTreeState()` at line 2710, so the tree is rebuilt with counts on the same pass that pushes the flag. No extra wiring is needed.

**3.7 Render counts** (`src/view/NavigationPane.svelte`, `styles.css`)

Add `showNavItemCounts?: boolean;` to `NavigationPaneProps`, defaulting to `false` in the destructure. Add the resolver:

```ts
function getFolderNodeCount(node: FolderTreeNode): number {
  if (!showNavItemCounts) {
    return 0;
  }

  return includeSubfolders ? node.recursiveCount : node.directCount;
}
```

Add `{@const nodeCount = getFolderNodeCount(node)}` to the run of `{@const}` declarations at the top of the folder `{#each}` body (lines 310-312, next to `hasChildren` / `isSelected` / `label`). Svelte only allows `{@const}` as an immediate child of a block, so it cannot be declared inside the button element.

Then, in the folder row's `.fce-tree-button`, after `.fce-tree-label`:

```svelte
{#if nodeCount > 0}
  <span class="fce-nav-row-count">{nodeCount}</span>
{/if}
```

A zero count renders nothing rather than a `0`, so empty folders stay quiet. Tag and box rows get no counts — tag counts would need a `metadataCache` scan crossed with the active folder scope, which is a separate feature.

Both counts live on the node, so flipping include-subfolders re-renders from existing state with no tree rebuild.

Add to `styles.css` after the nav row rules:

```css
.folder-card-view .fce-nav-row-count {
  flex: 0 0 auto;
  margin-inline-start: 6px;
  color: var(--fce-nav-count-color);
  font-size: var(--font-ui-smaller, 12px);
  font-variant-numeric: tabular-nums;
}
```

`--fce-nav-count-color` comes from Step 2; if Step 3 lands first, add that one token line with it.

**3.8 Tests**

`src/view/NavigationPane.svelte.test.ts`: extend `createFolderTree()` with `directCount` / `recursiveCount` on every node (give `projects` `directCount: 2, recursiveCount: 5` and its child `directCount: 3, recursiveCount: 3`). Add `"renders counts only when enabled and follows include-subfolders"`: mount with `showNavItemCounts: true, includeSubfolders: true` and assert the `projects` row shows `5`; remount with `includeSubfolders: false` and assert it shows `2`; remount with `showNavItemCounts: false` and assert `.fce-nav-row-count` is absent.

`src/view/FolderCardView.test.ts`: add a case building a stub vault root whose children include supported (`.md`, `.canvas`) and unsupported (`.png`) files across two nesting levels, then call `(view as any).buildFolderTree()` with `showNavItemCounts: true` and assert the root node's `recursiveCount` equals the total supported-file count while a leaf's `directCount` matches its own supported files; repeat with the setting off and assert every count is `0`.

## Critical files & anchors

- `src/view/NavigationPane.svelte` — the `{#if layoutMode === "single"}` header (269-282), the folders `TreeSection` `actions` snippet (292-306), and both tree row loops (313-345 folder, 367-399 tag). Every step edits this file; the component-local `expandedFolderPaths` / `expandedTagPaths` at lines 84-85 are what expand-all mutates.
- `styles.css` — the `.folder-card-view` token block (10-33), the nav pane and header rules (69-208), and the popup-scoped selection rules at 642-646 that the nav override must out-specify without breaking the sort and box menus.
- `src/view/FolderCardView.ts` — `buildFolderTree` (3342-3373), `refreshFolderTreeState` (2376-2380), `handleVaultMutation`'s head (1673-1676), the search-debounce pair (3441-3457) that the tree debounce copies, and the state pushers (4290-4418).
- `src/view/FolderCardPanel.svelte` — `EMPTY_PANEL_STATE` (101-143), the derived reads (240-262), and the `<NavigationPane>` call site (637-660) where `onFolderAction` and `showNavItemCounts` attach.
- `docs/decisions/2026-04-09-toolbar-scope-summary-and-folder-only-subfolder-toggle.md` and `docs/decisions/2026-05-31-collapse-scope-model-to-root-default-folder-only.md` — the two records that fix the include-subfolders visibility rule (hidden in a box, available at vault root).

## Verification

Run from the repository root after each step:

```bash
npm run check && npm run check:svelte && npm run build && npm test
```

Targeted reruns while iterating:

```bash
npx vitest run src/view/NavigationPane.svelte.test.ts
npx vitest run src/view/FolderCardPanel.svelte.test.ts
npx vitest run src/view/FolderCardView.test.ts
npx vitest run src/settings.test.ts src/view/pipeline.test.ts
```

Manual checks — build with `npm run build`, reload the plugin (Settings → Community plugins → toggle off/on), and open Card Workspace in the left sidebar with the panel wide enough for two columns:

1. **Header parity and actions (Step 1).** The nav pane now shows a top bar. Hold a straight edge across both panes: the nav header and the card toolbar bottom edges line up. Confirm three buttons on the right: "Expand all", "Create child folder", "Including subfolders".
2. **Expand/collapse all (Step 1).** With everything collapsed, click "Expand all": every folder with children and every parent tag expands, and the tooltip becomes "Collapse all". Click again: both trees collapse fully.
3. **New folder (Step 1).** Select `Projects`, click "Create child folder", enter a name, confirm. The new folder appears nested under `Projects` in the tree.
4. **Include-subfolders at root and in a box (Step 1).** Select "Root /": the "Including subfolders" button is still present (it used to vanish). Click it — the tooltip becomes "Direct folder only" and the card pane drops to root-level files only. Enter a box from the Boxes section: the button is gone entirely, and the other two remain.
5. **Column hierarchy (Step 2).** The nav pane is visibly a shade different from the card canvas, while the cards keep their previous fill and border. Drag the sidebar narrow enough to trigger single-pane, toggle to the nav view, and confirm the full-width pane still looks right.
6. **Row treatment (Step 2).** Folder rows show a folder icon that becomes an open folder when expanded; the vault root shows a house; tag rows show a hash. The selected folder row carries a thin accent bar on its left edge and no check mark; a selected tag row still shows its check mark.
7. **Counts (Step 3).** With the setting off, no numbers appear. Enable "Show item counts in navigation": folder rows show a right-aligned number. Toggle "Including subfolders" off — the numbers drop to direct-folder counts. Create a note inside a folder and confirm its number increments within about a second; edit an existing note and confirm nothing re-renders.

## Assumptions & contingencies

- **The header carries exactly three actions plus the single-pane back button.** No pane-collapse button is duplicated into the nav header — the card toolbar's `panel-left-close` button (`Toolbar.svelte:436-446`) remains the only collapse control, since a copy inside the pane would vanish along with the pane it hides. If a fourth action is wanted later, add it to the right group; the `space-between` layout absorbs it without CSS changes.
- **Expand-all acts on the folder tree and the tag tree together.** If that proves surprising in use, scope `toggleExpandAll` to `expandedFolderPaths` only and leave `expandedTagPaths` untouched; nothing else in the plan depends on the tag half.
- **`color-mix(in srgb, ...)` is available.** Obsidian runs on a current Chromium, and the reference plugin at `/home/kenan/Source-Code-Learning/notebook-navigator` uses it throughout its shipped stylesheet. If a target build renders the selection background as transparent, replace `--fce-nav-row-selected-bg` with `var(--nav-item-background-active, var(--background-modifier-hover))`; the accent marker carries the state either way.
- **The nav pane at `--background-secondary` reads well in single-pane mode**, where it fills the entire view — unverified against a live theme this session. If the full-width secondary fill looks wrong, add `.folder-card-view .fce-shell.is-single .fce-nav-pane { background: var(--fce-bg); }` rather than abandoning the dual-column hierarchy.
- **Counts are folder-only and filter-agnostic.** If tag counts are wanted later, they need a `metadataCache` pass crossed with the active folder scope and a separate freshness path; do not fold them into `buildFolderTree`.
- **Counting is bounded by a 250 ms debounce on file events.** If a very large vault still stutters during bulk operations, raise `FOLDER_TREE_DEBOUNCE_MS` to 500 before considering an incremental count update — the full walk is O(vault files) and only runs when the setting is on.
