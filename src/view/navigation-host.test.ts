import { describe, expect, it, vi } from "vitest";

import { getUiStrings } from "../i18n";
import { DEFAULT_SETTINGS } from "../settings";
import type { NavigationProjection, NavigationRow } from "./navigation-model";
import { navigationLinksId, navigationPropertyId, navigationPropertyValueId } from "./navigation-model";
import { buildNavigationPanelState, publishLoadStart, publishPreparedCards, routeNavigationIntent, type LoadBoundaryHost } from "./navigation-host";
import { createPanelModel, type PanelModelState, type PanelProjectionState } from "./panel-model";
import { createBoxScope, createFolderScope, createLinksScope } from "./scope";

function projectionWith(row: NavigationRow): NavigationProjection {
  return { normalizedQuery: "", querying: false, sections: [], rows: [row], noResults: false };
}

function tagRow(): NavigationRow {
  return {
    id: "tag:work", kind: "tag", section: "tags", parentId: "section:tags", level: 2,
    positionInSet: 1, setSize: 1, expandable: false, expanded: false, disabled: false,
    semanticState: "none", label: "work", fullPath: "work", count: 0, icon: "tag",
    menuTarget: { section: "tags", scope: "item", itemId: "work" },
    tagPath: "work", synthetic: false, descendantCount: 0,
  };
}

function boxRow(): NavigationRow {
  return {
    id: "box:box-1", kind: "box", section: "boxes", parentId: "section:boxes", level: 2,
    positionInSet: 1, setSize: 1, expandable: false, expanded: false, disabled: false,
    semanticState: "current-range", label: "Box", fullPath: null, count: 0, icon: "box",
    menuTarget: { section: "boxes", scope: "item", itemId: "box-1" }, boxId: "box-1",
  };
}

function propertyRow(): NavigationRow {
  return {
    id: navigationPropertyId("status"), kind: "property", section: "properties",
    parentId: "section:properties", level: 2, positionInSet: 1, setSize: 1,
    expandable: true, expanded: false, disabled: false, semanticState: "none",
    label: "Status", fullPath: null, count: 3, icon: "list",
    menuTarget: { section: "properties", scope: "item", itemId: "status" },
    propertyKey: "status",
  };
}

function propertyValueRow(): NavigationRow {
  return {
    id: navigationPropertyValueId("status", { kind: "text", value: "open" }),
    kind: "property-value", section: "properties", parentId: navigationPropertyId("status"),
    level: 3, positionInSet: 1, setSize: 1, expandable: false, expanded: false, disabled: false,
    semanticState: "checked-filter", label: "open", fullPath: null, count: 2, icon: "dot",
    menuTarget: { section: "properties", scope: "item", itemId: "status", value: { kind: "text", value: "open" } },
    propertyKey: "status", value: { kind: "text", value: "open" },
  };
}

function linksRow(direction: "backlinks" | "outgoing", disabled = false): NavigationRow {
  return {
    id: navigationLinksId(direction), kind: "links", section: "links",
    parentId: "section:links", level: 2, positionInSet: direction === "outgoing" ? 1 : 2, setSize: 2,
    expandable: false, expanded: false, disabled, semanticState: "none",
    label: direction === "outgoing" ? "Outgoing links" : "Backlinks", fullPath: null, count: 0,
    icon: direction === "outgoing" ? "arrow-up-right" : "links",
    menuTarget: { section: "links", scope: "item", itemId: direction },
    direction,
  };
}

