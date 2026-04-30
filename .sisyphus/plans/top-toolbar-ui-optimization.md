# Top Toolbar UI Optimization

## TL;DR
> **Summary**: Simplify the top area so scope is expressed only once, summary content appears only when meaningful, search becomes an icon-triggered expandable control, and bulk mode becomes a compact action bar without changing underlying search or bulk-selection runtime behavior.
> **Deliverables**:
> - Toolbar markup update in `src/view/Toolbar.svelte`
> - Toolbar styling update in `styles.css`
> - Toolbar regression test rewrite/extension in `src/view/Toolbar.svelte.test.ts`
> - Conditional host-level regression coverage in `src/view/FolderCardView.test.ts` only if a runtime contract changes
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: 1 → 2 → 3 → 4

## Context
### Original Request
- 顶部范围信息只保留一处：保留文件夹按钮 + 文件夹名称，删除摘要区里的 Scope 文本。
- 摘要区删除 Scope / Tag filter / Status / Subfolders 常驻文本，仅在有 tag 筛选或索引异常/特殊状态时显示。
- 一级按钮结构保持现状：folder / all-notes / new-note / sort / filter / bulk。
- 搜索改成一级按钮触发展开，使用放大镜按钮；展开后显示搜索框，再次点击收起；清空改为 x 图标。
- 状态 badge 只在 `building` / `fallback` / `error` 时显示，`idle` / `ready` 不显示。
- Bulk 区改成紧凑操作条：左侧仅保留 `3 selected`，右侧保留批量动作按钮；删除 Bulk mode / Range anchor / 长提示文案，并收紧 bulk 按钮尺寸。
- `Subfolders` 保留为一级按钮区旁边的小型 toggle/chip，不显示 On / Off，选中态高亮表示包含子文件夹。

### Interview Summary
- 用户确认：搜索收起时保留现有 query 且继续生效。
- 用户确认：点击搜索按钮展开后自动聚焦搜索输入框。
- 用户确认：Bulk 计数文案使用 `3 selected` 风格。
- 规划默认决策：搜索作为新增的第七个一级图标按钮，放在既有六个一级按钮之后；`Subfolders` 作为一级按钮区旁边的独立小 chip，不并入六个固定一级按钮集合。
- 范围边界：只优化顶部信息呈现与交互方式，不重构一级按钮分级，不改变搜索索引/过滤/批量选择的底层行为。

### Metis Review (gaps addressed)
- 将实现范围锁定为 `Toolbar.svelte` / `styles.css` / `Toolbar.svelte.test.ts` 优先，避免 UI 工作外溢到 `FolderCardView.ts` 运行时逻辑。
- 明确 guardrail：隐藏 `idle` / `ready` 状态 badge 仅是渲染变化，不允许改动 `SearchStatus` 生成逻辑。
- 明确 guardrail：移除 bulk anchor/helper 文案，不允许删除 `bulkAnchorPath` 或 range selection 运行时状态。
- 明确 acceptance：搜索展开/收起/清空行为、status 可见性矩阵、bulk strip 文案、Subfolders 文案与高亮态都必须由自动化测试精确验证。

## Work Objectives
### Core Objective
在不改变搜索运行时、bulk selection 运行时、一级按钮主体结构的前提下，完成顶部 toolbar 的信息减法与交互优化，使顶部区域更接近 Obsidian 原生插件的紧凑工具栏体验。

### Deliverables
- `src/view/Toolbar.svelte` 顶部结构重排与条件渲染更新。
- `styles.css` 顶部区域、搜索展开区、compact bulk strip、Subfolders chip 的样式更新。
- `src/view/Toolbar.svelte.test.ts` 覆盖新搜索展开模式、summary/status 显示矩阵、bulk strip 精简结果、Subfolders 文案与按钮结构。
- `src/view/FolderCardView.test.ts` 仅在新增 toolbar 事件或 host contract 变更时补充回归测试。

### Definition of Done (verifiable conditions with commands)
- `npx vitest run src/view/Toolbar.svelte.test.ts` exits `0` and verifies the new toolbar UX contract.
- If runtime contract changes, `npx vitest run src/view/FolderCardView.test.ts` exits `0` and verifies search/bulk ownership semantics remain intact.
- `npm run check` exits `0`.
- `npm run build` exits `0`.
- `npm test` exits `0`.

