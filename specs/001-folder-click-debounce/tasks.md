---
description: "Task list for implementing same-folder click short-circuit and render dedupe"
---

# Tasks: 同一文件夹重复点击短路与重复渲染防抖

**Input**: Design documents from `C:\Users\kenan.lian\WPSSYNC\700 - Study\obsidian-cards-view-plugin\specs\001-folder-click-debounce\`
**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`, `contracts/folder-click-debounce.openapi.yaml`, `quickstart.md`

**Tests**: No automated test tasks added (feature spec does not request TDD or new automated tests). Validation is through quickstart manual scenarios and required build/type checks.

**Organization**: Tasks are grouped by user story for independent implementation and validation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no unresolved dependencies)
- **[Story]**: User story label (`[US1]`, `[US2]`)
- Each task includes an exact file path

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish typed contracts and baseline validation scaffolding used by all stories.

- [X] T001 Define `FolderSelectionRequest`, `FolderLoadKey`, `FolderLoadSnapshot`, `RefreshQueueState`, and `VaultMutationEvent` interfaces in `src/view/types.ts`
- [X] T002 Add `SelectionResult`, `RefreshResult`, `VaultMutationResult`, and action union types aligned with `specs/001-folder-click-debounce/contracts/folder-click-debounce.openapi.yaml` in `src/view/types.ts`
- [X] T003 [P] Add plugin-level intent sequencing state (`selectionRequestSeq`, `latestHandledRequestId`) in `src/main.ts`
- [X] T004 [P] Add quickstart evidence table for SC-001~SC-004 measurements in `specs/001-folder-click-debounce/quickstart.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build core dedupe and lifecycle infrastructure required before story work.

**⚠️ CRITICAL**: Complete this phase before implementing user stories.

- [X] T005 Implement folder load-key builder/comparator (`folderPath + includeSubfolders + sort`) in `src/view/FolderCardView.ts`
- [X] T006 Implement single-flight queue primitives (`inFlight`, `inFlightKey`, `queuedRequest`, `drainQueuedRequest`) in `src/view/FolderCardView.ts`
- [X] T007 Implement stale-intent guard so only the latest folder click can dispatch after `activateView()` in `src/main.ts`
- [X] T008 [P] Implement view cleanup API to cancel pending debounce/queue/hydration work in `src/view/FolderCardView.ts`
- [X] T009 Implement plugin unload/close cleanup to cancel debounced callbacks and invoke view cleanup in `src/main.ts`

**Checkpoint**: Foundation ready; user story phases can start.

---

## Phase 3: User Story 1 - 避免同目录重复刷新 (Priority: P1) 🎯 MVP

**Goal**: Repeated clicks on the same folder do not trigger redundant refresh/render cycles.

**Independent Test**: With unchanged folder A already visible, click folder A 10 times within 2 seconds and confirm only one effective refresh while cards, scroll position, and selection remain stable.

### Implementation for User Story 1

- [X] T010 [P] [US1] Refactor explorer click handling to create `FolderSelectionRequest` payloads and dispatch them from `src/main.ts`
- [X] T011 [P] [US1] Implement `/view/folder-selection` result resolution (`noop`, `started`, `queued_latest`, `reused_inflight`, `rejected_invalid`) in `src/view/FolderCardView.ts`
- [X] T012 [US1] Update load pipeline to skip destructive state resets (`cards=[]`, `generation++`) on noop in `src/view/FolderCardView.ts`
- [X] T013 [US1] Route `refresh()` through the single-flight selection pipeline with `forceRefresh` semantics in `src/view/FolderCardView.ts`
- [X] T014 [US1] Preserve selected note and UI stability during noop by limiting updates in `setSelectedFile`/`pushState` in `src/view/FolderCardView.ts`
- [ ] T015 [US1] Execute quickstart Scenario A/B and record observed refresh-count evidence in `specs/001-folder-click-debounce/quickstart.md`

**Checkpoint**: User Story 1 is independently functional and manually verifiable.

---

## Phase 4: User Story 2 - 当前目录变更自动更新 (Priority: P2)

**Goal**: Current folder updates automatically when relevant vault mutations occur.

**Independent Test**: While folder A is active, create/modify/delete/rename markdown files under A and verify the card list updates automatically without re-clicking the folder.

### Implementation for User Story 2

- [X] T016 [P] [US2] Normalize vault `create/modify/delete/rename` listeners into `VaultMutationEvent` dispatches in `src/main.ts`
- [X] T017 [P] [US2] Implement vault-mutation classifier (`ignored`, `enqueued`, `deferred_while_inflight`) with folder-scope filtering in `src/view/FolderCardView.ts`
- [X] T018 [US2] Implement current-folder rename reconciliation (`selectedFolderPath` old/new path handling) in `src/main.ts`
- [X] T019 [US2] Implement `/view/refresh` force-refresh entrypoint (`vault-change`, `settings-change`, `manual`) in `src/view/FolderCardView.ts`
- [X] T020 [US2] Update settings-save and debounced refresh path to call the force-refresh entrypoint instead of direct `view.refresh()` in `src/main.ts`
- [ ] T021 [US2] Execute quickstart Scenario C and record time-to-update observations in `specs/001-folder-click-debounce/quickstart.md`

**Checkpoint**: User Story 2 is independently functional and manually verifiable.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Final quality checks across stories.

- [X] T022 [P] Audit performance/privacy/native-feel/modular constraints and record final constitution notes in `specs/001-folder-click-debounce/research.md`
- [ ] T023 Run quickstart Scenario D (lifecycle cleanup) and record no-ghost-refresh evidence in `specs/001-folder-click-debounce/quickstart.md`
- [X] T024 Remove temporary debug counters/log statements introduced during implementation in `src/main.ts` and `src/view/FolderCardView.ts`
- [X] T025 Run `npm run check` and `npm run build`, then log pass results in `specs/001-folder-click-debounce/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: Start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1; blocks all user stories
- **Phase 3 (US1)**: Depends on Phase 2
- **Phase 4 (US2)**: Depends on Phase 2 (can overlap with late US1 polish once queue contracts are stable)
- **Phase 5 (Polish)**: Depends on completion of targeted user stories

