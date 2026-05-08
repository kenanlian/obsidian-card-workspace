import { beforeEach, describe, expect, it, vi } from "vitest";
import MiniSearch from "minisearch";
import { SearchIndexManager, type SearchIndexDocumentSource } from "./SearchIndexManager";
import type {
  IndexStoreClearResult,
  IndexStoreNamespaceMetadata,
  IndexStoreRestoreResult,
  IndexStoreWriteResult,
} from "./IndexStore";
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
  const index = new MiniSearch<SearchableDocument>({
    idField: "path",
    fields: ["title", "content"],
    storeFields: ["path", "title", "excerpt"],
    processTerm: (term): string => term.toLowerCase(),
  });

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
    expect(await manager.search("road", ["notes/a.md"])).toEqual(["notes/a.md"]);
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
    expect(await manager.search("road", ["notes/a.md"])).toEqual(["notes/a.md"]);

    await manager.syncDocumentStateFromSource();

    expect(readAllDocuments).toHaveBeenCalledTimes(1);
    expect(await manager.search("road", ["notes/a.md"])).toEqual(["notes/a.md"]);
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
    expect(await manager.search("roadmap", ["notes/a.md"])).toEqual([]);
    expectHealthSubset(manager.getSnapshot().health, {
      documentCount: 0,
    });
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
    expect(await manager.search("roadmap", ["notes/a.md", "notes/renamed.md"])).toEqual(["notes/renamed.md"]);
    expectHealthSubset(manager.getSnapshot().health, {
      documentCount: 1,
    });
    expect(store.write).toHaveBeenLastCalledWith(
      expect.objectContaining({ documentCount: 1 }),
      expect.objectContaining({ documentCount: 1 }),
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
    expect(await manager.search("roadmap", ["notes/projects/a.md", "notes/initiatives/a.md"])).toEqual([
      "notes/initiatives/a.md",
    ]);
    expect(await manager.search("checklist", [
      "notes/projects/sub/b.md",
      "notes/initiatives/sub/b.md",
    ])).toEqual(["notes/initiatives/sub/b.md"]);
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
    expect(await manager.search("road", ["notes/a.md"])).toEqual([]);
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
    expect(await manager.search("road", ["notes/a.md", "notes/b.md"])).toEqual(["notes/a.md"]);
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

  it("indexes non-Markdown documents by title only without matching path folder tokens", async () => {
    const docs = [
      createSearchableDocument("Assets/Project Brief.pdf", "Project Brief", ""),
    ];
    const store = createStoreMock();
    const { source } = createDocumentSource(docs);
    const manager = new SearchIndexManager({ store, documentSource: source });

    await manager.restore(createMetadata());
    await manager.rebuildFromSource("Initial build");

    expect(await manager.search("project brief", ["Assets/Project Brief.pdf"])).toEqual([
      "Assets/Project Brief.pdf",
    ]);
    expect(await manager.search("assets", ["Assets/Project Brief.pdf"])).toEqual([]);
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

    expect(await manager.search("shimmerword", ["notes/Status Update.md"])).toEqual([
      "notes/Status Update.md",
    ]);
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
    ])).toEqual([
      "Notes/Meeting.md",
      "Notes/Meeting Followup.md",
      "Notes/Other.md",
    ]);
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

    expect(await manager.search("equal", ["Notes/A.md", "Notes/B.md", "Notes/C.md"])).toEqual([
      "Notes/A.md",
      "Notes/B.md",
    ]);
    expect(await manager.search("shared token", ["Notes/A.md", "Notes/B.md", "Notes/C.md"])).toEqual([
      "Notes/A.md",
      "Notes/B.md",
      "Notes/C.md",
    ]);
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

    expect(await manager.search("status update", ["notes/Status Update.md"])).toEqual([
      "notes/Status Update.md",
    ]);
    expect(await manager.search("shimmerword", ["notes/Status Update.md"])).toEqual([
      "notes/Status Update.md",
    ]);
    expect(await manager.search("notes", ["notes/Status Update.md"])).toEqual([]);
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

    expect(await manager.search("project brief", ["Assets/Project Brief.pdf"])).toEqual([
      "Assets/Project Brief.pdf",
    ]);
    expect(await manager.search("brief", ["Assets/Project Brief.pdf"])).toEqual([
      "Assets/Project Brief.pdf",
    ]);
    expect(await manager.search("assets", ["Assets/Project Brief.pdf"])).toEqual([]);
    expect(await manager.search("body", ["Assets/Project Brief.pdf"])).toEqual([]);
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
    expect(await manager.search("migration", ["notes/new.md", "notes/a.md"])).toEqual(["notes/new.md"]);

    byPath.set("notes/new.md", createDocument("notes/new.md", "Migration Updated"));
    await manager.applyMutation(createMutation({ type: "modify", path: "notes/new.md" }));
    expect(await manager.search("updated", ["notes/new.md"])).toEqual(["notes/new.md"]);

    await manager.applyMutation(createMutation({ type: "delete", path: "notes/new.md" }));
    expect(await manager.search("updated", ["notes/new.md"])).toEqual([]);

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
    expect(await manager.search("roadmap", ["notes/a.md", "notes/renamed.md"])).toEqual(["notes/renamed.md"]);
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
    expect(await manager.search("project brief", ["Assets/Project Brief.pdf"])).toEqual([
      "Assets/Project Brief.pdf",
    ]);

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
    expect(await manager.search("project brief v2", ["Assets/Project Brief.pdf"])).toEqual([
      "Assets/Project Brief.pdf",
    ]);

    byPath.delete("Assets/Project Brief.pdf");
    await manager.applyMutation(
      createMutation({
        type: "delete",
        path: "Assets/Project Brief.pdf",
        isMarkdown: false,
      }),
    );
    expect(await manager.search("project brief v2", ["Assets/Project Brief.pdf"])).toEqual([]);

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
    expect(await manager.search("project brief", ["Assets/Archive.pdf"])).toEqual([
      "Assets/Archive.pdf",
    ]);
    expect(await manager.search("project brief", ["Assets/Project Brief.pdf"])).toEqual([]);
    expect(await manager.search("archive", ["Assets/Archive.pdf"])).toEqual([]);
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

    expect(await manager.search("roadmap", ["notes/a.md", "notes/a.canvas"])).toEqual([]);
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
    expect(await manager.search("roadmap", ["notes/initiatives/a.md"])).toEqual(["notes/initiatives/a.md"]);
    expect(await manager.search("checklist", ["notes/initiatives/sub/b.md"])).toEqual(["notes/initiatives/sub/b.md"]);
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
    expect(await manager.search("queue", ["notes/new.md"])).toEqual(["notes/new.md"]);
    expectHealthSubset(manager.getSnapshot().health, {
      outcome: "rebuilt",
      readiness: "ready",
      healthy: true,
      rebuildRequired: false,
      documentCount: 2,
    });
  });
});
