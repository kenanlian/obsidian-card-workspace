import type { UiStrings } from "../../i18n";
import type { PartialPluginSettings } from "../../settings";
import { TagInputModal } from "../modals/TagInputModal";
import {
  batchRemoveTagsFromFiles,
  batchRenameTagInFiles,
  normalizeTagForFrontmatter,
  type BatchTagMutationSummary,
} from "../note-tag-ops";
import {
  countRenameTargetConflicts,
  rewriteTagReferencesForDelete,
  rewriteTagReferencesForRename,
  scanTagManagementTargets,
  type TagReferenceRewrite,
  type TagReferenceSnapshot,
} from "../tag-management";
import type { ViewContext } from "../view-context";

export interface TagManagementActionsDeps {
  context: ViewContext;
  /** Shared destructive-confirmation modal (wired to `MergeActions`). */
  requestDestructiveConfirmation: (options: {
    title: string;
    message: string;
    confirmButtonText: string;
  }) => Promise<boolean>;
}

/**
 * Vault-wide tag management from the navigation tag menu: rename rewrites the
 * tag subtree across every note plus the plugin-side references (favorites,
 * active tag filter, box rule tag clauses); delete removes them. Impact is
 * scanned and confirmed before anything is written, and every file change goes
 * through the standard `processFrontMatter` / `vault.process` flows so
 * Obsidian's per-file undo keeps working.
 */
export class TagManagementActions {
  constructor(private readonly deps: TagManagementActionsDeps) {}

  private get strings(): UiStrings {
    return this.deps.context.getUiStrings();
  }

  /** Entry point for the nav tag menu's "Rename tag…" item. */
  openRenameTagModal(tag: string): void {
    const modal = new TagInputModal(
      this.deps.context.getApp(),
      { mode: "rename", strings: this.strings.view.tagInput, initialValue: normalizeTagForFrontmatter(tag) },
      async (nextTag) => this.submitTagRename(normalizeTagForFrontmatter(tag), nextTag),
    );
    modal.open();
  }

  async submitTagRename(from: string, to: string): Promise<boolean> {
    const strings = this.strings.view.tagManage;
    if (to.length === 0) {
      this.deps.context.notify(this.strings.view.tagInput.invalidTag);
      return false;
    }
    if (from === to) {
      return true;
    }

    const scan = scanTagManagementTargets(this.deps.context.getApp(), from, this.readTagReferences());
    if (!this.scanHasImpact(scan)) {
      this.deps.context.notify(strings.tagNotFound(from));
      return true;
    }

    const merging = countRenameTargetConflicts(this.deps.context.getApp(), from, to) > 0;
    const confirmed = await this.deps.requestDestructiveConfirmation({
      title: strings.renameConfirmTitle,
      message: strings.renameConfirmBody({
        from,
        to,
        noteCount: scan.files.length,
        descendantCount: scan.descendantTags.length,
        boxClauseCount: scan.boxRuleClauseCount,
        favoriteCount: scan.favoriteCount,
        filterCount: scan.filterTagCount,
        merging,
      }),
      confirmButtonText: strings.renameConfirm,
    });
    if (!confirmed) {
      return true;
    }

    const summary = await batchRenameTagInFiles(this.deps.context.getApp(), scan.files, from, to);
    await this.persistTagReferenceRewrite((refs) => rewriteTagReferencesForRename(refs, from, to));
    this.notifyTagMutationSummary(
      summary,
      (count) => strings.renamed(from, to, count),
      (count, failed) => strings.renamedPartial(from, to, count, failed),
      (failed) => strings.renameFailed(from, to, failed),
    );
    return true;
  }

  /** Entry point for the nav tag menu's "Delete tag…" item. */
  async requestDeleteTag(tag: string): Promise<void> {
    const strings = this.strings.view.tagManage;
    const target = normalizeTagForFrontmatter(tag);
    const scan = scanTagManagementTargets(this.deps.context.getApp(), target, this.readTagReferences());
    if (!this.scanHasImpact(scan)) {
      this.deps.context.notify(strings.tagNotFound(target));
      return;
    }

    const confirmed = await this.deps.requestDestructiveConfirmation({
      title: strings.deleteConfirmTitle,
      message: strings.deleteConfirmBody({
        tag: target,
        noteCount: scan.files.length,
        descendantCount: scan.descendantTags.length,
        boxClauseCount: scan.boxRuleClauseCount,
        favoriteCount: scan.favoriteCount,
        filterCount: scan.filterTagCount,
      }),
      confirmButtonText: strings.deleteConfirm,
    });
    if (!confirmed) {
      return;
    }

    const summary = await batchRemoveTagsFromFiles(this.deps.context.getApp(), scan.files, [target]);
    await this.persistTagReferenceRewrite((refs) => rewriteTagReferencesForDelete(refs, target));
    this.notifyTagMutationSummary(
      summary,
      (count) => strings.removed(target, count),
      (count, failed) => strings.removedPartial(target, count, failed),
      (failed) => strings.removeFailed(target, failed),
    );
  }

  private readTagReferences(): TagReferenceSnapshot {
    const settings = this.deps.context.getSettings();
    return {
      favorites: settings.favorites ?? [],
      filterTags: settings.filter.tags,
      boxes: settings.boxes ?? [],
    };
  }

  private scanHasImpact(scan: ReturnType<typeof scanTagManagementTargets>): boolean {
    return scan.files.length > 0
      || scan.favoriteCount > 0
      || scan.boxRuleClauseCount > 0
      || scan.filterTagCount > 0;
  }

  /** Applies the favorites/filter/box-rule rewrite as one graded settings patch. */
  private async persistTagReferenceRewrite(
    rewrite: (refs: TagReferenceSnapshot) => TagReferenceRewrite,
  ): Promise<void> {
    const result = rewrite(this.readTagReferences());
    const patch: PartialPluginSettings = {};
    if (result.favoritesChanged) patch.favorites = result.favorites;
    if (result.filterChanged) patch.filter = { tags: result.filterTags };
    if (result.boxesChanged) patch.boxes = result.boxes;
    if (Object.keys(patch).length === 0) {
      return;
    }
    await this.deps.context.saveSettings(patch);
  }

  private notifyTagMutationSummary(
    summary: BatchTagMutationSummary,
    successMessage: (count: number) => string,
    partialMessage: (count: number, failed: number) => string,
    failureMessage: (failed: number) => string,
  ): void {
    const changedCount = summary.changed.length;
    const failedCount = summary.failed.length;
    if (failedCount === 0) {
      this.deps.context.notify(successMessage(changedCount));
      return;
    }
    if (changedCount === 0) {
      this.deps.context.notify(failureMessage(failedCount));
      return;
    }
    this.deps.context.notify(partialMessage(changedCount, failedCount));
  }
}
