import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount, tick, unmount } from "svelte";
import NavigationPane from "./NavigationPane.svelte";
import type { FolderActionPayload, FolderTreeNode } from "./types";

interface SelectFolderPayload {
  path: string;
}

interface FilterChangePayload {
  tags: string[];
}

interface BoxCommandPayload {
  command: string;
  boxId?: string;
}

interface IncludeSubfoldersChangePayload {
  value: boolean;
}

type NavSection = "folders" | "tags" | "boxes";

interface NavCallbacks {
  onSelectFolder?: (payload: SelectFolderPayload) => void;
  onFolderAction?: (payload: FolderActionPayload) => void;
  onFilterChange?: (payload: FilterChangePayload) => void;
  onIncludeSubfoldersChange?: (payload: IncludeSubfoldersChangePayload) => void;
  onBoxCommand?: (payload: BoxCommandPayload) => void;
  onNavPaneResize?: (width: number) => void;
  onToggleNavPane?: () => void;
  onToggleNavSection?: (section: NavSection) => void;
}

interface Captured {
  callbacks: NavCallbacks;
  selectFolderEvents: SelectFolderPayload[];
  folderActionEvents: FolderActionPayload[];
  filterEvents: FilterChangePayload[];
  includeEvents: IncludeSubfoldersChangePayload[];
  boxCommandEvents: BoxCommandPayload[];
  resizeEvents: number[];
  togglePaneEvents: number;
  toggleSectionEvents: NavSection[];
}

let mountedComponents: Array<Record<string, unknown>> = [];

function createFolderTree(): FolderTreeNode[] {
  return [
    { name: "/", path: "/", depth: 0, children: [], directCount: 0, recursiveCount: 0 },
    { name: "notes", path: "notes", depth: 0, children: [], directCount: 0, recursiveCount: 0 },
    {
      name: "projects",
      path: "projects",
      depth: 0,
      children: [
        { name: "alpha", path: "projects/alpha", depth: 1, children: [], directCount: 3, recursiveCount: 3 },
      ],
      directCount: 2,
      recursiveCount: 5,
    },
  ];
}

function createCaptured(): Captured {
  const selectFolderEvents: SelectFolderPayload[] = [];
  const folderActionEvents: FolderActionPayload[] = [];
  const filterEvents: FilterChangePayload[] = [];
  const includeEvents: IncludeSubfoldersChangePayload[] = [];
  const boxCommandEvents: BoxCommandPayload[] = [];
  const resizeEvents: number[] = [];
  const toggleSectionEvents: NavSection[] = [];
  let togglePaneEvents = 0;
  const captured: Captured = {
    callbacks: {
      onSelectFolder: (payload) => {
        selectFolderEvents.push(payload);
      },
      onFolderAction: (payload) => {
        folderActionEvents.push(payload);
      },
      onFilterChange: (payload) => {
        filterEvents.push(payload);
      },
      onIncludeSubfoldersChange: (payload) => {
        includeEvents.push(payload);
      },
      onBoxCommand: (payload) => {
        boxCommandEvents.push(payload);
      },
      onNavPaneResize: (width) => {
        resizeEvents.push(width);
      },
      onToggleNavPane: () => {
        togglePaneEvents += 1;
        captured.togglePaneEvents = togglePaneEvents;
      },
      onToggleNavSection: (section) => {
        toggleSectionEvents.push(section);
      },
    },
    selectFolderEvents,
    folderActionEvents,
    filterEvents,
    includeEvents,
    boxCommandEvents,
    resizeEvents,
    togglePaneEvents: 0,
    toggleSectionEvents,
  };
  return captured;
}

function mountNav(
  props: Record<string, unknown> = {},
  callbacks: NavCallbacks = {},
): { component: Record<string, unknown> } {
  const target = document.createElement("div");
  target.className = "folder-card-view";
  document.body.appendChild(target);
  const component = mount(NavigationPane, {
    target,
    props: {
      folderTree: createFolderTree(),
      folderPath: "notes",
      includeSubfolders: true,
      availableTags: ["work", "work/ai", "personal"],
      activeFilterTags: [],
      boxSummaries: [
        { id: "box-1", name: "Alpha" },
        { id: "box-2", name: "Beta" },
      ],
      activeBoxId: null,
      navPaneWidth: 240,
      layoutMode: "dual",
      folderSectionCollapsed: false,
      tagSectionCollapsed: false,
      boxSectionCollapsed: false,
      ...callbacks,
      ...props,
    },
  });
  mountedComponents.push(component);
  return { component };
}

async function disposeMountedComponent(component: Record<string, unknown>): Promise<void> {
  mountedComponents = mountedComponents.filter((candidate) => candidate !== component);
  await unmount(component);
}

