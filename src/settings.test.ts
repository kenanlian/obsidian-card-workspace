import { describe, it, expect } from "vitest";
import {
  normalizeSettings,
  mergeSettings,
  migrateSettings,
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  type PartialPluginSettings,
  type PluginSettings,
} from "./settings";
import { DEFAULT_GROUP_SPEC } from "./card-grouping-settings";
import { serializeSettings } from "./services/SettingsStore";

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

  it("defaults newNoteTemplate to tags-frontmatter when the raw value is missing or invalid", () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, newNoteTemplate: undefined } as unknown).newNoteTemplate).toBe("tags-frontmatter");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, newNoteTemplate: "template" } as unknown).newNoteTemplate).toBe("tags-frontmatter");
  });

  it("preserves explicit newNoteTemplate blank", () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, newNoteTemplate: "blank" } as unknown).newNoteTemplate).toBe("blank");
  });

  it("drops the removed enableFileExplorerFolderClicks setting", () => {
    const normalized = normalizeSettings({
      ...DEFAULT_SETTINGS,
      enableFileExplorerFolderClicks: true,
    } as unknown) as unknown as Record<string, unknown>;

    expect(normalized.enableFileExplorerFolderClicks).toBeUndefined();
  });

  it("normalizes root lastFolderPath forms to the internal empty-string path", () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, lastFolderPath: "/" }).lastFolderPath).toBe("");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, lastViewMode: "all-notes" }).lastFolderPath).toBe("");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, lastViewMode: "unexpected" }).lastFolderPath).toBe("");
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

  it("defaults dragInsertAction to ask when the raw value is missing or invalid", () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, dragInsertAction: undefined } as unknown).dragInsertAction).toBe("ask");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, dragInsertAction: "current-area" } as unknown).dragInsertAction).toBe("ask");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, dragInsertAction: "unexpected" } as unknown).dragInsertAction).toBe("ask");
  });

  it("preserves each supported dragInsertAction value", () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, dragInsertAction: "ask" } as unknown).dragInsertAction).toBe("ask");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, dragInsertAction: "wiki" } as unknown).dragInsertAction).toBe("wiki");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, dragInsertAction: "embed" } as unknown).dragInsertAction).toBe("embed");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, dragInsertAction: "content" } as unknown).dragInsertAction).toBe("content");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, dragInsertAction: "title-content" } as unknown).dragInsertAction).toBe("title-content");
  });

  it("defaults cardCornerRadius to rounded when the raw value is missing or invalid", () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, cardCornerRadius: undefined } as unknown).cardCornerRadius).toBe("rounded");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, cardCornerRadius: "soft" } as unknown).cardCornerRadius).toBe("rounded");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, cardCornerRadius: 2 } as unknown).cardCornerRadius).toBe("rounded");
  });

  it("preserves each supported cardCornerRadius value", () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, cardCornerRadius: "compact" } as unknown).cardCornerRadius).toBe("compact");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, cardCornerRadius: "medium" } as unknown).cardCornerRadius).toBe("medium");
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, cardCornerRadius: "rounded" } as unknown).cardCornerRadius).toBe("rounded");
  });

  it("defaults showNavItemCounts to false when absent", () => {
    expect(normalizeSettings({}).showNavItemCounts).toBe(false);
  });

  it("defaults showNavItemCounts to false for non-boolean input and preserves true", () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, showNavItemCounts: "yes" } as unknown).showNavItemCounts).toBe(false);
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, showNavItemCounts: true } as unknown).showNavItemCounts).toBe(true);
  });
});

