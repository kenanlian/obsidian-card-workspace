import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { getUiStrings } from "../i18n";

const testState = vi.hoisted(() => {
  class TestTFile {
    path: string;
    basename: string;
    stat: { ctime: number; mtime: number };
    parent: { path: string } | null;

    constructor(path: string) {
      this.path = path;
      this.basename = path.replace(/.*\//, "").replace(/\.md$/, "");
      this.stat = {
        ctime: new Date("2024-01-01T00:00:00Z").getTime(),
        mtime: new Date("2024-01-02T00:00:00Z").getTime(),
      };
      const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      this.parent = { path: parentPath };
    }
  }

  class TestTFolder {
    path: string;
    name: string;
    children: unknown[];
    parent: { path: string } | null;

    constructor(path: string) {
      this.path = path;
      this.name = path === "" ? "/" : path.replace(/.*\//, "");
      this.children = [];
      const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      this.parent = path === "" ? null : { path: parentPath };
    }
  }

  class TestItemView {
    app: any;
    leaf: any;
    containerEl: any;

    constructor(leaf: any) {
      this.leaf = leaf;
      this.app = leaf.app;

      const root = document.createElement("div") as HTMLElement & {
        empty: () => void;
        createDiv: (options?: { cls?: string }) => HTMLElement;
      };
      const header = document.createElement("div");
      const content = document.createElement("div") as HTMLElement & {
        empty: () => void;
        createDiv: (options?: { cls?: string }) => HTMLElement;
      };

      content.empty = () => {
        content.innerHTML = "";
      };
      content.createDiv = (options?: { cls?: string }) => {
        const child = document.createElement("div");
        if (options?.cls) {
          child.className = options.cls;
        }
        content.appendChild(child);
        return child;
      };

      root.empty = () => {
        root.innerHTML = "";
      };
      root.createDiv = (options?: { cls?: string }) => {
        const child = document.createElement("div");
        if (options?.cls) {
          child.className = options.cls;
        }
        root.appendChild(child);
        return child;
      };

      root.append(header, content);
      document.body.appendChild(root);

      this.containerEl = root;
    }
  }

  class TestMenu {
    dom = { classList: { add: vi.fn() } };

    addItem(_configure: (item: unknown) => void): this {
      return this;
    }

    showAtMouseEvent(): void {
      return;
    }
  }

  class TestModal {
    app: unknown;
    contentEl: { empty: () => void; createEl: () => void };

    constructor(app: unknown) {
      this.app = app;
      this.contentEl = {
        empty: () => {
          return;
        },
        createEl: () => {
          return;
        },
      };
    }

    setTitle(): this {
      return this;
    }

    open(): void {
      return;
    }

    close(): void {
      return;
    }
  }

  class TestSetting {
    constructor(_container: unknown) {
      return;
    }

    setName(): this {
      return this;
    }

    setDesc(): this {
      return this;
    }

    addButton(configure: (button: {
      setButtonText: (text: string) => unknown;
      setWarning: () => unknown;
      setCta: () => unknown;
      onClick: (handler: () => void) => unknown;
    }) => void): this {
      const chain = {
        setButtonText: (_text: string) => chain,
        setWarning: () => chain,
        setCta: () => chain,
        onClick: (_handler: () => void) => chain,
      };
      configure(chain);
      return this;
    }

    addText(configure: (text: {
      setValue: (value: string) => unknown;
      onChange: (handler: (value: string) => void) => unknown;
    }) => void): this {
      const chain = {
        setValue: (_value: string) => chain,
        onChange: (_handler: (value: string) => void) => chain,
      };
      configure(chain);
      return this;
    }
  }

  class ResizeObserverStub {
    observe(): void {
      return;
    }

    disconnect(): void {
      return;
    }
  }
  return {
    TestTFile,
    TestTFolder,
    TestItemView,
    TestMenu,
    TestModal,
    TestSetting,
    ResizeObserverStub,
    noticeMessages: [] as string[],
  };
});

vi.mock("obsidian", () => {
  return {
    ItemView: testState.TestItemView,
    Menu: testState.TestMenu,
    Modal: testState.TestModal,
    Notice: class {
      constructor(message: string) {
        testState.noticeMessages.push(message);
      }
    },
    Platform: { isDesktopApp: true },
    Setting: testState.TestSetting,
    TFile: testState.TestTFile,
    TFolder: testState.TestTFolder,
    setIcon: (el: Element, icon: string) => {
      el.setAttribute("data-icon", icon);
    },
    setTooltip: (el: Element, tooltip: string) => {
      el.setAttribute("data-tooltip", tooltip);
    },
    getAllTags: (cache: { tags?: Array<{ tag: string }> } | null) => {
      return cache?.tags?.map((entry) => entry.tag) ?? [];
    },
  };
});

vi.mock("../FolderPickerModal", () => {
  return {
    FolderPickerModal: class {
      constructor(_app: unknown, onChoose: (folder: unknown) => void, title?: string) {
        (testState as any).folderPickerOnChoose = onChoose;
        (testState as any).folderPickerTitle = title ?? null;
      }

      open(): void {
        (testState as any).folderPickerOpenCount = ((testState as any).folderPickerOpenCount ?? 0) + 1;
      }
    },
  };
});

vi.mock("./note-ops", async () => {
  const actual = await vi.importActual<typeof import("./note-ops")>("./note-ops");

  return {
    buildMergedNoteContent: actual.buildMergedNoteContent,
    batchDeleteFilesUsingObsidianPreference: vi.fn(async () => ({ succeeded: [], failed: [] })),
    batchMoveFiles: vi.fn(async () => ({ succeeded: [], failed: [] })),
    batchTrashFiles: vi.fn(async () => ({ succeeded: [], failed: [] })),
    copyContentToClipboard: vi.fn(async () => true),
    copyTitleAndContentToClipboard: vi.fn(async () => true),
    copyTitleToClipboard: vi.fn(async () => true),
    deleteFileUsingObsidianPreference: vi.fn(async (_app: unknown, file: unknown) => ({ ok: true, file })),
    duplicateFile: vi.fn(async (_app: unknown, file: unknown) => ({ ok: true, file })),
    mergeNotes: vi.fn(async () => ({
      ok: true,
      mergedFile: { basename: "Merged" },
      sourceCount: 2,
    })),
    moveFile: vi.fn(async (_app: unknown, file: unknown) => ({ ok: true, file })),
    trashAbstractFileUsingObsidianPreference: vi.fn(async (app: { fileManager: { trashFile: (file: unknown) => Promise<void> } }, file: unknown) => {
      await app.fileManager.trashFile(file);
    }),
  };
});

import { FolderCardView } from "./FolderCardView";
import type { SearchServiceSnapshot } from "../search";
import type { CardFileKind } from "./file-kind";
import type { FolderTreeNode, NoteCardRecord } from "./types";

interface TestHarness {
  view: FolderCardView;
  plugin: {
    getSettings: ReturnType<typeof vi.fn>;
    getSearchService: ReturnType<typeof vi.fn>;
    getSearchSnapshot: ReturnType<typeof vi.fn>;
    subscribeSearchSnapshots: ReturnType<typeof vi.fn>;
    saveSettings: ReturnType<typeof vi.fn>;
    openNoteFromCard: ReturnType<typeof vi.fn>;
    selectAllNotes: ReturnType<typeof vi.fn>;
    createNoteInCurrentFolder: ReturnType<typeof vi.fn>;
    createNoteInFolder: ReturnType<typeof vi.fn>;
    selectFolderByPath: ReturnType<typeof vi.fn>;
  };
  panelContainer: HTMLElement;
}

function createCard(path: string, title: string, fileKind: CardFileKind = "markdown"): NoteCardRecord {
  const isMarkdown = fileKind === "markdown";

  return {
    file: new testState.TestTFile(path) as unknown as never,
    fileKind,
    path,
    title,
    ctime: new Date("2024-01-02T10:00:00Z").getTime(),
    mtime: new Date("2024-02-03T12:00:00Z").getTime(),
    excerpt: "",
    previewHtml: isMarkdown ? "<p>Preview text</p>" : "",
    previewMode: isMarkdown ? "text" : "placeholder",
    hydrated: true,
  };
}

function createFolder(path: string, children: Array<InstanceType<typeof testState.TestTFolder>> = []): InstanceType<typeof testState.TestTFolder> {
  const folder = new testState.TestTFolder(path);
  folder.children = children;
  for (const child of children) {
    child.parent = { path: folder.path };
  }
  return folder;
}

function createHarness(): TestHarness {
  const settings = {
    sort: { field: "mtime", direction: "desc" },
    filter: { tags: [] },
    pinnedPaths: [],
    cardCornerRadius: "compact",
    previewLines: 5,
    includeSubfolders: true,
    boxes: [],
    activeBoxId: null,
    navPaneWidth: 240,
    navPaneCollapsed: false,
    showNavItemCounts: false,
  };

  const app = {
    workspace: {
      leftSplit: { id: "left-split" },
      trigger: vi.fn(),
    },
    metadataCache: {
      getFileCache: vi.fn(() => null),
    },
    vault: {
      adapter: { getFullPath: vi.fn((path: string) => `/vault/${path}`) },
      getAbstractFileByPath: vi.fn(() => null),
      getMarkdownFiles: vi.fn(() => []),
      getRoot: vi.fn(() => new testState.TestTFolder("")),
      createFolder: vi.fn(async (path: string) => new testState.TestTFolder(path)),
      cachedRead: vi.fn(async () => ""),
      read: vi.fn(async () => ""),
    },
    fileManager: {
      renameFile: vi.fn(async () => undefined),
      promptForDeletion: vi.fn(async () => true),
      trashFile: vi.fn(async () => undefined),
    },
  };

  const leaf = {
    app,
    getRoot: vi.fn(() => app.workspace.leftSplit),
  };

  const plugin = {
    getSettings: vi.fn(() => settings),
    getUiLanguage: vi.fn(() => "en"),
    getUiStrings: vi.fn(() => getUiStrings("en")),
    getSearchService: vi.fn(() => null),
    getSearchSnapshot: vi.fn(() => null),
    subscribeSearchSnapshots: vi.fn(() => () => undefined),
    saveSettings: vi.fn(async (partial: Record<string, unknown>) => {
      Object.assign(settings, partial);
    }),
    openNoteFromCard: vi.fn(),
    selectAllNotes: vi.fn(async () => {
      return;
    }),
    createNoteInCurrentFolder: vi.fn(async () => {
      return;
    }),
    createNoteInFolder: vi.fn(async () => {
      return;
    }),
    selectFolderByPath: vi.fn(async () => {
      return;
    }),
  };

  const view = new FolderCardView(leaf as never, plugin as never);
  const panelContainer = (view.containerEl.children[1] as HTMLElement);

  return {
    view,
    plugin,
    panelContainer,
  };
}

function getPanelState(view: FolderCardView): {
  cards: NoteCardRecord[];
  searchMatchCountsByPath: Record<string, number>;
  [key: string]: unknown;
} {
  return (view as any).panelModel.getState();
}

function getTagNode(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".fce-tag-menu .fce-tree-button"))
    .find((button) => button.textContent?.includes(label));
}

