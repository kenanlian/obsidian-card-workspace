import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockState,
  resetFolderCardViewHarness,
  createViewWithFile,
  createMarkdownFile,
  createFolder,
  clickLatestModalButton,
  setLatestModalTextInput,
  flushAsyncWork,
  buildNoteOpsMock,
  registerFolderCardView,
} from "../../__mocks__/folder-card-view-harness";

vi.mock("../note-ops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../note-ops")>();
  return buildNoteOpsMock(actual);
});

import { FileActions } from "./file-actions";
import { FolderCardView } from "../FolderCardView";
import { getUiStrings } from "../../i18n";
import {
  copyContentToClipboard,
  copyTitleAndContentToClipboard,
  copyTitleToClipboard,
  deleteFileUsingObsidianPreference,
  duplicateFile,
  moveFile,
} from "../note-ops";

registerFolderCardView(FolderCardView);

describe("FileActions", () => {
  it("ignores a path that no longer resolves to a live markdown file", () => {
    const actions = new FileActions({
      context: {
        getApp: () => ({ vault: { getAbstractFileByPath: () => null } }),
      } as never,
      buildSiblingPath: (parent, name) => parent ? `${parent}/${name}` : name,
    });

    expect(actions.resolveLiveMarkdownFile("missing.md")).toBeNull();
  });
});