describe("navigation expansion settings", () => {
  it("defaults additive schema-v2 fields and normalizes malformed arrays", () => {
    expect(DEFAULT_SETTINGS.expandedFolderPaths).toEqual([]);
    expect(DEFAULT_SETTINGS.expandedTagPaths).toEqual([]);
    expect(migrateSettings({ schemaVersion: 2, workspace: {} })).toMatchObject({
      expandedFolderPaths: [],
      expandedTagPaths: [],
    });
    expect(normalizeSettings({
      expandedFolderPaths: "bad",
      expandedTagPaths: [null, 3, "# Work / AI ", ""],
    } as unknown)).toMatchObject({
      expandedFolderPaths: [],
      expandedTagPaths: ["work/ai"],
    });
  });

  it("structurally normalizes, deduplicates, omits root, and sorts expansion paths", () => {
    const normalized = normalizeSettings({
      expandedFolderPaths: ["/", "", " Projects//Alpha/ ", "Projects/Alpha", "Zed"],
      expandedTagPaths: [" #Work / AI ", "work/ai", "Personal", "//"],
    });
    expect(normalized.expandedFolderPaths).toEqual(["Projects/Alpha", "Zed"]);
    expect(normalized.expandedTagPaths).toEqual(["personal", "work/ai"]);
  });

  it("threads normalized expansion through v2 serialization and flattening", () => {
    const document = serializeSettings(normalizeSettings({
      expandedFolderPaths: ["B", "A"],
      expandedTagPaths: ["Z", "a"],
    }));
    expect(document.workspace.expandedFolderPaths).toEqual(["A", "B"]);
    expect(document.workspace.expandedTagPaths).toEqual(["a", "z"]);
    expect(migrateSettings(document)).toMatchObject({
      expandedFolderPaths: ["A", "B"],
      expandedTagPaths: ["a", "z"],
    });
  });
});
describe("normalizeSettings — sort fields", () => {
  it("preserves filename sort and falls back invalid sort fields to mtime", () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, sort: { field: "name", direction: "asc" } } as unknown).sort).toEqual({
      field: "name",
      direction: "asc",
    });

    expect(normalizeSettings({ ...DEFAULT_SETTINGS, sort: { field: "unexpected", direction: "asc" } } as unknown).sort).toEqual({
      field: "mtime",
      direction: "asc",
    });
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

  it("clamps previewLines within inclusive bounds for raw values 2, 3, 5, 8, 9", () => {
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, previewLines: 2 } as unknown).previewLines).toBe(3);
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, previewLines: 3 } as unknown).previewLines).toBe(3);
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, previewLines: 5 } as unknown).previewLines).toBe(5);
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, previewLines: 8 } as unknown).previewLines).toBe(8);
    expect(normalizeSettings({ ...DEFAULT_SETTINGS, previewLines: 9 } as unknown).previewLines).toBe(8);
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


