import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount, tick, unmount } from "svelte";
import NavigationPane from "./NavigationPane.svelte";
import { PLAIN_FOLDER_ICON } from "../icons";
import { getUiStrings } from "../i18n";
import type {
  FavoriteEntry,
  FolderActionPayload,
  FolderTreeNode,
  NavContextMenuPayload,
  NavSectionId,
} from "./types";

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

type NavSection = NavSectionId;

interface NavCallbacks {
  onSelectFolder?: (payload: SelectFolderPayload) => void;
  onFolderAction?: (payload: FolderActionPayload) => void;
  onFilterChange?: (payload: FilterChangePayload) => void;
  onIncludeSubfoldersChange?: (payload: IncludeSubfoldersChangePayload) => void;
  onBoxCommand?: (payload: BoxCommandPayload) => void;
  onNavContextMenu?: (payload: NavContextMenuPayload) => void;
  onFavoriteActivate?: (payload: { favorite: FavoriteEntry }) => void;
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
  navContextMenuEvents: NavContextMenuPayload[];
  favoriteActivateEvents: Array<{ favorite: FavoriteEntry }>;
  resizeEvents: number[];
  togglePaneEvents: number;
  toggleSectionEvents: NavSection[];
}

let mountedComponents: Array<Record<string, unknown>> = [];

function createFolderTree(): FolderTreeNode[] {
  return [
    {
      name: "/",
      path: "/",
      depth: 0,
      children: [],
      directCount: 0,
      recursiveCount: 5,
      recursiveFolderCount: 3,
    },
    {
      name: "notes",
      path: "notes",
      depth: 0,
      children: [],
      directCount: 0,
      recursiveCount: 0,
      recursiveFolderCount: 0,
    },
    {
      name: "projects",
      path: "projects",
      depth: 0,
      children: [
        {
          name: "alpha",
          path: "projects/alpha",
          depth: 1,
          children: [],
          directCount: 3,
          recursiveCount: 3,
          recursiveFolderCount: 0,
        },
      ],
      directCount: 2,
      recursiveCount: 5,
      recursiveFolderCount: 1,
    },
  ];
}

