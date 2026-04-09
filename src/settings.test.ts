import { describe, it, expect } from "vitest";
import { normalizeSettings, mergeSettings, DEFAULT_SETTINGS } from "./settings";

// ---------------------------------------------------------------------------
// normalizeSettings — pinnedPaths handling
// ---------------------------------------------------------------------------
describe("normalizeSettings — pinnedPaths", () => {
  it("normalizes invalid pinnedPaths (non-array) to empty array", () => {
    const raw = {
      ...DEFAULT_SETTINGS,
      pinnedPaths: "not-an-array",
    } as unknown;

    const result = normalizeSettings(raw);

    expect((result as unknown as { pinnedPaths: string[] }).pinnedPaths).toEqual([]);
  });

  it("normalizes null pinnedPaths to empty array", () => {
    const raw = {
      ...DEFAULT_SETTINGS,
      pinnedPaths: null,
    } as unknown;

    const result = normalizeSettings(raw);

    expect((result as unknown as { pinnedPaths: string[] }).pinnedPaths).toEqual([]);
  });

  it("normalizes undefined pinnedPaths to empty array", () => {
    const raw = {
      ...DEFAULT_SETTINGS,
      pinnedPaths: undefined,
    } as unknown;

    const result = normalizeSettings(raw);

    expect((result as unknown as { pinnedPaths: string[] }).pinnedPaths).toEqual([]);
  });

  it("preserves valid string-array pinnedPaths", () => {
    const raw = {
      ...DEFAULT_SETTINGS,
      pinnedPaths: ["folder1", "folder2"],
    } as unknown;

    const result = normalizeSettings(raw);

    expect((result as unknown as { pinnedPaths: string[] }).pinnedPaths).toEqual(["folder1", "folder2"]);
  });

  it("preserves empty string-array pinnedPaths", () => {
    const raw = {
      ...DEFAULT_SETTINGS,
      pinnedPaths: [],
    } as unknown;

    const result = normalizeSettings(raw);

    expect((result as unknown as { pinnedPaths: string[] }).pinnedPaths).toEqual([]);
  });

  it("preserves duplicate pinnedPaths entries (no dedupe in normalization)", () => {
    const raw = {
      ...DEFAULT_SETTINGS,
      pinnedPaths: ["folder1/note.md", "folder1/note.md", "folder2/note.md"],
    } as unknown;

    const result = normalizeSettings(raw);

    expect((result as unknown as { pinnedPaths: string[] }).pinnedPaths).toEqual([
      "folder1/note.md",
      "folder1/note.md",
      "folder2/note.md",
    ]);
  });

  it("filters out non-string elements from pinnedPaths array", () => {
    const raw = {
      ...DEFAULT_SETTINGS,
      pinnedPaths: ["folder1", 42, "folder2", null, "folder3"],
    } as unknown;

    const result = normalizeSettings(raw);

    expect((result as unknown as { pinnedPaths: string[] }).pinnedPaths).toEqual(["folder1", "folder2", "folder3"]);
  });

  it("filters out empty strings from pinnedPaths array", () => {
    const raw = {
      ...DEFAULT_SETTINGS,
      pinnedPaths: ["folder1", "", "folder2", "   ", "folder3"],
    } as unknown;

    const result = normalizeSettings(raw);

    expect((result as unknown as { pinnedPaths: string[] }).pinnedPaths).toEqual(["folder1", "folder2", "folder3"]);
  });
});

describe("normalizeSettings — includeSubfolders and view mode", () => {
  it("defaults includeSubfolders to true when the raw value is not boolean", () => {
    const raw = {
      ...DEFAULT_SETTINGS,
      includeSubfolders: "nope",
    } as unknown;

    expect(normalizeSettings(raw).includeSubfolders).toBe(true);
  });

  it("preserves explicit includeSubfolders false", () => {
    const raw = {
      ...DEFAULT_SETTINGS,
      includeSubfolders: false,
    } as unknown;

    expect(normalizeSettings(raw).includeSubfolders).toBe(false);
  });

  it("normalizes lastViewMode to all-notes only for the known value", () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, lastViewMode: "all-notes" }).lastViewMode).toBe("all-notes");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, lastViewMode: "unexpected" }).lastViewMode).toBe("folder");
  });
});