describe("navigation host intent routing", () => {
  it("keeps ordinary and additive Tag activation distinct", () => {
    const applyTagFilter = vi.fn();
    const navLayout = { getProjection: () => projectionWith(tagRow()) } as never;
    const common = {
      navLayout, scope: createFolderScope("", true), activeTags: ["old"],
      selectFolder: vi.fn(), switchBox: vi.fn(), applyTagFilter, activateFavorite: vi.fn(),
    };
    routeNavigationIntent({ ...common, intent: { type: "activate", rowId: "tag:work", mode: "ordinary" } });
    routeNavigationIntent({ ...common, intent: { type: "activate", rowId: "tag:work", mode: "additive" } });
    expect(applyTagFilter).toHaveBeenNthCalledWith(1, ["work"]);
    expect(applyTagFilter).toHaveBeenNthCalledWith(2, ["old", "work"]);
  });

  it("makes direct activation of the current Box a complete no-op", () => {
    const switchBox = vi.fn();
    routeNavigationIntent({
      intent: { type: "activate", rowId: "box:box-1", mode: "ordinary" },
      navLayout: { getProjection: () => projectionWith(boxRow()) } as never,
      scope: createBoxScope("box-1"), activeTags: [], selectFolder: vi.fn(), switchBox,
      applyTagFilter: vi.fn(), activateFavorite: vi.fn(),
    });
    expect(switchBox).not.toHaveBeenCalled();
  });

  it("acknowledges focus-return requests through the owning controller", () => {
    const consumeFocusReturn = vi.fn();
    routeNavigationIntent({
      intent: { type: "focus-return-consumed", token: 17 },
      navLayout: { consumeFocusReturn, getProjection: () => projectionWith(tagRow()) } as never,
      scope: createFolderScope("", true), activeTags: [], selectFolder: vi.fn(), switchBox: vi.fn(),
      applyTagFilter: vi.fn(), activateFavorite: vi.fn(),
    });
    expect(consumeFocusReturn).toHaveBeenCalledWith(17);
  });

  it("toggles a property-key expansion on ordinary activation", () => {
    const setExpanded = vi.fn();
    routeNavigationIntent({
      intent: { type: "activate", rowId: navigationPropertyId("status"), mode: "ordinary" },
      navLayout: { getProjection: () => projectionWith(propertyRow()), setExpanded } as never,
      scope: createFolderScope("", true), activeTags: [], selectFolder: vi.fn(), switchBox: vi.fn(),
      applyTagFilter: vi.fn(), activateFavorite: vi.fn(), selectPropertyValue: vi.fn(),
    });
    expect(setExpanded).toHaveBeenCalledWith(expect.objectContaining({ kind: "property" }), true);
  });

  it("ordinary-selects and additive-toggles property values through the injected callback", () => {
    const selectPropertyValue = vi.fn();
    const common = {
      navLayout: { getProjection: () => projectionWith(propertyValueRow()) } as never,
      scope: createFolderScope("", true), activeTags: [],
      selectFolder: vi.fn(), switchBox: vi.fn(), applyTagFilter: vi.fn(), activateFavorite: vi.fn(),
      selectPropertyValue,
    };
    routeNavigationIntent({
      ...common,
      intent: { type: "activate", rowId: navigationPropertyValueId("status", { kind: "text", value: "open" }), mode: "ordinary" },
    });
    expect(selectPropertyValue).toHaveBeenCalledWith("status", { kind: "text", value: "open" }, false);

    routeNavigationIntent({
      ...common,
      intent: { type: "activate", rowId: navigationPropertyValueId("status", { kind: "text", value: "open" }), mode: "additive" },
    });
    expect(selectPropertyValue).toHaveBeenLastCalledWith("status", { kind: "text", value: "open" }, true);
  });

  it("routes favorites reorder intents straight to the reorder callback without a row lookup", () => {
    const reorderFavorites = vi.fn();
    const navLayout = { getProjection: () => projectionWith(tagRow()) } as never;

    routeNavigationIntent({
      navLayout,
      scope: createFolderScope("", true),
      activeTags: [],
      selectFolder: vi.fn(),
      switchBox: vi.fn(),
      applyTagFilter: vi.fn(),
      activateFavorite: vi.fn(),
      reorderFavorites,
      intent: {
        type: "reorder-favorites",
        source: { kind: "tag", ref: "home" },
        target: { kind: "tag", ref: "work" },
        position: "before",
      },
    });

    expect(reorderFavorites).toHaveBeenCalledWith(
      { kind: "tag", ref: "home" },
      { kind: "tag", ref: "work" },
      "before",
    );
  });

  it("dispatches a links leaf to selectLinksDirection with the row direction", () => {
    const selectLinksDirection = vi.fn();
    const common = {
      navLayout: { getProjection: () => projectionWith(linksRow("outgoing")) } as never,
      scope: createFolderScope("", true), activeTags: [],
      selectFolder: vi.fn(), switchBox: vi.fn(), applyTagFilter: vi.fn(), activateFavorite: vi.fn(),
      selectLinksDirection,
    };
    routeNavigationIntent({
      ...common,
      intent: { type: "activate", rowId: navigationLinksId("outgoing"), mode: "ordinary" },
    });
    expect(selectLinksDirection).toHaveBeenCalledWith("outgoing");

    routeNavigationIntent({
      ...common,
      navLayout: { getProjection: () => projectionWith(linksRow("backlinks")) } as never,
      intent: { type: "activate", rowId: navigationLinksId("backlinks"), mode: "additive" },
    });
    expect(selectLinksDirection).toHaveBeenLastCalledWith("backlinks");
  });

  it("does not dispatch a disabled links leaf", () => {
    const selectLinksDirection = vi.fn();
    routeNavigationIntent({
      intent: { type: "activate", rowId: navigationLinksId("outgoing"), mode: "ordinary" },
      navLayout: { getProjection: () => projectionWith(linksRow("outgoing", true)) } as never,
      scope: createFolderScope("", true), activeTags: [],
      selectFolder: vi.fn(), switchBox: vi.fn(), applyTagFilter: vi.fn(), activateFavorite: vi.fn(),
      selectLinksDirection,
    });
    expect(selectLinksDirection).not.toHaveBeenCalled();
  });
});