describe("FileActions card copy/move/rename/delete", () => {
  beforeEach(() => {
    resetFolderCardViewHarness();
  });

  it("copyCardTitle delegates to copyTitleToClipboard exactly once", async () => {
    const { view, file, app } = createViewWithFile("notes/copy-target.md");

    await (view as any).modules.fileActions.copyCardTitle(file.path);

    expect(copyTitleToClipboard).toHaveBeenCalledTimes(1);
    expect(copyTitleToClipboard).toHaveBeenCalledWith(app, file, getUiStrings("en").noteOps);
  });

  it("copyCardContent delegates to copyContentToClipboard exactly once", async () => {
    const { view, file, app } = createViewWithFile("notes/copy-target.md");

    await (view as any).modules.fileActions.copyCardContent(file.path);

    expect(copyContentToClipboard).toHaveBeenCalledTimes(1);
    expect(copyContentToClipboard).toHaveBeenCalledWith(app, file, getUiStrings("en").noteOps);
  });

  it("copyCardTitleAndContent delegates to copyTitleAndContentToClipboard exactly once", async () => {
    const { view, file, app } = createViewWithFile("notes/copy-target.md");

    await (view as any).modules.fileActions.copyCardTitleAndContent(file.path);

    expect(copyTitleAndContentToClipboard).toHaveBeenCalledTimes(1);
    expect(copyTitleAndContentToClipboard).toHaveBeenCalledWith(app, file, getUiStrings("en").noteOps);
  });

  it("clipboard copy handlers safely no-op when file no longer exists", async () => {
    const { view, app } = createViewWithFile("notes/existing.md");
    const missingPath = "notes/deleted.md";
    app.vault.getAbstractFileByPath = vi.fn(() => null);

    await (view as any).modules.fileActions.copyCardTitle(missingPath);
    await (view as any).modules.fileActions.copyCardContent(missingPath);
    await (view as any).modules.fileActions.copyCardTitleAndContent(missingPath);

    expect(copyTitleToClipboard).not.toHaveBeenCalled();
    expect(copyContentToClipboard).not.toHaveBeenCalled();
    expect(copyTitleAndContentToClipboard).not.toHaveBeenCalled();
  });

  it("moveCardNote opens FolderPickerModal for the clicked file", () => {
    const { view, file } = createViewWithFile("notes/move-target.md");
    const openMoveFolderPickerSpy = vi.spyOn((view as any).modules.fileActions, "openMoveFolderPicker");

    (view as any).modules.fileActions.moveCardNote(file.path);

    expect(openMoveFolderPickerSpy).toHaveBeenCalledTimes(1);
    expect(openMoveFolderPickerSpy).toHaveBeenCalledWith(file);
    expect(mockState.folderPickerInstances).toHaveLength(1);
    expect(mockState.folderPickerInstances[0]?.open).toHaveBeenCalledTimes(1);
  });

  it("move selection no-ops when no folder is chosen", async () => {
    const { view, file } = createViewWithFile("notes/no-selection.md");

    (view as any).modules.fileActions.moveCardNote(file.path);
    const picker = mockState.folderPickerInstances[0];
    expect(picker).toBeDefined();

    await picker?.onChoose(null);

    expect(moveFile).not.toHaveBeenCalled();
    expect(mockState.noticeMessages).toHaveLength(0);
  });

  it("move selection no-ops when destination equals current parent folder", async () => {
    const { view, file } = createViewWithFile("notes/same-folder.md");

    (view as any).modules.fileActions.moveCardNote(file.path);
    const picker = mockState.folderPickerInstances[0];
    const sameFolder = createFolder("notes");

    await picker?.onChoose(sameFolder);

    expect(moveFile).not.toHaveBeenCalled();
    expect(mockState.noticeMessages).toHaveLength(0);
  });

  it("move selection re-resolves file and calls moveFile exactly once for different folder", async () => {
    const { view, file, app } = createViewWithFile("notes/move-me.md");
    const destination = createFolder("archive");

    (view as any).modules.fileActions.moveCardNote(file.path);
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

    (view as any).modules.fileActions.moveCardNote(file.path);
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

    (view as any).modules.fileActions.moveCardNote(file.path);
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

    await (view as any).modules.cardMenu.routeAction("make-copy", "notes/original.md");

    expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith("notes/original.md");
    expect(duplicateFile).toHaveBeenCalledTimes(1);
    expect(duplicateFile).toHaveBeenCalledWith(app, liveFile);

    await (view as any).modules.cardMenu.routeAction("rename", "notes/original.md");

    const renameModal = mockState.modalInstances.at(-1);
    expect(renameModal?.title).toBe("Rename file");
    expect(renameModal?.textInputs[0]?.value).toBe("original");

    setLatestModalTextInput(0, "renamed");
    clickLatestModalButton("Rename");
    await flushAsyncWork();

    expect(app.vault.getAbstractFileByPath).toHaveBeenLastCalledWith("notes/original.md");
    expect(app.fileManager.renameFile).toHaveBeenCalledTimes(1);
    expect(app.fileManager.renameFile).toHaveBeenCalledWith(liveFile, "notes/renamed.md");
  });

  it("rename accepts a basename input that already includes the original extension", async () => {
    const { view, app } = createViewWithFile("notes/original.md");
    const liveFile = createMarkdownFile("notes/original.md");
    app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
      if (requestedPath === "notes/original.md") {
        return liveFile;
      }
      return null;
    });

    await (view as any).modules.cardMenu.routeAction("rename", "notes/original.md");

    setLatestModalTextInput(0, "renamed.md");
    clickLatestModalButton("Rename");
    await flushAsyncWork();

    expect(app.fileManager.renameFile).toHaveBeenCalledTimes(1);
    expect(app.fileManager.renameFile).toHaveBeenCalledWith(liveFile, "notes/renamed.md");
  });

  it("delete prompts before using the preference-aware delete helper and move failures use file-neutral notices", async () => {
    const { view, file, app } = createViewWithFile("notes/delete-me.md", {
      promptForDeletion: async () => false,
    });

    await (view as any).modules
      .cardMenu.routeAction("delete", file.path);
    expect(app.fileManager.promptForDeletion).toHaveBeenCalledTimes(1);
    expect(app.fileManager.promptForDeletion).toHaveBeenCalledWith(file);
    expect(deleteFileUsingObsidianPreference).not.toHaveBeenCalled();
    expect(app.fileManager.trashFile).not.toHaveBeenCalled();

    app.fileManager.promptForDeletion = vi.fn(async () => true);
    await (view as any).modules.cardMenu.routeAction("delete", file.path);
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

    (view as any).modules.fileActions.moveCardNote(file.path);
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

    await (view as any).modules.cardMenu.routeAction("delete", file.path);

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

    await (view as any).modules
      .cardMenu.routeAction("delete", file.path);

    expect(app.fileManager.promptForDeletion).toHaveBeenCalledTimes(1);
    expect(app.fileManager.promptForDeletion).toHaveBeenCalledWith(file);
    expect(deleteFileUsingObsidianPreference).toHaveBeenCalledTimes(1);
    expect(deleteFileUsingObsidianPreference).toHaveBeenCalledWith(app, liveFile);
  });
});
