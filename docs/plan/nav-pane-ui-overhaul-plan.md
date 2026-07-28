# Navigation pane UI overhaul

## Context

The left navigation pane (`NavigationPane.svelte`, added alongside the card pane inside `.fce-shell`) has three defects: its tree rows render with broken layout and a visual style that clashes with the card pane; the collapse toggle sits inside the nav pane itself and leaves a 36px rail behind when collapsed; and hovering a folder row reveals three management buttons (new / move / delete folder) that should not exist because those actions will later move to a right-click menu.

End state: folder management buttons are gone (the host-side action plumbing stays for the future context menu); the toggle lives in the card pane's toolbar and fully hides the nav pane; when the whole view is too narrow for two columns, the layout falls back to a single-pane mode where nav and cards swap at full width; and the nav pane's rows adopt a style consistent with the card pane and Obsidian's native sidebar.

Work is split into three steps that land in order. The tree builds and the existing suite passes after each step.

## Approach

### Step 1 — Remove folder hover actions, move the toggle into the toolbar

Independent of Steps 2 and 3 except that Step 2 builds on the state fields introduced here.

**1.1 Delete the folder row action buttons** (`src/view/NavigationPane.svelte`)

Delete these, in full:

- the `FolderActionOption` interface (lines 34-38)
- the `onFolderAction` prop declaration (line 59) and its destructured binding (line 85)
- `getFolderActionOptions()` (lines 168-191)
- `triggerFolderAction()` (lines 219-222)
- the `<div class="fce-folder-row-end">` block in the folder tree template (lines 386-406)
- `FolderManagementAction` and `FolderActionPayload` from the `./types` import on line 12 (keep `FolderTreeNode`)

Replace the deleted `fce-folder-row-end` block with the selected-state indicator alone, matching the tag tree's structure at lines 456-460:

```svelte
<div class="fce-popup-row-trailing" aria-hidden={!isSelected}>
  {#if isSelected}
    <span class="fce-popup-row-selected-indicator fce-tree-row-check" use:applyIcon={"check"}></span>
  {/if}
</div>
```

Do **not** touch `onFolderAction` anywhere else. `FolderCardPanel.svelte` (props line 92, binding 157, `handleFolderAction` 312-314, forwarding 628), `FolderCardView.handleFolderActionRequest` (lines 1533-1551) with `openCreateChildFolderModal` / `openMoveFolderPickerForFolder` / `deleteFolder`, the `FolderManagementAction` / `FolderActionPayload` types in `src/view/types.ts` (237-242), and the `folderMenu.createChildFolder` / `moveFolder` / `deleteFolder` i18n strings all stay — the planned right-click menu re-enters through exactly this seam. Remove only the `onFolderAction={handleFolderAction}` line from the `<NavigationPane>` call in `FolderCardPanel.svelte` (line 628), since the component no longer declares that prop. That leaves `FolderCardPanel`'s own `onFolderAction` prop and its `handleFolderAction` forwarder temporarily unreferenced — keep both; `tsconfig.json` sets neither `noUnusedLocals` nor `noUnusedParameters`, so `npm run check` stays green.

**1.2 Delete the corresponding CSS** (`styles.css`)

Delete these rule blocks entirely:

- `.fce-folder-menu .fce-folder-row-end` (609-615)
- `.fce-folder-menu .fce-folder-row-actions` (617-633)
- `.fce-folder-menu .fce-tree-row:hover .fce-folder-row-actions, ...:focus-within...` (635-640)
- `.fce-folder-menu .fce-tree-row:hover .fce-popup-row-trailing, ...:focus-within...` (642-646)
- `.fce-folder-menu .fce-folder-row-action` (648-665)
- `.fce-folder-menu .fce-popup-row-trailing` (667-669)

In the combined hover rule at 671-677, drop the two `.fce-folder-menu .fce-folder-row-action...` selectors and keep only the chevron selectors:

```css
.fce-tree-menu .fce-tree-chevron:hover,
.fce-tree-menu .fce-tree-chevron:focus-visible {
  background: var(--background-modifier-hover);
  color: var(--text-normal);
}
```

**1.3 Introduce `layoutMode` and `navVisible`, retire `navPaneCollapsed` from panel state**

`navPaneCollapsed` remains a persisted setting in `src/settings.ts` and is not renamed or removed there. It stops being a render input: the panel state carries the derived values instead. Clean cutover — no alias field.

In `src/view/panel-model.ts` `PanelModelState` (line 61), replace:

```ts
navPaneCollapsed: boolean;
```

with:

```ts
layoutMode: "dual" | "single";
navVisible: boolean;
```

`navPaneWidth` stays.

In `src/view/FolderCardView.ts`, add two private helpers near `onToggleNavPane` (line 4461):

```ts
private getLayoutMode(): "dual" | "single" {
  return "dual";
}

private getNavVisible(): boolean {
  return !this.plugin.getSettings().navPaneCollapsed;
}
```

`getLayoutMode()` is hardcoded in this step and becomes width-driven in Step 2.

Update `buildPanelModelState()` (line 4313) — replace `navPaneCollapsed: settings.navPaneCollapsed,` with:

```ts
layoutMode: this.getLayoutMode(),
navVisible: this.getNavVisible(),
```

Update `pushState()` (line 4402) — replace `state.navPaneCollapsed = settings.navPaneCollapsed;` with:

```ts
state.layoutMode = this.getLayoutMode();
state.navVisible = this.getNavVisible();
```

`onToggleNavPane()` (4461-4464) is unchanged in this step: it still flips the persisted `navPaneCollapsed`, and the existing `saveSettings` → refresh → `pushState` path recomputes `navVisible`.

Update the four other places that construct a `PanelModelState` literal, replacing `navPaneCollapsed: false` with `layoutMode: "dual", navVisible: true`:

- `src/view/FolderCardPanel.svelte` `EMPTY_PANEL_STATE` (line 137)
- `src/view/FolderCardPanel.svelte.test.ts` `createInitialPanelState()` (line 72)
- `src/view/pipeline.test.ts` (line 31)
- `src/view/NavigationPane.svelte.test.ts` `mountNav()` props (line 121) — this one is component props, not panel state; see 1.6

Verify the full set with `rg -n 'navPaneCollapsed' src/` after editing; the only remaining hits must be in `src/settings.ts` and `src/view/FolderCardView.ts`.

**1.4 Delete the collapsed rail from the nav pane** (`src/view/NavigationPane.svelte`, `styles.css`)

In the template, delete the entire `{#if navPaneCollapsed}` branch (lines 302-314) and the `{:else}` / `{/if}` wrapper, so the `<nav class="fce-nav-pane">` element renders unconditionally. Also delete the `fce-nav-pane-header` div and its toggle button (lines 317-328) — Step 2 reintroduces this header in a different role.

Replace the `navPaneCollapsed` prop (declaration line 52, default line 78) with:

```ts
layoutMode?: "dual" | "single";
```

defaulting to `"dual"`. Keep the `onToggleNavPane` prop — Step 2 rewires it to the back button.

The inline width must not fight the single-pane rule added in Step 2, so make it conditional now (line 316):

```svelte
<nav
  class="fce-nav-pane"
  aria-label={strings.navPane.ariaLabel}
  style={layoutMode === "single" ? "" : `width: ${paneWidth}px;`}
>
```

In `styles.css`, delete `.folder-card-view .fce-nav-pane.is-collapsed` (57-61), `.folder-card-view .fce-nav-pane-header` (63-69), and `.folder-card-view .fce-nav-pane.is-collapsed .fce-nav-pane-toggle` (71-73). Step 2 adds a new `.fce-nav-pane-header` rule.