### Must Have
- Scope appears only once via the folder control and folder name; summary row must not render `Scope:` copy.
- First-row control order is fixed as: `pick-folder` / `all-notes` / `new-note` / `sort` / `filter` / `bulk` / `search-toggle`, followed by the standalone `Subfolders` chip only when folder scope exists.
- Summary row renders only meaningful items: tag filter state when active, and search status badge only for `building` / `fallback` / `error`.
- Search is triggered by a magnifier icon button on the first row, expands below the button row, auto-focuses on open, collapses on second click, preserves active query when collapsed, and clears only through an x icon button with `aria-label="Clear search query"`.
- `Subfolders` remains a compact chip adjacent to the first-row controls, with selected/highlighted state only, no `On` / `Off` copy.
- Bulk strip shows only `N selected` on the left and compact bulk action buttons on the right.
- Existing non-search first-level action IDs and handlers remain unchanged: `pick-folder`, `all-notes`, `new-note`, `sort`, `filter`, `bulk`.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- Must NOT change `FolderCardView.ts` search debounce, search snapshot handling, status generation, or projection logic unless a proven contract gap blocks the toolbar UI.
- Must NOT remove or repurpose `bulkAnchorPath` runtime behavior merely because its helper text disappears from the UI.
- Must NOT introduce persisted `searchExpanded` state into `panel-model.ts` / `types.ts` unless remount persistence is explicitly required.
- Must NOT reintroduce always-visible informational text for Scope / Status / Subfolders in the summary strip.
- Must NOT split the existing six primary actions into a new hierarchy or redesign their semantics.

## Verification Strategy
> ZERO HUMAN INTERVENTION - all verification is agent-executed.
- Test decision: tests-after + Vitest jsdom component regression, with host-view regression only if a runtime contract changes.
- QA policy: Every task below includes agent-executed scenarios with concrete selectors, commands, and evidence paths.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: Task 1 (toolbar behavior map and selector contract), Task 2 (toolbar markup/state refactor), Task 3 (toolbar styles refactor)

Wave 2: Task 4 (toolbar component regression tests), Task 5 (conditional host contract regression + full validation)

