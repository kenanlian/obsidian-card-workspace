import { describe, expect, it, vi } from "vitest";
import type { Menu } from "obsidian";

import { DEFAULT_GROUP_SPEC, type GroupSpec } from "../../card-grouping-settings";
import { getUiStrings } from "../../i18n";
import type { SortDirection, SortField } from "../../settings";
import {
  buildSortGroupMenu,
  decorateSortGroupMenu,
  SORT_GROUP_MENU_CLASS,
  SORT_GROUP_MENU_SECTION_TITLE_CLASS,
  type SortGroupMenuDeps,
  type SortGroupMenuState,
} from "./sort-group-menu";

class MockMenuItem {
  title: string | DocumentFragment = "";
  icon: string | null = null;
  disabled = false;
  checked = false;
  clickHandler: (() => void) | null = null;

  setTitle(title: string | DocumentFragment): this {
    this.title = title;
    return this;
  }

  setIcon(icon: string | null): this {
    this.icon = icon;
    return this;
  }

  setChecked(checked: boolean): this {
    this.checked = checked;
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    return this;
  }

  onClick(handler: () => void): this {
    this.clickHandler = handler;
    return this;
  }
}

class MockMenu {
  items: MockMenuItem[] = [];
  separators = 0;

  addItem(configure: (item: MockMenuItem) => void): this {
    const item = new MockMenuItem();
    configure(item);
    this.items.push(item);
    return this;
  }

  addSeparator(): this {
    this.separators += 1;
    return this;
  }

  asMenu(): Menu {
    return this as unknown as Menu;
  }
}

function titleText(item: MockMenuItem): string {
  return typeof item.title === "string" ? item.title : item.title.textContent ?? "";
}

function titles(menu: MockMenu): string[] {
  return menu.items.map(titleText);
}

function itemByTitle(menu: MockMenu, title: string): MockMenuItem | undefined {
  return menu.items.find((item) => titleText(item) === title);
}

function createState(overrides: Partial<SortGroupMenuState> = {}): SortGroupMenuState {
  return {
    sortField: "mtime",
    sortDirection: "desc",
    group: DEFAULT_GROUP_SPEC,
    availableGroupDimensions: ["none", "folder", "tag", "task"],
    hasSegments: false,
    ...overrides,
  };
}

function createDeps(overrides: Partial<SortGroupMenuDeps> = {}): SortGroupMenuDeps {
  return {
    strings: getUiStrings("en").sortGroup,
    onSelectSort: vi.fn(),
    onSelectDirection: vi.fn(),
    onSelectDimension: vi.fn(),
    onSelectOrderBy: vi.fn(),
    onSelectOrderDirection: vi.fn(),
    onCollapseAll: vi.fn(),
    onExpandAll: vi.fn(),
    ...overrides,
  };
}

function buildMenu(
  state: SortGroupMenuState = createState(),
  deps: SortGroupMenuDeps = createDeps(),
): { menu: MockMenu; state: SortGroupMenuState; deps: SortGroupMenuDeps } {
  const menu = new MockMenu();
  buildSortGroupMenu(menu.asMenu(), state, deps);
  return { menu, state, deps };
}

