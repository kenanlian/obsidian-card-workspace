import MiniSearch from "minisearch";
import { getSearchDisplayTerms } from "../search-tokenization";
import type {
  IndexStoreClearResult,
  IndexStore,
  IndexStoreNamespaceMetadata,
  IndexStoreRestoreRebuildRequiredResult,
  IndexStoreWriteFailureResult,
} from "./IndexStore";
import { classifySearchMutation } from "./document-preparation";
import {
  type SearchIndexHealthSnapshot,
  type SearchIndexPersistenceHealth,
  type SearchIndexRebuildReason,
  type SearchServiceSnapshot,
  type SearchVaultMutation,
  type SearchableDocument,
} from "./types";
import { createMiniSearchOptions, MINISEARCH_SEARCH_OPTIONS } from "./minisearch-options";
import {
  countNonOverlappingLiteralOccurrences,
  createSearchSuccessSnapshot,
  hasPathPrefix,
  rewriteFolderPath,
  rewritePathPrefix,
  searchErrorMessage,
  SearchMutationGate,
  SearchReconciliationRunner,
} from "./SearchReconciliationRunner";

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
  readAllDocuments(signal?: AbortSignal): Promise<SearchableDocument[]>;
  readDocument(path: string): Promise<SearchableDocument | null>;
}

