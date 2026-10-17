import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockState,
  resetFolderCardViewHarness,
  createViewWithFile,
  registerFolderCardView,
} from "../../__mocks__/folder-card-view-harness";
import { createBoxScope, createLinksScope, createFolderScope, type CardScope } from "../scope";
import { getUiStrings } from "../../i18n";
import { resolveCardFileKindFromPath } from "../file-kind";
import { FolderActions } from "./folder-actions";
import { FolderCardView } from "../FolderCardView";

registerFolderCardView(FolderCardView);

describe("FolderActions", () => {
  it("builds root and nested sibling paths without changing path semantics", () => {
    const actions = new FolderActions({ context: {} } as never);

    expect(actions.buildSiblingPath("/", "Untitled.md")).toBe("Untitled.md");
    expect(actions.buildSiblingPath("", "Untitled.md")).toBe("Untitled.md");
    expect(actions.buildSiblingPath("notes", "Untitled.md")).toBe("notes/Untitled.md");
  });

  it("does not rewrite folder scope after a rename while a links source is active", async () => {
    const moveScopeToFolder = vi.fn();
    const actions = new FolderActions({
      context: { store: { getScope: () => createLinksScope("notes/A.md", "outgoing") } },
      moveScopeToFolder,
    } as never);

    await (actions as any).refreshFolderScopeAfterFolderRename("notes", "renamed");

    expect(moveScopeToFolder).not.toHaveBeenCalled();
  });
});

