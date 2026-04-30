- Task 1 scope: `src/settings.ts` currently has persisted fields `sort`, `filter`, `pinnedPaths`, `includeSubfolders`, `defaultView`, `previewLines`, `lastFolderPath`, and `lastViewMode`; normalization/merge is centralized in `normalizeSettings(...)` and `mergeSettings(...)`.
- Task 3 seam: card opens currently flow as `path`-only payloads from `CardItem.svelte` -> `FolderCardPanel.svelte` -> `FolderCardView.ts`, with `previewLines` mirrored from settings into `PanelModelState` in four places (`buildPanelModelState`, initial `onOpen` mutation, `pushSelectionState`, `pushState`).
- Existing tests cover path-only host routing (`FolderCardView.test.ts`, `card-context-actions.test.ts`) and settings normalization/merge patterns (`settings.test.ts`), but do not yet cover destination-aware open payloads.
- Coupling risk: `CardItem.svelte` and `FolderCardPanel.svelte` duplicate payload interfaces; `FolderCardView.ts` currently assumes open-note detail contains only `path` and directly calls `plugin.openNoteFromCard(path)`.
# Task mapping findings

- Card UI actions live in `src/view/CardItem.svelte`: `onCardClick`, `onCardKeydown`, `onCardContextMenuAction`, `onPinClick`, `onPinKeydown`, and the action cluster around `.fce-card-actions`.
- Current normal-mode action slot only renders the pin button; bulk mode swaps in `.fce-card-bulk-checkbox` and removes pin UI entirely.
- The safest hover-preview DOM seam is the card title group (`.fce-card-title-group` / `h4`), not `.fce-card-actions`, because action buttons already own click/keyboard handlers and must stay isolated from preview dispatch.
- `FolderCardPanel.svelte` currently forwards only `onOpenNote`, `onBulkSelectCard`, `onCardContextMenu`, and `onPinToggle`; no hover callback exists yet.
- `FolderCardView.ts` currently registers `open-note` and `card-context-menu` events from the panel, with `openCardContextMenu(notePath, mouseEvent)` building the menu via `addCardContextMenuItems(menu, notePath)` and showing it with `menu.showAtMouseEvent(mouseEvent)`.
- Menu builder seam is narrow: `openCardContextMenu(...)` + `addCardContextMenuItems(...)` + `routeCardMenuAction(...)`; current menu items are only `Move to…` and `Copy`.
- Hover-preview integration should stay markdown-only by checking `card.fileKind === "markdown"` in the card/title surface before forwarding to the view.
- Closest tests: `src/view/CardItem.svelte.test.ts` (card actions, bulk isolation, pin behavior), `src/view/card-context-actions.test.ts` (context menu seam), and `src/view/FolderCardView.test.ts` (host open-routing seam).
- Likely regression points: accidental hover emission from action buttons/bulk checkbox, layout shift from action-slot changes, menu item order drift, and breaking right-click isolation or `openNoteFromCard` routing.


- Hover-link registration/emission:
  - obsidianmd/obsidian-maps src/map/markers.ts @ 199b4ac3d693b6dc759d8ee438633a55a7e09fee: triggers 'hover-link' with 'hoverParent', 'targetEl', and 'linktext' from map marker hover. https://github.com/obsidianmd/obsidian-maps/blob/199b4ac3d693b6dc759d8ee438633a55a7e09fee/src/map/markers.ts#L455-L463
  - RyotaUshio/obsidian-pdf-plus src/main.ts @ 6a3218b9c506076b405438489e614bc9e22b833b: registers multiple hover sources with registerHoverLinkSource(...). https://github.com/RyotaUshio/obsidian-pdf-plus/blob/6a3218b9c506076b405438489e614bc9e22b833b/src/main.ts#L796-L809
  - Caveat: public examples for registerHoverLinkSource are mostly simple source registration; no richer pattern surfaced.

- Anchored menu opening by position:
  - Obsidian docs: menu.showAtPosition({ x, y }) is the recommended explicit placement API.
  - Vinzent03/obsidian-git src/utils.ts @ 8e91800cfa4834a434f0a3bfe939ff9e259f69fd: file-menu opened at page coordinates via menu.showAtPosition({ x: event.pageX, y: event.pageY }). https://github.com/Vinzent03/obsidian-git/blob/8e91800cfa4834a434f0a3bfe939ff9e259f69fd/src/utils.ts#L59-L69
  - kevboh/longform src/view/explorer/ExplorerPane.ts: same pattern after triggering file-menu. https://github.com/kevboh/longform/blob/main/src/view/explorer/ExplorerPane.ts#L225-L231

