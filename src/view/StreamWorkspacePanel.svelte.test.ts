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


function entry(id: string, index: number, overrides: Partial<StreamPanelEntry> = {}): StreamPanelEntry {
 return { id, title: id, customTitle: null, ordinal: null, display: "stream", current: index === 0, pending: false, panelModel: createPanelModel(createInitialPanelState()), props: {}, ...overrides };
}
function createWorkspace(): StreamPanelState {
 const entries = ["one", "two", "three"].map((id, index) => entry(id, index));
 return { layout: { kind: "split", id:"rows", axis:"y", ratio:0.5, first:{
   kind:"split", id:"cols", axis:"x", ratio:0.5, first:{kind:"stream",id:"one"},second:{kind:"stream",id:"two"}
 },second:{kind:"stream",id:"three"}}, entries, currentStreamId: "one", maximizedStreamId: null, navigationVisible: true, singlePane: false, navPanelModel: entries[0].panelModel, navProps: {}, labels: getStreamUiStrings("en"), recentlyClosedCount: 1, unsupported: false };
}
type RenderProps = {
 model: ReturnType<typeof createStreamPanelModel>; onSelect?: (id: string) => void;
 onCommand?: (id: string, command: import("./stream-panel-model").StreamCommand, anchor?: HTMLElement) => void;
 onResize?: (width: number, height: number) => void; onSplitResize?: (id: string, width: number) => void;
 onPlace?: (id: string, place: import("./stream-tiles").Placement) => void; onCreate?: () => void; onReopen?: () => void; onToggleNav?: () => void;
};
let components: ReturnType<typeof mount>[] = [];
async function render(props: RenderProps) {
 const target = document.createElement("div"); document.body.append(target);
 components.push(mount(StreamWorkspacePanel, { target, props })); await tick(); return target;
}
function pointer(type: string, init: { clientX: number; button?: number }): Event {
 const Pointer = globalThis.PointerEvent ?? MouseEvent;
 return new Pointer(type, { bubbles: true, button: 0, ...init });
}
function placeItems(target: HTMLElement): void {
 for (const [index, element] of Array.from(target.querySelectorAll<HTMLElement>("[data-stream-item]")).entries()) {
  element.getBoundingClientRect = () => ({ left: index * 300, right: index * 300 + 300, width: 300, top: 0, bottom: 700, height: 700, x: index * 300, y: 0, toJSON() {} });
 }
}
beforeEach(() => {
 vi.stubGlobal("ResizeObserver", class {
  constructor(private readonly report: (entries: { contentRect: DOMRect }[]) => void) {}
  observe(node: HTMLElement) {
   if (node.classList.contains("fce-stream-stage")) this.report([{ contentRect: new DOMRect(0, 0, 1100, 700) }]);
  }
  disconnect() {}
 });
 vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1100);
 vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(700);
});
afterEach(async () => { for (const component of components) await unmount(component); components = []; document.body.innerHTML = ""; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("StreamWorkspacePanel", () => {
 it("renders streams beside one shared navigation without extra workspace chrome and keeps content mounted when target changes", async () => {
  const model = createStreamPanelModel(createWorkspace()); const onSelect = vi.fn();
  const target = await render({ model, onSelect });
  expect(target.querySelectorAll(".fce-stream-panel")).toHaveLength(3);
  expect(target.querySelectorAll(".fce-nav-pane")).toHaveLength(1);
  for (const removed of [".fce-stream-workspace-bar", ".fce-stream-list", ".fce-stream-panel-header"]) expect(target.querySelector(removed)).toBeNull();
  expect(target.querySelectorAll(".fce-stream-switcher")).toHaveLength(3);
  expect(target.querySelectorAll(".fce-stream-close")).toHaveLength(3);
  expect(["one", "two", "three"].map(id => target.querySelectorAll(`[data-stream-id="${id}"] button[aria-pressed]`).length)).toEqual([1, 0, 0]);
  const first = target.querySelector('[data-stream-id="one"] .fce-list');
  target.querySelector('[data-stream-id="two"] .fce-list')!.dispatchEvent(pointer("pointerdown", { clientX: 400 }));
  expect(onSelect).toHaveBeenCalledWith("two");
  const previous = model.getState(); model.setState({ ...previous, currentStreamId: "two", entries: previous.entries.map(value => ({ ...value, current: value.id === "two" })) }); await tick();
  expect(target.querySelector('[data-stream-id="one"] .fce-list')).toBe(first);
  expect(target.querySelector('[data-stream-id="two"]')!.getAttribute("aria-current")).toBe("true");
 });
 it("routes the toolbar switcher, close button and collapsed spine to host intents", async () => {
  const state = createWorkspace(); state.entries = state.entries.map((value, index) => index === 2 ? { ...value, display: "spine", width: 28, separator: false, panelModel: null } : value);
  const model = createStreamPanelModel(state), onCommand = vi.fn(), onSelect = vi.fn();
  const target = await render({ model, onCommand, onSelect });
  target.querySelector<HTMLButtonElement>('[data-stream-id="two"] .fce-stream-switcher')!.click();
  expect(onCommand).toHaveBeenLastCalledWith("two", "menu", expect.any(HTMLElement));
  target.querySelector<HTMLButtonElement>('[data-stream-id="two"] .fce-stream-close')!.click();
  expect(onCommand).toHaveBeenLastCalledWith("two", "close");
  const spine = target.querySelector<HTMLButtonElement>(".fce-stream-spine")!;
  expect(spine.getAttribute("aria-label")).toBe(`${state.labels.expand}: three`);
  spine.click(); expect(onSelect).toHaveBeenLastCalledWith("three");
  spine.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  expect(onCommand).toHaveBeenLastCalledWith("three", "menu", spine);
 });
 it("shows a custom or numbered title in the toolbar and only offers close with several streams", async () => {
  const state = createWorkspace();
  state.entries = [entry("one", 0, { customTitle: "Reading" })];
  const model = createStreamPanelModel(state); const target = await render({ model });
  expect(target.querySelector(".fce-stream-switcher .fce-toolbar-scope-text")?.textContent).toBe("Reading");
  expect(target.querySelector(".fce-stream-close")).toBeNull();
  expect(target.querySelector(".fce-stream-grip")).toBeNull();
  expect(target.querySelector(".fce-stream-stage.has-multiple")).toBeNull();
  model.setState({ ...state, entries: [entry("one", 0, { ordinal: 1 }), entry("two", 1, { ordinal: 2 })] }); await tick();
  expect(target.querySelector('[data-stream-id="two"] .fce-stream-switcher .fce-toolbar-scope-text')?.textContent).toBe("notes (2)");
  expect(target.querySelectorAll(".fce-stream-grip")).toHaveLength(2);
  expect(target.querySelectorAll(".fce-stream-close")).toHaveLength(2);
 });
 it("freezes pending content and keeps a menu and close control for streams without content", async () => {
  const workspace = createWorkspace();
  workspace.entries = workspace.entries.map((value, index) => index === 1 ? { ...value, pending: true, panelModel: null, error: "Failed" } : value);
  const onCommand = vi.fn(); const target = await render({ model: createStreamPanelModel(workspace), onCommand });
  const panel = target.querySelector('[data-stream-id="two"]')!;
  expect((panel.querySelector(".fce-stream-panel-content") as HTMLElement & { inert: boolean }).inert).toBe(true);
  expect(panel.querySelector(".fce-stream-fallback-bar")?.closest("[inert]")).toBeNull();
  expect(panel.querySelector('[role="alert"]')?.textContent).toBe("Failed");
  panel.querySelector<HTMLButtonElement>(".fce-stream-fallback-bar .fce-stream-switcher")!.click();
  expect(onCommand).toHaveBeenLastCalledWith("two", "menu", expect.any(HTMLElement));
  panel.querySelector<HTMLButtonElement>(`.fce-stream-fallback-bar button[aria-label="${workspace.labels.close}"]`)!.click();
  expect(onCommand).toHaveBeenLastCalledWith("two", "close");
 });
 it("resizes one stream from its splitter and reports available stage measurements", async () => {
  const onResize = vi.fn(), onSplitResize = vi.fn(), onShellResize = vi.fn();
  const state = createWorkspace(); state.navProps = { onShellResize };
  const target = await render({ model: createStreamPanelModel(state), onResize, onSplitResize });
  expect(onShellResize).toHaveBeenCalledWith(1100); expect(onResize).toHaveBeenCalledWith(1100, 700);
  const splitters = target.querySelectorAll<HTMLElement>('[role="separator"].fce-stream-splitter');
  expect(splitters).toHaveLength(2);
  splitters[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  expect(onSplitResize).toHaveBeenLastCalledWith("cols", 566/1100);
  splitters[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", shiftKey: true, bubbles: true }));
  expect(onSplitResize).toHaveBeenLastCalledWith("rows", 302/700);
 });
 it("reorders by dragging a stream title and swallows the click that ends the drag", async () => {
  const onPlace = vi.fn(), onCommand = vi.fn();
  const target = await render({ model: createStreamPanelModel(createWorkspace()), onPlace, onCommand });
  placeItems(target);
  const handle = target.querySelector<HTMLButtonElement>('[data-stream-id="one"] .fce-stream-switcher')!;
  handle.dispatchEvent(pointer("pointerdown", { clientX: 10 }));
  const stage = target.querySelector<HTMLElement>(".fce-stream-stage")!;
  stage.getBoundingClientRect = () => new DOMRect(0,0,1100,700);
  document.dispatchEvent(pointer("pointermove", { clientX: 500 })); await tick();
  expect(target.querySelector(".fce-stream-drop-preview")).not.toBeNull();
  document.dispatchEvent(pointer("pointerup", { clientX: 500 }));
  expect(onPlace).toHaveBeenCalledExactlyOnceWith("one", {target:"split:rows",side:"top"});
  handle.click(); expect(onCommand).not.toHaveBeenCalled();
  handle.dispatchEvent(pointer("pointerdown", { clientX: 10 }));
  document.dispatchEvent(pointer("pointerup", { clientX: 12 }));
  handle.click(); expect(onCommand).toHaveBeenLastCalledWith("one", "menu", handle);
  expect(onPlace).toHaveBeenCalledOnce();
 });
 it("reveals programmatically selected streams but not streams chosen by pointer", async () => {
  const model = createStreamPanelModel(createWorkspace());
  const target = await render({ model });
  placeItems(target);
  const stage = target.querySelector<HTMLElement>(".fce-stream-stage")!;
  let scrollLeft = 0;
  Object.defineProperty(stage, "scrollLeft", { get: () => scrollLeft, set: (value: number) => { scrollLeft = value; }, configurable: true });
  stage.getBoundingClientRect = () => ({ left: 0, right: 500, width: 500, top: 0, bottom: 700, height: 700, x: 0, y: 0, toJSON() {} });
  const select = (id: string) => { const previous = model.getState(); model.setState({ ...previous, currentStreamId: id, entries: previous.entries.map(value => ({ ...value, current: value.id === id })) }); };
  select("three"); await tick();
  expect(scrollLeft).toBe(400);
  scrollLeft = 0;
  target.querySelector('[data-stream-id="two"] .fce-list')!.dispatchEvent(pointer("pointerdown", { clientX: 400 }));
  select("two"); await tick();
  expect(scrollLeft).toBe(0);
 });
 it("renders only the maximized stream and keeps empty-pane recovery reachable", async () => {
  const state = createWorkspace(); state.maximizedStreamId = "two";
  state.entries = state.entries.map(value => ({ ...value, display: value.id === "two" ? "stream" : "hidden", separator: false }));
  const model = createStreamPanelModel(state), onCreate = vi.fn(), onReopen = vi.fn(), onToggleNav = vi.fn();
  const target = await render({ model, onCreate, onReopen, onToggleNav });
  expect(target.querySelectorAll(".fce-stream-panel")).toHaveLength(1);
  expect(target.querySelector(".fce-stream-grip")).toBeNull();
  expect(target.querySelector(".fce-stream-close")).not.toBeNull();
  model.setState({ ...state, entries: [], navigationVisible: false }); await tick();
  const buttons = Array.from(target.querySelectorAll<HTMLButtonElement>(".fce-stream-empty button"));
  expect(buttons.map(button => button.textContent)).toEqual([state.labels.create, state.labels.reopen, state.labels.toggleNavigation]);
  for (const button of buttons) button.click();
  expect([onCreate, onReopen, onToggleNav].every(callback => callback.mock.calls.length === 1)).toBe(true);
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
