import { beforeEach, describe, expect, it, vi } from "vitest";

interface MockSearchSnapshot {
  initialized: boolean;
  disposed: boolean;
  mode: "indexed";
  status: "ready" | "building" | "error";
  lastError: string | null;
  health: {
    outcome: "restored" | "rebuild-required" | "rebuilt" | "failed" | "none";
    readiness: "initializing" | "restoring" | "building" | "ready" | "rebuild-required" | "error";
    healthy: boolean;
    rebuilding: boolean;
    rebuildRequired: boolean;
    persistence: "unknown" | "healthy" | "storage-unavailable" | "read-failed" | "write-failed";
    documentCount: number | null;
    lastIndexedAt: number | null;
    rebuildReason:
      | "missing"
      | "version-drift"
      | "corrupt"
      | "read-failed"
      | "load-failed"
      | "storage-unavailable"
      | "folder-rebuild-required"
      | null;
    lastError: string | null;
    lastSuccessfulRestore: {
      outcome: "restored" | "rebuilt";
      at: number;
      documentCount: number;
      detail: string | null;
    } | null;
    lastSuccessfulBuild: {
      outcome: "restored" | "rebuilt";
      at: number;
      documentCount: number;
      detail: string | null;
    } | null;
    detail: string | null;
  };
}

function createMockHealth(overrides: Partial<MockSearchSnapshot["health"]> = {}): MockSearchSnapshot["health"] {
  return {
    outcome: "restored",
    readiness: "ready",
    healthy: true,
    rebuilding: false,
    rebuildRequired: false,
    persistence: "healthy",
    documentCount: 10,
    lastIndexedAt: 1,
    rebuildReason: null,
    lastError: null,
    lastSuccessfulRestore: {
      outcome: "restored",
      at: 1,
      documentCount: 10,
      detail: "restored",
    },
    lastSuccessfulBuild: null,
    detail: "restored",
    ...overrides,
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
      health: createMockHealth(),
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
    managers: [] as Array<{
      restore: ReturnType<typeof vi.fn>;
      rebuildFromSource: ReturnType<typeof vi.fn>;
      syncDocumentStateFromSource: ReturnType<typeof vi.fn>;
      syncDocumentStateCallCount: () => number;
      clearAndReset: ReturnType<typeof vi.fn>;
      getSnapshot: ReturnType<typeof vi.fn>;
      subscribe: ReturnType<typeof vi.fn>;
      initialize: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
      search: ReturnType<typeof vi.fn>;
      handleVaultMutation: ReturnType<typeof vi.fn>;
      markInitializationFailure: ReturnType<typeof vi.fn>;
    }>,
    stores: [] as Array<{ vaultNamespace: string }>,
  };
});

