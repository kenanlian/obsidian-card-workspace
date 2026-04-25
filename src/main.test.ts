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
    target.path = "notes/fallback.md";
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

    await plugin.openNoteFromCard("notes/fallback.md");

    expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    expect(rootCanvasLeaf.openFile).toHaveBeenCalledWith(target, { active: true });
  });

  it("opens a new tab for default card opens when the most recent root canvas leaf is pinned", async () => {
    const { plugin, app } = createPluginHarness();
    const target = new TFile();
    target.path = "notes/fallback-pinned.md";
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

    await plugin.openNoteFromCard("notes/fallback-pinned.md");

    expect(app.workspace.getLeaf).toHaveBeenCalledWith(true);
    expect(newTabLeaf.openFile).toHaveBeenCalledWith(target, { active: true });
    expect(pinnedRootCanvasLeaf.openFile).not.toHaveBeenCalled();
  });

  it("falls back to the active root markdown leaf when no recent file-capable root leaf exists", async () => {
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

  it("falls back to an existing root markdown leaf when the most recent root leaf is empty", async () => {
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

  it("resolveTargetLeaf falls back to an existing root markdown leaf before opening a new tab", () => {
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
    target.path = "notes/split-fallback.md";
    app.vault.getAbstractFileByPath.mockReturnValue(target);

    const newRootLeaf = { openFile: vi.fn(async () => undefined) };
    app.workspace.getLeaf.mockReturnValue(newRootLeaf);

    await plugin.openNoteFromCard("notes/split-fallback.md", "split-right");

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

    const fallbackLeaf = { openFile: vi.fn(async () => undefined) };
    app.workspace.getLeaf.mockReturnValue(fallbackLeaf);
    delete app.workspace.openPopoutLeaf;

    await plugin.openNoteFromCard("notes/window-missing.md", "new-window");

    expect(obsidianMockState.notices).toEqual([
      "Open in new window is available on desktop only.",
    ]);
    expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    expect(fallbackLeaf.openFile).not.toHaveBeenCalled();
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
        name: "Rebuild Card Workspace search index",
      },
      {
        id: "recover-folder-card-search-index",
        name: "Recover Card Workspace search index",
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
