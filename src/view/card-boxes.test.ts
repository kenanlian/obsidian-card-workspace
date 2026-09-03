import { describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import type { PropertyFilterClause } from "../property-filter-settings";
import {
  addManualPaths,
  addRuleToBox,
  createCardBox,
  deleteCardBox,
  duplicateCardBox,
  ensureUniqueBoxName,
  getBoxMembershipSignature,
  reconcileBoxForVaultMutation,
  removeMemberFromBox,
  removeRuleFromBox,
  renameCardBox,
  restoreExcludedPaths,
  translateBrowseScopeToRule,
  upsertCardBox,
} from "./card-boxes";
import { DEFAULT_GROUP_SPEC } from "../card-grouping-settings";
import { deriveRuleId } from "./box-rule-identity";
import type { CardBoxDefinition, Rule } from "./types";

function makeBox(partial: Partial<CardBoxDefinition> = {}): CardBoxDefinition {
  return {
    id: partial.id ?? "box-1",
    name: partial.name ?? "Box",
    rules: partial.rules ?? [],
    manualPaths: partial.manualPaths ?? [],
    excludedPaths: partial.excludedPaths ?? [],
    pinnedPaths: partial.pinnedPaths ?? [],
    sort: partial.sort ?? { field: "mtime", direction: "desc" },
    group: partial.group ?? { ...DEFAULT_GROUP_SPEC },
  };
}

function makeRule(partial: Partial<Rule> = {}): Rule {
  const content = { folder: "", includeSubfolders: true, tags: [], properties: [], ...partial };
  return { ...content, id: partial.id ?? deriveRuleId(content), name: partial.name ?? "" };
}

const statusClause: PropertyFilterClause = { key: "status", values: [{ kind: "text", value: "open" }] };

function createApp(tagsByPath: Record<string, string[]>): App {
  return {
    vault: {
      getAbstractFileByPath(path: string): TFile | null {
        if (!(path in tagsByPath)) {
          return null;
        }
        return { path } as TFile;
      },
    },
    metadataCache: {
      getFileCache(file: TFile) {
        const tags = tagsByPath[file.path];
        if (!tags) {
          return null;
        }
        return { tags: tags.map((tag) => ({ tag: `#${tag}` })) };
      },
    },
  } as unknown as App;
}

describe("naming", () => {
  it("ensures unique names by suffixing", () => {
    const boxes = [makeBox({ id: "a", name: "Ideas" }), makeBox({ id: "b", name: "Ideas (2)" })];
    expect(ensureUniqueBoxName("Ideas", boxes)).toBe("Ideas (3)");
    expect(ensureUniqueBoxName("Fresh", boxes)).toBe("Fresh");
  });

  it("creates boxes with unique id and name", () => {
    const boxes = [makeBox({ id: "a", name: "Ideas" })];
    const created = createCardBox("Ideas", boxes);
    expect(created.name).toBe("Ideas (2)");
    expect(created.id).not.toBe("a");
    expect(created.rules).toEqual([]);
  });
});

describe("crud", () => {
  it("renames without colliding", () => {
    const boxes = [makeBox({ id: "a", name: "A" }), makeBox({ id: "b", name: "B" })];
    const next = renameCardBox(boxes, "b", "A");
    expect(next.find((box) => box.id === "b")?.name).toBe("A (2)");
  });

  it("deletes a box", () => {
    const boxes = [makeBox({ id: "a" }), makeBox({ id: "b" })];
    expect(deleteCardBox(boxes, "a").map((box) => box.id)).toEqual(["b"]);
  });

  it("duplicates a box next to the source", () => {
    const boxes = [makeBox({ id: "a", name: "A", rules: [makeRule({ folder: "P" })] })];
    const next = duplicateCardBox(boxes, "a");
    expect(next).toHaveLength(2);
    expect(next[1].name).toBe("A (copy)");
    expect(next[1].rules).toEqual([makeRule({ folder: "P" })]);
    expect(next[1].id).not.toBe("a");
  });

  it("upserts by id", () => {
    const boxes = [makeBox({ id: "a", name: "A" })];
    const replaced = upsertCardBox(boxes, makeBox({ id: "a", name: "A*" }));
    expect(replaced[0].name).toBe("A*");
    const appended = upsertCardBox(boxes, makeBox({ id: "c", name: "C" }));
    expect(appended.map((box) => box.id)).toEqual(["a", "c"]);
  });
});

describe("rule + membership helpers", () => {
  it("serializes only the membership-defining fields", () => {
    const box = makeBox({
      rules: [makeRule({ folder: "Projects", name: "Client work" })],
      manualPaths: ["Manual.md"],
      excludedPaths: ["Excluded.md"],
      pinnedPaths: ["Pinned.md"],
    });

    // Pinned as a literal: rule identity must stay out of the signature so a
    // vault upgraded from a pre-identity release produces the same bytes and
    // does not trigger a spurious reload.
    expect(getBoxMembershipSignature(box)).toBe(
      '{"rules":[{"folder":"Projects","includeSubfolders":true,"tags":[],"properties":[]}],'
      + '"manual":["Manual.md"],"excluded":["Excluded.md"]}',
    );
    expect(getBoxMembershipSignature({ ...box, name: "Renamed", pinnedPaths: [] }))
      .toBe(getBoxMembershipSignature(box));
  });

  it("ignores rule renames but not rule folder changes in the signature", () => {
    const box = makeBox({ rules: [makeRule({ folder: "Projects" })] });
    const renamed = makeBox({
      rules: [makeRule({ folder: "Projects", id: "custom", name: "Client work" })],
    });
    const moved = makeBox({ rules: [makeRule({ folder: "Archive" })] });

    expect(getBoxMembershipSignature(renamed)).toBe(getBoxMembershipSignature(box));
    expect(getBoxMembershipSignature(moved)).not.toBe(getBoxMembershipSignature(box));
  });

  it("translates a browse scope into a rule with derived identity", () => {
    expect(
      translateBrowseScopeToRule({ folder: "/", includeSubfolders: false, tags: ["wip"] }),
    ).toEqual({
      folder: "",
      includeSubfolders: false,
      tags: ["wip"],
      properties: [],
      id: "r:|false|wip",
      name: "",
    });
  });

  it("bakes normalized property clauses into the translated rule (C2/V-B)", () => {
    const rule = translateBrowseScopeToRule({
      folder: "Projects",
      includeSubfolders: false,
      tags: [],
      properties: [
        { key: "Status", values: [{ kind: "text", value: "open" }, { kind: "text", value: "open" }] },
        "not-a-clause" as never,
      ],
    });
    expect(rule.properties).toEqual([{ key: "status", values: [{ kind: "text", value: "open" }] }]);
    expect(rule.id).toBe('r:Projects|false||[["status",["[\\"t\\",\\"open\\"]"]]]');
  });

  it("carries rule identity and box grouping through clone and duplicate", () => {
    const rule = makeRule({ folder: "Projects", id: "custom", name: "Client work" });
    const group = { dimension: "tag", orderBy: "count", orderDirection: "desc" } as const;
    const source = makeBox({ id: "a", rules: [rule], group });

    const [, copy] = duplicateCardBox([source], "a");

    expect(copy.rules).toEqual([rule]);
    expect(copy.rules[0]).not.toBe(rule);
    expect(copy.group).toEqual(group);
    expect(copy.group).not.toBe(source.group);
  });

  it("defaults a created box to ungrouped and clones an explicit group", () => {
    expect(createCardBox("Box", []).group).toEqual(DEFAULT_GROUP_SPEC);

    const group = { dimension: "folder", orderBy: "name", orderDirection: "asc" } as const;
    const created = createCardBox("Box", [], { group });
    expect(created.group).toEqual(group);
    expect(created.group).not.toBe(group);
  });

  it("dedupes identical rules", () => {
    const box = makeBox({ rules: [makeRule({ folder: "P", tags: ["a", "b"] })] });
    const next = addRuleToBox(box, makeRule({ folder: "P", tags: ["b", "a"] }));
    expect(next.rules).toHaveLength(1);
  });

  it("keeps rules with identical folder+tags but different property clauses (S9/V-B)", () => {
    const box = makeBox({ rules: [makeRule({ folder: "P", tags: ["a"], properties: [statusClause] })] });
    const other = makeRule({
      folder: "P",
      tags: ["a"],
      properties: [{ key: "priority", values: [{ kind: "number", value: 1 }] }],
    });
    expect(addRuleToBox(box, other).rules).toHaveLength(2);
  });

  it("dedupes rules whose clauses use the same keys in a different order (V-B)", () => {
    const clauses: PropertyFilterClause[] = [
      statusClause,
      { key: "priority", values: [{ kind: "missing" }] },
    ];
    const box = makeBox({ rules: [makeRule({ folder: "P", properties: clauses })] });
    const reordered = makeRule({ folder: "P", properties: [...clauses].reverse() });
    expect(addRuleToBox(box, reordered).rules).toHaveLength(1);
  });

  it("deep-isolates duplicated rule property clauses by value (C1/V-B)", () => {
    const rule = makeRule({ folder: "P", properties: [statusClause] });
    const source = makeBox({ id: "a", rules: [rule] });

    const [, copy] = duplicateCardBox([source], "a");

    expect(copy.rules[0]?.properties).toEqual([statusClause]);
    expect(copy.rules[0]?.properties[0]).not.toBe(rule.properties[0]);
    expect(copy.rules[0]?.properties[0]?.values).not.toBe(rule.properties[0]?.values);
    source.rules[0].properties[0].values.push({ kind: "missing" });
    expect(copy.rules[0]?.properties[0]?.values).toEqual([{ kind: "text", value: "open" }]);
  });

  it("embeds rule properties in the membership signature (V-B)", () => {
    const withClauses = makeBox({ rules: [makeRule({ folder: "P", properties: [statusClause] })] });
    const sameClauses = makeBox({ rules: [makeRule({ folder: "P", properties: [statusClause] })] });
    const otherClauses = makeBox({
      rules: [
        makeRule({
          folder: "P",
          properties: [{ key: "status", values: [{ kind: "text", value: "done" }] }],
        }),
      ],
    });

    expect(getBoxMembershipSignature(sameClauses)).toBe(getBoxMembershipSignature(withClauses));
    expect(getBoxMembershipSignature(otherClauses)).not.toBe(getBoxMembershipSignature(withClauses));
  });

  it("removes a rule by index", () => {
    const box = makeBox({ rules: [makeRule({ folder: "P" }), makeRule({ folder: "Q" })] });
    expect(removeRuleFromBox(box, 0).rules).toEqual([makeRule({ folder: "Q" })]);
  });

  it("adds manual paths and clears matching exclusions", () => {
    const box = makeBox({ excludedPaths: ["A.md"] });
    const next = addManualPaths(box, ["A.md", "B.md"]);
    expect(next.manualPaths).toEqual(["A.md", "B.md"]);
    expect(next.excludedPaths).toEqual([]);
  });

  it("removes a manual member without exclusion", () => {
    const app = createApp({ "A.md": [] });
    const box = makeBox({ manualPaths: ["A.md"] });
    const next = removeMemberFromBox(app, box, "A.md");
    expect(next.manualPaths).toEqual([]);
    expect(next.excludedPaths).toEqual([]);
  });

  it("excludes a rule-hit member on removal", () => {
    const app = createApp({ "P/A.md": [] });
    const box = makeBox({ rules: [makeRule({ folder: "P" })] });
    const next = removeMemberFromBox(app, box, "P/A.md");
    expect(next.excludedPaths).toEqual(["P/A.md"]);
  });

  it("restores excluded paths", () => {
    const box = makeBox({ excludedPaths: ["A.md", "B.md"] });
    expect(restoreExcludedPaths(box, ["A.md"]).excludedPaths).toEqual(["B.md"]);
    expect(restoreExcludedPaths(box).excludedPaths).toEqual([]);
  });
});

describe("reconcileBoxForVaultMutation", () => {
  it("migrates file renames across path lists", () => {
    const box = makeBox({
      manualPaths: ["A.md"],
      excludedPaths: ["B.md"],
      pinnedPaths: ["A.md"],
    });
    const next = reconcileBoxForVaultMutation(box, {
      eventType: "rename",
      path: "A2.md",
      oldPath: "A.md",
      isFolder: false,
    });
    expect(next.manualPaths).toEqual(["A2.md"]);
    expect(next.pinnedPaths).toEqual(["A2.md"]);
    expect(next.excludedPaths).toEqual(["B.md"]);
  });

  it("prefix-migrates folder renames including rule folders", () => {
    const box = makeBox({
      rules: [makeRule({ folder: "Projects" }), makeRule({ folder: "" })],
      manualPaths: ["Projects/A.md"],
      pinnedPaths: ["Projects/Sub/B.md"],
    });
    const next = reconcileBoxForVaultMutation(box, {
      eventType: "rename",
      path: "Work",
      oldPath: "Projects",
      isFolder: true,
    });
    expect(next.rules[0].folder).toBe("Work");
    expect(next.rules[1].folder).toBe("");
    expect(next.manualPaths).toEqual(["Work/A.md"]);
    expect(next.pinnedPaths).toEqual(["Work/Sub/B.md"]);
  });

  it("drops deleted files from path lists", () => {
    const box = makeBox({ manualPaths: ["A.md", "B.md"], pinnedPaths: ["A.md"] });
    const next = reconcileBoxForVaultMutation(box, {
      eventType: "delete",
      path: "A.md",
      oldPath: null,
      isFolder: false,
    });
    expect(next.manualPaths).toEqual(["B.md"]);
    expect(next.pinnedPaths).toEqual([]);
  });

  it("drops deleted folder contents but leaves rules dangling", () => {
    const box = makeBox({
      rules: [makeRule({ folder: "Projects" })],
      manualPaths: ["Projects/A.md", "Other/B.md"],
    });
    const next = reconcileBoxForVaultMutation(box, {
      eventType: "delete",
      path: "Projects",
      oldPath: null,
      isFolder: true,
    });
    expect(next.manualPaths).toEqual(["Other/B.md"]);
    expect(next.rules).toEqual([makeRule({ folder: "Projects" })]);
  });

  it("returns the same reference when nothing changes", () => {
    const box = makeBox({ manualPaths: ["A.md"] });
    const next = reconcileBoxForVaultMutation(box, {
      eventType: "modify",
      path: "A.md",
      oldPath: null,
      isFolder: false,
    });
    expect(next).toBe(box);
  });
});