interface SearchIndexManagerOptions {
  store: Pick<IndexStore, "restore" | "write" | "clear">;
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
   */
  private static readonly MUTATION_PERSIST_DEBOUNCE_MS = 1000;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistScheduled = false;
  private persistInFlight: Promise<void> | null = null;
  private readonly store: Pick<IndexStore, "restore" | "write" | "clear">;
  private readonly documentSource: SearchIndexDocumentSource;
  private index: MiniSearch<SearchableDocument>;
  private snapshot: SearchServiceSnapshot = {
    ...INITIAL_SNAPSHOT,
    health: { ...INITIAL_SNAPSHOT.health },
  };
  private readonly listeners = new Set<(snapshot: SearchServiceSnapshot) => void>();
  private readonly documentsByPath = new Map<string, SearchableDocument>();
  private expectedMetadata: IndexStoreNamespaceMetadata | null = null;
  private readonly sourceRunner = new SearchReconciliationRunner();
  private readonly mutationGate = new SearchMutationGate();
  private mutationJournal: SearchVaultMutation[] | null = null;
  private sourceWorkPending = 0;
  private sourceWorkPromise: Promise<void> | null = null;
  private queuedRebuildDetail: string | null = null;
  private disposed = false;
  private generation = 0;

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
      health: {
        ...this.snapshot.health,
      },
    };
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
      const detail = this.toRebuildDetail(restoreResult);
      const persistence = this.toRestorePersistence(restoreResult.reason);
      const rebuildReason = this.toRestoreRebuildReason(restoreResult.reason);
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
      const restoredIndex = await MiniSearch.loadJSONAsync<SearchableDocument>(
        restoreResult.payload.serializedIndexJson,
        createMiniSearchOptions(),
      );
      if (!this.isCurrent(generation)) {
        return { status: "building", outcome: "rebuild-required", detail: null };
      }
      this.index = restoredIndex;
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
      matchCountsByPath: this.buildMatchCountsByPath(trimmed, ordered),
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
      if (nextKind === "rebuild") this.setBuilding(nextDetail, "building");
      this.cancelPendingPersist();
      this.mutationJournal = [];
      const documents = await this.documentSource.readAllDocuments(signal);
      if (!isCurrent()) return;
      const replacement = this.createEmptyIndex();
      if (documents.length > 0) await replacement.addAllAsync(documents);
      if (!isCurrent()) return;
      const replacementDocuments = new Map(documents.map((document) => [document.path, document]));

      const release = await this.mutationGate.acquire();
      let persisted = false;
      try {
        if (!isCurrent()) return;
        const journal = this.mutationJournal ?? [];
        this.mutationJournal = null;
        for (const event of journal) {
          await this.applyMutationToState(event, replacement, replacementDocuments, false);
          if (!isCurrent()) return;
        }
        const now = Date.now();
        persisted = await this.persistIndex(replacement, replacement.documentCount, now);
        if (persisted && isCurrent()) {
          this.index = replacement;
          this.documentsByPath.clear();
          for (const [path, document] of replacementDocuments) this.documentsByPath.set(path, document);
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

  private publishReplacementSuccess(kind: "reconcile" | "rebuild", detail: string, at: number): void {
    if (this.disposed) return;
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
    return this.persistIndex(this.index, documentCount, lastIndexedAt);
  }

  private async persistIndex(
    index: MiniSearch<SearchableDocument>,
    documentCount: number,
    lastIndexedAt: number,
  ): Promise<boolean> {
    if (!this.expectedMetadata) {
      return false;
    }

    const writeResult = await this.store.write(
      {
        ...this.expectedMetadata,
        documentCount,
        lastIndexedAt,
      },
      {
        serializedIndexJson: JSON.stringify(index.toJSON()),
        documentCount,
        lastIndexedAt,
      },
    );

    if (this.disposed) return false;
    if (writeResult.outcome === "failed") {
      this.applyWriteFailure(writeResult);
      return false;
    }

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
    const result = await this.applyMutationToState(event, this.index, this.documentsByPath, true);
    if (result.action === "applied") this.schedulePersistMutationState();
    return result;
  }

  private async applyMutationToState(
    event: SearchVaultMutation,
    index: MiniSearch<SearchableDocument>,
    documents: Map<string, SearchableDocument>,
    live: boolean,
  ): Promise<SearchIndexManagerMutationResult> {
    const decision = classifySearchMutation(event);

    if (decision.action === "ignored") {
      return {
        action: "ignored",
        rebuildRequired: false,
      };
    }

    if (decision.action === "rebuild-required") {
      if (live) this.markFolderRebuildRequired("Folder rename cannot be safely rewritten; full rebuild required.");
      return {
        action: "rebuild-required",
        rebuildRequired: true,
      };
    }

    if (decision.action === "delete") {
      this.discardIndexedPath(event.path, index, documents);
      return {
        action: "applied",
        rebuildRequired: false,
      };
    }

    if (decision.action === "create" || decision.action === "modify") {
      await this.upsertDocument(event.path, index, documents);
      return {
        action: "applied",
        rebuildRequired: false,
      };
    }

    if (decision.action === "file-rename") {
      const oldPath = event.oldPath;
      if (!oldPath) {
        return {
          action: "rebuild-required",
          rebuildRequired: true,
        };
      }

      this.discardIndexedPath(oldPath, index, documents);
      await this.upsertDocument(event.path, index, documents);
      return {
        action: "applied",
        rebuildRequired: false,
      };
    }

    if (decision.action === "folder-rename") {
      const oldPrefix = event.oldPath;
      if (!oldPrefix) {
        return {
          action: "rebuild-required",
          rebuildRequired: true,
        };
      }

      const didRewrite = this.rewriteFolderPrefix(oldPrefix, event.path, index, documents);
      if (!didRewrite) {
        if (live) this.markFolderRebuildRequired("Folder rename could not be safely rewritten from restored index metadata; full rebuild required.");
        return {
          action: "rebuild-required",
          rebuildRequired: true,
        };
      }

      return {
        action: "applied",
        rebuildRequired: false,
      };
    }

    return {
      action: "ignored",
      rebuildRequired: false,
    };
  }

  private schedulePersistMutationState(): void {
    this.refreshHealthDocumentCount();
    this.persistScheduled = true;
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.mutationGate.run(() => this.flushPendingPersist());
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
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persistScheduled = false;
  }

  /** Write out debounced index state immediately. Tests and dispose use this instead of waiting on the timer. */
  async flushPendingPersist(): Promise<void> {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
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

  private rewriteFolderPrefix(
    oldPrefix: string,
    newPrefix: string,
    index = this.index,
    documents = this.documentsByPath,
  ): boolean {
    const affected = this.collectIndexedFolderRenames(oldPrefix, newPrefix, index);
    if (affected.length === 0) {
      return false;
    }

    for (const rename of affected) {
      this.rewriteIndexedPath(rename.oldPath, rename.newPath, index);

      const hydratedDocument = documents.get(rename.oldPath);
      if (!hydratedDocument) {
        continue;
      }

      documents.delete(rename.oldPath);
      documents.set(rename.newPath, {
        ...hydratedDocument,
        path: rename.newPath,
        folderPath: rewriteFolderPath(hydratedDocument.folderPath, oldPrefix, newPrefix),
      });
    }

    return true;
  }

  private async upsertDocument(
    path: string,
    index = this.index,
    documents = this.documentsByPath,
  ): Promise<void> {
    const document = await this.documentSource.readDocument(path);
    if (this.disposed) return;
    if (!document) {
      this.discardIndexedPath(path, index, documents);
      return;
    }

    if (index.has(path)) {
      index.discard(path);
    }
    index.add(document);
    documents.set(path, document);
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

  private discardIndexedPath(
    path: string,
    index = this.index,
    documents = this.documentsByPath,
  ): void {
    if (index.has(path)) {
      index.discard(path);
    }
    documents.delete(path);
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

  private buildMatchCountsByPath(query: string, orderedPaths: string[]): Record<string, number> | undefined {
    const uniqueTokens = getSearchDisplayTerms(query);
    if (uniqueTokens.length === 0) {
      return undefined;
    }

    const matchCountsByPath: Record<string, number> = {};
    for (const path of orderedPaths) {
      const document = this.documentsByPath.get(path);
      if (!document) {
        continue;
      }

      const searchBasis = `${document.title} ${document.content}`.trim();
      const count = this.countTokenMatches(searchBasis, uniqueTokens);
      if (count > 0) {
        matchCountsByPath[path] = count;
      }
    }

    return Object.keys(matchCountsByPath).length > 0 ? matchCountsByPath : undefined;
  }

  private countTokenMatches(searchBasis: string, tokens: string[]): number {
    const normalizedBasis = searchBasis.toLowerCase();
    let total = 0;
    for (const token of tokens) {
      total += countNonOverlappingLiteralOccurrences(normalizedBasis, token);
    }

    return total;
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

  private toRebuildDetail(restoreResult: IndexStoreRestoreRebuildRequiredResult): string {
    if (restoreResult.detail) {
      return restoreResult.detail;
    }

    switch (restoreResult.reason) {
      case "missing":
        return "No persisted index found; full build required.";
      case "version-drift":
        return "Persisted index version drift; full build required.";
      case "corrupt":
        return "Persisted index is corrupt; full build required.";
      case "unavailable":
        return "Persistent index storage unavailable; rebuild cannot restore persisted index.";
      case "read-failed":
      default:
        return "Persisted index read failed; full build required.";
    }
  }

  private toRestorePersistence(reason: IndexStoreRestoreRebuildRequiredResult["reason"]): SearchIndexPersistenceHealth {
    switch (reason) {
      case "unavailable":
        return "storage-unavailable";
      case "read-failed":
        return "read-failed";
      case "missing":
      case "version-drift":
      case "corrupt":
      default:
        return "healthy";
    }
  }

  private toRestoreRebuildReason(reason: IndexStoreRestoreRebuildRequiredResult["reason"]): SearchIndexRebuildReason {
    switch (reason) {
      case "missing":
      case "version-drift":
      case "corrupt":
      case "read-failed":
      case "unavailable":
        return reason === "unavailable" ? "storage-unavailable" : reason;
      default:
        return "read-failed";
    }
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
