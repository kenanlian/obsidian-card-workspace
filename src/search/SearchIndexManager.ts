import MiniSearch from "minisearch";
import type {
  IndexStoreClearResult,
  IndexStore,
  IndexStoreNamespaceMetadata,
  IndexStoreRestoreRebuildRequiredResult,
  IndexStoreWriteFailureResult,
} from "./IndexStore";
import { classifySearchMutation } from "./document-preparation";
import {
  PHASE3_MINISEARCH_CONTRACT,
  type SearchIndexHealthSnapshot,
  type SearchIndexPersistenceHealth,
  type SearchIndexRebuildReason,
  type SearchIndexSuccessOutcome,
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
  readAllDocuments(): Promise<SearchableDocument[]>;
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

const SEARCH_OPTIONS = {
  prefix: PHASE3_MINISEARCH_CONTRACT.query.prefix,
  fuzzy: PHASE3_MINISEARCH_CONTRACT.query.fuzzy,
  combineWith: PHASE3_MINISEARCH_CONTRACT.query.combineWith,
  boost: {
    title: PHASE3_MINISEARCH_CONTRACT.boost.title,
    content: PHASE3_MINISEARCH_CONTRACT.boost.content,
  },
};

const WHITESPACE_PATTERN = /\s+/g;

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
  private pendingMutations = new Map<string, SearchVaultMutation>();
  private expectedMetadata: IndexStoreNamespaceMetadata | null = null;
  private isBuilding = false;
  private rebuildRequestedDuringBuild = false;
  private pendingRebuildDetail: string | null = null;

  constructor(options: SearchIndexManagerOptions) {
    this.store = options.store;
    this.documentSource = options.documentSource;
    this.index = this.createEmptyIndex();
  }

  async initialize(): Promise<void> {
    return Promise.resolve();
  }

  markInitializationFailure(error: unknown): void {
    const detail = this.errorMessage(error, "Indexed search initialization failed.");
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
    void this.flushPendingPersist();

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
    return {
      ...this.snapshot,
      health: {
        ...this.snapshot.health,
      },
    };
  }

  subscribe(listener: (snapshot: SearchServiceSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async restore(expectedMetadata: IndexStoreNamespaceMetadata): Promise<SearchIndexManagerRestoreResult> {
    this.expectedMetadata = expectedMetadata;
    this.setBuilding("Restoring persisted search index...", "restoring");

    const restoreResult = await this.store.restore(expectedMetadata);
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
      this.index = await MiniSearch.loadJSONAsync<SearchableDocument>(
        restoreResult.payload.serializedIndexJson,
        this.createMiniSearchOptions(),
      );
      const success = this.createSuccessSnapshot(
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
      await this.store.clear();
      const detail = this.errorMessage(error, "Persisted index could not be restored; full rebuild required.");
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
    await this.refreshDocumentStateFromSource();
  }

  async rebuildFromSource(detail = "Manual rebuild requested."): Promise<void> {
    await this.runFullBuild(detail);
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
    this.pendingMutations.clear();
    this.rebuildRequestedDuringBuild = false;
    this.pendingRebuildDetail = null;
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
    const results = this.index.search(trimmed, SEARCH_OPTIONS) as SearchIndexMiniSearchResult[];
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
          lastSuccessfulBuild: this.createSuccessSnapshot("rebuilt", documentCount, lastIndexedAt, "Search index rebuilt."),
          detail: "Search index rebuilt.",
        },
      };
    this.emit();
  }

  handleVaultMutation(event: SearchVaultMutation): void {
    void this.applyMutation(event);
  }

  async applyMutation(event: SearchVaultMutation): Promise<SearchIndexManagerMutationResult> {
    if (this.isBuilding) {
      this.queueMutation(event);
      return {
        action: "ignored",
        rebuildRequired: false,
      };
    }

    return this.applyMutationNow(event);
  }

  private async runFullBuild(detail: string): Promise<void> {
    if (this.isBuilding) {
      this.rebuildRequestedDuringBuild = true;
      this.pendingRebuildDetail = detail;
      return;
    }

    // A full build writes the whole index anyway, so a pending incremental write is moot.
    this.cancelPendingPersist();
    this.isBuilding = true;
    try {
      let nextDetail = detail;
      do {
        this.rebuildRequestedDuringBuild = false;
        this.pendingRebuildDetail = null;
        await this.executeFullBuild(nextDetail);
        await this.flushPendingMutations();
        nextDetail = this.pendingRebuildDetail ?? "Rebuild requested after queued mutations.";
      } while (this.rebuildRequestedDuringBuild);
    } finally {
      this.isBuilding = false;
    }
  }

  private async executeFullBuild(detail: string): Promise<void> {
    this.setBuilding(detail, "building");
    const documents = await this.documentSource.readAllDocuments();
    const nextIndex = this.createEmptyIndex();
    if (documents.length > 0) {
      await nextIndex.addAllAsync(documents);
    }
    this.index = nextIndex;
    this.documentsByPath.clear();
    for (const document of documents) {
      this.documentsByPath.set(document.path, document);
    }

    const now = Date.now();
    const persistSucceeded = await this.persistCurrentIndex(documents.length, now);
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
        documentCount: documents.length,
        lastIndexedAt: now,
        rebuildReason: null,
        lastError: null,
        lastSuccessfulBuild: this.createSuccessSnapshot("rebuilt", documents.length, now, detail),
        detail,
      },
    };
    this.emit();
  }

  private async persistCurrentIndex(documentCount: number, lastIndexedAt: number): Promise<boolean> {
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
        serializedIndexJson: JSON.stringify(this.index.toJSON()),
        documentCount,
        lastIndexedAt,
      },
    );

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

  private async flushPendingMutations(): Promise<void> {
    if (this.pendingMutations.size === 0) {
      return;
    }

    const queued = [...this.pendingMutations.values()];
    this.pendingMutations.clear();
    for (const event of queued) {
      const result = await this.applyMutationNow(event);
      if (result.rebuildRequired) {
        this.rebuildRequestedDuringBuild = true;
      }
    }
  }

  private queueMutation(event: SearchVaultMutation): void {
    const key = this.queueKey(event);
    this.pendingMutations.set(key, event);
    const decision = classifySearchMutation(event);
    if (decision.action === "rebuild-required") {
      this.rebuildRequestedDuringBuild = true;
      this.pendingRebuildDetail = "Queued folder rename requires full rebuild.";
    }
  }

  private queueKey(event: SearchVaultMutation): string {
    if (event.type === "rename") {
      return `rename:${event.oldPath ?? "missing"}->${event.path}`;
    }
    return `${event.type}:${event.path}`;
  }

  private async applyMutationNow(event: SearchVaultMutation): Promise<SearchIndexManagerMutationResult> {
    const decision = classifySearchMutation(event);

    if (decision.action === "ignored") {
      return {
        action: "ignored",
        rebuildRequired: false,
      };
    }

    if (decision.action === "rebuild-required") {
      this.markFolderRebuildRequired("Folder rename cannot be safely rewritten; full rebuild required.");
      return {
        action: "rebuild-required",
        rebuildRequired: true,
      };
    }

    if (decision.action === "delete") {
      this.discardIndexedPath(event.path);
      this.schedulePersistMutationState();
      return {
        action: "applied",
        rebuildRequired: false,
      };
    }

    if (decision.action === "create" || decision.action === "modify") {
      await this.upsertDocument(event.path);
      this.schedulePersistMutationState();
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

      this.discardIndexedPath(oldPath);
      await this.upsertDocument(event.path);
      this.schedulePersistMutationState();
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

      const didRewrite = this.rewriteFolderPrefix(oldPrefix, event.path);
      if (!didRewrite) {
        this.markFolderRebuildRequired("Folder rename could not be safely rewritten from restored index metadata; full rebuild required.");
        return {
          action: "rebuild-required",
          rebuildRequired: true,
        };
      }

      this.schedulePersistMutationState();

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
      void this.flushPendingPersist();
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

  private rewriteFolderPrefix(oldPrefix: string, newPrefix: string): boolean {
    const affected = this.collectIndexedFolderRenames(oldPrefix, newPrefix);
    if (affected.length === 0) {
      return false;
    }

    for (const rename of affected) {
      this.rewriteIndexedPath(rename.oldPath, rename.newPath);

      const hydratedDocument = this.documentsByPath.get(rename.oldPath);
      if (!hydratedDocument) {
        continue;
      }

      this.documentsByPath.delete(rename.oldPath);
      this.documentsByPath.set(rename.newPath, {
        ...hydratedDocument,
        path: rename.newPath,
        folderPath: rewriteFolderPath(hydratedDocument.folderPath, oldPrefix, newPrefix),
      });
    }

    return true;
  }

  private async upsertDocument(path: string): Promise<void> {
    const document = await this.documentSource.readDocument(path);
    if (!document) {
      this.discardIndexedPath(path);
      return;
    }

    if (this.index.has(path)) {
      this.index.discard(path);
    }
    this.index.add(document);
    this.documentsByPath.set(path, document);
  }

  private async refreshDocumentStateFromSource(): Promise<void> {
    const allDocuments = await this.documentSource.readAllDocuments();
    this.documentsByPath.clear();
    for (const document of allDocuments) {
      this.documentsByPath.set(document.path, document);
    }
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

  private discardIndexedPath(path: string): void {
    if (this.index.has(path)) {
      this.index.discard(path);
    }
    this.documentsByPath.delete(path);
  }

  private collectIndexedFolderRenames(oldPrefix: string, newPrefix: string): Array<{ oldPath: string; newPath: string }> {
    const indexState = this.getInternalIndexState();
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

  private rewriteIndexedPath(oldPath: string, newPath: string): void {
    const indexState = this.getInternalIndexState();
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
    const uniqueTokens = this.extractUniqueQueryTokens(query);
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

  private extractUniqueQueryTokens(query: string): string[] {
    const normalized = query.toLowerCase().replace(WHITESPACE_PATTERN, " ").trim();
    if (normalized.length === 0) {
      return [];
    }

    const uniqueTokens = new Set<string>();
    for (const token of normalized.split(" ")) {
      if (token.length === 0) {
        continue;
      }
      uniqueTokens.add(token);
    }

    return [...uniqueTokens];
  }

  private countTokenMatches(searchBasis: string, tokens: string[]): number {
    const normalizedBasis = searchBasis.toLowerCase();
    let total = 0;
    for (const token of tokens) {
      total += countNonOverlappingLiteralOccurrences(normalizedBasis, token);
    }

    return total;
  }

  private getInternalIndexState(): MiniSearchInternalState | null {
    const internalIndex = this.index as unknown as Record<string, unknown>;
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
    return new MiniSearch<SearchableDocument>(this.createMiniSearchOptions());
  }

  private createMiniSearchOptions() {
    return {
      idField: "path",
      fields: [...PHASE3_MINISEARCH_CONTRACT.indexFields],
      storeFields: [...PHASE3_MINISEARCH_CONTRACT.storeFields],
      processTerm: (term: string): string => term.toLowerCase(),
    };
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

  private createSuccessSnapshot(
    outcome: SearchIndexSuccessOutcome,
    documentCount: number,
    at: number,
    detail: string | null,
  ): SearchIndexHealthSnapshot["lastSuccessfulBuild"] {
    return {
      outcome,
      at,
      documentCount,
      detail,
    };
  }

  private errorMessage(error: unknown, defaultMessage: string): string {
    if (error instanceof Error && error.message.length > 0) {
      return error.message;
    }
    return defaultMessage;
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

function hasPathPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function rewritePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) {
    return newPrefix;
  }
  return `${newPrefix}${path.slice(oldPrefix.length)}`;
}

function rewriteFolderPath(folderPath: string, oldPrefix: string, newPrefix: string): string {
  if (folderPath.length === 0) {
    return "";
  }
  if (folderPath === oldPrefix || folderPath.startsWith(`${oldPrefix}/`)) {
    return rewritePathPrefix(folderPath, oldPrefix, newPrefix);
  }
  return folderPath;
}

function countNonOverlappingLiteralOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0 || haystack.length === 0) {
    return 0;
  }

  let count = 0;
  let searchStart = 0;
  while (searchStart < haystack.length) {
    const matchIndex = haystack.indexOf(needle, searchStart);
    if (matchIndex === -1) {
      break;
    }

    count += 1;
    searchStart = matchIndex + needle.length;
  }

  return count;
}