describe("buildSortGroupMenu", () => {
  it("lays out the four headed sections with separators and trailing commands", () => {
    const { menu } = buildMenu();

    expect(titles(menu)).toEqual([
      "Sort by", "Edited time", "Created time", "Filename",
      "Order", "Ascending", "Descending",
      "Group by", "None", "Folder", "Tag", "Card box rule", "Task status",
      "Group order", "Default", "Name", "Card count", "Ascending", "Descending",
      "Collapse all", "Expand all",
    ]);
    expect(menu.separators).toBe(5);
  });

  it("renders the section vocabulary in Chinese", () => {
    const menu = new MockMenu();
    buildSortGroupMenu(
      menu.asMenu(),
      createState(),
      createDeps({ strings: getUiStrings("zh").sortGroup }),
    );

    expect(titles(menu)).toEqual([
      "排序依据", "编辑时间", "创建时间", "文件名",
      "顺序", "升序", "降序",
      "分组依据", "不分组", "文件夹", "标签", "卡片盒规则", "任务状态",
      "分组顺序", "默认", "名称", "卡片数量", "升序", "降序",
      "全部折叠", "全部展开",
    ]);
  });

  it("marks the active choices as checked and disables the headings", () => {
    const group: GroupSpec = { dimension: "tag", orderBy: "count", orderDirection: "desc" };
    const { menu } = buildMenu(createState({
      sortField: "ctime",
      sortDirection: "asc",
      group,
      hasSegments: true,
    }));

    const checked = menu.items.filter((item) => item.checked).map(titleText);
    expect(checked).toEqual(["Created time", "Ascending", "Tag", "Card count", "Descending"]);
    expect(menu.items.filter((item) => !item.checked)).toHaveLength(menu.items.length - 5);

    for (const heading of ["Sort by", "Order", "Group by", "Group order"]) {
      const item = itemByTitle(menu, heading);
      expect(item?.disabled, `${heading} heading must be disabled`).toBe(true);
      expect(item?.clickHandler).toBeNull();
    }
  });

  it("disables the unavailable box-rule dimension without a click handler", () => {
    const { menu, deps } = buildMenu(createState({
      availableGroupDimensions: ["none", "folder", "tag", "task"],
    }));

    const boxRule = itemByTitle(menu, "Card box rule");
    expect(boxRule?.disabled).toBe(true);
    expect(boxRule?.clickHandler).toBeNull();
    // The node environment has no DOM, so the hinted title degrades to the label.
    expect(titleText(boxRule!)).toBe("Card box rule");

    for (const title of ["None", "Folder", "Tag", "Task status"]) {
      expect(itemByTitle(menu, title)?.disabled, `${title} must stay enabled`).toBe(false);
    }

    expect(deps.onSelectDimension).not.toHaveBeenCalled();
  });

  it("enables the box-rule dimension inside a card box", () => {
    const { menu, deps } = buildMenu(createState({
      availableGroupDimensions: ["none", "folder", "tag", "box-rule", "task"],
    }));

    const boxRule = itemByTitle(menu, "Card box rule");
    expect(boxRule?.disabled).toBe(false);
    boxRule?.clickHandler?.();

    expect(deps.onSelectDimension).toHaveBeenCalledWith("box-rule");
  });

  it("disables the whole group-order section while the dimension is none", () => {
    const { menu } = buildMenu(createState({ group: DEFAULT_GROUP_SPEC }));

    const groupOrderSlice = menu.items.slice(menu.items.findIndex((item) => titleText(item) === "Group order") + 1);
    // Default/Name/Card count, then the two order-direction rows, ending before the commands.
    for (const title of ["Default", "Name", "Card count", "Ascending", "Descending"]) {
      const item = groupOrderSlice.find((candidate) => titleText(candidate) === title);
      expect(item?.disabled, `${title} must be disabled without grouping`).toBe(true);
      expect(item?.clickHandler).toBeNull();
    }
  });

  it("disables the collapse and expand commands without segments", () => {
    const withoutSegments = buildMenu(createState({ hasSegments: false, group: { dimension: "folder", orderBy: "default", orderDirection: "asc" } }));

    expect(itemByTitle(withoutSegments.menu, "Collapse all")?.disabled).toBe(true);
    expect(itemByTitle(withoutSegments.menu, "Expand all")?.disabled).toBe(true);

    const withSegments = buildMenu(createState({ hasSegments: true, group: { dimension: "folder", orderBy: "default", orderDirection: "asc" } }));

    expect(itemByTitle(withSegments.menu, "Collapse all")?.disabled).toBe(false);
    expect(itemByTitle(withSegments.menu, "Expand all")?.disabled).toBe(false);
  });

  it("routes option clicks to the matching intent callbacks", () => {
    const { menu, deps } = buildMenu(createState({
      group: { dimension: "folder", orderBy: "default", orderDirection: "asc" },
      hasSegments: true,
    }));

    itemByTitle(menu, "Filename")?.clickHandler?.();
    itemByTitle(menu, "Ascending")?.clickHandler?.();
    itemByTitle(menu, "Tag")?.clickHandler?.();
    itemByTitle(menu, "Name")?.clickHandler?.();
    menu.items
      .filter((item) => titleText(item) === "Descending")
      .at(-1)
      ?.clickHandler?.();
    itemByTitle(menu, "Collapse all")?.clickHandler?.();
    itemByTitle(menu, "Expand all")?.clickHandler?.();

    expect(deps.onSelectSort).toHaveBeenCalledWith("name" as SortField);
    expect(deps.onSelectDirection).toHaveBeenCalledWith("asc" as SortDirection);
    expect(deps.onSelectDimension).toHaveBeenCalledWith("tag");
    expect(deps.onSelectOrderBy).toHaveBeenCalledWith("name");
    expect(deps.onSelectOrderDirection).toHaveBeenCalledWith("desc" as SortDirection);
    expect(deps.onCollapseAll).toHaveBeenCalledTimes(1);
    expect(deps.onExpandAll).toHaveBeenCalledTimes(1);
  });
});

