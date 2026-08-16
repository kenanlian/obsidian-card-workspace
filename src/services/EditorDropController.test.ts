import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  notices: [] as string[],
  leavesByType: {} as Record<string, unknown[]>,
  menus: [] as Array<{
    items: Array<{ title: string; icon: string; onClick: (() => void) | null }>;
    positions: Array<{ x: number; y: number }>;
    dom: { classList: { add: ReturnType<typeof vi.fn> } };
  }>,
}));

vi.mock("obsidian", () => {
  class MockNotice {
    constructor(message: string) {
      mockState.notices.push(message);
    }
  }

  class MockMenu {
    items: Array<{ title: string; icon: string; onClick: (() => void) | null }> = [];
    positions: Array<{ x: number; y: number }> = [];
    dom = { classList: { add: vi.fn() } };

    constructor() {
      mockState.menus.push(this);
    }

    addItem(configure: (item: {
      setTitle: (title: string) => unknown;
      setIcon: (icon: string) => unknown;
      onClick: (callback: () => void) => unknown;
    }) => void): this {
      const entry = { title: "", icon: "", onClick: null as (() => void) | null };
      const item = {
        setTitle: (title: string) => {
          entry.title = title;
          return item;
        },
        setIcon: (icon: string) => {
          entry.icon = icon;
          return item;
        },
        onClick: (callback: () => void) => {
          entry.onClick = callback;
          return item;
        },
      };
      configure(item);
      this.items.push(entry);
      return this;
    }

    showAtPosition(position: { x: number; y: number }): void {
      this.positions.push(position);
    }
  }

  class MockTAbstractFile {
    constructor(public path: string) {}
  }

  class MockTFile extends MockTAbstractFile {
    extension = "md";
    basename: string;
    stat = { ctime: 1, mtime: 1 };

    constructor(path = "") {
      super(path);
      const leaf = path.split("/").at(-1) ?? "";
      this.basename = leaf.endsWith(".md") ? leaf.slice(0, -3) : leaf;
    }
  }

  return {
    Notice: MockNotice,
    Menu: MockMenu,
    TAbstractFile: MockTAbstractFile,
    TFile: MockTFile,
    MarkdownView: class MockMarkdownView {
      constructor(public leaf: unknown) {}
    },
  };
});

import type { App } from "obsidian";
import { MarkdownView, TFile } from "obsidian";
import { getUiStrings } from "../i18n";
import { DEFAULT_SETTINGS, type PluginSettings } from "../settings";
import { EditorDropController } from "./EditorDropController";

function createAppMock() {
  return {
    workspace: {
      getLeavesOfType: vi.fn((type: string) => mockState.leavesByType[type] ?? []),
    },
    vault: {
      getAbstractFileByPath: vi.fn(() => null),
      cachedRead: vi.fn(async () => ""),
    },
  };
}

function createController(
  app: ReturnType<typeof createAppMock>,
  settingsOverrides: Partial<PluginSettings> = {},
): EditorDropController {
  const settings: PluginSettings = { ...DEFAULT_SETTINGS, ...settingsOverrides };
  return new EditorDropController({
    app: app as unknown as App,
    getSettings: () => settings,
    getUiStrings: () => getUiStrings("en"),
  });
}

function createEditorMock(cursor = { line: 2, ch: 4 }) {
  return {
    offsetToPos: vi.fn((offset: number) => ({ line: 0, ch: offset })),
    posToOffset: vi.fn((position: { line: number; ch: number }) => position.ch),
    replaceRange: vi.fn(),
    setCursor: vi.fn(),
    getCursor: vi.fn(() => cursor),
  };
}

function createDropEvent(payload: string | null) {
  const event = {
    clientX: 120,
    clientY: 180,
    defaultPrevented: false,
    preventDefault: vi.fn(() => {
      event.defaultPrevented = true;
    }),
    dataTransfer: {
      dropEffect: "none",
      types: payload ? ["application/x-card-workspace-note"] : [],
      getData: vi.fn((type: string) => (type === "application/x-card-workspace-note" ? payload ?? "" : "")),
    },
  };
  return event;
}

function bindMarkdownEditorContext(editor: ReturnType<typeof createEditorMock>): unknown {
  const cmView = {};
  Object.assign(editor, { cm: cmView });
  const markdownView = new MarkdownView({} as never) as MarkdownView & { editor: typeof editor };
  markdownView.editor = editor as never;
  mockState.leavesByType["markdown"] = [{ view: markdownView, getRoot: vi.fn(() => null) }];
  return cmView;
}

