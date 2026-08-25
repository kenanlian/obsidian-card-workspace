import { beforeEach, describe, expect, it, vi } from "vitest";
import MiniSearch from "minisearch";
import { SearchIndexManager, type SearchIndexDocumentSource } from "./SearchIndexManager";
import { createMiniSearchOptions } from "./minisearch-options";
import type {
  IndexStoreClearResult,
  IndexStoreNamespaceMetadata,
  IndexStoreRestoreResult,
  IndexStoreSerializedPayload,
  IndexStoreWriteResult,
} from "./IndexStore";
import { prepareSearchableDocument } from "./document-preparation";
import type { SearchableDocument, SearchVaultMutation } from "./types";

type SearchIndexManagerHealth = ReturnType<InstanceType<typeof SearchIndexManager>["getSnapshot"]>["health"];

function expectHealthSubset(
  actual: SearchIndexManagerHealth,
  expected: Partial<SearchIndexManagerHealth>,
): void {
  expect(actual).toMatchObject(expected);
}

interface FakeStore {
  restore: ReturnType<typeof vi.fn<() => Promise<IndexStoreRestoreResult>>>;
  write: ReturnType<typeof vi.fn<() => Promise<IndexStoreWriteResult>>>;
  clear: ReturnType<typeof vi.fn<() => Promise<IndexStoreClearResult>>>;
}

function createMetadata(overrides: Partial<IndexStoreNamespaceMetadata> = {}): IndexStoreNamespaceMetadata {
  return {
    vaultNamespace: "vault-a",
    schemaVersion: "schema-v1",
    tokenizerVersion: "tokenizer-v1",
    pluginVersion: "plugin-v1",
    documentCount: 0,
    lastIndexedAt: 0,
    ...overrides,
  };
}

function createDocument(path: string, title = path): SearchableDocument {
  return {
    path,
    title,
    normalizedTitle: title.toLowerCase(),
    content: `content for ${title}`,
    excerpt: `excerpt for ${title}`,
    folderPath: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
    mtime: 10,
    ctime: 5,
  };
}

function createSearchableDocument(
  path: string,
  title: string,
  content: string,
  excerpt = content.slice(0, 260),
): SearchableDocument {
  return {
    path,
    title,
    normalizedTitle: title.toLowerCase(),
    content,
    excerpt,
    folderPath: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
    mtime: 10,
    ctime: 5,
  };
}

function createStoreMock(
  result: IndexStoreRestoreResult = {
    outcome: "rebuild-required",
    reason: "missing",
    cleared: false,
    detail: null,
  },
): FakeStore {
  return {
    restore: vi.fn(async () => result),
    write: vi.fn(async () => ({ outcome: "written", bytes: 12 })),
    clear: vi.fn(async () => ({ outcome: "cleared" })),
  };
}

function createDocumentSource(initial: SearchableDocument[] = []): {
  source: SearchIndexDocumentSource;
  byPath: Map<string, SearchableDocument>;
  readAllDocuments: ReturnType<typeof vi.fn<() => Promise<SearchableDocument[]>>>;
  readDocument: ReturnType<typeof vi.fn<(path: string) => Promise<SearchableDocument | null>>>;
} {
  const byPath = new Map<string, SearchableDocument>();
  for (const document of initial) {
    byPath.set(document.path, document);
  }

  const readAllDocuments = vi.fn(async () => [...byPath.values()]);
  const readDocument = vi.fn(async (path: string) => byPath.get(path) ?? null);

  return {
    source: {
      readAllDocuments,
      readDocument,
    },
    byPath,
    readAllDocuments,
    readDocument,
  };
}

async function createSerializedIndex(documents: SearchableDocument[]): Promise<string> {
  const index = new MiniSearch<SearchableDocument>(createMiniSearchOptions());

  if (documents.length > 0) {
    await index.addAllAsync(documents);
  }

  return JSON.stringify(index.toJSON());
}

function createMutation(overrides: Partial<SearchVaultMutation> = {}): SearchVaultMutation {
  return {
    type: "modify",
    path: "notes/a.md",
    oldPath: null,
    isMarkdown: true,
    isFolder: false,
    ...overrides,
  };
}

