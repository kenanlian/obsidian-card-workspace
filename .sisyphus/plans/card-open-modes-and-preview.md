# Card Open Modes And Page Preview Integration

## TL;DR
> **Summary**: Add configurable card open destinations, a hover-revealed per-card more-actions button, and Obsidian-supported Page Preview hover integration without breaking the current card/view/plugin architecture.
> **Deliverables**:
> - Persisted default card open destination setting with UI control
> - Card more-actions button plus expanded card action menu with four open destinations
> - Destination-aware file opening in current area, new tab, right split, and desktop pop-out window
> - Page Preview-compatible hover-link registration and card hover dispatch for markdown cards
> - Updated Vitest coverage across settings, component, view, and plugin seams
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: 1 → 3 → 4 → 5 → 6 → 7 → 8

## Context
### Original Request
- Provide more ways to open notes from cards instead of always opening in the main workspace.
- Match Obsidian-style note-link destinations: new tab, open to the right, and new window.
- Make plain left-click configurable.
- Add Ctrl/Cmd + hover Page Preview behavior like native note links if supported by official APIs.

### Interview Summary
- Plain left-click becomes configurable across **all four** destinations: current area, new tab, open to the right, and new window.
- The primary UI surface is a **per-card more-actions button** placed at the current pin-button position; the pin button moves left of it.
- The more-actions button should be **hidden until hover**, but still become visible on keyboard focus for accessibility.
- Hover preview should follow the official Page Preview path with **Ctrl on Windows/Linux** and **Cmd on macOS**, using Obsidian’s supported hover-link integration instead of custom preview UI.
- Test strategy is **tests-after** using the repository’s existing Vitest jsdom + node patterns.

### Metis Review (gaps addressed)
- Locked `open to the right` to the **root editor split** path (`getLeaf("split", "vertical")`), not the right sidebar `getRightLeaf()` API.
- Locked keyboard parity: **Enter/Space** on a focused card uses the same configured default destination as plain left-click.
- Locked accessibility/layout behavior: the more-actions button is visually hidden with reserved space and becomes visible on `.fce-card:hover` and `.fce-card:focus-within`; bulk mode keeps the existing checkbox-only action slot.
- Locked unsupported new-window behavior: if the pop-out API is unavailable, show `Notice("Open in new window is available on desktop only.")` and do nothing.
- Locked Page Preview path: register a hover source once in plugin `onload`, emit `hover-link` from the view on card mouseover, and rely on `defaultMod: true` instead of manual Ctrl/Cmd gating or any custom preview popover.

## Work Objectives
### Core Objective
Implement native-feeling card open controls that preserve current architecture boundaries while letting the executor add destination-specific opens and official Page Preview cooperation with no hidden decisions.

### Deliverables
- Shared `OpenDestination` settings contract and normalization path.
- Settings tab dropdown for default card open destination.
- Panel-model and callback payload wiring for destination-aware card actions.
- Hover-revealed more-actions button and stable card-action layout.
- Unified card action menu with four open destinations plus existing move/copy actions.
- Plugin-level open resolver for current area, new tab, right split, and new window.
- Plugin-level hover-link source registration and view-level hover-link event dispatch.

### Definition of Done (verifiable conditions with commands)
- `npx vitest run src/settings.test.ts src/FolderCardExplorerSettingTab.test.ts`
- `npx vitest run src/view/CardItem.svelte.test.ts src/view/FolderCardPanel.svelte.test.ts src/view/FolderCardView.test.ts src/view/card-context-actions.test.ts`
- `npx vitest run src/main.test.ts`
- `npm run check`
- `npm run build`
- `npm test`
- All commands above exit with code `0`.

### Must Have
- Add `defaultOpenDestination` to persisted plugin settings with exact options: `current-area`, `new-tab`, `split-right`, `new-window`.
- Keep the default setting value at `current-area`.
- Render a settings dropdown whose description explicitly states that it controls **left click and Enter/Space on cards**.
- Pass the default destination through the existing `CardItem.svelte` → `FolderCardPanel.svelte` → `FolderCardView.ts` → `main.ts` seam instead of creating a side channel.
- Add a card more-actions button at the current pin-button slot and move the pin button immediately to its left.
- Use the existing supported `chevron-down` icon for the per-card more-actions button so the executor does not need to guess icon compatibility.
- Keep action-slot width reserved so hover-only controls do not cause virtualization/layout shift.
- In bulk mode, preserve the current checkbox-only action slot and do not show the more-actions button.
- Use exact card menu item titles and order:
  1. `Open in current area`
  2. `Open in new tab`
  3. `Open to the right`
  4. `Open in new window`
  5. `Move to…`
  6. `Copy`
