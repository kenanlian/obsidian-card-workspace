import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class MockTFile {
    path = "";
    basename = "";
    name = "";
    extension = "md";
    parent: { path: string } | null = null;
    constructor(path = "") {
      this.path = path;
    }
  },
  getAllTags: (cache: { frontmatter?: { tags?: string[] }; tags?: Array<{ tag: string }> } | null) => {
    const tags: string[] = [];
    if (cache?.frontmatter?.tags) tags.push(...cache.frontmatter.tags);
    if (cache?.tags) tags.push(...cache.tags.map((entry) => entry.tag));
    return tags;
  },
}));

import { TFile, type App } from "obsidian";
import { DEFAULT_GROUP_SPEC } from "../card-grouping-settings";
import type { CardBoxDefinition, FavoriteEntry, Rule } from "./types";
import {
  countRenameTargetConflicts,
  rewriteTagReferencesForDelete,
  rewriteTagReferencesForRename,
  scanTagManagementTargets,
  type TagReferenceSnapshot,
} from "./tag-management";

function markdownFile(path: string): TFile {
  const file = new TFile();
  (file as unknown as { path: string }).path = path;
  return file;
}

function appWithTagsByPath(tagsByPath: Record<string, string[]>): App {
  const filesByPath = new Map<string, TFile>();
  for (const path of Object.keys(tagsByPath)) {
    filesByPath.set(path, markdownFile(path));
  }
  return {
    vault: {
      getMarkdownFiles: () => [...filesByPath.values()],
    },
    metadataCache: {
      getFileCache: (file: TFile) => {
        const tags = tagsByPath[file.path] ?? [];
        return tags.length > 0
          ? { tags: tags.map((tag) => ({ tag: `#${tag}` })) }
          : null;
      },
    },
  } as unknown as App;
}

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    folder: "",
    includeSubfolders: true,
    tags: [],
    properties: [],
    id: "rule-1",
    name: "",
    ...overrides,
  };
}

