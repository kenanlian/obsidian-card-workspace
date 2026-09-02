import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPipeline, applyTagFilter, applyPropertyFilter, applySearchFilter, applyPinReorder, stepsForScope } from "./pipeline";
import { createBoxScope, createFolderScope, type CardScope } from "./scope";
import type { PipelineContext } from "./pipeline";
import type { GroupBucket } from "./card-grouping";
import type { GroupSpec } from "../card-grouping-settings";
import { DEFAULT_GROUP_SPEC } from "../card-grouping-settings";
import type { NoteCardRecord } from "./types";
import type { CardFileKind } from "./file-kind";
import { PHASE3_MINISEARCH_CONTRACT } from "../search/types";
import type { PropertyScalarRef } from "../property-filter-settings";
import * as metadataUtils from "./metadata-utils";

const folderSteps = () => stepsForScope(createFolderScope("", true));

// ---------------------------------------------------------------------------
// Mock Helpers
// ---------------------------------------------------------------------------

function createMockContext(): PipelineContext {
  return {
    app: {} as PipelineContext["app"],
    filterTags: [],
    propertyFilters: [],
    search: {
      query: "",
      execution: "indexed-unavailable",
      orderedPaths: undefined,
    },
    pinnedPaths: [],
    group: { spec: { ...DEFAULT_GROUP_SPEC }, buckets: new Map() },
    collapsedGroupKeys: new Set(),
  };
}

function withPinnedPaths(context: PipelineContext, pinnedPaths: string[]): PipelineContext {
  return {
    ...context,
    pinnedPaths: [...pinnedPaths],
  };
}

/** Buckets a card by its top-level folder, which is enough to exercise grouping. */
function withFolderGrouping(
  context: PipelineContext,
  cards: readonly NoteCardRecord[],
  spec: Partial<GroupSpec> = {},
): PipelineContext {
  const buckets = new Map<string, GroupBucket>();
  for (const card of cards) {
    const separatorIndex = card.path.lastIndexOf("/");
    const parentPath = separatorIndex === -1 ? "" : card.path.slice(0, separatorIndex);
    buckets.set(card.path, {
      key: `folder:${parentPath}`,
      label: parentPath === "" ? "Vault root" : parentPath,
      detail: parentPath,
      sortKey: parentPath,
      isMissing: false,
    });
  }

  return {
    ...context,
    group: { spec: { ...DEFAULT_GROUP_SPEC, dimension: "folder", ...spec }, buckets },
  };
}

interface CreateMockCardOptions {
  fileKind?: CardFileKind;
  title?: string;
}

function createMockCard(path: string, excerpt = "", options: CreateMockCardOptions = {}): NoteCardRecord {
  const { fileKind = "markdown", title = path.replace(/.*\//, "").replace(/\.[^.]+$/, "") } = options;

  return {
    file: { path, basename: path.replace(/.*\//, "").replace(/\.[^.]+$/, "") } as NoteCardRecord["file"],
    fileKind,
    path,
    title,
    ctime: Date.now(),
    mtime: Date.now(),
    excerpt,
    previewHtml: "",
    previewMode: "empty",
    hydrated: false,
    taskSummary: null,
  };
}

const text = (value: string): PropertyScalarRef => ({ kind: "text", value });

// ---------------------------------------------------------------------------
// runPipeline
// ---------------------------------------------------------------------------

describe("runPipeline", () => {
  it("returns input unchanged when steps array is empty", () => {
    const cards = [createMockCard("test.md")];
    const context = createMockContext();
    const result = runPipeline(cards, [], context);
    expect(result.cards).toBe(cards);
    expect(result.segments).toEqual([]);
  });

  it("returns input unchanged with identity folder-scope steps", () => {
    const cards = [createMockCard("a.md"), createMockCard("b.md")];
    const context = createMockContext();
    const result = runPipeline(cards, folderSteps(), context);
    expect(result.cards).toEqual(cards);
  });

  it("chains steps in order — step N receives step N-1 output", () => {
    const cards = [createMockCard("original.md")];
    const context = createMockContext();

    const step1 = vi.fn((c: NoteCardRecord[]) => [...c, createMockCard("added-step1.md")]);
    const step2 = vi.fn((c: NoteCardRecord[]) => [...c, createMockCard("added-step2.md")]);
    const step3 = vi.fn((c: NoteCardRecord[]) => [...c, createMockCard("added-step3.md")]);

    const result = runPipeline(cards, [step1, step2, step3], context);

    expect(step1).toHaveBeenCalledWith(cards, context);
    expect(step2).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ path: "added-step1.md" })]), context);
    expect(step3).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ path: "added-step2.md" })]), context);
    expect(result.cards).toHaveLength(4);
  });

  it("returns empty array when given empty cards", () => {
    const context = createMockContext();
    const result = runPipeline([], folderSteps(), context);
    expect(result.cards).toEqual([]);
  });

  it("passes context to each step", () => {
    const cards = [createMockCard("test.md")];
    const context = createMockContext();

    const mockStep = vi.fn((c: NoteCardRecord[]) => c);
    runPipeline(cards, [mockStep], context);

    expect(mockStep).toHaveBeenCalledWith(cards, context);
  });
});

