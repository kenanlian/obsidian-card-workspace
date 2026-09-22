import MiniSearch, { type AsPlainObject } from "minisearch";
import { scheduleIdleTask } from "./idle-task";
import type {
  IndexStoreClearResult,
  IndexStore,
  IndexStoreDocumentCatalog,
  IndexStoreNamespaceMetadata,
  IndexStoreWriteFailureResult,
} from "./IndexStore";
import { SearchDocumentCatalog } from "./document-catalog";
import { classifySearchMutation } from "./document-preparation";
import { buildMatchCountsByPath } from "./match-counts";
import { createMiniSearchOptions, MINISEARCH_SEARCH_OPTIONS } from "./minisearch-options";
import {
  applyMutationToWorkingSet,
  isUnmergeableMutation,
  type IndexWorkingSet,
  type MutationApplicationHost,
} from "./mutation-application";
import { toRebuildDetail, toRestorePersistence, toRestoreRebuildReason } from "./restore-mapping";
import {
  createSearchSuccessSnapshot,
  hasPathPrefix,
  rewriteFolderPath,
  rewritePathPrefix,
  searchErrorMessage,
  SearchMutationGate,
  SearchReconciliationRunner,
} from "./SearchReconciliationRunner";
import {
  type SearchIndexHealthSnapshot,
  type SearchServiceSnapshot,
  type SearchVaultMutation,
  type SearchableDocument,
} from "./types";

export interface SearchIndexManagerRestoreResult {
  status: "ready" | "building";
  outcome: "restored" | "rebuild-required";
  detail: string | null;
}

export interface SearchIndexManagerMutationResult {
  action: "ignored" | "applied" | "rebuild-required";
  rebuildRequired: boolean;
}

export interface SearchIndexManagerSearchResult {
  orderedPaths: string[];
  matchCountsByPath?: Record<string, number>;
}

export interface SearchIndexDocumentSource {
  streamDocuments(signal?: AbortSignal): AsyncGenerator<SearchableDocument[]>;
  readAllDocuments(signal?: AbortSignal): Promise<SearchableDocument[]>;
  readDocument(path: string): Promise<SearchableDocument | null>;
  readCatalogSnapshot(): IndexStoreDocumentCatalog;
}

interface SearchIndexManagerOptions {
  store: Pick<IndexStore, "restore" | "write" | "clear" | "isAvailable">;
  documentSource: SearchIndexDocumentSource;
}

type SearchIndexMiniSearchResult = {
  path?: string;
  score?: number;
};

interface MiniSearchStoredFields {
  path?: string;
}

interface MiniSearchInternalState {
  _storedFields: Map<number, MiniSearchStoredFields>;
  _documentIds: Map<number, string>;
  _idToShortId: Map<string, number>;
}

const INITIAL_SNAPSHOT: SearchServiceSnapshot = {
  initialized: true,
  disposed: false,
  mode: "indexed",
  status: "building",
  lastError: null,
  contentRevision: 0,
  health: {
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
  },
};

