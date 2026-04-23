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
      "Filter cards",
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
      activeFilterTags: ["#Work"],
      searchStatus: "ready",
    }));
    await tick();

    let summaryRow = document.querySelector<HTMLDivElement>(".fce-toolbar-content-row");
    expect(summaryRow).not.toBeNull();
    let content = summaryRow?.textContent || "";
    expect(content).toContain("Tag filter: 1 active");
    expect(content).not.toContain("Scope:");
    expect(content).not.toContain("Index ready");
    await disposeMountedComponent(component);

    const expectedStatuses = {
      building: "Building index",
      fallback: "Fallback search",
      error: "Search error",
    } as const;

    for (const searchStatus of ["building", "fallback", "error"] as const) {
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

    let filterButton = document.querySelector<HTMLButtonElement>('button[aria-label="Filter cards"]');
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

  it("renders a compact icon-only bulk strip with tooltips and right-aligned summary", async () => {
    const { component } = mountToolbar({
      bulkMode: true,
      selectedCount: 3,
      bulkAnchorPath: "some/path.md",
      canBulkSelectAll: true,
      canBulkClearSelection: true,
      canBulkMoveSelected: true,
      canBulkTrashSelected: true,
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
    expect(document.querySelector(".fce-toolbar-bulk-mode-pill")).toBeNull();
    expect(bulkStrip?.textContent).not.toContain("Range anchor ready");
    expect(bulkStrip?.textContent).not.toContain("All bulk actions are ready.");

    const bulkButtons = Array.from(bulkActions?.querySelectorAll<HTMLButtonElement>("button") || []);
    expect(bulkButtons).toHaveLength(7);
    expect(bulkButtons.map((button) => button.getAttribute("data-tooltip"))).toEqual([
      "Select all",
      "Clear selection",
      "Move selected",
      "Trash selected",
      "Delete selected",
      "Merge selected",
      "Exit bulk mode",
    ]);
    expect(bulkButtons.map((button) => button.getAttribute("data-icon"))).toEqual([
      "check-square",
      "x-square",
      "folder-input",
      "trash",
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
