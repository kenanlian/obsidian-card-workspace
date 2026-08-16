import { TFolder } from "obsidian";

import { FolderPickerModal } from "../../FolderPickerModal";
import type { UiStrings } from "../../i18n";
import type { OpenDestination } from "../../settings";
import { CreateFolderModal } from "../modals/CreateFolderModal";
import { resolveUniquePath, trashAbstractFileUsingObsidianPreference } from "../note-ops";
import { normalizeScopePath, scopeDisplayPath } from "../scope";
import type { SelectionResult } from "../types";
import type { ViewContext } from "../view-context";
import {
  buildSiblingPath,
  countFilesInFolder,
  getFallbackFolderPathAfterFolderDeletion,
} from "./folder-action-helpers";

/** JSON Canvas requires the two top-level arrays; Obsidian rewrites the file on first save. */
const NEW_CANVAS_CONTENT = '{"nodes":[],"edges":[]}';
const NEW_BASE_CONTENT = "views:\n  - type: table\n    name: Table\n";
const FOLDER_DUPLICATE_CONFIRM_THRESHOLD = 50;

/** Capabilities needed by moved methods that are not themselves moved methods. */
export interface FolderActionsDeps {
  context: ViewContext;
  isBoxMode: () => boolean;
  selectFolderFromNav: (path: string) => Promise<void>;
  moveScopeToFolder: (path: string) => Promise<SelectionResult>;
  resetSearchQuery: () => void;
  /** Search focus remains host-owned rather than shared-store state. */
  bumpSearchFocusToken: () => void;
  refreshFolderTreeState: () => void;
  rewritePathAfterRename: (currentPath: string, oldPath: string, newPath: string) => string;
  requestDestructiveConfirmation: (options: {
    title: string;
    message: string;
    confirmButtonText: string;
  }) => Promise<boolean>;
  createNoteInFolder: (folderPath: string, tags: string[]) => Promise<void>;
  openNoteFromCard: (path: string, destination?: OpenDestination) => Promise<void>;
}

/** Folder create/rename/move/duplicate/delete actions. */
export class FolderActions {
  constructor(private readonly deps: FolderActionsDeps) {}

  private get strings(): UiStrings {
    return this.deps.context.getUiStrings();
  }

  getFolderManagementStrings(): UiStrings["view"]["folderManagement"] {
    return this.strings.view.folderManagement;
  }

  /** Shared with file actions for note rename paths. */
  buildSiblingPath(parentPath: string, fileName: string): string {
    return buildSiblingPath(parentPath, fileName);
  }

  resolveFolderFromUiPath(folderPath: string): TFolder | null {
    const normalizedPath = normalizeScopePath(folderPath);
    const app = this.deps.context.getApp();
    const folder = normalizedPath === ""
      ? app.vault.getRoot()
      : app.vault.getAbstractFileByPath(normalizedPath);
    return folder instanceof TFolder ? folder : null;
  }

  private openCreateChildFolderModal(parentFolderPath: string): void {
    const parentFolder = this.resolveFolderFromUiPath(parentFolderPath);
    if (!(parentFolder instanceof TFolder)) {
      this.deps.context.notify(this.getFolderManagementStrings().folderNotFound);
      return;
    }

    const strings = this.getFolderManagementStrings();
    const modal = new CreateFolderModal(
      this.deps.context.getApp(),
      strings,
      {
        title: strings.createChildTitle,
        submitLabel: strings.create,
        submittingLabel: strings.creating,
      },
      async (nextName: string) => {
        return this.createChildFolder(parentFolderPath, nextName);
      },
    );
    modal.open();
  }

  private async createChildFolder(parentFolderPath: string, nextName: string): Promise<boolean> {
    const strings = this.getFolderManagementStrings();
    const trimmedName = nextName.trim();
    if (trimmedName.length === 0) {
      this.deps.context.notify(strings.emptyName);
      return false;
    }

    if (trimmedName.includes("/") || trimmedName.includes("\\")) {
      this.deps.context.notify(strings.invalidName);
      return false;
    }

    const parentFolder = this.resolveFolderFromUiPath(parentFolderPath);
    if (!(parentFolder instanceof TFolder)) {
      this.deps.context.notify(strings.folderNotFound);
      return false;
    }

    try {
      await this.deps.context.getApp().vault.createFolder(this.buildSiblingPath(parentFolder.path, trimmedName));
      this.deps.refreshFolderTreeState();
      return true;
    } catch (error) {
      this.deps.context.notify(strings.createFailed(String(error)));
      return false;
    }
  }