export class SearchIndexManager {
  /**
   * Incremental mutations keep the in-memory index current immediately, but the
   * full-index serialization is coalesced: deleting a folder fans out one event
   * per contained file, and serializing on each one blocks the main thread.
   * A whole-vault snapshot is expensive enough that an editing session should
   * pay for it once, not once per save, so the window is deliberately long and
   * the write itself waits for an idle callback.
   */
  private static readonly MUTATION_PERSIST_DEBOUNCE_MS = 30_000;
  private static readonly MUTATION_PERSIST_IDLE_TIMEOUT_MS = 5_000;
  /**
   * MiniSearch's own auto-vacuum is driven by `dirtFactor`, which on a large
   * vault effectively never reaches its 0.1 default: at ~27 800 documents that
   * would take roughly 3 090 discards. Since the reconcile fast path no longer
   * rebuilds the index each session, discarded terms would otherwise survive
   * every restart, so an explicit count gate is what actually collects them.
   */
  private static readonly VACUUM_MIN_DIRT_COUNT = 1000;
  private persistTimer: number | null = null;
  private cancelPersistIdleTask: (() => void) | null = null;
  private persistScheduled = false;
  private persistInFlight: Promise<void> | null = null;
  private readonly store: Pick<IndexStore, "restore" | "write" | "clear" | "isAvailable">;
  private readonly documentSource: SearchIndexDocumentSource;
  private index: MiniSearch<SearchableDocument>;
  private snapshot: SearchServiceSnapshot = {
    ...INITIAL_SNAPSHOT,
    health: { ...INITIAL_SNAPSHOT.health },
  };
  /** Monotonic in-memory content revision; surfaced through `getSnapshot()`. */
  private contentRevision = 0;
  private readonly listeners = new Set<(snapshot: SearchServiceSnapshot) => void>();
  private readonly documentsByPath = new Map<string, SearchableDocument>();
  private documentCatalog = new SearchDocumentCatalog();
  /** Whether `documentCatalog` describes the currently persisted index. */
  private catalogAvailable = false;
  private expectedMetadata: IndexStoreNamespaceMetadata | null = null;
  private readonly sourceRunner = new SearchReconciliationRunner();
  private readonly mutationGate = new SearchMutationGate();
  private mutationJournal: SearchVaultMutation[] | null = null;
  private sourceWorkPending = 0;
  private sourceWorkPromise: Promise<void> | null = null;
  private queuedRebuildDetail: string | null = null;
  private disposed = false;
  private generation = 0;
  private readonly mutationHost: MutationApplicationHost = {
    discardIndexedPath: (path, set) => this.discardIndexedPath(path, set),
    upsertDocument: (path, set) => this.upsertDocument(path, set),
    rewriteFolderPrefix: (oldPrefix, newPrefix, set) => this.rewriteFolderPrefix(oldPrefix, newPrefix, set),
    markFolderRebuildRequired: (detail) => this.markFolderRebuildRequired(detail),
  };

  constructor(options: SearchIndexManagerOptions) {
    this.store = options.store;
    this.documentSource = options.documentSource;
    this.index = this.createEmptyIndex();
  }

  async initialize(): Promise<void> {
    return Promise.resolve();
  }

  markInitializationFailure(error: unknown): void {
    if (this.disposed) return;
    const detail = searchErrorMessage(error, "Indexed search initialization failed.");
    this.snapshot = {
      ...this.snapshot,
      initialized: true,
      disposed: false,
      status: "error",
      lastError: detail,
      health: {
        ...this.snapshot.health,
        outcome: "failed",
        readiness: "error",
        healthy: false,
        rebuilding: false,
        rebuildRequired: false,
        persistence: "unknown",
        documentCount: null,
        lastIndexedAt: null,
        rebuildReason: null,
        lastError: detail,
        detail,
      },
    };
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.sourceRunner.dispose();
    this.cancelPendingPersist();
    this.mutationJournal = null;

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
    return {
      ...this.snapshot,
      contentRevision: this.contentRevision,
      health: {
        ...this.snapshot.health,
      },
    };
  }

  /**
   * Notifies subscribers that the in-memory index content changed. Called once
   * after every successfully applied mutation (even when the document count is
   * unchanged) so consumers can invalidate stale query results.
   */
  private bumpContentRevision(): void {
    this.contentRevision += 1;
    this.emit();
  }

