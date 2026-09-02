import { describe, expect, it, vi, type Mock } from "vitest";
import type { GroupDimension } from "../../card-grouping-settings";
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

function harness(
  records: NoteCardRecord[],
  getFileCache: Mock = vi.fn(() => null),
  dimension: GroupDimension = "none",
  bucketMoved = false,
  membershipDeparted = false,
  propertyImpact: "reproject" | "nav" | "none" = "none",
) {
  const store = createViewStateStore(createFolderScope("", true));
  store.replaceBaseCards(records);
  store.replaceVisibleCards(records);
  const context = {
    getApp: () => ({ metadataCache: { getFileCache } }),
    store,
    epochs: createViewEpochs(),
    publishGroups: vi.fn(),
  } as unknown as ViewContext;
  const reprojectAndPublish = vi.fn();
  const reconcileMetadataMembershipForPath = vi.fn(() => membershipDeparted);
  const refreshGroupBucketForPath = vi.fn(() => bucketMoved);
  const classifyPropertyMetadataImpact = vi.fn((): "reproject" | "nav" | "none" => propertyImpact);
  return {
    context,
    store,
    getFileCache,
    reprojectAndPublish,
    reconcileMetadataMembershipForPath,
    refreshGroupBucketForPath,
    classifyPropertyMetadataImpact,
    controller: new TaskSummaryController({
      context,
      getGroupDimension: () => dimension,
      reprojectAndPublish,
      reconcileMetadataMembershipForPath,
      refreshGroupBucketForPath,
      classifyPropertyMetadataImpact,
    }),
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

  describe("task-dimension freshness", () => {
    it("reprojects instead of patching when the bucket changes under dimension task", () => {
      const target = card("notes/target.md");
      const { context, controller, getFileCache, reprojectAndPublish } = harness(
        [target],
        vi.fn(() => null),
        "task",
      );
      getFileCache.mockReturnValue(cacheWithTasks(2, 0));

      controller.handleMetadataChange(target.path);

      expect(reprojectAndPublish).toHaveBeenCalledTimes(1);
      expect(context.publishGroups).not.toHaveBeenCalled();
    });

    it("keeps the minimal patch path when the bucket is unchanged under dimension task", () => {
      const target = card("notes/target.md");
      target.taskSummary = { total: 3, incomplete: 2 };
      const { context, store, controller, getFileCache, reprojectAndPublish } = harness(
        [target],
        vi.fn(() => null),
        "task",
      );
      getFileCache.mockReturnValue(cacheWithTasks(3, 1));

      controller.handleMetadataChange(target.path);

      expect(reprojectAndPublish).not.toHaveBeenCalled();
      expect(context.publishGroups).toHaveBeenCalledTimes(1);
      expect(context.publishGroups).toHaveBeenCalledWith("cards");
      expect(store.getBaseCard(target.path)?.taskSummary).toEqual({ total: 3, incomplete: 1 });
    });

    it("preserves the patch path for every other dimension", () => {
      const target = card("notes/target.md");
      const { context, store, controller, getFileCache, reprojectAndPublish } = harness(
        [target],
        vi.fn(() => null),
        "folder",
      );
      getFileCache.mockReturnValue(cacheWithTasks(2, 0));

      controller.handleMetadataChange(target.path);

      expect(reprojectAndPublish).not.toHaveBeenCalled();
      expect(context.publishGroups).toHaveBeenCalledTimes(1);
      expect(context.publishGroups).toHaveBeenCalledWith("cards");
      expect(store.getBaseCard(target.path)?.taskSummary).toEqual({ total: 2, incomplete: 0 });
    });

    it("still performs no patch and no publish for a value-equal summary", () => {
      const target = card("notes/target.md");
      target.taskSummary = { total: 2, incomplete: 1 };
      const { context, store, controller, getFileCache, reprojectAndPublish } = harness(
        [target],
        vi.fn(() => null),
        "task",
      );
      getFileCache.mockReturnValue(cacheWithTasks(2, 1));
      const original = store.getBaseCard(target.path);

      controller.handleMetadataChange(target.path);

      expect(reprojectAndPublish).not.toHaveBeenCalled();
      expect(context.publishGroups).not.toHaveBeenCalled();
      expect(store.getBaseCard(target.path)).toBe(original);
    });
  });

  describe("metadata-derived group buckets", () => {
    it("reprojects a departed Box member before it can fall through to a manual bucket", () => {
      const target = card("notes/target.md");
      const {
        context,
        controller,
        reprojectAndPublish,
        reconcileMetadataMembershipForPath,
        refreshGroupBucketForPath,
      } = harness([target], vi.fn(() => null), "box-rule", false, true);

      controller.handleMetadataChange(target.path);

      expect(reconcileMetadataMembershipForPath).toHaveBeenCalledWith(target.path);
      expect(refreshGroupBucketForPath).not.toHaveBeenCalled();
      expect(reprojectAndPublish).toHaveBeenCalledTimes(1);
      expect(context.publishGroups).not.toHaveBeenCalled();
    });

    it("reprojects when a tag edit moved the card's bucket", () => {
      const target = card("notes/target.md");
      target.taskSummary = null;
      const { context, controller, reprojectAndPublish, refreshGroupBucketForPath } = harness(
        [target],
        vi.fn(() => null),
        "tag",
        true,
      );

      controller.handleMetadataChange(target.path);

      // The vault-content epoch does not move on a metadata-only edit, so
      // without this the card keeps its pre-edit header.
      expect(refreshGroupBucketForPath).toHaveBeenCalledWith(target.path);
      expect(reprojectAndPublish).toHaveBeenCalledTimes(1);
      expect(context.publishGroups).not.toHaveBeenCalled();
    });

    it("does not reproject when the bucket did not move", () => {
      const target = card("notes/target.md");
      target.taskSummary = null;
      const { context, controller, reprojectAndPublish, refreshGroupBucketForPath } = harness(
        [target],
        vi.fn(() => null),
        "tag",
        false,
      );

      controller.handleMetadataChange(target.path);

      expect(refreshGroupBucketForPath).toHaveBeenCalledWith(target.path);
      expect(reprojectAndPublish).not.toHaveBeenCalled();
      expect(context.publishGroups).not.toHaveBeenCalled();
    });

    it("leaves the folder dimension on its minimal patch path", () => {
      const target = card("notes/target.md");
      target.taskSummary = { total: 2, incomplete: 1 };
      const { context, controller, getFileCache, reprojectAndPublish, refreshGroupBucketForPath } =
        harness([target], vi.fn(() => null), "folder");
      getFileCache.mockReturnValue(cacheWithTasks(2, 0));

      controller.handleMetadataChange(target.path);

      expect(refreshGroupBucketForPath).toHaveBeenCalledWith(target.path);
      expect(reprojectAndPublish).not.toHaveBeenCalled();
      expect(context.publishGroups).toHaveBeenCalledWith("cards");
    });
  });

  describe("property metadata impact (WP-05)", () => {
    it("reprojects in one coherent batch when the property lane classifies reproject", () => {
      const target = card("notes/target.md");
      const { context, controller, reprojectAndPublish, classifyPropertyMetadataImpact } = harness(
        [target],
        vi.fn(() => null),
        "none",
        false,
        false,
        "reproject",
      );

      controller.handleMetadataChange(target.path);

      expect(classifyPropertyMetadataImpact).toHaveBeenCalledWith(target.path);
      expect(reprojectAndPublish).toHaveBeenCalledTimes(1);
      // The single coherent batch owns publication; no separate cards/nav publish.
      expect(context.publishGroups).not.toHaveBeenCalled();
    });

    it("publishes nav only for a nav-classified impact without active clauses", () => {
      const target = card("notes/target.md");
      const { context, controller, reprojectAndPublish } = harness(
        [target],
        vi.fn(() => null),
        "none",
        false,
        false,
        "nav",
      );

      controller.handleMetadataChange(target.path);

      expect(reprojectAndPublish).not.toHaveBeenCalled();
      expect(context.publishGroups).toHaveBeenCalledTimes(1);
      expect(context.publishGroups).toHaveBeenCalledWith("nav");
    });

    it("publishes cards and nav once when a nav-classified impact also changes the summary", () => {
      const target = card("notes/target.md");
      const { context, controller, getFileCache, reprojectAndPublish } = harness(
        [target],
        vi.fn(() => null),
        "none",
        false,
        false,
        "nav",
      );
      getFileCache.mockReturnValue(cacheWithTasks(2, 1));

      controller.handleMetadataChange(target.path);

      expect(reprojectAndPublish).not.toHaveBeenCalled();
      expect(context.publishGroups).toHaveBeenCalledTimes(1);
      expect(context.publishGroups).toHaveBeenCalledWith("cards", "nav");
    });

    it("keeps the unused-Properties minimal cards patch for a none-classified impact", () => {
      const target = card("notes/target.md");
      const { context, controller, getFileCache, reprojectAndPublish } = harness(
        [target],
        vi.fn(() => null),
        "none",
        false,
        false,
        "none",
      );
      getFileCache.mockReturnValue(cacheWithTasks(2, 1));

      controller.handleMetadataChange(target.path);

      expect(reprojectAndPublish).not.toHaveBeenCalled();
      expect(context.publishGroups).toHaveBeenCalledTimes(1);
      expect(context.publishGroups).toHaveBeenCalledWith("cards");
    });

    it("never consults property classification for an out-of-base path", () => {
      const target = card("notes/target.md");
      const {
        context,
        controller,
        reprojectAndPublish,
        classifyPropertyMetadataImpact,
        refreshGroupBucketForPath,
      } = harness([target], vi.fn(() => null), "none", false, false, "reproject");

      controller.handleMetadataChange("notes/missing.md");

      expect(classifyPropertyMetadataImpact).not.toHaveBeenCalled();
      expect(reprojectAndPublish).not.toHaveBeenCalled();
      expect(refreshGroupBucketForPath).not.toHaveBeenCalled();
      expect(context.publishGroups).not.toHaveBeenCalled();
    });

    it("reprojects once for a membership departure without consulting classification", () => {
      const target = card("notes/target.md");
      const {
        context,
        controller,
        reprojectAndPublish,
        classifyPropertyMetadataImpact,
        refreshGroupBucketForPath,
      } = harness([target], vi.fn(() => null), "box-rule", false, true, "reproject");

      controller.handleMetadataChange(target.path);

      // Membership departure returns before the property lane is classified.
      expect(classifyPropertyMetadataImpact).not.toHaveBeenCalled();
      expect(refreshGroupBucketForPath).not.toHaveBeenCalled();
      expect(reprojectAndPublish).toHaveBeenCalledTimes(1);
      expect(context.publishGroups).not.toHaveBeenCalled();
    });
  });
});
