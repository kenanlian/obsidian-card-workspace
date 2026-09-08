import { describe, expect, it, vi } from "vitest";
import type { GroupDimension } from "../../card-grouping-settings";
import { DEFAULT_GROUP_SPEC } from "../../card-grouping-settings";
import type { PipelineSearchInput } from "../types";
import { createBoxScope, createFolderScope, createLinksScope } from "../scope";
import type { NoteCardRecord } from "../types";
import type { ViewContext } from "../view-context";
import { createViewEpochs } from "../view-epochs";
import { createViewStateStore } from "../view-state-store";
import { ProjectionController } from "./ProjectionController";
import {
  MetadataImpactController,
  type MetadataImpactControllerDeps,
} from "./MetadataImpactController";
import type { MetadataMembershipOutcome } from "./ScopeController";

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

type HarnessOverrides = Partial<Omit<MetadataImpactControllerDeps, "context">>;

function harness(
  records: NoteCardRecord[],
  options: {
    getFileCache?: ReturnType<typeof vi.fn>;
    dimension?: GroupDimension;
    scope?: ReturnType<typeof createFolderScope> | ReturnType<typeof createBoxScope> | ReturnType<typeof createLinksScope>;
    membership?: MetadataMembershipOutcome;
    bucketsMoved?: boolean;
    tagsChanged?: boolean;
    propertyImpact?: "reproject" | "nav" | "none";
    browseTagFilterActive?: boolean;
    searchActive?: boolean;
    silentRefresh?: () => Promise<void>;
    overrides?: HarnessOverrides;
  } = {},
) {
  const store = createViewStateStore(options.scope ?? createFolderScope("", true));
  store.replaceBaseCards(records);
  store.replaceVisibleCards(records);
  const getFileCache = options.getFileCache ?? vi.fn(() => null);
  const context = {
    getApp: () => ({ metadataCache: { getFileCache } }),
    store,
    epochs: createViewEpochs(),
    publishGroups: vi.fn(),
  } as unknown as ViewContext;

  const deps: MetadataImpactControllerDeps = {
    context,
    getGroupDimension: () => options.dimension ?? "none",
    isBrowseTagFilterActive: () => options.browseTagFilterActive ?? false,
    isSearchActive: () => options.searchActive ?? false,
    reconcileMetadataMembershipForPath: vi.fn(
      (): MetadataMembershipOutcome => options.membership ?? "unchanged",
    ),
    refreshMetadataGroupBuckets: vi.fn(() => options.bucketsMoved ?? false),
    refreshScopeTagData: vi.fn(() => options.tagsChanged ?? false),
    classifyPropertyMetadataImpact: vi.fn(
      (): "reproject" | "nav" | "none" => options.propertyImpact ?? "none",
    ),
    invalidateMetadataDerivedCaches: vi.fn(),
    refreshSearchCandidatesSilently:
      options.silentRefresh ?? vi.fn(async () => undefined),
    reprojectCardsForMetadata: vi.fn(),
    publishImpactBatch: vi.fn(),
    scheduleVisibleHydrationCandidates: vi.fn(),
    ...options.overrides,
  };
  return {
    context,
    store,
    getFileCache,
    deps,
    controller: new MetadataImpactController(deps),
  };
}

