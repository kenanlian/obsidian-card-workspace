import MiniSearch from "minisearch";
import type {
  IndexStore,
  IndexStoreNamespaceMetadata,
  IndexStoreRestoreResult,
  IndexStoreWriteResult,
} from "./IndexStore";
import { classifySearchMutation } from "./document-preparation";
import {
  PHASE3_MINISEARCH_CONTRACT,
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

const INITIAL_SNAPSHOT: SearchServiceSnapshot = {
  initialized: true,
  disposed: false,
  mode: "indexed",
  status: "building",
  lastError: null,
  health: {
    outcome: "none",
    healthy: false,
    rebuilding: true,
    documentCount: null,
    lastIndexedAt: null,
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

export class SearchIndexManager {
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

  dispose(): void {
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
    this.setBuilding("Restoring persisted search index...");

    const restoreResult = await this.store.restore(expectedMetadata);
    if (restoreResult.outcome !== "restored") {
      const detail = this.toRebuildDetail(restoreResult);
      this.snapshot = {
        ...this.snapshot,
        status: "building",
        lastError: null,
        health: {
          outcome: "rebuild-required",
          healthy: false,
          rebuilding: true,
          documentCount: null,
          lastIndexedAt: null,
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
      await this.refreshDocumentStateFromSource();
      this.snapshot = {
        ...this.snapshot,
        status: "ready",
        lastError: null,
        health: {
          outcome: "restored",
          healthy: true,
          rebuilding: false,
          documentCount: restoreResult.payload.documentCount,
          lastIndexedAt: restoreResult.payload.lastIndexedAt,
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
          outcome: "rebuild-required",
          healthy: false,
          rebuilding: true,
          documentCount: null,
          lastIndexedAt: null,
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

  async rebuildFromSource(detail = "Manual rebuild requested."): Promise<void> {
    await this.runFullBuild(detail);
  }

  async search(query: string, candidatePaths: string[]): Promise<string[]> {
    if (this.snapshot.status !== "ready") {
      return [];
    }

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return [...candidatePaths];
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

    return ordered;
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
        outcome: "rebuilt",
        healthy: true,
        rebuilding: false,
        documentCount,
        lastIndexedAt,
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
    this.setBuilding(detail);
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
        outcome: "rebuilt",
        healthy: true,
        rebuilding: false,
        documentCount: documents.length,
        lastIndexedAt: now,
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

  private applyWriteFailure(writeResult: Extract<IndexStoreWriteResult, { outcome: "failed" }>): void {
    this.snapshot = {
      ...this.snapshot,
      status: "error",
      lastError: writeResult.detail,
      health: {
        ...this.snapshot.health,
        outcome: "failed",
        healthy: false,
        rebuilding: false,
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
      const detail = "Folder rename cannot be safely rewritten; full rebuild required.";
      this.snapshot = {
        ...this.snapshot,
        status: "building",
        health: {
          ...this.snapshot.health,
          outcome: "rebuild-required",
          healthy: false,
          rebuilding: true,
          detail,
        },
      };
      this.emit();
      return {
        action: "rebuild-required",
        rebuildRequired: true,
      };
    }

    if (decision.action === "delete") {
      if (this.documentsByPath.has(event.path)) {
        this.index.discard(event.path);
      }
      this.documentsByPath.delete(event.path);
      await this.persistMutationState();
      return {
        action: "applied",
        rebuildRequired: false,
      };
    }

    if (decision.action === "create" || decision.action === "modify") {
      await this.upsertDocument(event.path);
      await this.persistMutationState();
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

      if (this.documentsByPath.has(oldPath)) {
        this.index.discard(oldPath);
      }
      this.documentsByPath.delete(oldPath);
      await this.upsertDocument(event.path);
      await this.persistMutationState();
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
        return {
          action: "rebuild-required",
          rebuildRequired: true,
        };
      }

      await this.persistMutationState();

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

  private rewriteFolderPrefix(oldPrefix: string, newPrefix: string): boolean {
    const affected = [...this.documentsByPath.values()].filter((document) => hasPathPrefix(document.path, oldPrefix));
    if (affected.length === 0) {
      return false;
    }

    for (const document of affected) {
      this.index.discard(document.path);
      this.documentsByPath.delete(document.path);

      const rewrittenPath = rewritePathPrefix(document.path, oldPrefix, newPrefix);
      const rewrittenFolderPath = rewriteFolderPath(document.folderPath, oldPrefix, newPrefix);
      const rewrittenDocument: SearchableDocument = {
        ...document,
        path: rewrittenPath,
        folderPath: rewrittenFolderPath,
      };

      this.index.add(rewrittenDocument);
      this.documentsByPath.set(rewrittenDocument.path, rewrittenDocument);
    }

    return true;
  }

  private async upsertDocument(path: string): Promise<void> {
    const document = await this.documentSource.readDocument(path);
    if (!document) {
      if (this.documentsByPath.has(path)) {
        this.index.discard(path);
      }
      this.documentsByPath.delete(path);
      return;
    }

    if (this.documentsByPath.has(path)) {
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
    const persistSucceeded = await this.persistCurrentIndex(this.documentsByPath.size, now);
    if (!persistSucceeded) {
      return;
    }

    if (this.snapshot.status === "ready") {
      this.snapshot = {
        ...this.snapshot,
        health: {
          ...this.snapshot.health,
          documentCount: this.documentsByPath.size,
          lastIndexedAt: now,
        },
      };
      this.emit();
    }
  }

  private setBuilding(detail: string): void {
    this.snapshot = {
      ...this.snapshot,
      status: "building",
      lastError: null,
      health: {
        ...this.snapshot.health,
        healthy: false,
        rebuilding: true,
        detail,
      },
    };
    this.emit();
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

  private toRebuildDetail(restoreResult: Extract<IndexStoreRestoreResult, { outcome: "rebuild-required" }>): string {
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
        return "Persistent index storage unavailable; fallback mode active.";
      case "read-failed":
      default:
        return "Persisted index read failed; full build required.";
    }
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.length > 0) {
      return error.message;
    }
    return fallback;
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
