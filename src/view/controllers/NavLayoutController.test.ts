import { TFile, TFolder } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

const obsidianTypes = vi.hoisted(() => {
  class MockTFile {
    path = "";
    name = "";
    extension = "";
  }
  class MockTFolder {
    path = "";
    name = "";
    children: Array<MockTFile | MockTFolder> = [];
  }
  return { MockTFile, MockTFolder };
});

vi.mock("obsidian", () => ({
  TFile: obsidianTypes.MockTFile,
  TFolder: obsidianTypes.MockTFolder,
}));

import { defaultNavSectionOrder } from "../../navigation-section-order";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../settings";
import { createFolderScope } from "../scope";
import { navigationFolderId } from "../navigation-model";
import type { NavigationProjectionInput } from "../navigation-model";
import type { NavSectionId } from "../types";
import type { ViewContext } from "../view-context";
import { createViewEpochs } from "../view-epochs";
import { createViewStateStore } from "../view-state-store";
import { NavLayoutController } from "./NavLayoutController";

function folder(path: string, children: Array<TFile | TFolder> = []): TFolder {
  const value = new TFolder();
  value.path = path;
  value.name = path.slice(path.lastIndexOf("/") + 1);
  value.children = children;
  return value;
}

function file(path: string): TFile {
  const value = new TFile();
  value.path = path;
  value.name = path.slice(path.lastIndexOf("/") + 1);
  value.extension = path.slice(path.lastIndexOf(".") + 1);
  return value;
}

function createHarness(root = folder("")) {
  const settings = normalizeSettings(DEFAULT_SETTINGS);
  const publishGroups = vi.fn();
  const saveSettings = vi.fn(async (patch: Partial<typeof settings>) => {
    Object.assign(settings, patch);
  });
  const context = {
    getApp: () => ({ vault: { getRoot: () => root } }),
    store: createViewStateStore(createFolderScope("", true)),
    epochs: createViewEpochs(),
    getSettings: () => settings,
    saveSettings,
    getUiStrings: vi.fn(),
    publishGroups,
    requestUpdate: vi.fn(),
    notify: vi.fn(),
    getViewWindow: () => globalThis,
  } as unknown as ViewContext;
  const onNavCountsInvalidated = vi.fn();
  const controller = new NavLayoutController({
    context,
    onNavCountsInvalidated,
    getTooltipSide: () => "right",
  });
  return { context, controller, onNavCountsInvalidated, publishGroups, saveSettings, settings };
}

function projectionInput(scope = createFolderScope("a/b", true)): Omit<NavigationProjectionInput, "query" | "expansion"> {
  return {
    scope,
    activeTags: [],
    selectedPath: null,
    favorites: [],
    folders: [{
      name: "a", path: "a", depth: 0, directCount: 0, recursiveCount: 0,
      recursiveFolderCount: 1,
      children: [{
        name: "b", path: "a/b", depth: 1, directCount: 0, recursiveCount: 0,
        recursiveFolderCount: 1,
        children: [{ name: "c", path: "a/b/c", depth: 2, directCount: 0, recursiveCount: 0, recursiveFolderCount: 0, children: [] }],
      }],
    }],
    tags: [],
    boxes: [],
    tagCounts: {},
    includeSubfolders: true,
    tagsDisabled: false,
    sectionCollapsed: { favorites: false, folders: false, tags: false, boxes: false },
    sectionOrder: defaultNavSectionOrder(),
    sectionLabels: {
      favorites: { label: "Favorites", emptyLabel: null },
      folders: { label: "Folders", emptyLabel: null },
      tags: { label: "Tags", emptyLabel: null },
      boxes: { label: "Boxes", emptyLabel: null },
    },
    rootFolderLabel: "Root /",
  };
}

