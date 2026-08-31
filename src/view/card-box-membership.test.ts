import { describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import { inFolderScope, isBoxMember, matchesRule } from "./card-box-membership";
import { DEFAULT_GROUP_SPEC } from "../card-grouping-settings";
import { deriveRuleId } from "./box-rule-identity";
import type { CardBoxDefinition, Rule } from "./types";

interface FileFixture {
  path: string;
  tags: string[];
}

function createApp(files: FileFixture[]): App {
  const byPath = new Map<string, FileFixture>();
  for (const file of files) {
    byPath.set(file.path, file);
  }

  return {
    vault: {
      getAbstractFileByPath(path: string): TFile | null {
        const fixture = byPath.get(path);
        if (!fixture) {
          return null;
        }
        return {
          path: fixture.path,
          basename: fixture.path.split("/").pop()?.replace(/\.md$/, "") ?? fixture.path,
        } as TFile;
      },
    },
    metadataCache: {
      getFileCache(file: TFile) {
        const fixture = byPath.get(file.path);
        if (!fixture) {
          return null;
        }
        return { tags: fixture.tags.map((tag) => ({ tag: `#${tag}` })) };
      },
    },
  } as unknown as App;
}

function makeRule(partial: Partial<Rule> = {}): Rule {
  const content = {
    folder: "",
    includeSubfolders: true,
    tags: [],
    ...partial,
  };
  return { ...content, id: partial.id ?? deriveRuleId(content), name: partial.name ?? "" };
}

function makeBox(partial: Partial<CardBoxDefinition> = {}): CardBoxDefinition {
  return {
    id: "box-1",
    name: "Box",
    rules: [],
    manualPaths: [],
    excludedPaths: [],
    pinnedPaths: [],
    sort: { field: "mtime", direction: "desc" },
    group: { ...DEFAULT_GROUP_SPEC },
    ...partial,
  };
}

describe("inFolderScope", () => {
  it("treats empty folder as vault root", () => {
    expect(inFolderScope("Note.md", "", true)).toBe(true);
    expect(inFolderScope("Sub/Note.md", "", true)).toBe(true);
    expect(inFolderScope("Sub/Note.md", "", false)).toBe(false);
    expect(inFolderScope("Note.md", "", false)).toBe(true);
  });

  it("scopes to a folder with and without subfolders", () => {
    expect(inFolderScope("Projects/A.md", "Projects", false)).toBe(true);
    expect(inFolderScope("Projects/Sub/A.md", "Projects", false)).toBe(false);
    expect(inFolderScope("Projects/Sub/A.md", "Projects", true)).toBe(true);
    expect(inFolderScope("Other/A.md", "Projects", true)).toBe(false);
  });
});

describe("matchesRule", () => {
  it("matches folder-only rules without touching tags", () => {
    const app = createApp([{ path: "Projects/A.md", tags: [] }]);
    expect(matchesRule(app, "Projects/A.md", makeRule({ folder: "Projects" }))).toBe(true);
  });

  it("applies AND semantics across tags", () => {
    const app = createApp([{ path: "Projects/A.md", tags: ["wip", "design"] }]);
    expect(
      matchesRule(app, "Projects/A.md", makeRule({ folder: "Projects", tags: ["wip", "design"] })),
    ).toBe(true);
    expect(
      matchesRule(app, "Projects/A.md", makeRule({ folder: "Projects", tags: ["wip", "missing"] })),
    ).toBe(false);
  });

  it("returns false when a tagged rule targets a missing file", () => {
    const app = createApp([]);
    expect(matchesRule(app, "Ghost.md", makeRule({ tags: ["wip"] }))).toBe(false);
  });
});

describe("isBoxMember", () => {
  it("includes manual paths regardless of rules or exclusions", () => {
    const app = createApp([{ path: "Note.md", tags: [] }]);
    const box = makeBox({ manualPaths: ["Note.md"], excludedPaths: ["Note.md"] });
    expect(isBoxMember(app, "Note.md", box)).toBe(true);
  });

  it("combines rules with OR semantics", () => {
    const app = createApp([
      { path: "Projects/A.md", tags: [] },
      { path: "Ideas/B.md", tags: [] },
    ]);
    const box = makeBox({
      rules: [makeRule({ folder: "Projects" }), makeRule({ folder: "Ideas" })],
    });
    expect(isBoxMember(app, "Projects/A.md", box)).toBe(true);
    expect(isBoxMember(app, "Ideas/B.md", box)).toBe(true);
    expect(isBoxMember(app, "Other/C.md", box)).toBe(false);
  });

  it("excludes rule hits listed in excludedPaths", () => {
    const app = createApp([{ path: "Projects/A.md", tags: [] }]);
    const box = makeBox({
      rules: [makeRule({ folder: "Projects" })],
      excludedPaths: ["Projects/A.md"],
    });
    expect(isBoxMember(app, "Projects/A.md", box)).toBe(false);
  });

  it("treats a rule-less box as purely manual", () => {
    const app = createApp([{ path: "Note.md", tags: [] }]);
    const box = makeBox({ manualPaths: ["Note.md"] });
    expect(isBoxMember(app, "Note.md", box)).toBe(true);
    expect(isBoxMember(app, "Other.md", box)).toBe(false);
  });
});
