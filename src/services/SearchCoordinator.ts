import { Notice, TFile, type App } from "obsidian";

import type { UiStrings } from "../i18n";
import {
  IndexBuildGuard,
  IndexedSearchService,
  IndexStore,
  SearchIndexManager,
  scheduleIdleTask,
} from "../search";
import type {
  IndexStoreNamespaceMetadata,
  SearchIndexObservabilitySnapshot,
  SearchService,
  SearchServiceSnapshot,
  SearchVaultMutation,
} from "../search";
import { isMarkdownCardKind, resolveCardFileKindFromPath } from "../view/file-kind";
import type { VaultMutationEvent } from "../view/types";
import type { VaultEventBus } from "./VaultEventBus";
import {
  prepareSearchDocument,
  resolveSearchVaultNamespace,
  SearchDocumentSource,
} from "./SearchDocumentSource";

/** v2 persists the MiniSearch snapshot as a structured-clone object, not a JSON string. */
const SEARCH_SCHEMA_VERSION = "phase3-v2";
export const SEARCH_TOKENIZER_VERSION = "search-text-v3-han-bigram";
const SEARCH_MAX_CANDIDATE_PATHS = 10000;
/**
 * Full-source scans are deferred past startup: cards and navigation do not
 * depend on the index, so nothing user-visible should wait on it.
 */
const STARTUP_INDEX_WORK_IDLE_TIMEOUT_MS = 10_000;

type SearchRecoveryBoundaryState = "healthy" | "degraded";

export type SearchSnapshotListener = (snapshot: SearchServiceSnapshot) => void;

export interface SearchCoordinatorDeps {
  getApp: () => App;
  getUiStrings: () => UiStrings;
  getPluginVersion: () => string;
}

/**
 * Owns the indexed search lifecycle: construction, restore/rebuild/recovery state
 * machine, snapshot fan-out, and the startup work deferred until layout is ready.
 */
export class SearchCoordinator {
  private readonly getApp: () => App;
  private readonly getUiStrings: () => UiStrings;
  private readonly getPluginVersion: () => string;

  private searchService: SearchService | null = null;
  private searchManager: SearchIndexManager | null = null;
  private buildGuard: IndexBuildGuard | null = null;
  private cancelStartupIdleTask: (() => void) | null = null;
  private searchServiceUnsubscribe: (() => void) | null = null;
  private vaultEventUnsubscribe: (() => void) | null = null;
  private searchSnapshot: SearchServiceSnapshot | null = null;
  private readonly searchSnapshotListeners = new Set<SearchSnapshotListener>();
  private searchRecoveryBoundaryState: SearchRecoveryBoundaryState = "healthy";
  private layoutReady = false;
  private shouldRunStartupSearchRebuild = false;
  private pendingStartupSearchRebuildDetail: string | null = null;
  private shouldSyncRestoredSearchState = false;
  private pendingRestoredSearchStateSync: Promise<void> | null = null;
  private pendingSearchRebuild: Promise<void> | null = null;
  private pendingSearchRecovery: Promise<void> | null = null;
  private pendingSearchClearReset: Promise<void> | null = null;
  private pendingMutationRecoveryRebuild: Promise<void> | null = null;
  private readonly bufferedMutations: VaultMutationEvent[] = [];
  private mutationForwardingReady = false;
  private pendingInitialization: Promise<void> | null = null;
  private disposed = false;

  constructor(deps: SearchCoordinatorDeps) {
    this.getApp = deps.getApp;
    this.getUiStrings = deps.getUiStrings;
    this.getPluginVersion = deps.getPluginVersion;
  }

  private get app(): App {
    return this.getApp();
  }

  async initialize(): Promise<void> {
    if (this.disposed) return;
    if (this.pendingInitialization) return this.pendingInitialization;
    if (this.searchService && this.mutationForwardingReady) return;
    const run = this.initializeRuntime();
    const completion = run.finally(() => {
      if (this.pendingInitialization === completion) this.pendingInitialization = null;
    });
    this.pendingInitialization = completion;
    return completion;
  }