describe("buildNavigationPanelState linksDisabled (C5b)", () => {
  function captureLinksDisabled(options: {
    scope: ReturnType<typeof createFolderScope> | ReturnType<typeof createLinksScope>;
    selectedPath: string | null;
  }): boolean | undefined {
    let captured: boolean | undefined;
    const navLayout = {
      project: (input: { linksDisabled: boolean }) => {
        captured = input.linksDisabled;
        return { normalizedQuery: "", querying: false, sections: [], rows: [], noResults: false };
      },
      getLayoutMode: () => "dual" as const,
      getNavVisible: () => true,
      getQuery: () => "",
      getFocusId: () => null,
      getFocusRequest: () => null,
      getRevealRequest: () => null,
    };
    buildNavigationPanelState({
      settings: DEFAULT_SETTINGS,
      strings: getUiStrings("en"),
      scope: options.scope,
      selectedPath: options.selectedPath,
      folderTree: [],
      favorites: [],
      boxSummaries: [],
      cardProjection: {
        sortField: "mtime",
        sortDirection: "desc",
        availableTags: [],
        tagCounts: {},
        activeFilterTags: [],
        pinnedPaths: [],
        group: DEFAULT_SETTINGS.group,
        availableGroupDimensions: ["none"],
        groupSegmentCount: 0,
        metadataStatus: "ready",
      },
      navLayout: navLayout as never,
      tooltipSide: "right",
    });
    return captured;
  }

  it("disables leaves for a null or unsupported selectedPath in folder scope", () => {
    expect(captureLinksDisabled({ scope: createFolderScope("", true), selectedPath: null })).toBe(true);
    expect(captureLinksDisabled({ scope: createFolderScope("", true), selectedPath: "P.png" })).toBe(true);
    expect(captureLinksDisabled({ scope: createFolderScope("", true), selectedPath: "notes/A.md" })).toBe(false);
  });

  it("never disables leaves while already in a links scope", () => {
    const scope = createLinksScope("notes/A.md", "outgoing");
    expect(captureLinksDisabled({ scope, selectedPath: null })).toBe(false);
    expect(captureLinksDisabled({ scope, selectedPath: "P.png" })).toBe(false);
  });
});

