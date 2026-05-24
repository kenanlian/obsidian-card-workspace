import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount } from "svelte";
import { tick } from "svelte";
import { getToolbarStrings } from "../i18n";
import Toolbar from "./Toolbar.svelte";
import type { FolderTreeNode } from "./types";

interface FilterChangePayload {
  tags: string[];
}

interface SortChangePayload {
  field: string;
  direction: string;
}

interface IncludeSubfoldersChangePayload {
  value: boolean;
}

interface SelectFolderPayload {
  path: string;
}

interface ToolbarActionPayload {
  action: string;
}

interface SearchQueryChangePayload {
  query: string;
}

interface SearchQueryResetPayload {
  source: "clear-button";
}

interface ToolbarCallbacks {
  onFilterChange?: (payload: FilterChangePayload) => void;
  onSortChange?: (payload: SortChangePayload) => void;
  onIncludeSubfoldersChange?: (payload: IncludeSubfoldersChangePayload) => void;
  onSearchQueryChange?: (payload: SearchQueryChangePayload) => void;
  onSearchQueryReset?: (payload: SearchQueryResetPayload) => void;
  onSelectFolder?: (payload: SelectFolderPayload) => void;
  onToolbarAction?: (payload: ToolbarActionPayload) => void;
}

interface CapturedCallbacks {
  callbacks: ToolbarCallbacks;
  filterEvents: FilterChangePayload[];
  sortEvents: SortChangePayload[];
  includeEvents: IncludeSubfoldersChangePayload[];
  searchQueryChangeEvents: SearchQueryChangePayload[];
  searchQueryResetEvents: SearchQueryResetPayload[];
  selectFolderEvents: SelectFolderPayload[];
  toolbarActionEvents: ToolbarActionPayload[];
}

let mountedComponents: Array<Record<string, unknown>> = [];

function createFolderTree(): FolderTreeNode[] {
  return [
    {
      name: "notes",
      path: "notes",
      depth: 0,
      children: [],
    },
    {
      name: "projects",
      path: "projects",
      depth: 0,
      children: [],
    },
  ];
}

function createAvailableTags(): string[] {
  return ["work/ai", "work/ml", "personal"];
}

function createCapturedCallbacks(): CapturedCallbacks {
  const filterEvents: FilterChangePayload[] = [];
  const sortEvents: SortChangePayload[] = [];
  const includeEvents: IncludeSubfoldersChangePayload[] = [];
  const searchQueryChangeEvents: SearchQueryChangePayload[] = [];
  const searchQueryResetEvents: SearchQueryResetPayload[] = [];
  const selectFolderEvents: SelectFolderPayload[] = [];
  const toolbarActionEvents: ToolbarActionPayload[] = [];

  return {
    callbacks: {
      onFilterChange: (payload: FilterChangePayload) => {
        filterEvents.push(payload);
      },
      onSortChange: (payload: SortChangePayload) => {
        sortEvents.push(payload);
      },
      onIncludeSubfoldersChange: (payload: IncludeSubfoldersChangePayload) => {
        includeEvents.push(payload);
      },
      onSearchQueryChange: (payload: SearchQueryChangePayload) => {
        searchQueryChangeEvents.push(payload);
      },
      onSearchQueryReset: (payload: SearchQueryResetPayload) => {
        searchQueryResetEvents.push(payload);
      },
      onSelectFolder: (payload: SelectFolderPayload) => {
        selectFolderEvents.push(payload);
      },
      onToolbarAction: (payload: ToolbarActionPayload) => {
        toolbarActionEvents.push(payload);
      },
    },
    filterEvents,
    sortEvents,
    includeEvents,
    searchQueryChangeEvents,
    searchQueryResetEvents,
    selectFolderEvents,
    toolbarActionEvents,
  };
}

function mountToolbar(
  props: Record<string, unknown> = {},
  callbacks: ToolbarCallbacks = {},
): { component: Record<string, unknown>; target: HTMLDivElement } {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const component = mount(Toolbar, {
    target,
    props: {
      folderPath: "notes",
      sortField: "mtime",
      sortDirection: "desc",
      folderTree: createFolderTree(),
      availableTags: createAvailableTags(),
      activeFilterTags: [],
      includeSubfolders: true,
      searchQuery: "",
      searchStatus: "idle",
      isAllNotesScope: false,
      bulkMode: false,
      selectedCount: 0,
      bulkAnchorPath: null,
      canBulkSelectAll: false,
      canBulkClearSelection: false,
      canBulkMoveSelected: false,
      canBulkDeleteSelected: false,
      canBulkMergeSelected: false,
      ...callbacks,
      ...props,
    },
  });
  mountedComponents.push(component);

  return { component, target };
}

async function disposeMountedComponent(component: Record<string, unknown>): Promise<void> {
  mountedComponents = mountedComponents.filter((candidate) => candidate !== component);
  await unmount(component);
}

function getFilterButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[aria-label="Tag filter"]');
}

async function openTagPopup(): Promise<void> {
  const filterButton = getFilterButton();
  expect(filterButton).not.toBeNull();
  filterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 44, clientY: 12 }));
  await tick();
}

function getFolderScopeButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[aria-label="Folder scope"]');
}

async function openFolderPopup(): Promise<void> {
  const folderButton = getFolderScopeButton();
  expect(folderButton).not.toBeNull();
  folderButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 44, clientY: 12 }));
  await tick();
}

function getSortButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[aria-label="Sort cards"]');
}

async function openSortPopup(): Promise<void> {
  const sortButton = getSortButton();
  expect(sortButton).not.toBeNull();
  sortButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 44, clientY: 12 }));
  await tick();
}

function getSelectedSortOption(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    ".fce-sort-menu button[role='menuitemradio'][aria-checked='true']",
  );
}

function getTreeRowByText(menuSelector: string, text: string): HTMLDivElement | null {
  return Array.from(document.querySelectorAll<HTMLDivElement>(`${menuSelector} .fce-tree-row`))
    .find((row) => row.textContent?.includes(text)) ?? null;
}

function getSelectedTreeRow(menuSelector: string): HTMLDivElement | null {
  return document.querySelector<HTMLDivElement>(`${menuSelector} .fce-tree-row.is-selected`);
}

describe("Toolbar.svelte", () => {
  beforeEach(() => {
    mountedComponents = [];
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    await Promise.all(mountedComponents.map((component) => unmount(component)));
    mountedComponents = [];
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opens a collapsible tag tree and selects a nested tag", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({}, captured.callbacks);

    expect(document.querySelector(".fce-tag-menu")).toBeNull();

    await openTagPopup();

    const filterButton = getFilterButton();
    expect(filterButton).not.toBeNull();
    expect(filterButton?.className).toContain("is-selected");

    const workNodeBeforeExpand = Array.from(document.querySelectorAll<HTMLButtonElement>(".fce-tag-menu .fce-tree-button"))
      .find((button) => button.textContent?.includes("#work"));
    expect(workNodeBeforeExpand).not.toBeUndefined();
    expect(workNodeBeforeExpand?.getAttribute("aria-checked")).toBe("false");
    expect(Array.from(document.querySelectorAll<HTMLButtonElement>(".fce-tag-menu .fce-tree-button"))
      .some((button) => button.textContent?.includes("#work/ai"))).toBe(false);

    const workChevron = document.querySelector<HTMLButtonElement>(".fce-tag-menu .fce-tree-chevron[aria-label='Expand']");
    expect(workChevron).not.toBeNull();
    workChevron?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    const nestedNode = Array.from(document.querySelectorAll<HTMLButtonElement>(".fce-tag-menu .fce-tree-button"))
      .find((button) => button.textContent?.includes("#work/ai"));
    expect(nestedNode).not.toBeUndefined();
    nestedNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(captured.filterEvents).toEqual([{ tags: ["work/ai"] }]);
    expect(captured.toolbarActionEvents).not.toContainEqual({ action: "filter" });
    expect(document.querySelector(".fce-tag-menu")).toBeNull();

    await disposeMountedComponent(component);
  });

  it("closes the tag popup on escape and outside click", async () => {
    const { component } = mountToolbar();

    await openTagPopup();
    expect(document.querySelector(".fce-tag-menu")).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();

    expect(document.querySelector(".fce-tag-menu")).toBeNull();

    await openTagPopup();
    expect(document.querySelector(".fce-tag-menu")).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(document.querySelector(".fce-tag-menu")).toBeNull();

    await disposeMountedComponent(component);
  });

  it("sort popup closes on escape and outside click", async () => {
    const { component } = mountToolbar();

    await openSortPopup();
    expect(document.querySelector(".fce-sort-menu")).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();

    expect(document.querySelector(".fce-sort-menu")).toBeNull();

    await openSortPopup();
    expect(document.querySelector(".fce-sort-menu")).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(document.querySelector(".fce-sort-menu")).toBeNull();

    await disposeMountedComponent(component);
  });

  it("renders the tag popup as a fixed portal menu", async () => {
    const { component } = mountToolbar();

    await openTagPopup();

    const tagMenu = document.querySelector<HTMLElement>(".fce-tag-menu");
    expect(tagMenu).not.toBeNull();
    expect(tagMenu?.parentElement).toBe(document.body);
    expect(tagMenu?.style.position).toBe("fixed");
    expect(tagMenu?.style.left).toBe("44px");
    expect(tagMenu?.style.top).toBe("12px");

    await disposeMountedComponent(component);
  });

  it("renders the folder popup with the shared tree contract and closes it on escape", async () => {
    const { component } = mountToolbar({
      folderPath: "projects",
      folderTree: [
        {
          name: "projects",
          path: "projects",
          depth: 0,
          children: [
            {
              name: "client-a",
              path: "projects/client-a",
              depth: 1,
              children: [],
            },
          ],
        },
      ],
    });

    await openFolderPopup();

    const folderMenu = document.querySelector<HTMLElement>(".fce-folder-menu.fce-tree-menu");
    expect(folderMenu).not.toBeNull();
    expect(folderMenu?.parentElement).toBe(document.body);
    expect(folderMenu?.getAttribute("aria-label")).toBe("Folder scope");

    const selectedRow = folderMenu?.querySelector<HTMLElement>(".fce-tree-row.is-selected");
    expect(selectedRow?.textContent).toContain("projects");

    const firstFolderButton = folderMenu?.querySelector<HTMLButtonElement>(".fce-tree-button[role='menuitem']");
    expect(firstFolderButton).not.toBeNull();

    const firstChevron = folderMenu?.querySelector<HTMLButtonElement>(".fce-tree-chevron[aria-expanded]");
    expect(firstChevron).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();

    expect(document.querySelector(".fce-folder-menu")).toBeNull();

    await openFolderPopup();
    expect(document.querySelector(".fce-folder-menu")).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(document.querySelector(".fce-folder-menu")).toBeNull();

    await disposeMountedComponent(component);
  });

  it("renders the shared trailing selected indicator across popup variants", async () => {
    let { component } = mountToolbar();

    await openSortPopup();

    const selectedSortOption = getSelectedSortOption();
    expect(selectedSortOption).not.toBeNull();
    expect(selectedSortOption?.classList.contains("fce-popup-row")).toBe(true);
    expect(selectedSortOption?.querySelector(".fce-popup-row-leading")).not.toBeNull();
    expect(selectedSortOption?.querySelector(".fce-popup-row-content .fce-sort-menu-item-label")).not.toBeNull();
    expect(selectedSortOption?.querySelector(".fce-popup-row-trailing .fce-popup-row-selected-indicator")).not.toBeNull();
    expect(selectedSortOption?.querySelector(".fce-sort-menu-item-check")).not.toBeNull();

    await disposeMountedComponent(component);

    ({ component } = mountToolbar({
      folderPath: "projects",
      folderTree: [
        {
          name: "projects",
          path: "projects",
          depth: 0,
          children: [
            {
              name: "client-a",
              path: "projects/client-a",
              depth: 1,
              children: [],
            },
          ],
        },
      ],
    }));

    await openFolderPopup();

    const selectedFolderRow = getSelectedTreeRow(".fce-folder-menu");
    expect(selectedFolderRow).not.toBeNull();
    expect(selectedFolderRow?.classList.contains("fce-popup-row")).toBe(true);
    expect(selectedFolderRow?.querySelector(".fce-popup-row-leading")).not.toBeNull();
    expect(selectedFolderRow?.querySelector(".fce-popup-row-content .fce-tree-button")).not.toBeNull();
    expect(selectedFolderRow?.querySelector(".fce-popup-row-content .fce-tree-label")).not.toBeNull();
    expect(selectedFolderRow?.querySelector(".fce-popup-row-trailing .fce-popup-row-selected-indicator")).not.toBeNull();
    expect(selectedFolderRow?.querySelector(".fce-tree-row-check")).not.toBeNull();
    expect(selectedFolderRow?.classList.contains("is-selected")).toBe(true);

    await disposeMountedComponent(component);

    ({ component } = mountToolbar({ activeFilterTags: ["work/ai"] }));

    await openTagPopup();

    const selectedTagRow = getSelectedTreeRow(".fce-tag-menu");
    expect(selectedTagRow).not.toBeNull();
    expect(selectedTagRow?.classList.contains("fce-popup-row")).toBe(true);
    expect(selectedTagRow?.querySelector(".fce-popup-row-leading")).not.toBeNull();
    expect(selectedTagRow?.querySelector(".fce-popup-row-content .fce-tree-button[aria-checked='true']")).not.toBeNull();
    expect(selectedTagRow?.querySelector(".fce-popup-row-content .fce-tree-label")).not.toBeNull();
    expect(selectedTagRow?.querySelector(".fce-popup-row-trailing .fce-popup-row-selected-indicator")).not.toBeNull();
    expect(selectedTagRow?.querySelector(".fce-tree-row-check")).not.toBeNull();
    expect(selectedTagRow?.classList.contains("is-selected")).toBe(true);

    await disposeMountedComponent(component);
  });

  it("renders placeholder leading slots for non-expandable tree rows", async () => {
    let { component } = mountToolbar({
      folderPath: "projects",
      folderTree: [
        {
          name: "projects",
          path: "projects",
          depth: 0,
          children: [
            {
              name: "client-a",
              path: "projects/client-a",
              depth: 1,
              children: [],
            },
          ],
        },
      ],
    });

    await openFolderPopup();

    const expandableFolderRow = getTreeRowByText(".fce-folder-menu", "projects");
    expect(expandableFolderRow?.querySelector(".fce-popup-row-leading .fce-tree-chevron[aria-expanded]")).not.toBeNull();

    const folderChevron = expandableFolderRow?.querySelector<HTMLButtonElement>(".fce-popup-row-leading .fce-tree-chevron[aria-expanded]");
    folderChevron?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    const folderLeafRow = getTreeRowByText(".fce-folder-menu", "client-a");
    expect(folderLeafRow?.querySelector(".fce-popup-row-leading .fce-tree-chevron.is-placeholder")).not.toBeNull();
    expect(folderLeafRow?.querySelector(".fce-popup-row-content .fce-tree-button")).not.toBeNull();
    expect(folderLeafRow?.querySelector(".fce-popup-row-trailing")).not.toBeNull();

    await disposeMountedComponent(component);

    ({ component } = mountToolbar());

    await openTagPopup();

    const expandableTagRow = getTreeRowByText(".fce-tag-menu", "#work");
    expect(expandableTagRow?.querySelector(".fce-popup-row-leading .fce-tree-chevron[aria-expanded]")).not.toBeNull();

    const tagChevron = expandableTagRow?.querySelector<HTMLButtonElement>(".fce-popup-row-leading .fce-tree-chevron[aria-expanded]");
    tagChevron?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    const tagLeafRow = getTreeRowByText(".fce-tag-menu", "#work/ai");
    expect(tagLeafRow?.querySelector(".fce-popup-row-leading .fce-tree-chevron.is-placeholder")).not.toBeNull();
    expect(tagLeafRow?.querySelector(".fce-popup-row-content .fce-tree-button")).not.toBeNull();
    expect(tagLeafRow?.querySelector(".fce-popup-row-trailing")).not.toBeNull();

    await disposeMountedComponent(component);
  });

  it("preserves truncation and trailing indicator for long popup labels", async () => {
    const longFolderName = "projects-with-a-very-long-folder-label-that-should-truncate-in-the-label-slot";
    const longTagPath = "labels-with-a-very-long-tag-path-that-should-truncate-in-the-label-slot";

    let { component } = mountToolbar({
      folderPath: longFolderName,
      folderTree: [
        {
          name: longFolderName,
          path: longFolderName,
          depth: 0,
          children: [],
        },
      ],
    });

    await openFolderPopup();

    const selectedFolderRow = getSelectedTreeRow(".fce-folder-menu");
    const selectedFolderLabel = selectedFolderRow?.querySelector<HTMLSpanElement>(".fce-tree-label");
    expect(selectedFolderLabel?.textContent).toBe(longFolderName);
    expect(selectedFolderLabel?.parentElement).toBe(selectedFolderRow?.querySelector(".fce-popup-row-content .fce-tree-button"));
    expect(selectedFolderRow?.querySelector(".fce-popup-row-leading .fce-tree-chevron")).not.toBeNull();
    expect(selectedFolderRow?.querySelector(".fce-popup-row-trailing .fce-popup-row-selected-indicator")).not.toBeNull();
    expect(selectedFolderRow?.classList.contains("is-selected")).toBe(true);

    await disposeMountedComponent(component);

    ({ component } = mountToolbar({ activeFilterTags: [longTagPath], availableTags: [longTagPath] }));

    await openTagPopup();

    const selectedTagRow = getSelectedTreeRow(".fce-tag-menu");
    const selectedTagLabel = selectedTagRow?.querySelector<HTMLSpanElement>(".fce-tree-label");
    expect(selectedTagLabel?.textContent).toBe(`#${longTagPath}`);
    expect(selectedTagLabel?.parentElement).toBe(selectedTagRow?.querySelector(".fce-popup-row-content .fce-tree-button"));
    expect(selectedTagRow?.querySelector(".fce-popup-row-leading .fce-tree-chevron")).not.toBeNull();
    expect(selectedTagRow?.querySelector(".fce-popup-row-trailing .fce-popup-row-selected-indicator")).not.toBeNull();
    expect(selectedTagRow?.classList.contains("is-selected")).toBe(true);

    await disposeMountedComponent(component);
  });

  it("renders the selected tag summary without shipping a premature clear button", async () => {
    const englishStrings = getToolbarStrings("en");
    expect(englishStrings.filter.selectedTagSummary("project/work")).toBe("project/work tag selected");
    expect(englishStrings.filter.selectedTagClearLabel).toBe("Clear selected tag");

    const chineseStrings = getToolbarStrings("zh");
    expect(chineseStrings.filter.selectedTagSummary("项目/工作")).toBe("已选标签：项目/工作");
    expect(chineseStrings.filter.selectedTagClearLabel).toBe("清除所选标签");

    const { component } = mountToolbar({ activeFilterTags: ["project/work"] });
    await tick();

    const filterButton = getFilterButton();
    expect(filterButton).not.toBeNull();
    expect(filterButton?.className).toContain("is-selected");

    const contentRow = document.querySelector<HTMLDivElement>(".fce-toolbar-content-row");
    expect(contentRow).not.toBeNull();
    expect(contentRow?.textContent).toContain("project/work tag selected");
    const clearButton = document.querySelector<HTMLButtonElement>(".fce-tag-clear");
    expect(clearButton).not.toBeNull();
    expect(clearButton?.getAttribute("aria-label")).toBe("Clear selected tag");

    await disposeMountedComponent(component);
  });

  it("deselects the current tag when the selected node is clicked again", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({ activeFilterTags: ["work/ai"] }, captured.callbacks);

    await openTagPopup();

    const nestedNode = Array.from(document.querySelectorAll<HTMLButtonElement>(".fce-tag-menu .fce-tree-button"))
      .find((button) => button.textContent?.includes("#work/ai"));
    expect(nestedNode).not.toBeUndefined();
    expect(nestedNode?.getAttribute("aria-checked")).toBe("true");
    nestedNode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(captured.filterEvents).toEqual([{ tags: [] }]);
    expect(document.querySelector(".fce-tag-menu")).toBeNull();

    await disposeMountedComponent(component);
  });

  it("renders a non-interactive empty tag row when no tags are available", async () => {
    const { component } = mountToolbar({ availableTags: [] });

    await openTagPopup();

    const emptyRow = document.querySelector<HTMLDivElement>(".fce-tag-menu .fce-tree-empty");
    expect(emptyRow).not.toBeNull();
    expect(emptyRow?.textContent).toContain("No tags found");
    expect(document.querySelectorAll(".fce-tag-menu .fce-tree-button")).toHaveLength(0);

    await disposeMountedComponent(component);
  });

  it("removes the tag popup portal and listeners on unmount", async () => {
    const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");
    const { component } = mountToolbar();

    await openTagPopup();
    expect(document.querySelector(".fce-tag-menu")).not.toBeNull();

    await disposeMountedComponent(component);

    expect(document.querySelector(".fce-tag-menu")).toBeNull();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("click", expect.any(Function), true);
    expect(removeEventListenerSpy).toHaveBeenCalledWith("keydown", expect.any(Function), true);
  });

  it("emits sort-change with selected field and direction", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({}, captured.callbacks);

    const sortButton = document.querySelector<HTMLButtonElement>('button[aria-label="Sort cards"]');
    expect(sortButton).not.toBeNull();
    sortButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 24, clientY: 36 }));
    await tick();

    const options = Array.from(document.querySelectorAll<HTMLButtonElement>(".fce-sort-menu button[role='menuitemradio']"));
    const firstUnselected = options.find((option) => option.getAttribute("aria-checked") === "false");
    expect(firstUnselected).not.toBeUndefined();
    firstUnselected?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.sortEvents).toHaveLength(1);
    expect(captured.sortEvents[0]).toEqual({ field: "mtime", direction: "asc" });

    await disposeMountedComponent(component);
  });

  it("exposes a menu-level accessible name for sort popup", async () => {
    const { component } = mountToolbar();

    await openSortPopup();

    const sortMenu = document.querySelector<HTMLElement>(".fce-sort-menu");
    expect(sortMenu).not.toBeNull();
    expect(sortMenu?.getAttribute("aria-label")).toBe(getToolbarStrings("en").actions.sortTitle);

    await disposeMountedComponent(component);
  });

  it("keeps exactly one popup open when buttons are clicked in sequence", async () => {
    let { component } = mountToolbar();

    await openFolderPopup();
    expect(document.querySelectorAll(".fce-folder-menu, .fce-sort-menu, .fce-tag-menu")).toHaveLength(1);
    expect(document.querySelector(".fce-folder-menu")).not.toBeNull();

    await openSortPopup();
    expect(document.querySelectorAll(".fce-folder-menu, .fce-sort-menu, .fce-tag-menu")).toHaveLength(1);
    expect(document.querySelector(".fce-folder-menu")).toBeNull();
    expect(document.querySelector(".fce-sort-menu")).not.toBeNull();

    await openTagPopup();
    expect(document.querySelectorAll(".fce-folder-menu, .fce-sort-menu, .fce-tag-menu")).toHaveLength(1);
    expect(document.querySelector(".fce-sort-menu")).toBeNull();
    expect(document.querySelector(".fce-tag-menu")).not.toBeNull();

    await disposeMountedComponent(component);

    ({ component } = mountToolbar());

    await openSortPopup();
    expect(document.querySelectorAll(".fce-folder-menu, .fce-sort-menu, .fce-tag-menu")).toHaveLength(1);
    expect(document.querySelector(".fce-sort-menu")).not.toBeNull();

    await openFolderPopup();
    expect(document.querySelectorAll(".fce-folder-menu, .fce-sort-menu, .fce-tag-menu")).toHaveLength(1);
    expect(document.querySelector(".fce-sort-menu")).toBeNull();
    expect(document.querySelector(".fce-folder-menu")).not.toBeNull();

    await disposeMountedComponent(component);
  });

  it("emits include-subfolders-change and folder/toolbar actions", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({}, captured.callbacks);

    const includeToggle = document.querySelector<HTMLButtonElement>('button[aria-label="Including subfolders"]');
    expect(includeToggle).not.toBeNull();
    includeToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const pickFolderButton = document.querySelector<HTMLButtonElement>('button[aria-label="Folder scope"]');
    expect(pickFolderButton).not.toBeNull();
    pickFolderButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 44, clientY: 12 }));
    await tick();

    const folderItems = Array.from(document.querySelectorAll<HTMLButtonElement>(".fce-folder-menu .fce-tree-button"));
    const projectsItem = folderItems.find((item) => item.textContent?.includes("projects"));
    expect(projectsItem).not.toBeUndefined();
    projectsItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const allNotesButton = document.querySelector<HTMLButtonElement>('button[aria-label="All notes"]');
    expect(allNotesButton).not.toBeNull();
    allNotesButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.includeEvents).toEqual([{ value: false }]);
    expect(captured.selectFolderEvents).toEqual([{ path: "projects" }]);
    expect(captured.toolbarActionEvents).toContainEqual({ action: "pick-folder" });
    expect(captured.toolbarActionEvents).toContainEqual({ action: "all-notes" });

    await disposeMountedComponent(component);
  });

  it("emits the pick-folder toolbar action before folder selection", async () => {
    const order: string[] = [];
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({}, {
      ...captured.callbacks,
      onToolbarAction: (payload) => {
        captured.toolbarActionEvents.push(payload);
        order.push(`toolbar:${payload.action}`);
      },
      onSelectFolder: (payload) => {
        captured.selectFolderEvents.push(payload);
        order.push(`folder:${payload.path}`);
      },
    });

    const pickFolderButton = document.querySelector<HTMLButtonElement>('button[aria-label="Folder scope"]');
    expect(pickFolderButton).not.toBeNull();
    pickFolderButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 44, clientY: 12 }));
    await tick();

    const folderItems = Array.from(document.querySelectorAll<HTMLButtonElement>(".fce-folder-menu .fce-tree-button"));
    const projectsItem = folderItems.find((item) => item.textContent?.includes("projects"));
    expect(projectsItem).not.toBeUndefined();
    projectsItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.toolbarActionEvents).toEqual([{ action: "pick-folder" }]);
    expect(captured.selectFolderEvents).toEqual([{ path: "projects" }]);
    expect(order).toEqual(["toolbar:pick-folder", "folder:projects"]);

    await disposeMountedComponent(component);
  });

  it("renders first-row controls in the exact sequence with Subfolders after Folder scope", async () => {
    const { component } = mountToolbar();
    
    const buttonsRow = document.querySelector<HTMLDivElement>(".fce-toolbar-buttons");
    expect(buttonsRow).not.toBeNull();
    
    const buttons = Array.from(buttonsRow?.querySelectorAll("button") || []);
    const expectedLabels = [
      "Folder scope",
      "Including subfolders",
      "All notes",
      "Create note",
      "Sort cards",
      "Tag filter",
      "Bulk actions",
      "Toggle search"
    ];
    
    expect(buttons.length).toBeGreaterThanOrEqual(8);
    for (let i = 0; i < expectedLabels.length; i += 1) {
      expect(buttons[i].getAttribute("aria-label")).toBe(expectedLabels[i]);
    }
    
    await disposeMountedComponent(component);
  });

  it("renders search as a toggleable first-row control and autofocuses when expanded", async () => {
    const { component } = mountToolbar();

    let searchInput = document.querySelector<HTMLInputElement>('input[aria-label="Search notes"]');
    expect(searchInput).toBeNull();

    const toggleButton = document.querySelector<HTMLButtonElement>('button[aria-label="Toggle search"]');
    expect(toggleButton).not.toBeNull();
    expect(document.querySelector(".fce-toolbar-buttons")?.contains(toggleButton as Node)).toBe(true);

    toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    searchInput = document.querySelector<HTMLInputElement>('input[aria-label="Search notes"]');
    expect(searchInput).not.toBeNull();
    expect(document.querySelector(".fce-toolbar-search-row")).not.toBeNull();
    expect(document.activeElement).toBe(searchInput);

    await disposeMountedComponent(component);
  });

  it("collapses search without clearing an active prop-backed query", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({ searchQuery: "active query" }, captured.callbacks);

    const toggleButton = document.querySelector<HTMLButtonElement>('button[aria-label="Toggle search"]');
    expect(toggleButton).not.toBeNull();

    toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    let searchInput = document.querySelector<HTMLInputElement>('input[aria-label="Search notes"]');
    expect(searchInput).not.toBeNull();
    expect(searchInput?.value).toBe("active query");

    toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    searchInput = document.querySelector<HTMLInputElement>('input[aria-label="Search notes"]');
    expect(searchInput).toBeNull();
    expect(captured.searchQueryResetEvents).toEqual([]);

    await disposeMountedComponent(component);
  });

  it("keeps the search toggle highlighted when a collapsed query remains active", async () => {
    const { component } = mountToolbar({ searchQuery: "active query" });

    const toggleButton = document.querySelector<HTMLButtonElement>('button[aria-label="Toggle search"]');
    expect(toggleButton).not.toBeNull();
    expect(toggleButton?.classList.contains("is-selected")).toBe(true);
    expect(document.querySelector('input[aria-label="Search notes"]')).toBeNull();

    toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    expect(document.querySelector('input[aria-label="Search notes"]')).not.toBeNull();

    toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    expect(document.querySelector('input[aria-label="Search notes"]')).toBeNull();
    expect(toggleButton?.classList.contains("is-selected")).toBe(true);

    await disposeMountedComponent(component);
  });

  it("emits onSearchQueryChange when typing in the search input", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({}, captured.callbacks);

    const toggleButton = document.querySelector<HTMLButtonElement>('button[aria-label="Toggle search"]');
    toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    const searchInput = document.querySelector<HTMLInputElement>('input[aria-label="Search notes"]');
    expect(searchInput).not.toBeNull();

    if (searchInput) {
      searchInput.value = "my search query";
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    expect(captured.searchQueryChangeEvents).toEqual([{ query: "my search query" }]);

    await disposeMountedComponent(component);
  });

  it("clears an expanded search query with the x icon button", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({ searchQuery: "active query" }, captured.callbacks);

    const toggleButton = document.querySelector<HTMLButtonElement>('button[aria-label="Toggle search"]');
    toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    const clearButton = document.querySelector<HTMLButtonElement>('button[aria-label="Clear search query"]');
    expect(clearButton).not.toBeNull();
    expect(clearButton?.closest(".fce-toolbar-search")).not.toBeNull();

    clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.searchQueryResetEvents).toEqual([{ source: "clear-button" }]);
    expect(captured.searchQueryChangeEvents).toEqual([]);

    await disposeMountedComponent(component);
  });

  it("renders contextual summary badges only when filters or exceptional search states are active", async () => {
    let { component } = mountToolbar({
      activeFilterTags: [],
      searchStatus: "idle",
    });

    expect(document.querySelector(".fce-toolbar-content-row")).toBeNull();
    await disposeMountedComponent(component);

    ({ component } = mountToolbar({
      activeFilterTags: ["project/work"],
      searchStatus: "ready",
    }));
    await tick();

    let summaryRow = document.querySelector<HTMLDivElement>(".fce-toolbar-content-row");
    expect(summaryRow).not.toBeNull();
    let content = summaryRow?.textContent || "";
    expect(content).not.toContain("Scope:");
    expect(content).not.toContain("Index ready");
    await disposeMountedComponent(component);

    const expectedStatuses = {
      building: "Building index",
      unavailable: "Search unavailable",
      "rebuild-required": "Rebuild required",
      error: "Search error",
    } as const;

    for (const searchStatus of ["building", "unavailable", "rebuild-required", "error"] as const) {
      ({ component } = mountToolbar({
        activeFilterTags: [],
        searchStatus,
      }));
      await tick();

      summaryRow = document.querySelector<HTMLDivElement>(".fce-toolbar-content-row");
      expect(summaryRow).not.toBeNull();
      content = summaryRow?.textContent || "";
      expect(content).toContain(expectedStatuses[searchStatus]);

      const searchStatusEl = document.querySelector<HTMLElement>(".fce-toolbar-content-row .fce-search-status");
      expect(searchStatusEl).not.toBeNull();
      expect(searchStatusEl?.getAttribute("data-search-status")).toBe(searchStatus);
      expect(searchStatusEl?.textContent).toBe(expectedStatuses[searchStatus]);

      await disposeMountedComponent(component);
    }

    interface GranularTest {
      status: import("./types").SearchStatus;
      expected: string;
      readiness?: import("./types").SearchIndexReadinessState;
      rebuildReason?: import("./types").SearchIndexRebuildReason;
      persistence?: import("./types").SearchIndexPersistenceHealth;
    }

    const granularTests: GranularTest[] = [
      { status: "building", readiness: "restoring", expected: "Restoring index" },
      { status: "building", readiness: "building", expected: "Building index" },
      { status: "rebuild-required", rebuildReason: "version-drift", expected: "Rebuild required (version drift)" },
      { status: "rebuild-required", rebuildReason: "corrupt", expected: "Rebuild required (corrupted)" },
      { status: "rebuild-required", rebuildReason: "folder-rebuild-required", expected: "Rebuild required (folder changed)" },
      { status: "ready", persistence: "storage-unavailable", expected: "Search storage unavailable" },
    ];

    for (const test of granularTests) {
      ({ component } = mountToolbar({
        activeFilterTags: [],
        searchStatus: test.status,
        searchIndexReadiness: test.readiness,
        searchIndexRebuildReason: test.rebuildReason,
        searchIndexPersistence: test.persistence,
      }));
      await tick();

      const searchStatusEl = document.querySelector<HTMLElement>(".fce-toolbar-content-row .fce-search-status");
      expect(searchStatusEl).not.toBeNull();
      expect(searchStatusEl?.textContent).toBe(test.expected);

      await disposeMountedComponent(component);
    }
  });

  it("keeps all-notes, filter, and bulk buttons highlighted while their state is active", async () => {
    let { component } = mountToolbar({
      isAllNotesScope: true,
      folderPath: "",
    });

    let allNotesButton = document.querySelector<HTMLButtonElement>('button[aria-label="All notes"]');
    expect(allNotesButton?.classList.contains("is-selected")).toBe(true);
    await disposeMountedComponent(component);

    ({ component } = mountToolbar({
      activeFilterTags: ["work"],
    }));
    await tick();

    let filterButton = document.querySelector<HTMLButtonElement>('button[aria-label="Tag filter"]');
    expect(filterButton?.classList.contains("is-selected")).toBe(true);
    await disposeMountedComponent(component);

    ({ component } = mountToolbar({
      bulkMode: true,
    }));
    await tick();

    const bulkButton = document.querySelector<HTMLButtonElement>('button[aria-label="Bulk actions"]');
    expect(bulkButton?.classList.contains("is-selected")).toBe(true);
    expect(document.querySelector(".fce-toolbar-bulk-strip")).not.toBeNull();
    await disposeMountedComponent(component);
  });

  it("does not keep the create-note action visually selected after it emits", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({}, captured.callbacks);

    const createNoteButton = document.querySelector<HTMLButtonElement>('button[aria-label="Create note"]');
    expect(createNoteButton).not.toBeNull();
    expect(createNoteButton?.classList.contains("is-selected")).toBe(false);

    createNoteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(captured.toolbarActionEvents).toEqual([{ action: "new-note" }]);
    expect(createNoteButton?.classList.contains("is-selected")).toBe(false);

    const allNotesButton = document.querySelector<HTMLButtonElement>('button[aria-label="All notes"]');
    expect(allNotesButton?.classList.contains("is-selected")).toBe(false);

    await disposeMountedComponent(component);
  });

  it("keeps all-notes highlighted when create-note emits inside the all-notes scope", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({ isAllNotesScope: true, folderPath: "" }, captured.callbacks);

    const allNotesButton = document.querySelector<HTMLButtonElement>('button[aria-label="All notes"]');
    const createNoteButton = document.querySelector<HTMLButtonElement>('button[aria-label="Create note"]');
    expect(allNotesButton?.classList.contains("is-selected")).toBe(true);
    expect(createNoteButton?.classList.contains("is-selected")).toBe(false);

    createNoteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(captured.toolbarActionEvents).toEqual([{ action: "new-note" }]);
    expect(allNotesButton?.classList.contains("is-selected")).toBe(true);
    expect(createNoteButton?.classList.contains("is-selected")).toBe(false);

    await disposeMountedComponent(component);
  });

  it("renders only one destructive bulk action", async () => {
    const { component } = mountToolbar({
      bulkMode: true,
      selectedCount: 3,
      bulkAnchorPath: "some/path.md",
      canBulkSelectAll: true,
      canBulkClearSelection: true,
      canBulkMoveSelected: true,
      canBulkDeleteSelected: true,
      canBulkMergeSelected: true,
    });

    await tick();

    const bulkStrip = document.querySelector<HTMLDivElement>(".fce-toolbar-bulk-strip");
    expect(bulkStrip).not.toBeNull();

    const bulkActions = document.querySelector<HTMLDivElement>(".fce-toolbar-bulk-actions");
    const bulkSummary = document.querySelector<HTMLDivElement>(".fce-toolbar-bulk-summary");
    expect(bulkActions).not.toBeNull();
    expect(bulkSummary).not.toBeNull();
    expect(bulkStrip?.firstElementChild).toBe(bulkActions);
    expect(bulkStrip?.lastElementChild).toBe(bulkSummary);
    expect(bulkSummary?.textContent).toContain("3 selected");

    const bulkButtons = Array.from(bulkActions?.querySelectorAll<HTMLButtonElement>("button") || []);
    expect(bulkButtons).toHaveLength(6);

    const tooltips = bulkButtons.map((button) => button.getAttribute("data-tooltip"));
    expect(tooltips).toEqual([
      "Select all",
      "Clear selection",
      "Move selected",
      "Delete selected",
      "Merge selected",
      "Exit bulk mode",
    ]);

    const destructiveTooltips = tooltips.filter((tooltip) => tooltip?.toLowerCase().includes("delete") || tooltip?.toLowerCase().includes("trash"));
    expect(destructiveTooltips).toEqual(["Delete selected"]);

    expect(bulkButtons.map((button) => button.getAttribute("data-icon"))).toEqual([
      "check-square",
      "x-square",
      "folder-input",
      "trash-2",
      "combine",
      "x",
    ]);

    await disposeMountedComponent(component);
  });

  it("renders Subfolders as a first-row icon button with pressed and tooltip state", async () => {
    let { component } = mountToolbar({
      folderPath: "notes",
      includeSubfolders: true,
      isAllNotesScope: false,
    });
    await tick();

    let subfoldersToggle = document.querySelector<HTMLButtonElement>('button[aria-label="Including subfolders"]');
    expect(subfoldersToggle).not.toBeNull();
    expect(subfoldersToggle?.classList.contains("is-selected")).toBe(true);
    expect(subfoldersToggle?.getAttribute("aria-label")).toBe("Including subfolders");
    expect(subfoldersToggle?.getAttribute("aria-pressed")).toBe("true");
    expect(subfoldersToggle?.getAttribute("data-icon")).toBe("folder-tree");
    expect(subfoldersToggle?.getAttribute("data-tooltip")).toBe("Including subfolders");

    const buttonsRow = document.querySelector<HTMLDivElement>(".fce-toolbar-buttons");
    expect(buttonsRow?.children[1]).toBe(subfoldersToggle);

    await disposeMountedComponent(component);

    ({ component } = mountToolbar({
      folderPath: "notes",
      includeSubfolders: false,
      isAllNotesScope: false,
    }));
    await tick();

    subfoldersToggle = document.querySelector<HTMLButtonElement>('button[aria-label="Direct folder only"]');
    expect(subfoldersToggle).not.toBeNull();
    expect(subfoldersToggle?.classList.contains("is-selected")).toBe(false);
    expect(subfoldersToggle?.getAttribute("aria-pressed")).toBe("false");
    expect(subfoldersToggle?.getAttribute("data-tooltip")).toBe("Direct folder only");

    await disposeMountedComponent(component);

    ({ component } = mountToolbar({
      folderPath: "notes",
      includeSubfolders: true,
      isAllNotesScope: true,
    }));
    await tick();

    expect(document.querySelector('button[aria-label="Including subfolders"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Direct folder only"]')).toBeNull();

    await disposeMountedComponent(component);
  });

  it("cleans up menus on unmount", async () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    for (let i = 0; i < 2; i += 1) {
      const { component } = mountToolbar();

      const sortButton = document.querySelector<HTMLButtonElement>('button[aria-label="Sort cards"]');
      expect(sortButton).not.toBeNull();
      sortButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 16, clientY: 18 }));
      await tick();

      const sortMenu = document.body.querySelector<HTMLDivElement>(".fce-sort-menu");
      expect(sortMenu).not.toBeNull();
      expect(sortMenu?.parentElement).toBe(document.body);

      const folderButton = document.querySelector<HTMLButtonElement>('button[aria-label="Folder scope"]');
      expect(folderButton).not.toBeNull();
      folderButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 20, clientY: 22 }));
      await tick();

      const folderMenu = document.body.querySelector<HTMLDivElement>(".fce-folder-menu");
      expect(folderMenu).not.toBeNull();
      expect(folderMenu?.parentElement).toBe(document.body);

      await disposeMountedComponent(component);

      expect(document.body.querySelector(".fce-folder-menu")).toBeNull();
      expect(document.body.querySelector(".fce-sort-menu")).toBeNull();
      document.body.innerHTML = "";
    }

    const addClickCaptureCount = addSpy.mock.calls.filter((call) => call[0] === "click" && call[2] === true).length;
    const removeClickCaptureCount = removeSpy.mock.calls.filter((call) => call[0] === "click" && call[2] === true).length;

    expect(addClickCaptureCount).toBeGreaterThan(0);
    expect(removeClickCaptureCount).toBe(addClickCaptureCount);
  });
});
