import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GROUP_SPEC } from "../../card-grouping-settings";
import type { SearchIndexHealthSnapshot, SearchService, SearchServiceSnapshot } from "../../search";
import { DEFAULT_SETTINGS, normalizeSettings, mergeSettings } from "../../settings";
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
    saveSettings: vi.fn(async () => undefined),
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
    expect(publishSearchProjection).not.toHaveBeenCalled();
    expect(context.publishGroups).toHaveBeenCalledWith("cards", "search");
    expect(controller.getCommittedQuery()).toBe("");
    const hydrationRevision = context.store.getHydrationRevision();
    expect(controller.buildPipelineSearchInput()).toEqual({
      query: "",
      execution: "indexed-unavailable",
    });
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
    expect(controller.getCommittedQuery()).toBe("alpha");
    expect(context.store.getHydrationRevision()).toBe(hydrationRevision + 1);
    expect(publishSearchProjection).toHaveBeenCalledTimes(1);
  });

  it("keeps the last committed cards visible while a ready-index query is debounced", async () => {
    vi.useFakeTimers();
    const context = createContext();
    const alpha = { path: "notes/alpha.md", title: "Alpha" } as NoteCardRecord;
    const beta = { path: "notes/beta.md", title: "Beta" } as NoteCardRecord;
    context.store.replaceBaseCards([alpha, beta]);
    context.store.replaceVisibleCards([alpha, beta]);

    const query = vi.fn(async (request: { query: string }) => ({
      mode: "indexed" as const,
      status: "ready" as const,
      execution: "indexed-ready" as const,
      orderedPaths: request.query === "alpha" ? [alpha.path] : [beta.path],
    }));
    let controller!: SearchController;
    const projection = new ProjectionController({
      context,
      getSearchInput: () => controller.buildPipelineSearchInput(),
      getEffectivePinnedPaths: () => [],
      getLoadKey: () => "notes",
      getGroupConfig: () => DEFAULT_GROUP_SPEC,
      getCollapsedGroupKeys: () => new Set(),
    });
    const publishSearchProjection = vi.fn(() => projection.reprojectCards());
    controller = new SearchController({
      context,
      getSearchService: () => asService(query),
      getSearchSnapshot: () => createSnapshot(),
      subscribeSearchSnapshots: () => () => undefined,
      publishSearchProjection,
    });
    controller.initializeSnapshotState();

    controller.onQueryChange({ query: "alpha" });
    await controller.refreshProjection();
    controller.clearDebounce();
    expect(context.store.getVisibleCards().map((card) => card.path)).toEqual([alpha.path]);
    expect(controller.getCommittedQuery()).toBe("alpha");

    publishSearchProjection.mockClear();
    controller.onQueryChange({ query: "beta" });

    expect(controller.getQuery()).toBe("beta");
    expect(controller.getCommittedQuery()).toBe("alpha");
    expect(context.store.getVisibleCards().map((card) => card.path)).toEqual([alpha.path]);
    expect(publishSearchProjection).not.toHaveBeenCalled();

    vi.advanceTimersByTime(120);
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getCommittedQuery()).toBe("beta");
    expect(context.store.getVisibleCards().map((card) => card.path)).toEqual([beta.path]);
    expect(publishSearchProjection).toHaveBeenCalledTimes(1);
    controller.dispose();
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


describe("SearchController history and collapse", () => {
  function harness(context = createContext(), query = vi.fn(), settled = () => true) {
    const publish = vi.fn();
    const controller = new SearchController({ context, getSearchService: () => asService(query),
      getSearchSnapshot: () => createSnapshot(), subscribeSearchSnapshots: () => () => undefined,
      publishSearchProjection: publish, isScopeSettled: settled });
    controller.initializeSnapshotState();
    return { controller, publish, context, query };
  }

  it("records once per automatic ending, lets Enter record again, and suppresses resurrection after management", () => {
    const context = createContext();
    let settings = normalizeSettings({});
    context.getSettings = () => settings;
    context.saveSettings = vi.fn(async (patch) => { settings = mergeSettings(settings, patch); });
    const { controller } = harness(context);
    controller.onQueryChange({ query: " Alpha " });
    controller.onHistoryCommand({ command: "record", source: "blur" });
    controller.resetQuery("collapse");
    expect(context.saveSettings).toHaveBeenCalledTimes(1);
    expect(settings.searchHistory).toEqual(["Alpha"]);
    controller.onQueryChange({ query: "Alpha" });
    controller.onHistoryCommand({ command: "delete", query: "alpha" });
    controller.onHistoryCommand({ command: "record", source: "blur" });
    expect(settings.searchHistory).toEqual([]);
    controller.onHistoryCommand({ command: "record", source: "enter" });
    expect(settings.searchHistory).toEqual(["Alpha"]);
    controller.onHistoryCommand({ command: "clear" });
    controller.resetQuery("collapse");
    expect(settings.searchHistory).toEqual([]);
    controller.onQueryChange({ query: "new" });
    controller.resetQuery();
    controller.onHistoryCommand({ command: "record", source: "blur" });
    expect(settings.searchHistory).toEqual([]);
    controller.onQueryChange({ query: " visible " });
    controller.resetQuery("clear-button");
    expect(settings.searchHistory).toEqual(["visible"]);
    const savesAfterClear = vi.mocked(context.saveSettings).mock.calls.length;
    controller.onHistoryCommand({ command: "record", source: "blur" });
    controller.resetQuery("collapse");
    controller.resetQuery("clear-button");
    expect(context.saveSettings).toHaveBeenCalledTimes(savesAfterClear);
    controller.dispose();
  });

  it("uses the latest shared settings synchronously across two views while saves are pending", async () => {
    const context = createContext();
    let settings = normalizeSettings({});
    let release!: () => void;
    const write = new Promise<void>((resolve) => { release = resolve; });
    context.getSettings = () => settings;
    context.saveSettings = vi.fn((patch) => { settings = mergeSettings(settings, patch); return write; });
    const a = harness(context), b = harness(context);
    a.controller.onQueryChange({ query: "first" });
    a.controller.onHistoryCommand({ command: "record", source: "enter" });
    b.controller.onQueryChange({ query: "partial" });
    b.controller.onHistoryCommand({ command: "select", query: "second" });
    expect(settings.searchHistory).toEqual(["second", "first"]);
    expect(a.controller.getQuery()).toBe("first");
    expect(b.controller.getQuery()).toBe("second");
    expect(a.query).not.toHaveBeenCalled();
    expect(b.query).not.toHaveBeenCalled();
    a.publish.mockClear(); b.publish.mockClear();
    b.controller.onHistoryCommand({ command: "delete", query: "FIRST" });
    expect(settings.searchHistory).toEqual(["second"]);
    expect(a.publish).not.toHaveBeenCalled(); expect(b.publish).not.toHaveBeenCalled();
    release(); await write;
    a.controller.dispose(); b.controller.dispose();
  });

  it.each(["collapse", "clear-button"] as const)("records unavailable queries and resets immediately via %s despite a failed save", async (source) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const context = createContext();
      context.saveSettings = vi.fn(async () => { throw new Error("disk full"); });
      const { controller } = harness(context);
      controller.onSearchSnapshot(createSnapshot({ status: "building" }));
      controller.onQueryChange({ query: "missing" });
      controller.resetQuery(source);
      expect(controller.getQuery()).toBe("");
      expect(controller.getCommittedQuery()).toBe("");
      expect(context.saveSettings).toHaveBeenCalledWith({ searchHistory: ["missing"] });
      await Promise.resolve();
      expect(warn).toHaveBeenCalled();
      controller.dispose();
    } finally { warn.mockRestore(); }
  });

  it.each(["collapse", "clear-button"] as const)("cancels debounce on %s and rejects an already running late result", async (source) => {
    vi.useFakeTimers();
    let resolve!: (value: Awaited<ReturnType<SearchService["query"]>>) => void;
    const query = vi.fn(() => new Promise<Awaited<ReturnType<SearchService["query"]>>>((r) => { resolve = r; }));
    const { controller, publish } = harness(createContext(), query);
    controller.onQueryChange({ query: "draft" });
    controller.resetQuery(source);
    vi.advanceTimersByTime(120);
    expect(query).not.toHaveBeenCalled();
    controller.onQueryChange({ query: "running" });
    const pending = controller.refreshProjection();
    controller.resetQuery(source);
    publish.mockClear();
    resolve({ mode: "indexed", status: "ready", execution: "indexed-ready", orderedPaths: ["notes/a.md"], matchCountsByPath: { "notes/a.md": 1 } });
    await pending;
    expect(controller.getQuery()).toBe("");
    expect(controller.getCommittedQuery()).toBe("");
    expect(controller.getMatchCountsByPath()).toEqual({});
    expect(publish).not.toHaveBeenCalled();
    controller.dispose();
    vi.useRealTimers();
  });

  it("clears the committed query during a scope load so an empty post-load refresh cannot retain highlights", async () => {
    let settled = true;
    const query = vi.fn(async () => ({ execution: "indexed-ready" as const, orderedPaths: [] }));
    const { controller } = harness(createContext(), query, () => settled);
    controller.onQueryChange({ query: "old" });
    await controller.refreshProjection();
    settled = false;
    controller.resetForLoad();
    controller.resetQuery("collapse");
    await controller.refreshProjection({ allowUnsettled: true, publish: false });
    expect(controller.getCommittedQuery()).toBe("");
    expect(controller.buildPipelineSearchInput().query).toBe("");
    controller.dispose();
  });
});