### Dependency Matrix (full, all tasks)
- Task 1 blocks Tasks 2-5.
- Task 2 blocks Tasks 3-5.
- Task 3 depends on Task 2 and blocks Task 5.
- Task 4 depends on Task 2 and should land after Task 3 if selectors/classes change.
- Task 5 depends on Tasks 2-4.
- Final verification wave depends on Tasks 1-5.

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 3 tasks → visual-engineering, quick
- Wave 2 → 2 tasks → quick, unspecified-low
- Final verification → 4 parallel review agents

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Refactor first-row toolbar controls and local search-toggle behavior

  **What to do**: Update `src/view/Toolbar.svelte` so the first row order is exactly `pick-folder` → `all-notes` → `new-note` → `sort` → `filter` → `bulk` → `search-toggle`, with `Subfolders` rendered afterward as a separate chip only when `hasFolderScope` is true. The new local search toggle must use a magnifier icon and accessible label `Toggle search`. Implement `searchExpanded` as local toolbar-only UI state. Clicking the search button must expand a dedicated search row below the first row, auto-focus `input[aria-label="Search notes"]`, and close any open folder/sort/filter menu. Clicking the button again must collapse the search row without clearing `searchQuery` and without emitting `onSearchQueryReset`. When `searchQuery.trim().length > 0`, keep the search button in highlighted/selected state even if the search row is collapsed so active filtering remains discoverable. Replace the text clear affordance with an x icon button that keeps `aria-label="Clear search query"`.
  **Must NOT do**: Do not add persisted `searchExpanded` state to `PanelModelState` or `types.ts`. Do not convert the search toggle into a new `onToolbarAction` runtime action. Do not change search debounce, snapshot handling, or `clearSearchQuery()` semantics in `FolderCardView.ts`.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: primary work is toolbar layout/interaction refactor within a Svelte component.
  - Skills: [`frontend-ui-ux`] - improves the Obsidian-style icon-triggered search interaction while preserving native-feeling layout.
  - Omitted: [`review-work`] - reserved for the final verification wave, not for implementation.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [2, 3, 4, 5] | Blocked By: []

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/view/Toolbar.svelte:129-136` - existing six primary actions that must keep IDs and semantics unchanged.
  - Pattern: `src/view/Toolbar.svelte:266-313` - current toolbar action/menu-closing logic to extend for the local search toggle.
  - Pattern: `src/view/Toolbar.svelte:450-477` - current folder text, include-subfolders, search input, and clear-query handlers.
  - Pattern: `src/view/Toolbar.svelte:495-572` - existing first-row toolbar and always-visible search row to replace.
  - API/Type: `src/view/types.ts:8-23` - search ownership contract; toolbar must stay intent-emitter-only.
  - API/Type: `src/view/panel-model.ts:4-31` - current panel state already provides `searchQuery` and `searchStatus`; no `searchExpanded` slot exists.
  - Host wiring: `src/view/FolderCardPanel.svelte:509-537` - current prop/event pass-through, useful to confirm no host changes are required.
  - Test: `src/view/Toolbar.svelte.test.ts:195-252` - current always-visible search assumptions that must be rewritten.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/Toolbar.svelte.test.ts -t "renders search as a toggleable first-row control and autofocuses when expanded"` exits `0`.
  - [ ] `npx vitest run src/view/Toolbar.svelte.test.ts -t "collapses search without clearing an active prop-backed query"` exits `0`.
  - [ ] `npx vitest run src/view/Toolbar.svelte.test.ts -t "keeps the search toggle highlighted when a collapsed query remains active"` exits `0`.
  - [ ] `python - <<'PY'
from pathlib import Path
src = Path('src/view/Toolbar.svelte').read_text()
required = ['action.id === "pick-folder"', 'action.id === "sort"', 'action.id === "filter"', 'aria-label="Toggle search"', 'aria-label="Clear search query"']
assert all(token in src for token in required)
assert 'Clear</button>' not in src
PY` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Search expands from the first row and autofocuses
    Tool: Bash
    Steps: Run `npx vitest run src/view/Toolbar.svelte.test.ts -t "renders search as a toggleable first-row control and autofocuses when expanded"`
    Expected: Exit code 0; test asserts `button[aria-label="Toggle search"]` exists in the first row, click reveals `input[aria-label="Search notes"]`, and `document.activeElement` becomes that input.
    Evidence: .sisyphus/evidence/task-1-search-toggle.txt

  Scenario: Collapsing search preserves the active query and does not emit reset
    Tool: Bash
    Steps: Run `npx vitest run src/view/Toolbar.svelte.test.ts -t "collapses search without clearing an active prop-backed query"`
    Expected: Exit code 0; test asserts second toggle click hides the search row, leaves the prop-backed query value unchanged, and records no `onSearchQueryReset` callback.
    Evidence: .sisyphus/evidence/task-1-search-collapse.txt

  Scenario: Search controls use icon-based affordances instead of legacy text clear UI
    Tool: Bash
    Steps: Run `python - <<'PY'
from pathlib import Path
src = Path('src/view/Toolbar.svelte').read_text()
required = ['aria-label="Toggle search"', 'aria-label="Clear search query"']
assert all(token in src for token in required)
assert 'Clear</button>' not in src
PY`
    Expected: Exit code 0; toolbar source exposes the new search toggle and icon-clear semantics, and no longer contains the legacy text clear button label.
    Evidence: .sisyphus/evidence/task-1-search-icons.txt
  ```

  **Commit**: NO | Message: `refactor(toolbar): add expandable search toggle` | Files: `src/view/Toolbar.svelte`, `src/view/Toolbar.svelte.test.ts`

- [x] 2. Simplify contextual summary and Subfolders chip rendering

  **What to do**: Replace the current always-on summary row with a conditional summary strip that renders only when at least one contextual item exists. Remove `Scope:` output completely. Render tag-filter status only when `activeFilterTags.length > 0`, using compact copy `Tag filter: {N} active`. Render search-status badge only when `searchStatus` is `building`, `fallback`, or `error`, preserving the current compact labels (`Building index`, `Fallback search`, `Search error`). Keep `Subfolders` outside the summary row as a compact chip adjacent to the first-row controls; it must render only when `hasFolderScope` is true, show only the text `Subfolders`, use selected styling when `includeSubfolders` is true, and never render `On` / `Off` copy.
  **Must NOT do**: Do not show summary content for `idle` or `ready`. Do not keep `Subfolders:` summary text as a fallback. Do not show the Subfolders chip in All Notes scope or when no folder scope exists.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: this is conditional rendering and compact-toolbar information architecture work.
  - Skills: [`frontend-ui-ux`] - helps keep the top area minimal and Obsidian-native without over-design.
  - Omitted: [`review-work`] - final review belongs in the dedicated verification wave.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [3, 4, 5] | Blocked By: [1]

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/view/Toolbar.svelte:181-201` - existing `hasFolderScope`, `hasTagFilter`, scope/tag/subfolder summaries, and `searchStatusLabel` derived values to simplify.
  - Pattern: `src/view/Toolbar.svelte:574-597` - current summary row and Subfolders toggle markup to replace.
  - Pattern: `src/view/Toolbar.svelte:76-82` - current exact search-status labels to preserve for exceptional statuses.
  - Style: `styles.css:67-128` - current summary-row and toggle CSS that must be adjusted rather than duplicated.
  - Test: `src/view/Toolbar.svelte.test.ts:218-252` - existing status-label tests that currently expect `idle` and `ready` badges to render.
  - Test: `src/view/Toolbar.svelte.test.ts:274-299` - current include-subfolders interaction expectations and selector usage.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/Toolbar.svelte.test.ts -t "renders contextual summary badges only when filters or exceptional search states are active"` exits `0`.
  - [ ] `npx vitest run src/view/Toolbar.svelte.test.ts -t "renders Subfolders as a chip without on-off copy"` exits `0`.
  - [ ] `python - <<'PY'
