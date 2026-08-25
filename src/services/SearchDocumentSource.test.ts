import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class TFile {
    constructor(public path: string) {}
  },
}));

import { TFile } from "obsidian";
import { SearchDocumentSource } from "./SearchDocumentSource";
import type { SearchableDocument } from "../search";

function document(path: string): SearchableDocument {
  return { path, title: path, normalizedTitle: path, content: "", excerpt: "", folderPath: "", mtime: 1, ctime: 1 };
}

function createFile(path: string): TFile {
  const value = new TFile();
  value.path = path;
  return value;
}

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
});