### User Story Dependencies

- **US1 (P1)**: No dependency on other stories after Foundational completion
- **US2 (P2)**: No strict functional dependency on US1, but reuses the same queue/refresh primitives from Foundational

### Contract Coverage Mapping

- `/view/folder-selection` -> T010, T011, T012, T014
- `/view/refresh` -> T013, T019, T020
- `/events/vault-mutation` -> T016, T017, T018
- `/lifecycle/unload` -> T008, T009, T023

---

## Parallel Opportunities

- Setup: T003 and T004 can run in parallel
- Foundational: T007 and T008 can run in parallel
- US1: T010 and T011 can run in parallel before T012/T013 integration
- US2: T016 and T017 can run in parallel before T018/T019 integration
- Polish: T022 can run in parallel with T023

---

## Parallel Example: User Story 1

```text
Task T010 [US1] in src/main.ts
Task T011 [US1] in src/view/FolderCardView.ts
```

## Parallel Example: User Story 2

```text
Task T016 [US2] in src/main.ts
Task T017 [US2] in src/view/FolderCardView.ts
```

---

## Implementation Strategy

### MVP First (US1)

1. Complete Phase 1 and Phase 2
2. Deliver Phase 3 (US1) end-to-end
3. Validate Scenario A/B and SC-001/SC-004 evidence
4. Pause for review/demo before US2

### Incremental Delivery

1. Foundation complete
2. Ship US1 (duplicate-click short-circuit + in-flight dedupe)
3. Ship US2 (vault auto-refresh with event filtering)
4. Run polish + required validation commands (`npm run check`, `npm run build`)

### Team Parallelization

1. Developer A: `src/main.ts` flow tasks (T003, T007, T010, T016, T018, T020)
2. Developer B: `src/view/FolderCardView.ts` queue/state tasks (T005, T006, T008, T011, T012, T013, T017, T019)
3. Developer C: validation/docs evidence tasks (`specs/001-folder-click-debounce/quickstart.md`, `specs/001-folder-click-debounce/research.md`)
