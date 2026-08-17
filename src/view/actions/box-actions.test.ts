import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clickLatestModalButton,
  createDeferred,
  mockState,
  resetFolderCardViewHarness,
  createViewWithFile,
  findMenuItemByTitle,
  flushAsyncWork,
  registerFolderCardView,
  setLatestModalTextInput,
} from "../../__mocks__/folder-card-view-harness";
import { getUiStrings } from "../../i18n";
import { createBoxScope, createFolderScope } from "../scope";
import { BoxActions } from "./box-actions";
import { FolderCardView } from "../FolderCardView";

registerFolderCardView(FolderCardView);

describe("BoxActions", () => {
  beforeEach(() => {
    resetFolderCardViewHarness();
  });

  const box = {
    id: "box-1",
    name: "One",
    rules: [],
    manualPaths: [],
    excludedPaths: [],
    pinnedPaths: [],
    sort: { field: "mtime" as const, direction: "desc" as const },
  };

  function createSettings(overrides: Record<string, unknown> = {}) {
    return {
      activeBoxId: null,
      boxes: [box],
      favorites: [],
      filter: { tags: ["project"] },
      includeSubfolders: true,
      lastFolderPath: "notes",
      ...overrides,
    };
  }

  function createModalActions(options: {
    scope?: ReturnType<typeof createFolderScope> | ReturnType<typeof createBoxScope>;
    settings?: ReturnType<typeof createSettings>;
    saveSettings?: ReturnType<typeof vi.fn>;
    moveScopeToFolder?: ReturnType<typeof vi.fn>;
  } = {}): BoxActions {
    const scope = options.scope ?? createFolderScope("notes", false);
    return new BoxActions({
      context: {
        getApp: () => ({}),
        store: {
          getScope: () => scope,
          getBaseCards: () => [],
        },
        getSettings: () => options.settings ?? createSettings(),
        getUiStrings: () => getUiStrings("en"),
        saveSettings: options.saveSettings ?? vi.fn(async () => undefined),
      },
      createProgrammaticSelectionRequest: vi.fn((nextScope) => ({ scope: nextScope })),
      handleScopeSelection: vi.fn(async () => ({ action: "started" })),
      moveScopeToFolder:
        options.moveScopeToFolder ?? vi.fn(async () => ({ action: "started" })),
      returnToCardsViewIfSinglePane: vi.fn(),
    } as never);
  }

  it("derives active-box list semantics from runtime scope, not persisted activeBoxId", () => {
    let scope = createFolderScope("notes", true);
    const activeBoxEntry = { id: "box-1", name: "One" };
    const actions = new BoxActions({
      context: {
        store: { getScope: () => scope },
        getSettings: () => ({ activeBoxId: "stale", boxes: [activeBoxEntry] }),
      },
    } as never);

    expect(actions.isBoxMode()).toBe(false);
    expect(actions.getActiveBox()).toBeNull();

    scope = createBoxScope("box-1");
    expect(actions.isBoxMode()).toBe(true);
    expect(actions.getActiveBox()).toBe(activeBoxEntry);
  });

  it("does not return to cards or persist when entering a rejected box scope", async () => {
    const returnToCards = vi.fn();
    const saveSettings = vi.fn();
    const actions = new BoxActions({
      context: { saveSettings },
      createProgrammaticSelectionRequest: vi.fn(() => ({ scope: createBoxScope("missing") })),
      handleScopeSelection: vi.fn(async () => ({ action: "rejected_invalid" })),
      returnToCardsViewIfSinglePane: returnToCards,
    } as never);

    await actions.enterBoxScope("missing");

    expect(returnToCards).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("returns to cards once after entering an accepted box scope without direct persistence", async () => {
    const returnToCards = vi.fn();
    const saveSettings = vi.fn();
    const actions = new BoxActions({
      context: { saveSettings },
      createProgrammaticSelectionRequest: vi.fn(() => ({ scope: createBoxScope("box-1") })),
      handleScopeSelection: vi.fn(async () => ({ action: "started" })),
      returnToCardsViewIfSinglePane: returnToCards,
    } as never);

    await actions.enterBoxScope("box-1");

    expect(returnToCards).toHaveBeenCalledTimes(1);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("does not return to cards or persist when exiting to a rejected folder scope", async () => {
    const returnToCards = vi.fn();
    const saveSettings = vi.fn();
    const actions = new BoxActions({
      context: {
        getSettings: () => ({ lastFolderPath: "missing" }),
        saveSettings,
      },
      moveScopeToFolder: vi.fn(async () => ({ action: "rejected_invalid" })),
      returnToCardsViewIfSinglePane: returnToCards,
    } as never);

    await actions.exitBoxScope();

    expect(returnToCards).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("returns to cards once after exiting to an accepted folder scope without direct persistence", async () => {
    const returnToCards = vi.fn();
    const saveSettings = vi.fn();
    const actions = new BoxActions({
      context: {
        getSettings: () => ({ lastFolderPath: "notes" }),
        saveSettings,
      },
      moveScopeToFolder: vi.fn(async () => ({ action: "started" })),
      returnToCardsViewIfSinglePane: returnToCards,
    } as never);

    await actions.exitBoxScope();

    expect(returnToCards).toHaveBeenCalledTimes(1);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("persists a newly created box before entering it without writing activeBoxId directly", async () => {
    const persistence = createDeferred<void>();
    const order: string[] = [];
    const saveSettings = vi.fn(async (_patch: Record<string, any>) => {
      order.push("persist");
      await persistence.promise;
    });
    const actions = createModalActions({
      settings: createSettings({ boxes: [] }),
      saveSettings,
    });
    const enterBoxScope = vi
      .spyOn(actions, "enterBoxScope")
      .mockImplementation(async (boxId) => {
        order.push(`enter:${boxId}`);
      });

    actions.openCreateBoxModal();
    setLatestModalTextInput(0, "Created");
    clickLatestModalButton("Create");
    await flushAsyncWork();

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(enterBoxScope).not.toHaveBeenCalled();

    persistence.resolve();
    await flushAsyncWork();

    const patch = saveSettings.mock.calls[0]?.[0];
    const createdId = patch.boxes[0].id;
    expect(order).toEqual(["persist", `enter:${createdId}`]);
    expect(patch).not.toHaveProperty("activeBoxId");
    expect(mockState.modalInstances.at(-1)?.contentEl.isConnected).toBe(false);
  });

  it("does not enter or close the create modal when box persistence rejects", async () => {
    const persistenceError = new Error("box persistence failed");
    const saveSettings = vi.fn(async (_patch: Record<string, any>) => {
      throw persistenceError;
    });
    const actions = createModalActions({
      settings: createSettings({ boxes: [] }),
      saveSettings,
    });
    const enterBoxScope = vi.spyOn(actions, "enterBoxScope");

    actions.openCreateBoxModal();
    setLatestModalTextInput(0, "Unpersisted");
    const modal = mockState.modalInstances.at(-1) as unknown as {
      contentEl: { isConnected: boolean };
      submit: () => Promise<void>;
    };

    await expect(modal.submit()).rejects.toBe(persistenceError);

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(enterBoxScope).not.toHaveBeenCalled();
    expect(modal.contentEl.isConnected).toBe(true);
  });

  it("saves a rule from one committed folder-scope snapshot, then enters the persisted box", async () => {
    const order: string[] = [];
    const saveSettings = vi.fn(async (_patch: Record<string, any>) => {
      order.push("persist");
    });
    const actions = createModalActions({
      scope: createFolderScope("screened", false),
      settings: createSettings({ boxes: [], includeSubfolders: true }),
      saveSettings,
    });
    vi.spyOn(actions, "enterBoxScope").mockImplementation(async (boxId) => {
      order.push(`enter:${boxId}`);
    });

    actions.openSaveScopeAsBoxModal();
    clickLatestModalButton("Create");
    await flushAsyncWork();

    const patch = saveSettings.mock.calls[0]?.[0];
    const created = patch.boxes[0];
    expect(created.rules).toEqual([
      { folder: "screened", includeSubfolders: false, tags: ["project"] },
    ]);
    expect(order).toEqual(["persist", `enter:${created.id}`]);
    expect(patch).not.toHaveProperty("activeBoxId");
  });

  it("moves away from the runtime-active box before deleting despite stale activeBoxId", async () => {
    const order: string[] = [];
    const moveScopeToFolder = vi.fn(async () => {
      order.push("move");
      return { action: "started" as const };
    });
    const saveSettings = vi.fn(async (_patch: Record<string, any>) => {
      order.push("persist");
    });
    const actions = createModalActions({
      scope: createBoxScope(box.id),
      settings: createSettings({ activeBoxId: "stale-other-box" }),
      moveScopeToFolder,
      saveSettings,
    });

    actions.handleBoxCommand({ command: "delete", boxId: box.id });
    clickLatestModalButton("Delete");
    await flushAsyncWork();

    expect(moveScopeToFolder).toHaveBeenCalledWith("notes");
    expect(order).toEqual(["move", "persist"]);
    expect(saveSettings.mock.calls[0]?.[0]).toEqual({ boxes: [], favorites: [] });
    expect(mockState.modalInstances.at(-1)?.contentEl.isConnected).toBe(false);
  });

  it("keeps the active box and confirmation open when the folder migration is rejected", async () => {
    const saveSettings = vi.fn(async (_patch: Record<string, any>) => undefined);
    const actions = createModalActions({
      scope: createBoxScope(box.id),
      saveSettings,
      moveScopeToFolder: vi.fn(async () => ({ action: "rejected_invalid" })),
    });

    actions.handleBoxCommand({ command: "delete", boxId: box.id });
    clickLatestModalButton("Delete");
    await flushAsyncWork();

    expect(saveSettings).not.toHaveBeenCalled();
    expect(mockState.modalInstances.at(-1)?.contentEl.isConnected).toBe(true);
  });

  it("deletes a non-active box without moving scope even when activeBoxId is stale", async () => {
    const moveScopeToFolder = vi.fn(async () => ({ action: "started" }));
    const saveSettings = vi.fn(async (_patch: Record<string, any>) => undefined);
    const actions = createModalActions({
      scope: createFolderScope("notes", false),
      settings: createSettings({ activeBoxId: box.id }),
      moveScopeToFolder,
      saveSettings,
    });

    actions.handleBoxCommand({ command: "delete", boxId: box.id });
    clickLatestModalButton("Delete");
    await flushAsyncWork();

    expect(moveScopeToFolder).not.toHaveBeenCalled();
    expect(saveSettings.mock.calls[0]?.[0]).toEqual({ boxes: [], favorites: [] });
  });
});

describe("card box context menus", () => {
  beforeEach(() => {
    resetFolderCardViewHarness();
  });

    const BOX_ID = "box-1";

    function createViewWithBox(activeBoxId: string | null = null): {
      view: FolderCardView;
      plugin: any;
    } {
      const { view, plugin } = createViewWithFile("notes/box-menu.md");
      plugin.getSettings = vi.fn(() => ({
        includeSubfolders: true,
        sort: { field: "mtime", direction: "desc" },
        filter: { tags: [] },
        defaultView: "cards",
        lastFolderPath: "notes",
        pinnedPaths: [],
        previewLines: 5,
        activeBoxId,
        boxes: [
          {
            id: BOX_ID,
            name: "Reading",
            rules: [],
            manualPaths: [],
            excludedPaths: [],
            pinnedPaths: [],
            sort: { field: "mtime", direction: "desc" },
          },
        ],
      }));
      if (activeBoxId !== null) {
        (view as any).cardScope = createBoxScope(activeBoxId);
      }
      return { view, plugin };
    }

    function getMenuTitles(): string[] {
      const menu = mockState.menuInstances[0];
      return menu.items
        .filter((item: any) => item.kind !== "separator")
        .map((item: any) => item.title);
    }

    function createNavPayload(overrides: Record<string, unknown>): Record<string, unknown> {
      return {
        bridge: {
          hasExpandedFolders: false,
          hasExpandedTags: false,
          toggleAllFolders: vi.fn(),
          toggleAllTags: vi.fn(),
          tagHasChildren: false,
          tagExpanded: false,
          toggleTagExpansion: vi.fn(),
        },
        mouseEvent: { clientX: 1, clientY: 2 },
        ...overrides,
      };
    }

    it("box row context menu offers open, configure, add-current-view, rename, duplicate, and delete", () => {
      const { view } = createViewWithBox();
      const mouseEvent = { clientX: 5, clientY: 6 };

      (view as any).openNavContextMenu(
        createNavPayload({ section: "boxes", scope: "item", itemId: BOX_ID, mouseEvent }),
      );

      expect(mockState.menuInstances).toHaveLength(1);
      expect(getMenuTitles()).toEqual([
        "Open card box",
        "Configure card box…",
        "Add current view to this card box",
        "Add to favorites",
        "Make a copy",
        "Rename…",
        "Delete",
      ]);

      const menu = mockState.menuInstances[0];
      expect(menu.showAtMouseEvent).toHaveBeenCalledTimes(1);
      expect(menu.showAtMouseEvent).toHaveBeenCalledWith(mouseEvent);
      expect(menu.dom.classList.add).toHaveBeenCalledWith("fce-card-context-menu");
    });

    it("box section context menu offers creation entries and hides save-current-view inside a box", () => {
      const { view } = createViewWithBox();

      (view as any).openNavContextMenu(createNavPayload({ section: "boxes", scope: "header" }));
      expect(getMenuTitles()).toEqual([
        "New card box…",
        "Save current view as card box…",
        "Add current view to card box",
        "Collapse section",
      ]);

      mockState.menuInstances.length = 0;

      const { view: boxModeView } = createViewWithBox(BOX_ID);
      (boxModeView as any).openNavContextMenu(createNavPayload({ section: "boxes", scope: "header" }));
      expect(getMenuTitles()).toEqual(["New card box…", "Collapse section"]);

      mockState.menuInstances.length = 0;

      (boxModeView as any).openNavContextMenu(
        createNavPayload({ section: "boxes", scope: "item", itemId: BOX_ID }),
      );
      expect(getMenuTitles()).not.toContain("Add current view to this card box");
    });

    it("add-current-view submenu targets every card box and routes to the scope rule", () => {
      const { view } = createViewWithBox();
      const addScopeToBox = vi.spyOn((view as any).modules.boxActions, "addScopeToBox").mockImplementation(() => undefined);

      (view as any).openNavContextMenu(createNavPayload({ section: "boxes", scope: "header" }));

      const item = findMenuItemByTitle(mockState.menuInstances[0], "Add current view to card box");
      expect(item.icon).toBe("package-check");
      expect(item.submenu?.items.map((entry: any) => entry.title)).toEqual(["Reading"]);

      (item.submenu!.items[0] as any).clickHandler();

      expect(addScopeToBox).toHaveBeenCalledTimes(1);
      expect(addScopeToBox).toHaveBeenCalledWith(BOX_ID);
    });

    it("add-to-box submenu lists every card box with a box icon", () => {
      const { view } = createViewWithBox();
      const addPathsToBox = vi
        .spyOn((view as any).modules.boxActions, "addPathsToBox")
        .mockImplementation(async () => undefined);

      (view as any).modules.cardMenu.open({
        notePath: "notes/box-menu.md",
        trigger: "contextmenu",
        mouseEvent: { clientX: 3, clientY: 4 },
      });

      const item = findMenuItemByTitle(mockState.menuInstances[0], "Add to card box");
      const submenuItems = (item.submenu?.items ?? []).filter(
        (entry: any) => entry.kind !== "separator",
      );
      expect(submenuItems.map((entry: any) => ({ title: entry.title, icon: entry.icon }))).toEqual([
        { title: "Reading", icon: "box" },
        { title: "New card box…", icon: "plus" },
      ]);

      (submenuItems[0] as any).clickHandler();

      expect(addPathsToBox).toHaveBeenCalledWith(BOX_ID, ["notes/box-menu.md"]);
    });

    it("hides the add-current-view entry when no card box exists", () => {
      const { view, plugin } = createViewWithBox();
      const settings = plugin.getSettings();
      plugin.getSettings = vi.fn(() => ({ ...settings, boxes: [] }));

      (view as any).openNavContextMenu(createNavPayload({ section: "boxes", scope: "header" }));

      expect(getMenuTitles()).toEqual([
        "New card box…",
        "Save current view as card box…",
        "Collapse section",
      ]);
    });

    it("opens a flat box picker when a submenu is unavailable", () => {
      const { view } = createViewWithBox();
      const addScopeToBox = vi.spyOn((view as any).modules.boxActions, "addScopeToBox").mockImplementation(() => undefined);
      const mouseEvent = { clientX: 9, clientY: 11 };

      (view as any).modules.boxActions.openAddScopeToBoxPicker(mouseEvent);

      expect(mockState.menuInstances).toHaveLength(1);
      const menu = mockState.menuInstances[0];
      expect(menu.items.map((item: any) => item.title)).toEqual(["Reading"]);
      expect(menu.showAtMouseEvent).toHaveBeenCalledWith(mouseEvent);

      menu.items[0].clickHandler?.();
      expect(addScopeToBox).toHaveBeenCalledWith(BOX_ID);
    });

    it("skips the flat box picker inside a box, without boxes, or without a mouse event", () => {
      const { view: boxModeView } = createViewWithBox(BOX_ID);
      (boxModeView as any).modules.boxActions.openAddScopeToBoxPicker({ clientX: 1, clientY: 2 });

      const { view, plugin } = createViewWithBox();
      (view as any).modules.boxActions.openAddScopeToBoxPicker(null);

      const settings = plugin.getSettings();
      plugin.getSettings = vi.fn(() => ({ ...settings, boxes: [] }));
      (view as any).modules.boxActions.openAddScopeToBoxPicker({ clientX: 1, clientY: 2 });

      expect(mockState.menuInstances).toHaveLength(0);
    });

    it("nav context menu is ignored for an unknown box id or a non-mouse event", () => {
      const { view } = createViewWithBox();

      (view as any).openNavContextMenu(
        createNavPayload({
          section: "boxes",
          scope: "item",
          itemId: "missing",
          mouseEvent: { clientX: 5, clientY: 6 },
        }),
      );
      (view as any).openNavContextMenu(
        createNavPayload({ section: "boxes", scope: "item", itemId: BOX_ID, mouseEvent: null }),
      );

      for (const menu of mockState.menuInstances) {
        expect(menu.showAtMouseEvent).not.toHaveBeenCalled();
        expect(menu.items).toEqual([]);
        expect(menu.dom.classList.add).not.toHaveBeenCalled();
      }
    });

    it("routes the panel nav-context-menu callback into openNavContextMenu", async () => {
      const { view } = createViewWithBox();
      await (view as any).onOpen();

      const openNavContextMenu = vi
        .spyOn(view as any, "openNavContextMenu")
        .mockImplementation(() => undefined);

      const payload = createNavPayload({
        section: "boxes",
        scope: "item",
        itemId: BOX_ID,
        mouseEvent: { clientX: 3, clientY: 4 },
      });
      mockState.panelEventHandlers["nav-context-menu"]({ detail: payload });

      expect(openNavContextMenu).toHaveBeenCalledTimes(1);
      expect(openNavContextMenu).toHaveBeenCalledWith(payload);
    });
});
