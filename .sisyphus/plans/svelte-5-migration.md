# Full Svelte 5 Migration Plan

## TL;DR
> **Summary**: Fully migrate the plugin from Svelte legacy compatibility patterns to standard Svelte 5 while preserving the current Obsidian runtime architecture, virtualization behavior, and performance invariants. Build the migration around TDD, first establishing real-runtime coverage and a typed host-owned panel model that replaces legacy `$set` updates.
> **Deliverables**:
> - Standard Svelte 5 component syntax in `src/view/FolderCardPanel.svelte`, `src/view/Toolbar.svelte`, and `src/view/CardItem.svelte`
> - Host integration in `src/view/FolderCardView.ts` migrated from `new/$set/$on/$destroy` to a typed panel model plus `mount/unmount`
> - Verification safety net: `svelte-check`, real component smoke/contract tests, and CI
> - Removal of `compatibility.componentApi = 4` and legacy mock surfaces in the same initiative
> **Effort**: Large
> **Parallel**: YES - 4 waves
> **Critical Path**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

## Context
### Original Request
"目前项目还在使用svelte legacy。我希望重构到svelte 5 规范。"

### Interview Summary
- User selected a **full migration to standard Svelte 5**, not a permanent compatibility-mode solution.
- User selected **TDD**: add key regression coverage first, then migrate incrementally.
- User wants **migration safety-net setup included** in scope.
- User approved a **temporary bridge phase** so components can migrate before `FolderCardView.ts` fully leaves the legacy class API.

### Metis Review (gaps addressed)
- Locked the key architectural decision that replaces repeated `$set(...)`: use a **host-owned typed panel model** with explicit mutation methods, not remounting.
- Added guardrails to avoid false confidence from mock-only tests by requiring real `.svelte` runtime smoke/contract coverage.
- Narrowed the temporary bridge to the **outer seam only** (`FolderCardView.ts` ↔ root panel), forbidding a permanent compatibility facade.
- Preserved non-migration invariants: virtualization, generation guards, debounced refresh behavior, CSS scope, CJS bundle, and Obsidian externals.

## Work Objectives
### Core Objective
Migrate the repo’s Svelte integration from legacy compatibility patterns to standard Svelte 5 patterns without changing feature scope or degrading runtime behavior.

### Deliverables
- `package.json` includes a runnable `svelte-check` verification path and any required component-test scripts.
- `vitest.config.ts` supports both existing node-based logic tests and real Svelte component tests using a DOM environment.
- `src/view/panel-model.ts` defines the host-owned typed panel model via `interface PanelModelState` and `createPanelModel(...)`, replacing ad hoc `$set(...)` prop pushes.
- `src/view/CardItem.svelte`, `src/view/Toolbar.svelte`, and `src/view/FolderCardPanel.svelte` no longer depend on `export let`, `$:`, `createEventDispatcher`, or component `on:` forwarding as their primary component-contract mechanism.
- `src/view/FolderCardView.ts` mounts the panel with Svelte 5 `mount/unmount`, passes typed callback props, and updates a host-owned panel model instead of calling `$set`.
- `src/__mocks__/FolderCardPanel.svelte.ts` and related tests stop modeling the legacy component instance API as the primary contract.
- `esbuild.config.mjs` no longer sets `compatibility.componentApi = 4`.
- CI runs `npx svelte-check --tsconfig ./tsconfig.json`, `npm run check`, `npm run build`, and `npm test` on Node 20.

### Definition of Done (verifiable conditions with commands)
- `npx svelte-check --tsconfig ./tsconfig.json` exits `0`
- `npm run check` exits `0`
- `npm run build` exits `0`
- `npm test` exits `0`
- `npx vitest run src/view/CardItem.svelte.test.ts` exits `0`
- `npx vitest run src/view/Toolbar.svelte.test.ts` exits `0`
- `npx vitest run src/view/FolderCardPanel.svelte.test.ts` exits `0`
- `npx vitest run src/view/FolderCardView.test.ts` exits `0`
- `grep -R "componentApi: 4" esbuild.config.mjs package.json src vitest.config.ts` returns no matches
- `grep -R "createEventDispatcher\|export let\|\$set(\|\$on(\|\$destroy(" src/view src/__mocks__` returns no matches in the migrated surfaces

