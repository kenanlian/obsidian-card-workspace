import { describe, expect, it } from "vitest";
import {
  IndexStore,
  type IndexStoreNamespaceMetadata,
  type IndexStoreRecord,
  type IndexStoreRestoreResult,
  type IndexStoreSerializedPayload,
  type IndexStoreStorageAdapter,
} from "./IndexStore";

class MemoryIndexStoreAdapter implements IndexStoreStorageAdapter {
  private records = new Map<string, unknown>();

  async getRecord(key: string): Promise<IndexStoreRecord | null> {
    return this.records.has(key) ? (this.records.get(key) as IndexStoreRecord) : null;
  }

  async setRecord(key: string, value: IndexStoreRecord): Promise<void> {
    this.records.set(key, value);
  }

  async removeRecord(key: string): Promise<void> {
    this.records.delete(key);
  }

  setRawRecord(key: string, value: unknown): void {
    this.records.set(key, value);
  }
}

class FailingRemoveMemoryIndexStoreAdapter extends MemoryIndexStoreAdapter {
  override async removeRecord(_key: string): Promise<void> {
    throw new Error("record deletion failed");
  }
}

class ThrowingIndexStoreAdapter implements IndexStoreStorageAdapter {
  constructor(
    private readonly options: {
      getError?: Error;
      setError?: Error;
      removeError?: Error;
    },
  ) {}

  async getRecord(_key: string): Promise<IndexStoreRecord | null> {
    if (this.options.getError) {
      throw this.options.getError;
    }
    return null;
  }

  async setRecord(_key: string, _value: IndexStoreRecord): Promise<void> {
    if (this.options.setError) {
      throw this.options.setError;
    }
  }

  async removeRecord(_key: string): Promise<void> {
    if (this.options.removeError) {
      throw this.options.removeError;
    }
  }
}