// ---------------------------------------------------------------------------
// Group arrangement stage
// ---------------------------------------------------------------------------

describe("group arrangement stage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the same card array reference and no segments for dimension none", () => {
    const cards = [createMockCard("notes/a.md"), createMockCard("b.md")];
    const context = createMockContext();

    const result = runPipeline(cards, [], context);

    expect(result.cards).toBe(cards);
    expect(result.segments).toEqual([]);
  });

  it("returns populated segments for an empty query with a dimension set", () => {
    const cards = [
      createMockCard("notes/a.md"),
      createMockCard("archive/b.md"),
      createMockCard("notes/c.md"),
    ];
    const context = withFolderGrouping(createMockContext(), cards);

    const result = runPipeline(cards, folderSteps(), context);

    expect(result.segments.map((segment) => segment.key)).toEqual([
      "folder:archive",
      "folder:notes",
    ]);
    expect(result.segments.map((segment) => segment.count)).toEqual([1, 2]);
    expect(result.cards.map((card) => card.path)).toEqual([
      "archive/b.md",
      "notes/a.md",
      "notes/c.md",
    ]);
  });

  it("pauses grouping for a non-empty query regardless of execution state", () => {
    const cards = [createMockCard("notes/a.md"), createMockCard("archive/b.md")];
    const executions = ["indexed-ready", "indexed-building", "indexed-unavailable"] as const;

    for (const execution of executions) {
      const context = withFolderGrouping(createMockContext(), cards);
      context.search.query = "roadmap";
      context.search.execution = execution;
      context.search.orderedPaths = ["notes/a.md", "archive/b.md"];

      const result = runPipeline(cards, folderSteps(), context);
      expect(result.segments, execution).toEqual([]);
    }
  });

  it("leaves the collapse set intact while paused so clearing the query restores it", () => {
    const cards = [createMockCard("notes/a.md"), createMockCard("archive/b.md")];
    const context = withFolderGrouping(createMockContext(), cards);
    context.collapsedGroupKeys = new Set(["folder:archive"]);

    context.search.query = "roadmap";
    context.search.execution = "indexed-ready";
    context.search.orderedPaths = ["notes/a.md", "archive/b.md"];
    expect(runPipeline(cards, folderSteps(), context).segments).toEqual([]);

    context.search.query = "";
    context.search.orderedPaths = undefined;
    const restored = runPipeline(cards, folderSteps(), context);
    expect(restored.cards.map((card) => card.path)).toEqual(["notes/a.md"]);
    expect(restored.segments.map((segment) => [segment.key, segment.collapsed])).toEqual([
      ["folder:archive", true],
      ["folder:notes", false],
    ]);
  });

  it("keeps a pinned card leading its own group instead of the whole stream", () => {
    const cards = [
      createMockCard("archive/a.md"),
      createMockCard("archive/b.md"),
      createMockCard("notes/c.md"),
      createMockCard("notes/d.md"),
    ];
    const context = withFolderGrouping(
      withPinnedPaths(createMockContext(), ["notes/d.md"]),
      cards,
    );

    const result = runPipeline(cards, folderSteps(), context);

    expect(result.cards.map((card) => card.path)).toEqual([
      "archive/a.md",
      "archive/b.md",
      "notes/d.md",
      "notes/c.md",
    ]);
  });
});

// ---------------------------------------------------------------------------
// applyTagFilter behavior tests (Task 2 — TDD RED phase)
// ---------------------------------------------------------------------------

