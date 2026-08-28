import { describe, expect, it } from "vitest";

import { PLAIN_FOLDER_ICON } from "../icons";
import { defaultNavSectionOrder } from "../navigation-section-order";
import type { FolderTreeNode } from "./types";
import type { TagTreeNode } from "./tag-tree";
import {
  type NavigationProjectionInput,
  type NavigationRow,
  navigationBoxId,
  navigationFavoriteId,
  navigationFolderId,
  navigationSectionId,
  navigationTagId,
} from "./navigation-model";
import { projectNavigation, resolveNavigationFocus } from "./navigation-projection";

const sectionLabels = {
  favorites: { label: "Favorites", emptyLabel: "No favorites yet — right-click an item to add one" },
  folders: { label: "Folders", emptyLabel: null },
  tags: { label: "Tags", emptyLabel: "No tags found" },
  boxes: { label: "Boxes", emptyLabel: "No card boxes yet — right-click to create one" },
} as const;

function folder(
  name: string,
  path: string,
  children: FolderTreeNode[] = [],
  counts = { direct: 1, recursive: 1, folders: 0 },
): FolderTreeNode {
  return {
    name,
    path,
    children,
    depth: 0,
    directCount: counts.direct,
    recursiveCount: counts.recursive,
    recursiveFolderCount: counts.folders,
  };
}

function tag(
  tagPath: string,
  label: string,
  children: TagTreeNode[] = [],
  synthetic = false,
): TagTreeNode {
  return {
    tag: tagPath,
    displayTag: tagPath,
    label,
    depth: 0,
    synthetic,
    children,
  };
}

function buildInput(overrides: Partial<NavigationProjectionInput> = {}): NavigationProjectionInput {
  return {
    query: "",
    scope: { kind: "folder", path: "Projects/Alpha", includeSubfolders: true },
    activeTags: ["work/current"],
    selectedPath: "Projects/Alpha/Current.md",
    favorites: [
      { kind: "folder", ref: "Projects/Alpha", label: "Alpha", icon: "folder", count: 2, missing: false },
      { kind: "tag", ref: "work/current", label: "work/current", icon: "tag", count: 3, missing: false },
      { kind: "file", ref: "Projects/Alpha/Current.md", label: "Current", icon: "file", count: 0, missing: false },
      { kind: "box", ref: "box-a", label: "Box Alpha", icon: "box", count: 4, missing: false },
    ],
    folders: [
      folder("/", "/"),
      folder("Projects", "Projects", [
        folder("Alpha", "Projects/Alpha", [
          folder("Résumé", "Projects/Alpha/Résumé"),
        ]),
        folder("Alpha", "Projects/Archive/Alpha"),
      ], { direct: 1, recursive: 4, folders: 3 }),
    ],
    tags: [
      tag("work", "Work", [
        tag("work/current", "Current"),
        tag("work/历史", "历史"),
      ], true),
    ],
    boxes: [
      { id: "box-a", name: "Box Alpha", cardCount: 4 },
      { id: "box-b", name: "资料", cardCount: 2 },
    ],
    tagCounts: { work: 5, "work/current": 3, "work/历史": 2 },
    includeSubfolders: true,
    tagsDisabled: false,
    sectionCollapsed: { favorites: false, folders: false, tags: false, boxes: false },
    sectionOrder: defaultNavSectionOrder(),
    sectionLabels,
    rootFolderLabel: "Root /",
    expansion: {
      folders: {
        manual: ["Projects"],
        reveal: ["Projects/Alpha"],
        query: [],
        suppressed: [],
      },
      tags: { manual: ["work"], reveal: [], query: [], suppressed: [] },
      queryCollapsedSections: [],
    },
    ...overrides,
  };
}

function ids(rows: readonly NavigationRow[]): string[] {
  return rows.map((row) => row.id);
}