describe("normalizeSettings — navSectionOrder", () => {
  const defaultOrder = ["favorites", "folders", "tags", "boxes"];

  it("defaults navSectionOrder when the value is missing", () => {
    const { navSectionOrder: _omitted, ...rest } = DEFAULT_SETTINGS;
    expect(normalizeSettings(rest).navSectionOrder).toEqual(defaultOrder);
    expect(normalizeSettings({}).navSectionOrder).toEqual(defaultOrder);
  });

  it("falls back to default for null and non-array navSectionOrder inputs", () => {
    const invalidValues: unknown[] = [null, "favorites", 0, false, { folders: true }];

    for (const invalidValue of invalidValues) {
      const raw = {
        ...DEFAULT_SETTINGS,
        navSectionOrder: invalidValue,
      } as unknown;

      expect(normalizeSettings(raw).navSectionOrder).toEqual(defaultOrder);
    }
  });

  it("preserves a valid permutation", () => {
    const permutation = ["boxes", "tags", "favorites", "folders"];
    const raw = {
      ...DEFAULT_SETTINGS,
      navSectionOrder: permutation,
    } as unknown;

    expect(normalizeSettings(raw).navSectionOrder).toEqual(permutation);
  });

  it("normalizes duplicates, unknown ids, and partial input", () => {
    expect(normalizeSettings({
      ...DEFAULT_SETTINGS,
      navSectionOrder: ["folders", "folders", "tags", "folders"],
    } as unknown).navSectionOrder).toEqual(["folders", "tags", "favorites", "boxes"]);

    expect(normalizeSettings({
      ...DEFAULT_SETTINGS,
      navSectionOrder: ["favorites", "nope", "folders", "mystery", "tags", "boxes"],
    } as unknown).navSectionOrder).toEqual(defaultOrder);

    expect(normalizeSettings({
      ...DEFAULT_SETTINGS,
      navSectionOrder: ["boxes"],
    } as unknown).navSectionOrder).toEqual(["boxes", "favorites", "folders", "tags"]);
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

  it("updates newNoteTemplate while preserving unrelated settings", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      pinnedPaths: ["notes/pinned.md"],
      filter: {
        tags: ["active"],
      },
      includeSubfolders: true,
    };

    const result = mergeSettings(current, { newNoteTemplate: "blank" });

    expect(result.newNoteTemplate).toBe("blank");
    expect(result.pinnedPaths).toEqual(["notes/pinned.md"]);
    expect(result.filter.tags).toEqual(["active"]);
    expect(result.includeSubfolders).toBe(true);
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
      lastFolderPath: "",
    } as unknown;

    const result = mergeSettings(current as never, { previewLines: 8 });

    expect(result.previewLines).toBe(8);
    expect(result.sort.field).toBe("ctime");
    expect(result.sort.direction).toBe("asc");
    expect(result.filter.tags).toEqual(["tag-a", "tag-b"]);
    expect(result.pinnedPaths).toEqual(["folder/note-1.md", "folder/note-2.md"]);
    expect(result.includeSubfolders).toBe(false);
    expect(result.defaultView).toBe("cards");
    expect(result.lastFolderPath).toBe("");
  });

  it("normalizes previewLines in patch for raw values 2, 3, 5, 8, 9", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { previewLines: 2 }).previewLines).toBe(3);
    expect(mergeSettings(DEFAULT_SETTINGS, { previewLines: 3 }).previewLines).toBe(3);
    expect(mergeSettings(DEFAULT_SETTINGS, { previewLines: 5 }).previewLines).toBe(5);
    expect(mergeSettings(DEFAULT_SETTINGS, { previewLines: 8 }).previewLines).toBe(8);
    expect(mergeSettings(DEFAULT_SETTINGS, { previewLines: 9 }).previewLines).toBe(8);
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
});


describe("mergeSettings — navSectionOrder", () => {
  it("replaces navSectionOrder wholesale and leaves sectionCollapsed intact", () => {
    const current: PluginSettings = {
      ...DEFAULT_SETTINGS,
      navSectionOrder: ["folders", "tags", "boxes", "favorites"],
      sectionCollapsed: { favorites: true, folders: true, tags: false, boxes: true },
      previewLines: 8,
      includeSubfolders: false,
    };

    const next: PluginSettings["navSectionOrder"] = ["boxes", "tags", "folders", "favorites"];
    const result = mergeSettings(current, { navSectionOrder: next });

    expect(result.navSectionOrder).toEqual(next);
    expect(result.sectionCollapsed).toEqual({
      favorites: true, folders: true, tags: false, boxes: true,
    });
    expect(result.previewLines).toBe(8);
    expect(result.includeSubfolders).toBe(false);
  });

  it("normalizes a partial or invalid navSectionOrder patch", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { navSectionOrder: ["boxes"] }).navSectionOrder)
      .toEqual(["boxes", "favorites", "folders", "tags"]);

    const patch = { navSectionOrder: null } as unknown;
    expect(mergeSettings(DEFAULT_SETTINGS, patch as never).navSectionOrder)
      .toEqual(["favorites", "folders", "tags", "boxes"]);
  });
});


describe("mergeSettings — defaultCardOpenBehavior", () => {
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

  it("updates cardCornerRadius while preserving unrelated settings fields", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      cardCornerRadius: "compact" as const,
      previewLines: 8,
      pinnedPaths: ["folder/note-1.md"],
      includeSubfolders: false,
    };

    const result = mergeSettings(current, { cardCornerRadius: "rounded" });

    expect(result.cardCornerRadius).toBe("rounded");
    expect(result.previewLines).toBe(8);
    expect(result.pinnedPaths).toEqual(["folder/note-1.md"]);
    expect(result.includeSubfolders).toBe(false);
  });

  it("normalizes invalid cardCornerRadius patches back to rounded", () => {
    const result = mergeSettings(DEFAULT_SETTINGS, { cardCornerRadius: "soft" } as never);

    expect(result.cardCornerRadius).toBe("rounded");
  });
});