describe("applyTagFilter behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns all cards when filterTags is empty", () => {
    const cards = [
      createMockCard("note-a.md"),
      createMockCard("note-b.md"),
      createMockCard("note-c.md"),
    ];
    const context = createMockContext();
    context.filterTags = [];

    // Mock matchesTagFilter to return true (accepting all cards)
    vi.spyOn(metadataUtils, "matchesTagFilter").mockReturnValue(true);

    const result = applyTagFilter(cards, context);
    expect(result).toEqual(cards);
    expect(result).toHaveLength(3);
  });

  it("excludes cards that do not match all selected tags (AND semantics)", () => {
    const cardA = createMockCard("has-both.md");
    const cardB = createMockCard("has-only-first.md");
    const cardC = createMockCard("has-only-second.md");
    const cardD = createMockCard("has-neither.md");

    const cards = [cardA, cardB, cardC, cardD];
    const context = createMockContext();
    context.filterTags = ["important", "archived"];

    vi.spyOn(metadataUtils, "matchesTagFilter").mockImplementation((_app, file, filterTags) => {
      if (file.path === "has-both.md") {
        return filterTags.every((tag) => ["important", "archived"].includes(tag));
      }
      if (file.path === "has-only-first.md") {
        return filterTags.every((tag) => ["important"].includes(tag));
      }
      if (file.path === "has-only-second.md") {
        return filterTags.every((tag) => ["archived"].includes(tag));
      }
      return false;
    });

    const result = applyTagFilter(cards, context);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(cardA);
  });

  it("returns empty array when no cards match the filter", () => {
    const cards = [
      createMockCard("note-a.md"),
      createMockCard("note-b.md"),
    ];
    const context = createMockContext();
    context.filterTags = ["nonexistent-tag"];

    // Mock: no cards match
    vi.spyOn(metadataUtils, "matchesTagFilter").mockReturnValue(false);

    const result = applyTagFilter(cards, context);
    expect(result).toEqual([]);
  });

  it("returns empty array for no-tag cards when filter tags are selected", () => {
    const cards = [
      createMockCard("no-tags-a.md"),
      createMockCard("no-tags-b.md"),
    ];
    const context = createMockContext();
    context.filterTags = ["work"];

    vi.spyOn(metadataUtils, "matchesTagFilter").mockReturnValue(false);

    const result = applyTagFilter(cards, context);

    expect(result).toEqual([]);
  });

  it("passes selected tags through to metadata matching helper", () => {
    const cards = [createMockCard("sample.md")];
    const context = createMockContext();
    context.filterTags = ["#Important", "Work"];

    const matchesSpy = vi.spyOn(metadataUtils, "matchesTagFilter").mockReturnValue(true);

    const result = applyTagFilter(cards, context);

    expect(result).toEqual(cards);
    expect(matchesSpy).toHaveBeenCalledTimes(1);
    expect(matchesSpy).toHaveBeenCalledWith(context.app, cards[0]?.file, ["#Important", "Work"]);
  });

  it("preserves card order when filtering", () => {
    const cardA = createMockCard("a.md");
    const cardB = createMockCard("b.md");
    const cardC = createMockCard("c.md");
    const cards = [cardA, cardB, cardC];

    const context = createMockContext();
    context.filterTags = ["selected"];

    vi.spyOn(metadataUtils, "matchesTagFilter").mockImplementation((_app, file, filterTags) => {
      const aHasTags = ["selected"].includes(filterTags[0]);
      const bHasTags = ["selected"].includes(filterTags[0]);
      if (file.path === "a.md") return aHasTags;
      if (file.path === "b.md") return bHasTags;
      if (file.path === "c.md") return false;
      return false;
    });

    const result = applyTagFilter(cards, context);
    expect(result).toEqual([cardA, cardB]);
    expect(result[0]).toBe(cardA);
    expect(result[1]).toBe(cardB);
  });

  it("correctly applies multiple-tag AND logic: all tags required", () => {
    const cardMatch = createMockCard("matches-all.md");
    const cardMissOne = createMockCard("missing-one.md");
    const cards = [cardMatch, cardMissOne];

    const context = createMockContext();
    context.filterTags = ["tag1", "tag2", "tag3"];

    vi.spyOn(metadataUtils, "matchesTagFilter").mockImplementation((_app, file, filterTags) => {
      if (file.path === "matches-all.md") {
        return filterTags.every((tag) => ["tag1", "tag2", "tag3"].includes(tag));
      }
      if (file.path === "missing-one.md") {
        return filterTags.every((tag) => ["tag1", "tag2"].includes(tag));
      }
      return false;
    });

    const result = applyTagFilter(cards, context);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(cardMatch);
  });
});

// ---------------------------------------------------------------------------
// applyPropertyFilter behavior (WP-02 V10)
// ---------------------------------------------------------------------------