  subscribe(listener: (snapshot: SearchServiceSnapshot) => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async restore(expectedMetadata: IndexStoreNamespaceMetadata): Promise<SearchIndexManagerRestoreResult> {
    if (this.disposed) return { status: "building", outcome: "rebuild-required", detail: null };
    const generation = this.generation;
    this.expectedMetadata = expectedMetadata;
    this.setBuilding("Restoring persisted search index...", "restoring");

    const restoreResult = await this.store.restore(expectedMetadata);
    if (!this.isCurrent(generation)) {
      return { status: "building", outcome: "rebuild-required", detail: null };
    }
    if (restoreResult.outcome !== "restored") {
      const detail = toRebuildDetail(restoreResult);
      const persistence = toRestorePersistence(restoreResult.reason);
      const rebuildReason = toRestoreRebuildReason(restoreResult.reason);
      this.snapshot = {
        ...this.snapshot,
        status: "building",
        lastError: null,
        health: {
          ...this.snapshot.health,
          outcome: "rebuild-required",
          readiness: "rebuild-required",
          healthy: false,
          rebuilding: true,
          rebuildRequired: true,
          persistence,
          documentCount: null,
          lastIndexedAt: null,
          rebuildReason,
          lastError: null,
          detail,
        },
      };
      this.emit();
      return {
        status: "building",
        outcome: "rebuild-required",
        detail,
      };
    }

    try {
      const restoredIndex = await MiniSearch.loadJSAsync<SearchableDocument>(
        restoreResult.payload.serializedIndex as unknown as AsPlainObject,
        createMiniSearchOptions(),
      );
      if (!this.isCurrent(generation)) {
        return { status: "building", outcome: "rebuild-required", detail: null };
      }
      this.index = restoredIndex;
      const restoredCatalog = restoreResult.payload.documentCatalog;
      if (restoredCatalog) {
        this.documentCatalog.loadFrom(restoredCatalog);
        this.catalogAvailable = true;
      } else {
        this.documentCatalog.clear();
        this.catalogAvailable = false;
      }
      const success = createSearchSuccessSnapshot(
        "restored",
        restoreResult.payload.documentCount,
        restoreResult.payload.lastIndexedAt,
        "Search index restored from persistent storage.",
      );
      this.snapshot = {
        ...this.snapshot,
        status: "ready",
        lastError: null,
        health: {
          ...this.snapshot.health,
          outcome: "restored",
          readiness: "ready",
          healthy: true,
          rebuilding: false,
          rebuildRequired: false,
          persistence: "healthy",
          documentCount: restoreResult.payload.documentCount,
          lastIndexedAt: restoreResult.payload.lastIndexedAt,
          rebuildReason: null,
          lastError: null,
          lastSuccessfulRestore: success,
          detail: "Search index restored from persistent storage.",
        },
      };
      this.emit();
      return {
        status: "ready",
        outcome: "restored",
        detail: "Search index restored from persistent storage.",
      };
    } catch (error) {
      if (!this.isCurrent(generation)) return { status: "building", outcome: "rebuild-required", detail: null };
      await this.store.clear();
      if (!this.isCurrent(generation)) {
        return { status: "building", outcome: "rebuild-required", detail: null };
      }
      const detail = searchErrorMessage(error, "Persisted index could not be restored; full rebuild required.");
      this.snapshot = {
        ...this.snapshot,
        status: "building",
        lastError: detail,
        health: {
          ...this.snapshot.health,
          outcome: "rebuild-required",
          readiness: "rebuild-required",
          healthy: false,
          rebuilding: true,
          rebuildRequired: true,
          persistence: "read-failed",
          documentCount: null,
          lastIndexedAt: null,
          rebuildReason: "load-failed",
          lastError: detail,
          detail,
        },
      };
      this.emit();
      return {
        status: "building",
        outcome: "rebuild-required",
        detail,
      };
    }
  }

  async syncDocumentStateFromSource(): Promise<void> {
    await this.runReplacement("reconcile", "Search index reconciled with vault source.");
  }

  async rebuildFromSource(detail = "Manual rebuild requested."): Promise<void> {
    await this.runReplacement("rebuild", detail);
  }

  async clearAndReset(detail = "Manual clear/reset requested."): Promise<IndexStoreClearResult> {
    const clearResult = await this.store.clear();
    if (clearResult.outcome === "failed") {
      const failureDetail = clearResult.detail ?? "Persisted search index could not be cleared.";
      this.snapshot = {
        ...this.snapshot,
        status: "error",
        lastError: failureDetail,
        health: {
          ...this.snapshot.health,
          outcome: "failed",
          readiness: "error",
          healthy: false,
          rebuilding: false,
          rebuildRequired: false,
          persistence: clearResult.reason === "unavailable" ? "storage-unavailable" : "write-failed",
          documentCount: null,
          lastIndexedAt: null,
          rebuildReason: clearResult.reason === "unavailable" ? "storage-unavailable" : null,
          lastError: failureDetail,
          detail: failureDetail,
        },
      };
      this.emit();
      return clearResult;
    }

    this.index = this.createEmptyIndex();
    this.documentsByPath.clear();
    this.documentCatalog.clear();
    this.catalogAvailable = false;
    this.mutationJournal = null;
    this.snapshot = {
      ...this.snapshot,
      status: "building",
      lastError: null,
      health: {
        ...this.snapshot.health,
        outcome: "rebuild-required",
        readiness: "rebuild-required",
        healthy: false,
        rebuilding: true,
        rebuildRequired: true,
        persistence: "healthy",
        documentCount: null,
        lastIndexedAt: null,
        rebuildReason: "missing",
        lastError: null,
        detail,
      },
    };
    this.emit();
    return clearResult;
  }

  async search(query: string, candidatePaths: string[]): Promise<SearchIndexManagerSearchResult> {
    if (this.snapshot.status !== "ready") {
      return {
        orderedPaths: [],
      };
    }

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return {
        orderedPaths: [...candidatePaths],
      };
    }

    const allowed = new Set(candidatePaths);
    const results = this.index.search(trimmed, MINISEARCH_SEARCH_OPTIONS) as SearchIndexMiniSearchResult[];
    const ordered: string[] = [];
    for (const result of results) {
      if (typeof result.path !== "string") {
        continue;
      }
      if (!allowed.has(result.path)) {
        continue;
      }
      ordered.push(result.path);
    }

    return {
      orderedPaths: ordered,
      matchCountsByPath: buildMatchCountsByPath(trimmed, ordered, this.documentsByPath),
    };
  }

