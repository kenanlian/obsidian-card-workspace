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
  search(query: string, candidatePaths: string[]): Promise<string[]>;
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

  constructor(manager: IndexedSearchManagerAdapter, options: IndexedSearchServiceOptions) {
    this.manager = manager;
    this.options = options;
    this.snapshot = cloneSnapshot(this.manager.getSnapshot());
  }

  async initialize(): Promise<void> {
    if (!this.managerUnsubscribe) {
      this.managerUnsubscribe = this.manager.subscribe((snapshot) => {
        this.snapshot = cloneSnapshot(snapshot);
        this.emit();
      });
    }

    await this.manager.initialize();
    this.snapshot = cloneSnapshot(this.manager.getSnapshot());
    this.emit();
  }

  dispose(): void {
    this.manager.dispose();
    this.snapshot = cloneSnapshot(this.manager.getSnapshot());
    this.emit();

    if (this.managerUnsubscribe) {
      this.managerUnsubscribe();
      this.managerUnsubscribe = null;
    }
    this.listeners.clear();
  }

  getSnapshot(): SearchServiceSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  subscribe(listener: (snapshot: SearchServiceSnapshot) => void): () => void {
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

    const searchedPaths = await this.manager.search(request.query, boundedCandidates);
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
    for (const path of searchedPaths) {
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
    };
  }

  handleVaultMutation(event: SearchVaultMutation): void {
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

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
