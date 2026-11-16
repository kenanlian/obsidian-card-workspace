import { describe, expect, it, vi } from "vitest";
import { DEFAULT_GROUP_SPEC } from "../../card-grouping-settings";
import { DEFAULT_SETTINGS, mergeSettings, type PartialPluginSettings, type PluginSettings } from "../../settings";
import { GroupCollapseController, taskGroupCollapseSpec } from "../controllers/GroupCollapseController";
import { createBoxScope, createFolderScope, createLinksScope, type CardScope } from "../scope";
import { createStreamBrowseState } from "../stream-browse-state";
import { resolveSourceCapabilities } from "../source-capabilities";
import type { CardBoxDefinition, NoteCardRecord } from "../types";
import { createViewEpochs } from "../view-epochs";
import { createViewStateStore } from "../view-state-store";
import { ArrangementActions, type ArrangementActionsDeps } from "./arrangement-actions";

function makeCard(path: string, title: string, mtime = 1): NoteCardRecord {
  return {
    file: { path, basename: title } as never,
    fileKind: "markdown",
    path,
    title,
    ctime: 1,
    mtime,
    excerpt: "",
    previewHtml: "",
    previewMode: "empty",
    hydrated: false,
    taskSummary: null,
  };
}

describe("independent links arrangement", () => {
  it("writes only the current links direction and retains global sort, pins and grouping", async () => {
    const h = createHarness({ scope: createLinksScope("source.md", "backlinks") });
    const previous = h.getSettings();
    await h.actions.onSortChange({ field: "name", direction: "asc" });
    const next = h.getSettings();
    expect(next.linksSort.backlinks).toEqual({ field: "name", direction: "asc" });
    expect(next.linksSort.outgoing).toEqual(previous.linksSort.outgoing);
    expect(next.sort).toEqual(previous.sort);
    expect(next.pinnedPaths).toEqual(previous.pinnedPaths);
    expect(next.group).toEqual(previous.group);
    h.store.setScope(createLinksScope("source.md", "outgoing"));
    await h.actions.onSortChange({ field: "reference-count", direction: "asc" });
    expect(h.getSettings().linksSort.backlinks).toEqual(next.linksSort.backlinks);
    expect(h.getSettings().linksSort.outgoing).toEqual({ field: "reference-count", direction: "asc" });
  });
});

function makeBox(overrides: Partial<CardBoxDefinition> = {}): CardBoxDefinition {
  return {
    id: "box-1",
    name: "Box",
    rules: [],
    manualPaths: [],
    excludedPaths: [],
    pinnedPaths: [],
    sort: { field: "mtime", direction: "desc" },
    group: { ...DEFAULT_GROUP_SPEC },
    ...overrides,
  };
}

