import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, tick, unmount } from "svelte";
import NavigationPane from "./NavigationPane.svelte";
import { DragSession } from "./drag-session";
import type { PanelNavState, PanelScopeState } from "./panel-model";
import { mobileNavigation } from "./mobile-navigation";
const state = vi.hoisted(() => ({ opened: [] as Array<{ close: () => void; modalEl: HTMLElement }> }));
vi.mock("obsidian", () => ({ setIcon() {}, setTooltip() {}, Modal: class {
  contentEl = document.createElement("div"); modalEl = document.createElement("div"); onClose = () => {};
  constructor() { this.modalEl.append(this.contentEl); Object.assign(this.modalEl, { addClass: (...names: string[]) => this.modalEl.classList.add(...names) }); }
  open() { document.body.append(this.modalEl); state.opened.push(this); }
  close() { this.onClose(); this.modalEl.remove(); }
} }));
afterEach(() => { state.opened = []; document.body.replaceChildren(); });
describe("mobile navigation host Modal", () => {
  it("moves one mounted navigation node across resize and closes with the host without duplicating state", () => {
    const shell = document.createElement("div"), nav = document.createElement("nav"), input = document.createElement("input");
    nav.append(input); shell.append(nav); document.body.append(shell); input.value = "query";
    const onClose = vi.fn(), options = { app: {} as never, enabled: true, visible: true, onClose };
    const action = mobileNavigation(nav, options);
    expect(state.opened).toHaveLength(1); expect(shell.contains(nav)).toBe(false); expect(state.opened[0].modalEl.contains(nav)).toBe(true);
    action.update(options); expect(state.opened).toHaveLength(1);
    action.update({ ...options, enabled: false }); expect(shell.contains(nav)).toBe(true); expect(onClose).not.toHaveBeenCalled(); expect(input.value).toBe("query");
    action.update(options); state.opened[1].close(); expect(shell.contains(nav)).toBe(true); expect(onClose).toHaveBeenCalledOnce();
    action.destroy(); expect(shell.childNodes).toHaveLength(1);
  });
});


it.each([false, true])("opens navigation for a card drag and only closes a modal opened by that drag (initial visibility %s)", async (visible) => {
  const sectionCollapsed = { favorites: false, folders: false, tags: false, properties: false, boxes: false, templates: false, links: false };
  const nav: PanelNavState = {
    folderTree: [], favorites: [], boxSummaries: [], paneWidth: 240, layoutMode: "single", visible, sectionCollapsed,
    showItemCounts: false, tooltipSide: "right", propertyFilterCount: 0, query: "", focusId: null, focusRequest: null, revealRequest: null,
    projection: { normalizedQuery: "", querying: false, sections: [], noResults: false, rows: [{
      id: "folder:", kind: "folder", section: "folders", folderPath: "", parentId: null, level: 1, positionInSet: 1, setSize: 1,
      expandable: false, expanded: false, disabled: false, semanticState: "none", label: "Root", fullPath: "", count: 0, icon: null,
      directCount: 0, recursiveCount: 0, recursiveFolderCount: 0, menuTarget: { section: "folders", scope: "item", itemId: "" },
    }] },
  };
  const scope: PanelScopeState = { displayPath: "", sourceIdentity: "folder::true", includeSubfolders: true, activeBoxId: null, activeBoxName: null,
    boxExcludedCount: 0, emptyStateMessage: "", browseTagFilterEnabled: true, browsePropertyFilterEnabled: true, supportsIncludeSubfolders: true, supportsBoxRuleSeeding: true };
  const target = document.createElement("div"); document.body.append(target);
  const dragSession = new DragSession(), onDropCards = vi.fn(), onToggleNavPane = vi.fn();
  const component = mount(NavigationPane, { target, props: { mobileApp: {} as never, mobile: true, nav, scope, dragSession, onDropCards, onToggleNavPane } });
  await tick();
  const source = document.createElement("div"); document.body.append(source);
  dragSession.begin({ kind: "cards", paths: ["A.md"], label: "A" }, document, "touch", 20, 30);
  await tick();
  expect(state.opened).toHaveLength(1);
  const row = document.querySelector<HTMLElement>('[data-nav-row-id="folder:"]')!;
  expect(state.opened[0].modalEl.contains(row)).toBe(true);
  source.remove();
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => row });
  dragSession.move(30, 40); dragSession.drop(); await tick();
  expect(onDropCards).toHaveBeenCalledExactlyOnceWith({ kind: "folder", path: "" }, ["A.md"]);
  expect(onToggleNavPane).not.toHaveBeenCalled();
  expect(state.opened[0].modalEl.isConnected).toBe(visible);
  await unmount(component); dragSession.dispose(); delete (document as Partial<Document>).elementFromPoint;
});
