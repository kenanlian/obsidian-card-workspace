import type { TFile } from "obsidian";

import type { UiStrings } from "../../i18n";
import { collectAllTags, getFileTags } from "../metadata-utils";
import { BulkRemoveTagsModal, type BulkRemovableTagOption } from "../modals/BulkRemoveTagsModal";
import { TagInputModal, type TagMutationMode } from "../modals/TagInputModal";
import {
  addTagToFile,
  batchAddTagToFiles,
  batchRemoveTagsFromFiles,
  normalizeTagForFrontmatter,
  removeTagFromFile,
} from "../note-tag-ops";
import { copyPathToClipboard } from "../note-ops";
import { normalizeTagPath } from "../tag-tree";
import type { ViewContext } from "../view-context";

export interface TagActionsDeps {
  context: ViewContext;
  /** Markdown-only resolution; owned by `FileActions`. */
  resolveLiveMarkdownFile: (notePath: string) => TFile | null;
  isBulkMode: () => boolean;
  getSelectedPaths: () => Set<string>;
  resolveSelectedLiveMarkdownFilesInOrder: () => {
    selectedPathsInOrder: string[];
    filesInOrder: TFile[];
  };
  reconcileSelectionToOrderedPaths: (pathsInOrder: string[]) => void;
  /** Scope tags for the current view, memoized by `ProjectionController`. */
  deriveAvailableTags: () => string[];
  isBoxMode: () => boolean;
  getDisplayFolderPath: () => string;
  createNoteIn: (folderUiPath: string, tags?: string[]) => Promise<void>;
  returnToCardsViewIfSinglePane: () => void;
}

/**
 * Tag filter, single-note tag edits, and bulk tag add/remove — moved verbatim
 * behind injected controller and file-action seams.
 */
export class TagActions {
  constructor(private readonly deps: TagActionsDeps) {}

  private get strings(): UiStrings {
    return this.deps.context.getUiStrings();
  }

  // -- Tag filter --------------------------------------------------------

  async applyTagFilter(nextTags: string[]): Promise<void> {
    await this.deps.context.saveSettings({ filter: { tags: nextTags } });
  }

  async addTagToFilter(tag: string): Promise<void> {
    const current = this.deps.context.getSettings().filter.tags;
    if (current.some((existing) => normalizeTagPath(existing) === tag)) {
      return;
    }
    await this.applyTagFilter([...current, tag]);
  }

  async removeTagFromFilter(tag: string): Promise<void> {
    const current = this.deps.context.getSettings().filter.tags;
    const nextTags = current.filter((existing) => normalizeTagPath(existing) !== tag);
    if (nextTags.length === current.length) {
      return;
    }
    await this.applyTagFilter(nextTags);
  }

  async filterByOnlyTag(tag: string): Promise<void> {
    await this.applyTagFilter([tag]);
  }

  async clearTagFilter(): Promise<void> {
    if (this.deps.context.getSettings().filter.tags.length === 0) {
      return;
    }
    await this.applyTagFilter([]);
  }

  async copyTag(tag: string): Promise<void> {
    await copyPathToClipboard(`#${tag}`, this.strings.noteOps);
  }

  async createNoteWithTag(tag: string): Promise<void> {
    await this.deps.createNoteIn(this.deps.getDisplayFolderPath(), [tag]);
  }