describe("MetadataImpactController membership coordination", () => {
  it("awaits the silent candidate refresh before reprojecting and publishing one coherent batch", async () => {
    const order: string[] = [];
    const target = card("notes/target.md");
    const { context, deps, controller } = harness([target], {
      scope: createBoxScope("box-1"),
      membership: "entered",
      searchActive: true,
      silentRefresh: vi.fn(async () => {
        order.push("silent-refresh");
      }),
      overrides: {
        reprojectCardsForMetadata: vi.fn(() => {
          order.push("reproject");
        }),
        publishImpactBatch: vi.fn((batch) => {
          order.push(`publish:${batch.kind}`);
        }),
        scheduleVisibleHydrationCandidates: vi.fn(() => {
          order.push("hydrate-candidates");
        }),
      },
    });

    await controller.handleMetadataChange(target.path);

    expect(deps.invalidateMetadataDerivedCaches).toHaveBeenCalledTimes(1);
    expect(deps.refreshSearchCandidatesSilently).toHaveBeenCalledTimes(1);
    // The candidate refresh must land before reprojection so the projection
    // reads refreshed search state, and hydration candidates resolve only
    // against the refreshed projection.
    expect(order).toEqual(["silent-refresh", "reproject", "publish:reprojected", "hydrate-candidates"]);
    expect(deps.publishImpactBatch).toHaveBeenCalledWith({
      kind: "reprojected",
      includeSearch: true,
    });
    expect(context.publishGroups).not.toHaveBeenCalled();
    expect(deps.scheduleVisibleHydrationCandidates).toHaveBeenCalledWith([target.path]);
  });

  it("search-hidden entries still delegate to the projection-first visibility filter", async () => {
    const target = card("notes/hidden-by-search.md");
    const { deps, controller } = harness([target], {
      scope: createBoxScope("box-1"),
      membership: "entered",
      searchActive: true,
    });

    await controller.handleMetadataChange(target.path);

    // The controller cannot know visibility before reprojection; the delegate
    // (ScopeController.scheduleVisibleHydrationCandidates) drops hidden cards,
    // so no read happens until ordinary viewport demand.
    expect(deps.scheduleVisibleHydrationCandidates).toHaveBeenCalledTimes(1);
    expect(deps.scheduleVisibleHydrationCandidates).toHaveBeenCalledWith([target.path]);
  });

  it("a member that left the box skips hydration scheduling and still refreshes search candidates", async () => {
    const target = card("notes/leaving.md");
    const { deps, controller } = harness([target], {
      scope: createBoxScope("box-1"),
      membership: "left",
      searchActive: true,
    });

    await controller.handleMetadataChange(target.path);

    expect(deps.refreshSearchCandidatesSilently).toHaveBeenCalledTimes(1);
    expect(deps.reprojectCardsForMetadata).toHaveBeenCalledTimes(1);
    expect(deps.publishImpactBatch).toHaveBeenCalledWith({
      kind: "reprojected",
      includeSearch: true,
    });
    expect(deps.scheduleVisibleHydrationCandidates).not.toHaveBeenCalled();
  });

  it("empty queries skip the search group in the batch but keep the coherent publication", async () => {
    const target = card("notes/entering.md");
    const { deps, controller } = harness([target], {
      scope: createBoxScope("box-1"),
      membership: "entered",
      searchActive: false,
    });

    await controller.handleMetadataChange(target.path);

    expect(deps.publishImpactBatch).toHaveBeenCalledWith({
      kind: "reprojected",
      includeSearch: false,
    });
  });

  it("publishes nothing when a scope load wins the race during the silent refresh", async () => {
    const target = card("notes/target.md");
    const { context, deps, controller } = harness([target], {
      scope: createBoxScope("box-1"),
      membership: "entered",
      silentRefresh: vi.fn(async () => {
        // A scope load started while the metadata coordinator awaited.
        context.epochs.load.bump();
      }),
    });

    await controller.handleMetadataChange(target.path);

    expect(deps.reprojectCardsForMetadata).not.toHaveBeenCalled();
    expect(deps.publishImpactBatch).not.toHaveBeenCalled();
    expect(deps.scheduleVisibleHydrationCandidates).not.toHaveBeenCalled();
  });
});

