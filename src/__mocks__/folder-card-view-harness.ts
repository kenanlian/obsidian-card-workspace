/**
 * Shared FolderCardView + mocked-panel harness for node-project tests.
 * Architecture tests skip `__mocks__/`; this is test infrastructure, not production.
 */
import { expect, vi } from "vitest";
import { getUiStrings } from "../i18n";

const mockState = vi.hoisted(() => {
  if (typeof HTMLElement === "undefined") {
    (globalThis as any).HTMLElement = class HTMLElement {};
  }

  const menuInstances: MockMenu[] = [];
  const folderPickerInstances: MockFolderPickerModal[] = [];
  const modalInstances: MockModal[] = [];
  const suggestModalInstances: MockSuggestModal[] = [];
  const noticeMessages: string[] = [];
  const panelEventHandlers: Record<string, (event: any) => void> = {};
  const runtimeFlags = {
    isDesktopApp: true,
  };
  const clipboardWriteTextMock = vi.fn(async (_text: string) => undefined);

  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const existingNavigator = navigatorDescriptor?.get ? navigatorDescriptor.get.call(globalThis) : (globalThis as any).navigator;
  const nextNavigator = {
    ...existingNavigator,
    clipboard: {
      ...existingNavigator?.clipboard,
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
    onGroupChange?: (payload: Record<string, unknown>) => void;
    onGroupCollapseCommand?: (payload: Record<string, unknown>) => void;
    onFilterChange?: (payload: Record<string, unknown>) => void;
    onIncludeSubfoldersChange?: (payload: Record<string, unknown>) => void;
    onSearchQueryChange?: (payload: Record<string, unknown>) => void;
    onSearchQueryReset?: (payload: Record<string, unknown>) => void;
    onSelectFolder?: (payload: Record<string, unknown>) => void;
    onFolderAction?: (payload: Record<string, unknown>) => void;
    onNavContextMenu?: (payload: Record<string, unknown>) => void;
    onFavoriteActivate?: (payload: Record<string, unknown>) => void;
    onHydrateViewport?: (payload: Record<string, unknown>) => void;
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
      onGroupChange: "group-change",
      onGroupCollapseCommand: "group-collapse",
      onFilterChange: "filter-change",
      onIncludeSubfoldersChange: "include-subfolders-change",
      onSearchQueryChange: "search-query-change",
      onSearchQueryReset: "search-query-reset",
      onSelectFolder: "select-folder",
      onFolderAction: "folder-action",
      onNavContextMenu: "nav-context-menu",
      onFavoriteActivate: "favorite-activate",
      onHydrateViewport: "hydrate-viewport",
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
    checked: boolean | null = null;
    disabled = false;
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

    setChecked(checked: boolean): this {
      this.checked = checked;
      return this;
    }

    setDisabled(disabled: boolean): this {
      this.disabled = disabled;
      return this;
    }

    onClick(handler: () => void): this {
      this.clickHandler = handler;
      return this;
    }

    setSubmenu(): MockMenu {
      const submenu = new MockMenu();
      this.submenu = submenu;
      const submenuIndex = menuInstances.indexOf(submenu);
      if (submenuIndex >= 0) {
        menuInstances.splice(submenuIndex, 1);
      }

      return submenu;
    }
  }

  class MockMenuTitleElement {
    textContent: string;

    constructor(text: string) {
      this.textContent = text;
    }
  }

  class MockMenuItemDom {
    readonly titleElement: MockMenuTitleElement;
    readonly classNames = new Set<string>(["menu-item"]);
    readonly classList = {
      add: (token: string) => {
        this.classNames.add(token);
      },
    };

    constructor(title: string) {
      this.titleElement = new MockMenuTitleElement(title);
    }

    querySelector(selector: string): MockMenuTitleElement | null {
      if (selector === ".menu-item-title") {
        return this.titleElement;
      }

      return null;
    }

    hasClass(token: string): boolean {
      return this.classNames.has(token);
    }
  }

  class MockMenuDom {
    readonly classList = {
      add: vi.fn(),
    };
    private readonly itemNodes: MockMenuItemDom[] = [];

    appendItem(item: MockMenuItem): void {
      this.itemNodes.push(new MockMenuItemDom(item.title));
    }

    appendSeparator(): void {}

    querySelectorAll<T>(selector: string): T[] {
      if (selector === ".menu-item") {
        return this.itemNodes as T[];
      }

      if (selector === ".menu-item.fce-menu-item-danger .menu-item-title") {
        return this.itemNodes
          .filter((item) => item.hasClass("fce-menu-item-danger"))
          .map((item) => item.titleElement) as T[];
      }

      return [];
    }
  }
  class MockMenu {
    items: MockMenuItem[] = [];
    showAtMouseEvent = vi.fn();
    showAtPosition = vi.fn();
    hideHandler: (() => void) | null = null;
    dom: MockMenuDom;

    constructor() {
      this.dom = new MockMenuDom();
      menuInstances.push(this);
    }

    addItem(configure: (item: MockMenuItem) => void): this {
      const item = new MockMenuItem();
      configure(item);
      this.items.push(item);
      this.dom.appendItem(item);
      return this;
    }

    addSeparator(): this {
      const separator = new MockMenuItem();
      separator.kind = "separator";
      this.items.push(separator);
      this.dom.appendSeparator();
      return this;
    }

    onHide(handler: () => void): this {
      this.hideHandler = handler;
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
    disabled: boolean;
    onClick: (() => void) | null;
  }

  interface MockModalTextInput {
    value: string;
    onChange: ((value: string) => void) | null;
    keydownHandlers: Array<(event: { key: string; preventDefault: () => void }) => void>;
  }

  interface MockModalCheckbox {
    label: string;
    checked: boolean;
    onChange: (() => void) | null;
  }

  interface MockModalToggle {
    label: string;
    description: string | null;
    value: boolean;
    onChange: ((value: boolean) => void) | null;
  }

  class MockModalElement {
    readonly __ownerModal: MockModal;
    private readonly text: string | null;
    private readonly tag: string;
    checked = false;
    private changeHandler: (() => void) | null = null;

    constructor(modal: MockModal, tag: string, text: string | null = null) {
      this.__ownerModal = modal;
      this.tag = tag;
      this.text = text;
    }

    createEl(tag: string, attrs?: { text?: string; cls?: string; type?: string }): MockModalElement {
      this.__ownerModal.renderOrder.push(`${tag}:${attrs?.text ?? ""}`);
      if (tag === "p" && typeof attrs?.text === "string") {
        this.__ownerModal.messages.push(attrs.text);
      }
      if (tag === "pre" && typeof attrs?.text === "string") {
        this.__ownerModal.renderedPreviewText = attrs.text;
      }
      if (tag === "span" && this.tag === "label" && typeof attrs?.text === "string") {
        const checkbox = this.__ownerModal.checkboxes.at(-1);
        if (checkbox) {
          checkbox.label = attrs.text;
        }
      }
      if (tag === "input" && attrs?.type === "checkbox") {
        const checkbox: MockModalCheckbox = {
          label: this.text ?? "",
          checked: false,
          onChange: null,
        };
        this.__ownerModal.checkboxes.push(checkbox);
        const inputEl = new MockModalElement(this.__ownerModal, tag);
        Object.defineProperty(inputEl, "checked", {
          get: () => checkbox.checked,
          set: (value: boolean) => {
            checkbox.checked = value;
          },
          configurable: true,
          enumerable: true,
        });
        inputEl.addEventListener = vi.fn((event: string, handler: () => void) => {
          if (event === "change") {
            checkbox.onChange = handler;
          }
        });
        return inputEl;
      }
      return new MockModalElement(this.__ownerModal, tag, attrs?.text ?? null);
    }

    createDiv(_attrs?: { cls?: string }): MockModalElement {
      return new MockModalElement(this.__ownerModal, "div");
    }

    addEventListener = vi.fn((_event: string, handler: () => void) => {
      this.changeHandler = handler;
    });

    triggerChange(): void {
      this.changeHandler?.();
    }
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
    toggles: MockModalToggle[] = [];
    checkboxes: MockModalCheckbox[] = [];
    modalEl: {
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
    };
    contentEl: MockModalElement & {
      scrollTop: number;
      isConnected: boolean;
      empty: () => void;
    };

    constructor(app: unknown) {
      this.app = app;
      this.modalEl = {
        scrollTop: 0,
        scrollHeight: 1200,
        clientHeight: 400,
      };
      const contentEl = new MockModalElement(this, "div") as MockModal["contentEl"];
      contentEl.scrollTop = 0;
      contentEl.isConnected = true;
      contentEl.empty = () => {
        this.descriptions = [];
        this.messages = [];
        this.renderedPreviewText = "";
        this.renderOrder = [];
        this.buttons = [];
        this.textInputs = [];
        this.toggles = [];
        this.checkboxes = [];
      };
      this.contentEl = contentEl;
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
      this.contentEl.isConnected = false;
      if ("onClose" in this && typeof (this as any).onClose === "function") {
        (this as any).onClose();
      }
    }
  }
  class MockSuggestModal {
    app: unknown;
    title = "";

    constructor(app: unknown) {
      this.app = app;
      suggestModalInstances.push(this);
    }

    setTitle(title: string): this {
      this.title = title;
      return this;
    }

    open(): void {
      return;
    }

    close(): void {
      return;
    }

    getItems(): unknown[] {
      return [];
    }

    getItemText(_item: unknown): string {
      return "";
    }

    onChooseItem(_item: unknown): void | Promise<void> {
      return;
    }
  }

  class MockSetting {
    private modal: MockModal | null;

    constructor(containerEl: unknown) {
      const owner = (containerEl as { __ownerModal?: MockModal } | null)?.__ownerModal;
      this.modal = owner ?? null;
    }

    private currentName = "";
    private currentDescription: string | null = null;

    setName(name: string): this {
      this.currentName = name;
      this.modal?.renderOrder.push(`setting:${name}`);
      return this;
    }

    setDesc(description: string): this {
      this.currentDescription = description;
      this.modal?.descriptions.push(description);
      return this;
    }

    addText(configure: (text: {
      setValue: (value: string) => unknown;
      setPlaceholder: (value: string) => unknown;
      onChange: (handler: (value: string) => void) => unknown;
      inputEl: {
        addEventListener: (
          type: string,
          handler: (event: { key: string; preventDefault: () => void }) => void,
        ) => void;
      };
    }) => void): this {
      const record: MockModalTextInput = {
        value: "",
        onChange: null,
        keydownHandlers: [],
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
        inputEl: {
          addEventListener: (
            type: string,
            handler: (event: { key: string; preventDefault: () => void }) => void,
          ) => {
            if (type === "keydown") {
              record.keydownHandlers.push(handler);
            }
          },
        },
      };

      configure(chain);
      this.modal?.textInputs.push(record);
      return this;
    }

    addToggle(configure: (toggle: {
      setValue: (value: boolean) => unknown;
      onChange: (handler: (value: boolean) => void) => unknown;
    }) => void): this {
      const record: MockModalToggle = {
        label: this.currentName,
        description: this.currentDescription,
        value: false,
        onChange: null,
      };

      const chain = {
        setValue: (value: boolean) => {
          record.value = value;
          return chain;
        },
        onChange: (handler: (value: boolean) => void) => {
          record.onChange = handler;
          return chain;
        },
      };

      configure(chain);
      this.modal?.renderOrder.push(`toggle:${record.label}`);
      this.modal?.toggles.push(record);
      return this;
    }

    addButton(configure: (button: {
      setButtonText: (text: string) => unknown;
      onClick: (handler: () => void) => unknown;
      setWarning: () => unknown;
      setCta: () => unknown;
      setDisabled: (disabled: boolean) => unknown;
    }) => void): this {
      const record: MockModalButton = {
        text: "",
        warning: false,
        cta: false,
        disabled: false,
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
        setDisabled: (disabled: boolean) => {
          record.disabled = disabled;
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
    MockSuggestModal,
    MockTFile,
    MockTFolder,
    MockFolderPickerModal,
    createMountedPanel,
    svelteMountMock,
    svelteUnmountMock,
    menuInstances,
    folderPickerInstances,
    modalInstances,
    suggestModalInstances,
    noticeMessages,
    panelEventHandlers,
    panelInstances,
    runtimeFlags,
    clipboardWriteTextMock,
  };
});

export { mockState, getUiStrings };

vi.mock("obsidian", () => {
  return {
    FuzzySuggestModal: mockState.MockSuggestModal,
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

vi.mock("../view/FolderCardPanel.svelte", () => {
  return {
    default: mockState.createMountedPanel,
  };
});

export async function buildNoteOpsMock(
  actual: typeof import("../view/note-ops"),
): Promise<Record<string, unknown>> {
  return {
    buildMergedNoteContent: actual.buildMergedNoteContent,
    addTagToFile: vi.fn(async (_app: unknown, file: unknown) => ({ ok: true, file })),
    batchAddTagToFiles: vi.fn(async () => ({ succeeded: [], failed: [] })),
    batchDeleteFilesUsingObsidianPreference: vi.fn(async () => ({ succeeded: [], failed: [] })),
    batchMoveFiles: vi.fn(async () => ({ succeeded: [], failed: [] })),
    batchRemoveTagsFromFiles: vi.fn(async () => ({ changed: [], noop: [], failed: [] })),
    batchTrashFiles: vi.fn(async () => ({ succeeded: [], failed: [] })),
    copyContentToClipboard: vi.fn(async () => true),
    copyTitleAndContentToClipboard: vi.fn(async () => true),
    copyTitleToClipboard: vi.fn(async () => true),
    deleteFileUsingObsidianPreference: vi.fn(async (_app: unknown, file: unknown) => ({ ok: true, file })),
    duplicateFile: vi.fn(async (_app: unknown, file: unknown) => ({ ok: true, file })),
    mergeNotes: vi.fn(async () => ({
      ok: true,
      mergedFile: new mockState.MockTFile("notes/Merged notes.md"),
      sourceCount: 2,
    })),
    moveFile: vi.fn(async (_app: unknown, file: unknown) => ({ ok: true, file })),
    normalizeTagForFrontmatter: vi.fn((tag: string) => tag.trim().replace(/^#/, "").toLowerCase()),
    removeTagFromFile: vi.fn(async (_app: unknown, file: unknown) => ({ ok: true, file })),
    trashAbstractFileUsingObsidianPreference: vi.fn(async (app: { fileManager: { trashFile: (file: unknown) => Promise<void> } }, file: unknown) => {
      await app.fileManager.trashFile(file);
    }),
  };
}

vi.mock("../FolderPickerModal", () => {
  return {
    FolderPickerModal: mockState.MockFolderPickerModal,
  };
});

import type { FolderCardView } from "../view/FolderCardView";
import type { SearchServiceSnapshot } from "../search";

type FolderCardViewCtor = new (leaf: any, plugin: any) => FolderCardView;
let folderCardViewCtor: FolderCardViewCtor | null = null;

export function registerFolderCardView(ctor: FolderCardViewCtor): void {
  folderCardViewCtor = ctor;
}
export function createFolder(path: string): InstanceType<typeof mockState.MockTFolder> {
  return new mockState.MockTFolder(path);
}
export function createMarkdownFile(path: string): InstanceType<typeof mockState.MockTFile> {
  const file = new mockState.MockTFile(path);
  (file as unknown as { extension: string }).extension = "md";
  return file;
}

export function createNonMarkdownFile(path: string, extension: string = "png"): InstanceType<typeof mockState.MockTFile> {
  const file = new mockState.MockTFile(path);
  (file as unknown as { extension: string }).extension = extension;
  return file;
}

export function attachChildren(
  folder: InstanceType<typeof mockState.MockTFolder>,
  children: unknown[],
): InstanceType<typeof mockState.MockTFolder> {
  folder.children = children;
  return folder;
}

export function createViewWithFile(
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
      processFrontMatter: vi.fn(async (_file: InstanceType<typeof mockState.MockTFile>, mutate: (frontmatter: Record<string, unknown>) => void) => {
        mutate({});
      }),
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
      process: vi.fn(async (_file: InstanceType<typeof mockState.MockTFile>, mutate: (content: string) => string) => mutate("")),
    },
    workspace: {},
  };
  const leaf = { app, getRoot: vi.fn(() => ({})) };
  const plugin = {
    getSettings: vi.fn(() => ({
      includeSubfolders: true,
      sort: { field: "mtime", direction: "desc" },
      filter: { tags: [], properties: [] },
      visiblePropertyKeys: [],
      expandedPropertyKeys: [],
      sectionCollapsed: { favorites: false, folders: false, tags: false, properties: false, boxes: false },
      navSectionOrder: ["favorites", "folders", "tags", "properties", "boxes"],
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
    subscribeVaultEvents: vi.fn(() => () => undefined),
    subscribeMetadataEvents: vi.fn(() => () => undefined),
    openNoteFromCard: vi.fn(),
    selectAllNotes: vi.fn(),
    createNoteInCurrentFolder: vi.fn(),
    createNoteInFolder: vi.fn(async () => undefined),
    selectFolderByPath: vi.fn(),
    saveSettings: vi.fn(async () => undefined),
  };

  if (!folderCardViewCtor) {
    throw new Error("registerFolderCardView() must run before createViewWithFile()");
  }
  const view = new folderCardViewCtor(leaf as any, plugin as any);
  return { view, app, file, plugin };
}

export function createCardRecord(
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
    taskSummary: null,
  };
}

export function createCardRecordFromPath(
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

export function publishAll(view: FolderCardView): void {
  (view as any).modules.projection.reprojectCards();
  (view as any).modules.bulk.reconcileToVisibleCards();
  (view as any).publishGroups("strings", "scope", "cards", "search", "projection", "bulk", "nav", "appearance");
}

export function createIndexedSearchServiceStub(result: {
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
export function getLatestModalButton(
  buttonText: string,
  occurrence: number = 0,
): { text: string; disabled: boolean; onClick: (() => void) | null } | undefined {
  const modal = mockState.modalInstances.at(-1);
  expect(modal).toBeDefined();

  const buttons = modal?.buttons.filter((candidate) => candidate.text === buttonText) ?? [];
  return buttons[occurrence];
}

export function clickLatestModalButton(buttonText: string, occurrence: number = 0): void {
  const button = getLatestModalButton(buttonText, occurrence);
  expect(button).toBeDefined();
  expect(typeof button?.onClick).toBe("function");
  button?.onClick?.();
}

export function setLatestModalTextInput(index: number, value: string): void {
  const modal = mockState.modalInstances.at(-1);
  expect(modal).toBeDefined();

  const input = modal?.textInputs[index];
  expect(input).toBeDefined();
  input!.value = value;
  input?.onChange?.(value);
}

export function setLatestModalCheckbox(label: string, checked: boolean): void {
  const modal = mockState.modalInstances.at(-1);
  expect(modal).toBeDefined();

  const checkbox = modal?.checkboxes.find((candidate) => candidate.label === label);
  expect(checkbox).toBeDefined();
  checkbox!.checked = checked;
  checkbox?.onChange?.();
}

export function getMenuStructure(menu: {
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

export function getTopLevelMenuSignature(menu: {
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
export function getDangerMenuTitles(menu: { dom: { querySelectorAll: <T>(selector: string) => T[] } }): string[] {
  return menu.dom.querySelectorAll<{ textContent: string | null }>(".menu-item.fce-menu-item-danger .menu-item-title")
    .map((element) => element.textContent?.trim() ?? "");
}

export function findMenuItemByTitle(
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

export async function flushAsyncWork(iterations: number = 5): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

export function createDeferred<T>(): {
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

export function createSearchHealth(overrides: Partial<SearchServiceSnapshot["health"]> = {}): SearchServiceSnapshot["health"] {
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

export function resetFolderCardViewHarness(): void {
  mockState.menuInstances.length = 0;
  mockState.folderPickerInstances.length = 0;
  mockState.modalInstances.length = 0;
  mockState.suggestModalInstances.length = 0;
  mockState.noticeMessages.length = 0;
  mockState.panelInstances.length = 0;
  mockState.runtimeFlags.isDesktopApp = true;
  mockState.clipboardWriteTextMock.mockReset();
  mockState.clipboardWriteTextMock.mockResolvedValue(undefined);
  (globalThis as unknown as {
    activeWindow?: Pick<Window, "setTimeout" | "clearTimeout">;
  }).activeWindow = {
    setTimeout: ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      setTimeout(handler, timeout, ...args)) as Window["setTimeout"],
    clearTimeout: ((handle?: number | NodeJS.Timeout) => {
      if (handle !== undefined) {
        clearTimeout(handle);
      }
    }) as Window["clearTimeout"],
  };
  Object.keys(mockState.panelEventHandlers).forEach((key) => {
    delete mockState.panelEventHandlers[key];
  });
  vi.clearAllMocks();
}
