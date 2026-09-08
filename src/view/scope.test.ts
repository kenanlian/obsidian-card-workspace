import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class TFile {},
  TFolder: class TFolder {},
}));

import { TFile, TFolder } from "obsidian";
import { DEFAULT_GROUP_SPEC } from "../card-grouping-settings";
import type { CardBoxDefinition } from "./types";
import {
  createBoxScope,
  createFolderScope,
  createLinksScope,
  isBoxScope,
  isCurrentBoxId,
  isCurrentFolderPath,
  isFolderScope,
  isLinksScope,
  normalizeScopePath,
  resolveBrowseIncludeSubfolders,
  scopeDisplayPath,
  scopeIdentity,
  scopesEqual,
  serializeScopeKey,
  validateScope,
} from "./scope";

const SORT = { field: "mtime", direction: "desc" } as const;

function createBox(id: string = "box-1"): CardBoxDefinition {
  return {
    id,
    name: "Ideas",
    rules: [],
    manualPaths: [],
    excludedPaths: [],
    pinnedPaths: [],
    sort: SORT,
    group: { ...DEFAULT_GROUP_SPEC },
  };
}

function createApp(root: unknown, entries: Record<string, unknown> = {}): never {
  return {
    vault: {
      getRoot: vi.fn(() => root),
      getAbstractFileByPath: vi.fn((path: string) => entries[path] ?? null),
    },
  } as never;
}

describe("scope construction and discrimination", () => {
  it("normalizes both vault-root spellings to the same folder scope", () => {
    expect(normalizeScopePath("/")).toBe("");
    expect(normalizeScopePath("")).toBe("");
    expect(createFolderScope("/", true)).toEqual(createFolderScope("", true));
  });

  it("keeps real folder paths and creates box and links scopes unchanged", () => {
    expect(createFolderScope("notes/ideas", false)).toEqual({
      kind: "folder",
      path: "notes/ideas",
      includeSubfolders: false,
    });
    expect(createBoxScope("box-1")).toEqual({ kind: "box", boxId: "box-1" });
    expect(createLinksScope("notes/a.md", "backlinks")).toEqual({
      kind: "links",
      notePath: "notes/a.md",
      direction: "backlinks",
    });
    expect(createLinksScope("notes/a.md", "outgoing")).toEqual({
      kind: "links",
      notePath: "notes/a.md",
      direction: "outgoing",
    });
  });

  it("exhaustively discriminates folder, box, and links scopes", () => {
    const folder = createFolderScope("notes", true);
    const box = createBoxScope("box-1");
    const backlinks = createLinksScope("notes/a.md", "backlinks");
    const outgoing = createLinksScope("notes/a.md", "outgoing");

    expect([isFolderScope(folder), isBoxScope(folder), isLinksScope(folder)]).toEqual([true, false, false]);
    expect([isFolderScope(box), isBoxScope(box), isLinksScope(box)]).toEqual([false, true, false]);
    expect([isFolderScope(backlinks), isBoxScope(backlinks), isLinksScope(backlinks)]).toEqual([false, false, true]);
    expect([isFolderScope(outgoing), isBoxScope(outgoing), isLinksScope(outgoing)]).toEqual([false, false, true]);
  });
});

describe("scopesEqual", () => {
  it("compares every folder field", () => {
    expect(scopesEqual(createFolderScope("notes", true), createFolderScope("notes", true))).toBe(true);
    expect(scopesEqual(createFolderScope("notes", true), createFolderScope("notes", false))).toBe(false);
    expect(scopesEqual(createFolderScope("notes", true), createFolderScope("other", true))).toBe(false);
  });

  it("compares box identity and rejects cross-kind equality", () => {
    expect(scopesEqual(createBoxScope("box-1"), createBoxScope("box-1"))).toBe(true);
    expect(scopesEqual(createBoxScope("box-1"), createBoxScope("box-2"))).toBe(false);
    expect(scopesEqual(createFolderScope("", true), createBoxScope("box-1"))).toBe(false);
    expect(scopesEqual(createBoxScope("box-1"), createFolderScope("", true))).toBe(false);
  });

  it("compares links notePath and direction; direction is part of identity", () => {
    const backlinks = createLinksScope("notes/a.md", "backlinks");
    const outgoing = createLinksScope("notes/a.md", "outgoing");

    expect(scopesEqual(backlinks, createLinksScope("notes/a.md", "backlinks"))).toBe(true);
    expect(scopesEqual(outgoing, createLinksScope("notes/a.md", "outgoing"))).toBe(true);
    expect(scopesEqual(backlinks, outgoing)).toBe(false);
    expect(scopesEqual(backlinks, createLinksScope("notes/b.md", "backlinks"))).toBe(false);
    expect(scopesEqual(backlinks, createFolderScope("notes/a.md", true))).toBe(false);
    expect(scopesEqual(backlinks, createBoxScope("box-1"))).toBe(false);
    expect(scopesEqual(createFolderScope("", true), backlinks)).toBe(false);
  });
});

