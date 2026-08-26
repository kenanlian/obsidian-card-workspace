import type { Menu } from "obsidian";

import type { NavMenuDeps } from "../nav-context-menu";
import type { NavSectionId } from "../types";

/** Shared persisted section toggle used by every navigation menu surface. */
export function appendNavSectionToggleItem(
  menu: Menu,
  deps: NavMenuDeps,
  section: NavSectionId,
): void {
  const collapsed = deps.sectionCollapsed[section];
  menu.addItem((item) => {
    item
      .setTitle(collapsed
        ? deps.strings.toolbar.navPane.expandSection
        : deps.strings.toolbar.navPane.collapseSection)
      .setIcon(collapsed ? "chevron-right" : "chevron-down")
      .onClick(() => deps.actions.toggleSection(section));
  });
}
