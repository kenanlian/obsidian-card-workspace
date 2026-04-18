import { beforeEach, describe, expect, it, vi } from "vitest";

const searchMockState = vi.hoisted(() => {
  return {
    initializeShouldFail: false,
    onDispose: null as null | ((instance: unknown) => void),
    instances: [] as Array<{
      initialize: ReturnType<typeof vi.fn>;
      dispose: ReturnType<typeof vi.fn>;
      query: ReturnType<typeof vi.fn>;
      getSnapshot: ReturnType<typeof vi.fn>;
      subscribe: ReturnType<typeof vi.fn>;
      handleVaultMutation: ReturnType<typeof vi.fn>;
    }>,
  };
});

const obsidianMockState = vi.hoisted(() => {
  return {
    layoutReadyCallback: null as (() => void) | null,
    workspaceOnCallback: null as ((file: unknown) => void) | null,
    vaultCallbacks: {} as Record<string, (...args: unknown[]) => void>,
  };
});

vi.mock("./search", () => {
  class MockNoIndexSearchService {
    initialize = vi.fn(async () => {
      if (searchMockState.initializeShouldFail) {
        throw new Error("search init failed");
      }
    });

    dispose = vi.fn(() => {
      searchMockState.onDispose?.(this);
    });

    query = vi.fn(async () => {
      return {
        mode: "no-index",
        status: "ready",
        orderedPaths: null,
      };
    });

    getSnapshot = vi.fn(() => {
      return {
        initialized: true,
        disposed: false,
        mode: "no-index",
        status: "ready",
        lastError: null,
      };
    });

    subscribe = vi.fn(() => {
      return () => undefined;
    });

    handleVaultMutation = vi.fn(() => undefined);

    constructor() {
      searchMockState.instances.push(this);
    }
  }

  return {
    NoIndexSearchService: MockNoIndexSearchService,
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

  class MockTAbstractFile {
    path: string;

    constructor(path: string) {
      this.path = path;
    }
  }

  class MockTFile extends MockTAbstractFile {
    extension = "md";
    stat = {
      ctime: 1,
      mtime: 1,
    };
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

import { TFile } from "obsidian";
import FolderCardExplorerPlugin from "./main";

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
      getLeavesOfType: vi.fn(() => []),
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
    },
  };

  const plugin = new FolderCardExplorerPlugin({} as never, {} as never);
  (plugin as unknown as { app: unknown }).app = app;

  return { plugin, app };
}

describe("FolderCardExplorerPlugin search lifecycle", () => {
  beforeEach(() => {
    (globalThis as unknown as { document?: unknown }).document = {};
    searchMockState.initializeShouldFail = false;
    searchMockState.onDispose = null;
    searchMockState.instances.length = 0;
    obsidianMockState.layoutReadyCallback = null;
    obsidianMockState.workspaceOnCallback = null;
    obsidianMockState.vaultCallbacks = {};
    vi.clearAllMocks();
  });

  it("initializes plugin-owned search service during onload", async () => {
    const { plugin } = createPluginHarness();

    await plugin.onload();

    const service = searchMockState.instances[0];
    expect(service).toBeDefined();
    expect(service?.initialize).toHaveBeenCalledTimes(1);
    expect(plugin.getSearchService()).toBe(service);
  });

  it("degrades to fallback-safe mode when service initialization fails", async () => {
    const { plugin } = createPluginHarness();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    searchMockState.initializeShouldFail = true;

    let serviceDisposedWhileOwned = false;
    searchMockState.onDispose = (instance) => {
      serviceDisposedWhileOwned = plugin.getSearchService() === instance;
    };

    await plugin.onload();

    const service = searchMockState.instances[0];
    expect(service).toBeDefined();
    expect(service?.dispose).toHaveBeenCalledTimes(1);
    expect(serviceDisposedWhileOwned).toBe(true);
    expect(plugin.getSearchService()).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("forwards vault mutations to search service and disposes it on unload", async () => {
    const { plugin, app } = createPluginHarness();

    await plugin.onload();
    const service = searchMockState.instances[0];
    expect(service).toBeDefined();

    const createCallback = obsidianMockState.vaultCallbacks.create;
    expect(createCallback).toBeDefined();

    const createdFile = new TFile() as TFile & { path: string; extension: string };
    createdFile.path = "notes/new-note.md";
    createdFile.extension = "md";
    createCallback?.(createdFile);

    expect(service?.handleVaultMutation).toHaveBeenCalledWith({
      type: "create",
      path: "notes/new-note.md",
      oldPath: null,
      isMarkdown: true,
      isFolder: false,
    });

    await plugin.onunload();

    expect(service?.dispose).toHaveBeenCalledTimes(1);
    expect(plugin.getSearchService()).toBeNull();
    expect(app.workspace.detachLeavesOfType).toHaveBeenCalledWith("folder-card-view");
  });
});