function getSectionToggle(title: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".fce-tree-section-toggle"))
    .find((button) => button.textContent?.trim() === title) ?? null;
}

function getTreeButtonByText(menuSelector: string, text: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(`${menuSelector} .fce-tree-button`))
    .find((button) => button.querySelector(".fce-tree-label")?.textContent?.trim() === text) ?? null;
}

function getFolderRowCount(label: string): string | null {
  const button = getTreeButtonByText(".fce-folder-menu", label);
  return button?.querySelector(".fce-nav-row-count")?.textContent?.trim() ?? null;
}

describe("NavigationPane.svelte", () => {
  beforeEach(() => {
    mountedComponents = [];
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    await Promise.all(mountedComponents.map((component) => unmount(component)));
    mountedComponents = [];
    document.body.innerHTML = "";
  });

  it("renders the three collapsible sections", async () => {
    const { component } = mountNav();

    expect(getSectionToggle("Folders")).not.toBeNull();
    expect(getSectionToggle("Tags")).not.toBeNull();
    expect(getSectionToggle("Boxes")).not.toBeNull();

    await disposeMountedComponent(component);
  });

  it("emits onToggleNavSection when a section header is clicked", async () => {
    const captured = createCaptured();
    const { component } = mountNav({}, captured.callbacks);

    getSectionToggle("Folders")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    getSectionToggle("Tags")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    getSectionToggle("Boxes")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(captured.toggleSectionEvents).toEqual(["folders", "tags", "boxes"]);

    await disposeMountedComponent(component);
  });

  it("hides section body when collapsed", async () => {
    const { component } = mountNav({ folderSectionCollapsed: true });

    expect(getTreeButtonByText(".fce-folder-menu", "notes")).toBeNull();

    await disposeMountedComponent(component);
  });

  it("emits onSelectFolder when a folder row is clicked", async () => {
    const captured = createCaptured();
    const { component } = mountNav({}, captured.callbacks);

    getTreeButtonByText(".fce-folder-menu", "projects")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.selectFolderEvents).toEqual([{ path: "projects" }]);

    await disposeMountedComponent(component);
  });

  it("emits multi-select tag filter arrays", async () => {
    const captured = createCaptured();
    const { component } = mountNav({ activeFilterTags: ["work"] }, captured.callbacks);

    getTreeButtonByText(".fce-tag-menu", "personal")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.filterEvents).toEqual([{ tags: ["work", "personal"] }]);

    await disposeMountedComponent(component);
  });

  it("removes an already-selected tag when toggled again", async () => {
    const captured = createCaptured();
    const { component } = mountNav({ activeFilterTags: ["work"] }, captured.callbacks);

    getTreeButtonByText(".fce-tag-menu", "work")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.filterEvents).toEqual([{ tags: [] }]);

    await disposeMountedComponent(component);
  });

  it("disables tag filtering while in a box", async () => {
    const captured = createCaptured();
    const { component } = mountNav({ activeBoxId: "box-1" }, captured.callbacks);

    const tagMenu = document.querySelector<HTMLElement>(".fce-tag-menu");
    expect(tagMenu?.classList.contains("is-disabled")).toBe(true);
    expect(tagMenu?.textContent).toContain("Tag filter is unavailable in a box");

    await disposeMountedComponent(component);
  });

  it("activates a box on click and exits when the active box is clicked", async () => {
    const captured = createCaptured();
    let { component } = mountNav({}, captured.callbacks);

    document.querySelector<HTMLButtonElement>(".fce-nav-box-item")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(captured.boxCommandEvents).toEqual([{ command: "switch", boxId: "box-1" }]);

    await disposeMountedComponent(component);

    const captured2 = createCaptured();
    ({ component } = mountNav({ activeBoxId: "box-1" }, captured2.callbacks));

    document.querySelector<HTMLButtonElement>(".fce-nav-box-item.is-active")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(captured2.boxCommandEvents).toEqual([{ command: "exit" }]);

    await disposeMountedComponent(component);
  });

  it("emits include-subfolders toggle from the pane header", async () => {
    const captured = createCaptured();
    let { component } = mountNav({ folderPath: "notes", includeSubfolders: true }, captured.callbacks);

    const includeToggle = document.querySelector<HTMLButtonElement>('button[aria-label="Including subfolders"]');
    expect(includeToggle).not.toBeNull();
    includeToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.includeEvents).toEqual([{ value: false }]);

    await disposeMountedComponent(component);

    const rootCaptured = createCaptured();
    ({ component } = mountNav({ folderPath: "/", includeSubfolders: true }, rootCaptured.callbacks));

    const rootToggle = document.querySelector<HTMLButtonElement>('button[aria-label="Including subfolders"]');
    expect(rootToggle).not.toBeNull();
    rootToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(rootCaptured.includeEvents).toEqual([{ value: false }]);

    await disposeMountedComponent(component);
  });

  it("hides the include-subfolders toggle in box mode", async () => {
    const { component } = mountNav({ activeBoxId: "box-1" });

    expect(document.querySelector('button[aria-label="Including subfolders"]')).toBeNull();

    await disposeMountedComponent(component);
  });

  it("renders the header toolbar in dual layout", async () => {
    const { component } = mountNav();

    expect(document.querySelector(".fce-nav-pane-header")).not.toBeNull();
    expect(document.querySelector('button[aria-label="Back to cards"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Create child folder"]')).not.toBeNull();

    await disposeMountedComponent(component);
  });

  it("expands every folder and tag node, then collapses them", async () => {
    const { component } = mountNav();

    expect(getTreeButtonByText(".fce-folder-menu", "alpha")).toBeNull();

    const expandAll = document.querySelector<HTMLButtonElement>('button[aria-label="Expand all"]');
    expect(expandAll).not.toBeNull();
    expandAll?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(getTreeButtonByText(".fce-folder-menu", "alpha")).not.toBeNull();
    expect(getTreeButtonByText(".fce-tag-menu", "ai")).not.toBeNull();

    const collapseAll = document.querySelector<HTMLButtonElement>('button[aria-label="Collapse all"]');
    expect(collapseAll).not.toBeNull();
    collapseAll?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(getTreeButtonByText(".fce-folder-menu", "alpha")).toBeNull();

    await disposeMountedComponent(component);
  });

  it("emits create-child-folder for the current scope", async () => {
    const captured = createCaptured();
    const { component } = mountNav({ folderPath: "notes" }, captured.callbacks);

    document.querySelector<HTMLButtonElement>('button[aria-label="Create child folder"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(captured.folderActionEvents).toEqual([{ action: "create-child-folder", path: "notes" }]);

    await disposeMountedComponent(component);
  });

  it("renders a back button in single layout that emits onToggleNavPane", async () => {
    const captured = createCaptured();
    const { component } = mountNav({ layoutMode: "single" }, captured.callbacks);

    const backButton = document.querySelector<HTMLButtonElement>('button[aria-label="Back to cards"]');
    expect(backButton).not.toBeNull();
    backButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.togglePaneEvents).toBe(1);

    await disposeMountedComponent(component);
  });

  it("marks the selected folder row and leaves tag checks intact", async () => {
    const { component } = mountNav({ folderPath: "notes", activeFilterTags: ["work"] });

    const selectedFolderRow = document.querySelector<HTMLElement>(".fce-folder-menu .fce-tree-row.is-selected");
    expect(selectedFolderRow).not.toBeNull();
    expect(selectedFolderRow?.querySelector(".fce-tree-row-check")).toBeNull();

    expect(document.querySelector(".fce-tag-menu .fce-tree-row.is-selected .fce-tree-row-check")).not.toBeNull();

    await disposeMountedComponent(component);
  });

  it("renders counts only when enabled and follows include-subfolders", async () => {
    let { component } = mountNav({ showNavItemCounts: true, includeSubfolders: true });

    expect(getFolderRowCount("projects")).toBe("5");

    await disposeMountedComponent(component);

    ({ component } = mountNav({ showNavItemCounts: true, includeSubfolders: false }));

    expect(getFolderRowCount("projects")).toBe("2");

    await disposeMountedComponent(component);

    ({ component } = mountNav({ showNavItemCounts: false, includeSubfolders: true }));

    expect(document.querySelector(".fce-nav-row-count")).toBeNull();

    await disposeMountedComponent(component);
  });

  it("applies the persisted nav pane width", async () => {
    const { component } = mountNav({ navPaneWidth: 320 });

    const pane = document.querySelector<HTMLElement>(".fce-nav-pane");
    expect(pane?.style.width).toBe("320px");

    await disposeMountedComponent(component);
  });

  it("exposes a resize handle and emits a clamped width after a pointer drag", async () => {
    const captured = createCaptured();
    const { component } = mountNav({ navPaneWidth: 240 }, captured.callbacks);

    const handle = document.querySelector<HTMLElement>(".fce-nav-resize-handle");
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute("role")).toBe("separator");

    if (typeof PointerEvent === "function" && handle) {
      handle.setPointerCapture = () => undefined;
      handle.releasePointerCapture = () => undefined;
      handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 100, pointerId: 1 }));
      handle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 160, pointerId: 1 }));
      handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 160, pointerId: 1 }));
      await tick();

      expect(captured.resizeEvents).toEqual([300]);
    }

    await disposeMountedComponent(component);
  });
});