### Must Have
- Full standard Svelte 5 end state in the component tree and host seam covered by this initiative.
- TDD-first migration sequencing with real runtime coverage added before risky host seam changes.
- Host-owned typed panel model as the sole replacement for repeated `$set(...)` updates.
- Temporary bridge only at the outer host/root seam and removed before completion.
- Exact preservation of current user-visible behaviors unless a failing test demonstrates a pre-existing bug.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Must NOT redesign the UI, styles, folder workflow, selection model, or card layout.
- Must NOT migrate build tooling away from esbuild/CJS unless a verified blocker makes it unavoidable.
- Must NOT rewrite `use:` actions merely because they are Svelte-specific; keep them unless a real compatibility issue requires change.
- Must NOT use controlled remounting for normal selection/filter/scroll/hydration updates.
- Must NOT leave a permanent adapter exposing `new/$set/$on/$destroy` semantics.
- Must NOT change virtualization, hydration window logic, generation guards, pin/filter ordering, or debounced vault observer behavior except to preserve them during API migration.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: **TDD** using existing Vitest plus new real-runtime component tests and `svelte-check`
- QA policy: Every task includes agent-executed happy-path and failure/edge-case scenarios
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: verification safety net and architectural contract foundation
Wave 2: leaf/subtree component migration slices (`CardItem`, `Toolbar`) under tests
Wave 3: root panel + host seam migration and compatibility removal
Wave 4: cleanup, CI hardening, full verification

### Dependency Matrix (full, all tasks)
- 1 blocks 2, 3, 4, 5, 6, 7, 8, 9
- 2 blocks 5, 6, 7, 8, 9
- 3 blocks 6, 7, 8, 9
- 4 blocks 6, 7, 8, 9
- 5 blocks 7, 8, 9
- 6 blocks 7, 8, 9
- 7 blocks 8, 9
- 8 blocks 9
- 9 blocks final verification only

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 4 tasks → unspecified-high, quick
- Wave 2 → 2 tasks → unspecified-high
- Wave 3 → 2 tasks → deep, unspecified-high
- Wave 4 → 1 task → quick

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Add migration verification baseline and DOM-capable component test lane

  **What to do**:
  - Update `package.json` to add `svelte-check` and explicit component-test commands if needed.
  - Update `vitest.config.ts` so existing pure logic tests stay on the node environment while `.svelte` component tests can run in `jsdom`.
  - Add any minimal dev dependencies required for `svelte-check` and DOM-backed Vitest component execution.
  - Keep the current test inventory working; do not break existing node-based tests to enable component tests.

  **Must NOT do**:
  - Do not replace Vitest.
  - Do not add browser E2E tooling.
  - Do not switch the whole test suite globally to `jsdom` if per-file/per-project split suffices.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: touches verification tooling, package scripts, and test runtime configuration.
  - Skills: [`obsidian-plugin-docs`] - why needed: confirm no Obsidian-specific packaging assumptions are violated while changing build/test tooling.
  - Omitted: [`project-docs-maintenance`] - why not needed: documentation updates are out of scope for this migration plan.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [2, 3, 4, 5, 6, 7, 8, 9] | Blocked By: []

  **References**:
  - Pattern: `vitest.config.ts` - current Vitest setup with global aliasing and node test environment to preserve where possible.
  - Pattern: `package.json` - current script layout and dependency versions.
  - External: `https://svelte.dev/docs/svelte/v5-migration-guide` - migration guidance confirming standard Svelte 5 target.
  - External: `https://svelte.dev/docs/svelte/legacy-component-api` - legacy API being phased out.

  **Acceptance Criteria**:
  - [ ] `npx svelte-check --tsconfig ./tsconfig.json` exits `0`
  - [ ] `npx vitest run src/view/card-context-actions.test.ts` exits `0`
  - [ ] `npm test` exits `0` after the config split
  - [ ] Existing pure-logic tests still run under node, and component tests can run under `jsdom`

  **QA Scenarios**:
  ```
  Scenario: Baseline verification lane works
    Tool: Bash
    Steps: Run `npx svelte-check --tsconfig ./tsconfig.json && npm run check && npm test`
    Expected: All commands exit 0 and the test suite reports both legacy logic tests and new component-capable configuration without config errors
    Evidence: .sisyphus/evidence/task-1-verification-baseline.txt

  Scenario: DOM test lane is isolated
    Tool: Bash
    Steps: Run `grep -R "jsdom\|environment" vitest.config.ts package.json && npx vitest run src/view/card-context-actions.test.ts`
    Expected: The config clearly defines a DOM-capable component-test lane while the existing node-based integration test still runs successfully under the split setup
    Evidence: .sisyphus/evidence/task-1-dom-lane.txt
  ```

  **Commit**: YES | Message: `test(svelte): add migration verification baseline` | Files: [`package.json`, `vitest.config.ts`, lockfile if changed]

