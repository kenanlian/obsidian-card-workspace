import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  if (typeof HTMLElement === "undefined") {
    (globalThis as any).HTMLElement = class HTMLElement {};
  }

  const menuInstances: MockMenu[] = [];
  const folderPickerInstances: MockFolderPickerModal[] = [];
  const noticeMessages: string[] = [];
  const panelEventHandlers: Record<string, (event: any) => void> = {};

  (globalThis as any).__mockState = { panelEventHandlers };

  class MockTFile {
    path: string;
    basename: string;
    parent: { path: string } | null;

    constructor(path: string) {
      this.path = path;
      this.basename = path.replace(/.*\//, "").replace(/\.md$/, "");
      const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      this.parent = { path: parentPath };
    }
  }

  class MockTFolder {
    path: string;
    name: string;
    children: unknown[];

    constructor(path: string) {
      this.path = path;
      this.name = path === "" ? "/" : path.replace(/.*\//, "");
      this.children = [];
    }
  }

  class MockNotice {
    constructor(message: string) {
      noticeMessages.push(message);
    }
  }

  class MockMenuItem {
    title = "";
    icon = "";
    clickHandler: (() => void) | null = null;

    setTitle(title: string): this {
      this.title = title;
      return this;
    }

    setIcon(icon: string): this {
      this.icon = icon;
      return this;
    }

    onClick(handler: () => void): this {
      this.clickHandler = handler;
      return this;
    }
  }

  class MockMenu {
    items: MockMenuItem[] = [];
    showAtMouseEvent = vi.fn();
    dom: any;

    constructor() {
      this.dom = new (globalThis as any).HTMLElement();
      this.dom.classList = { add: vi.fn() };
      menuInstances.push(this);
    }

    addItem(configure: (item: MockMenuItem) => void): this {
      const item = new MockMenuItem();
      configure(item);
      this.items.push(item);
      return this;
    }
  }

  class MockFolderPickerModal {
    app: unknown;
    onChoose: (folder: unknown) => void;
    open = vi.fn();

    constructor(app: unknown, onChoose: (folder: unknown) => void) {
      this.app = app;
      this.onChoose = onChoose;
      folderPickerInstances.push(this);
    }
  }

  class MockItemView {
    app: any;
    leaf: any;
    containerEl: any;

    constructor(leaf: any) {
      this.leaf = leaf;
      this.app = leaf.app;
      this.containerEl = {
        children: [{}, { empty: vi.fn(), createDiv: vi.fn(() => ({}) ) }],
        empty: vi.fn(),
        createDiv: vi.fn(() => ({})),
      };
    }
  }

  return {
    MockItemView,
    MockMenu,
    MockNotice,
    MockTFile,
    MockTFolder,
    MockFolderPickerModal,
    menuInstances,
    folderPickerInstances,
    noticeMessages,
    panelEventHandlers,
  };
});

vi.mock("obsidian", () => {
  return {
    ItemView: mockState.MockItemView,
    Menu: mockState.MockMenu,
    Notice: mockState.MockNotice,
    TFile: mockState.MockTFile,
    TFolder: mockState.MockTFolder,
  };
});

vi.mock("./FolderCardPanel.svelte", () => {
  return {
    default: class MockFolderCardPanel {
      $on(eventName: string, handler: (event: any) => void): () => void {
        mockState.panelEventHandlers[eventName] = handler;
        return () => {
          delete mockState.panelEventHandlers[eventName];
        };
      }

      $set(): void {
        return;
      }

      $destroy(): void {
        return;
      }
    },
  };
});

vi.mock("./note-ops", () => {
  return {
    copyNoteToClipboard: vi.fn(async () => true),
    moveFile: vi.fn(async (_app: unknown, file: unknown) => ({ ok: true, file })),
  };
});

vi.mock("../FolderPickerModal", () => {
  return {
    FolderPickerModal: mockState.MockFolderPickerModal,
  };
});

import { FolderCardView } from "./FolderCardView";
import { copyNoteToClipboard, moveFile } from "./note-ops";
import { ALL_NOTES_PATH } from "./types";

