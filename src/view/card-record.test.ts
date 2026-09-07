import { describe, expect, it, vi } from "vitest";

const obsidianTypes = vi.hoisted(() => {
  class MockTFile {
    path = "";
    name = "";
    basename = "";
    extension = "md";
    stat = { ctime: 1, mtime: 2 };
  }
  return { MockTFile };
});

vi.mock("obsidian", () => ({ TFile: obsidianTypes.MockTFile }));

import { TFile, type App } from "obsidian";
import type { CardFileKind } from "./file-kind";
import { createCardRecord } from "./card-record";

function appWith(getFileCache: (file: TFile) => unknown): App {
  return { metadataCache: { getFileCache } } as unknown as App;
}

function liveFile(path: string, stat = { ctime: 101, mtime: 202 }): TFile {
  const value = new TFile() as any;
  value.path = path;
  value.name = path.slice(path.lastIndexOf("/") + 1);
  value.basename = value.name.replace(/\.[^.]+$/, "");
  value.stat = stat;
  return value as TFile;
}

describe("createCardRecord", () => {
  const cases: Array<{ kind: CardFileKind; fileName: string }> = [
    { kind: "markdown", fileName: "note.md" },
    { kind: "base", fileName: "table.base" },
    { kind: "canvas", fileName: "board.canvas" },
    { kind: "excalidraw", fileName: "drawing.excalidraw" },
  ];

  for (const { kind, fileName } of cases) {
    it(`initializes exact factory defaults for ${kind} files`, () => {
      const file = liveFile(`scope/${fileName}`);
      const getFileCache = vi.fn(() => null);
      const record = createCardRecord(appWith(getFileCache), file, kind);

      expect(record.file).toBe(file);
      expect(record.fileKind).toBe(kind);
      expect(record.path).toBe("scope/" + fileName);
      expect(record.title).toBe(file.basename);
      expect(record.ctime).toBe(101);
      expect(record.mtime).toBe(202);
      expect(record.excerpt).toBe("");
      expect(record.previewHtml).toBe("");
      expect(record.previewMode).toBe("empty");
      expect(record.hydrated).toBe(false);
    });
  }

  it("derives the markdown task summary exactly once from current live metadata", () => {
    const file = liveFile("scope/tasks.md");
    const getFileCache = vi.fn(() => ({ listItems: [{ task: " " }, { task: "x" }, { task: "-" }] }));
    const record = createCardRecord(appWith(getFileCache), file, "markdown");

    expect(record.taskSummary).toEqual({ total: 3, incomplete: 1 });
    expect(getFileCache).toHaveBeenCalledTimes(1);
    expect(getFileCache).toHaveBeenCalledWith(file);
  });

  it("keeps the task summary null for non-markdown kinds without consulting metadata", () => {
    for (const kind of ["base", "canvas", "excalidraw"] as const) {
      const getFileCache = vi.fn(() => ({ listItems: [{ task: " " }] }));
      const record = createCardRecord(appWith(getFileCache), liveFile(`scope/item.${kind}`), kind);
      expect(record.taskSummary).toBeNull();
      expect(getFileCache).not.toHaveBeenCalled();
    }
  });

  it("copies whichever ctime/mtime the live stat currently reports", () => {
    const first = createCardRecord(appWith(() => null), liveFile("scope/fresh.md"), "markdown");
    expect([first.ctime, first.mtime]).toEqual([101, 202]);
    const second = createCardRecord(
      appWith(() => null),
      liveFile("scope/fresh.md", { ctime: 7, mtime: 9 }),
      "markdown",
    );
    expect([second.ctime, second.mtime]).toEqual([7, 9]);
  });
});
