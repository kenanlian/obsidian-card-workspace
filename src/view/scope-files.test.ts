import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class MockTFile {
    path: string;

    constructor(path: string = "") {
      this.path = path;
    }
  }

  class MockTFolder {
    path: string;
    children: Array<MockTFile | MockTFolder> = [];

    constructor(path: string = "") {
      this.path = path;
    }
  }

  return { App: class MockApp {}, TFile: MockTFile, TFolder: MockTFolder };
});

import { TFile, TFolder } from "obsidian";
import {
  collectSupportedFiles,
  isPathInFolderScope,
  rewritePathAfterRename,
} from "./scope-files";

function file(path: string): TFile {
  const result = new TFile();
  result.path = path;
  return result;
}

function folder(path: string, children: Array<TFile | TFolder> = []): TFolder {
  const result = new TFolder();
  result.path = path;
  result.children = children;
  return result;
}

function createApp(root: TFolder, entries: Record<string, TFile | TFolder | null> = {}): never {
  return {
    vault: {
      getRoot: vi.fn(() => root),
      getAbstractFileByPath: vi.fn((path: string) => entries[path] ?? null),
    },
  } as never;
}

describe("collectSupportedFiles", () => {
  it("collects only direct supported files from the vault root", () => {
    const nested = folder("nested", [file("nested/deep.md")]);
    const root = folder("", [
      file("note.md"),
      file("table.base"),
      file("board.canvas"),
      file("drawing.excalidraw"),
      file("drawing.excalidraw.md"),
      file("ignored.txt"),
      nested,
    ]);

    expect(collectSupportedFiles(createApp(root), "", false).map((entry) => entry.path)).toEqual([
      "note.md",
      "table.base",
      "board.canvas",
      "drawing.excalidraw",
      "drawing.excalidraw.md",
    ]);
  });

  it("recursively collects supported files and preserves the original traversal behavior", () => {
    const notes = folder("notes", [
      file("notes/direct.md"),
      file("notes/ignored.pdf"),
      folder("notes/deep", [file("notes/deep/board.canvas"), file("notes/deep/table.base")]),
    ]);
    const app = createApp(folder(""), { notes });

    expect(collectSupportedFiles(app, "notes", true).map((entry) => entry.path)).toEqual([
      "notes/direct.md",
      "notes/deep/board.canvas",
      "notes/deep/table.base",
    ]);
    expect(collectSupportedFiles(app, "notes", false).map((entry) => entry.path)).toEqual([
      "notes/direct.md",
    ]);
  });

  it("returns no files when the requested path is missing or is a file", () => {
    const app = createApp(folder(""), { "note.md": file("note.md") });

    expect(collectSupportedFiles(app, "missing", true)).toEqual([]);
    expect(collectSupportedFiles(app, "note.md", true)).toEqual([]);
  });
});

describe("isPathInFolderScope", () => {
  it("handles recursive and nonrecursive vault-root scopes", () => {
    expect(isPathInFolderScope("note.md", "", false)).toBe(true);
    expect(isPathInFolderScope("nested/note.md", "", false)).toBe(false);
    expect(isPathInFolderScope("nested/note.md", "", true)).toBe(true);
  });

  it("handles exact, direct-child, and descendant folder membership", () => {
    expect(isPathInFolderScope("a", "a", false)).toBe(true);
    expect(isPathInFolderScope("a/note.md", "a", false)).toBe(true);
    expect(isPathInFolderScope("a/deep/note.md", "a", false)).toBe(false);
    expect(isPathInFolderScope("a/deep/note.md", "a", true)).toBe(true);
  });

  it("enforces folder-prefix boundaries", () => {
    expect(isPathInFolderScope("ab/note.md", "a", true)).toBe(false);
    expect(isPathInFolderScope("a2/note.md", "a", false)).toBe(false);
  });
});

describe("rewritePathAfterRename", () => {
  it("rewrites exact paths and descendants", () => {
    expect(rewritePathAfterRename("a", "a", "renamed")).toBe("renamed");
    expect(rewritePathAfterRename("a/deep/note.md", "a", "renamed")).toBe("renamed/deep/note.md");
  });

  it("preserves the vault root and paths outside the rename boundary", () => {
    expect(rewritePathAfterRename("", "a", "renamed")).toBe("");
    expect(rewritePathAfterRename("ab/note.md", "a", "renamed")).toBe("ab/note.md");
    expect(rewritePathAfterRename("other/note.md", "a", "renamed")).toBe("other/note.md");
  });
});
