import { describe, expect, it } from "vitest";
import {
  buildTagTree,
  collectAncestorTagPaths,
  collectExpandableTagPaths,
  flattenVisibleTagTree,
  normalizeTagPath,
  resolveTagSelection,
  tagPathMatchesFilter,
} from "./tag-tree";

describe("normalizeTagPath", () => {
  it("normalizes case, leading hash, spacing, and empty segments", () => {
    expect(normalizeTagPath(" #Work / AI // Harness ")).toBe("work/ai/harness");
  });
});

describe("resolveTagSelection", () => {
  it("replaces the filter on a plain activation", () => {
    expect(resolveTagSelection(["work", "personal"], "notes", false)).toEqual(["notes"]);
  });

  it("collapses a multi-tag filter to the activated tag", () => {
    expect(resolveTagSelection(["work", "personal"], "work", false)).toEqual(["work"]);
  });

  it("clears the filter when the only active tag is activated again", () => {
    expect(resolveTagSelection(["#Work"], "work", false)).toEqual([]);
  });

  it("adds to the filter on an additive activation", () => {
    expect(resolveTagSelection(["work"], "#Personal", true)).toEqual(["work", "personal"]);
  });

  it("removes only the activated tag on an additive activation", () => {
    expect(resolveTagSelection(["work", "personal"], "Work", true)).toEqual(["personal"]);
  });

  it("returns the same array for an empty tag so callers can skip the update", () => {
    const activeTags = ["work"];
    expect(resolveTagSelection(activeTags, " # ", false)).toBe(activeTags);
  });
});

describe("buildTagTree", () => {
  it("builds a normalized hierarchy and synthesizes missing parents", () => {
    const tree = buildTagTree(["#领域/AI/harness"]);

    expect(tree).toEqual([
      {
        tag: "领域",
        displayTag: "领域",
        label: "领域",
        depth: 0,
        synthetic: true,
        children: [
          {
            tag: "领域/ai",
            displayTag: "领域/AI",
            label: "AI",
            depth: 1,
            synthetic: true,
            children: [
              {
                tag: "领域/ai/harness",
                displayTag: "领域/AI/harness",
                label: "harness",
                depth: 2,
                synthetic: false,
                children: [],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("marks exact parent tags as non-synthetic and sorts siblings", () => {
    const tree = buildTagTree(["Project/zeta", "Project", "Project/Alpha"]);

    expect(tree[0]?.synthetic).toBe(false);
    expect(tree[0]?.displayTag).toBe("Project");
    expect(tree[0]?.children.map((child) => child.label)).toEqual(["Alpha", "zeta"]);
  });

  it("chooses deterministic synthetic parent casing regardless of input order", () => {
    const firstTree = buildTagTree(["work/ML", "Work/AI"]);
    const secondTree = buildTagTree(["Work/AI", "work/ML"]);

    expect(firstTree[0]?.displayTag).toBe("Work");
    expect(secondTree[0]?.displayTag).toBe("Work");
    expect(firstTree[0]).toEqual(secondTree[0]);
  });

  it("prefers exact parent casing over descendant-derived casing", () => {
    const firstTree = buildTagTree(["WORK/AI", "work"]);
    const secondTree = buildTagTree(["work", "WORK/AI"]);

    expect(firstTree[0]?.displayTag).toBe("work");
    expect(firstTree[0]?.synthetic).toBe(false);
    expect(secondTree[0]?.displayTag).toBe("work");
    expect(secondTree[0]?.synthetic).toBe(false);
  });

  it("chooses deterministic display casing for duplicate exact normalized tags", () => {
    const firstTree = buildTagTree(["work/ai", "Work/AI"]);
    const secondTree = buildTagTree(["Work/AI", "work/ai"]);

    expect(firstTree[0]?.children[0]?.displayTag).toBe("Work/AI");
    expect(secondTree[0]?.children[0]?.displayTag).toBe("Work/AI");
  });
});

describe("collectAncestorTagPaths", () => {
  it("returns ancestor paths for a selected nested tag", () => {
    expect(collectAncestorTagPaths("project/work")).toEqual(["project"]);
    expect(collectAncestorTagPaths("project/home")).toEqual(["project"]);
    expect(collectAncestorTagPaths("area")).toEqual([]);
  });
});

describe("flattenVisibleTagTree", () => {
  it("returns only expanded descendants", () => {
    const tree = buildTagTree(["project/alpha/one", "project/beta"]);

    expect(flattenVisibleTagTree(tree, new Set())).toEqual([
      {
        tag: "project",
        displayTag: "project",
        label: "project",
        depth: 0,
        synthetic: true,
        hasChildren: true,
        descendantCount: 3,
        selectable: true,
      },
    ]);

    expect(flattenVisibleTagTree(tree, new Set(["project", "project/alpha"]))).toEqual([
      {
        tag: "project",
        displayTag: "project",
        label: "project",
        depth: 0,
        synthetic: true,
        hasChildren: true,
        descendantCount: 3,
        selectable: true,
      },
      {
        tag: "project/alpha",
        displayTag: "project/alpha",
        label: "alpha",
        depth: 1,
        synthetic: true,
        hasChildren: true,
        descendantCount: 1,
        selectable: true,
      },
      {
        tag: "project/alpha/one",
        displayTag: "project/alpha/one",
        label: "one",
        depth: 2,
        synthetic: false,
        hasChildren: false,
        descendantCount: 0,
        selectable: true,
      },
      {
        tag: "project/beta",
        displayTag: "project/beta",
        label: "beta",
        depth: 1,
        synthetic: false,
        hasChildren: false,
        descendantCount: 0,
        selectable: true,
      },
    ]);
  });

  it("keeps synthetic parents selectable when flattening visible nodes", () => {
    const tree = buildTagTree(["project/work", "area"]);

    expect(flattenVisibleTagTree(tree, new Set())).toEqual([
      {
        tag: "area",
        displayTag: "area",
        label: "area",
        depth: 0,
        synthetic: false,
        hasChildren: false,
        descendantCount: 0,
        selectable: true,
      },
      {
        tag: "project",
        displayTag: "project",
        label: "project",
        depth: 0,
        synthetic: true,
        hasChildren: true,
        descendantCount: 1,
        selectable: true,
      },
    ]);
  });
});

describe("collectExpandableTagPaths", () => {
  it("collects every non-leaf tag path", () => {
    const tree = buildTagTree(["a/b/c", "a/d"]);
    expect(collectExpandableTagPaths(tree)).toEqual(["a", "a/b"]);
  });
});

describe("tagPathMatchesFilter", () => {
  it("matches exact and descendant tag paths only", () => {
    expect(tagPathMatchesFilter("领域/ai/harness", "领域")).toBe(true);
    expect(tagPathMatchesFilter("领域/ai/harness", "领域/ai")).toBe(true);
    expect(tagPathMatchesFilter("领域/ai", "领域/ai")).toBe(true);
    expect(tagPathMatchesFilter("领域/ml", "领域/ai")).toBe(false);
    expect(tagPathMatchesFilter("domain-ai", "domain")).toBe(false);
  });
});
