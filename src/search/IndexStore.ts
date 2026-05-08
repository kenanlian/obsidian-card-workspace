const INDEX_STORE_DATABASE_NAME = "card-workspace-search";
const INDEX_STORE_OBJECT_STORE_NAME = "searchIndexes";

export interface IndexStoreNamespaceMetadata {
  vaultNamespace: string;
  schemaVersion: string;
  tokenizerVersion: string;
  pluginVersion: string;
  documentCount: number;
  lastIndexedAt: number;
}

export interface IndexStoreSerializedPayload {
  serializedIndexJson: string;
  documentCount: number;
  lastIndexedAt: number;
}

export interface IndexStoreRecord {
  metadata: IndexStoreNamespaceMetadata;
  serializedIndexJson: string;
}

export type IndexStoreRestoreFailureReason =
  | "missing"
  | "version-drift"
  | "corrupt"
  | "unavailable"
  | "read-failed";

export type IndexStoreStorageFailureReason = "unavailable" | "quota" | "write-failed" | "clear-failed";

export type IndexStoreRestoreResult =
  | {
      outcome: "restored";
      metadata: IndexStoreNamespaceMetadata;
      payload: IndexStoreSerializedPayload;
    }
  | {
      outcome: "rebuild-required";
      reason: IndexStoreRestoreFailureReason;
      cleared: boolean;
      detail: string | null;
    };

export type IndexStoreRestoreRebuildRequiredResult = Extract<
  IndexStoreRestoreResult,
  { outcome: "rebuild-required" }
>;

export type IndexStoreWriteResult =
  | {
      outcome: "written";
      bytes: number;
    }
  | {
      outcome: "failed";
      reason: Extract<IndexStoreStorageFailureReason, "unavailable" | "quota" | "write-failed">;
      detail: string | null;
    };

export type IndexStoreWriteFailureResult = Extract<IndexStoreWriteResult, { outcome: "failed" }>;

export type IndexStoreClearResult =
  | {
      outcome: "cleared";
    }
  | {
      outcome: "failed";
      reason: Extract<IndexStoreStorageFailureReason, "unavailable" | "clear-failed">;
      detail: string | null;
    };

export interface IndexStoreStorageAdapter {
  getRecord(key: string): Promise<IndexStoreRecord | null>;
  setRecord(key: string, value: IndexStoreRecord): Promise<void>;
  removeRecord(key: string): Promise<void>;
}

interface IndexStoreOptions {
  adapter?: IndexStoreStorageAdapter;
  indexedDbFactory?: IDBFactory | null;
  vaultNamespace: string;
}

class IndexedDbUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexedDbUnavailableError";
  }
}

class IndexedDbStorageAdapter implements IndexStoreStorageAdapter {
  private readonly indexedDbFactory: IDBFactory;

  constructor(indexedDbFactory: IDBFactory | null | undefined) {
    if (!indexedDbFactory) {
      throw new IndexedDbUnavailableError("IndexedDB API is not available in this runtime.");
    }
    this.indexedDbFactory = indexedDbFactory;
  }

  async getRecord(key: string): Promise<IndexStoreRecord | null> {
    return this.withStore("readonly", (store) =>
      this.requestPromise<IndexStoreRecord | undefined>(store.get(key)).then((result) => result ?? null),
    );
  }

  async setRecord(key: string, value: IndexStoreRecord): Promise<void> {
    await this.withStore("readwrite", async (store, transaction) => {
      await this.requestPromise(store.put(value, key));
      await this.transactionPromise(transaction);
    });
  }

  async removeRecord(key: string): Promise<void> {
    await this.withStore("readwrite", async (store, transaction) => {
      await this.requestPromise(store.delete(key));
      await this.transactionPromise(transaction);
    });
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore, transaction: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const database = await this.openDatabase();
    try {
      const transaction = database.transaction(INDEX_STORE_OBJECT_STORE_NAME, mode);
      const objectStore = transaction.objectStore(INDEX_STORE_OBJECT_STORE_NAME);
      return await work(objectStore, transaction);
    } finally {
      database.close();
    }
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = this.indexedDbFactory.open(INDEX_STORE_DATABASE_NAME, 1);
      } catch (error) {
        reject(error);
        return;
      }

      request.onerror = () => {
        reject(request.error ?? new Error("Failed to open IndexedDB database."));
      };
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(INDEX_STORE_OBJECT_STORE_NAME)) {
          database.createObjectStore(INDEX_STORE_OBJECT_STORE_NAME);
        }
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
    });
  }

  private requestPromise<T = void>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error("IndexedDB request failed."));
      };
    });
  }

  private transactionPromise(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(transaction.error ?? new Error("IndexedDB transaction failed."));
      };
      transaction.onabort = () => {
        reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
      };
    });
  }
}

export class IndexStore {
  readonly vaultNamespace: string;
  private readonly adapter: IndexStoreStorageAdapter;
  private readonly available: boolean;

  constructor(options: IndexStoreOptions) {
    this.vaultNamespace = options.vaultNamespace;

    if (options.adapter) {
      this.adapter = options.adapter;
      this.available = true;
      return;
    }

    try {
      this.adapter = new IndexedDbStorageAdapter(options.indexedDbFactory ?? globalThis.indexedDB);
      this.available = true;
    } catch (error) {
      this.adapter = createUnavailableAdapter(error);
      this.available = false;
    }
  }

