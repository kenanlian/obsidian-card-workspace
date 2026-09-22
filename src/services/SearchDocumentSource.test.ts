import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class TFile {
    constructor(public path: string) {}
  },
}));

import { TFile } from "obsidian";
import { SEARCH_DOCUMENT_BATCH_SIZE, SearchDocumentSource } from "./SearchDocumentSource";
import type { SearchableDocument } from "../search";

function document(path: string): SearchableDocument {
  return { path, title: path, normalizedTitle: path, content: "", excerpt: "", folderPath: "", mtime: 1, ctime: 1 };
}

function createFile(path: string, mtime = 1): TFile {
  const value = new TFile();
  value.path = path;
  value.stat = { ctime: 1, mtime, size: 0 };
  return value;
}

const MIXED_KIND_FILES = [
  "notes/a.md",
  "assets/diagram.png",
  "notes/board.canvas",
  "assets/brief.pdf",
  "notes/table.base",
  "notes/sketch.excalidraw.md",
  "assets/clip.mp4",
];

describe("SearchDocumentSource", () => {
  it("limits reads to eight and returns successful documents in vault order", async () => {
    const files = Array.from({ length: 20 }, (_, index) => createFile(`${index}.md`));
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const prepare = vi.fn(async (file: TFile) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      if (file.path === "5.md") throw new Error("one bad file");
      return document(file.path);
    });
    const source = new SearchDocumentSource(
      { vault: { getFiles: () => files } } as never,
      prepare,
    );

    const reading = source.readAllDocuments();
    await vi.waitFor(() => expect(releases).toHaveLength(8));
    while (prepare.mock.calls.length < files.length) {
      releases.splice(0).forEach((release) => release());
      await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0));
    }
    releases.splice(0).forEach((release) => release());
    const result = await reading;
    expect(peak).toBe(8);
    expect(result.map(({ path }) => path)).toEqual(files.map(({ path }) => path).filter((path) => path !== "5.md"));
  });

  it("indexes only supported card files so attachments never enter the index", async () => {
    const files = MIXED_KIND_FILES.map((path) => createFile(path));
    const prepare = vi.fn(async (file: TFile) => document(file.path));
    const source = new SearchDocumentSource({ vault: { getFiles: () => files } } as never, prepare);

    const result = await source.readAllDocuments();

    expect(result.map(({ path }) => path)).toEqual([
      "notes/a.md",
      "notes/board.canvas",
      "notes/table.base",
      "notes/sketch.excalidraw.md",
    ]);
    expect(prepare).toHaveBeenCalledTimes(4);
  });

  it("returns null for a single unsupported path so a mutation discards it", async () => {
    const prepare = vi.fn(async (file: TFile) => document(file.path));
    const attachment = createFile("assets/diagram.png");
    const source = new SearchDocumentSource(
      { vault: { getAbstractFileByPath: () => attachment } } as never,
      prepare,
    );

    expect(await source.readDocument("assets/diagram.png")).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("stops dequeue and omits a read that completes after abort", async () => {
    const files = Array.from({ length: 16 }, (_, index) => createFile(`${index}.md`));
    const controller = new AbortController();
    const releases: Array<() => void> = [];
    const prepare = vi.fn(async (file: TFile) => {
      await new Promise<void>((resolve) => { releases.push(resolve); });
      return document(file.path);
    });
    const source = new SearchDocumentSource({ vault: { getFiles: () => files } } as never, prepare);
    const reading = source.readAllDocuments(controller.signal);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(8));
    controller.abort();
    releases.forEach((release) => release());
    expect(await reading).toEqual([]);
    expect(prepare).toHaveBeenCalledTimes(8);
  });

  it("streams the same documents, in the same order, as a whole-vault read", async () => {
    const files = Array.from({ length: 450 }, (_, index) => createFile(`${String(index).padStart(3, "0")}.md`));
    const prepare = vi.fn(async (file: TFile) => (file.path === "005.md" ? null : document(file.path)));
    const source = new SearchDocumentSource({ vault: { getFiles: () => files } } as never, prepare);

    const batches: SearchableDocument[][] = [];
    for await (const batch of source.streamDocuments()) {
      batches.push(batch);
    }

    // The 199 is the first window minus the one file that prepared as null.
    expect(batches.map((batch) => batch.length)).toEqual([199, 200, 50]);
    expect(batches.every((batch) => batch.length <= SEARCH_DOCUMENT_BATCH_SIZE)).toBe(true);
    expect(batches.flat()).toEqual(await source.readAllDocuments());
  });

  it("stops yielding once aborted between batches", async () => {
    const files = Array.from({ length: 450 }, (_, index) => createFile(`${String(index).padStart(3, "0")}.md`));
    const controller = new AbortController();
    const prepare = vi.fn(async (file: TFile) => document(file.path));
    const source = new SearchDocumentSource({ vault: { getFiles: () => files } } as never, prepare);

    const batches: SearchableDocument[][] = [];
    for await (const batch of source.streamDocuments(controller.signal)) {
      batches.push(batch);
      controller.abort();
    }

    expect(batches).toHaveLength(1);
    expect(prepare).toHaveBeenCalledTimes(SEARCH_DOCUMENT_BATCH_SIZE);
  });

  it("keeps attachments out of every streamed batch", async () => {
    const files = MIXED_KIND_FILES.map((path) => createFile(path));
    const prepare = vi.fn(async (file: TFile) => document(file.path));
    const source = new SearchDocumentSource({ vault: { getFiles: () => files } } as never, prepare);

    const batches: SearchableDocument[][] = [];
    for await (const batch of source.streamDocuments()) {
      batches.push(batch);
    }

    expect(batches.flat().map(({ path }) => path)).toEqual([
      "notes/a.md",
      "notes/board.canvas",
      "notes/table.base",
      "notes/sketch.excalidraw.md",
    ]);
    expect(prepare).toHaveBeenCalledTimes(4);
  });

  it("snapshots path-to-mtime for supported card files only, without reading any file", async () => {
    const files = MIXED_KIND_FILES.map((path, index) => createFile(path, 100 + index));
    const prepare = vi.fn(async (file: TFile) => document(file.path));
    const cachedRead = vi.fn(async () => "");
    const source = new SearchDocumentSource(
      { vault: { getFiles: () => files, cachedRead } } as never,
      prepare,
    );

    const snapshot = source.readCatalogSnapshot();

    expect(prepare).not.toHaveBeenCalled();
    expect(cachedRead).not.toHaveBeenCalled();
    expect(snapshot).toEqual({
      "notes/a.md": 100,
      "notes/board.canvas": 102,
      "notes/table.base": 104,
      "notes/sketch.excalidraw.md": 105,
    });
    expect(Object.keys(snapshot)).toEqual(
      (await source.readAllDocuments()).map(({ path }) => path),
    );
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it("returns an empty snapshot when the vault cannot enumerate files", () => {
    const prepare = vi.fn(async (file: TFile) => document(file.path));
    const source = new SearchDocumentSource({ vault: {} } as never, prepare);

    expect(source.readCatalogSnapshot()).toEqual({});
    expect(prepare).not.toHaveBeenCalled();
  });
});
