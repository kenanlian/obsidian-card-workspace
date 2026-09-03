import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { inFolderScope, isBoxMember, matchesRule } from "./card-box-membership";
import { DEFAULT_GROUP_SPEC } from "../card-grouping-settings";
import { deriveRuleId } from "./box-rule-identity";
import type { PropertyFilterClause, PropertyScalarRef } from "../property-filter-settings";
import type { CardBoxDefinition, Rule } from "./types";

interface FileFixture {
  path: string;
  tags: string[];
  frontmatter?: Record<string, unknown> | null;
  noCache?: boolean;
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
        if (!fixture || fixture.noCache === true) {
          return null;
        }
        const cache: { tags: Array<{ tag: string }>; frontmatter?: Record<string, unknown> | null } = {
          tags: fixture.tags.map((tag) => ({ tag: `#${tag}` })),
        };
        if (fixture.frontmatter !== undefined) {
          cache.frontmatter = fixture.frontmatter;
        }
        return cache;
      },
    },
  } as unknown as App;
}

const text = (value: string): PropertyScalarRef => ({ kind: "text", value });
const missing: PropertyScalarRef = { kind: "missing" };

function clause(key: string, ...values: PropertyScalarRef[]): PropertyFilterClause {
  return { key, values };
}

function makeRule(partial: Partial<Rule> = {}): Rule {
  const content = {
    folder: "",
    includeSubfolders: true,
    tags: [],
    properties: [],
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
  it("matches folder-only rules without touching tags or the metadata cache", () => {
    const app = createApp([{ path: "Projects/A.md", tags: [] }]);
    const getFileCache = vi.spyOn(app.metadataCache, "getFileCache");
    expect(matchesRule(app, "Projects/A.md", makeRule({ folder: "Projects" }))).toBe(true);
    expect(getFileCache).not.toHaveBeenCalled();
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

  it("applies AND semantics across folder, tags, and property clauses", () => {
    const app = createApp([{ path: "Projects/A.md", tags: ["wip"], frontmatter: { status: "open" } }]);
    expect(
      matchesRule(
        app,
        "Projects/A.md",
        makeRule({ folder: "Projects", tags: ["wip"], properties: [clause("status", text("open"))] }),
      ),
    ).toBe(true);
    expect(
      matchesRule(
        app,
        "Projects/A.md",
        makeRule({ folder: "Projects", tags: ["wip"], properties: [clause("status", text("done"))] }),
      ),
    ).toBe(false);
    expect(
      matchesRule(
        app,
        "Projects/A.md",
        makeRule({ folder: "Projects", tags: ["other"], properties: [clause("status", text("open"))] }),
      ),
    ).toBe(false);
    expect(
      matchesRule(
        app,
        "Projects/A.md",
        makeRule({ folder: "Other", tags: ["wip"], properties: [clause("status", text("open"))] }),
      ),
    ).toBe(false);
  });

  it("matches a missing clause on markdown without the key or frontmatter", () => {
    const app = createApp([
      { path: "A.md", tags: [], frontmatter: {} },
      { path: "B.md", tags: [] },
      { path: "C.md", tags: [], frontmatter: { status: "open" } },
    ]);
    const rule = makeRule({ properties: [clause("status", missing)] });
    expect(matchesRule(app, "A.md", rule)).toBe(true);
    expect(matchesRule(app, "B.md", rule)).toBe(true);
    expect(matchesRule(app, "C.md", rule)).toBe(false);
  });

  it("lets non-markdown files match only all-missing clause sets", () => {
    const app = createApp([{ path: "Board.canvas", tags: [] }]);
    expect(
      matchesRule(app, "Board.canvas", makeRule({ properties: [clause("status", missing)] })),
    ).toBe(true);
    expect(
      matchesRule(app, "Board.canvas", makeRule({ properties: [clause("status", text("open"))] })),
    ).toBe(false);
  });

  it("reads the metadata cache exactly once per evaluation", () => {
    const app = createApp([
      { path: "Projects/A.md", tags: ["wip"], frontmatter: { status: "open" } },
    ]);
    const getFileCache = vi.spyOn(app.metadataCache, "getFileCache");
    matchesRule(
      app,
      "Projects/A.md",
      makeRule({ folder: "Projects", tags: ["wip"], properties: [clause("status", text("open"))] }),
    );
    expect(getFileCache).toHaveBeenCalledTimes(1);
    expect(getFileCache).toHaveBeenCalledWith(
      expect.objectContaining({ path: "Projects/A.md" }),
    );
  });

  it("never matches valued clauses for a key absent from the vault", () => {
    const app = createApp([{ path: "A.md", tags: [], frontmatter: { other: "x" } }]);
    expect(
      matchesRule(app, "A.md", makeRule({ properties: [clause("status", text("open"))] })),
    ).toBe(false);
  });

  it("always matches missing clauses for a key absent from the vault", () => {
    const app = createApp([{ path: "A.md", tags: [], frontmatter: { other: "x" } }]);
    expect(
      matchesRule(app, "A.md", makeRule({ properties: [clause("status", missing)] })),
    ).toBe(true);
  });

  it("evaluates against the current cache when metadata is not ready", () => {
    const app = createApp([{ path: "A.md", tags: ["wip"], noCache: true }]);
    expect(matchesRule(app, "A.md", makeRule({ tags: ["wip"] }))).toBe(false);
    expect(
      matchesRule(app, "A.md", makeRule({ properties: [clause("status", text("open"))] })),
    ).toBe(false);
    expect(
      matchesRule(app, "A.md", makeRule({ properties: [clause("status", missing)] })),
    ).toBe(true);
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

  it("keeps manual bypass and exclusion semantics over property clauses", () => {
    const app = createApp([
      { path: "Projects/manual.md", tags: [], frontmatter: { status: "done" } },
      { path: "Projects/rule-hit.md", tags: [], frontmatter: { status: "open" } },
    ]);
    const rule = makeRule({
      folder: "Projects",
      properties: [clause("status", text("open"))],
    });
    expect(
      isBoxMember(app, "Projects/manual.md", makeBox({ rules: [rule], manualPaths: ["Projects/manual.md"] })),
    ).toBe(true);
    expect(
      isBoxMember(app, "Projects/rule-hit.md", makeBox({ rules: [rule], excludedPaths: ["Projects/rule-hit.md"] })),
    ).toBe(false);
  });

  it("treats a rule-less box as purely manual", () => {
    const app = createApp([{ path: "Note.md", tags: [] }]);
    const box = makeBox({ manualPaths: ["Note.md"] });
    expect(isBoxMember(app, "Note.md", box)).toBe(true);
    expect(isBoxMember(app, "Other.md", box)).toBe(false);
  });
});