**1.5 Add the toggle button to the toolbar** (`src/view/Toolbar.svelte`, `src/view/FolderCardPanel.svelte`, `styles.css`)

In `Toolbar.svelte`, add to `ToolbarProps` (after `folderPath`, line 40):

```ts
navVisible?: boolean;
onToggleNavPane?: () => void;
```

and to the destructuring (line 149 area / line 172 area) with `navVisible = false` as the default.

Use a dedicated callback, **not** the `onToolbarAction` string channel: `selectToolbarAction()` records the clicked id into `activeToolbarAction` for `is-selected` highlighting (lines 278-281), and this button's highlight must track `navVisible`, not "last clicked".

Insert as the first child of `.fce-toolbar-buttons` (line 431), outside and above the `{#if isBoxMode}` at line 432 so it renders in both browse and box modes:

```svelte
<button
  type="button"
  class="clickable-icon fce-toolbar-button {navVisible ? 'is-selected' : ''}"
  aria-label={navVisible ? strings.navPane.collapsePane : strings.navPane.expandPane}
  aria-pressed={navVisible}
  onclick={() => onToggleNavPane?.()}
  use:applyIcon={navVisible ? "panel-left-close" : "panel-left-open"}
  use:applyTooltip={navVisible ? strings.navPane.collapsePane : strings.navPane.expandPane}
>
  <span class="fce-sr-only">{navVisible ? strings.navPane.collapsePane : strings.navPane.expandPane}</span>
</button>
```

`strings` is `ToolbarStrings`, which already contains `navPane` (`src/i18n.ts` lines 83-96), so no new i18n keys are needed here.

In `FolderCardPanel.svelte`: add `const navVisible = $derived(panelState.navVisible);` and `const layoutMode = $derived(panelState.layoutMode);` next to the other derived reads (lines 254-258, replacing the `navPaneCollapsed` derived on line 255). Pass `{navVisible}` and `onToggleNavPane={handleToggleNavPane}` to `<Toolbar>` (line 635 block), and pass `{layoutMode}` instead of `{navPaneCollapsed}` to `<NavigationPane>` (line 621).

Add the shell visibility rule to `styles.css`, immediately after the `.folder-card-view .fce-shell` block (line 35):

```css
.folder-card-view .fce-shell.is-nav-hidden .fce-nav-pane {
  display: none;
}
```

and set the class in `FolderCardPanel.svelte` on the shell element (line 608):

```svelte
<div class="fce-shell {bulkMode ? 'is-bulk-mode' : ''} {layoutMode === 'single' ? 'is-single' : 'is-dual'} {navVisible ? 'is-nav-visible' : 'is-nav-hidden'}">
```

The `is-single` / `is-nav-visible` classes are inert until Step 2 adds rules for them; emit them now so Step 2 is CSS-only on the shell.

Hiding with `display: none` rather than `{#if}` is required: `NavigationPane` owns `expandedFolderPaths`, `expandedTagPaths`, and `seededTagExpansion` as component-local `$state` (lines 92-94), and unmounting would reset the user's folder-tree expansion on every toggle.

**1.6 Update tests**

`src/view/NavigationPane.svelte.test.ts`:
- In `mountNav()` (line 121), replace `navPaneCollapsed: false` with `layoutMode: "dual"`.
- Replace the test `"collapses to a rail and emits onToggleNavPane"` (lines 271-288) with `"renders no pane header in dual layout"`, asserting `document.querySelector(".fce-nav-pane-header")` is `null` and `document.querySelector(".fce-nav-pane")` is not `null`.
- Keep `onToggleNavPane` in `NavCallbacks` and `createCaptured()` (lines 31, 81-84) even though no test fires it after this step; Step 2 adds the back-button test that uses it.

`src/view/Toolbar.svelte.test.ts`: add a test that mounts with `navVisible: false` plus an `onToggleNavPane` spy, finds `button[aria-label="Expand navigation"]`, clicks it, asserts the spy fired once and that `onToolbarAction` did **not** fire; then remounts with `navVisible: true` and asserts `button[aria-label="Collapse navigation"]` exists and carries `is-selected`.

