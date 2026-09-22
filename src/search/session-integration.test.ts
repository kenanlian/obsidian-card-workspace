import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class TFile {
    path = "";
    basename = "";
    stat = { ctime: 1, mtime: 1, size: 0 };
  },
}));

import { TFile } from "obsidian";
import { IndexStore, type IndexStoreNamespaceMetadata, type IndexStoreStorageAdapter } from "./IndexStore";
import { SearchIndexManager } from "./SearchIndexManager";
import { prepareSearchDocument, SearchDocumentSource } from "../services/SearchDocumentSource";

const VAULT_NAMESPACE = "path:/vault/integration";

function createMetadata(): IndexStoreNamespaceMetadata {
  return {
    vaultNamespace: VAULT_NAMESPACE,
    schemaVersion: "phase3-v2",
    tokenizerVersion: "search-text-v3-han-bigram",
    pluginVersion: "1.2.5",
    documentCount: 0,
    lastIndexedAt: 0,
  };
}

/**
 * Stands in for Chromium IndexedDB. `structuredClone` is deliberate: it is what
 * the real adapter does to the record, so a payload that is not plain
 * structured-cloneable data fails here rather than only in Obsidian.
 */
function createMemoryAdapter(): {
  adapter: IndexStoreStorageAdapter;
  setRecord: ReturnType<typeof vi.fn<(key: string, value: unknown) => Promise<void>>>;
  indexWrites: () => number;
} {
  const records = new Map<string, unknown>();
  const setRecord = vi.fn(async (key: string, value: unknown) => {
    records.set(key, structuredClone(value));
  });
  return {
    adapter: {
      getRecord: async (key: string) => {
        const value = records.get(key);
        return value === undefined ? undefined : structuredClone(value);
      },
      setRecord,
      removeRecord: async (key: string) => {
        records.delete(key);
      },
    },
    setRecord,
    indexWrites: () => setRecord.mock.calls.filter(([key]) => key === VAULT_NAMESPACE).length,
  };
}

interface FakeVaultFile {
  path: string;
  markdown: string;
  mtime: number;
}

/** Minimal vault: enough for real enumeration, real `cachedRead`, and real preparation. */
function createFakeVault(files: FakeVaultFile[]) {
  const state = new Map(files.map((file) => [file.path, { ...file }]));

  const toTFile = (entry: FakeVaultFile): TFile => {
    const file = new TFile();
    file.path = entry.path;
    file.basename = entry.path.slice(entry.path.lastIndexOf("/") + 1).replace(/\.md$/, "");
    file.stat = { ctime: 1, mtime: entry.mtime, size: entry.markdown.length };
    return file;
  };

  const cachedRead = vi.fn(async (file: TFile) => state.get(file.path)?.markdown ?? "");

  const app = {
    vault: {
      getFiles: () => [...state.values()].map(toTFile),
      cachedRead,
      getAbstractFileByPath: (path: string) => {
        const entry = state.get(path);
        return entry ? toTFile(entry) : null;
      },
    },
  };

  return {
    app,
    cachedRead,
    edit(path: string, markdown: string, mtime: number): void {
      state.set(path, { path, markdown, mtime });
    },
  };
}

function createSession(vault: ReturnType<typeof createFakeVault>, adapter: IndexStoreStorageAdapter) {
  const store = new IndexStore({ adapter, vaultNamespace: VAULT_NAMESPACE });
  const source = new SearchDocumentSource(
    vault.app as never,
    (file) => prepareSearchDocument(vault.app as never, file),
  );
  return new SearchIndexManager({ store, documentSource: source });
}

const CORPUS: FakeVaultFile[] = [
  { path: "notes/alpha.md", markdown: "# Alpha\n\nintegrationneedle appears here once.", mtime: 100 },
  { path: "notes/beta.md", markdown: "# Beta\n\nintegrationneedle and integrationneedle twice.", mtime: 200 },
  { path: "notes/han.md", markdown: "# 汉字\n\n索引哨兵内容。", mtime: 300 },
  { path: "notes/plain.md", markdown: "# Plain\n\nnothing of interest.", mtime: 400 },
  { path: "assets/diagram.png", markdown: "", mtime: 500 },
];

const CARD_PATHS = CORPUS.filter(({ path }) => path.endsWith(".md")).map(({ path }) => path);

