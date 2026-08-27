import { describe, expect, it, vi } from "vitest";
import type { App, CachedMetadata, ListItemCache, TFile } from "obsidian";
import type { CardFileKind } from "./file-kind";
import { deriveCardTaskSummary, summarizeTaskListItems } from "./task-summary";

function listItem(task?: string): ListItemCache {
  return { task, parent: 0 } as ListItemCache;
}

function cacheWith(listItems: ListItemCache[]): CachedMetadata {
  return { listItems };
}

function createMockFile(): TFile {
  return {
    path: "notes/tasks.md",
    basename: "tasks",
  } as TFile;
}

function createMockApp(getFileCache: ReturnType<typeof vi.fn>): App {
  return {
    metadataCache: { getFileCache },
  } as unknown as App;
}

describe("summarizeTaskListItems", () => {
  it("returns null for a null cache", () => {
    expect(summarizeTaskListItems(null)).toBeNull();
  });

  it("returns null when listItems is missing", () => {
    expect(summarizeTaskListItems({})).toBeNull();
  });

  it("returns null when listItems is an empty array", () => {
    expect(summarizeTaskListItems(cacheWith([]))).toBeNull();
  });

  it("returns null when every list item has task: undefined", () => {
    expect(
      summarizeTaskListItems(cacheWith([listItem(undefined), listItem()])),
    ).toBeNull();
  });

  it("counts three tasks with two incomplete spaces and one x", () => {
    expect(
      summarizeTaskListItems(
        cacheWith([listItem(" "), listItem(" "), listItem("x")]),
      ),
    ).toEqual({ total: 3, incomplete: 2 });
  });

  it("reports incomplete 0 when every task is x", () => {
    expect(
      summarizeTaskListItems(cacheWith([listItem("x"), listItem("x"), listItem("x")])),
    ).toEqual({ total: 3, incomplete: 0 });
  });

  it("counts a hyphen marker as complete", () => {
    expect(summarizeTaskListItems(cacheWith([listItem("-")]))).toEqual({
      total: 1,
      incomplete: 0,
    });
  });

  it("counts an uppercase X marker as complete", () => {
    expect(summarizeTaskListItems(cacheWith([listItem("X")]))).toEqual({
      total: 1,
      incomplete: 0,
    });
  });

  it("counts a slash marker as complete", () => {
    expect(summarizeTaskListItems(cacheWith([listItem("/")]))).toEqual({
      total: 1,
      incomplete: 0,
    });
  });

  it("counts only task entries among mixed task and non-task list items", () => {
    expect(
      summarizeTaskListItems(
        cacheWith([
          listItem(),
          listItem(" "),
          listItem(undefined),
          listItem("x"),
          listItem(),
        ]),
      ),
    ).toEqual({ total: 2, incomplete: 1 });
  });

  it("treats a multi-character task string as complete without throwing", () => {
    expect(summarizeTaskListItems(cacheWith([listItem("xx")]))).toEqual({
      total: 1,
      incomplete: 0,
    });
  });
});

describe("deriveCardTaskSummary", () => {
  const nonMarkdownKinds: CardFileKind[] = ["canvas", "base", "excalidraw"];

  it.each(nonMarkdownKinds)(
    "returns null for fileKind %s without calling getFileCache",
    (fileKind) => {
      const getFileCache = vi.fn();
      const app = createMockApp(getFileCache);
      const file = createMockFile();

      expect(deriveCardTaskSummary(app, file, fileKind)).toBeNull();
      expect(getFileCache).not.toHaveBeenCalled();
    },
  );

  it("consults getFileCache for markdown and returns the summarized result", () => {
    const cache = cacheWith([listItem(" "), listItem(" "), listItem("x")]);
    const getFileCache = vi.fn(() => cache);
    const app = createMockApp(getFileCache);
    const file = createMockFile();

    expect(deriveCardTaskSummary(app, file, "markdown")).toEqual({
      total: 3,
      incomplete: 2,
    });
    expect(getFileCache).toHaveBeenCalledTimes(1);
    expect(getFileCache).toHaveBeenCalledWith(file);
  });

  it("returns null when getFileCache returns null for markdown", () => {
    const getFileCache = vi.fn(() => null);
    const app = createMockApp(getFileCache);
    const file = createMockFile();

    expect(deriveCardTaskSummary(app, file, "markdown")).toBeNull();
    expect(getFileCache).toHaveBeenCalledTimes(1);
    expect(getFileCache).toHaveBeenCalledWith(file);
  });
});
