# Navigation pane icon affordances and tag counts

## Context

Six navigation-pane refinements, all inside the left nav column (`NavigationPane.svelte`, `TreeSection.svelte`, `styles.css`) plus one new data field:

1. The include-subfolders header button's active state uses the accent color while every other icon button in the plugin uses the toolbar's neutral active treatment.
2. Tag rows show no note count; folder rows already do, gated by `showNavItemCounts`.
3. The three section headers (Folders / Tags / Boxes) lead with a bare chevron instead of a section-identifying icon.
4. Folder tree rows carry a separate chevron column plus a folder icon; the icon should take over expand/collapse and reveal a chevron on hover.
5. Tag tree rows likewise; their `hash` icon should become `tags` (has children) or `tag` (leaf).
6. Box rows use `gallery-horizontal`; they should use `box`.

End state: every expandable row and section header exposes exactly one leading 16px slot that shows an identity icon at rest and a directional chevron on hover/focus, tag rows show roll-up counts under the existing counts setting, and the include-subfolders toggle matches the toolbar's active styling.

## Approach

Steps 1–3 are independent of each other and of steps 4–6. Step 5 depends on step 4 (both rewrite the same tag-row markup). Step 6 depends on steps 4 and 5.

### Step 1 — Align the include-subfolders active color (`styles.css`)

Replace the body of `.folder-card-view .fce-nav-header-button.is-active` (currently at lines 108-110, `color: var(--fce-accent);`) with the same declarations `.folder-card-view .fce-toolbar-button.is-selected` uses at lines 364-367:

```css
.folder-card-view .fce-nav-header-button.is-active {
  background-color: var(--background-modifier-hover);
  color: var(--icon-color-hover);
}
```

Keep the `is-active` class name in `NavigationPane.svelte` (line 366) — no markup change, and no test asserts on either class.

### Step 2 — Box row icon (`src/view/NavigationPane.svelte`)

Line 506: change `use:applyIcon={"gallery-horizontal"}` to `use:applyIcon={"box"}`. Nothing else in the box list changes.

### Step 3 — Section headers show identity icons, chevron on hover

`src/view/TreeSection.svelte`:

- Add a required `icon: string;` to `TreeSectionProps` (after `title`), and add `icon` to the `$props()` destructure with no default so every call site must pass one.
- Replace the single chevron span (line 42) with two sibling spans, glyph first:

```svelte
<span class="fce-tree-section-glyph" aria-hidden="true" use:applyIcon={icon}></span>
<span class="fce-tree-section-chevron" aria-hidden="true" use:applyIcon={collapsed ? "chevron-right" : "chevron-down"}></span>
```

`aria-expanded` stays on the toggle button, so the collapse state remains announced when the chevron is visually hidden.

`src/view/NavigationPane.svelte`: pass `icon="folders"` to the Folders `TreeSection` (line 380), `icon="tags"` to Tags (line 429), and `icon="boxes"` to Boxes (line 485).

`styles.css`: replace the `.folder-card-view .fce-tree-section-chevron` block (lines 170-177) with the shared box rule plus the swap rules:

```css
.folder-card-view .fce-tree-section-glyph,
.folder-card-view .fce-tree-section-chevron {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
}

.folder-card-view .fce-tree-section-chevron {
  display: none;
}

.folder-card-view .fce-tree-section-toggle:hover .fce-tree-section-glyph,
.folder-card-view .fce-tree-section-toggle:focus-visible .fce-tree-section-glyph {
  display: none;
}

.folder-card-view .fce-tree-section-toggle:hover .fce-tree-section-chevron,
.folder-card-view .fce-tree-section-toggle:focus-visible .fce-tree-section-chevron {
  display: inline-flex;
}
```

The section-toggle text assertion in `NavigationPane.svelte.test.ts:154-157` compares `button.textContent`; icon spans contribute no text (the mocked `setIcon` only sets `data-icon`), so it keeps passing.

### Step 4 — Row leading slot becomes the expand/collapse control

