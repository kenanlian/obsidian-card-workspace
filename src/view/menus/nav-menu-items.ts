import type { Menu } from "obsidian";
import { isFavorite } from "../favorites";
import type { NavMenuDeps } from "../nav-context-menu";
import type { FavoriteKind } from "../types";

export type MenuItemLike = Parameters<Parameters<Menu["addItem"]>[0]>[0];

interface SubmenuCapableItem {
  setSubmenu?: () => Menu;
}

export function addItem(
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
export function addSubmenuItem(
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

export function appendFavoriteToggleItem(
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
