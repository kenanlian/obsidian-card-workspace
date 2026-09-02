import { describe, expect, it } from "vitest";

import { getUiStrings } from "../i18n";
import { defaultNavSectionOrder } from "../navigation-section-order";
import { projectNavigation } from "./navigation-projection";
import { resolveNavigationRowTooltip } from "./navigation-tooltip";
import {
  navigationBoxId,
  navigationFavoriteId,
  navigationFolderId,
  navigationSectionId,
  navigationTagId,
  type NavigationProjectionInput,
} from "./navigation-model";

const strings = getUiStrings("en");
const zh = getUiStrings("zh");

function input(overrides: Partial<NavigationProjectionInput> = {}): NavigationProjectionInput {
  return {
    query: "",
    scope: { kind: "folder", path: "", includeSubfolders: true },
    activeTags: [],
    selectedPath: null,
    favorites: [
      { kind: "file", ref: "note.md", label: "Note", icon: "file-text", count: 0, missing: false },
      { kind: "file", ref: "gone.md", label: "Gone", icon: "file-text", count: 0, missing: true },
    ],
    folders: [{
      name: "/", path: "/", depth: 0, directCount: 2, recursiveCount: 5, recursiveFolderCount: 3, children: [],
    }],
    tags: [{
      label: "work", displayTag: "work", tag: "work", depth: 0, synthetic: false,
      children: [{ label: "now", displayTag: "now", tag: "work/now", depth: 1, synthetic: false, children: [] }],
    }],
    boxes: [{ id: "box-1", name: "Inbox", cardCount: 4 }],
    tagCounts: { work: 7, "work/now": 2 },
    includeSubfolders: true,
    tagsDisabled: false,
    sectionCollapsed: { favorites: false, folders: false, tags: false, properties: false, boxes: false },
    sectionOrder: defaultNavSectionOrder(),
    sectionLabels: {
      favorites: { label: "Favorites", emptyLabel: null },
      folders: { label: "Folders", emptyLabel: null },
      tags: { label: "Tags", emptyLabel: null },
      properties: { label: "Properties", emptyLabel: null },
      boxes: { label: "Boxes", emptyLabel: null },
    },
    rootFolderLabel: "Root /",
    expansion: {
      folders: { manual: [], reveal: [], query: [], suppressed: [] },
      tags: { manual: ["work"], reveal: [], query: [], suppressed: [] },
      queryCollapsedSections: [],
    },
    ...overrides,
  };
}

describe("resolveNavigationRowTooltip", () => {
  it("uses 1.1.5 count copy for folders, tags, and boxes", () => {
    const byId = new Map(projectNavigation(input()).rows.map((row) => [row.id, row]));
    expect(resolveNavigationRowTooltip(byId.get(navigationFolderId(""))!, strings))
      .toBe("5 files, 3 folders");
    expect(resolveNavigationRowTooltip(byId.get(navigationTagId("work"))!, strings))
      .toBe("7 files, 1 subtag");
    expect(resolveNavigationRowTooltip(byId.get(navigationBoxId("box-1"))!, strings)).toBe("4 files");
    expect(resolveNavigationRowTooltip(byId.get(navigationFolderId(""))!, zh))
      .toBe("5 个文件, 3 个文件夹");
    expect(resolveNavigationRowTooltip(byId.get(navigationTagId("work"))!, zh))
      .toBe("7 个文件, 1 个子标签");
  });

  it("uses the favorite label, including the missing suffix", () => {
    const byId = new Map(projectNavigation(input()).rows.map((row) => [row.id, row]));
    expect(resolveNavigationRowTooltip(byId.get(navigationFavoriteId("file", "note.md"))!, strings))
      .toBe("Note");
    expect(resolveNavigationRowTooltip(byId.get(navigationFavoriteId("file", "gone.md"))!, strings))
      .toBe("Gone (missing)");
    expect(resolveNavigationRowTooltip(byId.get(navigationSectionId("folders"))!, strings)).toBe("");
  });
});
