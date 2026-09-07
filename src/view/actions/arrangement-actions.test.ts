import { describe, expect, it, vi } from "vitest";
import { DEFAULT_GROUP_SPEC } from "../../card-grouping-settings";
import { DEFAULT_SETTINGS, mergeSettings, type PartialPluginSettings, type PluginSettings } from "../../settings";
import { GroupCollapseController } from "../controllers/GroupCollapseController";
import { createBoxScope, createFolderScope, type CardScope } from "../scope";
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

  const deps: ArrangementActionsDeps = {
    context: {
      getApp: () => ({}) as never,
      store,
      epochs: createViewEpochs(),
      getSettings: () => settings,
      saveSettings,
      getUiStrings: () => ({}) as never,
      publishGroups,
      requestUpdate: async () => undefined,
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
  };

  return {
    actions: new ArrangementActions(deps),
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
    getGroupSegmentKeys,
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