- Destination-specific note opening via leaves:
  - shabegom/buttons src/handlers/createNote.ts @ 0fc70f37ff983353925882f0aebb51cb63e05ac6: opens created notes in vertical/horizontal split using getLeaf("split", "vertical") / getLeaf("split", "horizontal"). https://github.com/shabegom/buttons/blob/0fc70f37ff983353925882f0aebb51cb63e05ac6/src/handlers/createNote.ts#L85-L96
  - obsidian docs: getLeaf(true) for a new leaf and getLeaf("split", "vertical") for the right split; pair with openFile or setViewState.
  - logancyang/obsidian-copilot src/main.ts: getLeaf(true).openFile(file) for opening into a new leaf/tab. https://github.com/logancyang/obsidian-copilot/blob/master/src/main.ts#L773-L781

- Pop-out fallback / availability:
  - tadashi-aikawa/obsidian-another-quick-switcher src/app-helper.ts @ ee8eada3ea9ec2a6fe0ffa93719df2ea7ae5670a: new-window branch uses workspace.openPopoutLeaf(). https://github.com/tadashi-aikawa/obsidian-another-quick-switcher/blob/ee8eada3ea9ec2a6fe0ffa93719df2ea7ae5670a/src/app-helper.ts#L697-L704
  - PKM-er/obsidian-zotlit app/obsidian/src/note-feature/template-preview/open.ts @ 2f3523efd9fc4f76f09856414a5c1b589a68a864: starts with openPopoutLeaf() then splits from it. https://github.com/PKM-er/obsidian-zotlit/blob/2f3523efd9fc4f76f09856414a5c1b589a68a864/app/obsidian/src/note-feature/template-preview/open.ts#L42-L50
  - Caveat: I found no public example that explicitly guards openPopoutLeaf() failure when pop-outs are unavailable; rely on typings/tests for fallback behavior.

- `Plugin.registerHoverLinkSource(id, info)` is the supported hook for Page preview integration. `HoverLinkSource` only exposes `display` and `defaultMod`; `defaultMod` controls whether Mod must be held to trigger hover links, so manual Ctrl/Cmd gating should not be needed when it is `true`.
- `Menu.showAtMouseEvent(evt)` anchors the menu at the mouse event; `Menu.showAtPosition(position)` is for explicit coordinates and is documented as available since 1.1.0.
- For layout, `getLeaf(true)` means a new leaf in the root split, while `getLeaf("split", "vertical")` creates an adjacent leaf to the right. `getRightLeaf()` is sidebar-only and is the wrong API for split-right note opening.
- `openPopoutLeaf()` creates a single-leaf popout window and is desktop-only.
- Official docs found did not spell out the full `hover-link` payload contract; source-backed examples show `event`, `source`, `hoverParent`, `targetEl`, `linktext`, `sourcePath`, and `state` are passed when triggering the event.
- Task 1 implementation result: `src/settings.ts` now persists `defaultOpenDestination` alongside the other stored settings, with a dedicated normalizer that accepts only `current-area`, `new-tab`, `split-right`, and `new-window`.
- Task 1 test result: `src/settings.test.ts` now covers invalid destination fallback to `current-area` and `mergeSettings(...)` preserving unrelated fields while updating `defaultOpenDestination`.

- Task 2 implementation result: `src/FolderCardExplorerSettingTab.ts` now renders `Preview lines` first and a second dropdown setting named `Default card open destination` with the exact labels `Open in current area`, `Open in new tab`, `Open to the right`, and `Open in new window`.
- Task 2 test result: `src/FolderCardExplorerSettingTab.test.ts` now covers row order, exact dropdown labels, initial value from `plugin.getSettings().defaultOpenDestination`, and single-call persistence via `plugin.saveSettings({ defaultOpenDestination: value })`.
- Implementation note: the dropdown description explicitly mentions left click and Enter/Space, and the tab consumes the persisted field without threading it into the view seam yet.

- Follow-up verification: `src/view/pipeline.test.ts` needed the new required `defaultOpenDestination: "current-area"` fixture field to satisfy `PluginSettings` after Task 1.
- Follow-up verification result: `npm run check` and `npx vitest run src/FolderCardExplorerSettingTab.test.ts src/view/pipeline.test.ts` both passed after the minimal fixture update.

- Task 3 wiring result: introduced shared `OpenNotePayload` in `src/view/panel-model.ts` as `{ path, destination }` and consumed it from both `CardItem.svelte` and `FolderCardPanel.svelte` to keep the normal open seam consistent.
- `PanelModelState` now carries `defaultOpenDestination`, and `FolderCardView.ts` keeps it synchronized at all four refresh points: `buildPanelModelState`, initial `onOpen` mutation, `pushSelectionState`, and `pushState`.
- Normal-mode opens now route destination-aware payloads to `plugin.openNoteFromCard(path, destination)`; bulk-mode isolation remains intact (bulk selection path never emits the open seam).
- Host/component tests were updated to assert destination propagation (`split-right` fixture routing and `CardItem` default + configured destination emission).