describe("applyPropertyFilter behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the same array reference when propertyFilters is empty", () => {
    const cards = [createMockCard("a.md"), createMockCard("b.md")];
    const context = createMockContext();
    context.propertyFilters = [];

    expect(applyPropertyFilter(cards, context)).toBe(cards);
  });

  it("returns the same array reference when clauses normalize to empty", () => {
    const cards = [createMockCard("a.md")];
    const context = createMockContext();
    context.propertyFilters = [{ key: "status", values: [] }];

    expect(applyPropertyFilter(cards, context)).toBe(cards);
  });

  it("applies tag, property, and search filters before pin reorder in one folder pass", () => {
    const cards = [
      createMockCard("tag-filtered.md", "query-hit"),
      createMockCard("prop-filtered.md", "query-hit"),
      createMockCard("visible-pinned.md", "query-hit"),
      createMockCard("visible-unpinned.md", "query-hit"),
      createMockCard("search-filtered.md", "query-hit"),
    ];
    const baseContext = createMockContext();
    baseContext.filterTags = ["project"];
    baseContext.propertyFilters = [{ key: "status", values: [text("open")] }];
    baseContext.search.query = "query-hit";
    baseContext.search.execution = "indexed-ready";
    baseContext.search.orderedPaths = ["visible-pinned.md", "visible-unpinned.md"];
    // Pinning the property-filtered card must not reintroduce it (non-bypass).
    const context = withPinnedPaths(baseContext, ["prop-filtered.md", "visible-pinned.md"]);

    vi.spyOn(metadataUtils, "matchesTagFilter").mockImplementation((_app, file) => {
      return file.path !== "tag-filtered.md";
    });
    vi.spyOn(metadataUtils, "getFileFrontmatter").mockImplementation((_app, file) => {
      return file.path === "prop-filtered.md" ? { status: "done" } : { status: "open" };
    });

    expect(runPipeline(cards, folderSteps(), context).cards.map((card) => card.path)).toEqual([
      "visible-pinned.md",
      "visible-unpinned.md",
    ]);
  });

  it("applies property filtering in box scopes before search and pin", () => {
    const cards = [
      createMockCard("prop-filtered.md", "query-hit"),
      createMockCard("visible.md", "query-hit"),
    ];
    const baseContext = createMockContext();
    baseContext.filterTags = ["folder-only-filter"];
    baseContext.propertyFilters = [{ key: "status", values: [text("open")] }];
    baseContext.search.query = "query-hit";
    baseContext.search.execution = "indexed-ready";
    baseContext.search.orderedPaths = ["visible.md"];
    const context = withPinnedPaths(baseContext, ["prop-filtered.md", "visible.md"]);

    // Tag filtering is skipped for box scopes; this rejecting mock proves it.
    vi.spyOn(metadataUtils, "matchesTagFilter").mockReturnValue(false);
    vi.spyOn(metadataUtils, "getFileFrontmatter").mockImplementation((_app, file) => {
      return file.path === "visible.md" ? { status: "open" } : { status: "done" };
    });

    const steps = stepsForScope(createBoxScope("box-1"));
    expect(steps).not.toContain(applyTagFilter);
    expect(steps[0]).toBe(applyPropertyFilter);

    expect(runPipeline(cards, steps, context).cards.map((card) => card.path)).toEqual(["visible.md"]);
  });

  it("projects zero cards for a non-ready search even with an active property clause", () => {
    const cards = [
      createMockCard("a.md", "query-hit"),
      createMockCard("b.md", "query-hit"),
    ];
    const context = createMockContext();
    context.propertyFilters = [{ key: "status", values: [text("open")] }];
    context.search.query = "query-hit";
    context.search.execution = "indexed-unavailable";

    vi.spyOn(metadataUtils, "getFileFrontmatter").mockReturnValue({ status: "open" });

    expect(runPipeline(cards, folderSteps(), context).cards).toEqual([]);
  });

  it("groups only cards that passed the property filter", () => {
    const cards = [
      createMockCard("notes/a.md"),
      createMockCard("notes/b.md"),
      createMockCard("archive/c.md"),
    ];
    const context = withFolderGrouping(createMockContext(), cards);
    context.propertyFilters = [{ key: "status", values: [text("open")] }];

    vi.spyOn(metadataUtils, "getFileFrontmatter").mockImplementation((_app, file) => {
      return file.path === "notes/b.md" ? { status: "done" } : { status: "open" };
    });

    const result = runPipeline(cards, folderSteps(), context);

    expect(result.cards.map((card) => card.path)).toEqual([
      "archive/c.md",
      "notes/a.md",
    ]);
    expect(result.segments.map((segment) => segment.key)).toEqual([
      "folder:archive",
      "folder:notes",
    ]);
    expect(result.segments.map((segment) => segment.count)).toEqual([1, 1]);
  });
});

