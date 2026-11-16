import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { DEFAULT_GROUP_SPEC } from "../card-grouping-settings";
import { getUiStrings } from "../i18n";
import { createPanelModel, type PanelModelState } from "./panel-model";
import { createStreamPanelModel, type StreamPanelEntry, type StreamPanelState } from "./stream-panel-model";
import { getStreamUiStrings } from "./stream-ui-strings";
import StreamWorkspacePanel from "./StreamWorkspacePanel.svelte";
import FolderCardPanel from "./FolderCardPanel.svelte";
import Toolbar from "./Toolbar.svelte";
function createInitialPanelState(): PanelModelState {
  return {
    strings: getUiStrings("en"),
    scope: {
      displayPath: "notes",
      includeSubfolders: true,
      activeBoxId: null,
      activeBoxName: null,
      boxExcludedCount: 0,
      emptyStateMessage: "No supported files found in this folder.",
      sourceIdentity: "folder:notes:true",
      browseTagFilterEnabled: true,
      browsePropertyFilterEnabled: true,
      supportsIncludeSubfolders: true,
      supportsBoxRuleSeeding: true,
    },
    cards: {
      records: [],
      searchMatchCountsByPath: {},
      selectedPath: null,
      loading: false,
      generation: 0,
      sequenceRevision: 0,
      hydrationRevision: 0,
      groupSegments: [],
      groupRevision: 0,
      extentCount: 0,
    },
    search: { history: [], query: "", committedQuery: "", status: "idle", focusToken: 0 },
    projection: {
      sortField: "mtime",
      sortDirection: "desc",
      availableTags: [],
      tagCounts: {},
      activeFilterTags: [],
      pinnedPaths: [],
      group: { ...DEFAULT_GROUP_SPEC },
      availableGroupDimensions: ["none", "folder", "tag", "task"],
      groupSegmentCount: 0,
      metadataStatus: "ready",
    },
    bulk: {
      bulkMode: false,
      selectedPaths: [],
      selectedCount: 0,
      bulkAnchorPath: null,
      canBulkSelectAll: false,
      canBulkClearSelection: false,
      canBulkMoveSelected: false,
      canBulkEditTagsSelected: false,
      canBulkEditPropertiesSelected: false,
      canBulkDeleteSelected: false,
      canBulkMergeSelected: false,
    },
    nav: {
      folderTree: [],
      favorites: [],
      boxSummaries: [],
      paneWidth: 240,
      layoutMode: "dual",
      visible: true,
      sectionCollapsed: { favorites: false, folders: false, tags: false, properties: false, boxes: false, templates: false, links: false },
      showItemCounts: false,
      tooltipSide: "right",
      propertyFilterCount: 0,
      projection: { normalizedQuery: "", querying: false, sections: [], rows: [], noResults: false },
      query: "",
      focusId: null,
      focusRequest: null,
      revealRequest: null,
    },
    images: { byPath: {}, requestVersion: 0 },
    appearance: { cardCornerRadius: "compact", previewLines: 5, searchPreviewSnippetCount: 2 },
  };
}


