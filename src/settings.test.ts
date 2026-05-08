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

  it("defaults defaultCardOpenBehavior to smart when the raw value is missing or invalid", () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, defaultCardOpenBehavior: undefined } as unknown).defaultCardOpenBehavior).toBe("smart");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, defaultCardOpenBehavior: "current-area" } as unknown).defaultCardOpenBehavior).toBe("smart");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, defaultCardOpenBehavior: "unexpected" } as unknown).defaultCardOpenBehavior).toBe("smart");
  });

  it("preserves each supported defaultCardOpenBehavior value", () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, defaultCardOpenBehavior: "smart" } as unknown).defaultCardOpenBehavior).toBe("smart");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, defaultCardOpenBehavior: "new-tab" } as unknown).defaultCardOpenBehavior).toBe("new-tab");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, defaultCardOpenBehavior: "split-right" } as unknown).defaultCardOpenBehavior).toBe("split-right");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, defaultCardOpenBehavior: "new-window" } as unknown).defaultCardOpenBehavior).toBe("new-window");
  });
});


describe("normalizeSettings — previewLines", () => {
  it("defaults previewLines to 5 when value is missing", () => {
    const raw = {
      ...DEFAULT_SETTINGS,
    } as unknown;

    const result = normalizeSettings(raw);

    expect(result.previewLines).toBe(5);
  });

  it("clamps previewLines within inclusive bounds for raw values 2, 3, 5, 10, 11", () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, previewLines: 2 } as unknown).previewLines).toBe(3);
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, previewLines: 3 } as unknown).previewLines).toBe(3);
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, previewLines: 5 } as unknown).previewLines).toBe(5);
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, previewLines: 10 } as unknown).previewLines).toBe(10);
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, previewLines: 11 } as unknown).previewLines).toBe(10);
  });

  it("falls back to default for null and non-number previewLines inputs", () => {
    const invalidValues: unknown[] = [null, "5", false, { value: 5 }, [5]];

    for (const invalidValue of invalidValues) {
      const raw = {
        ...DEFAULT_SETTINGS,
        previewLines: invalidValue,
      } as unknown;

      expect(normalizeSettings(raw).previewLines).toBe(5);
    }
  });

  it("only uses the exact previewLines key", () => {
    const raw = {
      ...DEFAULT_SETTINGS,
      previewLine: 10,
    } as unknown;

    const result = normalizeSettings(raw);

    expect(result.previewLines).toBe(5);
  });
});


describe("search query settings boundary", () => {
  it("normalizeSettings ignores runtime search query fields", () => {
    const raw = {
      ...DEFAULT_SETTINGS,
      searchQuery: "roadmap",
    } as unknown;

    const result = normalizeSettings(raw);

    expect("searchQuery" in (result as unknown as Record<string, unknown>)).toBe(false);
  });

  it("mergeSettings ignores runtime search query fields in patch", () => {
    const result = mergeSettings(DEFAULT_SETTINGS, { searchQuery: "roadmap" } as never);

    expect("searchQuery" in (result as unknown as Record<string, unknown>)).toBe(false);
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


describe("mergeSettings — previewLines", () => {
  it("updates previewLines while preserving unrelated settings fields", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      sort: {
        field: "ctime",
        direction: "asc",
      },
      filter: {
        tags: ["tag-a", "tag-b"],
      },
      pinnedPaths: ["folder/note-1.md", "folder/note-2.md"],
      includeSubfolders: false,
      defaultView: "cards",
      lastViewMode: "all-notes",
    } as unknown;

    const result = mergeSettings(current as never, { previewLines: 10 });

    expect(result.previewLines).toBe(10);
    expect(result.sort.field).toBe("ctime");
    expect(result.sort.direction).toBe("asc");
    expect(result.filter.tags).toEqual(["tag-a", "tag-b"]);
    expect(result.pinnedPaths).toEqual(["folder/note-1.md", "folder/note-2.md"]);
    expect(result.includeSubfolders).toBe(false);
    expect(result.defaultView).toBe("cards");
    expect(result.lastViewMode).toBe("all-notes");
  });

  it("normalizes previewLines in patch for raw values 2, 3, 5, 10, 11", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { previewLines: 2 }).previewLines).toBe(3);
    expect(mergeSettings(DEFAULT_SETTINGS, { previewLines: 3 }).previewLines).toBe(3);
    expect(mergeSettings(DEFAULT_SETTINGS, { previewLines: 5 }).previewLines).toBe(5);
    expect(mergeSettings(DEFAULT_SETTINGS, { previewLines: 10 }).previewLines).toBe(10);
    expect(mergeSettings(DEFAULT_SETTINGS, { previewLines: 11 }).previewLines).toBe(10);
  });

  it("falls back to default when patch.previewLines is null or non-number", () => {
    const invalidValues: unknown[] = [null, "5", true, { value: 5 }, [5]];

    for (const invalidValue of invalidValues) {
      const patch = {
        previewLines: invalidValue,
      } as unknown;

      expect(mergeSettings(DEFAULT_SETTINGS, patch as never).previewLines).toBe(5);
    }
  });

  it("only accepts previewLines key in patch", () => {
    const patch = {
      previewLine: 10,
    } as unknown;

    const result = mergeSettings(DEFAULT_SETTINGS, patch as never);

    expect(result.previewLines).toBe(5);
  });

  it("updates defaultCardOpenBehavior while preserving unrelated settings fields", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      previewLines: 8,
      pinnedPaths: ["folder/note-1.md"],
      includeSubfolders: false,
    };

    const result = mergeSettings(current, { defaultCardOpenBehavior: "split-right" });

    expect(result.defaultCardOpenBehavior).toBe("split-right");
    expect(result.previewLines).toBe(8);
    expect(result.pinnedPaths).toEqual(["folder/note-1.md"]);
    expect(result.includeSubfolders).toBe(false);
  });

  it("normalizes invalid defaultCardOpenBehavior patches back to smart", () => {
    const result = mergeSettings(DEFAULT_SETTINGS, { defaultCardOpenBehavior: "current-area" } as never);

    expect(result.defaultCardOpenBehavior).toBe("smart");
  });
});
