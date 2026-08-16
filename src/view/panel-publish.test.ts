import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  ItemView: class {},
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
import { createPanelModel, PANEL_GROUPS, type PanelGroup, type PanelModelState } from "./panel-model";
import { FolderCardView } from "./FolderCardView";
import { createBoxScope } from "./scope";

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
    },
    search: { query: "", status: "idle", focusToken: 0 },
    projection: {
      sortField: "mtime",
      sortDirection: "desc",
      availableTags: [],
      tagCounts: {},
      activeFilterTags: [],
      pinnedPaths: [],
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
  ["search query or snapshot", ["search", "cards", "bulk", "scope"]],
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
    ["reproject", ["cards", "projection", "bulk", "scope"]],
    ["rehydrate", ["cards", "projection", "bulk", "scope"]],
    ["reload", [...PANEL_GROUPS]],
  ] as const)("publishes the %s intent mapping once", (intent, groups) => {
    const { view, initial, listener } = createPublishHarness();

    (view as unknown as { publishForIntent: (value: typeof intent) => void }).publishForIntent(intent);

    expect(listener).toHaveBeenCalledTimes(1);
    const next = ((view as unknown as { panelModel: ReturnType<typeof createPanelModel> }).panelModel).getState();
    expectOnlyGroupsChanged(initial, next, groups);
  });

  it("builds a fresh card-record array", () => {
    const view = Object.create(FolderCardView.prototype) as FolderCardView;
    const records: PanelModelState["cards"]["records"] = [];
    Object.assign(view as object, {
      visibleCards: records,
      searchMatchCountsByPath: {},
      selectedPath: null,
      loading: false,
      loadEpoch: { value: 4 },
    });

    const cards = (view as unknown as { buildCardsGroup: () => PanelModelState["cards"] }).buildCardsGroup();

    expect(cards.records).toEqual(records);
    expect(cards.records).not.toBe(records);
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
    };
    Object.assign(view as object, {
      cardScope: createBoxScope(box.id),
      searchQuery: "",
      visibleCards: [],
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