beforeEach(() => {
  vi.useRealTimers();
  vi.stubGlobal("window", globalThis);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("search index session lifecycle", () => {
  it("builds, then restores an unchanged vault without writing, then rewrites after a real edit", async () => {
    const vault = createFakeVault(CORPUS);
    const storage = createMemoryAdapter();

    // Session A — cold start with no persisted record.
    const sessionA = createSession(vault, storage.adapter);
    const restoreA = await sessionA.restore(createMetadata());
    expect(restoreA.outcome).toBe("rebuild-required");
    await sessionA.rebuildFromSource("integration cold build");
    expect(sessionA.getSnapshot().status).toBe("ready");
    expect(storage.indexWrites()).toBe(1);

    const persisted = (await storage.adapter.getRecord(VAULT_NAMESPACE)) as {
      documentCatalog?: Record<string, number>;
      metadata: IndexStoreNamespaceMetadata;
    };
    // Attachments must never reach the index or the catalog.
    expect(Object.keys(persisted.documentCatalog ?? {}).sort()).toEqual([...CARD_PATHS].sort());
    expect(persisted.metadata.documentCount).toBe(CARD_PATHS.length);

    const latinA = await sessionA.search("integrationneedle", CARD_PATHS);
    const hanA = await sessionA.search("索引哨兵", CARD_PATHS);
    expect(latinA.orderedPaths.length).toBeGreaterThan(0);
    expect(hanA.orderedPaths).toEqual(["notes/han.md"]);

    // Session B — same vault, same storage, brand new manager.
    const sessionB = createSession(vault, storage.adapter);
    const restoreB = await sessionB.restore(createMetadata());
    expect(restoreB.outcome).toBe("restored");
    const writesBeforeReconcile = storage.indexWrites();
    vault.cachedRead.mockClear();
    await sessionB.syncDocumentStateFromSource();

    // R1/C4: an unchanged vault performs no write at all.
    expect(storage.indexWrites()).toBe(writesBeforeReconcile);
    expect(sessionB.getSnapshot().health.lastIndexedAt).toBe(persisted.metadata.lastIndexedAt);
    // C5: the read pass still runs, which is what keeps match counts alive.
    expect(vault.cachedRead).toHaveBeenCalled();
    expect(await sessionB.search("integrationneedle", CARD_PATHS)).toEqual(latinA);
    expect(await sessionB.search("索引哨兵", CARD_PATHS)).toEqual(hanA);

    // Session C — one file genuinely changed on disk.
    vault.edit("notes/plain.md", "# Plain\n\nnow contains integrationneedle and freshtoken.", 999);
    const sessionC = createSession(vault, storage.adapter);
    expect((await sessionC.restore(createMetadata())).outcome).toBe("restored");
    const writesBeforeChangedReconcile = storage.indexWrites();
    await sessionC.syncDocumentStateFromSource();

    expect(storage.indexWrites()).toBe(writesBeforeChangedReconcile + 1);
    expect((await sessionC.search("freshtoken", CARD_PATHS)).orderedPaths).toEqual(["notes/plain.md"]);
    const latinC = await sessionC.search("integrationneedle", CARD_PATHS);
    expect(latinC.orderedPaths).toContain("notes/plain.md");
    expect(latinC.matchCountsByPath?.["notes/plain.md"]).toBe(1);

    // The refreshed catalog still covers exactly the card files.
    const rewritten = (await storage.adapter.getRecord(VAULT_NAMESPACE)) as {
      documentCatalog?: Record<string, number>;
    };
    expect(Object.keys(rewritten.documentCatalog ?? {}).sort()).toEqual([...CARD_PATHS].sort());
    expect(rewritten.documentCatalog?.["notes/plain.md"]).toBe(999);
  });

  it("restores a legacy record with no catalog by reconciling once, then persists a catalog", async () => {
    const vault = createFakeVault(CORPUS);
    const storage = createMemoryAdapter();

    const seeded = createSession(vault, storage.adapter);
    await seeded.restore(createMetadata());
    await seeded.rebuildFromSource("seed build");

    // Strip the catalog to reproduce a record written before this feature.
    const record = (await storage.adapter.getRecord(VAULT_NAMESPACE)) as Record<string, unknown>;
    delete record.documentCatalog;
    await storage.adapter.setRecord(VAULT_NAMESPACE, record);
    const writesAfterSeed = storage.indexWrites();

    const legacy = createSession(vault, storage.adapter);
    expect((await legacy.restore(createMetadata())).outcome).toBe("restored");
    await legacy.syncDocumentStateFromSource();

    // Catalog-unavailable forces exactly today's full reconcile, which then
    // writes the catalog for the next session.
    expect(storage.indexWrites()).toBe(writesAfterSeed + 1);
    const healed = (await storage.adapter.getRecord(VAULT_NAMESPACE)) as {
      documentCatalog?: Record<string, number>;
    };
    expect(Object.keys(healed.documentCatalog ?? {}).sort()).toEqual([...CARD_PATHS].sort());

    const writesBeforeWarmReconcile = storage.indexWrites();
    const warm = createSession(vault, storage.adapter);
    await warm.restore(createMetadata());
    await warm.syncDocumentStateFromSource();
    expect(storage.indexWrites()).toBe(writesBeforeWarmReconcile);
  });
});