`src/view/FolderCardPanel.svelte.test.ts` and `src/view/pipeline.test.ts`: field rename only (1.3).

### Step 2 — Responsive single-pane fallback

Depends on Step 1.

**2.1 Add the width threshold constant** (`src/settings.ts`)

Next to `NAV_PANE_WIDTH_MIN` / `MAX` / `DEFAULT_NAV_PANE_WIDTH` (lines 20-22):

```ts
export const CARD_PANE_MIN_WIDTH = 304;
```

304 = `--fce-card-min-width` (280px, `styles.css` line 21) + `.fce-list` horizontal padding (2 × `--fce-wall-gap` at 12px, `styles.css` line 802). Below that the card grid squashes cards under their minimum instead of reflowing.

**2.2 Report shell width from Svelte to the host** (`src/view/FolderCardPanel.svelte`)

Add `onShellResize?: (width: number) => void;` to `FolderCardPanelProps` and destructure it. Add an action modeled on the existing `bindViewport` (lines 450-468):

```ts
function bindShell(node: HTMLDivElement): { destroy: () => void } {
  const report = (): void => {
    onShellResize?.(node.clientWidth);
  };

  report();
  const resizeObserver = new ResizeObserver(report);
  resizeObserver.observe(node);

  return {
    destroy() {
      resizeObserver.disconnect();
    },
  };
}
```

Apply `use:bindShell` to the `.fce-shell` element. The layout mode itself is computed host-side, per the repo's host-owned-state rule (`AGENTS.md`); Svelte reports the raw measurement only.

**2.3 Guard the viewport measurement against zero width** (`src/view/FolderCardPanel.svelte`)

Hiding `.fce-main-pane` with `display: none` makes its `ResizeObserver` report a 0 width, which drives `columnCount` to 1 and then trips the effect at lines 485-490 (`columnCount !== lastMeasuredColumnCount` → `rowHeightMap = new Map()`), throwing away every measured row height and causing a visible re-layout when the pane returns.

Add an early return at the top of `syncViewportMetrics` (line 424):

```ts
function syncViewportMetrics(node: HTMLDivElement): void {
  if (node.clientWidth === 0) {
    return;
  }
  ...
}
```

Leave the `viewportWidth === 0` recovery effect (lines 531-535) as is: with the guard, it calls a function that returns without mutating state, so it settles instead of looping.

**2.4 Host-side layout mode and single-pane view** (`src/view/FolderCardView.ts`)

Add two private fields alongside the other runtime state:

```ts
private shellWidth = 0;
private singlePaneView: "nav" | "cards" = "cards";
```

Replace the Step 1 stub `getLayoutMode()`:

```ts
private getLayoutMode(): "dual" | "single" {
  if (this.shellWidth <= 0) {
    return "dual";
  }
  return this.shellWidth < this.plugin.getSettings().navPaneWidth + CARD_PANE_MIN_WIDTH
    ? "single"
    : "dual";
}
```

A zero or unmeasured width must resolve to `"dual"`. `FolderCardPanel.svelte.test.ts` stubs `ResizeObserver` with a no-op `observe()` (lines 9-17) and jsdom reports `clientWidth === 0`, so any other default would flip every existing panel test into single-pane and break the assertions at lines 120-121 and 157-158.

Replace `getNavVisible()`:

```ts
private getNavVisible(): boolean {
  if (this.getLayoutMode() === "single") {
    return this.singlePaneView === "nav";
  }
  return !this.plugin.getSettings().navPaneCollapsed;
}
```

Add a narrow push that only refreshes the two layout fields:

```ts
private pushNavLayoutState(): void {
  this.panelModel.mutate((state) => {
    state.layoutMode = this.getLayoutMode();
    state.navVisible = this.getNavVisible();
  });
}
```