- Keep `Move to…` and `Copy` behavior unchanged.
- Implement `split-right` with the Obsidian root-split API, not the sidebar dock API.
- Preserve current note-creation behavior by explicitly opening newly created notes in `current-area`; do not let the new card setting alter `createNoteInCurrentFolder()` behavior.
- Register the hover-link source exactly once during plugin `onload` with source id `card-workspace`, display `Card Workspace`, and `defaultMod: true`.
- Only emit Page Preview hover-link events for `markdown` cards.
- Emit hover-link from card mouseover without manual Ctrl/Cmd checks; rely on Page Preview’s source settings and `defaultMod: true`.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Do **not** use `getRightLeaf()` for `open to the right`; that API is for the right sidebar dock.
- Do **not** build a custom preview popover, tooltip preview, or duplicated Page Preview UI.
- Do **not** add modifier-click destination shortcuts; this scope is settings + more-actions menu + hover preview only.
- Do **not** change toolbar behavior, folder selection behavior, or card rendering outside the action cluster and hover-preview event plumbing.
- Do **not** allow the more-actions button to reflow card width/height when it appears.
- Do **not** silently fall back from `new-window` to another destination when pop-out support is unavailable.
- Do **not** emit hover-link from action buttons, bulk-selection controls, or non-markdown cards.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: **tests-after** with existing Vitest `node` + `jsdom` projects (`vitest.config.ts` already separates those environments)
- QA policy: Every task includes happy-path and failure/edge scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.txt`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave when possible; this feature stays at two bounded waves because the runtime seam is narrow and later tasks depend on explicit API contracts from Wave 1.

Wave 1: contracts and UI foundations
- Task 1 — add open-destination settings contract
- Task 2 — add settings UI control
- Task 3 — propagate default destination through panel-model and callback contracts
- Task 4 — update card UI behavior and stable action-slot layout

Wave 2: runtime integrations
- Task 5 — refactor FolderCardView card action menu seam
- Task 6 — implement destination-specific note opening in the plugin
- Task 7 — register Page Preview hover source at plugin load
- Task 8 — emit supported hover-link events from card hover through the view seam

### Dependency Matrix (full, all tasks)
- 1 blocks 2, 3, 4, 6
- 2 has no downstream blockers beyond final verification
- 3 blocks 4, 5, 8
- 4 blocks 5 and 8
- 5 blocks final verification
- 6 blocks 5
- 7 blocks 8
- 8 blocks final verification

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 4 tasks → `quick`, `visual-engineering`, `unspecified-low`
- Wave 2 → 4 tasks → `quick`, `unspecified-low`, `unspecified-high`

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Add shared open-destination settings contract

  **What to do**: Extend `src/settings.ts` with a new `OpenDestination` union type containing exactly `"current-area" | "new-tab" | "split-right" | "new-window"`. Add `defaultOpenDestination` to `PluginSettings`, `PartialPluginSettings`, `DEFAULT_SETTINGS`, `normalizeSettings(...)`, and `mergeSettings(...)`. Create a dedicated normalizer that falls back to `current-area` for unknown values. Keep this field persisted like `previewLines` and `includeSubfolders`.
  **Must NOT do**: Do not overload `defaultView` or create a nested `open` settings object; do not introduce background-open or modifier-specific settings; do not alter runtime-only state in `normalizeSettings`.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: tightly scoped type/normalization work in a single TS module with adjacent tests
  - Skills: `[]` - no special skill required
  - Omitted: `obsidian-plugin-docs` - official API research is already resolved for the planner

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 2, 3, 4, 6 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/settings.ts:13-27` - current persisted settings shape
  - Pattern: `src/settings.ts:45-59` - default settings object to extend
  - Pattern: `src/settings.ts:112-153` - normalization/merge pattern to follow exactly
  - Test: `src/settings.test.ts:101-188` - normalization boundary style already used in this repo
  - Test: `src/settings.test.ts:193-385` - merge-settings preservation pattern already exists

  **Acceptance Criteria** (agent-executable only):
  - [ ] `OpenDestination` exists in `src/settings.ts` with exactly four string-literal members.
  - [ ] `DEFAULT_SETTINGS.defaultOpenDestination` equals `"current-area"`.
  - [ ] `normalizeSettings({ ...DEFAULT_SETTINGS, defaultOpenDestination: "unexpected" })` returns `current-area`.
  - [ ] `mergeSettings(DEFAULT_SETTINGS, { defaultOpenDestination: "new-tab" })` persists `new-tab` without altering unrelated fields.
  - [ ] `npx vitest run src/settings.test.ts` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: settings normalization accepts only the four supported destinations
    Tool: Bash
    Steps: Run `npx vitest run src/settings.test.ts -t "normalizes defaultOpenDestination to the supported enum only"`
    Expected: Vitest passes; invalid values resolve to `current-area`, while `new-tab`, `split-right`, and `new-window` are preserved.
    Evidence: .sisyphus/evidence/task-1-open-destination-settings.txt

  Scenario: mergeSettings preserves unrelated state while updating default destination
    Tool: Bash
    Steps: Run `npx vitest run src/settings.test.ts -t "mergeSettings updates defaultOpenDestination without mutating unrelated fields"`
    Expected: Vitest passes; sort/filter/pinned/includeSubfolders/previewLines remain unchanged.
    Evidence: .sisyphus/evidence/task-1-open-destination-settings-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/settings.ts`, `src/settings.test.ts`

- [x] 2. Add default-open-destination control to the settings tab

  **What to do**: Update `src/FolderCardExplorerSettingTab.ts` to render a second setting below `Preview lines` named `Default card open destination`. Use a dropdown, not a slider or toggle. The dropdown description must state that it controls left click and Enter/Space on cards. The options must be exactly: `Open in current area`, `Open in new tab`, `Open to the right`, and `Open in new window`, mapped to the four persisted setting values. Persist via `plugin.saveSettings({ defaultOpenDestination: value })`.
  **Must NOT do**: Do not remove or reorder the existing preview-lines setting; do not collapse both settings into one Setting row; do not add platform-specific branching in the settings UI.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: one UI settings file plus its dedicated test file
  - Skills: `[]`
  - Omitted: `frontend-ui-ux` - the repo already has a clear settings-tab pattern and this change is straightforward

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: none | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/FolderCardExplorerSettingTab.ts:13-33` - existing settings row construction and save seam
  - Pattern: `src/FolderCardExplorerSettingTab.test.ts:103-140` - current settings-tab test harness and assertions
  - API/Type: `src/settings.ts:13-27` - persisted setting field that drives the dropdown value
  - External: `manifest.json:2-4` - plugin display name remains `Card Workspace`; keep settings copy aligned with that name/feature

  **Acceptance Criteria** (agent-executable only):
  - [ ] The settings tab still renders the preview-lines slider first.
  - [ ] A second setting named `Default card open destination` renders a dropdown with exactly four options.
  - [ ] The dropdown initializes from `plugin.getSettings().defaultOpenDestination`.
  - [ ] Changing the dropdown calls `plugin.saveSettings({ defaultOpenDestination: <value> })` exactly once.
  - [ ] `npx vitest run src/FolderCardExplorerSettingTab.test.ts` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: settings tab renders preview slider plus open-destination dropdown
    Tool: Bash
    Steps: Run `npx vitest run src/FolderCardExplorerSettingTab.test.ts -t "renders preview lines and default card open destination controls"`
    Expected: Vitest passes; the dropdown appears after the slider with the exact four labels.
    Evidence: .sisyphus/evidence/task-2-settings-tab-destination.txt

  Scenario: changing the dropdown persists through saveSettings seam
    Tool: Bash
    Steps: Run `npx vitest run src/FolderCardExplorerSettingTab.test.ts -t "persists defaultOpenDestination through the plugin saveSettings seam"`
    Expected: Vitest passes; the plugin save stub receives only the new destination patch.
    Evidence: .sisyphus/evidence/task-2-settings-tab-destination-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/FolderCardExplorerSettingTab.ts`, `src/FolderCardExplorerSettingTab.test.ts`

- [x] 3. Thread the configured destination through panel-model and open callbacks

  **What to do**: Introduce a shared card-open payload contract that includes both `path` and `destination`. Update the relevant payload interfaces in `CardItem.svelte`, `FolderCardPanel.svelte`, and any related test harnesses so normal-mode card opens emit the configured default destination while bulk mode remains unchanged. Add `defaultOpenDestination` to `PanelModelState` in `src/view/panel-model.ts`, populate it from settings in `FolderCardView.ts`, and keep it synchronized anywhere `previewLines` is refreshed (`buildPanelModelState`, initial panel mutation in `onOpen`, `pushSelectionState`, `pushState`).
  **Must NOT do**: Do not read plugin settings directly inside `CardItem.svelte`; do not bypass `panelModel`; do not modify the bulk-select payload; do not thread destination through context-menu payloads yet.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: multi-file seam work across Svelte props, panel model, and host-view tests
  - Skills: `[]`
  - Omitted: `obsidian-plugin-docs` - this is internal wiring, not API research

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 4, 5, 8 | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/view/CardItem.svelte:177-205` - current open payload only includes `path`
  - Pattern: `src/view/FolderCardPanel.svelte:73-87` - panel prop callback contracts
  - Pattern: `src/view/FolderCardPanel.svelte:183-197` - event passthrough seam
  - Pattern: `src/view/panel-model.ts:4-31` - persisted panel state shape
  - Pattern: `src/view/FolderCardView.ts:440-455` - current onOpenNote/onCardContextMenu host wiring
  - Pattern: `src/view/FolderCardView.ts:2208-2300` - all places panel state is built/pushed and must stay aligned
  - Test: `src/view/FolderCardView.test.ts:345-389` - current host contract and click-routing assertions
  - Test: `src/view/card-context-actions.test.ts:14-31,57-81,623-635` - mock panel callback wiring already captures `open-note`

  **Acceptance Criteria** (agent-executable only):
  - [ ] `PanelModelState` includes `defaultOpenDestination` and it is set from plugin settings everywhere panel state is constructed or refreshed.
  - [ ] Card open payloads now include `{ path, destination }` in normal mode.
  - [ ] Bulk-mode click and checkbox flows still emit only bulk-selection payloads and never call the open seam.
  - [ ] FolderCardView forwards destination-aware open payloads to `plugin.openNoteFromCard(path, destination)`.
  - [ ] `npx vitest run src/view/FolderCardView.test.ts src/view/card-context-actions.test.ts` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: host open-note seam forwards both path and configured destination
    Tool: Bash
    Steps: Run `npx vitest run src/view/FolderCardView.test.ts -t "forwards card open events with the configured destination"`
    Expected: Vitest passes; the plugin open stub receives `("notes/cycle.md", "new-tab")` or equivalent configured value.
    Evidence: .sisyphus/evidence/task-3-panel-open-payload.txt

  Scenario: bulk-mode interactions remain isolated from the open seam
    Tool: Bash
    Steps: Run `npx vitest run src/view/CardItem.svelte.test.ts -t "does not emit open events from bulk mode controls"`
    Expected: Vitest passes; no destination-aware open payload is emitted when bulk mode is active.
    Evidence: .sisyphus/evidence/task-3-panel-open-payload-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/panel-model.ts`, `src/view/FolderCardView.ts`, `src/view/FolderCardView.test.ts`, `src/view/card-context-actions.test.ts`, `src/view/FolderCardPanel.svelte`, `src/view/CardItem.svelte`, `src/view/CardItem.svelte.test.ts`

- [x] 4. Add the hover-revealed more-actions button and stable card action layout

  **What to do**: Update `src/view/CardItem.svelte` so normal mode renders two action buttons in order: pin on the left, more-actions on the right. The more-actions button must occupy the current visual pin slot, use the already-supported `chevron-down` icon, stop propagation, and call an exact callback payload shape: `onCardMenuRequest({ path: card.path, trigger: "button", position: { x: rect.left, y: rect.bottom } })`, where `rect` is `event.currentTarget.getBoundingClientRect()`. Left-click and Enter/Space on the card body must emit the configured default destination. The more-actions button must remain keyboard-focusable even when visually hidden; reveal it on `.fce-card:hover` and `.fce-card:focus-within`. Update `styles.css` to reserve action-slot space and avoid reflow by using opacity/visibility transitions instead of layout insertion/removal. In bulk mode, keep the existing checkbox-only action slot.
  **Must NOT do**: Do not make the more-actions button appear with `display: none`; do not move the pin button outside `.fce-card-actions`; do not wire the more-actions button directly to note opening or to custom DOM menus; do not invent a different callback payload shape for button-triggered menus.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: Svelte markup + CSS behavior must preserve virtualization and native-feeling hover/focus affordances
  - Skills: `[]`
  - Omitted: `frontend-ui-ux` - not required because the user already decided exact placement/visibility behavior

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5, 8 | Blocked By: 1, 3

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/view/CardItem.svelte:177-237` - current click/keyboard/pin handlers
  - Pattern: `src/view/CardItem.svelte:249-304` - current card DOM and action-cluster placement
  - Pattern: `styles.css:499-583` - current card-header, actions, and hover/focus pin visibility rules
  - Pattern: `src/view/Toolbar.svelte:227-243,492-526` - existing `applyIcon`/button/icon pattern using Obsidian `setIcon` and the already-supported `chevron-down` icon
  - Test: `src/view/CardItem.svelte.test.ts:152-315` - current click/context/pin/bulk assertions to extend
  - Test: `src/view/FolderCardPanel.svelte.test.ts` - use existing panel component tests if callback surfacing needs coverage there
  - External: `.agents/skills/obsidian-plugin-docs/references/ui.md:329-347` - built-in icon guidance via `setIcon`

  **Acceptance Criteria** (agent-executable only):
  - [ ] In normal mode, `.fce-card-actions` contains both `.fce-card-pin-btn` and `.fce-card-more-btn`, with pin preceding more-actions in DOM order, and `.fce-card-more-btn` renders `data-icon="chevron-down"` in tests.
  - [ ] Clicking or pressing Enter on `.fce-card-more-btn` does not trigger card open.
  - [ ] Clicking or pressing Enter on `.fce-card-more-btn` emits `{ path: "notes/a.md", trigger: "button", position: { x: <rect.left>, y: <rect.bottom> } }`.
  - [ ] Card click and Enter/Space on `.fce-card` emit `{ path, destination }` using `defaultOpenDestination` from props.
  - [ ] In bulk mode, the checkbox remains the only action control and neither pin nor more-actions renders.
  - [ ] CSS reserves action-cluster space and reveals action buttons on hover/focus without changing the card’s structural DOM.
  - [ ] `npx vitest run src/view/CardItem.svelte.test.ts src/view/FolderCardPanel.svelte.test.ts` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: normal-mode card emits configured destination and exposes more-actions without accidental open
    Tool: Bash
    Steps: Run `npx vitest run src/view/CardItem.svelte.test.ts -t "emits destination-aware open events and isolates the more-actions button"`
    Expected: Vitest passes; the card emits `{ path: "notes/a.md", destination: "split-right" }` while the more-actions button emits only `{ path: "notes/a.md", trigger: "button", position: { x, y } }`.
    Evidence: .sisyphus/evidence/task-4-card-actions-layout.txt

  Scenario: bulk mode keeps checkbox-only action slot
    Tool: Bash
    Steps: Run `npx vitest run src/view/CardItem.svelte.test.ts -t "keeps bulk mode action slot limited to the checkbox"`
    Expected: Vitest passes; `.fce-card-pin-btn` and `.fce-card-more-btn` are absent in bulk mode.
    Evidence: .sisyphus/evidence/task-4-card-actions-layout-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/CardItem.svelte`, `src/view/CardItem.svelte.test.ts`, `src/view/FolderCardPanel.svelte`, `src/view/FolderCardPanel.svelte.test.ts`, `styles.css`

- [x] 5. Expand FolderCardView’s card action menu to include open destinations

  **What to do**: Refactor `FolderCardView.ts` so card menu requests from both right-click and the more-actions button converge on one menu builder. Keep the method boundary centered on the existing `openCardContextMenu(...)` / `addCardContextMenuItems(...)` seam. Introduce support for two exact trigger modes: `{ trigger: "contextmenu", mouseEvent }` uses `showAtMouseEvent(mouseEvent)`, and `{ trigger: "button", position }` uses `showAtPosition(position)`. The menu item order and titles must be exactly the six items listed in **Must Have**. Each open action must route through `plugin.openNoteFromCard(notePath, destination)`; `Move to…` and `Copy` must keep using `routeCardMenuAction(...)` unchanged. Add button-trigger support without requiring a true `MouseEvent`.
  **Must NOT do**: Do not duplicate separate menu item lists for context click vs more-actions click; do not remove the `fce-card-context-menu` class; do not rename existing move/copy helpers unless required for clarity.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: host-level interaction refactor with menu mechanics and existing test harness support
  - Skills: `[]`
  - Omitted: `obsidian-plugin-docs` - `showAtMouseEvent` vs `showAtPosition` guidance is already known

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: final verification | Blocked By: 3, 4, 6

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/view/FolderCardView.ts:794-858` - existing card context menu seam and item registration
  - Pattern: `src/view/FolderCardView.ts:860-885` - existing routeCardMenuAction / move / copy path to preserve
  - Pattern: `src/view/CardItem.svelte:209-212` - existing context-menu event payload shape that the new button-trigger payload should parallel
  - Test: `src/view/card-context-actions.test.ts:606-660` - event isolation and menu invocation assertions
  - Test: `src/view/card-context-actions.test.ts:1912-1925` - exact menu item title/icon assertions to update
  - External: `.agents/skills/obsidian-plugin-docs/references/ui.md:194-197` - `showAtMouseEvent` and `showAtPosition` menu display guidance

  **Acceptance Criteria** (agent-executable only):
  - [ ] Right-click still opens the menu at the cursor and does not call `openNoteFromCard` by itself.
  - [ ] The more-actions button opens the same menu via `showAtPosition({ x, y })` using the exact button payload position instead of requiring a mouse context event.
  - [ ] Menu titles appear in the exact order: current area, new tab, open to the right, new window, move to…, copy.
  - [ ] Selecting any open-destination menu item calls `plugin.openNoteFromCard(notePath, destination)` with the correct destination.
  - [ ] `Move to…` and `Copy` still route through their existing behavior paths.
  - [ ] `npx vitest run src/view/card-context-actions.test.ts` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: right-click menu includes all open destinations before move/copy
    Tool: Bash
    Steps: Run `npx vitest run src/view/card-context-actions.test.ts -t "openCardContextMenu adds the four open destinations before Move to… and Copy"`
    Expected: Vitest passes; menu item titles exactly match the required order and the menu keeps the `fce-card-context-menu` class.
    Evidence: .sisyphus/evidence/task-5-card-menu-destinations.txt

  Scenario: more-actions button opens anchored menu and isolates open routing
    Tool: Bash
    Steps: Run `npx vitest run src/view/card-context-actions.test.ts -t "more-actions button opens the card menu without triggering openNoteFromCard"`
    Expected: Vitest passes; button-triggered menus use the non-mouse position path and note opening occurs only after selecting an explicit destination item.
    Evidence: .sisyphus/evidence/task-5-card-menu-destinations-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/FolderCardView.ts`, `src/view/card-context-actions.test.ts`, and any adjacent type/test helpers touched by the new menu trigger payload`