function createWorkspace(): StreamPanelState {
 const entries: StreamPanelEntry[] = ["one", "two", "three"].map((id, index) => ({ id, title: id, sourceLabel: "notes/" + id, expanded: true, autoCollapsed: false, current: index === 0, pending: false, panelModel: createPanelModel(createInitialPanelState()), props: {}, weight: 1 }));
 return { entries, currentStreamId: "one", direction: "horizontal", navigationVisible: true, singlePane: false, navPanelModel: entries[0].panelModel, navProps: {}, labels: getStreamUiStrings("en"), recentlyClosedCount: 1, unsupported: false };
}
let components: ReturnType<typeof mount>[] = [];
async function render(props: { model: ReturnType<typeof createStreamPanelModel>; onSelect?: (id: string) => void; onCommand?: (id: string, command: import("./stream-panel-model").StreamCommand, anchor?: HTMLElement) => void; onResize?: (width: number, height: number) => void; onResizePair?: (a: string, b: string, delta: number) => void; onReorder?: (id: string, delta: -1 | 1) => void; onCreate?: () => void }) {
 const target = document.createElement("div"); document.body.append(target);
 components.push(mount(StreamWorkspacePanel, { target, props })); await tick(); return target;
}
beforeEach(() => {
 vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
 vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1100);
 vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(700);
});
afterEach(async () => { for (const component of components) await unmount(component); components = []; document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("StreamWorkspacePanel", () => {
 it("renders three independent streams with one shared navigation and preserves mounted content when target changes", async () => {
  const model = createStreamPanelModel(createWorkspace()); const onSelect = vi.fn();
  const target = await render({ model, onSelect });
  expect(target.querySelectorAll(".fce-stream-panel")).toHaveLength(3);
  expect(target.querySelectorAll(".fce-nav-pane")).toHaveLength(1);
  const first = target.querySelector('[data-stream-id="one"] .fce-list');
  const titles = target.querySelectorAll<HTMLButtonElement>(".fce-stream-select"); titles[1].click();
  expect(onSelect).toHaveBeenCalledWith("two");
  const previous = model.getState(); model.setState({ ...previous, currentStreamId: "two", entries: previous.entries.map(entry => ({ ...entry, current: entry.id === "two" })) }); await tick();
  expect(target.querySelector('[data-stream-id="one"] .fce-list')).toBe(first);
  expect(titles[1].getAttribute("aria-current")).toBe("true");
 });
 it("shows no current target while retaining a visible tile and freezes only pending content", async () => {
  const workspace = createWorkspace();
  workspace.currentStreamId = null;
  workspace.entries = workspace.entries.map((entry, index) => ({ ...entry, expanded: index === 1, current: false, pending: index === 1 }));
  const target = await render({ model: createStreamPanelModel(workspace) });
  expect(target.querySelector(".fce-stream-workspace-bar [role='status']")?.textContent).toBe(workspace.labels.noCurrent);
  expect(target.querySelectorAll(".fce-stream-panel")).toHaveLength(1);
  const panel = target.querySelector('[data-stream-id="two"]')!;
  expect((panel.querySelector(".fce-stream-panel-content") as HTMLElement & { inert: boolean }).inert).toBe(true);
  expect(panel.querySelector(".fce-stream-panel-header")?.closest("[inert]")).toBeNull();
  expect(target.querySelector(".fce-stream-list")?.closest("[inert]")).toBeNull();
 });
 it("keeps selection, show-only, tiling, collapse, close and management intents distinct", async () => {
  const model = createStreamPanelModel(createWorkspace()); const onCommand = vi.fn();
  const target = await render({ model, onCommand });
  const click = (label: string) => target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
  click("Show only this stream"); click("Tile this stream"); click("Collapse stream"); click("Close stream"); click("Manage stream");
  expect(onCommand.mock.calls.map(call => call[1])).toEqual(["show-only", "tile", "collapse", "close", "manage"]);
  expect(onCommand.mock.calls[4][2]).toBeInstanceOf(HTMLElement);
  expect(model.getState().entries).toHaveLength(3);
 });
 it("offers keyboard focus movement, reorder and split resizing with available stage measurements", async () => {
  const onResize = vi.fn(), onResizePair = vi.fn(), onReorder = vi.fn(), onShellResize = vi.fn();
  const state = createWorkspace(); state.navProps = { onShellResize };
  const target = await render({ model: createStreamPanelModel(state), onResize, onResizePair, onReorder });
  expect(onShellResize).toHaveBeenCalledWith(1100); expect(onResize).toHaveBeenCalledWith(1100, 700);
  const buttons = target.querySelectorAll<HTMLButtonElement>(".fce-stream-select"); buttons[0].focus(); buttons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })); expect(document.activeElement).toBe(buttons[2]);
  buttons[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })); expect(document.activeElement).toBe(buttons[0]);
  target.querySelector<HTMLButtonElement>('button[aria-label="Move later"]')!.click(); expect(onReorder).toHaveBeenCalledWith("one", 1);
  target.querySelector('[role="separator"].fce-stream-splitter')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); expect(onResizePair).toHaveBeenCalledWith("one", "two", 16);
 });
 it("keeps collapsed stream management accessible when source navigation is hidden and in compact mode", async () => {
  const state = createWorkspace(); state.navigationVisible = false; state.entries = state.entries.map((entry, index) => index === 2 ? { ...entry, expanded: false, autoCollapsed: true } : entry);
  const model = createStreamPanelModel(state), onCommand = vi.fn(); const target = await render({ model, onCommand });
  expect(target.querySelectorAll(".fce-nav-pane")).toHaveLength(0); expect(target.textContent).toContain(state.labels.autoCollapsed);
  target.querySelector<HTMLButtonElement>('[data-stream-list-id="three"] button[aria-label="Manage stream"]')!.click(); expect(onCommand).toHaveBeenLastCalledWith("three", "manage", expect.any(HTMLElement));
  model.setState({ ...model.getState(), singlePane: true }); await tick(); expect(target.querySelectorAll(".fce-stream-select")).toHaveLength(0);
  target.querySelector<HTMLButtonElement>(".fce-stream-list-toggle")!.click(); await tick(); expect(target.querySelectorAll(".fce-stream-select")).toHaveLength(3);
 });
 it("shows recovery without writing unsupported host state", async () => {
  const state = { ...createWorkspace(), entries: [], unsupported: true }; const model = createStreamPanelModel(state); const onCreate = vi.fn();
  const target = await render({ model, onCreate }); target.querySelector<HTMLButtonElement>(".fce-stream-empty button")!.click(); expect(onCreate).toHaveBeenCalledOnce(); expect(model.getState()).toBe(state);
 });
 it("preserves the legacy panel navigation default and supports external navigation", async () => {
  const target = document.createElement("div"); document.body.append(target); const panelModel = createPanelModel(createInitialPanelState());
  const legacy = mount(FolderCardPanel, { target, props: { panelModel } }); await tick(); expect(target.querySelectorAll(".fce-nav-pane")).toHaveLength(1); expect(target.querySelector(".fce-stream-workspace")).toBeNull(); await unmount(legacy);
  components.push(mount(FolderCardPanel, { target, props: { panelModel, showNavigation: false } })); await tick(); expect(target.querySelector(".fce-nav-pane")).toBeNull(); expect(target.querySelector(".fce-main-pane")).not.toBeNull();
 });
 it("reports each mounted card viewport and clears the automatic work region on teardown", async () => {
  const target = document.createElement("div"); document.body.append(target);
  const onRegionReady = vi.fn();
  const component = mount(FolderCardPanel, { target, props: { panelModel: createPanelModel(createInitialPanelState()), showNavigation: false, onRegionReady } });
  await tick();
  expect(onRegionReady).toHaveBeenCalledTimes(1);
  expect(onRegionReady).toHaveBeenLastCalledWith(target.querySelector(".fce-list"));
  await unmount(component);
  expect(onRegionReady).toHaveBeenCalledTimes(2);
  expect(onRegionReady).toHaveBeenLastCalledWith(null);
 });
 it("allows stage resize callbacks to publish host snapshots without becoming resize dependencies", async () => {
  const revisions = new SvelteMap([["host", 0]]);
  const model = createStreamPanelModel(createWorkspace());
  const onResize = vi.fn(() => {
    const revision = revisions.get("host")!;
    if (revision > 10) throw new Error("Stage resize entered a publish feedback loop");
    revisions.set("host", revision + 1);
    model.setState({ ...model.getState(), recentlyClosedCount: revision + 1 });
  });
  await render({ model, onResize });
  const reports = onResize.mock.calls.length;
  expect(reports).toBeGreaterThan(0);
  revisions.set("host", 8);
  model.setState({ ...model.getState(), recentlyClosedCount: 20 }); await tick();
  expect(onResize).toHaveBeenCalledTimes(reports);
 });
 it("keeps host search persistence reads outside presentation effect dependencies", async () => {
  const revisions = new SvelteMap([["host", 0]]);
  const model = createStreamPanelModel(createWorkspace());
  const onSearchOpenChange = vi.fn(() => {
    const revision = revisions.get("host")!;
    const snapshot = model.getState();
    if (revision > 10) throw new Error("Search visibility entered a publish feedback loop");
    revisions.set("host", revision + 1);
    model.setState({ ...snapshot, recentlyClosedCount: revision + 1 });
  });
  model.setState({ ...model.getState(), entries: model.getState().entries.map(entry => ({ ...entry, props: { onSearchOpenChange } })) });
  const target = await render({ model });
  expect(onSearchOpenChange).toHaveBeenCalledTimes(3);
  revisions.set("host", 8); await tick();
  expect(onSearchOpenChange).toHaveBeenCalledTimes(3);
  target.querySelector<HTMLButtonElement>('[data-stream-id="one"] button[aria-label="Toggle search"]')!.click(); await tick();
  expect(onSearchOpenChange).toHaveBeenCalledTimes(4);
  expect(onSearchOpenChange).toHaveBeenLastCalledWith(true);
 });
 it("restores search visibility and reports toggles for host persistence", async () => {
  const target = document.createElement("div"); document.body.append(target); const onSearchOpenChange = vi.fn();
  components.push(mount(Toolbar, { target, props: { initialSearchOpen: true, onSearchOpenChange } })); await tick();
  expect(target.querySelector(".fce-search-input")).not.toBeNull(); expect(onSearchOpenChange).toHaveBeenLastCalledWith(true);
  target.querySelector<HTMLButtonElement>('button[aria-label="Toggle search"]')!.click(); await tick(); expect(onSearchOpenChange).toHaveBeenLastCalledWith(false);
 });
});