  async markRebuilt(documentCount: number, lastIndexedAt: number): Promise<void> {
    if (!this.expectedMetadata) {
      return;
    }

    const persistSucceeded = await this.persistCurrentIndex(documentCount, lastIndexedAt);
    if (!persistSucceeded) {
      return;
    }

      this.snapshot = {
        ...this.snapshot,
        status: "ready",
        lastError: null,
        health: {
          ...this.snapshot.health,
          outcome: "rebuilt",
          readiness: "ready",
          healthy: true,
          rebuilding: false,
          rebuildRequired: false,
          persistence: "healthy",
          documentCount,
          lastIndexedAt,
          rebuildReason: null,
          lastError: null,
          lastSuccessfulBuild: createSearchSuccessSnapshot("rebuilt", documentCount, lastIndexedAt, "Search index rebuilt."),
          detail: "Search index rebuilt.",
        },
      };
    this.emit();
  }

  handleVaultMutation(event: SearchVaultMutation): void {
    void this.applyMutation(event);
  }

  async applyMutation(event: SearchVaultMutation): Promise<SearchIndexManagerMutationResult> {
    if (this.disposed) return { action: "ignored", rebuildRequired: false };
    const scanning = this.sourceWorkPending > 0;
    const decision = classifySearchMutation(event);
    if (scanning && decision.action === "rebuild-required") {
      this.queuedRebuildDetail = "Rebuild requested after queued mutations.";
      return { action: "ignored", rebuildRequired: false };
    }
    const result = await this.mutationGate.run(() => {
      if (!this.disposed) this.mutationJournal?.push({ ...event });
      return this.disposed ? Promise.resolve<SearchIndexManagerMutationResult>({ action: "ignored", rebuildRequired: false }) : this.applyMutationNow(event);
    });
    if (scanning && result.rebuildRequired) {
      this.queuedRebuildDetail = "Rebuild requested after queued mutations.";
    }
    return scanning ? { action: "ignored", rebuildRequired: false } : result;
  }

  private async runReplacement(kind: "reconcile" | "rebuild", detail: string): Promise<void> {
    if (this.sourceWorkPromise) {
      if (kind === "rebuild") this.queuedRebuildDetail = detail;
      return this.sourceWorkPromise;
    }
    const run = this.runReplacementLoop(kind, detail);
    this.sourceWorkPromise = run;
    try {
      await run;
    } finally {
      if (this.sourceWorkPromise === run) this.sourceWorkPromise = null;
    }
  }

