import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockState,
  resetFolderCardViewHarness,
  createViewWithFile,
  getDangerMenuTitles,
  registerFolderCardView,
} from "../__mocks__/folder-card-view-harness";
import type { Menu } from "obsidian";
import { getUiStrings } from "../i18n";
import { createBoxScope } from "./scope";
import { FolderCardView } from "./FolderCardView";
import { buildNavContextMenu, resolveNavMenuDangerLabel, type NavMenuActions, type NavMenuDeps } from "./nav-context-menu";
import type { CardBoxDefinition, FavoriteEntry, NavContextMenuPayload } from "./types";

registerFolderCardView(FolderCardView);

// ---------------------------------------------------------------------------
// Mock menu
// ---------------------------------------------------------------------------

class MockMenuItem {
  title = "";
  icon = "";
  checked: boolean | null = null;
  disabled = false;
  clickHandler: (() => void) | null = null;
  submenu: MockMenu | null = null;
  kind: "item" | "separator" = "item";

  constructor(private readonly submenuSupported: boolean) {}

  setTitle(title: string): this {
    this.title = title;
    return this;
  }

  setIcon(icon: string): this {
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

  setSubmenu(): MockMenu | undefined {
    if (!this.submenuSupported) {
      return undefined;
    }
    this.submenu = new MockMenu(this.submenuSupported);
    return this.submenu;
  }
}

class MockMenu {
  items: MockMenuItem[] = [];

  constructor(private readonly submenuSupported = true) {}

  addItem(configure: (item: MockMenuItem) => void): this {
    const item = new MockMenuItem(this.submenuSupported);
    configure(item);
    this.items.push(item);
    return this;
  }