describe("card box settings normalization", () => {
  it("defaults to empty boxes and null active box", () => {
    const result = normalizeSettings({});
    expect(result.boxes).toEqual([]);
    expect(result.activeBoxId).toBeNull();
  });

  it("drops invalid boxes and dedupes ids", () => {
    const result = normalizeSettings({
      boxes: [
        { id: "a", name: "A" },
        { id: "", name: "no-id" },
        { id: "a", name: "duplicate" },
        "not-an-object",
      ],
    } as never);

    expect(result.boxes.map((box) => box.id)).toEqual(["a"]);
    expect(result.boxes[0].name).toBe("A");
    expect(result.boxes[0].rules).toEqual([]);
    expect(result.boxes[0].sort).toEqual({ field: "mtime", direction: "desc" });
  });

  it("enforces the manual/excluded disjoint invariant", () => {
    const result = normalizeSettings({
      boxes: [
        {
          id: "a",
          name: "A",
          manualPaths: ["shared.md", "manual.md"],
          excludedPaths: ["shared.md", "excluded.md"],
        },
      ],
    } as never);

    expect(result.boxes[0].manualPaths).toEqual(["shared.md", "manual.md"]);
    expect(result.boxes[0].excludedPaths).toEqual(["excluded.md"]);
  });

  it("normalizes rule folders and tags", () => {
    const result = normalizeSettings({
      boxes: [
        {
          id: "a",
          name: "A",
          rules: [
            { folder: "/", includeSubfolders: false, tags: ["#Wip", "", 5] },
            "bad-rule",
          ],
        },
      ],
    } as never);

    expect(result.boxes[0].rules).toEqual([
      { folder: "", includeSubfolders: false, tags: ["#Wip"], id: "r:|false|#Wip", name: "" },
    ]);
  });

  it("falls back to null activeBoxId when it does not match a box", () => {
    expect(normalizeSettings({ boxes: [{ id: "a", name: "A" }], activeBoxId: "ghost" } as never).activeBoxId).toBeNull();
    expect(normalizeSettings({ boxes: [{ id: "a", name: "A" }], activeBoxId: "a" } as never).activeBoxId).toBe("a");
  });
});

