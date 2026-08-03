import type { Menu } from "obsidian";
import type { UiStrings } from "../i18n";
import { findCardBox } from "./card-boxes";
import { isFavorite } from "./favorites";
import { normalizeTagPath } from "./tag-tree";
import type {
  CardBoxDefinition,
  FavoriteEntry,
  FavoriteKind,
  NavContextMenuPayload,
  NavSectionId,
} from "./types";

export interface NavMenuActions {
  createNote: (folderUiPath: string) => void;
  createFolder: (folderUiPath: string) => void;
  createCanvas: (folderUiPath: string) => void;
  createBase: (folderUiPath: string) => void;
  duplicateFolder: (folderUiPath: string) => void;
  moveFolder: (folderUiPath: string) => void;
  renameFolder: (folderUiPath: string) => void;
  deleteFolder: (folderUiPath: string) => void;
  findInFolder: (folderUiPath: string) => void;
  copyPath: (ref: string, mode: "vault" | "system") => void;
  revealInSystemExplorer: (ref: string) => void;
  toggleIncludeSubfolders: () => void;
  toggleSection: (section: NavSectionId) => void;
  addTagToFilter: (tag: string) => void;
  removeTagFromFilter: (tag: string) => void;
  filterByOnlyTag: (tag: string) => void;
  clearTagFilter: () => void;
  createNoteWithTag: (tag: string) => void;
  copyTag: (tag: string) => void;
  boxCommand: (command: string, boxId?: string) => void;
  appendAddScopeSubmenu: (menu: Menu) => void;
  restoreBoxExcluded: (boxId: string) => void;
  toggleFavorite: (kind: FavoriteKind, ref: string) => void;
  moveFavorite: (kind: FavoriteKind, ref: string, delta: -1 | 1) => void;
  clearFavorites: () => void;
  cardMenu: (menu: Menu, notePath: string) => void;
}

export interface NavMenuDeps {
  strings: UiStrings;
  isBoxMode: boolean;
  includeSubfolders: boolean;
  activeFilterTags: string[];
  canResolveSystemPath: boolean;
  favorites: FavoriteEntry[];
  boxes: CardBoxDefinition[];
  activeBoxId: string | null;
  boxExcludedCount: (boxId: string) => number;
  sectionCollapsed: Record<NavSectionId, boolean>;
  actions: NavMenuActions;
}

type MenuItemLike = Parameters<Parameters<Menu["addItem"]>[0]>[0];

interface SubmenuCapableItem {
  setSubmenu?: () => Menu;
}

function addItem(
  menu: Menu,
  title: string,
  icon: string,
  onClick: () => void,
  configure?: (item: MenuItemLike) => void,
): void {
  menu.addItem((item) => {
    item.setTitle(title).setIcon(icon).onClick(onClick);
    configure?.(item);
  });
}

/**
 * `setSubmenu` is absent from the installed `obsidian` typings, so the runtime
 * probe mirrors `appendAddScopeToBoxMenu` in `FolderCardView`.
 */
function addSubmenuItem(
  menu: Menu,
  title: string,
  icon: string,
  build: (submenu: Menu) => void,
  fallback: () => void,
): void {
  menu.addItem((item) => {
    item.setTitle(title).setIcon(icon);
    const submenu = (item as unknown as SubmenuCapableItem).setSubmenu?.();
    if (submenu && typeof submenu.addItem === "function") {
      build(submenu);
      return;
    }
    item.onClick(fallback);
  });
}

function appendFavoriteToggleItem(
  menu: Menu,
  deps: NavMenuDeps,
  kind: FavoriteKind,
  ref: string,
): void {
  const navMenu = deps.strings.view.navMenu;
  const favorited = isFavorite(deps.favorites, kind, ref);
  addItem(
    menu,
    favorited ? navMenu.unfavorite : navMenu.favorite,
    favorited ? "star-off" : "star",
    () => deps.actions.toggleFavorite(kind, ref),
  );
}

function appendSectionToggleItem(menu: Menu, deps: NavMenuDeps, section: NavSectionId): void {
  const collapsed = deps.sectionCollapsed[section];
  addItem(
    menu,
    collapsed ? deps.strings.toolbar.navPane.expandSection : deps.strings.toolbar.navPane.collapseSection,
    collapsed ? "chevron-right" : "chevron-down",
    () => deps.actions.toggleSection(section),
  );
}