- [x] 2. Add real Svelte runtime smoke tests for `CardItem.svelte` and `Toolbar.svelte`

  **What to do**:
  - Create DOM-backed tests that import the real `.svelte` components instead of mocks.
  - For `CardItem.svelte`, assert rendering, click/keyboard/context-menu behavior, and pin toggle callback contract.
  - For `Toolbar.svelte`, assert filter/sort/include-subfolders/folder-selection callback behavior and teardown of any portaled menus/listeners.
  - Prefer the standard Svelte 5 mounting path used by tests over mock-only legacy instance APIs.

  **Must NOT do**:
  - Do not rely on `createEventDispatcher` or mocked `$on` behavior as the sole assertion mechanism.
  - Do not weaken current behavior by asserting only that tests compile.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: non-trivial DOM tests across interactive components with menus and callbacks.
  - Skills: []
  - Omitted: [`obsidian-plugin-docs`] - why not needed: this is repo-local test work.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [5, 6, 7, 8, 9] | Blocked By: [1]

  **References**:
  - Pattern: `src/view/CardItem.svelte` - current note-card rendering and event behavior.
  - Pattern: `src/view/Toolbar.svelte` - current toolbar menu and action behavior.
  - Test: `src/view/card-context-actions.test.ts` - existing event payload expectations to preserve.
  - API/Type: `src/view/types.ts` - card and view-related contracts to preserve in tests.

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/view/CardItem.svelte.test.ts` exits `0`
  - [ ] `npx vitest run src/view/Toolbar.svelte.test.ts` exits `0`
  - [ ] Card item click emits the preserved note-open payload for `notes/a.md`
  - [ ] Toolbar teardown removes any menu DOM appended to `document.body` and leaves no leaked click listeners detectable by repeated mount/unmount cycles

  **QA Scenarios**:
  ```
  Scenario: Card item runtime behavior matches existing contract
    Tool: Bash
    Steps: Run `npx vitest run src/view/CardItem.svelte.test.ts -t "opens note and toggles pin"`
    Expected: The real component renders, clicking the card requests open for `notes/a.md`, and pin-toggle callback receives the expected card identity payload
    Evidence: .sisyphus/evidence/task-2-carditem-smoke.txt

  Scenario: Toolbar cleanup is correct after failure-style interaction
    Tool: Bash
    Steps: Run `npx vitest run src/view/Toolbar.svelte.test.ts -t "cleans up menus on unmount"`
    Expected: After opening and unmounting menus, no orphaned menu nodes remain in `document.body` and follow-up mounts do not duplicate handlers
    Evidence: .sisyphus/evidence/task-2-toolbar-cleanup.txt
  ```

  **Commit**: YES | Message: `test(view): add real svelte runtime smoke coverage` | Files: [`src/view/CardItem.svelte.test.ts`, `src/view/Toolbar.svelte.test.ts`, related helpers/mocks]

- [x] 3. Add root-panel and host-contract tests that cover real runtime mounting behavior

  **What to do**:
  - Add a real `FolderCardPanel.svelte` smoke/contract test that mounts the root panel and asserts empty state, rendered list state, and hydrate callback behavior.
  - Add or expand `FolderCardView.test.ts` coverage for mount/unmount cycles, state propagation, and no-leak teardown behavior.
  - Reduce or scope global mock aliasing so these tests can exercise the real panel runtime instead of the legacy mock.

  **Must NOT do**:
  - Do not delete existing mock-based tests until equivalent or stronger real-runtime coverage exists.
  - Do not leave the root panel untested while changing the host seam.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: root contract tests affect both runtime coordinator and real Svelte root behavior.
  - Skills: []
  - Omitted: [`obsidian-plugin-docs`] - why not needed: runtime contract is internal to repo.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [6, 7, 8, 9] | Blocked By: [1]

  **References**:
  - Pattern: `src/view/FolderCardPanel.svelte` - root panel behavior and row/hydrate handling.
  - Pattern: `src/view/FolderCardView.ts` - current host mount/update/destroy responsibilities.
  - Test: `src/view/card-context-actions.test.ts` - current payload contract coverage to preserve.
  - Mock: `src/__mocks__/FolderCardPanel.svelte.ts` - current legacy seam to phase out safely.

  **Acceptance Criteria**:
  - [ ] `npx vitest run src/view/FolderCardPanel.svelte.test.ts` exits `0`
  - [ ] `npx vitest run src/view/FolderCardView.test.ts` exits `0`
  - [ ] Root panel smoke test asserts `.fce-list` render path and empty-state message `No Markdown notes found in this folder.`
  - [ ] Host test verifies repeated open/close cycles do not leave dangling DOM or handler state

  **QA Scenarios**:
  ```
  Scenario: Root panel smoke test covers empty and populated states
    Tool: Bash
    Steps: Run `npx vitest run src/view/FolderCardPanel.svelte.test.ts`
    Expected: The real panel renders empty-state text for empty cards, renders the list container for populated cards, and invokes hydrate callback with numeric bounds
    Evidence: .sisyphus/evidence/task-3-panel-smoke.txt

  Scenario: Host open/close cycles stay leak-free
    Tool: Bash
    Steps: Run `npx vitest run src/view/FolderCardView.test.ts -t "mounts panel and propagates updates"`
    Expected: `onOpen()` mounts once, later updates propagate without crash, and repeated close/reopen cycles do not duplicate subscriptions or leave stale nodes
    Evidence: .sisyphus/evidence/task-3-host-contract.txt
  ```

  **Commit**: YES | Message: `test(host): cover real panel mount contract` | Files: [`src/view/FolderCardPanel.svelte.test.ts`, `src/view/FolderCardView.test.ts`, `vitest.config.ts`, targeted helpers]

- [x] 4. Introduce a typed host-owned panel model and temporary outer-seam bridge

  **What to do**:
  - Create `src/view/panel-model.ts` exporting `interface PanelModelState` and `createPanelModel(...)`, capturing the UI-facing panel state currently pushed through repeated `$set(...)` calls.
  - Expose explicit mutation methods such as cards update, selection update, filter/sort update, folder-path update, and hydration-window update.
  - Add a temporary outer bridge that normalizes mount/unmount and callback wiring between `FolderCardView.ts` and the root panel while migration is in flight.
  - Keep `FolderCardView.ts` as the only write owner; components remain read-mostly and request changes via callbacks only.

  **Must NOT do**:
  - Do not expose a long-lived `$set`-like adapter.
  - Do not duplicate source-of-truth state between the host and components.
  - Do not use remounting as the normal update path.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: this is the central architecture seam and source-of-truth contract for the migration.
  - Skills: []
  - Omitted: [`obsidian-plugin-docs`] - why not needed: primarily internal coordinator design.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [7, 8, 9] | Blocked By: [1]

  **References**:
  - Pattern: `src/view/FolderCardView.ts` - legacy instance typing, dynamic import, mount, event wiring, destroy flow, and repeated `$set` update calls that must be replaced by explicit model updates.
  - API/Type: `src/view/types.ts` - view-facing state types to reuse rather than inventing parallel contracts.
  - External: `https://svelte.dev/docs/svelte/v5-migration-guide` - `mount/unmount` and standard Svelte 5 component model guidance.

  **Acceptance Criteria**:
  - [ ] `src/view/panel-model.ts` exists and exports `interface PanelModelState` plus `createPanelModel(...)`
  - [ ] `grep -R "\$set(" src/view/FolderCardView.ts` returns no matches
  - [ ] Temporary bridge is restricted to mount/unmount and callback normalization at the outer seam only
  - [ ] `npx vitest run src/view/FolderCardView.test.ts` exits `0`

  **QA Scenarios**:
  ```
  Scenario: Host model updates replace legacy prop pushes
    Tool: Bash
    Steps: Run `grep -R "interface PanelModelState\|createPanelModel" src/view/panel-model.ts src/view/FolderCardView.ts && ! grep -R "\$set(" src/view/FolderCardView.ts && npx vitest run src/view/FolderCardView.test.ts -t "mounts panel and propagates updates"`
    Expected: The typed panel model exists, `FolderCardView.ts` no longer uses `$set`, and state changes propagate without remounting
    Evidence: .sisyphus/evidence/task-4-panel-model.txt

  Scenario: Bridge does not become a hidden compatibility facade
    Tool: Bash
    Steps: Run `! grep -R "\$set(" src/view/FolderCardView.ts && npx vitest run src/view/FolderCardView.test.ts -t "mounts panel and propagates updates"`
    Expected: The outer seam no longer depends on `$set`, and the migrated host test still passes
    Evidence: .sisyphus/evidence/task-4-legacy-surface-audit.txt
  ```

  **Commit**: YES | Message: `refactor(view): add typed panel model bridge` | Files: [`src/view/panel-model.ts`, `src/view/FolderCardView.ts`, related tests]

