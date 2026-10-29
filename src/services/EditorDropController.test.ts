import { beforeEach, describe, expect, it, vi } from "vitest";

interface MenuEntry {
  title: string;
  icon: string;
  onClick: (() => void) | null;
  disabled: boolean;
  submenu: MenuState | null;
  dom: { style: { setProperty: ReturnType<typeof vi.fn> } };
}

interface MenuState {
  items: MenuEntry[];
  positions: Array<{ x: number; y: number }>;
  dom: { classList: { add: ReturnType<typeof vi.fn> } };
  hide: () => void;
}

const mockState = vi.hoisted(() => ({
  notices: [] as string[],
  copyFallbacks: [] as Array<{ value: string; readOnly: boolean; focus: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> }>,
  leavesByType: {} as Record<string, unknown[]>,
  menus: [] as MenuState[],
  submenuSupported: true,
}));

vi.mock("obsidian", () => {
  class MockNotice {
    constructor(message: string) {
      mockState.notices.push(message);
    }
  }

  class MockMenu {
    useNativeMenu = true;
    items: MenuEntry[] = [];
    positions: Array<{ x: number; y: number }> = [];
    dom = {
      classList: { add: vi.fn() },
      // Menu items stay detached until the menu is sorted for display.
      querySelectorAll: vi.fn((_selector: string) => [] as Element[]),
    };
    hideCallback: (() => void) | null = null;

    constructor() {
      mockState.menus.push(this);
    }

    setUseNativeMenu(useNativeMenu: boolean): this {
      this.useNativeMenu = useNativeMenu;
      return this;
    }

    addItem(configure: (item: {
      setTitle: (title: string) => unknown;
      setIcon: (icon: string) => unknown;
      setDisabled: (disabled: boolean) => unknown;
      setSubmenu: () => MockMenu | undefined;
      onClick: (callback: () => void) => unknown;
    }) => void): this {
      const entry: MenuEntry = { title: "", icon: "", onClick: null, disabled: false, submenu: null,
        dom: { style: { setProperty: vi.fn() } } };
      const item = {
        dom: entry.dom,
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
        setDisabled: (disabled: boolean) => {
          entry.disabled = disabled;
          return item;
        },
        setSubmenu: () => {
          if (!mockState.submenuSupported) return undefined;
          const submenu = new MockMenu();
          entry.submenu = submenu;
          return submenu;
        },
      };
      configure(item);
      this.items.push(entry);
      return this;
    }

    showAtPosition(position: { x: number; y: number }): void {
      this.positions.push(position);
    }

    addSeparator(): this {
      this.items.push({ title: "separator", icon: "", onClick: null, disabled: true, submenu: null,
        dom: { style: { setProperty: vi.fn() } } });
      return this;
    }

    onHide(callback: () => void): void { this.hideCallback = callback; }
    hide(): void { this.hideCallback?.(); }
  }

  class MockTAbstractFile {
    constructor(public path: string) {}
  }

  class MockTFile extends MockTAbstractFile {
    extension = "md";
    basename: string;
    stat = { ctime: 1, mtime: 1, size: 1 };

    constructor(path = "") {
      super(path);
      const leaf = path.split("/").at(-1) ?? "";
      this.basename = leaf.endsWith(".md") ? leaf.slice(0, -3) : leaf;
    }
  }

  return {
    Modal: class {
      contentEl = { createEl: () => { const field = { value: "", readOnly: false, focus: vi.fn(), select: vi.fn() }; mockState.copyFallbacks.push(field); return field; } };
      setTitle() {} open() {}
    },
    Notice: MockNotice,
    Menu: MockMenu,
    TAbstractFile: MockTAbstractFile,
    TFile: MockTFile,
    stripHeadingForLink: (heading: string) => heading.replace(/([:#|^\\\r\n]|%%|\[\[|]])/g, " ").replace(/\s+/g, " ").trim(),
    // Model native matching, including its first-match behavior for duplicate anchors.
    resolveSubpath: (cache: { headings?: HeadingCache[] }, anchor: string) => {
      const parts = anchor.split("#").filter(Boolean);
      const normalize = (value: string) => value.replace(/[!"#$%&()*+,.:;<=>?@^`{|}~/[\]\\\r\n]/g, " ")
        .replace(/\s+/g, " ").trim().toLowerCase();
      let part = 0;
      let level = 0;
      for (const heading of cache.headings ?? []) {
        if (heading.level > level && normalize(heading.heading) === normalize(parts[part])) {
          level = heading.level;
          if (++part === parts.length) return { type: "heading", current: heading };
        }
      }
      return null;
    },
    MarkdownView: class MockMarkdownView {
      constructor(public leaf: unknown) {}
    },
  };
});

vi.mock("@codemirror/view", () => ({
  EditorView: class MockEditorView {
    state = { doc: {} };
    posAtCoords(): null { return null; }
  },
}));

import type { App, HeadingCache } from "obsidian";
import { MarkdownView, TFile } from "obsidian";
import { EditorView } from "@codemirror/view";
import { getUiStrings } from "../i18n";
import { DEFAULT_SETTINGS, type PluginSettings } from "../settings";
import { EditorDropController } from "./EditorDropController";
import { extractHeadingSection } from "./heading-drag-insert";

function createAppMock() {
  return {
    workspace: {
      getLeavesOfType: vi.fn((type: string) => mockState.leavesByType[type] ?? []),
    },
    vault: {
      getAbstractFileByPath: vi.fn(() => null),
      cachedRead: vi.fn(async () => ""),
    },
    metadataCache: {
      getFileCache: vi.fn((): { headings?: HeadingCache[] } | null => null),
      fileToLinktext: vi.fn((file: TFile, _sourcePath: string, _omitExtension: boolean) => file.basename),
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
    getValue: vi.fn(() => "Target body"),
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
  const cmView = new EditorView();
  Object.assign(editor, { cm: cmView });
  const markdownView = new MarkdownView({} as never) as MarkdownView & { editor: typeof editor };
  markdownView.editor = editor as never;
  mockState.leavesByType["markdown"] = [{ view: markdownView, getRoot: vi.fn(() => null) }];
  return cmView;
}

function heading(content: string, raw: string, title: string, level: number, from = 0): HeadingCache {
  const offset = content.indexOf(raw, from);
  if (offset < 0) throw new Error(`Missing fixture heading: ${raw}`);
  const line = content.slice(0, offset).split("\n").length - 1;
  return {
    heading: title, level,
    position: {
      start: { offset, line, col: 0 },
      end: { offset: offset + raw.length, line: line + raw.split("\n").length - 1, col: raw.split("\n").at(-1)!.length },
    },
  };
}

function createFile(path: string): TFile {
  const file = new TFile();
  Object.assign(file, { path, basename: path.split("/").at(-1)!.replace(/\.md$/, "") });
  return file;
}

const sectionSource = "Prelude\n\n# Intro\n\nIntro body\n\n## **Method** ##\n\n  body  \n\n### Example\n\n```md\n# Not a heading\n```\n\n## Conclusion\n\nLast body\n\n# Empty\n\n# Final\n\nEnd  \n\n";
const sectionHeadings = [
  heading(sectionSource, "# Intro", "Intro", 1),
  heading(sectionSource, "## **Method** ##", "**Method**", 2),
  heading(sectionSource, "### Example", "Example", 3),
  heading(sectionSource, "## Conclusion", "Conclusion", 2),
  heading(sectionSource, "# Empty", "Empty", 1),
  heading(sectionSource, "# Final", "Final", 1),
];

async function startHeadingDrop(
  action: PluginSettings["dragInsertAction"] = "ask",
  content = sectionSource,
  headings: HeadingCache[] | null = sectionHeadings,
  overrides: Partial<PluginSettings> = {},
) {
  const app = createAppMock();
  const file = createFile("notes/Source.md");
  const target = createFile("target/Target.md");
  app.vault.getAbstractFileByPath.mockReturnValue(file as never);
  app.vault.cachedRead.mockResolvedValue(content);
  app.metadataCache.getFileCache.mockReturnValue(headings === null ? null : { headings });
  const controller = createController(app, { enableHeadingDragInsert: true, dragInsertAction: action, ...overrides });
  const editor = createEditorMock();
  const cm = bindMarkdownEditorContext(editor) as EditorView;
  const sourceEditor = createEditorMock();
  const sourceCm = new EditorView();
  Object.assign(sourceEditor, { cm: sourceCm });
  const sourceView = new MarkdownView({} as never);
  Object.assign(sourceView, { editor: sourceEditor, file });
  mockState.leavesByType.markdown.push({ view: sourceView });
  const info = { editor, file: target };
  const event = createDropEvent(JSON.stringify({ path: file.path, title: file.basename }));
  await controller.handleCardEditorDrop(event as unknown as DragEvent, editor as never, info as never);
  return { app, controller, file, target, editor, sourceEditor, cm, sourceCm, info, event, menu: mockState.menus[0] };
}

function choose(menu: MenuState, title: string): void {
  const entry = menu.items.find((item) => item.title === title);
  expect(entry?.disabled).toBe(false);
  expect(entry?.onClick).toBeTypeOf("function");
  entry!.onClick!();
  menu.hide();
}

describe("EditorDropController", () => {
  beforeEach(() => {
    mockState.notices = [];
    mockState.menus = [];
    mockState.leavesByType = {};
    mockState.submenuSupported = true;
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

  it("strips leading frontmatter when inserting content", async () => {
    const app = createAppMock();
    const controller = createController(app, { dragInsertAction: "content" });
    const file = new TFile();
    Object.assign(file, { path: "notes/Source.md", basename: "Source" });
    app.vault.getAbstractFileByPath.mockReturnValue(file as never);
    app.vault.cachedRead.mockResolvedValue("---\ntags:\n  - keep\n---\n\nBody");

    const editor = createEditorMock({ line: 1, ch: 2 });
    const event = createDropEvent(JSON.stringify({ path: "notes/Source.md", title: "Source" }));
    await controller.handleCardEditorDrop(event as unknown as DragEvent, editor as never, { editor } as never);

    expect(editor.replaceRange).toHaveBeenCalledWith("Body", { line: 1, ch: 2 }, undefined, "card-workspace-drag");
  });

  it("strips leading frontmatter when inserting title and content", async () => {
    const app = createAppMock();
    const controller = createController(app, { dragInsertAction: "title-content" });
    const file = new TFile();
    Object.assign(file, { path: "notes/Source.md", basename: "Source" });
    app.vault.getAbstractFileByPath.mockReturnValue(file as never);
    app.vault.cachedRead.mockResolvedValue("---\ntags:\n  - keep\n---\n\nBody");

    const editor = createEditorMock({ line: 1, ch: 2 });
    const event = createDropEvent(JSON.stringify({ path: "notes/Source.md", title: "Source" }));
    await controller.handleCardEditorDrop(event as unknown as DragEvent, editor as never, { editor } as never);

    expect(editor.replaceRange).toHaveBeenCalledWith("# Source\n\nBody", { line: 1, ch: 2 }, undefined, "card-workspace-drag");
  });

  it("blocks unsupported configured content insertion for base files", async () => {
    const app = createAppMock();
    const controller = createController(app, { dragInsertAction: "content" });
    const file = new TFile();
    Object.assign(file, { path: "notes/Source.base", basename: "Source.base" });
    app.vault.getAbstractFileByPath.mockReturnValue(file as never);

    const editor = createEditorMock();
    const event = createDropEvent(JSON.stringify({ path: "notes/Source.base", title: "Source.base" }));
    const handled = controller.handleWorkspaceEditorDrop(
      event as unknown as DragEvent,
      editor as never,
      { editor } as never,
    );
    await Promise.resolve();

    expect(handled).toBe(true);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mockState.menus).toHaveLength(0);
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(mockState.notices).toEqual(["This card type does not support that drag insertion action."]);
  });

  it.each(["png", "pdf", "mp3", "webm", "zip", "custom"])("offers only supported attachment insertion actions for %s", async (extension) => {
    const app = createAppMock();
    const controller = createController(app, { dragInsertAction: "ask" });
    const file = Object.assign(new TFile(), { path: `asset.${extension}`, basename: "asset" });
    app.vault.getAbstractFileByPath.mockReturnValue(file as never);
    const editor = createEditorMock();
    await controller.handleCardEditorDrop(createDropEvent(JSON.stringify({ path: file.path, title: file.basename })) as unknown as DragEvent,
      editor as never, { editor } as never);
    expect(mockState.menus[0]?.items.map((item) => item.title)).toEqual(["zip", "custom"].includes(extension)
      ? ["Insert wiki link"] : ["Insert wiki link", "Insert embed link"]);
    expect(app.vault.cachedRead).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("shows only wiki insert for excalidraw ask mode", async () => {
    const app = createAppMock();
    const controller = createController(app, { dragInsertAction: "ask" });
    const file = new TFile();
    Object.assign(file, { path: "notes/Sketch.excalidraw", basename: "Sketch.excalidraw" });
    app.vault.getAbstractFileByPath.mockReturnValue(file as never);

    const editor = createEditorMock();
    const event = createDropEvent(JSON.stringify({ path: "notes/Sketch.excalidraw", title: "Sketch.excalidraw" }));
    const handled = controller.handleWorkspaceEditorDrop(
      event as unknown as DragEvent,
      editor as never,
      { editor } as never,
    );
    await Promise.resolve();

    expect(handled).toBe(true);
    expect(mockState.menus).toHaveLength(1);
    expect(mockState.menus[0]?.items.map((item) => item.title)).toEqual(["Insert wiki link"]);
  });

  it("ignores drops without the plugin drag MIME", async () => {
    const controller = createController(createAppMock());
    const editor = createEditorMock();
    const event = createDropEvent(null);
    const handled = controller.handleWorkspaceEditorDrop(
      event as unknown as DragEvent,
      editor as never,
      { editor } as never,
    );
    await Promise.resolve();

    expect(handled).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mockState.menus).toHaveLength(0);
    expect(mockState.notices).toEqual([]);
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it("keeps the existing ask menu when section insertion is disabled", async () => {
    const { app, menu } = await startHeadingDrop("ask", sectionSource, sectionHeadings, { enableHeadingDragInsert: false });
    expect(menu.items.map((item) => item.title)).toEqual([
      "Insert wiki link", "Insert embed link", "Insert card content", "Insert card title & content",
    ]);
    expect(menu.items.every((item) => item.submenu === null)).toBe(true);
    expect(app.metadataCache.getFileCache).not.toHaveBeenCalled();
  });

  it("offers the same ordered sections and whole-note entry under all four ask actions without reading", async () => {
    const { menu, app } = await startHeadingDrop();
    expect(menu.items.map((item) => item.title)).toEqual([
      "Insert section link", "Insert embed link", "Insert section content", "Insert section heading & content",
    ]);
    const titles = ["Whole note", "separator", "Intro", "**Method**", "Example", "Conclusion", "Empty", "Final"];
    for (const action of menu.items) {
      const submenu = action.submenu!;
      expect(submenu.items.map((item) => item.title)).toEqual(titles);
      expect(submenu.dom.classList.add).toHaveBeenCalledWith("fce-card-drag-heading-menu");
      expect(submenu.items[0].icon).toBe("file-text");
      expect(submenu.items.slice(2).map((item) => item.icon)).toEqual([
        "heading-1", "heading-2", "heading-3", "heading-2", "heading-1", "heading-1",
      ]);
      submenu.items.slice(2).forEach((item, index) => {
        expect(item.dom.style.setProperty).toHaveBeenCalledWith("--fce-heading-depth", String([0, 1, 2, 1, 0, 0][index]));
      });
    }
    expect(app.vault.cachedRead).not.toHaveBeenCalled();
    expect(app.metadataCache.fileToLinktext).not.toHaveBeenCalled();
  });

  it.each([
    ["wiki", "[[notes/Source#**Method**]]"],
    ["embed", "![[notes/Source#**Method**]]"],
    ["content", "  body  \n\n### Example\n\n```md\n# Not a heading\n```"],
    ["title-content", "## **Method** ##\n\n  body  \n\n### Example\n\n```md\n# Not a heading\n```"],
  ] as const)("opens the section picker for fixed %s and inserts the selected range", async (action, expected) => {
    const { app, editor, menu } = await startHeadingDrop(action);
    app.metadataCache.fileToLinktext.mockReturnValue("notes/Source");
    expect(mockState.menus).toHaveLength(1);
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(app.vault.cachedRead).not.toHaveBeenCalled();
    choose(menu, "**Method**");
    await vi.waitFor(() => expect(editor.replaceRange).toHaveBeenCalledWith(expected, { line: 2, ch: 4 }, undefined, "card-workspace-drag"));
    if (action === "wiki" || action === "embed") {
      expect(app.metadataCache.fileToLinktext).toHaveBeenCalledWith(expect.any(TFile), "target/Target.md", true);
      expect(app.vault.cachedRead).not.toHaveBeenCalled();
    } else {
      expect(app.vault.cachedRead).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    ["wiki", "[[Source]]"], ["embed", "![[Source]]"],
    ["content", "Body"], ["title-content", "# Source\n\nBody"],
  ] as const)("preserves whole-note insertion for %s", async (action, expected) => {
    const { editor, menu } = await startHeadingDrop(action, "---\ntags: [x]\n---\n\nBody", []);
    choose(menu, "Whole note");
    await vi.waitFor(() => expect(editor.replaceRange).toHaveBeenCalledWith(expected, expect.anything(), undefined, "card-workspace-drag"));
  });

  it("opens an independent section menu when runtime submenus are unavailable", async () => {
    mockState.submenuSupported = false;
    const { menu, editor } = await startHeadingDrop();
    choose(menu, "Insert embed link");
    const picker = mockState.menus[1];
    expect(picker.positions).toEqual([{ x: 120, y: 180 }]);
    expect(picker.dom.classList.add).toHaveBeenCalledWith("fce-card-drag-heading-menu");
    choose(picker, "Final");
    expect(editor.replaceRange).toHaveBeenCalledWith("![[Source#Final]]", expect.anything(), undefined, "card-workspace-drag");
  });

  it.each([
    [[2, 3, 2], [0, 1, 0]],
    [[3, 2, 3], [1, 0, 1]],
    [[3, 3], [0, 0]],
    [[2, 4, 6], [0, 2, 4]],
  ])("indents headings %j relative to the highest level in the note", async (levels, depths) => {
    const content = levels.map((level, index) => `${"#".repeat(level)} Section ${index}`).join("\n");
    const headings = levels.map((level, index) => heading(content,
      `${"#".repeat(level)} Section ${index}`, `Section ${index}`, level));
    const { menu } = await startHeadingDrop("wiki", content, headings);
    expect(menu.dom.classList.add).toHaveBeenCalledWith("fce-card-drag-heading-menu");
    expect(menu.items[0].dom.style.setProperty).not.toHaveBeenCalled();
    menu.items.slice(2).forEach((item, index) => {
      expect(item.icon).toBe(`heading-${levels[index]}`);
      expect(item.dom.style.setProperty).toHaveBeenCalledWith("--fce-heading-depth", String(depths[index]));
    });
  });

  it.each([[], null] as const)("retains a whole-note entry and disabled hint when headings are %j", async (headings) => {
    const { menu, app, editor } = await startHeadingDrop("wiki", "Body", headings as HeadingCache[] | null);
    expect(menu.items.map((item) => item.title)).toEqual([
      "Whole note", "separator", headings === null
        ? "Heading metadata is unavailable. Try dropping the card again." : "No other sections to insert",
    ]);
    expect(menu.items[2]).toMatchObject({ disabled: true, onClick: null });
    expect(app.vault.cachedRead).not.toHaveBeenCalled();
    choose(menu, "Whole note");
    await vi.waitFor(() => expect(editor.replaceRange).toHaveBeenCalled());
  });

  it("cancels on menu dismissal and ignores callbacks retained from the cancelled menu", async () => {
    const { menu, editor, app } = await startHeadingDrop("content");
    menu.hide();
    menu.items[2].onClick?.();
    expect(app.vault.cachedRead).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it("copies the last section and does not insert a whitespace-only section", async () => {
    const { menu, editor, controller, event, info } = await startHeadingDrop("content");
    choose(menu, "Empty");
    await Promise.resolve();
    expect(editor.replaceRange).not.toHaveBeenCalled();
    await controller.handleCardEditorDrop(event as unknown as DragEvent, editor as never, info as never);
    choose(mockState.menus[1], "Final");
    await vi.waitFor(() => expect(editor.replaceRange).toHaveBeenCalledWith("End  ", expect.anything(), undefined, "card-workspace-drag"));
  });

  it.each(["content", "title-content"] as const)("preserves Setext and CRLF for %s", async (action) => {
    const content = "Title *original*\r\n================\r\n\r\n    indented  \r\n\r\nChild\r\n-----\r\n\r\nchild body\r\n\r\nNext\r\n====\r\nstop";
    const headings = [
      heading(content, "Title *original*\r\n================", "Title *original*", 1),
      heading(content, "Child\r\n-----", "Child", 2),
      heading(content, "Next\r\n====", "Next", 1),
    ];
    const { menu, editor } = await startHeadingDrop(action, content, headings);
    choose(menu, "Title *original*");
    const expected = `${action === "title-content" ? "Title *original*\r\n================\r\n\r\n" : ""}    indented  \r\n\r\nChild\r\n-----\r\n\r\nchild body`;
    await vi.waitFor(() => expect(editor.replaceRange).toHaveBeenCalledWith(expected, expect.anything(), undefined, "card-workspace-drag"));
  });

  it("handles a heading at EOF and all six heading levels", async () => {
    const content = "# A\n## B\n### C\n#### D\n##### E\n###### F";
    const headings = Array.from({ length: 6 }, (_, index) => heading(content, `${"#".repeat(index + 1)} ${"ABCDEF"[index]}`, "ABCDEF"[index], index + 1));
    const { menu, editor } = await startHeadingDrop("title-content", content, headings);
    expect(menu.items.slice(2).map((item) => item.title)).toEqual(["A", "B", "C", "D", "E", "F"]);
    choose(menu, "F");
    await vi.waitFor(() => expect(editor.replaceRange).toHaveBeenCalledWith("###### F", expect.anything(), undefined, "card-workspace-drag"));
    expect(extractHeadingSection(content, headings, headings[5], false)).toBe("");
  });

  it("disambiguates a duplicate heading using its parent heading path", async () => {
    const content = "# A\n## Same\nfirst\n# B\n## Same\nsecond";
    const headings = [heading(content, "# A", "A", 1), heading(content, "## Same", "Same", 2),
      heading(content, "# B", "B", 1), heading(content, "## Same", "Same", 2, content.indexOf("# B"))];
    const { menu, editor } = await startHeadingDrop("wiki", content, headings);
    menu.items.at(-1)?.onClick?.();
    expect(editor.replaceRange).toHaveBeenCalledWith("[[Source#B#Same]]", expect.anything(), undefined, "card-workspace-drag");
  });

  it("refuses an unaddressable repeated heading but still copies the selected original range", async () => {
    const content = "# Same\nfirst\n# Same\nsecond";
    const headings = [heading(content, "# Same", "Same", 1), heading(content, "# Same", "Same", 1, 1)];
    const { menu, app, editor, controller, event, info } = await startHeadingDrop("ask", content, headings);
    menu.items[0].submenu?.items.at(-1)?.onClick?.();
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(mockState.notices).toEqual(["Obsidian cannot link to this specific heading. Insert its content instead."]);
    expect(app.vault.cachedRead).not.toHaveBeenCalled();
    await controller.handleCardEditorDrop(event as unknown as DragEvent, editor as never, info as never);
    const root = [...mockState.menus].reverse().find((entry) => entry.items[0]?.title === "Insert section link")!;
    root.items[2].submenu?.items.at(-1)?.onClick?.();
    await vi.waitFor(() => expect(editor.replaceRange).toHaveBeenCalledWith("second", expect.anything(), undefined, "card-workspace-drag"));
  });

  it("uses native normalization for headings containing link delimiters", async () => {
    const content = "# Heading: has # and | symbols\nbody";
    const headings = [heading(content, content.split("\n")[0], "Heading: has # and | symbols", 1)];
    const { menu, editor } = await startHeadingDrop("wiki", content, headings);
    choose(menu, "Heading: has # and | symbols");
    expect(editor.replaceRange).toHaveBeenCalledWith("[[Source#Heading has and symbols]]", expect.anything(), undefined, "card-workspace-drag");
  });

  it.each(["base", "canvas", "excalidraw", "excalidraw.md"])("keeps existing behavior for %s cards when enabled", async (extension) => {
    const app = createAppMock();
    const file = createFile(`Source.${extension}`);
    app.vault.getAbstractFileByPath.mockReturnValue(file as never);
    const editor = createEditorMock();
    const controller = createController(app, { enableHeadingDragInsert: true });
    await controller.handleCardEditorDrop(createDropEvent(JSON.stringify({ path: file.path, title: file.basename })) as unknown as DragEvent, editor as never, { editor } as never);
    const titles = mockState.menus[0].items.map((item) => item.title);
    expect(titles).toEqual(extension.startsWith("excalidraw") ? ["Insert wiki link"] : ["Insert wiki link", "Insert embed link"]);
    expect(app.metadataCache.getFileCache).not.toHaveBeenCalled();
  });

  it("reports a failed content read without inserting", async () => {
    const { app, menu, editor } = await startHeadingDrop("content");
    app.vault.cachedRead.mockRejectedValue(new Error("Read failed"));
    choose(menu, "Intro");
    await vi.waitFor(() => expect(mockState.notices).toEqual(["Could not read the card source note."]));
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it("cancels when heading metadata changes after opening the menu", async () => {
    const { app, menu, editor } = await startHeadingDrop("content");
    app.metadataCache.getFileCache.mockReturnValue({ headings: [] });
    choose(menu, "Intro");
    expect(app.vault.cachedRead).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(mockState.notices).toEqual(["The source note or target editor changed. Drop the card again."]);
  });

  it.each(["source-delete", "source-mtime", "source-rename", "target-switch", "target-editor", "target-content", "editor-event", "source-editor-event", "vault-event", "folder-rename", "active-leaf", "new-drop", "new-drag", "drag-start", "dispose"])(
    "drops a pending read after %s", async (change) => {
      const { app, menu, editor, file, controller, info, event } = await startHeadingDrop("content");
      let finish!: (value: string) => void;
      app.vault.cachedRead.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      choose(menu, "**Method**");
      switch (change) {
        case "source-delete": app.vault.getAbstractFileByPath.mockReturnValue(null); break;
        case "source-mtime": file.stat.mtime++; break;
        case "source-rename": file.path = "Moved.md"; break;
        case "target-switch": info.file = createFile("Other.md"); break;
        case "target-editor": info.editor = createEditorMock(); break;
        case "target-content": editor.getValue.mockReturnValue("Changed body"); break;
        case "editor-event":
          editor.getValue.mockReturnValue("Changed body");
          controller.handleEditorChange(editor as never, info as never);
          editor.getValue.mockReturnValue("Target body");
          break;
        case "source-editor-event": controller.handleEditorChange(createEditorMock() as never, { file } as never); break;
        case "vault-event": controller.handleVaultMutation({ eventType: "modify", path: file.path, oldPath: null, isFolder: false, fileKind: "markdown" }); break;
        case "folder-rename": controller.handleVaultMutation({ eventType: "rename", path: "moved", oldPath: "notes", isFolder: true, fileKind: null }); break;
        case "active-leaf": controller.handleActiveLeafChange(null); break;
        case "new-drop": await controller.handleCardEditorDrop(event as unknown as DragEvent, editor as never, info as never); break;
        case "new-drag": controller.handleDragOver(createDropEvent("payload") as unknown as DragEvent); break;
        case "drag-start": controller.handleDragStart(createDropEvent("payload") as unknown as DragEvent); break;
        case "dispose": controller.dispose(); break;
      }
      finish(sectionSource);
      await Promise.resolve();
      expect(editor.replaceRange).not.toHaveBeenCalled();
      expect(mockState.notices).toEqual([]);
    },
  );

  it("retires successful insertions before synchronous editor-change and ignores repeated selections", async () => {
    const { controller, editor, menu, info } = await startHeadingDrop("wiki");
    editor.replaceRange.mockImplementation(() => controller.handleEditorChange(editor as never, info as never));
    const callback = menu.items[2].onClick;
    callback?.();
    callback?.();
    expect(editor.replaceRange).toHaveBeenCalledTimes(1);
    expect(editor.setCursor).toHaveBeenCalledTimes(1);
  });

  it("ignores a delayed editor-change event whose document still matches the drop snapshot", async () => {
    const { controller, editor, sourceEditor, file, menu, info } = await startHeadingDrop("wiki");
    controller.handleEditorChange(editor as never, info as never);
    controller.handleEditorChange(sourceEditor as never, { file } as never);
    choose(menu, "Intro");
    expect(editor.replaceRange).toHaveBeenCalledTimes(1);
  });

  it.each(["target", "source"])("rejects a changed %s CodeMirror document even if its text is unchanged and its event is delayed", async (which) => {
    const { menu, editor, app, cm, sourceCm } = await startHeadingDrop("content");
    Object.assign((which === "target" ? cm : sourceCm).state, { doc: {} });
    choose(menu, "Intro");
    expect(app.vault.cachedRead).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });
});

describe("mobile editor target insertion", () => {
  beforeEach(() => { mockState.notices = []; mockState.menus = []; mockState.leavesByType = {}; });
  function setup() {
    const app = createAppMock(), controller = createController(app);
    const source = createFile("Source.md"), target = createFile("Target.md"), editor = createEditorMock({ line: 0, ch: 3 });
    const view = Object.assign(new MarkdownView({} as never), { editor, file: target });
    mockState.leavesByType.markdown = [{ view }];
    app.vault.getAbstractFileByPath.mockImplementation(((path: string) => path === source.path ? source : path === target.path ? target : null) as never);
    const enter = () => {
      controller.handleActiveLeafChange({ view } as never);
      controller.handleActiveLeafChange({ view: { getViewType: () => "folder-card-view" } } as never);
    };
    return { app, controller, source, target, editor, view, enter };
  }
  async function open(f: ReturnType<typeof setup>) {
    const { Menu } = await import("obsidian"); const menu = new Menu();
    f.controller.appendMobileMenu(menu, f.source.path); return mockState.menus.at(-1)!;
  }
  it("captures the primary cursor before entry and inserts once without replacing the selection", async () => {
    const f = setup(); f.enter(); f.editor.getCursor.mockReturnValue({ line: 0, ch: 9 });
    const menu = await open(f); expect(menu.items[0].title).toBe("Insert into Target.md");
    const insert = menu.items.find(item => item.title === "Insert wiki link")!;
    insert.onClick!(); insert.onClick!(); await Promise.resolve(); await Promise.resolve();
    expect(f.editor.replaceRange).toHaveBeenCalledOnce(); expect(f.editor.replaceRange).toHaveBeenCalledWith("[[Source]]", { line: 0, ch: 3 }, undefined, "card-workspace-drag");
    f.controller.dispose();
  });
  it.each(["edited", "closed", "renamed", "switched", "document"])("rejects a target %s while the content read is pending", async kind => {
    const f = setup(), cm = new EditorView({} as never); Object.assign(f.editor, { cm }); f.enter();
    let finish!: (value: string) => void; f.app.vault.cachedRead.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const menu = await open(f); menu.items.find(item => item.title === "Insert card content")!.onClick!();
    if (kind === "edited") f.editor.getValue.mockReturnValue("changed");
    if (kind === "closed") mockState.leavesByType.markdown = [];
    if (kind === "renamed") f.target.path = "Renamed.md";
    if (kind === "switched") f.controller.handleActiveLeafChange({ view: new MarkdownView({} as never) } as never);
    if (kind === "document") Object.assign(cm.state, { doc: {} });
    finish("body"); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(f.editor.replaceRange).not.toHaveBeenCalled(); f.controller.dispose();
  });
  it("offers copy without a target and preserves non-Markdown file restrictions", async () => {
    const f = setup(); f.source.path = "Source.canvas"; f.source.extension = "canvas";
    const menu = await open(f);
    expect(menu.items[0].title).toBe("No valid Markdown editor target");
    expect(menu.items.some(item => item.title === "Copy · Insert wiki link")).toBe(true);
    expect(menu.items.some(item => item.title === "Copy · Insert embed link")).toBe(true);
    expect(menu.items.some(item => item.title.includes("card content"))).toBe(false); f.controller.dispose();
  });
  it("opens selectable text when mobile clipboard access fails", async () => {
    const f = setup(); mockState.copyFallbacks = [];
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    try {
      const menu = await open(f); menu.items.find(item => item.title === "Copy · Insert wiki link")!.onClick!();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(mockState.copyFallbacks[0]).toMatchObject({ value: "[[Source]]", readOnly: true });
      expect(mockState.copyFallbacks[0].select).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); f.controller.dispose(); }
  });

  it("captures the editor already active when the plugin was enabled", async () => {
    const f = setup();
    Object.assign(f.app.workspace, { getActiveViewOfType: () => f.view });
    f.controller.captureMenuTargetBeforeActivation();
    const menu = await open(f); expect(menu.items[0].title).toBe("Insert into Target.md"); f.controller.dispose();
  });
  it("invalidates a target renamed away and back before opening its menu", async () => {
    const f = setup(); f.enter();
    f.controller.handleVaultMutation({ type: "rename", path: "Renamed.md", oldPath: "Target.md", isMarkdown: true, isFolder: false } as never);
    const menu = await open(f); expect(menu.items[0].title).toBe("No valid Markdown editor target"); f.controller.dispose();
  });

});