function createHarness(options: {
  scope?: CardScope;
  settings?: Partial<PluginSettings>;
  box?: CardBoxDefinition | null;
  cards?: NoteCardRecord[];
} = {}) {
  const scope = options.scope ?? createFolderScope("notes", true);
  let settings = mergeSettings(DEFAULT_SETTINGS, options.settings ?? {});
  let box = options.box === undefined
    ? (scope.kind === "box" ? makeBox({ id: scope.boxId }) : null)
    : options.box;
  if (box && !settings.boxes.some((entry) => entry.id === box!.id)) {
    settings = mergeSettings(settings, { boxes: [box, ...settings.boxes] });
  }

  const store = createViewStateStore(scope);
  store.replaceBaseCards(options.cards ?? []);
  const groupCollapse = new GroupCollapseController();
  const calls: string[] = [];
  const originalReplace = store.replaceBaseCards.bind(store);
  store.replaceBaseCards = (cards) => {
    calls.push("base-sort");
    originalReplace(cards);
  };

  const saveSettings = vi.fn(async (patch: PartialPluginSettings) => {
    settings = mergeSettings(settings, patch);
    if (box && patch.boxes) {
      box = patch.boxes.find((entry) => entry.id === box!.id) ?? box;
    }
  });
  const updateActiveBox = vi.fn(async (mutate: (current: CardBoxDefinition) => CardBoxDefinition) => {
    if (!box) {
      return;
    }
    box = mutate(box);
    settings = mergeSettings(settings, {
      boxes: settings.boxes.map((entry) => (entry.id === box!.id ? box! : entry)),
    });
  });
  const refreshLoadKeyForCurrentScope = vi.fn(() => {
    calls.push("load-key");
  });
  const reprojectCards = vi.fn(() => {
    calls.push("projection");
  });
  const reconcileToVisibleCards = vi.fn(() => {
    calls.push("bulk");
  });
  const publishGroups = vi.fn();
  const getGroupSegmentKeys = vi.fn((): readonly string[] => ["folder:notes", "folder:archive"]);
  const requestUpdate = vi.fn(async () => {
    calls.push("reload");
  });
  const exitBulkMode = vi.fn(() => true);
  const returnToStreamIfSinglePane = vi.fn();

  const deps: ArrangementActionsDeps = {
    context: {
      getApp: () => ({}) as never,
      store,
      epochs: createViewEpochs(),
      getSettings: () => settings,
      saveSettings,
      getUiStrings: () => ({}) as never,
      publishGroups,
      requestUpdate,
      notify: () => undefined,
      getViewWindow: () => ({ setTimeout, clearTimeout }),
    },
    saveSettings,
    getActiveBox: () => box,
    updateActiveBox,
    resolveCapabilities: () => resolveSourceCapabilities(store.getScope()),
    publishGroups,
    refreshLoadKeyForCurrentScope,
    reprojectCards,
    reconcileToVisibleCards,
    groupCollapse,
    getGroupSegmentKeys,
    exitBulkMode,
    returnToStreamIfSinglePane,
  };

  return {
    actions: new ArrangementActions(deps),
    context: deps.context,
    store,
    getSettings: () => settings,
    getBox: () => box,
    groupCollapse,
    saveSettings,
    updateActiveBox,
    refreshLoadKeyForCurrentScope,
    reprojectCards,
    reconcileToVisibleCards,
    publishGroups,
    requestUpdate,
    getGroupSegmentKeys,
    exitBulkMode,
    returnToStreamIfSinglePane,
    calls,
  };
}