  async restore(expected: IndexStoreNamespaceMetadata): Promise<IndexStoreRestoreResult> {
    if (!this.available) {
      return {
        outcome: "rebuild-required",
        reason: "unavailable",
        cleared: false,
        detail: "IndexedDB unavailable.",
      };
    }

    let record: IndexStoreRecord | null;
    try {
      record = await this.adapter.getRecord(this.vaultNamespace);
    } catch (error) {
      return {
        outcome: "rebuild-required",
        reason: "read-failed",
        cleared: false,
        detail: normalizeErrorMessage(error),
      };
    }

    if (!record) {
      return {
        outcome: "rebuild-required",
        reason: "missing",
        cleared: false,
        detail: null,
      };
    }

    if (!isValidRecord(record)) {
      const cleared = await this.clearPersistedRecord();
      return {
        outcome: "rebuild-required",
        reason: "corrupt",
        cleared,
        detail: "Persisted index record has invalid shape.",
      };
    }

    if (!matchesExpectedMetadata(record.metadata, expected)) {
      const cleared = await this.clearPersistedRecord();
      return {
        outcome: "rebuild-required",
        reason: "version-drift",
        cleared,
        detail: "Persisted index metadata version drift detected.",
      };
    }

    return {
      outcome: "restored",
      metadata: record.metadata,
      payload: {
        serializedIndexJson: record.serializedIndexJson,
        documentCount: record.metadata.documentCount,
        lastIndexedAt: record.metadata.lastIndexedAt,
      },
    };
  }

  async write(metadata: IndexStoreNamespaceMetadata, payload: IndexStoreSerializedPayload): Promise<IndexStoreWriteResult> {
    if (!this.available) {
      return {
        outcome: "failed",
        reason: "unavailable",
        detail: "IndexedDB unavailable.",
      };
    }

    const record = this.createRecord(metadata, payload);
    const serializedRecord = JSON.stringify(record);

    try {
      await this.adapter.setRecord(this.vaultNamespace, record);
      return {
        outcome: "written",
        bytes: serializedRecord.length,
      };
    } catch (error) {
      if (isQuotaError(error)) {
        return {
          outcome: "failed",
          reason: "quota",
          detail: normalizeErrorMessage(error),
        };
      }

      return {
        outcome: "failed",
        reason: "write-failed",
        detail: normalizeErrorMessage(error),
      };
    }
  }

  async clear(): Promise<IndexStoreClearResult> {
    if (!this.available) {
      return {
        outcome: "failed",
        reason: "unavailable",
        detail: "IndexedDB unavailable.",
      };
    }

    return this.clearInternal();
  }

  private async clearPersistedRecord(): Promise<boolean> {
    if (!this.available) {
      return false;
    }
    const result = await this.clearInternal();
    return result.outcome === "cleared";
  }

  private async clearInternal(): Promise<IndexStoreClearResult> {
    try {
      await this.adapter.removeRecord(this.vaultNamespace);
      return {
        outcome: "cleared",
      };
    } catch (error) {
      return {
        outcome: "failed",
        reason: "clear-failed",
        detail: normalizeErrorMessage(error),
      };
    }
  }

  private createRecord(metadata: IndexStoreNamespaceMetadata, payload: IndexStoreSerializedPayload): IndexStoreRecord {
    const normalizedMetadata: IndexStoreNamespaceMetadata = {
      ...metadata,
      vaultNamespace: this.vaultNamespace,
      documentCount: payload.documentCount,
      lastIndexedAt: payload.lastIndexedAt,
    };

    return {
      metadata: normalizedMetadata,
      serializedIndexJson: payload.serializedIndexJson,
    };
  }
}

function createUnavailableAdapter(error: unknown): IndexStoreStorageAdapter {
  const unavailableError = error instanceof Error ? error : new Error("IndexedDB unavailable.");
  return {
    async getRecord(): Promise<IndexStoreRecord | null> {
      throw unavailableError;
    },
    async setRecord(): Promise<void> {
      throw unavailableError;
    },
    async removeRecord(): Promise<void> {
      throw unavailableError;
    },
  };
}

function isValidRecord(value: unknown): value is IndexStoreRecord {
  if (!isRecord(value)) {
    return false;
  }

  if (!isRecord(value.metadata)) {
    return false;
  }

  if (typeof value.serializedIndexJson !== "string") {
    return false;
  }

  const metadata = value.metadata;
  return (
    typeof metadata.vaultNamespace === "string" &&
    typeof metadata.schemaVersion === "string" &&
    typeof metadata.tokenizerVersion === "string" &&
    typeof metadata.pluginVersion === "string" &&
    Number.isFinite(metadata.documentCount) &&
    Number.isFinite(metadata.lastIndexedAt)
  );
}

function matchesExpectedMetadata(stored: IndexStoreNamespaceMetadata, expected: IndexStoreNamespaceMetadata): boolean {
  return (
    stored.vaultNamespace === expected.vaultNamespace &&
    stored.schemaVersion === expected.schemaVersion &&
    stored.tokenizerVersion === expected.tokenizerVersion &&
    stored.pluginVersion === expected.pluginVersion
  );
}

function isQuotaError(error: unknown): boolean {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "QuotaExceededError";
  }

  if (error instanceof Error) {
    return error.name === "QuotaExceededError" || error.message.toLowerCase().includes("quota");
  }

  return false;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "Unknown storage error.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
