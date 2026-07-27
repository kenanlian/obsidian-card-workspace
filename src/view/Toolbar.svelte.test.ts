import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount } from "svelte";
import { tick } from "svelte";
import Toolbar from "./Toolbar.svelte";

interface SortChangePayload {
  field: string;
  direction: string;
}

interface SearchQueryChangePayload {
  query: string;
}

interface SearchQueryResetPayload {
  source: "clear-button";
}

interface ToolbarActionPayload {
  action: string;
}

interface BoxCommandPayload {
  command: string;
  boxId?: string;
}

interface ToolbarCallbacks {
  onSortChange?: (payload: SortChangePayload) => void;
  onSearchQueryChange?: (payload: SearchQueryChangePayload) => void;
  onSearchQueryReset?: (payload: SearchQueryResetPayload) => void;
  onToolbarAction?: (payload: ToolbarActionPayload) => void;
  onBoxCommand?: (payload: BoxCommandPayload) => void;
}

interface CapturedCallbacks {
  callbacks: ToolbarCallbacks;
  sortEvents: SortChangePayload[];
  searchQueryChangeEvents: SearchQueryChangePayload[];
  searchQueryResetEvents: SearchQueryResetPayload[];
  toolbarActionEvents: ToolbarActionPayload[];
  boxCommandEvents: BoxCommandPayload[];
}

let mountedComponents: Array<Record<string, unknown>> = [];

function createCapturedCallbacks(): CapturedCallbacks {
  const sortEvents: SortChangePayload[] = [];
  const searchQueryChangeEvents: SearchQueryChangePayload[] = [];
  const searchQueryResetEvents: SearchQueryResetPayload[] = [];
  const toolbarActionEvents: ToolbarActionPayload[] = [];
  const boxCommandEvents: BoxCommandPayload[] = [];
  return {
    callbacks: {
      onSortChange: (payload) => {
        sortEvents.push(payload);
      },
      onSearchQueryChange: (payload) => {
        searchQueryChangeEvents.push(payload);
      },
      onSearchQueryReset: (payload) => {
        searchQueryResetEvents.push(payload);
      },
      onToolbarAction: (payload) => {
        toolbarActionEvents.push(payload);
      },
      onBoxCommand: (payload) => {
        boxCommandEvents.push(payload);
      },
    },
    sortEvents,
    searchQueryChangeEvents,
    searchQueryResetEvents,
    toolbarActionEvents,
    boxCommandEvents,
  };
}

