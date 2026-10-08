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
import { resolveFolderSortMode } from "../../folder-sibling-orders";
import type { PropertyFacet } from "../property-facets";
import { createFolderScope, createLinksScope } from "../scope";
import { navigationFolderId, navigationPropertyId, navigationPropertyValueId } from "../navigation-model";
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
    tagsDisabled: false, propertiesDisabled: false,
    sectionCollapsed: { favorites: false, folders: false, tags: false, properties: false, boxes: false, links: false },
    sectionOrder: defaultNavSectionOrder(),
    sectionLabels: {
      favorites: { label: "Favorites", emptyLabel: null },
      folders: { label: "Folders", emptyLabel: null },
      tags: { label: "Tags", emptyLabel: null },
      properties: { label: "Properties", emptyLabel: null },
      boxes: { label: "Boxes", emptyLabel: null },
      links: { label: "Links", emptyLabel: null },
    },
    rootFolderLabel: "Root /",
    linksLeafLabels: { backlinks: "Backlinks", outgoing: "Outgoing links" },
    linksDisabled: true,
  };
}

const statusFacet: PropertyFacet = {
  key: "status",
  label: "Status",
  valuedCount: 3,
  missingCount: 1,
  values: [
    { ref: { kind: "text", value: "open" }, label: "open", count: 2 },
    { ref: { kind: "text", value: "closed" }, label: "closed", count: 1 },
    { ref: { kind: "missing" }, label: "Unassigned", count: 1 },
  ],
};

const priorityFacet: PropertyFacet = {
  key: "priority",
  label: "Priority",
  valuedCount: 2,
  missingCount: 2,
  values: [{ ref: { kind: "number", value: 1 }, label: "1", count: 1 }],
};

