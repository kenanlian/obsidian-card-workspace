import { describe, expect, it, vi } from "vitest";

import type { NavigationProjection, NavigationRow } from "./navigation-model";
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
});
