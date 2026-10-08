import type { Menu } from "obsidian";

import { canMoveNavSection } from "../../navigation-section-order";
import type { NavMenuDeps } from "../nav-context-menu";
import type { NavSectionId } from "../types";
import { appendNavSectionToggleItem } from "./nav-menu-expansion";

/** Trailing header group: collapse/expand, then move-up, then move-down. */
export function appendNavSectionHeaderItems(
  menu: Menu,
  deps: NavMenuDeps,
  section: NavSectionId,
): void {
  menu.addItem((item) => item.setTitle(deps.strings.navigationVisibility.hideSection)
    .setIcon("eye-off").onClick(() => deps.actions.hideSection(section)));
  appendNavSectionToggleItem(menu, deps, section);
  const navMenu = deps.strings.view.navMenu;
  menu.addItem((item) => {
    item
      .setTitle(navMenu.moveSectionUp)
      .setIcon("arrow-up")
      .onClick(() => deps.actions.moveSection(section, -1))
      .setDisabled(!canMoveNavSection(deps.sectionOrder, section, -1, deps.hiddenSections));
  });
  menu.addItem((item) => {
    item
      .setTitle(navMenu.moveSectionDown)
      .setIcon("arrow-down")
      .onClick(() => deps.actions.moveSection(section, 1))
      .setDisabled(!canMoveNavSection(deps.sectionOrder, section, 1, deps.hiddenSections));
  });
}