- [x] 5. Migrate `CardItem.svelte` to standard Svelte 5 contract patterns

  **What to do**:
  - Convert `export let` to `$props()`.
  - Replace local `$:` usage with `$derived` or straightforward rune-safe computation.
  - Replace `createEventDispatcher` output contract with typed callback props.
  - Update parent call sites and tests to use the new callback prop contract while preserving payload semantics.

  **Must NOT do**:
  - Do not change rendered HTML structure or CSS class semantics unless required by Svelte 5 syntax.
  - Do not change preview rendering behavior or `{@html}` sanitization assumptions.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: self-contained component migration with parent contract updates.
  - Skills: []
  - Omitted: [`obsidian-plugin-docs`] - why not needed: pure repo-local component work.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [7, 8, 9] | Blocked By: [1, 2, 4]

  **References**:
  - Pattern: `src/view/CardItem.svelte` - current props, event handlers, and `{@html}` render path.
  - Pattern: `src/view/FolderCardPanel.svelte` - parent usage of `CardItem` callback/event contract.
  - Test: `src/view/CardItem.svelte.test.ts` - required smoke/contract behavior to keep passing.
  - Test: `src/view/card-context-actions.test.ts` - existing payload semantics to preserve.

  **Acceptance Criteria**:
  - [ ] `src/view/CardItem.svelte` no longer uses `export let`, `$:`, or `createEventDispatcher`
  - [ ] `npx vitest run src/view/CardItem.svelte.test.ts` exits `0`
  - [ ] Existing host/root tests consuming card actions still pass unchanged in behavior

  **QA Scenarios**:
  ```
  Scenario: Card item callback contract survives migration
    Tool: Bash
    Steps: Run `npx vitest run src/view/CardItem.svelte.test.ts && npx vitest run src/view/card-context-actions.test.ts`
    Expected: Real runtime tests and existing payload-contract tests both pass, proving callback props preserved event semantics
    Evidence: .sisyphus/evidence/task-5-carditem-migration.txt

  Scenario: Keyboard/context edge behavior remains intact
    Tool: Bash
    Steps: Run `npx vitest run src/view/CardItem.svelte.test.ts -t "supports keyboard and context menu actions"`
    Expected: Keyboard activation and context-menu callback behavior still emit the expected payload shapes without runtime errors
    Evidence: .sisyphus/evidence/task-5-carditem-edge.txt
  ```

  **Commit**: YES | Message: `refactor(view): migrate card item to svelte 5` | Files: [`src/view/CardItem.svelte`, `src/view/FolderCardPanel.svelte`, related tests/types]