// ---------------------------------------------------------------------------
// applySearchFilter behavior
// ---------------------------------------------------------------------------

describe("apply search filter behavior", () => {
  it("returns all cards when query is empty", () => {
    const cards = [createMockCard("alpha.md"), createMockCard("beta.md")];
    const context = createMockContext();
    context.search.query = "";

    expect(applySearchFilter(cards, context)).toEqual(cards);
  });

  it("returns all cards when query is whitespace", () => {
    const cards = [createMockCard("alpha.md"), createMockCard("beta.md")];
    const context = createMockContext();
    context.search.query = "   ";

    expect(applySearchFilter(cards, context)).toEqual(cards);
  });

  it("projects zero cards when a non-empty query is blocked by unavailable indexed search", () => {
    const cards = [
      createMockCard("Quarterly-Roadmap.md"),
      createMockCard("Meeting-Notes.md"),
    ];
    const context = createMockContext();
    context.search.query = "roadmap";
    context.search.execution = "indexed-unavailable";

    expect(applySearchFilter(cards, context)).toEqual([]);
  });

  it("treats orderedPaths empty array as indexed-ready zero results", () => {
    const cards = [createMockCard("Quarterly-Roadmap.md"), createMockCard("Meeting-Notes.md")];
    const context = createMockContext();
    context.search.query = "roadmap";
    context.search.execution = "indexed-ready";
    context.search.orderedPaths = [];

    expect(applySearchFilter(cards, context)).toEqual([]);
  });

  it("distinguishes indexed-ready zero results from blocked unavailable search states by execution contract", () => {
    const cards = [
      createMockCard("Quarterly-Roadmap.md", "roadmap body"),
      createMockCard("Meeting-Notes.md", "meeting body"),
    ];
    const readyZeroContext = createMockContext();
    readyZeroContext.search.query = "roadmap";
    readyZeroContext.search.execution = "indexed-ready";
    readyZeroContext.search.orderedPaths = [];

    const blockedContext = createMockContext();
    blockedContext.search.query = "roadmap";
    blockedContext.search.execution = "indexed-unavailable";
    blockedContext.search.orderedPaths = undefined;

    expect(applySearchFilter(cards, readyZeroContext)).toEqual([]);
    expect(applySearchFilter(cards, blockedContext)).toEqual([]);
    expect(readyZeroContext.search.execution).toBe("indexed-ready");
    expect(readyZeroContext.search.orderedPaths).toEqual([]);
    expect(blockedContext.search.execution).toBe("indexed-unavailable");
    expect(blockedContext.search.orderedPaths).toBeUndefined();
  });

  it("uses orderedPaths ordering when indexed results are provided", () => {
    const cards = [
      createMockCard("alpha.md", "alpha body"),
      createMockCard("beta.md", "beta body"),
      createMockCard("gamma.md", "gamma body"),
    ];
    const context = createMockContext();
    context.search.query = "body";
    context.search.execution = "indexed-ready";
    context.search.orderedPaths = ["gamma.md", "missing.md", "alpha.md"];

    expect(applySearchFilter(cards, context).map((card) => card.path)).toEqual(["gamma.md", "alpha.md"]);
  });

  it("treats indexed-ready ordered paths as authoritative for non-empty queries", () => {
    const cards = [
      createMockCard("notes/roadmap.md", "roadmap body", { fileKind: "markdown", title: "roadmap" }),
      createMockCard("boards/alpha.canvas", "This is a canvas file.", {
        fileKind: "canvas",
        title: "alpha.canvas",
      }),
      createMockCard("sketches/idea.excalidraw", "This is an excalidraw file.", {
        fileKind: "excalidraw",
        title: "idea.excalidraw",
      }),
    ];

    const context = createMockContext();
    context.search.query = "canvas";
    context.search.execution = "indexed-ready";
    context.search.orderedPaths = ["notes/roadmap.md"];

    expect(applySearchFilter(cards, context).map((card) => card.path)).toEqual(["notes/roadmap.md"]);

    context.search.query = "excalidraw file";
    context.search.execution = "indexed-unavailable";
    context.search.orderedPaths = undefined;
    expect(applySearchFilter(cards, context).map((card) => card.path)).toEqual([]);
  });

  it("projects zero cards for all blocked non-ready indexed executions", () => {
    const cards = [
      createMockCard("zeta.md", "query-hit"),
      createMockCard("alpha.md", "query-hit"),
      createMockCard("beta.md", "nope"),
      createMockCard("delta.md", "query-hit"),
    ];
    const blockedExecutions = [
      "indexed-building",
      "indexed-rebuild-required",
      "indexed-storage-unavailable",
      "indexed-error",
      "indexed-unavailable",
    ] as const;

    for (const execution of blockedExecutions) {
      const context = createMockContext();
      context.search.query = "query-hit";
      context.search.execution = execution;

      expect(applySearchFilter(cards, context), execution).toEqual([]);
    }
  });

  it("restores unfiltered projection for empty query even when orderedPaths is []", () => {
    const cards = [createMockCard("alpha.md"), createMockCard("beta.md")];
    const context = createMockContext();
    context.search.query = "";
    context.search.execution = "indexed-ready";
    context.search.orderedPaths = [];

    expect(applySearchFilter(cards, context)).toEqual(cards);
  });

  it("locks the phase 3 indexed search MiniSearch contract", () => {
    expect(PHASE3_MINISEARCH_CONTRACT.indexFields).toEqual(["title", "content"]);
    expect(PHASE3_MINISEARCH_CONTRACT.storeFields).toEqual(["path", "title", "excerpt"]);
    expect(PHASE3_MINISEARCH_CONTRACT.normalize).toBe("lowercase");
    expect(PHASE3_MINISEARCH_CONTRACT.tokenizer).toEqual({
      hanScope: "unicode-script-han",
      indexStrategy: "unigram-and-overlapping-bigram",
      queryStrategy: "single-unigram-else-overlapping-bigram",
    });
    expect(PHASE3_MINISEARCH_CONTRACT.query).toEqual({
      prefixPolicy: "non-han-only",
      fuzzy: false,
      combineWith: "AND",
    });
    expect(PHASE3_MINISEARCH_CONTRACT.boost).toEqual({
      title: 3,
      content: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// applyPinReorder Behavioral Tests (Task 3 — TDD RED phase)
// ---------------------------------------------------------------------------

describe("applyPinReorder", () => {
  it("returns empty array when given empty cards", () => {
    const context = createMockContext();
    const result = applyPinReorder([], context);
    expect(result).toEqual([]);
  });

  it("does not reintroduce pinned cards removed by tag filtering in the default pipeline", () => {
    const cards = [
      createMockCard("visible-pinned.md"),
      createMockCard("filtered-pinned.md"),
      createMockCard("visible-unpinned.md"),
    ];
    const baseContext = createMockContext();
    baseContext.filterTags = ["project"];
    const context = withPinnedPaths(baseContext, ["filtered-pinned.md", "visible-pinned.md"]);

    vi.spyOn(metadataUtils, "matchesTagFilter").mockImplementation((_app, file) => {
      return file.path !== "filtered-pinned.md";
    });

    expect(runPipeline(cards, folderSteps(), context).cards.map((card) => card.path)).toEqual([
      "visible-pinned.md",
      "visible-unpinned.md",
    ]);
  });

  it("does not reintroduce pinned cards removed by search filtering in the default pipeline", () => {
    const cards = [
      createMockCard("visible-pinned.md", "query-hit"),
      createMockCard("filtered-pinned.md", "different text"),
      createMockCard("visible-unpinned.md", "query-hit"),
    ];
    const baseContext = createMockContext();
    baseContext.search.query = "query-hit";
    baseContext.search.execution = "indexed-ready";
    baseContext.search.orderedPaths = ["visible-pinned.md", "visible-unpinned.md"];
    const context = withPinnedPaths(baseContext, ["filtered-pinned.md", "visible-pinned.md"]);

    expect(runPipeline(cards, folderSteps(), context).cards.map((card) => card.path)).toEqual([
      "visible-pinned.md",
      "visible-unpinned.md",
    ]);
  });

  it("applies tag and search filters before pin reorder in one default-pipeline pass", () => {
    const cards = [
      createMockCard("visible-pinned.md", "query-hit"),
      createMockCard("tag-filtered-pinned.md", "query-hit"),
      createMockCard("visible-unpinned.md", "query-hit"),
      createMockCard("search-filtered.md", "no-match"),
    ];
    const baseContext = createMockContext();
    baseContext.filterTags = ["project"];
    baseContext.search.query = "query-hit";
    baseContext.search.execution = "indexed-ready";
    baseContext.search.orderedPaths = ["visible-pinned.md", "tag-filtered-pinned.md", "visible-unpinned.md"];
    const context = withPinnedPaths(baseContext, ["tag-filtered-pinned.md", "visible-pinned.md"]);

    vi.spyOn(metadataUtils, "matchesTagFilter").mockImplementation((_app, file) => {
      return file.path !== "tag-filtered-pinned.md";
    });

    expect(runPipeline(cards, folderSteps(), context).cards.map((card) => card.path)).toEqual([
      "visible-pinned.md",
      "visible-unpinned.md",
    ]);
  });

  it("keeps tag -> indexed search -> pin sequencing in the default pipeline", () => {
    const cards = [
      createMockCard("a.md", "query-hit"),
      createMockCard("b.md", "query-hit"),
      createMockCard("c.md", "query-hit"),
      createMockCard("d.md", "query-hit"),
    ];
    const baseContext = createMockContext();
    baseContext.filterTags = ["project"];
    baseContext.search.query = "query-hit";
    baseContext.search.execution = "indexed-ready";
    baseContext.search.orderedPaths = ["d.md", "b.md", "a.md"];
    const context = withPinnedPaths(baseContext, ["a.md", "b.md"]);

    vi.spyOn(metadataUtils, "matchesTagFilter").mockImplementation((_app, file) => {
      return file.path !== "b.md";
    });

    expect(runPipeline(cards, folderSteps(), context).cards.map((card) => card.path)).toEqual([
      "a.md",
      "d.md",
    ]);
  });

  it("preserves relative order within pinned and unpinned segments after filtering", () => {
    const cards = [
      createMockCard("a.md"),
      createMockCard("b.md"),
      createMockCard("c.md"),
      createMockCard("d.md"),
    ];
    const baseContext = createMockContext();
    baseContext.filterTags = ["active"];
    const context = withPinnedPaths(baseContext, ["c.md", "a.md", "duplicate-missing.md", "c.md"]);

    vi.spyOn(metadataUtils, "matchesTagFilter").mockImplementation((_app, file) => {
      return file.path !== "b.md";
    });

    expect(runPipeline(cards, folderSteps(), context).cards.map((card) => card.path)).toEqual([
      "a.md",
      "c.md",
      "d.md",
    ]);
  });

  it("returns cards unchanged when no pinned paths are provided to the pipeline", () => {
    const cards = [createMockCard("a.md"), createMockCard("b.md")];
    const context = createMockContext();
    const result = applyPinReorder(cards, context);
    expect(result).toEqual(cards);
  });

  it("moves pinned cards to the front while preserving relative order", () => {
    const cards = [
      createMockCard("a.md"),
      createMockCard("b.md"),
      createMockCard("c.md"),
      createMockCard("d.md"),
    ];
    const context = createMockContext();
    // Assume future settings.pinnedPaths = ["b.md", "d.md"]
    // Pinned cards must appear in their ORIGINAL relative order from input, not pinnedPaths order
    // Mock: extend context to have pinnedPaths
    const contextWithPins = withPinnedPaths(context, ["b.md", "d.md"]);

    const result = applyPinReorder(cards, contextWithPins);

    // Expected: pinned [b, d] first (in their original relative order from input), then unpinned [a, c]
    expect(result).toHaveLength(4);
    expect(result[0]?.path).toBe("b.md");
    expect(result[1]?.path).toBe("d.md");
    expect(result[2]?.path).toBe("a.md");
    expect(result[3]?.path).toBe("c.md");
  });

  it("preserves relative order of pinned cards", () => {
    const cards = [
      createMockCard("a.md"),
      createMockCard("b.md"),
      createMockCard("c.md"),
      createMockCard("d.md"),
      createMockCard("e.md"),
    ];
    const context = createMockContext();
    // Pinned paths listed in this order: c, a
    // But in the input array, a comes before c
    // So in the pinned segment, a must come before c (preserving input order)
    const contextWithPins = withPinnedPaths(context, ["c.md", "a.md"]);

    const result = applyPinReorder(cards, contextWithPins);

    // Expected: a comes before c (as in the input array), not as in pinnedPaths order
    expect(result[0]?.path).toBe("a.md");
    expect(result[1]?.path).toBe("c.md");
    expect(result[2]?.path).toBe("b.md");
    expect(result[3]?.path).toBe("d.md");
    expect(result[4]?.path).toBe("e.md");
  });

  it("preserves relative order of unpinned cards", () => {
    const cards = [
      createMockCard("a.md"),
      createMockCard("b.md"),
      createMockCard("c.md"),
      createMockCard("d.md"),
    ];
    const context = createMockContext();
    // Pin only b
    const contextWithPins = withPinnedPaths(context, ["b.md"]);

    const result = applyPinReorder(cards, contextWithPins);

    // Expected: b first (pinned), then a, c, d (in original order)
    expect(result[0]?.path).toBe("b.md");
    expect(result[1]?.path).toBe("a.md");
    expect(result[2]?.path).toBe("c.md");
    expect(result[3]?.path).toBe("d.md");
  });

  it("does not restore filtered-out pinned cards (non-bypass semantics)", () => {
    // This tests the critical constraint: pinning only reorders current input
    // It does NOT restore cards that were removed by earlier pipeline steps
    const cards = [
      createMockCard("a.md"),
      createMockCard("c.md"),
      // note: b.md is absent (filtered out by applyTagFilter or applySearchFilter)
    ];
    const context = createMockContext();
    // Try to pin b.md, but it's not in the current pipeline input
    const contextWithPins = withPinnedPaths(context, ["b.md"]);

    const result = applyPinReorder(cards, contextWithPins);

    // Expected: b.md should NOT appear (only a, c in original order)
    expect(result).toHaveLength(2);
    expect(result[0]?.path).toBe("a.md");
    expect(result[1]?.path).toBe("c.md");
  });

  it("handles partial pin match: only pins cards that exist in current input", () => {
    const cards = [
      createMockCard("a.md"),
      createMockCard("b.md"),
      createMockCard("c.md"),
    ];
    const context = createMockContext();
    // Request pins for b, d, e (but d and e don't exist in current input)
    const contextWithPins = withPinnedPaths(context, ["b.md", "d.md", "e.md"]);

    const result = applyPinReorder(cards, contextWithPins);

    // Expected: b pinned first, then a, c (in original relative order)
    // d and e are ignored because they're not in the current input
    expect(result).toHaveLength(3);
    expect(result[0]?.path).toBe("b.md");
    expect(result[1]?.path).toBe("a.md");
    expect(result[2]?.path).toBe("c.md");
  });

  it("handles empty pinnedPaths array like no pinning", () => {
    const cards = [createMockCard("a.md"), createMockCard("b.md")];
    const context = createMockContext();
    const contextWithPins = withPinnedPaths(context, []);

    const result = applyPinReorder(cards, contextWithPins);

    // Expected: unchanged
    expect(result).toEqual(cards);
  });

  it("ignores duplicate pinned paths while preserving stable partition order", () => {
    const cards = [
      createMockCard("a.md"),
      createMockCard("b.md"),
      createMockCard("c.md"),
      createMockCard("d.md"),
    ];
    const context = createMockContext();
    const contextWithDuplicatePins = withPinnedPaths(context, ["c.md", "c.md", "a.md", "a.md"]);

    const result = applyPinReorder(cards, contextWithDuplicatePins);

    expect(result).toHaveLength(4);
    expect(result.map((card) => card.path)).toEqual(["a.md", "c.md", "b.md", "d.md"]);
  });
});

// ---------------------------------------------------------------------------
// stepsForScope
// ---------------------------------------------------------------------------

describe("stepsForScope", () => {
  it("contains exactly 4 steps in correct order for folder scopes", () => {
    const steps = folderSteps();
    expect(steps).toHaveLength(4);
    expect(steps[0]).toBe(applyTagFilter);
    expect(steps[1]).toBe(applyPropertyFilter);
    expect(steps[2]).toBe(applySearchFilter);
    expect(steps[3]).toBe(applyPinReorder);
  });

  it("contains exactly 3 steps in correct order for box scopes", () => {
    const steps = stepsForScope(createBoxScope("box-1"));
    expect(steps).toHaveLength(3);
    expect(steps[0]).toBe(applyPropertyFilter);
    expect(steps[1]).toBe(applySearchFilter);
    expect(steps[2]).toBe(applyPinReorder);
  });

  it("full pipeline with defaults returns input unchanged", () => {
    const cards = [createMockCard("a.md"), createMockCard("b.md"), createMockCard("c.md")];
    const context = createMockContext();
    const result = runPipeline(cards, folderSteps(), context);
    expect(result.cards).toEqual(cards);
    expect(result.cards).toHaveLength(3);
  });

  it("skips tag filtering for box scopes without shrinking box membership", () => {
    const cards = [createMockCard("box-a.md"), createMockCard("box-b.md")];
    const context = createMockContext();
    context.filterTags = ["folder-only-filter"];
    vi.spyOn(metadataUtils, "matchesTagFilter").mockReturnValue(false);

    const steps = stepsForScope(createBoxScope("box-1"));
    expect(steps).not.toContain(applyTagFilter);
    expect(runPipeline(cards, steps, context).cards).toEqual(cards);
  });

  it("throws for an unhandled card source instead of inheriting folder steps", () => {
    const unknownScope = { kind: "links", targetPath: "a.md" } as unknown as CardScope;
    expect(() => stepsForScope(unknownScope)).toThrow(/Unhandled card source/);
  });
});