describe("ArrangementActions", () => {
  it("writes global sort and does not call the Box updater", async () => {
    const harness = createHarness();

    await harness.actions.onSortChange({ field: "name", direction: "asc" });

    expect(harness.saveSettings).toHaveBeenCalledWith({
      sort: { field: "name", direction: "asc" },
    });
    expect(harness.updateActiveBox).not.toHaveBeenCalled();
    expect(harness.calls).toEqual([]);
  });

  it("writes Box-local sort then runs the atomic reorder seam", async () => {
    const zeta = makeCard("notes/zeta.md", "Zeta", 20);
    const alpha = makeCard("notes/alpha.md", "Alpha", 10);
    const harness = createHarness({
      scope: createBoxScope("box-1"),
      cards: [zeta, alpha],
    });

    await harness.actions.onSortChange({ field: "name", direction: "asc" });

    expect(harness.updateActiveBox).toHaveBeenCalledTimes(1);
    expect(harness.getBox()?.sort).toEqual({ field: "name", direction: "asc" });
    expect(harness.saveSettings).not.toHaveBeenCalled();
    expect(harness.store.getBaseCards().map((card) => card.title)).toEqual(["Alpha", "Zeta"]);
    expect(harness.calls).toEqual(["base-sort", "load-key", "projection", "bulk"]);
  });

  it("sortAndReprojectCards uses exact call order base sort -> load-key -> projection -> bulk", () => {
    const harness = createHarness({
      cards: [makeCard("notes/zeta.md", "Zeta", 20), makeCard("notes/alpha.md", "Alpha", 10)],
      settings: { sort: { field: "name", direction: "asc" } },
    });

    harness.actions.sortAndReprojectCards();

    expect(harness.calls).toEqual(["base-sort", "load-key", "projection", "bulk"]);
    expect(harness.refreshLoadKeyForCurrentScope).toHaveBeenCalledTimes(1);
    expect(harness.reprojectCards).toHaveBeenCalledTimes(1);
    expect(harness.reconcileToVisibleCards).toHaveBeenCalledTimes(1);
    expect(harness.store.getBaseCards().map((card) => card.path)).toEqual([
      "notes/alpha.md",
      "notes/zeta.md",
    ]);
  });

  it("saves grain-only changes, rejects invalid grains, and keeps box settings local", async () => {
    const global = createHarness();
    await global.actions.onGroupChange({ dimension: "mtime", timeGranularity: "week" });
    await global.actions.onGroupChange({ timeGranularity: "month" });
    expect(global.getSettings().group).toMatchObject({ dimension: "mtime", timeGranularity: "month" });
    await global.actions.onGroupChange({ timeGranularity: "invalid" });
    expect(global.saveSettings).toHaveBeenCalledTimes(2);
    const box = createHarness({ scope: createBoxScope("box-1") });
    await box.actions.onGroupChange({ dimension: "ctime", timeGranularity: "biweek" });
    expect(box.getBox()?.group).toMatchObject({ dimension: "ctime", timeGranularity: "biweek" });
    expect(box.getSettings().group.dimension).toBe("none");
    expect(box.requestUpdate).not.toHaveBeenCalled();
  });

  it("writes global group and Box-local group independently", async () => {
    const globalHarness = createHarness();
    await globalHarness.actions.onGroupChange({ dimension: "folder" });
    expect(globalHarness.saveSettings).toHaveBeenCalledWith({
      group: { dimension: "folder", orderBy: "default", orderDirection: "asc" },
    });
    expect(globalHarness.updateActiveBox).not.toHaveBeenCalled();

    const boxHarness = createHarness({ scope: createBoxScope("box-1") });
    await boxHarness.actions.onGroupChange({ dimension: "tag" });
    expect(boxHarness.updateActiveBox).toHaveBeenCalledTimes(1);
    expect(boxHarness.getBox()?.group.dimension).toBe("tag");
    expect(boxHarness.saveSettings).not.toHaveBeenCalled();
    expect(boxHarness.calls).toEqual(["base-sort", "load-key", "projection", "bulk"]);
  });

  it("accepts only visible normalized property keys and keeps box grouping local", async () => {
    const settings = { visiblePropertyKeys: ["status"] };
    const global = createHarness({ settings });
    await global.actions.onGroupChange({ dimension: "property", propertyKey: " Status " });
    expect(global.getSettings().group).toMatchObject({ dimension: "property", propertyKey: "status" });
    await global.actions.onGroupChange({ dimension: "property", propertyKey: "hidden" });
    expect(global.saveSettings).toHaveBeenCalledTimes(1);

    const box = createHarness({ scope: createBoxScope("box-1"), settings });
    await box.actions.onGroupChange({ dimension: "property", propertyKey: "status" });
    expect(box.getBox()?.group).toMatchObject({ dimension: "property", propertyKey: "status" });
    expect(box.getSettings().group.dimension).toBe("none");
  });

  it("V29 takes the reload route instead of the reproject seam when a Box moves into task", async () => {
    const harness = createHarness({
      scope: createBoxScope("box-1"),
      box: makeBox({ id: "box-1", group: { dimension: "none", orderBy: "default", orderDirection: "asc" } }),
    });

    await harness.actions.onGroupChange({ dimension: "task" });

    expect(harness.getBox()?.group.dimension).toBe("task");
    expect(harness.requestUpdate).toHaveBeenCalledWith("reload", "settings-change");
    expect(harness.reprojectCards).not.toHaveBeenCalled();
    expect(harness.calls).toEqual(["reload"]);
  });

  it("V29 keeps the reproject seam when a Box moves out of task or between other dimensions", async () => {
    const leaving = createHarness({
      scope: createBoxScope("box-1"),
      box: makeBox({ id: "box-1", group: { dimension: "task", orderBy: "default", orderDirection: "asc" } }),
    });
    await leaving.actions.onGroupChange({ dimension: "folder" });
    expect(leaving.requestUpdate).not.toHaveBeenCalled();
    expect(leaving.calls).toEqual(["base-sort", "load-key", "projection", "bulk"]);

    const reordering = createHarness({
      scope: createBoxScope("box-1"),
      box: makeBox({ id: "box-1", group: { dimension: "task", orderBy: "default", orderDirection: "asc" } }),
    });
    await reordering.actions.onGroupChange({ dimension: "task", orderBy: "count" });
    expect(reordering.requestUpdate).not.toHaveBeenCalled();
    expect(reordering.calls).toEqual(["base-sort", "load-key", "projection", "bulk"]);
  });

  it("V29 leaves the global task transition to the settings intent, not the seam", async () => {
    const harness = createHarness();

    await harness.actions.onGroupChange({ dimension: "task" });

    expect(harness.saveSettings).toHaveBeenCalledWith({
      group: { dimension: "task", orderBy: "default", orderDirection: "asc" },
    });
    expect(harness.requestUpdate).not.toHaveBeenCalled();
    expect(harness.calls).toEqual([]);
  });

  it("writes global pins and Box-local pins without auto-resorting Box pins", async () => {
    const globalHarness = createHarness();
    await globalHarness.actions.onPinToggle({ path: "notes/a.md", pinned: true });
    expect(globalHarness.saveSettings).toHaveBeenCalledWith({ pinnedPaths: ["notes/a.md"] });
    expect(globalHarness.updateActiveBox).not.toHaveBeenCalled();

    const boxHarness = createHarness({ scope: createBoxScope("box-1") });
    await boxHarness.actions.onPinToggle({ path: "notes/a.md", pinned: true });
    expect(boxHarness.updateActiveBox).toHaveBeenCalledTimes(1);
    expect(boxHarness.getBox()?.pinnedPaths).toEqual(["notes/a.md"]);
    expect(boxHarness.saveSettings).not.toHaveBeenCalled();
    expect(boxHarness.getSettings().pinnedPaths).toEqual([]);
    expect(boxHarness.calls).toEqual([]);
  });

  it("keeps collapse runtime-only: no settings write, then reproject + bulk + cards/bulk publish", () => {
    const harness = createHarness();

    harness.actions.onGroupCollapseCommand({ command: "toggle", key: "folder:notes" });

    expect(harness.saveSettings).not.toHaveBeenCalled();
    expect(harness.updateActiveBox).not.toHaveBeenCalled();
    expect(harness.groupCollapse.getCollapsedKeys(createFolderScope("notes", true), "none").has("folder:notes"))
      .toBe(true);
    expect(harness.calls).toEqual(["projection", "bulk"]);
    expect(harness.publishGroups).toHaveBeenCalledWith("cards", "bulk");
  });

  it("treats invalid and semantic no-op payloads as no-ops", async () => {
    const harness = createHarness({
      settings: { sort: { field: "mtime", direction: "desc" }, pinnedPaths: ["notes/a.md"] },
    });

    await harness.actions.onSortChange({ field: "mtime", direction: "desc" });
    await harness.actions.onSortChange({});
    await harness.actions.onGroupChange({ dimension: "none" });
    await harness.actions.onGroupChange({ dimension: "not-a-dimension" });
    await harness.actions.onPinToggle({ path: "notes/a.md", pinned: true });
    await harness.actions.onPinToggle({ path: "", pinned: true });
    await harness.actions.onPinToggle({ pinned: true });
    harness.actions.onGroupCollapseCommand({ command: "toggle" });
    harness.actions.onGroupCollapseCommand({ command: "toggle", key: "" });
    harness.actions.onGroupCollapseCommand({ command: "unknown" });

    expect(harness.saveSettings).not.toHaveBeenCalled();
    expect(harness.updateActiveBox).not.toHaveBeenCalled();
    expect(harness.publishGroups).not.toHaveBeenCalled();
    expect(harness.calls).toEqual([]);
  });

  it("falls back to global arrangement when the Box definition is missing", async () => {
    const harness = createHarness({
      scope: createBoxScope("ghost"),
      box: null,
      settings: { boxes: [] },
    });

    await harness.actions.onSortChange({ field: "name", direction: "asc" });

    expect(harness.saveSettings).toHaveBeenCalledWith({
      sort: { field: "name", direction: "asc" },
    });
    expect(harness.updateActiveBox).not.toHaveBeenCalled();
  });
});

