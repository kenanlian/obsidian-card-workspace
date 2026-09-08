import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockState,
  resetFolderCardViewHarness,
  createViewWithFile,
  registerFolderCardView,
} from "../../__mocks__/folder-card-view-harness";
import { createBoxScope, createLinksScope } from "../scope";
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