  async onFilterChange(detail: { tags?: unknown }): Promise<void> {
    this.deps.returnToCardsViewIfSinglePane();
    if (this.deps.isBoxMode()) {
      return;
    }
    const rawTags = Array.isArray(detail.tags) ? detail.tags : [];
    const nextTags: string[] = [];
    for (const tag of rawTags) {
      if (typeof tag !== "string") {
        continue;
      }
      const normalized = tag.trim().replace(/^#/, "").toLowerCase();
      if (normalized.length > 0 && !nextTags.includes(normalized)) {
        nextTags.push(normalized);
      }
    }
    const currentTags = this.deps.context.getSettings().filter.tags;
    if (
      currentTags.length === nextTags.length &&
      currentTags.every((tag, index) => tag === nextTags[index])
    ) {
      return;
    }
    await this.deps.context.saveSettings({ filter: { tags: nextTags } });
  }

  // -- Single-note tag edits ---------------------------------------------

  openSingleTagModal(notePath: string, mode: TagMutationMode): void {
    const file = this.deps.resolveLiveMarkdownFile(notePath);
    if (!file) {
      return;
    }
    if (mode === "add") {
      const modal = new TagInputModal(
        this.deps.context.getApp(),
        { mode, strings: this.strings.view.tagInput },
        async (tag) => this.submitSingleTagAction(notePath, mode, tag),
      );
      modal.open();
      return;
    }
    const tagOptions = this.buildBulkRemovableTagOptions([file]);
    if (tagOptions.length === 0) {
      this.deps.context.notify(this.strings.view.singleRemoveTag.noRemovableTags);
      return;
    }
    const modal = new BulkRemoveTagsModal(
      this.deps.context.getApp(),
      {
        titleText: this.strings.view.bulkRemoveTag.modalTitle,
        emptyMessage: this.strings.view.singleRemoveTag.noRemovableTags,
        selectionSummary: (count) => this.strings.view.bulkRemoveTag.selectedTagCount(count),
        cancelText: this.strings.view.tagInput.cancel,
        submitText: this.strings.view.bulkRemoveTag.removeSelectedTags,
        submittingText: this.strings.view.bulkRemoveTag.removingSelectedTags,
        tagOptions,
      },
      async (tags) => this.executeSingleRemoveTags(notePath, tags),
    );
    modal.open();
  }

  async submitSingleTagAction(notePath: string, mode: TagMutationMode, tag: string): Promise<boolean> {
    const file = this.deps.resolveLiveMarkdownFile(notePath);
    if (!file) {
      return true;
    }
    const result = mode === "add"
      ? await addTagToFile(this.deps.context.getApp(), file, tag)
      : await removeTagFromFile(this.deps.context.getApp(), file, tag);
    if (!result.ok) {
      const message = mode === "add"
        ? this.strings.view.singleTagActions.failedToAdd(result.error)
        : this.strings.view.singleTagActions.failedToRemove(result.error);
      this.deps.context.notify(message);
      return false;
    }
    if (mode === "remove" && "changed" in result && !result.changed) {
      this.deps.context.notify(this.strings.view.singleTagActions.absent(tag, file.basename));
      return false;
    }
    if (mode === "remove" && "changed" in result && result.changed) {
      await this.clearStaleTagFilterIfNeeded([tag]);
    }
    const message = mode === "add"
      ? this.strings.view.singleTagActions.added(tag, file.basename)
      : this.strings.view.singleTagActions.removed(tag, file.basename);
    this.deps.context.notify(message);
    return true;
  }

  async executeSingleRemoveTags(notePath: string, tags: string[]): Promise<boolean> {
    const file = this.deps.resolveLiveMarkdownFile(notePath);
    if (!file) {
      return true;
    }
    const collapsedTags = this.collapseBulkRemovableTags(tags);
    if (collapsedTags.length === 0) {
      this.deps.context.notify(this.strings.view.singleRemoveTag.noRemovableTags);
      return false;
    }
    if (collapsedTags.length === 1) {
      return this.submitSingleTagAction(notePath, "remove", collapsedTags[0]);
    }
    const summary = await batchRemoveTagsFromFiles(this.deps.context.getApp(), [file], collapsedTags);
    if (summary.changed.length > 0) {
      await this.clearStaleTagFilterIfNeeded(collapsedTags);
    }
    const strings = this.strings.view.bulkRemoveTag;
    if (summary.failed.length === 0 && summary.noop.length === 0) {
      this.deps.context.notify(strings.removed(summary.changed.length, collapsedTags.length));
      return true;
    }
    if (summary.changed.length === 0 && summary.failed.length === 0) {
      this.deps.context.notify(strings.noop(summary.noop.length, collapsedTags.length));
      return false;
    }
    this.deps.context.notify(strings.failed(summary.failed.length, collapsedTags.length));
    return false;
  }

  // -- Bulk tag edits ------------------------------------------------------

  bulkAddTagSelected(): void {
    if (!this.deps.isBulkMode() || this.deps.getSelectedPaths().size === 0) {
      return;
    }
    this.openBulkTagModal("add");
  }

  bulkRemoveTagSelected(): void {
    if (!this.deps.isBulkMode() || this.deps.getSelectedPaths().size === 0) {
      return;
    }
    this.openBulkTagModal("remove");
  }

  openBulkTagModal(mode: TagMutationMode): void {
    if (mode === "add") {
      const modal = new TagInputModal(
        this.deps.context.getApp(),
        { mode, strings: this.strings.view.tagInput },
        async (tag) => this.executeBulkTagAction(tag),
      );
      modal.open();
      return;
    }
    const { selectedPathsInOrder, filesInOrder } = this.deps.resolveSelectedLiveMarkdownFilesInOrder();
    const livePathsInOrder = filesInOrder.map((file) => file.path);
    if (filesInOrder.length === 0) {
      this.deps.reconcileSelectionToOrderedPaths([]);
      this.deps.context.notify(this.strings.view.bulkRemoveTag.noSelectedNotes);
      return;
    }
    if (livePathsInOrder.length !== selectedPathsInOrder.length) {
      this.deps.reconcileSelectionToOrderedPaths(livePathsInOrder);
    }
    const tagOptions = this.buildBulkRemovableTagOptions(filesInOrder);
    if (tagOptions.length === 0) {
      this.deps.context.notify(this.strings.view.bulkRemoveTag.noRemovableTags);
      return;
    }
    const modal = new BulkRemoveTagsModal(
      this.deps.context.getApp(),
      {
        titleText: this.strings.view.bulkRemoveTag.modalTitle,
        emptyMessage: this.strings.view.bulkRemoveTag.noRemovableTags,
        selectionSummary: (count) => this.strings.view.bulkRemoveTag.selectedTagCount(count),
        cancelText: this.strings.view.tagInput.cancel,
        submitText: this.strings.view.bulkRemoveTag.removeSelectedTags,
        submittingText: this.strings.view.bulkRemoveTag.removingSelectedTags,
        tagOptions,
      },
      async (tags) => this.executeBulkRemoveTags(tags),
    );
    modal.open();
  }

  async executeBulkTagAction(tag: string): Promise<boolean> {
    const strings = this.strings.view.bulkAddTag;
    const { selectedPathsInOrder, filesInOrder } = this.deps.resolveSelectedLiveMarkdownFilesInOrder();
    const livePathsInOrder = filesInOrder.map((file) => file.path);
    if (filesInOrder.length === 0) {
      this.deps.reconcileSelectionToOrderedPaths([]);
      this.deps.context.notify(strings.noSelectedNotes);
      return true;
    }
    if (livePathsInOrder.length !== selectedPathsInOrder.length) {
      this.deps.reconcileSelectionToOrderedPaths(livePathsInOrder);
    }
    const summary = await batchAddTagToFiles(this.deps.context.getApp(), filesInOrder, tag);
    const failedPathSet = new Set(summary.failed.map((failed) => failed.path));
    const failedPathsInOrder = livePathsInOrder.filter((path) => failedPathSet.has(path));
    this.deps.reconcileSelectionToOrderedPaths(failedPathsInOrder);
    const succeededCount = summary.succeeded.length;
    const failedCount = summary.failed.length;
    if (failedCount === 0) {
      this.deps.context.notify(strings.added(succeededCount, tag));
      return true;
    }
    if (succeededCount === 0) {
      this.deps.context.notify(strings.failed(failedCount, tag));
      return false;
    }
    this.deps.context.notify(strings.partial(succeededCount, failedCount, tag));
    return true;
  }

  async executeBulkRemoveTags(tags: string[]): Promise<boolean> {
    const strings = this.strings.view.bulkRemoveTag;
    const { selectedPathsInOrder, filesInOrder } = this.deps.resolveSelectedLiveMarkdownFilesInOrder();
    const livePathsInOrder = filesInOrder.map((file) => file.path);
    if (filesInOrder.length === 0) {
      this.deps.reconcileSelectionToOrderedPaths([]);
      this.deps.context.notify(strings.noSelectedNotes);
      return true;
    }
    if (livePathsInOrder.length !== selectedPathsInOrder.length) {
      this.deps.reconcileSelectionToOrderedPaths(livePathsInOrder);
    }
    const collapsedTags = this.collapseBulkRemovableTags(tags);
    if (collapsedTags.length === 0) {
      this.deps.context.notify(strings.noRemovableTags);
      return false;
    }
    const summary = await batchRemoveTagsFromFiles(this.deps.context.getApp(), filesInOrder, collapsedTags);
    const failedPathSet = new Set(summary.failed.map((failed) => failed.path));
    const failedPathsInOrder = livePathsInOrder.filter((path) => failedPathSet.has(path));
    this.deps.reconcileSelectionToOrderedPaths(failedPathsInOrder);
    const removedCount = summary.changed.length;
    const noopCount = summary.noop.length;
    const failedCount = summary.failed.length;
    if (removedCount > 0) {
      await this.clearStaleTagFilterIfNeeded(collapsedTags);
    }
    if (failedCount === 0 && noopCount === 0) {
      this.deps.context.notify(strings.removed(removedCount, collapsedTags.length));
      return true;
    }
    if (removedCount === 0 && failedCount === 0) {
      this.deps.context.notify(strings.noop(noopCount, collapsedTags.length));
      return false;
    }
    if (removedCount === 0 && noopCount === 0) {
      this.deps.context.notify(strings.failed(failedCount, collapsedTags.length));
      return false;
    }
    this.deps.context.notify(strings.partial(removedCount, noopCount, failedCount, collapsedTags.length));
    return true;
  }

  // -- Tag option helpers ---------------------------------------------------

  buildBulkRemovableTagOptions(filesInOrder: TFile[]): BulkRemovableTagOption[] {
    const app = this.deps.context.getApp();
    const displayTags = collectAllTags(app, filesInOrder);
    const displayByNormalizedTag = new Map<string, string>();
    for (const displayTag of displayTags) {
      displayByNormalizedTag.set(normalizeTagForFrontmatter(displayTag), displayTag);
    }
    const countsByNormalizedTag = new Map<string, number>();
    for (const file of filesInOrder) {
      const fileTags = new Set(getFileTags(app, file));
      for (const tag of fileTags) {
        countsByNormalizedTag.set(tag, (countsByNormalizedTag.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(countsByNormalizedTag.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([normalizedTag, selectedFileCount]) => ({
        normalizedTag,
        label: `${displayByNormalizedTag.get(normalizedTag) ?? normalizedTag} (${selectedFileCount})`,
      }));
  }

  collapseBulkRemovableTags(tags: string[]): string[] {
    const normalizedTags = Array.from(new Set(
      tags.map((tag) => normalizeTagForFrontmatter(tag)).filter((tag) => tag.length > 0),
    ));
    normalizedTags.sort((left, right) => left.length - right.length || left.localeCompare(right));
    const collapsedTags: string[] = [];
    for (const normalizedTag of normalizedTags) {
      if (collapsedTags.some((candidate) => normalizedTag === candidate || normalizedTag.startsWith(`${candidate}/`))) {
        continue;
      }
      collapsedTags.push(normalizedTag);
    }
    return collapsedTags;
  }

  async clearStaleTagFilterIfNeeded(removedTags: string[]): Promise<void> {
    const currentFilterTags = this.deps.context.getSettings().filter.tags;
    const activeFilterTag = normalizeTagForFrontmatter(currentFilterTags[0] ?? "");
    if (activeFilterTag.length === 0) {
      return;
    }
    const normalizedRemovedTags = this.collapseBulkRemovableTags(removedTags);
    const removedActiveFilter = normalizedRemovedTags.some(
      (removedTag) => activeFilterTag === removedTag || activeFilterTag.startsWith(`${removedTag}/`),
    );
    const availableTags = new Set(this.deps.deriveAvailableTags().map((tag) => normalizeTagForFrontmatter(tag)));
    if (!removedActiveFilter && availableTags.has(activeFilterTag)) {
      return;
    }
    await this.deps.context.saveSettings({ filter: { tags: [] } });
  }
}
