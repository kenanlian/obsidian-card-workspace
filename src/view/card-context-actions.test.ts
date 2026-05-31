import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUiStrings } from "../i18n";

const mockState = vi.hoisted(() => {
  if (typeof HTMLElement === "undefined") {
    (globalThis as any).HTMLElement = class HTMLElement {};
  }

  const menuInstances: MockMenu[] = [];
  const folderPickerInstances: MockFolderPickerModal[] = [];
  const modalInstances: MockModal[] = [];
  const noticeMessages: string[] = [];
  const panelEventHandlers: Record<string, (event: any) => void> = {};
  const runtimeFlags = {
    isDesktopApp: true,
  };
  const clipboardWriteTextMock = vi.fn(async (_text: string) => undefined);

  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const existingNavigator = navigatorDescriptor?.get ? navigatorDescriptor.get.call(globalThis) : (globalThis as any).navigator;
  const nextNavigator = {
    ...(existingNavigator ?? {}),
    clipboard: {
      ...(existingNavigator?.clipboard ?? {}),
      writeText: clipboardWriteTextMock,
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: nextNavigator,
  });

  interface MockPanelProps {
    panelModel?: {
      getState: () => Record<string, unknown>;
      subscribe: (listener: (state: Record<string, unknown>) => void) => () => void;
    };
    onOpenNote?: (payload: Record<string, unknown>) => void;
    onBulkSelectCard?: (payload: Record<string, unknown>) => void;
    onCardContextMenu?: (payload: Record<string, unknown>) => void;
    onPinToggle?: (payload: Record<string, unknown>) => void;
    onToolbarAction?: (payload: Record<string, unknown>) => void;
    onSortChange?: (payload: Record<string, unknown>) => void;
    onFilterChange?: (payload: Record<string, unknown>) => void;
    onIncludeSubfoldersChange?: (payload: Record<string, unknown>) => void;
    onSearchQueryChange?: (payload: Record<string, unknown>) => void;
    onSearchQueryReset?: (payload: Record<string, unknown>) => void;
    onSelectFolder?: (payload: Record<string, unknown>) => void;
    onHydrateRange?: (payload: Record<string, unknown>) => void;
  }

  interface MockPanelMountOptions {
    props?: MockPanelProps;
  }

  interface MockMountedPanel {
    initialProps: Record<string, unknown>;
    modelSnapshots: Array<Record<string, unknown>>;
    teardown: () => void;
  }

  const panelInstances: MockMountedPanel[] = [];

  const createMountedPanel = (options: MockPanelMountOptions = {}): MockMountedPanel => {
    const panelModel = options.props?.panelModel;
    const initialProps = panelModel ? panelModel.getState() : {};
    const modelSnapshots: Array<Record<string, unknown>> = [];
    let unsubscribeModel: (() => void) | null = null;

    if (panelModel) {
      unsubscribeModel = panelModel.subscribe((snapshot) => {
        modelSnapshots.push(snapshot);
      });
    }

    const callbacks = options.props ?? {};
    const callbackPropToEvent: Record<string, string> = {
      onOpenNote: "open-note",
      onBulkSelectCard: "bulk-select-card",
      onCardContextMenu: "card-context-menu",
      onPinToggle: "pin-toggle",
      onToolbarAction: "toolbar-action",
      onSortChange: "sort-change",
      onFilterChange: "filter-change",
      onIncludeSubfoldersChange: "include-subfolders-change",
      onSearchQueryChange: "search-query-change",
      onSearchQueryReset: "search-query-reset",
      onSelectFolder: "select-folder",
      onHydrateRange: "hydrate-range",
    };

    for (const [callbackPropName, eventName] of Object.entries(callbackPropToEvent)) {
      const callback = (callbacks as Record<string, unknown>)[callbackPropName];
      if (typeof callback !== "function") {
        continue;
      }

      panelEventHandlers[eventName] = (event: any) => {
        callback(event?.detail ?? event);
      };
    }

    const mountedPanel: MockMountedPanel = {
      initialProps,
      modelSnapshots,
      teardown: () => {
        unsubscribeModel?.();
        unsubscribeModel = null;
      },
    };

    panelInstances.push(mountedPanel);
    return mountedPanel;
  };

  const svelteMountMock = vi.fn((Component: (options: MockPanelMountOptions) => MockMountedPanel, options: MockPanelMountOptions) => {
    return Component(options);
  });

  const svelteUnmountMock = vi.fn(async (component: { teardown?: () => void } | null) => {
    component?.teardown?.();
  });

  (globalThis as any).__mockState = { panelEventHandlers };

  class MockTFile {
    path: string;
    basename: string;
    name: string;
    extension: string;
    parent: { path: string } | null;

    constructor(path: string) {
      this.path = path;
      this.name = path.replace(/.*\//, "");
      const dotIndex = this.name.lastIndexOf(".");
      this.extension = dotIndex >= 0 ? this.name.slice(dotIndex + 1) : "";
      this.basename = dotIndex >= 0 ? this.name.slice(0, dotIndex) : this.name;
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
    submenu: MockMenu | null = null;
    kind: "item" | "separator" = "item";
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

    setSubmenu(submenu: MockMenu): this {
      this.submenu = submenu;
      const submenuIndex = menuInstances.indexOf(submenu);
      if (submenuIndex >= 0) {
        menuInstances.splice(submenuIndex, 1);
      }

      return this;
    }
  }

  class MockMenu {
    items: MockMenuItem[] = [];
    showAtMouseEvent = vi.fn();
    showAtPosition = vi.fn();
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

    addSeparator(): this {
      const separator = new MockMenuItem();
      separator.kind = "separator";
      this.items.push(separator);
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

  interface MockModalButton {
    text: string;
    warning: boolean;
    cta: boolean;
    onClick: (() => void) | null;
  }

  interface MockModalTextInput {
    value: string;
    onChange: ((value: string) => void) | null;
  }

  class MockModal {
    app: unknown;
    title = "";
    descriptions: string[] = [];
    messages: string[] = [];
    renderedPreviewText = "";
    renderOrder: string[] = [];
    buttons: MockModalButton[] = [];
    textInputs: MockModalTextInput[] = [];
    modalEl: {
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
    };
    contentEl: {
      __ownerModal: MockModal;
      scrollTop: number;
      empty: () => void;
      createEl: (tag: string, attrs?: { text?: string }) => Record<string, unknown>;
      createDiv: () => Record<string, unknown>;
    };

    constructor(app: unknown) {
      this.app = app;
      this.modalEl = {
        scrollTop: 0,
        scrollHeight: 1200,
        clientHeight: 400,
      };
      this.contentEl = {
        __ownerModal: this,
        scrollTop: 0,
        empty: () => {
          this.descriptions = [];
          this.messages = [];
          this.renderedPreviewText = "";
          this.renderOrder = [];
          this.buttons = [];
          this.textInputs = [];
        },
        createEl: (tag: string, attrs?: { text?: string }) => {
          this.renderOrder.push(`${tag}:${attrs?.text ?? ""}`);
          if (tag === "p" && typeof attrs?.text === "string") {
            this.messages.push(attrs.text);
          }
          if (tag === "pre" && typeof attrs?.text === "string") {
            this.renderedPreviewText = attrs.text;
          }
          return {};
        },
        createDiv: () => ({}),
      };
    }

    setTitle(title: string): this {
      this.title = title;
      return this;
    }

    open(): void {
      modalInstances.push(this);
      if ("onOpen" in this && typeof (this as any).onOpen === "function") {
        (this as any).onOpen();
      }
    }

    close(): void {
      if ("onClose" in this && typeof (this as any).onClose === "function") {
        (this as any).onClose();
      }
    }
  }

  class MockSetting {
    private modal: MockModal | null;

    constructor(containerEl: unknown) {
      const owner = (containerEl as { __ownerModal?: MockModal } | null)?.__ownerModal;
      this.modal = owner ?? null;
    }

    setName(_name: string): this {
      return this;
    }

    setDesc(description: string): this {
      this.modal?.descriptions.push(description);
      return this;
    }

    addText(configure: (text: {
      setValue: (value: string) => unknown;
      setPlaceholder: (value: string) => unknown;
      onChange: (handler: (value: string) => void) => unknown;
    }) => void): this {
      const record: MockModalTextInput = {
        value: "",
        onChange: null,
      };

      const chain = {
        setValue: (value: string) => {
          record.value = value;
          return chain;
        },
        setPlaceholder: (_value: string) => {
          return chain;
        },
        onChange: (handler: (value: string) => void) => {
          record.onChange = handler;
          return chain;
        },
      };

      configure(chain);
      this.modal?.textInputs.push(record);
      return this;
    }

    addButton(configure: (button: {
      setButtonText: (text: string) => unknown;
      onClick: (handler: () => void) => unknown;
      setWarning: () => unknown;
      setCta: () => unknown;
    }) => void): this {
      const record: MockModalButton = {
        text: "",
        warning: false,
        cta: false,
        onClick: null,
      };

      const chain = {
        setButtonText: (text: string) => {
          record.text = text;
          return chain;
        },
        onClick: (handler: () => void) => {
          record.onClick = handler;
          return chain;
        },
        setWarning: () => {
          record.warning = true;
          return chain;
        },
        setCta: () => {
          record.cta = true;
          return chain;
        },
      };

      configure(chain);
      this.modal?.renderOrder.push(`button:${record.text}`);
      this.modal?.buttons.push(record);
      return this;
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
    MockModal,
    MockNotice,
    MockSetting,
    MockTFile,
    MockTFolder,
    MockFolderPickerModal,
    createMountedPanel,
    svelteMountMock,
    svelteUnmountMock,
    menuInstances,
    folderPickerInstances,
    modalInstances,
    noticeMessages,
    panelEventHandlers,
    panelInstances,
    runtimeFlags,
    clipboardWriteTextMock,
  };
});

vi.mock("obsidian", () => {
  return {
    FuzzySuggestModal: class<T> {
      app: unknown;

      constructor(app: unknown) {
        this.app = app;
      }

      setTitle(_title: string): this {
        return this;
      }

      open(): void {
        return;
      }

      getItems(): T[] {
        return [];
      }

      getItemText(_item: T): string {
        return "";
      }

      onChooseItem(_item: T): void {
        return;
      }
    },
    ItemView: mockState.MockItemView,
    Menu: mockState.MockMenu,
    Modal: mockState.MockModal,
    Notice: mockState.MockNotice,
    Setting: mockState.MockSetting,
    Platform: {
      get isDesktopApp() {
        return mockState.runtimeFlags.isDesktopApp;
      },
    },
    getAllTags: (cache: { tags?: Array<{ tag: string }> } | null) => {
      return cache?.tags?.map((entry) => entry.tag) ?? [];
    },
    TFile: mockState.MockTFile,
    TFolder: mockState.MockTFolder,
  };
});

vi.mock("svelte", () => {
  return {
    mount: mockState.svelteMountMock,
    unmount: mockState.svelteUnmountMock,
  };
});

vi.mock("./FolderCardPanel.svelte", () => {
  return {
    default: mockState.createMountedPanel,
  };
});

vi.mock("./note-ops", () => {
  return {
    batchDeleteFilesUsingObsidianPreference: vi.fn(async () => ({ succeeded: [], failed: [] })),
    batchMoveFiles: vi.fn(async () => ({ succeeded: [], failed: [] })),
    batchTrashFiles: vi.fn(async () => ({ succeeded: [], failed: [] })),
    copyNoteToClipboard: vi.fn(async () => true),
    deleteFileUsingObsidianPreference: vi.fn(async (_app: unknown, file: unknown) => ({ ok: true, file })),
    duplicateFile: vi.fn(async (_app: unknown, file: unknown) => ({ ok: true, file })),
    mergeNotes: vi.fn(async () => ({
      ok: true,
      mergedFile: new mockState.MockTFile("notes/Merged notes.md"),
      sourceCount: 2,
    })),
    moveFile: vi.fn(async (_app: unknown, file: unknown) => ({ ok: true, file })),
  };
});

vi.mock("../FolderPickerModal", () => {
  return {
    FolderPickerModal: mockState.MockFolderPickerModal,
  };
});

import { FolderCardView } from "./FolderCardView";
import {
  batchDeleteFilesUsingObsidianPreference,
  batchMoveFiles,
  batchTrashFiles,
  copyNoteToClipboard,
  deleteFileUsingObsidianPreference,
  duplicateFile,
  mergeNotes,
  moveFile,
} from "./note-ops";
import type { SearchServiceSnapshot } from "../search";
import * as markdownUtils from "./markdown-utils";

function createFolder(path: string): InstanceType<typeof mockState.MockTFolder> {
  return new mockState.MockTFolder(path);
}

function createMarkdownFile(path: string): InstanceType<typeof mockState.MockTFile> {
  const file = new mockState.MockTFile(path);
  (file as unknown as { extension: string }).extension = "md";
  return file;
}

function createNonMarkdownFile(path: string, extension: string = "png"): InstanceType<typeof mockState.MockTFile> {
  const file = new mockState.MockTFile(path);
  (file as unknown as { extension: string }).extension = extension;
  return file;
}

function attachChildren(
  folder: InstanceType<typeof mockState.MockTFolder>,
  children: unknown[],
): InstanceType<typeof mockState.MockTFolder> {
  folder.children = children;
  return folder;
}

function createViewWithFile(
  path: string = "notes/a.md",
  options: {
    isDesktopApp?: boolean;
    fullPath?: string | null;
    promptForDeletion?: (file: InstanceType<typeof mockState.MockTFile>) => Promise<boolean> | boolean;
  } = {},
): {
  view: FolderCardView;
  app: any;
  file: InstanceType<typeof mockState.MockTFile>;
  plugin: any;
} {
  const file = new mockState.MockTFile(path);
  mockState.runtimeFlags.isDesktopApp = options.isDesktopApp ?? true;
  const app = {
    metadataCache: {
      getFileCache: vi.fn(() => null),
    },
    fileManager: {
      promptForDeletion: vi.fn(async (targetFile: InstanceType<typeof mockState.MockTFile>) => {
        if (typeof options.promptForDeletion === "function") {
          return options.promptForDeletion(targetFile);
        }

        return true;
      }),
      trashFile: vi.fn(async () => undefined),
      renameFile: vi.fn(async () => undefined),
    },
    vault: {
      adapter: {
        getFullPath: vi.fn(() => {
          if (Object.prototype.hasOwnProperty.call(options, "fullPath")) {
            return options.fullPath;
          }

          return `/vault/${path}`;
        }),
      },
      getName: vi.fn(() => "Test Vault"),
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
        previewLines: 5,
              })),
      getUiLanguage: vi.fn(() => "en"),
      getUiStrings: vi.fn(() => getUiStrings("en")),
      getSearchService: vi.fn(() => null),
      getSearchSnapshot: vi.fn(() => null),
      subscribeSearchSnapshots: vi.fn(() => () => undefined),
      openNoteFromCard: vi.fn(),
     selectAllNotes: vi.fn(),
     createNoteInCurrentFolder: vi.fn(),
     selectFolderByPath: vi.fn(),
     saveSettings: vi.fn(async () => undefined),
   };

  const view = new FolderCardView(leaf as any, plugin as any);
  return { view, app, file, plugin };
}

function createCardRecord(
  file: InstanceType<typeof mockState.MockTFile>,
  fileKind: "markdown" | "base" | "canvas" | "excalidraw" = "markdown",
) {
  return {
    file,
    fileKind,
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

function createCardRecordFromPath(
  path: string,
  fileKind: "markdown" | "base" | "canvas" | "excalidraw" = "markdown",
) {
  const file = createMarkdownFile(path);
  (file as unknown as { stat: { ctime: number; mtime: number } }).stat = {
    ctime: 1,
    mtime: 1,
  };
  return createCardRecord(file, fileKind);
}

function createIndexedSearchServiceStub(result: {
  mode: "indexed";
  status: "ready" | "building" | "error";
  execution:
    | "indexed-ready"
    | "indexed-building"
    | "indexed-rebuild-required"
    | "indexed-storage-unavailable"
    | "indexed-error"
    | "indexed-unavailable";
  orderedPaths?: string[];
} = {
  mode: "indexed",
  status: "building",
  execution: "indexed-unavailable",
}): {
  initialize: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  getSnapshot: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  handleVaultMutation: ReturnType<typeof vi.fn>;
} {
  return {
    initialize: vi.fn(async () => undefined),
    dispose: vi.fn(() => undefined),
    getSnapshot: vi.fn(() => null),
    subscribe: vi.fn(() => () => undefined),
    query: vi.fn(async () => result),
    handleVaultMutation: vi.fn(() => undefined),
  };
}

function clickLatestModalButton(buttonText: string, occurrence: number = 0): void {
  const modal = mockState.modalInstances.at(-1);
  expect(modal).toBeDefined();

  const buttons = modal?.buttons.filter((candidate) => candidate.text === buttonText) ?? [];
  const button = buttons[occurrence];
  expect(button).toBeDefined();
  expect(typeof button?.onClick).toBe("function");
  button?.onClick?.();
}

function setLatestModalTextInput(index: number, value: string): void {
  const modal = mockState.modalInstances.at(-1);
  expect(modal).toBeDefined();

  const input = modal?.textInputs[index];
  expect(input).toBeDefined();
  input!.value = value;
  input?.onChange?.(value);
}

function getMenuItemTitles(menu: { items: Array<{ kind?: string; title: string }> }): string[] {
  return menu.items.filter((item) => item.kind !== "separator").map((item) => item.title);
}

function getMenuStructure(menu: {
  items: Array<{
    kind?: string;
    title: string;
    submenu?: { items: Array<{ kind?: string; title: string }> } | null;
  }>;
}): Array<string> {
  return menu.items.map((item) => {
    if (item.kind === "separator") {
      return "separator";
    }

    if (item.submenu) {
      const submenuTitles = item.submenu.items.map((submenuItem) => {
        return submenuItem.kind === "separator" ? "separator" : submenuItem.title;
      });
      return `${item.title} -> ${submenuTitles.join(", ")}`;
    }

    return item.title;
  });
}

function getTopLevelMenuSignature(menu: {
  items: Array<{
    kind?: string;
    title: string;
    icon?: string;
  }>;
}): Array<{ kind: "separator" } | { kind: "item"; title: string; icon: string }> {
  return menu.items.map((item) => {
    if (item.kind === "separator") {
      return { kind: "separator" };
    }

    return {
      kind: "item",
      title: item.title,
      icon: item.icon ?? "",
    };
  });
}

function findMenuItemByTitle(
  menu: {
    items: Array<{
      title: string;
      icon?: string;
      clickHandler?: (() => void) | null;
      submenu?: { items: Array<{ kind?: string; title: string; icon?: string }> } | null;
    }>;
  },
  title: string,
): {
  title: string;
  icon?: string;
  clickHandler?: (() => void) | null;
  submenu?: { items: Array<{ kind?: string; title: string; icon?: string }> } | null;
} {
  const item = menu.items.find((entry) => entry.title === title);
  expect(item).toBeDefined();
  return item as {
    title: string;
    icon?: string;
    clickHandler?: (() => void) | null;
    submenu?: { items: Array<{ kind?: string; title: string; icon?: string }> } | null;
  };
}

async function flushAsyncWork(iterations: number = 5): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

describe("FolderCardView card context actions", () => {
  beforeEach(() => {
    mockState.menuInstances.length = 0;
    mockState.folderPickerInstances.length = 0;
    mockState.modalInstances.length = 0;
    mockState.noticeMessages.length = 0;
    mockState.panelInstances.length = 0;
    mockState.runtimeFlags.isDesktopApp = true;
    mockState.clipboardWriteTextMock.mockReset();
    mockState.clipboardWriteTextMock.mockResolvedValue(undefined);
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
      await flushAsyncWork();

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
      contextMenuHandler({
        detail: { path: file.path, trigger: "contextmenu", mouseEvent: mockMouseEvent },
      });

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

      contextMenuHandler({
        detail: { path: file.path, trigger: "contextmenu", mouseEvent: event1 },
      });
      contextMenuHandler({
        detail: { path: file.path, trigger: "contextmenu", mouseEvent: event2 },
      });

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
      contextMenuHandler({
        detail: { path: file.path, trigger: "contextmenu", mouseEvent: mockMouseEvent },
      });

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

     it("onOpen() registers filter-change subscription that persists only the first selected tag", async () => {
       const { view, plugin } = createViewWithFile("notes/test-filter.md");

       await (view as any).onOpen();

       expect(mockState.panelEventHandlers["filter-change"]).toBeDefined();

       const filterChangeHandler = mockState.panelEventHandlers["filter-change"];
       filterChangeHandler({ detail: { tags: ["important", "archived"] } });

        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(plugin.saveSettings).toHaveBeenCalledWith({
          filter: {
            tags: ["important"],
          },
        });
      });

      it("filter-change handler sanitizes, normalizes, and single-selects tag input", async () => {
       const { view, plugin } = createViewWithFile("notes/tag-normalize.md");

       await (view as any).onOpen();

       const filterChangeHandler = mockState.panelEventHandlers["filter-change"];
       filterChangeHandler({ detail: { tags: ["#Important", " WORK ", "", "   "] } });

        expect(plugin.saveSettings).toHaveBeenCalledWith({
          filter: {
            tags: ["important"],
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

    describe("Task 2: Search query coordinator ownership", () => {
      it("search queries run only after the 120ms debounce boundary", async () => {
        vi.useFakeTimers();
        try {
          const { view, plugin } = createViewWithFile("notes/search-service-boundary.md");
          const visibleCards = [
            createCardRecordFromPath("notes/search-service-boundary.md"),
            createCardRecordFromPath("notes/second.md"),
          ];

          const service = createIndexedSearchServiceStub();
          const querySpy = service.query;
          plugin.getSearchService = vi.fn(() => service);

          (view as any).folderPath = "notes";
          (view as any).baseCards = visibleCards;
          (view as any).visibleCards = visibleCards;

          await (view as any).onOpen();

          const queryChangeHandler = mockState.panelEventHandlers["search-query-change"];
          queryChangeHandler({ detail: { query: "roadmap" } });

          expect(querySpy).not.toHaveBeenCalled();

          vi.advanceTimersByTime(119);
          await flushAsyncWork();
          expect(querySpy).not.toHaveBeenCalled();

          vi.advanceTimersByTime(1);
          await flushAsyncWork();

          expect((view as any).searchQuery).toBe("roadmap");
          expect(plugin.saveSettings).not.toHaveBeenCalled();
          expect(querySpy).toHaveBeenCalledWith({
            query: "roadmap",
            scope: {
              folderPath: "notes",
              includeSubfolders: true,
            },
            candidatePaths: visibleCards.map((card) => card.path),
          });
          expect((view as any).visibleCards).toEqual([]);
          expect((view as any).searchStatus).toBe("unavailable");
          expect((view as any).searchOrderedPaths).toBeUndefined();
          expect(mockState.panelInstances[0]?.modelSnapshots.at(-1)).toMatchObject({
            searchQuery: "roadmap",
            searchStatus: "unavailable",
            cards: [],
          });
        } finally {
          vi.useRealTimers();
        }
      });

      it("reset clears query state but keeps snapshot-driven health visibility", async () => {
        vi.useFakeTimers();
        try {
          const { view, plugin } = createViewWithFile("notes/search-reset-health.md");
          const service = createIndexedSearchServiceStub();
          const getSearchService = vi.fn(() => service);
          plugin.getSearchService = getSearchService;
          plugin.getSearchSnapshot = vi.fn(() => ({
            initialized: true,
            disposed: false,
            mode: "indexed",
            status: "error",
            lastError: "index unavailable",
            health: createSearchHealth({
              outcome: "failed",
              readiness: "error",
              healthy: false,
              rebuilding: false,
              rebuildRequired: false,
              documentCount: null,
              lastIndexedAt: null,
              lastError: "index unavailable",
              detail: "failed",
            }),
          }));

          await (view as any).onOpen();

          expect((view as any).searchStatus).toBe("error");

          const queryChangeHandler = mockState.panelEventHandlers["search-query-change"];
          const queryResetHandler = mockState.panelEventHandlers["search-query-reset"];

          queryChangeHandler({ detail: { query: "alpha" } });
          expect((view as any).searchStatus).toBe("error");

            queryResetHandler({ detail: { source: "clear-button" } });
            expect((view as any).searchQuery).toBe("");
            expect((view as any).searchOrderedPaths).toBeUndefined();
            expect((view as any).searchStatus).toBe("error");

          vi.advanceTimersByTime(200);
          await flushAsyncWork();
          expect(getSearchService).not.toHaveBeenCalled();
          expect(plugin.saveSettings).not.toHaveBeenCalled();
        } finally {
          vi.useRealTimers();
        }
      });

      it("drops stale async results after snapshot transition and folder switch", async () => {
        vi.useFakeTimers();
        try {
          const { view, plugin } = createViewWithFile("notes/search-stale-protection.md");
          const visibleCards = [
            createCardRecordFromPath("notes/search-stale-protection.md"),
            createCardRecordFromPath("notes/second.md"),
          ];

          const pending: Array<{ resolve: (result: any) => void }> = [];
          const query = vi.fn((_request: unknown) => {
            return new Promise((resolve) => {
              pending.push({ resolve });
            });
          });

          let snapshotListener: ((snapshot: SearchServiceSnapshot) => void) | null = null;
          const emitSnapshot = (snapshot: SearchServiceSnapshot): void => {
            const listener = snapshotListener;
            if (!listener) {
              return;
            }

            listener(snapshot);
          };
          plugin.getSearchSnapshot = vi.fn(() => ({

            initialized: true,
            disposed: false,
            mode: "indexed",
            status: "ready",
            lastError: null,
            health: createSearchHealth({
              documentCount: 2,
              lastSuccessfulRestore: {
                outcome: "restored",
                at: 1,
                documentCount: 2,
                detail: "restored",
              },
            }),
          }));
          plugin.subscribeSearchSnapshots = vi.fn((listener: (snapshot: SearchServiceSnapshot) => void) => {
            snapshotListener = listener;
            return () => {
              snapshotListener = null;
            };
          });
          plugin.getSearchService = vi.fn(() => ({ query }));

          (view as any).folderPath = "notes";
          (view as any).baseCards = visibleCards;
          (view as any).visibleCards = visibleCards;

          await (view as any).onOpen();

          const queryChangeHandler = mockState.panelEventHandlers["search-query-change"];

          queryChangeHandler({ detail: { query: "alpha" } });
          vi.advanceTimersByTime(120);
          await flushAsyncWork();
          expect(query).toHaveBeenCalledTimes(1);

          queryChangeHandler({ detail: { query: "beta" } });
          vi.advanceTimersByTime(120);
          await flushAsyncWork();
          expect(query).toHaveBeenCalledTimes(2);

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

          pending[1]?.resolve({
            mode: "indexed",
            status: "ready",
            execution: "indexed-ready",
            orderedPaths: [visibleCards[1].path],
          });
          await flushAsyncWork();

          expect((view as any).searchStatus).toBe("rebuild-required");
          expect((view as any).searchOrderedPaths).toBeUndefined();

          queryChangeHandler({ detail: { query: "gamma" } });
          vi.advanceTimersByTime(120);
          await flushAsyncWork();
          expect(query).toHaveBeenCalledTimes(3);

          (view as any).generation += 1;
          (view as any).folderPath = "archive";

          pending[2]?.resolve({
            mode: "indexed",
            status: "ready",
            execution: "indexed-ready",
            orderedPaths: [visibleCards[0].path],
          });
          pending[0]?.resolve({
            mode: "indexed",
            status: "ready",
            execution: "indexed-ready",
            orderedPaths: [visibleCards[0].path],
          });
          await flushAsyncWork();

          expect((view as any).searchQuery).toBe("gamma");
          expect((view as any).searchStatus).toBe("rebuild-required");
          expect((view as any).searchOrderedPaths).toBeUndefined();
        } finally {
          vi.useRealTimers();
        }
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
        expect(mockState.panelEventHandlers["include-subfolders-change"]).toBeDefined();
        expect(mockState.panelEventHandlers["search-query-change"]).toBeDefined();
        expect(mockState.panelEventHandlers["search-query-reset"]).toBeDefined();
        expect(mockState.panelEventHandlers["pin-toggle"]).toBeDefined();
        expect(typeof mockState.panelEventHandlers["pin-toggle"]).toBe("function");
      });

      it("registers bulk subscriptions", async () => {
        const { view } = createViewWithFile("notes/bulk-subscriptions.md");

        (view as any).bulkMode = true;
        (view as any).selectedPaths = new Set(["notes/bulk-subscriptions.md"]);
        (view as any).bulkAnchorPath = "notes/bulk-subscriptions.md";

        await (view as any).onOpen();

        expect(mockState.panelEventHandlers["toolbar-action"]).toBeDefined();
        expect(mockState.panelEventHandlers["bulk-select-card"]).toBeDefined();
        expect(typeof mockState.panelEventHandlers["toolbar-action"]).toBe("function");
        expect(typeof mockState.panelEventHandlers["bulk-select-card"]).toBe("function");
        expect(mockState.panelInstances).toHaveLength(1);
        expect(mockState.panelInstances[0]?.initialProps).toMatchObject({
          bulkMode: true,
          selectedPaths: ["notes/bulk-subscriptions.md"],
          selectedCount: 1,
          bulkAnchorPath: "notes/bulk-subscriptions.md",
          canBulkSelectAll: false,
          canBulkClearSelection: true,
          canBulkMoveSelected: true,
          canBulkDeleteSelected: true,
          canBulkMergeSelected: false,
        });
      });

      it("normal mode and bulk mode click behavior stay distinct", async () => {
        const { view, plugin } = createViewWithFile("notes/click-distinction.md");
        const visibleCards = [createCardRecordFromPath("notes/selected-in-bulk.md")];

        (view as any).baseCards = visibleCards;
        (view as any).visibleCards = visibleCards;
        (view as any).deriveVisibleCards = vi.fn(() => visibleCards);

        await (view as any).onOpen();

        const openNoteHandler = mockState.panelEventHandlers["open-note"];
        const bulkSelectHandler = mockState.panelEventHandlers["bulk-select-card"];

        openNoteHandler({ detail: { path: "notes/normal-open.md" } });
        expect(plugin.openNoteFromCard).toHaveBeenCalledTimes(1);
        expect(plugin.openNoteFromCard).toHaveBeenLastCalledWith("notes/normal-open.md");

        (view as any).bulkMode = true;
        openNoteHandler({ detail: { path: "notes/should-not-open.md" } });
        expect(plugin.openNoteFromCard).toHaveBeenCalledTimes(1);

        bulkSelectHandler({ detail: { path: "notes/selected-in-bulk.md", shiftKey: false } });

        expect(plugin.openNoteFromCard).toHaveBeenCalledTimes(1);
        expect(Array.from((view as any).selectedPaths)).toEqual(["notes/selected-in-bulk.md"]);
        expect((view as any).bulkAnchorPath).toBe("notes/selected-in-bulk.md");
      });

      it("shift-range selection uses visible order", async () => {
        const { view, plugin } = createViewWithFile("notes/shift-visible-order.md");
        const visibleCards = [
          createCardRecordFromPath("notes/c.md"),
          createCardRecordFromPath("notes/b.md"),
          createCardRecordFromPath("notes/a.md"),
          createCardRecordFromPath("notes/d.md"),
        ];

        (view as any).baseCards = [
          createCardRecordFromPath("notes/a.md"),
          createCardRecordFromPath("notes/b.md"),
          createCardRecordFromPath("notes/c.md"),
          createCardRecordFromPath("notes/d.md"),
          createCardRecordFromPath("notes/hidden.md"),
        ];
        (view as any).visibleCards = visibleCards;
        (view as any).deriveVisibleCards = vi.fn(() => visibleCards);
        (view as any).bulkMode = true;

        await (view as any).onOpen();

        const bulkSelectHandler = mockState.panelEventHandlers["bulk-select-card"];
        bulkSelectHandler({ detail: { path: "notes/b.md", shiftKey: false } });
        bulkSelectHandler({ detail: { path: "notes/d.md", shiftKey: true } });

        expect(Array.from((view as any).selectedPaths)).toEqual([
          "notes/b.md",
          "notes/a.md",
          "notes/d.md",
        ]);
        expect((view as any).bulkAnchorPath).toBe("notes/b.md");
        expect((view as any).selectedPaths.has("notes/hidden.md")).toBe(false);
        expect(plugin.openNoteFromCard).not.toHaveBeenCalled();
      });

      it("bulk selection state machine", async () => {
        const { view } = createViewWithFile("notes/bulk-state-machine.md");
        const visibleCards = [
          createCardRecordFromPath("notes/alpha.md"),
          createCardRecordFromPath("notes/gamma.md"),
          createCardRecordFromPath("notes/beta.md"),
        ];

        (view as any).visibleCards = visibleCards;
        (view as any).deriveVisibleCards = vi.fn(() => visibleCards);
        (view as any).bulkMode = true;
        (view as any).selectedPaths = new Set<string>(["notes/alpha.md"]);
        (view as any).bulkAnchorPath = "notes/alpha.md";

        await (view as any).onOpen();

        const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
        toolbarActionHandler({ detail: { action: "bulk-select-all" } });

        expect(Array.from((view as any).selectedPaths)).toEqual([
          "notes/alpha.md",
          "notes/gamma.md",
          "notes/beta.md",
        ]);
        expect((view as any).bulkAnchorPath).toBe("notes/alpha.md");

        const afterSelectAll = mockState.panelInstances[0]?.modelSnapshots.at(-1);
        expect(afterSelectAll).toMatchObject({
          selectedPaths: ["notes/alpha.md", "notes/gamma.md", "notes/beta.md"],
          selectedCount: 3,
          bulkAnchorPath: "notes/alpha.md",
          canBulkSelectAll: true,
          canBulkClearSelection: true,
          canBulkMoveSelected: true,
          canBulkDeleteSelected: true,
          canBulkMergeSelected: true,
        });

        toolbarActionHandler({ detail: { action: "bulk-clear-selection" } });

        expect((view as any).selectedPaths.size).toBe(0);
        expect((view as any).bulkAnchorPath).toBeNull();

        const afterClear = mockState.panelInstances[0]?.modelSnapshots.at(-1);
        expect(afterClear).toMatchObject({
          selectedPaths: [],
          selectedCount: 0,
          bulkAnchorPath: null,
          canBulkSelectAll: true,
          canBulkClearSelection: false,
          canBulkMoveSelected: false,
          canBulkDeleteSelected: false,
          canBulkMergeSelected: false,
        });
      });

      it("bulk toolbar actions and enablement", async () => {
        const { view } = createViewWithFile("notes/bulk-toolbar.md");
        const visibleCards = [
          createCardRecordFromPath("notes/alpha.md"),
          createCardRecordFromPath("notes/beta.md"),
          createCardRecordFromPath("notes/gamma.md"),
        ];

        (view as any).visibleCards = visibleCards;
        (view as any).deriveVisibleCards = vi.fn(() => visibleCards);
        (view as any).bulkMode = true;

        await (view as any).onOpen();

        expect(mockState.panelInstances).toHaveLength(1);
        expect(mockState.panelInstances[0]?.initialProps).toMatchObject({
          bulkMode: true,
          selectedPaths: [],
          selectedCount: 0,
          bulkAnchorPath: null,
          canBulkSelectAll: true,
          canBulkClearSelection: false,
          canBulkMoveSelected: false,
          canBulkDeleteSelected: false,
          canBulkMergeSelected: false,
        });

        (view as any).selectedPaths = new Set(["notes/beta.md"]);
        (view as any).bulkAnchorPath = "notes/beta.md";
        (view as any).pushState();

        const afterSingleSelect = mockState.panelInstances[0]?.modelSnapshots.at(-1);
        expect(afterSingleSelect).toMatchObject({
          selectedPaths: ["notes/beta.md"],
          selectedCount: 1,
          bulkAnchorPath: "notes/beta.md",
          canBulkSelectAll: true,
          canBulkClearSelection: true,
          canBulkMoveSelected: true,
          canBulkDeleteSelected: true,
          canBulkMergeSelected: false,
        });

        const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
        toolbarActionHandler({ detail: { action: "bulk-select-all" } });

        expect(Array.from((view as any).selectedPaths)).toEqual([
          "notes/alpha.md",
          "notes/beta.md",
          "notes/gamma.md",
        ]);

        const afterSelectAll = mockState.panelInstances[0]?.modelSnapshots.at(-1);
        expect(afterSelectAll).toMatchObject({
          selectedPaths: ["notes/alpha.md", "notes/beta.md", "notes/gamma.md"],
          selectedCount: 3,
          bulkAnchorPath: "notes/beta.md",
          canBulkSelectAll: true,
          canBulkClearSelection: true,
          canBulkMoveSelected: true,
          canBulkDeleteSelected: true,
          canBulkMergeSelected: true,
        });
      });

      it("exiting bulk mode clears selection", async () => {
        const { view } = createViewWithFile("notes/bulk-exit.md");
        const visibleCards = [
          createCardRecordFromPath("notes/alpha.md"),
          createCardRecordFromPath("notes/beta.md"),
        ];

        (view as any).visibleCards = visibleCards;
        (view as any).deriveVisibleCards = vi.fn(() => visibleCards);
        (view as any).bulkMode = true;
        (view as any).selectedPaths = new Set(["notes/alpha.md", "notes/beta.md"]);
        (view as any).bulkAnchorPath = "notes/alpha.md";

        await (view as any).onOpen();

        const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
        toolbarActionHandler({ detail: { action: "bulk" } });

        expect((view as any).bulkMode).toBe(false);
        expect((view as any).selectedPaths.size).toBe(0);
        expect((view as any).bulkAnchorPath).toBeNull();
        expect(mockState.panelInstances[0]?.modelSnapshots.at(-1)).toMatchObject({
          bulkMode: false,
          selectedPaths: [],
          selectedCount: 0,
          bulkAnchorPath: null,
          canBulkSelectAll: true,
          canBulkClearSelection: false,
          canBulkMoveSelected: false,
          canBulkDeleteSelected: false,
          canBulkMergeSelected: false,
        });
      });

      it("onOpen passes includeSubfolders and folder scope props to the panel", async () => {
        const { view } = createViewWithFile("notes/folder-scope-props.md");

        (view as any).folderPath = "projects/active";

        await (view as any).onOpen();

        expect(mockState.panelInstances).toHaveLength(1);
        expect(mockState.panelInstances[0]?.initialProps).toMatchObject({
          folderPath: "projects/active",
          includeSubfolders: true,
          previewLines: 5,
        });
      });

      it("onOpen passes a legible root folder scope state to the panel", async () => {
        const { view } = createViewWithFile("notes/root-props.md");

        (view as any).folderPath = "";

        await (view as any).onOpen();

        expect(mockState.panelInstances).toHaveLength(1);
        expect(mockState.panelInstances[0]?.initialProps).toMatchObject({
          folderPath: "/",
          includeSubfolders: true,
        });
      });

      it("include-subfolders-change persists valid boolean values in folder scope", async () => {
        const { view, plugin } = createViewWithFile("notes/include-subfolders.md");

        (view as any).folderPath = "projects/active";

        await (view as any).onOpen();

        const includeSubfoldersHandler = mockState.panelEventHandlers["include-subfolders-change"];
        expect(includeSubfoldersHandler).toBeDefined();

        includeSubfoldersHandler({ detail: { value: false } });

        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(plugin.saveSettings).toHaveBeenCalledWith({
          includeSubfolders: false,
        });
      });

      it("include-subfolders-change ignores invalid values", async () => {
        const { view, plugin } = createViewWithFile("notes/include-subfolders-invalid.md");

        (view as any).folderPath = "projects/active";

        await (view as any).onOpen();

        const includeSubfoldersHandler = mockState.panelEventHandlers["include-subfolders-change"];
        includeSubfoldersHandler({ detail: { value: "nope" } });

        expect(plugin.saveSettings).not.toHaveBeenCalled();
      });

      it("include-subfolders-change persists valid boolean values in root folder scope", async () => {
        const { view, plugin } = createViewWithFile("notes/include-subfolders-root.md");

        (view as any).folderPath = "";

        await (view as any).onOpen();

        const includeSubfoldersHandler = mockState.panelEventHandlers["include-subfolders-change"];
        includeSubfoldersHandler({ detail: { value: false } });

        expect(plugin.saveSettings).toHaveBeenCalledWith({
          includeSubfolders: false,
        });
      });

      it("include-subfolders-change is a no-op when the requested value already matches settings", async () => {
        const { view, plugin } = createViewWithFile("notes/include-subfolders-same-value.md");

        (view as any).folderPath = "projects/active";

        await (view as any).onOpen();

        const includeSubfoldersHandler = mockState.panelEventHandlers["include-subfolders-change"];
        includeSubfoldersHandler({ detail: { value: true } });

        expect(plugin.saveSettings).not.toHaveBeenCalled();
      });

      it("sort-change subscription persists the requested sort settings", async () => {
        const { view, plugin } = createViewWithFile("notes/sort-change.md");

        await (view as any).onOpen();

        const sortChangeHandler = mockState.panelEventHandlers["sort-change"];
        expect(sortChangeHandler).toBeDefined();

        sortChangeHandler({ detail: { field: "ctime", direction: "asc" } });

        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(plugin.saveSettings).toHaveBeenCalledWith({
          sort: {
            field: "ctime",
            direction: "asc",
          },
        });
      });

      it("select-folder subscription routes to plugin.selectFolderByPath with panel-picker source", async () => {
        const { view, plugin } = createViewWithFile("notes/select-folder.md");

        await (view as any).onOpen();

        const selectFolderHandler = mockState.panelEventHandlers["select-folder"];
        expect(selectFolderHandler).toBeDefined();

        selectFolderHandler({ detail: { path: "projects/archive" } });

        expect(plugin.selectFolderByPath).toHaveBeenCalledTimes(1);
        expect(plugin.selectFolderByPath).toHaveBeenCalledWith("projects/archive", "panel-picker");
      });


      it("hydrate-range subscription forwards visible window to hydrateRange", async () => {
        const { view, app, file } = createViewWithFile("notes/hydrate-range.md");
        const card = createCardRecord(file);

        app.vault.cachedRead = vi.fn(async () => "# Hydrate me\nBody");
        (view as any).baseCards = [card];
        (view as any).visibleCards = [card];
        (view as any).loading = false;

        await (view as any).onOpen();

        const hydrateRangeHandler = mockState.panelEventHandlers["hydrate-range"];
        expect(hydrateRangeHandler).toBeDefined();

        hydrateRangeHandler({ detail: { start: 0, end: 1 } });
        await flushAsyncWork(1);
        await flushAsyncWork(1);

        expect(app.vault.cachedRead).toHaveBeenCalledTimes(1);
        expect(app.vault.cachedRead).toHaveBeenCalledWith(file);
        expect(card.hydrated).toBe(true);
      });
      it("prewarms projected startup cards before the first non-loading panel snapshot", async () => {
        const { view, app, plugin } = createViewWithFile("notes/prewarm-projection-seed.md");
        const pinnedFile = createMarkdownFile("notes/pinned.md");
        const remainingTaggedFiles = Array.from({ length: 12 }, (_, index) =>
          createMarkdownFile(`notes/tagged-${index + 2}.md`),
        );
        const filteredOutFile = createMarkdownFile("notes/filtered-out.md");
        const files = [pinnedFile, ...remainingTaggedFiles, filteredOutFile];

        files.forEach((file, index) => {
          (file as unknown as { stat: { ctime: number; mtime: number } }).stat = {
            ctime: index + 1,
            mtime: file.path === filteredOutFile.path ? 200 : index + 1,
          };
        });

        const notesFolder = attachChildren(createFolder("notes"), files);
        const fileByPath = new Map(files.map((file) => [file.path, file] as const));

        plugin.getSettings = vi.fn(() => ({
          includeSubfolders: true,
          sort: { field: "mtime", direction: "desc" },
          filter: { tags: ["focus"] },
          defaultView: "cards",
          lastFolderPath: null,
          lastViewMode: "folder",
          pinnedPaths: [pinnedFile.path],
          previewLines: 5,
        }));

        app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
          if (requestedPath === "notes") {
            return notesFolder;
          }
          return fileByPath.get(requestedPath) ?? null;
        });
        app.metadataCache.getFileCache = vi.fn((file: { path: string }) => {
          if (file.path === filteredOutFile.path) {
            return { tags: [{ tag: "#other" }] };
          }
          return { tags: [{ tag: "#focus" }] };
        });
        app.vault.cachedRead = vi.fn(async (file: { basename: string }) => `# ${file.basename}\nBody ${file.basename}`);

        await (view as any).onOpen();
        await (view as any).handleFolderSelection({
          requestId: 6,
          folderPath: "notes",
          source: "programmatic",
          requestedAtMs: Date.now(),
          forceRefresh: false,
        });

        const firstStableSnapshot = mockState.panelInstances[0]?.modelSnapshots.find(
          (snapshot: any) =>
            snapshot.loading === false &&
            Array.isArray(snapshot.cards) &&
            snapshot.cards.length > 0,
        ) as { cards?: Array<{ path: string; hydrated: boolean }> } | undefined;

        expect(firstStableSnapshot).toBeDefined();
        expect(firstStableSnapshot?.cards).toHaveLength(13);
        expect(firstStableSnapshot?.cards?.[0]?.path).toBe(pinnedFile.path);
        expect(firstStableSnapshot?.cards?.slice(0, 12).every((card) => card.hydrated)).toBe(true);
        expect(firstStableSnapshot?.cards?.[12]?.path).toBe(remainingTaggedFiles[0]?.path);
        expect(firstStableSnapshot?.cards?.[12]?.hydrated).toBe(false);
        expect(app.vault.cachedRead).toHaveBeenCalledTimes(12);
        expect(app.vault.cachedRead).not.toHaveBeenCalledWith(filteredOutFile);
      });

      it("startup prewarm prevents duplicate hydrate-range reads on open", async () => {
        const { view, app } = createViewWithFile("notes/prewarm-no-dup.md");
        const files = Array.from({ length: 13 }, (_, index) => {
          const file = createMarkdownFile(`notes/prewarm-${index + 1}.md`);
          (file as unknown as { stat: { ctime: number; mtime: number } }).stat = {
            ctime: index + 1,
            mtime: index + 1,
          };
          return file;
        });
        const notesFolder = attachChildren(createFolder("notes"), files);
        const fileByPath = new Map(files.map((file) => [file.path, file] as const));

        app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
          if (requestedPath === "notes") {
            return notesFolder;
          }
          return fileByPath.get(requestedPath) ?? null;
        });
        app.vault.cachedRead = vi.fn(async (file: { basename: string }) => `# ${file.basename}\nBody`);

        await (view as any).onOpen();
        await (view as any).handleFolderSelection({
          requestId: 7,
          folderPath: "notes",
          source: "programmatic",
          requestedAtMs: Date.now(),
          forceRefresh: false,
        });

        expect(app.vault.cachedRead).toHaveBeenCalledTimes(12);

        const hydrateRangeHandler = mockState.panelEventHandlers["hydrate-range"];
        expect(hydrateRangeHandler).toBeDefined();

        hydrateRangeHandler({ detail: { start: 0, end: 12 } });
        await flushAsyncWork(2);

        expect(app.vault.cachedRead).toHaveBeenCalledTimes(12);
      });

      it("drops stale startup prewarm results after generation changes", async () => {
        const { view, app } = createViewWithFile("notes/stale-startup-prewarm.md");
        const file = createMarkdownFile("notes/stale-startup-prewarm.md");
        (file as unknown as { stat: { ctime: number; mtime: number } }).stat = {
          ctime: 1,
          mtime: 1,
        };
        const notesFolder = attachChildren(createFolder("notes"), [file]);
        const staleRead = createDeferred<string>();

        app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
          if (requestedPath === "notes") {
            return notesFolder;
          }
          return requestedPath === file.path ? file : null;
        });
        app.vault.cachedRead = vi.fn(() => staleRead.promise);

        const loadPromise = (view as any).loadFolder(
          "notes",
          {
            folderPath: "notes",
            includeSubfolders: true,
            sortField: "mtime",
            sortDirection: "desc",
          },
          "notes|true|mtime|desc",
        );

        await flushAsyncWork(1);

        expect((view as any).pendingHydration.has(file.path)).toBe(true);

        (view as any).generation += 1;
        (view as any).pendingHydration.clear();

        staleRead.resolve("# stale\ncontent");
        await loadPromise;

        const card = (view as any).baseCards[0];
        expect(card?.hydrated).toBe(false);
        expect(card?.previewHtml).toBe("");
        expect(card?.previewMode).toBe("empty");
        expect((view as any).pendingHydration.size).toBe(0);
      });

      it("hydrateRange pushes state once after finishing a multi-batch visible range", async () => {
        const { view, app } = createViewWithFile("notes/range-single-push.md");
        const files = Array.from({ length: 12 }, (_, index) => {
          const file = createMarkdownFile(`notes/range-${index + 1}.md`);
          (file as unknown as { stat: { ctime: number; mtime: number } }).stat = {
            ctime: index + 1,
            mtime: index + 1,
          };
          return file;
        });
        const notesFolder = attachChildren(createFolder("notes"), files);
        const fileByPath = new Map(files.map((file) => [file.path, file] as const));

        app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
          if (requestedPath === "notes") {
            return notesFolder;
          }
          return fileByPath.get(requestedPath) ?? null;
        });
        app.vault.cachedRead = vi.fn(async (file: { basename: string }) => `# ${file.basename}\nBody`);

        await (view as any).handleFolderSelection({
          requestId: 8,
          folderPath: "notes",
          source: "programmatic",
          requestedAtMs: Date.now(),
          forceRefresh: false,
        });

        vi.mocked(app.vault.cachedRead).mockClear();
        for (const card of (view as any).baseCards) {
          card.hydrated = false;
          card.previewHtml = "";
          card.previewMode = "empty";
        }
        (view as any).pendingHydration.clear();

        const pushStateSpy = vi.spyOn(view as any, "pushState");
        pushStateSpy.mockClear();

        await (view as any).hydrateRange(0, 12);

        expect(app.vault.cachedRead).toHaveBeenCalledTimes(12);
        expect(pushStateSpy).toHaveBeenCalledTimes(1);
        expect((view as any).baseCards.every((card: { hydrated: boolean }) => card.hydrated)).toBe(true);
      });


      it("onClose unmounts the panel instance and clears registered handlers", async () => {
        const { view } = createViewWithFile("notes/close-cleanup.md");

        (view as any).queuedRequest = { requestId: 1 };
        (view as any).refreshQueued = true;
        (view as any).pendingHydration = new Set(["notes/close-cleanup.md"]);
        (view as any).inFlight = Promise.resolve();
        (view as any).inFlightKey = "notes/close-cleanup.md";
        (view as any).loading = true;
        const generationBeforeClose = (view as any).generation;

        await (view as any).onOpen();

        const mountedComponent = (view as any).component;

        await (view as any).onClose();

        expect(mockState.svelteUnmountMock).toHaveBeenCalledTimes(1);
        expect(mockState.svelteUnmountMock).toHaveBeenCalledWith(mountedComponent);
        expect((view as any).component).toBeNull();
        expect((view as any).hostEl).toBeNull();
        expect((view as any).queuedRequest).toBeNull();
        expect((view as any).refreshQueued).toBe(false);
        expect((view as any).pendingHydration.size).toBe(0);
        expect((view as any).inFlight).toBeNull();
        expect((view as any).inFlightKey).toBeNull();
        expect((view as any).loading).toBe(false);
        expect((view as any).generation).toBe(generationBeforeClose + 1);
      });

      describe("Task 6: preview settings refresh wiring and generation safety", () => {
        it("hydrates with updated previewLines after settings-change refresh", async () => {
          const { view, app, plugin } = createViewWithFile("notes/preview-refresh.md");
          const file = createMarkdownFile("notes/preview-refresh.md");
          (file as unknown as { stat: { ctime: number; mtime: number } }).stat = {
            ctime: 1,
            mtime: 1,
          };
          const notesFolder = attachChildren(createFolder("notes"), [file]);
          let previewLines = 3;
          const previewSpy = vi.spyOn(markdownUtils, "buildLightPreview");

          plugin.getSettings = vi.fn(() => ({
            includeSubfolders: true,
            sort: { field: "mtime", direction: "desc" },
            filter: { tags: [] },
            defaultView: "cards",
            lastFolderPath: null,
            lastViewMode: "folder",
            pinnedPaths: [],
            previewLines,
          }));

          app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
            if (requestedPath === "notes") {
              return notesFolder;
            }
            if (requestedPath === file.path) {
              return file;
            }
            return null;
          });
          app.vault.cachedRead = vi.fn(async () => "line1\nline2\nline3\nline4");

          await (view as any).handleFolderSelection({
            requestId: 1,
            folderPath: "notes",
            source: "programmatic",
            requestedAtMs: Date.now(),
            forceRefresh: false,
          });
          await (view as any).hydrateRange(0, 1);

          expect(previewSpy).toHaveBeenLastCalledWith(
            "line1\nline2\nline3\nline4",
            expect.any(Number),
            3,
          );

          previewLines = 9;

          await (view as any).refresh({
            reason: "settings-change",
            folderPath: "notes",
            forceRefresh: true,
          });
          await (view as any).hydrateRange(0, 1);

          expect(previewSpy).toHaveBeenLastCalledWith(
            "line1\nline2\nline3\nline4",
            expect.any(Number),
            9,
          );
        });

        it("ignores stale hydration errors after previewLines change bumps generation", async () => {
          const { view, app, plugin } = createViewWithFile("notes/stale-refresh.md");
          const files = Array.from({ length: 13 }, (_, index) => {
            const file = createMarkdownFile(`notes/stale-refresh-${index + 1}.md`);
            (file as unknown as { stat: { ctime: number; mtime: number } }).stat = {
              ctime: index + 1,
              mtime: index + 1,
            };
            return file;
          });
          const staleFile = files[0];
          const notesFolder = attachChildren(createFolder("notes"), files);
          const firstReadError = new Error("stale read failed");
          const staleRead = createDeferred<string>();
          let previewLines = 4;
          const previewSpy = vi.spyOn(markdownUtils, "buildLightPreview");

          plugin.getSettings = vi.fn(() => ({
            includeSubfolders: true,
            sort: { field: "mtime", direction: "desc" },
            filter: { tags: [] },
            defaultView: "cards",
            lastFolderPath: null,
            lastViewMode: "folder",
            pinnedPaths: [],
            previewLines,
          }));

          const fileByPath = new Map(files.map((file) => [file.path, file] as const));
          app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
            if (requestedPath === "notes") {
              return notesFolder;
            }
            return fileByPath.get(requestedPath) ?? null;
          });

          app.vault.cachedRead = vi.fn((file: { path: string }) => {
            if (file.path === staleFile?.path) {
              return staleRead.promise;
            }
            return Promise.resolve("fresh\npreview\ncontent");
          });

          await (view as any).handleFolderSelection({
            requestId: 2,
            folderPath: "notes",
            source: "programmatic",
            requestedAtMs: Date.now(),
            forceRefresh: false,
          });

          vi.mocked(app.vault.cachedRead).mockClear();
          previewSpy.mockClear();

          const staleHydration = (view as any).hydrateRange(12, 13);
          await flushAsyncWork(1);

          previewLines = 8;
          (view as any).generation += 1;
          (view as any).pendingHydration.clear();
          staleRead.reject(firstReadError);
          await staleHydration;
          vi.mocked(app.vault.cachedRead).mockImplementation(async () => "fresh\npreview\ncontent");


          const staleCard = (view as any).baseCards.find((card: { path: string }) => card.path === staleFile?.path);
          expect(staleCard?.hydrated).toBe(false);
          expect(staleCard?.previewHtml).toBe("");
          expect(staleCard?.previewMode).toBe("empty");

          await (view as any).hydrateRange(12, 13);

          expect(previewSpy).toHaveBeenCalledTimes(1);
          expect(previewSpy).toHaveBeenLastCalledWith(
            "fresh\npreview\ncontent",
            expect.any(Number),
            8,
          );
          expect((view as any).baseCards[0]?.hydrated).toBe(true);
        });

        it("settings-change previewLines refresh keeps sort/filter/includeSubfolders panel props stable", async () => {
          const { view, app, plugin } = createViewWithFile("notes/preview-props.md");
          const file = createMarkdownFile("notes/preview-props.md");
          (file as unknown as { stat: { ctime: number; mtime: number } }).stat = {
            ctime: 2,
            mtime: 2,
          };
          const notesFolder = attachChildren(createFolder("notes"), [file]);
          const pinnedPaths = [file.path];
          let previewLines = 4;
          const previewSpy = vi.spyOn(markdownUtils, "buildLightPreview");

          plugin.getSettings = vi.fn(() => ({
            includeSubfolders: false,
            sort: { field: "ctime", direction: "asc" },
            filter: { tags: [] },
            defaultView: "cards",
            lastFolderPath: null,
            lastViewMode: "folder",
            pinnedPaths,
            previewLines,
          }));

          app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
            if (requestedPath === "notes") {
              return notesFolder;
            }
            if (requestedPath === file.path) {
              return file;
            }
            return null;
          });
          app.vault.cachedRead = vi.fn(async () => "only\none\ntwo\nthree");

          await (view as any).onOpen();
          await (view as any).handleFolderSelection({
            requestId: 3,
            folderPath: "notes",
            source: "programmatic",
            requestedAtMs: Date.now(),
            forceRefresh: false,
          });
          await (view as any).hydrateRange(0, 1);

          expect(previewSpy).toHaveBeenLastCalledWith(
            "only\none\ntwo\nthree",
            expect.any(Number),
            4,
          );
          expect(mockState.panelInstances).toHaveLength(1);
          expect(mockState.panelInstances[0]?.modelSnapshots.at(-1)).toMatchObject({
            sortField: "ctime",
            sortDirection: "asc",
            activeFilterTags: [],
            pinnedPaths,
            includeSubfolders: false,
            previewLines: 4,
          });

          previewLines = 10;
          await (view as any).refresh({
            reason: "settings-change",
            folderPath: "notes",
            forceRefresh: true,
          });
          await (view as any).hydrateRange(0, 1);

          expect(previewSpy).toHaveBeenLastCalledWith(
            "only\none\ntwo\nthree",
            expect.any(Number),
            10,
          );
          expect(mockState.panelInstances[0]?.modelSnapshots.at(-1)).toMatchObject({
            sortField: "ctime",
            sortDirection: "asc",
            activeFilterTags: [],
            pinnedPaths,
            includeSubfolders: false,
            previewLines: 10,
          });
        });

        it("hydrateRange keeps sparse content non-empty while empty markdown remains empty", async () => {
          const { view, app } = createViewWithFile("notes/preview-sparse-empty.md");
          const emptyFile = createMarkdownFile("notes/empty.md");
          const sparseFile = createMarkdownFile("notes/sparse.md");
          (emptyFile as unknown as { stat: { ctime: number; mtime: number } }).stat = {
            ctime: 3,
            mtime: 3,
          };
          (sparseFile as unknown as { stat: { ctime: number; mtime: number } }).stat = {
            ctime: 4,
            mtime: 4,
          };
          const notesFolder = attachChildren(createFolder("notes"), [emptyFile, sparseFile]);

          app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
            if (requestedPath === "notes") {
              return notesFolder;
            }
            if (requestedPath === emptyFile.path) {
              return emptyFile;
            }
            if (requestedPath === sparseFile.path) {
              return sparseFile;
            }
            return null;
          });

          app.vault.cachedRead = vi.fn(async (file: { path: string }) => {
            if (file.path === emptyFile.path) {
              return "\n  \n\t";
            }
            if (file.path === sparseFile.path) {
              return "single real preview line";
            }
            return "";
          });

          await (view as any).handleFolderSelection({
            requestId: 4,
            folderPath: "notes",
            source: "programmatic",
            requestedAtMs: Date.now(),
            forceRefresh: false,
          });
          await (view as any).hydrateRange(0, 2);

          const emptyCard = (view as any).baseCards.find((card: { path: string }) => card.path === emptyFile.path);
          const sparseCard = (view as any).baseCards.find((card: { path: string }) => card.path === sparseFile.path);

          expect(emptyCard?.hydrated).toBe(true);
          expect(emptyCard?.previewMode).toBe("empty");
          expect(emptyCard?.previewHtml).toBe("");

          expect(sparseCard?.hydrated).toBe(true);
          expect(sparseCard?.previewMode).not.toBe("empty");
          expect(sparseCard?.previewHtml).not.toBe("");
        });

        it("hydrateRange keeps code previews in the normalized paragraph clamp surface", async () => {
          const { view, app } = createViewWithFile("notes/preview-code-clamp.md");
          const codeFile = createMarkdownFile("notes/code.md");
          (codeFile as unknown as { stat: { ctime: number; mtime: number } }).stat = {
            ctime: 5,
            mtime: 5,
          };
          const notesFolder = attachChildren(createFolder("notes"), [codeFile]);

          app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
            if (requestedPath === "notes") {
              return notesFolder;
            }
            if (requestedPath === codeFile.path) {
              return codeFile;
            }
            return null;
          });

          app.vault.cachedRead = vi.fn(async () => "```ts\nconst alpha = 1;\nconst beta = 2;\nconst gamma = 3;\n```");

          await (view as any).handleFolderSelection({
            requestId: 5,
            folderPath: "notes",
            source: "programmatic",
            requestedAtMs: Date.now(),
            forceRefresh: false,
          });
          await (view as any).hydrateRange(0, 1);

          const codeCard = (view as any).baseCards.find((card: { path: string }) => card.path === codeFile.path);

          expect(codeCard?.hydrated).toBe(true);
          expect(codeCard?.previewMode).toBe("code");
          expect(codeCard?.previewHtml).toContain('<p class="fce-preview-code">');
          expect(codeCard?.previewHtml).not.toContain("<pre");
        });
      });
    });

    it("openCardContextMenu shows the shared menu with destination items for contextmenu trigger", () => {
      const { view, file } = createViewWithFile();
      const mouseEvent = { clientX: 12, clientY: 24 } as MouseEvent;

      (view as any).openCardContextMenu({
        notePath: file.path,
        trigger: "contextmenu",
        mouseEvent,
      });

      expect(mockState.menuInstances).toHaveLength(1);
      const [menu] = mockState.menuInstances;
      expect(getMenuStructure(menu!)).toEqual([
        "Open in current window",
        "Open in new tab",
        "Open to the right",
        "Open in new window",
        "separator",
        "Make a copy",
        "Move file to...",
        "Copy note content",
        "separator",
        "Rename...",
        "Delete",
      ]);
      expect(menu?.showAtMouseEvent).toHaveBeenCalledTimes(1);
      expect(menu?.showAtMouseEvent).toHaveBeenCalledWith(mouseEvent);
      expect(menu?.showAtPosition).not.toHaveBeenCalled();
      expect(menu?.dom.classList.add).toHaveBeenCalledWith("fce-card-context-menu");
    });

  it("desktop markdown cards render the reduced card menu contract exactly", () => {
    const { view, file } = createViewWithFile("notes/desktop-markdown-parity.md", {
      isDesktopApp: true,
      fullPath: "/vault/notes/desktop-markdown-parity.md",
    });

    (view as any).openCardContextMenu({
      notePath: file.path,
      trigger: "contextmenu",
      mouseEvent: { clientX: 16, clientY: 24 },
    });

    expect(mockState.menuInstances).toHaveLength(1);
    const [menu] = mockState.menuInstances;
    expect(menu).toBeDefined();

      expect(getTopLevelMenuSignature(menu!)).toEqual([
        { kind: "item", title: "Open in current window", icon: "folder-open" },
        { kind: "item", title: "Open in new tab", icon: "file-plus" },
        { kind: "item", title: "Open to the right", icon: "separator-vertical" },
        { kind: "item", title: "Open in new window", icon: "picture-in-picture-2" },
      { kind: "separator" },
      { kind: "item", title: "Make a copy", icon: "copy" },
      { kind: "item", title: "Move file to...", icon: "folder-input" },
      { kind: "item", title: "Copy note content", icon: "documents" },
      { kind: "separator" },
      { kind: "item", title: "Rename...", icon: "pencil" },
      { kind: "item", title: "Delete", icon: "trash" },
    ]);
  });

  it("openCardContextMenu shows the shared menu at explicit coordinates for button trigger", () => {
    const { view, file } = createViewWithFile();
    const position = { x: 40, y: 88 };

    (view as any).openCardContextMenu({
      notePath: file.path,
      trigger: "button",
      position,
    });

    expect(mockState.menuInstances).toHaveLength(1);
    const [menu] = mockState.menuInstances;
    expect(menu?.showAtPosition).toHaveBeenCalledTimes(1);
    expect(menu?.showAtPosition).toHaveBeenCalledWith(position);
    expect(menu?.showAtMouseEvent).not.toHaveBeenCalled();
    expect(menu?.dom.classList.add).toHaveBeenCalledWith("fce-card-context-menu");
  });

  it("openCardContextMenu aborts and does not render menu on invalid inputs", () => {
    const { view } = createViewWithFile();

    (view as any).openCardContextMenu({
      notePath: 123,
      trigger: "contextmenu",
      mouseEvent: { clientX: 12, clientY: 24 },
    });
    (view as any).openCardContextMenu({ notePath: "path.md", trigger: "contextmenu", mouseEvent: null });
    (view as any).openCardContextMenu({
      notePath: "path.md",
      trigger: "contextmenu",
      mouseEvent: { clientX: 12 },
    });
    (view as any).openCardContextMenu({ notePath: "path.md", trigger: "button", position: null });
    (view as any).openCardContextMenu({
      notePath: "path.md",
      trigger: "button",
      position: { x: 12 },
    });

    expect(mockState.menuInstances).toHaveLength(0);
  });

  it("routeCardMenuAction opens note for destination actions and preserves remaining file-mutation routes", async () => {
    const { view, file, plugin } = createViewWithFile("notes/context-route.md");
    const makeCopySpy = vi.spyOn(view as any, "makeCardFileCopy").mockResolvedValue(undefined);
    const moveSpy = vi.spyOn(view as any, "moveCardNote");
    const renameSpy = vi.spyOn(view as any, "renameCardFile").mockImplementation(() => undefined);
    const deleteSpy = vi.spyOn(view as any, "deleteCardFile").mockResolvedValue(undefined);
    const copySpy = vi.spyOn(view as any, "copyCardNote").mockResolvedValue(undefined);

    await (view as any).routeCardMenuAction("current-area", file.path);
    await (view as any).routeCardMenuAction("new-tab", file.path);
    await (view as any).routeCardMenuAction("split-right", file.path);
    await (view as any).routeCardMenuAction("new-window", file.path);
    await (view as any).routeCardMenuAction("make-copy", file.path);
    await (view as any).routeCardMenuAction("move", file.path);
    await (view as any).routeCardMenuAction("rename", file.path);
    await (view as unknown as { routeCardMenuAction: (action: "delete", notePath: string) => Promise<void> })
      .routeCardMenuAction("delete", file.path);
    await (view as any).routeCardMenuAction("copy-note-content", file.path);

    expect(plugin.openNoteFromCard).toHaveBeenNthCalledWith(1, file.path, "current-area");
    expect(plugin.openNoteFromCard).toHaveBeenNthCalledWith(2, file.path, "new-tab");
    expect(plugin.openNoteFromCard).toHaveBeenNthCalledWith(3, file.path, "split-right");
    expect(plugin.openNoteFromCard).toHaveBeenNthCalledWith(4, file.path, "new-window");
    expect(plugin.openNoteFromCard).toHaveBeenCalledTimes(4);
    expect(makeCopySpy).toHaveBeenCalledTimes(1);
    expect(makeCopySpy).toHaveBeenCalledWith(file.path);
    expect(moveSpy).toHaveBeenCalledTimes(1);
    expect(moveSpy).toHaveBeenCalledWith(file.path);
    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(renameSpy).toHaveBeenCalledWith(file.path);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(file.path);
    expect(copySpy).toHaveBeenCalledTimes(1);
    expect(copySpy).toHaveBeenCalledWith(file.path);
  });


  it("conditional menu variants keep separators clean after removing optional actions", () => {
    const { view: desktopNonMarkdownView, file: desktopNonMarkdownFile } = createViewWithFile(
      "notes/non-markdown.canvas",
      {
        isDesktopApp: true,
        fullPath: "/vault/notes/non-markdown.canvas",
      },
    );
    const desktopNonMarkdownCard = createCardRecord(desktopNonMarkdownFile, "canvas");
    (desktopNonMarkdownView as any).baseCards = [desktopNonMarkdownCard];
    (desktopNonMarkdownView as any).visibleCards = [desktopNonMarkdownCard];

    (desktopNonMarkdownView as any).openCardContextMenu({
      notePath: desktopNonMarkdownFile.path,
      trigger: "contextmenu",
      mouseEvent: { clientX: 2, clientY: 2 },
    });

    expect(mockState.menuInstances).toHaveLength(1);
    const [desktopNonMarkdownMenu] = mockState.menuInstances;
    expect(getTopLevelMenuSignature(desktopNonMarkdownMenu!)).toEqual([
      { kind: "item", title: "Open in current window", icon: "folder-open" },
      { kind: "item", title: "Open in new tab", icon: "file-plus" },
      { kind: "item", title: "Open to the right", icon: "separator-vertical" },
      { kind: "item", title: "Open in new window", icon: "picture-in-picture-2" },
      { kind: "separator" },
      { kind: "item", title: "Make a copy", icon: "copy" },
      { kind: "item", title: "Move file to...", icon: "folder-input" },
      { kind: "separator" },
      { kind: "item", title: "Rename...", icon: "pencil" },
      { kind: "item", title: "Delete", icon: "trash" },
    ]);

    mockState.menuInstances.length = 0;

    const { view: nonDesktopMarkdownView, file: nonDesktopMarkdownFile } = createViewWithFile("notes/non-desktop.md", {
      isDesktopApp: false,
      fullPath: null,
    });

    (nonDesktopMarkdownView as any).openCardContextMenu({
      notePath: nonDesktopMarkdownFile.path,
      trigger: "button",
      position: { x: 12, y: 18 },
    });

    expect(mockState.menuInstances).toHaveLength(1);
    const [nonDesktopMarkdownMenu] = mockState.menuInstances;
    expect(getTopLevelMenuSignature(nonDesktopMarkdownMenu!)).toEqual([
      { kind: "item", title: "Open in current window", icon: "folder-open" },
      { kind: "item", title: "Open in new tab", icon: "file-plus" },
      { kind: "item", title: "Open to the right", icon: "separator-vertical" },
      { kind: "item", title: "Open in new window", icon: "picture-in-picture-2" },
      { kind: "separator" },
      { kind: "item", title: "Make a copy", icon: "copy" },
      { kind: "item", title: "Move file to...", icon: "folder-input" },
      { kind: "item", title: "Copy note content", icon: "documents" },
      { kind: "separator" },
      { kind: "item", title: "Rename...", icon: "pencil" },
      { kind: "item", title: "Delete", icon: "trash" },
    ]);
    expect(nonDesktopMarkdownMenu?.showAtPosition).toHaveBeenCalledWith({ x: 12, y: 18 });
    expect(nonDesktopMarkdownMenu?.showAtMouseEvent).not.toHaveBeenCalled();
    expect(nonDesktopMarkdownMenu?.dom.classList.add).toHaveBeenCalledWith("fce-card-context-menu");
  });

  it("menu destination clicks call plugin.openNoteFromCard with bound this", () => {
    const { view, file, plugin } = createViewWithFile("notes/runtime-binding.md");
    const receiverCalls: Array<{ receiver: unknown; path: string; destination: string }> = [];

    plugin.openNoteFromCard = function(this: unknown, path: string, destination: string): void {
      receiverCalls.push({ receiver: this, path, destination });
    } as unknown as typeof plugin.openNoteFromCard;

    (view as any).openCardContextMenu({
      notePath: file.path,
      trigger: "button",
      position: { x: 32, y: 64 },
    });

    const [menu] = mockState.menuInstances;
    expect(menu).toBeDefined();

    const destinationTitles = [
      "Open in current window",
      "Open in new tab",
      "Open to the right",
      "Open in new window",
    ];

    for (const title of destinationTitles) {
      const menuItem = menu?.items.find((item) => item.title === title);
      expect(menuItem?.clickHandler).toBeTypeOf("function");
      menuItem?.clickHandler?.();
    }

    expect(receiverCalls).toEqual([
      { receiver: plugin, path: file.path, destination: "current-area" },
      { receiver: plugin, path: file.path, destination: "new-tab" },
      { receiver: plugin, path: file.path, destination: "split-right" },
      { receiver: plugin, path: file.path, destination: "new-window" },
    ]);
  });


  it("copyCardNote delegates to copyNoteToClipboard exactly once", async () => {
    const { view, file, app } = createViewWithFile("notes/copy-target.md");

    await (view as any).copyCardNote(file.path);

    expect(copyNoteToClipboard).toHaveBeenCalledTimes(1);
    expect(copyNoteToClipboard).toHaveBeenCalledWith(app, file, getUiStrings("en").noteOps);
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
    expect(moveFile).toHaveBeenCalledWith(app, file, destination, getUiStrings("en").noteOps);
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
    expect(mockState.noticeMessages).toEqual(["Failed to move file: permission denied"]);
  });

  it("make-copy and rename routes re-resolve the clicked file and call the expected helpers exactly once", async () => {
    const { view, app } = createViewWithFile("notes/original.md");
    const liveFile = createMarkdownFile("notes/original.md");
    app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
      if (requestedPath === "notes/original.md") {
        return liveFile;
      }
      return null;
    });

    await (view as any).routeCardMenuAction("make-copy", "notes/original.md");

    expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith("notes/original.md");
    expect(duplicateFile).toHaveBeenCalledTimes(1);
    expect(duplicateFile).toHaveBeenCalledWith(app, liveFile);

    await (view as any).routeCardMenuAction("rename", "notes/original.md");

    const renameModal = mockState.modalInstances.at(-1);
    expect(renameModal?.title).toBe("Rename file");
    expect(renameModal?.textInputs[0]?.value).toBe("original.md");

    setLatestModalTextInput(0, "renamed.md");
    clickLatestModalButton("Rename");
    await flushAsyncWork();

    expect(app.vault.getAbstractFileByPath).toHaveBeenLastCalledWith("notes/original.md");
    expect(app.fileManager.renameFile).toHaveBeenCalledTimes(1);
    expect(app.fileManager.renameFile).toHaveBeenCalledWith(liveFile, "notes/renamed.md");
  });

  it("delete prompts before using the preference-aware delete helper and move failures use file-neutral notices", async () => {
    const { view, file, app } = createViewWithFile("notes/delete-me.md", {
      promptForDeletion: async () => false,
    });

    await (view as unknown as { routeCardMenuAction: (action: "delete", notePath: string) => Promise<void> })
      .routeCardMenuAction("delete", file.path);
    expect(app.fileManager.promptForDeletion).toHaveBeenCalledTimes(1);
    expect(app.fileManager.promptForDeletion).toHaveBeenCalledWith(file);
    expect(deleteFileUsingObsidianPreference).not.toHaveBeenCalled();
    expect(app.fileManager.trashFile).not.toHaveBeenCalled();

    app.fileManager.promptForDeletion = vi.fn(async () => true);
    await (view as any).routeCardMenuAction("delete", file.path);
    expect(app.fileManager.promptForDeletion).toHaveBeenCalledTimes(1);
    expect(deleteFileUsingObsidianPreference).toHaveBeenCalledTimes(1);
    expect(deleteFileUsingObsidianPreference).toHaveBeenCalledWith(app, file);
    expect(app.fileManager.trashFile).not.toHaveBeenCalled();

    const destination = createFolder("archive");
    vi.mocked(moveFile).mockResolvedValueOnce({
      ok: false,
      error: "permission denied",
      path: file.path,
    });

    (view as any).moveCardNote(file.path);
    const picker = mockState.folderPickerInstances.at(-1);
    await picker?.onChoose(destination);

    expect(mockState.noticeMessages).toContain("Failed to move file: permission denied");
  });

  it("delete skips the trash helper when the prompt already removed the file", async () => {
    const { view, file, app } = createViewWithFile("notes/already-removed.md");
    app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
      if (requestedPath !== file.path) {
        return null;
      }

      if (vi.mocked(app.fileManager.promptForDeletion).mock.calls.length > 0) {
        return null;
      }

      return file;
    });

    await (view as any).routeCardMenuAction("delete", file.path);

    expect(app.fileManager.promptForDeletion).toHaveBeenCalledTimes(1);
    expect(app.fileManager.promptForDeletion).toHaveBeenCalledWith(file);
    expect(app.vault.getAbstractFileByPath).toHaveBeenCalledTimes(2);
    expect(deleteFileUsingObsidianPreference).not.toHaveBeenCalled();
    expect(app.fileManager.trashFile).not.toHaveBeenCalled();
    expect(mockState.noticeMessages).toEqual([]);
  });

  it("delete uses the post-prompt live file when it remains available", async () => {
    const { view, file, app } = createViewWithFile("notes/live-after-prompt.md");
    const liveFile = createMarkdownFile("notes/live-after-prompt.md");
    app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
      if (requestedPath !== file.path) {
        return null;
      }

      if (vi.mocked(app.fileManager.promptForDeletion).mock.calls.length > 0) {
        return liveFile;
      }

      return file;
    });

    await (view as unknown as { routeCardMenuAction: (action: "delete", notePath: string) => Promise<void> })
      .routeCardMenuAction("delete", file.path);

    expect(app.fileManager.promptForDeletion).toHaveBeenCalledTimes(1);
    expect(app.fileManager.promptForDeletion).toHaveBeenCalledWith(file);
    expect(deleteFileUsingObsidianPreference).toHaveBeenCalledTimes(1);
    expect(deleteFileUsingObsidianPreference).toHaveBeenCalledWith(app, liveFile);
  });

  describe("batch move workflow", () => {
    it("resolves selected paths to live files in selection order before batch execution", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const third = createMarkdownFile("notes/third.md");
      const destination = createFolder("archive");

      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === third.path) {
          return third;
        }
        return null;
      });

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set([
        second.path,
        "notes/missing.md",
        first.path,
        third.path,
      ]);
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(third.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(third.path),
      ];
      (view as any).deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(third.path),
      ]);

      vi.mocked(batchMoveFiles).mockResolvedValueOnce({
        succeeded: [
          { ok: true, file: second as unknown as any },
          { ok: true, file: first as unknown as any },
          { ok: true, file: third as unknown as any },
        ],
        failed: [],
      } as any);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-move-selected" } });

      const picker = mockState.folderPickerInstances.at(-1);
      await picker?.onChoose(destination);

      expect(batchMoveFiles).toHaveBeenCalledTimes(1);
      expect(batchMoveFiles).toHaveBeenCalledWith(
        app,
        [second, first, third] as unknown as any,
        destination,
        getUiStrings("en").noteOps,
      );
    });

    it("bulk move workflow reconciles selection after execution", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const successA = createMarkdownFile("notes/success-a.md");
      const failedB = createMarkdownFile("notes/failed-b.md");
      const successC = createMarkdownFile("notes/success-c.md");
      const destination = createFolder("archive");

      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === successA.path) {
          return successA;
        }
        if (requestedPath === failedB.path) {
          return failedB;
        }
        if (requestedPath === successC.path) {
          return successC;
        }
        return null;
      });

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set([
        successA.path,
        "notes/stale.md",
        failedB.path,
        successC.path,
      ]);
      (view as any).bulkAnchorPath = successA.path;
      (view as any).baseCards = [
        createCardRecordFromPath(successA.path),
        createCardRecordFromPath(failedB.path),
        createCardRecordFromPath(successC.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(successA.path),
        createCardRecordFromPath(failedB.path),
        createCardRecordFromPath(successC.path),
      ];
      (view as any).deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(successA.path),
        createCardRecordFromPath(failedB.path),
        createCardRecordFromPath(successC.path),
      ]);

      vi.mocked(batchMoveFiles).mockResolvedValueOnce({
        succeeded: [
          { ok: true, file: successA as unknown as any },
          { ok: true, file: successC as unknown as any },
        ],
        failed: [{ ok: false, error: "permission denied", path: failedB.path }],
      } as any);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-move-selected" } });

      const picker = mockState.folderPickerInstances.at(-1);
      await picker?.onChoose(destination);

      expect(Array.from((view as any).selectedPaths)).toEqual([failedB.path]);
      expect((view as any).bulkAnchorPath).toBe(failedB.path);
      expect(mockState.noticeMessages).toEqual(["Moved 2 notes; 1 failed."]);
    });

    it("clears stale selections when bulk move resolves to zero live files", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const destination = createFolder("archive");

      app.vault.getAbstractFileByPath = vi.fn(() => null);

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set(["notes/stale-a.md", "notes/stale-b.md"]);
      (view as any).bulkAnchorPath = "notes/stale-a.md";
      (view as any).baseCards = [
        createCardRecordFromPath("notes/stale-a.md"),
        createCardRecordFromPath("notes/stale-b.md"),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath("notes/stale-a.md"),
        createCardRecordFromPath("notes/stale-b.md"),
      ];
      (view as any).deriveVisibleCards = vi.fn(() => []);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-move-selected" } });

      const picker = mockState.folderPickerInstances.at(-1);
      await picker?.onChoose(destination);

      expect(batchMoveFiles).not.toHaveBeenCalled();
      expect((view as any).selectedPaths.size).toBe(0);
      expect((view as any).bulkAnchorPath).toBeNull();
      expect(mockState.noticeMessages).toEqual(["No selected notes are available to move."]);
    });

    it("clears stale selections when bulk move resolves to already-target live files", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const alreadyFirst = createMarkdownFile("archive/already-first.md");
      const alreadySecond = createMarkdownFile("archive/already-second.md");
      const destination = createFolder("archive");

      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === alreadyFirst.path) {
          return alreadyFirst;
        }
        if (requestedPath === alreadySecond.path) {
          return alreadySecond;
        }
        return null;
      });

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set([
        "notes/stale-before.md",
        alreadySecond.path,
        "notes/stale-middle.md",
        alreadyFirst.path,
      ]);
      (view as any).bulkAnchorPath = "notes/stale-before.md";
      (view as any).baseCards = [
        createCardRecordFromPath(alreadyFirst.path),
        createCardRecordFromPath(alreadySecond.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(alreadySecond.path),
        createCardRecordFromPath(alreadyFirst.path),
      ];
      (view as any).deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(alreadySecond.path),
        createCardRecordFromPath(alreadyFirst.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-move-selected" } });

      const picker = mockState.folderPickerInstances.at(-1);
      await picker?.onChoose(destination);

      expect(batchMoveFiles).not.toHaveBeenCalled();
      expect(Array.from((view as any).selectedPaths)).toEqual([
        alreadySecond.path,
        alreadyFirst.path,
      ]);
      expect((view as any).bulkAnchorPath).toBe(alreadySecond.path);
      expect(mockState.noticeMessages).toEqual(["All selected notes are already in the target folder."]);
    });
  });

  describe("bulk delete workflows", () => {
    it("reconciles stale selection and no-ops when bulk delete has no live files at confirm time", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");

      app.vault.getAbstractFileByPath = vi.fn(() => null);

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set(["notes/stale-a.md", "notes/stale-b.md"]);
      (view as any).bulkAnchorPath = "notes/stale-a.md";
      (view as any).baseCards = [
        createCardRecordFromPath("notes/stale-a.md"),
        createCardRecordFromPath("notes/stale-b.md"),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath("notes/stale-a.md"),
        createCardRecordFromPath("notes/stale-b.md"),
      ];
      (view as any).deriveVisibleCards = vi.fn(() => []);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-delete-selected" } });
      await flushAsyncWork(1);

      expect(mockState.modalInstances).toHaveLength(0);
      expect(batchDeleteFilesUsingObsidianPreference).not.toHaveBeenCalled();
      expect(Array.from((view as any).selectedPaths)).toEqual([]);
      expect((view as any).bulkAnchorPath).toBeNull();
      expect(mockState.noticeMessages).toEqual(["No selected notes are available to delete."]);

    });
  });

  describe("bulk delete workflows require confirmation", () => {
    it("does not execute bulk delete helper when confirmation is denied", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");

      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        return null;
      });

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set([first.path, second.path]);
      (view as any).bulkAnchorPath = first.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-delete-selected" } });
      await flushAsyncWork(1);

      expect(batchDeleteFilesUsingObsidianPreference).not.toHaveBeenCalled();
      expect(mockState.modalInstances).toHaveLength(1);
      expect(mockState.modalInstances[0]?.title).toBe("Delete selected notes?");
      expect(mockState.modalInstances[0]?.messages).toEqual([
        "Delete 2 selected notes? Obsidian will use your Files & Links delete preference.",
      ]);

      clickLatestModalButton("Cancel");
      await flushAsyncWork();

      expect(batchDeleteFilesUsingObsidianPreference).not.toHaveBeenCalled();
      expect(Array.from((view as any).selectedPaths)).toEqual([first.path, second.path]);
      expect((view as any).bulkAnchorPath).toBe(first.path);
      expect(mockState.noticeMessages).toEqual([]);
    });
  });

  describe("merge workflow", () => {
    it("uses frozen visible-order selection, supports reorder, and keeps preview aligned with merge inputs", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const third = createMarkdownFile("notes/third.md");
      const notesFolder = createFolder("notes");
      const bodyByPath: Record<string, string> = {
        [first.path]: "First body",
        [second.path]: "Second body",
        [third.path]: "Third body",
      };

      app.vault.read = vi.fn(async (file: { path: string }) => {
        return bodyByPath[file.path] ?? "";
      });
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === third.path) {
          return third;
        }
        if (requestedPath === "notes") {
          return notesFolder;
        }
        return null;
      });

      vi.mocked(mergeNotes).mockResolvedValueOnce({
        ok: true,
        mergedFile: createMarkdownFile("notes/Merged notes.md") as unknown as any,
        sourceCount: 3,
      });

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set([third.path, first.path, second.path]);
      (view as any).bulkAnchorPath = third.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(third.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(third.path),
      ];
      (view as any).deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(third.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();

      expect(mockState.modalInstances).toHaveLength(1);
      expect(mockState.modalInstances[0]?.title).toBe("Merge selected notes");
      expect(mockState.modalInstances[0]?.renderOrder.indexOf("button:Cancel")).toBeLessThan(
        mockState.modalInstances[0]?.renderOrder.indexOf("h4:Preview") ?? -1,
      );
      expect(mockState.modalInstances[0]?.renderOrder.indexOf("button:Merge notes")).toBeLessThan(
        mockState.modalInstances[0]?.renderOrder.indexOf("h4:Preview") ?? -1,
      );

      clickLatestModalButton("Down", 0);
      await flushAsyncWork();

      expect(mockState.modalInstances[0]?.textInputs[1]?.value).toBe("");
      const defaultPreview = [
        "# second\n\nSecond body",
        "# first\n\nFirst body",
        "# third\n\nThird body",
      ].join("");
      expect(mockState.modalInstances.at(-1)?.renderedPreviewText).toBe(defaultPreview);

      setLatestModalTextInput(1, "\n\n***\n\n");
      await flushAsyncWork();

      const expectedPreview = [
        "# second\n\nSecond body",
        "# first\n\nFirst body",
        "# third\n\nThird body",
      ].join("\n\n***\n\n");

      expect(mockState.modalInstances.at(-1)?.renderedPreviewText).toBe(expectedPreview);
      expect(mergeNotes).not.toHaveBeenCalled();

      clickLatestModalButton("Merge notes");
      await flushAsyncWork();

      expect(mergeNotes).toHaveBeenCalledTimes(1);
      expect(mergeNotes).toHaveBeenCalledWith(
        app,
        [second, first, third],
        notesFolder,
        "Merged notes",
        "\n\n***\n\n",
        getUiStrings("en").noteOps,
      );
    });

    it("preserves modal scroll position across reorder and cleanup actions", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const third = createMarkdownFile("notes/third.md");
      const notesFolder = createFolder("notes");
      const bodyByPath: Record<string, string> = {
        [first.path]: "First body",
        [second.path]: "Second body",
        [third.path]: "Third body",
      };

      app.vault.read = vi.fn(async (file: { path: string }) => {
        return bodyByPath[file.path] ?? "";
      });
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === third.path) {
          return third;
        }
        if (requestedPath === "notes") {
          return notesFolder;
        }
        return null;
      });

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set([third.path, first.path, second.path]);
      (view as any).bulkAnchorPath = third.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(third.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(third.path),
      ];
      (view as any).deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(third.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();

      const modal = mockState.modalInstances.at(-1);
      expect(modal).toBeDefined();

      modal!.modalEl.scrollTop = 180;
      clickLatestModalButton("Keep source notes");
      expect(modal!.modalEl.scrollTop).toBe(180);

      modal!.modalEl.scrollTop = 240;
      clickLatestModalButton("Down", 0);
      expect(modal!.modalEl.scrollTop).toBe(240);
      await flushAsyncWork();
      expect(modal!.modalEl.scrollTop).toBe(240);
    });

    it("does not rerender bulk merge preview after the modal closes", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const notesFolder = createFolder("notes");
      const pendingRead = createDeferred<string>();

      app.vault.read = vi.fn(() => pendingRead.promise);
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === "notes") {
          return notesFolder;
        }
        return null;
      });

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set([first.path, second.path]);
      (view as any).bulkAnchorPath = first.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork(1);

      const modal = mockState.modalInstances.at(-1);
      expect(modal).toBeDefined();
      expect(app.vault.read).toHaveBeenCalledTimes(1);

      clickLatestModalButton("Cancel");
      expect(modal?.buttons).toEqual([]);
      expect(modal?.renderedPreviewText).toBe("");

      pendingRead.resolve("First body");
      await flushAsyncWork();

      expect(app.vault.read).toHaveBeenCalledTimes(1);
      expect(modal?.buttons).toEqual([]);
      expect(modal?.messages).toEqual([]);
      expect(modal?.renderedPreviewText).toBe("");
    });

    it("drops stale bulk merge preview refreshes when a newer refresh wins", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const notesFolder = createFolder("notes");
      const immediateBodies: Record<string, string> = {
        [first.path]: "First body",
        [second.path]: "Second body",
      };
      const pendingReads: Array<ReturnType<typeof createDeferred<string>>> = [];

      app.vault.read = vi.fn(async (file: { path: string }) => {
        return immediateBodies[file.path] ?? "";
      });
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === "notes") {
          return notesFolder;
        }
        return null;
      });

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set([first.path, second.path]);
      (view as any).bulkAnchorPath = first.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();

      app.vault.read = vi.fn(() => {
        const deferred = createDeferred<string>();
        pendingReads.push(deferred);
        return deferred.promise;
      });

      setLatestModalTextInput(1, "\n\n***\n\n");
      await flushAsyncWork(1);
      setLatestModalTextInput(1, "\n\n===\n\n");
      await flushAsyncWork(1);

      expect(pendingReads).toHaveLength(2);

      pendingReads[1]!.resolve("First body");
      await flushAsyncWork(1);
      expect(pendingReads).toHaveLength(3);

      pendingReads[2]!.resolve("Second body");
      await flushAsyncWork();

      expect(mockState.modalInstances.at(-1)?.renderedPreviewText).toBe([
        "# first\n\nFirst body",
        "# second\n\nSecond body",
      ].join("\n\n===\n\n"));

      pendingReads[0]!.resolve("First body");
      await flushAsyncWork();

      expect(app.vault.read).toHaveBeenCalledTimes(3);
      expect(mockState.modalInstances.at(-1)?.renderedPreviewText).toBe([
        "# first\n\nFirst body",
        "# second\n\nSecond body",
      ].join("\n\n===\n\n"));
    });

    it("does not rerender bulk merge modal after successful submit closes it", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const notesFolder = createFolder("notes");

      app.vault.read = vi.fn(async (file: { path: string }) => {
        return `${file.path} body`;
      });
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === "notes") {
          return notesFolder;
        }
        return null;
      });

      vi.mocked(mergeNotes).mockResolvedValueOnce({
        ok: true,
        mergedFile: createMarkdownFile("notes/Merged notes.md") as unknown as any,
        sourceCount: 2,
      });

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set([first.path, second.path]);
      (view as any).bulkAnchorPath = first.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();

      const modal = mockState.modalInstances.at(-1);
      expect(modal).toBeDefined();

      clickLatestModalButton("Merge notes");
      await flushAsyncWork();

      expect(mergeNotes).toHaveBeenCalledTimes(1);
      expect(modal?.buttons).toEqual([]);
      expect(modal?.messages).toEqual([]);
      expect(modal?.renderedPreviewText).toBe("");
    });

    it("runs post-merge trash only after merge success", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const notesFolder = createFolder("notes");

      app.vault.read = vi.fn(async (file: { path: string }) => {
        return `${file.path} body`;
      });
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === "notes") {
          return notesFolder;
        }
        return null;
      });

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set([first.path, second.path]);
      (view as any).bulkAnchorPath = first.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];

      vi.mocked(mergeNotes).mockReset();
      vi.mocked(mergeNotes).mockResolvedValue({ ok: false, error: "merge failed" } as any);
      vi.mocked(batchTrashFiles).mockClear();

      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();
      clickLatestModalButton("Trash source notes after merge");
      await flushAsyncWork(1);
      clickLatestModalButton("Merge notes");
      await flushAsyncWork();

      expect(mergeNotes).toHaveBeenCalledTimes(1);
      expect(batchTrashFiles).not.toHaveBeenCalled();
      expect(mockState.noticeMessages).toContain("Failed to merge notes: merge failed");
      expect(mockState.modalInstances.at(-1)?.title).toBe("Merge selected notes");
      expect(mockState.modalInstances.at(-1)?.buttons.some((button) => button.text === "Merge notes")).toBe(true);

      vi.mocked(mergeNotes).mockResolvedValueOnce({
        ok: true,
        mergedFile: createMarkdownFile("notes/Merged notes.md") as unknown as any,
        sourceCount: 2,
      });
      vi.mocked(batchTrashFiles).mockResolvedValueOnce({
        succeeded: [{ ok: true, file: first as unknown as any }],
        failed: [{ ok: false, error: "trash blocked", path: second.path }],
      });

      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();
      clickLatestModalButton("Trash source notes after merge");
      await flushAsyncWork(1);
      clickLatestModalButton("Merge notes");
      await flushAsyncWork();

      expect(batchTrashFiles).toHaveBeenCalledTimes(1);
      expect(batchTrashFiles).toHaveBeenCalledWith(app, [first, second]);
      expect(Array.from((view as any).selectedPaths)).toEqual([second.path]);
      expect((view as any).bulkAnchorPath).toBe(second.path);
    });
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
        fileKind: "markdown",
      });

      expect(result.shouldRefresh).toBe(false);
      expect(result.queueAction).toBe("ignored");
      expect(result.incrementalResult).toEqual({ handled: true, action: "removed" });
      expect((view as any).baseCards).toHaveLength(0);
      expect((view as any).refreshQueued).toBe(false);
    });

    it("rename updates card path when move stays visible in recursive root scope", () => {
      const { view, app, file } = createViewWithFile("notes/move-me.md");
      const movedFile = new mockState.MockTFile("archive/move-me.md");
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        return requestedPath === movedFile.path ? movedFile : null;
      });

      (view as any).folderPath = "";
      (view as any).baseCards = [createCardRecord(file)];

      const result = (view as any).handleVaultMutation({
        eventType: "rename",
        oldPath: "notes/move-me.md",
        path: "archive/move-me.md",
        isFolder: false,
        fileKind: "markdown",
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

  describe("Phase 2 regression hardening", () => {
    it("restores single-note open and context-menu behavior after exiting bulk mode", async () => {
      const { view, plugin, file } = createViewWithFile("notes/single-note-after-bulk.md");
      const mouseEvent = { clientX: 44, clientY: 99 };

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      const openNoteHandler = mockState.panelEventHandlers["open-note"];
      const contextMenuHandler = mockState.panelEventHandlers["card-context-menu"];

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set([file.path]);
      (view as any).bulkAnchorPath = file.path;

      openNoteHandler({ detail: { path: file.path } });
      expect(plugin.openNoteFromCard).not.toHaveBeenCalled();

      toolbarActionHandler({ detail: { action: "bulk" } });

      expect((view as any).bulkMode).toBe(false);
      expect((view as any).selectedPaths.size).toBe(0);
      expect((view as any).bulkAnchorPath).toBeNull();

      openNoteHandler({ detail: { path: file.path } });
      contextMenuHandler({
        detail: { path: file.path, trigger: "contextmenu", mouseEvent },
      });

      expect(plugin.openNoteFromCard).toHaveBeenCalledTimes(1);
      expect(plugin.openNoteFromCard).toHaveBeenCalledWith(file.path);
      expect(mockState.menuInstances).toHaveLength(1);
      expect(mockState.menuInstances[0]?.showAtMouseEvent).toHaveBeenCalledWith(mouseEvent);
    });

    it("keeps filter, pin, and include-subfolders toolbar actions functional after bulk mode toggles", async () => {
      const { view, plugin } = createViewWithFile("projects/active/phase2-toggle.md");

      (view as any).folderPath = "projects/active";

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      const filterChangeHandler = mockState.panelEventHandlers["filter-change"];
      const pinToggleHandler = mockState.panelEventHandlers["pin-toggle"];
      const includeSubfoldersHandler = mockState.panelEventHandlers["include-subfolders-change"];

      toolbarActionHandler({ detail: { action: "bulk" } });
      toolbarActionHandler({ detail: { action: "bulk" } });

      filterChangeHandler({ detail: { tags: ["#Work"] } });
      pinToggleHandler({ detail: { path: "projects/active/phase2-toggle.md", pinned: true } });
      includeSubfoldersHandler({ detail: { value: false } });
      await flushAsyncWork();

      expect(plugin.saveSettings).toHaveBeenNthCalledWith(1, {
        filter: {
          tags: ["work"],
        },
      });
      expect(plugin.saveSettings).toHaveBeenNthCalledWith(2, {
        pinnedPaths: ["projects/active/phase2-toggle.md"],
      });
      expect(plugin.saveSettings).toHaveBeenNthCalledWith(3, {
        includeSubfolders: false,
      });
    });

    it("treats zero-selection bulk actions as safe no-ops", async () => {
      const { view } = createViewWithFile("notes/zero-selection.md");

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set<string>();
      (view as any).bulkAnchorPath = null;

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-move-selected" } });
      toolbarActionHandler({ detail: { action: "bulk-delete-selected" } });
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();

      expect(mockState.folderPickerInstances).toHaveLength(0);
      expect(mockState.modalInstances).toHaveLength(0);
      expect(batchMoveFiles).not.toHaveBeenCalled();
      expect(batchTrashFiles).not.toHaveBeenCalled();
      expect(batchDeleteFilesUsingObsidianPreference).not.toHaveBeenCalled();
      expect(mergeNotes).not.toHaveBeenCalled();
      expect(mockState.noticeMessages).toEqual([]);
    });

    it("avoids pipeline and tag recomputation for bulk selection-only state updates", async () => {
      const { view } = createViewWithFile("notes/selection-hot-path.md");
      const firstPath = "notes/first.md";
      const secondPath = "notes/second.md";
      const visibleCards = [
        createCardRecordFromPath(firstPath),
        createCardRecordFromPath(secondPath),
      ];

      (view as any).bulkMode = true;
      (view as any).baseCards = visibleCards;
      (view as any).visibleCards = visibleCards;
      (view as any).deriveVisibleCards = vi.fn(() => visibleCards);

      await (view as any).onOpen();

      const deriveVisibleCardsSpy = vi.spyOn(view as any, "deriveVisibleCards");
      const deriveAvailableTagsSpy = vi.spyOn(view as any, "deriveAvailableTags");

      const bulkSelectCardHandler = mockState.panelEventHandlers["bulk-select-card"];
      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];

      bulkSelectCardHandler({ detail: { path: firstPath, shiftKey: false } });
      bulkSelectCardHandler({ detail: { path: secondPath, shiftKey: false } });
      toolbarActionHandler({ detail: { action: "bulk-clear-selection" } });
      toolbarActionHandler({ detail: { action: "bulk" } });
      toolbarActionHandler({ detail: { action: "bulk" } });

      expect(deriveVisibleCardsSpy).not.toHaveBeenCalled();
      expect(deriveAvailableTagsSpy).not.toHaveBeenCalled();
    });

    it("bulk delete uses Obsidian preference-respecting confirmation and reconciles stale selection", async () => {
      const { view, app } = createViewWithFile("notes/delete-stale.md");
      const liveFile = createMarkdownFile("notes/live.md");
      const stalePath = "notes/stale.md";

      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === liveFile.path) {
          return liveFile;
        }
        return null;
      });

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set([stalePath, liveFile.path]);
      (view as any).bulkAnchorPath = stalePath;
      (view as any).baseCards = [
        createCardRecordFromPath(stalePath),
        createCardRecordFromPath(liveFile.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(stalePath),
        createCardRecordFromPath(liveFile.path),
      ];
      (view as any).deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(stalePath),
        createCardRecordFromPath(liveFile.path),
      ]);

      vi.mocked(batchDeleteFilesUsingObsidianPreference).mockResolvedValueOnce({
        succeeded: [{ ok: true, file: liveFile as unknown as any }],
        failed: [],
      } as any);

      await (view as any).onOpen();

      expect(mockState.panelInstances).toHaveLength(1);

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-delete-selected" } });
      await flushAsyncWork(1);

      expect(Array.from((view as any).selectedPaths)).toEqual([liveFile.path]);
      expect((view as any).bulkAnchorPath).toBe(liveFile.path);
      expect(mockState.modalInstances).toHaveLength(1);
      expect(mockState.modalInstances[0]?.title).toBe("Delete selected notes?");
      expect(mockState.modalInstances[0]?.messages).toEqual([
        "Delete 1 selected note? Obsidian will use your Files & Links delete preference.",
      ]);

      clickLatestModalButton("Delete");
      await flushAsyncWork();

      expect(batchDeleteFilesUsingObsidianPreference).toHaveBeenCalledTimes(1);
      expect(batchDeleteFilesUsingObsidianPreference).toHaveBeenCalledWith(app, [liveFile] as unknown as any);
      expect(batchTrashFiles).not.toHaveBeenCalled();
      expect(Array.from((view as any).selectedPaths)).toEqual([]);
      expect((view as any).bulkAnchorPath).toBeNull();
      expect(mockState.noticeMessages).toEqual(["Deleted 1 note."]);
    });

    it("keeps the bulk merge modal usable when submit throws unexpectedly", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const notesFolder = createFolder("notes");

      app.vault.read = vi.fn(async () => "body");
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === "notes") {
          return notesFolder;
        }
        return null;
      });

      vi.mocked(mergeNotes).mockReset();
      vi.mocked(mergeNotes).mockRejectedValueOnce(new Error("boom"));

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set([first.path, second.path]);
      (view as any).bulkAnchorPath = first.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();

      clickLatestModalButton("Merge notes");
      await flushAsyncWork();

      expect(mergeNotes).toHaveBeenCalledTimes(1);
      expect(mockState.noticeMessages).toContain("Failed to merge notes: Error: boom");
      expect(mockState.modalInstances.at(-1)?.title).toBe("Merge selected notes");
      expect(mockState.modalInstances.at(-1)?.buttons.some((button) => button.text === "Merge notes")).toBe(true);
      expect(batchTrashFiles).not.toHaveBeenCalled();
    });

    it("clears bulk selection after successful merge while keeping selectedPath stable", async () => {
      const { view, app } = createViewWithFile("notes/merge-clears-selection.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const notesFolder = createFolder("notes");

      app.vault.read = vi.fn(async () => "body");
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === "notes") {
          return notesFolder;
        }
        return null;
      });

      (view as any).selectedPath = "notes/editor-focused.md";
      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set([first.path, second.path]);
      (view as any).bulkAnchorPath = first.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ]);

      vi.mocked(mergeNotes).mockResolvedValueOnce({
        ok: true,
        mergedFile: createMarkdownFile("notes/Merged notes.md") as unknown as any,
        sourceCount: 2,
      });

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();

      clickLatestModalButton("Merge notes");
      await flushAsyncWork();

      expect(mergeNotes).toHaveBeenCalledTimes(1);
      expect(batchTrashFiles).not.toHaveBeenCalled();
      expect(Array.from((view as any).selectedPaths)).toEqual([]);
      expect((view as any).bulkAnchorPath).toBeNull();
      expect((view as any).selectedPath).toBe("notes/editor-focused.md");
      expect((view as any).bulkMode).toBe(true);
    });
  });

  describe("Phase 1 regression hardening", () => {
    it("pushState updates the panel to root scope while preserving sort, filter, and pinned props", () => {
      const { view, plugin } = createViewWithFile("notes/push-state-root.md");

      plugin.getSettings = vi.fn(() => ({
        includeSubfolders: false,
        sort: { field: "ctime", direction: "asc" },
        filter: { tags: ["alpha", "beta"] },
        defaultView: "cards",
        lastFolderPath: "",
        pinnedPaths: ["notes/pinned.md"],
      }));

      (view as any).component = mockState.createMountedPanel({
        props: { panelModel: (view as any).panelModel },
      });
      (view as any).folderPath = "";
      (view as any).baseCards = [createCardRecord(createMarkdownFile("notes/pinned.md"))];

      (view as any).pushState();

      expect((view as any).component.modelSnapshots.at(-1)).toMatchObject({
        folderPath: "/",
        sortField: "ctime",
        sortDirection: "asc",
        activeFilterTags: ["alpha", "beta"],
        pinnedPaths: ["notes/pinned.md"],
        includeSubfolders: false,
      });
    });

    it("selectedPath stays independent from bulk selection", () => {
      const { view } = createViewWithFile("notes/independent-selection.md");
      const selectedPaths = new Set(["notes/a.md", "notes/b.md"]);
      const visibleCards = [
        createCardRecordFromPath("notes/a.md"),
        createCardRecordFromPath("notes/b.md"),
      ];

      (view as any).component = mockState.createMountedPanel({
        props: { panelModel: (view as any).panelModel },
      });
      (view as any).selectedPath = "notes/previous.md";
      (view as any).bulkMode = true;
      (view as any).selectedPaths = selectedPaths;
      (view as any).bulkAnchorPath = "notes/a.md";
      (view as any).baseCards = visibleCards;
      (view as any).deriveVisibleCards = vi.fn(() => visibleCards);

      (view as any).setSelectedFile("notes/independent-selection.md");

      expect((view as any).selectedPath).toBe("notes/independent-selection.md");
      expect(Array.from((view as any).selectedPaths)).toEqual(["notes/a.md", "notes/b.md"]);
      expect((view as any).bulkAnchorPath).toBe("notes/a.md");
      expect((view as any).component.modelSnapshots.at(-1)).toMatchObject({
        selectedPath: "notes/independent-selection.md",
        bulkMode: true,
        selectedPaths: ["notes/a.md", "notes/b.md"],
        selectedCount: 2,
      });
    });

    it("pushState includes bulk runtime payload", () => {
      const { view, plugin } = createViewWithFile("notes/bulk-runtime-payload.md");
      const firstSelectedPath = "notes/first.md";
      const secondSelectedPath = "notes/second.md";

      plugin.getSettings = vi.fn(() => ({
        includeSubfolders: true,
        sort: { field: "mtime", direction: "desc" },
        filter: { tags: [] },
        defaultView: "cards",
        lastFolderPath: null,
        lastViewMode: "folder",
        pinnedPaths: [],
        previewLines: 5,
      }));

      (view as any).component = mockState.createMountedPanel({
        props: { panelModel: (view as any).panelModel },
      });
      (view as any).folderPath = "notes";
      (view as any).selectedPath = "notes/editor-sync.md";
      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set([firstSelectedPath, secondSelectedPath]);
      (view as any).bulkAnchorPath = firstSelectedPath;
      (view as any).baseCards = [
        createCardRecord(createMarkdownFile(firstSelectedPath)),
        createCardRecord(createMarkdownFile(secondSelectedPath)),
      ];

      (view as any).pushState();

      expect((view as any).component.modelSnapshots.at(-1)).toMatchObject({
        selectedPath: "notes/editor-sync.md",
        bulkMode: true,
        selectedPaths: [firstSelectedPath, secondSelectedPath],
        selectedCount: 2,
        bulkAnchorPath: firstSelectedPath,
        canBulkSelectAll: true,
        canBulkClearSelection: true,
        canBulkMoveSelected: true,
        canBulkDeleteSelected: true,
        canBulkMergeSelected: true,
      });
    });

    it("supports base canvas and excalidraw cards without non-markdown cachedRead", () => {
      const { view, app } = createViewWithFile("projects/active/direct.md");
      const root = attachChildren(createFolder("projects/active"), [
        createMarkdownFile("projects/active/direct.md"),
        createNonMarkdownFile("projects/active/reference.base", "base"),
        createNonMarkdownFile("projects/active/flow.canvas", "canvas"),
        createNonMarkdownFile("projects/active/sketch.excalidraw", "excalidraw"),
        createMarkdownFile("projects/active/sketch.excalidraw.md"),
        createNonMarkdownFile("projects/active/image.png"),
      ]);

      app.vault.getAbstractFileByPath = vi.fn(() => root);

      expect((view as any).collectSupportedFiles("projects/active", false).map((file: { path: string }) => file.path)).toEqual([
        "projects/active/direct.md",
        "projects/active/reference.base",
        "projects/active/flow.canvas",
        "projects/active/sketch.excalidraw",
        "projects/active/sketch.excalidraw.md",
      ]);
    });

    it("collectSupportedFiles recurses nested markdown files when includeSubfolders is true", () => {
      const { view, app } = createViewWithFile("projects/active/direct.md");
      const root = attachChildren(createFolder("projects/active"), [
        createMarkdownFile("projects/active/direct.md"),
        attachChildren(createFolder("projects/active/nested"), [
          createMarkdownFile("projects/active/nested/deep.md"),
        ]),
      ]);

      app.vault.getAbstractFileByPath = vi.fn(() => root);

      expect((view as any).collectSupportedFiles("projects/active", true).map((file: { path: string }) => file.path)).toEqual([
        "projects/active/direct.md",
        "projects/active/nested/deep.md",
      ]);
    });

    it("collectSupportedFiles recurses from root when includeSubfolders is true", () => {
      const { view, app } = createViewWithFile("projects/active/direct.md");
      const root = attachChildren(createFolder(""), [
        createMarkdownFile("projects/active/direct.md"),
        attachChildren(createFolder("projects/active/nested"), [
          createMarkdownFile("projects/active/nested/deep.md"),
        ]),
      ]);

      app.vault.getRoot = vi.fn(() => root);

      expect((view as any).collectSupportedFiles("", true).map((file: { path: string }) => file.path)).toEqual([
        "projects/active/direct.md",
        "projects/active/nested/deep.md",
      ]);
    });

    it("isPathInScope excludes nested descendants for direct root scope and includes them recursively", () => {
      const { view } = createViewWithFile("notes/root.md");

      (view as any).folderPath = "";

      expect((view as any).isPathInScope("root.md", false)).toBe(true);
      expect((view as any).isPathInScope("archive/nested.md", false)).toBe(false);
      expect((view as any).isPathInScope("archive/nested.md", true)).toBe(true);
    });

    it("vault mutations ignore nested descendants when includeSubfolders is false", () => {
      const { view, plugin } = createViewWithFile("projects/active/direct.md");

      (view as any).folderPath = "projects/active";
      plugin.getSettings = vi.fn(() => ({
        includeSubfolders: false,
        sort: { field: "mtime", direction: "desc" },
        filter: { tags: [] },
        defaultView: "cards",
        lastFolderPath: null,
        lastViewMode: "folder",
        pinnedPaths: [],
      }));

      expect(
        (view as any).shouldRefreshForVaultEvent({
          eventType: "create",
          path: "projects/active/nested/deep.md",
          isFolder: false,
          fileKind: "markdown",
        }),
      ).toBe(false);
    });

    it("vault mutations include nested descendants when includeSubfolders is true", () => {
      const { view, plugin } = createViewWithFile("projects/active/direct.md");

      (view as any).folderPath = "projects/active";
      plugin.getSettings = vi.fn(() => ({
        includeSubfolders: true,
        sort: { field: "mtime", direction: "desc" },
        filter: { tags: [] },
        defaultView: "cards",
        lastFolderPath: null,
        lastViewMode: "folder",
        pinnedPaths: [],
      }));

      expect(
        (view as any).shouldRefreshForVaultEvent({
          eventType: "create",
          path: "projects/active/nested/deep.md",
          isFolder: false,
          fileKind: "markdown",
        }),
      ).toBe(true);
    });

    it("bulk selection reconciliation", () => {
      const { view } = createViewWithFile("notes/reconcile-reorder.md");
      const cardA = createCardRecordFromPath("notes/a.md");
      const cardB = createCardRecordFromPath("notes/b.md");
      const cardC = createCardRecordFromPath("notes/c.md");

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set(["notes/a.md", "notes/c.md"]);
      (view as any).bulkAnchorPath = "notes/a.md";
      (view as any).baseCards = [cardA, cardB, cardC];
      (view as any).deriveVisibleCards = vi.fn(() => [cardC, cardA]);

      (view as any).pushState();

      expect(Array.from((view as any).selectedPaths)).toEqual(["notes/c.md", "notes/a.md"]);
      expect((view as any).bulkAnchorPath).toBe("notes/a.md");

      (view as any).deriveVisibleCards = vi.fn(() => [cardC]);
      (view as any).pushState();

      expect(Array.from((view as any).selectedPaths)).toEqual(["notes/c.md"]);
      expect((view as any).bulkAnchorPath).toBe("notes/c.md");

      (view as any).selectedPaths = new Set(["notes/stale.md"]);
      (view as any).bulkAnchorPath = "notes/stale.md";
      (view as any).cleanupLifecycle();

      expect((view as any).selectedPaths.size).toBe(0);
      expect((view as any).bulkAnchorPath).toBeNull();
      expect((view as any).bulkMode).toBe(true);
    });

    it("filter and scope changes reconcile bulk selection", async () => {
      const { view, app, plugin } = createViewWithFile("notes/scope-reconcile.md");
      const directFile = createMarkdownFile("notes/direct.md");
      const nestedFile = createMarkdownFile("notes/nested/deep.md");
      (directFile as unknown as { stat: { ctime: number; mtime: number } }).stat = { ctime: 10, mtime: 10 };
      (nestedFile as unknown as { stat: { ctime: number; mtime: number } }).stat = { ctime: 11, mtime: 11 };

      const nestedFolder = attachChildren(createFolder("notes/nested"), [nestedFile]);
      const notesFolder = attachChildren(createFolder("notes"), [directFile, nestedFolder]);
      const rootFolder = attachChildren(createFolder(""), [notesFolder]);
      let includeSubfolders = true;

      plugin.getSettings = vi.fn(() => ({
        includeSubfolders,
        sort: { field: "mtime", direction: "desc" },
        filter: { tags: [] },
        defaultView: "cards",
        lastFolderPath: null,
        lastViewMode: "folder",
        pinnedPaths: [],
        previewLines: 5,
      }));

      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === "notes") {
          return notesFolder;
        }
        if (requestedPath === directFile.path) {
          return directFile;
        }
        if (requestedPath === nestedFile.path) {
          return nestedFile;
        }
        return null;
      });
      app.vault.getRoot = vi.fn(() => rootFolder);
      app.vault.cachedRead = vi.fn(async () => "preview");

      await (view as any).handleFolderSelection({
        requestId: 21,
        folderPath: "notes",
        source: "programmatic",
        requestedAtMs: Date.now(),
        forceRefresh: false,
      });

      (view as any).bulkMode = true;
      (view as any).selectedPaths = new Set(["notes/direct.md", "notes/nested/deep.md"]);
      (view as any).bulkAnchorPath = "notes/direct.md";
      (view as any).deriveVisibleCards = vi.fn(() => [createCardRecordFromPath("notes/direct.md")]);

      (view as any).pushState();

      expect(Array.from((view as any).selectedPaths)).toEqual(["notes/direct.md"]);
      expect((view as any).bulkAnchorPath).toBe("notes/direct.md");

      includeSubfolders = false;
      await (view as any).handleFolderSelection({
        requestId: 22,
        folderPath: "notes",
        source: "programmatic",
        requestedAtMs: Date.now(),
        forceRefresh: true,
      });

      expect((view as any).bulkMode).toBe(true);
      expect((view as any).selectedPaths.size).toBe(0);
      expect((view as any).bulkAnchorPath).toBeNull();

      (view as any).selectedPaths = new Set(["notes/direct.md"]);
      (view as any).bulkAnchorPath = "notes/direct.md";
      await (view as any).handleFolderSelection({
        requestId: 23,
        folderPath: "",
        source: "programmatic",
        requestedAtMs: Date.now(),
        forceRefresh: true,
      });

      expect((view as any).bulkMode).toBe(true);
      expect((view as any).selectedPaths.size).toBe(0);
      expect((view as any).bulkAnchorPath).toBeNull();
    });

    it("scope changes clear bulk selection immediately while load is in flight", async () => {
      const { view, app, plugin } = createViewWithFile("notes/inflight-scope-change.md");
      const component = mockState.createMountedPanel({
        props: { panelModel: (view as any).panelModel },
      });
      const notesFolder = createFolder("notes");

      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        return requestedPath === "notes" ? notesFolder : null;
      });

      (view as any).component = component;
      (view as any).bulkMode = true;
      (view as any).folderPath = "notes";
      (view as any).selectedPaths = new Set(["notes/keep.md", "notes/drop.md"]);
      (view as any).bulkAnchorPath = "notes/keep.md";
      (view as any).baseCards = [
        createCardRecordFromPath("notes/keep.md"),
        createCardRecordFromPath("notes/drop.md"),
      ];
      (view as any).deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath("notes/keep.md"),
        createCardRecordFromPath("notes/drop.md"),
      ]);
      (view as any).inFlight = Promise.resolve();
      (view as any).inFlightKey = "notes::true::mtime::desc";
      (view as any).inFlightLoadScope = {
        folderPath: "notes",
        includeSubfolders: true,
        sortField: "mtime",
        sortDirection: "desc",
      };

      plugin.getSettings = vi.fn(() => ({
        includeSubfolders: false,
        sort: { field: "mtime", direction: "desc" },
        filter: { tags: [] },
        defaultView: "cards",
        lastFolderPath: null,
        lastViewMode: "folder",
        pinnedPaths: [],
        previewLines: 5,
      }));

      const result = await (view as any).handleFolderSelection({
        requestId: 24,
        folderPath: "notes",
        source: "programmatic",
        requestedAtMs: Date.now(),
        forceRefresh: true,
      });

      expect(result.action).toBe("queued_latest");
      expect((view as any).bulkMode).toBe(true);
      expect((view as any).selectedPaths.size).toBe(0);
      expect((view as any).bulkAnchorPath).toBeNull();
      expect(component.modelSnapshots.at(-1)).toMatchObject({
        bulkMode: true,
        selectedPaths: [],
        selectedCount: 0,
        bulkAnchorPath: null,
      });
    });

    it("rename and delete mutations update selectedPaths", () => {
      const { view, app } = createViewWithFile("notes/mutation-selected.md");
      const fileA = createMarkdownFile("notes/mutation-selected.md");
      const fileB = createMarkdownFile("notes/keep-or-delete.md");
      const renamedFile = createMarkdownFile("notes/renamed-selected.md");

      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === renamedFile.path) {
          return renamedFile;
        }
        return null;
      });

      (view as any).folderPath = "notes";
      (view as any).bulkMode = true;
      (view as any).baseCards = [createCardRecord(fileA), createCardRecord(fileB)];
      (view as any).selectedPaths = new Set([fileA.path, fileB.path]);
      (view as any).bulkAnchorPath = fileA.path;

      const renameResult = (view as any).handleVaultMutation({
        eventType: "rename",
        oldPath: fileA.path,
        path: renamedFile.path,
        isFolder: false,
        fileKind: "markdown",
      });

      expect(renameResult.shouldRefresh).toBe(false);
      expect(renameResult.incrementalResult).toEqual({ handled: true, action: "updated" });
      expect((view as any).selectedPaths.has(fileA.path)).toBe(false);
      expect((view as any).selectedPaths.has(renamedFile.path)).toBe(true);
      expect((view as any).bulkAnchorPath).toBe(renamedFile.path);

      const deleteResult = (view as any).handleVaultMutation({
        eventType: "delete",
        path: fileB.path,
        isFolder: false,
        fileKind: "markdown",
      });

      expect(deleteResult.shouldRefresh).toBe(false);
      expect(deleteResult.incrementalResult).toEqual({ handled: true, action: "removed" });
      expect(Array.from((view as any).selectedPaths)).toEqual([renamedFile.path]);

      const movedOutOfScopeResult = (view as any).handleVaultMutation({
        eventType: "rename",
        oldPath: renamedFile.path,
        path: "archive/renamed-selected.md",
        isFolder: false,
        fileKind: "markdown",
      });

      expect(movedOutOfScopeResult.shouldRefresh).toBe(false);
      expect(movedOutOfScopeResult.incrementalResult).toEqual({ handled: true, action: "removed" });
      expect((view as any).selectedPaths.size).toBe(0);
      expect((view as any).bulkAnchorPath).toBeNull();
    });

    it("open-note, sort-change, filter-change, and pin-toggle still work after switching to root scope", async () => {
      const { view, plugin } = createViewWithFile("notes/phase1-regression.md");

      plugin.getSettings = vi.fn(() => ({
        includeSubfolders: true,
        sort: { field: "mtime", direction: "desc" },
        filter: { tags: [] },
        defaultView: "cards",
        lastFolderPath: "",
        pinnedPaths: [],
              }));

      (view as any).folderPath = "";
      await (view as any).onOpen();
      await (view as any).onOpen();

      mockState.panelEventHandlers["open-note"]({ detail: { path: "notes/phase1-regression.md" } });
      mockState.panelEventHandlers["sort-change"]({ detail: { field: "ctime", direction: "asc" } });
      mockState.panelEventHandlers["filter-change"]({ detail: { tags: ["#Project"] } });
      mockState.panelEventHandlers["pin-toggle"]({ detail: { path: "notes/phase1-regression.md", pinned: true } });

      expect(plugin.openNoteFromCard).toHaveBeenCalledWith("notes/phase1-regression.md");
      expect(plugin.saveSettings).toHaveBeenNthCalledWith(1, {
        sort: {
          field: "ctime",
          direction: "asc",
        },
      });
      expect(plugin.saveSettings).toHaveBeenNthCalledWith(2, {
        filter: {
          tags: ["project"],
        },
      });
      expect(plugin.saveSettings).toHaveBeenNthCalledWith(3, {
        pinnedPaths: ["notes/phase1-regression.md"],
      });
    });
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