Add the resize handler:

```ts
private onShellResize(width: number): void {
  if (typeof width !== "number" || !Number.isFinite(width)) {
    return;
  }

  const nextWidth = Math.round(width);
  if (nextWidth === this.shellWidth) {
    return;
  }

  const previousMode = this.getLayoutMode();
  this.shellWidth = nextWidth;

  if (previousMode === "dual" && this.getLayoutMode() === "single") {
    this.singlePaneView = "cards";
  }

  this.pushNavLayoutState();
}
```

The push is unconditional rather than gated on a mode change: `panelModel.mutate` is a shallow clone plus listener fan-out, and the early `nextWidth === this.shellWidth` return already absorbs the repeated identical measurements that a drag produces.

Auto-falling back to `"cards"` (not `"nav"`) is required: the toolbar lives inside `.fce-main-pane`, so a fallback landing on the nav view would leave the user with a pane whose only control is the back button.

Rewrite the toggle:

```ts
private async onToggleNavPane(): Promise<void> {
  if (this.getLayoutMode() === "single") {
    this.singlePaneView = this.singlePaneView === "nav" ? "cards" : "nav";
    this.pushNavLayoutState();
    return;
  }

  const current = this.plugin.getSettings().navPaneCollapsed;
  await this.plugin.saveSettings({ navPaneCollapsed: !current });
}
```

Single-pane toggling deliberately does not write `navPaneCollapsed`: it is a transient view swap, and persisting it would leave the nav pane hidden after the user widens the panel back to two columns.

Add the return-to-cards helper and call it from the nav-driven scope changes:

```ts
private returnToCardsViewIfSinglePane(): void {
  if (this.getLayoutMode() !== "single" || this.singlePaneView === "cards") {
    return;
  }

  this.singlePaneView = "cards";
  this.pushNavLayoutState();
}
```

Call it as the first statement of `selectFolderFromNav` (line 4441), `onFilterChange` (line 4410, before the `isBoxMode()` guard), and `onIncludeSubfoldersChange` (line 4482, before its guards). Also call it in `handleBoxCommand` (line 1055) for the `"switch"` and `"exit"` cases only, before their `saveSettings` calls.

Do **not** call it from `onToggleNavSection` (line 4466): collapsing a nav section changes nav presentation only, while the other four change the card result set and so warrant showing the result.

Wire the new callback in `onOpen()`'s prop object, next to `onNavPaneResize` (line 1415):

```ts
onShellResize: (width: number) => {
  this.onShellResize(width);
},
```

**2.5 Single-pane back button in the nav pane** (`src/view/NavigationPane.svelte`, `src/i18n.ts`, `styles.css`)

Re-add a header, rendered only in single-pane layout, as the first child of `<nav class="fce-nav-pane">`:

```svelte
{#if layoutMode === "single"}
  <div class="fce-nav-pane-header">
    <button
      type="button"
      class="clickable-icon fce-nav-pane-toggle"
      aria-label={strings.navPane.backToCards}
      onclick={() => onToggleNavPane?.()}
      use:applyIcon={"arrow-left"}
      use:applyTooltip={strings.navPane.backToCards}
    >
      <span class="fce-sr-only">{strings.navPane.backToCards}</span>
    </button>
  </div>
{/if}
```

It reuses `onToggleNavPane` — in single-pane mode that call already means "swap to the other view".

Add `backToCards: string;` to the `navPane` block of the `ToolbarStrings` interface (`src/i18n.ts` lines 83-96), `backToCards: "Back to cards",` to the `en` table (lines 488-501), and `backToCards: "返回卡片",` to the `zh` table (lines 866-879). TypeScript enforces both locales.

Add the header rule to `styles.css` where the deleted one was (after line 55):

```css
.folder-card-view .fce-nav-pane-header {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 6px;
  flex: 0 0 auto;
}
```

**2.6 Single-pane shell CSS** (`styles.css`)

