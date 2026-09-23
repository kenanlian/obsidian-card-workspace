import type {
  SearchQueryExecutionState,
  SearchQueryResult,
  SearchService,
  SearchServiceSnapshot,
} from "../../search";
import { AsyncEpoch, type EpochToken } from "../async-epoch";
import { scopesEqual, type CardScope } from "../scope";
import type { PipelineSearchInput, SearchStatus } from "../types";
import type { DisposableController, DisposeReport, ViewContext } from "../view-context";

const SEARCH_DEBOUNCE_MS = 120;

export interface SearchControllerDeps {
  context: ViewContext;
  getSearchService: () => SearchService | null;
  getSearchSnapshot: () => SearchServiceSnapshot | null;
  subscribeSearchSnapshots: (
    listener: (snapshot: SearchServiceSnapshot) => void,
  ) => () => void;
  publishSearchProjection: () => void;
  /** When omitted, the scope is treated as settled. */
  isScopeSettled?: () => boolean;
}

/** Options for {@link SearchController.refreshProjection}. */
export interface SearchRefreshOptions {
  /**
   * When false, suppresses the ordinary intermediate panel publication so a
   * coordinating caller can publish one coherent final batch itself. Default
   * true, preserving every existing caller's publishing behavior.
   */
  readonly publish?: boolean;
  /**
   * Load orchestration refreshes a finished base while `isScopeSettled()` is
   * still false. User-driven refreshes omit this and wait for the settled publish.
   */
  readonly allowUnsettled?: boolean;
}

/** Owns one view's indexed-search runtime, including both stale-result guards. */
export class SearchController implements DisposableController {
  private query = "";
  /** Query represented by `execution` / `orderedPaths` and the visible-card projection. */
  private committedQuery = "";
  private execution: SearchQueryExecutionState = "indexed-unavailable";
  private orderedPaths: string[] | undefined;
  private matchCountsByPath: Record<string, number> = {};
  private status: SearchStatus = "idle";
  private focusToken = 0;
  private snapshot: SearchServiceSnapshot | null = null;
  private snapshotUnsubscribe: (() => void) | null = null;
  private debounceTimer: ReturnType<Window["setTimeout"]> | null = null;
  private readonly requestEpoch = new AsyncEpoch();
  private readonly snapshotEpoch = new AsyncEpoch();

  constructor(private readonly deps: SearchControllerDeps) {}

  private get context(): ViewContext {
    return this.deps.context;
  }

  private scopeSettled(): boolean {
    return this.deps.isScopeSettled?.() !== false;
  }

  getQuery(): string {
    return this.query;
  }

  getCommittedQuery(): string {
    return this.committedQuery;
  }

  getStatus(): SearchStatus {
    return this.status;
  }

  getMatchCountsByPath(): Record<string, number> {
    return this.matchCountsByPath;
  }

  getSnapshot(): SearchServiceSnapshot | null {
    return this.snapshot;
  }

  getFocusToken(): number {
    return this.focusToken;
  }

  bumpFocusToken(): void {
    this.focusToken += 1;
    this.context.publishGroups("search");
  }

  buildPipelineSearchInput(): PipelineSearchInput {
    if (this.execution !== "indexed-ready") {
      return { query: this.committedQuery, execution: this.execution };
    }

    return {
      query: this.committedQuery,
      execution: this.execution,
      orderedPaths: this.orderedPaths ?? [],
    };
  }

  initializeSnapshotState(): void {
    this.clearSnapshotSubscription();
    this.applySnapshot(this.deps.getSearchSnapshot(), false);
    this.snapshotUnsubscribe = this.deps.subscribeSearchSnapshots((snapshot) => {
      this.applySnapshot(snapshot, true);
    });
  }

  onSearchSnapshot(snapshot: SearchServiceSnapshot): void {
    this.applySnapshot(snapshot, true);
  }