const obsidianMockState = vi.hoisted(() => {
  return {
    layoutReadyCallback: null as (() => void) | null,
    autoRunLayoutReady: true,
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
    private syncDocumentStateCounter = 0;

    restore = vi.fn(async () => searchMockState.restoreResult);
    rebuildFromSource = vi.fn(async () => undefined);
    syncDocumentStateFromSource = vi.fn(async () => {
      this.syncDocumentStateCounter += 1;
    });
    clearAndReset = vi.fn(async () => ({ outcome: "cleared" as const }));
    getSnapshot = vi.fn(() => searchMockState.currentSnapshot);
    subscribe = vi.fn((listener: (snapshot: MockSearchSnapshot) => void) => {
      listener(searchMockState.currentSnapshot);
      return () => undefined;
    });
    initialize = vi.fn(async () => undefined);
    dispose = vi.fn(() => undefined);
    search = vi.fn(async () => [] as string[]);
    handleVaultMutation = vi.fn(() => undefined);
    markInitializationFailure = vi.fn((error: unknown) => {
      const detail = error instanceof Error ? error.message : "Indexed search initialization failed.";
      searchMockState.currentSnapshot = {
        initialized: true,
        disposed: false,
        mode: "indexed",
        status: "error",
        lastError: detail,
        health: createMockHealth({
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
          lastSuccessfulRestore: null,
          detail,
        }),
      };
      for (const service of searchMockState.indexedServices) {
        service.emitSnapshot(searchMockState.currentSnapshot);
      }
    });

    constructor() {
      searchMockState.managers.push(this);
    }

    syncDocumentStateCallCount(): number {
      return this.syncDocumentStateCounter;
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
        execution: "indexed-ready",
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

  return {
    IndexStore: MockIndexStore,
    SearchIndexManager: MockSearchIndexManager,
    IndexedSearchService: MockIndexedSearchService,
    prepareSearchableDocument: vi.fn((input: { path: string; title: string; markdown?: string; mtime: number; ctime: number }) => ({
      path: input.path,
      title: input.title,
      normalizedTitle: input.title.toLowerCase(),
      content: input.markdown ?? "",
      excerpt: input.markdown ?? "",
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
    registerHoverLinkSource = vi.fn();
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
      getMostRecentLeaf: ReturnType<typeof vi.fn>;
      createLeafBySplit: ReturnType<typeof vi.fn>;
      openPopoutLeaf?: ReturnType<typeof vi.fn>;
      getRightLeaf: ReturnType<typeof vi.fn>;
      revealLeaf: ReturnType<typeof vi.fn>;
      rootSplit: { id: string };
      leftSplit: { id: string };
      rightSplit: { id: string };
    };
    vault: {
      on: ReturnType<typeof vi.fn>;
      getAbstractFileByPath: ReturnType<typeof vi.fn>;
      getFiles: ReturnType<typeof vi.fn>;
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
        if (obsidianMockState.autoRunLayoutReady) {
          callback();
        }
      }),
      getActiveFile: vi.fn(() => null),
      getLeavesOfType: vi.fn((type: string) => obsidianMockState.leavesByType[type] ?? []),
      detachLeavesOfType: vi.fn(),
      getActiveViewOfType: vi.fn(() => null),
      getLeaf: vi.fn(() => ({ openFile: vi.fn(async () => undefined) })),
      getMostRecentLeaf: vi.fn(() => null),
      createLeafBySplit: vi.fn(() => ({ openFile: vi.fn(async () => undefined) })),
      openPopoutLeaf: vi.fn(async () => ({ openFile: vi.fn(async () => undefined) })),
      getRightLeaf: vi.fn(() => ({ setViewState: vi.fn(async () => undefined) })),
      revealLeaf: vi.fn(),
      rootSplit: { id: "root-split" },
      leftSplit: { id: "left-split" },
      rightSplit: { id: "right-split" },
    },
    vault: {
      on: vi.fn((eventName: string, callback: (...args: unknown[]) => void) => {
        obsidianMockState.vaultCallbacks[eventName] = callback;
        return { eventName };
      }),
      getAbstractFileByPath: vi.fn(() => null),
      getFiles: vi.fn(() => []),
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

describe("FolderCardExplorerPlugin open destination routing", () => {
  beforeEach(() => {
    obsidianMockState.notices = [];
  });

  it("reuses the most recent root markdown leaf for default card opens when unpinned", async () => {
    const { plugin, app } = createPluginHarness();
    const target = new TFile();
    target.path = "notes/current.md";
    app.vault.getAbstractFileByPath.mockReturnValue(target);

    const leaf = {
      getRoot: vi.fn(() => app.workspace.rootSplit),
      getViewState: vi.fn(() => ({ type: "markdown", pinned: false })),
      openFile: vi.fn(async () => undefined),
    };
    app.workspace.getMostRecentLeaf.mockReturnValue(leaf);

    await plugin.openNoteFromCard("notes/current.md");

    expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    expect(leaf.openFile).toHaveBeenCalledWith(target, { active: true });
  });

  it("opens a new tab for default card opens when the most recent root leaf is pinned", async () => {
    const { plugin, app } = createPluginHarness();
    const target = new TFile();
    target.path = "notes/pinned.md";
    app.vault.getAbstractFileByPath.mockReturnValue(target);

    const pinnedLeaf = {
      getRoot: vi.fn(() => app.workspace.rootSplit),
      getViewState: vi.fn(() => ({ type: "markdown", pinned: true })),
      openFile: vi.fn(async () => undefined),
    };
    const newTabLeaf = { openFile: vi.fn(async () => undefined) };
    app.workspace.getMostRecentLeaf.mockReturnValue(pinnedLeaf);
    app.workspace.getLeaf.mockReturnValue(newTabLeaf);

    await plugin.openNoteFromCard("notes/pinned.md");

    expect(app.workspace.getLeaf).toHaveBeenCalledWith(true);
    expect(newTabLeaf.openFile).toHaveBeenCalledWith(target, { active: true });
    expect(pinnedLeaf.openFile).not.toHaveBeenCalled();
  });

  it("reuses the most recent root canvas leaf for default card opens when sidebar focus hides the editor", async () => {
    const { plugin, app } = createPluginHarness();
    const target = new TFile();
    target.path = "notes/sidebar-root-canvas.md";
    app.vault.getAbstractFileByPath.mockReturnValue(target);

    const sidebarLeaf = {
      getRoot: vi.fn(() => app.workspace.leftSplit),
      getViewState: vi.fn(() => ({ type: "markdown", pinned: false })),
    };
    const rootCanvasLeaf = {
      getRoot: vi.fn(() => app.workspace.rootSplit),
      getViewState: vi.fn(() => ({ type: "canvas", pinned: false })),
      openFile: vi.fn(async () => undefined),
    };
    app.workspace.getActiveViewOfType.mockReturnValue({ leaf: sidebarLeaf });
    app.workspace.getMostRecentLeaf.mockReturnValue(rootCanvasLeaf);

    await plugin.openNoteFromCard("notes/sidebar-root-canvas.md");

    expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    expect(rootCanvasLeaf.openFile).toHaveBeenCalledWith(target, { active: true });
  });

  it("opens a new tab for default card opens when the most recent root canvas leaf is pinned", async () => {
    const { plugin, app } = createPluginHarness();
    const target = new TFile();
    target.path = "notes/sidebar-root-canvas-pinned.md";
    app.vault.getAbstractFileByPath.mockReturnValue(target);

    const sidebarLeaf = {
      getRoot: vi.fn(() => app.workspace.leftSplit),
      getViewState: vi.fn(() => ({ type: "markdown", pinned: false })),
    };
    const pinnedRootCanvasLeaf = {
      getRoot: vi.fn(() => app.workspace.rootSplit),
      getViewState: vi.fn(() => ({ type: "canvas", pinned: true })),
      openFile: vi.fn(async () => undefined),
    };
    const newTabLeaf = { openFile: vi.fn(async () => undefined) };
    app.workspace.getActiveViewOfType.mockReturnValue({ leaf: sidebarLeaf });
    app.workspace.getMostRecentLeaf.mockReturnValue(pinnedRootCanvasLeaf);
    app.workspace.getLeaf.mockReturnValue(newTabLeaf);

    await plugin.openNoteFromCard("notes/sidebar-root-canvas-pinned.md");

    expect(app.workspace.getLeaf).toHaveBeenCalledWith(true);
    expect(newTabLeaf.openFile).toHaveBeenCalledWith(target, { active: true });
    expect(pinnedRootCanvasLeaf.openFile).not.toHaveBeenCalled();
  });

  it("uses the active root markdown leaf when no recent file-capable root leaf exists", async () => {
    const { plugin, app } = createPluginHarness();
    const target = new TFile();
    target.path = "notes/active-root-markdown.md";
    app.vault.getAbstractFileByPath.mockReturnValue(target);

    const activeRootMarkdownLeaf = {
      getRoot: vi.fn(() => app.workspace.rootSplit),
      getViewState: vi.fn(() => ({ type: "markdown", pinned: false })),
      openFile: vi.fn(async () => undefined),
    };
    app.workspace.getActiveViewOfType.mockReturnValue({ leaf: activeRootMarkdownLeaf });
    app.workspace.getMostRecentLeaf.mockReturnValue(null);

    await plugin.openNoteFromCard("notes/active-root-markdown.md");

    expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    expect(activeRootMarkdownLeaf.openFile).toHaveBeenCalledWith(target, { active: true });
  });

  it("uses an existing root markdown leaf when the most recent root leaf is empty", async () => {
    const { plugin, app } = createPluginHarness();
    const target = new TFile();
    target.path = "notes/existing-root-markdown.md";
    app.vault.getAbstractFileByPath.mockReturnValue(target);

    const sidebarLeaf = {
      getRoot: vi.fn(() => app.workspace.leftSplit),
      getViewState: vi.fn(() => ({ type: "markdown", pinned: false })),
    };
    const recentEmptyLeaf = {
      getRoot: vi.fn(() => app.workspace.rootSplit),
      getViewState: vi.fn(() => ({ type: "empty" })),
      openFile: vi.fn(async () => undefined),
    };
    const existingRootMarkdownLeaf = {
      getRoot: vi.fn(() => app.workspace.rootSplit),
      getViewState: vi.fn(() => ({ type: "markdown", pinned: false })),
      openFile: vi.fn(async () => undefined),
    };
    app.workspace.getActiveViewOfType.mockReturnValue({ leaf: sidebarLeaf });
    app.workspace.getMostRecentLeaf.mockReturnValue(recentEmptyLeaf);
    app.workspace.getLeavesOfType.mockReturnValue([sidebarLeaf, existingRootMarkdownLeaf]);

    await plugin.openNoteFromCard("notes/existing-root-markdown.md");

    expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    expect(existingRootMarkdownLeaf.openFile).toHaveBeenCalledWith(target, { active: true });
    expect(recentEmptyLeaf.openFile).not.toHaveBeenCalled();
  });

  it("opens a new tab for default card opens when no suitable root leaf exists", async () => {
    const { plugin, app } = createPluginHarness();
    const target = new TFile();
    target.path = "notes/no-main-leaf.md";
    app.vault.getAbstractFileByPath.mockReturnValue(target);

    const sidebarLeaf = {
      getRoot: vi.fn(() => app.workspace.leftSplit),
      getViewState: vi.fn(() => ({ type: "markdown", pinned: false })),
    };
    const recentEmptyLeaf = {
      getRoot: vi.fn(() => app.workspace.rootSplit),
      getViewState: vi.fn(() => ({ type: "empty" })),
      openFile: vi.fn(async () => undefined),
    };
    const newTabLeaf = { openFile: vi.fn(async () => undefined) };
    app.workspace.getActiveViewOfType.mockReturnValue({ leaf: sidebarLeaf });
    app.workspace.getMostRecentLeaf.mockReturnValue(recentEmptyLeaf);
    app.workspace.getLeavesOfType.mockReturnValue([sidebarLeaf]);
    app.workspace.getLeaf.mockReturnValue(newTabLeaf);

    await plugin.openNoteFromCard("notes/no-main-leaf.md");

    expect(app.workspace.getLeaf).toHaveBeenCalledWith(true);
    expect(newTabLeaf.openFile).toHaveBeenCalledWith(target, { active: true });
    expect(recentEmptyLeaf.openFile).not.toHaveBeenCalled();
  });


  it("resolveTargetLeaf skips sidebar markdown views and prefers the most recent root leaf", () => {
    const { plugin, app } = createPluginHarness();
    const sidebarLeaf = {
      getRoot: vi.fn(() => app.workspace.leftSplit),
      getViewState: vi.fn(() => ({ type: "markdown" })),
    };
    const rootLeaf = {
      getRoot: vi.fn(() => app.workspace.rootSplit),
      getViewState: vi.fn(() => ({ type: "canvas" })),
    };
    app.workspace.getActiveViewOfType.mockReturnValue({ leaf: sidebarLeaf });
    app.workspace.getMostRecentLeaf.mockReturnValue(rootLeaf);

    const resolvedLeaf = (plugin as unknown as { resolveTargetLeaf: () => unknown }).resolveTargetLeaf();

    expect(app.workspace.getMostRecentLeaf).toHaveBeenCalledWith(app.workspace.rootSplit);
    expect(resolvedLeaf).toBe(rootLeaf);
  });

  it("resolveTargetLeaf uses an existing root markdown leaf before opening a new tab", () => {
    const { plugin, app } = createPluginHarness();
    const sidebarLeaf = {
      getRoot: vi.fn(() => app.workspace.leftSplit),
      getViewState: vi.fn(() => ({ type: "markdown" })),
    };
    const rootLeaf = {
      getRoot: vi.fn(() => app.workspace.rootSplit),
      getViewState: vi.fn(() => ({ type: "markdown" })),
    };
    app.workspace.getLeavesOfType.mockReturnValue([sidebarLeaf, rootLeaf]);

    const resolvedLeaf = (plugin as unknown as { resolveTargetLeaf: () => unknown }).resolveTargetLeaf();

    expect(resolvedLeaf).toBe(rootLeaf);
    expect(app.workspace.getLeaf).not.toHaveBeenCalled();
  });

  it("resolveTargetLeaf opens a new root leaf when no root leaf exists", () => {
    const { plugin, app } = createPluginHarness();
    const sidebarLeaf = {
      getRoot: vi.fn(() => app.workspace.leftSplit),
      getViewState: vi.fn(() => ({ type: "markdown" })),
    };
    const newRootLeaf = { openFile: vi.fn(async () => undefined) };
    app.workspace.getLeavesOfType.mockReturnValue([sidebarLeaf]);
    app.workspace.getLeaf.mockReturnValue(newRootLeaf);

    const resolvedLeaf = (plugin as unknown as { resolveTargetLeaf: () => unknown }).resolveTargetLeaf();

    expect(resolvedLeaf).toBe(newRootLeaf);
    expect(app.workspace.getLeaf).toHaveBeenCalledWith(true);
  });

  it("resolveTargetLeaf reuses a non-markdown root leaf before opening a new tab", () => {
    const { plugin, app } = createPluginHarness();
    const rootLeaf = {
      getRoot: vi.fn(() => app.workspace.rootSplit),
      getViewState: vi.fn(() => ({ type: "canvas" })),
    };
    app.workspace.getMostRecentLeaf.mockReturnValue(rootLeaf);

    const resolvedLeaf = (plugin as unknown as { resolveTargetLeaf: () => unknown }).resolveTargetLeaf();

    expect(resolvedLeaf).toBe(rootLeaf);
    expect(app.workspace.getLeaf).not.toHaveBeenCalled();
  });

  it("opens in a new tab with getLeaf(true) and syncs selection", async () => {
    const { plugin, app } = createPluginHarness();
    const target = new TFile();
    target.path = "notes/new-tab.md";
    app.vault.getAbstractFileByPath.mockReturnValue(target);

    const leaf = { openFile: vi.fn(async () => undefined) };
    app.workspace.getLeaf.mockReturnValue(leaf);
    const syncSelection = vi.spyOn(plugin as unknown as { syncSelection: (path: string) => void }, "syncSelection");

    await plugin.openNoteFromCard("notes/new-tab.md", "new-tab");

    expect(app.workspace.getLeaf).toHaveBeenCalledWith(true);
    expect(leaf.openFile).toHaveBeenCalledWith(target, { active: true });
    expect(syncSelection).toHaveBeenCalledWith("notes/new-tab.md");
  });

  it("opens in split-right by splitting the resolved main editor leaf", async () => {
    const { plugin, app } = createPluginHarness();
    const target = new TFile();
    target.path = "notes/split.md";
    app.vault.getAbstractFileByPath.mockReturnValue(target);

    const targetLeaf = {
      getRoot: vi.fn(() => app.workspace.rootSplit),
      getViewState: vi.fn(() => ({ type: "canvas" })),
    };
    const splitLeaf = { openFile: vi.fn(async () => undefined) };
    vi.spyOn(plugin as unknown as { findExistingRootEditorLeaf: () => unknown }, "findExistingRootEditorLeaf").mockReturnValue(targetLeaf);
    app.workspace.createLeafBySplit.mockReturnValue(splitLeaf);

    await plugin.openNoteFromCard("notes/split.md", "split-right");

    expect(app.workspace.createLeafBySplit).toHaveBeenCalledWith(targetLeaf, "vertical");
    expect(splitLeaf.openFile).toHaveBeenCalledWith(target, { active: true });
  });

  it("opens in split-right via a new root leaf when no main editor leaf exists", async () => {
    const { plugin, app } = createPluginHarness();
    const target = new TFile();
    target.path = "notes/split-new-root.md";
    app.vault.getAbstractFileByPath.mockReturnValue(target);

    const newRootLeaf = { openFile: vi.fn(async () => undefined) };
    app.workspace.getLeaf.mockReturnValue(newRootLeaf);

    await plugin.openNoteFromCard("notes/split-new-root.md", "split-right");

    expect(app.workspace.createLeafBySplit).not.toHaveBeenCalled();
    expect(app.workspace.getLeaf).toHaveBeenCalledWith(true);
    expect(newRootLeaf.openFile).toHaveBeenCalledWith(target, { active: true });
  });

  it("opens in a new window via openPopoutLeaf when available", async () => {
    const { plugin, app } = createPluginHarness();
    const target = new TFile();
    target.path = "notes/window.md";
    app.vault.getAbstractFileByPath.mockReturnValue(target);

    const leaf = { openFile: vi.fn(async () => undefined) };
    app.workspace.openPopoutLeaf = vi.fn(async () => leaf);

    await plugin.openNoteFromCard("notes/window.md", "new-window");

    expect(app.workspace.openPopoutLeaf).toHaveBeenCalledTimes(1);
    expect(leaf.openFile).toHaveBeenCalledWith(target, { active: true });
  });

  it("shows exact desktop-only notice and no-ops when popout leaf API is unavailable", async () => {
    const { plugin, app } = createPluginHarness();
    const target = new TFile();
    target.path = "notes/window-missing.md";
    app.vault.getAbstractFileByPath.mockReturnValue(target);

    const defaultLeaf = { openFile: vi.fn(async () => undefined) };
    app.workspace.getLeaf.mockReturnValue(defaultLeaf);
    delete app.workspace.openPopoutLeaf;

    await plugin.openNoteFromCard("notes/window-missing.md", "new-window");

    expect(obsidianMockState.notices).toEqual([
      "Open in new window is available on desktop only.",
    ]);
    expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    expect(defaultLeaf.openFile).not.toHaveBeenCalled();
  });

  it("opens newly created notes in current-area explicitly", async () => {
    const { plugin, app } = createPluginHarness();
    (plugin as unknown as { selectedFolderPath: string | null }).selectedFolderPath = "notes";
    app.vault.create.mockResolvedValue({ path: "notes/Untitled.md" });
    const openNoteFromCard = vi.spyOn(plugin, "openNoteFromCard").mockResolvedValue(undefined);

    await plugin.createNoteInCurrentFolder();

    expect(openNoteFromCard).toHaveBeenCalledWith("notes/Untitled.md", "current-area");
  });
});

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
      health: createMockHealth(),
    };
    searchMockState.indexedServices.length = 0;
    searchMockState.managers.length = 0;
    searchMockState.stores.length = 0;
    obsidianMockState.layoutReadyCallback = null;
    obsidianMockState.autoRunLayoutReady = true;
    obsidianMockState.workspaceOnCallback = null;
    obsidianMockState.vaultCallbacks = {};
    obsidianMockState.notices = [];
    obsidianMockState.leavesByType = {};
    vi.clearAllMocks();
  });

  it("initializes indexed service and attempts restore during startup", async () => {
    const { plugin } = createPluginHarness();

    await plugin.onload();

    const mockPlugin = plugin as unknown as {
      registerHoverLinkSource: ReturnType<typeof vi.fn>;
      addCommand: ReturnType<typeof vi.fn>;
      registerDomEvent: ReturnType<typeof vi.fn>;
      registerEvent: ReturnType<typeof vi.fn>;
    };

    expect(mockPlugin.registerHoverLinkSource).toHaveBeenCalledTimes(1);
    expect(mockPlugin.registerHoverLinkSource).toHaveBeenCalledWith("card-workspace", {
      display: "Card Workspace",
      defaultMod: true,
    });
    expect(mockPlugin.registerHoverLinkSource.mock.invocationCallOrder[0]).toBeLessThan(
      mockPlugin.addCommand.mock.invocationCallOrder[0],
    );
    expect(mockPlugin.registerHoverLinkSource.mock.invocationCallOrder[0]).toBeLessThan(
      mockPlugin.registerDomEvent.mock.invocationCallOrder[0],
    );
    expect(mockPlugin.registerHoverLinkSource.mock.invocationCallOrder[0]).toBeLessThan(
      mockPlugin.registerEvent.mock.invocationCallOrder[0],
    );

    expect(searchMockState.indexedServices).toHaveLength(1);
    expect(searchMockState.managers).toHaveLength(1);
    expect(searchMockState.stores[0]?.vaultNamespace).toBe("path:/vault/base");
    expect(searchMockState.indexedServices[0]?.initialize).toHaveBeenCalledTimes(1);
    expect(searchMockState.managers[0]?.restore).toHaveBeenCalledTimes(1);
    expect(searchMockState.managers[0]?.syncDocumentStateFromSource).toHaveBeenCalledTimes(1);
    expect(plugin.getSearchService()).toBe(searchMockState.indexedServices[0]);
  });

  it("prepares markdown documents with cached reads and title-only pdf documents without cached reads", async () => {
    const { app } = createPluginHarness();
    const markdownFile = new TFile();
    markdownFile.path = "notes/Markdown Note.md";
    markdownFile.basename = "Markdown Note";
    markdownFile.stat = { mtime: 20, ctime: 10 } as never;
    const nonMarkdownFile = new TFile();
    nonMarkdownFile.path = "Assets/Project Brief.pdf";
    nonMarkdownFile.basename = "Project Brief";
    nonMarkdownFile.stat = { mtime: 30, ctime: 15 } as never;

    app.vault.cachedRead.mockResolvedValue("# Markdown Note\n\nunique-markdown-term");

    const plugin = new FolderCardExplorerPlugin({} as never, {} as never);
    (plugin as unknown as { app: typeof app }).app = app;

    const markdownDocument = await (plugin as unknown as {
      prepareSearchableDocumentFromFile(file: TFile): Promise<unknown>;
    }).prepareSearchableDocumentFromFile(markdownFile);
    const nonMarkdownDocument = await (plugin as unknown as {
      prepareSearchableDocumentFromFile(file: TFile): Promise<unknown>;
    }).prepareSearchableDocumentFromFile(nonMarkdownFile);

    expect(app.vault.cachedRead).toHaveBeenCalledTimes(1);
    expect(markdownDocument).toEqual(
      expect.objectContaining({
        path: markdownFile.path,
        title: markdownFile.basename,
        content: expect.stringContaining("unique-markdown-term"),
      }),
    );
    expect(nonMarkdownDocument).toEqual(
      expect.objectContaining({
        path: nonMarkdownFile.path,
        title: nonMarkdownFile.basename,
        content: "",
        excerpt: "",
      }),
    );
  });

  it("keeps indexed service bound and marks indexed initialization failure when startup init fails", async () => {
    const { plugin } = createPluginHarness();
    searchMockState.indexedInitializeShouldFail = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await plugin.onload();

    expect(searchMockState.indexedServices[0]?.initialize).toHaveBeenCalledTimes(1);
    expect(searchMockState.managers[0]?.markInitializationFailure).toHaveBeenCalledTimes(1);
    expect(plugin.getSearchService()).toBe(searchMockState.indexedServices[0]);
    expect(plugin.getSearchSnapshot()).toEqual({
      initialized: true,
      disposed: false,
      mode: "indexed",
      status: "error",
      lastError: "indexed init failed",
      health: expect.objectContaining({
        outcome: "failed",
        readiness: "error",
        healthy: false,
        rebuilding: false,
        rebuildRequired: false,
        persistence: "unknown",
        lastError: "indexed init failed",
        detail: "indexed init failed",
      }),
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[Card Workspace] Indexed search initialization failed.",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("registers search status, rebuild, and clear/reset commands", async () => {
    const { plugin } = createPluginHarness();

    await plugin.onload();

    const addCommandCalls = (plugin as unknown as { addCommand: ReturnType<typeof vi.fn> }).addCommand.mock.calls;
    const searchCommands = addCommandCalls
      .map((entry: unknown[]) => entry[0] as { id: string; name: string })
      .filter((command) => command.id.includes("folder-card-search-index"))
      .map((command) => ({ id: command.id, name: command.name }));

    expect(searchCommands).toHaveLength(4);
    expect(searchCommands).toEqual([
      {
        id: "show-folder-card-search-index-status",
        name: "Show Card Workspace local search index lifecycle status",
      },
      {
        id: "recover-folder-card-search-index",
        name: "Recover Card Workspace local search index lifecycle",
      },
      {
        id: "rebuild-folder-card-search-index",
        name: "Rebuild Card Workspace local search index from notes",
      },
      {
        id: "clear-reset-folder-card-search-index",
        name: "Clear and reset Card Workspace local search index state",
      },
    ]);
  });

  it("routes recover, rebuild, and clear/reset commands through plugin-owned lifecycle", async () => {
    const { plugin } = createPluginHarness();

    await plugin.onload();

    const commands = (plugin as unknown as { addCommand: ReturnType<typeof vi.fn> }).addCommand.mock.calls.map(
      (entry: unknown[]) => entry[0] as { id: string; callback: () => void },
    );

    const recover = commands.find((command) => command.id === "recover-folder-card-search-index");
    const rebuild = commands.find((command) => command.id === "rebuild-folder-card-search-index");
    const reset = commands.find((command) => command.id === "clear-reset-folder-card-search-index");
    recover?.callback();
    rebuild?.callback();
    reset?.callback();

    await Promise.resolve();
    await Promise.resolve();

    expect(searchMockState.managers[0]?.restore).toHaveBeenCalledTimes(2);
    expect(searchMockState.managers[0]?.clearAndReset).toHaveBeenCalledTimes(1);
    expect(searchMockState.managers[0]?.syncDocumentStateFromSource).toHaveBeenCalledTimes(2);
    expect(searchMockState.managers[0]?.rebuildFromSource).toHaveBeenCalledTimes(2);
    expect(searchMockState.managers[0]?.restore).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        vaultNamespace: "path:/vault/base",
      }),
    );
    expect(searchMockState.managers[0]?.rebuildFromSource).toHaveBeenNthCalledWith(
      1,
      "Manual rebuild command requested local search index rebuild.",
    );
    expect(searchMockState.managers[0]?.rebuildFromSource).toHaveBeenNthCalledWith(
      2,
      "Manual clear/reset command requested full local search index rebuild.",
    );
    expect(searchMockState.managers[0]?.clearAndReset).toHaveBeenCalledWith(
      "Manual clear/reset command requested local search index reset.",
    );
    expect(obsidianMockState.notices).toContain(
      "Card Workspace local search index cleared. Rebuilding from notes...",
    );
  });

  it("keeps clear/reset command idempotent while a local index reset is already running", async () => {
    const { plugin } = createPluginHarness();
    const clearAndResetGate = (() => {
      let resolvePromise: (() => void) | null = null;
      const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });
      return {
        promise,
        resolve(): void {
          resolvePromise?.();
        },
      };
    })();

    searchMockState.managers.length = 0;

    await plugin.onload();

    searchMockState.managers[0]?.clearAndReset.mockImplementation(async () => {
      await clearAndResetGate.promise;
      return { outcome: "cleared" as const };
    });

    const commands = (plugin as unknown as { addCommand: ReturnType<typeof vi.fn> }).addCommand.mock.calls.map(
      (entry: unknown[]) => entry[0] as { id: string; callback: () => void },
    );
    const reset = commands.find((command) => command.id === "clear-reset-folder-card-search-index");

    reset?.callback();
    reset?.callback();
    await Promise.resolve();

    expect(searchMockState.managers[0]?.clearAndReset).toHaveBeenCalledTimes(1);
    expect(searchMockState.managers[0]?.rebuildFromSource).toHaveBeenCalledTimes(0);

    clearAndResetGate.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(searchMockState.managers[0]?.rebuildFromSource).toHaveBeenCalledTimes(1);
    expect(searchMockState.managers[0]?.rebuildFromSource).toHaveBeenCalledWith(
      "Manual clear/reset command requested full local search index rebuild.",
    );
  });

  it("shows local-only search index status with health fields and query availability", async () => {
    const { plugin } = createPluginHarness();
    searchMockState.currentSnapshot = {
      initialized: true,
      disposed: false,
      mode: "indexed",
      status: "ready",
      lastError: null,
      health: createMockHealth({
        outcome: "rebuilt",
        readiness: "ready",
        healthy: true,
        rebuilding: false,
        rebuildRequired: false,
        persistence: "healthy",
        documentCount: 14,
        rebuildReason: null,
        lastError: null,
        lastSuccessfulRestore: {
          outcome: "restored",
          at: 12,
          documentCount: 11,
          detail: "restored",
        },
        lastSuccessfulBuild: {
          outcome: "rebuilt",
          at: 25,
          documentCount: 14,
          detail: "rebuilt",
        },
      }),
    };

    await plugin.onload();

    const observability = plugin.getSearchIndexObservabilitySnapshot();
    expect(observability).toEqual({
      status: "ready",
      queriesAllowed: true,
      health: expect.objectContaining({
        outcome: "rebuilt",
        readiness: "ready",
        persistence: "healthy",
        documentCount: 14,
        rebuildReason: null,
        lastError: null,
        lastSuccessfulRestore: {
          outcome: "restored",
          at: 12,
          documentCount: 11,
          detail: "restored",
        },
        lastSuccessfulBuild: {
          outcome: "rebuilt",
          at: 25,
          documentCount: 14,
          detail: "rebuilt",
        },
      }),
    });

    const commands = (plugin as unknown as { addCommand: ReturnType<typeof vi.fn> }).addCommand.mock.calls.map(
      (entry: unknown[]) => entry[0] as { id: string; callback: () => void },
    );
    const status = commands.find((command) => command.id === "show-folder-card-search-index-status");
    status?.callback();

    expect(obsidianMockState.notices).toContain(
      [
        "Card Workspace local search index lifecycle",
        "Status: ready",
        "Query availability: available",
        "Readiness: ready",
        "Persistence: healthy",
        "Documents: 14",
        "Last outcome: rebuilt",
        "Last restore: restored at 12 (11 docs)",
        "Last build: rebuilt at 25 (14 docs)",
        "Rebuild reason: none",
        "Last error: none",
      ].join("\n"),
    );
  });

  it("reports queriesAllowed false for degraded search index states", async () => {
    const cases = [
      {
        status: "building" as const,
        health: createMockHealth({
          outcome: "rebuild-required",
          readiness: "rebuild-required",
          healthy: false,
          rebuilding: true,
          rebuildRequired: true,
          persistence: "healthy",
          documentCount: null,
          lastIndexedAt: null,
          rebuildReason: "folder-rebuild-required",
          lastError: null,
          detail: "Folder rename requires rebuild.",
        }),
      },
      {
        status: "error" as const,
        health: createMockHealth({
          outcome: "failed",
          readiness: "error",
          healthy: false,
          rebuilding: false,
          rebuildRequired: false,
          persistence: "storage-unavailable",
          documentCount: null,
          lastIndexedAt: null,
          rebuildReason: "storage-unavailable",
          lastError: "IndexedDB unavailable.",
          lastSuccessfulRestore: null,
          lastSuccessfulBuild: null,
          detail: "IndexedDB unavailable.",
        }),
      },
    ];

    for (const testCase of cases) {
      searchMockState.currentSnapshot = {
        initialized: true,
        disposed: false,
        mode: "indexed",
        status: testCase.status,
        lastError: testCase.health.lastError,
        health: testCase.health,
      };

      const { plugin } = createPluginHarness();
      await plugin.onload();

      const observability = plugin.getSearchIndexObservabilitySnapshot();
      expect(observability).toEqual({
        status: testCase.status,
        queriesAllowed: false,
        health: expect.objectContaining({
          outcome: testCase.health.outcome,
          readiness: testCase.health.readiness,
          healthy: false,
          rebuildRequired: testCase.health.rebuildRequired,
          persistence: testCase.health.persistence,
          rebuildReason: testCase.health.rebuildReason,
          lastError: testCase.health.lastError,
        }),
      });
    }
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

  it("treats markdown-to-non-markdown file renames as markdown search mutations", async () => {
    const { plugin } = createPluginHarness();
    await plugin.onload();

    const renameCallback = obsidianMockState.vaultCallbacks.rename;
    const renamedFile = new TFile() as TFile & { path: string; extension: string };
    renamedFile.path = "notes/renamed.canvas";
    renamedFile.extension = "canvas";
    renameCallback?.(renamedFile, "notes/renamed.md");

    expect(searchMockState.indexedServices[0]?.handleVaultMutation).toHaveBeenCalledWith({
      type: "rename",
      path: "notes/renamed.canvas",
      oldPath: "notes/renamed.md",
      isMarkdown: true,
      isFolder: false,
    });
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
        readiness: "rebuild-required",
        rebuilding: true,
        healthy: false,
        rebuildRequired: true,
        rebuildReason: "folder-rebuild-required",
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
        readiness: "rebuild-required",
        rebuilding: true,
        healthy: false,
        rebuildRequired: true,
      },
    });
    service?.emitSnapshot({
      ...searchMockState.currentSnapshot,
      status: "ready",
      health: {
        ...searchMockState.currentSnapshot.health,
        outcome: "rebuilt",
        readiness: "ready",
        rebuilding: false,
        healthy: true,
        rebuildRequired: false,
      },
    });

    expect(view.onSearchSnapshot).toHaveBeenCalledTimes(seenStatuses.length);
    expect(seenStatuses).toContain("ready");
    expect(seenStatuses).toContain("building");
    expect(obsidianMockState.notices).toEqual([
      "Card Workspace search index requires recovery.",
      "Card Workspace search index is ready.",
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

  it("defers first-run startup rebuild and vault observers until layout ready", async () => {
    obsidianMockState.autoRunLayoutReady = false;
    const { plugin, app } = createPluginHarness();
    searchMockState.restoreResult = {
      status: "building",
      outcome: "rebuild-required",
      detail: "missing persisted index",
    };

    await plugin.onload();

    expect(searchMockState.managers[0]?.rebuildFromSource).not.toHaveBeenCalled();
    expect(app.vault.on).not.toHaveBeenCalled();

    obsidianMockState.layoutReadyCallback?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(app.vault.on).toHaveBeenCalledTimes(4);
    expect(searchMockState.managers[0]?.rebuildFromSource).toHaveBeenCalledTimes(1);
    expect(searchMockState.managers[0]?.rebuildFromSource).toHaveBeenCalledWith(
      "Startup restore required full search rebuild.",
    );
  });

  it("keeps restored index query-capable before layout ready while deferred sync waits", async () => {
    obsidianMockState.autoRunLayoutReady = false;
    const { plugin, app } = createPluginHarness();

    await plugin.onload();

    expect(plugin.getSearchIndexObservabilitySnapshot()).toEqual({
      status: "ready",
      queriesAllowed: true,
      health: expect.objectContaining({
        outcome: "restored",
        readiness: "ready",
        healthy: true,
        rebuildRequired: false,
      }),
    });
    expect(searchMockState.managers[0]?.syncDocumentStateCallCount()).toBe(0);
    expect(searchMockState.managers[0]?.syncDocumentStateFromSource).not.toHaveBeenCalled();
    expect(app.vault.on).not.toHaveBeenCalled();

    const indexedService = searchMockState.indexedServices[0] as {
      query: (request: {
        query: string;
        scope: { folderPath: string; includeSubfolders: boolean };
        candidatePaths: string[];
      }) => Promise<unknown>;
    };
    const queryResult = await indexedService.query({
      query: "alpha",
      scope: { folderPath: "notes", includeSubfolders: true },
      candidatePaths: ["notes/a.md"],
    });
    expect(queryResult).toEqual({
      mode: "indexed",
      status: "ready",
      execution: "indexed-ready",
      orderedPaths: [],
    });

    obsidianMockState.layoutReadyCallback?.();
    await Promise.resolve();

    expect(searchMockState.managers[0]?.syncDocumentStateCallCount()).toBe(1);
    expect(searchMockState.managers[0]?.syncDocumentStateFromSource).toHaveBeenCalledTimes(1);
    expect(app.vault.on).toHaveBeenCalledTimes(4);
  });

  it("keeps recovery and rebuild commands idempotent before layout ready after missing store restore", async () => {
    obsidianMockState.autoRunLayoutReady = false;
    const { plugin, app } = createPluginHarness();
    searchMockState.restoreResult = {
      status: "building",
      outcome: "rebuild-required",
      detail: "missing persisted index",
    };

    await plugin.onload();

    const commands = (plugin as unknown as { addCommand: ReturnType<typeof vi.fn> }).addCommand.mock.calls.map(
      (entry: unknown[]) => entry[0] as { id: string; callback: () => void },
    );
    const recover = commands.find((command) => command.id === "recover-folder-card-search-index");
    const rebuild = commands.find((command) => command.id === "rebuild-folder-card-search-index");

    recover?.callback();
    recover?.callback();
    rebuild?.callback();
    rebuild?.callback();
    await Promise.resolve();
    await Promise.resolve();

    expect(searchMockState.managers[0]?.restore).toHaveBeenCalledTimes(1);
    expect(searchMockState.managers[0]?.rebuildFromSource).not.toHaveBeenCalled();
    expect(app.vault.on).not.toHaveBeenCalled();

    obsidianMockState.layoutReadyCallback?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(app.vault.on).toHaveBeenCalledTimes(4);
    expect(searchMockState.managers[0]?.rebuildFromSource).toHaveBeenCalledTimes(1);
    expect(searchMockState.managers[0]?.rebuildFromSource).toHaveBeenCalledWith(
      "Manual rebuild command requested local search index rebuild.",
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
        readiness: "error",
        healthy: false,
        rebuildRequired: false,
      },
    });
    service?.emitSnapshot({
      ...searchMockState.currentSnapshot,
      status: "error",
      health: {
        ...searchMockState.currentSnapshot.health,
        outcome: "failed",
        readiness: "error",
        healthy: false,
        rebuildRequired: false,
      },
    });

    expect(obsidianMockState.notices.filter((message) => message.includes("requires recovery"))).toHaveLength(1);
  });
});