- [x] 6. Migrate `Toolbar.svelte` to standard Svelte 5 while preserving menu cleanup and callback behavior

  **What to do**:
  - Convert `export let` to `$props()` and replace `$:` blocks with `$derived`/`$effect` as appropriate.
  - Replace `createEventDispatcher` outputs with typed callback props for toolbar actions, sort changes, filter changes, include-subfolders changes, and folder selection.
  - Preserve existing DOM cleanup and menu portal behavior; ensure any body-appended menus and document listeners are cleaned up on unmount.
  - Update parent/root usage to consume callbacks directly rather than legacy component events.

  **Must NOT do**:
  - Do not rewrite `use:` actions unless a specific compatibility issue requires it.
  - Do not redesign menu UX or folder-picker behavior.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: complex interactive component with many derived states and cleanup paths.
  - Skills: []
  - Omitted: [`obsidian-plugin-docs`] - why not needed: repo-local interactive component migration.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [7, 8, 9] | Blocked By: [1, 2, 4]

  **References**:
  - Pattern: `src/view/Toolbar.svelte` - current props, menus, actions, and dispatch sites.
  - Pattern: `src/view/FolderCardPanel.svelte` - parent/root usage of toolbar outputs.
  - Test: `src/view/Toolbar.svelte.test.ts` - runtime callback and cleanup assertions to preserve.
  - Test: `src/view/card-context-actions.test.ts` - existing action payload expectations.

  **Acceptance Criteria**:
  - [ ] `src/view/Toolbar.svelte` no longer uses `export let`, `$:`, or `createEventDispatcher`
  - [ ] `npx vitest run src/view/Toolbar.svelte.test.ts` exits `0`
  - [ ] Menu portal cleanup and callback payload behavior remain unchanged under repeated mount/unmount cycles

  **QA Scenarios**:
  ```
  Scenario: Toolbar callback contract survives migration
    Tool: Bash
    Steps: Run `npx vitest run src/view/Toolbar.svelte.test.ts`
    Expected: Filter, sort, include-subfolders, and folder-selection callbacks all fire with the expected payloads through the migrated callback-prop contract
    Evidence: .sisyphus/evidence/task-6-toolbar-migration.txt

  Scenario: Portaled menu cleanup remains leak-free
    Tool: Bash
    Steps: Run `npx vitest run src/view/Toolbar.svelte.test.ts -t "cleans up menus on unmount"`
    Expected: Repeated mount/unmount cycles leave no orphaned DOM in `document.body` and no duplicate document listeners
    Evidence: .sisyphus/evidence/task-6-toolbar-cleanup.txt
  ```

  **Commit**: YES | Message: `refactor(view): migrate toolbar to svelte 5` | Files: [`src/view/Toolbar.svelte`, `src/view/FolderCardPanel.svelte`, related tests/types]

