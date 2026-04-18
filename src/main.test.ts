import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockSearchSnapshot {
  initialized: boolean;
  disposed: boolean;
  mode: "indexed" | "no-index";
  status: "ready" | "building" | "error";
  lastError: string | null;
  health: {
    outcome: "restored" | "rebuild-required" | "rebuilt" | "failed" | "none";
    healthy: boolean;
    rebuilding: boolean;
    documentCount: number | null;
    lastIndexedAt: number | null;
    detail: string | null;
  };
}

const searchMockState = vi.hoisted(() => {
  return {
    indexedInitializeShouldFail: false,
    restoreResult: {
      status: "ready",
      outcome: "restored",
      detail: "restored",
    } as {
      status: "ready" | "building";
      outcome: "restored" | "rebuild-required";
      detail: string | null;
    },
    currentSnapshot: {
      initialized: true,
      disposed: false,
      mode: "indexed",
      status: "ready",
      lastError: null,
      health: {
        outcome: "restored",
        healthy: true,
        rebuilding: false,
        documentCount: 10,
        lastIndexedAt: 1,
        detail: "restored",
      },
    } as MockSearchSnapshot,
    indexedServices: [] as Array<{
      initialize: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
      query: ReturnType<typeof vi.fn>;
      getSnapshot: ReturnType<typeof vi.fn>;
      subscribe: ReturnType<typeof vi.fn>;
      handleVaultMutation: ReturnType<typeof vi.fn>;
      emitSnapshot: (snapshot: MockSearchSnapshot) => void;
    }>,
    noIndexServices: [] as Array<{
      initialize: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
      query: ReturnType<typeof vi.fn>;
      getSnapshot: ReturnType<typeof vi.fn>;
      subscribe: ReturnType<typeof vi.fn>;
      handleVaultMutation: ReturnType<typeof vi.fn>;
    }>,
    managers: [] as Array<{
      restore: ReturnType<typeof vi.fn>;
      rebuildFromSource: ReturnType<typeof vi.fn>;
      getSnapshot: ReturnType<typeof vi.fn>;
      subscribe: ReturnType<typeof vi.fn>;
      initialize: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
      search: ReturnType<typeof vi.fn>;
      handleVaultMutation: ReturnType<typeof vi.fn>;
    }>,
    stores: [] as Array<{ vaultNamespace: string }>,
  };
});

const obsidianMockState = vi.hoisted(() => {
  return {
    layoutReadyCallback: null as (() => void) | null,
    workspaceOnCallback: null as ((file: unknown) => void) | null,
    vaultCallbacks: {} as Record<string, (...args: unknown[]) => void>,
    notices: [] as string[],
    leavesByType: {} as Record<string, unknown[]>,
  };
});

