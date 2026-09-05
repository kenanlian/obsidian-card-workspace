import { describe, expect, it, vi } from "vitest";

import type { NavigationProjection, NavigationRow } from "./navigation-model";
import { navigationPropertyId, navigationPropertyValueId } from "./navigation-model";
import { routeNavigationIntent } from "./navigation-host";
import { createBoxScope, createFolderScope } from "./scope";

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
});