// ---------------------------------------------------------------------------
// mergeSettings — pinnedPaths updates
// ---------------------------------------------------------------------------
describe("mergeSettings — pinnedPaths", () => {
  it("updates pinnedPaths via patch and preserves other fields", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      pinnedPaths: ["oldFolder"],
      includeSubfolders: false,
      sort: {
        field: "ctime",
        direction: "asc",
      },
    } as unknown;

    const patch = {
      pinnedPaths: ["newFolder1", "newFolder2"],
    } as unknown;

    const result = mergeSettings(current as never, patch as never);

    expect((result as unknown as { pinnedPaths: string[] }).pinnedPaths).toEqual(["newFolder1", "newFolder2"]);
    expect(result.includeSubfolders).toBe(false);
    expect(result.sort.field).toBe("ctime");
    expect(result.sort.direction).toBe("asc");
  });

  it("mergeSettings preserves existing fields when pinnedPaths not in patch", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      pinnedPaths: ["folder1"],
      includeSubfolders: true,
      sort: {
        field: "mtime",
        direction: "desc",
      },
    } as unknown;

    const patch = {
      includeSubfolders: false,
    } as unknown;

    const result = mergeSettings(current as never, patch as never);

    expect((result as unknown as { pinnedPaths: string[] }).pinnedPaths).toEqual(["folder1"]);
    expect(result.includeSubfolders).toBe(false);
    expect(result.sort.field).toBe("mtime");
  });

  it("clears pinnedPaths by merging with empty array", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      pinnedPaths: ["folder1", "folder2"],
    } as unknown;

    const patch = {
      pinnedPaths: [],
    } as unknown;

    const result = mergeSettings(current as never, patch as never);

    expect((result as unknown as { pinnedPaths: string[] }).pinnedPaths).toEqual([]);
  });

  it("mergeSettings normalizes invalid pinnedPaths in patch to empty array", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      pinnedPaths: ["originalFolder"],
    } as unknown;

    const patch = {
      pinnedPaths: "invalid-not-array",
    } as unknown;

    const result = mergeSettings(current as never, patch as never);

    expect((result as unknown as { pinnedPaths: string[] }).pinnedPaths).toEqual([]);
  });

  it("mergeSettings updates pinnedPaths while keeping filter.tags intact", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      pinnedPaths: [],
      filter: {
        tags: ["tag1", "tag2"],
      },
    } as unknown;

    const patch = {
      pinnedPaths: ["newFolder"],
    } as unknown;

    const result = mergeSettings(current as never, patch as never);

    expect((result as unknown as { pinnedPaths: string[] }).pinnedPaths).toEqual(["newFolder"]);
    expect(result.filter.tags).toEqual(["tag1", "tag2"]);
  });

  it("mergeSettings updates pinnedPaths while keeping sort intact", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      pinnedPaths: [],
      sort: {
        field: "ctime",
        direction: "asc",
      },
    } as unknown;

    const patch = {
      pinnedPaths: ["newFolder"],
    } as unknown;

    const result = mergeSettings(current as never, patch as never);

    expect((result as unknown as { pinnedPaths: string[] }).pinnedPaths).toEqual(["newFolder"]);
    expect(result.sort.field).toBe("ctime");
    expect(result.sort.direction).toBe("asc");
  });

  it("updates includeSubfolders while preserving pinned paths and filter tags", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      pinnedPaths: ["notes/pinned.md"],
      filter: {
        tags: ["active"],
      },
      includeSubfolders: true,
    } as unknown;

    const result = mergeSettings(current as never, { includeSubfolders: false } as never);

    expect(result.includeSubfolders).toBe(false);
    expect(result.pinnedPaths).toEqual(["notes/pinned.md"]);
    expect(result.filter.tags).toEqual(["active"]);
  });
});