- [x] 7. Migrate `FolderCardPanel.svelte` and `FolderCardView.ts` to the final standard Svelte 5 host/component seam

  **What to do**:
  - Convert `FolderCardPanel.svelte` from legacy props/reactivity/dispatcher usage to standard Svelte 5 rune-based props and callback props.
  - Replace the legacy class-based host integration in `FolderCardView.ts` with `mount/unmount` and the already-introduced host-owned panel model.
  - Move all root event handling to direct callback props instead of component `$on` subscriptions.
  - Preserve virtualization, selection projection, hydration range propagation, and async generation-safety behavior exactly.

  **Must NOT do**:
  - Do not change the virtualization row math or pipeline semantics.
  - Do not collapse host-owned orchestration into the Svelte component tree.
  - Do not remount the root panel for ordinary state changes.

  **Recommended Agent Profile**:
  - Category: `deep` - Reason: root component plus runtime coordinator migration is the highest-risk architecture slice.
  - Skills: []
  - Omitted: [`obsidian-plugin-docs`] - why not needed: internal seam and repo-local runtime migration.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: [8, 9] | Blocked By: [1, 3, 4, 5, 6]

  **References**:
  - Pattern: `src/view/FolderCardPanel.svelte` - root panel legacy patterns to replace.
  - Pattern: `src/view/FolderCardView.ts` - host runtime coordinator and mount/update/destroy responsibilities.
  - Pattern: `src/view/pipeline.ts` - projection logic that must remain behaviorally unchanged.
  - Pattern: `src/view/scroll-anchoring.ts` - anchoring behavior that must remain behaviorally unchanged.
  - Test: `src/view/FolderCardPanel.svelte.test.ts` - root runtime behavior.
  - Test: `src/view/FolderCardView.test.ts` - mount/update/teardown behavior.
  - Test: `src/view/card-context-actions.test.ts` - callback payload semantics.

  **Acceptance Criteria**:
  - [ ] `src/view/FolderCardPanel.svelte` and `src/view/FolderCardView.ts` no longer rely on `createEventDispatcher`, component `$on`, component `$set`, or class-based mounting
  - [ ] `npx vitest run src/view/FolderCardPanel.svelte.test.ts` exits `0`
  - [ ] `npx vitest run src/view/FolderCardView.test.ts` exits `0`
  - [ ] `npm run check` and `npm run build` exit `0`

  **QA Scenarios**:
  ```
  Scenario: Final host/root seam works under standard Svelte 5
    Tool: Bash
    Steps: Run `npx vitest run src/view/FolderCardPanel.svelte.test.ts && npx vitest run src/view/FolderCardView.test.ts`
    Expected: Real root-panel and host tests both pass using the new mount/callback/model seam without legacy instance APIs
    Evidence: .sisyphus/evidence/task-7-root-host-migration.txt

  Scenario: Existing behavior-critical logic stays stable after seam migration
    Tool: Bash
    Steps: Run `npx vitest run src/view/pipeline.test.ts && npx vitest run src/view/scroll-anchoring.test.ts && npx vitest run src/view/card-context-actions.test.ts`
    Expected: Projection, anchoring, and action-payload tests all pass, showing no regression in behavior-critical contracts
    Evidence: .sisyphus/evidence/task-7-behavior-regression.txt
  ```

  **Commit**: YES | Message: `refactor(view): migrate root panel and host seam` | Files: [`src/view/FolderCardPanel.svelte`, `src/view/FolderCardView.ts`, related tests/types/helpers]

- [x] 8. Remove legacy compatibility mode and legacy mock surfaces

  **What to do**:
  - Remove `compatibility.componentApi = 4` from `esbuild.config.mjs`.
  - Upgrade or adjust Svelte/esbuild plugin versions only if required to support the final standard Svelte 5 compile path.
  - Replace or delete legacy mock surfaces that model `$on/$set/$destroy` once no production/runtime tests depend on them.
  - Audit the migrated surfaces to ensure no forbidden legacy APIs remain.

  **Must NOT do**:
  - Do not remove compatibility mode before root/host runtime tests pass.
  - Do not keep dead compatibility shims after the final seam works.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: coordinated cleanup across build config, mocks, and migration leftovers.
  - Skills: []
  - Omitted: [`obsidian-plugin-docs`] - why not needed: repo-local tooling cleanup.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: [9] | Blocked By: [1, 3, 4, 5, 6, 7]

  **References**:
  - Pattern: `esbuild.config.mjs` - current compatibility flag to remove.
  - Mock: `src/__mocks__/FolderCardPanel.svelte.ts` - legacy mock surface to retire or rewrite.
  - Test: `src/view/card-context-actions.test.ts` - ensure remaining tests are aligned with the new runtime contract.
  - External: `https://svelte.dev/docs/svelte/legacy-component-api` - API being fully removed from repo usage.

  **Acceptance Criteria**:
  - [ ] `npm run build` exits `0` without `componentApi: 4`
  - [ ] `grep -R "componentApi: 4" esbuild.config.mjs package.json src vitest.config.ts` returns no matches
  - [ ] `grep -R "\$set(\|\$on(\|\$destroy(" src/view src/__mocks__` returns no matches in remaining migrated runtime surfaces
  - [ ] `npm test` exits `0`

  **QA Scenarios**:
  ```
  Scenario: Compatibility mode is fully removed
    Tool: Bash
    Steps: Run `! grep -R "componentApi: 4" esbuild.config.mjs package.json src vitest.config.ts && npm run build`
    Expected: No compatibility flag remains and the production build still exits 0
    Evidence: .sisyphus/evidence/task-8-compatibility-removal.txt

  Scenario: Legacy instance APIs are gone from runtime surfaces
    Tool: Bash
    Steps: Run `! grep -R "\$set(\|\$on(\|\$destroy(" src/view src/__mocks__ && npm test`
    Expected: No legacy instance API matches remain in runtime surfaces and tests still pass
    Evidence: .sisyphus/evidence/task-8-legacy-api-audit.txt
  ```

  **Commit**: YES | Message: `build(svelte): remove legacy compatibility mode` | Files: [`esbuild.config.mjs`, `src/__mocks__/FolderCardPanel.svelte.ts`, related tests/package config]

