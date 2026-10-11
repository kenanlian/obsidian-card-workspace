import type { TFile } from "obsidian";

import type { UiStrings } from "../../i18n";
import { editTagsInFile, normalizeTagForFrontmatter } from "../note-tag-ops";
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

  // -- Tag edits -----------------------------------------------------------

  /** Card menu entry: the bulk tag dialog scoped to one note. */
  editTagsForNote(notePath: string): void {
    const file = this.deps.resolveLiveMarkdownFile(notePath);
    if (file) this.openTagsEditor([file]);
  }

  bulkEditTagsSelected(): void {
    if (!this.deps.isBulkMode()) return;
    const files = this.deps.resolveSelectedLiveMarkdownFilesInOrder().filesInOrder;
    if (!files.length) return;
    this.openTagsEditor(files, (failedPaths) => this.deps.reconcileSelectionToOrderedPaths(failedPaths));
  }

  private openTagsEditor(files: TFile[], onApplied?: (failedPaths: string[]) => void): void {
    const app = this.deps.context.getApp();
    const strings = this.strings.view.bulkMetadata;
    const session = new BulkMetadataSession(files);
    const modal = new BulkTagsModal(app, { strings, snapshot: buildBulkMetadataSnapshot(app, files), targetCount: files.length }, async (draft) => {
      const result = await session.apply(app, (file) => editTagsInFile(app, file, draft));
      onApplied?.(result.failed.map((file) => file.path));
      if (result.changed > 0 && draft.removeTags.length) await this.clearStaleTagFilterIfNeeded(draft.removeTags);
      const message = strings.result(result.changed, result.noop, result.failed.length) + (result.failed.length ? ` ${strings.retry}\n${result.errors.join("\n")}` : "");
      modal.showResult(message, result.failed.length);
      this.deps.context.notify(message);
      return !result.failed.length;
    });
    modal.open();
  }

  // -- Tag helpers ----------------------------------------------------------

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
