import type {
  SearchQueryExecutionState,
  SearchQueryResult,
  SearchService,
  SearchServiceSnapshot,
} from "../../search";
import { AsyncEpoch, type EpochToken } from "../async-epoch";
import { isFolderScope, scopeDisplayPath, scopesEqual, type CardScope } from "../scope";
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
}

/** Owns one view's indexed-search runtime, including both stale-result guards. */
export class SearchController implements DisposableController {
  private query = "";
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

  getQuery(): string {
    return this.query;
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
      return { query: this.query, execution: this.execution };
    }

    return {
      query: this.query,
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
    this.execution = this.derivePendingExecution();
    this.orderedPaths = undefined;
    this.clearMatchCounts();
    this.requestEpoch.bump();
    this.status = this.deriveStatus();
    this.deps.publishSearchProjection();

    if (this.query.trim().length > 0) {
      this.scheduleDebouncedProjection();
      return;
    }

    this.clearDebounce();
  }

  resetQuery(): void {
    this.clearDebounce();
    this.requestEpoch.bump();
    this.clearMatchCounts();

    if (this.query.length === 0 && this.orderedPaths === undefined) {
      this.status = this.deriveStatus();
      this.deps.publishSearchProjection();
      return;
    }

    this.query = "";
    this.execution = this.derivePendingExecution();
    this.orderedPaths = undefined;
    this.status = this.deriveStatus();
    this.deps.publishSearchProjection();
  }

  resetForLoad(): void {
    this.execution = this.derivePendingExecution();
    this.orderedPaths = undefined;
    this.clearMatchCounts();
    this.clearDebounce();
    this.requestEpoch.bump();
    this.status = this.deriveStatus();
  }

  async refreshProjection(): Promise<void> {
    const query = this.query.trim();
    if (query.length === 0) {
      this.fallBackToPendingExecution();
      return;
    }

    const service = this.deps.getSearchService();
    if (!service) {
      this.fallBackToPendingExecution();
      return;
    }

    const requestToken = this.requestEpoch.bump();
    const loadToken = this.context.epochs.load.token();
    const requestScope = this.context.store.getScope();
    const snapshotToken = this.snapshotEpoch.token();

    try {
      const scope = this.context.store.getScope();
      const result = await service.query({
        query,
        scope: {
          folderPath: scopeDisplayPath(scope),
          includeSubfolders: isFolderScope(scope) ? scope.includeSubfolders : true,
        },
        candidatePaths: this.context.store.getBaseCards().map((card) => card.path),
      });

      if (!this.isRequestCurrent(requestToken, loadToken, requestScope, snapshotToken, query)) {
        return;
      }

      this.execution = result.execution;
      if (result.execution === "indexed-ready") {
        this.orderedPaths = result.orderedPaths ?? [];
        this.matchCountsByPath = { ...result.matchCountsByPath };
      } else {
        this.orderedPaths = undefined;
        this.clearMatchCounts();
      }
      this.status = this.toRuntimeStatus(result);
      this.deps.publishSearchProjection();
    } catch {
      if (!this.isRequestCurrent(requestToken, loadToken, requestScope, snapshotToken, query)) {
        return;
      }
      this.fallBackToPendingExecution();
    }
  }

  private fallBackToPendingExecution(): void {
    this.execution = this.derivePendingExecution();
    this.orderedPaths = undefined;
    this.clearMatchCounts();
    this.status = this.deriveStatus();
    this.deps.publishSearchProjection();
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
    this.execution = "indexed-unavailable";
    this.orderedPaths = undefined;
    this.clearMatchCounts();
    this.status = "idle";
    this.requestEpoch.bump();
    this.snapshotEpoch.bump();
    return { cancelledDebounce };
  }
}