describe("projectNavigation", () => {
  it("preserves section/source order and occupied empty section metadata for a blank query", () => {
    const projection = projectNavigation(buildInput({ favorites: [], boxes: [] }));

    expect(projection.querying).toBe(false);
    expect(projection.noResults).toBe(false);
    expect(projection.sections.map((section) => section.section)).toEqual([
      "favorites", "folders", "tags", "boxes",
    ]);
    expect(projection.sections[0]?.emptyLabel).toBe("No favorites yet — right-click an item to add one");
    expect(projection.sections[3]?.emptyLabel).toBe("No card boxes yet — right-click to create one");
    expect(ids(projection.rows).slice(0, 5)).toEqual([
      navigationSectionId("favorites"),
      navigationSectionId("folders"),
      navigationFolderId(""),
      navigationFolderId("Projects"),
      navigationFolderId("Projects/Alpha"),
    ]);
  });

  it("assigns a constant folder identity icon by path, not expansion state", () => {
    const collapsed = projectNavigation(buildInput({
      expansion: {
        folders: { manual: [], reveal: [], query: [], suppressed: [] },
        tags: { manual: [], reveal: [], query: [], suppressed: [] },
        queryCollapsedSections: [],
      },
    }));
    const expanded = projectNavigation(buildInput());
    const collapsedById = new Map(collapsed.rows.map((row) => [row.id, row]));
    const expandedById = new Map(expanded.rows.map((row) => [row.id, row]));

    expect(collapsedById.get(navigationFolderId(""))?.icon).toBe("house");
    expect(expandedById.get(navigationFolderId(""))?.icon).toBe("house");

    expect(collapsedById.get(navigationFolderId("Projects"))).toMatchObject({
      expandable: true,
      expanded: false,
      icon: PLAIN_FOLDER_ICON,
    });
    expect(expandedById.get(navigationFolderId("Projects"))).toMatchObject({
      expandable: true,
      expanded: true,
      icon: PLAIN_FOLDER_ICON,
    });
    expect(expandedById.get(navigationFolderId("Projects/Alpha"))).toMatchObject({
      expandable: true,
      expanded: true,
      icon: PLAIN_FOLDER_ICON,
    });

    expect(expandedById.get(navigationFolderId("Projects/Alpha/Résumé"))).toMatchObject({
      expandable: false,
      expanded: false,
      icon: PLAIN_FOLDER_ICON,
    });
    expect(expandedById.get(navigationFolderId("Projects/Archive/Alpha"))).toMatchObject({
      expandable: false,
      expanded: false,
      icon: PLAIN_FOLDER_ICON,
    });

    for (const row of [...collapsed.rows, ...expanded.rows]) {
      if (row.kind !== "folder") continue;
      expect(row.icon).not.toBe("folder");
    }
  });

  it("keeps the same folder identity icon regardless of expandable or expanded", () => {
    const collapsed = projectNavigation(buildInput({
      expansion: {
        folders: { manual: [], reveal: [], query: [], suppressed: [] },
        tags: { manual: [], reveal: [], query: [], suppressed: [] },
        queryCollapsedSections: [],
      },
    }));
    const expanded = projectNavigation(buildInput());
    const folders = [...collapsed.rows, ...expanded.rows].filter((row) => row.kind === "folder");
    expect(folders.length).toBeGreaterThan(0);
    for (const row of folders) {
      expect(row.icon).toBe(row.folderPath === "" ? "house" : PLAIN_FOLDER_ICON);
    }
    const collapsedProjects = collapsed.rows.find((row) => row.id === navigationFolderId("Projects"));
    const expandedProjects = expanded.rows.find((row) => row.id === navigationFolderId("Projects"));
    expect(collapsedProjects).toMatchObject({ expandable: true, expanded: false, icon: PLAIN_FOLDER_ICON });
    expect(expandedProjects).toMatchObject({ expandable: true, expanded: true, icon: PLAIN_FOLDER_ICON });
    expect(collapsedProjects?.icon).toBe(expandedProjects?.icon);
  });

  it("assigns null icons to section header rows", () => {
    const projection = projectNavigation(buildInput());
    const sections = projection.rows.filter((row) => row.kind === "section");
    expect(sections.length).toBeGreaterThan(0);
    for (const row of sections) {
      expect(row.icon).toBeNull();
    }
  });

  it("uses the tag identity icon for every tag row including synthetic parents", () => {
    const projection = projectNavigation(buildInput());
    const tags = projection.rows.filter((row) => row.kind === "tag");
    expect(tags.some((row) => row.synthetic)).toBe(true);
    for (const row of tags) {
      expect(row.icon).toBe("tag");
    }
  });

  it("matches trimmed case-insensitive substrings without ranking or reordering", () => {
    const result = projectNavigation(buildInput({ query: "  ALP  " }));

    expect(result.normalizedQuery).toBe("alp");
    expect(result.sections.map((section) => section.section)).toEqual([
      "favorites", "folders", "boxes",
    ]);
    expect(ids(result.rows)).toEqual([
      navigationSectionId("favorites"),
      navigationFavoriteId("folder", "Projects/Alpha"),
      navigationFavoriteId("box", "box-a"),
      navigationSectionId("folders"),
      navigationFolderId("Projects"),
      navigationFolderId("Projects/Alpha"),
      navigationFolderId("Projects/Alpha/Résumé"),
      navigationFolderId("Projects/Archive/Alpha"),
      navigationSectionId("boxes"),
      navigationBoxId("box-a"),
    ]);
  });

  it("matches full paths and non-ASCII candidates with ordinary lowercasing", () => {
    const folderResult = projectNavigation(buildInput({ query: "alpha/rés" }));
    expect(ids(folderResult.rows)).toContain(navigationFolderId("Projects/Alpha/Résumé"));
    expect(ids(folderResult.rows)).toContain(navigationFolderId("Projects"));

    const tagResult = projectNavigation(buildInput({ query: "历史" }));
    expect(ids(tagResult.rows)).toEqual([
      navigationSectionId("tags"),
      navigationTagId("work"),
      navigationTagId("work/历史"),
    ]);

    const boxResult = projectNavigation(buildInput({ query: "资料" }));
    expect(ids(boxResult.rows)).toEqual([
      navigationSectionId("boxes"),
      navigationBoxId("box-b"),
    ]);
  });

  it("retains nested ancestors and allows a temporary query collapse override", () => {
    const expanded = projectNavigation(buildInput({
      query: "résumé",
      expansion: {
        ...buildInput().expansion,
        folders: { manual: [], reveal: [], query: [], suppressed: [] },
      },
    }));
    expect(ids(expanded.rows)).toEqual([
      navigationSectionId("folders"),
      navigationFolderId("Projects"),
      navigationFolderId("Projects/Alpha"),
      navigationFolderId("Projects/Alpha/Résumé"),
    ]);

    const collapsed = projectNavigation(buildInput({
      query: "résumé",
      expansion: {
        ...buildInput().expansion,
        folders: { manual: [], reveal: [], query: [], suppressed: ["Projects"] },
      },
    }));
    expect(ids(collapsed.rows)).toEqual([
      navigationSectionId("folders"),
      navigationFolderId("Projects"),
    ]);
  });

  it("hides no-match sections and reports one global no-results state", () => {
    const noMatches = projectNavigation(buildInput({ query: "not-a-navigation-item" }));
    expect(noMatches.sections).toEqual([]);
    expect(noMatches.rows).toEqual([]);
    expect(noMatches.noResults).toBe(true);
  });

  it("keeps stable IDs independent of labels, counts, expansion, and query", () => {
    const first = projectNavigation(buildInput());
    const second = projectNavigation(buildInput({
      query: "alpha",
      favorites: [{ kind: "folder", ref: "Projects/Alpha", label: "Renamed label Alpha", icon: "folder", count: 99, missing: false }],
      expansion: {
        ...buildInput().expansion,
        folders: { manual: [], reveal: [], query: ["Projects"], suppressed: [] },
      },
    }));
    expect(ids(first.rows)).toContain(navigationFavoriteId("folder", "Projects/Alpha"));
    expect(ids(second.rows)).toContain(navigationFavoriteId("folder", "Projects/Alpha"));
    expect(ids(first.rows)).toContain(navigationFolderId("Projects/Alpha"));
    expect(ids(second.rows)).toContain(navigationFolderId("Projects/Alpha"));
  });

  it("projects parent, level, set position/size, counts, and expansion deterministically", () => {
    const projection = projectNavigation(buildInput());
    const projects = projection.rows.find((row) => row.id === navigationFolderId("Projects"));
    const alpha = projection.rows.find((row) => row.id === navigationFolderId("Projects/Alpha"));
    const archiveAlpha = projection.rows.find((row) => row.id === navigationFolderId("Projects/Archive/Alpha"));

    expect(projects).toMatchObject({
      parentId: navigationSectionId("folders"), level: 2, positionInSet: 2, setSize: 2,
      expandable: true, expanded: true, count: 4,
    });
    expect(alpha).toMatchObject({
      parentId: navigationFolderId("Projects"), level: 3, positionInSet: 1, setSize: 2,
      semanticState: "current-range", expanded: true,
    });
    expect(archiveAlpha).toMatchObject({
      parentId: navigationFolderId("Projects"), level: 3, positionInSet: 2, setSize: 2,
    });
  });

  it("keeps range, checked Tag, active file, and disabled state independent", () => {
    const projection = projectNavigation(buildInput({
      scope: { kind: "box", boxId: "box-a" },
      tagsDisabled: true,
    }));
    const byId = new Map(projection.rows.map((row) => [row.id, row]));

    expect(byId.get(navigationFavoriteId("folder", "Projects/Alpha"))?.semanticState).toBe("none");
    expect(byId.get(navigationFavoriteId("box", "box-a"))?.semanticState).toBe("current-range");
    expect(byId.get(navigationFavoriteId("tag", "work/current"))?.semanticState).toBe("checked-filter");
    expect(byId.get(navigationFavoriteId("file", "Projects/Alpha/Current.md"))?.semanticState).toBe("active-file");
    expect(byId.get(navigationTagId("work/current"))).toMatchObject({
      semanticState: "checked-filter",
      disabled: true,
    });
    expect(byId.get(navigationBoxId("box-a"))?.semanticState).toBe("current-range");
  });

  it("labels the vault root with the supplied localized copy", () => {
    expect(projectNavigation(buildInput()).rows.find((row) => row.id === navigationFolderId(""))).toMatchObject({
      label: "Root /",
    });
    expect(projectNavigation(buildInput({ rootFolderLabel: "根目录 /" }))
      .rows.find((row) => row.id === navigationFolderId(""))?.label).toBe("根目录 /");
  });

  it("matches the localized root folder label", () => {
    expect(ids(projectNavigation(buildInput({ query: "root" })).rows)).toContain(navigationFolderId(""));
    expect(ids(projectNavigation(buildInput({ query: "根目录", rootFolderLabel: "根目录 /" })).rows))
      .toContain(navigationFolderId(""));
  });

  it("omits malformed rows without disturbing valid siblings", () => {
    const projection = projectNavigation(buildInput({
      favorites: [
        { kind: "file", ref: "", label: "Invalid", icon: "file", count: 0, missing: false },
        { kind: "file", ref: "ok.md", label: "Okay", icon: "file", count: 0, missing: false },
      ],
      boxes: [
        { id: "", name: "Invalid", cardCount: 0 },
        { id: "ok", name: "Okay", cardCount: 0 },
      ],
    }));
    expect(ids(projection.rows)).toContain(navigationFavoriteId("file", "ok.md"));
    expect(ids(projection.rows)).toContain(navigationBoxId("ok"));
    expect(ids(projection.rows)).not.toContain(navigationFavoriteId("file", ""));
    expect(ids(projection.rows)).not.toContain(navigationBoxId(""));
  });

  it("projects sections, rows, and ARIA positions from the supplied section order", () => {
    const order = ["boxes", "tags", "folders", "favorites"] as const;
    const projection = projectNavigation(buildInput({ sectionOrder: order }));
    expect(projection.sections.map((section) => section.section)).toEqual([...order]);
    expect(projection.rows[0]?.id).toBe(navigationSectionId("boxes"));
    const sectionRows = projection.rows.filter((row) => row.kind === "section");
    expect(sectionRows.map((row) => ({
      section: row.section, positionInSet: row.positionInSet, setSize: row.setSize,
    }))).toEqual(order.map((section, index) => ({
      section, positionInSet: index + 1, setSize: 4,
    })));
  });

  it("normalizes a malformed section order before projecting", () => {
    const projection = projectNavigation(buildInput({
      sectionOrder: ["tags", "tags", "nope", 7] as unknown as NavigationProjectionInput["sectionOrder"],
    }));
    expect(projection.sections.map((section) => section.section)).toEqual([
      "tags", "favorites", "folders", "boxes",
    ]);
  });

  it("keeps reordered relative sequence and filtered ARIA positions under query", () => {
    const projection = projectNavigation(buildInput({
      sectionOrder: ["boxes", "tags", "folders", "favorites"],
      query: "current",
    }));
    expect(projection.sections.map((section) => section.section)).toEqual(["tags", "favorites"]);
    const sectionRows = projection.rows.filter((row) => row.kind === "section");
    expect(sectionRows).toHaveLength(2);
    expect(sectionRows[0]).toMatchObject({ section: "tags", positionInSet: 1, setSize: 2 });
    expect(sectionRows[1]).toMatchObject({ section: "favorites", positionInSet: 2, setSize: 2 });
  });
});

describe("resolveNavigationFocus", () => {
  const section = (id: string, semanticState: NavigationRow["semanticState"] = "none"): NavigationRow => ({
    id,
    kind: "section",
    section: "folders",
    parentId: null,
    level: 1,
    positionInSet: 1,
    setSize: 1,
    expandable: true,
    expanded: true,
    disabled: false,
    semanticState,
    label: id,
    fullPath: null,
    count: 0,
    icon: null,
    menuTarget: { section: "folders", scope: "header" },
  });

  it("prefers stable ID, then current range, then prior index, then first section", () => {
    const previous = [section("a"), section("b"), section("c")];
    expect(resolveNavigationFocus(previous, [section("a"), section("b")], "b")).toBe("b");
    expect(resolveNavigationFocus(previous, [section("a"), section("range", "current-range")], "c")).toBe("range");
    expect(resolveNavigationFocus(previous, [section("a"), section("x")], "c")).toBe("x");
    expect(resolveNavigationFocus([], [section("first")], null)).toBe("first");
    expect(resolveNavigationFocus(previous, [], "b")).toBeNull();
  });
});