describe("MetadataImpactController folder-scope impacts", () => {
  it("re-runs the projection when browse tag filters are active (match exit/entry)", async () => {
    const target = card("notes/target.md");
    const { deps, controller } = harness([target], {
      browseTagFilterActive: true,
    });

    await controller.handleMetadataChange(target.path);

    // Folder scope + active tag filter re-runs the sole pipeline so
    // matching-to-nonmatching and back are visible immediately.
    expect(deps.reprojectCardsForMetadata).toHaveBeenCalledTimes(1);
    expect(deps.publishImpactBatch).toHaveBeenCalledWith({
      kind: "reprojected",
      includeSearch: false,
    });
    expect(deps.refreshSearchCandidatesSilently).not.toHaveBeenCalled();
  });

  it("publishes the facets batch when scope tag data moved without active filters", async () => {
    const target = card("notes/tagged.md");
    const { context, deps, controller } = harness([target], {
      tagsChanged: true,
    });

    await controller.handleMetadataChange(target.path);

    expect(deps.reprojectCardsForMetadata).not.toHaveBeenCalled();
    expect(deps.publishImpactBatch).toHaveBeenCalledTimes(1);
    expect(deps.publishImpactBatch).toHaveBeenCalledWith({
      kind: "facets",
      includeCards: false,
    });
    expect(context.publishGroups).not.toHaveBeenCalled();
    // Cache invalidation (box counts + scope/vault tags + debounced count
    // refresh) happens for every in-base Markdown metadata event.
    expect(deps.invalidateMetadataDerivedCaches).toHaveBeenCalledTimes(1);
  });

  it("detects tag-data changes through the real ProjectionController wiring", async () => {
    // Regression: production wires invalidateMetadataDerivedCaches before
    // refreshScopeTagData, so the change signal must survive the invalidation
    // that clears the live tag cache (a mocked dep hid this seam before).
    const target = card("notes/tagged.md");
    const { context, deps, getFileCache } = harness([target]);
    const projection = new ProjectionController({
      context,
      getSearchInput: () => ({ query: "" }) as PipelineSearchInput,
      getEffectivePinnedPaths: () => [],
      getLoadKey: () => "load-key",
      getGroupConfig: () => DEFAULT_GROUP_SPEC,
      getCollapsedGroupKeys: () => new Set<string>(),
    });
    const wired: HarnessOverrides = {
      invalidateMetadataDerivedCaches: () => projection.invalidateMetadataDerivedCaches(),
      refreshScopeTagData: () => projection.refreshScopeTagData(),
    };
    const wiredController = new MetadataImpactController({
      ...deps,
      ...wired,
    });

    // Warm the live cache, then change only tag data.
    getFileCache.mockReturnValue({ tags: [{ tag: "#work" }] });
    projection.deriveScopeTags();
    getFileCache.mockReturnValue({ tags: [{ tag: "#work" }, { tag: "#urgent" }] });

    await wiredController.handleMetadataChange(target.path);

    expect(deps.reprojectCardsForMetadata).not.toHaveBeenCalled();
    expect(deps.publishImpactBatch).toHaveBeenCalledTimes(1);
    expect(deps.publishImpactBatch).toHaveBeenCalledWith({
      kind: "facets",
      includeCards: false,
    });
    // The refreshed cache serves the new tag data to the next derivation.
    expect(projection.deriveScopeTags().availableTags).toEqual(["urgent", "work"]);
  });

  it("stays silent through the real wiring when tag data is unchanged", async () => {
    const target = card("notes/stable.md");
    const { context, deps, getFileCache } = harness([target]);
    const projection = new ProjectionController({
      context,
      getSearchInput: () => ({ query: "" }) as PipelineSearchInput,
      getEffectivePinnedPaths: () => [],
      getLoadKey: () => "load-key",
      getGroupConfig: () => DEFAULT_GROUP_SPEC,
      getCollapsedGroupKeys: () => new Set<string>(),
    });
    const wiredController = new MetadataImpactController({
      ...deps,
      invalidateMetadataDerivedCaches: () => projection.invalidateMetadataDerivedCaches(),
      refreshScopeTagData: () => projection.refreshScopeTagData(),
    });

    getFileCache.mockReturnValue({ tags: [{ tag: "#work" }] });
    projection.deriveScopeTags();

    await wiredController.handleMetadataChange(target.path);

    expect(deps.publishImpactBatch).not.toHaveBeenCalled();
  });

  it("an in-base event with no moved impact publishes nothing at all", async () => {
    const target = card("notes/alias-only.md");
    const { context, deps, controller, getFileCache } = harness([target]);
    getFileCache.mockReturnValue(null);

    await controller.handleMetadataChange(target.path);

    // No tag/facet/property/bucket/task movement: caches are invalidated (the
    // debounced count refresh still lands later), but no panel notification.
    expect(deps.invalidateMetadataDerivedCaches).toHaveBeenCalledTimes(1);
    expect(deps.refreshMetadataGroupBuckets).toHaveBeenCalledTimes(1);
    expect(deps.refreshScopeTagData).toHaveBeenCalledTimes(1);
    expect(deps.reprojectCardsForMetadata).not.toHaveBeenCalled();
    expect(deps.publishImpactBatch).not.toHaveBeenCalled();
    expect(context.publishGroups).not.toHaveBeenCalled();
  });
});

