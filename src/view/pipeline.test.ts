import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPipeline, applyTagFilter, applySearchFilter, applyPinReorder, DEFAULT_PIPELINE_STEPS } from "./pipeline";
import type { PipelineContext } from "./pipeline";
import type { NoteCardRecord } from "./types";
import type { CardFileKind } from "./file-kind";
import { PHASE3_MINISEARCH_CONTRACT } from "../search/types";
import * as metadataUtils from "./metadata-utils";

// ---------------------------------------------------------------------------
// Mock Helpers
// ---------------------------------------------------------------------------

function createMockContext(): PipelineContext {
  return {
    app: {} as PipelineContext["app"],
    settings: {
      sort: { field: "mtime", direction: "desc" },
      filter: { tags: [] },
      includeSubfolders: true,
      enableFileExplorerFolderClicks: false,
      defaultView: "cards",
      defaultCardOpenBehavior: "smart",
      cardCornerRadius: "compact",
      previewLines: 5,
      lastFolderPath: null,
      lastViewMode: "folder",
      pinnedPaths: [],
    },
    search: {
      query: "",
      execution: "indexed-unavailable",
      orderedPaths: undefined,
    },
    pinnedPaths: [],
  };
}

function withPinnedPaths(context: PipelineContext, pinnedPaths: string[]): PipelineContext {
  return {
    ...context,
    settings: {
      ...context.settings,
      pinnedPaths: [...pinnedPaths],
    },
    pinnedPaths: [...pinnedPaths],
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
  };
}

// ---------------------------------------------------------------------------
// runPipeline
// ---------------------------------------------------------------------------

describe("runPipeline", () => {
  it("returns input unchanged when steps array is empty", () => {
    const cards = [createMockCard("test.md")];
    const context = createMockContext();
    const result = runPipeline(cards, [], context);
    expect(result).toBe(cards);
  });

  it("returns input unchanged with identity steps (DEFAULT_PIPELINE_STEPS)", () => {
    const cards = [createMockCard("a.md"), createMockCard("b.md")];
    const context = createMockContext();
    const result = runPipeline(cards, DEFAULT_PIPELINE_STEPS, context);
    expect(result).toEqual(cards);
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
    expect(result).toHaveLength(4);
  });

  it("returns empty array when given empty cards", () => {
    const context = createMockContext();
    const result = runPipeline([], DEFAULT_PIPELINE_STEPS, context);
    expect(result).toEqual([]);
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
// applyTagFilter behavior tests (Task 2 — TDD RED phase)
// ---------------------------------------------------------------------------

describe("applyTagFilter behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns all cards when settings.filter.tags is empty", () => {
    const cards = [
      createMockCard("note-a.md"),
      createMockCard("note-b.md"),
      createMockCard("note-c.md"),
    ];
    const context = createMockContext();
    context.settings.filter.tags = [];

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
    context.settings.filter.tags = ["important", "archived"];

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
    context.settings.filter.tags = ["nonexistent-tag"];

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
    context.settings.filter.tags = ["work"];

    vi.spyOn(metadataUtils, "matchesTagFilter").mockReturnValue(false);

    const result = applyTagFilter(cards, context);

    expect(result).toEqual([]);
  });

  it("passes selected tags through to metadata matching helper", () => {
    const cards = [createMockCard("sample.md")];
    const context = createMockContext();
    context.settings.filter.tags = ["#Important", "Work"];

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
    context.settings.filter.tags = ["selected"];

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
    context.settings.filter.tags = ["tag1", "tag2", "tag3"];

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
    expect(PHASE3_MINISEARCH_CONTRACT.query).toEqual({
      prefix: true,
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
    baseContext.settings.filter.tags = ["project"];
    const context = withPinnedPaths(baseContext, ["filtered-pinned.md", "visible-pinned.md"]);

    vi.spyOn(metadataUtils, "matchesTagFilter").mockImplementation((_app, file) => {
      return file.path !== "filtered-pinned.md";
    });

    expect(runPipeline(cards, DEFAULT_PIPELINE_STEPS, context).map((card) => card.path)).toEqual([
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

    expect(runPipeline(cards, DEFAULT_PIPELINE_STEPS, context).map((card) => card.path)).toEqual([
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
    baseContext.settings.filter.tags = ["project"];
    baseContext.search.query = "query-hit";
    baseContext.search.execution = "indexed-ready";
    baseContext.search.orderedPaths = ["visible-pinned.md", "tag-filtered-pinned.md", "visible-unpinned.md"];
    const context = withPinnedPaths(baseContext, ["tag-filtered-pinned.md", "visible-pinned.md"]);

    vi.spyOn(metadataUtils, "matchesTagFilter").mockImplementation((_app, file) => {
      return file.path !== "tag-filtered-pinned.md";
    });

    expect(runPipeline(cards, DEFAULT_PIPELINE_STEPS, context).map((card) => card.path)).toEqual([
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
    baseContext.settings.filter.tags = ["project"];
    baseContext.search.query = "query-hit";
    baseContext.search.execution = "indexed-ready";
    baseContext.search.orderedPaths = ["d.md", "b.md", "a.md"];
    const context = withPinnedPaths(baseContext, ["a.md", "b.md"]);

    vi.spyOn(metadataUtils, "matchesTagFilter").mockImplementation((_app, file) => {
      return file.path !== "b.md";
    });

    expect(runPipeline(cards, DEFAULT_PIPELINE_STEPS, context).map((card) => card.path)).toEqual([
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
    baseContext.settings.filter.tags = ["active"];
    const context = withPinnedPaths(baseContext, ["c.md", "a.md", "duplicate-missing.md", "c.md"]);

    vi.spyOn(metadataUtils, "matchesTagFilter").mockImplementation((_app, file) => {
      return file.path !== "b.md";
    });

    expect(runPipeline(cards, DEFAULT_PIPELINE_STEPS, context).map((card) => card.path)).toEqual([
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
// DEFAULT_PIPELINE_STEPS
// ---------------------------------------------------------------------------

describe("DEFAULT_PIPELINE_STEPS", () => {
  it("contains exactly 3 steps in correct order", () => {
    expect(DEFAULT_PIPELINE_STEPS).toHaveLength(3);
    expect(DEFAULT_PIPELINE_STEPS[0]).toBe(applyTagFilter);
    expect(DEFAULT_PIPELINE_STEPS[1]).toBe(applySearchFilter);
    expect(DEFAULT_PIPELINE_STEPS[2]).toBe(applyPinReorder);
  });

  it("full pipeline with defaults returns input unchanged", () => {
    const cards = [createMockCard("a.md"), createMockCard("b.md"), createMockCard("c.md")];
    const context = createMockContext();
    const result = runPipeline(cards, DEFAULT_PIPELINE_STEPS, context);
    expect(result).toEqual(cards);
    expect(result).toHaveLength(3);
  });
});
