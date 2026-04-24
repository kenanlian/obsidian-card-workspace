import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

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

function createCard(path: string, title: string): NoteCardRecord {
  return {
    file: new testState.TestTFile(path) as unknown as never,
    fileKind: "markdown",
    path,
    title,
    ctime: new Date("2024-01-02T10:00:00Z").getTime(),
    mtime: new Date("2024-02-03T12:00:00Z").getTime(),
    excerpt: "",
    previewHtml: "<p>Preview text</p>",
    previewMode: "text",
    hydrated: true,
  };
}

function createHarness(): TestHarness {
  const settings = {
    sort: { field: "mtime", direction: "desc" },
    filter: { tags: [] },
    pinnedPaths: [],
    previewLines: 5,
    includeSubfolders: true,
  };

  const app = {
    workspace: {
      leftSplit: { id: "left-split" },
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

    (view as any).folderPath = "notes";
    (view as any).baseCards = [createCard("notes/runtime.md", "Runtime host note")];
    (view as any).pushState();
    await tick();

    expect(panelContainer.textContent).toContain("Runtime host note");
    expect(panelContainer.querySelector(".fce-list")).not.toBeNull();
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
        orderedPaths: ["notes/alpha.md"],
      }));
      plugin.getSearchService = vi.fn(() => ({ query }));
      plugin.getSearchSnapshot = vi.fn(() => ({
        initialized: true,
        disposed: false,
        mode: "indexed",
        status: "ready",
        lastError: null,
        health: {
          outcome: "restored",
          healthy: true,
          rebuilding: false,
          documentCount: 1,
          lastIndexedAt: 1,
          detail: "restored",
        },
      }));

      (view as any).folderPath = "notes";
      (view as any).baseCards = [createCard("notes/alpha.md", "Alpha")];

      await view.onOpen();
      expect((view as any).searchStatus).toBe("ready");

      (view as any).onSearchQueryChange({ query: "alpha" });
      vi.advanceTimersByTime(119);
      await Promise.resolve();
      expect(query).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
      expect(query).toHaveBeenCalledTimes(1);

      (view as any).resetSearchQuery();
      expect((view as any).searchQuery).toBe("");
      expect((view as any).searchOrderedPaths).toBeNull();
      expect((view as any).searchStatus).toBe("ready");
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
        health: {
          outcome: "restored",
          healthy: true,
          rebuilding: false,
          documentCount: 2,
          lastIndexedAt: 1,
          detail: "restored",
        },
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
        health: {
          outcome: "rebuild-required",
          healthy: false,
          rebuilding: true,
          documentCount: null,
          lastIndexedAt: null,
          detail: "rebuilding",
        },
      });

      pending[0]?.resolve({
        mode: "indexed",
        status: "ready",
        orderedPaths: ["notes/beta.md"],
      });
      await Promise.resolve();
      await Promise.resolve();

      expect((view as any).searchStatus).toBe("building");
      expect((view as any).searchOrderedPaths).toBeNull();

      await view.onClose();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
