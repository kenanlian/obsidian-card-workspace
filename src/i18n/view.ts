import type { UiLanguage } from "./types";
import { viewStringsEn } from "./view.en";
import { viewStringsZh } from "./view.zh";

export interface ViewStrings {
  displayName: string;
  emptyFolder: string;
  emptySearchCurrentFolder: (query: string) => string;
  emptySearchCurrentFolderWithTags: (query: string) => string;
  bulkConfirm: {
    cancel: string;
  };
  rename: {
    title: string;
    nameLabel: string;
    cancel: string;
    rename: string;
    renaming: string;
  };
  move: {
    chooseFolder: string;
    noSelectedNotes: string;
    allAlreadyInTargetFolder: string;
    moved: (count: number) => string;
    failed: (count: number) => string;
    partial: (success: number, failed: number) => string;
  };
  bulkDelete: {
    noLiveFilesMessage: string;
    confirmTitle: string;
    confirmButtonText: string;
    confirmMessage: (count: number) => string;
    successMessage: (count: number) => string;
    failureMessage: (count: number) => string;
    partialMessage: (success: number, failed: number) => string;
  };
  merge: {
    title: string;
    sourceCount: (count: number) => string;
    mergedTitle: string;
    targetFolder: string;
    separator: string;
    chooseFolder: string;
    sourceOrder: string;
    up: string;
    down: string;
    sourceCleanup: string;
    keepSourceNotes: string;
    trashSourceNotesAfterMerge: string;
    preview: string;
    loadingPreview: string;
    failedToBuildPreview: (reason: string) => string;
    cancel: string;
    mergeNotes: string;
    merging: string;
    defaultMergedTitle: string;
    selectAtLeastTwoNotes: string;
    markdownOnly: string;
    failedToMergeNotes: (reason: string) => string;
    mergedInto: (count: number, basename: string) => string;
    trashedSources: (count: number) => string;
    failedToTrashSources: (count: number) => string;
    trashedSourcesPartial: (success: number, failed: number) => string;
  };
  tagInput: {
    addTitle: string;
    removeTitle: string;
    tagLabel: string;
    tagPlaceholder: string;
    invalidTag: string;
    cancel: string;
    add: string;
    adding: string;
    remove: string;
    removing: string;
  };
  singleTagActions: {
    added: (tag: string, basename: string) => string;
    removed: (tag: string, basename: string) => string;
    absent: (tag: string, basename: string) => string;
    failedToAdd: (reason: string) => string;
    failedToRemove: (reason: string) => string;
  };
  singleRemoveTag: {
    modalTitle: string;
    noRemovableTags: string;
  };
  bulkAddTag: {
    noSelectedNotes: string;
    added: (count: number, tag: string) => string;
    failed: (count: number, tag: string) => string;
    partial: (success: number, failed: number, tag: string) => string;
  };
  bulkRemoveTag: {
    noSelectedNotes: string;
    noRemovableTags: string;
    modalTitle: string;
    removeSelectedTags: string;
    removingSelectedTags: string;
    selectedTagCount: (count: number) => string;
    removed: (removed: number, tagCount: number) => string;
    noop: (noop: number, tagCount: number) => string;
    failed: (failed: number, tagCount: number) => string;
    partial: (removed: number, noop: number, failed: number, tagCount: number) => string;
  };
  folderManagement: {
    createChildTitle: string;
    nameLabel: string;
    cancel: string;
    create: string;
    creating: string;
    emptyName: string;
    invalidName: string;
    folderNotFound: string;
    createFailed: (reason: string) => string;
    sameTarget: string;
    invalidMoveTarget: string;
    moveFailed: (reason: string) => string;
    deleteFailed: (reason: string) => string;
    renameTitle: string;
    rename: string;
    renaming: string;
    renameFailed: (reason: string) => string;
    unchangedName: string;
    duplicateConfirmTitle: string;
    duplicateConfirmBody: (count: number) => string;
    duplicateConfirm: string;
    duplicateFailed: (reason: string) => string;
    createFileFailed: (reason: string) => string;
  };
  contextMenu: {
    openInCurrentWindow: string;
    openInNewTab: string;
    openToTheRight: string;
    openInNewWindow: string;
    makeCopy: string;
    moveFileTo: string;
    addTag: string;
    removeTag: string;
    copyTitle: string;
    copyContent: string;
    copyTitleAndContent: string;
    rename: string;
    delete: string;
  };
  navMenu: {
    newNote: string;
    newFolder: string;
    newCanvas: string;
    newBase: string;
    newNoteAtRoot: string;
    newFolderAtRoot: string;
    newCanvasAtRoot: string;
    newBaseAtRoot: string;
    duplicateFolder: string;
    renameFolder: string;
    findInFolder: string;
    copyPath: string;
    copyVaultPath: string;
    copySystemPath: string;
    revealInSystemExplorer: string;
    expandAllFolders: string;
    collapseAllFolders: string;
    expandAllTags: string;
    collapseAllTags: string;
    addTagToFilter: string;
    removeTagFromFilter: string;
    filterByOnlyThisTag: string;
    expandSubtags: string;
    collapseSubtags: string;
    newNoteWithTag: string;
    copyTag: string;
    clearTagFilter: string;
    openThisBox: string;
    exitThisBox: string;
    restoreExcludedCards: (count: number) => string;
    favorite: string;
    unfavorite: string;
    moveFavoriteUp: string;
    moveFavoriteDown: string;
    moveSectionUp: string;
    moveSectionDown: string;
    clearFavorites: string;
    clearFavoritesConfirmTitle: string;
    clearFavoritesConfirmBody: (count: number) => string;
    clearFavoritesConfirm: string;
  };
  dragInsertMenu: {
    insertWikiLink: string;
    insertEmbedLink: string;
    insertContent: string;
    insertTitleAndContent: string;
    unsupportedForFileType: string;
    sourceFileMissing: string;
  };
}

export const viewStrings: Record<UiLanguage, ViewStrings> = {
  en: viewStringsEn,
  zh: viewStringsZh,
};