describe("NavLayoutController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives the folder tree and exposes identical counts for favorites", () => {
    const nested = folder("alpha/nested", [file("alpha/nested/three.canvas")]);
    const alpha = folder("alpha", [file("alpha/one.md"), file("alpha/two.txt"), nested]);
    const { controller, publishGroups } = createHarness(folder("", [file("root.base"), alpha]));

    controller.refreshFolderTreeState();

    expect(controller.getFolderTree()).toEqual([
      expect.objectContaining({ path: "/", directCount: 1, recursiveCount: 3, recursiveFolderCount: 2 }),
      expect.objectContaining({ path: "alpha", directCount: 1, recursiveCount: 2, recursiveFolderCount: 1 }),
    ]);
    expect(controller.getFolderTreeCount("alpha/nested")).toEqual({ direct: 1, recursive: 1 });
    expect(publishGroups).toHaveBeenCalledWith("nav");
  });

  it("preserves dual/single pane layout and delegates persistent toggles", async () => {
    const { controller, publishGroups, saveSettings, settings } = createHarness();

    expect(controller.getLayoutMode()).toBe("dual");
    controller.onShellResize(settings.navPaneWidth + 303);
    expect(controller.getLayoutMode()).toBe("single");
    expect(controller.getNavVisible()).toBe(false);

    await controller.onToggleNavPane();
    expect(controller.getNavVisible()).toBe(true);
    controller.returnToCardsViewIfSinglePane();
    expect(controller.getNavVisible()).toBe(false);

    controller.onShellResize(settings.navPaneWidth + 304);
    await controller.onToggleNavPane();
    expect(saveSettings).toHaveBeenCalledWith({ navPaneCollapsed: true });
    expect(publishGroups).toHaveBeenCalledWith("nav");
    expect(controller.getTooltipSide()).toBe("right");
  });

  it("debounces tree and count refreshes at exactly 250ms", () => {
    vi.useFakeTimers();
    const { context, controller, onNavCountsInvalidated, publishGroups } = createHarness();
    const initialNavEpoch = context.epochs.navCount.value;

    controller.scheduleFolderTreeRefresh();
    controller.scheduleNavCountRefresh();
    vi.advanceTimersByTime(249);
    expect(publishGroups).not.toHaveBeenCalled();
    expect(onNavCountsInvalidated).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(publishGroups).toHaveBeenCalledTimes(2);
    expect(onNavCountsInvalidated).toHaveBeenCalledTimes(1);
    expect(context.epochs.navCount.value).toBe(initialNavEpoch + 1);
  });

  it("refreshes nav state and reports disposal of either pending timer", () => {
    vi.useFakeTimers();
    const { context, controller, onNavCountsInvalidated, publishGroups } = createHarness();
    const initialNavEpoch = context.epochs.navCount.value;

    controller.refreshNavState();
    expect(onNavCountsInvalidated).toHaveBeenCalledTimes(1);
    expect(context.epochs.navCount.value).toBe(initialNavEpoch + 1);
    expect(publishGroups).toHaveBeenCalledWith("nav", "scope");

    controller.scheduleFolderTreeRefresh();
    controller.scheduleNavCountRefresh();
    expect(controller.dispose()).toEqual({ cancelledDebounce: true });
    vi.runAllTimers();
    expect(onNavCountsInvalidated).toHaveBeenCalledTimes(1);
  });

  it("seeds a one-shot reveal only for initial and distinct folder scopes", () => {
    const { controller } = createHarness();
    controller.syncScope(createFolderScope("a/b", true));
    const first = controller.getRevealRequest();
    expect(first).toEqual({ token: 1, rowId: navigationFolderId("a/b") });

    controller.syncScope(createFolderScope("a/b", false));
    expect(controller.getRevealRequest()).toBe(first);
    controller.syncScope(createFolderScope("a/c", true));
    expect(controller.getRevealRequest()).toEqual({ token: 2, rowId: navigationFolderId("a/c") });
  });

  it("keeps initial focus unresolved while a restored current folder becomes visible", () => {
    const { controller } = createHarness();
    const loading = projectionInput();
    loading.folders = [];
    controller.project(loading);
    expect(controller.getFocusId()).toBeNull();

    const restored = controller.project(projectionInput());
    expect(restored.rows.find((row) => row.id === "folder:a/b")?.semanticState).toBe("current-range");
    expect(controller.getFocusId()).toBeNull();

    controller.setFocus("folder:a/b");
    controller.project(projectionInput());
    expect(controller.getFocusId()).toBe("folder:a/b");
  });

  it("temporarily exposes a persisted-collapsed Folders section and lets collapse consume it", async () => {
    const { controller, saveSettings, settings } = createHarness();
    settings.sectionCollapsed.folders = true;
    const base = projectionInput();
    const input = { ...base, sectionCollapsed: { ...base.sectionCollapsed, folders: true } };
    let projection = controller.project(input);
    const section = projection.rows.find((row) => row.id === "section:folders");
    expect(section?.expanded).toBe(true);
    expect(projection.rows.some((row) => row.id === "folder:a/b")).toBe(true);
    if (!section) throw new Error("missing Folders section fixture");
    await controller.setExpanded(section, false);
    expect(saveSettings).not.toHaveBeenCalled();
    projection = controller.project(input);
    expect(projection.sections.find((item) => item.section === "folders")?.expanded).toBe(false);
  });

  it("keeps query and reveal runtime per-view and rejects callbacks after disposal", () => {
    const first = createHarness();
    const second = createHarness();
    first.controller.updateQuery("alpha");
    expect(first.controller.getQuery()).toBe("alpha");
    expect(second.controller.getQuery()).toBe("");

    first.controller.syncScope(createFolderScope("a", true));
    const request = first.controller.getRevealRequest();
    first.controller.dispose();
    first.controller.updateQuery("stale");
    if (request) first.controller.consumeReveal(request.token);
    expect(first.controller.getQuery()).toBe("");
    expect(first.controller.getRevealRequest()).toBeNull();
  });

  it("consumes reveal expansion on manual collapse and recovers focus after query loss", async () => {
    const { controller, saveSettings } = createHarness();
    let projection = controller.project(projectionInput());
    const ancestor = projection.rows.find((row) => row.id === "folder:a");
    expect(ancestor?.expanded).toBe(true);
    if (!ancestor) throw new Error("missing ancestor fixture");

    await controller.setExpanded(ancestor, false);
    expect(saveSettings).toHaveBeenCalledWith({ expandedFolderPaths: [] });
    projection = controller.project(projectionInput());
    expect(projection.rows.find((row) => row.id === "folder:a")?.expanded).toBe(false);

    const focusController = createHarness().controller;
    focusController.project(projectionInput());
    focusController.setFocus("folder:a");
    focusController.updateQuery("missing");
    projection = focusController.project(projectionInput());
    expect(projection.noResults).toBe(true);
    expect(focusController.getFocusId()).toBeNull();
    focusController.clearQuery();
    focusController.project(projectionInput());
    expect(focusController.getFocusId()).toBe("folder:a/b");
  });

  it("consumes descendant reveal overrides and does not reopen them after re-expanding the ancestor", async () => {
    const { controller } = createHarness();
    let projection = controller.project(projectionInput(createFolderScope("a/b/c", true)));
    const a = projection.rows.find((row) => row.id === "folder:a");
    if (!a) throw new Error("missing ancestor fixture");
    await controller.setExpanded(a, false);
    projection = controller.project(projectionInput(createFolderScope("a/b/c", true)));
    const collapsedA = projection.rows.find((row) => row.id === "folder:a");
    if (!collapsedA) throw new Error("missing collapsed ancestor fixture");
    await controller.setExpanded(collapsedA, true);
    projection = controller.project(projectionInput(createFolderScope("a/b/c", true)));
    expect(projection.rows.find((row) => row.id === "folder:a")?.expanded).toBe(true);
    expect(projection.rows.find((row) => row.id === "folder:a/b")?.expanded).toBe(false);
  });

  it("lets query-induced expansion override a prior reveal suppression", async () => {
    const { controller } = createHarness();
    let projection = controller.project(projectionInput(createFolderScope("a/b/c", true)));
    const ancestor = projection.rows.find((row) => row.id === "folder:a");
    if (!ancestor) throw new Error("missing ancestor fixture");
    await controller.setExpanded(ancestor, false);
    controller.updateQuery("c");
    projection = controller.project(projectionInput(createFolderScope("a/b/c", true)));
    expect(projection.rows.find((row) => row.id === "folder:a")?.expanded).toBe(true);
    expect(projection.rows.some((row) => row.id === "folder:a/b/c")).toBe(true);
  });

  it("snapshots section collapse into the query baseline instead of aliasing live settings", () => {
    const { controller, settings } = createHarness();
    settings.sectionCollapsed.folders = false;
    controller.updateQuery("a");
    const captured = controller.getQueryBaseline();

    // Mutating only the live record must not reach through into the captured
    // baseline; an alias here would make every later comparison report equality.
    settings.sectionCollapsed.folders = true;

    expect(captured?.sectionCollapsed.folders).toBe(false);
  });

  it("captures query baseline once, adopts legitimate shared changes, and clears only temporary state", async () => {
    const { controller, settings } = createHarness();
    settings.expandedFolderPaths = ["a"];
    settings.sectionCollapsed.folders = true;
    controller.updateQuery("a");
    const captured = controller.getQueryBaseline();
    controller.updateQuery("A");
    expect(controller.getQueryBaseline()).toBe(captured);

    settings.expandedFolderPaths = ["a", "shared"];
    settings.expandedTagPaths = ["work"];
    settings.sectionCollapsed.folders = false;
    let projection = controller.project(projectionInput());
    expect(controller.getQueryBaseline()).toEqual({
      expandedFolderPaths: ["a", "shared"],
      expandedTagPaths: ["work"],
      sectionCollapsed: { favorites: false, folders: false, tags: false, boxes: false },
    });
    const a = projection.rows.find((row) => row.id === "folder:a");
    if (!a) throw new Error("missing query row fixture");
    await controller.setExpanded(a, false);
    controller.clearQuery();
    projection = controller.project(projectionInput());
    expect(controller.getQueryBaseline()).toBeNull();
    expect(projection.rows.find((row) => row.id === "folder:a")?.expanded).toBe(true);
    expect(projection.sections.find((section) => section.section === "folders")?.expanded).toBe(true);
    expect(controller.getRevealRequest()?.rowId).toBe("folder:a/b");
  });

  it("rewrites focus, suppression baseline, and pending reveal without incrementing its token", () => {
    const { controller, settings } = createHarness();
    settings.expandedFolderPaths = ["old"];
    const oldInput = projectionInput(createFolderScope("old/child", true));
    oldInput.folders = [{
      name: "old", path: "old", depth: 0, directCount: 0, recursiveCount: 0,
      recursiveFolderCount: 1,
      children: [{ name: "child", path: "old/child", depth: 1, directCount: 0, recursiveCount: 0, recursiveFolderCount: 0, children: [] }],
    }];
    controller.updateQuery("old");
    const oldProjection = controller.project(oldInput);
    const oldRow = oldProjection.rows.find((row) => row.id === "folder:old");
    if (!oldRow) throw new Error("missing old folder fixture");
    void controller.setExpanded(oldRow, false);
    controller.setFocus("folder:old/child");
    const token = controller.getRevealRequest()?.token;
    controller.rewriteFolderIdentity((path) => path.replace(/^old(?=\/|$)/, "renamed"));
    expect(controller.getFocusId()).toBe("folder:renamed/child");
    expect(controller.getQueryBaseline()?.expandedFolderPaths).toEqual(["renamed"]);
    expect(controller.getRevealRequest()).toEqual({ token, rowId: "folder:renamed/child" });
    controller.updateQuery("renamed");
    const renamedInput = projectionInput(createFolderScope("renamed/child", true));
    renamedInput.folders = [{
      name: "renamed", path: "renamed", depth: 0, directCount: 0, recursiveCount: 0,
      recursiveFolderCount: 1,
      children: [{ name: "child", path: "renamed/child", depth: 1, directCount: 0, recursiveCount: 0, recursiveFolderCount: 0, children: [] }],
    }];
    const renamedProjection = controller.project(renamedInput);
    expect(controller.getRevealRequest()).toEqual({ token, rowId: "folder:renamed/child" });
    expect(renamedProjection.rows.find((row) => row.id === "folder:renamed")?.expanded).toBe(false);
  });

  it("returns menu focus through deterministic fallback when the origin vanished", () => {
    const { controller } = createHarness();
    controller.project(projectionInput());
    controller.restoreFocus("folder:deleted");
    expect(controller.getFocusId()).toBe("folder:a/b");
    expect(controller.getFocusRequest()).toEqual({ token: 1, rowId: "folder:a/b" });
    controller.consumeFocusReturn(0);
    expect(controller.getFocusRequest()).not.toBeNull();
    controller.consumeFocusReturn(1);
    expect(controller.getFocusRequest()).toBeNull();
  });

  it("persists a swapped navSectionOrder through saveSettings", async () => {
    const { controller, saveSettings } = createHarness();

    await controller.onMoveNavSection("folders", -1);

    expect(saveSettings).toHaveBeenCalledWith({
      navSectionOrder: ["folders", "favorites", "tags", "boxes"],
    });
  });

  it("is a silent no-op for an impossible delta or unknown section", async () => {
    const { controller, saveSettings } = createHarness();

    await controller.onMoveNavSection("favorites", -1);
    await controller.onMoveNavSection("boxes", 1);
    await controller.onMoveNavSection("mystery" as NavSectionId, 1);

    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("normalizes a malformed stored order before swapping", async () => {
    const { controller, saveSettings, settings } = createHarness();
    settings.navSectionOrder = ["tags", "nope", "boxes"] as unknown as NavSectionId[];

    await controller.onMoveNavSection("boxes", 1);

    expect(saveSettings).toHaveBeenCalledWith({
      navSectionOrder: ["tags", "favorites", "boxes", "folders"],
    });
  });
});
