import type {
  SearchQueryRequest,
  SearchQueryResult,
  SearchService,
  SearchServiceSnapshot,
  SearchVaultMutation,
} from "./types";

const INITIAL_SNAPSHOT: SearchServiceSnapshot = {
  initialized: false,
  disposed: false,
  mode: "no-index",
  status: "building",
  lastError: null,
  health: {
    outcome: "none",
    healthy: false,
    rebuilding: true,
    documentCount: null,
    lastIndexedAt: null,
    detail: "No index present; fallback filtering remains active.",
  },
};

/**
 * Minimal plugin-owned search adapter for pre-index mode.
 * It is lifecycle-safe and always degrades to local fallback filtering.
 */
export class NoIndexSearchService implements SearchService {
  private snapshot: SearchServiceSnapshot = { ...INITIAL_SNAPSHOT };
  private listeners = new Set<(snapshot: SearchServiceSnapshot) => void>();

  async initialize(): Promise<void> {
    this.snapshot = {
      initialized: true,
      disposed: false,
      mode: "no-index",
      status: "ready",
      lastError: null,
      health: {
        outcome: "none",
        healthy: true,
        rebuilding: false,
        documentCount: null,
        lastIndexedAt: null,
        detail: "No index present; service is ready for fallback filtering.",
      },
    };
    this.emit();
  }

  dispose(): void {
    if (this.snapshot.disposed) {
      return;
    }

    this.snapshot = {
      ...this.snapshot,
      initialized: false,
      disposed: true,
      status: "building",
      health: {
        ...this.snapshot.health,
        healthy: false,
        rebuilding: true,
      },
    };
    this.emit();
    this.listeners.clear();
  }

  getSnapshot(): SearchServiceSnapshot {
    return { ...this.snapshot };
  }

  subscribe(listener: (snapshot: SearchServiceSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());

    return () => {
      this.listeners.delete(listener);
    };
  }

  async query(_request: SearchQueryRequest): Promise<SearchQueryResult> {
    const status = this.snapshot.initialized && !this.snapshot.disposed ? "ready" : "error";
    return {
      mode: "no-index",
      status,
      execution: "fallback-filtering",
      orderedPaths: null,
    };
  }

  handleVaultMutation(_event: SearchVaultMutation): void {
    // No-op in no-index mode; future indexed adapters can consume mutation deltas.
  }

  private emit(): void {
    const next = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(next);
    }
  }
}