Add after the `.is-nav-hidden` rule from Step 1:

```css
.folder-card-view .fce-shell.is-single.is-nav-visible .fce-main-pane {
  display: none;
}

.folder-card-view .fce-shell.is-single .fce-nav-pane {
  flex: 1 1 auto;
  width: 100%;
  border-right: none;
}

.folder-card-view .fce-shell.is-single .fce-nav-resize-handle {
  display: none;
}
```

The resize handle is hidden rather than conditionally rendered — it holds no state worth preserving, and CSS keeps the template simpler.

**2.7 Tests**

`src/view/FolderCardView.test.ts` — add cases driving the private methods directly, matching the file's existing `(view as any).method(...)` style (see lines 1367-1369):

- `onShellResize(400)` then `onToggleNavPane()` leaves `plugin.saveSettings` uncalled for `navPaneCollapsed` and flips the pushed `navVisible` to `true`; a second `onToggleNavPane()` flips it back to `false`.
- `onShellResize(800)` then `onToggleNavPane()` calls `saveSettings` with `{ navPaneCollapsed: true }`.
- With `onShellResize(400)` and `singlePaneView` set to `"nav"`, calling `selectFolderFromNav("projects")` pushes `navVisible === false`.
- Going `onShellResize(800)` → `onShellResize(400)` while the nav was visible pushes `layoutMode === "single"` and `navVisible === false`.

Read the latest pushed snapshot through the existing `__mockState.panelSnapshots` capture in `src/__mocks__/FolderCardPanel.svelte.ts` (lines 54-58).

`src/view/NavigationPane.svelte.test.ts` — add a case mounting with `layoutMode: "single"` that asserts `button[aria-label="Back to cards"]` exists and firing its click increments `captured.togglePaneEvents`.

### Step 3 — Restyle the navigation pane

Depends on Steps 1 and 2 (row padding and section spacing are tuned against the final DOM).

**3.1 Fix the broken row layout by unscoping the popup row primitives** (`styles.css`)

Root cause: the nav tree reuses the popup menu's row markup (`fce-popup-row`, `fce-popup-row-leading` / `-content` / `-trailing`) but every layout declaration is scoped under `.fce-popup-menu` (lines 522-559), and `.fce-tree-menu.fce-nav-tree` has no such ancestor. The rows therefore fall back to block layout and stack the chevron, label, and check mark vertically.

Split the block at lines 522-559 into an unscoped layout layer plus a menu-only visual layer:

```css
.fce-popup-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.fce-popup-row-leading,
.fce-popup-row-trailing {
  flex: 0 0 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  min-height: 16px;
}

.fce-popup-row-content {
  min-width: 0;
  flex: 1;
  display: inline-flex;
  align-items: center;
}

.fce-popup-menu .fce-popup-row {
  min-height: 28px;
  border-radius: 4px;
  color: var(--text-normal);
  font-size: var(--font-ui-small, 13px);
  line-height: 1.4;
  transition: background-color 120ms ease, color 120ms ease;
}
```

Keep `.fce-popup-menu .fce-popup-row:hover` (534-536) and `:focus-within` (538-542) menu-scoped and unchanged.

Move the popup-only sizing off the shared tree class. Change `.fce-tree-menu` (585-591) to drop `width` and `max-height`:

```css
.fce-tree-menu {
  padding: var(--size-2-3, 6px) 0;
  overflow-x: hidden;
}
```

and add the popup-only variant immediately after:

```css
.fce-popup-menu .fce-tree-menu {
  width: 250px;
  max-height: 444px;
  overflow-y: auto;
}
```

This removes the reverse-override that `.folder-card-view .fce-nav-tree` (165-170) currently relies on; leave that rule in place.

**3.2 Add nav row design tokens** (`styles.css`)

Append to the `.folder-card-view` token block (lines 10-28):

