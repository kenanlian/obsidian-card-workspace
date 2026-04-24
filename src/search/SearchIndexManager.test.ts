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
    expect(seen).toEqual(["building", "building", "ready"]);
    expect(await manager.search("road", ["notes/a.md"])).toEqual(["notes/a.md"]);
  });

  it("marks rebuild-required on restore failures and keeps fallback-capable building snapshot", async () => {
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
    expect(snapshot.health.outcome).toBe("rebuild-required");
    expect(snapshot.health.rebuilding).toBe(true);
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
    expect(snapshot.health.healthy).toBe(false);
    expect(snapshot.health.outcome).toBe("failed");
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
    expect(snapshot.health.healthy).toBe(false);
    expect(snapshot.health.outcome).toBe("failed");
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

  it("escalates unsafe folder rename to rebuild-required", async () => {
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
    expect(manager.getSnapshot().health.outcome).toBe("rebuild-required");
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
  });
});