function createMetadata(overrides: Partial<IndexStoreNamespaceMetadata> = {}): IndexStoreNamespaceMetadata {
  return {
    vaultNamespace: "vault-a",
    schemaVersion: "schema-v1",
    tokenizerVersion: "tokenizer-v1",
    pluginVersion: "plugin-v1",
    documentCount: 4,
    lastIndexedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function createPayload(overrides: Partial<IndexStoreSerializedPayload> = {}): IndexStoreSerializedPayload {
  return {
    serializedIndexJson: "{\"version\":1}",
    documentCount: 4,
    lastIndexedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("IndexStore", () => {
  it("restores when only the diagnostic plugin version differs", async () => {
    const adapter = new MemoryIndexStoreAdapter();
    const store = new IndexStore({ adapter, vaultNamespace: "vault-a" });
    await store.write(createMetadata({ pluginVersion: "plugin-old" }), createPayload());
    const restore = await store.restore(createMetadata({ pluginVersion: "plugin-new" }));
    expect(restore.outcome).toBe("restored");
  });

  it("restores persisted record when metadata versions match", async () => {
    const adapter = new MemoryIndexStoreAdapter();
    const store = new IndexStore({
      adapter,
      vaultNamespace: "vault-a",
    });
    const metadata = createMetadata();
    const payload = createPayload({ serializedIndexJson: "{\"documents\":42}" });

    const write = await store.write(metadata, payload);
    const restore = await store.restore(metadata);

    expect(write).toEqual({
      outcome: "written",
      bytes: expect.any(Number),
    });
    expect(restore).toEqual({
      outcome: "restored",
      metadata: {
        ...metadata,
        documentCount: payload.documentCount,
        lastIndexedAt: payload.lastIndexedAt,
      },
      payload,
    });
  });

  it("returns rebuild-required missing when no record exists", async () => {
    const store = new IndexStore({
      adapter: new MemoryIndexStoreAdapter(),
      vaultNamespace: "vault-a",
    });

    const restore = await store.restore(createMetadata());

    expect(restore).toEqual({
      outcome: "rebuild-required",
      reason: "missing",
      cleared: false,
      detail: null,
    });
  });

  it("returns rebuild-required version-drift and clears stale records", async () => {
    const adapter = new MemoryIndexStoreAdapter();
    const store = new IndexStore({
      adapter,
      vaultNamespace: "vault-a",
    });

    await store.write(createMetadata(), createPayload());
    const restore = await store.restore(createMetadata({ schemaVersion: "schema-v2" }));
    const afterClear = await store.restore(createMetadata());

    expect(restore).toEqual({
      outcome: "rebuild-required",
      reason: "version-drift",
      cleared: true,
      detail: "Persisted index metadata version drift detected.",
    });
    expect(afterClear).toEqual({
      outcome: "rebuild-required",
      reason: "missing",
      cleared: false,
      detail: null,
    });
  });

  it("returns rebuild-required version-drift when tokenizer metadata changes", async () => {
    const adapter = new MemoryIndexStoreAdapter();
    const store = new IndexStore({
      adapter,
      vaultNamespace: "vault-a",
    });

    await store.write(createMetadata({ tokenizerVersion: "search-text-v2" }), createPayload());
    const restore = await store.restore(createMetadata({ tokenizerVersion: "search-text-v3-han-bigram" }));

    expect(restore).toEqual({
      outcome: "rebuild-required",
      reason: "version-drift",
      cleared: true,
      detail: "Persisted index metadata version drift detected.",
    });
  });

  it("rejects tokenizer-drift payload when best-effort stale-record clearing fails", async () => {
    const adapter = new FailingRemoveMemoryIndexStoreAdapter();
    const store = new IndexStore({ adapter, vaultNamespace: "vault-a" });

    await store.write(createMetadata({ tokenizerVersion: "search-text-v2" }), createPayload());
    const currentMetadata = createMetadata({ tokenizerVersion: "search-text-v3-han-bigram" });
    const restore = await store.restore(currentMetadata);
    const retry = await store.restore(currentMetadata);

    expect(restore).toEqual({
      outcome: "rebuild-required",
      reason: "version-drift",
      cleared: false,
      detail: "Persisted index metadata version drift detected.",
    });
    expect(retry).toEqual(restore);
  });

  it("returns rebuild-required corrupt when persisted payload has invalid shape", async () => {
    const adapter = new MemoryIndexStoreAdapter();
    adapter.setRawRecord("vault-a", {
      metadata: createMetadata(),
      serializedIndexJson: 42,
    });
    const store = new IndexStore({
      adapter,
      vaultNamespace: "vault-a",
    });

    const restore = await store.restore(createMetadata());

    expect(restore).toEqual({
      outcome: "rebuild-required",
      reason: "corrupt",
      cleared: true,
      detail: "Persisted index record has invalid shape.",
    });
  });

  it("returns rebuild-required read-failed when storage read throws", async () => {
    const store = new IndexStore({
      adapter: new ThrowingIndexStoreAdapter({ getError: new Error("boom") }),
      vaultNamespace: "vault-a",
    });

    const restore = await store.restore(createMetadata());

    expect(restore).toEqual({
      outcome: "rebuild-required",
      reason: "read-failed",
      cleared: false,
      detail: "boom",
    });
  });

  it("returns typed write failures for quota errors", async () => {
    const quotaError = new Error("quota exceeded");
    quotaError.name = "QuotaExceededError";

    const store = new IndexStore({
      adapter: new ThrowingIndexStoreAdapter({ setError: quotaError }),
      vaultNamespace: "vault-a",
    });

    const result = await store.write(createMetadata(), createPayload());

    expect(result).toEqual({
      outcome: "failed",
      reason: "quota",
      detail: "quota exceeded",
    });
  });

  it("clears records and returns typed clear outcome", async () => {
    const adapter = new MemoryIndexStoreAdapter();
    const store = new IndexStore({
      adapter,
      vaultNamespace: "vault-a",
    });

    await store.write(createMetadata(), createPayload());
    const clearResult = await store.clear();
    const restoreResult = await store.restore(createMetadata());

    expect(clearResult).toEqual({ outcome: "cleared" });
    expect(restoreResult).toEqual({
      outcome: "rebuild-required",
      reason: "missing",
      cleared: false,
      detail: null,
    });
  });

  it("degrades to unavailable outcomes when IndexedDB is not available", async () => {
    const store = new IndexStore({
      indexedDbFactory: null,
      vaultNamespace: "vault-a",
    });

    const restore = await store.restore(createMetadata());
    const write = await store.write(createMetadata(), createPayload());
    const clear = await store.clear();

    expect(restore).toEqual({
      outcome: "rebuild-required",
      reason: "unavailable",
      cleared: false,
      detail: "IndexedDB unavailable.",
    });
    expect(write).toEqual({
      outcome: "failed",
      reason: "unavailable",
      detail: "IndexedDB unavailable.",
    });
    expect(clear).toEqual({
      outcome: "failed",
      reason: "unavailable",
      detail: "IndexedDB unavailable.",
    });
  });

  it("keeps restore outcome variants available for missing, drift, and corruption states", () => {
    const outcomes: IndexStoreRestoreResult[] = [
      { outcome: "rebuild-required", reason: "missing", cleared: false, detail: null },
      { outcome: "rebuild-required", reason: "version-drift", cleared: true, detail: "drift" },
      { outcome: "rebuild-required", reason: "corrupt", cleared: true, detail: "corrupt" },
    ];

    const labels = outcomes.map((entry) => {
      if (entry.outcome === "restored") {
        return "restored";
      }
      return `${entry.outcome}:${entry.reason}`;
    });

    expect(labels).toEqual([
      "rebuild-required:missing",
      "rebuild-required:version-drift",
      "rebuild-required:corrupt",
    ]);
  });
});
