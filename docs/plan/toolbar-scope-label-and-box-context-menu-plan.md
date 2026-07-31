# Toolbar scope label + nav-pane card-box context menus

## Context

Two card-pane defects, plus the card-box entry migration they force:

1. The collapse-navigation button in the card pane toolbar renders a persistent dark "selected" background whenever the nav pane is visible (dual-pane), so a plain toggle looks like an active filter.
2. The card pane never shows which folder / tag / card box it is currently browsing. The scope must appear in the first-level button row, immediately after the collapse button, with the existing icon buttons pushed to the right edge, and the scope text must truncate progressively with a trailing ellipsis as the pane narrows.

Because the scope becomes plain text, the card-box name dropdown and the box "back" arrow leave the toolbar. Everything that dropdown hosted (create / rename / duplicate / delete / configure / add-current-view-to-box / save-view-as-box) has no other entry point today, so this change also moves box management into nav-pane context menus that use the same Obsidian `Menu` styling as the card context menu, plus one new browse-mode toolbar button for "save current view as card box".

End state: toolbar row is `[collapse][scope text, ellipsis-truncated][right-aligned icon buttons]`; the custom `.fce-box-menu` popup is gone; box management lives on right-click of the nav pane "Card boxes" section header and of each box row.

## Approach

### Step 1 — Add the new i18n keys (independent, do first)

`src/i18n.ts`. Additive only; deletions happen in Step 4 after their usages are gone.

Add to the `ToolbarStrings` interface (after the `navPane` block, before `search`):

```ts
  scope: {
    ariaLabel: string;
    separator: string;
  };
```

`en.toolbar`:

```ts
    scope: {
      ariaLabel: "Current scope",
      separator: " · ",
    },
```

`zh.toolbar`:

```ts
    scope: {
      ariaLabel: "当前范围",
      separator: " · ",
    },
```

Add to the `BoxStrings` interface (after `addScopeToBox`) and both locales:

```ts
  addScopeToThisBox: string;
```

- `en.box`: `addScopeToThisBox: "Add current view to this card box"`
- `zh.box`: `addScopeToThisBox: "将当前视图加入此卡片盒"`

Reword the existing boxes-empty hint so the only creation entry point is discoverable (right-click), keeping the key name:

- `en.toolbar.navPane.boxesEmpty`: `"No card boxes yet — right-click to create one"`
- `zh.toolbar.navPane.boxesEmpty`: `"还没有卡片盒 — 右键新建"`

Reuse existing keys elsewhere; do not add duplicates: `box.createBox`, `box.saveScopeAsBox`, `box.saveScopeTitle`, `box.rename`, `box.duplicate`, `box.delete`, `box.configure`, `toolbar.folderMenu.rootFolder`.

### Step 2 — Rewrite the toolbar first-level row (depends on Step 1)

`src/view/Toolbar.svelte`.

**2a. Props.** Add `activeFilterTags?: string[]` to `ToolbarProps` with default `activeFilterTags = []`. Delete the `boxSummaries?: BoxSummary[]` and `boxExcludedCount?: number` props and their defaults — after 2c nothing reads them. Drop the now-unused `import type { BoxSummary } from "./panel-model";`. Keep `folderPath` (currently declared but unused — it becomes load-bearing here) and `activeBoxId` / `activeBoxName`.

In `src/view/FolderCardPanel.svelte`, at the `<Toolbar …>` call site (~line 668): delete `boxSummaries={panelState.boxSummaries}` and `boxExcludedCount={panelState.boxExcludedCount}`, add `{activeFilterTags}` (the local already exists — it is passed to `NavigationPane` at line 649). Leave `PanelModelState.boxExcludedCount` in `panel-model.ts` untouched; `NavigationPane` still consumes `boxSummaries` from the model.

**2b. Scope derivations.** `panelState.folderPath` reaches the toolbar as the *display* path: `FolderCardView.getDisplayFolderPath()` (line 4349) returns `"/"` for the vault root and the real path otherwise, so root detection must accept both `"/"` and `""`. Filter tags are stored without a leading `#` (see `describeRule` in `FolderCardView.ts:1071-1081`), but strip defensively. Add:

```ts
  function formatScopeTag(tag: string): string {
    return tag.startsWith("#") ? tag : `#${tag}`;
  }

  const isVaultRootScope = $derived(folderPath === "/" || folderPath === "");
  const folderScopeName = $derived(
    isVaultRootScope ? strings.folderMenu.rootFolder : (folderPath.split("/").pop() ?? folderPath),
  );
  const folderScopeFullLabel = $derived(
    isVaultRootScope ? strings.folderMenu.rootFolder : folderPath,
  );
  const tagScopeLabel = $derived(activeFilterTags.map(formatScopeTag).join(", "));

  function joinScope(folderLabel: string): string {
    return tagScopeLabel.length > 0 ? `${folderLabel}${strings.scope.separator}${tagScopeLabel}` : folderLabel;
  }

  const scopeText = $derived(isBoxMode ? (activeBoxName ?? "") : joinScope(folderScopeName));
  const scopeTooltip = $derived(isBoxMode ? (activeBoxName ?? "") : joinScope(folderScopeFullLabel));
```

`isBoxMode` already exists (line 217).

**2c. Markup.** Replace the whole `<div class="fce-toolbar-buttons">` body (lines 435-549) with three children in this order.

1. The existing collapse button, with the active state removed — its class becomes exactly `class="clickable-icon fce-toolbar-button"`. Keep `aria-pressed={navVisible}`, the `panel-left-close` / `panel-left-open` icon swap, the tooltip, and the sr-only label unchanged.
2. The scope element (static text, not focusable, no click handler):

```svelte
      <div class="fce-toolbar-scope {isBoxMode ? 'is-box' : ''}" use:applyTooltip={scopeTooltip}>
        <span class="fce-sr-only">{strings.scope.ariaLabel}</span>
        <span class="fce-toolbar-scope-text">{scopeText}</span>
      </div>