- [x] 9. Add CI enforcement and run final local verification sweep

  **What to do**:
  - Add GitHub Actions workflow running on `ubuntu-latest` with Node 20.
  - Ensure workflow runs `npx svelte-check --tsconfig ./tsconfig.json`, `npm run check`, `npm run build`, and `npm test`.
  - Make any final script/config cleanup needed so local and CI verification paths are identical.

  **Must NOT do**:
  - Do not add deployment or release automation.
  - Do not create a CI matrix unless an actual version constraint requires it.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: focused workflow/config addition after migration behavior is already locked.
  - Skills: []
  - Omitted: [`obsidian-plugin-docs`] - why not needed: CI is repo infrastructure, not plugin runtime API.

  **Parallelization**: Can Parallel: NO | Wave 4 | Blocks: [] | Blocked By: [1, 3, 4, 5, 6, 7, 8]

  **References**:
  - Pattern: `package.json` - canonical local verification commands.
  - Pattern: `vitest.config.ts` - test config that CI must execute reliably.
  - Pattern: `esbuild.config.mjs` - final build path to validate in CI.

  **Acceptance Criteria**:
  - [ ] `.github/workflows/` contains a workflow that runs the full verification command set on Node 20
  - [ ] `npx svelte-check --tsconfig ./tsconfig.json && npm run check && npm run build && npm test` exits `0` locally
  - [ ] Workflow YAML validates syntactically and references only repo-supported commands

  **QA Scenarios**:
  ```
  Scenario: Local verification mirrors CI exactly
    Tool: Bash
    Steps: Run `npx svelte-check --tsconfig ./tsconfig.json && npm run check && npm run build && npm test`
    Expected: Full verification passes locally with the exact command sequence CI will run
    Evidence: .sisyphus/evidence/task-9-final-local-verification.txt

  Scenario: CI workflow is present and targets the correct runtime
    Tool: Bash
    Steps: Run `grep -R "ubuntu-latest\|node-version: 20\|npx svelte-check --tsconfig ./tsconfig.json\|npm run check\|npm run build\|npm test" .github/workflows`
    Expected: Workflow content includes the required runner, Node version, and full verification command set
    Evidence: .sisyphus/evidence/task-9-ci-workflow.txt
  ```

  **Commit**: YES | Message: `ci: enforce svelte 5 verification suite` | Files: [`.github/workflows/*.yml`, `package.json` if script alignment needed]

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle

  **What to do**:
  - Run an oracle review against `.sisyphus/plans/svelte-5-migration.md` and the implemented branch/worktree.
  - Verify every required deliverable from tasks 1-9 exists and that no required migration step was skipped.
  - Fail if any task acceptance criterion is not evidenced by the implemented changes or verification outputs.

  **Must NOT do**:
  - Do not approve based on partial task completion.
  - Do not ignore missing deliverables because tests happen to pass.

  **QA Scenarios**:
  ```
  Scenario: Implementation matches the approved plan
    Tool: oracle
    Steps: Dispatch the `oracle` review agent against the implemented branch/worktree with the prompt: `Audit the implemented branch/worktree against .sisyphus/plans/svelte-5-migration.md. Verify that each numbered task's deliverables exist, required files were updated, compatibility mode is removed, and final verification commands succeeded. Return APPROVED only if there are no missing planned deliverables or skipped migration steps.`
    Expected: Oracle returns APPROVED or equivalent no-blocker verdict tied to concrete findings from the implemented work
    Evidence: .sisyphus/evidence/f1-plan-compliance.md

  Scenario: Missing deliverables are rejected
    Tool: oracle
    Steps: Dispatch the `oracle` review agent with the prompt: `Perform a strict plan-compliance audit for .sisyphus/plans/svelte-5-migration.md. Explicitly reject if any planned deliverable, acceptance criterion, or compatibility-removal requirement is missing even when build/tests pass.`
    Expected: Oracle either confirms no omissions or returns a blocking list of missing deliverables; silent approval is not allowed
    Evidence: .sisyphus/evidence/f1-plan-compliance-strict.md
  ```

- [x] F2. Code Quality Review — unspecified-high

  **What to do**:
  - Review the changed implementation for maintainability, type safety, cleanup behavior, and Svelte 5 idiom quality.
  - Verify the new panel-model boundary is coherent, typed, and not a disguised `$set` compatibility shim.
  - Fail on dead bridges, unclear ownership, stale abstractions, or AI-slop style overengineering.

  **Must NOT do**:
  - Do not approve code that merely passes tests while preserving hidden legacy facades.
  - Do not allow split state ownership between host and component tree.

  **QA Scenarios**:
  ```
  Scenario: Code quality and migration idioms are acceptable
    Tool: unspecified-high
    Steps: Dispatch an `unspecified-high` review agent with the prompt: `Review the implemented Svelte 5 migration for code quality. Focus on src/view/panel-model.ts, src/view/FolderCardView.ts, src/view/FolderCardPanel.svelte, src/view/Toolbar.svelte, src/view/CardItem.svelte, and related tests/config. Reject hidden legacy facades, weak typing, cleanup leaks, dead compatibility code, and non-idiomatic Svelte 5 patterns.`
    Expected: Reviewer returns APPROVED or equivalent no-blocker verdict with concrete code-quality findings
    Evidence: .sisyphus/evidence/f2-code-quality.md

  Scenario: Hidden compatibility shims are caught
    Tool: Bash
    Steps: Run `! grep -R "\$set(\|\$on(\|\$destroy(" src/view src/__mocks__ && npx svelte-check --tsconfig ./tsconfig.json && npm run check`
    Expected: No hidden legacy instance APIs remain in runtime surfaces and typed verification still passes
    Evidence: .sisyphus/evidence/f2-legacy-shim-audit.txt
  ```

- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)

  **What to do**:
  - Execute the real runtime verification suite introduced by the migration, focusing on user-visible flows and teardown behavior.
  - If execution produces a browser-accessible harness, use Playwright for an additional pass; otherwise use the real Svelte runtime Vitest suite as the authoritative UI/runtime check.
  - Fail on any regression in empty state, card interaction, toolbar interaction, hydrate callbacks, or cleanup behavior.

  **Must NOT do**:
  - Do not treat mock-only tests as UI verification.
  - Do not require human-operated Obsidian manual testing for completion.

  **QA Scenarios**:
  ```
  Scenario: Real runtime UI flows pass end-to-end at test level
    Tool: Bash
    Steps: Run `npx vitest run src/view/CardItem.svelte.test.ts src/view/Toolbar.svelte.test.ts src/view/FolderCardPanel.svelte.test.ts src/view/FolderCardView.test.ts`
    Expected: All real runtime component/host tests pass, covering empty state, rendered list state, card open/pin actions, toolbar callbacks, hydrate callbacks, and teardown paths
    Evidence: .sisyphus/evidence/f3-runtime-qa.txt

  Scenario: Full repo verification still passes after UI/runtime checks
    Tool: Bash
    Steps: Run `npx svelte-check --tsconfig ./tsconfig.json && npm run check && npm run build && npm test`
    Expected: Full verification passes after the runtime-focused test pass, proving no hidden integration regression remains
    Evidence: .sisyphus/evidence/f3-full-verification.txt
  ```

- [x] F4. Scope Fidelity Check — deep

  **What to do**:
  - Review the completed work for scope discipline against the plan’s IN/OUT boundaries.
  - Confirm the migration did not quietly expand into UI redesign, feature work, build-tool replacement, or unrelated refactors.
  - Fail if any out-of-scope work landed without being explicitly required by the Svelte 5 migration.

  **Must NOT do**:
  - Do not approve “nice-to-have” refactors folded into the migration.
  - Do not ignore changed files outside the justified migration/test/CI/build surface.

  **QA Scenarios**:
  ```
  Scenario: Out-of-scope changes are rejected
    Tool: deep
    Steps: Dispatch the `deep` review agent with the prompt: `Audit the implemented branch/worktree for scope fidelity against .sisyphus/plans/svelte-5-migration.md. Reject if the work includes UI redesign, unrelated feature work, unnecessary build-system replacement, or refactors outside the migration/test/CI/build surface justified by the plan.`
    Expected: Reviewer returns APPROVED only if all changes stay within the migration scope and every exception is justified by the plan
    Evidence: .sisyphus/evidence/f4-scope-fidelity.md

  Scenario: Changed-file surface stays aligned to migration scope
    Tool: Bash
    Steps: Run `git status --short && git diff --name-only --cached && git diff --name-only`
    Expected: Reported file paths are explainable by the plan's migration, test, build, mock, and CI tasks; unexplained files cause rejection
    Evidence: .sisyphus/evidence/f4-changed-files.txt
  ```

## Commit Strategy
- Create one commit per numbered task where the task meaningfully changes behavior or verification.
- Preserve bisectability: tests first, then leaf component migrations, then root seam migration, then compatibility removal, then CI.
- Do not squash away the safety-net commits; they are part of migration risk control.

## Success Criteria
- Repo uses standard Svelte 5 patterns across the component tree and host seam with no dependency on `componentApi: 4`.
- Host runtime coordinator remains the source of truth and updates the UI through a typed panel model rather than imperative `$set` calls.
- Real runtime Svelte tests exist for leaf components, root panel, and host seam, closing the previous mock-only coverage gap.
- Full verification (`svelte-check`, type-check, build, test, CI) passes without manual intervention.