function appendCreateItems(menu: Menu, deps: NavMenuDeps, folderUiPath: string, atRoot: boolean): void {
  const navMenu = deps.strings.view.navMenu;
  addItem(menu, atRoot ? navMenu.newNoteAtRoot : navMenu.newNote, "square-pen", () =>
    deps.actions.createNote(folderUiPath),
  );
  addItem(menu, atRoot ? navMenu.newFolderAtRoot : navMenu.newFolder, "folder-plus", () =>
    deps.actions.createFolder(folderUiPath),
  );
  addItem(menu, atRoot ? navMenu.newCanvasAtRoot : navMenu.newCanvas, "layout-dashboard", () =>
    deps.actions.createCanvas(folderUiPath),
  );
  addItem(menu, atRoot ? navMenu.newBaseAtRoot : navMenu.newBase, "layout-list", () =>
    deps.actions.createBase(folderUiPath),
  );
}

function appendCopyPathItem(menu: Menu, deps: NavMenuDeps, ref: string): void {
  const navMenu = deps.strings.view.navMenu;
  addSubmenuItem(
    menu,
    navMenu.copyPath,
    "clipboard-copy",
    (submenu) => {
      submenu.addItem((sub) => {
        sub
          .setTitle(navMenu.copyVaultPath)
          .setIcon("vault")
          .onClick(() => deps.actions.copyPath(ref, "vault"));
      });
      if (deps.canResolveSystemPath) {
        submenu.addItem((sub) => {
          sub
            .setTitle(navMenu.copySystemPath)
            .setIcon("hard-drive")
            .onClick(() => deps.actions.copyPath(ref, "system"));
        });
      }
    },
    () => deps.actions.copyPath(ref, "vault"),
  );
}

function buildFoldersHeaderMenu(menu: Menu, payload: NavContextMenuPayload, deps: NavMenuDeps): boolean {
  const navMenu = deps.strings.view.navMenu;
  appendCreateItems(menu, deps, "/", true);
  menu.addSeparator();

  const expanded = payload.bridge.hasExpandedFolders;
  addItem(
    menu,
    expanded ? navMenu.collapseAllFolders : navMenu.expandAllFolders,
    expanded ? "chevrons-down-up" : "chevrons-up-down",
    () => payload.bridge.toggleAllFolders(),
  );

  addItem(
    menu,
    deps.strings.toolbar.folderMenu.includeSubfolders,
    "folder-tree",
    () => deps.actions.toggleIncludeSubfolders(),
    (item) => {
      item.setChecked(deps.includeSubfolders);
      item.setDisabled(deps.isBoxMode);
    },
  );

  menu.addSeparator();
  appendSectionToggleItem(menu, deps, "folders");
  return true;
}

function buildRootFolderItemMenu(menu: Menu, deps: NavMenuDeps): boolean {
  const navMenu = deps.strings.view.navMenu;
  appendCreateItems(menu, deps, "/", false);
  menu.addSeparator();
  addItem(menu, navMenu.findInFolder, "search", () => deps.actions.findInFolder("/"));
  if (deps.canResolveSystemPath) {
    addItem(menu, navMenu.revealInSystemExplorer, "folder-symlink", () =>
      deps.actions.revealInSystemExplorer(""),
    );
  }
  return true;
}

function buildFolderItemMenu(menu: Menu, deps: NavMenuDeps, itemId: string): boolean {
  const navMenu = deps.strings.view.navMenu;
  const folderMenu = deps.strings.toolbar.folderMenu;

  appendCreateItems(menu, deps, itemId, false);
  menu.addSeparator();

  addItem(menu, navMenu.duplicateFolder, "copy", () => deps.actions.duplicateFolder(itemId));
  addItem(menu, folderMenu.moveFolder, "folder-input", () => deps.actions.moveFolder(itemId));
  addItem(menu, navMenu.findInFolder, "search", () => deps.actions.findInFolder(itemId));
  appendFavoriteToggleItem(menu, deps, "folder", itemId);

  menu.addSeparator();
  appendCopyPathItem(menu, deps, itemId);
  if (deps.canResolveSystemPath) {
    addItem(menu, navMenu.revealInSystemExplorer, "folder-symlink", () =>
      deps.actions.revealInSystemExplorer(itemId),
    );
  }

  menu.addSeparator();
  addItem(menu, navMenu.renameFolder, "pencil", () => deps.actions.renameFolder(itemId));
  addItem(menu, folderMenu.deleteFolder, "trash", () => deps.actions.deleteFolder(itemId));
  return true;
}

