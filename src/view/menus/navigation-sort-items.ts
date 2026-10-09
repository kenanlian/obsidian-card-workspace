import type { Menu } from "obsidian";
import type { NavigationSortTarget } from "../../navigation-sorting";
import type { NavMenuDeps } from "../nav-context-menu";
import { addItem } from "./nav-menu-items";

/** A header sorts its items; a branch item sorts its children, as in Folders. */
export function appendNavigationSortItems(menu: Menu, deps: NavMenuDeps, target: NavigationSortTarget): void {
  const strings = deps.strings.view.navMenu;
  const mode = deps.navigationSortMode(target);
  for (const [value, title, icon] of [
    ["asc", strings.sortNameAsc, "sort-asc"],
    ["desc", strings.sortNameDesc, "sort-desc"],
    ["manual", strings.sortManual, "list-ordered"],
  ] as const) {
    addItem(menu, title, icon, () => deps.actions.sortNavigationItems(target, value), (item) => item.setChecked(mode === value));
  }
}
