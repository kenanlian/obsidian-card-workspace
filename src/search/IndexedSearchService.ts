import type { SearchIndexManagerSearchResult } from "./SearchIndexManager";
import type {
  SearchQueryExecutionState,
  SearchQueryRequest,
  SearchQueryResult,
  SearchService,
  SearchServiceSnapshot,
  SearchVaultMutation,
} from "./types";

export interface IndexedSearchManagerAdapter {
  initialize(): Promise<void>;
  dispose(): void;
  getSnapshot(): SearchServiceSnapshot;
  subscribe(listener: (snapshot: SearchServiceSnapshot) => void): () => void;
  search(query: string, candidatePaths: string[]): Promise<SearchIndexManagerSearchResult>;
  handleVaultMutation(event: SearchVaultMutation): void;
}

export interface IndexedSearchServiceOptions {
  maxCandidatePaths: number;
}

function cloneSnapshot(snapshot: SearchServiceSnapshot): SearchServiceSnapshot {
  return {
    ...snapshot,
    health: {
      ...snapshot.health,
    },
  };
}

export class IndexedSearchService implements SearchService {
  private readonly manager: IndexedSearchManagerAdapter;
  private readonly options: IndexedSearchServiceOptions;
  private snapshot: SearchServiceSnapshot;
  private readonly listeners = new Set<(snapshot: SearchServiceSnapshot) => void>();
  private managerUnsubscribe: (() => void) | null = null;
  private disposed = false;

  constructor(manager: IndexedSearchManagerAdapter, options: IndexedSearchServiceOptions) {
    this.manager = manager;
    this.options = options;
    this.snapshot = cloneSnapshot(this.manager.getSnapshot());
  }

  async initialize(): Promise<void> {
    if (this.disposed) return;
    if (!this.managerUnsubscribe) {
      this.managerUnsubscribe = this.manager.subscribe((snapshot) => {
        this.snapshot = cloneSnapshot(snapshot);
        this.emit();
      });
    }

    await this.manager.initialize();
    if (this.disposed) return;
    this.snapshot = cloneSnapshot(this.manager.getSnapshot());
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.managerUnsubscribe) {
      this.managerUnsubscribe();
      this.managerUnsubscribe = null;
    }
    this.manager.dispose();
    this.snapshot = cloneSnapshot(this.manager.getSnapshot());
    this.emit();
    this.listeners.clear();
  }

  getSnapshot(): SearchServiceSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  subscribe(listener: (snapshot: SearchServiceSnapshot) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async query(request: SearchQueryRequest): Promise<SearchQueryResult> {
    const blockedExecution = this.getBlockedExecution(this.snapshot);
    if (blockedExecution) {
      return {
        mode: "indexed",
        status: this.snapshot.status,
        execution: blockedExecution,
      };
    }

    const boundedCandidates = this.boundCandidatePaths(request.candidatePaths);
    if (boundedCandidates.length === 0) {
      return {
        mode: "indexed",
        status: "ready",
        execution: "indexed-ready",
        orderedPaths: [],
      };
    }

    const searchResult = await this.manager.search(request.query, boundedCandidates);
    if (this.disposed) {
      return { mode: "indexed", status: this.snapshot.status, execution: "indexed-unavailable" };
    }
    const postSearchBlockedExecution = this.getBlockedExecution(this.snapshot);
    if (postSearchBlockedExecution) {
      return {
        mode: "indexed",
        status: this.snapshot.status,
        execution: postSearchBlockedExecution,
      };
    }

    const allowed = new Set(boundedCandidates);
    const orderedPaths: string[] = [];
    for (const path of searchResult.orderedPaths) {
      if (!allowed.has(path)) {
        continue;
      }
      if (orderedPaths.includes(path)) {
        continue;
      }
      orderedPaths.push(path);
    }

    return {
      mode: "indexed",
      status: "ready",
      execution: "indexed-ready",
      orderedPaths,
      matchCountsByPath: this.filterMatchCountsByPath(orderedPaths, searchResult),
    };
  }

  handleVaultMutation(event: SearchVaultMutation): void {
    if (this.disposed) return;
    this.manager.handleVaultMutation(event);
  }

  private boundCandidatePaths(candidatePaths: string[]): string[] {
    const max = Math.max(0, this.options.maxCandidatePaths);
    if (max === 0) {
      return [];
    }

    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const path of candidatePaths) {
      if (seen.has(path)) {
        continue;
      }
      deduped.push(path);
      seen.add(path);
      if (deduped.length >= max) {
        break;
      }
    }

    return deduped;
  }

  private getBlockedExecution(snapshot: SearchServiceSnapshot): SearchQueryExecutionState | null {
    if (!snapshot.initialized || snapshot.disposed || snapshot.mode !== "indexed") {
      return "indexed-unavailable";
    }

    if (snapshot.status === "ready") {
      return null;
    }

    if (snapshot.status === "error") {
      return "indexed-error";
    }

    if (snapshot.health.outcome === "rebuild-required") {
      return snapshot.health.persistence === "storage-unavailable"
        ? "indexed-storage-unavailable"
        : "indexed-rebuild-required";
    }

    return "indexed-building";
  }

  private filterMatchCountsByPath(
    orderedPaths: string[],
    searchResult: SearchIndexManagerSearchResult,
  ): Record<string, number> | undefined {
    if (!searchResult.matchCountsByPath) {
      return undefined;
    }

    const filtered: Record<string, number> = {};
    for (const path of orderedPaths) {
      const count = searchResult.matchCountsByPath[path];
      if (typeof count !== "number") {
        continue;
      }
      filtered[path] = count;
    }

    return Object.keys(filtered).length > 0 ? filtered : undefined;
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