  openMoveFolderPickerForFolder(folderPath: string): void {
    const folder = this.resolveFolderFromUiPath(folderPath);
    if (!(folder instanceof TFolder)) {
      this.deps.context.notify(this.getFolderManagementStrings().folderNotFound);
      return;
    }
    if (folder.path === "") {
      return;
    }

    const modal = new FolderPickerModal(this.deps.context.getApp(), (targetFolder: TFolder) => {
      void this.onFolderMoveTargetChosen(folderPath, targetFolder);
    }, this.strings.folderPicker.selectFolderTitle);
    modal.open();
  }

  private async onFolderMoveTargetChosen(folderPath: string, targetFolder: TFolder | null): Promise<void> {
    const strings = this.getFolderManagementStrings();
    if (!(targetFolder instanceof TFolder)) {
      return;
    }

    const folder = this.resolveFolderFromUiPath(folderPath);
    if (!(folder instanceof TFolder)) {
      this.deps.context.notify(strings.folderNotFound);
      return;
    }
    if (folder.path === "") {
      return;
    }

    if ((folder.parent?.path ?? "") === targetFolder.path) {
      this.deps.context.notify(strings.sameTarget);
      return;
    }

    if (targetFolder.path === folder.path || targetFolder.path.startsWith(`${folder.path}/`)) {
      this.deps.context.notify(strings.invalidMoveTarget);
      return;
    }

    await this.renameFolderTo(folder, this.buildSiblingPath(targetFolder.path, folder.name));
  }

  /** Shared move/rename primitive: both entry points get the same scope repair. */
  private async renameFolderTo(
    folder: TFolder,
    nextPath: string,
    failureMessage?: (reason: string) => string,
  ): Promise<boolean> {
    const strings = this.getFolderManagementStrings();
    const previousPath = folder.path;
    try {
      await this.deps.context.getApp().fileManager.renameFile(folder, nextPath);
      this.deps.refreshFolderTreeState();
      await this.refreshFolderScopeAfterFolderRename(previousPath, nextPath);
      return true;
    } catch (error) {
      this.deps.context.notify((failureMessage ?? strings.moveFailed)(String(error)));
      return false;
    }
  }

  openRenameFolderModal(folderUiPath: string): void {
    const strings = this.getFolderManagementStrings();
    const folder = this.resolveFolderFromUiPath(folderUiPath);
    if (!(folder instanceof TFolder)) {
      this.deps.context.notify(strings.folderNotFound);
      return;
    }

    if (folder.path === "") {
      return;
    }

    const modal = new CreateFolderModal(
      this.deps.context.getApp(),
      strings,
      {
        title: strings.renameTitle,
        submitLabel: strings.rename,
        submittingLabel: strings.renaming,
        initialName: folder.name,
      },
      async (nextName: string) => {
        return this.renameFolder(folderUiPath, nextName);
      },
    );
    modal.open();
  }

  private async renameFolder(folderUiPath: string, nextName: string): Promise<boolean> {
    const strings = this.getFolderManagementStrings();
    const trimmedName = nextName.trim();
    if (trimmedName.length === 0) {
      this.deps.context.notify(strings.emptyName);
      return false;
    }

    if (trimmedName.includes("/") || trimmedName.includes("\\")) {
      this.deps.context.notify(strings.invalidName);
      return false;
    }

    const folder = this.resolveFolderFromUiPath(folderUiPath);
    if (!(folder instanceof TFolder)) {
      this.deps.context.notify(strings.folderNotFound);
      return false;
    }

    if (trimmedName === folder.name) {
      this.deps.context.notify(strings.unchangedName);
      return false;
    }

    return this.renameFolderTo(
      folder,
      this.buildSiblingPath(folder.parent?.path ?? "", trimmedName),
      strings.renameFailed,
    );
  }

  async duplicateFolder(folderUiPath: string): Promise<void> {
    const strings = this.getFolderManagementStrings();
    const folder = this.resolveFolderFromUiPath(folderUiPath);
    if (!(folder instanceof TFolder)) {
      this.deps.context.notify(strings.folderNotFound);
      return;
    }

    if (folder.path === "") {
      return;
    }

    const fileCount = countFilesInFolder(folder);
    if (fileCount > FOLDER_DUPLICATE_CONFIRM_THRESHOLD) {
      const confirmed = await this.deps.requestDestructiveConfirmation({
        title: strings.duplicateConfirmTitle,
        message: strings.duplicateConfirmBody(fileCount),
        confirmButtonText: strings.duplicateConfirm,
      });
      if (!confirmed) {
        return;
      }
    }

    const targetPath = resolveUniquePath(this.deps.context.getApp(), `${folder.name} copy`, folder.parent?.path ?? "");
    try {
      await this.deps.context.getApp().vault.copy(folder, targetPath);
      this.deps.refreshFolderTreeState();
    } catch (error) {
      this.deps.context.notify(strings.duplicateFailed(String(error)));
    }
  }

