import { describe, expect, it, vi, type Mock } from "vitest";
import { createFolderScope } from "../scope";
import type { NoteCardRecord } from "../types";
import type { ViewContext } from "../view-context";
import { createViewEpochs } from "../view-epochs";
import { createViewStateStore } from "../view-state-store";
import * as pipeline from "../pipeline";
import { TaskSummaryController } from "./TaskSummaryController";

function card(path: string, fileKind: NoteCardRecord["fileKind"] = "markdown"): NoteCardRecord {
  return {
    file: { path, stat: { mtime: 2 } },
    fileKind,
    path,
    title: path,
    ctime: 1,
    mtime: 2,
    excerpt: "",
    previewHtml: "",
    previewMode: "empty",
    hydrated: false,
    taskSummary: null,
  } as NoteCardRecord;
}

function cacheWithTasks(total = 2, incomplete = 1) {
  const listItems = Array.from({ length: total }, (_, index) => ({
    task: index < incomplete ? " " : "x",
  }));
  return { listItems };
}

function harness(records: NoteCardRecord[], getFileCache: Mock = vi.fn(() => null)) {
  const store = createViewStateStore(createFolderScope("", true));
  store.replaceBaseCards(records);
  store.replaceVisibleCards(records);
  const context = {
    getApp: () => ({ metadataCache: { getFileCache } }),
    store,
    epochs: createViewEpochs(),
    publishGroups: vi.fn(),
  } as unknown as ViewContext;
  return {
    context,
    store,
    getFileCache,
    controller: new TaskSummaryController({ context }),
  };
}

describe("TaskSummaryController", () => {
  it("V7: patches only the changed markdown card and publishes cards once", () => {
    const target = card("notes/target.md");
    const sibling = card("notes/sibling.md");
    const { context, store, controller, getFileCache } = harness([target, sibling]);
    getFileCache.mockImplementation((file: { path: string }) =>
      file.path === target.path ? cacheWithTasks(2, 1) : null,
    );

    const visibleRevisionBefore = store.getVisibleSequenceRevision();
    const hydrationRevisionBefore = store.getHydrationRevision();

    controller.handleMetadataChange(target.path);

    expect(context.publishGroups).toHaveBeenCalledTimes(1);
    expect(context.publishGroups).toHaveBeenCalledWith("cards");
    expect(store.getBaseCard(target.path)?.taskSummary).toEqual({ total: 2, incomplete: 1 });
    expect(store.getBaseCard(sibling.path)).toBe(sibling);
    expect(store.getBaseCard(sibling.path)?.taskSummary).toBeNull();
    expect(store.getVisibleSequenceRevision()).toBe(visibleRevisionBefore);
    expect(store.getHydrationRevision()).toBe(hydrationRevisionBefore);
  });

  describe("V8: value-equal summaries skip patch and publish", () => {
    it("skips when both the stored and recomputed summaries are null", () => {
      const target = card("notes/empty.md");
      const { context, store, controller } = harness([target], vi.fn(() => null));
      const original = store.getBaseCard(target.path);

      controller.handleMetadataChange(target.path);

      expect(context.publishGroups).not.toHaveBeenCalled();
      expect(store.getBaseCard(target.path)).toBe(original);
      expect(store.getBaseCard(target.path)?.taskSummary).toBeNull();
    });

    it("skips when total and incomplete match on distinct objects", () => {
      const target = card("notes/same.md");
      target.taskSummary = { total: 2, incomplete: 1 };
      const { context, store, controller, getFileCache } = harness([target]);
      getFileCache.mockReturnValue(cacheWithTasks(2, 1));
      const original = store.getBaseCard(target.path);
      const storedSummary = original?.taskSummary;

      controller.handleMetadataChange(target.path);

      expect(context.publishGroups).not.toHaveBeenCalled();
      expect(store.getBaseCard(target.path)).toBe(original);
      expect(store.getBaseCard(target.path)?.taskSummary).toBe(storedSummary);
    });
  });

  it("V9: unknown paths and non-markdown cards are no-ops", () => {
    const markdown = card("notes/note.md");
    const canvas = card("notes/board.canvas", "canvas");
    const { context, store, controller, getFileCache } = harness([markdown, canvas]);
    getFileCache.mockReturnValue(cacheWithTasks(3, 2));
    const originalMarkdown = store.getBaseCard(markdown.path);
    const originalCanvas = store.getBaseCard(canvas.path);

    controller.handleMetadataChange("notes/missing.md");
    controller.handleMetadataChange(canvas.path);

    expect(context.publishGroups).not.toHaveBeenCalled();
    expect(store.getBaseCard(markdown.path)).toBe(originalMarkdown);
    expect(store.getBaseCard(canvas.path)).toBe(originalCanvas);
    expect(store.getBaseCard(canvas.path)?.taskSummary).toBeNull();
  });

  it("V10: events after dispose are no-ops and do not throw", () => {
    const target = card("notes/closed.md");
    const { context, store, controller, getFileCache } = harness([target]);
    getFileCache.mockReturnValue(cacheWithTasks(2, 1));
    const original = store.getBaseCard(target.path);

    expect(controller.dispose()).toEqual({});
    expect(() => controller.handleMetadataChange(target.path)).not.toThrow();
    expect(context.publishGroups).not.toHaveBeenCalled();
    expect(store.getBaseCard(target.path)).toBe(original);
  });

  it("V11: never reprojects, advances hydration, or enters the pipeline", () => {
    const target = card("notes/keep-order.md");
    const { context, store, controller, getFileCache } = harness([target]);
    getFileCache.mockReturnValue(cacheWithTasks(2, 1));
    const replaceVisibleCards = vi.spyOn(store, "replaceVisibleCards");
    const replaceBaseCards = vi.spyOn(store, "replaceBaseCards");
    const advanceHydrationRevision = vi.spyOn(store, "advanceHydrationRevision");
    const runPipeline = vi.spyOn(pipeline, "runPipeline");
    const stepsForScope = vi.spyOn(pipeline, "stepsForScope");
    const applyTagFilter = vi.spyOn(pipeline, "applyTagFilter");
    const applySearchFilter = vi.spyOn(pipeline, "applySearchFilter");
    const applyPinReorder = vi.spyOn(pipeline, "applyPinReorder");

    controller.handleMetadataChange(target.path);

    expect(context.publishGroups).toHaveBeenCalledTimes(1);
    expect(store.getBaseCard(target.path)?.taskSummary).toEqual({ total: 2, incomplete: 1 });
    expect(replaceVisibleCards).not.toHaveBeenCalled();
    expect(replaceBaseCards).not.toHaveBeenCalled();
    expect(advanceHydrationRevision).not.toHaveBeenCalled();
    expect(runPipeline).not.toHaveBeenCalled();
    expect(stepsForScope).not.toHaveBeenCalled();
    expect(applyTagFilter).not.toHaveBeenCalled();
    expect(applySearchFilter).not.toHaveBeenCalled();
    expect(applyPinReorder).not.toHaveBeenCalled();
  });
});