function box(overrides: Partial<CardBoxDefinition> = {}): CardBoxDefinition {
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

function refs(overrides: Partial<TagReferenceSnapshot> = {}): TagReferenceSnapshot {
  return { favorites: [], filterTags: [], boxes: [], ...overrides };
}

describe("scanTagManagementTargets", () => {
  it("collects carrying files, descendant tags, and plugin references", () => {
    const app = appWithTagsByPath({
      "a.md": ["project", "keep"],
      "b.md": ["project/alpha/deep", "other"],
      "c.md": ["project/beta"],
      "d.md": ["unrelated"],
    });
    const snapshot = refs({
      favorites: [
        { kind: "tag", ref: "project" },
        { kind: "tag", ref: "project/alpha" },
        { kind: "tag", ref: "unrelated" },
        { kind: "folder", ref: "notes" },
      ] satisfies FavoriteEntry[],
      filterTags: ["project", "other"],
      boxes: [
        box({ id: "box-1", rules: [rule({ tags: ["project", "keep"] })] }),
        box({ id: "box-2", rules: [rule({ tags: ["project/beta"] })] }),
        box({ id: "box-3", rules: [rule({ tags: ["unrelated"] })] }),
      ],
    });

    const scan = scanTagManagementTargets(app, "#Project", snapshot);

    expect(scan.files.map((file) => file.path)).toEqual(["a.md", "b.md", "c.md"]);
    expect(scan.descendantTags).toEqual(["project/alpha", "project/alpha/deep", "project/beta"]);
    expect(scan.favoriteCount).toBe(2);
    expect(scan.filterTagCount).toBe(1);
    expect(scan.boxRuleClauseCount).toBe(2);
    expect(scan.affectedBoxCount).toBe(2);
  });

  it("counts each box rule clause separately inside one rule", () => {
    const app = appWithTagsByPath({ "a.md": ["work"] });
    const scan = scanTagManagementTargets(app, "work", refs({
      boxes: [box({ rules: [rule({ tags: ["work", "work/ai", "other"] })] })],
    }));
    expect(scan.boxRuleClauseCount).toBe(2);
    expect(scan.affectedBoxCount).toBe(1);
  });
});

describe("countRenameTargetConflicts", () => {
  it("flags notes already carrying the rename target, but not the renamed subtree itself", () => {
    const app = appWithTagsByPath({
      "a.md": ["source", "target"],
      "b.md": ["source/child", "target/child"],
      "c.md": ["source/other"],
      "d.md": ["target/deep"],
    });

    expect(countRenameTargetConflicts(app, "source", "target")).toBe(2);
    expect(countRenameTargetConflicts(app, "source", "fresh")).toBe(0);
    expect(countRenameTargetConflicts(app, "source", "source")).toBe(0);
  });
});

describe("rewriteTagReferencesForRename", () => {
  it("prefix-maps favorites, filter tags, and box rule clauses including descendants", () => {
    const snapshot = refs({
      favorites: [
        { kind: "tag", ref: "a/b" },
        { kind: "tag", ref: "a/b/child" },
        { kind: "tag", ref: "a/c" },
        { kind: "folder", ref: "notes" },
      ] satisfies FavoriteEntry[],
      filterTags: ["a/b", "a/c", "keep"],
      boxes: [box({ rules: [rule({ tags: ["a/b", "a/b/child", "a/c"] })] })],
    });

    const result = rewriteTagReferencesForRename(snapshot, "a/b", "x/y");

    expect(result.favorites).toEqual([
      { kind: "tag", ref: "x/y" },
      { kind: "tag", ref: "x/y/child" },
      { kind: "tag", ref: "a/c" },
      { kind: "folder", ref: "notes" },
    ]);
    expect(result.filterTags).toEqual(["x/y", "a/c", "keep"]);
    expect(result.boxes[0]?.rules[0]?.tags).toEqual(["x/y", "x/y/child", "a/c"]);
    expect(result.favoritesChanged).toBe(true);
    expect(result.filterChanged).toBe(true);
    expect(result.boxesChanged).toBe(true);
  });

  it("merges favorites and rule clauses that collide after the rename", () => {
    const snapshot = refs({
      favorites: [
        { kind: "tag", ref: "a/b" },
        { kind: "tag", ref: "c/d" },
      ] satisfies FavoriteEntry[],
      filterTags: ["a/b", "c/d"],
      boxes: [box({ rules: [rule({ tags: ["a/b", "c/d"] })] })],
    });

    const result = rewriteTagReferencesForRename(snapshot, "a/b", "c/d");

    expect(result.favorites).toEqual([{ kind: "tag", ref: "c/d" }]);
    expect(result.filterTags).toEqual(["c/d"]);
    expect(result.boxes[0]?.rules[0]?.tags).toEqual(["c/d"]);
  });

  it("keeps references and changed flags untouched when nothing matches", () => {
    const favorites: FavoriteEntry[] = [{ kind: "tag", ref: "work" }];
    const filterTags = ["work"];
    const boxes = [box({ rules: [rule({ tags: ["work"] })] })];
    const result = rewriteTagReferencesForRename({ favorites, filterTags, boxes }, "a/b", "c/d");

    expect(result.favorites).toBe(favorites);
    expect(result.filterTags).toBe(filterTags);
    expect(result.boxes).toBe(boxes);
    expect(result.favoritesChanged).toBe(false);
    expect(result.filterChanged).toBe(false);
    expect(result.boxesChanged).toBe(false);
  });

  it("returns unchanged references for an identity or empty rename", () => {
    const snapshot = refs({
      favorites: [{ kind: "tag", ref: "a/b" }],
      filterTags: ["a/b"],
      boxes: [box({ rules: [rule({ tags: ["a/b"] })] })],
    });
    for (const [from, to] of [["a/b", "a/b"], ["", "c/d"], ["a/b", ""]] as const) {
      const result = rewriteTagReferencesForRename(snapshot, from, to);
      expect(result.favorites).toBe(snapshot.favorites);
      expect(result.boxes).toBe(snapshot.boxes);
    }
  });
});

describe("rewriteTagReferencesForDelete", () => {
  it("removes tag favorites, filter tags, and matching box rule clauses including descendants", () => {
    const snapshot = refs({
      favorites: [
        { kind: "tag", ref: "a/b" },
        { kind: "tag", ref: "a/b/child" },
        { kind: "tag", ref: "a/c" },
        { kind: "folder", ref: "notes" },
      ] satisfies FavoriteEntry[],
      filterTags: ["a/b", "a/b/child", "keep"],
      boxes: [box({ rules: [rule({ tags: ["a/b", "keep"] })] })],
    });

    const result = rewriteTagReferencesForDelete(snapshot, "a/b");

    expect(result.favorites).toEqual([
      { kind: "tag", ref: "a/c" },
      { kind: "folder", ref: "notes" },
    ]);
    expect(result.filterTags).toEqual(["keep"]);
    expect(result.boxes[0]?.rules[0]?.tags).toEqual(["keep"]);
    expect(result.favoritesChanged).toBe(true);
    expect(result.filterChanged).toBe(true);
    expect(result.boxesChanged).toBe(true);
  });

  it("keeps untouched boxes by reference and flags nothing changed when nothing matches", () => {
    const boxes = [box({ id: "box-keep", rules: [rule({ tags: ["keep"] })] })];
    const favorites: FavoriteEntry[] = [{ kind: "folder", ref: "notes" }];
    const result = rewriteTagReferencesForDelete(
      { favorites, filterTags: ["keep"], boxes },
      "a/b",
    );

    expect(result.favorites).toBe(favorites);
    expect(result.boxes).toBe(boxes);
    expect(result.favoritesChanged).toBe(false);
    expect(result.filterChanged).toBe(false);
    expect(result.boxesChanged).toBe(false);
  });
});
