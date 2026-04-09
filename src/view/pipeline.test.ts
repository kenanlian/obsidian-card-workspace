import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPipeline, applyTagFilter, applySearchFilter, applyPinReorder, DEFAULT_PIPELINE_STEPS } from "./pipeline";
import type { PipelineContext, PipelineStep } from "./pipeline";
import type { NoteCardRecord } from "./types";
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
      defaultView: "cards",
      lastFolderPath: null,
      lastViewMode: "folder",
      pinnedPaths: [],
    },
  };
}

function createMockCard(path: string): NoteCardRecord {
  return {
    file: { path, basename: path.replace(/.*\//, "").replace(".md", "") } as NoteCardRecord["file"],
    path,
    title: path.replace(/.*\//, "").replace(".md", ""),
    ctime: Date.now(),
    mtime: Date.now(),
    excerpt: "",
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
// Stub Steps (remaining)
// ---------------------------------------------------------------------------

describe("stub steps (remaining)", () => {
  it("applySearchFilter returns cards unchanged", () => {
    const cards = [createMockCard("test.md")];
    const context = createMockContext();
    const result = applySearchFilter(cards, context);
    expect(result).toBe(cards);
  });

  it("applySearchFilter stays a pass-through even when includeSubfolders changes", () => {
    const cards = [createMockCard("nested/test.md")];
    const context = createMockContext();
    context.settings.includeSubfolders = false;

    expect(applySearchFilter(cards, context)).toBe(cards);
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
    const context = createMockContext();
    context.settings.filter.tags = ["project"];
    context.settings.pinnedPaths = ["filtered-pinned.md", "visible-pinned.md"];

    vi.spyOn(metadataUtils, "matchesTagFilter").mockImplementation((_app, file) => {
      return file.path !== "filtered-pinned.md";
    });

    expect(runPipeline(cards, DEFAULT_PIPELINE_STEPS, context).map((card) => card.path)).toEqual([
      "visible-pinned.md",
      "visible-unpinned.md",
    ]);
  });

  it("preserves relative order within pinned and unpinned segments after filtering", () => {
    const cards = [
      createMockCard("a.md"),
      createMockCard("b.md"),
      createMockCard("c.md"),
      createMockCard("d.md"),
    ];
    const context = createMockContext();
    context.settings.filter.tags = ["active"];
    context.settings.pinnedPaths = ["c.md", "a.md", "duplicate-missing.md", "c.md"];

    vi.spyOn(metadataUtils, "matchesTagFilter").mockImplementation((_app, file) => {
      return file.path !== "b.md";
    });

    expect(runPipeline(cards, DEFAULT_PIPELINE_STEPS, context).map((card) => card.path)).toEqual([
      "a.md",
      "c.md",
      "d.md",
    ]);
  });

  it("returns cards unchanged when no pinnedPaths in settings", () => {
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
    const contextWithPins = {
      ...context,
      settings: {
        ...context.settings,
        pinnedPaths: ["b.md", "d.md"],
      },
    } as unknown as PipelineContext;

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
    const contextWithPins = {
      ...context,
      settings: {
        ...context.settings,
        pinnedPaths: ["c.md", "a.md"],
      },
    } as unknown as PipelineContext;

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
    const contextWithPins = {
      ...context,
      settings: {
        ...context.settings,
        pinnedPaths: ["b.md"],
      },
    } as unknown as PipelineContext;

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
    const contextWithPins = {
      ...context,
      settings: {
        ...context.settings,
        pinnedPaths: ["b.md"],
      },
    } as unknown as PipelineContext;

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
    const contextWithPins = {
      ...context,
      settings: {
        ...context.settings,
        pinnedPaths: ["b.md", "d.md", "e.md"],
      },
    } as unknown as PipelineContext;

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
    const contextWithPins = {
      ...context,
      settings: {
        ...context.settings,
        pinnedPaths: [],
      },
    } as unknown as PipelineContext;

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
    const contextWithDuplicatePins = {
      ...context,
      settings: {
        ...context.settings,
        pinnedPaths: ["c.md", "c.md", "a.md", "a.md"],
      },
    } as unknown as PipelineContext;

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