function createFolder(path: string): InstanceType<typeof mockState.MockTFolder> {
  return new mockState.MockTFolder(path);
}

function createViewWithFile(path: string = "notes/a.md"): {
  view: FolderCardView;
  app: any;
  file: InstanceType<typeof mockState.MockTFile>;
  plugin: any;
} {
  const file = new mockState.MockTFile(path);
  const app = {
    vault: {
      getAbstractFileByPath: vi.fn((requestedPath: string) => {
        return requestedPath === path ? file : null;
      }),
      cachedRead: vi.fn(async () => ""),
    },
    workspace: {},
  };
  const leaf = { app, getRoot: vi.fn(() => ({})) };
   const plugin = {
     getSettings: vi.fn(() => ({
       includeSubfolders: true,
       sort: { field: "mtime", direction: "desc" },
       filter: { tags: [] },
       defaultView: "cards",
       lastFolderPath: null,
       lastViewMode: "folder",
       pinnedPaths: [],
     })),
     openNoteFromCard: vi.fn(),
     selectAllNotes: vi.fn(),
     createNoteInCurrentFolder: vi.fn(),
     selectFolderByPath: vi.fn(),
     saveSettings: vi.fn(async () => undefined),
   };

  const view = new FolderCardView(leaf as any, plugin as any);
  return { view, app, file, plugin };
}

function createCardRecord(file: InstanceType<typeof mockState.MockTFile>) {
  return {
    file,
    path: file.path,
    title: file.basename,
    ctime: 1,
    mtime: 1,
    excerpt: "",
    previewHtml: "",
    previewMode: "empty" as const,
    hydrated: false,
  };
}

