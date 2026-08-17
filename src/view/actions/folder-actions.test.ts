import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockState,
  resetFolderCardViewHarness,
  createViewWithFile,
  registerFolderCardView,
} from "../../__mocks__/folder-card-view-harness";
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
});

describe("note creation targets", () => {
  beforeEach(() => {
    resetFolderCardViewHarness();
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
