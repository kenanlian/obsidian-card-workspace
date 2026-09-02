import type { Menu } from "obsidian";
import type { PropertyScalarRef } from "../../property-filter-settings";
import type { NavMenuDeps } from "../nav-context-menu";
import { addItem } from "./nav-menu-items";
import { appendNavSectionHeaderItems } from "./nav-section-header-items";

/**
 * Properties lane menus (C9). The header offers the chooser first, then the
 * filter clear, then the generic section move/collapse items. Key rows can be
 * hidden with the same coherent cleanup as the chooser; value rows only filter,
 * never edit frontmatter.
 */
export function buildPropertiesHeaderMenu(menu: Menu, deps: NavMenuDeps): boolean {
  const property = deps.strings.property;
  addItem(menu, property.chooseVisible, "settings-2", () => deps.actions.chooseVisibleProperties());
  addItem(
    menu,
    property.clearFilters,
    "filter-x",
    () => deps.actions.clearPropertyFilters(),
    (item) => {
      item.setDisabled(deps.propertyFilterCount === 0);
    },
  );
  menu.addSeparator();
  appendNavSectionHeaderItems(menu, deps, "properties");
  return true;
}

/** Property-key item menu: Hide this property. */
export function buildPropertyKeyMenu(menu: Menu, deps: NavMenuDeps, key: string): boolean {
  addItem(menu, deps.strings.property.hideThisProperty, "eye-off", () => deps.actions.hideProperty(key));
  return true;
}

/** Property-value item menu: add/remove from filter, then filter-by-only. */
export function buildPropertyValueMenu(
  menu: Menu,
  deps: NavMenuDeps,
  key: string,
  value: PropertyScalarRef,
): boolean {
  const property = deps.strings.property;
  const isActive = deps.isPropertyValueActive(key, value);

  addItem(
    menu,
    isActive ? property.removeFromFilter : property.addToFilter,
    isActive ? "filter-x" : "filter",
    () => deps.actions.togglePropertyValue(key, value),
    (item) => {
      item.setChecked(isActive);
    },
  );
  addItem(
    menu,
    property.filterByOnlyThisValue,
    "list-filter",
    () => deps.actions.filterByOnlyPropertyValue(key, value),
    (item) => {
      item.setDisabled(isActive && deps.propertyFilterCount === 1);
    },
  );
  return true;
}