  async findInFolder(folderUiPath: string): Promise<void> {
    await this.deps.selectFolderFromNav(folderUiPath);
    this.deps.resetSearchQuery();
    this.deps.bumpSearchFocusToken();
    this.deps.context.publishGroups("search");
  }

  /** Folder-tree create actions always land in browse mode on the target folder, never inside an open card box. */
  async createFromFolderTree(
    folderUiPath: string,
    kind: "note" | "folder" | "canvas" | "base",
  ): Promise<void> {
    if (this.deps.isBoxMode()) {
      await this.deps.selectFolderFromNav(folderUiPath);
    }

    if (kind === "note") {
      await this.createNoteIn(folderUiPath);
      return;
    }
    if (kind === "canvas") {
      await this.createCanvasIn(folderUiPath);
      return;
    }
    if (kind === "base") {
      await this.createBaseIn(folderUiPath);
      return;
    }
    this.openCreateChildFolderModal(folderUiPath);
  }

  async deleteFolder(folderPath: string): Promise<void> {
    const strings = this.getFolderManagementStrings();
    const folder = this.resolveFolderFromUiPath(folderPath);
    if (!(folder instanceof TFolder)) {
      this.deps.context.notify(strings.folderNotFound);
      return;
    }

    if (folder.path === "") {
      return;
    }

    try {
      const confirmed = await this.deps.context.getApp().fileManager.promptForDeletion(folder);
      if (!confirmed) {
        return;
      }

      const liveFolder = this.resolveFolderFromUiPath(folderPath);
      if (!(liveFolder instanceof TFolder)) {
        this.deps.context.notify(strings.folderNotFound);
        return;
      }

      const currentFolderPath = scopeDisplayPath(this.deps.context.store.getScope());
      const nextFolderPath = getFallbackFolderPathAfterFolderDeletion(currentFolderPath, liveFolder.path);
      await trashAbstractFileUsingObsidianPreference(this.deps.context.getApp(), liveFolder);
      this.deps.refreshFolderTreeState();
      if (nextFolderPath !== null) {
        await this.deps.moveScopeToFolder(nextFolderPath);
      }
    } catch (error) {
      this.deps.context.notify(strings.deleteFailed(String(error)));
    }
  }

  private async refreshFolderScopeAfterFolderRename(previousPath: string, nextPath: string): Promise<void> {
    const scope = this.deps.context.store.getScope();
    if (scope.kind !== "folder") {
      return;
    }

    const currentFolderPath = scope.path;
    const rewrittenPath = this.deps.rewritePathAfterRename(currentFolderPath, previousPath, nextPath);
    if (rewrittenPath === null || rewrittenPath === currentFolderPath) {
      return;
    }

    await this.deps.moveScopeToFolder(rewrittenPath);
  }

  async createNoteIn(folderUiPath: string, tags: string[] = []): Promise<void> {
    const folder = this.resolveFolderFromUiPath(folderUiPath);
    if (!(folder instanceof TFolder)) {
      this.deps.context.notify(this.getFolderManagementStrings().folderNotFound);
      return;
    }

    try {
      await this.deps.createNoteInFolder(folder.path, tags);
    } catch (error) {
      this.deps.context.notify(this.getFolderManagementStrings().createFileFailed(String(error)));
    }
  }

  private async createCanvasIn(folderUiPath: string): Promise<void> {
    await this.createSupportedFileIn(folderUiPath, "canvas", NEW_CANVAS_CONTENT);
  }

  private async createBaseIn(folderUiPath: string): Promise<void> {
    await this.createSupportedFileIn(folderUiPath, "base", NEW_BASE_CONTENT);
  }

  private async createSupportedFileIn(
    folderUiPath: string,
    extension: "canvas" | "base",
    content: string,
  ): Promise<void> {
    const folder = this.resolveFolderFromUiPath(folderUiPath);
    if (!(folder instanceof TFolder)) {
      this.deps.context.notify(this.getFolderManagementStrings().folderNotFound);
      return;
    }

    const fileName = `${this.strings.app.untitledNoteBaseName}.${extension}`;
    const targetPath = resolveUniquePath(this.deps.context.getApp(), fileName, folder.path);
    try {
      const created = await this.deps.context.getApp().vault.create(targetPath, content);
      await this.deps.openNoteFromCard(created.path, "new-tab");
    } catch (error) {
      this.deps.context.notify(this.getFolderManagementStrings().createFileFailed(String(error)));
    }
  }
}
