import type { TFile } from "obsidian";

import type { UiStrings } from "../../i18n";
import { collectAllTags, getFileTags } from "../metadata-utils";
import { BulkRemoveTagsModal, type BulkRemovableTagOption } from "../modals/BulkRemoveTagsModal";
import { TagInputModal, type TagMutationMode } from "../modals/TagInputModal";
import {
  addTagToFile,
  editTagsInFile,
  batchRemoveTagsFromFiles,
  normalizeTagForFrontmatter,
  removeTagFromFile,
} from "../note-tag-ops";
import { copyPathToClipboard } from "../note-ops";
import { normalizeTagPath } from "../tag-tree";
import { buildBulkMetadataSnapshot } from "../bulk-metadata";
import { BulkTagsModal } from "../modals/BulkTagsModal";
import { BulkMetadataSession } from "./bulk-metadata-session";
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
  /** Browse Tag filter capability for the current source (C6); boxes and links disable it. */
  browseTagFilterEnabled: () => boolean;
  getDisplayFolderPath: () => string;
  createNoteIn: (folderUiPath: string, tags?: string[]) => Promise<void>;
  returnToCardsViewIfSinglePane: () => void;
}

/**
 * Tag filters and single/bulk tag edits behind injected view and file seams.
 */
export class TagActions {
  constructor(private readonly deps: TagActionsDeps) {}

  private get strings(): UiStrings {
    return this.deps.context.getUiStrings();
  }

  // -- Tag filter --------------------------------------------------------

  async applyTagFilter(nextTags: string[]): Promise<void> {
    await this.deps.context.saveSettings({ filter: nextTags.length > 0
      ? { tags: nextTags, properties: [] } : { tags: nextTags } });
  }

  async addTagToFilter(tag: string): Promise<void> {
    const filter = this.deps.context.getSettings().filter;
    const current = filter.tags;
    const alreadySelected = current.some((existing) => normalizeTagPath(existing) === tag);
    if (alreadySelected && filter.properties.length === 0) return;
    await this.applyTagFilter(alreadySelected ? current : [...current, tag]);
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
    const rawTags = Array.isArray(detail.tags) ? detail.tags : [];
    // Non-filterable scopes only accept the clearing intent: dormant tag filters
    // must stay escapable (section-header clear button) without becoming settable.
    if (!this.deps.browseTagFilterEnabled() && rawTags.length > 0) {
      return;
    }
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
    const currentFilter = this.deps.context.getSettings().filter;
    const currentTags = currentFilter.tags;
    if (currentTags.length === nextTags.length
      && currentTags.every((tag, index) => tag === nextTags[index])
      && (nextTags.length === 0 || currentFilter.properties.length === 0)) return;
    await this.applyTagFilter(nextTags);
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

  bulkEditTagsSelected(): void {
    if (!this.deps.isBulkMode()) return;
    const files = this.deps.resolveSelectedLiveMarkdownFilesInOrder().filesInOrder;
    if (!files.length) return;
    const app = this.deps.context.getApp();
    const strings = this.strings.view.bulkMetadata;
    const session = new BulkMetadataSession(files);
    const modal = new BulkTagsModal(app, { strings, snapshot: buildBulkMetadataSnapshot(app, files), targetCount: files.length }, async (draft) => {
      const result = await session.apply(app, (file) => editTagsInFile(app, file, draft));
      this.deps.reconcileSelectionToOrderedPaths(result.failed.map((file) => file.path));
      if (result.changed > 0 && draft.removeTags.length) await this.clearStaleTagFilterIfNeeded(draft.removeTags);
      const message = strings.result(result.changed, result.noop, result.failed.length) + (result.failed.length ? ` ${strings.retry}\n${result.errors.join("\n")}` : "");
      modal.showResult(message, result.failed.length);
      this.deps.context.notify(message);
      return !result.failed.length;
    });
    modal.open();
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
