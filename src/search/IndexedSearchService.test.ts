import { describe, expect, it, vi } from "vitest";
import { IndexedSearchService, type IndexedSearchManagerAdapter } from "./IndexedSearchService";
import type { SearchIndexManagerSearchResult } from "./SearchIndexManager";
import type { SearchServiceSnapshot, SearchVaultMutation } from "./types";

function createHealth(overrides: Partial<SearchServiceSnapshot["health"]> = {}): SearchServiceSnapshot["health"] {
  return {
    outcome: "none",
    readiness: "initializing",
    healthy: false,
    rebuilding: true,
    rebuildRequired: false,
    persistence: "unknown",
    documentCount: null,
    lastIndexedAt: null,
    rebuildReason: null,
    lastError: null,
    lastSuccessfulRestore: null,
    lastSuccessfulBuild: null,
    detail: "Index manager initializing.",
    ...overrides,
  };
}

function createSnapshot(overrides: Partial<SearchServiceSnapshot> = {}): SearchServiceSnapshot {
  return {
    initialized: true,
    disposed: false,
    mode: "indexed",
    status: "building",
    lastError: null,
    health: createHealth(),
    ...overrides,
  };
}

function createMutation(overrides: Partial<SearchVaultMutation> = {}): SearchVaultMutation {
  return {
    type: "rename",
    path: "folder-b",
    oldPath: "folder-a",
    isMarkdown: false,
    isFolder: true,
    renameClassification: "folder-rebuild-required",
    ...overrides,
  };
}

function createManagerHarness(initialSnapshot = createSnapshot()): {
  manager: IndexedSearchManagerAdapter;
  emit: (snapshot: SearchServiceSnapshot) => void;
  initialize: ReturnType<typeof vi.fn<() => Promise<void>>>;
  dispose: ReturnType<typeof vi.fn<() => void>>;
  getSnapshot: ReturnType<typeof vi.fn<() => SearchServiceSnapshot>>;
  subscribe: ReturnType<typeof vi.fn<(listener: (snapshot: SearchServiceSnapshot) => void) => () => void>>;
  search: ReturnType<typeof vi.fn<(query: string, candidatePaths: string[]) => Promise<SearchIndexManagerSearchResult>>>;
  handleVaultMutation: ReturnType<typeof vi.fn<(event: SearchVaultMutation) => void>>;
} {
  let current = initialSnapshot;
  const listeners = new Set<(snapshot: SearchServiceSnapshot) => void>();

  const initialize = vi.fn(async () => undefined);
  const dispose = vi.fn(() => {
    current = createSnapshot({
      initialized: false,
      disposed: true,
      status: "building",
      health: {
        ...current.health,
        healthy: false,
        rebuilding: true,
      },
    });
    for (const listener of listeners) {
      listener({
        ...current,
        health: {
          ...current.health,
        },
      });
    }
    listeners.clear();
  });
  const getSnapshot = vi.fn(() => ({
    ...current,
    health: {
      ...current.health,
    },
  }));
  const subscribe = vi.fn((listener: (snapshot: SearchServiceSnapshot) => void) => {
    listeners.add(listener);
    listener({
      ...current,
      health: {
        ...current.health,
      },
    });
    return () => {
      listeners.delete(listener);
    };
  });
  const search = vi.fn(async () => ({ orderedPaths: [] }) as SearchIndexManagerSearchResult);
  const handleVaultMutation = vi.fn(() => undefined);

  return {
    manager: {
      initialize,
      dispose,
      getSnapshot,
      subscribe,
      search,
      handleVaultMutation,
    },
    emit: (snapshot: SearchServiceSnapshot) => {
      current = snapshot;
      for (const listener of listeners) {
        listener({
          ...current,
          health: {
            ...current.health,
          },
        });
      }
    },
    initialize,
    dispose,
    getSnapshot,
    subscribe,
    search,
    handleVaultMutation,
  };
}