function buildTagsHeaderMenu(menu: Menu, payload: NavContextMenuPayload, deps: NavMenuDeps): boolean {
  if (deps.isBoxMode) {
    appendSectionToggleItem(menu, deps, "tags");
    return true;
  }

  const navMenu = deps.strings.view.navMenu;
  addItem(
    menu,
    navMenu.clearTagFilter,
    "filter-x",
    () => deps.actions.clearTagFilter(),
    (item) => {
      item.setDisabled(deps.activeFilterTags.length === 0);
    },
  );

  menu.addSeparator();

  const expanded = payload.bridge.hasExpandedTags;
  addItem(
    menu,
    expanded ? navMenu.collapseAllTags : navMenu.expandAllTags,
    expanded ? "chevrons-down-up" : "chevrons-up-down",
    () => payload.bridge.toggleAllTags(),
  );

  menu.addSeparator();
  appendSectionToggleItem(menu, deps, "tags");
  return true;
}

function buildTagItemMenu(
  menu: Menu,
  payload: NavContextMenuPayload,
  deps: NavMenuDeps,
  itemId: string,
): boolean {
  if (deps.isBoxMode) {
    return false;
  }

  const navMenu = deps.strings.view.navMenu;
  const isActive = deps.activeFilterTags.some((tag) => normalizeTagPath(tag) === itemId);

  addItem(
    menu,
    isActive ? navMenu.removeTagFromFilter : navMenu.addTagToFilter,
    "tag",
    () => (isActive ? deps.actions.removeTagFromFilter(itemId) : deps.actions.addTagToFilter(itemId)),
    (item) => {
      item.setChecked(isActive);
    },
  );

  addItem(
    menu,
    navMenu.filterByOnlyThisTag,
    "filter",
    () => deps.actions.filterByOnlyTag(itemId),
    (item) => {
      item.setDisabled(isActive && deps.activeFilterTags.length === 1);
    },
  );

  if (payload.bridge.tagHasChildren) {
    menu.addSeparator();
    addItem(
      menu,
      payload.bridge.tagExpanded ? navMenu.collapseSubtags : navMenu.expandSubtags,
      payload.bridge.tagExpanded ? "chevron-down" : "chevron-right",
      () => payload.bridge.toggleTagExpansion(),
    );
  }

  menu.addSeparator();
  addItem(menu, navMenu.newNoteWithTag, "square-pen", () => deps.actions.createNoteWithTag(itemId));
  addItem(menu, navMenu.copyTag, "clipboard-copy", () => deps.actions.copyTag(itemId));
  appendFavoriteToggleItem(menu, deps, "tag", itemId);
  return true;
}

function buildBoxesHeaderMenu(menu: Menu, deps: NavMenuDeps): boolean {
  const box = deps.strings.box;
  addItem(menu, box.createBox, "box", () => deps.actions.boxCommand("create"));

  if (!deps.isBoxMode) {
    addItem(menu, box.saveScopeAsBox, "package-plus", () =>
      deps.actions.boxCommand("save-scope-as-box"),
    );
    deps.actions.appendAddScopeSubmenu(menu);
  }

  menu.addSeparator();
  appendSectionToggleItem(menu, deps, "boxes");
  return true;
}

function buildBoxItemMenu(menu: Menu, deps: NavMenuDeps, itemId: string): boolean {
  if (findCardBox(deps.boxes, itemId) === null) {
    return false;
  }

  const navMenu = deps.strings.view.navMenu;
  const box = deps.strings.box;
  const isActive = itemId === deps.activeBoxId;

  addItem(
    menu,
    isActive ? navMenu.exitThisBox : navMenu.openThisBox,
    isActive ? "log-out" : "box",
    () => deps.actions.boxCommand(isActive ? "exit" : "switch", itemId),
  );
  addItem(menu, box.configure, "settings-2", () => deps.actions.boxCommand("configure", itemId));

  if (!deps.isBoxMode) {
    addItem(menu, box.addScopeToThisBox, "list-plus", () =>
      deps.actions.boxCommand("add-scope-to-box", itemId),
    );
  }

  const excludedCount = deps.boxExcludedCount(itemId);
  if (excludedCount > 0) {
    addItem(menu, navMenu.restoreExcludedCards(excludedCount), "undo-2", () =>
      deps.actions.restoreBoxExcluded(itemId),
    );
  }

  appendFavoriteToggleItem(menu, deps, "box", itemId);

  menu.addSeparator();
  addItem(menu, box.duplicate, "copy", () => deps.actions.boxCommand("duplicate", itemId));

  menu.addSeparator();
  addItem(menu, box.rename, "pencil", () => deps.actions.boxCommand("rename", itemId));
  addItem(menu, box.delete, "trash-2", () => deps.actions.boxCommand("delete", itemId));
  return true;
}

