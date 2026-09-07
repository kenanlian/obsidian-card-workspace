import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GROUP_SPEC } from "../../card-grouping-settings";
import type { SearchIndexHealthSnapshot, SearchService, SearchServiceSnapshot } from "../../search";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../settings";
import { ProjectionController } from "./ProjectionController";
import { createFolderScope } from "../scope";
import type { NoteCardRecord } from "../types";
import type { ViewContext } from "../view-context";
import { createViewEpochs } from "../view-epochs";
import { createViewStateStore } from "../view-state-store";
import { SearchController } from "./SearchController";

function createHealth(
  patch: Partial<SearchIndexHealthSnapshot> = {},
): SearchIndexHealthSnapshot {
  return {
    outcome: "restored",
    readiness: "ready",
    healthy: true,
    rebuilding: false,
    rebuildRequired: false,
    persistence: "healthy",
    documentCount: 1,
    lastIndexedAt: 1,
    rebuildReason: null,
    lastError: null,
    lastSuccessfulRestore: null,
    lastSuccessfulBuild: null,
    detail: null,
    ...patch,
  };
}

function createSnapshot(
  patch: Partial<SearchServiceSnapshot> = {},
): SearchServiceSnapshot {
  return {
    initialized: true,
    disposed: false,
    mode: "indexed",
    status: "ready",
    lastError: null,
    contentRevision: 0,
    health: createHealth(),
    ...patch,
  };
}

function createContext(): ViewContext {
  return {
    getApp: vi.fn(() => ({ metadataCache: { getFileCache: vi.fn(() => null) } })),
    store: createViewStateStore(createFolderScope("notes", true)),
    epochs: createViewEpochs(),
    getSettings: vi.fn(() => normalizeSettings(DEFAULT_SETTINGS)),
    saveSettings: vi.fn(),
    getUiStrings: vi.fn(),
    publishGroups: vi.fn(),
    requestUpdate: vi.fn(),
    notify: vi.fn(),
    getViewWindow: () => globalThis,
  } as unknown as ViewContext;
}

function asService(query: SearchService["query"]): SearchService {
  return { query } as SearchService;
}