```css
  --fce-nav-row-height: 26px;
  --fce-nav-row-radius: var(--radius-s, 4px);
  --fce-nav-indent-step: 16px;
  --fce-nav-row-hover: var(--nav-item-background-hover, var(--background-modifier-hover));
  --fce-nav-row-active-bg: var(--nav-item-background-active, var(--background-modifier-hover));
  --fce-nav-row-active-color: var(--nav-item-color-active, var(--text-normal));
```

Every Obsidian `--nav-item-*` reference carries a fallback, so the styling holds even on themes that omit them.

**3.3 Give nav rows their own visual layer** (`styles.css`)

Add after the `.folder-card-view .fce-nav-tree` block (line 170):

```css
.folder-card-view .fce-nav-tree .fce-tree-row {
  min-height: var(--fce-nav-row-height);
  margin: 0 4px;
  padding-inline-end: 6px;
  border-radius: var(--fce-nav-row-radius);
  color: var(--fce-text);
  font-size: var(--font-ui-small, 13px);
  transition: background-color 120ms ease, color 120ms ease;
}

.folder-card-view .fce-nav-tree .fce-tree-row:hover {
  background: var(--fce-nav-row-hover);
}
```

Then override the two popup-inherited selection rules for the nav context — `.fce-folder-menu .fce-tree-row.is-selected` / `.fce-tag-menu .fce-tree-row.is-selected` (603-607) currently only set a flat hover background:

```css
.folder-card-view .fce-nav-tree .fce-tree-row.is-selected {
  background: var(--fce-nav-row-active-bg);
  color: var(--fce-nav-row-active-color);
  font-weight: var(--nav-item-weight-active, 600);
}
```

**3.4 Switch row indentation to the token** (`src/view/NavigationPane.svelte`)

In both tree loops (folder row line 359, tag row line 429), replace the hardcoded inline padding:

```svelte
style="padding-left: {node.depth * 16 + 8}px;"
```

with:

```svelte
style="padding-left: calc(var(--fce-nav-indent-step) * {node.depth} + 8px);"
```

**3.5 Fix the section headers** (`styles.css`)

`.folder-card-view .fce-tree-section-toggle` (109-128) is a `<button>` that sets `display: inline-flex` but no `justify-content`, so Obsidian's base button styling centers its chevron and title — the visible symptom is the "文件夹 / 标签 / 卡片盒" labels floating in the middle of the pane while the tree below is left-aligned. Add `justify-content: flex-start;` to that rule, and drop `text-transform: uppercase;` and `letter-spacing: 0.04em;` (they do nothing for CJK and read foreign next to Obsidian's native sidebar headings).

Delete the `border-bottom` from `.folder-card-view .fce-tree-section` (98-100), leaving the section as a spacing-only container:

```css
.folder-card-view .fce-tree-section {
  padding-bottom: 4px;
}
```

**3.6 Align the pane background with the card pane** (`styles.css`)

`.folder-card-view .fce-nav-pane` (45-55) currently paints `background: var(--fce-surface)`, which is the same token the cards themselves use (line 843) — so the nav pane reads as one oversized card while sitting next to a differently-coloured card canvas. Change it to `background: var(--fce-bg);` and keep the `border-right` as the only separator in dual layout.

## Critical files & anchors

- `src/view/NavigationPane.svelte` — template lines 302-510 hold the collapsed-rail branch, the pane header, and both tree loops; the component-local `expandedFolderPaths` / `expandedTagPaths` at lines 92-94 are the reason hiding must be CSS-based.
- `styles.css` lines 492-559 — the `.fce-popup-menu`-scoped row primitives whose scoping is the root cause of the broken nav rows; splitting them is the highest-risk edit in Step 3 because the sort and box menus consume the same classes.
- `src/view/FolderCardPanel.svelte` lines 424-535 and 608-719 — `syncViewportMetrics` plus the row-measurement effects that the `display: none` guard protects, and the shell/toolbar/nav wiring that every step touches.
- `src/view/FolderCardView.ts` lines 1385-1424 and 4282-4480 — the panel callback wiring and the panel-state builders/pushers where `layoutMode`, `navVisible`, and the toggle branch live.
- `src/view/FolderCardPanel.svelte.test.ts` lines 9-17 and 118-121 — the no-op `ResizeObserver` stub and the both-panes-present assertions that force `getLayoutMode()` to default to `"dual"` at zero width.

