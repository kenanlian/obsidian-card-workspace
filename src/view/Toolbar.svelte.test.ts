import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount } from "svelte";
import { tick } from "svelte";
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
      availableTags: ["#Work", "#Idea"],
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
      canBulkTrashSelected: false,
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

  it("emits filter-change with normalized tags", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({}, captured.callbacks);

    const filterButton = document.querySelector<HTMLButtonElement>('button[aria-label="Filter cards"]');
    expect(filterButton).not.toBeNull();
    filterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 12, clientY: 20 }));
    await tick();

    const workTagItem = Array.from(document.querySelectorAll<HTMLButtonElement>(".fce-filter-menu .fce-sort-menu-item"))
      .find((item) => item.textContent?.includes("#Work"));

    expect(workTagItem).not.toBeUndefined();
    workTagItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(captured.filterEvents).toEqual([{ tags: ["work"] }]);

    await disposeMountedComponent(component);
  });

  it("search query emits intent-only change and reset callbacks", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({ searchQuery: "existing" }, captured.callbacks);

    const searchInput = document.querySelector<HTMLInputElement>('input[aria-label="Search notes"]');
    expect(searchInput).not.toBeNull();
    if (!searchInput) {
      throw new Error("Expected search input to exist");
    }

    searchInput.value = "roadmap";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));

    const clearButton = document.querySelector<HTMLButtonElement>('button[aria-label="Clear search query"]');
    expect(clearButton).not.toBeNull();
    clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.searchQueryChangeEvents).toEqual([{ query: "roadmap" }]);
    expect(captured.searchQueryResetEvents).toEqual([{ source: "clear-button" }]);

    await disposeMountedComponent(component);
  });

  it("search query renders current query and status from props", async () => {
    const { component } = mountToolbar({ searchQuery: "roadmap", searchStatus: "fallback" });

    const searchInput = document.querySelector<HTMLInputElement>('input[aria-label="Search notes"]');
    const status = document.querySelector<HTMLElement>(".fce-search-status");

    expect(searchInput?.value).toBe("roadmap");
    expect(status?.textContent).toContain("Fallback search");
    expect(status?.getAttribute("data-search-status")).toBe("fallback");

    await disposeMountedComponent(component);
  });

  it("renders the exact compact search status labels and no rebuild controls", async () => {
    const expectedLabels = [
      { status: "idle", label: "Search idle" },
      { status: "building", label: "Building index" },
      { status: "ready", label: "Index ready" },
      { status: "fallback", label: "Fallback search" },
      { status: "error", label: "Search error" },
    ] as const;

    for (const expected of expectedLabels) {
      const { component } = mountToolbar({ searchStatus: expected.status });
      const status = document.querySelector<HTMLElement>(".fce-search-status");

      expect(status?.textContent).toBe(expected.label);
      expect(status?.getAttribute("data-search-status")).toBe(expected.status);
      expect(document.body.textContent).not.toContain("Rebuild");
      expect(document.body.textContent).not.toContain("Search settings");

      await disposeMountedComponent(component);
      document.body.innerHTML = "";
    }
  });

  it("emits sort-change with selected field and direction", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({}, captured.callbacks);

    const sortButton = document.querySelector<HTMLButtonElement>('button[aria-label="Sort cards"]');
    expect(sortButton).not.toBeNull();
    sortButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 24, clientY: 36 }));
    await tick();

    const options = Array.from(document.querySelectorAll<HTMLButtonElement>('.fce-sort-menu button[role="menuitemradio"]'));
    const firstUnselected = options.find((option) => option.getAttribute("aria-checked") === "false");
    expect(firstUnselected).not.toBeUndefined();
    firstUnselected?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.sortEvents).toHaveLength(1);
    expect(captured.sortEvents[0]).toEqual({ field: "mtime", direction: "asc" });

    await disposeMountedComponent(component);
  });

  it("emits include-subfolders-change and folder/toolbar actions", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({}, captured.callbacks);

    const includeToggle = document.querySelector<HTMLButtonElement>(".fce-toolbar-toggle");
    expect(includeToggle).not.toBeNull();
    includeToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const pickFolderButton = document.querySelector<HTMLButtonElement>('button[aria-label="Folder scope"]');
    expect(pickFolderButton).not.toBeNull();
    pickFolderButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 44, clientY: 12 }));
    await tick();

    const folderItems = Array.from(document.querySelectorAll<HTMLDivElement>(".fce-folder-menu .fce-folder-tree-item"));
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

  it("cleans up menus on unmount", async () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    for (let i = 0; i < 2; i += 1) {
      const { component } = mountToolbar();

      const filterButton = document.querySelector<HTMLButtonElement>('button[aria-label="Filter cards"]');
      expect(filterButton).not.toBeNull();
      filterButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 16, clientY: 18 }));
      await tick();

      const filterMenu = document.body.querySelector<HTMLDivElement>(".fce-filter-menu");
      expect(filterMenu).not.toBeNull();
      expect(filterMenu?.parentElement).toBe(document.body);

      await disposeMountedComponent(component);

      expect(document.body.querySelector(".fce-filter-menu")).toBeNull();
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