  private applySnapshot(snapshot: SearchServiceSnapshot | null, publish: boolean): void {
    this.snapshot = snapshot;
    this.snapshotEpoch.bump();
    this.requestEpoch.bump();
    this.committedQuery = this.query;
    this.clearMatchCounts();
    this.execution = this.derivePendingExecution();
    this.orderedPaths = undefined;
    this.status = this.deriveStatus();

    if (publish) {
      this.deps.publishSearchProjection();
    }

    if (this.query.trim().length > 0 && snapshot?.mode === "indexed" && snapshot.status === "ready") {
      void this.refreshProjection();
    }
  }

  private clearSnapshotSubscription(): void {
    this.snapshotUnsubscribe?.();
    this.snapshotUnsubscribe = null;
  }

  onQueryChange(detail: { query?: unknown }): void {
    const nextQuery = typeof detail.query === "string" ? detail.query : "";
    if (nextQuery === this.query) {
      return;
    }

    this.query = nextQuery;
    this.requestEpoch.bump();
    this.status = this.deriveStatus();
    if (!this.scopeSettled()) {
      this.context.publishGroups("search");
      return;
    }

    if (this.query.trim().length > 0) {
      if (this.isIndexReady()) {
        // Keep the last committed cards and highlights mounted while the next
        // ready-index query is inside the debounce window. Only the toolbar's
        // draft text changes now; the projection swaps atomically on success.
        this.context.publishGroups("search");
      } else {
        // A genuinely non-ready index must retain the indexed-only invariant:
        // non-empty queries block immediately rather than exposing browse data.
        this.commitPendingProjection();
        this.deps.publishSearchProjection();
      }
      this.scheduleDebouncedProjection();
      return;
    }

    this.clearDebounce();
    this.commitPendingProjection();
    this.deps.publishSearchProjection();
  }

  resetQuery(): void {
    this.clearDebounce();
    this.requestEpoch.bump();
    this.query = "";
    this.status = this.deriveStatus();
    if (!this.scopeSettled()) {
      this.context.publishGroups("search");
      return;
    }
    this.commitPendingProjection();
    this.deps.publishSearchProjection();
  }

  resetForLoad(): void {
    this.committedQuery = this.query;
    this.execution = this.derivePendingExecution();
    this.orderedPaths = undefined;
    this.clearMatchCounts();
    this.clearDebounce();
    this.requestEpoch.bump();
    this.status = this.deriveStatus();
  }

  /**
   * Re-runs the current query against the current base-card candidates.
   *
   * Empty queries return immediately. State updates stay behind the existing
   * request/load/snapshot/query stale guards: a request that went stale (a
   * newer query, load, or search snapshot won the race) is dropped and cannot
   * overwrite the winning request, which owns its normal publication. With
   * `publish: false` the intermediate `publishSearchProjection` calls are
   * suppressed — including the failure fallback — so the caller can await the
   * silent state update and publish one coherent batch afterwards.
   */
  async refreshProjection(options: SearchRefreshOptions = {}): Promise<void> {
    if (options.allowUnsettled !== true && !this.scopeSettled()) return;
    const publish = options.publish !== false;
    const query = this.query.trim();
    if (query.length === 0) {
      return;
    }

    const service = this.deps.getSearchService();
    if (!service) {
      this.fallBackToPendingExecution(publish);
      return;
    }

    const requestToken = this.requestEpoch.bump();
    const loadToken = this.context.epochs.load.token();
    const requestScope = this.context.store.getScope();
    const snapshotToken = this.snapshotEpoch.token();

    try {
      const result = await service.query({
        query,
        candidatePaths: this.context.store.getBaseCards().map((card) => card.path),
      });

      if (!this.isRequestCurrent(requestToken, loadToken, requestScope, snapshotToken, query)) {
        return;
      }

      this.execution = result.execution;
      this.committedQuery = this.query;
      if (result.execution === "indexed-ready") {
        this.orderedPaths = result.orderedPaths ?? [];
        this.matchCountsByPath = { ...result.matchCountsByPath };
      } else {
        this.orderedPaths = undefined;
        this.clearMatchCounts();
      }
      this.status = this.toRuntimeStatus(result);
      if (publish) {
        this.deps.publishSearchProjection();
      }
    } catch {
      if (!this.isRequestCurrent(requestToken, loadToken, requestScope, snapshotToken, query)) {
        return;
      }
      this.fallBackToPendingExecution(publish);
    }
  }

