import { describe, it, expect, vi } from "vitest";
import { runPipeline, applyTagFilter, applySearchFilter, applyPinReorder, DEFAULT_PIPELINE_STEPS } from "./pipeline";
import type { PipelineContext, PipelineStep } from "./pipeline";
import type { NoteCardRecord } from "./types";

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
// Stub Steps
// ---------------------------------------------------------------------------

describe("stub steps", () => {
  it("applyTagFilter returns cards unchanged", () => {
    const cards = [createMockCard("test.md")];
    const context = createMockContext();
    const result = applyTagFilter(cards, context);
    expect(result).toBe(cards);
  });

  it("applySearchFilter returns cards unchanged", () => {
    const cards = [createMockCard("test.md")];
    const context = createMockContext();
    const result = applySearchFilter(cards, context);
    expect(result).toBe(cards);
  });

  it("applyPinReorder returns cards unchanged", () => {
    const cards = [createMockCard("test.md")];
    const context = createMockContext();
    const result = applyPinReorder(cards, context);
    expect(result).toBe(cards);
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
