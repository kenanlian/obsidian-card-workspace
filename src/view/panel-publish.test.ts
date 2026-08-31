import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  ItemView: class {
    app: unknown;
    leaf: unknown;
    containerEl = { children: [] };

    constructor(leaf: { app: unknown }) {
      this.leaf = leaf;
      this.app = leaf.app;
    }
  },
  FuzzySuggestModal: class {},
  Menu: class {},
  Modal: class {},
  Notice: class {},
  Setting: class {},
  TFile: class {},
  TFolder: class {},
  getAllTags: () => [],
  normalizePath: (path: string) => path,
  setIcon: () => undefined,
  setTooltip: () => undefined,
}));

import { getUiStrings } from "../i18n";
import { DEFAULT_GROUP_SPEC } from "../card-grouping-settings";
import { DEFAULT_SETTINGS, normalizeSettings } from "../settings";
import { createPanelModel, PANEL_GROUPS, type PanelGroup, type PanelModelState } from "./panel-model";
import { FolderCardView } from "./FolderCardView";
import { createBoxScope, createFolderScope } from "./scope";
import { createViewEpochs } from "./view-epochs";
import { createViewStateStore } from "./view-state-store";
import type { NoteCardRecord } from "./types";

function createCard(path: string): NoteCardRecord {
  return {
    file: {} as never,
    fileKind: "markdown",
    path,
    title: path,
    ctime: 1,
    mtime: 2,
    excerpt: "",
    previewHtml: "",
    previewMode: "empty",
    hydrated: false,
    taskSummary: null,
  };
}

function buildState(): PanelModelState {
  return {
    strings: getUiStrings("en"),
    scope: {
      displayPath: "/",
      includeSubfolders: true,
      activeBoxId: null,
      activeBoxName: null,
      boxExcludedCount: 0,
      emptyStateMessage: "Empty",
    },
    cards: {
      records: [],
      searchMatchCountsByPath: {},
      selectedPath: null,
      loading: false,
      generation: 0,
      sequenceRevision: 0,
      hydrationRevision: 0,
      groupSegments: [],
      groupRevision: 0,
    },
    search: { query: "", status: "idle", focusToken: 0 },
    projection: {
      sortField: "mtime",
      sortDirection: "desc",
      availableTags: [],
      tagCounts: {},
      activeFilterTags: [],
      pinnedPaths: [],
      group: { ...DEFAULT_GROUP_SPEC },
      availableGroupDimensions: ["none", "folder", "tag", "task"],
      groupSegmentCount: 0,
    },
    bulk: {
      bulkMode: false,
      selectedPaths: [],
      selectedCount: 0,
      bulkAnchorPath: null,
      canBulkSelectAll: false,
      canBulkClearSelection: false,
      canBulkMoveSelected: false,
      canBulkAddTagSelected: false,
      canBulkRemoveTagSelected: false,
      canBulkDeleteSelected: false,
      canBulkMergeSelected: false,
    },
    nav: {
      folderTree: [],
      favorites: [],
      boxSummaries: [],
      paneWidth: 260,
      layoutMode: "dual",
      visible: true,
      sectionCollapsed: { favorites: false, folders: false, tags: false, boxes: false },
      showItemCounts: true,
      tooltipSide: "right",
      projection: { normalizedQuery: "", querying: false, sections: [], rows: [], noResults: false },
      query: "",
      focusId: null,
      focusRequest: null,
      revealRequest: null,
    },
    appearance: { cardCornerRadius: "medium", previewLines: 8 },
  };
}

