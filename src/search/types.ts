export type SearchStatus = "idle" | "fallback" | "ready" | "building" | "error";

/** Indexed-mode status values surfaced by the plugin-owned search service. */
export type SearchServiceStatus = Extract<SearchStatus, "ready" | "building" | "error">;

/** Runtime strategy for resolving a query. */
export type SearchExecutionMode = "no-index" | "indexed";

/** Narrow folder scope input owned by the view coordinator, not the service. */
export interface SearchScope {
  folderPath: string | null;
  includeSubfolders: boolean;
}

/**
 * Query payload passed from runtime coordinator to SearchService.
 * The service receives projection inputs but does not own query/panel state.
 */
export interface SearchQueryRequest {
  query: string;
  scope: SearchScope;
  candidatePaths: string[];
}

/**
 * Ordered path projection seam for indexed mode.
 * `orderedPaths: null` means callers must use local fallback filtering.
 */
export interface SearchQueryResult {
  mode: SearchExecutionMode;
  status: SearchServiceStatus;
  orderedPaths: string[] | null;
  scoresByPath?: Record<string, number>;
}

/**
 * Service-level status snapshot for plugin lifecycle coordination.
 * `main.ts` owns lifecycle and can subscribe; views remain consumers.
 */
export interface SearchServiceSnapshot {
  initialized: boolean;
  disposed: boolean;
  mode: SearchExecutionMode;
  status: SearchServiceStatus;
  lastError: string | null;
}

export type SearchVaultMutationType = "create" | "modify" | "delete" | "rename";

/** Optional mutation forwarding seam for plugin-owned vault observers. */
export interface SearchVaultMutation {
  type: SearchVaultMutationType;
  path: string;
  oldPath: string | null;
  isMarkdown: boolean;
  isFolder: boolean;
}

export interface SearchService {
  initialize(): Promise<void>;
  dispose(): void;
  getSnapshot(): SearchServiceSnapshot;
  subscribe(listener: (snapshot: SearchServiceSnapshot) => void): () => void;
  query(request: SearchQueryRequest): Promise<SearchQueryResult>;
  handleVaultMutation(event: SearchVaultMutation): void;
}