describe("card grouping settings normalization", () => {
  it("defaults a v2 document with no preferences.group to the ungrouped spec", () => {
    const result = migrateSettings({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      preferences: { previewLines: 7 },
    });
    expect(result.group).toEqual(DEFAULT_GROUP_SPEC);
  });

  it("defaults a v1 flat document with no group to the ungrouped spec", () => {
    expect(migrateSettings({ lastFolderPath: "Projects" }).group).toEqual(DEFAULT_GROUP_SPEC);
  });

  it("rejects null, string, and out-of-domain group values", () => {
    expect(normalizeSettings({ group: null } as never).group).toEqual(DEFAULT_GROUP_SPEC);
    expect(normalizeSettings({ group: "folder" } as never).group).toEqual(DEFAULT_GROUP_SPEC);
    expect(normalizeSettings({ group: { dimension: "author" } } as never).group)
      .toEqual(DEFAULT_GROUP_SPEC);
  });

  it("keeps a valid group spec on the flat read view", () => {
    expect(normalizeSettings({
      group: { dimension: "task", orderBy: "count", orderDirection: "desc" },
    } as never).group).toEqual({ dimension: "task", orderBy: "count", orderDirection: "desc" });
  });

  it("normalizes a box with no group to ungrouped rather than inheriting the global group", () => {
    const result = normalizeSettings({
      group: { dimension: "folder", orderBy: "name", orderDirection: "desc" },
      boxes: [{ id: "a", name: "A" }],
    } as never);

    expect(result.group).toEqual({ dimension: "folder", orderBy: "name", orderDirection: "desc" });
    expect(result.boxes[0].group).toEqual(DEFAULT_GROUP_SPEC);
  });

  it("derives a missing rule id from rule content", () => {
    const result = normalizeSettings({
      boxes: [{
        id: "a",
        name: "A",
        rules: [{ folder: "Projects", includeSubfolders: false, tags: ["b", "a"] }],
      }],
    } as never);

    expect(result.boxes[0].rules[0].id).toBe("r:Projects|false|a,b");
  });

  it("re-derives then index-suffixes rules that share an explicit id", () => {
    const result = normalizeSettings({
      boxes: [{
        id: "a",
        name: "A",
        rules: [
          { folder: "Projects", includeSubfolders: true, tags: [], id: "dup" },
          { folder: "Archive", includeSubfolders: true, tags: [], id: "dup" },
          { folder: "Projects", includeSubfolders: true, tags: [], id: "dup" },
          { folder: "Projects", includeSubfolders: true, tags: [], id: "dup" },
        ],
      }],
    } as never);

    const ids = result.boxes[0].rules.map((rule) => rule.id);
    expect(ids).toEqual([
      "dup",
      "r:Archive|true|",
      "r:Projects|true|",
      "r:Projects|true|#3",
    ]);
    expect(new Set(ids).size).toBe(4);
  });

  it("keeps advancing the suffix when the indexed candidate is also taken", () => {
    // A hand-edited box can carry an explicit id equal to the candidate the
    // fallback would generate; accepting it blindly emits the same id twice and
    // silently merges two rules into one box-rule group.
    const result = normalizeSettings({
      boxes: [{
        id: "a",
        name: "A",
        rules: [
          { folder: "Projects", includeSubfolders: true, tags: [], id: "r:Projects|true|" },
          { folder: "Projects", includeSubfolders: true, tags: [], id: "r:Projects|true|#1" },
          { folder: "Projects", includeSubfolders: true, tags: [], id: "r:Projects|true|" },
        ],
      }],
    } as never);

    const ids = result.boxes[0].rules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toEqual([
      "r:Projects|true|",
      "r:Projects|true|#1",
      "r:Projects|true|#2",
    ]);
  });

  it("trims a rule name and defaults it to the empty string", () => {
    const result = normalizeSettings({
      boxes: [{
        id: "a",
        name: "A",
        rules: [
          { folder: "P", tags: [], name: "  Client work  " },
          { folder: "Q", tags: [], name: 5 },
        ],
      }],
    } as never);

    expect(result.boxes[0].rules.map((rule) => rule.name)).toEqual(["Client work", ""]);
  });

  it("adds exactly the grouping and rule-identity keys when re-serializing a v2 document", () => {
    const persisted = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      preferences: {
        sort: { field: "name", direction: "asc" },
        includeSubfolders: false,
        defaultView: "cards",
        defaultCardOpenBehavior: "new-tab",
        dragInsertAction: "wiki",
        cardCornerRadius: "compact",
        newNoteTemplate: "blank",
        previewLines: 8,
        showNavItemCounts: true,
        navSectionOrder: ["boxes", "tags", "folders", "favorites"],
      },
      workspace: {
        lastFolderPath: "Projects",
        expandedFolderPaths: ["Projects"],
        expandedTagPaths: ["work"],
        activeBoxId: "box-1",
        filterTags: ["work"],
        navPaneWidth: 200,
        navPaneCollapsed: true,
        sectionCollapsed: { favorites: true, folders: true, tags: false, boxes: true },
      },
      userData: {
        boxes: [{
          id: "box-1",
          name: "Inbox",
          rules: [{ folder: "Projects", includeSubfolders: true, tags: ["work"] }],
          manualPaths: ["Projects/A.md"],
          excludedPaths: ["Projects/B.md"],
          pinnedPaths: ["Projects/A.md"],
          sort: { field: "mtime", direction: "desc" },
        }],
        favorites: [{ kind: "folder", ref: "Projects" }],
        pinnedPaths: ["Projects/a.md"],
      },
    };

    // Upgrading a pre-grouping vault must add these four keys and nothing else.
    // Rule identity is written unconditionally: C11's downgrade path re-derives
    // a dropped id and falls back for a dropped name, which presumes both are
    // normally persisted.
    expect(serializeSettings(migrateSettings(persisted))).toEqual({
      ...persisted,
      preferences: { ...persisted.preferences, group: DEFAULT_GROUP_SPEC },
      userData: {
        ...persisted.userData,
        boxes: [{
          ...persisted.userData.boxes[0],
          rules: [{
            ...persisted.userData.boxes[0].rules[0],
            id: "r:Projects|true|work",
            name: "",
          }],
          group: DEFAULT_GROUP_SPEC,
        }],
      },
    });
  });
});