- Task 3 verification follow-up: tightened `PanelModelState.defaultOpenDestination` back to required in `src/view/panel-model.ts` and updated the direct panel-state fixture in `src/view/FolderCardPanel.svelte.test.ts` with `"current-area"`.
- Contract remains strict while destination-aware open payload wiring from Task 3 is preserved unchanged.
- Follow-up verification passed: targeted view/component vitest suite and `npm run check` both succeeded.
- When adding new action buttons to the card UI, use `opacity: 0` and toggle to `opacity: 1` on `.fce-card:hover` and `.fce-card:focus-within` instead of `visibility: hidden` to ensure native keyboard focusability works smoothly.

- Task 7 implementation result: `src/main.ts` now registers the Page Preview hover source during `onload()` with the exact id/display pair `card-workspace` / `Card Workspace`, keeping the hook startup-only and positioned before runtime event wiring.
- Task 7 test seam: `src/main.test.ts` now stubs `registerHoverLinkSource(...)` on the plugin mock so startup assertions can verify the single registration call and its exact info object.

- Task 6 runtime routing: `src/main.ts` now accepts `openNoteFromCard(path, destination)` with `OpenDestination` and resolves leaves by destination (`current-area` -> `resolveTargetLeaf()`, `new-tab` -> `getLeaf(true)`, `split-right` -> `getLeaf("split", "vertical")`, `new-window` -> `openPopoutLeaf()` when available).
- Desktop-only guard behavior is explicit: unsupported `new-window` emits exactly `new Notice("Open in new window is available on desktop only.")` and returns early without fallback leaf opens.
- Successful destination opens still use `await leaf.openFile(target, { active: true })` followed by `this.syncSelection(target.path)`, and `createNoteInCurrentFolder()` now explicitly opens with `"current-area"`.
- Task 6 tests in `src/main.test.ts` now pin each destination API call and the exact desktop-only notice/no-op contract.

- Task 5 menu trigger seam now uses a single `openCardContextMenu(detail)` payload and branches by `trigger`: `"button"` requires `{ x, y }` and calls `menu.showAtPosition(position)`, while contextmenu-triggered flows call `menu.showAtMouseEvent(mouseEvent)`.
- The shared `addCardContextMenuItems(...)` builder now emits destination items in this exact order before existing actions: `Open in current area`, `Open in new tab`, `Open to the right`, `Open in new window`, `Move to…`, `Copy`.
- `routeCardMenuAction(...)` now accepts `OpenDestination | "move" | "copy"`, forwarding destination actions to `plugin.openNoteFromCard(notePath, destination)` while preserving existing move/copy behavior paths unchanged.

- Task 8 hover-preview seam now emits only from `CardItem.svelte` title group (`.fce-card-title-group`) and only when `card.fileKind === "markdown"`; emitted payload shape is shared as `CardHoverLinkPayload` (`{ path, targetEl, mouseEvent }`) in `src/view/types.ts`.
- Payload forwarding chain is now `CardItem.svelte` -> `FolderCardPanel.svelte` -> `FolderCardView.ts`, where the view triggers `this.app.workspace.trigger("hover-link", { event, source: "card-workspace", hoverParent: this, targetEl, linktext })` without manual modifier-key checks.
- Tests now pin both positive and negative hover behavior: markdown title-group hover triggers once, while non-markdown cards and action/bulk controls emit nothing (`CardItem.svelte.test.ts`, `FolderCardView.test.ts`).

- Task 8 follow-up (a11y): preserving title-group hover semantics while removing Svelte’s static-element interaction warning can be done minimally by keeping `onmouseenter` on `.fce-card-title-group` and adding `role="presentation"`; this clears the CardItem warning without changing markdown-only hover payload behavior.
- Verification note: `npx vitest run src/view/CardItem.svelte.test.ts src/view/FolderCardView.test.ts` still passes unchanged hover expectations, and `npm run build` now reports only pre-existing Toolbar warnings with no new `CardItem.svelte` warning.

- Runtime no-op root cause for destination menu clicks was detached invocation in `openCardWithDestination(...)`; extracting `this.plugin.openNoteFromCard` into a standalone function dropped plugin receiver semantics in real runtime contexts.
- Minimal fix is direct method dispatch (`this.plugin.openNoteFromCard(path, destination)`), which preserves `this` and keeps destination/menu contracts unchanged.
- Regression coverage now executes destination menu item click handlers from the view/menu path and asserts the call receiver is the plugin object for all four destinations, so a future detached-call regression fails immediately.