- [x] 6. Implement destination-specific note opening in the plugin

  **What to do**: Refactor `src/main.ts` so `openNoteFromCard` accepts `(path: string, destination: OpenDestination)` and routes to a new helper that resolves a destination-specific `WorkspaceLeaf`. Implement exact behaviors:
  - `current-area`: preserve existing `resolveTargetLeaf()` behavior
  - `new-tab`: use `this.app.workspace.getLeaf(true)`
  - `split-right`: use `this.app.workspace.getLeaf("split", "vertical")`
  - `new-window`: use `this.app.workspace.openPopoutLeaf()` when available
  After resolving a valid leaf, call `await leaf.openFile(target, { active: true })` and then `this.syncSelection(target.path)`. For unsupported `new-window`, show `new Notice("Open in new window is available on desktop only.")` and return without opening. Keep `createNoteInCurrentFolder()` explicitly calling `openNoteFromCard(file.path, "current-area")`.
  **Must NOT do**: Do not use `getRightLeaf()` for split-right; do not silently downgrade `new-window` to another destination; do not stop calling `syncSelection` after successful opens.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: plugin runtime/API integration with multiple testable destination branches
  - Skills: `[]`
  - Omitted: `obsidian-plugin-docs` - API choices and guardrails are already fixed in the plan

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: 5 | Blocked By: 1

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/main.ts:164-172` - current single-destination `openNoteFromCard`
  - Pattern: `src/main.ts:250-262` - current `resolveTargetLeaf()` implementation to preserve for `current-area`
  - Pattern: `src/main.ts:115-124` - note creation path that must keep current-area semantics
  - Test: `src/main.test.ts:332-381` - plugin harness already stubs workspace leaf APIs
  - External: `.agents/skills/obsidian-plugin-docs/references/ui.md:1374-1379` - root split vs side dock leaf guidance
  - External: `.agents/skills/obsidian-plugin-docs/references/ui.md:1228-1237` - current plugin view uses `getRightLeaf(false)` only for the sidebar card view; do not reuse that for note opening

  **Acceptance Criteria** (agent-executable only):
  - [ ] `openNoteFromCard` accepts a destination argument and opens markdown files in the correct leaf for each supported destination.
  - [ ] `current-area` still reuses active/existing markdown leaf selection via `resolveTargetLeaf()`.
  - [ ] `split-right` does not call `getRightLeaf()`.
  - [ ] Unsupported `new-window` shows the exact notice text and performs no file open.
  - [ ] `createNoteInCurrentFolder()` explicitly opens the created note in `current-area`.
  - [ ] `npx vitest run src/main.test.ts` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: plugin resolves each destination to the correct leaf API
    Tool: Bash
    Steps: Run `npx vitest run src/main.test.ts -t "openNoteFromCard routes current-area, new-tab, and split-right to the correct workspace leaf APIs"`
    Expected: Vitest passes; `current-area` uses the existing leaf resolver, `new-tab` uses `getLeaf(true)`, and `split-right` uses the split API without touching `getRightLeaf()`.
    Evidence: .sisyphus/evidence/task-6-plugin-open-destinations.txt

  Scenario: unsupported new-window shows notice and does not open the file
    Tool: Bash
    Steps: Run `npx vitest run src/main.test.ts -t "shows a desktop-only notice when open in new window is unavailable"`
    Expected: Vitest passes; `openPopoutLeaf` unavailability yields the exact notice text and no `openFile` call.
    Evidence: .sisyphus/evidence/task-6-plugin-open-destinations-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/main.ts`, `src/main.test.ts`, and any imported settings/type modules required for `OpenDestination`