describe("decorateSortGroupMenu", () => {
  interface FakeItem {
    classes: Set<string>;
    titleText: string;
  }

  function createFakeMenuDom(items: string[]) {
    const menuClasses = new Set<string>();
    const fakeItems: FakeItem[] = items.map((title) => ({
      classes: new Set<string>(),
      titleText: title,
    }));

    return {
      menuClasses,
      fakeItems,
      dom: {
        classList: {
          add: (token: string) => {
            menuClasses.add(token);
          },
        },
        querySelectorAll: (selectors: string) => {
          expect(selectors).toBe(".menu-item");
          return fakeItems.map((item) => ({
            classList: {
              add: (token: string) => {
                item.classes.add(token);
              },
            },
            querySelector: (itemSelectors: string) => itemSelectors === ".menu-item-title"
              ? { textContent: item.titleText }
              : null,
          }));
        },
      } as never,
    };
  }

  it("marks the menu surface and the four heading rows", () => {
    const strings = getUiStrings("en").sortGroup;
    const fake = createFakeMenuDom([
      "Sort by", "Edited time",
      "Order", "Ascending",
      "Group by", "None",
      "Group order", "Default",
      "Collapse all",
    ]);

    decorateSortGroupMenu({ dom: fake.dom } as unknown as Menu, strings);

    expect(fake.menuClasses.has(SORT_GROUP_MENU_CLASS)).toBe(true);
    expect(fake.fakeItems.filter((item) => item.classes.has(SORT_GROUP_MENU_SECTION_TITLE_CLASS)).map((item) => item.titleText))
      .toEqual(["Sort by", "Order", "Group by", "Group order"]);
  });

  it("marks Chinese headings and ignores non-heading rows", () => {
    const strings = getUiStrings("zh").sortGroup;
    const fake = createFakeMenuDom(["排序依据", "编辑时间", "顺序", "升序", "分组顺序", "分组 顺序"]);

    decorateSortGroupMenu({ dom: fake.dom } as unknown as Menu, strings);

    expect(fake.fakeItems.filter((item) => item.classes.has(SORT_GROUP_MENU_SECTION_TITLE_CLASS)).map((item) => item.titleText))
      .toEqual(["排序依据", "顺序", "分组顺序"]);
  });

  it("still marks the menu surface when item inspection is unavailable", () => {
    const menuClasses = new Set<string>();
    decorateSortGroupMenu(
      { dom: { classList: { add: (token: string) => menuClasses.add(token) } } } as unknown as Menu,
      getUiStrings("en").sortGroup,
    );

    expect(menuClasses.has(SORT_GROUP_MENU_CLASS)).toBe(true);
  });
});