function createCaptured(): Captured {
  const selectFolderEvents: SelectFolderPayload[] = [];
  const folderActionEvents: FolderActionPayload[] = [];
  const filterEvents: FilterChangePayload[] = [];
  const includeEvents: IncludeSubfoldersChangePayload[] = [];
  const boxCommandEvents: BoxCommandPayload[] = [];
  const navContextMenuEvents: NavContextMenuPayload[] = [];
  const favoriteActivateEvents: Array<{ favorite: FavoriteEntry }> = [];
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
      onNavContextMenu: (payload) => {
        navContextMenuEvents.push(payload);
      },
      onFavoriteActivate: (payload) => {
        favoriteActivateEvents.push(payload);
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
    navContextMenuEvents,
    favoriteActivateEvents,
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
  const values = props as Record<string, any>;
  const component = mount(NavigationPane, {
    target,
    props: {
      strings: getUiStrings("en"),
      nav: {
        folderTree: values.folderTree ?? createFolderTree(),
        favorites: values.favorites ?? [],
        boxSummaries: values.boxSummaries ?? [
          { id: "box-1", name: "Alpha", cardCount: 4 },
          { id: "box-2", name: "Beta", cardCount: 0 },
        ],
        paneWidth: values.navPaneWidth ?? 240,
        layoutMode: values.layoutMode ?? "dual",
        visible: true,
        sectionCollapsed: {
          favorites: values.favoritesSectionCollapsed ?? false,
          folders: values.folderSectionCollapsed ?? false,
          tags: values.tagSectionCollapsed ?? false,
          boxes: values.boxSectionCollapsed ?? false,
        },
        showItemCounts: values.showNavItemCounts ?? false,
        tooltipSide: values.tooltipSide ?? "right",
      },
      scope: {
        displayPath: values.folderPath ?? "notes",
        includeSubfolders: values.includeSubfolders ?? true,
        activeBoxId: values.activeBoxId ?? null,
        activeBoxName: null,
        boxExcludedCount: 0,
        emptyStateMessage: "",
      },
      availableTags: values.availableTags ?? ["work", "work/ai", "personal"],
      tagCounts: values.tagCounts ?? { work: 3, "work/ai": 1, personal: 2 },
      activeFilterTags: values.activeFilterTags ?? [],
      ...callbacks,
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

function getTagRowCount(label: string): string | null {
  const button = getTreeButtonByText(".fce-tag-menu", label);
  return button?.querySelector(".fce-nav-row-count")?.textContent?.trim() ?? null;
}

function getRowGlyphIcon(menuSelector: string, label: string): string | null {
  const row = getTreeButtonByText(menuSelector, label)?.closest(".fce-tree-row");
  return row?.querySelector(".fce-tree-item-glyph")?.getAttribute("data-icon") ?? null;
}

function getRow(menuSelector: string, label: string): HTMLElement | null {
  return (getTreeButtonByText(menuSelector, label)?.closest(".fce-tree-row") as HTMLElement | null) ?? null;
}

function getRowTooltip(menuSelector: string, label: string): string | null {
  return getTreeButtonByText(menuSelector, label)?.getAttribute("data-tooltip") ?? null;
}

function getBoxItemByName(name: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".fce-nav-box-item"))
    .find((button) => button.querySelector(".fce-nav-box-label")?.textContent?.trim() === name) ?? null;
}

const FAVORITE_ROWS = [
  {
    kind: "folder" as const,
    ref: "notes",
    label: "notes",
    icon: "card-workspace-plain-folder",
    count: 0,
    selected: true,
    missing: false,
  },
  {
    kind: "file" as const,
    ref: "notes/A.md",
    label: "A",
    icon: "file-text",
    count: 0,
    selected: false,
    missing: true,
  },
  {
    kind: "tag" as const,
    ref: "work",
    label: "work",
    icon: "tag",
    count: 3,
    selected: false,
    missing: false,
  },
  {
    kind: "box" as const,
    ref: "box-1",
    label: "Alpha",
    icon: "box",
    count: 4,
    selected: false,
    missing: false,
  },
];

function dispatchContextMenu(element: Element | null | undefined): void {
  element?.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 20 }),
  );
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

  it("replaces the filter on a plain tag click instead of accumulating", async () => {
    const captured = createCaptured();
    const { component } = mountNav({ activeFilterTags: ["work"] }, captured.callbacks);

    getTreeButtonByText(".fce-tag-menu", "personal")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.filterEvents).toEqual([{ tags: ["personal"] }]);

    await disposeMountedComponent(component);
  });

  it("collapses a multi-tag filter down to the plainly clicked tag", async () => {
    const captured = createCaptured();
    const { component } = mountNav({ activeFilterTags: ["work", "personal"] }, captured.callbacks);

    getTreeButtonByText(".fce-tag-menu", "work")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.filterEvents).toEqual([{ tags: ["work"] }]);

    await disposeMountedComponent(component);
  });

  it("clears the filter when the only active tag is clicked again", async () => {
    const captured = createCaptured();
    const { component } = mountNav({ activeFilterTags: ["work"] }, captured.callbacks);

    getTreeButtonByText(".fce-tag-menu", "work")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(captured.filterEvents).toEqual([{ tags: [] }]);

    await disposeMountedComponent(component);
  });

  it("adds a tag to the filter on ctrl-click", async () => {
    const captured = createCaptured();
    const { component } = mountNav({ activeFilterTags: ["work"] }, captured.callbacks);

    getTreeButtonByText(".fce-tag-menu", "personal")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, ctrlKey: true }),
    );

    expect(captured.filterEvents).toEqual([{ tags: ["work", "personal"] }]);

    await disposeMountedComponent(component);
  });

  it("removes an already-selected tag on meta-click without dropping the rest", async () => {
    const captured = createCaptured();
    const { component } = mountNav({ activeFilterTags: ["work", "personal"] }, captured.callbacks);

    getTreeButtonByText(".fce-tag-menu", "work")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, metaKey: true }),
    );

    expect(captured.filterEvents).toEqual([{ tags: ["personal"] }]);

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

  it("emits a box row context menu request with the box id", async () => {
    const captured = createCaptured();
    const { component } = mountNav({}, captured.callbacks);

    document.querySelector<HTMLButtonElement>(".fce-nav-box-item")?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 20 }),
    );

    expect(captured.navContextMenuEvents).toHaveLength(1);
    expect(captured.navContextMenuEvents[0]?.section).toBe("boxes");
    expect(captured.navContextMenuEvents[0]?.scope).toBe("item");
    expect(captured.navContextMenuEvents[0]?.itemId).toBe("box-1");

    await disposeMountedComponent(component);
  });

  it("emits a header-scoped box menu request from the section header and the list body", async () => {
    const captured = createCaptured();
    const { component } = mountNav({}, captured.callbacks);

    getSectionToggle("Boxes")?.closest(".fce-tree-section-header")?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 20 }),
    );
    document.querySelector<HTMLElement>(".fce-nav-box-list")?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 20 }),
    );

    expect(captured.navContextMenuEvents).toHaveLength(2);
    expect(captured.navContextMenuEvents.map((payload) => payload.scope)).toEqual([
      "header",
      "header",
    ]);
    expect(captured.navContextMenuEvents.map((payload) => payload.itemId)).toEqual([
      undefined,
      undefined,
    ]);

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
    expect(document.querySelector('button[aria-label="New folder in vault root"]')).not.toBeNull();

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

  it("emits create-child-folder targeting the vault root from the pane header", async () => {
    const captured = createCaptured();
    const { component } = mountNav({ folderPath: "notes" }, captured.callbacks);

    document.querySelector<HTMLButtonElement>('button[aria-label="New folder in vault root"]')?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(captured.folderActionEvents).toEqual([{ action: "create-child-folder", path: "/" }]);

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

  it("renders tag counts only when enabled", async () => {
    let { component } = mountNav({ showNavItemCounts: true });

    expect(getTagRowCount("work")).toBe("3");
    expect(getTagRowCount("personal")).toBe("2");

    await disposeMountedComponent(component);

    ({ component } = mountNav({ showNavItemCounts: false }));

    expect(document.querySelector(".fce-tag-menu .fce-nav-row-count")).toBeNull();

    await disposeMountedComponent(component);
  });

  it("leading icon toggles folder expansion and marks tag leaf icons", async () => {
    const { component } = mountNav();
    await tick();

    expect(getTreeButtonByText(".fce-folder-menu", "projects")?.querySelector("[data-icon]")).toBeNull();
    expect(getTreeButtonByText(".fce-folder-menu", "alpha")).toBeNull();

    const projectsRow = getTreeButtonByText(".fce-folder-menu", "projects")?.closest(".fce-tree-row");
    const expandButton = projectsRow?.querySelector<HTMLButtonElement>(
      '.fce-tree-item-icon[aria-label="Expand"]',
    );
    expect(expandButton).not.toBeNull();
    expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(getTreeButtonByText(".fce-folder-menu", "alpha")).not.toBeNull();

    expect(getRowGlyphIcon(".fce-tag-menu", "work")).toBe("tags");
    expect(getRowGlyphIcon(".fce-tag-menu", "personal")).toBe("tag");

    await disposeMountedComponent(component);
  });

  it("shows recursive counts instead of names in row tooltips", async () => {
    const { component } = mountNav();
    await tick();

    expect(getRowTooltip(".fce-folder-menu", "Root /")).toBe("5 files, 3 folders");
    expect(getRowTooltip(".fce-folder-menu", "projects")).toBe("5 files, 1 folder");
    expect(getRowTooltip(".fce-folder-menu", "notes")).toBe("0 files, 0 folders");
    expect(getRowTooltip(".fce-tag-menu", "work")).toBe("3 files, 1 subtag");
    expect(getRowTooltip(".fce-tag-menu", "personal")).toBe("2 files, 0 subtags");
    expect(getBoxItemByName("Alpha")?.getAttribute("data-tooltip")).toBe("4 files");
    expect(getBoxItemByName("Beta")?.getAttribute("data-tooltip")).toBe("0 files");

    await disposeMountedComponent(component);
  });

  it("renders inline box counts only when enabled, including for the active box", async () => {
    const { component } = mountNav({ showNavItemCounts: true, activeBoxId: "box-1" });
    await tick();

    expect(getBoxItemByName("Alpha")?.querySelector(".fce-nav-row-count")?.textContent).toBe("4");
    // Beta holds no cards, so it gets no badge rather than a "0".
    expect(getBoxItemByName("Beta")?.querySelector(".fce-nav-row-count")).toBeNull();

    await disposeMountedComponent(component);
  });

  it("keeps tooltip counts when inline counts are disabled and labels the active box with the exit action", async () => {
    const { component } = mountNav({ showNavItemCounts: false, activeBoxId: "box-1" });
    await tick();

    expect(document.querySelector(".fce-nav-row-count")).toBeNull();
    expect(getRowTooltip(".fce-folder-menu", "projects")).toBe("5 files, 1 folder");
    expect(getBoxItemByName("Alpha")?.getAttribute("data-tooltip")).toBe("Exit box");
    expect(getBoxItemByName("Beta")?.getAttribute("data-tooltip")).toBe("0 files");

    await disposeMountedComponent(component);
  });

  it("uses the plugin folder glyph, folders, folder-open, and house by node shape", async () => {
    const { component } = mountNav();
    await tick();

    expect(getRowGlyphIcon(".fce-folder-menu", "Root /")).toBe("house");
    expect(getRowGlyphIcon(".fce-folder-menu", "notes")).toBe(PLAIN_FOLDER_ICON);
    expect(getRowGlyphIcon(".fce-folder-menu", "projects")).toBe("folders");

    getRow(".fce-folder-menu", "projects")
      ?.querySelector<HTMLButtonElement>(".fce-tree-item-icon")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(getRowGlyphIcon(".fce-folder-menu", "projects")).toBe("folder-open");
    expect(getRowGlyphIcon(".fce-folder-menu", "alpha")).toBe(PLAIN_FOLDER_ICON);

    await disposeMountedComponent(component);
  });

  it("marks a row as hovered while the pointer is anywhere in its subtree", async () => {
    const { component } = mountNav();
    await tick();

    const parentRow = getRow(".fce-folder-menu", "projects");
    parentRow
      ?.querySelector<HTMLButtonElement>(".fce-tree-item-icon")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    const childRow = getRow(".fce-folder-menu", "alpha");
    childRow?.dispatchEvent(new Event("pointerenter"));
    await tick();

    expect(parentRow?.classList.contains("is-hovered")).toBe(true);
    expect(childRow?.classList.contains("is-hovered")).toBe(true);
    expect(getRow(".fce-folder-menu", "notes")?.classList.contains("is-hovered")).toBe(false);

    childRow?.dispatchEvent(new Event("pointerleave"));
    await tick();

    expect(parentRow?.classList.contains("is-hovered")).toBe(false);

    await disposeMountedComponent(component);
  });

  it("indents rows by one indent step per depth level plus a base step", async () => {
    const { component } = mountNav();
    await tick();

    getRow(".fce-folder-menu", "projects")
      ?.querySelector<HTMLButtonElement>(".fce-tree-item-icon")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(getRow(".fce-folder-menu", "projects")?.getAttribute("style")).toContain(
      "calc(var(--fce-nav-indent-step) * (0 + 1))",
    );
    expect(getRow(".fce-folder-menu", "alpha")?.getAttribute("style")).toContain(
      "calc(var(--fce-nav-indent-step) * (1 + 1))",
    );

    await disposeMountedComponent(component);
  });

  it("names the pane and resize handle without an aria-label tooltip", async () => {
    const { component } = mountNav();
    await tick();

    const pane = document.querySelector<HTMLElement>(".fce-nav-pane");
    expect(pane?.hasAttribute("aria-label")).toBe(false);
    const paneLabelId = pane?.getAttribute("aria-labelledby") ?? "";
    expect(document.getElementById(paneLabelId)?.textContent?.trim()).toBe("Navigation");

    const handle = document.querySelector<HTMLElement>(".fce-nav-resize-handle");
    expect(handle?.hasAttribute("aria-label")).toBe(false);
    const handleLabelId = handle?.getAttribute("aria-labelledby") ?? "";
    expect(document.getElementById(handleLabelId)?.textContent?.trim()).toBe("Resize navigation");

    await disposeMountedComponent(component);
  });

  it("renders section identity icons", async () => {
    const { component } = mountNav();
    await tick();

    const glyphIcons = Array.from(document.querySelectorAll(".fce-tree-section-glyph")).map((glyph) =>
      glyph.getAttribute("data-icon"),
    );
    expect(glyphIcons).toEqual(["star", "folders", "tags", "package"]);
    expect(document.querySelectorAll(".fce-tree-section-chevron")).toHaveLength(4);

    await disposeMountedComponent(component);
  });

  it("renders box rows with the box icon", async () => {
    const { component } = mountNav();
    await tick();

    expect(document.querySelector(".fce-nav-box-icon")?.getAttribute("data-icon")).toBe("box");

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

  describe("favorites section", () => {
    it("renders first among the sections with one row per favorite", async () => {
      const { component } = mountNav({ favorites: FAVORITE_ROWS });
      await tick();

      const sectionTitles = Array.from(
        document.querySelectorAll(".fce-tree-section .fce-tree-section-title"),
      ).map((title) => title.textContent?.trim());
      expect(sectionTitles).toEqual(["Favorites", "Folders", "Tags", "Boxes"]);

      const rows = document.querySelectorAll(".fce-favorites-menu .fce-tree-row");
      expect(rows).toHaveLength(4);
      expect(
        Array.from(document.querySelectorAll(".fce-favorites-menu .fce-tree-item-glyph")).map((glyph) =>
          glyph.getAttribute("data-icon"),
        ),
      ).toEqual(["card-workspace-plain-folder", "file-text", "tag", "box"]);

      expect(getRow(".fce-favorites-menu", "notes")?.classList.contains("is-selected")).toBe(true);
      expect(getRow(".fce-favorites-menu", "A")?.classList.contains("is-missing")).toBe(true);

      await disposeMountedComponent(component);
    });

    it("renders the empty state when there are no favorites", async () => {
      const { component } = mountNav({ favorites: [] });
      await tick();

      expect(document.querySelector(".fce-favorites-menu .fce-tree-empty")?.textContent?.trim()).toBe(
        "No favorites yet — right-click an item to add one",
      );

      await disposeMountedComponent(component);
    });

    it("activates every row, including tag rows", async () => {
      const captured = createCaptured();
      const { component } = mountNav({ favorites: FAVORITE_ROWS }, captured.callbacks);
      await tick();

      for (const label of ["notes", "A", "work", "Alpha"]) {
        getTreeButtonByText(".fce-favorites-menu", label)?.click();
      }

      expect(captured.favoriteActivateEvents.map((payload) => payload.favorite)).toEqual([
        { kind: "folder", ref: "notes" },
        { kind: "file", ref: "notes/A.md" },
        { kind: "tag", ref: "work" },
        { kind: "box", ref: "box-1" },
      ]);

      await disposeMountedComponent(component);
    });

    it("emits header, body, and row context menus with a single payload each", async () => {
      const captured = createCaptured();
      const { component } = mountNav({ favorites: FAVORITE_ROWS }, captured.callbacks);
      await tick();

      dispatchContextMenu(getSectionToggle("Favorites")?.closest(".fce-tree-section-header"));
      dispatchContextMenu(document.querySelector(".fce-favorites-menu"));
      dispatchContextMenu(getRow(".fce-favorites-menu", "work"));

      expect(captured.navContextMenuEvents).toHaveLength(3);
      expect(captured.navContextMenuEvents.map((payload) => payload.section)).toEqual([
        "favorites",
        "favorites",
        "favorites",
      ]);
      expect(captured.navContextMenuEvents.map((payload) => payload.scope)).toEqual([
        "header",
        "header",
        "item",
      ]);
      expect(captured.navContextMenuEvents[2]?.favorite).toEqual({ kind: "tag", ref: "work" });

      await disposeMountedComponent(component);
    });
  });

  describe("nav context menu emission", () => {
    it("emits header, body, and row payloads for the folders section", async () => {
      const captured = createCaptured();
      const { component } = mountNav({}, captured.callbacks);
      await tick();

      dispatchContextMenu(getSectionToggle("Folders")?.closest(".fce-tree-section-header"));
      dispatchContextMenu(document.querySelector(".fce-folder-menu"));
      dispatchContextMenu(getRow(".fce-folder-menu", "notes"));

      expect(captured.navContextMenuEvents).toHaveLength(3);
      expect(
        captured.navContextMenuEvents.map((payload) => [payload.section, payload.scope, payload.itemId]),
      ).toEqual([
        ["folders", "header", undefined],
        ["folders", "header", undefined],
        ["folders", "item", "notes"],
      ]);

      await disposeMountedComponent(component);
    });

    it("emits header, body, and row payloads for the tags section", async () => {
      const captured = createCaptured();
      const { component } = mountNav({}, captured.callbacks);
      await tick();

      dispatchContextMenu(getSectionToggle("Tags")?.closest(".fce-tree-section-header"));
      dispatchContextMenu(document.querySelector(".fce-tag-menu"));
      dispatchContextMenu(getRow(".fce-tag-menu", "work"));

      expect(captured.navContextMenuEvents).toHaveLength(3);
      expect(
        captured.navContextMenuEvents.map((payload) => [payload.section, payload.scope, payload.itemId]),
      ).toEqual([
        ["tags", "header", undefined],
        ["tags", "header", undefined],
        ["tags", "item", "work"],
      ]);

      await disposeMountedComponent(component);
    });

    it("reports tag children on the bridge only for a parent tag", async () => {
      const captured = createCaptured();
      const { component } = mountNav({}, captured.callbacks);
      await tick();

      dispatchContextMenu(getRow(".fce-tag-menu", "work"));
      dispatchContextMenu(getRow(".fce-tag-menu", "personal"));

      expect(captured.navContextMenuEvents[0]?.bridge.tagHasChildren).toBe(true);
      expect(captured.navContextMenuEvents[1]?.bridge.tagHasChildren).toBe(false);

      await disposeMountedComponent(component);
    });

    it("flips hasExpandedFolders on the bridge after toggleAllFolders runs", async () => {
      const captured = createCaptured();
      const { component } = mountNav({}, captured.callbacks);
      await tick();

      dispatchContextMenu(getSectionToggle("Folders")?.closest(".fce-tree-section-header"));
      expect(captured.navContextMenuEvents[0]?.bridge.hasExpandedFolders).toBe(false);

      captured.navContextMenuEvents[0]?.bridge.toggleAllFolders();
      await tick();

      dispatchContextMenu(getSectionToggle("Folders")?.closest(".fce-tree-section-header"));
      expect(captured.navContextMenuEvents[1]?.bridge.hasExpandedFolders).toBe(true);

      await disposeMountedComponent(component);
    });
  });
});