describe("buildNavigationPanelState browse-filter disabled flags (C6)", () => {
  function captureDisabledFlags(scope: ReturnType<typeof createFolderScope>): {
    tagsDisabled: boolean;
    propertiesDisabled: boolean;
  } {
    let captured = { tagsDisabled: false, propertiesDisabled: false };
    const navLayout = {
      project: (input: { tagsDisabled: boolean; propertiesDisabled: boolean }) => {
        captured = { tagsDisabled: input.tagsDisabled, propertiesDisabled: input.propertiesDisabled };
        return { normalizedQuery: "", querying: false, sections: [], rows: [], noResults: false };
      },
      getLayoutMode: () => "dual" as const,
      getNavVisible: () => true,
      getQuery: () => "",
      getFocusId: () => null,
      getFocusRequest: () => null,
      getRevealRequest: () => null,
    };
    buildNavigationPanelState({
      settings: DEFAULT_SETTINGS,
      strings: getUiStrings("en"),
      scope,
      selectedPath: null,
      folderTree: [],
      favorites: [],
      boxSummaries: [],
      cardProjection: {
        sortField: "mtime",
        sortDirection: "desc",
        availableTags: [],
        tagCounts: {},
        activeFilterTags: [],
        pinnedPaths: [],
        group: DEFAULT_SETTINGS.group,
        availableGroupDimensions: ["none"],
        groupSegmentCount: 0,
        metadataStatus: "ready",
      },
      navLayout: navLayout as never,
      tooltipSide: "right",
    });
    return captured;
  }

  it("derives both disabled flags from resolveSourceCapabilities per scope kind", () => {
    expect(captureDisabledFlags(createFolderScope("notes", true)))
      .toEqual({ tagsDisabled: false, propertiesDisabled: false });
    expect(captureDisabledFlags(createBoxScope("box-1")))
      .toEqual({ tagsDisabled: true, propertiesDisabled: true });
    expect(captureDisabledFlags(createLinksScope("notes/a.md", "backlinks")))
      .toEqual({ tagsDisabled: true, propertiesDisabled: true });
  });
});

describe("buildNavigationPanelState property empty label", () => {
  function capturePropertyEmptyLabel(metadataStatus: "pending" | "ready"): string | null {
    let emptyLabel: string | null = null;
    const navLayout = {
      project: (input: { sectionLabels: { properties: { emptyLabel: string | null } } }) => {
        emptyLabel = input.sectionLabels.properties.emptyLabel;
        return { normalizedQuery: "", querying: false, sections: [], rows: [], noResults: false };
      },
      getLayoutMode: () => "dual" as const,
      getNavVisible: () => true,
      getQuery: () => "",
      getFocusId: () => null,
      getFocusRequest: () => null,
      getRevealRequest: () => null,
    };
    buildNavigationPanelState({
      settings: { ...DEFAULT_SETTINGS, visiblePropertyKeys: ["status"] },
      strings: getUiStrings("en"),
      scope: createFolderScope("notes", true),
      selectedPath: null,
      folderTree: [],
      favorites: [],
      boxSummaries: [],
      cardProjection: {
        sortField: "mtime",
        sortDirection: "desc",
        availableTags: [],
        tagCounts: {},
        activeFilterTags: [],
        pinnedPaths: [],
        group: DEFAULT_SETTINGS.group,
        availableGroupDimensions: ["none"],
        groupSegmentCount: 0,
        metadataStatus,
      },
      navLayout: navLayout as never,
      tooltipSide: "right",
    });
    return emptyLabel;
  }

  it("keeps the ordinary empty label across metadata status for compatibility", () => {
    const strings = getUiStrings("en").property;
    expect(capturePropertyEmptyLabel("pending")).toBe(strings.sectionEmpty);
    expect(capturePropertyEmptyLabel("ready")).toBe(strings.sectionEmpty);
  });
});