  private async runReplacementLoop(kind: "reconcile" | "rebuild", detail: string): Promise<void> {
    let nextKind = kind;
    let nextDetail = detail;
    this.sourceWorkPending = 1;
    try {
      do {
        this.queuedRebuildDetail = null;
        await this.sourceRunner.run(async (signal, isCurrent) => {
      if (nextKind === "reconcile" && (await this.tryHydrateUnchangedVault(signal, isCurrent))) return;
      if (nextKind === "rebuild") this.setBuilding(nextDetail, "building");
      this.cancelPendingPersist();
      this.mutationJournal = [];
      const replacement = this.createEmptyIndex();
      const replacementDocuments = new Map<string, SearchableDocument>();
      const replacementCatalog = new SearchDocumentCatalog();
      // Batched so peak memory is one read window rather than the whole vault;
      // consecutive windows keep the single-shot document order (C10).
      for await (const batch of this.documentSource.streamDocuments(signal)) {
        if (!isCurrent()) return;
        await replacement.addAllAsync(batch);
        for (const document of batch) {
          replacementDocuments.set(document.path, document);
          replacementCatalog.set(document.path, document.mtime);
        }
      }
      if (!isCurrent()) return;
      const replacementSet: IndexWorkingSet = {
        index: replacement,
        documents: replacementDocuments,
        catalog: replacementCatalog,
      };

      const release = await this.mutationGate.acquire();
      let persisted = false;
      try {
        if (!isCurrent()) return;
        const journal = this.mutationJournal ?? [];
        this.mutationJournal = null;
        for (const event of journal) {
          await applyMutationToWorkingSet(event, replacementSet, false, this.mutationHost);
          if (!isCurrent()) return;
        }
        const now = Date.now();
        persisted = await this.persistIndex(replacement, replacementCatalog, replacement.documentCount, now);
        if (persisted && isCurrent()) {
          this.index = replacement;
          this.documentsByPath.clear();
          for (const [path, document] of replacementDocuments) this.documentsByPath.set(path, document);
          this.documentCatalog = replacementCatalog;
          this.publishReplacementSuccess(nextKind, nextDetail, now);
        }
      } finally {
        this.mutationJournal = null;
        release();
      }

      await this.mutationGate.run(async () => undefined);
      if (isCurrent() && this.persistScheduled) await this.flushPendingPersist();
        });
        if (this.queuedRebuildDetail) {
          nextKind = "rebuild";
          nextDetail = this.queuedRebuildDetail;
        }
      } while (this.queuedRebuildDetail && !this.disposed);
    } finally {
      this.sourceWorkPending = 0;
    }
  }

  /**
   * A reconcile over a vault whose `{path: mtime}` catalog still matches the
   * persisted index has nothing to re-index, so it skips the replacement
   * MiniSearch, the serialization, and the write. It still reads every document
   * because match-count badges are computed from `documentsByPath`, which a
   * restore never populates. Returns false when the catalog cannot prove the
   * vault is unchanged, leaving the caller on the full replacement path.
   */
  private async tryHydrateUnchangedVault(signal: AbortSignal, isCurrent: () => boolean): Promise<boolean> {
    const currentCatalog = this.documentSource.readCatalogSnapshot();
    if (!this.catalogAvailable || !this.documentCatalog.matches(currentCatalog)) return false;

    // Journalled before the read so a mutation landing mid-pass is visible
    // below and cannot be clobbered by the staler document this pass holds.
    this.mutationJournal = [];
    const documents = await this.documentSource.readAllDocuments(signal);
    if (!isCurrent()) return true;

    const release = await this.mutationGate.acquire();
    try {
      const journal = this.mutationJournal ?? [];
      this.mutationJournal = null;
      if (!journal.some(isUnmergeableMutation)) this.mergeHydratedDocuments(documents, journal);
    } finally {
      this.mutationJournal = null;
      release();
    }

    if (!this.documentCatalog.matches(this.documentSource.readCatalogSnapshot())) {
      this.queuedRebuildDetail = "Vault changed during reconciliation; full rebuild required.";
    }
    return true;
  }