describe("host folder deletion", () => {
  function harness(initialScope: CardScope = createFolderScope("notes/child", true)) {
    const folder = new mockState.MockTFolder("notes");
    const root = new mockState.MockTFolder("");
    const files = new Map([["notes", folder]]);
    let scope = initialScope;
    let selectionVersion = 0;
    const app = {
      vault: {
        getRoot: () => root,
        getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      },
      fileManager: {
        trashFile: vi.fn(async () => { files.delete("notes"); }),
        promptForDeletion: vi.fn(async (): Promise<unknown> => undefined),
      },
    };
    const notify = vi.fn(), moveScopeToFolder = vi.fn(), refreshFolderTreeState = vi.fn();
    const actions = new FolderActions({
      context: { getApp: () => app, getUiStrings: () => getUiStrings("en"), store: { getScope: () => scope }, notify },
      moveScopeToFolder, refreshFolderTreeState, getActiveSelectionVersion: () => selectionVersion,
    } as never);
    return { actions, app, folder, files, notify, moveScopeToFolder, refreshFolderTreeState,
      beginSelection: () => { selectionVersion += 1; },
      setScope: (next: CardScope) => { scope = next; selectionVersion += 1; } };
  }

  it.each([undefined, true])("returns to root after a host deletion returning %s, with one deletion", async (result) => {
    const h = harness();
    h.app.fileManager.promptForDeletion.mockImplementation(async () => {
      await h.app.fileManager.trashFile();
      return result;
    });
    await h.actions.deleteFolder("notes");
    expect(h.app.fileManager.trashFile).toHaveBeenCalledTimes(1);
    expect(h.moveScopeToFolder).toHaveBeenCalledExactlyOnceWith("");
    expect(h.refreshFolderTreeState).toHaveBeenCalledTimes(1);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it.each([undefined, false, true])("does not treat result %s as proof of deletion", async (result) => {
    const h = harness();
    h.app.fileManager.promptForDeletion.mockResolvedValue(result);
    await h.actions.deleteFolder("notes");
    expect(h.files.get("notes")).toBe(h.folder);
    expect(h.app.fileManager.trashFile).not.toHaveBeenCalled();
    expect(h.moveScopeToFolder).not.toHaveBeenCalled();
    expect(h.refreshFolderTreeState).not.toHaveBeenCalled();
  });

  it("does not mistake a renamed target for a deleted folder", async () => {
    const h = harness();
    h.app.fileManager.promptForDeletion.mockImplementation(async () => {
      h.files.delete("notes");
      h.folder.path = "renamed";
      h.files.set("renamed", h.folder);
    });
    await h.actions.deleteFolder("notes");
    expect(h.moveScopeToFolder).not.toHaveBeenCalled();
    expect(h.app.fileManager.trashFile).not.toHaveBeenCalled();
  });

  it.each([
    createFolderScope("other", true), createBoxScope("box"), createLinksScope("notes/A.md", "backlinks"),
  ])("preserves a scope selected while the deletion prompt is open: %j", async (next) => {
    const h = harness();
    let finish!: () => void;
    h.app.fileManager.promptForDeletion.mockImplementation(async () => {
      await new Promise<void>((resolve) => { finish = resolve; });
      await h.app.fileManager.trashFile();
    });
    const pending = h.actions.deleteFolder("notes");
    h.setScope(next);
    finish();
    await pending;
    expect(h.moveScopeToFolder).not.toHaveBeenCalled();
    expect(h.app.fileManager.trashFile).toHaveBeenCalledTimes(1);
  });

  it("does not fall back when a replacement occupies the original path", async () => {
    const h = harness();
    h.app.fileManager.promptForDeletion.mockImplementation(async () => {
      await h.app.fileManager.trashFile();
      h.files.set("notes", new mockState.MockTFolder("notes"));
      return true;
    });
    await h.actions.deleteFolder("notes");
    expect(h.moveScopeToFolder).not.toHaveBeenCalled();
  });

  it("preserves a pending selection whose new scope has not committed yet", async () => {
    const h = harness();
    h.app.fileManager.promptForDeletion.mockImplementation(async () => {
      h.beginSelection();
      await h.app.fileManager.trashFile();
    });
    await h.actions.deleteFolder("notes");
    expect(h.moveScopeToFolder).not.toHaveBeenCalled();
  });

  it("reports a failure and never requests deletion of vault root", async () => {
    const h = harness();
    h.app.fileManager.promptForDeletion.mockRejectedValue(new Error("permission denied"));
    await h.actions.deleteFolder("notes");
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify.mock.calls[0]?.[0]).toContain("permission denied");
    expect(h.moveScopeToFolder).not.toHaveBeenCalled();
    await h.actions.deleteFolder("/");
    expect(h.app.fileManager.promptForDeletion).toHaveBeenCalledTimes(1);
  });

  it("also protects host root folders whose path is slash", async () => {
    const h = harness();
    h.app.vault.getRoot().path = "/";
    await h.actions.deleteFolder("/");
    expect(h.app.fileManager.promptForDeletion).not.toHaveBeenCalled();
  });
});

describe("note creation targets", () => {
  beforeEach(() => {
    resetFolderCardViewHarness();
  });

  it("proceeds directly from a folder scope without re-selecting the folder (C6)", async () => {
    const { view, app, plugin } = createViewWithFile();
    app.vault.getRoot = vi.fn(() => new mockState.MockTFolder("/"));
    const selectFolder = vi.spyOn(view, "selectFolderFromNav").mockResolvedValue(undefined);

    await (view as any).modules.folderActions.createFromFolderTree("/", "note");

    expect(selectFolder).not.toHaveBeenCalled();
    expect(plugin.createNoteInFolder).toHaveBeenCalledWith("/", []);
  });

  it("leaves a box scope first so folder-tree creates land in browse mode (C6)", async () => {
    const { view, app, plugin } = createViewWithFile();
    app.vault.getRoot = vi.fn(() => new mockState.MockTFolder("/"));
    (view as any).cardScope = createBoxScope("box-1");
    const selectFolder = vi.spyOn(view, "selectFolderFromNav").mockResolvedValue(undefined);

    await (view as any).modules.folderActions.createFromFolderTree("/", "note");

    expect(selectFolder).toHaveBeenCalledTimes(1);
    expect(selectFolder).toHaveBeenCalledWith("/");
    expect(plugin.createNoteInFolder).toHaveBeenCalledWith("/", []);
  });

  it("leaves a links scope first so folder-tree creates land in browse mode", async () => {
    const { view, app, plugin } = createViewWithFile();
    app.vault.getRoot = vi.fn(() => new mockState.MockTFolder("/"));
    (view as any).cardScope = createLinksScope("notes/A.md", "backlinks");
    const selectFolder = vi.spyOn(view, "selectFolderFromNav").mockResolvedValue(undefined);

    await (view as any).modules.folderActions.createFromFolderTree("/", "note");

    expect(selectFolder).toHaveBeenCalledTimes(1);
    expect(selectFolder).toHaveBeenCalledWith("/");
    expect(plugin.createNoteInFolder).toHaveBeenCalledWith("/", []);
  });

    it("routes the vault-root scope through the root folder returned by the vault", async () => {
      const { view, app, plugin } = createViewWithFile();
      // Obsidian reports "/" as the root folder path.
      app.vault.getRoot = vi.fn(() => new mockState.MockTFolder("/"));

      await (view as any).modules.folderActions.createNoteIn("/", ["work"]);

      expect(app.vault.getRoot).toHaveBeenCalled();
      expect(plugin.createNoteInFolder).toHaveBeenCalledWith("/", ["work"]);
    });

    it("surfaces a notice instead of failing silently when creation throws", async () => {
      const { view, app, plugin } = createViewWithFile();
      app.vault.getRoot = vi.fn(() => new mockState.MockTFolder("/"));
      plugin.createNoteInFolder = vi.fn(async () => {
        throw new Error("permission denied");
      });

      await (view as any).modules.folderActions.createNoteIn("/");

      expect(mockState.noticeMessages).toContain("Failed to create file: Error: permission denied");
    });

    it("builds root-level sibling paths without a leading slash", () => {
      const { view } = createViewWithFile();

      expect((view as any).modules.folderActions.buildSiblingPath("/", "Untitled.md")).toBe("Untitled.md");
      expect((view as any).modules.folderActions.buildSiblingPath("", "Untitled.md")).toBe("Untitled.md");
      expect((view as any).modules.folderActions.buildSiblingPath("notes", "Untitled.md")).toBe("notes/Untitled.md");
    });
});

describe("shared folder move action", () => {
  function moveHarness(language: "en" | "zh" = "en") {
    const root = new mockState.MockTFolder("/");
    const source = new mockState.MockTFolder("a/source");
    const a = new mockState.MockTFolder("a"), b = new mockState.MockTFolder("b");
    Object.assign(source, { parent: a });
    const files = new Map([["a/source", source], ["a", a], ["b", b],
      ["a/source/child", new mockState.MockTFolder("a/source/child")]]);
    const renameFile = vi.fn(async (_folder: unknown, _path: string): Promise<void> => undefined);
    const app = { vault: { getRoot: () => root, getAbstractFileByPath: (path: string) => files.get(path) ?? null },
      fileManager: { renameFile } };
    const notify = vi.fn(), refreshFolderTreeState = vi.fn(), moveScopeToFolder = vi.fn();
    const actions = new FolderActions({ context: { getApp: () => app, getUiStrings: () => getUiStrings(language), notify,
      store: { getScope: () => createFolderScope("a/source/child", true) } }, refreshFolderTreeState, moveScopeToFolder,
      rewritePathAfterRename: (path: string, old: string, next: string) => path.replace(old, next),
    } as never);
    return { actions, source, b, files, renameFile, notify, refreshFolderTreeState, moveScopeToFolder };
  }
  it("routes picker and drag moves through the same public method", () => {
    const h = moveHarness();
    const move = vi.spyOn(h.actions, "moveFolderTo").mockResolvedValue(undefined);
    h.actions.openMoveFolderPickerForFolder("a/source");
    mockState.folderPickerInstances.at(-1)?.onChoose(h.b);
    expect(move).toHaveBeenCalledExactlyOnceWith("a/source", "b");
  });
  it("repairs a selected descendant after moving its ancestor and supports root targets", async () => {
    const h = moveHarness();
    await h.actions.moveFolderTo("a/source", "b");
    expect(h.renameFile).toHaveBeenCalledExactlyOnceWith(h.source, "b/source");
    expect(h.moveScopeToFolder).toHaveBeenCalledExactlyOnceWith("b/source/child");
    expect(h.refreshFolderTreeState).toHaveBeenCalledTimes(1);
    await h.actions.moveFolderTo("a/source", "/");
    expect(h.renameFile).toHaveBeenLastCalledWith(h.source, "source");
  });
  it.each(["en", "zh"] as const)("rejects a name collision with a localized notice (%s)", async (language) => {
    const h = moveHarness(language);
    h.files.set("b/source", new mockState.MockTFolder("b/source"));
    await h.actions.moveFolderTo("a/source", "b");
    expect(h.notify).toHaveBeenCalledExactlyOnceWith(getUiStrings(language).view.folderManagement.moveConflict);
    expect(h.renameFile).not.toHaveBeenCalled();
  });
  it("re-resolves both paths and rejects root, self, descendants, and current parent", async () => {
    const h = moveHarness();
    for (const [source, target] of [["missing", "b"], ["a/source", "gone"], ["/", "b"],
      ["a/source", "a/source"], ["a/source", "a/source/child"], ["a/source", "a"]]) {
      await h.actions.moveFolderTo(source, target);
    }
    h.files.delete("b");
    await h.actions.moveFolderTo("a/source", "b");
    expect(h.renameFile).not.toHaveBeenCalled();
    expect(h.refreshFolderTreeState).not.toHaveBeenCalled();
  });
  it("ignores concurrent submissions and releases the guard after API failure", async () => {
    const h = moveHarness();
    let reject!: (error: Error) => void;
    h.renameFile.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    const pending = h.actions.moveFolderTo("a/source", "b");
    await h.actions.moveFolderTo("a/source", "b");
    expect(h.renameFile).toHaveBeenCalledTimes(1);
    reject(new Error("permission denied"));
    await pending;
    expect(h.notify).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("permission denied"));
    expect(h.refreshFolderTreeState).not.toHaveBeenCalled();
    await h.actions.moveFolderTo("a/source", "b");
    expect(h.renameFile).toHaveBeenCalledTimes(2);
  });
});