describe("IndexedSearchService", () => {
  it("syncs manager snapshots on initialize and mirrors subscribe fanout", async () => {
    const harness = createManagerHarness(createSnapshot({ status: "building" }));
    const service = new IndexedSearchService(harness.manager, { maxCandidatePaths: 25 });
    const seen: string[] = [];

    const unsubscribe = service.subscribe((snapshot) => {
      seen.push(snapshot.status);
    });

    await service.initialize();
    harness.emit(createSnapshot({
      status: "ready",
      health: createHealth({
        outcome: "restored",
        readiness: "ready",
        healthy: true,
        rebuilding: false,
        rebuildRequired: false,
        persistence: "healthy",
        documentCount: 7,
        lastIndexedAt: 100,
        lastSuccessfulRestore: {
          outcome: "restored",
          at: 100,
          documentCount: 7,
          detail: "Search index restored from persistent storage.",
        },
        detail: "Search index restored from persistent storage.",
      }),
    }));

    expect(harness.initialize).toHaveBeenCalledTimes(1);
    expect(harness.subscribe).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().status).toBe("ready");
    expect(seen).toEqual(["building", "building", "building", "ready"]);

    unsubscribe();
  });

  it("disposes safely, unsubscribes manager listener, and emits final disposed snapshot", async () => {
    const harness = createManagerHarness(createSnapshot({ status: "ready" }));
    const service = new IndexedSearchService(harness.manager, { maxCandidatePaths: 25 });
    const seen: boolean[] = [];

    service.subscribe((snapshot) => {
      seen.push(snapshot.disposed);
    });

    await service.initialize();
    service.dispose();

    expect(harness.dispose).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().disposed).toBe(true);
    expect(seen.at(-1)).toBe(true);
  });

  it("returns candidate-bounded indexed ordering when ready", async () => {
    const harness = createManagerHarness(createSnapshot({ status: "ready" }));
    harness.search.mockResolvedValue({
      orderedPaths: [
        "notes/Meeting Followup.md",
        "Archive/Global Meeting Index.md",
        "notes/Meeting.md",
        "notes/Meeting Followup.md",
        "notes/Other.md",
      ],
      matchCountsByPath: {
        "notes/Meeting Followup.md": 4,
        "Archive/Global Meeting Index.md": 9,
        "notes/Meeting.md": 2,
        "notes/Other.md": 1,
      },
    });
    const service = new IndexedSearchService(harness.manager, { maxCandidatePaths: 3 });
    await service.initialize();

    const result = await service.query({
      query: "meeting",
      scope: { folderPath: "notes", includeSubfolders: true },
      candidatePaths: [
        "notes/Meeting.md",
        "notes/Meeting Followup.md",
        "notes/Other.md",
        "notes/Backlog.md",
        "notes/Other.md",
      ],
    });

    expect(harness.search).toHaveBeenCalledWith("meeting", [
      "notes/Meeting.md",
      "notes/Meeting Followup.md",
      "notes/Other.md",
    ]);
    expect(result).toEqual({
      mode: "indexed",
      status: "ready",
      execution: "indexed-ready",
      orderedPaths: [
        "notes/Meeting Followup.md",
        "notes/Meeting.md",
        "notes/Other.md",
      ],
      matchCountsByPath: {
        "notes/Meeting Followup.md": 4,
        "notes/Meeting.md": 2,
        "notes/Other.md": 1,
      },
    });
  });

  it("returns indexed-ready zero results when the bounded candidates have no matches", async () => {
    const harness = createManagerHarness(createSnapshot({ status: "ready" }));
    harness.search.mockResolvedValue({ orderedPaths: [] });
    const service = new IndexedSearchService(harness.manager, { maxCandidatePaths: 3 });
    await service.initialize();

    const result = await service.query({
      query: "meeting",
      scope: { folderPath: "notes", includeSubfolders: true },
      candidatePaths: ["notes/Meeting.md", "notes/Meeting Followup.md"],
    });

    expect(harness.search).toHaveBeenCalledWith("meeting", ["notes/Meeting.md", "notes/Meeting Followup.md"]);
    expect(result).toEqual({
      mode: "indexed",
      status: "ready",
      execution: "indexed-ready",
      orderedPaths: [],
    });
  });

  it("exposes matchCountsByPath only for indexed-ready returned paths", async () => {
    const harness = createManagerHarness(createSnapshot({ status: "ready" }));
    harness.search.mockResolvedValue({
      orderedPaths: ["notes/a.md", "notes/b.md", "notes/a.md", "notes/outside.md"],
      matchCountsByPath: {
        "notes/a.md": 5,
        "notes/b.md": 3,
        "notes/outside.md": 8,
      },
    });
    const service = new IndexedSearchService(harness.manager, { maxCandidatePaths: 2 });
    await service.initialize();

    const result = await service.query({
      query: "alpha beta",
      scope: { folderPath: "notes", includeSubfolders: true },
      candidatePaths: ["notes/a.md", "notes/b.md", "notes/c.md"],
    });

    expect(result).toEqual({
      mode: "indexed",
      status: "ready",
      execution: "indexed-ready",
      orderedPaths: ["notes/a.md", "notes/b.md"],
      matchCountsByPath: {
        "notes/a.md": 5,
        "notes/b.md": 3,
      },
    });
  });

  it("omits match count metadata when bounded indexed-ready results retain no returned-path counts", async () => {
    const harness = createManagerHarness(createSnapshot({ status: "ready" }));
    harness.search.mockResolvedValue({
      orderedPaths: ["notes/outside.md", "notes/outside.md"],
      matchCountsByPath: {
        "notes/outside.md": 8,
      },
    });
    const service = new IndexedSearchService(harness.manager, { maxCandidatePaths: 2 });
    await service.initialize();

    const result = await service.query({
      query: "alpha",
      scope: { folderPath: "notes", includeSubfolders: true },
      candidatePaths: ["notes/a.md", "notes/b.md", "notes/c.md"],
    });

    expect(result).toEqual({
      mode: "indexed",
      status: "ready",
      execution: "indexed-ready",
      orderedPaths: [],
    });
  });

  it("returns indexed-building result while restore/build is in progress", async () => {
    const harness = createManagerHarness(createSnapshot({ status: "building" }));
    const service = new IndexedSearchService(harness.manager, { maxCandidatePaths: 25 });

    const result = await service.query({
      query: "roadmap",
      scope: { folderPath: "notes", includeSubfolders: true },
      candidatePaths: ["notes/a.md", "notes/b.md"],
    });

    expect(harness.search).not.toHaveBeenCalled();
    expect(result).toEqual({
      mode: "indexed",
      status: "building",
      execution: "indexed-building",
    });
  });

  it("does not locally filter candidate paths while building", async () => {
    const harness = createManagerHarness(createSnapshot({ status: "building" }));
    const service = new IndexedSearchService(harness.manager, { maxCandidatePaths: 25 });

    const result = await service.query({
      query: "meeting",
      scope: { folderPath: "notes", includeSubfolders: true },
      candidatePaths: ["Notes/Meeting.md", "Notes/Plan.md"],
    });

    expect(harness.search).not.toHaveBeenCalled();
    expect(result).toEqual({
      mode: "indexed",
      status: "building",
      execution: "indexed-building",
    });
    expect(result).not.toHaveProperty("orderedPaths");
  });

  it("returns indexed rebuild-required result when health requires rebuild", async () => {
    const harness = createManagerHarness(createSnapshot({
      status: "building",
      health: createHealth({
        outcome: "rebuild-required",
        readiness: "rebuild-required",
        healthy: false,
        rebuilding: true,
        rebuildRequired: true,
        persistence: "healthy",
        documentCount: null,
        lastIndexedAt: null,
        rebuildReason: "version-drift",
        detail: "Full rebuild required.",
      }),
    }));
    const service = new IndexedSearchService(harness.manager, { maxCandidatePaths: 25 });

    const result = await service.query({
      query: "roadmap",
      scope: { folderPath: "notes", includeSubfolders: true },
      candidatePaths: ["notes/a.md"],
    });

    expect(harness.search).not.toHaveBeenCalled();
    expect(result).toEqual({
      mode: "indexed",
      status: "building",
      execution: "indexed-rebuild-required",
    });
  });

  it("returns indexed storage-unavailable result when rebuild-required is caused by storage", async () => {
    const harness = createManagerHarness(createSnapshot({
      status: "building",
      health: createHealth({
        outcome: "rebuild-required",
        readiness: "rebuild-required",
        healthy: false,
        rebuilding: true,
        rebuildRequired: true,
        persistence: "storage-unavailable",
        documentCount: null,
        lastIndexedAt: null,
        rebuildReason: "storage-unavailable",
        detail: "Persistent index storage unavailable; rebuild cannot restore persisted index.",
      }),
    }));
    const service = new IndexedSearchService(harness.manager, { maxCandidatePaths: 25 });

    const result = await service.query({
      query: "roadmap",
      scope: { folderPath: "notes", includeSubfolders: true },
      candidatePaths: ["notes/a.md"],
    });

    expect(harness.search).not.toHaveBeenCalled();
    expect(result).toEqual({
      mode: "indexed",
      status: "building",
      execution: "indexed-storage-unavailable",
    });
  });

  it("returns indexed-error result in error state", async () => {
    const harness = createManagerHarness(createSnapshot({ status: "error", lastError: "disk full" }));
    const service = new IndexedSearchService(harness.manager, { maxCandidatePaths: 25 });

    const result = await service.query({
      query: "roadmap",
      scope: { folderPath: "notes", includeSubfolders: true },
      candidatePaths: ["notes/a.md"],
    });

    expect(harness.search).not.toHaveBeenCalled();
    expect(result).toEqual({
      mode: "indexed",
      status: "error",
      execution: "indexed-error",
    });
  });

  it("returns indexed-unavailable result when the indexed runtime is not initialized", async () => {
    const harness = createManagerHarness(createSnapshot({ initialized: false, status: "building" }));
    const service = new IndexedSearchService(harness.manager, { maxCandidatePaths: 25 });

    const result = await service.query({
      query: "roadmap",
      scope: { folderPath: "notes", includeSubfolders: true },
      candidatePaths: ["notes/a.md"],
    });

    expect(harness.search).not.toHaveBeenCalled();
    expect(result).toEqual({
      mode: "indexed",
      status: "building",
      execution: "indexed-unavailable",
    });
  });

  it("does not locally filter candidate paths when indexed runtime is unavailable", async () => {
    const harness = createManagerHarness(createSnapshot({ initialized: false, status: "building" }));
    const service = new IndexedSearchService(harness.manager, { maxCandidatePaths: 25 });

    const result = await service.query({
      query: "meeting",
      scope: { folderPath: "notes", includeSubfolders: true },
      candidatePaths: ["Notes/Meeting.md", "Notes/Plan.md"],
    });

    expect(harness.search).not.toHaveBeenCalled();
    expect(result).toEqual({
      mode: "indexed",
      status: "building",
      execution: "indexed-unavailable",
    });
    expect(result).not.toHaveProperty("orderedPaths");
  });

  it("forwards vault mutations to manager", () => {
    const harness = createManagerHarness();
    const service = new IndexedSearchService(harness.manager, { maxCandidatePaths: 25 });
    const event = createMutation();

    service.handleVaultMutation(event);

    expect(harness.handleVaultMutation).toHaveBeenCalledTimes(1);
    expect(harness.handleVaultMutation).toHaveBeenCalledWith(event);
  });
});
