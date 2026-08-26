import type { NavMenuDeps } from "../nav-context-menu";
import { canResolveSystemPath } from "../desktop-shell";
import type { ViewContext } from "../view-context";
import type { ViewModules } from "../view-modules";

export interface NavMenuDepsHost {
  context: ViewContext;
  modules: ViewModules;
  onIncludeSubfoldersChange: (detail: { value?: unknown }) => Promise<void>;
}

/** Binds the nav context menu's action table to the view's controllers and actions. */
export function buildNavMenuDeps(deps: NavMenuDepsHost): NavMenuDeps {
  const settings = deps.context.getSettings();
  return {
    strings: deps.context.getUiStrings(),
    isBoxMode: deps.modules.boxActions.isBoxMode(),
    includeSubfolders: settings.includeSubfolders,
    activeFilterTags: settings.filter.tags,
    canResolveSystemPath: canResolveSystemPath(deps.context.getApp()),
    favorites: settings.favorites ?? [],
    boxes: settings.boxes ?? [],
    activeBoxId: deps.modules.boxActions.getActiveBox()?.id ?? null,
    boxExcludedCount: (boxId) => deps.modules.boxActions.getBoxExcludedCount(boxId),
    sectionCollapsed: {
      favorites: settings.favoritesSectionCollapsed,
      folders: settings.folderSectionCollapsed,
      tags: settings.tagSectionCollapsed,
      boxes: settings.boxSectionCollapsed,
    },
    hasExpandedFolders: deps.modules.navLayout.hasExpandedRows("folder"),
    hasExpandedTags: deps.modules.navLayout.hasExpandedRows("tag"),
    tagExpansion: (tag) => deps.modules.navLayout.getTagExpansion(tag),
    expansionActions: {
      toggleAllFolders: () => { void deps.modules.navLayout.toggleAll("folder"); },
      toggleAllTags: () => { void deps.modules.navLayout.toggleAll("tag"); },
      toggleTag: (tag) => { void deps.modules.navLayout.toggleById(`tag:${tag}`); },
    },
    actions: {
      createNote: (folderUiPath) => {
        void deps.modules.folderActions.createFromFolderTree(folderUiPath, "note");
      },
      createFolder: (folderUiPath) => {
        void deps.modules.folderActions.createFromFolderTree(folderUiPath, "folder");
      },
      createCanvas: (folderUiPath) => {
        void deps.modules.folderActions.createFromFolderTree(folderUiPath, "canvas");
      },
      createBase: (folderUiPath) => {
        void deps.modules.folderActions.createFromFolderTree(folderUiPath, "base");
      },
      duplicateFolder: (folderUiPath) => {
        void deps.modules.folderActions.duplicateFolder(folderUiPath);
      },
      moveFolder: (folderUiPath) => {
        deps.modules.folderActions.openMoveFolderPickerForFolder(folderUiPath);
      },
      renameFolder: (folderUiPath) => {
        deps.modules.folderActions.openRenameFolderModal(folderUiPath);
      },
      deleteFolder: (folderUiPath) => {
        void deps.modules.folderActions.deleteFolder(folderUiPath);
      },
      findInFolder: (folderUiPath) => {
        void deps.modules.folderActions.findInFolder(folderUiPath);
      },
      copyPath: (ref, mode) => {
        void deps.modules.favoriteActions.copyFavoritePath(ref, mode);
      },
      revealInSystemExplorer: (ref) => {
        void deps.modules.favoriteActions.revealInSystemExplorer(ref);
      },
      toggleIncludeSubfolders: () => {
        void deps.onIncludeSubfoldersChange({ value: !settings.includeSubfolders });
      },
      toggleSection: (section) => {
        void deps.modules.navLayout.onToggleNavSection(section);
      },
      addTagToFilter: (tag) => {
        void deps.modules.tagActions.addTagToFilter(tag);
      },
      removeTagFromFilter: (tag) => {
        void deps.modules.tagActions.removeTagFromFilter(tag);
      },
      filterByOnlyTag: (tag) => {
        void deps.modules.tagActions.filterByOnlyTag(tag);
      },
      clearTagFilter: () => {
        void deps.modules.tagActions.clearTagFilter();
      },
      createNoteWithTag: (tag) => {
        void deps.modules.tagActions.createNoteWithTag(tag);
      },
      copyTag: (tag) => {
        void deps.modules.tagActions.copyTag(tag);
      },
      boxCommand: (command, boxId) => {
        deps.modules.boxActions.handleBoxCommand({ command, boxId });
      },
      appendAddScopeSubmenu: (menu) => {
        deps.modules.boxActions.appendAddScopeToBoxMenu(menu);
      },
      restoreBoxExcluded: (boxId) => {
        void deps.modules.boxActions.restoreBoxExcluded(boxId);
      },
      toggleFavorite: (kind, ref) => {
        void deps.modules.favoriteActions.toggleFavoriteEntry(kind, ref);
      },
      moveFavorite: (kind, ref, delta) => {
        void deps.modules.favoriteActions.moveFavoriteEntry(kind, ref, delta);
      },
      clearFavorites: () => {
        void deps.modules.favoriteActions.clearFavorites();
      },
      cardMenu: (menu, notePath) => {
        deps.modules.cardMenu.addItems(menu, notePath);
      },
    },
  };
}
