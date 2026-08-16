import { afterEach, describe, expect, it, vi } from "vitest";
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
});