function mountToolbar(
  props: Record<string, unknown> = {},
  callbacks: ToolbarCallbacks = {},
): { component: Record<string, unknown>; target: HTMLDivElement } {
  const target = document.createElement("div");
  target.className = "folder-card-view";
  document.body.appendChild(target);
  const component = mount(Toolbar, {
    target,
    props: {
      folderPath: "notes",
      sortField: "mtime",
      sortDirection: "desc",
      searchQuery: "",
      searchStatus: "idle",
      bulkMode: false,
      selectedCount: 0,
      bulkAnchorPath: null,
      canBulkSelectAll: false,
      canBulkClearSelection: false,
      canBulkMoveSelected: false,
      canBulkAddTagSelected: false,
      canBulkRemoveTagSelected: false,
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

  it("does not render folder or tag controls", async () => {
    const { component } = mountToolbar();

    expect(document.querySelector('button[aria-label="Folder scope"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Tag filter"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Including subfolders"]')).toBeNull();

    await disposeMountedComponent(component);
  });

  it("renders first-row controls in the slim sequence", async () => {
    const { component } = mountToolbar();

    const buttonsRow = document.querySelector<HTMLDivElement>(".fce-toolbar-buttons");
    expect(buttonsRow).not.toBeNull();

    const buttons = Array.from(buttonsRow?.querySelectorAll("button") || []);
    const expectedLabels = [
      "Create note",
      "Sort cards",
      "Bulk actions",
      "Card boxes",
      "Toggle search",
    ];

    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(expectedLabels);

    await disposeMountedComponent(component);
  });

  it("emits sort-change with selected field and direction", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({}, captured.callbacks);

    await openSortPopup();

    const filenameDescOption = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".fce-sort-menu button[role='menuitemradio']"),
    ).find((option) => option.textContent?.includes("Filename (Z to A)"));

    expect(filenameDescOption).not.toBeUndefined();
    filenameDescOption?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.sortEvents).toEqual([{ field: "name", direction: "desc" }]);

    await disposeMountedComponent(component);
  });

  it("renders filename sort options before time-based options", async () => {
    const { component } = mountToolbar();

    await openSortPopup();

    const labels = Array.from(
      document.querySelectorAll<HTMLElement>(".fce-sort-menu .fce-sort-menu-item-label"),
    ).map((element) => element.textContent?.trim());

    expect(labels).toEqual([
      "Filename (A to Z)",
      "Filename (Z to A)",
      "Edited time (newest first)",
      "Edited time (oldest first)",
      "Created time (newest first)",
      "Created time (oldest first)",
    ]);

    await disposeMountedComponent(component);
  });

  it("renders the shared trailing selected indicator for the sort menu", async () => {
    const { component } = mountToolbar();

    await openSortPopup();

    const selectedSortOption = getSelectedSortOption();
    expect(selectedSortOption).not.toBeNull();
    expect(selectedSortOption?.classList.contains("fce-popup-row")).toBe(true);
    expect(selectedSortOption?.querySelector(".fce-popup-row-content .fce-sort-menu-item-label")).not.toBeNull();
    expect(selectedSortOption?.querySelector(".fce-popup-row-trailing .fce-popup-row-selected-indicator")).not.toBeNull();
    expect(selectedSortOption?.querySelector(".fce-sort-menu-item-check")).not.toBeNull();

    await disposeMountedComponent(component);
  });

  it("closes the sort popup on escape and outside click", async () => {
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

  it("exposes a menu-level accessible name for sort popup through its trigger button", async () => {
    const { component } = mountToolbar();

    await openSortPopup();

    const sortMenu = document.querySelector<HTMLElement>(".fce-sort-menu");
    expect(sortMenu).not.toBeNull();
    expect(sortMenu?.getAttribute("aria-labelledby")).toBe("fce-sort-button");
    expect(sortMenu?.hasAttribute("aria-label")).toBe(false);

    await disposeMountedComponent(component);
  });

  it("renders search as a toggleable first-row control and autofocuses when expanded", async () => {
    const { component } = mountToolbar();

    let searchInput = document.querySelector<HTMLInputElement>('input[aria-label="Search notes"]');
    expect(searchInput).toBeNull();

    const toggleButton = document.querySelector<HTMLButtonElement>('button[aria-label="Toggle search"]');
    expect(toggleButton).not.toBeNull();

    toggleButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    await tick();

    searchInput = document.querySelector<HTMLInputElement>('input[aria-label="Search notes"]');
    expect(searchInput).not.toBeNull();
    expect(document.querySelector(".fce-toolbar-search-row")).not.toBeNull();
    expect(document.activeElement).toBe(searchInput);

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

    clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.searchQueryResetEvents).toEqual([{ source: "clear-button" }]);
    expect(captured.searchQueryChangeEvents).toEqual([]);

    await disposeMountedComponent(component);
  });

  it("renders search status badges only when exceptional search states are active", async () => {
    let { component } = mountToolbar({ searchStatus: "idle" });
    expect(document.querySelector(".fce-toolbar-content-row")).toBeNull();
    await disposeMountedComponent(component);

    ({ component } = mountToolbar({ searchStatus: "ready" }));
    await tick();
    expect(document.querySelector(".fce-toolbar-content-row")).toBeNull();
    await disposeMountedComponent(component);

    const expectedStatuses = {
      building: "Building index",
      unavailable: "Search unavailable",
      "rebuild-required": "Rebuild required",
      error: "Search error",
    } as const;

    for (const searchStatus of ["building", "unavailable", "rebuild-required", "error"] as const) {
      ({ component } = mountToolbar({ searchStatus }));
      await tick();

      const searchStatusEl = document.querySelector<HTMLElement>(".fce-toolbar-content-row .fce-search-status");
      expect(searchStatusEl).not.toBeNull();
      expect(searchStatusEl?.getAttribute("data-search-status")).toBe(searchStatus);
      expect(searchStatusEl?.textContent).toBe(expectedStatuses[searchStatus]);

      await disposeMountedComponent(component);
    }
  });

  it("opens the box entry menu and emits a create command", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({}, captured.callbacks);

    const boxButton = document.querySelector<HTMLButtonElement>('button[aria-label="Card boxes"]');
    expect(boxButton).not.toBeNull();
    boxButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
    await tick();

    const boxMenu = document.querySelector<HTMLElement>(".fce-box-menu");
    expect(boxMenu).not.toBeNull();

    const createItem = Array.from(boxMenu?.querySelectorAll<HTMLButtonElement>(".fce-box-menu-item") ?? [])
      .find((item) => item.textContent?.includes("New card box"));
    createItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.boxCommandEvents).toContainEqual({ command: "create" });

    await disposeMountedComponent(component);
  });

  it("keeps the bulk button highlighted while bulk mode is active", async () => {
    const { component } = mountToolbar({ bulkMode: true });
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

    await disposeMountedComponent(component);
  });

  it("renders only one destructive bulk action", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({
      bulkMode: true,
      selectedCount: 3,
      bulkAnchorPath: "some/path.md",
      canBulkSelectAll: true,
      canBulkClearSelection: true,
      canBulkMoveSelected: true,
      canBulkAddTagSelected: true,
      canBulkRemoveTagSelected: false,
      canBulkDeleteSelected: true,
      canBulkMergeSelected: true,
    }, captured.callbacks);

    await tick();

    const bulkActions = document.querySelector<HTMLDivElement>(".fce-toolbar-bulk-actions");
    const bulkButtons = Array.from(bulkActions?.querySelectorAll<HTMLButtonElement>("button") || []);
    expect(bulkButtons).toHaveLength(8);

    const destructiveButtons = bulkButtons.filter((button) => button.classList.contains("is-destructive"));
    expect(destructiveButtons).toHaveLength(1);
    expect(destructiveButtons[0]?.getAttribute("data-tooltip")).toBe("Delete selected");

    bulkButtons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    bulkButtons[7]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(captured.toolbarActionEvents).toEqual([
      { action: "bulk-select-all" },
      { action: "bulk-delete-selected" },
    ]);

    await disposeMountedComponent(component);
  });

  it("cleans up the sort menu portal and listeners on unmount", async () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const { component } = mountToolbar();

    await openSortPopup();
    const sortMenu = document.body.querySelector<HTMLDivElement>(".fce-sort-menu");
    expect(sortMenu).not.toBeNull();
    expect(sortMenu?.parentElement).toBe(document.body);

    await disposeMountedComponent(component);

    expect(document.body.querySelector(".fce-sort-menu")).toBeNull();

    const addClickCaptureCount = addSpy.mock.calls.filter((call) => call[0] === "click" && call[2] === true).length;
    const removeClickCaptureCount = removeSpy.mock.calls.filter((call) => call[0] === "click" && call[2] === true).length;

    expect(addClickCaptureCount).toBeGreaterThan(0);
    expect(removeClickCaptureCount).toBe(addClickCaptureCount);
  });
});