- [x] 7. Register the Page Preview hover source during plugin startup

  **What to do**: In `src/main.ts` `onload()`, register a hover-link source once via `this.registerHoverLinkSource("card-workspace", { display: "Card Workspace", defaultMod: true })` after settings/view registration and before runtime events that can emit hover-link. Keep the source id exactly `card-workspace` to match the plugin manifest id and keep `display` exactly `Card Workspace` to match the plugin name. Do not conditionally register per platform or per view. Extend tests/mocks so startup assertions can verify registration occurs once.
  **Must NOT do**: Do not register the hover source from `FolderCardView` or `CardItem.svelte`; do not omit `defaultMod`; do not create multiple source ids.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: single plugin-startup hook plus test harness augmentation
  - Skills: `[]`
  - Omitted: `obsidian-plugin-docs` - hover-source contract has already been resolved

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 8 | Blocked By: none

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/main.ts:62-100` - plugin startup sequencing in `onload()`
  - Pattern: `manifest.json:2-4` - plugin id/name that the hover source must mirror
  - Test: `src/main.test.ts:250-381` - Obsidian plugin/workspace harness to extend with `registerHoverLinkSource`
  - External: `https://github.com/obsidianmd/obsidian-api/blob/bbb696aeb8bf5126bf2ecbf84fc8284fe133bc20/obsidian.d.ts` - source-backed `registerHoverLinkSource(id, { display, defaultMod })` contract
  - External: `.agents/skills/obsidian-plugin-docs/references/guides.md:206-214` - hover-link emission pattern that this registration supports

  **Acceptance Criteria** (agent-executable only):
  - [ ] `onload()` registers exactly one hover source with id `card-workspace`.
  - [ ] The hover source info object is exactly `{ display: "Card Workspace", defaultMod: true }`.
  - [ ] Hover-source registration remains startup-only and is not repeated by views.
  - [ ] `npx vitest run src/main.test.ts` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: plugin startup registers the Card Workspace hover source exactly once
    Tool: Bash
    Steps: Run `npx vitest run src/main.test.ts -t "registers the Card Workspace hover-link source during startup"`
    Expected: Vitest passes; the plugin register stub receives `("card-workspace", { display: "Card Workspace", defaultMod: true })` exactly once during `onload()`.
    Evidence: .sisyphus/evidence/task-7-hover-source-registration.txt

  Scenario: startup registration does not duplicate across repeated lifecycle setup assertions
    Tool: Bash
    Steps: Run `npx vitest run src/main.test.ts -t "does not duplicate hover-link source registration within a single plugin startup"`
    Expected: Vitest passes; only one registration call is observed per instantiated plugin lifecycle.
    Evidence: .sisyphus/evidence/task-7-hover-source-registration-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/main.ts`, `src/main.test.ts`

- [x] 8. Emit supported hover-link events from markdown cards only

  **What to do**: Extend the card/view seam so hover-preview events are emitted from card hover for markdown cards only. Keep the event path consistent with the existing architecture: `CardItem.svelte` captures `mouseover` on the link-like hover target (use the card title group, not the entire card action cluster), forwards `{ path, targetEl, mouseEvent }` through `FolderCardPanel.svelte`, and `FolderCardView.ts` calls `this.app.workspace.trigger("hover-link", { event: mouseEvent, source: "card-workspace", hoverParent: this, targetEl, linktext: path })`. Do not emit from non-markdown cards, more-actions button, pin button, or bulk checkbox. Do not add manual Ctrl/Cmd guards; rely on the registered source’s `defaultMod: true` setting and Obsidian Page Preview. Update component/view tests to assert exact event payloads.
  **Must NOT do**: Do not emit hover-link directly from the plugin class or from arbitrary DOM nodes lacking the card context; do not emit for `.base`, `.canvas`, or `.excalidraw` cards; do not emit on click.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: coordinated Svelte/view hover behavior with source-backed API payload requirements and non-trivial test setup
  - Skills: `[]`
  - Omitted: `playwright` - browser automation is unnecessary because the supported behavior is fully unit/integration-testable in jsdom with workspace trigger stubs

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: final verification | Blocked By: 3, 4, 7

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/view/CardItem.svelte:249-304` - current card DOM; choose the title group as the hover target surface
  - Pattern: `src/view/FolderCardPanel.svelte:183-197,553-566` - callback forwarding seam from card to view
  - Pattern: `src/view/FolderCardView.ts:440-455` - host callback registration style to extend with hover preview events
  - Pattern: `src/view/types.ts:39-49` - `NoteCardRecord.fileKind` identifies markdown-only hover eligibility
  - Test: `src/view/CardItem.svelte.test.ts:318-413` - existing render/search assertions to extend with hover-event coverage
  - Test: `src/view/FolderCardView.test.ts` - add workspace trigger stub assertions at the host seam
  - External: `.agents/skills/obsidian-plugin-docs/references/guides.md:195-214` - official hover-link emission example

  **Acceptance Criteria** (agent-executable only):
  - [ ] Hovering the markdown card hover target emits a forwarded payload that ultimately calls `workspace.trigger("hover-link", ...)` with `source: "card-workspace"`, `linktext: <path>`, `targetEl`, `event`, and `hoverParent: this`.
  - [ ] Non-markdown cards do not emit any hover-link events.
  - [ ] Action buttons and bulk controls do not emit hover-link events.
  - [ ] The implementation does not manually inspect Ctrl/Cmd state before calling `workspace.trigger`.
  - [ ] `npx vitest run src/view/CardItem.svelte.test.ts src/view/FolderCardView.test.ts` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: markdown card hover emits the exact hover-link payload through the view seam
    Tool: Bash
    Steps: Run `npx vitest run src/view/FolderCardView.test.ts -t "emits hover-link for markdown card hover with the Card Workspace source"`
    Expected: Vitest passes; the workspace trigger stub receives `hover-link` with `{ source: "card-workspace", linktext: "notes/a.md", hoverParent: view, targetEl, event }`.
    Evidence: .sisyphus/evidence/task-8-hover-link-forwarding.txt

  Scenario: non-markdown cards and action controls never emit hover-link
    Tool: Bash
    Steps: Run `npx vitest run src/view/CardItem.svelte.test.ts -t "limits hover preview dispatch to markdown title hover only"`
    Expected: Vitest passes; canvas/base/excalidraw cards and button hovers produce no preview payload.
    Evidence: .sisyphus/evidence/task-8-hover-link-forwarding-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `src/view/CardItem.svelte`, `src/view/CardItem.svelte.test.ts`, `src/view/FolderCardPanel.svelte`, `src/view/FolderCardView.ts`, `src/view/FolderCardView.test.ts`, and any shared types used for the hover payload`

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit

  **What to do**: Run a read-only audit against the implemented diff and verify that every shipped behavior matches this plan’s locked decisions. Check especially: the four `defaultOpenDestination` values, exact menu item titles/order, `split-right` using root-split semantics instead of `getRightLeaf()`, markdown-only hover preview, exact new-window notice text, and unchanged move/copy behavior.
  **Must NOT do**: Do not modify code during this audit; do not accept approximations such as renamed menu items or fallback open-destination behavior.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: comprehensive read-only verification against the plan with implementation context
  - Skills: `[]`
  - Omitted: `oracle` - review category must stay in the supported executor categories listed for this environment

  **Parallelization**: Can Parallel: YES | Final Wave | Blocks: completion sign-off | Blocked By: tasks 1-8 complete

  **References**:
  - Plan: `.sisyphus/plans/card-open-modes-and-preview.md:58-87` - locked functional requirements and guardrails
  - Plan: `.sisyphus/plans/card-open-modes-and-preview.md:306-399` - menu + open-destination runtime tasks
  - Plan: `.sisyphus/plans/card-open-modes-and-preview.md:401-486` - hover-link integration tasks

  **Acceptance Criteria**:
  - [ ] Reviewer explicitly confirms every must-have item is implemented or marks the audit failed.
  - [ ] Reviewer explicitly confirms no must-not-have item is violated or marks the audit failed.
  - [ ] Audit output names any mismatches by file/path and planned requirement.

  **QA Scenarios**:
  ```
  Scenario: plan-to-implementation audit passes with no requirement drift
    Tool: task
    Steps: Launch one `unspecified-high` review agent to compare the final code diff against this plan, requiring a checklist-based pass/fail verdict with cited file paths.
    Expected: Agent returns PASS only if all must-have / must-not-have conditions align exactly; otherwise returns FAIL with concrete mismatches.
    Evidence: .sisyphus/evidence/final-f1-plan-compliance.txt

  Scenario: plan audit catches menu/open-behavior drift if present
    Tool: task
    Steps: In the same review, require explicit verification of menu labels/order, split-right semantics, and new-window notice text.
    Expected: Agent reports the exact file and discrepancy if any title/order/API/notice string differs from plan.
    Evidence: .sisyphus/evidence/final-f1-plan-compliance-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `n/a`