The icon currently lives inside `.fce-tree-button`, and buttons cannot nest, so the icon moves into the existing `.fce-popup-row-leading` slot and replaces the chevron button there. Indentation is unchanged (`padding-left: calc(var(--fce-nav-indent-step) * depth + 8px)` stays on the row), so every row shifts left by one 16px slot — that is intended and matches Obsidian's native file tree density.

`src/view/NavigationPane.svelte`, folder rows (lines 394-423). Replace the leading block and drop the icon span from the tree button:

```svelte
<div class="fce-popup-row-leading">
  {#if hasChildren}
    <button
      type="button"
      class="fce-tree-item-icon"
      aria-label={expandedFolderPaths.has(node.path) ? strings.folderMenu.collapse : strings.folderMenu.expand}
      aria-expanded={expandedFolderPaths.has(node.path)}
      onclick={(event) => toggleFolderExpansion(event, node.path)}
    >
      <span class="fce-tree-item-glyph" aria-hidden="true" use:applyIcon={getFolderNodeIcon(node)}></span>
      <span
        class="fce-tree-item-chevron"
        aria-hidden="true"
        use:applyIcon={expandedFolderPaths.has(node.path) ? "chevron-down" : "chevron-right"}
      ></span>
    </button>
  {:else}
    <span class="fce-tree-item-icon is-static" aria-hidden="true">
      <span class="fce-tree-item-glyph" use:applyIcon={getFolderNodeIcon(node)}></span>
    </span>
  {/if}
</div>
<div class="fce-popup-row-content">
  <button
    type="button"
    class="fce-tree-button"
    onclick={() => selectFolder(node.path)}
    use:applyTooltip={label}
  >
    <span class="fce-tree-label">{label}</span>
    {#if nodeCount > 0}
      <span class="fce-nav-row-count">{nodeCount}</span>
    {/if}
  </button>
</div>
```

Leaf rows render the glyph in a non-interactive span, so the 16px slot stays occupied and alignment holds. `getFolderNodeIcon()` (lines 194-204) is unchanged: `house` for the root node, `folder-open` when expanded, else `folder`.

Apply the identical structure to tag rows (lines 445-478), using `expandedTagPaths` / `node.tag` / `toggleTagExpansion`, keeping the tree button's `role="menuitemcheckbox"`, `aria-checked`, and the trailing `.fce-tree-row-check` block untouched.

Rename `onFolderChevronClick` → `toggleFolderExpansion` and `onTagChevronClick` → `toggleTagExpansion` (lines 218-238); both are component-private and referenced only at their call sites. Bodies are unchanged — they still `event.stopPropagation()` so toggling never selects the row.

`styles.css` edits in the `.fce-tree-menu` block:

- Lines 685-689: retarget `.fce-tree-chevron:hover, .fce-tree-chevron:focus-visible` to `.fce-tree-item-icon:hover, .fce-tree-item-icon:focus-visible`.
- Line 730: in the shared reset list, replace `.fce-tree-menu .fce-tree-chevron,` with `.fce-tree-menu .fce-tree-item-icon,` (keep `.fce-tree-button` in the list).
- Lines 743-752: rename the selector to `.fce-tree-menu .fce-tree-item-icon` and keep the same box/color/cursor declarations.
- Lines 754-758: rename to `.fce-tree-menu .fce-tree-item-icon:focus-visible`.
- Lines 760-763: delete the `.is-placeholder` rule — no markup emits that class any more.
- Lines 773-781 (`.fce-tree-menu .fce-tree-node-icon`) become the inner glyph/chevron rule:

```css
.fce-tree-menu .fce-tree-item-glyph,
.fce-tree-menu .fce-tree-item-chevron {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
}

.fce-tree-menu .fce-tree-item-chevron {
  display: none;
}
```

- Lines 212-215 (`.folder-card-view .fce-nav-tree .fce-tree-node-icon`, which sets `margin-inline-end: 6px` and the nav icon color) become:

```css
.folder-card-view .fce-nav-tree .fce-tree-item-icon {
  color: var(--fce-nav-icon-color);
}
```

The 6px margin is dropped because the icon now sits in the leading slot and `.fce-popup-row`'s `gap: 8px` provides the separation.

