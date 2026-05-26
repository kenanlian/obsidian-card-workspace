import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { getUiStrings } from "../i18n";
import { ALL_NOTES_PATH } from "./types";

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

    constructor(path: string) {
      this.path = path;
      this.name = path === "" ? "/" : path.replace(/.*\//, "");
      this.children = [];
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
  };
});

vi.mock("obsidian", () => {
  return {
    ItemView: testState.TestItemView,
    Menu: testState.TestMenu,
    Modal: testState.TestModal,
    Notice: class {
      constructor(_message: string) {
        return;
      }
    },
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
      constructor(_app: unknown, _onChoose: (folder: unknown) => void) {
        return;
      }

      open(): void {
        return;
      }
    },
  };
});

vi.mock("./note-ops", () => {
  return {
    batchDeleteFilesUsingObsidianPreference: vi.fn(async () => ({ succeeded: [], failed: [] })),
    batchMoveFiles: vi.fn(async () => ({ succeeded: [], failed: [] })),
    batchTrashFiles: vi.fn(async () => ({ succeeded: [], failed: [] })),
    copyNoteToClipboard: vi.fn(async () => true),
    mergeNotes: vi.fn(async () => ({
      ok: true,
      mergedFile: { basename: "Merged" },
      sourceCount: 2,
    })),
    moveFile: vi.fn(async (_app: unknown, file: unknown) => ({ ok: true, file })),
  };
});

import { FolderCardView } from "./FolderCardView";
import type { SearchServiceSnapshot } from "../search";
import type { CardFileKind } from "./file-kind";
import type { NoteCardRecord } from "./types";

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

function createHarness(): TestHarness {
  const settings = {
    sort: { field: "mtime", direction: "desc" },
    filter: { tags: [] },
    pinnedPaths: [],
    cardCornerRadius: "compact",
    previewLines: 5,
    includeSubfolders: true,
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
      getAbstractFileByPath: vi.fn(() => null),
      getRoot: vi.fn(() => new testState.TestTFolder("")),
      cachedRead: vi.fn(async () => ""),
      read: vi.fn(async () => ""),
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

function getFilterButton(panelContainer: HTMLElement): HTMLButtonElement | null {
  return panelContainer.querySelector<HTMLButtonElement>('.fce-toolbar-button[data-icon="tags"]');
}

async function openTagPopup(panelContainer: HTMLElement): Promise<void> {
  const filterButton = getFilterButton(panelContainer);
  expect(filterButton).not.toBeNull();
  filterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 44, clientY: 12 }));
  await tick();
}

function getTagNode(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".fce-tag-menu .fce-tree-button"))
    .find((button) => button.textContent?.includes(label));
}

describe("FolderCardView host contract", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
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
  });

  it("persists a selected nested tag from the toolbar popup", async () => {
    const { view, plugin, panelContainer } = createHarness();

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

    await openTagPopup(panelContainer);

    expect(getFilterButton(panelContainer)?.className).toContain("is-selected");
    expect(getTagNode("Work")).not.toBeUndefined();
    expect(getTagNode("Work/AI")).toBeUndefined();

    const workChevron = document.querySelector<HTMLButtonElement>(".fce-tag-menu .fce-tree-chevron[aria-label='Expand']");
    expect(workChevron).not.toBeNull();
    workChevron?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    const nestedNode = getTagNode("AI");
    expect(nestedNode).not.toBeUndefined();
    expect(getTagNode("Work/AI")).toBeUndefined();

    const nestedChevron = Array.from(document.querySelectorAll<HTMLButtonElement>(".fce-tag-menu .fce-tree-chevron"))
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

  it("clears the active tag from the toolbar summary", async () => {
    const { view, plugin, panelContainer } = createHarness();
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

    expect(panelContainer.textContent).toContain("Work/AI tag selected");

    await openTagPopup(panelContainer);

    const nestedNode = getTagNode("AI");
    expect(nestedNode).not.toBeUndefined();
    expect(nestedNode?.getAttribute("aria-checked")).toBe("true");
    nestedNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    (view as any).pushState();
    await tick();

    expect(settings.filter.tags).toEqual([]);
    expect(panelContainer.textContent).not.toContain("Work/AI tag selected");
    expect(document.querySelector(".fce-tag-menu")).toBeNull();
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

    (view as any).folderPath = ALL_NOTES_PATH;
    expect((view as any).buildEmptyStateMessage()).toBe('No results for “alpha” in current tag scope.');

    plugin.getSettings = vi.fn(() => ({
      sort: { field: "mtime", direction: "desc" },
      filter: { tags: [] },
      pinnedPaths: [],
      cardCornerRadius: "compact",
      previewLines: 5,
      includeSubfolders: true,
    }));
    expect((view as any).buildEmptyStateMessage()).toBe('No results for “alpha” in all notes.');
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
