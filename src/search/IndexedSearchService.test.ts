import { describe, expect, it, vi } from "vitest";
import { IndexedSearchService, type IndexedSearchManagerAdapter } from "./IndexedSearchService";
import type { SearchServiceSnapshot, SearchVaultMutation } from "./types";

function createSnapshot(overrides: Partial<SearchServiceSnapshot> = {}): SearchServiceSnapshot {
  return {
    initialized: true,
    disposed: false,
    mode: "indexed",
    status: "building",
    lastError: null,
    health: {
      outcome: "none",
      healthy: false,
      rebuilding: true,
      documentCount: null,
      lastIndexedAt: null,
      detail: "Index manager initializing.",
    },
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
  search: ReturnType<typeof vi.fn<(query: string, candidatePaths: string[]) => Promise<string[]>>>;
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
  const search = vi.fn(async () => [] as string[]);
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
      health: {
        outcome: "restored",
        healthy: true,
        rebuilding: false,
        documentCount: 7,
        lastIndexedAt: 100,
        detail: "Search index restored from persistent storage.",
      },
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
    harness.search.mockResolvedValue([
      "notes/b.md",
      "outside/x.md",
      "notes/a.md",
      "notes/b.md",
      "notes/c.md",
    ]);
    const service = new IndexedSearchService(harness.manager, { maxCandidatePaths: 3 });
    await service.initialize();

    const result = await service.query({
      query: "roadmap",
      scope: { folderPath: "notes", includeSubfolders: true },
      candidatePaths: ["notes/a.md", "notes/b.md", "notes/c.md", "notes/d.md", "notes/c.md"],
    });

    expect(harness.search).toHaveBeenCalledWith("roadmap", ["notes/a.md", "notes/b.md", "notes/c.md"]);
    expect(result).toEqual({
      mode: "indexed",
      status: "ready",
      execution: "indexed-ordering",
      orderedPaths: ["notes/b.md", "notes/a.md", "notes/c.md"],
    });
  });

  it("returns fallback-safe result while building", async () => {
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
      execution: "fallback-filtering",
      orderedPaths: null,
    });
  });

  it("returns fallback-safe result in error state", async () => {
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
      execution: "fallback-filtering",
      orderedPaths: null,
    });
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