function buildFavoritesHeaderMenu(menu: Menu, deps: NavMenuDeps): boolean {
  addItem(
    menu,
    deps.strings.view.navMenu.clearFavorites,
    "star-off",
    () => deps.actions.clearFavorites(),
    (item) => {
      item.setDisabled(deps.favorites.length === 0);
    },
  );

  menu.addSeparator();
  appendSectionToggleItem(menu, deps, "favorites");
  return true;
}

function getFavoriteGroupPosition(
  favorites: FavoriteEntry[],
  favorite: FavoriteEntry,
): { index: number; size: number } {
  const group = favorites.filter((entry) => entry.kind === favorite.kind);
  return {
    index: group.findIndex((entry) => entry.ref === favorite.ref),
    size: group.length,
  };
}

function buildFavoriteItemMenu(
  menu: Menu,
  payload: NavContextMenuPayload,
  deps: NavMenuDeps,
): boolean {
  const favorite = payload.favorite;
  if (!favorite) {
    return false;
  }

  const navMenu = deps.strings.view.navMenu;
  const { kind, ref } = favorite;
  const { index, size } = getFavoriteGroupPosition(deps.favorites, favorite);

  addItem(menu, navMenu.unfavorite, "star-off", () => deps.actions.toggleFavorite(kind, ref));
  addItem(
    menu,
    navMenu.moveFavoriteUp,
    "arrow-up",
    () => deps.actions.moveFavorite(kind, ref, -1),
    (item) => {
      item.setDisabled(index <= 0);
    },
  );
  addItem(
    menu,
    navMenu.moveFavoriteDown,
    "arrow-down",
    () => deps.actions.moveFavorite(kind, ref, 1),
    (item) => {
      item.setDisabled(index === -1 || index === size - 1);
    },
  );

  menu.addSeparator();

  if (kind === "folder") {
    if (ref === "") {
      buildRootFolderItemMenu(menu, deps);
      return true;
    }
    buildFolderItemMenu(menu, deps, ref);
    return true;
  }

  if (kind === "file") {
    deps.actions.cardMenu(menu, ref);
    return true;
  }

  if (kind === "tag") {
    buildTagItemMenu(menu, payload, deps, ref);
    return true;
  }

  buildBoxItemMenu(menu, deps, ref);
  return true;
}

/** Returns false when no items were added; the caller then skips showing the menu. */
export function buildNavContextMenu(
  menu: Menu,
  payload: NavContextMenuPayload,
  deps: NavMenuDeps,
): boolean {
  if (payload.section === "favorites") {
    return payload.scope === "header"
      ? buildFavoritesHeaderMenu(menu, deps)
      : buildFavoriteItemMenu(menu, payload, deps);
  }

  if (payload.section === "folders") {
    if (payload.scope === "header") {
      return buildFoldersHeaderMenu(menu, payload, deps);
    }
    if (typeof payload.itemId !== "string") {
      return false;
    }
    return payload.itemId === "/"
      ? buildRootFolderItemMenu(menu, deps)
      : buildFolderItemMenu(menu, deps, payload.itemId);
  }

  if (payload.section === "tags") {
    if (payload.scope === "header") {
      return buildTagsHeaderMenu(menu, payload, deps);
    }
    if (typeof payload.itemId !== "string") {
      return false;
    }
    return buildTagItemMenu(menu, payload, deps, payload.itemId);
  }

  if (payload.scope === "header") {
    return buildBoxesHeaderMenu(menu, deps);
  }
  if (typeof payload.itemId !== "string") {
    return false;
  }
  return buildBoxItemMenu(menu, deps, payload.itemId);
}

/**
 * Menu-item title that `markMenuItemAsDanger` should highlight, or null.
 * `markMenuItemAsDanger` matches on rendered title text, so the wrong label
 * silently leaves the delete row unstyled.
 */
export function resolveNavMenuDangerLabel(
  payload: NavContextMenuPayload,
  deps: NavMenuDeps,
): string | null {
  if (payload.scope === "header") {
    return null;
  }

  if (payload.section === "folders") {
    return payload.itemId === "/" || typeof payload.itemId !== "string"
      ? null
      : deps.strings.toolbar.folderMenu.deleteFolder;
  }

  if (payload.section === "boxes") {
    return typeof payload.itemId === "string" ? deps.strings.box.delete : null;
  }

  if (payload.section === "favorites") {
    const favorite = payload.favorite;
    if (!favorite) {
      return null;
    }
    if (favorite.kind === "folder") {
      return favorite.ref === "" ? null : deps.strings.toolbar.folderMenu.deleteFolder;
    }
    if (favorite.kind === "file") {
      return deps.strings.view.contextMenu.delete;
    }
    if (favorite.kind === "box") {
      return deps.strings.box.delete;
    }
    return null;
  }

  return null;
}