describe("SearchController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits exactly 120ms before querying", async () => {
    vi.useFakeTimers();
    const context = createContext();
    const query = vi.fn(async () => ({
      mode: "indexed" as const,
      status: "ready" as const,
      execution: "indexed-ready" as const,
      orderedPaths: ["notes/alpha.md"],
    }));
    const publishSearchProjection = vi.fn();
    const controller = new SearchController({
      context,
      getSearchService: () => asService(query),
      getSearchSnapshot: () => createSnapshot(),
      subscribeSearchSnapshots: () => () => undefined,
      publishSearchProjection,
    });

    controller.initializeSnapshotState();
    controller.onQueryChange({ query: "alpha" });
    vi.advanceTimersByTime(119);
    await Promise.resolve();
    expect(query).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(query).toHaveBeenCalledTimes(1);
    expect(controller.buildPipelineSearchInput()).toEqual({
      query: "alpha",
      execution: "indexed-ready",
      orderedPaths: ["notes/alpha.md"],
    });
  });

  it("projects zero cards for a non-empty query while the index is non-ready", () => {
    const context = createContext();
    context.store.replaceBaseCards([{
      path: "notes/alpha.md",
      title: "Alpha",
      file: { path: "notes/alpha.md" },
    } as NoteCardRecord]);
    let controller!: SearchController;
    const projection = new ProjectionController({
      context,
      getSearchInput: () => controller.buildPipelineSearchInput(),
      getEffectivePinnedPaths: () => [],
      getLoadKey: () => "notes",
      getGroupConfig: () => DEFAULT_GROUP_SPEC,
      getCollapsedGroupKeys: () => new Set(),
    });
    controller = new SearchController({
      context,
      getSearchService: () => null,
      getSearchSnapshot: () => createSnapshot({
        status: "building",
        health: createHealth({
          outcome: "rebuild-required",
          readiness: "rebuild-required",
          healthy: false,
          rebuilding: true,
          rebuildRequired: true,
          rebuildReason: "version-drift",
        }),
      }),
      subscribeSearchSnapshots: () => () => undefined,
      publishSearchProjection: () => projection.reprojectCards(),
    });

    controller.initializeSnapshotState();
    controller.onQueryChange({ query: "alpha" });

    expect(controller.getStatus()).toBe("rebuild-required");
    expect(controller.buildPipelineSearchInput()).toEqual({
      query: "alpha",
      execution: "indexed-rebuild-required",
    });
    expect(context.store.getVisibleCards()).toEqual([]);
    controller.dispose();
  });

  it("drops an indexed result after the search snapshot advances", async () => {
    const context = createContext();
    let resolveQuery!: (value: Awaited<ReturnType<SearchService["query"]>>) => void;
    const query = vi.fn(() => new Promise<Awaited<ReturnType<SearchService["query"]>>>((resolve) => {
      resolveQuery = resolve;
    }));
    const controller = new SearchController({
      context,
      getSearchService: () => asService(query),
      getSearchSnapshot: () => createSnapshot(),
      subscribeSearchSnapshots: () => () => undefined,
      publishSearchProjection: vi.fn(),
    });

    controller.initializeSnapshotState();
    controller.onQueryChange({ query: "alpha" });
    const pending = controller.refreshProjection();
    controller.onSearchSnapshot(createSnapshot({
      status: "building",
      health: createHealth({ readiness: "building", rebuilding: true }),
    }));
    resolveQuery({
      mode: "indexed",
      status: "ready",
      execution: "indexed-ready",
      orderedPaths: ["notes/alpha.md"],
      matchCountsByPath: { "notes/alpha.md": 3 },
    });
    await pending;

    expect(controller.getStatus()).toBe("building");
    expect(controller.getMatchCountsByPath()).toEqual({});
    expect(controller.buildPipelineSearchInput()).toEqual({
      query: "alpha",
      execution: "indexed-building",
    });
    controller.dispose();
  });

  it("disposes its timer and subscription and invalidates both owned epochs", () => {
    vi.useFakeTimers();
    const context = createContext();
    const unsubscribe = vi.fn();
    const controller = new SearchController({
      context,
      getSearchService: () => null,
      getSearchSnapshot: () => createSnapshot(),
      subscribeSearchSnapshots: () => unsubscribe,
      publishSearchProjection: vi.fn(),
    });

    controller.initializeSnapshotState();
    controller.onQueryChange({ query: "alpha" });
    const requestToken = (controller as any).requestEpoch.token();
    const snapshotToken = (controller as any).snapshotEpoch.token();

    expect(controller.dispose()).toEqual({ cancelledDebounce: true });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect((controller as any).requestEpoch.isCurrent(requestToken)).toBe(false);
    expect((controller as any).snapshotEpoch.isCurrent(snapshotToken)).toBe(false);
  });

  it("does not publish a redundant post-load projection for an empty query", async () => {
    const context = createContext();
    const publishSearchProjection = vi.fn();
    const controller = new SearchController({
      context,
      getSearchService: () => null,
      getSearchSnapshot: () => createSnapshot(),
      subscribeSearchSnapshots: () => () => undefined,
      publishSearchProjection,
    });
    controller.resetForLoad();
    await controller.refreshProjection();
    expect(publishSearchProjection).not.toHaveBeenCalled();
  });

  it("silent refresh expands candidatePaths to the full new base cards without an intermediate publish", async () => {
    const context = createContext();
    const seenRequests: Array<{ candidatePaths: string[] }> = [];
    const query = vi.fn(async (request: { candidatePaths: string[] }) => {
      seenRequests.push(request);
      return {
        mode: "indexed" as const,
        status: "ready" as const,
        execution: "indexed-ready" as const,
        orderedPaths: request.candidatePaths,
        matchCountsByPath: { "notes/entered.md": 2 },
      };
    });
    const publishSearchProjection = vi.fn();
    const controller = new SearchController({
      context,
      getSearchService: () => asService(query),
      getSearchSnapshot: () => createSnapshot(),
      subscribeSearchSnapshots: () => () => undefined,
      publishSearchProjection,
    });
    controller.initializeSnapshotState();
    context.store.replaceBaseCards([
      { path: "notes/alpha.md" } as NoteCardRecord,
      { path: "notes/entered.md" } as NoteCardRecord,
    ]);
    controller.onQueryChange({ query: "needle" });
    publishSearchProjection.mockClear();

    // A Box membership change installed a new base set; the silent refresh must
    // send the full new candidate paths and update state without publishing.
    await controller.refreshProjection({ publish: false });

    expect(seenRequests.at(-1)?.candidatePaths).toEqual([
      "notes/alpha.md",
      "notes/entered.md",
    ]);
    expect(publishSearchProjection).not.toHaveBeenCalled();
    expect(controller.buildPipelineSearchInput().orderedPaths).toEqual([
      "notes/alpha.md",
      "notes/entered.md",
    ]);
    expect(controller.getMatchCountsByPath()).toEqual({ "notes/entered.md": 2 });
    controller.dispose();
  });

  it("sends the exact candidate-only query payload after C7 scope removal", async () => {
    const context = createContext();
    const query = vi.fn(async () => ({
      mode: "indexed" as const,
      status: "ready" as const,
      execution: "indexed-ready" as const,
      orderedPaths: [],
    }));
    const controller = new SearchController({
      context,
      getSearchService: () => asService(query),
      getSearchSnapshot: () => createSnapshot(),
      subscribeSearchSnapshots: () => () => undefined,
      publishSearchProjection: () => undefined,
    });
    controller.initializeSnapshotState();
    context.store.replaceBaseCards([
      { path: "notes/a.md" } as NoteCardRecord,
      { path: "notes/b.md" } as NoteCardRecord,
    ]);
    controller.onQueryChange({ query: "needle" });

    await controller.refreshProjection();

    // `candidatePaths` is the only scope boundary; the request carries no
    // derived folder/box scope data (C7).
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith({
      query: "needle",
      candidatePaths: ["notes/a.md", "notes/b.md"],
    });
    controller.dispose();
  });

  it("silent refresh returns immediately for an empty query", async () => {
    const context = createContext();
    const query = vi.fn();
    const publishSearchProjection = vi.fn();
    const controller = new SearchController({
      context,
      getSearchService: () => asService(query),
      getSearchSnapshot: () => createSnapshot(),
      subscribeSearchSnapshots: () => () => undefined,
      publishSearchProjection,
    });
    controller.initializeSnapshotState();

    await controller.refreshProjection({ publish: false });

    expect(query).not.toHaveBeenCalled();
    expect(publishSearchProjection).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("a stale silent request cannot overwrite the winning request's state", async () => {
    const context = createContext();
    let resolveSilent!: (value: { execution: "indexed-ready"; orderedPaths: string[] }) => void;
    let firstCall = true;
    const query = vi.fn((request: { query: string }) => {
      if (request.query === "old" && firstCall) {
        firstCall = false;
        return new Promise<{ execution: "indexed-ready"; orderedPaths: string[] }>((resolve) => {
          resolveSilent = resolve;
        });
      }
      return Promise.resolve({
        mode: "indexed" as const,
        status: "ready" as const,
        execution: "indexed-ready" as const,
        orderedPaths: ["notes/winner.md"],
      });
    });
    const staleWinnerService = {
      query: (request: { query: string }) => query(request),
    } as unknown as SearchService;
    const publishSearchProjection = vi.fn();
    const controller = new SearchController({
      context,
      getSearchService: () => staleWinnerService,
      getSearchSnapshot: () => createSnapshot(),
      subscribeSearchSnapshots: () => () => undefined,
      publishSearchProjection,
    });
    controller.initializeSnapshotState();
    context.store.replaceBaseCards([{ path: "notes/winner.md" } as NoteCardRecord]);
    controller.onQueryChange({ query: "old" });
    const silent = controller.refreshProjection({ publish: false });

    // The winning request arrives while the silent one is still pending: a
    // contentRevision snapshot (or a new query) invalidates the silent request.
    controller.onSearchSnapshot(createSnapshot({ contentRevision: 1 }));
    await Promise.resolve();
    await Promise.resolve();
    resolveSilent({
      execution: "indexed-ready",
      orderedPaths: ["notes/stale.md"],
    });
    await silent;

    // The snapshot-driven winner owns the publication and the final state.
    expect(publishSearchProjection).toHaveBeenCalled();
    expect(controller.buildPipelineSearchInput().orderedPaths).toEqual(["notes/winner.md"]);
    controller.dispose();
  });

  it("silent fallback to a blocked state updates execution without publishing", async () => {
    const context = createContext();
    const publishSearchProjection = vi.fn();
    const controller = new SearchController({
      context,
      getSearchService: () => null,
      getSearchSnapshot: () => createSnapshot(),
      subscribeSearchSnapshots: () => () => undefined,
      publishSearchProjection,
    });
    controller.initializeSnapshotState();
    context.store.replaceBaseCards([{ path: "notes/a.md" } as NoteCardRecord]);
    controller.onQueryChange({ query: "needle" });
    publishSearchProjection.mockClear();

    await controller.refreshProjection({ publish: false });

    expect(publishSearchProjection).not.toHaveBeenCalled();
    expect(controller.buildPipelineSearchInput()).toMatchObject({
      query: "needle",
      execution: "indexed-unavailable",
    });
    controller.dispose();
  });
});