```

   `.fce-sr-only` is `position: absolute` (styles.css:833) so it does not consume flex width. Do not use `aria-label` here: Obsidian renders its own hover tooltip for every `aria-label`, which would double up with `setTooltip` (same reasoning as the comment above `<nav>` in `NavigationPane.svelte:432-435`).
3. `<div class="fce-toolbar-actions">` wrapping the buttons, preserving the existing `{#if isBoxMode}` / `{:else}` split:
   - Box mode: the sort button (unchanged, keeps `sortButtonId`, `captureSortButton`, `showSortMenu` selected class, `boxStrings.sortTitle`), then the `settings-2` configure button (unchanged — the user chose to keep it), then the bulk button. **Delete** the `fce-box-exit-button` (`arrow-left`) block and the entire `<div class="fce-toolbar-folder-group">` / `fce-box-switcher-button` block.
   - Browse mode: the existing `{#each TOOLBAR_ACTIONS …}` loop unchanged (new-note, sort, bulk), then a new save-scope button in place of the deleted `fce-box-entry-button`:

```svelte
        <button
          type="button"
          class="clickable-icon fce-toolbar-button"
          aria-label={boxStrings.saveScopeTitle}
          onclick={() => emitBoxCommand("save-scope-as-box")}
          use:applyIcon={"package-plus"}
          use:applyTooltip={boxStrings.saveScopeTitle}
        >
          <span class="fce-sr-only">{boxStrings.saveScopeTitle}</span>
        </button>
```

   - The search toggle button stays last, inside `.fce-toolbar-actions`, outside the `{#if}`.

   The save-scope button is browse-mode only on purpose: `openSaveScopeAsBoxModal` reads `getBrowseScope()` (folder + includeSubfolders + filter tags, `FolderCardView.ts:1062-1069`), which in box mode is not what the pane is showing.

**2d. Delete the custom box popup.** Remove the entire `{#if showBoxMenu}` block (lines 655-720) and every symbol that only serves it: `showBoxMenu`, `boxMenuX`, `boxMenuY`, `boxMenuEl`, `boxButtonEl`, `boxButtonId`, `captureBoxButton`, `closeBoxMenu`, `openBoxMenu`, `boxMenuAction`, `otherBoxes`. Keep `emitBoxCommand` but drop its `closeBoxMenu()` call so it becomes:

```ts
  function emitBoxCommand(command: string, boxId?: string): void {
    onBoxCommand?.(boxId === undefined ? { command } : { command, boxId });
  }
```

Keep `createPopupPortalAction`, `createElementCapture`, and the sort menu — the sort popup still uses them.

**2e. Toolbar tests** (`src/view/Toolbar.svelte.test.ts`, jsdom project) — update in this step so the suite stays green:

- `"renders first-row controls in the slim sequence"` (line 158): the expected `aria-label` list becomes `["Expand navigation", "Create note", "Sort cards", "Bulk actions", "Save current view as card box", "Toggle search"]` (`mountToolbar` defaults to `navVisible: false`).
- `"toggles the navigation pane through a dedicated callback"` (line 179): change line 197 to assert `collapseButton?.classList.contains("is-selected")` is `false`, and keep the click-emits-callback half.
- Delete `"opens the box entry menu and emits a create command"` (line 382) — the `.fce-box-menu` popup no longer exists.
- Add `"emits save-scope-as-box from the toolbar and hides it in box mode"`: mount browse-mode, click `button[aria-label="Save current view as card box"]`, expect `captured.boxCommandEvents` to contain `{ command: "save-scope-as-box" }`; remount with `activeBoxId: "box-1"`, `activeBoxName: "Reading"` and expect that button to be absent.
- Add `"renders the browsed folder and tags as truncatable scope text"`: mount with `folderPath: "Projects/2026/Notes"`, `activeFilterTags: ["work", "idea"]`; expect `.fce-toolbar-scope-text` text content to equal `"Notes · #work, #idea"`. Remount with `folderPath: "/"` and no tags → `"Root /"`. Remount with `activeBoxId: "box-1"`, `activeBoxName: "Reading"` → `"Reading"` and `.fce-toolbar-scope` carrying `is-box`.
- If the mount helper passes `boxSummaries` / `boxExcludedCount`, drop those from it.

### Step 3 — CSS (depends on Step 2; independent of Steps 5-7)

`styles.css`.

- `.folder-card-view .fce-toolbar-buttons` (line 350): delete `overflow-x: auto;` — it would horizontally scroll the row instead of compressing the scope text — and add `min-width: 0;`.
- Add after it:

```css
.folder-card-view .fce-toolbar-scope {
  display: flex;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  padding: 0 4px;
  color: var(--fce-text);
  font-size: var(--font-ui-small, 13px);
}

.folder-card-view .fce-toolbar-scope-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-card-view .fce-toolbar-scope.is-box .fce-toolbar-scope-text {
  font-weight: var(--font-medium, 600);
}

.folder-card-view .fce-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}
```

- Delete these now-unreferenced rules (verified: `.fce-folder-button*`, `.fce-toolbar-folder-group`, `.fce-box-menu*`, `.fce-box-switcher-button` appear only in `styles.css`, `Toolbar.svelte`, and `Toolbar.svelte.test.ts`): `.fce-toolbar-folder-group` (357), `.fce-folder-button` (366), `.fce-folder-button-text` (377), `.fce-folder-button-chevron` (386), the `--fce-toolbar-folder-button-min-width` token (line 27), `.fce-box-switcher-button .fce-folder-button-text` (1220), `.fce-box-menu` (1224), `.fce-box-menu-heading` (1232), `.fce-box-menu-invite` (1240), `.fce-box-menu-separator` (1248), `.fce-box-menu .fce-box-menu-item` (1254) and its `.is-destructive` variant (1267), `.fce-box-menu-label` (1271).
- Keep `.fce-toolbar-button.is-selected` (396) — sort, bulk, and search still use it.
- Keep `.menu.fce-card-context-menu` (1200) and `.fce-menu-item-danger` (1208) — Step 7 reuses them for the box menus.

### Step 4 — Delete the dead box strings (depends on Steps 1-2)

`src/i18n.ts`. After the toolbar rewrite these `BoxStrings` members have no reader (confirmed by grep over `src/**/*.{ts,svelte}`): `entryTitle`, `emptyInvite`, `addScopeToBox`, `switchHeading`, `manageHeading`, `exit`, `exitTitle`. Remove each from the interface and from both `en.box` and `zh.box`. Keep `configure`, `configureTitle`, `sortTitle`, `createBox`, `saveScopeAsBox`, `saveScopeTitle`, and everything the modals use.

### Step 5 — Give `TreeSection` a header context-menu hook (independent of Steps 2-4)

`src/view/TreeSection.svelte`. Add to `TreeSectionProps` and the destructured defaults:

```ts
    onHeaderContextMenu?: (event: MouseEvent) => void;
```

Attach it to the header wrapper only (not the toggle button, so the whole row including empty space responds):

```svelte
  <div class="fce-tree-section-header" oncontextmenu={(event) => onHeaderContextMenu?.(event)}>
```

Svelte 5 warns about interaction handlers on non-interactive elements only for keyboard/mouse *activation* handlers; `oncontextmenu` on a div containing a button needs no `role`. If `npm run check:svelte` does flag it, add `role="presentation"` to that div rather than moving the handler.

### Step 6 — Emit box context-menu requests from the nav pane (depends on Step 5)

**6a. Shared payload type.** `src/view/types.ts`, next to `FolderActionPayload` (line 242):

```ts
export interface BoxContextMenuPayload {
  boxId?: string;
  mouseEvent: MouseEvent;
}
```

Absent `boxId` means the request came from the section header / empty list area, i.e. the "create" menu.

**6b. `src/view/NavigationPane.svelte`.** Import `BoxContextMenuPayload` alongside `FolderActionPayload`, add the prop `onBoxContextMenu?: (payload: BoxContextMenuPayload) => void;` with a destructured default, and add:

```ts
  function requestBoxSectionMenu(event: MouseEvent): void {
    event.preventDefault();
    onBoxContextMenu?.({ mouseEvent: event });
  }

  function requestBoxRowMenu(event: MouseEvent, boxId: string): void {
    event.preventDefault();
    event.stopPropagation();
    onBoxContextMenu?.({ boxId, mouseEvent: event });
  }
```

`stopPropagation` in the row handler is required because the row `<button>` is a DOM child of `.fce-nav-box-list`, which also carries the section handler; without it a row right-click would open both menus.

Wire the boxes `TreeSection` (line 637) with `onHeaderContextMenu={requestBoxSectionMenu}`, add `oncontextmenu={requestBoxSectionMenu}` to the `<div class="fce-nav-box-list">` (line 646) so right-clicking the empty-state area also offers creation, and add `oncontextmenu={(event) => requestBoxRowMenu(event, box.id)}` to each `.fce-nav-box-item` button (line 652). Do not touch the existing left-click `selectBox` behavior (enter box / exit when already active) — it stays the only enter/exit affordance. Only the boxes section gets a menu; folders and tags keep their current behavior.

**6c. `src/view/FolderCardPanel.svelte`.** Import the type, add `onBoxContextMenu?: (payload: BoxContextMenuPayload) => void;` to `FolderCardPanelProps` plus its destructured entry, add a pass-through mirroring `handleFolderAction` (line 319):

```ts
  function handleBoxContextMenu(detail: BoxContextMenuPayload): void {
    onBoxContextMenu?.(detail);
  }
```

and pass `onBoxContextMenu={handleBoxContextMenu}` to `<NavigationPane>`.

**6d. Nav pane tests** (`src/view/NavigationPane.svelte.test.ts`, jsdom): extend the harness props/captured-events with `onBoxContextMenu` (follow the existing `folderActionEvents` pattern at lines 28/40/95) and add:

- `"emits a box context menu request with the box id"`: dispatch `new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 20 })` on the first `.fce-nav-box-item`; expect exactly one captured payload with `boxId` equal to that box's id, and expect no second payload from bubbling.
- `"emits a box context menu request without a box id from the section header and empty list"`: dispatch the same event on the boxes `.fce-tree-section-header` and on `.fce-nav-box-list`; expect two payloads, both with `boxId === undefined`.

### Step 7 — Build the Obsidian menus in the view (depends on Step 6)

`src/view/FolderCardView.ts`.

**7a. Wiring.** In the panel mount props (next to `onBoxCommand`, line 1443):

```ts
        onBoxContextMenu: (detail: { boxId?: unknown; mouseEvent?: unknown }) => {
          this.openBoxContextMenu(detail);
        },
```

**7b. New private method**, placed directly after `addCardContextMenuItems` so the card-menu helpers it reuses are adjacent:

```ts
  private openBoxContextMenu(detail: { boxId?: unknown; mouseEvent?: unknown }): void {
    if (!this.isMouseEventLike(detail.mouseEvent)) {
      return;
    }

    const menu = new Menu();
    const boxId = typeof detail.boxId === "string" ? detail.boxId : null;
    if (boxId === null) {
      this.addBoxCreationMenuItems(menu);
    } else if (!this.addBoxItemMenuItems(menu, boxId)) {
      return;
    }

    menu.showAtMouseEvent(detail.mouseEvent);

    const menuDom = this.getMenuDom(menu);
    if (menuDom) {
      this.decorateCardContextMenu(menuDom, this.strings.box.delete);
    }
  }
```

Reuse the existing helpers verbatim: `isMouseEventLike` (line 1921), `getMenuDom` (1884), and `decorateCardContextMenu` (1892), which adds the `fce-card-context-menu` class and red-tints the item whose title matches the label passed in. Passing `this.strings.box.delete` is what makes Delete render red, exactly like the card menu's delete item.

`addBoxCreationMenuItems(menu: Menu): void` — always add `box.createBox` (icon `package-plus`) → `this.handleBoxCommand({ command: "create" })`; add `box.saveScopeAsBox` (icon `bookmark-plus`) → `{ command: "save-scope-as-box" }` **only when `!this.isBoxMode()`**, matching the toolbar button rule and for the same reason (`getBrowseScope()` is meaningless while a box is projected).

`addBoxItemMenuItems(menu: Menu, boxId: string): boolean` — return `false` without adding anything if `findCardBox(this.plugin.getSettings().boxes, boxId)` is `null` (stale row after an external settings change), so the caller skips showing an empty menu. Otherwise add, in order:

1. `box.configure`, icon `settings-2` → `this.handleBoxCommand({ command: "configure", boxId })`
2. `box.addScopeToThisBox`, icon `list-plus` → `{ command: "add-scope-to-box", boxId }` — **only when `!this.isBoxMode()`**, same scope-validity reason
3. `menu.addSeparator()`
4. `box.rename`, icon `pencil` → `{ command: "rename", boxId }`
5. `box.duplicate`, icon `copy` → `{ command: "duplicate", boxId }`
6. `menu.addSeparator()`
7. `box.delete`, icon `trash-2` → `{ command: "delete", boxId }`

Every command id already exists in `handleBoxCommand` (lines 1083-1122) and every handler already falls back correctly, so route through `handleBoxCommand` rather than calling the private modal openers directly. `isBoxMode()` (line 920) and `findCardBox` are already imported/available.

Use the same `menu.addItem((item) => { item.setTitle(…).setIcon(…).onClick(() => { … }); })` shape as `addCardContextMenuItems` (lines 1946-1953).

**7c. Test-mock seam.** `src/__mocks__/FolderCardPanel.svelte.ts` only forwards callbacks listed in `CALLBACK_PROP_TO_EVENT`. Add `onBoxContextMenu: "box-context-menu"` to that map and `onBoxContextMenu?: (payload: unknown) => void;` to its `PanelProps`, otherwise view-level tests cannot fire the event.

**7d. View tests.** Menu-construction tests for this view live in `src/view/card-context-actions.test.ts` (node project; it already has a `MockMenu` capturing titles/icons/`showAtMouseEvent` at lines 259-268). Add a `describe` there:

- `"box row context menu offers configure, add-current-view, rename, duplicate, and delete"`: seed settings with one box, call `(view as any).openBoxContextMenu({ boxId: "<id>", mouseEvent: { clientX: 5, clientY: 6 } })`, assert the captured item titles equal the English strings in the order above, that `showAtMouseEvent` was called once with that event, and that the menu dom got the `fce-card-context-menu` class.
- `"box section context menu offers creation entries and hides save-current-view inside a box"`: call with no `boxId` in browse mode → titles `["New card box…", "Save current view as card box…"]`; set `activeBoxId` to an existing box and call again → only `["New card box…"]`; also assert the box-row menu omits `"Add current view to this card box"` in that state.
- `"box context menu is ignored for an unknown box id or a non-mouse event"`: expect no menu instance created for `{ boxId: "missing", mouseEvent: {…} }` and for `{ boxId: "<id>", mouseEvent: null }`.

Add one wiring test in `src/view/FolderCardView.test.ts` (jsdom) following the existing `panelEventHandlers` pattern: fire the `box-context-menu` handler and assert `openBoxContextMenu` (spied) receives the payload.

## Critical files & anchors

- `src/view/Toolbar.svelte` — `<div class="fce-toolbar-buttons">` (435-549) is the row being restructured; `{#if showBoxMenu}` (655-720) is the popup being deleted. Both `isBoxMode` branches must keep their sort-button ids/captures intact or the sort popup breaks.
- `src/view/FolderCardView.ts` — `openCardContextMenu` / `decorateCardContextMenu` / `addCardContextMenuItems` (1843-2000) is the exact pattern to copy for menu styling; `handleBoxCommand` (1083-1122) is the command surface to route into, unchanged.
- `src/view/NavigationPane.svelte` — boxes `TreeSection` and `.fce-nav-box-list` (637-669) is where both context-menu triggers attach; `selectBox` (389-396) documents that left-click already enters/exits.
- `src/__mocks__/FolderCardPanel.svelte.ts` — `CALLBACK_PROP_TO_EVENT` (34-48) gates which panel callbacks view tests can fire.
- `styles.css` — `.fce-toolbar-buttons` (350) and the `.fce-box-menu*` block (1224-1274) are the add/delete sites.

## Verification

Run from the repo root:

```bash
npm run check && npm run check:svelte && npm run build && npm test
```

Targeted while iterating:

```bash
npx vitest run src/view/Toolbar.svelte.test.ts
npx vitest run src/view/NavigationPane.svelte.test.ts
npx vitest run src/view/card-context-actions.test.ts
npx vitest run src/view/FolderCardView.test.ts
```

Manual checks in Obsidian (build, then reload the plugin; the view is the left-sidebar Card Workspace pane):

1. With the nav pane open, the collapse button has no filled background; hovering still highlights it, and the icon flips between `panel-left-close` and `panel-left-open` as it is toggled.
2. Select `Projects/2026/Notes` in the nav pane and check two tags — the row reads `Notes · #work, #idea` right after the collapse button, and the icon buttons sit flush against the right edge. Drag the nav pane resize handle wider (and narrow the whole sidebar): the scope text shortens with a trailing `…` while no horizontal scrollbar appears in the row. Hover it to see the full path in the tooltip.
3. Select the vault root with no tags → the scope reads `Root /`.
4. In browse mode click the `package-plus` button → the "Save current view as card box" modal opens with the scope-derived default name. Enter a box; the scope text becomes the box name in medium weight, the `package-plus` button is gone, and no back arrow or name dropdown is present.
5. Right-click the "Card boxes" section header → menu with `New card box…` + `Save current view as card box…` (the latter absent while inside a box). Right-click a box row → configure / add-current-view / rename / duplicate / delete, with Delete in red and the same width and styling as a card right-click menu. Each item performs its action. With no boxes, right-click the "No card boxes yet — right-click to create one" area and confirm the creation menu opens there too.
6. Left-click the active box row to exit back to folder browsing, confirming the removed toolbar back arrow was redundant.

## Assumptions & contingencies

- Scope text shows only the folder's last path segment (full path in the tooltip) because trailing-ellipsis truncation would eat the most informative segment of a full path.
- `package-plus`, `bookmark-plus`, `list-plus`, `pencil`, `settings-2`, `copy`, and `trash-2` are assumed present in the bundled Lucide set. If any renders blank, substitute from icons already used in this repo: `gallery-horizontal` for the save-scope button, `folder-input` for add-current-view, `square-pen` for rename.
- Right-click is the only affordance for box management; no hover "more actions" button is added to nav rows. If discoverability proves insufficient in use, the follow-up is a hover-revealed `…` button on `.fce-nav-box-item` reusing the same `openBoxContextMenu` payload with `trigger: "button"` and `showAtPosition`, mirroring `CardItem.svelte:432-438`.
- `PanelModelState.boxExcludedCount` is left in place even though nothing reads it after the toolbar prop is dropped; removing it is not part of this change.
- If `svelte-check` rejects `oncontextmenu` on `.fce-nav-box-list` or `.fce-tree-section-header` without a role, add `role="presentation"` to that element instead of relocating the handler.
