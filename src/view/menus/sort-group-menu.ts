import type { Menu } from "obsidian";

import type { GroupDimension, GroupOrderBy, GroupSpec } from "../../card-grouping-settings";
import type { SortGroupStrings } from "../../i18n";
import type { SortDirection, SortField } from "../../settings";
import { getMenuDom } from "../menu-dom";

/** Class added to the native menu surface so styles.css can scope its rules. */
export const SORT_GROUP_MENU_CLASS = "fce-sort-group-menu";
/** Class added to the four muted section heading rows after the menu is shown. */
export const SORT_GROUP_MENU_SECTION_TITLE_CLASS = "fce-menu-section-title";

const HINT_CLASS = "fce-menu-item-hint";

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
  checked: boolean;
  disabled: boolean;
  hint?: string;
  onSelect?: () => void;
}

/**
 * Native menu items have no two-line hint API, so the disabled box-rule row
 * carries its hint as a second muted line inside the title. The fragment keeps
 * the label and hint as separate styled nodes; environments without a DOM
 * (node unit tests) degrade to the plain label.
 */
function buildTitledOption(title: string, hint: string | undefined): string | DocumentFragment {
  if (hint === undefined || typeof document === "undefined") {
    return title;
  }

  const fragment = document.createDocumentFragment();
  const label = document.createElement("div");
  label.textContent = title;
  const hintEl = document.createElement("div");
  hintEl.className = HINT_CLASS;
  hintEl.textContent = hint;
  fragment.append(label, hintEl);
  return fragment;
}

function addHeadingItem(menu: Menu, title: string): void {
  menu.addItem((item) => {
    item.setTitle(title).setIcon(null).setDisabled(true);
  });
}

function addOptionItem(menu: Menu, spec: SortGroupOptionSpec): void {
  menu.addItem((item) => {
    item
      .setTitle(buildTitledOption(spec.title, spec.hint))
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
    checked: state.sortField === "mtime",
    disabled: false,
    onSelect: () => deps.onSelectSort("mtime"),
  });
  addOptionItem(menu, {
    title: strings.fieldCtime,
    checked: state.sortField === "ctime",
    disabled: false,
    onSelect: () => deps.onSelectSort("ctime"),
  });
  addOptionItem(menu, {
    title: strings.fieldName,
    checked: state.sortField === "name",
    disabled: false,
    onSelect: () => deps.onSelectSort("name"),
  });

  menu.addSeparator();

  addHeadingItem(menu, strings.sortDirectionHeading);
  addOptionItem(menu, {
    title: strings.directionAsc,
    checked: state.sortDirection === "asc",
    disabled: false,
    onSelect: () => deps.onSelectDirection("asc"),
  });
  addOptionItem(menu, {
    title: strings.directionDesc,
    checked: state.sortDirection === "desc",
    disabled: false,
    onSelect: () => deps.onSelectDirection("desc"),
  });

  menu.addSeparator();

  addHeadingItem(menu, strings.groupHeading);
  const dimensionOptions: Array<{ dimension: GroupDimension; title: string }> = [
    { dimension: "none", title: strings.dimensionNone },
    { dimension: "folder", title: strings.dimensionFolder },
    { dimension: "tag", title: strings.dimensionTag },
    { dimension: "box-rule", title: strings.dimensionBoxRule },
    { dimension: "task", title: strings.dimensionTask },
  ];
  for (const { dimension, title } of dimensionOptions) {
    const unavailable = !state.availableGroupDimensions.includes(dimension);
    addOptionItem(menu, {
      title,
      checked: state.group.dimension === dimension,
      disabled: unavailable,
      hint: unavailable && dimension === "box-rule" ? strings.dimensionBoxRuleUnavailable : undefined,
      onSelect: () => deps.onSelectDimension(dimension),
    });
  }

  menu.addSeparator();

  addHeadingItem(menu, strings.groupOrderHeading);
  const orderByOptions: Array<{ orderBy: GroupOrderBy; title: string }> = [
    { orderBy: "default", title: strings.orderDefault },
    { orderBy: "name", title: strings.orderName },
    { orderBy: "count", title: strings.orderCount },
  ];
  for (const { orderBy, title } of orderByOptions) {
    addOptionItem(menu, {
      title,
      checked: state.group.orderBy === orderBy,
      disabled: groupOrderDisabled,
      onSelect: () => deps.onSelectOrderBy(orderBy),
    });
  }

  menu.addSeparator();

  addOptionItem(menu, {
    title: strings.directionAsc,
    checked: state.group.orderDirection === "asc",
    disabled: groupOrderDisabled,
    onSelect: () => deps.onSelectOrderDirection("asc"),
  });
  addOptionItem(menu, {
    title: strings.directionDesc,
    checked: state.group.orderDirection === "desc",
    disabled: groupOrderDisabled,
    onSelect: () => deps.onSelectOrderDirection("desc"),
  });

  menu.addSeparator();

  addOptionItem(menu, {
    title: strings.collapseAll,
    checked: false,
    disabled: !state.hasSegments,
    onSelect: () => deps.onCollapseAll(),
  });
  addOptionItem(menu, {
    title: strings.expandAll,
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