function createPublishHarness(): {
  view: FolderCardView;
  initial: PanelModelState;
  listener: ReturnType<typeof vi.fn>;
} {
  const initial = buildState();
  const replacements: PanelModelState = {
    ...buildState(),
    strings: getUiStrings("zh"),
    scope: { ...initial.scope, displayPath: "Archive" },
    cards: { ...initial.cards, records: [] },
    search: { ...initial.search, query: "needle" },
    projection: { ...initial.projection, sortField: "name" },
    bulk: { ...initial.bulk, bulkMode: true },
    nav: { ...initial.nav, visible: false },
    appearance: { ...initial.appearance, previewLines: 12 },
  };
  const view = Object.create(FolderCardView.prototype) as FolderCardView;
  const host = view as unknown as Record<string, unknown>;
  host.store = createViewStateStore(createFolderScope("", true));
  host.epochs = createViewEpochs();
  host.visibleCards = [];
  host.deriveVisibleCards = vi.fn(() => []);
  host.reconcileBulkSelectionToVisibleCards = vi.fn();
  host.plugin = { getUiStrings: () => replacements.strings };
  host.panelModel = createPanelModel(initial);
  for (const group of PANEL_GROUPS) {
    if (group === "strings") {
      continue;
    }
    const method = `build${group[0]!.toUpperCase()}${group.slice(1)}Group`;
    host[method] = vi.fn(() => replacements[group]);
  }

  const listener = vi.fn();
  (host.panelModel as ReturnType<typeof createPanelModel>).subscribe(listener);
  listener.mockClear();
  return { view, initial, listener };
}

function createRuntimeRouteHarness(): {
  view: FolderCardView;
  initial: PanelModelState;
  listener: ReturnType<typeof vi.fn>;
} {
  const settings = normalizeSettings(DEFAULT_SETTINGS);
  let uiStrings = getUiStrings("en");
  const app = {
    metadataCache: { getFileCache: vi.fn(() => null) },
    vault: {
      getAbstractFileByPath: vi.fn(() => null),
      getMarkdownFiles: vi.fn(() => []),
      getRoot: vi.fn(() => ({ path: "", children: [] })),
    },
    workspace: { leftSplit: {}, trigger: vi.fn() },
  };
  const plugin = {
    getSettings: () => settings,
    getUiStrings: () => uiStrings,
    saveSettings: vi.fn(async () => undefined),
    getSearchService: () => null,
    getSearchSnapshot: () => null,
    subscribeSearchSnapshots: () => () => undefined,
    openNoteFromCard: vi.fn(async () => undefined),
    createNoteInFolder: vi.fn(async () => undefined),
  };
  const leaf = { app, getRoot: () => null };
  const view = new FolderCardView(leaf as never, plugin as never);
  const initial = view.panelModel.getState();
  uiStrings = getUiStrings("zh");
  const replacements: PanelModelState = {
    ...buildState(),
    strings: getUiStrings("zh"),
    scope: { ...initial.scope, displayPath: "Archive" },
    cards: { ...initial.cards, records: [] },
    search: { ...initial.search, query: "needle" },
    projection: { ...initial.projection, sortField: "name" },
    bulk: { ...initial.bulk, bulkMode: true },
    nav: { ...initial.nav, visible: false },
    appearance: { ...initial.appearance, previewLines: 8 },
  };
  const host = view as unknown as Record<string, unknown>;
  for (const group of PANEL_GROUPS) {
    if (group === "strings") {
      continue;
    }
    const method = `build${group[0]!.toUpperCase()}${group.slice(1)}Group`;
    host[method] = vi.fn(() => replacements[group]);
  }

  const listener = vi.fn();
  view.panelModel.subscribe(listener);
  listener.mockClear();
  return { view, initial, listener };
}

/** Real build groups, real projection: the grouped-publish invariants need both. */
function createGroupedRuntimeView(): FolderCardView {
  const settings = normalizeSettings({
    ...DEFAULT_SETTINGS,
    group: { dimension: "folder", orderBy: "default", orderDirection: "asc" },
  });
  const app = {
    metadataCache: { getFileCache: vi.fn(() => null) },
    vault: {
      getAbstractFileByPath: vi.fn(() => null),
      getMarkdownFiles: vi.fn(() => []),
      getRoot: vi.fn(() => ({ path: "", children: [] })),
    },
    workspace: { leftSplit: {}, trigger: vi.fn() },
  };
  const plugin = {
    getSettings: () => settings,
    getUiStrings: () => getUiStrings("en"),
    saveSettings: vi.fn(async () => undefined),
    getSearchService: () => null,
    getSearchSnapshot: () => null,
    subscribeSearchSnapshots: () => () => undefined,
    openNoteFromCard: vi.fn(async () => undefined),
    createNoteInFolder: vi.fn(async () => undefined),
  };
  // The node project has no window; the search debounce reaches for one.
  (globalThis as unknown as { activeWindow?: Pick<Window, "setTimeout" | "clearTimeout"> })
    .activeWindow = { setTimeout: vi.fn(() => 0), clearTimeout: vi.fn() } as never;
  const view = new FolderCardView({ app, getRoot: () => null } as never, plugin as never);
  (view as unknown as { store: ReturnType<typeof createViewStateStore> }).store.replaceBaseCards([
    createCard("notes/alpha.md"),
    createCard("archive/beta.md"),
  ]);
  return view;
}