  private fallBackToPendingExecution(publish: boolean = true): void {
    this.commitPendingProjection();
    this.status = this.deriveStatus();
    if (publish) {
      this.deps.publishSearchProjection();
    }
  }

  private isRequestCurrent(
    requestToken: EpochToken,
    loadToken: EpochToken,
    requestScope: CardScope,
    snapshotToken: EpochToken,
    requestQuery: string,
  ): boolean {
    return (
      this.requestEpoch.isCurrent(requestToken)
      && this.context.epochs.load.isCurrent(loadToken)
      && scopesEqual(requestScope, this.context.store.getScope())
      && this.snapshotEpoch.isCurrent(snapshotToken)
      && requestQuery === this.query.trim()
    );
  }

  private deriveStatus(): SearchStatus {
    return this.deriveIndexedStatus(this.query.trim().length === 0);
  }

  private deriveIndexedStatus(emptyQuery: boolean): SearchStatus {
    const snapshot = this.snapshot;
    if (!snapshot || !snapshot.initialized || snapshot.disposed) {
      return emptyQuery ? "idle" : "unavailable";
    }
    if (snapshot.status === "error") {
      return "error";
    }
    if (snapshot.status === "building") {
      if (snapshot.health.outcome === "rebuild-required") {
        return this.isStorageUnavailable(snapshot) ? "storage-unavailable" : "rebuild-required";
      }
      return "building";
    }
    return "ready";
  }

  private toRuntimeStatus(result: SearchQueryResult): SearchStatus {
    switch (result.execution) {
      case "indexed-ready": return "ready";
      case "indexed-building": return "building";
      case "indexed-rebuild-required": return "rebuild-required";
      case "indexed-storage-unavailable": return "storage-unavailable";
      case "indexed-error": return "error";
      case "indexed-unavailable":
      default: return "unavailable";
    }
  }

  private derivePendingExecution(): SearchQueryExecutionState {
    const snapshot = this.snapshot;
    if (!snapshot || !snapshot.initialized || snapshot.disposed) {
      return "indexed-unavailable";
    }
    if (snapshot.status === "error") {
      return "indexed-error";
    }
    if (snapshot.status === "building") {
      if (snapshot.health.outcome === "rebuild-required") {
        return this.isStorageUnavailable(snapshot)
          ? "indexed-storage-unavailable"
          : "indexed-rebuild-required";
      }
      return "indexed-building";
    }
    return "indexed-unavailable";
  }

  private isIndexReady(): boolean {
    return this.snapshot?.initialized === true
      && !this.snapshot.disposed
      && this.snapshot.mode === "indexed"
      && this.snapshot.status === "ready";
  }

  private commitPendingProjection(): void {
    this.committedQuery = this.query;
    this.execution = this.derivePendingExecution();
    this.orderedPaths = undefined;
    this.clearMatchCounts();
  }

  private isStorageUnavailable(snapshot: SearchServiceSnapshot): boolean {
    return snapshot.health.persistence === "storage-unavailable"
      || snapshot.health.rebuildReason === "storage-unavailable";
  }

  clearMatchCounts(): void {
    this.matchCountsByPath = {};
  }

  clearDebounce(): boolean {
    if (this.debounceTimer === null) {
      return false;
    }
    this.context.getViewWindow().clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    return true;
  }

  private scheduleDebouncedProjection(): void {
    this.clearDebounce();
    this.debounceTimer = this.context.getViewWindow().setTimeout(() => {
      this.debounceTimer = null;
      void this.refreshProjection();
    }, SEARCH_DEBOUNCE_MS);
  }

  dispose(): DisposeReport {
    const cancelledDebounce = this.clearDebounce();
    this.clearSnapshotSubscription();
    this.snapshot = null;
    this.query = "";
    this.committedQuery = "";
    this.execution = "indexed-unavailable";
    this.orderedPaths = undefined;
    this.clearMatchCounts();
    this.status = "idle";
    this.requestEpoch.bump();
    this.snapshotEpoch.bump();
    return { cancelledDebounce };
  }
}