vi.mock("./search", () => {
  class MockIndexStore {
    vaultNamespace: string;

    constructor(options: { vaultNamespace: string }) {
      this.vaultNamespace = options.vaultNamespace;
      searchMockState.stores.push(this);
    }
  }

  class MockSearchIndexManager {
    restore = vi.fn(async () => searchMockState.restoreResult);
    rebuildFromSource = vi.fn(async () => undefined);
    getSnapshot = vi.fn(() => searchMockState.currentSnapshot);
    subscribe = vi.fn((listener: (snapshot: MockSearchSnapshot) => void) => {
      listener(searchMockState.currentSnapshot);
      return () => undefined;
    });
    initialize = vi.fn(async () => undefined);
    dispose = vi.fn(() => undefined);
    search = vi.fn(async () => [] as string[]);
    handleVaultMutation = vi.fn(() => undefined);

    constructor() {
      searchMockState.managers.push(this);
    }
  }

  class MockIndexedSearchService {
    private listeners = new Set<(snapshot: MockSearchSnapshot) => void>();

    initialize = vi.fn(async () => {
      if (searchMockState.indexedInitializeShouldFail) {
        throw new Error("indexed init failed");
      }
    });

    dispose = vi.fn(() => undefined);

    query = vi.fn(async () => {
      return {
        mode: "indexed",
        status: "ready",
        execution: "indexed-ordering",
        orderedPaths: [],
      };
    });
    getSnapshot = vi.fn(() => searchMockState.currentSnapshot);
    subscribe = vi.fn((listener: (snapshot: MockSearchSnapshot) => void) => {
      this.listeners.add(listener);
      listener(searchMockState.currentSnapshot);
      return () => {
        this.listeners.delete(listener);
      };
    });
    handleVaultMutation = vi.fn(() => undefined);

    emitSnapshot(snapshot: MockSearchSnapshot): void {
      searchMockState.currentSnapshot = snapshot;
      for (const listener of this.listeners) {
        listener(snapshot);
      }
    }

    constructor() {
      searchMockState.indexedServices.push(this);
    }
  }

  class MockNoIndexSearchService {
    initialize = vi.fn(async () => undefined);
    dispose = vi.fn(() => undefined);
    query = vi.fn(async () => {
      return {
        mode: "no-index",
        status: "ready",
        execution: "fallback-filtering",
        orderedPaths: null,
      };
    });
    getSnapshot = vi.fn(() => ({
      initialized: true,
      disposed: false,
      mode: "no-index",
      status: "ready",
      lastError: null,
      health: {
        outcome: "none",
        healthy: true,
        rebuilding: false,
        documentCount: null,
        lastIndexedAt: null,
        detail: null,
      },
    }));
    subscribe = vi.fn(() => () => undefined);
    handleVaultMutation = vi.fn(() => undefined);

    constructor() {
      searchMockState.noIndexServices.push(this);
    }
  }

  return {
    IndexStore: MockIndexStore,
    SearchIndexManager: MockSearchIndexManager,
    IndexedSearchService: MockIndexedSearchService,
    NoIndexSearchService: MockNoIndexSearchService,
    prepareSearchableDocument: vi.fn((input: { path: string; title: string; markdown: string; mtime: number; ctime: number }) => ({
      path: input.path,
      title: input.title,
      normalizedTitle: input.title.toLowerCase(),
      content: input.markdown,
      excerpt: input.markdown,
      folderPath: "",
      mtime: input.mtime,
      ctime: input.ctime,
    })),
  };
});

vi.mock("./FolderCardExplorerSettingTab", () => {
  return {
    FolderCardExplorerSettingTab: class MockFolderCardExplorerSettingTab {},
  };
});

vi.mock("./view/FolderCardView", () => {
  return {
    FOLDER_CARD_VIEW: "folder-card-view",
    FolderCardView: class MockFolderCardView {
      onSearchSnapshot = vi.fn();
      cleanupLifecycle(): void {}
      async handleFolderSelection(): Promise<{ action: "rejected_invalid"; folderPath: string; generationChanged: false; preserveUiState: true }> {
        return {
          action: "rejected_invalid",
          folderPath: "",
          generationChanged: false,
          preserveUiState: true,
        };
      }
      handleVaultMutation(): { shouldRefresh: false; queueAction: "ignored"; selectedFolderPathAfterRename: null; incrementalResult: null } {
        return {
          shouldRefresh: false,
          queueAction: "ignored",
          selectedFolderPathAfterRename: null,
          incrementalResult: null,
        };
      }
      setSelectedFile(): void {}
      getCurrentFolderPath(): string | null {
        return null;
      }
      async refresh(): Promise<{ action: "skipped_no_folder"; inFlightKey: null }> {
        return {
          action: "skipped_no_folder",
          inFlightKey: null,
        };
      }
    },
  };
});

vi.mock("obsidian", () => {
  class MockPlugin {
    app: unknown = null;
    registerView = vi.fn();
    addSettingTab = vi.fn();
    addCommand = vi.fn();
    registerDomEvent = vi.fn();
    registerEvent = vi.fn((eventRef: unknown) => eventRef);
    register = vi.fn((_cb: () => void) => undefined);
    loadData = vi.fn(async () => null);
    saveData = vi.fn(async () => undefined);
  }

  class MockNotice {
    constructor(message: string) {
      obsidianMockState.notices.push(message);
    }
  }

  class MockTAbstractFile {
    path: string;

    constructor(path: string) {
      this.path = path;
    }
  }

  class MockTFile extends MockTAbstractFile {
    extension = "md";
    basename: string;
    stat = {
      ctime: 1,
      mtime: 1,
    };

    constructor(path = "") {
      super(path);
      const leaf = path.split("/").at(-1) ?? "";
      this.basename = leaf.endsWith(".md") ? leaf.slice(0, -3) : leaf;
    }
  }

  class MockTFolder extends MockTAbstractFile {
    name: string;
    children: unknown[] = [];

    constructor(path: string) {
      super(path);
      this.name = path === "" ? "/" : path;
    }
  }

  const debounce = (callback: () => void) => {
    const debounced = (() => {
      callback();
    }) as (() => void) & { cancel: ReturnType<typeof vi.fn> };
    debounced.cancel = vi.fn();
    return debounced;
  };

  return {
    Plugin: MockPlugin,
    Notice: MockNotice,
    MarkdownView: class MockMarkdownView {
      leaf: unknown;

      constructor(leaf: unknown) {
        this.leaf = leaf;
      }
    },
    TAbstractFile: MockTAbstractFile,
    TFile: MockTFile,
    TFolder: MockTFolder,
    WorkspaceLeaf: class MockWorkspaceLeaf {},
    debounce,
  };
});