describe("MetadataImpactController property lane", () => {
  it("reprojects in one coherent batch when the lane classifies reproject", async () => {
    const target = card("notes/target.md");
    const { context, deps, controller } = harness([target], {
      propertyImpact: "reproject",
    });

    await controller.handleMetadataChange(target.path);

    expect(deps.classifyPropertyMetadataImpact).toHaveBeenCalledWith(target.path);
    expect(deps.reprojectCardsForMetadata).toHaveBeenCalledTimes(1);
    expect(deps.publishImpactBatch).toHaveBeenCalledWith({
      kind: "reprojected",
      includeSearch: false,
    });
    expect(context.publishGroups).not.toHaveBeenCalled();
  });

  it("publishes the facets batch for a nav-classified impact", async () => {
    const target = card("notes/target.md");
    const { deps, controller } = harness([target], {
      propertyImpact: "nav",
    });

    await controller.handleMetadataChange(target.path);

    expect(deps.reprojectCardsForMetadata).not.toHaveBeenCalled();
    expect(deps.publishImpactBatch).toHaveBeenCalledWith({
      kind: "facets",
      includeCards: false,
    });
  });

  it("includes cards in the facets batch when the summary also changed", async () => {
    const target = card("notes/target.md");
    const { deps, controller, getFileCache } = harness([target], {
      propertyImpact: "nav",
    });
    getFileCache.mockReturnValue(cacheWithTasks(2, 1));

    await controller.handleMetadataChange(target.path);

    expect(deps.publishImpactBatch).toHaveBeenCalledWith({
      kind: "facets",
      includeCards: true,
    });
  });

  it("never classifies property impact for an out-of-base path", async () => {
    const target = card("notes/target.md");
    const { context, deps, controller } = harness([target], {
      propertyImpact: "reproject",
    });

    await controller.handleMetadataChange("notes/missing.md");

    expect(deps.classifyPropertyMetadataImpact).not.toHaveBeenCalled();
    expect(deps.reprojectCardsForMetadata).not.toHaveBeenCalled();
    expect(deps.publishImpactBatch).not.toHaveBeenCalled();
    expect(context.publishGroups).not.toHaveBeenCalled();
  });

  it("evaluates membership for an out-of-base path before the in-base guard (C7)", async () => {
    const target = card("notes/in-base.md");
    const { deps, controller } = harness([target], {
      scope: createLinksScope("notes/A.md", "backlinks"),
      membership: "entered",
    });

    await controller.handleMetadataChange("notes/out-of-base.md");

    expect(deps.reconcileMetadataMembershipForPath).toHaveBeenCalledWith("notes/out-of-base.md");
    expect(deps.reprojectCardsForMetadata).toHaveBeenCalledTimes(1);
    expect(deps.classifyPropertyMetadataImpact).not.toHaveBeenCalled();
  });
});

describe("MetadataImpactController task summaries", () => {
  it("publishes cards only when just the summary changed", async () => {
    const target = card("notes/target.md");
    const sibling = card("notes/sibling.md");
    const { context, store, controller, getFileCache } = harness([target, sibling]);
    getFileCache.mockImplementation((file: { path: string }) =>
      file.path === target.path ? cacheWithTasks(2, 1) : null,
    );

    await controller.handleMetadataChange(target.path);

    expect(context.publishGroups).toHaveBeenCalledTimes(1);
    expect(context.publishGroups).toHaveBeenCalledWith("cards");
    expect(store.getBaseCard(target.path)?.taskSummary).toEqual({ total: 2, incomplete: 1 });
    expect(store.getBaseCard(sibling.path)).toBe(sibling);
  });

  it("keeps a value-equal summary a complete no-op", async () => {
    const target = card("notes/same.md");
    target.taskSummary = { total: 2, incomplete: 1 };
    const { context, store, controller, getFileCache } = harness([target]);
    getFileCache.mockReturnValue(cacheWithTasks(2, 1));
    const original = store.getBaseCard(target.path);

    await controller.handleMetadataChange(target.path);

    expect(context.publishGroups).not.toHaveBeenCalled();
    expect(store.getBaseCard(target.path)).toBe(original);
  });

  it("unknown paths and non-markdown cards are safe no-ops", async () => {
    const markdown = card("notes/note.md");
    const canvas = card("notes/board.canvas", "canvas");
    const { context, store, controller, getFileCache } = harness([markdown, canvas]);
    getFileCache.mockReturnValue(cacheWithTasks(3, 2));
    const originalMarkdown = store.getBaseCard(markdown.path);
    const originalCanvas = store.getBaseCard(canvas.path);

    await controller.handleMetadataChange("notes/missing.md");
    await controller.handleMetadataChange(canvas.path);

    expect(context.publishGroups).not.toHaveBeenCalled();
    expect(store.getBaseCard(markdown.path)).toBe(originalMarkdown);
    expect(store.getBaseCard(canvas.path)).toBe(originalCanvas);
  });

  it("reprojects when the task bucket moves under the task dimension", async () => {
    const target = card("notes/target.md");
    const { context, deps, controller, getFileCache } = harness([target], {
      dimension: "task",
    });
    getFileCache.mockReturnValue(cacheWithTasks(2, 0));

    await controller.handleMetadataChange(target.path);

    expect(deps.reprojectCardsForMetadata).toHaveBeenCalledTimes(1);
    expect(deps.publishImpactBatch).toHaveBeenCalledWith({
      kind: "reprojected",
      includeSearch: false,
    });
    expect(context.publishGroups).not.toHaveBeenCalled();
  });

  it("keeps the minimal cards patch when the bucket is unchanged under task grouping", async () => {
    const target = card("notes/target.md");
    target.taskSummary = { total: 3, incomplete: 2 };
    const { context, deps, controller, getFileCache } = harness([target], {
      dimension: "task",
    });
    getFileCache.mockReturnValue(cacheWithTasks(3, 1));

    await controller.handleMetadataChange(target.path);

    expect(deps.reprojectCardsForMetadata).not.toHaveBeenCalled();
    expect(context.publishGroups).toHaveBeenCalledTimes(1);
    expect(context.publishGroups).toHaveBeenCalledWith("cards");
  });

  it("preserves the cards-only patch path for every other dimension", async () => {
    const target = card("notes/target.md");
    const { context, deps, controller, getFileCache } = harness([target], {
      dimension: "folder",
    });
    getFileCache.mockReturnValue(cacheWithTasks(2, 0));

    await controller.handleMetadataChange(target.path);

    expect(deps.reprojectCardsForMetadata).not.toHaveBeenCalled();
    expect(context.publishGroups).toHaveBeenCalledWith("cards");
  });
});