describe("favorites settings normalization", () => {
  it("defaults to an empty list and an expanded section", () => {
    const result = normalizeSettings({});
    expect(result.favorites).toEqual([]);
    expect(result.sectionCollapsed.favorites).toBe(false);
  });

  it("persists the section collapse flag", () => {
    expect(normalizeSettings({ favoritesSectionCollapsed: true } as never).sectionCollapsed.favorites).toBe(true);
    expect(normalizeSettings({ favoritesSectionCollapsed: "yes" } as never).sectionCollapsed.favorites).toBe(false);
  });

  it("drops non-objects, unknown kinds, non-string refs, and empty tag refs", () => {
    const result = normalizeSettings({
      favorites: [
        "not-an-object",
        null,
        { kind: "note", ref: "A.md" },
        { kind: "file", ref: 5 },
        { kind: "tag", ref: "  " },
        { kind: "box", ref: "" },
        { kind: "file", ref: "A.md" },
      ],
    } as never);

    expect(result.favorites).toEqual([{ kind: "file", ref: "A.md" }]);
  });

  it("dedupes on kind plus normalized ref", () => {
    const result = normalizeSettings({
      favorites: [
        { kind: "tag", ref: "#Work" },
        { kind: "tag", ref: "work" },
        { kind: "folder", ref: "Projects/" },
        { kind: "folder", ref: "Projects" },
      ],
    } as never);

    expect(result.favorites).toEqual([
      { kind: "folder", ref: "Projects" },
      { kind: "tag", ref: "work" },
    ]);
  });

  it("keeps the vault-root folder ref", () => {
    const result = normalizeSettings({ favorites: [{ kind: "folder", ref: "/" }] } as never);
    expect(result.favorites).toEqual([{ kind: "folder", ref: "" }]);
  });

  it("regroups a mixed input into folder, file, tag, box order", () => {
    const result = normalizeSettings({
      favorites: [
        { kind: "box", ref: "box-1" },
        { kind: "tag", ref: "#Work/AI" },
        { kind: "file", ref: "Notes/A.md" },
        { kind: "folder", ref: "Projects" },
      ],
    } as never);

    expect(result.favorites).toEqual([
      { kind: "folder", ref: "Projects" },
      { kind: "file", ref: "Notes/A.md" },
      { kind: "tag", ref: "work/ai" },
      { kind: "box", ref: "box-1" },
    ]);
  });
});