import { TFile, TFolder } from "obsidian";
import FolderCardExplorerPlugin from "./main";
import { FolderCardView } from "./view/FolderCardView";

function createPluginHarness(): {
  plugin: FolderCardExplorerPlugin;
  app: {
    workspace: {
      on: ReturnType<typeof vi.fn>;
      onLayoutReady: ReturnType<typeof vi.fn>;
      getActiveFile: ReturnType<typeof vi.fn>;
      getLeavesOfType: ReturnType<typeof vi.fn>;
      detachLeavesOfType: ReturnType<typeof vi.fn>;
      getActiveViewOfType: ReturnType<typeof vi.fn>;
      getLeaf: ReturnType<typeof vi.fn>;
      getRightLeaf: ReturnType<typeof vi.fn>;
      revealLeaf: ReturnType<typeof vi.fn>;
    };
    vault: {
      on: ReturnType<typeof vi.fn>;
      getAbstractFileByPath: ReturnType<typeof vi.fn>;
      getRoot: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      getMarkdownFiles: ReturnType<typeof vi.fn>;
      cachedRead: ReturnType<typeof vi.fn>;
      adapter: { basePath: string };
      getName: ReturnType<typeof vi.fn>;
    };
  };
} {
  const app = {
    workspace: {
      on: vi.fn((_eventName: string, callback: (file: unknown) => void) => {
        obsidianMockState.workspaceOnCallback = callback;
        return { eventName: "workspace" };
      }),
      onLayoutReady: vi.fn((callback: () => void) => {
        obsidianMockState.layoutReadyCallback = callback;
        callback();
      }),
      getActiveFile: vi.fn(() => null),
      getLeavesOfType: vi.fn((type: string) => obsidianMockState.leavesByType[type] ?? []),
      detachLeavesOfType: vi.fn(),
      getActiveViewOfType: vi.fn(() => null),
      getLeaf: vi.fn(() => ({ openFile: vi.fn(async () => undefined) })),
      getRightLeaf: vi.fn(() => ({ setViewState: vi.fn(async () => undefined) })),
      revealLeaf: vi.fn(),
    },
    vault: {
      on: vi.fn((eventName: string, callback: (...args: unknown[]) => void) => {
        obsidianMockState.vaultCallbacks[eventName] = callback;
        return { eventName };
      }),
      getAbstractFileByPath: vi.fn(() => null),
      getRoot: vi.fn(() => ({ path: "", name: "/", children: [] })),
      create: vi.fn(async () => ({ path: "notes/new.md" })),
      getMarkdownFiles: vi.fn(() => []),
      cachedRead: vi.fn(async () => ""),
      adapter: { basePath: "/vault/base" },
      getName: vi.fn(() => "vault-name"),
    },
  };

  const plugin = new FolderCardExplorerPlugin({} as never, {} as never);
  (plugin as unknown as { app: unknown }).app = app;

  return { plugin, app };
}

