import { TFile, TFolder } from "obsidian";

import type { UiStrings } from "../../i18n";
import { isMarkdownCardKind, resolveCardFileKind } from "../file-kind";
import { BulkActionConfirmModal } from "../modals/BulkActionConfirmModal";
import { BulkMergeModal, type MergeModalSubmitResult } from "../modals/BulkMergeModal";
import {
  batchDeleteFilesUsingObsidianPreference,
  batchMoveFiles,
  batchTrashFiles,
  mergeNotes,
} from "../note-ops";
import { FolderPickerModal } from "../../FolderPickerModal";
import type { ViewContext } from "../view-context";

export interface MergeActionsDeps {
  context: ViewContext;
  /** Bulk-selection state is owned by the view, not this module. */
  getBulkMode: () => boolean;
  getSelectedPaths: () => Set<string>;
  setSelectedPaths: (paths: Set<string>) => void;
  setBulkAnchorPath: (path: string | null) => void;
  publishSelection: () => void;
  /** Not moved: shared with the other bulk actions (tag add/remove) elsewhere in the view. */
  reconcileSelectionToOrderedPaths: (pathsInOrder: string[]) => void;
  resolveSelectedLiveFilesInOrder: () => { selectedPathsInOrder: string[]; filesInOrder: TFile[] };
}

/**
 * Bulk destructive/relocation operations on the current selection: move,
 * delete, and merge.
 */
export class MergeActions {
  constructor(private readonly deps: MergeActionsDeps) {}

  private get strings(): UiStrings {
    return this.deps.context.getUiStrings();
  }

  bulkMoveSelected(): void {
    if (!this.deps.getBulkMode() || this.deps.getSelectedPaths().size === 0) {
      return;
    }

    const modal = new FolderPickerModal(this.deps.context.getApp(), (targetFolder: TFolder) => {
      void this.onBulkMoveTargetChosen(targetFolder);
    }, this.strings.folderPicker.selectFolderTitle);
    modal.open();
  }

  async onBulkMoveTargetChosen(targetFolder: TFolder | null): Promise<void> {
    const moveStrings = this.strings.view.move;
    if (!(targetFolder instanceof TFolder)) {
      return;
    }

    const selectedPathsInOrder = Array.from(this.deps.getSelectedPaths());
    const filesToMove: TFile[] = [];

    for (const selectedPath of selectedPathsInOrder) {
      const file = this.deps.context.getApp().vault.getAbstractFileByPath(selectedPath);
      if (file instanceof TFile) {
        filesToMove.push(file);
      }
    }

    if (filesToMove.length === 0) {
      this.deps.setSelectedPaths(new Set<string>());
      this.deps.setBulkAnchorPath(null);
      this.deps.publishSelection();
      this.deps.context.notify(moveStrings.noSelectedNotes);
      return;
    }

    const filesAlreadyInTarget = filesToMove.filter((file) => {
      return (file.parent?.path ?? "") === targetFolder.path;
    });
    const movableFiles = filesToMove.filter((file) => {
      return (file.parent?.path ?? "") !== targetFolder.path;
    });

    if (movableFiles.length === 0) {
      const alreadyTargetPathsInOrder = selectedPathsInOrder.filter((selectedPath) => {
        return filesAlreadyInTarget.some((file) => file.path === selectedPath);
      });
      this.deps.setSelectedPaths(new Set<string>(alreadyTargetPathsInOrder));
      this.deps.setBulkAnchorPath(alreadyTargetPathsInOrder[0] ?? null);
      this.deps.publishSelection();
      this.deps.context.notify(moveStrings.allAlreadyInTargetFolder);
      return;
    }

    const summary = await batchMoveFiles(this.deps.context.getApp(), movableFiles, targetFolder, this.strings.noteOps);
    const failedPathsInOrder = selectedPathsInOrder.filter((selectedPath) => {
      return (
        filesAlreadyInTarget.some((file) => file.path === selectedPath) ||
        summary.failed.some((failed) => failed.path === selectedPath)
      );
    });

    this.deps.setSelectedPaths(new Set<string>(failedPathsInOrder));
    this.deps.setBulkAnchorPath(failedPathsInOrder[0] ?? null);
    this.deps.publishSelection();

    const succeededCount = summary.succeeded.length;
    const failedCount = summary.failed.length + filesAlreadyInTarget.length;

    if (failedCount === 0) {
      this.deps.context.notify(moveStrings.moved(succeededCount));
      return;
    }

    if (succeededCount === 0) {
      this.deps.context.notify(moveStrings.failed(failedCount));
      return;
    }

    this.deps.context.notify(moveStrings.partial(succeededCount, failedCount));
  }

