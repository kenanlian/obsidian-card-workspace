import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, unmount } from "svelte";
import { tick } from "svelte";
import Toolbar from "./Toolbar.svelte";
import {
  getObsidianMenuInstances,
  resetObsidianMenuInstances,
  type ObsidianMockMenu,
  type ObsidianMockMenuItem,
} from "../__mocks__/obsidian";
import { BULK_ADD_TO_BOX_ICON, BULK_REMOVE_FROM_BOX_ICON } from "../icons";
import { getUiStrings } from "../i18n";

interface SortChangePayload {
  field: string;
  direction: string;
}

interface GroupChangePayload {
  dimension: string;
  orderBy: string;
  orderDirection: string;
}

interface GroupCollapseCommandPayload {
  command: string;
  key?: string;
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

const AVAILABLE_FOLDER_DIMENSIONS = ["none", "folder", "tag", "task"];
const AVAILABLE_BOX_DIMENSIONS = ["none", "folder", "tag", "box-rule", "task"];

interface ToolbarCallbacks {
  onSortChange?: (payload: SortChangePayload) => void;
  onGroupChange?: (payload: GroupChangePayload) => void;
  onGroupCollapseCommand?: (payload: GroupCollapseCommandPayload) => void;
  onSearchQueryChange?: (payload: SearchQueryChangePayload) => void;
  onSearchQueryReset?: (payload: SearchQueryResetPayload) => void;
  onToolbarAction?: (payload: ToolbarActionPayload) => void;
  onBoxCommand?: (payload: BoxCommandPayload) => void;
}

interface CapturedCallbacks {
  callbacks: ToolbarCallbacks;
  sortEvents: SortChangePayload[];
  groupChangeEvents: GroupChangePayload[];
  groupCollapseEvents: GroupCollapseCommandPayload[];
  searchQueryChangeEvents: SearchQueryChangePayload[];
  searchQueryResetEvents: SearchQueryResetPayload[];
  toolbarActionEvents: ToolbarActionPayload[];
  boxCommandEvents: BoxCommandPayload[];
}

let mountedComponents: Array<Record<string, unknown>> = [];

function createCapturedCallbacks(): CapturedCallbacks {
  const sortEvents: SortChangePayload[] = [];
  const groupChangeEvents: GroupChangePayload[] = [];
  const groupCollapseEvents: GroupCollapseCommandPayload[] = [];
  const searchQueryChangeEvents: SearchQueryChangePayload[] = [];
  const searchQueryResetEvents: SearchQueryResetPayload[] = [];
  const toolbarActionEvents: ToolbarActionPayload[] = [];
  const boxCommandEvents: BoxCommandPayload[] = [];
  return {
    callbacks: {
      onSortChange: (payload) => {
        sortEvents.push(payload);
      },
      onGroupChange: (payload) => {
        groupChangeEvents.push(payload);
      },
      onGroupCollapseCommand: (payload) => {
        groupCollapseEvents.push(payload);
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
    groupChangeEvents,
    groupCollapseEvents,
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
  const values = props as Record<string, any>;
  const component = mount(Toolbar, {
    target,
    props: {
      strings: values.strings ?? getUiStrings("en"),
      scope: {
        displayPath: values.folderPath ?? "notes",
        includeSubfolders: true,
        activeBoxId: values.activeBoxId ?? null,
        activeBoxName: values.activeBoxName ?? null,
        boxExcludedCount: 0,
        emptyStateMessage: "",
      },
      search: {
        query: values.searchQuery ?? "",
        status: values.searchStatus ?? "idle",
        readiness: values.searchIndexReadiness,
        persistence: values.searchIndexPersistence,
        rebuildReason: values.searchIndexRebuildReason,
        focusToken: values.searchFocusToken ?? 0,
      },
      projection: {
        sortField: values.sortField ?? "mtime",
        sortDirection: values.sortDirection ?? "desc",
        availableTags: [],
        tagCounts: {},
        activeFilterTags: values.activeFilterTags ?? [],
        pinnedPaths: [],
        group: values.group ?? { dimension: "none", orderBy: "default", orderDirection: "asc" },
        availableGroupDimensions: values.availableGroupDimensions ?? AVAILABLE_FOLDER_DIMENSIONS,
        groupSegmentCount: values.groupSegmentCount ?? 0,
      },
      bulk: {
        bulkMode: values.bulkMode ?? false,
        selectedPaths: [],
        selectedCount: values.selectedCount ?? 0,
        bulkAnchorPath: values.bulkAnchorPath ?? null,
        canBulkSelectAll: values.canBulkSelectAll ?? false,
        canBulkClearSelection: values.canBulkClearSelection ?? false,
        canBulkMoveSelected: values.canBulkMoveSelected ?? false,
        canBulkAddTagSelected: values.canBulkAddTagSelected ?? false,
        canBulkRemoveTagSelected: values.canBulkRemoveTagSelected ?? false,
        canBulkDeleteSelected: values.canBulkDeleteSelected ?? false,
        canBulkMergeSelected: values.canBulkMergeSelected ?? false,
      },
      boxSummaries: values.boxSummaries ?? [],
      navVisible: values.navVisible ?? false,
      onToggleNavPane: values.onToggleNavPane,
      ...callbacks,
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
  // The static class is queryable immediately after mount; icon attributes
  // arrive only after Svelte runs the deferred `use:` actions.
  return document.querySelector<HTMLButtonElement>(".fce-toolbar-actions button.fce-sort-trigger");
}

async function openSortMenu(): Promise<ObsidianMockMenu> {
  const sortButton = getSortButton();
  expect(sortButton).not.toBeNull();
  // Flush mount effects (icon/capture actions) before clicking, matching a real
  // user who can only click a fully rendered toolbar.
  await tick();
  sortButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 44, clientY: 12 }));
  await tick();
  const menu = getObsidianMenuInstances().at(-1);
  expect(menu).toBeDefined();
  return menu!;
}

function itemTitle(item: ObsidianMockMenuItem): string {
  if (typeof item.title === "string") {
    return item.title;
  }
  // Hinted titles are fragments of [label, hint]; the label is the first node.
  return item.title.firstElementChild?.textContent ?? item.title.textContent ?? "";
}

function itemHint(item: ObsidianMockMenuItem): string | null {
  if (typeof item.title === "string") {
    return null;
  }
  return item.title.querySelector(".fce-menu-item-hint")?.textContent ?? null;
}

function findMenuItem(menu: ObsidianMockMenu, title: string): ObsidianMockMenuItem | undefined {
  return menu.items.find((item) => itemTitle(item) === title);
}

function clickMenuItem(menu: ObsidianMockMenu, title: string): void {
  const item = findMenuItem(menu, title);
  expect(item, `expected a "${title}" menu item`).toBeDefined();
  item?.onClick?.(new MouseEvent("click"));
}

function expectMenuItemDisabled(menu: ObsidianMockMenu, title: string): void {
  const item = findMenuItem(menu, title);
  expect(item, `expected a "${title}" menu item`).toBeDefined();
  expect(item?.disabled, `"${title}" should be disabled`).toBe(true);
  expect(item?.onClick, `disabled "${title}" must not register a click handler`).toBeNull();
}

function expectMenuItemEnabled(menu: ObsidianMockMenu, title: string): void {
  const item = findMenuItem(menu, title);
  expect(item, `expected a "${title}" menu item`).toBeDefined();
  expect(item?.disabled, `"${title}" should be enabled`).toBe(false);
  expect(item?.onClick, `enabled "${title}" must register a click handler`).not.toBeNull();
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

describe("Toolbar.svelte", () => {
  beforeEach(() => {
    mountedComponents = [];
    document.body.innerHTML = "";
    resetObsidianMenuInstances();
  });

  afterEach(async () => {
    await Promise.all(mountedComponents.map((component) => unmount(component)));
    mountedComponents = [];
    document.body.innerHTML = "";
    resetObsidianMenuInstances();
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
      "Sort & group",
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
      "Sort & group",
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

  it("closes the box picker popup on an outside click and when the native sort menu opens", async () => {
    const { component } = mountToolbar({ boxSummaries: BOX_SUMMARIES });

    await clickBoxPickerButton();
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(document.querySelector(".fce-box-picker-menu")).toBeNull();

    await clickBoxPickerButton();
    await openSortMenu();

    expect(document.querySelector(".fce-box-picker-menu")).toBeNull();
    expect(getObsidianMenuInstances()).toHaveLength(1);

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

  it("builds the native sort & group menu with four headed sections and trailing commands", async () => {
    const { component } = mountToolbar();

    const menu = await openSortMenu();

    expect(menu.items.map(itemTitle)).toEqual([
      "Sort by", "Edited time", "Created time", "Filename",
      "Order", "Ascending", "Descending",
      "Group by", "None", "Folder", "Tag", "Card box rule", "Task status",
      "Group order", "Default", "Name", "Card count", "Ascending", "Descending",
      "Collapse all", "Expand all",
    ]);
    expect(menu.separators).toBe(5);

    await disposeMountedComponent(component);
  });

  it("decorates the native menu surface and marks the four section headings", async () => {
    const { component } = mountToolbar();

    const menu = await openSortMenu();

    expect(menu.classNames.has("fce-sort-group-menu")).toBe(true);
    expect(
      menu.items
        .filter((item) => item.classNames.has("fce-menu-section-title"))
        .map(itemTitle),
    ).toEqual(["Sort by", "Order", "Group by", "Group order"]);

    await disposeMountedComponent(component);
  });

  it("anchors the native menu under the sort trigger button", async () => {
    const { component } = mountToolbar();

    const sortButton = getSortButton();
    expect(sortButton).not.toBeNull();
    if (sortButton) {
      sortButton.getBoundingClientRect = () => ({ left: 40, top: 96, bottom: 124 }) as DOMRect;
    }

    const menu = await openSortMenu();

    expect(menu.positions).toEqual([{ x: 40, y: 124, overlap: true }]);

    await disposeMountedComponent(component);
  });

  it("marks the current selections as checked", async () => {
    const { component } = mountToolbar({
      sortField: "mtime",
      sortDirection: "desc",
      group: { dimension: "none", orderBy: "default", orderDirection: "asc" },
    });

    const menu = await openSortMenu();

    expect(
      menu.items.filter((item) => item.checked).map(itemTitle),
    ).toEqual(["Edited time", "Descending", "None", "Default", "Ascending"]);
    expect(menu.items.filter((item) => !item.checked)).toHaveLength(
      menu.items.length - 5,
    );

    await disposeMountedComponent(component);
  });

  it("emits sort-change for orthogonal field and direction picks", async () => {
    const captured = createCapturedCallbacks();
    let { component } = mountToolbar({ sortField: "mtime", sortDirection: "desc" }, captured.callbacks);

    let menu = await openSortMenu();
    clickMenuItem(menu, "Filename");

    expect(captured.sortEvents).toEqual([{ field: "name", direction: "desc" }]);

    await disposeMountedComponent(component);

    ({ component } = mountToolbar({ sortField: "name", sortDirection: "desc" }, captured.callbacks));

    menu = await openSortMenu();
    clickMenuItem(menu, "Ascending");

    expect(captured.sortEvents).toEqual([
      { field: "name", direction: "desc" },
      { field: "name", direction: "asc" },
    ]);

    await disposeMountedComponent(component);
  });

  it("does not emit when the already-selected field or direction is picked", async () => {
    const captured = createCapturedCallbacks();
    const { component } = mountToolbar({ sortField: "mtime", sortDirection: "desc" }, captured.callbacks);

    const menu = await openSortMenu();
    clickMenuItem(menu, "Edited time");
    clickMenuItem(menu, "Descending");

    expect(captured.sortEvents).toEqual([]);

    await disposeMountedComponent(component);
  });

  it("disables an unavailable group dimension with its hint and routes the available one", async () => {
    const captured = createCapturedCallbacks();
    let { component } = mountToolbar(
      { availableGroupDimensions: AVAILABLE_FOLDER_DIMENSIONS },
      captured.callbacks,
    );

    let menu = await openSortMenu();

    const boxRule = findMenuItem(menu, "Card box rule");
    expect(boxRule).toBeDefined();
    expect(boxRule?.disabled).toBe(true);
    expect(boxRule?.onClick).toBeNull();
    expect(itemHint(boxRule!)).toBe("Only available inside a card box");
    expectMenuItemEnabled(menu, "Folder");

    await disposeMountedComponent(component);

    ({ component } = mountToolbar({
      availableGroupDimensions: AVAILABLE_BOX_DIMENSIONS,
      activeBoxId: "box-1",
      activeBoxName: "Reading",
      group: { dimension: "none", orderBy: "count", orderDirection: "desc" },
    }, captured.callbacks));

    menu = await openSortMenu();

    expectMenuItemEnabled(menu, "Card box rule");
    expect(itemHint(findMenuItem(menu, "Card box rule")!)).toBeNull();
    clickMenuItem(menu, "Card box rule");

    expect(captured.groupChangeEvents).toEqual([
      { dimension: "box-rule", orderBy: "count", orderDirection: "desc" },
    ]);

    await disposeMountedComponent(component);
  });

  it("gates group order and collapse rows on the active dimension and segment count", async () => {
    const captured = createCapturedCallbacks();
    let { component } = mountToolbar({ groupSegmentCount: 0 }, captured.callbacks);

    let menu = await openSortMenu();

    for (const title of ["Default", "Name", "Card count", "Collapse all", "Expand all"]) {
      expectMenuItemDisabled(menu, title);
    }
    // Group-order direction rows share titles with the sort-direction rows, so
    // assert on their positions instead: they follow the order-by rows.
    const orderDirectionItems = menu.items.filter(
      (item) => itemTitle(item) === "Ascending" || itemTitle(item) === "Descending",
    );
    expect(orderDirectionItems).toHaveLength(4);
    expect(orderDirectionItems.slice(2).every((item) => item.disabled && item.onClick === null)).toBe(true);

    await disposeMountedComponent(component);

    ({ component } = mountToolbar({
      group: { dimension: "folder", orderBy: "default", orderDirection: "asc" },
      groupSegmentCount: 3,
    }, captured.callbacks));

    menu = await openSortMenu();

    for (const title of ["Default", "Name", "Card count", "Collapse all", "Expand all"]) {
      expectMenuItemEnabled(menu, title);
    }

    clickMenuItem(menu, "Collapse all");

    expect(captured.groupCollapseEvents).toEqual([{ command: "collapse-all" }]);

    menu = await openSortMenu();
    clickMenuItem(menu, "Card count");

    expect(captured.groupChangeEvents).toEqual([
      { dimension: "folder", orderBy: "count", orderDirection: "asc" },
    ]);

    await disposeMountedComponent(component);
  });

  it("reflects active grouping on the sort trigger button without transient menu state", async () => {
    let { component } = mountToolbar();

    expect(getSortButton()?.hasAttribute("aria-expanded")).toBe(false);
    expect(getSortButton()?.classList.contains("is-selected")).toBe(false);

    await openSortMenu();
    expect(getSortButton()?.hasAttribute("aria-expanded")).toBe(false);

    await disposeMountedComponent(component);

    ({ component } = mountToolbar({
      group: { dimension: "tag", orderBy: "default", orderDirection: "asc" },
    }));
    await tick();

    expect(getSortButton()?.hasAttribute("aria-expanded")).toBe(false);
    expect(getSortButton()?.classList.contains("is-selected")).toBe(true);

    await disposeMountedComponent(component);

    ({ component } = mountToolbar({ strings: getUiStrings("zh") }));
    await tick();

    expect(getSortButton()?.getAttribute("aria-label")).toBe("排序与分组");

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
});