describe("MetadataImpactController group buckets", () => {
  it("reprojects when the full-set bucket signature moved (including label-only casing)", async () => {
    const target = card("notes/target.md");
    const { deps, controller, getFileCache } = harness([target], {
      dimension: "tag",
      bucketsMoved: true,
    });
    getFileCache.mockReturnValue(null);

    await controller.handleMetadataChange(target.path);

    expect(deps.refreshMetadataGroupBuckets).toHaveBeenCalledTimes(1);
    expect(deps.reprojectCardsForMetadata).toHaveBeenCalledTimes(1);
    expect(deps.publishImpactBatch).toHaveBeenCalledWith({
      kind: "reprojected",
      includeSearch: false,
    });
  });

  it("keeps the summary-only path when the bucket signature is unchanged", async () => {
    const target = card("notes/target.md");
    const { context, deps, controller, getFileCache } = harness([target], {
      dimension: "tag",
      bucketsMoved: false,
    });
    getFileCache.mockReturnValue(cacheWithTasks(2, 1));

    await controller.handleMetadataChange(target.path);

    expect(deps.reprojectCardsForMetadata).not.toHaveBeenCalled();
    expect(context.publishGroups).toHaveBeenCalledTimes(1);
    expect(context.publishGroups).toHaveBeenCalledWith("cards");
  });
});

describe("MetadataImpactController repeat-safety and disposal", () => {
  it("repeated identical events converge without duplicated publications", async () => {
    const target = card("notes/stable.md");
    const { context, deps, controller, getFileCache } = harness([target]);
    getFileCache.mockReturnValue(null);

    await controller.handleMetadataChange(target.path);
    await controller.handleMetadataChange(target.path);

    expect(context.publishGroups).not.toHaveBeenCalled();
    expect(deps.publishImpactBatch).not.toHaveBeenCalled();
    expect(deps.invalidateMetadataDerivedCaches).toHaveBeenCalledTimes(2);
  });

  it("a repeated membership entry is a no-op beyond one unchanged reconcile", async () => {
    const target = card("notes/once.md");
    const { deps, controller } = harness([target], {
      scope: createBoxScope("box-1"),
      membership: "entered",
    });

    await controller.handleMetadataChange(target.path);
    // The Vault bus may deliver its own counterpart; reconcile reads live
    // state and reports unchanged on the second delivery.
    (deps.reconcileMetadataMembershipForPath as ReturnType<typeof vi.fn>).mockReturnValue(
      "unchanged",
    );
    await controller.handleMetadataChange(target.path);

    expect(deps.reprojectCardsForMetadata).toHaveBeenCalledTimes(1);
    expect(deps.scheduleVisibleHydrationCandidates).toHaveBeenCalledTimes(1);
  });

  it("events after dispose are no-ops and do not throw", async () => {
    const target = card("notes/closed.md");
    const { context, deps, controller, getFileCache } = harness([target], {
      membership: "entered",
      scope: createBoxScope("box-1"),
    });
    getFileCache.mockReturnValue(cacheWithTasks(2, 1));

    expect(controller.dispose()).toEqual({});
    await expect(controller.handleMetadataChange(target.path)).resolves.toBeUndefined();

    expect(deps.reconcileMetadataMembershipForPath).not.toHaveBeenCalled();
    expect(deps.refreshSearchCandidatesSilently).not.toHaveBeenCalled();
    expect(deps.publishImpactBatch).not.toHaveBeenCalled();
    expect(context.publishGroups).not.toHaveBeenCalled();
  });
});
