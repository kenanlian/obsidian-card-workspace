import { describe, expect, it } from "vitest";

import { getUiStrings } from "../i18n";
import { defaultNavSectionOrder } from "../navigation-section-order";
import {
  navigationLinksId,
  navigationSectionId,
  type NavigationProjectionInput,
} from "./navigation-model";
import { projectLinksRows } from "./links-navigation-projection";
import { createFolderScope, createLinksScope } from "./scope";

function buildInput(overrides: Partial<NavigationProjectionInput> = {}): NavigationProjectionInput {
  return {
    query: "",
    scope: createFolderScope("notes", true),
    activeTags: [],
    selectedPath: "notes/A.md",
    favorites: [],
    folders: [],
    tags: [],
    boxes: [],
    tagCounts: {},
    includeSubfolders: true,
    tagsDisabled: false,
    sectionCollapsed: { favorites: false, folders: false, tags: false, properties: false, boxes: false, links: false },
    sectionOrder: defaultNavSectionOrder(),
    sectionLabels: {
      favorites: { label: "Favorites", emptyLabel: null },
      folders: { label: "Folders", emptyLabel: null },
      tags: { label: "Tags", emptyLabel: null },
      properties: { label: "Properties", emptyLabel: null },
      boxes: { label: "Boxes", emptyLabel: null },
      links: { label: "Links", emptyLabel: null },
    },
    rootFolderLabel: "Root /",
    linksLeafLabels: { backlinks: "Backlinks", outgoing: "Outgoing links" },
    linksDisabled: false,
    expansion: {
      folders: { manual: [], reveal: [], query: [], suppressed: [] },
      tags: { manual: [], reveal: [], query: [], suppressed: [] },
      queryCollapsedSections: [],
    },
    ...overrides,
  };
}

describe("projectLinksRows", () => {
  it("emits two fixed leaves in outgoing-then-backlinks order with stable ids", () => {
    const { rows, matchedItemCount } = projectLinksRows(buildInput(), "");
    expect(matchedItemCount).toBe(2);
    expect(rows.map((row) => row.id)).toEqual([
      navigationLinksId("outgoing"),
      navigationLinksId("backlinks"),
    ]);
    expect(rows[0]).toMatchObject({
      kind: "links",
      section: "links",
      direction: "outgoing",
      parentId: navigationSectionId("links"),
      level: 2,
      expandable: false,
      expanded: false,
      count: 0,
      icon: "arrow-up-right",
      fullPath: null,
      disabled: false,
      semanticState: "none",
      label: "Outgoing links",
      menuTarget: { section: "links", scope: "item", itemId: "outgoing" },
      positionInSet: 0,
      setSize: 0,
    });
    expect(rows[1]).toMatchObject({
      kind: "links",
      section: "links",
      direction: "backlinks",
      parentId: navigationSectionId("links"),
      level: 2,
      expandable: false,
      expanded: false,
      count: 0,
      icon: "links",
      fullPath: null,
      disabled: false,
      semanticState: "none",
      label: "Backlinks",
      menuTarget: { section: "links", scope: "item", itemId: "backlinks" },
    });
  });

  it("marks only the matching links direction as current-range", () => {
    const outgoing = projectLinksRows(buildInput({
      scope: createLinksScope("notes/A.md", "outgoing"),
    }), "");
    expect(outgoing.rows.find((row) => row.direction === "outgoing")?.semanticState).toBe("current-range");
    expect(outgoing.rows.find((row) => row.direction === "backlinks")?.semanticState).toBe("none");

    const backlinks = projectLinksRows(buildInput({
      scope: createLinksScope("notes/A.md", "backlinks"),
    }), "");
    expect(backlinks.rows.find((row) => row.direction === "backlinks")?.semanticState).toBe("current-range");
    expect(backlinks.rows.find((row) => row.direction === "outgoing")?.semanticState).toBe("none");

    const folder = projectLinksRows(buildInput({ scope: createFolderScope("notes", true) }), "");
    expect(folder.rows.every((row) => row.semanticState === "none")).toBe(true);
  });

  it("applies the host-owned disabled flag to both leaves", () => {
    const disabled = projectLinksRows(buildInput({ linksDisabled: true }), "");
    expect(disabled.rows.every((row) => row.disabled)).toBe(true);
    const enabled = projectLinksRows(buildInput({ linksDisabled: false }), "");
    expect(enabled.rows.every((row) => row.disabled)).toBe(false);
  });

  it("filters leaves by localized labels and reports matchedItemCount 2 / 0–2", () => {
    const en = getUiStrings("en").links;
    const zh = getUiStrings("zh").links;
    const english = buildInput({
      linksLeafLabels: { backlinks: en.directionBacklinks, outgoing: en.directionOutgoing },
    });
    const chinese = buildInput({
      linksLeafLabels: { backlinks: zh.directionBacklinks, outgoing: zh.directionOutgoing },
    });

    expect(projectLinksRows(english, "").matchedItemCount).toBe(2);

    const outgoingOnly = projectLinksRows(english, "outgoing");
    expect(outgoingOnly.matchedItemCount).toBe(1);
    expect(outgoingOnly.rows.map((row) => row.direction)).toEqual(["outgoing"]);

    const backlinksOnly = projectLinksRows(english, "backlinks");
    expect(backlinksOnly.matchedItemCount).toBe(1);
    expect(backlinksOnly.rows.map((row) => row.direction)).toEqual(["backlinks"]);

    const zhOutgoing = projectLinksRows(chinese, "出链");
    expect(zhOutgoing.matchedItemCount).toBe(1);
    expect(zhOutgoing.rows.map((row) => row.direction)).toEqual(["outgoing"]);

    const zhBacklinks = projectLinksRows(chinese, "反链");
    expect(zhBacklinks.matchedItemCount).toBe(1);
    expect(zhBacklinks.rows.map((row) => row.direction)).toEqual(["backlinks"]);

    const none = projectLinksRows(english, "not-a-leaf");
    expect(none.matchedItemCount).toBe(0);
    expect(none.rows).toEqual([]);
  });

  it("falls back to the direction key when a leaf label is empty", () => {
    const { rows } = projectLinksRows(buildInput({
      linksLeafLabels: { backlinks: "", outgoing: "" },
    }), "");
    expect(rows.map((row) => row.label)).toEqual(["outgoing", "backlinks"]);
  });
});