  /**
   * Read documents win everywhere except the paths a live mutation already
   * touched during the pass: those hold a newer value than the read (C6).
   */
  private mergeHydratedDocuments(documents: SearchableDocument[], journal: SearchVaultMutation[]): void {
    const touched = new Set<string>();
    for (const event of journal) {
      touched.add(event.path);
      if (event.oldPath) touched.add(event.oldPath);
    }

    const readPaths = new Set<string>();
    for (const document of documents) {
      readPaths.add(document.path);
      if (!touched.has(document.path)) this.documentsByPath.set(document.path, document);
    }

    for (const path of this.documentsByPath.keys()) {
      if (!readPaths.has(path) && !touched.has(path)) this.documentsByPath.delete(path);
    }
  }

  private publishReplacementSuccess(kind: "reconcile" | "rebuild", detail: string, at: number): void {
    if (this.disposed) return;
    // A cutover replaces index content wholesale; a mutation that could not be
    // applied incrementally (rebuild-required, or ignored while scanning) only
    // lands its effect here, so the revision moves with the cutover.
    this.contentRevision += 1;
    const documentCount = this.index.documentCount;
    const outcome = kind === "rebuild" ? "rebuilt" : "restored";
    this.snapshot = {
      ...this.snapshot,
      status: "ready",
      lastError: null,
      health: {
        ...this.snapshot.health,
        outcome,
        readiness: "ready",
        healthy: true,
        rebuilding: false,
        rebuildRequired: false,
        persistence: "healthy",
        documentCount,
        lastIndexedAt: at,
        rebuildReason: null,
        lastError: null,
        lastSuccessfulBuild: kind === "rebuild"
          ? createSearchSuccessSnapshot("rebuilt", documentCount, at, detail)
          : this.snapshot.health.lastSuccessfulBuild,
        detail,
      },
    };
    this.emit();
  }

  private async persistCurrentIndex(documentCount: number, lastIndexedAt: number): Promise<boolean> {
    return this.persistIndex(this.index, this.documentCatalog, documentCount, lastIndexedAt);
  }

  /**
   * The catalog is passed in rather than read from the field so a replacement
   * persist serializes the catalog belonging to the index it is writing.
   */
  private async persistIndex(
    index: MiniSearch<SearchableDocument>,
    catalog: SearchDocumentCatalog,
    documentCount: number,
    lastIndexedAt: number,
  ): Promise<boolean> {
    if (!this.expectedMetadata) {
      return false;
    }

    // Snapshotting the index is the most expensive step in the whole pipeline;
    // never pay for it when the destination cannot accept the write anyway.
    if (!this.store.isAvailable()) {
      this.applyWriteFailure({
        outcome: "failed",
        reason: "unavailable",
        detail: "IndexedDB unavailable.",
      });
      return false;
    }

    if (index.dirtCount >= SearchIndexManager.VACUUM_MIN_DIRT_COUNT) {
      try {
        await index.vacuum();
      } catch (error) {
        // A vacuum is an optimization; losing the snapshot over one would be
        // strictly worse than persisting an index that still carries tombstones.
        console.warn("Search index vacuum failed; serializing without it.", error);
      }
      if (this.disposed) return false;
    }

    const writeResult = await this.store.write(
      {
        ...this.expectedMetadata,
        documentCount,
        lastIndexedAt,
      },
      {
        serializedIndex: index.toJSON(),
        documentCount,
        lastIndexedAt,
        documentCatalog: catalog.toSerializable(),
      },
    );

    if (this.disposed) return false;
    if (writeResult.outcome === "failed") {
      this.applyWriteFailure(writeResult);
      return false;
    }

    this.catalogAvailable = true;
    return true;
  }

