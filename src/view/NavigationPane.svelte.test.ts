import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount, tick, unmount } from "svelte";
import NavigationPane from "./NavigationPane.svelte";
import type { FolderTreeNode } from "./types";

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
    { name: "/", path: "/", depth: 0, children: [] },
    { name: "notes", path: "notes", depth: 0, children: [] },
    { name: "projects", path: "projects", depth: 0, children: [] },
  ];
}

function createCaptured(): Captured {
  const selectFolderEvents: SelectFolderPayload[] = [];
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
      navPaneCollapsed: false,
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
    .find((button) => button.textContent?.trim() === text) ?? null;
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

  it("emits include-subfolders toggle from the folder section header action", async () => {
    const captured = createCaptured();
    const { component } = mountNav({ folderPath: "notes", includeSubfolders: true }, captured.callbacks);

    const includeToggle = document.querySelector<HTMLButtonElement>('button[aria-label="Including subfolders"]');
    expect(includeToggle).not.toBeNull();
    includeToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.includeEvents).toEqual([{ value: false }]);

    await disposeMountedComponent(component);
  });

  it("collapses to a rail and emits onToggleNavPane", async () => {
    const captured = createCaptured();
    let { component } = mountNav({}, captured.callbacks);

    const collapseButton = document.querySelector<HTMLButtonElement>('button[aria-label="Collapse navigation"]');
    expect(collapseButton).not.toBeNull();
    collapseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(captured.togglePaneEvents).toBe(1);

    await disposeMountedComponent(component);

    ({ component } = mountNav({ navPaneCollapsed: true }, captured.callbacks));
    expect(document.querySelector(".fce-nav-pane.is-collapsed")).not.toBeNull();
    const expandButton = document.querySelector<HTMLButtonElement>('button[aria-label="Expand navigation"]');
    expect(expandButton).not.toBeNull();

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