  addSeparator(): this {
    const separator = new MockMenuItem(this.submenuSupported);
    separator.kind = "separator";
    this.items.push(separator);
    return this;
  }
}

type Signature = Array<{ title: string; icon: string } | "sep">;

function getSignature(menu: MockMenu): Signature {
  return menu.items.map((item) =>
    item.kind === "separator" ? "sep" : { title: item.title, icon: item.icon },
  );
}

function getTitles(menu: MockMenu): string[] {
  return menu.items
    .filter((item) => item.kind === "item")
    .map((item) => item.title);
}

function findItem(menu: MockMenu, title: string): MockMenuItem | undefined {
  return menu.items.find((item) => item.kind === "item" && item.title === title);
}

function asMenu(menu: MockMenu): Menu {
  return menu as unknown as Menu;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBox(id: string, name: string): CardBoxDefinition {
  return {
    id,
    name,
    rules: [],
    manualPaths: [],
    excludedPaths: [],
    pinnedPaths: [],
    sort: { field: "mtime", direction: "desc" },
  };
}

function createActions(): NavMenuActions {
  return {
    createNote: vi.fn(),
    createFolder: vi.fn(),
    createCanvas: vi.fn(),
    createBase: vi.fn(),
    duplicateFolder: vi.fn(),
    moveFolder: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    findInFolder: vi.fn(),
    copyPath: vi.fn(),
    revealInSystemExplorer: vi.fn(),
    toggleIncludeSubfolders: vi.fn(),
    toggleSection: vi.fn(),
    addTagToFilter: vi.fn(),
    removeTagFromFilter: vi.fn(),
    filterByOnlyTag: vi.fn(),
    clearTagFilter: vi.fn(),
    createNoteWithTag: vi.fn(),
    copyTag: vi.fn(),
    boxCommand: vi.fn(),
    appendAddScopeSubmenu: vi.fn(),
    restoreBoxExcluded: vi.fn(),
    toggleFavorite: vi.fn(),
    moveFavorite: vi.fn(),
    clearFavorites: vi.fn(),
    cardMenu: vi.fn(),
  };
}

function createDeps(overrides: Partial<NavMenuDeps> = {}): NavMenuDeps {
  return {
    strings: getUiStrings("en"),
    isBoxMode: false,
    includeSubfolders: true,
    activeFilterTags: [],
    canResolveSystemPath: true,
    favorites: [],
    boxes: [makeBox("box-1", "Alpha"), makeBox("box-2", "Beta")],
    activeBoxId: null,
    boxExcludedCount: () => 0,
    sectionCollapsed: { favorites: false, folders: false, tags: false, boxes: false },
    hasExpandedFolders: false,
    hasExpandedTags: false,
    tagExpansion: () => ({ hasChildren: false, expanded: false }),
    expansionActions: { toggleAllFolders: vi.fn(), toggleAllTags: vi.fn(), toggleTag: vi.fn() },
    actions: createActions(),
    ...overrides,
  };
}

function createPayload(
  overrides: Partial<NavContextMenuPayload> & Pick<NavContextMenuPayload, "section" | "scope">,
): NavContextMenuPayload {
  return {
    originId: `section:${overrides.section}`,
    trigger: { kind: "pointer", mouseEvent: { clientX: 1, clientY: 2 } as MouseEvent },
    ...overrides,
  };
}

function build(
  payload: NavContextMenuPayload,
  deps: NavMenuDeps,
  submenuSupported = true,
): { menu: MockMenu; result: boolean } {
  const menu = new MockMenu(submenuSupported);
  const result = buildNavContextMenu(asMenu(menu), payload, deps);
  return { menu, result };
}

// ---------------------------------------------------------------------------
// Menus A–C: folders
// ---------------------------------------------------------------------------

describe("folders header menu", () => {
  it("renders the create-at-root block, expansion, subfolders, and section toggle", () => {
    const deps = createDeps();
    const { menu, result } = build(createPayload({ section: "folders", scope: "header" }), deps);

    expect(result).toBe(true);
    expect(getSignature(menu)).toEqual([
      { title: "New note in vault root", icon: "square-pen" },
      { title: "New folder in vault root", icon: "folder-plus" },
      { title: "New canvas in vault root", icon: "layout-dashboard" },
      { title: "New base in vault root", icon: "layout-list" },
      "sep",
      { title: "Expand all folders", icon: "chevrons-up-down" },
      { title: "Including subfolders", icon: "folder-tree" },
      "sep",
      { title: "Collapse section", icon: "chevron-down" },
    ]);
  });

  it("flips the expand-all title and the section toggle from current state", () => {
    const deps = createDeps({
      sectionCollapsed: { favorites: false, folders: true, tags: false, boxes: false },
      hasExpandedFolders: true,
    });
    const payload = createPayload({
      section: "folders",
      scope: "header",
      originId: "section:folders",
    });
    const { menu } = build(payload, deps);

    expect(getTitles(menu)).toContain("Collapse all folders");
    expect(getTitles(menu)).toContain("Expand section");
  });

  it("checks include-subfolders and disables it in box mode", () => {
    const deps = createDeps({ includeSubfolders: false, isBoxMode: true });
    const { menu } = build(createPayload({ section: "folders", scope: "header" }), deps);

    const item = findItem(menu, "Including subfolders");
    expect(item?.checked).toBe(false);
    expect(item?.disabled).toBe(true);
  });

  it("routes the create actions to the root path", () => {
    const deps = createDeps();
    const { menu } = build(createPayload({ section: "folders", scope: "header" }), deps);

    findItem(menu, "New base in vault root")?.clickHandler?.();
    expect(deps.actions.createBase).toHaveBeenCalledWith("/");
  });
});

describe("root folder row menu", () => {
  it("offers only the four create items, search, and reveal", () => {
    const deps = createDeps({ tagExpansion: () => ({ hasChildren: true, expanded: true }) });
    const { menu, result } = build(
      createPayload({ section: "folders", scope: "item", itemId: "/" }),
      deps,
    );

    expect(result).toBe(true);
    expect(getSignature(menu)).toEqual([
      { title: "New note", icon: "square-pen" },
      { title: "New folder", icon: "folder-plus" },
      { title: "New canvas", icon: "layout-dashboard" },
      { title: "New base", icon: "layout-list" },
      "sep",
      { title: "Search in folder", icon: "search" },
      { title: "Show in system explorer", icon: "folder-symlink" },
    ]);
  });

  it("reveals the vault root by its empty path", () => {
    const deps = createDeps();
    const { menu } = build(createPayload({ section: "folders", scope: "item", itemId: "/" }), deps);

    findItem(menu, "Show in system explorer")?.clickHandler?.();
    expect(deps.actions.revealInSystemExplorer).toHaveBeenCalledWith("");
  });

  it("omits reveal when the system path cannot be resolved", () => {
    const deps = createDeps({ canResolveSystemPath: false });
    const { menu } = build(createPayload({ section: "folders", scope: "item", itemId: "/" }), deps);

    expect(getTitles(menu)).not.toContain("Show in system explorer");
  });
});

describe("folder row menu", () => {
  it("renders the full fifteen-row menu in order", () => {
    const deps = createDeps();
    const { menu, result } = build(
      createPayload({ section: "folders", scope: "item", itemId: "Projects" }),
      deps,
    );

    expect(result).toBe(true);
    expect(getSignature(menu)).toEqual([
      { title: "New note", icon: "square-pen" },
      { title: "New folder", icon: "folder-plus" },
      { title: "New canvas", icon: "layout-dashboard" },
      { title: "New base", icon: "layout-list" },
      "sep",
      { title: "Make a copy", icon: "copy" },
      { title: "Move folder", icon: "folder-input" },
      { title: "Search in folder", icon: "search" },
      { title: "Add to favorites", icon: "star" },
      "sep",
      { title: "Copy path", icon: "clipboard-copy" },
      { title: "Show in system explorer", icon: "folder-symlink" },
      "sep",
      { title: "Rename...", icon: "pencil" },
      { title: "Delete folder", icon: "trash" },
    ]);
  });

  it("flips the favorite item once the folder is favorited", () => {
    const favorites: FavoriteEntry[] = [{ kind: "folder", ref: "Projects" }];
    const deps = createDeps({ favorites });
    const { menu } = build(
      createPayload({ section: "folders", scope: "item", itemId: "Projects" }),
      deps,
    );

    const item = findItem(menu, "Remove from favorites");
    expect(item?.icon).toBe("star-off");
    item?.clickHandler?.();
    expect(deps.actions.toggleFavorite).toHaveBeenCalledWith("folder", "Projects");
  });

  it("builds the copy-path submenu with both branches", () => {
    const deps = createDeps();
    const { menu } = build(
      createPayload({ section: "folders", scope: "item", itemId: "Projects" }),
      deps,
    );

    const submenu = findItem(menu, "Copy path")?.submenu;
    expect(submenu).not.toBeUndefined();
    expect(getTitles(submenu as MockMenu)).toEqual(["Vault path", "System path"]);
    expect(findItem(submenu as MockMenu, "Vault path")?.icon).toBe("vault");
    expect(findItem(submenu as MockMenu, "System path")?.icon).toBe("hard-drive");

    findItem(submenu as MockMenu, "System path")?.clickHandler?.();
    expect(deps.actions.copyPath).toHaveBeenCalledWith("Projects", "system");
  });

  it("drops the system-path submenu entry when the system path is unavailable", () => {
    const deps = createDeps({ canResolveSystemPath: false });
    const { menu } = build(
      createPayload({ section: "folders", scope: "item", itemId: "Projects" }),
      deps,
    );

    const submenu = findItem(menu, "Copy path")?.submenu;
    expect(getTitles(submenu as MockMenu)).toEqual(["Vault path"]);
    expect(getTitles(menu)).not.toContain("Show in system explorer");
  });

  it("falls back to a direct vault-path copy when submenus are unavailable", () => {
    const deps = createDeps();
    const { menu } = build(
      createPayload({ section: "folders", scope: "item", itemId: "Projects" }),
      deps,
      false,
    );

    const item = findItem(menu, "Copy path");
    expect(item?.submenu).toBeNull();
    item?.clickHandler?.();
    expect(deps.actions.copyPath).toHaveBeenCalledWith("Projects", "vault");
  });
});

// ---------------------------------------------------------------------------
// Menus D–E: tags
// ---------------------------------------------------------------------------

describe("tags header menu", () => {
  it("renders clear-filter, expansion, and the section toggle", () => {
    const deps = createDeps({ activeFilterTags: ["work"] });
    const { menu, result } = build(createPayload({ section: "tags", scope: "header" }), deps);

    expect(result).toBe(true);
    expect(getSignature(menu)).toEqual([
      { title: "Clear tag filter", icon: "filter-x" },
      "sep",
      { title: "Expand all tags", icon: "chevrons-up-down" },
      "sep",
      { title: "Collapse section", icon: "chevron-down" },
    ]);
    expect(findItem(menu, "Clear tag filter")?.disabled).toBe(false);
  });

  it("disables clear-filter when no tag is active", () => {
    const deps = createDeps();
    const { menu } = build(createPayload({ section: "tags", scope: "header" }), deps);

    expect(findItem(menu, "Clear tag filter")?.disabled).toBe(true);
  });

  it("reduces to the section toggle in box mode", () => {
    const deps = createDeps({ isBoxMode: true, activeFilterTags: ["work"] });
    const { menu } = build(createPayload({ section: "tags", scope: "header" }), deps);

    expect(getSignature(menu)).toEqual([{ title: "Collapse section", icon: "chevron-down" }]);
  });
});

describe("tag row menu", () => {
  it("renders the add-to-filter variant for an inactive tag", () => {
    const deps = createDeps();
    const { menu, result } = build(
      createPayload({ section: "tags", scope: "item", itemId: "work" }),
      deps,
    );

    expect(result).toBe(true);
    expect(getSignature(menu)).toEqual([
      { title: "Add tag to filter", icon: "tag" },
      { title: "Filter by this tag only", icon: "filter" },
      "sep",
      { title: "New note with this tag", icon: "square-pen" },
      { title: "Copy tag", icon: "clipboard-copy" },
      { title: "Add to favorites", icon: "star" },
    ]);
    expect(findItem(menu, "Add tag to filter")?.checked).toBe(false);
  });

  it("flips to remove-from-filter and disables only-this-tag for the single active tag", () => {
    const deps = createDeps({ activeFilterTags: ["work"] });
    const { menu } = build(createPayload({ section: "tags", scope: "item", itemId: "work" }), deps);

    const toggle = findItem(menu, "Remove tag from filter");
    expect(toggle?.checked).toBe(true);
    toggle?.clickHandler?.();
    expect(deps.actions.removeTagFromFilter).toHaveBeenCalledWith("work");
    expect(findItem(menu, "Filter by this tag only")?.disabled).toBe(true);
  });

  it("adds the subtag expansion item only for a parent tag", () => {
    const deps = createDeps({ tagExpansion: () => ({ hasChildren: true, expanded: true }) });
    const payload = createPayload({
      section: "tags",
      scope: "item",
      itemId: "work",
      originId: "tag:work",
    });
    const { menu } = build(payload, deps);

    expect(getSignature(menu)).toEqual([
      { title: "Add tag to filter", icon: "tag" },
      { title: "Filter by this tag only", icon: "filter" },
      "sep",
      { title: "Collapse subtags", icon: "chevron-down" },
      "sep",
      { title: "New note with this tag", icon: "square-pen" },
      { title: "Copy tag", icon: "clipboard-copy" },
      { title: "Add to favorites", icon: "star" },
    ]);
  });

  it("returns false in box mode", () => {
    const deps = createDeps({ isBoxMode: true });
    const { menu, result } = build(
      createPayload({ section: "tags", scope: "item", itemId: "work" }),
      deps,
    );

    expect(result).toBe(false);
    expect(menu.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Menus F–G: boxes
// ---------------------------------------------------------------------------

describe("boxes header menu", () => {
  it("renders create, save-scope, the scope submenu hook, and the section toggle", () => {
    const deps = createDeps({ tagExpansion: () => ({ hasChildren: true, expanded: true }) });
    const { menu, result } = build(createPayload({ section: "boxes", scope: "header" }), deps);

    expect(result).toBe(true);
    expect(getSignature(menu)).toEqual([
      { title: "New card box…", icon: "box" },
      { title: "Save current view as card box…", icon: "package-plus" },
      "sep",
      { title: "Collapse section", icon: "chevron-down" },
    ]);
    expect(deps.actions.appendAddScopeSubmenu).toHaveBeenCalledTimes(1);
  });

  it("hides the scope items in box mode", () => {
    const deps = createDeps({ isBoxMode: true, activeBoxId: "box-1" });
    const { menu } = build(createPayload({ section: "boxes", scope: "header" }), deps);

    expect(getSignature(menu)).toEqual([
      { title: "New card box…", icon: "box" },
      "sep",
      { title: "Collapse section", icon: "chevron-down" },
    ]);
    expect(deps.actions.appendAddScopeSubmenu).not.toHaveBeenCalled();
  });
});

describe("box row menu", () => {
  it("renders the open variant for an inactive box", () => {
    const deps = createDeps();
    const { menu, result } = build(
      createPayload({ section: "boxes", scope: "item", itemId: "box-1" }),
      deps,
    );

    expect(result).toBe(true);
    expect(getSignature(menu)).toEqual([
      { title: "Open card box", icon: "box" },
      { title: "Configure card box…", icon: "settings-2" },
      { title: "Add current view to this card box", icon: "list-plus" },
      { title: "Add to favorites", icon: "star" },
      "sep",
      { title: "Make a copy", icon: "copy" },
      "sep",
      { title: "Rename…", icon: "pencil" },
      { title: "Delete", icon: "trash-2" },
    ]);
  });

  it("flips to exit for the active box and hides the scope item in box mode", () => {
    const deps = createDeps({ isBoxMode: true, activeBoxId: "box-1" });
    const { menu } = build(
      createPayload({ section: "boxes", scope: "item", itemId: "box-1" }),
      deps,
    );

    const exit = findItem(menu, "Exit card box");
    expect(exit?.icon).toBe("log-out");
    exit?.clickHandler?.();
    expect(deps.actions.boxCommand).toHaveBeenCalledWith("exit", "box-1");
    expect(getTitles(menu)).not.toContain("Add current view to this card box");
  });

  it("offers restore only when the box has excluded cards", () => {
    const deps = createDeps({ boxExcludedCount: () => 3 });
    const { menu } = build(
      createPayload({ section: "boxes", scope: "item", itemId: "box-1" }),
      deps,
    );

    const restore = findItem(menu, "Restore 3 removed notes");
    expect(restore?.icon).toBe("undo-2");
    restore?.clickHandler?.();
    expect(deps.actions.restoreBoxExcluded).toHaveBeenCalledWith("box-1");
  });

  it("returns false for an unknown box id", () => {
    const deps = createDeps();
    const { menu, result } = build(
      createPayload({ section: "boxes", scope: "item", itemId: "missing" }),
      deps,
    );

    expect(result).toBe(false);
    expect(menu.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Menus H–I: favorites
// ---------------------------------------------------------------------------

describe("favorites header menu", () => {
  it("renders clear-favorites and the section toggle", () => {
    const deps = createDeps({ favorites: [{ kind: "tag", ref: "work" }] });
    const { menu, result } = build(createPayload({ section: "favorites", scope: "header" }), deps);

    expect(result).toBe(true);
    expect(getSignature(menu)).toEqual([
      { title: "Clear favorites", icon: "star-off" },
      "sep",
      { title: "Collapse section", icon: "chevron-down" },
    ]);
    expect(findItem(menu, "Clear favorites")?.disabled).toBe(false);
  });

  it("disables clear-favorites when the list is empty", () => {
    const deps = createDeps();
    const { menu } = build(createPayload({ section: "favorites", scope: "header" }), deps);

    expect(findItem(menu, "Clear favorites")?.disabled).toBe(true);
  });
});

describe("favorites row menu", () => {
  const favorites: FavoriteEntry[] = [
    { kind: "folder", ref: "Projects" },
    { kind: "folder", ref: "Notes" },
    { kind: "file", ref: "Notes/A.md" },
    { kind: "tag", ref: "work" },
    { kind: "box", ref: "box-1" },
  ];

  it("prefixes the folder menu with unfavorite plus reordering", () => {
    const deps = createDeps({ favorites });
    const { menu, result } = build(
      createPayload({
        section: "favorites",
        scope: "item",
        favorite: { kind: "folder", ref: "Projects" },
      }),
      deps,
    );

    expect(result).toBe(true);
    expect(getSignature(menu).slice(0, 4)).toEqual([
      { title: "Remove from favorites", icon: "star-off" },
      { title: "Move up", icon: "arrow-up" },
      { title: "Move down", icon: "arrow-down" },
      "sep",
    ]);
    expect(getTitles(menu)).toContain("Delete folder");
    expect(findItem(menu, "Move up")?.disabled).toBe(true);
    expect(findItem(menu, "Move down")?.disabled).toBe(false);
  });

  it("disables move-down for the last entry inside its kind group", () => {
    const deps = createDeps({ favorites });
    const { menu } = build(
      createPayload({
        section: "favorites",
        scope: "item",
        favorite: { kind: "folder", ref: "Notes" },
      }),
      deps,
    );

    expect(findItem(menu, "Move up")?.disabled).toBe(false);
    expect(findItem(menu, "Move down")?.disabled).toBe(true);
  });

  it("appends the root-folder menu for the vault-root favorite", () => {
    const deps = createDeps({ favorites: [{ kind: "folder", ref: "" }] });
    const { menu } = build(
      createPayload({ section: "favorites", scope: "item", favorite: { kind: "folder", ref: "" } }),
      deps,
    );

    expect(getTitles(menu)).not.toContain("Delete folder");
    expect(getTitles(menu)).toContain("Search in folder");
  });

  it("delegates to the host card menu for a file favorite", () => {
    const deps = createDeps({ favorites });
    const { menu } = build(
      createPayload({
        section: "favorites",
        scope: "item",
        favorite: { kind: "file", ref: "Notes/A.md" },
      }),
      deps,
    );

    expect(deps.actions.cardMenu).toHaveBeenCalledTimes(1);
    expect(deps.actions.cardMenu).toHaveBeenCalledWith(asMenu(menu), "Notes/A.md");
  });

  it("stops after the reordering block for a tag favorite in box mode", () => {
    const deps = createDeps({ favorites, isBoxMode: true, activeBoxId: "box-1" });
    const { menu } = build(
      createPayload({ section: "favorites", scope: "item", favorite: { kind: "tag", ref: "work" } }),
      deps,
    );

    expect(getSignature(menu)).toEqual([
      { title: "Remove from favorites", icon: "star-off" },
      { title: "Move up", icon: "arrow-up" },
      { title: "Move down", icon: "arrow-down" },
      "sep",
    ]);
  });

  it("appends the box menu for a box favorite", () => {
    const deps = createDeps({ favorites });
    const { menu } = build(
      createPayload({ section: "favorites", scope: "item", favorite: { kind: "box", ref: "box-1" } }),
      deps,
    );

    expect(getTitles(menu)).toContain("Open card box");
    expect(getTitles(menu)).toContain("Configure card box…");
  });

  it("returns false without a favorite payload", () => {
    const deps = createDeps({ favorites });
    const { menu, result } = build(createPayload({ section: "favorites", scope: "item" }), deps);

    expect(result).toBe(false);
    expect(menu.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Localization + danger labels
// ---------------------------------------------------------------------------

describe("localization", () => {
  it("renders the folder row menu in zh", () => {
    const deps = createDeps({ strings: getUiStrings("zh") });
    const { menu } = build(
      createPayload({ section: "folders", scope: "item", itemId: "Projects" }),
      deps,
    );

    expect(getTitles(menu)).toEqual([
      "新建笔记",
      "新建文件夹",
      "新建白板",
      "新建数据库",
      "创建副本",
      "移动文件夹",
      "在文件夹中查找",
      "收藏",
      "复制路径",
      "在系统资源管理器中显示",
      "重命名...",
      "删除文件夹",
    ]);
  });
});

describe("resolveNavMenuDangerLabel", () => {
  const deps = createDeps({ favorites: [] });

  it("returns null for every header payload", () => {
    for (const section of ["favorites", "folders", "tags", "boxes"] as const) {
      expect(resolveNavMenuDangerLabel(createPayload({ section, scope: "header" }), deps)).toBeNull();
    }
  });

  it("returns the folder delete label for a non-root folder row", () => {
    expect(
      resolveNavMenuDangerLabel(
        createPayload({ section: "folders", scope: "item", itemId: "Projects" }),
        deps,
      ),
    ).toBe("Delete folder");
    expect(
      resolveNavMenuDangerLabel(
        createPayload({ section: "folders", scope: "item", itemId: "/" }),
        deps,
      ),
    ).toBeNull();
  });

  it("returns the box delete label for a box row and null for a tag row", () => {
    expect(
      resolveNavMenuDangerLabel(
        createPayload({ section: "boxes", scope: "item", itemId: "box-1" }),
        deps,
      ),
    ).toBe("Delete");
    expect(
      resolveNavMenuDangerLabel(
        createPayload({ section: "tags", scope: "item", itemId: "work" }),
        deps,
      ),
    ).toBeNull();
  });

  it("resolves the kind-appropriate label for favorites rows", () => {
    const cases: Array<[FavoriteEntry, string | null]> = [
      [{ kind: "folder", ref: "Projects" }, "Delete folder"],
      [{ kind: "folder", ref: "" }, null],
      [{ kind: "file", ref: "Notes/A.md" }, "Delete"],
      [{ kind: "tag", ref: "work" }, null],
      [{ kind: "box", ref: "box-1" }, "Delete"],
    ];

    for (const [favorite, expected] of cases) {
      expect(
        resolveNavMenuDangerLabel(
          createPayload({ section: "favorites", scope: "item", favorite }),
          deps,
        ),
      ).toBe(expected);
    }
  });
});

describe("nav context menu wiring", () => {
  beforeEach(() => {
    resetFolderCardViewHarness();
  });

    function createNavView(
      settingsOverrides: Record<string, unknown> = {},
    ): { view: FolderCardView; plugin: any } {
      const { view, plugin } = createViewWithFile("notes/nav-menu.md");
      plugin.getSettings = vi.fn(() => ({
        includeSubfolders: true,
        sort: { field: "mtime", direction: "desc" },
        filter: { tags: [] },
        defaultView: "cards",
        lastFolderPath: "notes",
        pinnedPaths: [],
        previewLines: 5,
        activeBoxId: null,
        boxes: [],
        favorites: [],
        favoritesSectionCollapsed: false,
        folderSectionCollapsed: false,
        tagSectionCollapsed: false,
        boxSectionCollapsed: false,
        ...settingsOverrides,
      }));
      const activeBox = (plugin.getSettings() as { activeBoxId: string | null }).activeBoxId;
      if (activeBox !== null) {
        (view as any).cardScope = createBoxScope(activeBox);
      }
      return { view, plugin };
    }

    function navPayload(overrides: Record<string, unknown>): Record<string, unknown> {
      const section = String(overrides.section ?? "folders");
      const scope = overrides.scope === "item" ? "item" : "header";
      const itemId = typeof overrides.itemId === "string" ? overrides.itemId : "";
      const favorite = overrides.favorite as FavoriteEntry | undefined;
      const originId = scope === "header" ? `section:${section}`
        : section === "favorites" && favorite ? `favorite:${favorite.kind}:${favorite.ref}`
          : `${section.slice(0, -1)}:${itemId === "/" ? "" : itemId}`;
      const mouseEvent = overrides.mouseEvent ?? { clientX: 7, clientY: 8 };
      return {
        ...overrides,
        originId,
        trigger: { kind: "pointer", mouseEvent },
      };
    }

    function latestMenuTitles(): string[] {
      const menu = mockState.menuInstances[0];
      return menu.items
        .filter((item: any) => item.kind !== "separator")
        .map((item: any) => item.title);
    }

    it("shows the folders header menu at the mouse event without a danger row", () => {
      const { view } = createNavView();

      (view as any).openNavContextMenu(navPayload({ section: "folders", scope: "header" }));

      const menu = mockState.menuInstances[0];
      expect(menu.showAtMouseEvent).toHaveBeenCalledTimes(1);
      expect(menu.dom.classList.add).toHaveBeenCalledWith("fce-card-context-menu");
      expect(getDangerMenuTitles(menu)).toEqual([]);
    });

    it("supports positioned triggers and returns focus when the menu hides", () => {
      const { view } = createNavView();
      const restoreFocus = vi.spyOn((view as any).modules.navLayout, "restoreFocus");
      (view as any).openNavContextMenu({
        section: "folders",
        scope: "header",
        originId: "section:folders",
        trigger: { kind: "position", position: { x: 12, y: 18 } },
      });

      const menu = mockState.menuInstances[0];
      expect(menu.showAtPosition).toHaveBeenCalledWith({ x: 12, y: 18 });
      expect(menu.showAtMouseEvent).not.toHaveBeenCalled();
      menu.hideHandler?.();
      expect(restoreFocus).toHaveBeenCalledWith("section:folders");
    });

    it("builds identical capabilities for pointer and positioned triggers", () => {
      const { view } = createNavView();
      (view as any).openNavContextMenu(navPayload({ section: "folders", scope: "header" }));
      (view as any).openNavContextMenu({
        section: "folders", scope: "header", originId: "section:folders",
        trigger: { kind: "position", position: { x: 4, y: 6 } },
      });
      expect(mockState.menuInstances).toHaveLength(2);
      const titles = (menu: any) => menu.items.map((item: any) => `${item.kind}:${item.title}`);
      expect(titles(mockState.menuInstances[1])).toEqual(titles(mockState.menuInstances[0]));
    });

    it("re-resolves and rejects a stale folder row before constructing a menu", () => {
      const { view } = createNavView();

      (view as any).openNavContextMenu(
        navPayload({ section: "folders", scope: "item", itemId: "notes" }),
      );

      expect(mockState.menuInstances).toHaveLength(0);
    });

    it("shows the favorites row menu for a file favorite", () => {
      const { view } = createNavView({ favorites: [{ kind: "file", ref: "notes/nav-menu.md" }] });

      (view as any).openNavContextMenu(
        navPayload({
          section: "favorites",
          scope: "item",
          favorite: { kind: "file", ref: "notes/nav-menu.md" },
        }),
      );

      const titles = latestMenuTitles();
      expect(titles.slice(0, 3)).toEqual(["Remove from favorites", "Move up", "Move down"]);
      expect(titles).toContain("Open in new tab");
      expect(mockState.menuInstances[0].showAtMouseEvent).toHaveBeenCalledTimes(1);
    });

    it("skips the menu entirely for a tag row in box mode", () => {
      const { view } = createNavView({
        activeBoxId: "box-1",
        boxes: [
          {
            id: "box-1",
            name: "Reading",
            rules: [],
            manualPaths: [],
            excludedPaths: [],
            pinnedPaths: [],
            sort: { field: "mtime", direction: "desc" },
          },
        ],
      });

      (view as any).openNavContextMenu(
        navPayload({ section: "tags", scope: "item", itemId: "work" }),
      );

      expect(mockState.menuInstances).toHaveLength(0);
    });

    // Cross-module: panel favorite-activate event -> FolderCardView.selectFolderFromNav.
    // Call entry is not FavoriteActions (that module owns tag-favorite activation).
    it("routes the panel favorite-activate callback into the folder scope", async () => {
      const { view } = createNavView();
      await (view as any).onOpen();

      const selectFolderFromNav = vi
        .spyOn(view as any, "selectFolderFromNav")
        .mockResolvedValue(undefined);

      mockState.panelEventHandlers["favorite-activate"]({
        detail: { favorite: { kind: "folder", ref: "notes" } },
      });

      expect(selectFolderFromNav).toHaveBeenCalledWith("notes");
    });
});