  private applyWriteFailure(writeResult: IndexStoreWriteFailureResult): void {
    this.snapshot = {
      ...this.snapshot,
      status: "error",
      lastError: writeResult.detail,
      health: {
        ...this.snapshot.health,
        outcome: "failed",
        readiness: "error",
        healthy: false,
        rebuilding: false,
        rebuildRequired: false,
        persistence: writeResult.reason === "unavailable" ? "storage-unavailable" : "write-failed",
        lastError: writeResult.detail,
        detail: writeResult.detail,
      },
    };
    this.emit();
  }

  private async applyMutationNow(event: SearchVaultMutation): Promise<SearchIndexManagerMutationResult> {
    const result = await applyMutationToWorkingSet(event, this.liveSet, true, this.mutationHost);
    if (result.action === "applied") {
      // Emit immediately with the bumped revision, before the debounced
      // persist refreshes the document count, so a same-count modify still
      // produces a snapshot consumers can notice.
      this.bumpContentRevision();
      this.schedulePersistMutationState();
    }
    return result;
  }

  private schedulePersistMutationState(): void {
    this.refreshHealthDocumentCount();
    this.persistScheduled = true;
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
    }
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      this.cancelPersistIdleTask?.();
      this.cancelPersistIdleTask = scheduleIdleTask(() => {
        this.cancelPersistIdleTask = null;
        void this.mutationGate.run(() => this.flushPendingPersist());
      }, SearchIndexManager.MUTATION_PERSIST_IDLE_TIMEOUT_MS);
    }, SearchIndexManager.MUTATION_PERSIST_DEBOUNCE_MS);
  }

  /**
   * Queries run against the in-memory index, so its document count is reported
   * as soon as a mutation lands even though the disk write is debounced.
   */
  private refreshHealthDocumentCount(): void {
    if (this.snapshot.status !== "ready") {
      return;
    }

    const documentCount = this.index.documentCount;
    if (this.snapshot.health.documentCount === documentCount) {
      return;
    }

    this.snapshot = {
      ...this.snapshot,
      health: {
        ...this.snapshot.health,
        documentCount,
      },
    };
    this.emit();
  }

  private cancelPendingPersist(): void {
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.cancelPersistIdleTask?.();
    this.cancelPersistIdleTask = null;
    this.persistScheduled = false;
  }

  /** Write out debounced index state immediately. Tests and dispose use this instead of waiting on the timer. */
  async flushPendingPersist(): Promise<void> {
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.cancelPersistIdleTask?.();
    this.cancelPersistIdleTask = null;
    if (this.persistInFlight) {
      await this.persistInFlight;
    }
    if (!this.persistScheduled) {
      return;
    }
    this.persistScheduled = false;
    const run = this.persistMutationState();
    this.persistInFlight = run;
    try {
      await run;
    } finally {
      if (this.persistInFlight === run) {
        this.persistInFlight = null;
      }
    }
  }

  private rewriteFolderPrefix(oldPrefix: string, newPrefix: string, set: IndexWorkingSet): boolean {
    const affected = this.collectIndexedFolderRenames(oldPrefix, newPrefix, set.index);
    if (affected.length === 0) {
      return false;
    }

    for (const rename of affected) {
      this.rewriteIndexedPath(rename.oldPath, rename.newPath, set.index);
      // Every indexed path moves, so the catalog moves with it whether or not
      // the document itself was ever hydrated.
      set.catalog.rename(rename.oldPath, rename.newPath);

      const hydratedDocument = set.documents.get(rename.oldPath);
      if (!hydratedDocument) {
        continue;
      }

      set.documents.delete(rename.oldPath);
      set.documents.set(rename.newPath, {
        ...hydratedDocument,
        path: rename.newPath,
        folderPath: rewriteFolderPath(hydratedDocument.folderPath, oldPrefix, newPrefix),
      });
    }

    return true;
  }

  private async upsertDocument(path: string, set: IndexWorkingSet): Promise<void> {
    const document = await this.documentSource.readDocument(path);
    if (this.disposed) return;
    if (!document) {
      this.discardIndexedPath(path, set);
      return;
    }

    if (set.index.has(path)) {
      set.index.discard(path);
    }
    set.index.add(document);
    set.documents.set(path, document);
    set.catalog.set(path, document.mtime);
  }

  private async persistMutationState(): Promise<void> {
    const now = Date.now();
    const documentCount = this.index.documentCount;
    const persistSucceeded = await this.persistCurrentIndex(documentCount, now);
    if (!persistSucceeded) {
      return;
    }

    if (this.snapshot.status === "ready") {
      this.snapshot = {
        ...this.snapshot,
        health: {
          ...this.snapshot.health,
          documentCount,
          lastIndexedAt: now,
          lastError: null,
        },
      };
      this.emit();
    }
  }

  private setBuilding(detail: string, readiness: SearchIndexHealthSnapshot["readiness"]): void {
    this.snapshot = {
      ...this.snapshot,
      status: "building",
      lastError: null,
      health: {
        ...this.snapshot.health,
        readiness,
        healthy: false,
        rebuilding: true,
        rebuildRequired: false,
        lastError: null,
        detail,
      },
    };
    this.emit();
  }

  private markFolderRebuildRequired(detail: string): void {
    this.snapshot = {
      ...this.snapshot,
      status: "building",
      health: {
        ...this.snapshot.health,
        outcome: "rebuild-required",
        readiness: "rebuild-required",
        healthy: false,
        rebuilding: true,
        rebuildRequired: true,
        rebuildReason: "folder-rebuild-required",
        lastError: null,
        detail,
      },
    };
    this.emit();
  }

  private discardIndexedPath(path: string, set: IndexWorkingSet): void {
    if (set.index.has(path)) {
      set.index.discard(path);
    }
    set.documents.delete(path);
    set.catalog.delete(path);
  }

  private collectIndexedFolderRenames(
    oldPrefix: string,
    newPrefix: string,
    index = this.index,
  ): Array<{ oldPath: string; newPath: string }> {
    const indexState = this.getInternalIndexState(index);
    if (!indexState) {
      return [];
    }

    const affected: Array<{ oldPath: string; newPath: string }> = [];
    for (const storedFields of indexState._storedFields.values()) {
      const oldPath = storedFields.path;
      if (typeof oldPath !== "string" || !hasPathPrefix(oldPath, oldPrefix)) {
        continue;
      }

      const rewrittenPath = rewritePathPrefix(oldPath, oldPrefix, newPrefix);
      if (indexState._idToShortId.has(rewrittenPath)) {
        return [];
      }

      affected.push({
        oldPath,
        newPath: rewrittenPath,
      });
    }

    return affected;
  }

  private rewriteIndexedPath(oldPath: string, newPath: string, index = this.index): void {
    const indexState = this.getInternalIndexState(index);
    if (!indexState) {
      return;
    }

    const shortId = indexState._idToShortId.get(oldPath);
    if (shortId === undefined) {
      return;
    }

    indexState._idToShortId.delete(oldPath);
    indexState._idToShortId.set(newPath, shortId);
    indexState._documentIds.set(shortId, newPath);

    const storedFields = indexState._storedFields.get(shortId);
    if (storedFields) {
      storedFields.path = newPath;
    }
  }

  private getInternalIndexState(index = this.index): MiniSearchInternalState | null {
    const internalIndex = index as unknown as Record<string, unknown>;
    const storedFields = internalIndex["_storedFields"];
    const documentIds = internalIndex["_documentIds"];
    const idToShortId = internalIndex["_idToShortId"];
    if (
      !(storedFields instanceof Map) ||
      !(documentIds instanceof Map) ||
      !(idToShortId instanceof Map)
    ) {
      return null;
    }

    return {
      _storedFields: storedFields as Map<number, MiniSearchStoredFields>,
      _documentIds: documentIds as Map<number, string>,
      _idToShortId: idToShortId as Map<string, number>,
    };
  }

  private createEmptyIndex(): MiniSearch<SearchableDocument> {
    return new MiniSearch<SearchableDocument>(createMiniSearchOptions());
  }

  /** Resolved per call because a cutover swaps both the index and the catalog. */
  private get liveSet(): IndexWorkingSet {
    return { index: this.index, documents: this.documentsByPath, catalog: this.documentCatalog };
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private emit(): void {
    if (this.disposed) return;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
