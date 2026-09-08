import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class MockTFile {
    path: string;

    constructor(path: string = "") {
      this.path = path;
    }
  }

  return { App: class MockApp {}, TFile: MockTFile };
});

import { TFile, type App } from "obsidian";
import { createBoxScope, createFolderScope, createLinksScope, isLinksScope } from "./scope";
import {
  collectLinksFiles,
  isLinksMember,
  isPathRelevantToLinksScope,
  resolveLinksFollowScope,
} from "./links-sources";

function file(path: string): TFile {
  const result = new TFile();
  result.path = path;
  return result;
}

function createApp(
  files: Record<string, TFile | null>,
  resolvedLinks: Record<string, Record<string, number> | undefined | null> = {},
): App {
  return {
    vault: {
      getAbstractFileByPath: vi.fn((path: string) => files[path] ?? null),
    },
    metadataCache: {
      resolvedLinks,
    },
  } as unknown as App;
}

const NOTE_A = "notes/A.md";
const NOTE_B = "notes/B.md";
const NOTE_C = "notes/C.md";
const NOTE_D = "notes/D.md";
const IMAGE = "notes/image.png";
const VANISHED = "notes/Vanished.md";

const files = {
  [NOTE_A]: file(NOTE_A),
  [NOTE_B]: file(NOTE_B),
  [NOTE_C]: file(NOTE_C),
  [NOTE_D]: file(NOTE_D),
  [IMAGE]: file(IMAGE),
};

/**
 * A.md outgoing: B, C, self, png, vanished dest.
 * B.md links back to A (the only linker).
 * C.md outgoing-only relative to A (links to D, not A).
 * Ghost is unresolved and never appears in resolvedLinks.
 */
const graph: Record<string, Record<string, number>> = {
  [NOTE_A]: { [NOTE_B]: 1, [NOTE_C]: 1, [NOTE_A]: 1, [IMAGE]: 1, [VANISHED]: 1 },
  [NOTE_B]: { [NOTE_A]: 2 },
  [NOTE_C]: { [NOTE_D]: 1 },
};

function pathsOf(app: App, direction: "backlinks" | "outgoing"): string[] {
  const scope = createLinksScope(NOTE_A, direction);
  if (!isLinksScope(scope)) {
    throw new Error("expected links scope");
  }
  return collectLinksFiles(app, scope).map((entry) => entry.path);
}

describe("collectLinksFiles backlinks", () => {
  it("finds only linkers and excludes self and outgoing-only files", () => {
    const app = createApp(files, graph);
    expect(pathsOf(app, "backlinks")).toEqual([NOTE_B]);
  });
});

describe("collectLinksFiles outgoing", () => {
  it("excludes self and unsupported targets (.png, unresolved)", () => {
    const app = createApp(files, graph);
    expect(new Set(pathsOf(app, "outgoing"))).toEqual(new Set([NOTE_B, NOTE_C]));
  });

  it("yields an empty set when the source has no resolvedLinks entry", () => {
    const app = createApp(files, {});
    expect(pathsOf(app, "outgoing")).toEqual([]);
    expect(pathsOf(app, "backlinks")).toEqual([]);
  });
});

describe("isLinksMember", () => {
  it("accepts a backlink linker and rejects self and outgoing-only files", () => {
    const app = createApp(files, graph);
    const scope = createLinksScope(NOTE_A, "backlinks");
    if (!isLinksScope(scope)) {
      throw new Error("expected links scope");
    }

    expect(isLinksMember(app, scope, NOTE_B)).toBe(true);
    expect(isLinksMember(app, scope, NOTE_A)).toBe(false);
    expect(isLinksMember(app, scope, NOTE_C)).toBe(false);
    expect(isLinksMember(app, scope, NOTE_D)).toBe(false);
  });

  it("accepts an outgoing dest and rejects self, png, and unresolved targets", () => {
    const app = createApp(files, graph);
    const scope = createLinksScope(NOTE_A, "outgoing");
    if (!isLinksScope(scope)) {
      throw new Error("expected links scope");
    }

    expect(isLinksMember(app, scope, NOTE_B)).toBe(true);
    expect(isLinksMember(app, scope, NOTE_C)).toBe(true);
    expect(isLinksMember(app, scope, NOTE_A)).toBe(false);
    expect(isLinksMember(app, scope, IMAGE)).toBe(false);
    expect(isLinksMember(app, scope, VANISHED)).toBe(false);
    expect(isLinksMember(app, scope, "notes/Ghost.md")).toBe(false);
  });
});

describe("isPathRelevantToLinksScope", () => {
  const scope = createLinksScope(NOTE_A, "backlinks");
  if (!isLinksScope(scope)) {
    throw new Error("expected links scope");
  }

  it("hits the source notePath regardless of graph membership", () => {
    expect(isPathRelevantToLinksScope(scope, NOTE_A)).toBe(true);
  });

  it("hits a supported card-file extension", () => {
    expect(isPathRelevantToLinksScope(scope, "other/note.md")).toBe(true);
    expect(isPathRelevantToLinksScope(scope, "board.canvas")).toBe(true);
  });

  it("rejects an unsupported extension that is not the source note", () => {
    expect(isPathRelevantToLinksScope(scope, IMAGE)).toBe(false);
    expect(isPathRelevantToLinksScope(scope, "notes/doc.pdf")).toBe(false);
  });
});

describe("resolveLinksFollowScope", () => {
  const backlinks = createLinksScope(NOTE_A, "backlinks");
  const outgoing = createLinksScope(NOTE_A, "outgoing");

  it("returns null when pinned", () => {
    expect(resolveLinksFollowScope(backlinks, NOTE_B, true)).toBeNull();
  });

  it("returns null for a non-links scope", () => {
    expect(resolveLinksFollowScope(createFolderScope("notes", true), NOTE_B, false)).toBeNull();
    expect(resolveLinksFollowScope(createBoxScope("box-1"), NOTE_B, false)).toBeNull();
  });

  it("returns null when the selected path is missing", () => {
    expect(resolveLinksFollowScope(backlinks, null, false)).toBeNull();
  });

  it("returns null when the selected path is already the source note", () => {
    expect(resolveLinksFollowScope(backlinks, NOTE_A, false)).toBeNull();
  });

  it("re-points a follow-mode links scope and preserves direction", () => {
    expect(resolveLinksFollowScope(backlinks, NOTE_B, false)).toEqual(
      createLinksScope(NOTE_B, "backlinks"),
    );
    expect(resolveLinksFollowScope(outgoing, NOTE_C, false)).toEqual(
      createLinksScope(NOTE_C, "outgoing"),
    );
  });
});

describe("malformed cache state", () => {
  it("never throws when resolvedLinks or dest maps are absent", () => {
    const missingCache = {
      vault: { getAbstractFileByPath: vi.fn(() => files[NOTE_B]) },
      metadataCache: {},
    } as unknown as App;
    const nullMaps = createApp(files, { [NOTE_A]: null, [NOTE_B]: undefined });
    const scopeBack = createLinksScope(NOTE_A, "backlinks");
    const scopeOut = createLinksScope(NOTE_A, "outgoing");
    if (!isLinksScope(scopeBack) || !isLinksScope(scopeOut)) {
      throw new Error("expected links scope");
    }

    expect(collectLinksFiles(missingCache, scopeBack)).toEqual([]);
    expect(collectLinksFiles(nullMaps, scopeOut)).toEqual([]);
    expect(isLinksMember(missingCache, scopeBack, NOTE_B)).toBe(false);
    expect(isLinksMember(nullMaps, scopeOut, NOTE_B)).toBe(false);
  });
});