describe("touch pinned ordering", () => {
  it("moves pins with the active scope owner and preserves filter membership rules", async () => {
    const h = createHarness();
    await h.actions.onPinToggle({ path: "a.md", pinned: true });
    await h.actions.onPinToggle({ path: "b.md", pinned: true });
    await h.actions.movePinnedCard("b.md", -1);
    expect(h.getSettings().pinnedPaths).toEqual(["b.md", "a.md"]);
    await h.actions.movePinnedCard("b.md", -1);
    expect(h.getSettings().pinnedPaths).toEqual(["b.md", "a.md"]);
    const box = makeBox({ pinnedPaths: ["a.md", "b.md"] });
    const scoped = createHarness({ scope: createBoxScope(box.id), box });
    await scoped.actions.movePinnedCard("a.md", 1);
    expect(scoped.getSettings().boxes[0].pinnedPaths).toEqual(["b.md", "a.md"]);
    expect(scoped.getSettings().pinnedPaths).toEqual(DEFAULT_SETTINGS.pinnedPaths);
  });
});

describe("task view arrangement", () => {
  it("writes the global view mode for folders and exits bulk mode when entering tasks", async () => {
    const h = createHarness();
    await h.actions.setViewMode("tasks");
    expect(h.getSettings().defaultView).toBe("tasks");
    expect(h.exitBulkMode).toHaveBeenCalledTimes(1);
    expect(h.updateActiveBox).not.toHaveBeenCalled();

    await h.actions.toggleViewMode();
    expect(h.getSettings().defaultView).toBe("cards");
    expect(h.exitBulkMode).toHaveBeenCalledTimes(1);
  });

  it("skips a write when the mode is unchanged", async () => {
    const h = createHarness({ settings: { defaultView: "tasks" } });
    await h.actions.setViewMode("tasks");
    await h.actions.onViewModeChange({ mode: "bogus" });
    expect(h.saveSettings).not.toHaveBeenCalled();
    expect(h.exitBulkMode).not.toHaveBeenCalled();
  });

  it.each([createBoxScope("box-1"), createLinksScope("source.md", "backlinks"), createLinksScope("source.md", "outgoing")])("writes global mode from %j", async (scope) => {
    const h = createHarness({ scope });
    await h.actions.onViewModeChange({ mode: "tasks" });
    expect(h.getSettings().defaultView).toBe("tasks");
    expect(h.updateActiveBox).not.toHaveBeenCalled();
  });

  it("writes global task sort and group for folders, keeping unrecognized fields", async () => {
    const h = createHarness();
    await h.actions.onTaskSortChange({ field: "due", direction: "sideways" });
    expect(h.getSettings().taskSort).toEqual({ field: "due", direction: DEFAULT_SETTINGS.taskSort.direction });
    await h.actions.onTaskSortChange({ direction: "desc" });
    expect(h.getSettings().taskSort).toEqual({ field: "due", direction: "desc" });

    await h.actions.onTaskGroupChange({ dimension: "done", timeGranularity: "month" });
    expect(h.getSettings().taskGroup).toEqual({ dimension: "done", timeGranularity: "month" });
    await h.actions.onTaskGroupChange({ dimension: "nope" });
    expect(h.getSettings().taskGroup).toEqual({ dimension: "done", timeGranularity: "month" });
    expect(h.updateActiveBox).not.toHaveBeenCalled();
  });

  it("writes box task sort and group to the active box only", async () => {
    const h = createHarness({ scope: createBoxScope("box-1") });
    const globalSort = h.getSettings().taskSort;
    await h.actions.setTaskSort({ field: "text", direction: "asc" });
    await h.actions.setTaskGroup({ dimension: "file" });
    expect(h.getBox()).toMatchObject({ taskSort: { field: "text", direction: "asc" }, taskGroup: { dimension: "file" } });
    expect(h.getSettings().taskSort).toEqual(globalSort);
    expect(h.saveSettings).not.toHaveBeenCalled();

    h.updateActiveBox.mockClear();
    await h.actions.setTaskGroup({ dimension: "file" });
    expect(h.updateActiveBox).not.toHaveBeenCalled();
  });

  it("routes collapse commands to the task namespace in task mode", () => {
    const h = createHarness({ settings: { defaultView: "tasks", taskGroup: { dimension: "status" } } });
    h.actions.onGroupCollapseCommand({ command: "toggle", key: "task-status:open" });
    const scope = h.store.getScope();
    expect([...h.groupCollapse.getCollapsedKeys(scope, taskGroupCollapseSpec({ dimension: "status" }))]).toEqual(["task-status:open"]);
    expect(h.groupCollapse.getCollapsedKeys(scope, h.getSettings().group).size).toBe(0);
  });
});

