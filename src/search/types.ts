export type SearchStatus =
  | "idle"
  | "ready"
  | "building"
  | "rebuild-required"
  | "storage-unavailable"
  | "unavailable"
  | "error";

/** Indexed-mode status values surfaced by the plugin-owned search service. */
export type SearchServiceStatus = Extract<SearchStatus, "ready" | "building" | "error">;

export type SearchIndexReadinessState =
  | "initializing"
  | "restoring"
  | "building"
  | "ready"
  | "rebuild-required"
  | "error";

export type SearchIndexPersistenceHealth = "unknown" | "healthy" | "storage-unavailable" | "read-failed" | "write-failed";

export type SearchIndexRebuildReason =
  | "missing"
  | "version-drift"
  | "corrupt"
  | "read-failed"
  | "load-failed"
  | "storage-unavailable"
  | "folder-rebuild-required";

export type SearchIndexSuccessOutcome = Extract<SearchRestoreOutcome, "restored" | "rebuilt">;

export interface SearchIndexSuccessSnapshot {
  outcome: SearchIndexSuccessOutcome;
  at: number;
  documentCount: number;
  detail: string | null;
}

/** Runtime strategy for resolving a query. */
export type SearchExecutionMode = "indexed";

/**
 * Indexed-only query execution state matrix.
 *
 * Empty-query browsing stays outside `SearchService.query()` and therefore outside this matrix.
 * For non-empty queries:
 * - `indexed-ready`: indexed search ran; `orderedPaths` is authoritative and may be empty.
 * - `indexed-building`: index restore/build is still in progress.
 * - `indexed-rebuild-required`: indexed search is blocked pending rebuild.
 * - `indexed-error`: indexed search failed and cannot run the query.
 * - `indexed-storage-unavailable`: persistent index storage is unavailable, so indexed search cannot run.
 * - `indexed-unavailable`: indexed search has not been initialized or is temporarily unavailable.
 */
export type SearchQueryExecutionState =
  | "indexed-ready"
  | "indexed-building"
  | "indexed-rebuild-required"
  | "indexed-error"
  | "indexed-storage-unavailable"
  | "indexed-unavailable";

/**
 * Canonical searchable document shape for Phase 3+ indexing work.
 *
 * Field order is intentional and contract-locked:
 * { path, title, normalizedTitle, content, excerpt, folderPath, mtime, ctime }
 *
 * Notes:
 * - `normalizedTitle` is lowercase-normalized title text used for deterministic matching.
 * - Tags are intentionally NOT indexed in Phase 3 because tag filtering has its own pipeline lane.
 */
export interface SearchableDocument {
  path: string;
  title: string;
  normalizedTitle: string;
  content: string;
  excerpt: string;
  folderPath: string;
  mtime: number;
  ctime: number;
}

/**
 * Phase 3 MiniSearch options contract (frozen for future implementation).
 *
 * - index fields: `title` + `content`
 * - stored fields: `path` + `title` + `excerpt`
 * - normalization: lowercase
 * - query options: prefix true, fuzzy false, AND combination
 * - ranking: title has 3x boost over content
 */
export const PHASE3_MINISEARCH_CONTRACT = {
  indexFields: ["title", "content"],
  storeFields: ["path", "title", "excerpt"],
  normalize: "lowercase",
  query: {
    prefix: true,
    fuzzy: false,
    combineWith: "AND",
  },
  boost: {
    title: 3,
    content: 1,
  },
} as const;

/**
 * Search service restore/rebuild checkpoint outcome.
 *
 * `rebuild-required` covers corruption/version mismatch/unsafe folder-rename cases,
 * and keeps runtime behavior on the indexed blocked/building path until rebuild completes.
 */
export type SearchRestoreOutcome = "none" | "restored" | "rebuild-required" | "rebuilt" | "failed";

/** Plugin-global index health snapshot (owned by `main.ts` lifecycle). */
export interface SearchIndexHealthSnapshot {
  outcome: SearchRestoreOutcome;
  readiness: SearchIndexReadinessState;
  healthy: boolean;
  rebuilding: boolean;
  rebuildRequired: boolean;
  persistence: SearchIndexPersistenceHealth;
  documentCount: number | null;
  lastIndexedAt: number | null;
  rebuildReason: SearchIndexRebuildReason | null;
  lastError: string | null;
  lastSuccessfulRestore: SearchIndexSuccessSnapshot | null;
  lastSuccessfulBuild: SearchIndexSuccessSnapshot | null;
  detail: string | null;
}

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
 *
 * - `execution: "indexed-ready"` means indexed search ran; `orderedPaths` is authoritative.
 * - `orderedPaths: []` still means indexed-ready zero matches, not unavailable search.
 * - Any non-ready execution state means indexed filtering did not run for this query.
 * - Score metadata stays runtime-internal and must not leak into render-facing card types.
 * - `matchCountsByPath` is runtime metadata for indexed-ready badge/count decoration, separate from ranking scores.
 */
export interface SearchQueryResult {
  mode: SearchExecutionMode;
  status: SearchServiceStatus;
  execution: SearchQueryExecutionState;
  orderedPaths?: string[];
  scoresByPath?: Record<string, number>;
  matchCountsByPath?: Record<string, number>;
}

/**
 * Service-level status snapshot for plugin lifecycle coordination.
 *
 * `main.ts` owns plugin-global service lifecycle and health reporting.
 * Views own per-view runtime query state and consume this snapshot read-only.
 */
export interface SearchServiceSnapshot {
  initialized: boolean;
  disposed: boolean;
  mode: SearchExecutionMode;
  status: SearchServiceStatus;
  lastError: string | null;
  health: SearchIndexHealthSnapshot;
}

/** Lightweight local-only observability payload for command/debug surfaces. */
export interface SearchIndexObservabilitySnapshot {
  status: SearchServiceStatus;
  queriesAllowed: boolean;
  health: SearchIndexHealthSnapshot;
}

export type SearchVaultMutationType = "create" | "modify" | "delete" | "rename";

/**
 * Rename classification contract.
 *
 * - `file`: single-file move/rename; index can remap one path.
 * - `folder-safe-prefix-rewrite`: subtree rename where old/new prefix mapping is provable.
 * - `folder-rebuild-required`: subtree rename cannot be proven safe for prefix rewrite; rebuild path required.
 */
export type SearchRenameClassification =
  | "file"
  | "folder-safe-prefix-rewrite"
  | "folder-rebuild-required";

/** Optional mutation forwarding seam for plugin-owned vault observers. */
export interface SearchVaultMutation {
  type: SearchVaultMutationType;
  path: string;
  oldPath: string | null;
  isMarkdown: boolean;
  isFolder: boolean;
  renameClassification?: SearchRenameClassification;
}

export interface SearchService {
  initialize(): Promise<void>;
  dispose(): void;
  getSnapshot(): SearchServiceSnapshot;
  subscribe(listener: (snapshot: SearchServiceSnapshot) => void): () => void;
  query(request: SearchQueryRequest): Promise<SearchQueryResult>;
  handleVaultMutation(event: SearchVaultMutation): void;
}
