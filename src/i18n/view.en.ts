import type { ViewStrings } from "./view";

export const viewStringsEn: ViewStrings = {
    displayName: "Card Workspace",
    emptyFolder: "No supported files found in this folder.",
    emptySearchCurrentFolder: (query: string) => `No results for “${query}” in current folder.`,
    emptySearchCurrentFolderWithTags: (query: string) => `No results for “${query}” in current folder and tag scope.`,
    bulkConfirm: {
      cancel: "Cancel",
    },
    rename: {
      title: "Rename file",
      nameLabel: "Name",
      cancel: "Cancel",
      rename: "Rename",
      renaming: "Renaming…",
    },
    move: {
      chooseFolder: "Choose…",
      noSelectedNotes: "No selected notes are available to move.",
      allAlreadyInTargetFolder: "All selected notes are already in the target folder.",
      moved: (count: number) => `Moved ${count} note${count === 1 ? "" : "s"}.`,
      failed: (count: number) => `Failed to move ${count} note${count === 1 ? "" : "s"}.`,
      partial: (success: number, failed: number) => `Moved ${success} note${success === 1 ? "" : "s"}; ${failed} failed.`,
    },
    bulkDelete: {
      noLiveFilesMessage: "No selected notes are available to delete.",
      confirmTitle: "Delete selected notes?",
      confirmButtonText: "Delete",
      confirmMessage: (count: number) => `Delete ${count} selected note${count === 1 ? "" : "s"}? Obsidian will use your Files & Links delete preference.`,
      successMessage: (count: number) => `Deleted ${count} note${count === 1 ? "" : "s"}.`,
      failureMessage: (count: number) => `Failed to delete ${count} note${count === 1 ? "" : "s"}.`,
      partialMessage: (success: number, failed: number) => `Deleted ${success} note${success === 1 ? "" : "s"}; ${failed} failed.`,
    },
    tagInput: {
      addTitle: "Add tag",
      removeTitle: "Remove tag",
      renameTitle: "Rename tag",
      tagLabel: "Tag",
      renameNewTagLabel: "New tag name",
      tagPlaceholder: "tag/sub-tag",
      invalidTag: "Enter a valid tag.",
      cancel: "Cancel",
      add: "Add tag",
      adding: "Adding…",
      remove: "Remove tag",
      removing: "Removing…",
      rename: "Rename",
      renaming: "Renaming…",
    },
    singleTagActions: {
      added: (tag: string, basename: string) => `Added #${tag} to "${basename}".`,
      removed: (tag: string, basename: string) => `Removed #${tag} from "${basename}".`,
      absent: (tag: string, basename: string) => `#${tag} was not present on "${basename}".`,
      failedToAdd: (reason: string) => `Failed to add tag: ${reason}`,
      failedToRemove: (reason: string) => `Failed to remove tag: ${reason}`,
    },
    singleRemoveTag: {
      modalTitle: "Remove tag",
      noRemovableTags: "This note does not contain any removable tags.",
    },
    bulkAddTag: {
      noSelectedNotes: "No selected Markdown notes are available to tag.",
      added: (count: number, tag: string) => `Added #${tag} to ${count} note${count === 1 ? "" : "s"}.`,
      failed: (count: number, tag: string) => `Failed to add #${tag} to ${count} note${count === 1 ? "" : "s"}.`,
      partial: (success: number, failed: number, tag: string) =>
        `Added #${tag} to ${success} note${success === 1 ? "" : "s"}; ${failed} failed.`,
    },
    bulkRemoveTag: {
      noSelectedNotes: "No selected Markdown notes are available to untag.",
      noRemovableTags: "The selected Markdown notes do not contain any removable tags.",
      modalTitle: "Remove tags",
      removeSelectedTags: "Remove selected tags",
      removingSelectedTags: "Removing selected tags…",
      selectedTagCount: (count: number) => `Selected ${count} tag${count === 1 ? "" : "s"}.`,
      removed: (removed: number, tagCount: number) =>
        `Removed ${tagCount} tag${tagCount === 1 ? "" : "s"} from ${removed} note${removed === 1 ? "" : "s"}.`,
      noop: (noop: number, tagCount: number) =>
        `No selected notes contained the ${tagCount} chosen tag${tagCount === 1 ? "" : "s"} (${noop} note${noop === 1 ? "" : "s"} unchanged).`,
      failed: (failed: number, tagCount: number) =>
        `Failed to remove ${tagCount} tag${tagCount === 1 ? "" : "s"} from ${failed} note${failed === 1 ? "" : "s"}.`,
      partial: (removed: number, noop: number, failed: number, tagCount: number) =>
        `Removed ${tagCount} tag${tagCount === 1 ? "" : "s"} from ${removed} note${removed === 1 ? "" : "s"}; ${noop} unchanged; ${failed} failed.`,
    },
    tagManage: {
      tagNotFound: (tag: string) =>
        `#${tag} is not used by any note, favorite, filter, or card box rule.`,
      renameConfirmTitle: "Rename tag",
      renameConfirm: "Rename",
      renameConfirmBody: (info) => {
        const parts = [`Rename #${info.from} to #${info.to}?`];
        if (info.noteCount > 0) {
          parts.push(`${info.noteCount} note${info.noteCount === 1 ? "" : "s"} will be rewritten.`);
        }
        if (info.descendantCount > 0) {
          parts.push(`This includes ${info.descendantCount} subtag${info.descendantCount === 1 ? "" : "s"}.`);
        }
        if (info.merging) {
          parts.push("The target tag already exists on some notes; tags will be merged.");
        }
        if (info.boxClauseCount > 0) {
          parts.push(`${info.boxClauseCount} card box rule tag condition${info.boxClauseCount === 1 ? "" : "s"} will be updated.`);
        }
        if (info.favoriteCount > 0) {
          parts.push(`${info.favoriteCount} favorite${info.favoriteCount === 1 ? "" : "s"} will be updated.`);
        }
        if (info.filterCount > 0) {
          parts.push(`${info.filterCount} active tag filter${info.filterCount === 1 ? "" : "s"} will be updated.`);
        }
        return parts.join(" ");
      },
      deleteConfirmTitle: "Delete tag",
      deleteConfirm: "Delete",
      deleteConfirmBody: (info) => {
        const parts = [`Delete #${info.tag}?`];
        if (info.noteCount > 0) {
          parts.push(`The tag will be removed from ${info.noteCount} note${info.noteCount === 1 ? "" : "s"}.`);
        }
        if (info.descendantCount > 0) {
          parts.push(`This includes ${info.descendantCount} subtag${info.descendantCount === 1 ? "" : "s"}.`);
        }
        if (info.boxClauseCount > 0) {
          parts.push(`${info.boxClauseCount} card box rule tag condition${info.boxClauseCount === 1 ? "" : "s"} will be removed.`);
        }
        if (info.favoriteCount > 0) {
          parts.push(`${info.favoriteCount} favorite${info.favoriteCount === 1 ? "" : "s"} will be removed.`);
        }
        if (info.filterCount > 0) {
          parts.push(`${info.filterCount} active tag filter${info.filterCount === 1 ? "" : "s"} will be cleared.`);
        }
        parts.push("Notes themselves are not deleted.");
        return parts.join(" ");
      },
      renamed: (from: string, to: string, count: number) =>
        `Renamed #${from} to #${to} in ${count} note${count === 1 ? "" : "s"}.`,
      renamedPartial: (from: string, to: string, count: number, failed: number) =>
        `Renamed #${from} to #${to} in ${count} note${count === 1 ? "" : "s"}; ${failed} failed.`,
      renameFailed: (from: string, to: string, failed: number) =>
        `Failed to rename #${from} to #${to} in ${failed} note${failed === 1 ? "" : "s"}.`,
      removed: (tag: string, count: number) =>
        `Removed #${tag} from ${count} note${count === 1 ? "" : "s"}.`,
      removedPartial: (tag: string, count: number, failed: number) =>
        `Removed #${tag} from ${count} note${count === 1 ? "" : "s"}; ${failed} failed.`,
      removeFailed: (tag: string, failed: number) =>
        `Failed to remove #${tag} from ${failed} note${failed === 1 ? "" : "s"}.`,
    },
    merge: {
      title: "Merge selected notes",
      sourceCount: (count: number) => `${count} source note${count === 1 ? "" : "s"}`,
      mergedTitle: "Merged title",
      targetFolder: "Target folder",
      separator: "Separator",
      chooseFolder: "Choose…",
      sourceOrder: "Merge order",
      up: "Up",
      down: "Down",
      sourceCleanup: "Source cleanup",
      keepSourceNotes: "Keep source notes",
      trashSourceNotesAfterMerge: "Trash source notes after merge",
      preview: "Preview",
      loadingPreview: "Loading preview...",
      failedToBuildPreview: (reason: string) => `Failed to build preview: ${reason}`,
      cancel: "Cancel",
      mergeNotes: "Merge notes",
      merging: "Merging…",
      defaultMergedTitle: "Merged notes",
      selectAtLeastTwoNotes: "Select at least 2 available notes to merge.",
      markdownOnly: "Only Markdown notes can be merged. Deselect the other file types first.",
      failedToMergeNotes: (reason: string) => `Failed to merge notes: ${reason}`,
      mergedInto: (count: number, basename: string) => `Merged ${count} notes into "${basename}".`,
      trashedSources: (count: number) => `Trashed ${count} source note${count === 1 ? "" : "s"}.`,
      failedToTrashSources: (count: number) => `Failed to trash ${count} source note${count === 1 ? "" : "s"}.`,
      trashedSourcesPartial: (success: number, failed: number) => `Trashed ${success} source note${success === 1 ? "" : "s"}; ${failed} failed.`,
    },
    folderManagement: {
      createChildTitle: "Create child folder",
      nameLabel: "Folder name",
      cancel: "Cancel",
      create: "Create",
      creating: "Creating…",
      emptyName: "Folder name cannot be empty.",
      invalidName: "Folder name cannot contain / or \\.",
      folderNotFound: "Folder no longer exists.",
      createFailed: (reason: string) => `Failed to create folder: ${reason}`,
      sameTarget: "Folder is already in the selected location.",
      invalidMoveTarget: "Cannot move a folder into itself or one of its subfolders.",
      moveFailed: (reason: string) => `Failed to move folder: ${reason}`,
      deleteFailed: (reason: string) => `Failed to delete folder: ${reason}`,
      renameTitle: "Rename folder",
      rename: "Rename",
      renaming: "Renaming…",
      renameFailed: (reason: string) => `Failed to rename folder: ${reason}`,
      unchangedName: "Folder name is unchanged.",
      duplicateConfirmTitle: "Copy folder",
      duplicateConfirmBody: (count: number) => `Copy this folder and its ${count} files?`,
      duplicateConfirm: "Copy",
      duplicateFailed: (reason: string) => `Failed to copy folder: ${reason}`,
      createFileFailed: (reason: string) => `Failed to create file: ${reason}`,
    },
    contextMenu: {
      openInCurrentWindow: "Open in current window",
      openInNewTab: "Open in new tab",
      openToTheRight: "Open to the right",
      openInNewWindow: "Open in new window",
      makeCopy: "Make a copy",
      moveFileTo: "Move file to...",
      addTag: "Add tag...",
      removeTag: "Remove tag...",
      copyTitle: "Copy title",
      copyContent: "Copy content",
      copyTitleAndContent: "Copy title & content",
      rename: "Rename...",
      delete: "Delete",
    },
    navMenu: {
      newNote: "New note",
      newFolder: "New folder",
      newCanvas: "New canvas",
      newBase: "New base",
      newNoteAtRoot: "New note in vault root",
      newFolderAtRoot: "New folder in vault root",
      newCanvasAtRoot: "New canvas in vault root",
      newBaseAtRoot: "New base in vault root",
      duplicateFolder: "Make a copy",
      renameFolder: "Rename...",
      findInFolder: "Search in folder",
      copyPath: "Copy path",
      copyVaultPath: "Vault path",
      copySystemPath: "System path",
      revealInSystemExplorer: "Show in system explorer",
      expandAllFolders: "Expand all folders",
      collapseAllFolders: "Collapse all folders",
      expandAllTags: "Expand all tags",
      collapseAllTags: "Collapse all tags",
      addTagToFilter: "Add tag to filter",
      removeTagFromFilter: "Remove tag from filter",
      filterByOnlyThisTag: "Filter by this tag only",
      expandSubtags: "Expand subtags",
      collapseSubtags: "Collapse subtags",
      newNoteWithTag: "New note with this tag",
      copyTag: "Copy tag",
      renameTag: "Rename tag…",
      deleteTag: "Delete tag…",
      clearTagFilter: "Clear tag filter",
      openThisBox: "Open card box",
      exitThisBox: "Exit card box",
      restoreExcludedCards: (count: number) => `Restore ${count} removed notes`,
      favorite: "Add to favorites",
      unfavorite: "Remove from favorites",
      moveFavoriteUp: "Move up",
      moveFavoriteDown: "Move down",
      moveSectionUp: "Move section up",
      moveSectionDown: "Move section down",
      clearFavorites: "Clear favorites",
      clearFavoritesConfirmTitle: "Clear favorites",
      clearFavoritesConfirmBody: (count: number) =>
        `Remove all ${count} favorites? Your notes and folders are not affected.`,
      clearFavoritesConfirm: "Clear",
    },
    dragInsertMenu: {
      insertWikiLink: "Insert wiki link",
      insertEmbedLink: "Insert embed link",
      insertContent: "Insert card content",
      insertTitleAndContent: "Insert card title & content",
      unsupportedForFileType: "This card type does not support that drag insertion action.",
      sourceFileMissing: "Card source file no longer exists.",
    },
};