- [x] F2. Code Quality Review

  **What to do**: Run a code-quality review focused on correctness, maintainability, typing, event isolation, and regression risk in the changed files. Require the reviewer to inspect settings normalization, callback payload threading, menu dispatch branching, workspace API usage, and hover-link event plumbing.
  **Must NOT do**: Do not rely on style-only comments; do not pass the review without explicitly checking for type drift, dead branches, duplicated menu logic, and accidental bulk-mode regressions.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: hands-on code review across TS + Svelte + host wiring
  - Skills: `[]`
  - Omitted: `quick` - this is a broad review pass, not a trivial edit

  **Parallelization**: Can Parallel: YES | Final Wave | Blocks: completion sign-off | Blocked By: tasks 1-8 complete

  **References**:
  - Plan: `.sisyphus/plans/card-open-modes-and-preview.md:129-486` - implementation task contracts to review against
  - Repo rule: `AGENTS.md` - strict typing, Svelte legacy mode, and native-feel/virtualization guardrails

  **Acceptance Criteria**:
  - [ ] Reviewer explicitly assesses correctness, maintainability, and regression risk in all changed files.
  - [ ] Reviewer explicitly checks for duplicated menu logic, invalid Obsidian API usage, and accessibility regressions.
  - [ ] Review output is binary PASS/FAIL with cited file paths for any issues.

  **QA Scenarios**:
  ```
  Scenario: quality review passes with no correctness or maintainability issues
    Tool: task
    Steps: Launch one `unspecified-high` review agent to inspect changed files for typing correctness, event isolation, API usage, and duplication.
    Expected: Agent returns PASS only if no blocking code-quality issues remain; otherwise FAIL with concrete file/path citations.
    Evidence: .sisyphus/evidence/final-f2-code-quality.txt

  Scenario: quality review explicitly checks bulk-mode and action-button isolation
    Tool: task
    Steps: Require the reviewer to verify that more-actions, pin, hover preview, and bulk mode do not interfere with each other.
    Expected: Agent reports PASS only if these interaction seams remain isolated; otherwise FAIL with the conflicting file path and branch.
    Evidence: .sisyphus/evidence/final-f2-code-quality-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `n/a`

- [x] F3. Real Manual QA

  **What to do**: Execute the repository’s required automated verification commands and targeted suites for this feature, then summarize pass/fail results. This final QA step must cover both broad repo health and feature-focused tests.
  **Must NOT do**: Do not substitute partial test runs for full verification; do not mark this complete if any command fails.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: command execution + evidence gathering across all required validation layers
  - Skills: `[]`
  - Omitted: `playwright` - the repo’s accepted validation path for this feature is fully covered by Vitest + check/build/test commands

  **Parallelization**: Can Parallel: YES | Final Wave | Blocks: completion sign-off | Blocked By: tasks 1-8 complete

  **References**:
  - Plan: `.sisyphus/plans/card-open-modes-and-preview.md:49-56` - definition-of-done commands
  - AGENTS.md: required validation commands `npm run check`, `npm run build`, `npm test`

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/settings.test.ts src/FolderCardExplorerSettingTab.test.ts` exits `0`.
  - [ ] `npx vitest run src/view/CardItem.svelte.test.ts src/view/FolderCardPanel.svelte.test.ts src/view/FolderCardView.test.ts src/view/card-context-actions.test.ts` exits `0`.
  - [ ] `npx vitest run src/main.test.ts` exits `0`.
  - [ ] `npm run check` exits `0`.
  - [ ] `npm run build` exits `0`.
  - [ ] `npm test` exits `0`.

  **QA Scenarios**:
  ```
  Scenario: targeted feature suites all pass
    Tool: Bash
    Steps: Run `npx vitest run src/settings.test.ts src/FolderCardExplorerSettingTab.test.ts src/view/CardItem.svelte.test.ts src/view/FolderCardPanel.svelte.test.ts src/view/FolderCardView.test.ts src/view/card-context-actions.test.ts src/main.test.ts`
    Expected: All targeted suites exit `0` and cover settings, component, host-view, menu, and plugin runtime seams.
    Evidence: .sisyphus/evidence/final-f3-targeted-tests.txt

  Scenario: full repository validation passes
    Tool: Bash
    Steps: Run `npm run check && npm run build && npm test`
    Expected: All three commands exit `0` with no type, build, or test failures.
    Evidence: .sisyphus/evidence/final-f3-full-validation.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `n/a`

- [x] F4. Scope Fidelity Check

  **What to do**: Run a final scope-only review that verifies the change set stayed within the requested feature boundaries: settings for default destination, card more-actions button, menu expansion, open-destination routing, and Page Preview hover-link integration. Explicitly reject any accidental toolbar redesign, custom preview UI, modifier-click shortcuts, or bulk-mode redesign.
  **Must NOT do**: Do not grade implementation quality here; this is a pure scope-boundary audit.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: targeted review of scope fidelity using the final diff and plan boundaries
  - Skills: `[]`
  - Omitted: `deep` - not a supported final-wave executor category for this environment

  **Parallelization**: Can Parallel: YES | Final Wave | Blocks: completion sign-off | Blocked By: tasks 1-8 complete

  **References**:
  - Plan: `.sisyphus/plans/card-open-modes-and-preview.md:35-47` - intended deliverables
  - Plan: `.sisyphus/plans/card-open-modes-and-preview.md:80-87` - explicit out-of-scope guardrails

  **Acceptance Criteria**:
  - [ ] Reviewer explicitly confirms all changed work is inside the planned scope or marks FAIL.
  - [ ] Reviewer explicitly confirms no out-of-scope feature was added.
  - [ ] Review output names any out-of-scope files/behaviors if scope drift occurred.

  **QA Scenarios**:
  ```
  Scenario: scope fidelity passes with no out-of-scope additions
    Tool: task
    Steps: Launch one `unspecified-high` review agent to compare the final diff against the plan’s IN/OUT boundaries only.
    Expected: Agent returns PASS only if the change set stays within the requested feature scope; otherwise FAIL with cited out-of-scope files/behaviors.
    Evidence: .sisyphus/evidence/final-f4-scope-fidelity.txt

  Scenario: scope review explicitly rejects custom preview UI or shortcut creep if present
    Tool: task
    Steps: Require explicit checks for custom preview popovers, modifier-click shortcuts, toolbar redesign, and bulk-mode redesign.
    Expected: Agent reports PASS only if none were added; otherwise FAIL with concrete citations.
    Evidence: .sisyphus/evidence/final-f4-scope-fidelity-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: `n/a`

## Commit Strategy
- Do **not** create commits unless the user explicitly asks for them after implementation and verification.
- If a commit is later requested, prefer one feature commit after implementation tasks pass and a separate follow-up fix commit only if final verification finds issues.
- Recommended future commit message if requested: `feat(cards): add configurable open destinations and page preview hooks`

## Success Criteria
- Card left-click and Enter/Space honor the configured default destination without affecting bulk-mode selection behavior.
- Each card exposes a hover/focus-revealed more-actions button that opens a menu with the exact four open destinations plus existing move/copy actions.
- `Open to the right` opens in a root split to the right, not in the right sidebar dock.
- `Open in new window` succeeds on supported desktop environments and shows a notice/no-op on unsupported environments.
- Ctrl/Cmd + hover works through Obsidian’s supported Page Preview hover-link path for markdown cards without custom preview UI.