describe("FolderCardExplorerPlugin indexed search lifecycle", () => {
  beforeEach(() => {
    (globalThis as unknown as { document?: unknown }).document = {};
    searchMockState.indexedInitializeShouldFail = false;
    searchMockState.restoreResult = {
      status: "ready",
      outcome: "restored",
      detail: "restored",
    };
    searchMockState.currentSnapshot = {
      initialized: true,
      disposed: false,
      mode: "indexed",
      status: "ready",
      lastError: null,
      health: {
        outcome: "restored",
        healthy: true,
        rebuilding: false,
        documentCount: 10,
        lastIndexedAt: 1,
        detail: "restored",
      },
    };
    searchMockState.indexedServices.length = 0;
    searchMockState.noIndexServices.length = 0;
    searchMockState.managers.length = 0;
    searchMockState.stores.length = 0;
    obsidianMockState.layoutReadyCallback = null;
    obsidianMockState.workspaceOnCallback = null;
    obsidianMockState.vaultCallbacks = {};
    obsidianMockState.notices = [];
    obsidianMockState.leavesByType = {};
    vi.clearAllMocks();
  });

  it("initializes indexed service and attempts restore during startup", async () => {
    const { plugin } = createPluginHarness();

    await plugin.onload();

    expect(searchMockState.indexedServices).toHaveLength(1);
    expect(searchMockState.managers).toHaveLength(1);
    expect(searchMockState.stores[0]?.vaultNamespace).toBe("path:/vault/base");
    expect(searchMockState.indexedServices[0]?.initialize).toHaveBeenCalledTimes(1);
    expect(searchMockState.managers[0]?.restore).toHaveBeenCalledTimes(1);
    expect(plugin.getSearchService()).toBe(searchMockState.indexedServices[0]);
  });

  it("degrades safely to no-index fallback when indexed init fails", async () => {
    const { plugin } = createPluginHarness();
    searchMockState.indexedInitializeShouldFail = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await plugin.onload();

    expect(searchMockState.indexedServices[0]?.initialize).toHaveBeenCalledTimes(1);
    expect(searchMockState.noIndexServices).toHaveLength(1);
    expect(searchMockState.noIndexServices[0]?.initialize).toHaveBeenCalledTimes(1);
    expect(plugin.getSearchService()).toBe(searchMockState.noIndexServices[0]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("registers exactly the two search lifecycle commands", async () => {
    const { plugin } = createPluginHarness();

    await plugin.onload();

    const addCommandCalls = (plugin as unknown as { addCommand: ReturnType<typeof vi.fn> }).addCommand.mock.calls;
    const searchCommands = addCommandCalls
      .map((entry: unknown[]) => entry[0] as { id: string; name: string })
      .filter((command) => command.id.includes("folder-card-search-index"))
      .map((command) => ({ id: command.id, name: command.name }));

    expect(searchCommands).toHaveLength(2);
    expect(searchCommands).toEqual([
      {
        id: "rebuild-folder-card-search-index",
        name: "Rebuild Folder Card Explorer search index",
      },
      {
        id: "recover-folder-card-search-index",
        name: "Recover Folder Card Explorer search index",
      },
    ]);
  });

  it("routes rebuild and recover commands through plugin-owned lifecycle", async () => {
    const { plugin } = createPluginHarness();

    await plugin.onload();

    const commands = (plugin as unknown as { addCommand: ReturnType<typeof vi.fn> }).addCommand.mock.calls.map(
      (entry: unknown[]) => entry[0] as { id: string; callback: () => void },
    );

    const rebuild = commands.find((command) => command.id === "rebuild-folder-card-search-index");
    const recover = commands.find((command) => command.id === "recover-folder-card-search-index");
    rebuild?.callback();
    recover?.callback();

    await Promise.resolve();
    await Promise.resolve();

    expect(searchMockState.managers[0]?.rebuildFromSource).toHaveBeenCalledTimes(1);
    expect(searchMockState.managers[0]?.restore).toHaveBeenCalledTimes(2);
  });

  it("forwards vault mutations to search service and disposes it on unload", async () => {
    const { plugin, app } = createPluginHarness();

    await plugin.onload();

    const createCallback = obsidianMockState.vaultCallbacks.create;
    const createdFile = new TFile() as TFile & { path: string; extension: string };
    createdFile.path = "notes/new-note.md";
    createdFile.extension = "md";
    createCallback?.(createdFile);

    expect(searchMockState.indexedServices[0]?.handleVaultMutation).toHaveBeenCalledWith({
      type: "create",
      path: "notes/new-note.md",
      oldPath: null,
      isMarkdown: true,
      isFolder: false,
    });

    await plugin.onunload();

    expect(searchMockState.indexedServices[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(plugin.getSearchService()).toBeNull();
    expect(app.workspace.detachLeavesOfType).toHaveBeenCalledWith("folder-card-view");
  });

  it("schedules plugin-owned rebuild when forwarded mutation reaches rebuild-required state", async () => {
    const { plugin } = createPluginHarness();
    await plugin.onload();

    const renameCallback = obsidianMockState.vaultCallbacks.rename;
    const TFolderCtor = TFolder as unknown as { new (path: string): TFolder };
    const renamedFolder = new TFolderCtor("archive");
    renameCallback?.(renamedFolder, "notes");

    expect(searchMockState.indexedServices[0]?.handleVaultMutation).toHaveBeenCalledWith({
      type: "rename",
      path: "archive",
      oldPath: "notes",
      isMarkdown: false,
      isFolder: true,
    });

    const service = searchMockState.indexedServices[0];
    service?.emitSnapshot({
      ...searchMockState.currentSnapshot,
      status: "building",
      health: {
        ...searchMockState.currentSnapshot.health,
        outcome: "rebuild-required",
        rebuilding: true,
        healthy: false,
        detail: "Folder rename cannot be safely rewritten; full rebuild required.",
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(searchMockState.managers[0]?.rebuildFromSource).toHaveBeenCalledTimes(1);
    expect(searchMockState.managers[0]?.rebuildFromSource).toHaveBeenCalledWith(
      "Unsafe vault mutation requires full search rebuild.",
    );
  });

  it("delivers snapshots once through the subscription seam with boundary-only recovery notices", async () => {
    const { plugin } = createPluginHarness();
    const ViewCtor = FolderCardView as unknown as { new (): { onSearchSnapshot: ReturnType<typeof vi.fn> } };
    const view = new ViewCtor();
    obsidianMockState.leavesByType["folder-card-view"] = [{ view }];

    const seenStatuses: string[] = [];
    const unsubscribe = plugin.subscribeSearchSnapshots((snapshot) => {
      seenStatuses.push(snapshot.status);
      (view.onSearchSnapshot as unknown as () => void)();
    });

    await plugin.onload();

    const service = searchMockState.indexedServices[0];
    service?.emitSnapshot({
      ...searchMockState.currentSnapshot,
      status: "building",
      health: {
        ...searchMockState.currentSnapshot.health,
        outcome: "rebuild-required",
        rebuilding: true,
        healthy: false,
      },
    });
    service?.emitSnapshot({
      ...searchMockState.currentSnapshot,
      status: "ready",
      health: {
        ...searchMockState.currentSnapshot.health,
        outcome: "rebuilt",
        rebuilding: false,
        healthy: true,
      },
    });

    expect(view.onSearchSnapshot).toHaveBeenCalledTimes(seenStatuses.length);
    expect(seenStatuses).toContain("ready");
    expect(seenStatuses).toContain("building");
    expect(obsidianMockState.notices).toEqual([
      "Folder Card Explorer search index requires recovery.",
      "Folder Card Explorer search index is ready.",
    ]);

    unsubscribe();
  });

  it("schedules startup rebuild after restore requires rebuild", async () => {
    const { plugin } = createPluginHarness();
    searchMockState.restoreResult = {
      status: "building",
      outcome: "rebuild-required",
      detail: "missing persisted index",
    };

    await plugin.onload();
    await Promise.resolve();

    expect(searchMockState.managers[0]?.rebuildFromSource).toHaveBeenCalledWith(
      "Startup restore required full search rebuild.",
    );
  });

  it("does not emit duplicate degraded notices for repeated failure snapshots", async () => {
    const { plugin } = createPluginHarness();
    await plugin.onload();

    const service = searchMockState.indexedServices[0];
    service?.emitSnapshot({
      ...searchMockState.currentSnapshot,
      status: "error",
      health: {
        ...searchMockState.currentSnapshot.health,
        outcome: "failed",
        healthy: false,
      },
    });
    service?.emitSnapshot({
      ...searchMockState.currentSnapshot,
      status: "error",
      health: {
        ...searchMockState.currentSnapshot.health,
        outcome: "failed",
        healthy: false,
      },
    });

    expect(obsidianMockState.notices.filter((message) => message.includes("requires recovery"))).toHaveLength(1);
  });
});