describe("migrateSettings — V47 schema versions", () => {
  it("migrates v0 lastViewMode all-notes to vault-root lastFolderPath", () => {
    expect(migrateSettings({ lastViewMode: "all-notes" }).lastFolderPath).toBe("");
    expect(migrateSettings({ lastViewMode: "all-notes", lastFolderPath: 12 }).lastFolderPath).toBe("");
    expect("lastViewMode" in migrateSettings({ lastViewMode: "all-notes" })).toBe(false);
    expect(migrateSettings({ lastViewMode: "all-notes" }).navSectionOrder).toEqual([
      "favorites", "folders", "tags", "boxes",
    ]);
  });

  it("migrates a v1 flat document including boxes, favorites, pins, and section collapse", () => {
    const result = migrateSettings({
      lastFolderPath: "Projects",
      pinnedPaths: ["Projects/a.md"],
      folderSectionCollapsed: true,
      tagSectionCollapsed: true,
      boxSectionCollapsed: false,
      favoritesSectionCollapsed: true,
      boxes: [{ id: "box-1", name: "Inbox" }],
      favorites: [{ kind: "folder", ref: "Projects" }],
      activeBoxId: "box-1",
      filter: { tags: ["work"] },
    });

    expect(result).toMatchObject({
      lastFolderPath: "Projects",
      pinnedPaths: ["Projects/a.md"],
      sectionCollapsed: { folders: true, tags: true, boxes: false, favorites: true },
      activeBoxId: "box-1",
      filter: { tags: ["work"] },
    });
    expect(result.boxes).toEqual([
      expect.objectContaining({ id: "box-1", name: "Inbox" }),
    ]);
    expect(result.favorites).toEqual([{ kind: "folder", ref: "Projects" }]);
    expect("lastViewMode" in result).toBe(false);
    expect(result.navSectionOrder).toEqual(["favorites", "folders", "tags", "boxes"]);
  });

  it("is idempotent for v2 documents and round-trips through serializeSettings", () => {
    const v2 = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      leftover: "drop-me",
      preferences: {
        sort: { field: "name", direction: "asc" },
        includeSubfolders: false,
        previewLines: 8,
        showNavItemCounts: true,
        navSectionOrder: ["boxes", "tags", "folders", "favorites"],
      },
      workspace: {
        lastFolderPath: "Projects",
        activeBoxId: "box-1",
        filterTags: ["work"],
        navPaneWidth: 200,
        navPaneCollapsed: true,
        sectionCollapsed: { favorites: true, folders: true, tags: false, boxes: true },
      },
      userData: {
        boxes: [{ id: "box-1", name: "Inbox" }],
        favorites: [{ kind: "folder", ref: "Projects" }],
        pinnedPaths: ["Projects/a.md"],
      },
    };

    const once = migrateSettings(v2);
    expect(migrateSettings(once)).toEqual(once);
    expect(migrateSettings(serializeSettings(once))).toEqual(once);
    expect(serializeSettings(once).schemaVersion).toBe(2);
    expect(serializeSettings(once).workspace.sectionCollapsed).toEqual({
      favorites: true, folders: true, tags: false, boxes: true,
    });
    expect(serializeSettings(once).preferences.navSectionOrder).toEqual([
      "boxes", "tags", "folders", "favorites",
    ]);
    expect(once.activeBoxId).toBe("box-1");
    expect(once.filter.tags).toEqual(["work"]);
    expect(once.sectionCollapsed).toEqual({
      favorites: true, folders: true, tags: false, boxes: true,
    });
    expect(once.navSectionOrder).toEqual(["boxes", "tags", "folders", "favorites"]);
  });

  it("re-serializes a v2 payload to a byte-identical payload", () => {
    const v2 = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      preferences: {
        sort: { field: "name", direction: "asc" },
        includeSubfolders: false,
        previewLines: 8,
        showNavItemCounts: true,
        navSectionOrder: ["boxes", "tags", "folders", "favorites"],
      },
      workspace: {
        lastFolderPath: "Projects",
        activeBoxId: "box-1",
        filterTags: ["work"],
        navPaneWidth: 200,
        navPaneCollapsed: true,
        sectionCollapsed: { favorites: true, folders: true, tags: false, boxes: true },
      },
      userData: {
        boxes: [{ id: "box-1", name: "Inbox" }],
        favorites: [{ kind: "folder", ref: "Projects" }],
        pinnedPaths: ["Projects/a.md"],
      },
    };

    const serializedOnce = serializeSettings(migrateSettings(v2));
    const serializedTwice = serializeSettings(migrateSettings(serializedOnce));

    // Re-serialization must be a fixed point: a persisted file rewritten by a
    // later load is byte-identical, not merely semantically equivalent.
    expect(JSON.stringify(serializedTwice)).toBe(JSON.stringify(serializedOnce));
    // Pinned against the canonical pre-Phase-0 emission order rather than
    // toEqual, which ignores key order and would accept a silently reordered
    // payload that rewrites every synced vault's data.json on first load.
    expect(JSON.stringify(serializedOnce.workspace.sectionCollapsed)).toBe(
      JSON.stringify({ favorites: true, folders: true, tags: false, boxes: true }),
    );
  });

  it("discards unrecognized top-level keys from v1 and v2 documents", () => {
    const v1 = migrateSettings({
      ...DEFAULT_SETTINGS,
      unknownTop: 1,
      searchQuery: "roadmap",
    });
    expect(v1).not.toHaveProperty("unknownTop");
    expect(v1).not.toHaveProperty("searchQuery");

    const v2 = migrateSettings({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      leftover: true,
      preferences: { previewLines: 6, unknownPref: 1 },
      workspace: { extra: "nope" },
    });
    expect(v2).not.toHaveProperty("leftover");
    expect(v2).not.toHaveProperty("unknownPref");
    expect(v2).not.toHaveProperty("extra");
    expect(v2.previewLines).toBe(6);
  });

  it("normalizes malformed preferences.navSectionOrder without changing schemaVersion", () => {
    const loaded = migrateSettings({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      preferences: { navSectionOrder: ["boxes", "boxes", "nope"] },
    });
    expect(loaded.navSectionOrder).toEqual(["boxes", "favorites", "folders", "tags"]);
    expect(serializeSettings(loaded).schemaVersion).toBe(2);
  });

  it("fills missing v2 layers from DEFAULT_SETTINGS", () => {
    expect(migrateSettings({ schemaVersion: SETTINGS_SCHEMA_VERSION })).toEqual(DEFAULT_SETTINGS);
    expect(
      migrateSettings({
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        preferences: { previewLines: 7 },
      }),
    ).toEqual({ ...DEFAULT_SETTINGS, previewLines: 7 });
  });

  it("keeps PartialPluginSettings deep-partial for sort and filter", () => {
    const patch: PartialPluginSettings = {
      sort: { field: "name" },
      filter: { tags: ["work"] },
    };
    const result = mergeSettings(DEFAULT_SETTINGS, patch);
    expect(result.sort).toEqual({ field: "name", direction: "desc" });
    expect(result.filter.tags).toEqual(["work"]);
  });

  it("populates sectionCollapsed from all four v1 legacy flat keys", () => {
    expect(migrateSettings({
      folderSectionCollapsed: true,
      tagSectionCollapsed: true,
      boxSectionCollapsed: true,
      favoritesSectionCollapsed: true,
    }).sectionCollapsed).toEqual({
      favorites: true, folders: true, tags: true, boxes: true,
    });
  });

  it("lets a v2 sectionCollapsed record win over leftover legacy flat keys", () => {
    expect(normalizeSettings({
      folderSectionCollapsed: true,
      tagSectionCollapsed: true,
      boxSectionCollapsed: true,
      favoritesSectionCollapsed: true,
      sectionCollapsed: { folders: false, tags: false },
    } as never).sectionCollapsed).toEqual({
      favorites: true, folders: false, tags: false, boxes: true,
    });
  });

  it("defaults every section to expanded on a v0 payload", () => {
    expect(migrateSettings({ lastViewMode: "all-notes" }).sectionCollapsed).toEqual({
      favorites: false, folders: false, tags: false, boxes: false,
    });
  });

  it("does not reset unpatched sections when merging a partial collapse patch", () => {
    const current = mergeSettings(DEFAULT_SETTINGS, {
      sectionCollapsed: { favorites: true, folders: true, tags: true, boxes: true },
    });
    const result = mergeSettings(current, { sectionCollapsed: { folders: false } });
    expect(result.sectionCollapsed).toEqual({
      favorites: true, folders: false, tags: true, boxes: true,
    });
  });
});
