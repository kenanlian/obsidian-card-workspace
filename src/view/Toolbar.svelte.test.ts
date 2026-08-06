import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount } from "svelte";
import { tick } from "svelte";
import Toolbar from "./Toolbar.svelte";
import { BULK_ADD_TO_BOX_ICON, BULK_REMOVE_FROM_BOX_ICON } from "../icons";

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

const BOX_SUMMARIES = [
  { id: "box-1", name: "Reading", cardCount: 3 },
  { id: "box-2", name: "Plans", cardCount: 1 },
];

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

function getBoxPickerButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('button[aria-label="Add current view to card box"]');
}

async function clickBoxPickerButton(): Promise<void> {
  const button = getBoxPickerButton();
  expect(button).not.toBeNull();
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 60, clientY: 12 }));
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

  it("keeps the search input closed while the focus token is zero", async () => {
    const { component } = mountToolbar({ searchFocusToken: 0 });
    await tick();

    expect(document.querySelector(".fce-search-input")).toBeNull();

    await disposeMountedComponent(component);
  });

  it("opens and focuses the search input when the focus token increments", async () => {
    const { component } = mountToolbar({ searchFocusToken: 1 });
    await tick();
    await tick();

    const input = document.querySelector<HTMLInputElement>(".fce-search-input");
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);

    await disposeMountedComponent(component);
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
      "Expand navigation",
      "Create note",
      "Sort cards",
      "Bulk actions",
      "Save current view as card box",
      "Toggle search",
    ];

    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(expectedLabels);

    await disposeMountedComponent(component);
  });

  it("offers add-current-view-to-box only once a card box exists", async () => {
    let { component } = mountToolbar();

    expect(getBoxPickerButton()).toBeNull();

    await disposeMountedComponent(component);

    ({ component } = mountToolbar({ boxSummaries: BOX_SUMMARIES }));

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".fce-toolbar-buttons button"));
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Expand navigation",
      "Create note",
      "Sort cards",
      "Bulk actions",
      "Save current view as card box",
      "Add current view to card box",
      "Toggle search",
    ]);

    await disposeMountedComponent(component);
  });

  it("hides add-current-view-to-box inside a card box", async () => {
    const { component } = mountToolbar({
      boxSummaries: BOX_SUMMARIES,
      activeBoxId: "box-1",
      activeBoxName: "Reading",
    });

    expect(getBoxPickerButton()).toBeNull();

    await disposeMountedComponent(component);
  });

  it("toggles the box picker popup from its own button", async () => {
    const { component } = mountToolbar({ boxSummaries: BOX_SUMMARIES });

    await clickBoxPickerButton();
    expect(document.querySelector(".fce-box-picker-menu")).not.toBeNull();
    expect(getBoxPickerButton()?.classList.contains("is-selected")).toBe(true);

    await clickBoxPickerButton();
    expect(document.querySelector(".fce-box-picker-menu")).toBeNull();
    expect(getBoxPickerButton()?.classList.contains("is-selected")).toBe(false);

    await disposeMountedComponent(component);
  });

  it("adds the current view to the picked box and closes the popup", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({ boxSummaries: BOX_SUMMARIES }, captured.callbacks);

    await clickBoxPickerButton();

    const options = Array.from(document.querySelectorAll<HTMLButtonElement>(".fce-box-picker-item"));
    expect(options.map((option) => option.textContent?.trim())).toEqual(["Reading", "Plans"]);

    options[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(captured.boxCommandEvents).toEqual([{ command: "add-scope-to-box", boxId: "box-2" }]);
    expect(document.querySelector(".fce-box-picker-menu")).toBeNull();

    await disposeMountedComponent(component);
  });

  it("closes the box picker popup on an outside click and when the sort popup opens", async () => {
    const { component } = mountToolbar({ boxSummaries: BOX_SUMMARIES });

    await clickBoxPickerButton();
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(document.querySelector(".fce-box-picker-menu")).toBeNull();

    await clickBoxPickerButton();
    await openSortPopup();

    expect(document.querySelector(".fce-box-picker-menu")).toBeNull();
    expect(document.querySelector(".fce-sort-menu")).not.toBeNull();

    await disposeMountedComponent(component);
  });

  it("toggles the navigation pane through a dedicated callback", async () => {
    const captured = createCapturedCallbacks();
    const onToggleNavPane = vi.fn();
    let { component } = mountToolbar({ navVisible: false, onToggleNavPane }, captured.callbacks);

    const expandButton = document.querySelector<HTMLButtonElement>('button[aria-label="Expand navigation"]');
    expect(expandButton).not.toBeNull();
    expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onToggleNavPane).toHaveBeenCalledTimes(1);
    expect(captured.toolbarActionEvents).toEqual([]);

    await disposeMountedComponent(component);

    ({ component } = mountToolbar({ navVisible: true, onToggleNavPane }, captured.callbacks));

    const collapseButton = document.querySelector<HTMLButtonElement>('button[aria-label="Collapse navigation"]');
    expect(collapseButton).not.toBeNull();
    expect(collapseButton?.classList.contains("is-selected")).toBe(false);

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

  it("emits save-scope-as-box from the toolbar and hides it in box mode", async () => {
    const captured = createCapturedCallbacks();
    let { component } = mountToolbar({}, captured.callbacks);

    const saveScopeButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Save current view as card box"]',
    );
    expect(saveScopeButton).not.toBeNull();
    saveScopeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.boxCommandEvents).toContainEqual({ command: "save-scope-as-box" });

    await disposeMountedComponent(component);

    ({ component } = mountToolbar({ activeBoxId: "box-1", activeBoxName: "Reading" }, captured.callbacks));
    await tick();

    expect(
      document.querySelector('button[aria-label="Save current view as card box"]'),
    ).toBeNull();

    await disposeMountedComponent(component);
  });

  it("renders the browsed folder and tags as truncatable scope text", async () => {
    let { component } = mountToolbar({
      folderPath: "Projects/2026/Notes",
      activeFilterTags: ["work", "idea"],
    });
    await tick();

    let scope = document.querySelector<HTMLElement>(".fce-toolbar-scope");
    expect(scope).not.toBeNull();
    expect(scope?.classList.contains("is-box")).toBe(false);
    expect(document.querySelector(".fce-toolbar-scope-text")?.textContent).toBe("Notes · #work, #idea");

    await disposeMountedComponent(component);

    ({ component } = mountToolbar({ folderPath: "/", activeFilterTags: [] }));
    await tick();

    expect(document.querySelector(".fce-toolbar-scope-text")?.textContent).toBe("Root /");

    await disposeMountedComponent(component);

    ({ component } = mountToolbar({ activeBoxId: "box-1", activeBoxName: "Reading" }));
    await tick();

    scope = document.querySelector<HTMLElement>(".fce-toolbar-scope");
    expect(scope?.classList.contains("is-box")).toBe(true);
    expect(document.querySelector(".fce-toolbar-scope-text")?.textContent).toBe("Reading");

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

  it("adds a remove-from-card-box bulk action only in box mode", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({
      bulkMode: true,
      selectedCount: 2,
      activeBoxId: "box-1",
      activeBoxName: "Alpha",
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
    expect(bulkButtons).toHaveLength(9);

    const addButton = bulkButtons.find(
      (button) => button.getAttribute("data-tooltip") === "Add to card box",
    );
    const removeButton = bulkButtons.find(
      (button) => button.getAttribute("data-tooltip") === "Remove from card box",
    );
    expect(addButton?.getAttribute("data-icon")).toBe(BULK_ADD_TO_BOX_ICON);
    expect(removeButton?.getAttribute("data-icon")).toBe(BULK_REMOVE_FROM_BOX_ICON);

    removeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(captured.toolbarActionEvents).toEqual([{ action: "bulk-remove-from-box" }]);

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