describe("EditorDropController", () => {
  beforeEach(() => {
    mockState.notices = [];
    mockState.menus = [];
    mockState.leavesByType = {};
  });

  it("accepts custom dragover/drop through the editor extension path and opens the markdown ask menu", async () => {
    const app = createAppMock();
    const controller = createController(app, { dragInsertAction: "ask" });
    const file = new TFile();
    Object.assign(file, { path: "notes/Source.md", basename: "Source" });
    app.vault.getAbstractFileByPath.mockReturnValue(file as never);

    const editor = createEditorMock();
    const cmView = bindMarkdownEditorContext(editor);
    const event = createDropEvent(JSON.stringify({ path: "notes/Source.md", title: "Source" }));
    const handled = controller.handleDomDrop(event as unknown as DragEvent, cmView as never);
    await Promise.resolve();

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockState.menus).toHaveLength(1);
    expect(mockState.menus[0]?.positions).toEqual([{ x: 120, y: 180 }]);
    expect(mockState.menus[0]?.dom.classList.add).toHaveBeenCalledWith("fce-card-drag-insert-menu");
    expect(mockState.menus[0]?.items.map((item) => item.title)).toEqual([
      "Insert wiki link",
      "Insert embed link",
      "Insert card content",
      "Insert card title & content",
    ]);

    mockState.menus[0]?.items[0]?.onClick?.();
    await Promise.resolve();
    expect(editor.replaceRange).toHaveBeenCalledWith("[[Source]]", { line: 2, ch: 4 }, undefined, "card-workspace-drag");
    expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 14 });
  });

  it("allows dragover for plugin drag payload and sets copy drop effect", () => {
    const controller = createController(createAppMock());
    const event = {
      clientX: 80,
      clientY: 120,
      defaultPrevented: false,
      preventDefault: vi.fn(),
      dataTransfer: { dropEffect: "none", types: ["application/x-card-workspace-note"] },
    };

    expect(controller.handleDragOver(event as unknown as DragEvent)).toBe(true);
    expect(event.dataTransfer.dropEffect).toBe("copy");
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("rejects dragover without the plugin drag MIME type", () => {
    const controller = createController(createAppMock());
    const event = {
      defaultPrevented: false,
      preventDefault: vi.fn(),
      dataTransfer: { dropEffect: "none", types: ["text/plain"] },
    };

    expect(controller.handleDragOver(event as unknown as DragEvent)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("inserts title and content directly when configured", async () => {
    const app = createAppMock();
    const controller = createController(app, { dragInsertAction: "title-content" });
    const file = new TFile();
    Object.assign(file, { path: "notes/Source.md", basename: "Source" });
    app.vault.getAbstractFileByPath.mockReturnValue(file as never);
    app.vault.cachedRead.mockResolvedValue("Body");

    const editor = createEditorMock({ line: 1, ch: 2 });
    const event = createDropEvent(JSON.stringify({ path: "notes/Source.md", title: "Source" }));
    await controller.handleCardEditorDrop(event as unknown as DragEvent, editor as never, { editor } as never);

    expect(mockState.menus).toHaveLength(0);
    expect(editor.replaceRange).toHaveBeenCalledWith("# Source\n\nBody", { line: 1, ch: 2 }, undefined, "card-workspace-drag");
    expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 16 });
  });

  it("blocks unsupported configured content insertion for base files", async () => {
    const app = createAppMock();
    const controller = createController(app, { dragInsertAction: "content" });
    const file = new TFile();
    Object.assign(file, { path: "notes/Source.base", basename: "Source.base" });
    app.vault.getAbstractFileByPath.mockReturnValue(file as never);

    const editor = createEditorMock();
    const event = createDropEvent(JSON.stringify({ path: "notes/Source.base", title: "Source.base" }));
    controller.handleWorkspaceEditorDrop(event as unknown as DragEvent, editor as never, { editor } as never);
    await Promise.resolve();

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockState.menus).toHaveLength(0);
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(mockState.notices).toEqual(["This card type does not support that drag insertion action."]);
  });

  it("shows only wiki insert for excalidraw ask mode", async () => {
    const app = createAppMock();
    const controller = createController(app, { dragInsertAction: "ask" });
    const file = new TFile();
    Object.assign(file, { path: "notes/Sketch.excalidraw", basename: "Sketch.excalidraw" });
    app.vault.getAbstractFileByPath.mockReturnValue(file as never);

    const editor = createEditorMock();
    const event = createDropEvent(JSON.stringify({ path: "notes/Sketch.excalidraw", title: "Sketch.excalidraw" }));
    controller.handleWorkspaceEditorDrop(event as unknown as DragEvent, editor as never, { editor } as never);
    await Promise.resolve();

    expect(mockState.menus).toHaveLength(1);
    expect(mockState.menus[0]?.items.map((item) => item.title)).toEqual(["Insert wiki link"]);
  });

  it("ignores drops without the plugin drag MIME", async () => {
    const controller = createController(createAppMock());
    const editor = createEditorMock();
    const event = createDropEvent(null);
    controller.handleWorkspaceEditorDrop(event as unknown as DragEvent, editor as never, { editor } as never);
    await Promise.resolve();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mockState.menus).toHaveLength(0);
    expect(mockState.notices).toEqual([]);
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });
});