describe("serializeScopeKey", () => {
  it("uses the deterministic folder shape and responds to folder and sort fields", () => {
    expect(serializeScopeKey(createFolderScope("notes", true), SORT)).toBe("notes::true::mtime::desc");
    expect(serializeScopeKey(createFolderScope("notes", true), SORT)).toBe(
      serializeScopeKey(createFolderScope("notes", true), SORT),
    );
    expect(serializeScopeKey(createFolderScope("notes", true), SORT)).not.toBe(
      serializeScopeKey(createFolderScope("notes", false), SORT),
    );
    expect(serializeScopeKey(createFolderScope("notes", true), SORT)).not.toBe(
      serializeScopeKey(createFolderScope("notes", true), { field: "name", direction: "asc" }),
    );
  });

  it("uses the box shape and is sensitive to membership signatures", () => {
    const box = createBoxScope("box-1");

    expect(serializeScopeKey(box, SORT, "sig-a")).toBe("box::box-1::mtime::desc::sig-a");
    expect(serializeScopeKey(box, SORT, "sig-a")).not.toBe(serializeScopeKey(box, SORT, "sig-b"));
    expect(serializeScopeKey(box, SORT)).toBe("box::box-1::mtime::desc::");
  });

  it("keeps folder and box key structures distinct", () => {
    expect(serializeScopeKey(createFolderScope("box", true), SORT)).not.toBe(
      serializeScopeKey(createBoxScope("box"), SORT, ""),
    );
  });

  it("uses the links shape and includes notePath, direction, and sort", () => {
    const backlinks = createLinksScope("notes/a.md", "backlinks");
    const outgoing = createLinksScope("notes/a.md", "outgoing");

    expect(serializeScopeKey(backlinks, SORT)).toBe("links::notes/a.md::backlinks::mtime::desc");
    expect(serializeScopeKey(outgoing, SORT)).toBe("links::notes/a.md::outgoing::mtime::desc");
    expect(serializeScopeKey(backlinks, SORT)).not.toBe(serializeScopeKey(outgoing, SORT));
    expect(serializeScopeKey(backlinks, SORT)).not.toBe(
      serializeScopeKey(createLinksScope("notes/b.md", "backlinks"), SORT),
    );
    expect(serializeScopeKey(backlinks, SORT)).not.toBe(
      serializeScopeKey(backlinks, { field: "name", direction: "asc" }),
    );
    expect(serializeScopeKey(backlinks, SORT, "ignored-sig")).toBe(
      "links::notes/a.md::backlinks::mtime::desc",
    );
  });
});

describe("scopeIdentity", () => {
  it("separates folders, recursion flags, and boxes", () => {
    expect(scopeIdentity(createFolderScope("notes", true))).not.toBe(
      scopeIdentity(createFolderScope("archive", true)),
    );
    expect(scopeIdentity(createFolderScope("notes", true))).not.toBe(
      scopeIdentity(createFolderScope("notes", false)),
    );
    expect(scopeIdentity(createBoxScope("box-1"))).not.toBe(scopeIdentity(createBoxScope("box-2")));
    expect(scopeIdentity(createFolderScope("", true))).toBe("folder::true");
    expect(scopeIdentity(createBoxScope("box-1"))).toBe("box:box-1");
    expect(scopeIdentity(createLinksScope("notes/a.md", "backlinks"))).toBe("links:notes/a.md:backlinks");
    expect(scopeIdentity(createLinksScope("notes/a.md", "outgoing"))).toBe("links:notes/a.md:outgoing");
    expect(scopeIdentity(createLinksScope("notes/a.md", "backlinks"))).not.toBe(
      scopeIdentity(createLinksScope("notes/a.md", "outgoing")),
    );
    expect(scopeIdentity(createLinksScope("notes/a.md", "backlinks"))).not.toBe(
      scopeIdentity(createLinksScope("notes/b.md", "backlinks")),
    );
  });

  it("ignores sort, unlike serializeScopeKey", () => {
    const folder = createFolderScope("notes", true);
    const box = createBoxScope("box-1");
    const otherSort = { field: "name", direction: "asc" } as const;

    expect(scopeIdentity(folder)).toBe(scopeIdentity(folder));
    expect(serializeScopeKey(folder, SORT)).not.toBe(serializeScopeKey(folder, otherSort));
    expect(serializeScopeKey(box, SORT)).not.toBe(serializeScopeKey(box, otherSort));
  });
});