function expectOnlyGroupsChanged(
  initial: PanelModelState,
  next: PanelModelState,
  changedGroups: readonly PanelGroup[],
): void {
  const changed = new Set(changedGroups);
  for (const group of PANEL_GROUPS) {
    if (changed.has(group)) {
      expect(next[group], `${group} should be replaced`).not.toBe(initial[group]);
    } else {
      expect(next[group], `${group} should retain its reference`).toBe(initial[group]);
    }
  }
}

const runtimeMappings: Array<[string, PanelGroup[]]> = [
  ["complete load or scope switch", [...PANEL_GROUPS]],
  ["search query or snapshot", ["search", "cards", "bulk", "scope", "projection"]],
  ["search focus token", ["search"]],
  ["hydration batch", ["cards"]],
  ["single-card selection", ["cards", "bulk"]],
  ["bulk mode or selection", ["bulk", "cards"]],
  ["sort, tag filter, or pin", ["cards", "projection", "bulk", "scope"]],
  ["nav refresh", ["nav"]],
  ["nav refresh affecting active box scope", ["nav", "scope"]],
  ["appearance", ["appearance"]],
  ["language", ["strings"]],
];

describe("FolderCardView grouped panel publishing", () => {
  it.each(runtimeMappings)("publishes the %s runtime mapping once", (_name, groups) => {
    const { view, initial, listener } = createPublishHarness();

    (view as unknown as { publishGroups: (...groups: PanelGroup[]) => void }).publishGroups(...groups);

    expect(listener).toHaveBeenCalledTimes(1);
    const next = ((view as unknown as { panelModel: ReturnType<typeof createPanelModel> }).panelModel).getState();
    expectOnlyGroupsChanged(initial, next, groups);
  });

  it.each([
    ["patch", ["nav", "appearance", "strings", "scope"]],
    ["reproject", ["nav", "appearance", "strings", "scope", "cards", "projection", "bulk"]],
    ["rehydrate", ["nav", "appearance", "strings", "scope", "cards", "projection", "bulk"]],
    ["reload", [...PANEL_GROUPS]],
  ] as const)("publishes the %s intent mapping once", (intent, groups) => {
    const { view, initial, listener } = createPublishHarness();

    (view as unknown as { publishForIntent: (value: typeof intent) => void }).publishForIntent(intent);

    expect(listener).toHaveBeenCalledTimes(1);
    const next = ((view as unknown as { panelModel: ReturnType<typeof createPanelModel> }).panelModel).getState();
    expectOnlyGroupsChanged(initial, next, groups);
  });

  it("publishes preview appearance as part of rehydrate", () => {
    const { view, initial } = createPublishHarness();

    (view as unknown as { publishForIntent: (value: "rehydrate") => void })
      .publishForIntent("rehydrate");

    const next = view.panelModel.getState();
    expect(next.appearance).not.toBe(initial.appearance);
    expect(next.appearance.previewLines).toBe(12);
  });

  it("includes patch groups when a mixed change resolves to reproject", () => {
    const { view, initial } = createPublishHarness();

    (view as unknown as { publishForIntent: (value: "reproject") => void })
      .publishForIntent("reproject");

    const next = view.panelModel.getState();
    expect(next.cards).not.toBe(initial.cards);
    expect(next.appearance).not.toBe(initial.appearance);
    expect(next.nav).not.toBe(initial.nav);
    expect(next.strings).not.toBe(initial.strings);
  });

  it.each([
    ["patch", ["nav", "appearance", "strings", "scope"]],
    ["reproject", ["nav", "appearance", "strings", "scope", "cards", "projection", "bulk"]],
    ["rehydrate", ["nav", "appearance", "strings", "scope", "cards", "projection", "bulk"]],
  ] as const)("routes applyUpdateIntent(%s) through the runtime publication mapping", async (intent, groups) => {
    const { view, initial, listener } = createRuntimeRouteHarness();

    await view.applyUpdateIntent(intent, "settings-change");

    expect(listener).toHaveBeenCalledTimes(1);
    expectOnlyGroupsChanged(initial, view.panelModel.getState(), groups);
    view.cleanupLifecycle();
  });

  it("routes single-card selection through the runtime publication mapping", () => {
    const { view, initial, listener } = createRuntimeRouteHarness();

    view.setSelectedFile("notes/selected.md");

    expect(listener).toHaveBeenCalledTimes(1);
    expectOnlyGroupsChanged(initial, view.panelModel.getState(), ["cards", "bulk", "nav"]);
    view.cleanupLifecycle();
  });

  it("routes a bulk-mode toolbar event through the controller publication callback", () => {
    const { view, initial, listener } = createRuntimeRouteHarness();

    view.handleToolbarAction({ action: "bulk" });

    expect(listener).toHaveBeenCalledTimes(1);
    expectOnlyGroupsChanged(initial, view.panelModel.getState(), ["bulk", "cards"]);
    view.cleanupLifecycle();
  });

  it("routes a search reset through the search projection publication callback", () => {
    const { view, initial, listener } = createRuntimeRouteHarness();

    view.modules.search.resetQuery();

    expect(listener).toHaveBeenCalledTimes(1);
    expectOnlyGroupsChanged(initial, view.panelModel.getState(), ["search", "cards", "bulk", "scope", "projection"]);
    view.cleanupLifecycle();
  });

  it("routes a group collapse command through the cards and bulk groups only", () => {
    const { view, initial, listener } = createRuntimeRouteHarness();

    view.onGroupCollapseCommand({ command: "toggle", key: "folder:notes" });

    expect(listener).toHaveBeenCalledTimes(1);
    expectOnlyGroupsChanged(initial, view.panelModel.getState(), ["cards", "bulk"]);
    view.cleanupLifecycle();
  });

  it("keeps the published segment count aligned with the segments across the search pause", () => {
    const view = createGroupedRuntimeView();

    (view as unknown as { projectVisibleCards: () => void }).projectVisibleCards();
    (view as unknown as { publishGroups: (...groups: PanelGroup[]) => void })
      .publishGroups("cards", "projection");

    const grouped = view.panelModel.getState();
    expect(grouped.cards.groupSegments).toHaveLength(2);
    expect(grouped.projection.groupSegmentCount).toBe(grouped.cards.groupSegments.length);

    view.modules.search.onQueryChange({ query: "alpha" });

    const paused = view.panelModel.getState();
    expect(paused.cards.groupSegments).toHaveLength(0);
    expect(paused.projection.groupSegmentCount).toBe(paused.cards.groupSegments.length);

    view.modules.search.onQueryChange({ query: "" });

    const restored = view.panelModel.getState();
    expect(restored.cards.groupSegments).toHaveLength(2);
    expect(restored.projection.groupSegmentCount).toBe(restored.cards.groupSegments.length);
    view.cleanupLifecycle();
  });

  it("routes a search focus event through SearchController", () => {
    const { view, initial, listener } = createRuntimeRouteHarness();

    view.modules.search.bumpFocusToken();

    expect(listener).toHaveBeenCalledTimes(1);
    expectOnlyGroupsChanged(initial, view.panelModel.getState(), ["search"]);
    view.cleanupLifecycle();
  });

  it("routes a hydration batch through HydrationController", async () => {
    const { view, initial, listener } = createRuntimeRouteHarness();
    const card = {
      path: "notes/board.canvas",
      title: "Board",
      fileKind: "canvas",
      file: { path: "notes/board.canvas", basename: "board" },
      ctime: 1,
      mtime: 1,
      excerpt: "",
      previewHtml: "",
      previewMode: "empty",
      hydrated: false,
      taskSummary: null,
    };
    const store = (view as unknown as { store: ReturnType<typeof createViewStateStore> }).store;
    store.replaceBaseCards([card as never]);
    store.replaceVisibleCards([card as never]);

    await view.modules.hydration.hydrateViewport({
      generation: (view as any).epochs.load.value,
      hydrationRevision: store.getHydrationRevision(),
      start: 0,
      end: 1,
      paths: [card.path],
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expectOnlyGroupsChanged(initial, view.panelModel.getState(), ["cards"]);
    view.cleanupLifecycle();
  });

  it("routes a navigation refresh through NavLayoutController", () => {
    const { view, initial, listener } = createRuntimeRouteHarness();

    view.refreshNavState();

    expect(listener).toHaveBeenCalledTimes(1);
    expectOnlyGroupsChanged(initial, view.panelModel.getState(), ["nav", "scope"]);
    view.cleanupLifecycle();
  });

  it("builds a fresh card-record array", () => {
    const view = Object.create(FolderCardView.prototype) as FolderCardView;
    const records: PanelModelState["cards"]["records"] = [];
    const epochs = createViewEpochs();
    for (let index = 0; index < 4; index += 1) {
      epochs.load.bump();
    }
    Object.assign(view as object, {
      store: createViewStateStore(createFolderScope("", true)),
      epochs,
      visibleCards: records,
      searchMatchCountsByPath: {},
      selectedPath: null,
      loading: false,
      modules: {
        search: { getMatchCountsByPath: () => ({}) },
        scopeController: { isLoading: () => false },
        projection: { getGroupSegments: () => [], getGroupRevision: () => 0 },
      },
    });

    const cards = (view as unknown as { buildCardsGroup: () => PanelModelState["cards"] }).buildCardsGroup();

    expect(cards.records).toEqual(records);
    expect(cards.records).not.toBe(records);
    expect(cards.sequenceRevision).toBe(0);
    expect(cards.hydrationRevision).toBe(0);
  });

  it("publishes independent visible-sequence and hydration revisions", () => {
    const view = Object.create(FolderCardView.prototype) as FolderCardView;
    const store = createViewStateStore(createFolderScope("", true));
    const first = createCard("first.md");
    store.replaceBaseCards([first]);
    store.replaceVisibleCards([first]);
    store.advanceHydrationRevision();
    Object.assign(view as object, {
      store,
      epochs: createViewEpochs(),
      modules: {
        search: { getMatchCountsByPath: () => ({}) },
        scopeController: { isLoading: () => false },
        projection: { getGroupSegments: () => [], getGroupRevision: () => 0 },
      },
    });

    const cards = (view as unknown as { buildCardsGroup: () => PanelModelState["cards"] }).buildCardsGroup();

    expect(cards.sequenceRevision).toBe(1);
    expect(cards.hydrationRevision).toBe(1);
  });

  it("derives active box identity and name from the runtime scope", () => {
    const view = Object.create(FolderCardView.prototype) as FolderCardView;
    const box = {
      id: "runtime-box",
      name: "Runtime box",
      rules: [],
      manualPaths: [],
      excludedPaths: ["excluded.md"],
      pinnedPaths: [],
      sort: { field: "mtime", direction: "desc" },
      group: { ...DEFAULT_GROUP_SPEC },
    };
    Object.assign(view as object, {
      store: createViewStateStore(createFolderScope("", true)),
      epochs: createViewEpochs(),
      cardScope: createBoxScope(box.id),
      searchQuery: "",
      visibleCards: [],
      modules: {
        search: { getQuery: () => "" },
        boxActions: { getActiveBox: () => box },
      },
      plugin: {
        getUiStrings: () => getUiStrings("en"),
        getSettings: () => ({
          activeBoxId: "stale-settings-box",
          boxes: [box],
          filter: { tags: [] },
          includeSubfolders: true,
        }),
      },
    });

    const scope = (view as unknown as { buildScopeGroup: () => PanelModelState["scope"] }).buildScopeGroup();

    expect(scope).toMatchObject({
      activeBoxId: "runtime-box",
      activeBoxName: "Runtime box",
      boxExcludedCount: 1,
    });
  });
});