from pathlib import Path
src = Path('src/view/Toolbar.svelte').read_text()
assert '<strong>Scope:</strong>' not in src
assert 'Subfolders:' not in src
assert '{includeSubfolders ? "On" : "Off"}' not in src
PY` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Summary appears only for active tags or exceptional search states
    Tool: Bash
    Steps: Run `npx vitest run src/view/Toolbar.svelte.test.ts -t "renders contextual summary badges only when filters or exceptional search states are active"`
    Expected: Exit code 0; test asserts no summary row for idle/ready with no tag filters, asserts `Tag filter: 1 active` when tags exist, and asserts `.fce-search-status[data-search-status="building"|"fallback"|"error"]` only for exceptional states.
    Evidence: .sisyphus/evidence/task-2-contextual-summary.txt

  Scenario: Subfolders chip remains compact and scope-aware
    Tool: Bash
    Steps: Run `npx vitest run src/view/Toolbar.svelte.test.ts -t "renders Subfolders as a chip without on-off copy"`
    Expected: Exit code 0; test asserts `.fce-toolbar-toggle` contains `Subfolders`, omits `On`/`Off`, toggles `aria-pressed`, and is absent in All Notes scope.
    Evidence: .sisyphus/evidence/task-2-subfolders-chip.txt
  ```

  **Commit**: NO | Message: `refactor(toolbar): make summary contextual` | Files: `src/view/Toolbar.svelte`, `src/view/Toolbar.svelte.test.ts`