describe("folder navigation intent wiring", () => {
  beforeEach(() => resetFolderCardViewHarness());
  it("routes folder drag intents to actions and layout without activating a source", () => {
    const { view } = createViewWithFile();
    const modules = (view as any).modules;
    const move = vi.spyOn(modules.folderActions, "moveFolderTo").mockResolvedValue(undefined);
    const reorder = vi.spyOn(modules.navLayout, "reorderFolders").mockResolvedValue(undefined);
    const expand = vi.spyOn(modules.navLayout, "expandFolderForDrag").mockImplementation(() => undefined);
    const clear = vi.spyOn(modules.navLayout, "clearFolderDrag").mockImplementation(() => undefined);
    const select = vi.spyOn(view, "selectFolderFromNav").mockResolvedValue(undefined);
    view.handleNavigationIntent({ type: "move-folder", sourcePath: "A", targetFolderPath: "B" });
    view.handleNavigationIntent({ type: "reorder-folders", sourcePath: "A", targetPath: "B", position: "after" });
    view.handleNavigationIntent({ type: "drag-expand-folder", path: "B" });
    view.handleNavigationIntent({ type: "clear-folder-drag" });
    expect(move).toHaveBeenCalledExactlyOnceWith("A", "B");
    expect(reorder).toHaveBeenCalledExactlyOnceWith("A", "B", "after");
    expect(expand).toHaveBeenCalledExactlyOnceWith("B");
    expect(clear).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
  });
});