  private async initializeRuntime(): Promise<void> {
    this.resetSearchRuntime();

    const indexed = this.createIndexedSearchService();
    this.searchManager = indexed.manager;
    this.buildGuard = new IndexBuildGuard(indexed.store);
    this.bindSearchService(indexed.service);

    try {
      await indexed.service.initialize();
      if (this.disposed || this.searchManager !== indexed.manager) return;
      const restoreResult = await indexed.manager.restore(this.createSearchMetadata(indexed.store.vaultNamespace));
      if (this.disposed || this.searchManager !== indexed.manager) return;
      this.mutationForwardingReady = true;
      this.replayBufferedMutations();
      if (restoreResult.outcome === "rebuild-required") {
        if (!this.shouldRunStartupSearchRebuild) {
          this.queueStartupSearchRebuild("Startup restore required full search rebuild.");
        }
      } else {
        this.scheduleRestoredSearchStateSync();
      }
    } catch (error) {
      if (this.disposed || this.searchManager !== indexed.manager) return;
      console.warn("[Card Workspace] Indexed search initialization failed.", error);
      indexed.manager.markInitializationFailure(error);
      this.shouldRunStartupSearchRebuild = false;
      this.pendingStartupSearchRebuildDetail = null;
      this.shouldSyncRestoredSearchState = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelStartupIdleTask?.();
    this.cancelStartupIdleTask = null;
    this.vaultEventUnsubscribe?.();
    this.vaultEventUnsubscribe = null;
    this.bufferedMutations.splice(0);
    this.searchSnapshotListeners.clear();
    this.resetSearchRuntime();
  }

  private resetSearchRuntime(): void {
    this.mutationForwardingReady = false;
    this.searchServiceUnsubscribe?.();
    this.searchServiceUnsubscribe = null;
    if (!this.searchService) {
      this.searchManager = null;
      this.buildGuard = null;
      this.searchSnapshot = null;
      return;
    }
    this.searchService.dispose();
    this.searchService = null;
    this.searchManager = null;
    this.buildGuard = null;
    this.searchSnapshot = null;
    this.pendingSearchClearReset = null;
    this.pendingSearchRebuild = null;
    this.pendingSearchRecovery = null;
    this.pendingRestoredSearchStateSync = null;
  }

  getService(): SearchService | null {
    return this.searchService;
  }

  getSnapshot(): SearchServiceSnapshot | null {
    return this.searchSnapshot ? this.cloneSearchSnapshot(this.searchSnapshot) : null;
  }

  getObservabilitySnapshot(): SearchIndexObservabilitySnapshot | null {
    if (!this.searchSnapshot) {
      return null;
    }
    const snapshot = this.cloneSearchSnapshot(this.searchSnapshot);
    return {
      status: snapshot.status,
      queriesAllowed: this.areSearchQueriesAllowed(snapshot),
      health: snapshot.health,
    };
  }

  subscribe(listener: SearchSnapshotListener): () => void {
    if (this.disposed) return () => undefined;
    this.searchSnapshotListeners.add(listener);
    if (this.searchSnapshot) {
      listener(this.cloneSearchSnapshot(this.searchSnapshot));
    }
    return () => {
      this.searchSnapshotListeners.delete(listener);
    };
  }

  applyVaultMutation(event: VaultMutationEvent): void {
    if (this.disposed) return;
    if (!this.mutationForwardingReady || !this.searchService) {
      this.bufferedMutations.push({ ...event });
      return;
    }
    this.searchService.handleVaultMutation(this.toSearchVaultMutation(event));
  }

  subscribeTo(bus: VaultEventBus): void {
    if (this.disposed) return;
    this.vaultEventUnsubscribe?.();
    this.vaultEventUnsubscribe = bus.subscribe((event) => {
      try {
        this.applyVaultMutation(event);
      } catch (error) {
        console.warn("[Card Workspace] Search service mutation forwarding failed.", error);
      }
    });
  }

  showStatus(): void {
    if (this.disposed) return;
    const snapshot = this.getObservabilitySnapshot();
    if (!snapshot) {
      new Notice(this.getUiStrings().app.searchIndexUnavailableNotice);
      return;
    }

    new Notice(this.formatSearchIndexStatus(snapshot));
  }

  async rebuild(detail: string, options: { resetGuard?: boolean } = {}): Promise<void> {
    if (this.disposed) return;
    if (this.pendingSearchRebuild) {
      return this.pendingSearchRebuild;
    }

    if (!this.searchManager) {
      this.queueStartupSearchRebuild(detail);
      await this.recover(detail);
      return;
    }

    if (!this.layoutReady) {
      this.queueStartupSearchRebuild(detail);
      return;
    }

    const manager = this.searchManager;
    this.pendingSearchRebuild = this.runGuardedRebuild(manager, detail, options).finally(() => {
      if (this.searchManager === manager) {
        this.pendingSearchRebuild = null;
      }
    });
    await this.pendingSearchRebuild;
  }

  /**
   * Brackets the build with a persisted attempt marker. Only a build that
   * reaches a ready snapshot clears it, so a run that takes the renderer down
   * with it stays counted and the next launch can refuse to repeat it.
   */
  private async runGuardedRebuild(
    manager: SearchIndexManager,
    detail: string,
    options: { resetGuard?: boolean },
  ): Promise<void> {
    const guard = this.buildGuard;
    if (options.resetGuard) await guard?.reset();
    await guard?.markBuildStarted();
    await manager.rebuildFromSource(detail);
    if (this.disposed || this.searchManager !== manager) return;
    if (this.searchSnapshot?.status === "ready") {
      await guard?.markBuildCompleted();
    }
  }

  /**
   * Entry point for the rebuild command: clears any suspension before building.
   * Stays synchronous up to `rebuild` so the in-flight guard there still holds.
   */
  rebuildManually(detail: string): Promise<void> {
    return this.rebuild(detail, { resetGuard: true });
  }

  async recover(rebuildDetail = "Recovery command requested full search rebuild."): Promise<void> {
    if (this.disposed) return;
    if (this.pendingSearchRecovery) {
      return this.pendingSearchRecovery;
    }

    this.pendingSearchRecovery = this.runRecoverSearchIndex(rebuildDetail).finally(() => {
      this.pendingSearchRecovery = null;
    });
    return this.pendingSearchRecovery;
  }

  async clearAndReset(): Promise<void> {
    if (this.disposed) return;
    if (this.pendingSearchClearReset) {
      return this.pendingSearchClearReset;
    }

    this.pendingSearchClearReset = this.runClearAndResetSearchIndex().finally(() => {
      this.pendingSearchClearReset = null;
    });
    return this.pendingSearchClearReset;
  }

  /**
   * Called once the workspace layout is ready. The work queued here reads every
   * file in the vault, so it waits for an idle window instead of competing with
   * the first paint of the card stream.
   */
  flushDeferredStartupWork(): void {
    if (this.disposed) return;
    this.layoutReady = true;
    if (!this.shouldRunStartupSearchRebuild && !this.shouldSyncRestoredSearchState) return;

    this.cancelStartupIdleTask?.();
    this.cancelStartupIdleTask = scheduleIdleTask(() => {
      this.cancelStartupIdleTask = null;
      if (this.disposed) return;
      void this.runDeferredStartupWork();
    }, STARTUP_INDEX_WORK_IDLE_TIMEOUT_MS);
  }

  private async runDeferredStartupWork(): Promise<void> {
    if (this.shouldRunStartupSearchRebuild) {
      const detail = this.consumeStartupSearchRebuildDetail("Startup restore required full search rebuild.");
      try {
        await this.runStartupRebuildIfPermitted(detail);
      } catch (error) {
        if (!this.disposed) console.warn("[Card Workspace] Startup search rebuild failed.", error);
      }
    }

    if (this.disposed) return;
    if (this.shouldSyncRestoredSearchState) {
      this.shouldSyncRestoredSearchState = false;
      await this.syncRestoredSearchState();
    }
  }

  /** Unattended rebuilds yield to the guard; an explicit user command never does. */
  private async runStartupRebuildIfPermitted(detail: string): Promise<void> {
    const guard = this.buildGuard;
    if (guard && !(await guard.canAutoBuild())) {
      if (this.disposed) return;
      new Notice(this.getUiStrings().app.searchIndexAutoBuildSuspended);
      return;
    }
    if (this.disposed) return;
    await this.rebuild(detail);
  }

  private toSearchVaultMutation(event: VaultMutationEvent): SearchVaultMutation {
    const nextPathIsMarkdown = event.fileKind !== null && isMarkdownCardKind(event.fileKind);
    const oldPathWasMarkdown =
      event.eventType === "rename" &&
      event.oldPath !== null &&
      resolveCardFileKindFromPath(event.oldPath) === "markdown";

    return {
      type: event.eventType,
      path: event.path,
      oldPath: event.oldPath,
      isMarkdown: nextPathIsMarkdown || oldPathWasMarkdown,
      isFolder: event.isFolder,
    };
  }

  private createIndexedSearchService(): {
    manager: SearchIndexManager;
    service: IndexedSearchService;
    store: IndexStore;
  } {
    const vaultNamespace = resolveSearchVaultNamespace(this.app);
    const store = new IndexStore({
      vaultNamespace,
    });
    const documentSource = new SearchDocumentSource(
      this.app,
      (file) => this.prepareSearchableDocumentFromFile(file),
    );
    const manager = new SearchIndexManager({
      store,
      documentSource,
    });

    const service = new IndexedSearchService(manager, {
      maxCandidatePaths: SEARCH_MAX_CANDIDATE_PATHS,
    });

    return {
      manager,
      service,
      store,
    };
  }

  private async prepareSearchableDocumentFromFile(file: TFile) {
    return prepareSearchDocument(this.app, file);
  }

  private createSearchMetadata(vaultNamespace: string): IndexStoreNamespaceMetadata {
    return {
      vaultNamespace,
      schemaVersion: SEARCH_SCHEMA_VERSION,
      tokenizerVersion: SEARCH_TOKENIZER_VERSION,
      pluginVersion: this.getPluginVersion(),
      documentCount: 0,
      lastIndexedAt: 0,
    };
  }

  private bindSearchService(service: SearchService): void {
    this.searchServiceUnsubscribe?.();
    this.searchServiceUnsubscribe = null;
    this.searchService = service;
    this.searchServiceUnsubscribe = service.subscribe((snapshot) => {
      this.handleSearchSnapshot(snapshot);
    });
  }

  private handleSearchSnapshot(snapshot: SearchServiceSnapshot): void {
    if (this.disposed) return;
    const nextSnapshot = this.cloneSearchSnapshot(snapshot);
    this.searchSnapshot = nextSnapshot;
    for (const listener of this.searchSnapshotListeners) {
      listener(this.cloneSearchSnapshot(nextSnapshot));
    }
    if (this.shouldRunMutationRecoveryRebuild(nextSnapshot)) {
      this.scheduleMutationRecoveryRebuild();
    }
    this.emitRecoveryBoundaryNotice(nextSnapshot);
  }

  private emitRecoveryBoundaryNotice(snapshot: SearchServiceSnapshot): void {
    const isDegraded =
      snapshot.status === "error" ||
      snapshot.health.outcome === "rebuild-required" ||
      snapshot.health.outcome === "failed";
    if (isDegraded) {
      if (this.searchRecoveryBoundaryState === "degraded") {
        return;
      }
      this.searchRecoveryBoundaryState = "degraded";
      new Notice(this.getUiStrings().app.searchIndexRequiresRecovery);
      return;
    }
    if (this.searchRecoveryBoundaryState === "degraded" && snapshot.status === "ready") {
      this.searchRecoveryBoundaryState = "healthy";
      new Notice(this.getUiStrings().app.searchIndexReady);
      return;
    }
    this.searchRecoveryBoundaryState = "healthy";
  }

  private cloneSearchSnapshot(snapshot: SearchServiceSnapshot): SearchServiceSnapshot {
    const cloneSuccess = (entry: SearchServiceSnapshot["health"]["lastSuccessfulRestore"]) =>
      entry ? { ...entry } : null;
    return {
      ...snapshot,
      health: {
        ...snapshot.health,
        lastSuccessfulRestore: cloneSuccess(snapshot.health.lastSuccessfulRestore),
        lastSuccessfulBuild: cloneSuccess(snapshot.health.lastSuccessfulBuild),
      },
    };
  }

  private areSearchQueriesAllowed(snapshot: SearchServiceSnapshot): boolean {
    return (
      snapshot.initialized &&
      !snapshot.disposed &&
      snapshot.mode === "indexed" &&
      snapshot.status === "ready" &&
      snapshot.health.readiness === "ready" &&
      snapshot.health.healthy &&
      !snapshot.health.rebuildRequired
    );
  }

  private formatSearchIndexStatus(snapshot: SearchIndexObservabilitySnapshot): string {
    const strings = this.getUiStrings().app;
    const { health } = snapshot;
    return [
      strings.searchIndexLifecycleTitle,
      `${strings.searchIndexStatusLabel}: ${snapshot.status}`,
      `${strings.searchIndexQueryAvailabilityLabel}: ${snapshot.queriesAllowed ? strings.searchIndexAvailable : strings.searchIndexBlocked}`,
      `${strings.searchIndexReadinessLabel}: ${health.readiness}`,
      `${strings.searchIndexPersistenceLabel}: ${health.persistence}`,
      `${strings.searchIndexDocumentsLabel}: ${health.documentCount === null ? strings.searchIndexUnknown : String(health.documentCount)}`,
      `${strings.searchIndexLastOutcomeLabel}: ${health.outcome}`,
      `${strings.searchIndexLastRestoreLabel}: ${this.formatSearchIndexSuccess(health.lastSuccessfulRestore)}`,
      `${strings.searchIndexLastBuildLabel}: ${this.formatSearchIndexSuccess(health.lastSuccessfulBuild)}`,
      `${strings.searchIndexRebuildReasonLabel}: ${health.rebuildReason ?? strings.searchIndexNone}`,
      `${strings.searchIndexLastErrorLabel}: ${health.lastError ?? strings.searchIndexNone}`,
    ].join("\n");
  }

  private formatSearchIndexSuccess(
    snapshot: SearchIndexObservabilitySnapshot["health"]["lastSuccessfulRestore"],
  ): string {
    return snapshot
      ? `${snapshot.outcome} at ${snapshot.at} (${snapshot.documentCount} docs)`
      : this.getUiStrings().app.searchIndexNone;
  }

  private shouldRunMutationRecoveryRebuild(snapshot: SearchServiceSnapshot): boolean {
    return (
      this.searchManager !== null &&
      snapshot.mode === "indexed" &&
      snapshot.status === "building" &&
      snapshot.health.outcome === "rebuild-required" &&
      snapshot.health.rebuildReason === "folder-rebuild-required"
    );
  }

  private scheduleMutationRecoveryRebuild(): void {
    if (this.pendingMutationRecoveryRebuild) {
      return;
    }
    this.pendingMutationRecoveryRebuild = this.rebuild(
      "Unsafe vault mutation requires full search rebuild.",
    )
      .catch((error) => {
        console.warn("[Card Workspace] Search rebuild scheduling failed.", error);
      })
      .finally(() => {
        this.pendingMutationRecoveryRebuild = null;
      });
  }

  private async runClearAndResetSearchIndex(): Promise<void> {
    if (this.disposed) return;
    // Let an in-flight rebuild finish first. Clearing underneath it would make
    // the post-clear rebuild coalesce into the older run and leave the index empty.
    if (this.pendingSearchRebuild) {
      await this.pendingSearchRebuild;
      if (this.disposed) return;
    }
    if (!this.searchManager) {
      await this.initialize();
    }

    if (!this.searchManager) {
      new Notice(this.getUiStrings().app.searchIndexUnavailable);
      return;
    }

    const clearResult = await this.searchManager.clearAndReset(
      "Manual clear/reset command requested local search index reset.",
    );
    if (this.disposed) return;
    if (clearResult.outcome === "failed") {
      new Notice(this.getUiStrings().app.searchIndexResetFailed);
      return;
    }

    new Notice(this.getUiStrings().app.searchIndexClearedAndRebuilding);
    await this.rebuild(
      "Manual clear/reset command requested full local search index rebuild.",
      { resetGuard: true },
    );
  }

  private async runRecoverSearchIndex(rebuildDetail: string): Promise<void> {
    if (this.disposed) return;
    if (!this.searchManager) {
      await this.initialize();
      if (!this.searchManager) {
        new Notice(this.getUiStrings().app.searchIndexUnavailable);
        return;
      }

      if (this.shouldRunStartupSearchRebuild) {
        await this.rebuild(this.consumeStartupSearchRebuildDetail(rebuildDetail), { resetGuard: true });
        return;
      }

      this.scheduleRestoredSearchStateSync();
      return;
    }

    if (!this.layoutReady && this.shouldRunStartupSearchRebuild) {
      return;
    }

    const result = await this.searchManager.restore(
      this.createSearchMetadata(resolveSearchVaultNamespace(this.app)),
    );
    if (this.disposed) return;
    if (result.outcome === "rebuild-required") {
      await this.rebuild(rebuildDetail, { resetGuard: true });
      return;
    }

    this.scheduleRestoredSearchStateSync();
  }

  private queueStartupSearchRebuild(detail: string): void {
    this.shouldRunStartupSearchRebuild = true;
    this.pendingStartupSearchRebuildDetail = detail;
  }

  private consumeStartupSearchRebuildDetail(defaultDetail: string): string {
    const detail = this.pendingStartupSearchRebuildDetail ?? defaultDetail;
    this.shouldRunStartupSearchRebuild = false;
    this.pendingStartupSearchRebuildDetail = null;
    return detail;
  }

  private scheduleRestoredSearchStateSync(): void {
    if (!this.searchManager) {
      return;
    }
    if (!this.layoutReady) {
      this.shouldSyncRestoredSearchState = true;
      return;
    }
    void this.syncRestoredSearchState();
  }

  private async syncRestoredSearchState(): Promise<void> {
    if (this.pendingRestoredSearchStateSync) {
      return this.pendingRestoredSearchStateSync;
    }

    if (!this.searchManager) {
      return;
    }

    const manager = this.searchManager;
    this.pendingRestoredSearchStateSync = manager.syncDocumentStateFromSource()
      .catch((error) => {
        if (this.disposed) return;
        console.warn("[Card Workspace] Restored search state sync failed.", error);
      })
      .finally(() => {
        if (this.searchManager === manager) {
          this.pendingRestoredSearchStateSync = null;
        }
      });
    await this.pendingRestoredSearchStateSync;
  }

  private replayBufferedMutations(): void {
    if (this.disposed || !this.searchService) return;
    const events = this.bufferedMutations.splice(0);
    for (const event of events) {
      if (this.disposed || !this.searchService) return;
      this.searchService.handleVaultMutation(this.toSearchVaultMutation(event));
    }
  }
}