- Add the hover/focus swap, scoped to the nav trees so it never affects other `.fce-tree-menu` consumers, and excluding `.is-static` so leaf rows never blank their icon:

```css
.folder-card-view .fce-nav-tree .fce-tree-row:hover .fce-tree-item-icon:not(.is-static) .fce-tree-item-glyph,
.folder-card-view .fce-nav-tree .fce-tree-row:focus-within .fce-tree-item-icon:not(.is-static) .fce-tree-item-glyph {
  display: none;
}

.folder-card-view .fce-nav-tree .fce-tree-row:hover .fce-tree-item-icon:not(.is-static) .fce-tree-item-chevron,
.folder-card-view .fce-nav-tree .fce-tree-row:focus-within .fce-tree-item-icon:not(.is-static) .fce-tree-item-chevron {
  display: flex;
}
```

`:focus-within` (not `:focus-visible` on the icon alone) is deliberate: keyboard users tabbing to either the icon button or the label button see the chevron affordance.

`.fce-tree-chevron` and `.fce-tree-node-icon` must have zero remaining occurrences in `src/` and `styles.css` after this step except the test updates in step 6; confirm with `rg -n 'fce-tree-chevron|fce-tree-node-icon' src styles.css`.

### Step 5 — Tag row icons and note counts

**Tag glyph.** In `NavigationPane.svelte` add next to the other resolvers (near `getFolderNodeIcon`, lines 194-204):

```ts
function getTagNodeIcon(node: VisibleTagTreeNode): string {
  return node.hasChildren ? "tags" : "tag";
}
```

`VisibleTagTreeNode` is already exported from `./tag-tree` (line 10); add it to the existing import at lines 6-12 using an inline type specifier — `import { buildTagTree, …, normalizeTagPath, type VisibleTagTreeNode } from "./tag-tree";` — because `isolatedModules: true` forbids importing a type without the `type` keyword. Use `getTagNodeIcon(node)` for both the button glyph and the static-span glyph written in step 4.

**Count data.** Counts roll up: a tag row shows how many cards clicking it would filter to, which by `tagPathMatchesFilter` (`src/view/tag-tree.ts:184-193`) includes descendant tags. A card contributes at most 1 to any single tag path.

`src/view/metadata-utils.ts` — add after `collectAllTags` (line 79). No existing helper produces per-tag counts:

```ts
/**
 * Count how many files fall under each tag path, keyed by normalized tag.
 * A file with `work/ai` counts once for `work` and once for `work/ai`, so a
 * parent count matches what selecting that parent would filter to.
 */
export function collectTagCounts(app: App, files: TFile[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    const rawTags = cache ? getAllTags(cache) : null;
    if (!rawTags || rawTags.length === 0) {
      continue;
    }

    const pathsForFile = new Set<string>();
    for (const rawTag of rawTags) {
      const normalizedTag = normalizeTagPath(rawTag);
      if (normalizedTag.length === 0) {
        continue;
      }

      const segments = normalizedTag.split("/");
      for (let index = 0; index < segments.length; index += 1) {
        pathsForFile.add(segments.slice(0, index + 1).join("/"));
      }
    }

    for (const tagPath of pathsForFile) {
      counts[tagPath] = (counts[tagPath] ?? 0) + 1;
    }
  }

  return counts;
}
```

`src/view/FolderCardView.ts` — add after `deriveAvailableTags()` (ends line 3428), and extend the `./metadata-utils` import at line 17 with `collectTagCounts`:

```ts
private deriveTagCounts(): Record<string, number> {
  if (!this.plugin.getSettings().showNavItemCounts) {
    return {};
  }

  return collectTagCounts(
    this.app,
    this.baseCards.map((card) => card.file),
  );
}
```

The setting gate mirrors `buildFolderTree()`'s `countsEnabled` short-circuit (line 3356) so the extra metadata-cache pass only happens when counts are visible. Counts follow the include-subfolders toggle for free because `baseCards` is already the scoped card set.

Write `tagCounts` at exactly the three places that write `availableTags`, and nowhere else — `pushSelectionState()` is deliberately excluded, matching how `availableTags` and `showNavItemCounts` are already handled:

- `src/view/FolderCardView.ts:1340` (the `onOpen` mutate) — add `state.tagCounts = this.deriveTagCounts();`
- `buildPanelModelState()` line 4367 — add `tagCounts: this.deriveTagCounts(),`
- `pushState()` line 4460 — add `state.tagCounts = this.deriveTagCounts();`

`src/view/panel-model.ts` — add `tagCounts: Record<string, number>;` to `PanelModelState` immediately after `availableTags` (line 37).

`src/view/FolderCardPanel.svelte` — add `tagCounts: {},` to `EMPTY_PANEL_STATE` after `availableTags` (line 114), and pass `tagCounts={panelState.tagCounts}` in the `<NavigationPane>` call right after `availableTags` (line 646). No `$derived` alias is needed; `availableTags` is passed inline the same way.

`src/view/NavigationPane.svelte` — add `tagCounts?: Record<string, number>;` to `NavigationPaneProps` after `availableTags` (line 42) and `tagCounts = {},` to the destructure (line 69). Add the resolver next to `getFolderNodeCount` (lines 206-212):

```ts
function getTagNodeCount(node: VisibleTagTreeNode): number {
  if (!showNavItemCounts) {
    return 0;
  }

  return tagCounts[node.tag] ?? 0;
}
```

Render it inside the tag row's `.fce-tree-button`, after `.fce-tree-label`, using the same `{#if count > 0}<span class="fce-nav-row-count">…</span>{/if}` shape as folder rows.

**Setting copy.** The existing `showNavItemCounts` toggle now governs both trees, so update only the description strings:

- `src/i18n.ts:433-434` (en) → `"Show how many cards each folder and tag contributes in the navigation pane. Folder counts follow the include-subfolders toggle, and tag counts include child tags."`
- `src/i18n.ts:817` (zh) → `"在导航栏中显示每个文件夹和标签包含的卡片数量。文件夹计数会跟随“包含子文件夹”开关变化，标签计数包含其子标签。"`

Leave `showNavItemCountsName` unchanged in both locales. No new setting key, no `settings.ts` change, no migration.

### Step 6 — Test updates

`src/view/FolderCardView.test.ts` lines 519 and 528-529 drive tag expansion through `.fce-tag-menu .fce-tree-chevron[aria-label='Expand']`. Change both selectors to `.fce-tag-menu .fce-tree-item-icon`; the `aria-label` values (`Expand` / `Collapse`) are unchanged, so only the class in the selector moves. `getTagNode()` (lines 395-398) matches on `.fce-tree-button` text and keeps working — the icon left the button and the count is absent there because that test's `plugin.getSettings()` mock (lines 499-506) has no `showNavItemCounts`.

`src/view/FolderCardPanel.svelte.test.ts` — add `tagCounts: {},` to `createInitialPanelState()` after `availableTags` (line 48). The literal is type-checked, so omitting it fails `npm run check`.

`src/view/pipeline.test.ts:35` and `src/view/FolderCardView.test.ts:314` build full `PluginSettings` literals, not `PanelModelState`; they need no change since no setting key is added.

`src/view/metadata-utils.test.ts` — add a `describe("collectTagCounts")` block following the `collectAllTags` pattern (lines 88-103; `getAllTagsMock.mockReturnValueOnce` per file, `createMockApp()` returns a truthy cache for every file):

- Two files tagged `["#Work/AI"]` and `["#work/ml"]` produce `{ work: 2, "work/ai": 1, "work/ml": 1 }`.
- One file tagged `["#Work/AI", "#work/ai/harness"]` counts `work` once, not twice: `{ work: 1, "work/ai": 1, "work/ai/harness": 1 }`.
- A file whose `getAllTags` returns `null` contributes nothing.

`src/view/NavigationPane.svelte.test.ts`:

- Extend `mountNav()`'s default props with `tagCounts: { work: 3, "work/ai": 1, personal: 2 }` so existing tests exercise a populated map with counts disabled.
- New test `"renders tag counts only when enabled"`: mount with `showNavItemCounts: true`, assert the `work` row's `.fce-nav-row-count` reads `3` and the `personal` row reads `2` (reuse `getTreeButtonByText(".fce-tag-menu", …)`); remount with `showNavItemCounts: false` and assert `.fce-tag-menu .fce-nav-row-count` is absent.
- New test `"leading icon toggles folder expansion and marks tag leaf icons"`: assert `.fce-folder-menu .fce-tree-button` no longer contains an icon span, click `.fce-folder-menu .fce-tree-item-icon[aria-label="Expand"]` on the `projects` row and assert `alpha` becomes visible, then assert the `work` tag row's glyph is `[data-icon="tags"]` and the `personal` row's is `[data-icon="tag"]` (the mocked `setIcon` writes `data-icon`).
- New test `"renders section identity icons"`: assert `.fce-tree-section-glyph` values are `folders`, `tags`, `boxes` in document order, and that each header still renders a `.fce-tree-section-chevron`.
- New test for the box icon: `.fce-nav-box-icon` carries `data-icon="box"`.

## Critical files & anchors

- `src/view/NavigationPane.svelte` — folder rows (394-424) and tag rows (445-479) are the two blocks that must end up structurally identical apart from glyph choice, count source, and the trailing check; the `TreeSection` call sites (380, 429, 485) take the new `icon` prop.
- `styles.css` — `.fce-tree-menu` block (669-796) holds every `.fce-tree-chevron` / `.fce-tree-node-icon` rule to rename or delete; the nav-scoped overrides (197-245) hold the row hover, icon color, and `.fce-nav-row-count` rules.
- `src/view/FolderCardView.ts` — `deriveAvailableTags()` (3412-3428) is the shape to copy for `deriveTagCounts()`, and its three write sites (1340, 4367, 4460) are exactly where `tagCounts` must be pushed.
- `src/__mocks__/obsidian.ts:60-62` — `setIcon` writes `data-icon`, which is how every icon assertion in the new tests works.

## Verification

Run from the repository root:

```bash
npm run check && npm run check:svelte && npm run build && npm test
```

Targeted runs while iterating:

```bash
npx vitest run src/view/metadata-utils.test.ts
npx vitest run src/view/NavigationPane.svelte.test.ts
npx vitest run src/view/FolderCardView.test.ts -t "persists a selected nested tag"
```

New-behavior checks the suite alone does not cover — run `npm run dev`, reload the plugin in Obsidian, open the card workspace with a vault that has at least one nested tag (`#work/ai`) and one nested folder:

1. Hover a folder row with children: the folder icon swaps to a chevron; click it and the row expands without changing the selected folder. Hover a leaf row: the icon stays a folder icon and does not blank out.
2. Hover each section header: the `folders`/`tags`/`boxes` icon swaps to a chevron; clicking still collapses the section.
3. Turn on "Show item counts in navigation": the `work` tag row shows a count equal to the number of cards carrying `work` or any `work/*` tag in the current scope, and toggling "include subfolders" changes both folder and tag counts. Turn the setting off and all counts disappear.
4. Scan the pane for empty 16px slots, which would mean an unresolved icon name (see contingency below).

## Assumptions & contingencies

- The Lucide icon names `folders`, `tags`, `tag`, `box`, and `boxes` are assumed present in the Obsidian build's bundled icon set (*unverified — the `obsidian` package is external and ships no icon manifest; the codebase already relies on recent names such as `house` and `folder-tree`*). If any renders as an empty slot in verification step 4, fall back to a name already proven in this codebase or a long-standing Lucide singular: `folders` → `folder`, `tags` → `tag`, `boxes` → `box`, and if `tag` itself fails, keep `hash`.
- Tag counts are scope-relative (derived from `baseCards`) rather than vault-wide, matching folder counts and the include-subfolders toggle. If vault-wide counts are wanted later, that is a different data source and a separate change.
- Row hover is the swap trigger rather than icon-only hover, so the chevron appears as soon as the pointer enters the row. If that reads as too noisy in verification, narrow the two swap selectors from `.fce-tree-row:hover` to `.fce-tree-item-icon:hover` (plus keep the `:focus-within` pair) — no markup change needed.