## Verification

Run after each step, from the repository root:

```bash
npm run check && npm run check:svelte && npm run build && npm test
```

Targeted reruns while iterating:

```bash
npx vitest run src/view/NavigationPane.svelte.test.ts
npx vitest run src/view/Toolbar.svelte.test.ts
npx vitest run src/view/FolderCardView.test.ts
npx vitest run src/view/FolderCardPanel.svelte.test.ts
```

New-behavior checks that the suite alone does not cover — build with `npm run build`, then reload the plugin in Obsidian (Settings → Community plugins → toggle off/on) and open the Card Workspace view in the left sidebar:

1. **Toggle position and full hide (Step 1).** With the left sidebar wide enough for two columns, confirm the leftmost toolbar button in the card pane carries the "Collapse navigation" tooltip. Click it: the nav pane disappears completely with no residual strip, and the button's tooltip becomes "Expand navigation". Click again to restore. Expand two or three folders in the tree, collapse and re-expand the pane, and confirm the expansion state survived.
2. **No folder hover buttons (Step 1).** Hover any folder row: only the chevron and the row highlight appear; no folder-plus, folder-input, or trash icons.
3. **Single-pane fallback (Step 2).** Drag the Obsidian sidebar divider until the view is narrower than roughly 544px (the default 240px nav width plus 304px). The nav pane disappears and the card pane keeps full width. Click the toolbar toggle: the nav pane now fills the whole view and shows a back arrow at the top; the card pane is hidden. Click a folder row: the view returns to cards, scoped to that folder. Click the toggle again, then the back arrow, and confirm it also returns to cards. Widen the sidebar past the threshold and confirm the two-column layout returns with the nav pane visible.
4. **No card-grid thrash (Step 2).** In a folder with 30+ notes, scroll partway down, toggle the nav pane hidden and visible twice, and confirm the card rows do not visibly re-measure or jump — this exercises the `syncViewportMetrics` zero-width guard.
5. **Row layout and style (Step 3).** Each folder and tag row renders chevron, label, and check mark on a single line at roughly 26px height, section headings ("Folders" / "Tags" / "Boxes") are left-aligned with the tree below them, hovering a row shows a rounded highlight, and the nav pane background matches the card pane's canvas rather than the cards.

## Assumptions & contingencies

- **The single-pane threshold is `navPaneWidth + 304`.** If in practice the fallback triggers too eagerly at the default nav width, lower `CARD_PANE_MIN_WIDTH` to 280 (dropping the list padding from the budget) rather than adding a settings knob.
- **Obsidian defines `--nav-item-background-hover`, `--nav-item-background-active`, `--nav-item-color-active`, and `--nav-item-weight-active`** — unverified against a live theme this session. Every use carries a fallback, so if any are absent the styling degrades to `--background-modifier-hover` / `--text-normal` / `600` with no visual breakage; no code change is needed.
- **The section-header centering comes from Obsidian's base `button` rule.** If adding `justify-content: flex-start` alone does not left-align the headings, also add `text-align: left;` to `.fce-tree-section-toggle` and `flex: 1 1 auto;` to `.fce-tree-section-title`.
- **No layout-mode preference setting is added.** The mode is derived from width only. If users later want to force single-pane on a wide panel, add a `layoutModePreference` setting that `getLayoutMode()` consults before the width check — the two-layer split (preference vs. effective mode) is already in place.
- **`isDesktopOnly` stays true** and no mobile branch is added; the width-driven fallback covers narrow sidebars on desktop.