  async bulkDeleteSelected(): Promise<void> {
    if (!this.deps.getBulkMode() || this.deps.getSelectedPaths().size === 0) {
      return;
    }

    await this.executeBulkDestructiveAction({
      noLiveFilesMessage: this.strings.view.bulkDelete.noLiveFilesMessage,
      confirmTitle: this.strings.view.bulkDelete.confirmTitle,
      confirmButtonText: this.strings.view.bulkDelete.confirmButtonText,
      confirmMessageBuilder: (count) => this.strings.view.bulkDelete.confirmMessage(count),
      successMessageBuilder: (count) => this.strings.view.bulkDelete.successMessage(count),
      failureMessageBuilder: (count) => this.strings.view.bulkDelete.failureMessage(count),
      partialMessageBuilder: (success, failed) => this.strings.view.bulkDelete.partialMessage(success, failed),
      runBatch: (files) => batchDeleteFilesUsingObsidianPreference(this.deps.context.getApp(), files),
    });
  }

  requestDestructiveConfirmation(options: {
    title: string;
    message: string;
    confirmButtonText: string;
  }): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new BulkActionConfirmModal(this.deps.context.getApp(), {
        ...options,
        cancelButtonText: this.strings.view.bulkConfirm.cancel,
      }, resolve);
      modal.open();
    });
  }

  async executeBulkDestructiveAction(options: {
    noLiveFilesMessage: string;
    confirmTitle: string;
    confirmButtonText: string;
    confirmMessageBuilder: (count: number) => string;
    successMessageBuilder: (count: number) => string;
    failureMessageBuilder: (count: number) => string;
    partialMessageBuilder: (success: number, failed: number) => string;
    runBatch: (files: TFile[]) => Promise<{ succeeded: Array<{ file: TFile }>; failed: Array<{ path: string }> }>;
  }): Promise<void> {
    const { selectedPathsInOrder, filesInOrder } = this.deps.resolveSelectedLiveFilesInOrder();
    const livePathsInOrder = filesInOrder.map((file) => file.path);

    if (filesInOrder.length === 0) {
      this.deps.reconcileSelectionToOrderedPaths([]);
      this.deps.context.notify(options.noLiveFilesMessage);
      return;
    }

    if (livePathsInOrder.length !== selectedPathsInOrder.length) {
      this.deps.reconcileSelectionToOrderedPaths(livePathsInOrder);
    }

    const confirmed = await this.requestDestructiveConfirmation({
      title: options.confirmTitle,
      message: options.confirmMessageBuilder(filesInOrder.length),
      confirmButtonText: options.confirmButtonText,
    });
    if (!confirmed) {
      return;
    }

    const summary = await options.runBatch(filesInOrder);
    const failedPathSet = new Set(summary.failed.map((failed) => failed.path));
    const failedPathsInOrder = livePathsInOrder.filter((path) => failedPathSet.has(path));

    this.deps.reconcileSelectionToOrderedPaths(failedPathsInOrder);

    const succeededCount = summary.succeeded.length;
    const failedCount = summary.failed.length;

    if (failedCount === 0) {
      this.deps.context.notify(options.successMessageBuilder(succeededCount));
      return;
    }

    if (succeededCount === 0) {
      this.deps.context.notify(options.failureMessageBuilder(failedCount));
      return;
    }

    this.deps.context.notify(options.partialMessageBuilder(succeededCount, failedCount));
  }

  bulkMergeSelected(): void {
    if (!this.deps.getBulkMode() || this.deps.getSelectedPaths().size < 2) {
      return;
    }

    const selectedPathSet = new Set(this.deps.getSelectedPaths());
    const selectedPathsInVisibleOrder = this.deps.context.store.getVisibleCards()
      .map((card) => card.path)
      .filter((path) => selectedPathSet.has(path));
    const filesInFrozenOrder: TFile[] = [];
    let hasNonMarkdownSelection = false;

    for (const path of selectedPathsInVisibleOrder) {
      const file = this.deps.context.getApp().vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        continue;
      }

      const fileKind = resolveCardFileKind(file);
      if (fileKind === null || !isMarkdownCardKind(fileKind)) {
        hasNonMarkdownSelection = true;
      }
      filesInFrozenOrder.push(file);
    }

    const livePathsInFrozenOrder = filesInFrozenOrder.map((file) => file.path);
    if (livePathsInFrozenOrder.length !== this.deps.getSelectedPaths().size) {
      this.deps.reconcileSelectionToOrderedPaths(livePathsInFrozenOrder);
    }

    if (hasNonMarkdownSelection) {
      this.deps.context.notify(this.strings.view.merge.markdownOnly);
      return;
    }

    if (filesInFrozenOrder.length < 2) {
      this.deps.context.notify(this.strings.view.merge.selectAtLeastTwoNotes);
      return;
    }

    const firstParentPath = filesInFrozenOrder[0]?.parent?.path ?? "";
    const initialTargetFolder = this.deps.context.getApp().vault.getAbstractFileByPath(firstParentPath);
    const targetFolder = initialTargetFolder instanceof TFolder
      ? initialTargetFolder
      : this.deps.context.getApp().vault.getRoot();

    const modal = new BulkMergeModal(
      this.deps.context.getApp(),
      {
        files: filesInFrozenOrder,
        initialTargetFolder: targetFolder,
        initialMergedTitle: this.strings.view.merge.defaultMergedTitle,
        strings: this.strings.view.merge,
        folderPickerTitle: this.strings.folderPicker.selectFolderTitle,
      },
      async (result) => {
        return this.executeBulkMerge(result);
      },
    );
    modal.open();
  }

  async executeBulkMerge(result: MergeModalSubmitResult): Promise<boolean> {
    const mergeResult = await mergeNotes(
      this.deps.context.getApp(),
      result.files,
      result.targetFolder,
      result.mergedTitle,
      result.separator,
      this.strings.noteOps,
    );

    if (!mergeResult.ok) {
      this.deps.context.notify(this.strings.view.merge.failedToMergeNotes(mergeResult.error));
      return false;
    }

    this.deps.context.notify(this.strings.view.merge.mergedInto(mergeResult.sourceCount, mergeResult.mergedFile.basename));

    if (result.cleanupMode === "keep") {
      this.deps.reconcileSelectionToOrderedPaths([]);
      return true;
    }

    const trashSummary = await batchTrashFiles(this.deps.context.getApp(), result.files);
    const failedPathSet = new Set(trashSummary.failed.map((failed) => failed.path));
    const failedPathsInOrder = result.files
      .map((file) => file.path)
      .filter((path) => failedPathSet.has(path));

    this.deps.reconcileSelectionToOrderedPaths(failedPathsInOrder);

    const trashedCount = trashSummary.succeeded.length;
    const failedCount = trashSummary.failed.length;

    if (failedCount === 0) {
      this.deps.context.notify(this.strings.view.merge.trashedSources(trashedCount));
      return true;
    }

    if (trashedCount === 0) {
      this.deps.context.notify(this.strings.view.merge.failedToTrashSources(failedCount));
      return true;
    }

    this.deps.context.notify(this.strings.view.merge.trashedSourcesPartial(trashedCount, failedCount));
    return true;
  }
}