describe("scopeDisplayPath", () => {
  it("returns folder paths and an empty path for boxes and links", () => {
    expect(scopeDisplayPath(createFolderScope("notes", true))).toBe("notes");
    expect(scopeDisplayPath(createBoxScope("box-1"))).toBe("");
    expect(scopeDisplayPath(createLinksScope("notes/a.md", "backlinks"))).toBe("");
    expect(scopeDisplayPath(createLinksScope("notes/a.md", "outgoing"))).toBe("");
  });
});

describe("current-folder, current-box, and browse-include-subfolders", () => {
  it("treats links as having no current folder or box and using the browse fallback", () => {
    const backlinks = createLinksScope("notes/a.md", "backlinks");
    const outgoing = createLinksScope("notes/a.md", "outgoing");

    expect(isCurrentFolderPath(backlinks, "notes")).toBe(false);
    expect(isCurrentFolderPath(outgoing, "")).toBe(false);
    expect(isCurrentBoxId(backlinks, "box-1")).toBe(false);
    expect(isCurrentBoxId(outgoing, "box-1")).toBe(false);
    expect(resolveBrowseIncludeSubfolders(backlinks, true)).toBe(true);
    expect(resolveBrowseIncludeSubfolders(outgoing, false)).toBe(false);
  });
});

describe("validateScope", () => {
  it("validates root folders through getRoot", () => {
    expect(validateScope(createApp(new TFolder()), createFolderScope("", true), [])).toBe(true);
    expect(validateScope(createApp({ path: "" }), createFolderScope("", true), [])).toBe(false);
  });

  it("validates non-root folder paths through getAbstractFileByPath", () => {
    const app = createApp(new TFolder(), { notes: new TFolder(), "notes/a.md": { path: "notes/a.md" } });

    expect(validateScope(app, createFolderScope("notes", true), [])).toBe(true);
    expect(validateScope(app, createFolderScope("missing", true), [])).toBe(false);
    expect(validateScope(app, createFolderScope("notes/a.md", true), [])).toBe(false);
  });

  it("accepts existing box IDs and rejects missing box IDs", () => {
    const app = createApp(new TFolder());

    expect(validateScope(app, createBoxScope("box-1"), [createBox()])).toBe(true);
    expect(validateScope(app, createBoxScope("box-2"), [createBox()])).toBe(false);
  });

  it("validates links scopes when notePath resolves to a TFile, in both directions", () => {
    const note = new TFile();
    const app = createApp(new TFolder(), {
      "notes/a.md": note,
      notes: new TFolder(),
    });

    expect(validateScope(app, createLinksScope("notes/a.md", "backlinks"), [])).toBe(true);
    expect(validateScope(app, createLinksScope("notes/a.md", "outgoing"), [])).toBe(true);
    expect(validateScope(app, createLinksScope("notes", "backlinks"), [])).toBe(false);
    expect(validateScope(app, createLinksScope("missing.md", "outgoing"), [])).toBe(false);
  });
});

describe("exhaustive scope dispatch guards", () => {
  it("throws on an unknown scope kind instead of silently classifying it as folder", () => {
    const futureScope = { kind: "future", path: "links" } as unknown as ReturnType<typeof createFolderScope>;
    const app = createApp(new TFolder());

    expect(() => serializeScopeKey(futureScope, { field: "mtime", direction: "desc" }))
      .toThrow(/Unhandled card source/);
    expect(() => validateScope(app, futureScope, [])).toThrow(/Unhandled card source/);
  });
});
