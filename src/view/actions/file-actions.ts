import { TFile, TFolder } from "obsidian";

import type { UiStrings } from "../../i18n";
import {
  copyContentToClipboard,
  copyTitleAndContentToClipboard,
  copyTitleToClipboard,
  deleteFileUsingObsidianPreference,
  duplicateFile,
  moveFile,
} from "../note-ops";
import { FolderPickerModal } from "../../FolderPickerModal";
import { isMarkdownCardKind, resolveCardFileKind } from "../file-kind";
import { RenameFileModal } from "../modals/RenameFileModal";
import type { ViewContext } from "../view-context";

export interface FileActionsDeps {
  context: ViewContext;
  /** Not moved: shared with folder-management code elsewhere in the view. */
  buildSiblingPath: (parentPath: string, fileName: string) => string;
}

/**
 * Single-card file operations: clipboard copies, duplicate, move, rename,
 * and delete, independent of the host view implementation.
 */
export class FileActions {
  constructor(private readonly deps: FileActionsDeps) {}

  private get strings(): UiStrings {
    return this.deps.context.getUiStrings();
  }

  async copyCardTitle(notePath: string): Promise<void> {
    const file = this.resolveLiveMarkdownFile(notePath);
    if (!file) {
      return;
    }

    await copyTitleToClipboard(this.deps.context.getApp(), file, this.strings.noteOps);
  }

  async copyCardContent(notePath: string): Promise<void> {
    const file = this.resolveLiveMarkdownFile(notePath);
    if (!file) {
      return;
    }

    await copyContentToClipboard(this.deps.context.getApp(), file, this.strings.noteOps);
  }

  async copyCardTitleAndContent(notePath: string): Promise<void> {
    const file = this.resolveLiveMarkdownFile(notePath);
    if (!file) {
      return;
    }

    await copyTitleAndContentToClipboard(this.deps.context.getApp(), file, this.strings.noteOps);
  }

  async makeCardFileCopy(notePath: string): Promise<void> {
    const file = this.deps.context.getApp().vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      return;
    }

    const result = await duplicateFile(this.deps.context.getApp(), file);
    if (!result.ok) {
      this.deps.context.notify(this.strings.app.failedToCopyFile(result.error));
    }
  }

  moveCardNote(notePath: string): void {
    const file = this.deps.context.getApp().vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      return;
    }

    this.openMoveFolderPicker(file);
  }

  renameCardFile(notePath: string): void {
    const file = this.deps.context.getApp().vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      return;
    }

    const modal = new RenameFileModal(
      this.deps.context.getApp(),
      { initialName: file.basename, strings: this.strings.view.rename },
      async (nextName: string) => {
        await this.submitRename(notePath, nextName);

        return true;
      },
    );
    modal.open();
  }

  resolveLiveMarkdownFile(notePath: string): TFile | null {
    const file = this.deps.context.getApp().vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      return null;
    }

    const fileKind = resolveCardFileKind(file);
    if (fileKind === null || !isMarkdownCardKind(fileKind)) {
      return null;
    }

    return file;
  }

  async submitRename(notePath: string, nextName: string): Promise<void> {
    const trimmedName = nextName.trim();
    if (trimmedName.length === 0) {
      this.deps.context.notify(this.strings.app.fileNameCannotBeEmpty);
      return;
    }

    const file = this.deps.context.getApp().vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      return;
    }

    const nextPath = this.deps.buildSiblingPath(
      file.parent?.path ?? "",
      this.buildRenamedFileName(file, trimmedName),
    );
    try {
      await this.deps.context.getApp().fileManager.renameFile(file, nextPath);
    } catch (error) {
      this.deps.context.notify(this.strings.app.failedToRenameFile(String(error)));
    }
  }

  async deleteCardFile(notePath: string): Promise<void> {
    const file = this.deps.context.getApp().vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      return;
    }

    try {
      const confirmed = await this.deps.context.getApp().fileManager.promptForDeletion(file);
      if (!confirmed) {
        return;
      }

      const liveFile = this.deps.context.getApp().vault.getAbstractFileByPath(notePath);
      if (!(liveFile instanceof TFile)) {
        return;
      }

      const result = await deleteFileUsingObsidianPreference(this.deps.context.getApp(), liveFile);
      if (!result.ok) {
        this.deps.context.notify(this.strings.app.failedToDeleteFile(result.error));
      }
    } catch (error) {
      this.deps.context.notify(this.strings.app.failedToDeleteFile(String(error)));
    }
  }

  openMoveFolderPicker(file: TFile): void {
    const modal = new FolderPickerModal(this.deps.context.getApp(), (targetFolder: TFolder) => {
      void this.onMoveTargetChosen(file.path, targetFolder);
    }, this.strings.folderPicker.selectFolderTitle);
    modal.open();
  }

  async onMoveTargetChosen(filePath: string, targetFolder: TFolder | null): Promise<void> {
    if (!(targetFolder instanceof TFolder)) {
      return;
    }

    const file = this.deps.context.getApp().vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      return;
    }

    const parentPath = file.parent?.path ?? "";
    if (parentPath === targetFolder.path) {
      return;
    }

    const result = await moveFile(this.deps.context.getApp(), file, targetFolder, this.strings.noteOps);
    if (!result.ok) {
      this.deps.context.notify(this.strings.app.failedToMoveFile(result.error));
    }
  }

  buildRenamedFileName(file: TFile, inputName: string): string {
    const trimmedName = inputName.trim();
    if (file.extension.length === 0) {
      return trimmedName;
    }

    const extensionSuffix = `.${file.extension}`;
    if (trimmedName.toLowerCase().endsWith(extensionSuffix.toLowerCase())) {
      return trimmedName;
    }

    return `${trimmedName}${extensionSuffix}`;
  }
}
