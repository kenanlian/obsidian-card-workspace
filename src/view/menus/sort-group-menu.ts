import type { Menu } from "obsidian";

import type { GroupDimension, GroupOrderBy, GroupSpec } from "../../card-grouping-settings";
import type { SortGroupStrings } from "../../i18n";
import type { SortDirection, SortField } from "../../settings";
import { getMenuDom } from "../menu-dom";

/** Class added to the native menu surface so styles.css can scope its rules. */
export const SORT_GROUP_MENU_CLASS = "fce-sort-group-menu";
/** Class added to the four muted section heading rows after the menu is shown. */
export const SORT_GROUP_MENU_SECTION_TITLE_CLASS = "fce-menu-section-title";

export interface SortGroupMenuState {
  sortField: SortField;
  sortDirection: SortDirection;
  group: GroupSpec;
  availableGroupDimensions: GroupDimension[];
  hasSegments: boolean;
}

export interface SortGroupMenuDeps {
  strings: SortGroupStrings;
  onSelectSort: (field: SortField) => void;
  onSelectDirection: (direction: SortDirection) => void;
  onSelectDimension: (dimension: GroupDimension) => void;
  onSelectOrderBy: (orderBy: GroupOrderBy) => void;
  onSelectOrderDirection: (direction: SortDirection) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
}

interface SortGroupOptionSpec {
  title: string;
  icon: string;
  checked: boolean;
  disabled: boolean;
  onSelect?: () => void;
}

function addHeadingItem(menu: Menu, title: string): void {
  menu.addItem((item) => {
    item.setTitle(title).setIcon(null).setDisabled(true);
  });
}

function addOptionItem(menu: Menu, spec: SortGroupOptionSpec): void {
  menu.addItem((item) => {
    item
      .setTitle(spec.title)
      .setIcon(spec.icon)
      .setChecked(spec.checked)
      .setDisabled(spec.disabled);
    if (!spec.disabled && spec.onSelect) {
      item.onClick(spec.onSelect);
    }
  });
}

export function buildSortGroupMenu(
  menu: Menu,
  state: SortGroupMenuState,
  deps: SortGroupMenuDeps,
): Menu {
  const { strings } = deps;
  const groupOrderDisabled = state.group.dimension === "none";

  addHeadingItem(menu, strings.sortFieldHeading);
  addOptionItem(menu, {
    title: strings.fieldMtime,
    icon: "file-clock",
    checked: state.sortField === "mtime",
    disabled: false,
    onSelect: () => deps.onSelectSort("mtime"),
  });
  addOptionItem(menu, {
    title: strings.fieldCtime,
    icon: "file-plus-2",
    checked: state.sortField === "ctime",
    disabled: false,
    onSelect: () => deps.onSelectSort("ctime"),
  });
  addOptionItem(menu, {
    title: strings.fieldName,
    icon: "file-text",
    checked: state.sortField === "name",
    disabled: false,
    onSelect: () => deps.onSelectSort("name"),
  });

  menu.addSeparator();

  addHeadingItem(menu, strings.sortDirectionHeading);
  addOptionItem(menu, {
    title: strings.directionAsc,
    icon: "arrow-up",
    checked: state.sortDirection === "asc",
    disabled: false,
    onSelect: () => deps.onSelectDirection("asc"),
  });
  addOptionItem(menu, {
    title: strings.directionDesc,
    icon: "arrow-down",
    checked: state.sortDirection === "desc",
    disabled: false,
    onSelect: () => deps.onSelectDirection("desc"),
  });

  menu.addSeparator();

  addHeadingItem(menu, strings.groupHeading);
  const dimensionOptions: Array<{ dimension: GroupDimension; title: string; icon: string }> = [
    { dimension: "none", title: strings.dimensionNone, icon: "list" },
    { dimension: "folder", title: strings.dimensionFolder, icon: "folder" },
    { dimension: "tag", title: strings.dimensionTag, icon: "tag" },
    { dimension: "task", title: strings.dimensionTask, icon: "list-checks" },
  ];
  if (state.availableGroupDimensions.includes("box-rule")) {
    dimensionOptions.push({
      dimension: "box-rule",
      title: strings.dimensionBoxRule,
      icon: "package-check",
    });
  }
  for (const { dimension, title, icon } of dimensionOptions) {
    addOptionItem(menu, {
      title,
      icon,
      checked: state.group.dimension === dimension,
      disabled: !state.availableGroupDimensions.includes(dimension),
      onSelect: () => deps.onSelectDimension(dimension),
    });
  }

  menu.addSeparator();

  addHeadingItem(menu, strings.groupOrderHeading);
  const orderByOptions: Array<{ orderBy: GroupOrderBy; title: string; icon: string }> = [
    { orderBy: "default", title: strings.orderDefault, icon: "list-restart" },
    { orderBy: "name", title: strings.orderName, icon: "arrow-down-a-z" },
    { orderBy: "count", title: strings.orderCount, icon: "hash" },
  ];
  for (const { orderBy, title, icon } of orderByOptions) {
    addOptionItem(menu, {
      title,
      icon,
      checked: state.group.orderBy === orderBy,
      disabled: groupOrderDisabled,
      onSelect: () => deps.onSelectOrderBy(orderBy),
    });
  }

  menu.addSeparator();

  addOptionItem(menu, {
    title: strings.directionAsc,
    icon: "arrow-up",
    checked: state.group.orderDirection === "asc",
    disabled: groupOrderDisabled,
    onSelect: () => deps.onSelectOrderDirection("asc"),
  });
  addOptionItem(menu, {
    title: strings.directionDesc,
    icon: "arrow-down",
    checked: state.group.orderDirection === "desc",
    disabled: groupOrderDisabled,
    onSelect: () => deps.onSelectOrderDirection("desc"),
  });

  menu.addSeparator();

  addOptionItem(menu, {
    title: strings.collapseAll,
    icon: "chevrons-up",
    checked: false,
    disabled: !state.hasSegments,
    onSelect: () => deps.onCollapseAll(),
  });
  addOptionItem(menu, {
    title: strings.expandAll,
    icon: "chevrons-down",
    checked: false,
    disabled: !state.hasSegments,
    onSelect: () => deps.onExpandAll(),
  });

  return menu;
}

/**
 * Marks the native menu surface and the four section heading rows. Headings
 * are matched by title text, the same DOM decoration approach the card context
 * menu uses for its danger row; option titles never collide with heading
 * titles. Call after `showAtPosition`, mirroring the card context menu flow.
 */
export function decorateSortGroupMenu(menu: Menu, strings: SortGroupStrings): void {
  const menuDom = getMenuDom(menu);
  if (!menuDom) {
    return;
  }

  menuDom.classList.add(SORT_GROUP_MENU_CLASS);
  if (typeof menuDom.querySelectorAll !== "function") {
    return;
  }

  const headings = new Set([
    strings.sortFieldHeading,
    strings.sortDirectionHeading,
    strings.groupHeading,
    strings.groupOrderHeading,
  ]);
  for (const item of menuDom.querySelectorAll(".menu-item")) {
    const title = item.querySelector?.(".menu-item-title");
    const text = title?.textContent?.trim();
    if (text !== undefined && headings.has(text)) {
      item.classList.add(SORT_GROUP_MENU_SECTION_TITLE_CLASS);
    }
  }
}