function propertyInput(properties: PropertyFacet[]): Omit<NavigationProjectionInput, "query" | "expansion"> {
  return { ...projectionInput(), properties };
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
    controller.onShellResize(settings.navPaneWidth + 159);
    expect(controller.getLayoutMode()).toBe("single");
    expect(controller.getNavVisible()).toBe(false);

    await controller.onToggleNavPane();
    expect(controller.getNavVisible()).toBe(true);
    controller.returnToCardsViewIfSinglePane();
    expect(controller.getNavVisible()).toBe(false);

    controller.onShellResize(settings.navPaneWidth + 160);
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

  it("does not force-reveal the Folders section for a links scope", () => {
    const { controller, settings } = createHarness();
    settings.sectionCollapsed.folders = true;
    const base = projectionInput(createLinksScope("notes/A.md", "backlinks"));
    const input = { ...base, sectionCollapsed: { ...base.sectionCollapsed, folders: true } };
    const projection = controller.project(input);
    expect(projection.sections.find((item) => item.section === "folders")?.expanded).toBe(false);
    expect(controller.getRevealRequest()).toBeNull();
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

  it("publishes a reveal-only collapse and recovers focus after query loss", async () => {
    const { controller, publishGroups, saveSettings } = createHarness();
    let projection = controller.project(projectionInput());
    const ancestor = projection.rows.find((row) => row.id === "folder:a");
    expect(ancestor?.expanded).toBe(true);
    if (!ancestor) throw new Error("missing ancestor fixture");

    publishGroups.mockClear();
    await controller.setExpanded(ancestor, false);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(publishGroups).toHaveBeenCalledOnce();
    expect(publishGroups).toHaveBeenCalledWith("nav");
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
      sectionCollapsed: { favorites: false, folders: false, tags: false, properties: false, boxes: false, links: false },
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

  it("cannot reveal hidden current folders through a scope switch, query or temporary expansion", () => {
    const h = createHarness();
    const input = { ...projectionInput(), hiddenFolderPaths: ["a"], hiddenTagPaths: [] };
    h.settings.hiddenFolderPaths = ["a"];
    h.controller.expandFolderForDrag("a");
    let projected = h.controller.project(input);
    expect(projected.rows.some((row) => row.kind === "folder")).toBe(false);
    h.controller.updateQuery("b");
    projected = h.controller.project(input);
    expect(projected.rows.some((row) => row.kind === "folder")).toBe(false);
    h.controller.clearQuery();
    projected = h.controller.project({ ...input, hiddenNavSections: [...defaultNavSectionOrder()] });
    h.controller.restoreFocus("folder:a/b");
    expect(projected.rows).toEqual([]);
    expect(h.controller.getFocusRequest()?.rowId).toBe("navigation-filter");
    h.controller.dispose();
  });

  it("preserves hidden branch expansion when expanding or collapsing all visible folders", async () => {
    const h = createHarness();
    h.settings.expandedFolderPaths = ["a", "a/b"];
    const original = projectionInput();
    const input = { ...original, hiddenFolderPaths: ["a"], folders: [...original.folders,
      { name: "z", path: "z", depth: 0, directCount: 0, recursiveCount: 0, recursiveFolderCount: 1,
        children: [{ name: "child", path: "z/child", depth: 1, directCount: 0, recursiveCount: 0, recursiveFolderCount: 0, children: [] }] }] };
    h.controller.project(input);
    await h.controller.toggleAll("folder");
    expect(h.settings.expandedFolderPaths).toEqual(["a", "a/b", "z"]);
    h.controller.project(input);
    await h.controller.toggleAll("folder");
    expect(h.settings.expandedFolderPaths).toEqual(["a", "a/b"]);
    h.controller.dispose();
  });

  it("moves only between section headers visible under the navigation query", async () => {
    const h = createHarness();
    h.controller.updateQuery("a");
    const projected = h.controller.project(projectionInput());
    expect(projected.sections.map((section) => section.section)).toEqual(["folders", "links"]);
    await h.controller.onMoveNavSection("folders", 1);
    expect(h.settings.navSectionOrder).toEqual(["favorites", "links", "tags", "properties", "boxes", "folders"]);
    h.controller.dispose();
  });

  it("persists a swapped navSectionOrder through saveSettings", async () => {
    const { controller, saveSettings } = createHarness();

    await controller.onMoveNavSection("folders", -1);

    expect(saveSettings).toHaveBeenCalledWith({
      navSectionOrder: ["folders", "favorites", "tags", "properties", "boxes", "links"],
    });
  });

  it("is a silent no-op for an impossible delta or unknown section", async () => {
    const { controller, saveSettings } = createHarness();

    await controller.onMoveNavSection("favorites", -1);
    await controller.onMoveNavSection("links", 1);
    await controller.onMoveNavSection("mystery" as NavSectionId, 1);

    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("normalizes a malformed stored order before swapping", async () => {
    const { controller, saveSettings, settings } = createHarness();
    settings.navSectionOrder = ["tags", "nope", "boxes"] as unknown as NavSectionId[];

    await controller.onMoveNavSection("boxes", 1);

    expect(saveSettings).toHaveBeenCalledWith({
      navSectionOrder: ["tags", "properties", "favorites", "boxes", "folders", "links"],
    });
  });

  it("persists blank-query property-key expansion through saveSettings", async () => {
    const { controller, saveSettings } = createHarness();
    let projection = controller.project(propertyInput([statusFacet]));
    const key = projection.rows.find((row) => row.id === navigationPropertyId("status"));
    expect(key?.expanded).toBe(false);
    if (!key) throw new Error("missing property key fixture");

    await controller.setExpanded(key, true);
    expect(saveSettings).toHaveBeenCalledWith({ expandedPropertyKeys: ["status"] });
  });

  it("expands complete folder, Tag, and property branches with one save per command", async () => {
    const { controller, saveSettings } = createHarness();
    const input = projectionInput(createFolderScope("", true));
    input.tags = [{
      tag: "work", displayTag: "work", label: "work", depth: 0, synthetic: false,
      children: [{
        tag: "work/ai", displayTag: "work/ai", label: "ai", depth: 1, synthetic: false,
        children: [{ tag: "work/ai/ml", displayTag: "work/ai/ml", label: "ml", depth: 2, synthetic: false, children: [] }],
      }],
    }];
    input.properties = [statusFacet, priorityFacet];
    controller.project(input);

    await controller.toggleAll("folder");
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings).toHaveBeenLastCalledWith({ expandedFolderPaths: ["a", "a/b"] });

    controller.project(input);
    await controller.toggleAll("tag");
    expect(saveSettings).toHaveBeenCalledTimes(2);
    expect(saveSettings).toHaveBeenLastCalledWith({ expandedTagPaths: ["work", "work/ai"] });

    controller.project(input);
    await controller.toggleAll("property");
    expect(saveSettings).toHaveBeenCalledTimes(3);
    expect(saveSettings).toHaveBeenLastCalledWith({ expandedPropertyKeys: ["priority", "status"] });
  });

  it("collapses a complete branch set with one save and preserves unrelated expansion state", async () => {
    const { controller, saveSettings, settings } = createHarness();
    settings.expandedFolderPaths = ["a", "a/b", "outside-current-tree"];
    controller.project(projectionInput(createFolderScope("", true)));

    await controller.toggleAll("folder");

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings).toHaveBeenCalledWith({ expandedFolderPaths: ["outside-current-tree"] });
  });

  it("updates query-time expansion in one publication without persisting", async () => {
    const { controller, publishGroups, saveSettings } = createHarness();
    controller.updateQuery("c");
    controller.project(projectionInput(createFolderScope("", true)));
    publishGroups.mockClear();

    await controller.toggleAll("folder");

    expect(saveSettings).not.toHaveBeenCalled();
    expect(publishGroups).toHaveBeenCalledTimes(1);
    expect(publishGroups).toHaveBeenCalledWith("nav");
  });

  it("keeps property query expansion/suppression runtime-only", async () => {
    const { controller, saveSettings } = createHarness();
    controller.updateQuery("open");
    let projection = controller.project(propertyInput([statusFacet]));
    const openKey = projection.rows.find((row) => row.id === navigationPropertyId("status"));
    expect(openKey?.expanded).toBe(true);
    if (!openKey) throw new Error("missing property key fixture");

    await controller.setExpanded(openKey, false);
    expect(saveSettings).not.toHaveBeenCalled();
    projection = controller.project(propertyInput([statusFacet]));
    expect(projection.rows.find((row) => row.id === navigationPropertyId("status"))?.expanded).toBe(false);

    const collapsed = projection.rows.find((row) => row.id === navigationPropertyId("status"));
    if (!collapsed) throw new Error("missing collapsed property key fixture");
    await controller.setExpanded(collapsed, true);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("returns focus to the key row when collapsing a property with a focused descendant", async () => {
    const { controller, settings } = createHarness();
    settings.expandedPropertyKeys = ["status"];
    const valueId = navigationPropertyValueId("status", { kind: "text", value: "open" });
    let projection = controller.project(propertyInput([statusFacet]));
    expect(projection.rows.some((row) => row.id === valueId)).toBe(true);

    controller.setFocus(valueId);
    const key = projection.rows.find((row) => row.id === navigationPropertyId("status"));
    if (!key) throw new Error("missing property key fixture");
    await controller.setExpanded(key, false);
    expect(controller.getFocusId()).toBe(navigationPropertyId("status"));
  });

  it("drops a key removed from visiblePropertyKeys from projection and expansion", () => {
    const { controller, settings } = createHarness();
    settings.expandedPropertyKeys = ["status", "priority"];
    let projection = controller.project(propertyInput([statusFacet, priorityFacet]));
    expect(projection.rows.some((row) => row.id === navigationPropertyId("status"))).toBe(true);
    expect(projection.rows.some((row) => row.id === navigationPropertyId("priority"))).toBe(true);

    // Chooser removal narrows the facet snapshot to the still-visible keys.
    projection = controller.project(propertyInput([statusFacet]));
    expect(projection.rows.some((row) => row.id === navigationPropertyId("status"))).toBe(true);
    expect(projection.rows.some((row) => row.id === navigationPropertyId("priority"))).toBe(false);
  });

  it("persists the Properties section collapse through the generic section toggle", async () => {
    const { controller, saveSettings, settings } = createHarness();
    expect(settings.sectionCollapsed.properties).toBe(false);

    await controller.onToggleNavSection("properties");

    expect(saveSettings).toHaveBeenCalledWith({ sectionCollapsed: { properties: true } });
  });

  it("clears property query expansion on disposal and resets the projection", () => {
    const { controller } = createHarness();
    controller.updateQuery("closed");
    const projection = controller.project(propertyInput([statusFacet]));
    expect(projection.rows.find((row) => row.id === navigationPropertyId("status"))?.expanded).toBe(true);

    controller.dispose();
    expect(controller.getQuery()).toBe("");
    expect(controller.getProjection().rows).toEqual([]);
  });
});

describe("folder drag navigation state", () => {
  it("keeps sorting choices exclusive, preserves the current order in manual mode, and switches to manual after a drag", async () => {
    const a = folder("a"), b = folder("b"), c = folder("c"), root = folder("", [b, a, c]);
    const h = createHarness(root);
    vi.spyOn(h.context, "getApp").mockReturnValue({ vault: {
      getRoot: () => root,
      getAbstractFileByPath: (path: string) => [a, b, c].find((f) => f.path === path) ?? null,
    } } as never);
    h.settings.folderSiblingOrders = { a: [] };
    h.settings.folderDescendingNameSorts = ["a"];
    h.controller.updateQuery("b");
    const mode = () => resolveFolderSortMode(h.settings.folderSiblingOrders, "", h.settings.folderDescendingNameSorts);
    expect(mode()).toBe("asc");

    await h.controller.sortFolderNameOrder("", "manual");
    expect(mode()).toBe("manual");
    expect(h.settings.folderSiblingOrders[""]).toEqual(["a", "b", "c"]);
    await h.controller.sortFolderNameOrder("", "desc");
    expect(mode()).toBe("desc");
    expect(h.settings.folderSiblingOrders[""]).toEqual(["c", "b", "a"]);

    await h.controller.sortFolderNameOrder("", "manual");
    expect(mode()).toBe("manual");
    expect(h.settings.folderSiblingOrders[""]).toEqual(["c", "b", "a"]);
    expect(h.settings.folderDescendingNameSorts).toEqual(["a"]);
    await h.controller.sortFolderNameOrder("", "desc");
    expect(mode()).toBe("desc");

    await h.controller.reorderFolders("b", "c", "before");
    expect(mode()).toBe("manual");
    expect(h.settings.folderSiblingOrders[""]).toEqual(["b", "c", "a"]);
    expect(h.settings.folderDescendingNameSorts).toEqual(["a"]);
    await h.controller.sortFolderNameOrder("", "asc");
    expect(mode()).toBe("asc");
    expect(h.settings.folderSiblingOrders).toEqual({ a: [] });
    expect(h.settings.folderDescendingNameSorts).toEqual(["a"]);
    expect(h.onNavCountsInvalidated).not.toHaveBeenCalled();
    expect(h.context.requestUpdate).not.toHaveBeenCalled();
  });
  it("switches a valid original-position drop from descending to manual while rejecting self drops", async () => {
    const a = folder("a"), b = folder("b"), root = folder("", [a, b]);
    const h = createHarness(root);
    vi.spyOn(h.context, "getApp").mockReturnValue({ vault: {
      getRoot: () => root,
      getAbstractFileByPath: (path: string) => [a, b].find((f) => f.path === path) ?? null,
    } } as never);
    await h.controller.sortFolderNameOrder("", "desc");
    h.saveSettings.mockClear();
    await h.controller.reorderFolders("b", "b", "before");
    expect(h.saveSettings).not.toHaveBeenCalled();
    await h.controller.reorderFolders("b", "a", "before");
    expect(h.settings.folderSiblingOrders[""]).toEqual(["b", "a"]);
    expect(h.settings.folderDescendingNameSorts).toEqual([]);
    expect(h.saveSettings).toHaveBeenCalledTimes(1);
  });
  it("uses all siblings under a query, ignores original-position drops, and resets only one group", async () => {
    const a = folder("a"), b = folder("b"), c = folder("c"), root = folder("", [a, b, c]);
    const h = createHarness(root);
    vi.spyOn(h.context, "getApp").mockReturnValue({ vault: {
      getRoot: () => root,
      getAbstractFileByPath: vi.fn((path: string) => [a, b, c].find((f) => f.path === path) ?? null),
    } } as never);
    h.settings.folderSiblingOrders = { a: [] };
    h.controller.updateQuery("b");
    h.publishGroups.mockClear();
    await h.controller.reorderFolders("a", "b", "before");
    expect(h.saveSettings).not.toHaveBeenCalled();
    expect(h.settings.folderSiblingOrders).toEqual({ a: [] });
    await h.controller.reorderFolders("c", "a", "before");
    expect(h.settings.folderSiblingOrders).toEqual({ a: [], "": ["c", "a", "b"] });
    expect(h.saveSettings).toHaveBeenCalledTimes(1);
    expect(h.onNavCountsInvalidated).not.toHaveBeenCalled();
    expect(h.context.requestUpdate).not.toHaveBeenCalled();
    await h.controller.sortFolderNameOrder("", "asc");
    expect(h.settings.folderSiblingOrders).toEqual({ a: [] });
    await h.controller.sortFolderNameOrder("", "asc");
    expect(h.saveSettings).toHaveBeenCalledTimes(2);
  });
  it("sorts all sibling folders descending under a query, persists once, and restores ascending order", async () => {
    const alpha = folder("Parent/Alpha"), bravo = folder("Parent/Bravo"), charlie = folder("Parent/Charlie");
    const parent = folder("Parent", [bravo, file("Parent/Zulu.md"), alpha, charlie]);
    const h = createHarness(folder("", [parent]));
    vi.spyOn(h.context, "getApp").mockReturnValue({ vault: {
      getRoot: () => folder("", [parent]),
      getAbstractFileByPath: (path: string) => path === "Parent" ? parent : null,
    } } as never);
    h.settings.folderSiblingOrders = { "": ["Other", "Parent"], Parent: [bravo.path, charlie.path, alpha.path] };
    h.controller.updateQuery("Bravo");

    await h.controller.sortFolderNameOrder("Parent", "desc");
    expect(h.settings.folderSiblingOrders).toEqual({
      "": ["Other", "Parent"], Parent: [charlie.path, bravo.path, alpha.path],
    });
    await h.controller.sortFolderNameOrder("Parent", "desc");
    expect(h.saveSettings).toHaveBeenCalledTimes(1);

    h.controller.refreshFolderTreeState();
    h.controller.updateQuery("");
    h.settings.expandedFolderPaths = ["Parent"];
    const project = () => h.controller.project({ ...projectionInput(createFolderScope("", true)),
      folders: h.controller.getFolderTree(), folderSiblingOrders: h.settings.folderSiblingOrders });
    expect(project().rows.filter((row) => row.kind === "folder").map((row) => row.id))
      .toEqual(["folder:", "folder:Parent", "folder:Parent/Charlie", "folder:Parent/Bravo", "folder:Parent/Alpha"]);

    await h.controller.sortFolderNameOrder("Parent", "asc");
    expect(h.settings.folderSiblingOrders).toEqual({ "": ["Other", "Parent"] });
    expect(project().rows.filter((row) => row.kind === "folder").map((row) => row.id))
      .toEqual(["folder:", "folder:Parent", "folder:Parent/Alpha", "folder:Parent/Bravo", "folder:Parent/Charlie"]);
    expect(h.onNavCountsInvalidated).not.toHaveBeenCalled();
    expect(h.context.requestUpdate).not.toHaveBeenCalled();
  });
  it("keeps root first when sorting top-level folders descending without a manual order", async () => {
    const h = createHarness(folder("", [folder("Alpha"), folder("Bravo"), file("Zulu.md")]));
    await h.controller.sortFolderNameOrder("", "desc");
    expect(h.settings.folderSiblingOrders).toEqual({ "": ["Bravo", "Alpha"] });
    h.controller.refreshFolderTreeState();
    const projection = h.controller.project({ ...projectionInput(createFolderScope("", true)),
      folders: h.controller.getFolderTree(), folderSiblingOrders: h.settings.folderSiblingOrders });
    expect(projection.rows.filter((row) => row.kind === "folder").map((row) => row.id))
      .toEqual(["folder:", "folder:Bravo", "folder:Alpha"]);
  });
  it("ignores name sorting for missing parents, file parents, and disposed views", async () => {
    const h = createHarness();
    vi.spyOn(h.context, "getApp").mockReturnValue({ vault: {
      getRoot: () => folder(""),
      getAbstractFileByPath: (path: string) => path === "note.md" ? file(path) : null,
    } } as never);
    h.settings.folderSiblingOrders = { Missing: ["Missing/Alpha"] };
    for (const direction of ["asc", "desc", "manual"] as const) {
      await h.controller.sortFolderNameOrder("Missing", direction);
      await h.controller.sortFolderNameOrder("note.md", direction);
    }
    h.controller.dispose();
    await h.controller.sortFolderNameOrder("", "desc");
    expect(h.saveSettings).not.toHaveBeenCalled();
  });
  it("temporary expansion publishes only nav, ignores repeated requests, and clears without a write", () => {
    const h = createHarness();
    const input = projectionInput(createFolderScope("", true));
    h.controller.project(input);
    h.publishGroups.mockClear();
    h.controller.expandFolderForDrag("a");
    h.controller.expandFolderForDrag("a");
    expect(h.publishGroups).toHaveBeenCalledExactlyOnceWith("nav");
    expect(h.controller.project(input).rows.find((r) => r.id === "folder:a")?.expanded).toBe(true);
    h.controller.clearFolderDrag();
    expect(h.controller.project(input).rows.find((r) => r.id === "folder:a")?.expanded).toBe(false);
    expect(h.settings.expandedFolderPaths).toEqual([]);
    expect(h.saveSettings).not.toHaveBeenCalled();
    expect(h.onNavCountsInvalidated).not.toHaveBeenCalled();
    h.controller.dispose();
    h.publishGroups.mockClear();
    h.controller.expandFolderForDrag("a");
    expect(h.publishGroups).not.toHaveBeenCalled();
  });
});