describe("scope load panel publication", () => {
  function createLoadBoundaryHarness(withPreviousCards: boolean) {
    const oldScope = { displayPath: "folder-a", sourceIdentity: "folder:folder-a:true" } as PanelModelState["scope"];
    const nextScope = { displayPath: "folder-b", sourceIdentity: "folder:folder-b:true" } as PanelModelState["scope"];
    const oldCards = {
      records: withPreviousCards ? [{ path: "folder-a/old.md" }] : [],
      loading: false,
    } as unknown as PanelModelState["cards"];
    const loadingCards = { ...oldCards, loading: true };
    const nextCards = {
      ...oldCards,
      records: [{ path: "folder-b/new.md" }],
      loading: false,
    } as unknown as PanelModelState["cards"];
    const oldSearch = { query: "draft", committedQuery: "old committed", status: "ready" } as PanelModelState["search"];
    const nextSearch = { query: "draft", committedQuery: "new committed", status: "ready" } as PanelModelState["search"];
    const oldProjection = {
      availableTags: ["old"], tagCounts: { old: 3 }, metadataStatus: "ready",
    } as unknown as PanelProjectionState;
    const nextProjection = {
      availableTags: ["next"], tagCounts: { next: 4 }, metadataStatus: "ready",
    } as unknown as PanelProjectionState;
    const oldNav = {
      folderTree: [], favorites: [], boxSummaries: [], projection: { rows: ["old-tag", "old-property"] },
    } as unknown as PanelModelState["nav"];
    const nextNav = {
      ...oldNav, projection: { rows: ["next-tag", "next-property"] },
    } as unknown as PanelModelState["nav"];
    const model = createPanelModel({
      scope: oldScope,
      cards: oldCards,
      search: oldSearch,
      nav: oldNav,
      projection: oldProjection,
      appearance: { previewLines: 5 },
      bulk: {} as PanelModelState["bulk"],
    } as PanelModelState);
    const notifications: PanelModelState[] = [];
    model.subscribe((state) => notifications.push(state));
    notifications.length = 0;

    const publishedGroups: string[][] = [];
    const nextBulk = {} as PanelModelState["bulk"];
    const host: LoadBoundaryHost = {
      panelModel: model,
      publishGroups: (...groups) => {
        publishedGroups.push(groups);
        model.batch((draft) => {
          for (const group of groups) {
            switch (group) {
              case "scope": draft.scope = nextScope; break;
              case "cards": draft.cards = groups.includes("projection") ? nextCards : loadingCards; break;
              case "search": draft.search = nextSearch; break;
              case "projection": draft.projection = nextProjection; break;
              case "bulk": draft.bulk = nextBulk; break;
            }
          }
        });
      },
      projectNav: (_folders, _favorites, _boxes, projection) => {
        expect(projection).toBe(nextProjection);
        return nextNav;
      },
      getSettings: () => ({ ...DEFAULT_SETTINGS, previewLines: 5 }),
      getScope: () => createFolderScope("next", true),
      getSelectedPath: () => null,
    };

    return { host, model, notifications, publishedGroups, oldScope, oldCards, oldSearch, oldProjection, oldNav,
      nextScope, nextCards, nextSearch, nextProjection, nextNav };
  }

  it("keeps the previous scope, cards, search and nav mounted until the complete replacement commits", () => {
    const harness = createLoadBoundaryHarness(true);
    const { host, model, notifications, publishedGroups, oldScope, oldCards, oldSearch, oldProjection,
      oldNav, nextScope, nextCards, nextSearch, nextProjection, nextNav } = harness;

    publishLoadStart(host, true);
    expect(publishedGroups[0]).toEqual(["cards", "bulk"]);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.scope).toBe(oldScope);
    expect(notifications[0]?.cards.records).toBe(oldCards.records);
    expect(notifications[0]?.cards.loading).toBe(true);
    expect(notifications[0]?.search).toBe(oldSearch);
    expect(notifications[0]?.projection).toBe(oldProjection);
    expect(notifications[0]?.nav).toBe(oldNav);

    notifications.length = 0;
    publishedGroups.length = 0;
    publishPreparedCards(host);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.scope).toBe(nextScope);
    expect(notifications[0]?.cards).toBe(nextCards);
    expect(notifications[0]?.search).toBe(nextSearch);
    expect(notifications[0]?.projection).toBe(nextProjection);
    expect(notifications[0]?.nav).toBe(nextNav);
    expect(publishedGroups[0]).toEqual(["scope", "cards", "search", "projection", "bulk"]);
    expect(model.getState().cards.records[0]?.path).toBe("folder-b/new.md");
  });

  it("publishes scope and loading search state for an initially empty load", () => {
    const { host, notifications, publishedGroups, nextScope } = createLoadBoundaryHarness(false);
    publishLoadStart(host, true);

    expect(publishedGroups[0]).toEqual(["scope", "cards", "search", "bulk"]);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.scope).toBe(nextScope);
    expect(notifications[0]?.cards.loading).toBe(true);
  });
});