describe("FolderCardView host contract", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    testState.noticeMessages.length = 0;
    (testState as any).folderPickerOnChoose = undefined;
    (testState as any).folderPickerTitle = null;
    (testState as any).folderPickerOpenCount = 0;
    (globalThis as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = testState.ResizeObserverStub as never;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("mounts panel and propagates updates", async () => {
    const { view, panelContainer } = createHarness();

    await view.onOpen();
    await tick();

    expect(panelContainer.querySelectorAll(".folder-card-view")).toHaveLength(1);
    expect(panelContainer.querySelector(".fce-shell")).not.toBeNull();
    expect((view as any).panelModel.getState().cardCornerRadius).toBe("compact");

    (view as any).folderPath = "notes";
    (view as any).baseCards = [createCard("notes/runtime.md", "Runtime host note")];
    (view as any).pushState();
    await tick();

    expect(panelContainer.textContent).toContain("Runtime host note");
    expect(panelContainer.querySelector(".fce-list")).not.toBeNull();

    await view.onClose();
  });
  it("re-sorts loaded cards immediately when sort changes to filename order", async () => {
    const { view, plugin } = createHarness();
    const zetaCard = createCard("notes/zeta.md", "Zeta");
    const alphaCard = createCard("notes/alpha.md", "Alpha");

    (view as any).folderPath = "notes";
    (view as any).baseCards = [zetaCard, alphaCard];

    await (view as any).onSortChange({ field: "name", direction: "asc" });

    expect(plugin.saveSettings).toHaveBeenCalledWith({
      sort: {
        field: "name",
        direction: "asc",
      },
    });
    expect((view as any).baseCards.map((card: NoteCardRecord) => card.title)).toEqual(["Alpha", "Zeta"]);
    expect(getPanelState(view).sortField).toBe("name");
    expect(getPanelState(view).sortDirection).toBe("asc");
  });

  it("repositions an in-scope renamed card under filename sorting", () => {
    const { view, plugin } = createHarness();
    const settings = {
      sort: { field: "name", direction: "asc" },
      filter: { tags: [] },
      pinnedPaths: [],
      cardCornerRadius: "compact",
      previewLines: 5,
      includeSubfolders: true,
    };
    const alphaCard = createCard("notes/alpha.md", "Alpha");
    const zetaCard = createCard("notes/zeta.md", "Zeta");
    const renamedFile = new testState.TestTFile("notes/zulu.md");

    plugin.getSettings = vi.fn(() => settings);
    (view.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      path === "notes/zulu.md" ? renamedFile : null,
    );

    (view as any).folderPath = "notes";
    (view as any).baseCards = [alphaCard, zetaCard];

    const result = (view as any).handleVaultMutation({
      eventType: "rename",
      path: "notes/zulu.md",
      oldPath: "notes/alpha.md",
      isFolder: false,
      fileKind: "markdown",
    });

    expect(result.shouldRefresh).toBe(false);
    expect(result.incrementalResult?.action).toBe("updated");
    expect((view as any).baseCards.map((card: NoteCardRecord) => card.title)).toEqual(["Zeta", "zulu"]);
    expect((view as any).baseCards.map((card: NoteCardRecord) => card.path)).toEqual([
      "notes/zeta.md",
      "notes/zulu.md",
    ]);
  });


  it("persists a selected nested tag from the navigation pane tag tree", async () => {
    const { view, plugin } = createHarness();

    plugin.getSettings = vi.fn(() => ({
      sort: { field: "mtime", direction: "desc" },
      filter: { tags: [] },
      pinnedPaths: [],
      cardCornerRadius: "compact",
      previewLines: 5,
      includeSubfolders: true,
    }));
    view.app.metadataCache.getFileCache = vi.fn(() => ({
      tags: [{ tag: "#Work/AI/harness", position: { start: { col: 0, line: 0, offset: 0 }, end: { col: 16, line: 0, offset: 16 } } }],
    }));

    (view as any).baseCards = [createCard("notes/runtime.md", "Runtime host note")];
    await view.onOpen();
    (view as any).pushState();
    await tick();

    expect(getTagNode("Work")).not.toBeUndefined();
    expect(getTagNode("Work/AI")).toBeUndefined();

    const workChevron = document.querySelector<HTMLButtonElement>(".fce-tag-menu .fce-tree-item-icon[aria-label='Expand']");
    expect(workChevron).not.toBeNull();
    workChevron?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    const nestedNode = getTagNode("AI");
    expect(nestedNode).not.toBeUndefined();
    expect(getTagNode("Work/AI")).toBeUndefined();

    const nestedChevron = Array.from(document.querySelectorAll<HTMLButtonElement>(".fce-tag-menu .fce-tree-item-icon"))
      .find((button) => button.getAttribute("aria-label") === "Expand");
    expect(nestedChevron).not.toBeUndefined();
    nestedChevron?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    const leafNode = getTagNode("harness");
    expect(leafNode).not.toBeUndefined();
    expect(getTagNode("Work/AI/harness")).toBeUndefined();

    leafNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(plugin.saveSettings).toHaveBeenCalledWith({
      filter: {
        tags: ["work/ai/harness"],
      },
    });
  });

  it("toggles off an active tag from the navigation pane tag tree", async () => {
    const { view, plugin } = createHarness();
    const settings = {
      sort: { field: "mtime", direction: "desc" },
      filter: { tags: ["work/ai"] },
      pinnedPaths: [],
      cardCornerRadius: "compact",
      previewLines: 5,
      includeSubfolders: true,
    };

    plugin.getSettings = vi.fn(() => settings);
    plugin.saveSettings = vi.fn(async (partial: Record<string, unknown>) => {
      Object.assign(settings, partial);
    });

    view.app.metadataCache.getFileCache = vi.fn(() => ({
      tags: [{ tag: "#Work/AI", position: { start: { col: 0, line: 0, offset: 0 }, end: { col: 8, line: 0, offset: 8 } } }],
    }));
    (view as any).baseCards = [createCard("notes/runtime.md", "Runtime host note")];

    await view.onOpen();
    (view as any).pushState();
    await tick();

    const nestedNode = getTagNode("AI");
    expect(nestedNode).not.toBeUndefined();
    expect(nestedNode?.getAttribute("aria-checked")).toBe("true");
    nestedNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    (view as any).pushState();
    await tick();

    expect(settings.filter.tags).toEqual([]);
  });

  it("computes default and search-specific empty-state messages", () => {
    const { view, plugin } = createHarness();

    expect((view as any).buildEmptyStateMessage()).toBe("No supported files found in this folder.");

    (view as any).searchQuery = "  alpha  ";
    (view as any).folderPath = "notes";
    plugin.getSettings = vi.fn(() => ({
      sort: { field: "mtime", direction: "desc" },
      filter: { tags: [] },
      pinnedPaths: [],
      cardCornerRadius: "compact",
      previewLines: 5,
      includeSubfolders: true,
    }));
    expect((view as any).buildEmptyStateMessage()).toBe('No results for “alpha” in current folder.');

    plugin.getSettings = vi.fn(() => ({
      sort: { field: "mtime", direction: "desc" },
      filter: { tags: ["tag-a"] },
      pinnedPaths: [],
      cardCornerRadius: "compact",
      previewLines: 5,
      includeSubfolders: true,
    }));
    expect((view as any).buildEmptyStateMessage()).toBe('No results for “alpha” in current folder and tag scope.');

    (view as any).folderPath = "";
    expect((view as any).buildEmptyStateMessage()).toBe('No results for “alpha” in current folder and tag scope.');

    plugin.getSettings = vi.fn(() => ({
      sort: { field: "mtime", direction: "desc" },
      filter: { tags: [] },
      pinnedPaths: [],
      cardCornerRadius: "compact",
      previewLines: 5,
      includeSubfolders: true,
    }));
    expect((view as any).buildEmptyStateMessage()).toBe('No results for “alpha” in current folder.');
  });

  it("repeated open/close cycles do not leave stale panel DOM or duplicate open handlers", async () => {
    const { view, plugin, panelContainer } = createHarness();

    (view as any).folderPath = "notes";
    (view as any).baseCards = [createCard("notes/cycle.md", "Cycle note")];

    for (let cycle = 0; cycle < 2; cycle += 1) {
      await view.onOpen();
      (view as any).pushState();
      await tick();

      const cardEl = panelContainer.querySelector<HTMLDivElement>(".fce-card");
      expect(cardEl).not.toBeNull();
      cardEl?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(plugin.openNoteFromCard).toHaveBeenCalledTimes(cycle + 1);
      expect(plugin.openNoteFromCard).toHaveBeenLastCalledWith("notes/cycle.md");

      await view.onClose();
      await tick();

      expect(panelContainer.querySelector(".fce-shell")).toBeNull();
    }

    expect(panelContainer.querySelectorAll(".folder-card-view")).toHaveLength(1);
    expect(panelContainer.querySelector(".fce-shell")).toBeNull();
  });

  it("debounces active query projection by 120ms and maps empty query status from snapshot", async () => {
    vi.useFakeTimers();
    try {
      const { view, plugin } = createHarness();
      const query = vi.fn(async () => ({
        mode: "indexed",
        status: "ready",
        execution: "indexed-ready",
        orderedPaths: ["notes/alpha.md"],
      }));
      plugin.getSearchService = vi.fn(() => ({ query }));
      plugin.getSearchSnapshot = vi.fn(() => ({
        initialized: true,
        disposed: false,
        mode: "indexed",
        status: "ready",
        lastError: null,
        health: createSearchHealth(),
      }));

      (view as any).folderPath = "notes";
      (view as any).baseCards = [createCard("notes/alpha.md", "Alpha")];

      await view.onOpen();
      expect((view as any).searchStatus).toBe("ready");
      expect(getPanelState(view).searchMatchCountsByPath).toEqual({});

      (view as any).onSearchQueryChange({ query: "alpha" });
      vi.advanceTimersByTime(119);
      await Promise.resolve();
      expect(query).not.toHaveBeenCalled();
      expect(getPanelState(view).searchMatchCountsByPath).toEqual({});

      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
      expect(query).toHaveBeenCalledTimes(1);

      (view as any).resetSearchQuery();
      expect((view as any).searchQuery).toBe("");
      expect((view as any).searchOrderedPaths).toBeUndefined();
      expect((view as any).searchStatus).toBe("ready");
      expect(getPanelState(view).searchMatchCountsByPath).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps typed query editable while blocked and auto-runs it once indexed search becomes ready", async () => {
    vi.useFakeTimers();
    try {
      const { view, plugin } = createHarness();
      const query = vi.fn()
        .mockResolvedValueOnce({
          mode: "indexed",
          status: "building",
          execution: "indexed-rebuild-required",
        })
        .mockResolvedValueOnce({
          mode: "indexed",
          status: "ready",
          execution: "indexed-ready",
          orderedPaths: ["notes/beta.md"],
        });
      let snapshotListener: ((snapshot: SearchServiceSnapshot) => void) | null = null;
      const emitSnapshot = (snapshot: SearchServiceSnapshot): void => {
        const listener = snapshotListener;
        if (!listener) {
          throw new Error("Expected search snapshot listener to be registered.");
        }

        listener(snapshot);
      };

      plugin.getSearchService = vi.fn(() => ({ query }));
      plugin.getSearchSnapshot = vi.fn(() => ({
        initialized: true,
        disposed: false,
        mode: "indexed",
        status: "building",
        lastError: null,
        health: createSearchHealth({
          outcome: "rebuild-required",
          readiness: "rebuild-required",
          healthy: false,
          rebuilding: true,
          rebuildRequired: true,
          documentCount: null,
          lastIndexedAt: null,
          rebuildReason: "version-drift",
          detail: "rebuilding",
        }),
      }));
      plugin.subscribeSearchSnapshots = vi.fn((listener: (snapshot: SearchServiceSnapshot) => void) => {
        snapshotListener = listener;
        return () => {
          snapshotListener = null;
        };
      });

      (view as any).folderPath = "notes";
      (view as any).baseCards = [
        createCard("notes/alpha.md", "Alpha"),
        createCard("notes/beta.md", "Beta"),
      ];

      await view.onOpen();
      expect((view as any).searchStatus).toBe("rebuild-required");

      (view as any).onSearchQueryChange({ query: "beta" });
      expect((view as any).searchQuery).toBe("beta");
      expect((view as any).visibleCards).toEqual([]);

      vi.advanceTimersByTime(120);
      await Promise.resolve();
      await Promise.resolve();
      expect(query).toHaveBeenCalledTimes(1);
      expect((view as any).visibleCards).toEqual([]);

      emitSnapshot({
        initialized: true,
        disposed: false,
        mode: "indexed",
        status: "ready",
        lastError: null,
        health: createSearchHealth({
          outcome: "restored",
          readiness: "ready",
          healthy: true,
          rebuilding: false,
          rebuildRequired: false,
          documentCount: 2,
          lastIndexedAt: 1,
        }),
      });

      await Promise.resolve();
      await Promise.resolve();

      expect(query).toHaveBeenCalledTimes(2);
      expect((view as any).searchQuery).toBe("beta");
      expect((view as any).searchStatus).toBe("ready");
      expect((view as any).visibleCards.map((card: NoteCardRecord) => card.path)).toEqual(["notes/beta.md"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops stale query results after snapshot transition and clears snapshot subscription on close", async () => {
    vi.useFakeTimers();
    try {
      const { view, plugin } = createHarness();
      const pending: Array<{ resolve: (result: unknown) => void }> = [];
      const query = vi.fn(() => {
        return new Promise((resolve) => {
          pending.push({ resolve });
        });
      });
      const unsubscribe = vi.fn();
      let snapshotListener: ((snapshot: SearchServiceSnapshot) => void) | null = null;
      const emitSnapshot = (snapshot: SearchServiceSnapshot): void => {
        const listener = snapshotListener;
        if (!listener) {
          return;
        }

        listener(snapshot);
      };

      plugin.getSearchService = vi.fn(() => ({ query }));
      plugin.getSearchSnapshot = vi.fn(() => ({
        initialized: true,
        disposed: false,
        mode: "indexed",
        status: "ready",
        lastError: null,
        health: createSearchHealth({ documentCount: 2, lastSuccessfulRestore: { outcome: "restored", at: 1, documentCount: 2, detail: "restored" } }),
      }));
      plugin.subscribeSearchSnapshots = vi.fn((listener: (snapshot: SearchServiceSnapshot) => void) => {
        snapshotListener = listener;
        return unsubscribe;
      });

      (view as any).folderPath = "notes";
      (view as any).baseCards = [createCard("notes/alpha.md", "Alpha"), createCard("notes/beta.md", "Beta")];

      await view.onOpen();

      (view as any).onSearchQueryChange({ query: "beta" });
      vi.advanceTimersByTime(120);
      await Promise.resolve();
      expect(query).toHaveBeenCalledTimes(1);

      emitSnapshot({
        initialized: true,
        disposed: false,
        mode: "indexed",
        status: "building",
        lastError: null,
        health: createSearchHealth({
          outcome: "rebuild-required",
          readiness: "rebuild-required",
          healthy: false,
          rebuilding: true,
          rebuildRequired: true,
          documentCount: null,
          lastIndexedAt: null,
          rebuildReason: "version-drift",
          detail: "rebuilding",
        }),
      });

      pending[0]?.resolve({
        mode: "indexed",
        status: "ready",
        execution: "indexed-ready",
        orderedPaths: ["notes/beta.md"],
      });
      await Promise.resolve();
      await Promise.resolve();

      expect((view as any).searchStatus).toBe("rebuild-required");
      expect((view as any).searchOrderedPaths).toBeUndefined();
      expect(getPanelState(view).searchMatchCountsByPath).toEqual({});

      await view.onClose();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleanupLifecycle is idempotent across repeated close calls and clears pending search runtime state", async () => {
    vi.useFakeTimers();
    try {
      const { view, plugin } = createHarness();
      const unsubscribe = vi.fn();

      plugin.getSearchSnapshot = vi.fn(() => ({
        initialized: true,
        disposed: false,
        mode: "indexed",
        status: "ready",
        lastError: null,
        health: createSearchHealth({ documentCount: 1, lastIndexedAt: 1 }),
      }));
      plugin.subscribeSearchSnapshots = vi.fn(() => unsubscribe);

      (view as any).folderPath = "notes";
      (view as any).baseCards = [createCard("notes/alpha.md", "Alpha")];

      await view.onOpen();
      (view as any).onSearchQueryChange({ query: "alpha" });

      expect((view as any).searchDebounceTimer).not.toBeNull();
      expect((view as any).searchSnapshotUnsubscribe).toBeTypeOf("function");

      await view.onClose();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect((view as any).component).toBeNull();
      expect((view as any).hostEl).toBeNull();
      expect((view as any).searchDebounceTimer).toBeNull();
      expect((view as any).searchSnapshotUnsubscribe).toBeNull();
      expect((view as any).searchQuery).toBe("");
      expect((view as any).searchOrderedPaths).toBeUndefined();
      expect((view as any).searchSnapshot).toBeNull();
      expect(getPanelState(view).searchMatchCountsByPath).toEqual({});

      await view.onClose();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect((view as any).searchDebounceTimer).toBeNull();
      expect((view as any).searchSnapshotUnsubscribe).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps cleanup isolated across multiple leaves of the same view type", async () => {
    vi.useFakeTimers();
    try {
      const harnessA = createHarness();
      const harnessB = createHarness();
      const unsubscribeA = vi.fn();
      const unsubscribeB = vi.fn();

      harnessA.plugin.getSearchSnapshot = vi.fn(() => ({
        initialized: true,
        disposed: false,
        mode: "indexed",
        status: "ready",
        lastError: null,
        health: createSearchHealth({ documentCount: 1, lastIndexedAt: 1 }),
      }));
      harnessB.plugin.getSearchSnapshot = vi.fn(() => ({
        initialized: true,
        disposed: false,
        mode: "indexed",
        status: "ready",
        lastError: null,
        health: createSearchHealth({ documentCount: 1, lastIndexedAt: 1 }),
      }));
      harnessA.plugin.subscribeSearchSnapshots = vi.fn(() => unsubscribeA);
      harnessB.plugin.subscribeSearchSnapshots = vi.fn(() => unsubscribeB);

      (harnessA.view as any).folderPath = "notes-a";
      (harnessA.view as any).baseCards = [createCard("notes-a/alpha.md", "Alpha")];
      (harnessB.view as any).folderPath = "notes-b";
      (harnessB.view as any).baseCards = [createCard("notes-b/beta.md", "Beta")];

      await harnessA.view.onOpen();
      await harnessB.view.onOpen();

      (harnessA.view as any).onSearchQueryChange({ query: "alpha" });
      (harnessB.view as any).onSearchQueryChange({ query: "beta" });

      expect((harnessA.view as any).searchDebounceTimer).not.toBeNull();
      expect((harnessB.view as any).searchDebounceTimer).not.toBeNull();

      await harnessA.view.onClose();

      expect(unsubscribeA).toHaveBeenCalledTimes(1);
      expect(unsubscribeB).not.toHaveBeenCalled();
      expect((harnessA.view as any).hostEl).toBeNull();
      expect((harnessA.view as any).searchDebounceTimer).toBeNull();
      expect((harnessA.view as any).searchSnapshotUnsubscribe).toBeNull();
      expect((harnessB.view as any).hostEl).not.toBeNull();
      expect((harnessB.view as any).searchDebounceTimer).not.toBeNull();
      expect((harnessB.view as any).searchSnapshotUnsubscribe).toBeTypeOf("function");

      await harnessB.view.onClose();

      expect(unsubscribeB).toHaveBeenCalledTimes(1);
      expect((harnessB.view as any).hostEl).toBeNull();
      expect((harnessB.view as any).searchDebounceTimer).toBeNull();
      expect((harnessB.view as any).searchSnapshotUnsubscribe).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("threads indexed-ready match counts through panel state without mutating cards", async () => {
    vi.useFakeTimers();
    try {
      const { view, plugin } = createHarness();
      const query = vi.fn(async () => ({
        mode: "indexed",
        status: "ready",
        execution: "indexed-ready",
        orderedPaths: ["notes/alpha.md"],
        matchCountsByPath: { "notes/alpha.md": 3 },
      }));
      plugin.getSearchService = vi.fn(() => ({ query }));
      plugin.getSearchSnapshot = vi.fn(() => ({
        initialized: true,
        disposed: false,
        mode: "indexed",
        status: "ready",
        lastError: null,
        health: createSearchHealth(),
      }));

      (view as any).folderPath = "notes";
      const card = createCard("notes/alpha.md", "Alpha");
      (view as any).baseCards = [card];

      await view.onOpen();
      (view as any).onSearchQueryChange({ query: "alpha" });
      vi.advanceTimersByTime(120);
      await Promise.resolve();
      await Promise.resolve();

      const panelState = getPanelState(view);
      expect(panelState.searchMatchCountsByPath).toEqual({ "notes/alpha.md": 3 });
      expect((view as any).baseCards[0]).toBe(card);
      expect(panelState.cards[0]).not.toHaveProperty("matchCount");
      expect(panelState.cards[0]).not.toHaveProperty("searchMatchCount");
      expect(panelState.cards[0]).toMatchObject({ path: "notes/alpha.md", title: "Alpha" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders a search badge from indexed-ready count metadata even when the visible preview omits the query text", async () => {
    vi.useFakeTimers();
    try {
      const { view, plugin, panelContainer } = createHarness();
      const query = vi.fn(async () => ({
        mode: "indexed",
        status: "ready",
        execution: "indexed-ready",
        orderedPaths: ["notes/deep-hit.md"],
        matchCountsByPath: { "notes/deep-hit.md": 4 },
      }));
      plugin.getSearchService = vi.fn(() => ({ query }));
      plugin.getSearchSnapshot = vi.fn(() => ({
        initialized: true,
        disposed: false,
        mode: "indexed",
        status: "ready",
        lastError: null,
        health: createSearchHealth(),
      }));

      const deepHitCard = createCard("notes/deep-hit.md", "Roadmap");
      deepHitCard.previewHtml = "<p>Visible preview only</p>";
      deepHitCard.excerpt = "Visible preview only";
      (view as any).folderPath = "notes";
      (view as any).baseCards = [deepHitCard];

      await view.onOpen();
      (view as any).onSearchQueryChange({ query: "alpha" });
      vi.advanceTimersByTime(120);
      await Promise.resolve();
      await Promise.resolve();
      await tick();

      const cardEl = panelContainer.querySelector(".fce-card");
      const badge = panelContainer.querySelector(".fce-card-search-count");
      expect(cardEl?.textContent).toContain("Visible preview only");
      expect(cardEl?.textContent).not.toContain("alpha");
      expect(badge?.textContent?.trim()).toBe("4 matches");
      expect(badge?.getAttribute("aria-label")).toBe("4 matches in this note");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears search counts immediately on empty query and ignores stale results", async () => {
    vi.useFakeTimers();
    try {
      const { view, plugin } = createHarness();
      const pending: Array<{ resolve: (value: unknown) => void }> = [];
      const query = vi.fn(() => {
        return new Promise((resolve) => {
          pending.push({ resolve });
        });
      });
      plugin.getSearchService = vi.fn(() => ({ query }));
      plugin.getSearchSnapshot = vi.fn(() => ({
        initialized: true,
        disposed: false,
        mode: "indexed",
        status: "ready",
        lastError: null,
        health: createSearchHealth(),
      }));

      (view as any).folderPath = "notes";
      (view as any).baseCards = [createCard("notes/alpha.md", "Alpha")];

      await view.onOpen();
      (view as any).onSearchQueryChange({ query: "alpha" });
      vi.advanceTimersByTime(120);
      await Promise.resolve();

      (view as any).resetSearchQuery();
      expect(getPanelState(view).searchMatchCountsByPath).toEqual({});

      pending[0]?.resolve({
        mode: "indexed",
        status: "ready",
        execution: "indexed-ready",
        orderedPaths: ["notes/alpha.md"],
        matchCountsByPath: { "notes/alpha.md": 7 },
      });
      await Promise.resolve();
      await Promise.resolve();

      expect((view as any).searchQuery).toBe("");
      expect(getPanelState(view).searchMatchCountsByPath).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it("exposes empty counts for blocked indexed search states", async () => {
    const { view, plugin } = createHarness();
    plugin.getSearchSnapshot = vi.fn(() => ({
      initialized: true,
      disposed: false,
      mode: "indexed",
      status: "building",
      lastError: null,
      health: createSearchHealth({
        outcome: "rebuild-required",
        readiness: "rebuild-required",
        healthy: false,
        rebuilding: true,
        rebuildRequired: true,
        documentCount: null,
        lastIndexedAt: null,
        rebuildReason: "version-drift",
        detail: "rebuilding",
      }),
    }));
    plugin.getSearchService = vi.fn(() => null);

    (view as any).folderPath = "notes";
    (view as any).baseCards = [createCard("notes/alpha.md", "Alpha")];

    await view.onOpen();
    (view as any).onSearchQueryChange({ query: "alpha" });

    expect(getPanelState(view).searchMatchCountsByPath).toEqual({});
    expect((view as any).searchStatus).toBe("rebuild-required");
  });

  it("does not let stale indexed-ready results overwrite current counts", async () => {
    vi.useFakeTimers();
    try {
      const { view, plugin } = createHarness();
      const pending: Array<{ resolve: (value: unknown) => void }> = [];
      const query = vi.fn(() => {
        return new Promise((resolve) => {
          pending.push({ resolve });
        });
      });
      plugin.getSearchService = vi.fn(() => ({ query }));
      plugin.getSearchSnapshot = vi.fn(() => ({
        initialized: true,
        disposed: false,
        mode: "indexed",
        status: "ready",
        lastError: null,
        health: createSearchHealth(),
      }));

      (view as any).folderPath = "notes";
      (view as any).baseCards = [createCard("notes/alpha.md", "Alpha"), createCard("notes/beta.md", "Beta")];

      await view.onOpen();
      (view as any).onSearchQueryChange({ query: "alpha" });
      vi.advanceTimersByTime(120);
      await Promise.resolve();
      expect(query).toHaveBeenCalledTimes(1);

      (view as any).onSearchQueryChange({ query: "beta" });
      vi.advanceTimersByTime(120);
      await Promise.resolve();
      expect(query).toHaveBeenCalledTimes(2);

      pending[0]?.resolve({
        mode: "indexed",
        status: "ready",
        execution: "indexed-ready",
        orderedPaths: ["notes/alpha.md"],
        matchCountsByPath: { "notes/alpha.md": 1 },
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(getPanelState(view).searchMatchCountsByPath).toEqual({});

      pending[1]?.resolve({
        mode: "indexed",
        status: "ready",
        execution: "indexed-ready",
        orderedPaths: ["notes/beta.md"],
        matchCountsByPath: { "notes/beta.md": 2 },
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(getPanelState(view).searchMatchCountsByPath).toEqual({ "notes/beta.md": 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards allowed card hover surfaces through to workspace hover-link trigger for markdown cards", async () => {
    const { view } = createHarness();

    (view as any).folderPath = "notes";
    (view as any).baseCards = [createCard("notes/hover.md", "Hover card")];

    await view.onOpen();
    (view as any).pushState();
    await tick();

    const titleGroup = (view as any).containerEl.querySelector(".fce-card-title-group") as HTMLElement | null;
    const excerpt = (view as any).containerEl.querySelector(".fce-excerpt") as HTMLElement | null;
    expect(titleGroup).not.toBeNull();
    expect(excerpt).not.toBeNull();
    expect((view as any).containerEl.querySelector(".fce-meta")).toBeNull();

    const titleEvent = new MouseEvent("mouseenter", { bubbles: true });
    titleGroup?.dispatchEvent(titleEvent);

    const excerptEvent = new MouseEvent("mouseenter", { bubbles: true });
    excerpt?.dispatchEvent(excerptEvent);

    const triggerSpy = (view as any).app.workspace.trigger as ReturnType<typeof vi.fn>;
    expect(triggerSpy).toHaveBeenCalledTimes(2);
    expect(triggerSpy).toHaveBeenNthCalledWith(1, "hover-link", {
      event: titleEvent,
      source: "card-workspace",
      hoverParent: view,
      targetEl: titleGroup,
      linktext: "notes/hover.md",
    });
    expect(triggerSpy).toHaveBeenNthCalledWith(2, "hover-link", {
      event: excerptEvent,
      source: "card-workspace",
      hoverParent: view,
      targetEl: excerpt,
      linktext: "notes/hover.md",
    });
  });

  it("forwards allowed card hover surfaces for supported non-markdown cards but excludes action controls", async () => {
    const { view } = createHarness();

    (view as any).folderPath = "notes";
    (view as any).baseCards = [createCard("notes/diagram.canvas", "diagram.canvas", "canvas")];

    await view.onOpen();
    (view as any).pushState();
    await tick();

    const triggerSpy = (view as any).app.workspace.trigger as ReturnType<typeof vi.fn>;

    const titleGroup = (view as any).containerEl.querySelector(".fce-card-title-group") as HTMLElement | null;
    const excerpt = (view as any).containerEl.querySelector(".fce-excerpt") as HTMLElement | null;
    const pinButton = (view as any).containerEl.querySelector(".fce-card-pin-btn") as HTMLButtonElement | null;
    const moreActionsButton = (view as any).containerEl.querySelector(".fce-more-actions-btn") as HTMLButtonElement | null;

    expect(titleGroup).not.toBeNull();
    expect(excerpt).not.toBeNull();
    expect((view as any).containerEl.querySelector(".fce-meta")).toBeNull();
    expect(pinButton).not.toBeNull();
    expect(moreActionsButton).not.toBeNull();

    titleGroup?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    excerpt?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    pinButton?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    moreActionsButton?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    expect(triggerSpy).toHaveBeenCalledTimes(2);
    expect(triggerSpy).toHaveBeenNthCalledWith(1, "hover-link", expect.objectContaining({
      targetEl: titleGroup,
      linktext: "notes/diagram.canvas",
    }));
    expect(triggerSpy).toHaveBeenNthCalledWith(2, "hover-link", expect.objectContaining({
      targetEl: excerpt,
      linktext: "notes/diagram.canvas",
    }));
  });
  it("builds a folder tree with vault root as a selectable top-level row", () => {
    const { view } = createHarness();
    const root = new testState.TestTFolder("");
    const projects = new testState.TestTFolder("projects");
    const archive = new testState.TestTFolder("archive");
    const nested = new testState.TestTFolder("projects/client-a");
    projects.children = [nested];
    root.children = [projects, archive];
    (view.app.vault.getRoot as ReturnType<typeof vi.fn>).mockReturnValue(root);

    const tree = (view as any).buildFolderTree();

    expect(tree).toEqual([
      {
        name: "/",
        path: "/",
        children: [],
        depth: 0,
        directCount: 0,
        recursiveCount: 0,
        recursiveFolderCount: 3,
      },
      {
        name: "archive",
        path: "archive",
        children: [],
        depth: 0,
        directCount: 0,
        recursiveCount: 0,
        recursiveFolderCount: 0,
      },
      {
        name: "projects",
        path: "projects",
        children: [
          {
            name: "client-a",
            path: "projects/client-a",
            children: [],
            depth: 1,
            directCount: 0,
            recursiveCount: 0,
            recursiveFolderCount: 0,
          },
        ],
        depth: 0,
        directCount: 0,
        recursiveCount: 0,
        recursiveFolderCount: 1,
      },
    ]);
  });

  it("counts supported card files and descendant folders regardless of the inline count setting", () => {
    const { view } = createHarness();
    const settings = (view as any).plugin.getSettings() as Record<string, unknown>;
    const nested = new testState.TestTFolder("projects/client-a");
    nested.children = [
      new testState.TestTFile("projects/client-a/brief.md"),
      new testState.TestTFile("projects/client-a/board.canvas"),
      new testState.TestTFile("projects/client-a/logo.png"),
    ];
    const projects = new testState.TestTFolder("projects");
    projects.children = [
      nested,
      new testState.TestTFile("projects/index.md"),
      new testState.TestTFile("projects/cover.png"),
    ];
    const root = new testState.TestTFolder("");
    root.children = [projects, new testState.TestTFile("inbox.md")];
    (view.app.vault.getRoot as ReturnType<typeof vi.fn>).mockReturnValue(root);

    settings.showNavItemCounts = true;

    const [rootNode, projectsNode] = (view as any).buildFolderTree() as FolderTreeNode[];

    expect(rootNode.directCount).toBe(1);
    expect(rootNode.recursiveCount).toBe(4);
    expect(rootNode.recursiveFolderCount).toBe(2);
    expect(projectsNode.directCount).toBe(1);
    expect(projectsNode.recursiveCount).toBe(3);
    expect(projectsNode.recursiveFolderCount).toBe(1);
    expect(projectsNode.children[0].directCount).toBe(2);
    expect(projectsNode.children[0].recursiveCount).toBe(2);
    expect(projectsNode.children[0].recursiveFolderCount).toBe(0);

    settings.showNavItemCounts = false;

    const [disabledRootNode, disabledProjectsNode] = (view as any).buildFolderTree() as FolderTreeNode[];

    expect(disabledRootNode.recursiveCount).toBe(4);
    expect(disabledRootNode.recursiveFolderCount).toBe(2);
    expect(disabledProjectsNode.recursiveCount).toBe(3);
  });

  it("normalizes slash root selection requests to the internal empty-string folder path", async () => {
    const { view } = createHarness();
    const root = new testState.TestTFolder("");
    (view.app.vault.getRoot as ReturnType<typeof vi.fn>).mockReturnValue(root);

    const result = await (view as any).handleFolderSelection({
      requestId: 1,
      folderPath: "/",
      source: "programmatic",
      requestedAtMs: Date.now(),
      forceRefresh: true,
    });

    expect(result).toMatchObject({
      action: "started",
      folderPath: "",
    });
    expect((view as any).folderPath).toBe("");
  });

  it("swaps the single-pane view without persisting navPaneCollapsed", async () => {
    const { view, plugin } = createHarness();

    (view as any).onShellResize(400);
    expect(getPanelState(view).layoutMode).toBe("single");
    expect(getPanelState(view).navVisible).toBe(false);

    await (view as any).onToggleNavPane();
    expect(getPanelState(view).navVisible).toBe(true);

    await (view as any).onToggleNavPane();
    expect(getPanelState(view).navVisible).toBe(false);

    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it("persists navPaneCollapsed when toggling in dual layout", async () => {
    const { view, plugin } = createHarness();

    (view as any).onShellResize(800);
    expect(getPanelState(view).layoutMode).toBe("dual");

    await (view as any).onToggleNavPane();

    expect(plugin.saveSettings).toHaveBeenCalledWith({ navPaneCollapsed: true });
  });

  it("returns to the cards view when a folder is selected in single-pane layout", async () => {
    const { view } = createHarness();

    (view as any).onShellResize(400);
    (view as any).singlePaneView = "nav";

    await (view as any).selectFolderFromNav("projects");

    expect(getPanelState(view).navVisible).toBe(false);
  });

  it("falls back to the cards view when narrowing below the dual-layout threshold", () => {
    const { view } = createHarness();

    (view as any).onShellResize(800);
    (view as any).singlePaneView = "nav";
    (view as any).onShellResize(400);

    expect(getPanelState(view).layoutMode).toBe("single");
    expect(getPanelState(view).navVisible).toBe(false);
  });

  it("routes folder action intents to the matching handlers", () => {
    const { view } = createHarness();
    const createSpy = vi.spyOn(view as any, "openCreateChildFolderModal").mockImplementation(() => undefined);

    (view as any).handleFolderActionRequest({ action: "create-child-folder", path: "projects" });

    expect(createSpy).toHaveBeenCalledWith("projects");
  });

  it("creates a child folder and refreshes the folder tree state", async () => {
    const { view } = createHarness();
    const projects = createFolder("projects");
    const root = createFolder("", [projects]);

    (view.app.vault.getRoot as ReturnType<typeof vi.fn>).mockReturnValue(root);
    (view.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      return path === "projects" ? projects : null;
    });
    (view.app.vault.createFolder as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      const child = createFolder(path);
      child.parent = { path: projects.path };
      projects.children.push(child);
      return child;
    });

    const created = await (view as any).createChildFolder("projects", "client-a");

    expect(created).toBe(true);
    expect(view.app.vault.createFolder).toHaveBeenCalledWith("projects/client-a");
    expect(getPanelState(view).folderTree).toEqual((view as any).buildFolderTree());
  });

  it("refreshes the folder tree state on folder vault mutations", async () => {
    const { view } = createHarness();
    const alpha = createFolder("alpha");
    const root = createFolder("", [alpha]);
    (view.app.vault.getRoot as ReturnType<typeof vi.fn>).mockReturnValue(root);

    (view as any).handleVaultMutation({
      eventType: "create",
      path: "beta",
      oldPath: null,
      isFolder: true,
      fileKind: null,
    });

    const treePaths = (getPanelState(view).folderTree as Array<{ path: string }>).map((node) => node.path);
    expect(treePaths).toContain("/");
    expect(treePaths).toContain("alpha");
    expect(getPanelState(view).folderTree).toEqual((view as any).buildFolderTree());
  });

  it("does not rebuild the folder tree for non-folder vault mutations", async () => {
    const { view } = createHarness();
    const buildSpy = vi.spyOn(view as any, "buildFolderTree");

    (view as any).handleVaultMutation({
      eventType: "modify",
      path: "notes/file.md",
      oldPath: null,
      isFolder: false,
      fileKind: "markdown",
    });

    expect(buildSpy).not.toHaveBeenCalled();
  });

  it("rejects invalid child folder names and missing parent folders", async () => {
    const { view } = createHarness();
    const projects = createFolder("projects");

    (view.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      return path === "projects" ? projects : null;
    });

    await expect((view as any).createChildFolder("projects", "bad/name")).resolves.toBe(false);
    await expect((view as any).createChildFolder("missing", "client-a")).resolves.toBe(false);

    expect(view.app.vault.createFolder).not.toHaveBeenCalled();
    expect(testState.noticeMessages).toEqual([
      "Folder name cannot contain / or \\.",
      "Folder no longer exists.",
    ]);
  });

  it("opens the folder picker only for live non-root folders", () => {
    const { view } = createHarness();
    const projects = createFolder("projects");
    const root = createFolder("");

    (view.app.vault.getRoot as ReturnType<typeof vi.fn>).mockReturnValue(root);
    (view.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      return path === "projects" ? projects : null;
    });

    (view as any).openMoveFolderPickerForFolder("projects");
    (view as any).openMoveFolderPickerForFolder("/");

    expect((testState as any).folderPickerOpenCount).toBe(1);
    expect((testState as any).folderPickerTitle).toBe("Select a folder");
  });

  it("rejects same-parent and descendant folder move targets", async () => {
    const { view } = createHarness();
    const clientA = createFolder("projects/client-a");
    const projects = createFolder("projects", [clientA]);

    (view.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      return path === "projects" ? projects : path === "projects/client-a" ? clientA : null;
    });

    await (view as any).onFolderMoveTargetChosen("projects", createFolder(""));
    await (view as any).onFolderMoveTargetChosen("projects", clientA);

    expect(view.app.fileManager.renameFile).not.toHaveBeenCalled();
    expect(testState.noticeMessages).toEqual([
      "Folder is already in the selected location.",
      "Cannot move a folder into itself or one of its subfolders.",
    ]);
  });

  it("renames folders and refreshes the active scope when the selected folder moves", async () => {
    const { view } = createHarness();
    const projects = createFolder("projects");
    const archive = createFolder("archive");
    const refreshSpy = vi.spyOn(view as any, "refresh").mockResolvedValue({ action: "started", inFlightKey: null });

    (view as any).folderPath = "projects";
    (view.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      return path === "projects" ? projects : path === "archive" ? archive : null;
    });

    await (view as any).onFolderMoveTargetChosen("projects", archive);

    expect(view.app.fileManager.renameFile).toHaveBeenCalledWith(projects, "archive/projects");
    expect(refreshSpy).toHaveBeenCalledWith({ reason: "manual", folderPath: "archive/projects", forceRefresh: true });
  });

  it("deletes the active folder scope back to root via prompt live re-fetch and skips root deletion", async () => {
    const { view } = createHarness();
    const initialClientA = createFolder("projects/client-a");
    const liveClientA = createFolder("projects/client-a");
    const root = createFolder("");
    const refreshSpy = vi.spyOn(view as any, "refresh").mockResolvedValue({ action: "started", inFlightKey: null });

    (view as any).folderPath = "projects/client-a";
    (view.app.vault.getRoot as ReturnType<typeof vi.fn>).mockReturnValue(root);
    (view.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>)
      .mockImplementationOnce((path: string) => path === "projects/client-a" ? initialClientA : null)
      .mockImplementationOnce((path: string) => path === "projects/client-a" ? liveClientA : null)
      .mockImplementation((path: string) => path === "projects/client-a" ? initialClientA : null);

    await (view as any).deleteFolder("projects/client-a");
    await (view as any).deleteFolder("/");

    expect(view.app.fileManager.promptForDeletion).toHaveBeenCalledTimes(1);
    expect(view.app.fileManager.promptForDeletion).toHaveBeenCalledWith(initialClientA);
    expect(view.app.fileManager.trashFile).toHaveBeenCalledWith(liveClientA);
    expect(refreshSpy).toHaveBeenCalledWith({ reason: "manual", folderPath: "", forceRefresh: true });
  });

  it("treats slash-selected root scope as eligible for modify-driven preview refresh", () => {
    const { view } = createHarness();
    const card = createCard("nested/note.md", "Nested note");
    const hydrateSpy = vi.spyOn(view as any, "hydrateCard").mockResolvedValue(undefined);

    (view as any).folderPath = "/";
    (view as any).baseCards = [card];

    const result = (view as any).handleVaultMutation({
      eventType: "modify",
      path: card.path,
      oldPath: null,
      isFolder: false,
      fileKind: "markdown",
    });

    expect(result.shouldRefresh).toBe(false);
    expect(result.incrementalResult).toEqual({ handled: true, action: "hydration_reset" });
    expect(hydrateSpy).toHaveBeenCalledWith(card.path, (view as any).generation);
  });

  it("localizes hydrated non-markdown placeholders when the Obsidian language is Chinese", async () => {
    const { view, plugin } = createHarness();
    (plugin as any).getUiLanguage.mockReturnValue("zh");
    (plugin as any).getUiStrings.mockReturnValue(getUiStrings("zh"));

    const card = createCard("notes/diagram.canvas", "diagram.canvas", "canvas");
    card.hydrated = false;
    card.previewHtml = "";
    (view as any).folderPath = "notes";
    (view as any).baseCards = [card];

    await (view as any).hydrateCard(card.path, (view as any).generation);

    expect(card.previewHtml).toContain("这是一个 Canvas 文件。");
  });
});
function createSearchHealth(overrides: Partial<SearchServiceSnapshot["health"]> = {}): SearchServiceSnapshot["health"] {
  return {
    outcome: "restored",
    readiness: "ready",
    healthy: true,
    rebuilding: false,
    rebuildRequired: false,
    persistence: "healthy",
    documentCount: 1,
    lastIndexedAt: 1,
    rebuildReason: null,
    lastError: null,
    lastSuccessfulRestore: {
      outcome: "restored",
      at: 1,
      documentCount: 1,
      detail: "restored",
    },
    lastSuccessfulBuild: null,
    detail: "restored",
    ...overrides,
  };
}

function makeTestBox(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "box-1",
    name: "Ideas",
    rules: [],
    manualPaths: [],
    excludedPaths: [],
    pinnedPaths: [],
    sort: { field: "mtime", direction: "desc" },
    ...overrides,
  };
}

describe("FolderCardView card box mode", () => {
  function readSettings(plugin: TestHarness["plugin"]): Record<string, any> {
    return (plugin.getSettings as unknown as () => Record<string, any>)();
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    (globalThis as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
      testState.ResizeObserverStub as never;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("pin toggle writes to the active box, not global settings", async () => {
    const { view, plugin } = createHarness();
    const settings = readSettings(plugin);
    settings.boxes = [makeTestBox()];
    settings.activeBoxId = "box-1";

    await (view as any).onPinToggle({ path: "notes/a.md", pinned: true });

    expect(settings.boxes[0].pinnedPaths).toEqual(["notes/a.md"]);
    expect(settings.pinnedPaths).toEqual([]);
  });

  it("sort change writes to the active box", async () => {
    const { view, plugin } = createHarness();
    const settings = readSettings(plugin);
    settings.boxes = [makeTestBox()];
    settings.activeBoxId = "box-1";

    await (view as any).onSortChange({ field: "name", direction: "asc" });

    expect(settings.boxes[0].sort).toEqual({ field: "name", direction: "asc" });
    expect(settings.sort).toEqual({ field: "mtime", direction: "desc" });
  });

  it("projects box members with the box's own pins first", () => {
    const { view, plugin } = createHarness();
    const settings = readSettings(plugin);
    settings.boxes = [makeTestBox({ pinnedPaths: ["notes/b.md"] })];
    settings.activeBoxId = "box-1";
    (view as any).baseCards = [createCard("notes/a.md", "A"), createCard("notes/b.md", "B")];

    const visible = (view as any).deriveVisibleCards() as NoteCardRecord[];

    expect(visible.map((card) => card.path)).toEqual(["notes/b.md", "notes/a.md"]);
  });

  it("exposes active box metadata in panel state", async () => {
    const { view, plugin } = createHarness();
    const settings = readSettings(plugin);
    settings.boxes = [makeTestBox()];
    settings.activeBoxId = "box-1";

    await view.onOpen();
    await tick();

    const state = getPanelState(view);
    expect(state.activeBoxId).toBe("box-1");
    expect(state.activeBoxName).toBe("Ideas");
    expect(state.boxSummaries).toEqual([{ id: "box-1", name: "Ideas", cardCount: 0 }]);
  });

  it("exposes box member counts and caches them per membership signature", async () => {
    const { view, plugin } = createHarness();
    const settings = readSettings(plugin);
    settings.boxes = [makeTestBox({ manualPaths: ["notes/a.md", "notes/b.md"] })];
    settings.activeBoxId = null;
    (view.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string) => new testState.TestTFile(path),
    );

    await view.onOpen();
    await tick();

    expect(getPanelState(view).boxSummaries).toEqual([
      { id: "box-1", name: "Ideas", cardCount: 2 },
    ]);

    const collectSpy = vi.spyOn(view as any, "collectBoxFiles");
    (view as any).pushState();

    expect(collectSpy).not.toHaveBeenCalled();

    settings.boxes = [makeTestBox({ manualPaths: ["notes/a.md"] })];
    (view as any).pushState();

    expect(collectSpy).toHaveBeenCalledTimes(1);
    expect(getPanelState(view).boxSummaries).toEqual([
      { id: "box-1", name: "Ideas", cardCount: 1 },
    ]);
  });

  it("switches and exits boxes via box commands", () => {
    const { view, plugin } = createHarness();
    const settings = readSettings(plugin);
    settings.boxes = [makeTestBox(), makeTestBox({ id: "box-2", name: "Plans" })];
    settings.activeBoxId = null;

    (view as any).handleBoxCommand({ command: "switch", boxId: "box-2" });
    expect(settings.activeBoxId).toBe("box-2");

    (view as any).handleBoxCommand({ command: "exit" });
    expect(settings.activeBoxId).toBeNull();
  });
});

describe("FolderCardView navigation scope activation", () => {
  function readSettings(plugin: TestHarness["plugin"]): Record<string, any> {
    return (plugin.getSettings as unknown as () => Record<string, any>)();
  }

  beforeEach(() => {
    document.body.innerHTML = "";
    testState.noticeMessages.length = 0;
    (globalThis as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
      testState.ResizeObserverStub as never;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("clears the tag filter when the activated folder differs from the current scope", async () => {
    const { view, plugin } = createHarness();
    const settings = readSettings(plugin);
    settings.filter = { tags: ["alpha"] };
    (view as any).folderPath = "notes";

    await (view as any).selectFolderFromNav("other");

    expect(plugin.saveSettings).toHaveBeenCalledWith({ filter: { tags: [] } });
    expect(plugin.selectFolderByPath).toHaveBeenCalledWith("other", "panel-picker");
  });

  it("keeps the tag filter when the activated folder is already the current scope", async () => {
    const { view, plugin } = createHarness();
    const settings = readSettings(plugin);
    settings.filter = { tags: ["alpha"] };
    (view as any).folderPath = "other";

    await (view as any).selectFolderFromNav("other");

    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(settings.filter.tags).toEqual(["alpha"]);
    expect(plugin.selectFolderByPath).toHaveBeenCalledWith("other", "panel-picker");
  });

  it("activating a favorited tag exits the box, jumps to the vault root, and keeps only that tag", async () => {
    const { view, plugin } = createHarness();
    const settings = readSettings(plugin);
    settings.boxes = [makeTestBox()];
    settings.activeBoxId = "box-1";
    settings.filter = { tags: ["stale"] };
    (view as any).folderPath = "notes";

    await (view as any).activateFavoriteTag("alpha");

    expect(settings.activeBoxId).toBeNull();
    expect(settings.filter.tags).toEqual(["alpha"]);
    expect(plugin.selectFolderByPath).toHaveBeenCalledWith("", "panel-picker");
  });

  it("folder-tree create actions leave box mode and switch scope before creating", async () => {
    const { view, plugin } = createHarness();
    const settings = readSettings(plugin);
    settings.boxes = [makeTestBox()];
    settings.activeBoxId = "box-1";
    (view.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string) => new testState.TestTFolder(path),
    );

    const createSpy = vi.spyOn(view as any, "createFromFolderTree");
    const actions = (view as any).buildNavMenuDeps().actions;
    actions.createNote("notes");
    actions.createFolder("notes");
    actions.createCanvas("notes");
    actions.createBase("notes");

    expect(createSpy.mock.calls.map((call) => call[1])).toEqual([
      "note",
      "folder",
      "canvas",
      "base",
    ]);

    createSpy.mockRestore();
    await (view as any).createFromFolderTree("notes", "note");

    expect(settings.activeBoxId).toBeNull();
    expect(plugin.selectFolderByPath).toHaveBeenCalledWith("notes", "panel-picker");
    expect(plugin.createNoteInFolder).toHaveBeenCalledWith("notes", []);
  });

  it("counts favorites vault-wide, independent of the browse scope", () => {
    const { view, plugin } = createHarness();
    const settings = readSettings(plugin);
    settings.showNavItemCounts = true;
    settings.includeSubfolders = true;
    settings.boxes = [makeTestBox({ manualPaths: ["notes/a.md", "notes/b.md"] })];
    settings.favorites = [
      { kind: "folder", ref: "notes" },
      { kind: "tag", ref: "work" },
      { kind: "box", ref: "box-1" },
    ];

    // Vault: notes/ holds two markdown files, one of which is tagged work/ai.
    const alpha = new testState.TestTFile("notes/a.md");
    const beta = new testState.TestTFile("notes/b.md");
    const notesFolder = createFolder("notes");
    notesFolder.children = [alpha, beta];
    const root = createFolder("", [notesFolder]);
    view.app.vault.getRoot = vi.fn(() => root) as never;
    view.app.vault.getMarkdownFiles = vi.fn(() => [alpha, beta]) as never;
    (view.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string) => (path === "notes" ? notesFolder : new testState.TestTFile(path)),
    );
    view.app.metadataCache.getFileCache = vi.fn((file: { path: string }) =>
      file.path === "notes/a.md" ? { tags: [{ tag: "#work/ai" }] } : null,
    ) as never;

    // Browsing an unrelated, empty scope must not shrink any of the numbers.
    (view as any).folderPath = "elsewhere";
    (view as any).baseCards = [];
    (view as any).refreshFolderTreeState();
    (view as any).pushState();

    const favorites = getPanelState(view).favorites as Array<{ ref: string; count: number }>;
    expect(favorites.map((row) => [row.ref, row.count])).toEqual([
      ["notes", 2],
      ["work", 1],
      ["box-1", 2],
    ]);
  });

  it("recomputes scope tag counts after a vault mutation", () => {
    const { view, plugin } = createHarness();
    const settings = readSettings(plugin);
    const alpha = createCard("notes/a.md", "A");
    (view as any).folderPath = "notes";
    (view as any).baseCards = [alpha];
    settings.showNavItemCounts = true;

    const getFileCache = vi.fn(() => ({ tags: [{ tag: "#work" }] }));
    view.app.metadataCache.getFileCache = getFileCache as never;

    (view as any).pushState();
    expect(getPanelState(view).tagCounts).toEqual({ work: 1 });

    const callsAfterFirstPush = getFileCache.mock.calls.length;
    (view as any).pushState();
    expect(getFileCache.mock.calls.length).toBe(callsAfterFirstPush);

    // A vault change must break the memo even when the card count is unchanged.
    view.app.metadataCache.getFileCache = vi.fn(() => ({ tags: [{ tag: "#archive" }] })) as never;
    view.handleVaultMutation({
      eventType: "modify",
      path: "notes/a.md",
      oldPath: null,
      isFolder: false,
      fileKind: "markdown",
    });
    (view as any).pushState();

    expect(getPanelState(view).tagCounts).toEqual({ archive: 1 });
  });

  it("never marks a favorited tag missing just because the current folder lacks it", () => {
    const { view, plugin } = createHarness();
    const settings = readSettings(plugin);
    settings.favorites = [
      { kind: "tag", ref: "work" },
      { kind: "folder", ref: "gone" },
    ];
    (view as any).folderPath = "notes";
    (view as any).baseCards = [];

    (view as any).pushState();

    const favorites = getPanelState(view).favorites as Array<{
      kind: string;
      ref: string;
      missing: boolean;
    }>;
    expect(favorites).toEqual([
      expect.objectContaining({ kind: "tag", ref: "work", missing: false }),
      expect.objectContaining({ kind: "folder", ref: "gone", missing: true }),
    ]);
  });

  it("does not insert a created file into an active box it is not a member of", () => {
    const { view, plugin } = createHarness();
    const settings = readSettings(plugin);
    settings.boxes = [makeTestBox({ manualPaths: ["notes/member.md"] })];
    settings.activeBoxId = "box-1";
    (view as any).folderPath = "";
    (view as any).baseCards = [];
    (view.app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string) => new testState.TestTFile(path),
    );

    const createEvent = {
      eventType: "create" as const,
      path: "notes/outsider.md",
      oldPath: null,
      isFolder: false,
      fileKind: "markdown" as const,
    };

    view.handleVaultMutation(createEvent);
    expect(((view as any).baseCards as NoteCardRecord[])).toHaveLength(0);

    view.handleVaultMutation({ ...createEvent, path: "notes/member.md" });
    expect(((view as any).baseCards as NoteCardRecord[]).map((card) => card.path)).toEqual([
      "notes/member.md",
    ]);
  });
});
