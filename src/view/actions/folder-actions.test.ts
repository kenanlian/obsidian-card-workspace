import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockState,
  resetFolderCardViewHarness,
  createViewWithFile,
  registerFolderCardView,
} from "../../__mocks__/folder-card-view-harness";
import { createBoxScope, createLinksScope, createFolderScope, type CardScope } from "../scope";
import { getUiStrings } from "../../i18n";
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
    const create = vi.fn(async (path: string, content: string) => {
      const file = new mockState.MockTFile(path); files.set(path, file);
      expect(JSON.parse(content)).toEqual({ type: "excalidraw", version: 2, elements: [], appState: {}, files: {} });
      return file;
    });
    const notify = vi.fn(), openNoteFromCard = vi.fn(), selectFolderFromNav = vi.fn(async () => undefined);
    const app = { vault: { getRoot: () => root, getAbstractFileByPath: (path: string) => files.get(path) ?? null, create } };
    const actions = new FolderActions({ context: { getApp: () => app, getUiStrings: () => getUiStrings(language), notify },
      getScope: () => scope, selectFolderFromNav, openNoteFromCard } as never);
    return { actions, create, notify, files, openNoteFromCard, selectFolderFromNav };
  }
  it.each(["en", "zh"] as const)("creates valid localized scenes at root and nested folders with unique names (%s)", async (language) => {
    const h = harness(language), base = getUiStrings(language).app.untitledNoteBaseName;
    for (const target of ["/", "notes"]) {
      await h.actions.createFromFolderTree(target, "excalidraw");
      await h.actions.createFromFolderTree(target, "excalidraw");
      await h.actions.createFromFolderTree(target, "excalidraw");
      const prefix = target === "/" ? "" : "notes/";
      for (const suffix of ["", " 1", " 2"]) {
        const path = `${prefix}${base}${suffix}.excalidraw`;
        expect(h.files.has(path)).toBe(true); expect(h.openNoteFromCard).toHaveBeenCalledWith(path, "new-tab");
      }
    }
    expect(h.notify).not.toHaveBeenCalled(); expect(h.selectFolderFromNav).not.toHaveBeenCalled();
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