it("returns from navigation before persistence finishes", async () => {
  const h = createHarness();
  let finish!: () => void;
  h.saveSettings.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = h.actions.setViewMode("tasks");
  expect(h.returnToStreamIfSinglePane).toHaveBeenCalledOnce();
  finish();
  await pending;
});


describe("desktop stream arrangement ownership", () => {
  it.each([createFolderScope("notes", true), createBoxScope("box-1"), createLinksScope("source.md", "outgoing")])(
    "keeps sort, group, mode, task sort and task group local for %j while pins remain shared", async (scope) => {
      const first = createHarness({ scope });
      const second = createHarness({ scope });
      for (const harness of [first, second]) {
        let state = createStreamBrowseState(scope, harness.getSettings());
        harness.context.browse = {
          get: () => state,
          update: (patch) => { state = { ...state, ...patch }; },
          reset: (next) => { state = { ...createStreamBrowseState(next, harness.getSettings()), filter: state.filter }; },
        };
      }
      const sibling = second.context.browse!.get();
      await first.actions.onSortChange({ field: "name", direction: "asc" });
      await first.actions.onGroupChange({ dimension: "tag" });
      await first.actions.setViewMode("tasks");
      await first.actions.setTaskSort({ field: "due", direction: "asc" });
      await first.actions.setTaskGroup({ dimension: "due" });
      expect(first.context.browse!.get()).toMatchObject({
        sort: { field: "name", direction: "asc" }, group: { dimension: "tag" },
        viewMode: "tasks", taskSort: { field: "due", direction: "asc" }, taskGroup: { dimension: "due" },
      });
      expect(second.context.browse!.get()).toEqual(sibling);
      expect(first.saveSettings).not.toHaveBeenCalled();
      expect(first.updateActiveBox).not.toHaveBeenCalled();
      expect(first.requestUpdate).toHaveBeenCalledWith("reproject", "settings-change");
      await first.actions.onPinToggle({ path: "pin.md", pinned: true });
      if (scope.kind === "box") expect(first.updateActiveBox).toHaveBeenCalledTimes(1);
      else expect(first.saveSettings).toHaveBeenCalledWith({ pinnedPaths: ["pin.md"] });
    },
  );

  it("retains the task-group reload requirement in a local stream", async () => {
    const h = createHarness();
    let state = createStreamBrowseState(h.store.getScope(), h.getSettings());
    h.context.browse = { get: () => state, update: patch => { state = { ...state, ...patch }; }, reset: vi.fn() };
    await h.actions.onGroupChange({ dimension: "task" });
    expect(h.requestUpdate).toHaveBeenCalledWith("reload", "settings-change");
    expect(h.saveSettings).not.toHaveBeenCalled();
  });
});