- [x] 3. Convert the bulk strip and toolbar styling into a compact top-bar layout

  **What to do**: Update `styles.css` and any matching toolbar class structure so the top area supports three clear layers: first-row controls, conditional expandable search row, and conditional contextual summary row. Tighten the bulk strip so the left side renders only the existing `bulkSelectionSummary` (`N selected`) and the right side renders the existing bulk action buttons plus `Exit Bulk`, with smaller visual weight than the primary toolbar icons. Remove pill/helper-specific styles that only supported `Bulk mode`, `Range anchor ready/idle`, and helper prose. Use concrete compact sizing decisions: bulk buttons `padding: 2px 6px`, `font-size: 11px`, `line-height: 1.1`; keep Subfolders chip at `padding: 3px 8px`, `font-size: 12px`.
  **Must NOT do**: Do not alter bulk action IDs, disabled-state booleans, or exit behavior. Do not enlarge the compact bulk buttons beyond the specified sizing. Do not leave orphaned CSS for removed pill/helper elements if those selectors are no longer used.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` - Reason: this task is mostly structural CSS and compact interaction styling.
  - Skills: [`frontend-ui-ux`] - helps keep spacing, hierarchy, and responsive behavior aligned with native sidebar controls.
  - Omitted: [`review-work`] - the final review wave handles quality gates after implementation.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [4, 5] | Blocked By: [2]

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `src/view/Toolbar.svelte:599-629` - current bulk strip markup that includes mode pill, anchor copy, and helper text to remove.
  - Pattern: `src/view/Toolbar.svelte:163-179` - current `bulkSelectionSummary`, helper-derived labels, and bulk action definitions; preserve action IDs and disabled booleans.
  - Style: `styles.css:49-214` - current toolbar, summary, toggle, bulk strip, and bulk button styles to refactor in place.
  - Style: `styles.css:273-305` - folder button sizing that should remain the visual anchor for the first row.
  - Test: `src/view/Toolbar.svelte.test.ts:195-302` - shared toolbar suite that should assert the new compact markup instead of legacy helper copy.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/Toolbar.svelte.test.ts -t "renders a compact bulk strip without legacy helper copy"` exits `0`.
  - [ ] `python - <<'PY'
from pathlib import Path
css = Path('styles.css').read_text()
assert '.fce-toolbar-bulk-mode-pill' not in css
assert '.fce-toolbar-bulk-button' in css
assert 'padding: 2px 6px;' in css
assert 'font-size: 11px;' in css
assert 'line-height: 1.1;' in css
PY` exits `0`.
  - [ ] `python - <<'PY'
from pathlib import Path
src = Path('src/view/Toolbar.svelte').read_text()
for token in ['Bulk mode', 'Range anchor ready', 'Range anchor idle', 'Select notes to enable move']:
    assert token not in src
PY` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Bulk mode renders as a compact action bar
    Tool: Bash
    Steps: Run `npx vitest run src/view/Toolbar.svelte.test.ts -t "renders a compact bulk strip without legacy helper copy"`
    Expected: Exit code 0; test asserts `.fce-toolbar-bulk-strip` contains `3 selected`, includes bulk action buttons, and omits `Bulk mode`, `Range anchor`, and legacy helper sentences.
    Evidence: .sisyphus/evidence/task-3-bulk-strip.txt

  Scenario: Compact bulk button sizing and removed pill styles are enforced in source
    Tool: Bash
    Steps: Run `python - <<'PY'
from pathlib import Path
css = Path('styles.css').read_text()
assert '.fce-toolbar-bulk-mode-pill' not in css
assert '.fce-toolbar-bulk-button' in css
assert 'padding: 2px 6px;' in css
assert 'font-size: 11px;' in css
assert 'line-height: 1.1;' in css
PY`
    Expected: Exit code 0; CSS keeps compact bulk sizing and no longer carries obsolete bulk-mode pill styling.
    Evidence: .sisyphus/evidence/task-3-bulk-css.txt
  ```

  **Commit**: NO | Message: `style(toolbar): compress bulk controls and rows` | Files: `src/view/Toolbar.svelte`, `styles.css`, `src/view/Toolbar.svelte.test.ts`

- [x] 4. Rewrite the toolbar component regression suite for the new DOM contract

  **What to do**: Rewrite `src/view/Toolbar.svelte.test.ts` so it matches the new toolbar contract instead of patching old assumptions. Keep existing filter, sort, folder-selection, and include-subfolders callback coverage, but replace search/status/bulk assertions with the new expandable-search and contextual-summary behavior. Add explicit tests for first-row search toggle order, auto-focus, collapse-without-reset, clear-via-x-button, highlighted search toggle when an active query remains collapsed, exceptional-only search status badges, absence of `Scope:` summary, compact bulk strip content, and Subfolders chip copy/visibility. Use exact selectors and aria-labels in tests so the DOM contract stays stable.
  **Must NOT do**: Do not keep legacy tests that assert an always-visible search input or visible `idle`/`ready` badges. Do not broaden the suite into runtime/search-index tests unless toolbar code truly forces a host contract change.

  **Recommended Agent Profile**:
  - Category: `quick` - Reason: this is a focused test rewrite in a single existing suite.
  - Skills: [] - existing Vitest and jsdom patterns in the repo are sufficient.
  - Omitted: [`frontend-ui-ux`] - no new visual design decisions are needed in the test-only pass.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [5] | Blocked By: [2, 3]

  **References** (executor has NO interview context - be exhaustive):
  - Test scaffold: `src/view/Toolbar.svelte.test.ts:1-172` - existing mount helpers, callback capture, and cleanup utilities to preserve.
  - Legacy search tests: `src/view/Toolbar.svelte.test.ts:195-252` - current expectations that must be replaced, not incrementally extended.
  - Existing folder/sort/filter coverage: `src/view/Toolbar.svelte.test.ts:174-193, 254-302` - keep these behaviors green while updating selectors only if required.
  - Implementation target: `src/view/Toolbar.svelte:495-629` - final DOM contract that tests must encode.
  - Status labels: `src/view/Toolbar.svelte:76-82` - preserve exact exceptional labels.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx vitest run src/view/Toolbar.svelte.test.ts` exits `0`.
  - [ ] The suite includes explicit tests named exactly:
    - `renders search as a toggleable first-row control and autofocuses when expanded`
    - `collapses search without clearing an active prop-backed query`
    - `keeps the search toggle highlighted when a collapsed query remains active`
    - `renders contextual summary badges only when filters or exceptional search states are active`
    - `renders a compact bulk strip without legacy helper copy`
    - `renders Subfolders as a chip without on-off copy`
  - [ ] `python - <<'PY'
from pathlib import Path
src = Path('src/view/Toolbar.svelte.test.ts').read_text()
names = [
    'renders search as a toggleable first-row control and autofocuses when expanded',
    'collapses search without clearing an active prop-backed query',
    'keeps the search toggle highlighted when a collapsed query remains active',
    'renders contextual summary badges only when filters or exceptional search states are active',
    'renders a compact bulk strip without legacy helper copy',
    'renders Subfolders as a chip without on-off copy',
]
assert all(name in src for name in names)
PY` exits `0`.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Full toolbar component suite passes with the new contract
    Tool: Bash
    Steps: Run `npx vitest run src/view/Toolbar.svelte.test.ts`
    Expected: Exit code 0; suite covers updated search, contextual summary, bulk strip, and Subfolders chip behavior without legacy always-visible-search assumptions.
    Evidence: .sisyphus/evidence/task-4-toolbar-suite.txt

  Scenario: Required regression test names exist in source
    Tool: Bash
    Steps: Run `python - <<'PY'
from pathlib import Path
src = Path('src/view/Toolbar.svelte.test.ts').read_text()
names = [
    'renders search as a toggleable first-row control and autofocuses when expanded',
    'collapses search without clearing an active prop-backed query',
    'keeps the search toggle highlighted when a collapsed query remains active',
    'renders contextual summary badges only when filters or exceptional search states are active',
    'renders a compact bulk strip without legacy helper copy',
    'renders Subfolders as a chip without on-off copy',
]
assert all(name in src for name in names)
PY`
    Expected: Exit code 0; the suite explicitly documents every new toolbar behavior in stable, searchable test names.
    Evidence: .sisyphus/evidence/task-4-toolbar-test-names.txt
  ```

  **Commit**: NO | Message: `test(toolbar): codify simplified header contract` | Files: `src/view/Toolbar.svelte.test.ts`

- [x] 5. Run conditional host-contract regression and complete repo validation

  **What to do**: Inspect the actual implementation diff. If `src/view/FolderCardView.ts`, `src/view/FolderCardPanel.svelte`, `src/view/panel-model.ts`, or `src/view/types.ts` changed, add/adjust `src/view/FolderCardView.test.ts` assertions to prove search ownership, `resetSearchQuery()`, and search-status generation still behave the same after the toolbar UI refactor. Regardless of whether host files changed, run the required validation commands `npm run check`, `npm run build`, and `npm test`. If no runtime contract files changed, skip editing `FolderCardView.test.ts` and document that the toolbar refactor remained presentation-only.
  **Must NOT do**: Do not fabricate host-level tests if no runtime file changed. Do not accept green toolbar tests as sufficient without running repo-wide validation. Do not merge if `npm run check`, `npm run build`, or `npm test` fails.

  **Recommended Agent Profile**:
  - Category: `unspecified-low` - Reason: conditional follow-up across a small set of files plus full validation commands.
  - Skills: [] - standard repo validation and targeted host-regression patterns are sufficient.
  - Omitted: [`frontend-ui-ux`] - this task is runtime regression and validation, not UI design.

  **Parallelization**: Can Parallel: NO | Wave 2 | Blocks: [F1, F2, F3, F4] | Blocked By: [1, 2, 3, 4]

  **References** (executor has NO interview context - be exhaustive):
  - Host state contract: `src/view/FolderCardView.ts:2168-2244` - current panel-state projection and search/bulk runtime fields.
  - Search ownership contract: `src/view/types.ts:8-23` - runtime ownership boundaries that must remain intact.
  - Prop pass-through: `src/view/FolderCardPanel.svelte:509-537` - confirms whether any host-prop signature changed.
  - Existing host regression: `src/view/FolderCardView.test.ts:390-439` - search debounce/reset/status behavior that must remain unchanged.
  - Existing host regression: `src/view/FolderCardView.test.ts:441-525` - snapshot transition/building-status behavior that must remain unchanged.
  - Validation commands: `package.json:6-14` - canonical `check`, `build`, `test`, and component-test scripts.

  **Acceptance Criteria** (agent-executable only):
  - [ ] If any host contract file changed, `npx vitest run src/view/FolderCardView.test.ts` exits `0`.
  - [ ] `npm run check` exits `0`.
  - [ ] `npm run build` exits `0`.
  - [ ] `npm test` exits `0`.
  - [ ] If no host contract file changed, `git diff --name-only -- src/view/FolderCardView.ts src/view/FolderCardPanel.svelte src/view/panel-model.ts src/view/types.ts` returns no paths.

  **QA Scenarios** (MANDATORY - task incomplete without these):
  ```
  Scenario: Host contract remains valid when runtime files changed
    Tool: Bash
    Steps: If any of `src/view/FolderCardView.ts`, `src/view/FolderCardPanel.svelte`, `src/view/panel-model.ts`, or `src/view/types.ts` changed, run `npx vitest run src/view/FolderCardView.test.ts`
    Expected: Exit code 0; search debounce, reset, and `building` snapshot handling remain unchanged from the existing host contract.
    Evidence: .sisyphus/evidence/task-5-host-regression.txt

  Scenario: Full repository validation passes after toolbar refactor
    Tool: Bash
    Steps: Run `npm run check && npm run build && npm test`
    Expected: Exit code 0; TypeScript, bundle build, and full Vitest suite all pass with the new toolbar UX.
    Evidence: .sisyphus/evidence/task-5-full-validation.txt
  ```

  **Commit**: YES | Message: `refactor(toolbar): simplify top controls and contextual status` | Files: `src/view/Toolbar.svelte`, `styles.css`, `src/view/Toolbar.svelte.test.ts`, `src/view/FolderCardView.test.ts` (only if changed), `src/view/FolderCardView.ts`/`src/view/FolderCardPanel.svelte`/`src/view/panel-model.ts`/`src/view/types.ts` (only if changed)

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [x] F1. Plan Compliance Audit — oracle
- [x] F2. Code Quality Review — unspecified-high
- [x] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check — deep

## Commit Strategy
- Prefer one implementation commit after Tasks 1-5 are complete and all validations pass.
- Recommended commit message: `refactor(toolbar): simplify top controls and contextual status`
- Do not create intermediate commits before the regression suite is green.

## Success Criteria
- Top toolbar no longer duplicates scope information.
- Summary row is contextual instead of always-on.
- Search interaction matches the decided expand/collapse behavior and is fully test-covered.
- Bulk strip reads as a compact action bar rather than an instructional banner.
- Validation commands pass without changing unrelated runtime behavior.