function createLargeCorpusDocuments(count: number): SearchableDocument[] {
  return Array.from({ length: count }, (_, index) => {
    const segment = String(Math.floor(index / 20)).padStart(3, "0");
    const ordinal = String(index).padStart(4, "0");
    const title = index === 420 ? `Launch Dossier ${ordinal}` : `Vault Note ${ordinal}`;
    const uniqueToken = index === 420 ? "vaultneedle420" : `cluster-token-${index % 23}`;
    const content = [
      `Segment ${segment} planning notes for batch ${ordinal}.`,
      `topic-${index % 11} archive-${index % 7} ${uniqueToken}.`,
      index % 2 === 0 ? "status ready for first indexing." : "status staged for first indexing.",
    ].join(" ");

    return createSearchableDocument(
      `vault/segment-${segment}/note-${ordinal}.md`,
      title,
      content,
      `Preview ${ordinal} ${uniqueToken}`,
    );
  });
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("SearchIndexManager", () => {
  it("restores asynchronously and transitions snapshot from building to ready", async () => {
    const docs = [createDocument("notes/a.md", "Roadmap")];
    const serialized = await createSerializedIndex(docs);
    const store = createStoreMock({
      outcome: "restored",
      metadata: createMetadata({ documentCount: 1, lastIndexedAt: 111 }),
      payload: {
        serializedIndexJson: serialized,
        documentCount: 1,
        lastIndexedAt: 111,
      },
    });
    const { source } = createDocumentSource();
    const manager = new SearchIndexManager({
      store,
      documentSource: source,
    });
    const seen: string[] = [];
    manager.subscribe((snapshot) => seen.push(snapshot.status));

    const result = await manager.restore(createMetadata());

    expect(result).toEqual({
      status: "ready",
      outcome: "restored",
      detail: "Search index restored from persistent storage.",
    });
    expect(source.readAllDocuments).not.toHaveBeenCalled();
    expect(seen).toEqual(["building", "building", "ready"]);
    expectHealthSubset(manager.getSnapshot().health, {
      outcome: "restored",
      readiness: "ready",
      healthy: true,
      rebuilding: false,
      rebuildRequired: false,
      persistence: "healthy",
      documentCount: 1,
      lastIndexedAt: 111,
      rebuildReason: null,
      lastError: null,
      lastSuccessfulRestore: {
        outcome: "restored",
        at: 111,
        documentCount: 1,
        detail: "Search index restored from persistent storage.",
      },
    });
    expect(await manager.search("road", ["notes/a.md"])).toMatchObject({ orderedPaths: ["notes/a.md"] });
  });

  it("does not install a deserialized index or emit ready after disposal", async () => {
    const document = createDocument("notes/a.md", "Roadmap");
    const store = createStoreMock({
      outcome: "restored",
      metadata: createMetadata({ documentCount: 1 }),
      payload: { serializedIndexJson: "deferred", documentCount: 1, lastIndexedAt: 1 },
    });
    const manager = new SearchIndexManager({ store, documentSource: createDocumentSource().source });
    const initialIndex = (manager as unknown as { index: MiniSearch<SearchableDocument> }).index;
    const loadedIndex = new MiniSearch<SearchableDocument>(createMiniSearchOptions());
    loadedIndex.add(document);
    let resolveLoad!: (index: MiniSearch<SearchableDocument>) => void;
    const loadSpy = vi.spyOn(MiniSearch, "loadJSONAsync").mockImplementationOnce(
      () => new Promise((resolve) => { resolveLoad = resolve; }) as never,
    );
    const snapshots: string[] = [];
    manager.subscribe((snapshot) => snapshots.push(snapshot.status));
    const restoring = manager.restore(createMetadata());
    await vi.waitFor(() => expect(loadSpy).toHaveBeenCalledTimes(1));
    manager.dispose();
    const countAtDispose = snapshots.length;
    resolveLoad(loadedIndex);
    await restoring;
    expect((manager as unknown as { index: MiniSearch<SearchableDocument> }).index).toBe(initialIndex);
    expect(store.clear).not.toHaveBeenCalled();
    expect(snapshots).toHaveLength(countAtDispose);
    loadSpy.mockRestore();
  });

  it("does not start corrupt-index clearing when deserialization fails after disposal", async () => {
    const store = createStoreMock({
      outcome: "restored",
      metadata: createMetadata({ documentCount: 1 }),
      payload: { serializedIndexJson: "deferred failure", documentCount: 1, lastIndexedAt: 1 },
    });
    const manager = new SearchIndexManager({ store, documentSource: createDocumentSource().source });
    let rejectLoad!: (error: Error) => void;
    const loadSpy = vi.spyOn(MiniSearch, "loadJSONAsync").mockImplementationOnce(
      () => new Promise((_resolve, reject) => { rejectLoad = reject; }) as never,
    );
    const restoring = manager.restore(createMetadata());
    await vi.waitFor(() => expect(loadSpy).toHaveBeenCalledTimes(1));
    manager.dispose();
    rejectLoad(new Error("late corrupt payload"));
    await restoring;
    expect(store.clear).not.toHaveBeenCalled();
    expect(manager.getSnapshot().disposed).toBe(true);
    loadSpy.mockRestore();
  });

  it("defers document-state reconciliation until explicit sync after healthy restore", async () => {
    const docs = [createDocument("notes/a.md", "Roadmap")];
    const serialized = await createSerializedIndex(docs);
    const store = createStoreMock({
      outcome: "restored",
      metadata: createMetadata({ documentCount: 1, lastIndexedAt: 111 }),
      payload: {
        serializedIndexJson: serialized,
        documentCount: 1,
        lastIndexedAt: 111,
      },
    });
    const { source, readAllDocuments } = createDocumentSource(docs);
    const manager = new SearchIndexManager({
      store,
      documentSource: source,
    });

    const restoreResult = await manager.restore(createMetadata());

    expect(restoreResult).toEqual({
      status: "ready",
      outcome: "restored",
      detail: "Search index restored from persistent storage.",
    });
    expect(readAllDocuments).not.toHaveBeenCalled();
    expect(await manager.search("road", ["notes/a.md"])).toMatchObject({ orderedPaths: ["notes/a.md"] });

    await manager.syncDocumentStateFromSource();

    expect(readAllDocuments).toHaveBeenCalledTimes(1);
    expect(await manager.search("road", ["notes/a.md"])).toMatchObject({ orderedPaths: ["notes/a.md"] });
  });

  it("reconciles restored source create, modify, delete, and rename into the index and persisted restore", async () => {
    const oldDocuments = [
      createSearchableDocument("notes/modified.md", "Modified", "oldterm"),
      createSearchableDocument("notes/deleted.md", "Deleted", "deleteterm"),
      createSearchableDocument("notes/old-name.md", "Renamed", "renameterm"),
    ];
    const store = createStoreMock({
      outcome: "restored",
      metadata: createMetadata({ documentCount: 3, lastIndexedAt: 111 }),
      payload: { serializedIndexJson: await createSerializedIndex(oldDocuments), documentCount: 3, lastIndexedAt: 111 },
    });
    const sourceState = createDocumentSource([
      createSearchableDocument("notes/modified.md", "Modified", "newterm"),
      createSearchableDocument("notes/created.md", "Created", "createterm"),
      createSearchableDocument("notes/new-name.md", "Renamed", "renameterm"),
    ]);
    const manager = new SearchIndexManager({ store, documentSource: sourceState.source });
    await manager.restore(createMetadata());
    await manager.syncDocumentStateFromSource();
    const candidates = ["notes/modified.md", "notes/deleted.md", "notes/created.md", "notes/old-name.md", "notes/new-name.md"];
    expect(await manager.search("newterm", candidates)).toMatchObject({ orderedPaths: ["notes/modified.md"] });
    expect(await manager.search("deleteterm", candidates)).toMatchObject({ orderedPaths: [] });
    expect(await manager.search("createterm", candidates)).toMatchObject({ orderedPaths: ["notes/created.md"] });
    expect(await manager.search("renameterm", candidates)).toMatchObject({ orderedPaths: ["notes/new-name.md"] });

    const writes = store.write.mock.calls as unknown as Array<[IndexStoreNamespaceMetadata, IndexStoreSerializedPayload]>;
    const persisted = writes.at(-1)?.[1];
    expect(persisted).toBeDefined();
    const restored = new SearchIndexManager({
      store: createStoreMock({ outcome: "restored", metadata: createMetadata({ documentCount: 3 }), payload: persisted! }),
      documentSource: createDocumentSource().source,
    });
    await restored.restore(createMetadata());
    expect(await restored.search("newterm", candidates)).toMatchObject({ orderedPaths: ["notes/modified.md"] });
    expect(await restored.search("renameterm", candidates)).toMatchObject({ orderedPaths: ["notes/new-name.md"] });
  });

  it("journals scan mutations, drains deferred-write and final-cutover mutations once, and persists them", async () => {
    const original = createSearchableDocument("notes/original.md", "Original", "oldterm");
    const replacement = createSearchableDocument("notes/replacement.md", "Replacement", "replacementterm");
    const store = createStoreMock({
      outcome: "restored",
      metadata: createMetadata({ documentCount: 1 }),
      payload: { serializedIndexJson: await createSerializedIndex([original]), documentCount: 1, lastIndexedAt: 1 },
    });
    let releaseWrite!: () => void;
    store.write.mockImplementationOnce(() => new Promise((resolve) => {
      releaseWrite = () => resolve({ outcome: "written", bytes: 12 });
    }));
    const sourceState = createDocumentSource([replacement]);
    let releaseScan!: () => void;
    sourceState.readAllDocuments.mockImplementationOnce(() => new Promise((resolve) => {
      releaseScan = () => resolve([replacement]);
    }));
    const manager = new SearchIndexManager({ store, documentSource: sourceState.source });
    await manager.restore(createMetadata());
    const reconciliation = manager.syncDocumentStateFromSource();
    await vi.waitFor(() => expect(sourceState.readAllDocuments).toHaveBeenCalledTimes(1));

    const duringScan = createSearchableDocument("notes/during-scan.md", "Scan", "scanterm");
    sourceState.byPath.set(duringScan.path, duringScan);
    await manager.applyMutation(createMutation({ type: "create", path: duringScan.path }));
    releaseScan();
    await vi.waitFor(() => expect(store.write).toHaveBeenCalledTimes(1));

    const duringWrite = createSearchableDocument("notes/during-write.md", "Write", "writeterm");
    sourceState.byPath.set(duringWrite.path, duringWrite);
    const writeMutation = manager.applyMutation(createMutation({ type: "create", path: duringWrite.path }));
    releaseWrite();
    const atCutover = createSearchableDocument("notes/at-cutover.md", "Cutover", "cutoverterm");
    sourceState.byPath.set(atCutover.path, atCutover);
    const cutoverMutation = manager.applyMutation(createMutation({ type: "create", path: atCutover.path }));
    await Promise.all([reconciliation, writeMutation, cutoverMutation]);

    expect(store.write).toHaveBeenCalledTimes(2);
    const writes = store.write.mock.calls as unknown as Array<[IndexStoreNamespaceMetadata, IndexStoreSerializedPayload]>;
    const persisted = writes.at(-1)![1];
    expect(persisted.documentCount).toBe(4);
    const restored = new SearchIndexManager({
      store: createStoreMock({ outcome: "restored", metadata: createMetadata({ documentCount: 4 }), payload: persisted }),
      documentSource: createDocumentSource().source,
    });
    await restored.restore(createMetadata());
    const paths = [replacement.path, duringScan.path, duringWrite.path, atCutover.path];
    for (const [term, path] of [["replacementterm", replacement.path], ["scanterm", duringScan.path], ["writeterm", duringWrite.path], ["cutoverterm", atCutover.path]]) {
      expect(await restored.search(term, paths)).toMatchObject({ orderedPaths: [path] });
    }
  });

  it("does not replay a safe folder rename that is already queued behind cutover", async () => {
    const oldDocument = createSearchableDocument("notes/old/a.md", "Old", "folderterm");
    const blocker = createSearchableDocument("notes/blocker.md", "Blocker", "blockerterm");
    const store = createStoreMock({
      outcome: "restored",
      metadata: createMetadata({ documentCount: 2 }),
      payload: { serializedIndexJson: await createSerializedIndex([oldDocument, blocker]), documentCount: 2, lastIndexedAt: 1 },
    });
    const sourceState = createDocumentSource([oldDocument, blocker]);
    let releaseScan!: () => void;
    sourceState.readAllDocuments.mockImplementationOnce(() => new Promise((resolve) => {
      releaseScan = () => resolve([oldDocument, blocker]);
    }));
    let releaseBlocker!: () => void;
    let shouldBlock = true;
    sourceState.readDocument.mockImplementation(async (path) => {
      if (path === blocker.path && shouldBlock) {
        shouldBlock = false;
        await new Promise<void>((resolve) => { releaseBlocker = resolve; });
      }
      return sourceState.byPath.get(path) ?? null;
    });
    const manager = new SearchIndexManager({ store, documentSource: sourceState.source });
    await manager.restore(createMetadata());
    const reconciliation = manager.syncDocumentStateFromSource();
    await vi.waitFor(() => expect(sourceState.readAllDocuments).toHaveBeenCalledTimes(1));

    const blockingMutation = manager.applyMutation(createMutation({ path: blocker.path }));
    await vi.waitFor(() => expect(sourceState.readDocument).toHaveBeenCalledWith(blocker.path));
    releaseScan();
    const gate = (manager as unknown as { mutationGate: { waiters: unknown[] } }).mutationGate;
    await vi.waitFor(() => expect(gate.waiters).toHaveLength(1));
    const renamedDocument = { ...oldDocument, path: "notes/new/a.md", folderPath: "notes/new" };
    sourceState.byPath.delete(oldDocument.path);
    sourceState.byPath.set(renamedDocument.path, renamedDocument);
    const renameMutation = manager.applyMutation(createMutation({
      type: "rename", oldPath: "notes/old", path: "notes/new", isFolder: true, isMarkdown: false,
    }));
    await vi.waitFor(() => expect(gate.waiters).toHaveLength(2));
    releaseBlocker();
    await Promise.all([reconciliation, blockingMutation, renameMutation]);

    expect(sourceState.readAllDocuments).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot()).toMatchObject({ status: "ready", health: { rebuildRequired: false } });
    expect(await manager.search("folderterm", [oldDocument.path, renamedDocument.path])).toMatchObject({
      orderedPaths: [renamedDocument.path],
    });
  });

  it("keeps the restored live index on deferred replacement failure and re-persists queued mutations", async () => {
    const original = createSearchableDocument("notes/original.md", "Original", "oldterm");
    const replacement = createSearchableDocument("notes/replacement.md", "Replacement", "newterm");
    const store = createStoreMock({
      outcome: "restored",
      metadata: createMetadata({ documentCount: 1 }),
      payload: { serializedIndexJson: await createSerializedIndex([original]), documentCount: 1, lastIndexedAt: 1 },
    });
    let failWrite!: () => void;
    store.write.mockImplementationOnce(() => new Promise((resolve) => {
      failWrite = () => resolve({ outcome: "failed", reason: "write-failed", detail: "replacement failed" });
    }));
    const sourceState = createDocumentSource([replacement]);
    const manager = new SearchIndexManager({ store, documentSource: sourceState.source });
    await manager.restore(createMetadata());
    const reconciliation = manager.syncDocumentStateFromSource();
    await vi.waitFor(() => expect(store.write).toHaveBeenCalledTimes(1));
    const queued = createSearchableDocument("notes/queued.md", "Queued", "queuedterm");
    sourceState.byPath.set(queued.path, queued);
    const mutation = manager.applyMutation(createMutation({ type: "create", path: queued.path }));
    failWrite();
    await Promise.all([reconciliation, mutation]);

    expect(manager.getSnapshot()).toMatchObject({ status: "error", health: { persistence: "write-failed" } });
    expect(store.write).toHaveBeenCalledTimes(2);
    const writes = store.write.mock.calls as unknown as Array<[IndexStoreNamespaceMetadata, IndexStoreSerializedPayload]>;
    const persisted = writes.at(-1)![1];
    const restored = new SearchIndexManager({
      store: createStoreMock({ outcome: "restored", metadata: createMetadata({ documentCount: 2 }), payload: persisted }),
      documentSource: createDocumentSource().source,
    });
    await restored.restore(createMetadata());
    const paths = [original.path, replacement.path, queued.path];
    expect(await restored.search("oldterm", paths)).toMatchObject({ orderedPaths: [original.path] });
    expect(await restored.search("newterm", paths)).toMatchObject({ orderedPaths: [] });
    expect(await restored.search("queuedterm", paths)).toMatchObject({ orderedPaths: [queued.path] });
  });

  it("queues rebuild behind reconciliation without overlapping source scans", async () => {
    const document = createSearchableDocument("notes/a.md", "A", "term");
    const store = createStoreMock({
      outcome: "restored",
      metadata: createMetadata({ documentCount: 1 }),
      payload: { serializedIndexJson: await createSerializedIndex([document]), documentCount: 1, lastIndexedAt: 1 },
    });
    const sourceState = createDocumentSource([document]);
    let active = 0;
    let peak = 0;
    let releaseFirst!: () => void;
    sourceState.readAllDocuments.mockImplementationOnce(() => new Promise((resolve) => {
      active += 1;
      peak = Math.max(peak, active);
      releaseFirst = () => { active -= 1; resolve([document]); };
    })).mockImplementationOnce(async () => {
      active += 1;
      peak = Math.max(peak, active);
      active -= 1;
      return [document];
    });
    const manager = new SearchIndexManager({ store, documentSource: sourceState.source });
    await manager.restore(createMetadata());
    const reconciliation = manager.syncDocumentStateFromSource();
    const rebuild = manager.rebuildFromSource("queued rebuild");
    await vi.waitFor(() => expect(sourceState.readAllDocuments).toHaveBeenCalledTimes(1));
    expect(peak).toBe(1);
    releaseFirst();
    await Promise.all([reconciliation, rebuild]);
    expect(sourceState.readAllDocuments).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
  });

  it("discards restored documents on pre-sync delete without forcing source reconciliation", async () => {
    const docs = [createDocument("notes/a.md", "Roadmap")];
    const serialized = await createSerializedIndex(docs);
    const store = createStoreMock({
      outcome: "restored",
      metadata: createMetadata({ documentCount: 1, lastIndexedAt: 111 }),
      payload: {
        serializedIndexJson: serialized,
        documentCount: 1,
        lastIndexedAt: 111,
      },
    });
    const { source, byPath, readAllDocuments } = createDocumentSource(docs);
    const manager = new SearchIndexManager({
      store,
      documentSource: source,
    });

    await manager.restore(createMetadata());

    byPath.delete("notes/a.md");
    await manager.applyMutation(createMutation({ type: "delete", path: "notes/a.md" }));

    expect(readAllDocuments).not.toHaveBeenCalled();
    expect(await manager.search("roadmap", ["notes/a.md"])).toMatchObject({ orderedPaths: [] });
    expectHealthSubset(manager.getSnapshot().health, {
      documentCount: 0,
    });
    await manager.flushPendingPersist();
    expect(store.write).toHaveBeenLastCalledWith(
      expect.objectContaining({ documentCount: 0 }),
      expect.objectContaining({ documentCount: 0 }),
    );
  });

  it("discards old restored path on pre-sync file rename without forcing source reconciliation", async () => {
    const docs = [createDocument("notes/a.md", "Roadmap")];
    const serialized = await createSerializedIndex(docs);
    const store = createStoreMock({
      outcome: "restored",
      metadata: createMetadata({ documentCount: 1, lastIndexedAt: 111 }),
      payload: {
        serializedIndexJson: serialized,
        documentCount: 1,
        lastIndexedAt: 111,
      },
    });
    const { source, byPath, readAllDocuments } = createDocumentSource(docs);
    const manager = new SearchIndexManager({
      store,
      documentSource: source,
    });

    await manager.restore(createMetadata());

    byPath.delete("notes/a.md");
    byPath.set("notes/renamed.md", createDocument("notes/renamed.md", "Roadmap"));
    await manager.applyMutation(
      createMutation({
        type: "rename",
        oldPath: "notes/a.md",
        path: "notes/renamed.md",
        isFolder: false,
      }),
    );

    expect(readAllDocuments).not.toHaveBeenCalled();
    expect(await manager.search("roadmap", ["notes/a.md", "notes/renamed.md"])).toMatchObject({ orderedPaths: ["notes/renamed.md"] });
    expectHealthSubset(manager.getSnapshot().health, {
      documentCount: 1,
    });
    await manager.flushPendingPersist();
    expect(store.write).toHaveBeenLastCalledWith(
      expect.objectContaining({ documentCount: 1 }),
      expect.objectContaining({ documentCount: 1 }),
    );
  });

  it("coalesces consecutive incremental mutations into a single index write", async () => {
    const docs = [createDocument("notes/a.md", "Roadmap"), createDocument("notes/b.md", "Backlog")];
    const serialized = await createSerializedIndex(docs);
    const store = createStoreMock({
      outcome: "restored",
      metadata: createMetadata({ documentCount: 2, lastIndexedAt: 111 }),
      payload: {
        serializedIndexJson: serialized,
        documentCount: 2,
        lastIndexedAt: 111,
      },
    });
    const { source, byPath } = createDocumentSource(docs);
    const manager = new SearchIndexManager({
      store,
      documentSource: source,
    });

    await manager.restore(createMetadata());
    store.write.mockClear();

    byPath.delete("notes/a.md");
    await manager.applyMutation(createMutation({ type: "delete", path: "notes/a.md" }));
    byPath.set("notes/c.md", createDocument("notes/c.md", "Checklist"));
    await manager.applyMutation(createMutation({ type: "create", path: "notes/c.md" }));
    await manager.applyMutation(createMutation({ type: "modify", path: "notes/b.md" }));

    expect(store.write).not.toHaveBeenCalled();
    // The in-memory index stays authoritative while the write is pending.
    expectHealthSubset(manager.getSnapshot().health, { documentCount: 2 });

    await manager.flushPendingPersist();

    expect(store.write).toHaveBeenCalledTimes(1);
    expect(store.write).toHaveBeenLastCalledWith(
      expect.objectContaining({ documentCount: 2 }),
      expect.objectContaining({ documentCount: 2 }),
    );
  });

  it("rewrites restored folder paths before sync without forcing source reconciliation", async () => {
    const docs = [
      createDocument("notes/projects/a.md", "Roadmap"),
      createDocument("notes/projects/sub/b.md", "Checklist"),
    ];
    const serialized = await createSerializedIndex(docs);
    const store = createStoreMock({
      outcome: "restored",
      metadata: createMetadata({ documentCount: 2, lastIndexedAt: 111 }),
      payload: {
        serializedIndexJson: serialized,
        documentCount: 2,
        lastIndexedAt: 111,
      },
    });
    const { source, readAllDocuments } = createDocumentSource(docs);
    const manager = new SearchIndexManager({
      store,
      documentSource: source,
    });

    await manager.restore(createMetadata());

    const result = await manager.applyMutation(
      createMutation({
        type: "rename",
        isFolder: true,
        isMarkdown: false,
        oldPath: "notes/projects",
        path: "notes/initiatives",
        renameClassification: "folder-safe-prefix-rewrite",
      }),
    );

    expect(result).toEqual({ action: "applied", rebuildRequired: false });
    expect(readAllDocuments).not.toHaveBeenCalled();
    expect(await manager.search("roadmap", ["notes/projects/a.md", "notes/initiatives/a.md"])).toMatchObject({ orderedPaths: [
      "notes/initiatives/a.md",
    ] });
    expect(await manager.search("checklist", [
      "notes/projects/sub/b.md",
      "notes/initiatives/sub/b.md",
    ])).toMatchObject({ orderedPaths: ["notes/initiatives/sub/b.md"] });
    expectHealthSubset(manager.getSnapshot().health, {
      documentCount: 2,
    });
  });

  it("marks rebuild-required when restored folder rewrite cannot be safely applied", async () => {
    const docs = [
      createDocument("notes/projects/a.md", "Roadmap"),
      createDocument("notes/initiatives/a.md", "Existing"),
    ];
    const serialized = await createSerializedIndex(docs);
    const store = createStoreMock({
      outcome: "restored",
      metadata: createMetadata({ documentCount: 2, lastIndexedAt: 111 }),
      payload: {
        serializedIndexJson: serialized,
        documentCount: 2,
        lastIndexedAt: 111,
      },
    });
    const { source, readAllDocuments } = createDocumentSource(docs);
    const manager = new SearchIndexManager({
      store,
      documentSource: source,
    });

    await manager.restore(createMetadata());

    const result = await manager.applyMutation(
      createMutation({
        type: "rename",
        isFolder: true,
        isMarkdown: false,
        oldPath: "notes/projects",
        path: "notes/initiatives",
        renameClassification: "folder-safe-prefix-rewrite",
      }),
    );

    expect(result).toEqual({ action: "rebuild-required", rebuildRequired: true });
    expect(readAllDocuments).not.toHaveBeenCalled();
    expect(manager.getSnapshot().status).toBe("building");
    expectHealthSubset(manager.getSnapshot().health, {
      outcome: "rebuild-required",
      readiness: "rebuild-required",
      healthy: false,
      rebuilding: true,
      rebuildRequired: true,
      rebuildReason: "folder-rebuild-required",
      detail: "Folder rename could not be safely rewritten from restored index metadata; full rebuild required.",
    });
  });

  it("marks rebuild-required on restore failures with explicit rebuild health", async () => {
    const store = createStoreMock({
      outcome: "rebuild-required",
      reason: "version-drift",
      cleared: true,
      detail: "Persisted index metadata version drift detected.",
    });
    const { source } = createDocumentSource();
    const manager = new SearchIndexManager({ store, documentSource: source });

    const result = await manager.restore(createMetadata());

    expect(result).toEqual({
      status: "building",
      outcome: "rebuild-required",
      detail: "Persisted index metadata version drift detected.",
    });
    const snapshot = manager.getSnapshot();
    expect(snapshot.status).toBe("building");
    expectHealthSubset(snapshot.health, {
      outcome: "rebuild-required",
      readiness: "rebuild-required",
      healthy: false,
      rebuilding: true,
      rebuildRequired: true,
      persistence: "healthy",
      documentCount: null,
      lastIndexedAt: null,
      rebuildReason: "version-drift",
      lastError: null,
    });
  });

  it("clears storage and requests rebuild when persisted payload cannot load", async () => {
    const store = createStoreMock({
      outcome: "restored",
      metadata: createMetadata({ documentCount: 1, lastIndexedAt: 12 }),
      payload: {
        serializedIndexJson: "{not-json}",
        documentCount: 1,
        lastIndexedAt: 12,
      },
    });
    const { source } = createDocumentSource();
    const manager = new SearchIndexManager({ store, documentSource: source });

    const result = await manager.restore(createMetadata());

    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe("rebuild-required");
    expect(manager.getSnapshot().status).toBe("building");
    expectHealthSubset(manager.getSnapshot().health, {
      outcome: "rebuild-required",
      readiness: "rebuild-required",
      rebuildRequired: true,
      persistence: "read-failed",
      rebuildReason: "load-failed",
    });
  });

  it("marks storage-unavailable restore state explicitly when persistent storage is unavailable", async () => {
    const store = createStoreMock({
      outcome: "rebuild-required",
      reason: "unavailable",
      cleared: false,
      detail: "IndexedDB unavailable.",
    });
    const { source } = createDocumentSource();
    const manager = new SearchIndexManager({ store, documentSource: source });

    const result = await manager.restore(createMetadata());

    expect(result).toEqual({
      status: "building",
      outcome: "rebuild-required",
      detail: "IndexedDB unavailable.",
    });
    expectHealthSubset(manager.getSnapshot().health, {
      outcome: "rebuild-required",
      readiness: "rebuild-required",
      rebuildRequired: true,
      persistence: "storage-unavailable",
      rebuildReason: "storage-unavailable",
      detail: "IndexedDB unavailable.",
    });
  });

  it("marks read-failed restore state explicitly when storage reads fail", async () => {
    const store = createStoreMock({
      outcome: "rebuild-required",
      reason: "read-failed",
      cleared: false,
      detail: "boom",
    });
    const { source } = createDocumentSource();
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());

    expectHealthSubset(manager.getSnapshot().health, {
      outcome: "rebuild-required",
      readiness: "rebuild-required",
      rebuildRequired: true,
      persistence: "read-failed",
      rebuildReason: "read-failed",
      detail: "boom",
    });
  });

  it("publishes health snapshot fields after clear/reset and blocks queries until rebuild", async () => {
    const docs = [createDocument("notes/a.md", "Roadmap")];
    const store = createStoreMock();
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial build");

    const result = await manager.clearAndReset("Manual clear/reset command requested.");

    expect(result).toEqual({ outcome: "cleared" });
    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(manager.getSnapshot().status).toBe("building");
    expectHealthSubset(manager.getSnapshot().health, {
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
      detail: "Manual clear/reset command requested.",
    });
    expect(manager.getSnapshot().health.lastSuccessfulBuild).toEqual(
      expect.objectContaining({
        outcome: "rebuilt",
        documentCount: 1,
      }),
    );
    expect(await manager.search("road", ["notes/a.md"])).toMatchObject({ orderedPaths: [] });
  });

  it("publishes health error state when clear/reset cannot clear storage", async () => {
    const store = createStoreMock();
    store.clear.mockResolvedValueOnce({
      outcome: "failed",
      reason: "unavailable",
      detail: "IndexedDB unavailable.",
    });
    const { source } = createDocumentSource([createDocument("notes/a.md", "Roadmap")]);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial build");
    const result = await manager.clearAndReset("Manual clear/reset command requested.");

    expect(result).toEqual({
      outcome: "failed",
      reason: "unavailable",
      detail: "IndexedDB unavailable.",
    });
    expect(manager.getSnapshot().status).toBe("error");
    expectHealthSubset(manager.getSnapshot().health, {
      outcome: "failed",
      readiness: "error",
      healthy: false,
      rebuilding: false,
      rebuildRequired: false,
      persistence: "storage-unavailable",
      rebuildReason: "storage-unavailable",
      lastError: "IndexedDB unavailable.",
      detail: "IndexedDB unavailable.",
    });
  });

  it("builds from canonical documents and persists rebuilt index", async () => {
    const docs = [createDocument("notes/a.md", "Roadmap"), createDocument("notes/b.md", "Checklist")];
    const store = createStoreMock();
    const { source, readAllDocuments } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial background build");

    expect(readAllDocuments).toHaveBeenCalledTimes(1);
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(await manager.search("road", ["notes/a.md", "notes/b.md"])).toMatchObject({ orderedPaths: ["notes/a.md"] });
    expect(manager.getSnapshot().status).toBe("ready");
    expectHealthSubset(manager.getSnapshot().health, {
      outcome: "rebuilt",
      readiness: "ready",
      healthy: true,
      rebuilding: false,
      rebuildRequired: false,
      persistence: "healthy",
      documentCount: 2,
      rebuildReason: null,
    });
  });

  it("retrieves contiguous Han text from titles and Markdown content without false AND matches", async () => {
    const docs = [
      createSearchableDocument("notes/title.md", "中华人民共和国", "title fixture"),
      createSearchableDocument("notes/content.md", "Reference", "这里记录中华人民共和国的资料"),
      createSearchableDocument("notes/separated.md", "Distractor", "人民各自出现，随后共和"),
    ];
    const store = createStoreMock();
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial Han build");

    const candidates = docs.map(({ path }) => path);
    expect(await manager.search("华人民", candidates)).toMatchObject({
      orderedPaths: ["notes/title.md", "notes/content.md"],
    });
    expect(await manager.search("人民共和", candidates)).toMatchObject({
      orderedPaths: ["notes/title.md", "notes/content.md"],
    });
    expect(await manager.search("华", candidates)).toMatchObject({
      orderedPaths: ["notes/title.md", "notes/content.md"],
    });
  });

  it("restores Han postings and keeps them current across incremental mutations and candidate bounds", async () => {
    const original = createSearchableDocument("notes/original.md", "中国资料", "中华人民共和国");
    const serialized = await createSerializedIndex([original]);
    const store = createStoreMock({
      outcome: "restored",
      metadata: createMetadata({ documentCount: 1, lastIndexedAt: 111 }),
      payload: { serializedIndexJson: serialized, documentCount: 1, lastIndexedAt: 111 },
    });
    const { source, byPath } = createDocumentSource([original]);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.syncDocumentStateFromSource();
    expect(await manager.search("人民共和", [original.path])).toMatchObject({ orderedPaths: [original.path] });
    expect(await manager.search("人民共和", [])).toMatchObject({ orderedPaths: [] });

    const modified = createSearchableDocument(original.path, "更新", "中文搜索已替换旧内容");
    byPath.set(original.path, modified);
    await manager.applyMutation(createMutation({ type: "modify", path: original.path }));
    expect(await manager.search("人民共和", [original.path])).toMatchObject({ orderedPaths: [] });
    expect(await manager.search("中文搜索", [original.path])).toMatchObject({ orderedPaths: [original.path] });

    const created = createSearchableDocument("notes/created.md", "新增中华人民共和国", "created");
    byPath.set(created.path, created);
    await manager.applyMutation(createMutation({ type: "create", path: created.path }));
    expect(await manager.search("人民共和", [original.path, created.path])).toMatchObject({ orderedPaths: [created.path] });

    byPath.delete(created.path);
    byPath.set("notes/renamed.md", { ...created, path: "notes/renamed.md" });
    await manager.applyMutation(createMutation({
      type: "rename",
      oldPath: created.path,
      path: "notes/renamed.md",
    }));
    expect(await manager.search("人民共和", [created.path, "notes/renamed.md"])).toMatchObject({
      orderedPaths: ["notes/renamed.md"],
    });

    byPath.delete("notes/renamed.md");
    await manager.applyMutation(createMutation({ type: "delete", path: "notes/renamed.md" }));
    expect(await manager.search("人民共和", ["notes/renamed.md"])).toMatchObject({ orderedPaths: [] });
  });

  it("combines Han and non-Han query terms while retaining English prefix and case behavior", async () => {
    const docs = [
      createSearchableDocument("notes/mixed.md", "中文 Roadmap", "release plan"),
      createSearchableDocument("notes/han-only.md", "中文", "unrelated"),
      createSearchableDocument("notes/english-only.md", "ROADMAP", "unrelated"),
    ];
    const store = createStoreMock();
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Mixed query build");

    expect(await manager.search("中文 road", docs.map(({ path }) => path))).toMatchObject({
      orderedPaths: ["notes/mixed.md"],
    });
  });

  it("first-indexes a deterministic large corpus with usable search state", async () => {
    const docs = createLargeCorpusDocuments(640);
    const store = createStoreMock();
    const { source, readAllDocuments } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });
    const targetPath = "vault/segment-021/note-0420.md";

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial large-vault build");

    expect(readAllDocuments).toHaveBeenCalledTimes(1);
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(await manager.search("launch dossier vaultneedle420", docs.map((document) => document.path))).toEqual({
      orderedPaths: [targetPath],
      matchCountsByPath: {
        [targetPath]: 3,
      },
    });
    expectHealthSubset(manager.getSnapshot().health, {
      outcome: "rebuilt",
      readiness: "ready",
      healthy: true,
      rebuilding: false,
      rebuildRequired: false,
      persistence: "healthy",
      documentCount: 640,
      rebuildReason: null,
    });
    expect(manager.getSnapshot().health.lastSuccessfulBuild).toEqual(expect.objectContaining({
      outcome: "rebuilt",
      documentCount: 640,
      detail: "Initial large-vault build",
    }));
  });

  it("recovers from a queued large-vault folder rename during first indexing", async () => {
    const docs = createLargeCorpusDocuments(640);
    const store = createStoreMock();
    const { source, byPath, readAllDocuments } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });
    const oldPrefix = "vault/segment-021";
    const newPrefix = "vault/archive/segment-021";
    const oldTargetPath = "vault/segment-021/note-0420.md";
    const newTargetPath = "vault/archive/segment-021/note-0420.md";

    await manager.restore(createMetadata());

    let releaseBuild: () => void = () => undefined;
    readAllDocuments.mockImplementationOnce(
      () =>
        new Promise<SearchableDocument[]>((resolve) => {
          releaseBuild = () => resolve([...byPath.values()]);
        }),
    );

    const buildPromise = manager.rebuildFromSource("Initial large-vault build");

    for (const document of docs.filter(({ path }) => path.startsWith(`${oldPrefix}/`))) {
      byPath.delete(document.path);
      const rewrittenPath = document.path.replace(oldPrefix, newPrefix);
      byPath.set(rewrittenPath, {
        ...document,
        path: rewrittenPath,
        folderPath: rewrittenPath.slice(0, rewrittenPath.lastIndexOf("/")),
      });
    }

    expect(
      await manager.applyMutation(
        createMutation({
          type: "rename",
          oldPath: oldPrefix,
          path: newPrefix,
          isFolder: true,
          isMarkdown: false,
          renameClassification: "folder-rebuild-required",
        }),
      ),
    ).toEqual({ action: "ignored", rebuildRequired: false });

    releaseBuild();
    await buildPromise;

    expect(readAllDocuments).toHaveBeenCalledTimes(2);
    expect(store.write).toHaveBeenCalledTimes(2);
    expect(await manager.search("launch dossier vaultneedle420", [oldTargetPath, newTargetPath])).toEqual({
      orderedPaths: [newTargetPath],
      matchCountsByPath: {
        [newTargetPath]: 3,
      },
    });
    expectHealthSubset(manager.getSnapshot().health, {
      outcome: "rebuilt",
      readiness: "ready",
      healthy: true,
      rebuilding: false,
      rebuildRequired: false,
      persistence: "healthy",
      documentCount: 640,
      rebuildReason: null,
    });
    expect(manager.getSnapshot().health.lastSuccessfulBuild).toEqual(expect.objectContaining({
      outcome: "rebuilt",
      documentCount: 640,
      detail: "Rebuild requested after queued mutations.",
    }));
  });

  it("indexes non-Markdown documents by title only without matching path folder tokens", async () => {
    const docs = [
      createSearchableDocument("Assets/Project Brief.pdf", "Project Brief", ""),
    ];
    const store = createStoreMock();
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial build");

    expect(await manager.search("project brief", ["Assets/Project Brief.pdf"])).toMatchObject({ orderedPaths: [
      "Assets/Project Brief.pdf",
    ] });
    expect(await manager.search("assets", ["Assets/Project Brief.pdf"])).toMatchObject({ orderedPaths: [] });
  });

  it("indexes markdown content independently of title and path text", async () => {
    const docs = [
      createSearchableDocument("notes/Status Update.md", "Status Update", "A uniquely-indexed shimmerword appears here."),
    ];
    const store = createStoreMock();
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial build");

    expect(await manager.search("shimmerword", ["notes/Status Update.md"])).toMatchObject({ orderedPaths: [
      "notes/Status Update.md",
    ] });
  });

  it("indexes fenced flow report and report_summary markdown content without path tokens", async () => {
    const docs = [
      prepareSearchableDocument({
        path: "notes/Fenced Report.md",
        title: "Code Fence Alpha",
        markdown: "```sh\nflow report\n```",
        mtime: 10,
        ctime: 5,
      }),
      prepareSearchableDocument({
        path: "notes/Report Summary.md",
        title: "Code Fence Beta",
        markdown: "```sh\n./report_summary\n```",
        mtime: 10,
        ctime: 5,
      }),
      prepareSearchableDocument({
        path: "notes/Control.md",
        title: "Control",
        markdown: "Nothing relevant here.",
        mtime: 10,
        ctime: 5,
      }),
    ];
    const store = createStoreMock();
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial build");

    expect(await manager.search("report", [
      "notes/Fenced Report.md",
      "notes/Report Summary.md",
      "notes/Control.md",
    ])).toMatchObject({ orderedPaths: [
      "notes/Report Summary.md",
      "notes/Fenced Report.md",
    ] });
    expect(await manager.search("summary", [
      "notes/Fenced Report.md",
      "notes/Report Summary.md",
      "notes/Control.md",
    ])).toMatchObject({ orderedPaths: [
      "notes/Report Summary.md",
    ] });
    expect(await manager.search("notes", [
      "notes/Fenced Report.md",
      "notes/Report Summary.md",
      "notes/Control.md",
    ])).toMatchObject({ orderedPaths: [] });
  });

  it("preserves current MiniSearch ranking for candidate-bounded meeting queries", async () => {
    const docs = [
      createSearchableDocument("Notes/Meeting.md", "Meeting", "weekly meeting agenda"),
      createSearchableDocument("Notes/Meeting Followup.md", "Meeting Followup", "meeting decisions and followup"),
      createSearchableDocument("Notes/Other.md", "Other", "meeting notes reference"),
      createSearchableDocument("Archive/Global Meeting Index.md", "Meeting Index", "meeting archive index"),
    ];
    const store = createStoreMock();
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial build");

    expect(await manager.search("meeting", [
      "Notes/Meeting.md",
      "Notes/Meeting Followup.md",
      "Notes/Other.md",
    ])).toMatchObject({ orderedPaths: [
      "Notes/Meeting.md",
      "Notes/Meeting Followup.md",
      "Notes/Other.md",
    ] });
  });

  it("preserves current MiniSearch tie ordering when identical documents score equally", async () => {
    const docs = [
      createSearchableDocument("Notes/A.md", "Equal", "shared token"),
      createSearchableDocument("Notes/B.md", "Equal", "shared token"),
      createSearchableDocument("Notes/C.md", "Other", "shared token"),
    ];
    const store = createStoreMock();
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial build");

    expect(await manager.search("equal", ["Notes/A.md", "Notes/B.md", "Notes/C.md"])).toMatchObject({ orderedPaths: [
      "Notes/A.md",
      "Notes/B.md",
    ] });
    expect(await manager.search("shared token", ["Notes/A.md", "Notes/B.md", "Notes/C.md"])).toMatchObject({ orderedPaths: [
      "Notes/A.md",
      "Notes/B.md",
      "Notes/C.md",
    ] });
  });

  it("returns match count metadata for unique query tokens across title and content", async () => {
    const docs = [
      createSearchableDocument(
        "notes/alpha.md",
        "Alpha",
        "alpha alpha beta",
      ),
    ];
    const store = createStoreMock();
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial build");

    expect(await manager.search("alpha beta alpha", ["notes/alpha.md"])).toEqual({
      orderedPaths: ["notes/alpha.md"],
      matchCountsByPath: {
        "notes/alpha.md": 4,
      },
    });

    expect(await manager.search("alpha", ["notes/alpha.md"])).toEqual({
      orderedPaths: ["notes/alpha.md"],
      matchCountsByPath: {
        "notes/alpha.md": 3,
      },
    });
  });

  it("returns match count metadata with non-overlapping literal occurrences", async () => {
    const docs = [
      createSearchableDocument("notes/aa.md", "Marker", "aaa"),
    ];
    const store = createStoreMock();
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial build");

    expect(await manager.search("aa", ["notes/aa.md"])).toEqual({
      orderedPaths: ["notes/aa.md"],
      matchCountsByPath: {
        "notes/aa.md": 1,
      },
    });
  });

  it("counts display literals rather than Han postings, including mixed and supplementary Han terms", async () => {
    const supplementaryHan = "𠀀";
    const docs = [
      createSearchableDocument(
        "notes/han-counts.md",
        "中文搜索",
        `中文搜索中文搜索 华华 ${supplementaryHan}${supplementaryHan} search SEARCH`,
      ),
    ];
    const store = createStoreMock();
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Han count build");

    expect(await manager.search("中文搜索", [docs[0].path])).toEqual({
      orderedPaths: [docs[0].path],
      matchCountsByPath: { [docs[0].path]: 3 },
    });
    expect(await manager.search("华", [docs[0].path])).toEqual({
      orderedPaths: [docs[0].path],
      matchCountsByPath: { [docs[0].path]: 2 },
    });
    expect(await manager.search(supplementaryHan, [docs[0].path])).toEqual({
      orderedPaths: [docs[0].path],
      matchCountsByPath: { [docs[0].path]: 2 },
    });
    expect(await manager.search("中文-search", [docs[0].path])).toEqual({
      orderedPaths: [docs[0].path],
      matchCountsByPath: { [docs[0].path]: 5 },
    });
  });

  it("builds case-insensitive match count metadata only for candidate-bounded results", async () => {
    const docs = [
      createSearchableDocument(
        "notes/alpha.md",
        "Alpha",
        "ALPHA alpha beta",
      ),
      createSearchableDocument(
        "notes/outside.md",
        "Alpha Outside",
        "alpha beta alpha beta",
      ),
    ];
    const store = createStoreMock();
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial build");

    expect(await manager.search("  ALPHA beta alpha  ", ["notes/alpha.md"])).toEqual({
      orderedPaths: ["notes/alpha.md"],
      matchCountsByPath: {
        "notes/alpha.md": 4,
      },
    });
  });

  it("omits match count metadata for empty queries while preserving candidate ordering", async () => {
    const docs = [
      createSearchableDocument("notes/a.md", "Alpha", "beta gamma"),
      createSearchableDocument("notes/b.md", "Beta", "alpha gamma"),
    ];
    const store = createStoreMock();
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial build");

    expect(await manager.search("   ", ["notes/b.md", "notes/a.md"])).toMatchObject({ orderedPaths: ["notes/b.md", "notes/a.md"] });
  });

  it("matches markdown title and markdown content without using path-only tokens", async () => {
    const docs = [
      createSearchableDocument("notes/Status Update.md", "Status Update", "A uniquely-indexed shimmerword appears here."),
    ];
    const store = createStoreMock();
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial build");

    expect(await manager.search("status update", ["notes/Status Update.md"])).toMatchObject({ orderedPaths: [
      "notes/Status Update.md",
    ] });
    expect(await manager.search("shimmerword", ["notes/Status Update.md"])).toMatchObject({ orderedPaths: [
      "notes/Status Update.md",
    ] });
    expect(await manager.search("notes", ["notes/Status Update.md"])).toMatchObject({ orderedPaths: [] });
  });

  it("keeps non-markdown search title-only with no path-token or content-like matches", async () => {
    const docs = [
      createSearchableDocument("Assets/Project Brief.pdf", "Project Brief", ""),
    ];
    const store = createStoreMock();
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial build");

    expect(await manager.search("project brief", ["Assets/Project Brief.pdf"])).toMatchObject({ orderedPaths: [
      "Assets/Project Brief.pdf",
    ] });
    expect(await manager.search("brief", ["Assets/Project Brief.pdf"])).toMatchObject({ orderedPaths: [
      "Assets/Project Brief.pdf",
    ] });
    expect(await manager.search("assets", ["Assets/Project Brief.pdf"])).toMatchObject({ orderedPaths: [] });
    expect(await manager.search("body", ["Assets/Project Brief.pdf"])).toMatchObject({ orderedPaths: [] });
  });

  it("keeps error state when rebuild persistence write fails", async () => {
    const docs = [createDocument("notes/a.md", "Roadmap")];
    const store = createStoreMock();
    store.write.mockResolvedValueOnce({
      outcome: "failed",
      reason: "write-failed",
      detail: "disk full",
    });
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });
    const seen: string[] = [];
    manager.subscribe((snapshot) => seen.push(snapshot.status));

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("rebuild for failure path");

    const snapshot = manager.getSnapshot();
    expect(snapshot.status).toBe("error");
    expectHealthSubset(snapshot.health, {
      outcome: "failed",
      readiness: "error",
      healthy: false,
      rebuilding: false,
      rebuildRequired: false,
      persistence: "write-failed",
      lastError: "disk full",
    });
    expect(snapshot.lastError).toBe("disk full");
    expect(seen.at(-1)).toBe("error");
  });

  it("does not publish ready from markRebuilt when persistence write fails", async () => {
    const store = createStoreMock();
    const { source } = createDocumentSource();
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    store.write.mockResolvedValueOnce({
      outcome: "failed",
      reason: "quota",
      detail: "quota exceeded",
    });

    await manager.markRebuilt(3, 123);

    const snapshot = manager.getSnapshot();
    expect(snapshot.status).toBe("error");
    expectHealthSubset(snapshot.health, {
      outcome: "failed",
      readiness: "error",
      healthy: false,
      rebuilding: false,
      rebuildRequired: false,
      persistence: "write-failed",
      lastError: "quota exceeded",
    });
    expect(snapshot.lastError).toBe("quota exceeded");
  });

  it("applies create/modify/delete/file-rename mutations incrementally", async () => {
    const initial = [createDocument("notes/a.md", "Roadmap")];
    const store = createStoreMock();
    const { source, byPath } = createDocumentSource(initial);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource();

    byPath.set("notes/new.md", createDocument("notes/new.md", "Migration Plan"));
    await manager.applyMutation(createMutation({ type: "create", path: "notes/new.md" }));
    expect(await manager.search("migration", ["notes/new.md", "notes/a.md"])).toMatchObject({ orderedPaths: ["notes/new.md"] });

    byPath.set("notes/new.md", createDocument("notes/new.md", "Migration Updated"));
    await manager.applyMutation(createMutation({ type: "modify", path: "notes/new.md" }));
    expect(await manager.search("updated", ["notes/new.md"])).toMatchObject({ orderedPaths: ["notes/new.md"] });

    await manager.applyMutation(createMutation({ type: "delete", path: "notes/new.md" }));
    expect(await manager.search("updated", ["notes/new.md"])).toMatchObject({ orderedPaths: [] });

    byPath.delete("notes/a.md");
    byPath.set("notes/renamed.md", createDocument("notes/renamed.md", "Roadmap"));
    await manager.applyMutation(
      createMutation({
        type: "rename",
        oldPath: "notes/a.md",
        path: "notes/renamed.md",
        isFolder: false,
      }),
    );
    expect(await manager.search("roadmap", ["notes/a.md", "notes/renamed.md"])).toMatchObject({ orderedPaths: ["notes/renamed.md"] });
  });

  it("applies non-Markdown create/modify/delete/rename mutations through applyMutation title-only paths", async () => {
    const store = createStoreMock();
    const { source, byPath } = createDocumentSource();
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource();

    byPath.set(
      "Assets/Project Brief.pdf",
      createSearchableDocument("Assets/Project Brief.pdf", "Project Brief", ""),
    );
    await manager.applyMutation(
      createMutation({
        type: "create",
        path: "Assets/Project Brief.pdf",
        isMarkdown: false,
      }),
    );
    expect(await manager.search("project brief", ["Assets/Project Brief.pdf"])).toMatchObject({ orderedPaths: [
      "Assets/Project Brief.pdf",
    ] });

    byPath.set(
      "Assets/Project Brief.pdf",
      createSearchableDocument("Assets/Project Brief.pdf", "Project Brief v2", ""),
    );
    await manager.applyMutation(
      createMutation({
        type: "modify",
        path: "Assets/Project Brief.pdf",
        isMarkdown: false,
      }),
    );
    expect(await manager.search("project brief v2", ["Assets/Project Brief.pdf"])).toMatchObject({ orderedPaths: [
      "Assets/Project Brief.pdf",
    ] });

    byPath.delete("Assets/Project Brief.pdf");
    await manager.applyMutation(
      createMutation({
        type: "delete",
        path: "Assets/Project Brief.pdf",
        isMarkdown: false,
      }),
    );
    expect(await manager.search("project brief v2", ["Assets/Project Brief.pdf"])).toMatchObject({ orderedPaths: [] });

    byPath.set(
      "Assets/Archive.pdf",
      createSearchableDocument("Assets/Archive.pdf", "Project Brief", ""),
    );
    await manager.applyMutation(
      createMutation({
        type: "rename",
        oldPath: "Assets/Project Brief.pdf",
        path: "Assets/Archive.pdf",
        isFolder: false,
        isMarkdown: false,
      }),
    );
    expect(await manager.search("project brief", ["Assets/Archive.pdf"])).toMatchObject({ orderedPaths: [
      "Assets/Archive.pdf",
    ] });
    expect(await manager.search("project brief", ["Assets/Project Brief.pdf"])).toMatchObject({ orderedPaths: [] });
    expect(await manager.search("archive", ["Assets/Archive.pdf"])).toMatchObject({ orderedPaths: [] });
  });

  it("removes indexed markdown document when rename target is no longer markdown-indexable", async () => {
    const initial = [createDocument("notes/a.md", "Roadmap")];
    const store = createStoreMock();
    const { source, byPath } = createDocumentSource(initial);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource();

    byPath.delete("notes/a.md");
    await manager.applyMutation(
      createMutation({
        type: "rename",
        oldPath: "notes/a.md",
        path: "notes/a.canvas",
        isFolder: false,
        isMarkdown: true,
      }),
    );

    expect(await manager.search("roadmap", ["notes/a.md", "notes/a.canvas"])).toMatchObject({ orderedPaths: [] });
  });

  it("rewrites folder paths for safe folder renames", async () => {
    const initial = [
      createDocument("notes/projects/a.md", "Roadmap"),
      createDocument("notes/projects/sub/b.md", "Checklist"),
    ];
    const store = createStoreMock();
    const { source } = createDocumentSource(initial);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource();

    const result = await manager.applyMutation(
      createMutation({
        type: "rename",
        isFolder: true,
        isMarkdown: false,
        oldPath: "notes/projects",
        path: "notes/initiatives",
        renameClassification: "folder-safe-prefix-rewrite",
      }),
    );

    expect(result).toEqual({ action: "applied", rebuildRequired: false });
    expect(await manager.search("roadmap", ["notes/initiatives/a.md"])).toMatchObject({ orderedPaths: ["notes/initiatives/a.md"] });
    expect(await manager.search("checklist", ["notes/initiatives/sub/b.md"])).toMatchObject({ orderedPaths: ["notes/initiatives/sub/b.md"] });
  });

  it("escalates unsafe folder rename to rebuild-required with explicit rebuild reason", async () => {
    const initial = [createDocument("notes/a.md", "Roadmap")];
    const store = createStoreMock();
    const { source } = createDocumentSource(initial);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource();

    const result = await manager.applyMutation(
      createMutation({
        type: "rename",
        isFolder: true,
        isMarkdown: false,
        oldPath: "notes",
        path: "notes/archive",
        renameClassification: "folder-rebuild-required",
      }),
    );

    expect(result).toEqual({ action: "rebuild-required", rebuildRequired: true });
    expect(manager.getSnapshot().status).toBe("building");
    expectHealthSubset(manager.getSnapshot().health, {
      outcome: "rebuild-required",
      readiness: "rebuild-required",
      rebuildRequired: true,
      rebuildReason: "folder-rebuild-required",
      healthy: false,
      rebuilding: true,
    });
  });

  it("queues/coalesces mutations during active full build", async () => {
    const initial = [createDocument("notes/a.md", "Roadmap")];
    const store = createStoreMock();
    const { source, byPath, readAllDocuments } = createDocumentSource(initial);
    const manager = new SearchIndexManager({ store, documentSource: source });
    await manager.restore(createMetadata());

    let releaseBuild: () => void = () => undefined;
    readAllDocuments.mockImplementationOnce(
      () =>
        new Promise<SearchableDocument[]>((resolve) => {
          releaseBuild = () => resolve([...byPath.values()]);
        }),
    );

    const buildPromise = manager.rebuildFromSource("long build");

    byPath.set("notes/new.md", createDocument("notes/new.md", "Queue Mutation"));
    const queued = await manager.applyMutation(createMutation({ type: "create", path: "notes/new.md" }));
    expect(queued).toEqual({ action: "ignored", rebuildRequired: false });

    releaseBuild();
    await buildPromise;
    expect(await manager.search("queue", ["notes/new.md"])).toMatchObject({ orderedPaths: ["notes/new.md"] });
    expectHealthSubset(manager.getSnapshot().health, {
      outcome: "rebuilt",
      readiness: "ready",
      healthy: true,
      rebuildRequired: false,
      documentCount: 2,
    });
  });
});