describe("FolderCardView card context actions", () => {
  beforeEach(() => {
    mockState.menuInstances.length = 0;
    mockState.folderPickerInstances.length = 0;
    mockState.noticeMessages.length = 0;
    Object.keys(mockState.panelEventHandlers).forEach((key) => {
      delete mockState.panelEventHandlers[key];
    });
    vi.clearAllMocks();
  });

  describe("Task 2: Event contract verification via real onOpen() subscriptions", () => {
    it("hydrates preloaded cards when onOpen runs after startup restore", async () => {
      const { view, app, file } = createViewWithFile("notes/startup-restore.md");
      const card = createCardRecord(file);

      app.vault.cachedRead = vi.fn(async () => "# Startup restore\nHydrated preview body");
      (view as any).baseCards = [card];
      (view as any).visibleCards = [card];
      (view as any).loading = false;

      await (view as any).onOpen();
      await Promise.resolve();
      await Promise.resolve();

      expect(app.vault.cachedRead).toHaveBeenCalledTimes(1);
      expect(card.hydrated).toBe(true);
      expect(card.previewMode).not.toBe("empty");
    });

    it("onOpen() registers open-note subscription that calls plugin.openNoteFromCard", async () => {
      const { view, plugin, file } = createViewWithFile("notes/test-note.md");

      await (view as any).onOpen();

      expect(mockState.panelEventHandlers["open-note"]).toBeDefined();

      const openNoteHandler = mockState.panelEventHandlers["open-note"];
      openNoteHandler({ detail: { path: file.path } });

      expect(plugin.openNoteFromCard).toHaveBeenCalledTimes(1);
      expect(plugin.openNoteFromCard).toHaveBeenCalledWith(file.path);
    });

    it("onOpen() registers card-context-menu subscription that calls openCardContextMenu", async () => {
      const { view, plugin, file } = createViewWithFile("notes/context-note.md");
      const mockMouseEvent = { clientX: 100, clientY: 200 };

      await (view as any).onOpen();

      expect(mockState.panelEventHandlers["card-context-menu"]).toBeDefined();

      const contextMenuHandler = mockState.panelEventHandlers["card-context-menu"];
      contextMenuHandler({ detail: { path: file.path, mouseEvent: mockMouseEvent } });

      expect(plugin.openNoteFromCard).not.toHaveBeenCalled();
      expect(mockState.menuInstances).toHaveLength(1);
      const [menu] = mockState.menuInstances;
      expect(menu?.showAtMouseEvent).toHaveBeenCalledWith(mockMouseEvent);
    });

    it("open-note subscription (registered in onOpen) routes multiple paths to openNoteFromCard", async () => {
      const { view, plugin } = createViewWithFile("notes/left-click.md");

      await (view as any).onOpen();

      const openNoteHandler = mockState.panelEventHandlers["open-note"];

      openNoteHandler({ detail: { path: "notes/first.md" } });
      openNoteHandler({ detail: { path: "notes/second.md" } });

      expect(plugin.openNoteFromCard).toHaveBeenCalledTimes(2);
      expect(plugin.openNoteFromCard).toHaveBeenNthCalledWith(1, "notes/first.md");
      expect(plugin.openNoteFromCard).toHaveBeenNthCalledWith(2, "notes/second.md");
    });

    it("card-context-menu subscription (registered in onOpen) creates menu without calling openNoteFromCard", async () => {
      const { view, plugin, file } = createViewWithFile("notes/right-click.md");
      const event1 = { clientX: 50, clientY: 100 };
      const event2 = { clientX: 75, clientY: 150 };

      await (view as any).onOpen();

      const contextMenuHandler = mockState.panelEventHandlers["card-context-menu"];

      contextMenuHandler({ detail: { path: file.path, mouseEvent: event1 } });
      contextMenuHandler({ detail: { path: file.path, mouseEvent: event2 } });

      expect(plugin.openNoteFromCard).not.toHaveBeenCalled();
      expect(mockState.menuInstances).toHaveLength(2);
      expect(mockState.menuInstances[0]?.showAtMouseEvent).toHaveBeenCalledWith(event1);
      expect(mockState.menuInstances[1]?.showAtMouseEvent).toHaveBeenCalledWith(event2);
    });

    it("event paths are isolated: open-note does not trigger menu creation", async () => {
      const { view, plugin, file } = createViewWithFile("notes/isolation.md");

      await (view as any).onOpen();

      const openNoteHandler = mockState.panelEventHandlers["open-note"];
      openNoteHandler({ detail: { path: file.path } });

      expect(mockState.menuInstances).toHaveLength(0);
      expect(plugin.openNoteFromCard).toHaveBeenCalledTimes(1);
    });

    it("event paths are isolated: card-context-menu does not trigger openNoteFromCard", async () => {
      const { view, plugin, file } = createViewWithFile("notes/isolation2.md");
      const mockMouseEvent = { clientX: 10, clientY: 20 };

      await (view as any).onOpen();

      const contextMenuHandler = mockState.panelEventHandlers["card-context-menu"];
      contextMenuHandler({ detail: { path: file.path, mouseEvent: mockMouseEvent } });

      expect(plugin.openNoteFromCard).not.toHaveBeenCalled();
      expect(mockState.menuInstances).toHaveLength(1);
    });

     it("both subscriptions exist after onOpen (open-note and card-context-menu)", async () => {
       const { view } = createViewWithFile("notes/dual-subscription.md");

       await (view as any).onOpen();

       expect(mockState.panelEventHandlers["open-note"]).toBeDefined();
       expect(mockState.panelEventHandlers["card-context-menu"]).toBeDefined();
       expect(typeof mockState.panelEventHandlers["open-note"]).toBe("function");
       expect(typeof mockState.panelEventHandlers["card-context-menu"]).toBe("function");
     });

     it("onOpen() registers filter-change subscription that calls onFilterChange", async () => {
       const { view, plugin } = createViewWithFile("notes/test-filter.md");

       await (view as any).onOpen();

       expect(mockState.panelEventHandlers["filter-change"]).toBeDefined();

       const filterChangeHandler = mockState.panelEventHandlers["filter-change"];
       filterChangeHandler({ detail: { tags: ["important", "archived"] } });

       expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
       expect(plugin.saveSettings).toHaveBeenCalledWith({
         filter: {
           tags: ["important", "archived"],
         },
       });
     });

     it("filter-change handler sanitizes and normalizes tag input", async () => {
       const { view, plugin } = createViewWithFile("notes/tag-normalize.md");

       await (view as any).onOpen();

       const filterChangeHandler = mockState.panelEventHandlers["filter-change"];
       filterChangeHandler({ detail: { tags: ["#Important", " WORK ", "", "   "] } });

       expect(plugin.saveSettings).toHaveBeenCalledWith({
         filter: {
           tags: ["important", "work"],
         },
       });
     });

      it("filter-change handler validates that tags is an array before processing", async () => {
        const { view, plugin } = createViewWithFile("notes/invalid-filter.md");

        await (view as any).onOpen();

        const filterChangeHandler = mockState.panelEventHandlers["filter-change"];
        filterChangeHandler({ detail: { tags: "not-an-array" } });

        expect(plugin.saveSettings).not.toHaveBeenCalled();
      });

      it("filter-change handler handles empty array input gracefully", async () => {
        const { view, plugin } = createViewWithFile("notes/empty-array-filter.md");

        await (view as any).onOpen();

        const filterChangeHandler = mockState.panelEventHandlers["filter-change"];
        filterChangeHandler({ detail: { tags: [] } });

        expect(plugin.saveSettings).not.toHaveBeenCalled();
      });

     it("event paths are isolated: filter-change does not trigger menu creation", async () => {
       const { view, plugin } = createViewWithFile("notes/filter-isolation.md");

       await (view as any).onOpen();

       const filterChangeHandler = mockState.panelEventHandlers["filter-change"];
       filterChangeHandler({ detail: { tags: ["work"] } });

       expect(mockState.menuInstances).toHaveLength(0);
       expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
     });

     it("event paths are isolated: filter-change does not trigger openNoteFromCard", async () => {
       const { view, plugin } = createViewWithFile("notes/filter-isolation2.md");

       await (view as any).onOpen();

       const filterChangeHandler = mockState.panelEventHandlers["filter-change"];
       filterChangeHandler({ detail: { tags: ["personal"] } });

       expect(plugin.openNoteFromCard).not.toHaveBeenCalled();
       expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
     });

      it("filter-change subscription is registered alongside open-note and card-context-menu", async () => {
        const { view } = createViewWithFile("notes/multi-subscription.md");

        await (view as any).onOpen();

        expect(mockState.panelEventHandlers["open-note"]).toBeDefined();
        expect(mockState.panelEventHandlers["card-context-menu"]).toBeDefined();
        expect(mockState.panelEventHandlers["filter-change"]).toBeDefined();
        expect(typeof mockState.panelEventHandlers["filter-change"]).toBe("function");
      });
    });

    describe("Task 11: Event contract verification for pin-toggle persistence flow", () => {
      it("onOpen() registers pin-toggle subscription", async () => {
        const { view } = createViewWithFile("notes/pin-register.md");

        await (view as any).onOpen();

        expect(mockState.panelEventHandlers["pin-toggle"]).toBeDefined();
        expect(typeof mockState.panelEventHandlers["pin-toggle"]).toBe("function");
      });

      it("pin-toggle subscription appends path to pinnedPaths when pinning", async () => {
        const { view, plugin } = createViewWithFile("notes/pin-me.md");

        await (view as any).onOpen();

        const pinToggleHandler = mockState.panelEventHandlers["pin-toggle"];
        pinToggleHandler({ detail: { path: "notes/pin-me.md", pinned: true } });

        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(plugin.saveSettings).toHaveBeenCalledWith({
          pinnedPaths: ["notes/pin-me.md"],
        });
      });

      it("pin-toggle subscription removes path from pinnedPaths when unpinning", async () => {
        const { view, plugin } = createViewWithFile("notes/unpin-me.md");
        const initialPinnedPaths = ["notes/pinned-first.md", "notes/unpin-me.md", "notes/pinned-last.md"];
        plugin.getSettings = vi.fn(() => ({
          includeSubfolders: true,
          sort: { field: "mtime", direction: "desc" },
          filter: { tags: [] },
          defaultView: "cards",
          lastFolderPath: null,
          lastViewMode: "folder",
          pinnedPaths: initialPinnedPaths,
        }));

        await (view as any).onOpen();

        const pinToggleHandler = mockState.panelEventHandlers["pin-toggle"];
        pinToggleHandler({ detail: { path: "notes/unpin-me.md", pinned: false } });

        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(plugin.saveSettings).toHaveBeenCalledWith({
          pinnedPaths: ["notes/pinned-first.md", "notes/pinned-last.md"],
        });
      });

      it("pin-toggle subscription appends multiple paths independently", async () => {
        const { view, plugin } = createViewWithFile("notes/multi-pin.md");
        let pinnedState: string[] = [];
        plugin.getSettings = vi.fn(() => ({
          includeSubfolders: true,
          sort: { field: "mtime", direction: "desc" },
          filter: { tags: [] },
          defaultView: "cards",
          lastFolderPath: null,
          lastViewMode: "folder",
          pinnedPaths: pinnedState,
        }));
        plugin.saveSettings = vi.fn(async (settings: any) => {
          pinnedState = settings.pinnedPaths;
        });

        await (view as any).onOpen();

        const pinToggleHandler = mockState.panelEventHandlers["pin-toggle"];
        pinToggleHandler({ detail: { path: "notes/first-pin.md", pinned: true } });
        pinToggleHandler({ detail: { path: "notes/second-pin.md", pinned: true } });

        expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
        expect(plugin.saveSettings).toHaveBeenNthCalledWith(1, {
          pinnedPaths: ["notes/first-pin.md"],
        });
        expect(plugin.saveSettings).toHaveBeenNthCalledWith(2, {
          pinnedPaths: ["notes/first-pin.md", "notes/second-pin.md"],
        });
      });

      it("pin-toggle avoids duplicate persistence when path is already pinned", async () => {
        const { view, plugin } = createViewWithFile("notes/already-pinned.md");
        plugin.getSettings = vi.fn(() => ({
          includeSubfolders: true,
          sort: { field: "mtime", direction: "desc" },
          filter: { tags: [] },
          defaultView: "cards",
          lastFolderPath: null,
          lastViewMode: "folder",
          pinnedPaths: ["notes/already-pinned.md"],
        }));

        await (view as any).onOpen();

        const pinToggleHandler = mockState.panelEventHandlers["pin-toggle"];
        pinToggleHandler({ detail: { path: "notes/already-pinned.md", pinned: true } });

        expect(plugin.saveSettings).not.toHaveBeenCalled();
      });

      it("pin-toggle ignores stale unpin request for missing pinned path", async () => {
        const { view, plugin } = createViewWithFile("notes/stale-unpin.md");
        plugin.getSettings = vi.fn(() => ({
          includeSubfolders: true,
          sort: { field: "mtime", direction: "desc" },
          filter: { tags: [] },
          defaultView: "cards",
          lastFolderPath: null,
          lastViewMode: "folder",
          pinnedPaths: ["notes/other-pinned.md"],
        }));

        await (view as any).onOpen();

        const pinToggleHandler = mockState.panelEventHandlers["pin-toggle"];
        pinToggleHandler({ detail: { path: "notes/stale-unpin.md", pinned: false } });

        expect(plugin.saveSettings).not.toHaveBeenCalled();
      });

      it("pin-toggle event isolation: does not trigger open-note or card-context-menu handlers", async () => {
        const { view, plugin } = createViewWithFile("notes/isolation-pin.md");

        await (view as any).onOpen();

        const pinToggleHandler = mockState.panelEventHandlers["pin-toggle"];
        pinToggleHandler({ detail: { path: "notes/isolation-pin.md", pinned: true } });

        expect(mockState.menuInstances).toHaveLength(0);
        expect(plugin.openNoteFromCard).not.toHaveBeenCalled();
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
      });

      it("all major subscriptions (open-note, card-context-menu, filter-change, pin-toggle) exist after onOpen", async () => {
        const { view } = createViewWithFile("notes/quad-subscription.md");

        await (view as any).onOpen();

        expect(mockState.panelEventHandlers["open-note"]).toBeDefined();
        expect(mockState.panelEventHandlers["card-context-menu"]).toBeDefined();
        expect(mockState.panelEventHandlers["filter-change"]).toBeDefined();
        expect(mockState.panelEventHandlers["pin-toggle"]).toBeDefined();
        expect(typeof mockState.panelEventHandlers["pin-toggle"]).toBe("function");
      });
    });

   it("openCardContextMenu adds Move to… and Copy items", () => {
    const { view, file } = createViewWithFile();
    const mouseEvent = { clientX: 12, clientY: 24 } as MouseEvent;

    (view as any).openCardContextMenu(file.path, mouseEvent);

    expect(mockState.menuInstances).toHaveLength(1);
    const [menu] = mockState.menuInstances;
    expect(menu?.items.map((item) => item.title)).toEqual(["Move to…", "Copy"]);
    expect(menu?.items.map((item) => item.icon)).toEqual(["folder-input", "documents"]);
    expect(menu?.showAtMouseEvent).toHaveBeenCalledTimes(1);
    expect(menu?.showAtMouseEvent).toHaveBeenCalledWith(mouseEvent);
    expect(menu?.dom.classList.add).toHaveBeenCalledWith("fce-card-context-menu");
  });

  it("openCardContextMenu aborts and does not render menu on invalid inputs", () => {
    const { view } = createViewWithFile();
    
    (view as any).openCardContextMenu(123, { clientX: 12, clientY: 24 });
    (view as any).openCardContextMenu("path.md", null);
    (view as any).openCardContextMenu("path.md", { clientX: 12 });
    
    expect(mockState.menuInstances).toHaveLength(0);
  });


  it("copyCardNote delegates to copyNoteToClipboard exactly once", async () => {
    const { view, file, app } = createViewWithFile("notes/copy-target.md");

    await (view as any).copyCardNote(file.path);

    expect(copyNoteToClipboard).toHaveBeenCalledTimes(1);
    expect(copyNoteToClipboard).toHaveBeenCalledWith(app, file);
  });

  it("copyCardNote safely no-ops when file no longer exists", async () => {
    const { view, app } = createViewWithFile("notes/existing.md");
    // Simulate file disappearing by using a path that will not resolve
    const missingPath = "notes/deleted.md";
    app.vault.getAbstractFileByPath = vi.fn(() => null);

    await (view as any).copyCardNote(missingPath);

    // copyNoteToClipboard should never be called
    expect(copyNoteToClipboard).not.toHaveBeenCalled();
  });

  it("moveCardNote opens FolderPickerModal for the clicked file", () => {
    const { view, file } = createViewWithFile("notes/move-target.md");
    const openMoveFolderPickerSpy = vi.spyOn(view as any, "openMoveFolderPicker");

    (view as any).moveCardNote(file.path);

    expect(openMoveFolderPickerSpy).toHaveBeenCalledTimes(1);
    expect(openMoveFolderPickerSpy).toHaveBeenCalledWith(file);
    expect(mockState.folderPickerInstances).toHaveLength(1);
    expect(mockState.folderPickerInstances[0]?.open).toHaveBeenCalledTimes(1);
  });

  it("move selection no-ops when no folder is chosen", async () => {
    const { view, file } = createViewWithFile("notes/no-selection.md");

    (view as any).moveCardNote(file.path);
    const picker = mockState.folderPickerInstances[0];
    expect(picker).toBeDefined();

    await picker?.onChoose(null);

    expect(moveFile).not.toHaveBeenCalled();
    expect(mockState.noticeMessages).toHaveLength(0);
  });

  it("move selection no-ops when destination equals current parent folder", async () => {
    const { view, file } = createViewWithFile("notes/same-folder.md");

    (view as any).moveCardNote(file.path);
    const picker = mockState.folderPickerInstances[0];
    const sameFolder = createFolder("notes");

    await picker?.onChoose(sameFolder);

    expect(moveFile).not.toHaveBeenCalled();
    expect(mockState.noticeMessages).toHaveLength(0);
  });

  it("move selection re-resolves file and calls moveFile exactly once for different folder", async () => {
    const { view, file, app } = createViewWithFile("notes/move-me.md");
    const destination = createFolder("archive");

    (view as any).moveCardNote(file.path);
    const picker = mockState.folderPickerInstances[0];
    await picker?.onChoose(destination);

    expect(app.vault.getAbstractFileByPath).toHaveBeenLastCalledWith(file.path);
    expect(moveFile).toHaveBeenCalledTimes(1);
    expect(moveFile).toHaveBeenCalledWith(app, file, destination);
    expect(mockState.noticeMessages).toHaveLength(0);
  });

  it("move selection safely no-ops when file is missing at execution time", async () => {
    const { view, file, app } = createViewWithFile("notes/missing-on-move.md");
    const destination = createFolder("archive");

    (view as any).moveCardNote(file.path);
    app.vault.getAbstractFileByPath = vi.fn(() => null);
    const picker = mockState.folderPickerInstances[0];

    await picker?.onChoose(destination);

    expect(moveFile).not.toHaveBeenCalled();
    expect(mockState.noticeMessages).toHaveLength(0);
  });

  it("move failure shows a single error notice with no success notice", async () => {
    const { view, file } = createViewWithFile("notes/failure.md");
    const destination = createFolder("archive");
    vi.mocked(moveFile).mockResolvedValueOnce({
      ok: false,
      error: "permission denied",
      path: file.path,
    });

    (view as any).moveCardNote(file.path);
    const picker = mockState.folderPickerInstances[0];

    await picker?.onChoose(destination);

    expect(moveFile).toHaveBeenCalledTimes(1);
    expect(mockState.noticeMessages).toEqual(["Failed to move note: permission denied"]);
  });

  describe("rename-driven incremental refresh after move", () => {
    it("rename removes card when move leaves current folder scope", () => {
      const { view, file } = createViewWithFile("notes/inside.md");
      (view as any).folderPath = "notes";
      (view as any).baseCards = [createCardRecord(file)];

      const result = (view as any).handleVaultMutation({
        eventType: "rename",
        oldPath: "notes/inside.md",
        path: "archive/inside.md",
        isFolder: false,
        isMarkdown: true,
      });

      expect(result.shouldRefresh).toBe(false);
      expect(result.queueAction).toBe("ignored");
      expect(result.incrementalResult).toEqual({ handled: true, action: "removed" });
      expect((view as any).baseCards).toHaveLength(0);
      expect((view as any).refreshQueued).toBe(false);
    });

    it("rename updates card path when move stays visible in all-notes scope", () => {
      const { view, app, file } = createViewWithFile("notes/move-me.md");
      const movedFile = new mockState.MockTFile("archive/move-me.md");
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        return requestedPath === movedFile.path ? movedFile : null;
      });

      (view as any).folderPath = ALL_NOTES_PATH;
      (view as any).baseCards = [createCardRecord(file)];

      const result = (view as any).handleVaultMutation({
        eventType: "rename",
        oldPath: "notes/move-me.md",
        path: "archive/move-me.md",
        isFolder: false,
        isMarkdown: true,
      });

      expect(result.shouldRefresh).toBe(false);
      expect(result.queueAction).toBe("ignored");
      expect(result.incrementalResult).toEqual({ handled: true, action: "updated" });
      expect((view as any).baseCards).toHaveLength(1);
      expect((view as any).baseCards[0]?.path).toBe("archive/move-me.md");
      expect((view as any).baseCards[0]?.title).toBe("move-me");
      expect((view as any).baseCards[0]?.file).toBe(movedFile);
      expect((view as any).refreshQueued).toBe(false);
    });
  });
});