describe("Excalidraw creation", () => {
  function harness(language: "en" | "zh", scope: CardScope = createFolderScope("notes", true)) {
    const root = new mockState.MockTFolder("/"), folder = new mockState.MockTFolder("notes");
    const files = new Map<string, unknown>([["notes", folder]]);
    const create = vi.fn(async (path: string, _content: string) => {
      const file = new mockState.MockTFile(path); files.set(path, file);
      return file;
    });
    // A freshly created .md has no metadata yet: the ordinary opener stays Markdown.
    let viewState: { type: string; state?: { file?: string }; active?: boolean } = { type: "empty" };
    const leaf = {
      setViewState: vi.fn(async (next: typeof viewState) => { viewState = next; }),
      loadIfDeferred: vi.fn(async () => undefined),
      getViewState: () => viewState,
      detach: vi.fn(),
    };
    const plugin: { _loaded?: boolean; isReady?: boolean } = { _loaded: true, isReady: true };
    const getPlugin = vi.fn((_id: string): unknown => plugin);
    const getLeaf = vi.fn(() => leaf);
    const notify = vi.fn(), selectFolderFromNav = vi.fn(async () => undefined);
    const openNoteFromCard = vi.fn(async (path: string) => {
      await leaf.setViewState({ type: "markdown", state: { file: path } });
    });
    const createNoteInFolder = vi.fn();
    const app = {
      vault: { getRoot: () => root, getAbstractFileByPath: (path: string) => files.get(path) ?? null, create },
      plugins: { getPlugin }, workspace: { getLeaf },
      viewRegistry: { getViewCreatorByType: vi.fn((_type: string): unknown => () => leaf) },
      metadataCache: { getCache: vi.fn(() => null) },
    };
    const actions = new FolderActions({ context: { getApp: () => app, getUiStrings: () => getUiStrings(language), notify },
      getScope: () => scope, selectFolderFromNav, openNoteFromCard, createNoteInFolder } as never);
    return { actions, app, plugin, getPlugin, getLeaf, leaf, create, notify, files, openNoteFromCard,
      selectFolderFromNav, createNoteInFolder };
  }
  it("opens the first view as a drawing even before metadata recognizes the file", async () => {
    const h = harness("en");
    expect(h.app.metadataCache.getCache()).toBeNull();
    await h.actions.createFromFolderTree("notes", "excalidraw");
    expect(h.leaf.setViewState.mock.calls.map(([state]) => state.type)).toEqual(["excalidraw"]);
    expect(h.getPlugin).toHaveBeenCalledWith("obsidian-excalidraw-plugin");
    expect(h.getLeaf).toHaveBeenCalledExactlyOnceWith("tab");
    expect(h.leaf.getViewState()).toEqual({ type: "excalidraw", state: { file: "notes/Untitled.excalidraw.md" }, active: true });
    expect(h.leaf.loadIfDeferred).toHaveBeenCalledTimes(1);
    expect(h.openNoteFromCard).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });
  it.each(["en", "zh"] as const)("rejects missing, disabled, loading or incompatible plugins without writes or tabs (%s)", async (language) => {
    for (const plugin of [null, undefined, {}, { _loaded: false, isReady: true }, { _loaded: true, isReady: false },
      { _loaded: true }, { isReady: true }]) {
      const h = harness(language, createBoxScope("box"));
      h.getPlugin.mockReturnValue(plugin);
      await h.actions.createFromFolderTree("notes", "excalidraw");
      expect(h.notify).toHaveBeenCalledExactlyOnceWith(language === "en"
        ? "Please install and enable Excalidraw before creating a drawing."
        : "请先安装并启用 Excalidraw 插件，再新建绘图。");
      expect(h.create).not.toHaveBeenCalled();
      expect(h.getLeaf).not.toHaveBeenCalled();
      expect(h.openNoteFromCard).not.toHaveBeenCalled();
      expect(h.selectFolderFromNav).not.toHaveBeenCalled();
    }
    const h = harness(language);
    Reflect.deleteProperty(h.app, "plugins");
    await h.actions.createFromFolderTree("notes", "excalidraw");
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.create).not.toHaveBeenCalled();
  });
  it("does not create a drawing when the plugin's view capability is unavailable", async () => {
    const h = harness("en");
    h.app.viewRegistry.getViewCreatorByType.mockReturnValue(undefined);
    await h.actions.createFromFolderTree("notes", "excalidraw");
    expect(h.app.viewRegistry.getViewCreatorByType).toHaveBeenCalledWith("excalidraw");
    expect(h.create).not.toHaveBeenCalled();
    expect(h.getLeaf).not.toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(h.app, "viewRegistry");
    await h.actions.createFromFolderTree("notes", "excalidraw");
    expect(h.create).not.toHaveBeenCalled();
  });
  it("keeps a valid drawing but opens no tab if the plugin unloads during the write", async () => {
    const h = harness("en");
    h.create.mockImplementationOnce(async (path: string) => {
      const file = new mockState.MockTFile(path); h.files.set(path, file);
      h.plugin._loaded = false; return file;
    });
    await h.actions.createFromFolderTree("notes", "excalidraw");
    expect(h.files.has("notes/Untitled.excalidraw.md")).toBe(true);
    expect(h.getLeaf).not.toHaveBeenCalled();
    expect(h.openNoteFromCard).not.toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("Drawing created, but could not open Excalidraw"));
  });
  it("rechecks availability after selecting the target folder", async () => {
    const h = harness("en", createLinksScope("a.md", "outgoing"));
    h.selectFolderFromNav.mockImplementation(async () => { h.plugin._loaded = false; });
    await h.actions.createFromFolderTree("notes", "excalidraw");
    expect(h.create).not.toHaveBeenCalled();
    expect(h.getLeaf).not.toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledTimes(1);
  });
  it.each(["en", "zh"] as const)("reports view failures and preserves the drawing without a Markdown fallback (%s)", async (language) => {
    const h = harness(language);
    h.leaf.setViewState.mockRejectedValueOnce(new Error("view failed"));
    await h.actions.createFromFolderTree("notes", "excalidraw");
    expect(h.files.has(`notes/${getUiStrings(language).app.untitledNoteBaseName}.excalidraw.md`)).toBe(true);
    expect(h.notify).toHaveBeenCalledExactlyOnceWith(language === "en"
      ? "Drawing created, but could not open Excalidraw: Error: view failed"
      : "绘图已创建，但无法打开 Excalidraw：Error: view failed");
    expect(h.leaf.detach).toHaveBeenCalledTimes(1);
    expect(h.openNoteFromCard).not.toHaveBeenCalled();
  });
  it("awaits view opening and reports a host that fails to enter the requested drawing view", async () => {
    const h = harness("en");
    let finish!: () => void;
    h.leaf.setViewState.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    let settled = false;
    const pending = h.actions.createFromFolderTree("notes", "excalidraw").then(() => { settled = true; });
    await vi.waitFor(() => expect(h.leaf.setViewState).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    finish(); await pending;
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.leaf.detach).toHaveBeenCalledTimes(1);
    expect(h.openNoteFromCard).not.toHaveBeenCalled();
  });
  it.each(["canvas", "base", "note"] as const)("keeps %s creation independent of Excalidraw", async (kind) => {
    const h = harness("en"); h.getPlugin.mockReturnValue(null);
    await h.actions.createFromFolderTree("notes", kind);
    if (kind === "note") {
      expect(h.createNoteInFolder).toHaveBeenCalledExactlyOnceWith("notes", []);
      expect(h.create).not.toHaveBeenCalled();
    } else {
      expect(h.create).toHaveBeenCalledTimes(1);
      expect(h.openNoteFromCard).toHaveBeenCalledExactlyOnceWith(`notes/Untitled.${kind}`, "new-tab");
    }
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.getPlugin).not.toHaveBeenCalled();
  });
  it.each(["en", "zh"] as const)("creates a Markdown drawing with an uncompressed empty scene (%s)", async (language) => {
    const h = harness(language);
    await h.actions.createFromFolderTree("notes", "excalidraw");
    expect(h.create).toHaveBeenCalledTimes(1);
    const [path, content] = h.create.mock.calls[0]!;
    expect(path).toBe(`notes/${getUiStrings(language).app.untitledNoteBaseName}.excalidraw.md`);
    expect(content).toMatch(/^---\nexcalidraw-plugin: parsed\ntags: \[excalidraw\]\n---\n/);
    expect(content.split("\n")[4]).toBe("==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠== You can decompress Drawing data with the command palette: 'Decompress current Excalidraw file'. For more info check in plugin settings under 'Saving'");
    expect(content).toContain("\n\n# Excalidraw Data\n\n## Text Elements\n%%\n## Drawing\n```json\n");
    expect([...content.matchAll(/^%%$/gm)]).toHaveLength(2);
    const blocks = [...content.matchAll(/^```([^\n]*)\n([\s\S]*?)^```$/gm)];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]![1]).toBe("json");
    expect(JSON.parse(blocks[0]![2]!)).toEqual({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} });
    expect(content.endsWith("\n```\n%%\n")).toBe(true);
    expect(content).not.toContain("\r");
    expect(h.notify).not.toHaveBeenCalled();
  });
  it.each(["en", "zh"] as const)("creates localized Markdown drawings at root and nested folders with unique names (%s)", async (language) => {
    const h = harness(language), base = getUiStrings(language).app.untitledNoteBaseName;
    for (const target of ["/", "notes"]) {
      await h.actions.createFromFolderTree(target, "excalidraw");
      await h.actions.createFromFolderTree(target, "excalidraw");
      await h.actions.createFromFolderTree(target, "excalidraw");
      const prefix = target === "/" ? "" : "notes/";
      for (const suffix of ["", " 1", " 2"]) {
        const path = `${prefix}${base}${suffix}.excalidraw.md`;
        expect(h.files.has(path)).toBe(true);
        expect(h.leaf.setViewState).toHaveBeenCalledWith({ type: "excalidraw", state: { file: path }, active: true });
        expect(resolveCardFileKindFromPath(path)).toBe("excalidraw");
      }
    }
    expect(h.create).toHaveBeenCalledTimes(6);
    expect(new Set(h.create.mock.calls.map(([, content]) => content)).size).toBe(1);
    expect(h.notify).not.toHaveBeenCalled(); expect(h.selectFolderFromNav).not.toHaveBeenCalled();
  });
  it("supports an empty root path and preserves existing files when resolving collisions", async () => {
    const h = harness("en"), base = getUiStrings("en").app.untitledNoteBaseName;
    const occupied = new mockState.MockTFile(`${base}.excalidraw.md`);
    h.files.set(occupied.path, occupied);
    h.files.set(`${base} 1.excalidraw.md`, new mockState.MockTFolder(`${base} 1.excalidraw.md`));
    await h.actions.createFromFolderTree("", "excalidraw");
    expect(h.create).toHaveBeenCalledExactlyOnceWith(`${base} 2.excalidraw.md`, expect.any(String));
    expect(h.files.get(occupied.path)).toBe(occupied);
    expect(h.leaf.setViewState).toHaveBeenCalledExactlyOnceWith({
      type: "excalidraw", state: { file: `${base} 2.excalidraw.md` }, active: true,
    });
  });
  it.each([createBoxScope("box"), createLinksScope("a.md", "outgoing")])("switches %j to the target folder before creating", async (scope) => {
    const h = harness("en", scope); await h.actions.createFromFolderTree("notes", "excalidraw");
    expect(h.selectFolderFromNav).toHaveBeenCalledExactlyOnceWith("notes");
    expect(h.selectFolderFromNav.mock.invocationCallOrder[0]).toBeLessThan(h.create.mock.invocationCallOrder[0]);
  });
  it("reports invalid targets and write failures without opening a tab", async () => {
    const h = harness("en"); h.files.delete("notes");
    await h.actions.createFromFolderTree("notes", "excalidraw"); expect(h.create).not.toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledWith(getUiStrings("en").view.folderManagement.folderNotFound);
    h.create.mockRejectedValueOnce(new Error("disk full"));
    await h.actions.createFromFolderTree("/", "excalidraw");
    expect(h.notify).toHaveBeenLastCalledWith(expect.stringContaining("disk full")); expect(h.openNoteFromCard).not.toHaveBeenCalled();
  });
});
