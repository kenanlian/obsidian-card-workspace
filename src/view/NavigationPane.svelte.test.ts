import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import { getUiStrings, type UiStrings } from "../i18n";
import { defaultNavSectionOrder } from "../navigation-section-order";
import type { PropertyFilterClause } from "../property-filter-settings";
import type { PanelNavState, PanelScopeState } from "./panel-model";
import {
  navigationPropertyId,
  navigationPropertyValueId,
  type NavigationIntent,
} from "./navigation-model";
import { resolveNavigationKey, resolveSeparatorWidth } from "./navigation-keyboard";
import { projectNavigation } from "./navigation-projection";
import type { PropertyFacet } from "./property-facets";
import NavigationPane from "./NavigationPane.svelte";
import NavigationPaneHarness from "../__mocks__/NavigationPaneHarness.svelte";
import type { NavContextMenuPayload } from "./types";

const components: Array<Record<string, unknown>> = [];
const originalRect = HTMLElement.prototype.getBoundingClientRect;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

function projection(query = "", sectionOrder = defaultNavSectionOrder()) {
  return projectNavigation({
    query,
    scope: { kind: "folder", path: "notes", includeSubfolders: true },
    activeTags: ["work"], selectedPath: "notes/A.md",
    favorites: [{ kind: "file", ref: "notes/A.md", label: "A", icon: "file-text", count: 0, missing: false }],
    folders: [
      { name: "/", path: "/", depth: 0, directCount: 1, recursiveCount: 4, recursiveFolderCount: 2, children: [] },
      { name: "notes", path: "notes", depth: 0, directCount: 2, recursiveCount: 3, recursiveFolderCount: 1,
        children: [{ name: "child", path: "notes/child", depth: 1, directCount: 1, recursiveCount: 1, recursiveFolderCount: 0, children: [] }] },
    ],
    tags: [{ label: "work", displayTag: "Work", tag: "work", depth: 0, synthetic: false, children: [] }],
    boxes: [{ id: "box-1", name: "Inbox", cardCount: 2 }], tagCounts: { work: 2 },
    includeSubfolders: true, tagsDisabled: false,
    sectionCollapsed: { favorites: false, folders: false, tags: false, properties: false, boxes: false },
    sectionOrder,
    sectionLabels: {
      favorites: { label: "Favorites", emptyLabel: "No favorites yet — right-click an item to add one" },
      folders: { label: "Folders", emptyLabel: null }, tags: { label: "Tags", emptyLabel: null },
      properties: { label: "Properties", emptyLabel: "No properties selected — choose which properties to show" },
      boxes: { label: "Boxes", emptyLabel: "No card boxes yet — right-click to create one" },
    },
    rootFolderLabel: "Root /",
    expansion: {
      folders: { manual: ["notes"], reveal: [], query: [], suppressed: [] },
      tags: { manual: [], reveal: [], query: [], suppressed: [] }, queryCollapsedSections: [],
    },
  });
}

function propertyFacet(overrides: Partial<PropertyFacet> = {}): PropertyFacet {
  return {
    key: "status",
    label: "Status",
    valuedCount: 2,
    missingCount: 1,
    values: [
      { ref: { kind: "text", value: "Open" }, label: "Open", count: 2 },
      { ref: { kind: "text", value: "Closed" }, label: "Closed", count: 1 },
      { ref: { kind: "missing" }, label: "Unassigned", count: 1 },
    ],
    ...overrides,
  };
}

function propertyProjection(options: {
  query?: string;
  clauses?: PropertyFilterClause[];
  facets?: PropertyFacet[];
} = {}) {
  return projectNavigation({
    query: options.query ?? "",
    scope: { kind: "folder", path: "notes", includeSubfolders: true },
    activeTags: ["work"], selectedPath: "notes/A.md",
    favorites: [{ kind: "file", ref: "notes/A.md", label: "A", icon: "file-text", count: 0, missing: false }],
    folders: [
      { name: "/", path: "/", depth: 0, directCount: 1, recursiveCount: 4, recursiveFolderCount: 2, children: [] },
      { name: "notes", path: "notes", depth: 0, directCount: 2, recursiveCount: 3, recursiveFolderCount: 1,
        children: [{ name: "child", path: "notes/child", depth: 1, directCount: 1, recursiveCount: 1, recursiveFolderCount: 0, children: [] }] },
    ],
    tags: [{ label: "work", displayTag: "Work", tag: "work", depth: 0, synthetic: false, children: [] }],
    boxes: [{ id: "box-1", name: "Inbox", cardCount: 2 }], tagCounts: { work: 2 },
    includeSubfolders: true, tagsDisabled: false,
    sectionCollapsed: { favorites: false, folders: false, tags: false, properties: false, boxes: false },
    sectionOrder: defaultNavSectionOrder(),
    sectionLabels: {
      favorites: { label: "Favorites", emptyLabel: "No favorites yet — right-click an item to add one" },
      folders: { label: "Folders", emptyLabel: null }, tags: { label: "Tags", emptyLabel: null },
      properties: { label: "Properties", emptyLabel: "No properties selected — choose which properties to show" },
      boxes: { label: "Boxes", emptyLabel: "No card boxes yet — right-click to create one" },
    },
    rootFolderLabel: "Root /",
    expansion: {
      folders: { manual: ["notes"], reveal: [], query: [], suppressed: [] },
      tags: { manual: [], reveal: [], query: [], suppressed: [] }, queryCollapsedSections: [],
      properties: { manual: ["status"], reveal: [], query: [], suppressed: [] },
    },
    properties: options.facets ?? [propertyFacet()],
    propertyClauses: options.clauses ?? [],
  });
}

function nav(overrides: Partial<PanelNavState> = {}): PanelNavState {
  return {
    folderTree: [], favorites: [], boxSummaries: [], paneWidth: 240, layoutMode: "dual", visible: true,
    sectionCollapsed: { favorites: false, folders: false, tags: false, properties: false, boxes: false }, showItemCounts: true,
    tooltipSide: "right", propertyFilterCount: 0, projection: projection(), query: "", focusId: "section:favorites",
    focusRequest: null, revealRequest: null,
    ...overrides,
  };
}

const scope: PanelScopeState = {
  displayPath: "notes", includeSubfolders: true, activeBoxId: null, activeBoxName: null,
  boxExcludedCount: 0, emptyStateMessage: "",
};

function render(options: {
  nav?: PanelNavState;
  scope?: PanelScopeState;
  activeFilterTags?: string[];
  strings?: UiStrings;
  onIntent?: (intent: NavigationIntent) => void;
  onMenu?: (payload: NavContextMenuPayload) => void;
  onPropertyCommand?: (payload: { command: "choose-visible" | "clear-filters" }) => void;
  onResize?: (width: number) => void;
} = {}) {
  const target = document.createElement("div");
  target.className = "folder-card-view";
  document.body.appendChild(target);
  const component = mount(NavigationPane, { target, props: {
    strings: options.strings ?? getUiStrings("en"), nav: options.nav ?? nav(), scope: options.scope ?? scope,
    activeFilterTags: options.activeFilterTags ?? ["work"], onNavigationIntent: options.onIntent,
    onNavContextMenu: options.onMenu, onPropertyCommand: options.onPropertyCommand,
    onNavPaneResize: options.onResize,
  } });
  components.push(component);
  return component;
}

function renderHarness(initialNav: PanelNavState, onIntent: (intent: NavigationIntent) => void) {
  const target = document.createElement("div");
  target.className = "folder-card-view";
  document.body.appendChild(target);
  const component = mount(NavigationPaneHarness, {
    target,
    props: { initialNav, scope, activeFilterTags: ["work"], onIntent },
  });
  components.push(component);
  return component as typeof component & { setNav: (next: PanelNavState) => void };
}

function row(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-nav-row-id="${id}"]`)!;
}

/** Property row IDs embed JSON-encoded text (quotes/brackets); find them by value, not CSS selector. */
function findRow(id: string): HTMLElement {
  const match = Array.from(document.querySelectorAll<HTMLElement>("[data-nav-row-id]"))
    .find((node) => node.dataset.navRowId === id);
  if (!match) throw new Error(`navigation row not found: ${id}`);
  return match;
}

describe("NavigationPane projected ARIA tree", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(async () => {
    await Promise.all(components.splice(0).map((component) => unmount(component)));
    document.body.innerHTML = "";
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    if (originalScrollIntoView) HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  it("defines every tree key without handling Tab or unrelated host keys", () => {
    const rows = projection().rows;
    const command = (key: string, rowId: string, shiftKey = false) =>
      resolveNavigationKey({ key, shiftKey }, rows, rowId);
    expect(command("ArrowDown", "section:favorites")).toEqual({ type: "focus", rowId: "favorite:file:notes/A.md" });
    expect(command("ArrowUp", "favorite:file:notes/A.md")).toEqual({ type: "focus", rowId: "section:favorites" });
    expect(command("Home", "box:box-1")).toEqual({ type: "focus", rowId: "section:favorites" });
    expect(command("End", "section:favorites")).toEqual({ type: "focus", rowId: "box:box-1" });
    expect(command("ArrowRight", "section:favorites")).toEqual({ type: "focus", rowId: "favorite:file:notes/A.md" });
    expect(command("ArrowRight", "folder:notes")).toEqual({ type: "focus", rowId: "folder:notes/child" });
    expect(command("ArrowLeft", "folder:notes/child")).toEqual({ type: "focus", rowId: "folder:notes" });
    expect(command("ArrowLeft", "folder:notes")).toEqual({ type: "expand", rowId: "folder:notes", expanded: false });
    expect(command("Enter", "tag:work")).toEqual({ type: "activate", rowId: "tag:work", mode: "ordinary" });
    expect(command(" ", "tag:work")).toEqual({ type: "activate", rowId: "tag:work", mode: "additive" });
    expect(command("ContextMenu", "tag:work")).toEqual({ type: "menu", rowId: "tag:work" });
    expect(command("F10", "tag:work", true)).toEqual({ type: "menu", rowId: "tag:work" });
    expect(command("Tab", "tag:work")).toBeNull();
    expect(resolveSeparatorWidth("ArrowRight", 240, false, true)).toBe(232);
    expect(resolveSeparatorWidth("ArrowLeft", 160, false, false)).toBeNull();
  });

  it("renders one flat tree with one roving target and no sequential embedded controls", () => {
    render();
    expect(document.querySelectorAll('[role="tree"]')).toHaveLength(1);
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    expect(items.filter((item) => item.tabIndex === 0).map((item) => item.dataset.navRowId)).toEqual(["section:favorites"]);
    expect(Array.from(document.querySelectorAll<HTMLElement>('[role="treeitem"] button')).every((button) => button.tabIndex === -1)).toBe(true);
    expect(row("folder:notes").getAttribute("aria-current")).toBe("page");
    expect(row("tag:work").getAttribute("aria-checked")).toBe("true");
    expect(row("favorite:file:notes/A.md").hasAttribute("aria-current")).toBe(false);
    expect(row("favorite:file:notes/A.md").hasAttribute("aria-checked")).toBe(false);
    expect(row("folder:notes/child").hasAttribute("aria-expanded")).toBe(false);
    expect(row("folder:").querySelector(".fce-tree-label")?.textContent).toBe("Root /");
    expect(row("folder:notes").querySelector(".fce-tree-label")?.textContent).toBe("notes");
    expect(document.querySelector('[role="tree"]')?.hasAttribute("aria-label")).toBe(false);
    expect(document.querySelector('[role="tree"]')?.hasAttribute("aria-labelledby")).toBe(true);
  });

  it("restores 1.1.5 item hover tooltips instead of the pane accessible name", async () => {
    render();
    await tick();
    expect(row("folder:").getAttribute("data-tooltip")).toBe("4 files, 2 folders");
    expect(row("folder:notes").getAttribute("data-tooltip")).toBe("3 files, 1 folder");
    expect(row("tag:work").getAttribute("data-tooltip")).toBe("2 files, 0 subtags");
    expect(row("box:box-1").getAttribute("data-tooltip")).toBe("2 files");
    expect(row("favorite:file:notes/A.md").getAttribute("data-tooltip")).toBe("A");
    expect(row("section:favorites").getAttribute("data-tooltip")).toBeNull();
  });

  it("keeps count tooltips when the visible count badges are hidden", async () => {
    render({ nav: nav({ showItemCounts: false }) });
    await tick();
    expect(row("folder:notes").querySelector(".fce-nav-row-count")).toBeNull();
    expect(row("folder:notes").getAttribute("data-tooltip")).toBe("3 files, 1 folder");
    expect(row("tag:work").getAttribute("data-tooltip")).toBe("2 files, 0 subtags");
  });

  it("keeps the navigation search icon inside a stable icon-input-clear layout", async () => {
    render();
    await tick();
    const filter = document.querySelector<HTMLElement>(".fce-nav-filter")!;
    expect(Array.from(filter.children).map((child) => child.tagName)).toEqual(["LABEL", "SPAN", "INPUT"]);
    expect(filter.querySelector<HTMLElement>(".fce-nav-filter-icon")?.dataset.icon).toBe("search");
    expect(filter.querySelector(".fce-nav-filter-clear")).toBeNull();

    render({ nav: nav({ query: "work", projection: projection("work") }) });
    await tick();
    const populatedFilter = document.querySelectorAll<HTMLElement>(".fce-nav-filter")[1]!;
    expect(Array.from(populatedFilter.children).map((child) => child.tagName)).toEqual(["LABEL", "SPAN", "INPUT", "BUTTON"]);
    expect(populatedFilter.querySelector<HTMLButtonElement>(".fce-nav-filter-clear")?.getAttribute("aria-label")).toBe("Clear navigation filter");
  });

  it("prefers a restored visible current range when the tree is entered for the first time", async () => {
    const intents: NavigationIntent[] = [];
    const restored = projection();
    const loading = {
      ...restored,
      rows: restored.rows.filter((candidate) => candidate.kind === "section" || candidate.section !== "folders"),
    };
    const component = renderHarness(
      nav({ focusId: null, projection: loading }),
      (intent) => intents.push(intent),
    );
    await tick(); await tick();
    expect(row("section:favorites").tabIndex).toBe(0);
    expect(intents).not.toContainEqual(expect.objectContaining({ type: "focus" }));

    component.setNav(nav({ focusId: null, projection: restored }));
    await tick(); await tick();
    expect(row("section:favorites").tabIndex).toBe(-1);
    expect(row("folder:notes").tabIndex).toBe(0);
    expect(intents).not.toContainEqual(expect.objectContaining({ type: "focus" }));

    const input = document.querySelector<HTMLInputElement>('input[aria-label="Filter navigation"]')!;
    input.focus();
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    input.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(row("folder:notes"));
    expect(intents).toContainEqual({ type: "focus", rowId: "folder:notes" });
  });

  it("keeps forward filter Tab inside its own mounted navigation instance", async () => {
    const firstIntents: NavigationIntent[] = [];
    const secondIntents: NavigationIntent[] = [];
    render({ nav: nav({ focusId: null }), onIntent: (intent) => firstIntents.push(intent) });
    render({ nav: nav({ layoutMode: "single", focusId: "box:box-1" }), onIntent: (intent) => secondIntents.push(intent) });
    await tick();
    const [firstView, secondView] = Array.from(document.querySelectorAll<HTMLElement>(".folder-card-view"));
    const firstInput = firstView.querySelector<HTMLInputElement>('input[aria-label="Filter navigation"]')!;
    const localCurrent = firstView.querySelector<HTMLElement>('[data-nav-row-id="folder:notes"]')!;
    const foreignBack = secondView.querySelector<HTMLButtonElement>(".fce-nav-header-button")!;
    foreignBack.focus(); firstInput.focus();

    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    firstInput.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(localCurrent);
    expect(document.activeElement).not.toBe(foreignBack);
    expect(firstIntents).toContainEqual({ type: "focus", rowId: "folder:notes" });
    expect(secondIntents).toEqual([]);
  });

  it("uses the local fallback but leaves backward, hidden, and no-result Tab native", async () => {
    const base = projection();
    const withoutCurrent = { ...base, rows: base.rows.filter((candidate) => candidate.kind !== "folder") };
    render({ nav: nav({ focusId: null, projection: withoutCurrent }) });
    render({ nav: nav({ visible: false, focusId: null }) });
    render({ nav: nav({ focusId: null, query: "missing", projection: projection("missing") }) });
    await tick();
    const [fallbackView, hiddenView, emptyView] = Array.from(document.querySelectorAll<HTMLElement>(".folder-card-view"));
    const fallbackInput = fallbackView.querySelector<HTMLInputElement>('input[aria-label="Filter navigation"]')!;
    const fallback = fallbackView.querySelector<HTMLElement>('[data-nav-row-id="section:favorites"]')!;
    fallbackInput.focus();
    const forward = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    fallbackInput.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(fallback);

    fallbackInput.focus();
    const backward = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    fallbackInput.dispatchEvent(backward);
    expect(backward.defaultPrevented).toBe(false);
    const hiddenTab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    hiddenView.querySelector<HTMLInputElement>('input[aria-label="Filter navigation"]')!.dispatchEvent(hiddenTab);
    expect(hiddenTab.defaultPrevented).toBe(false);
    const emptyTab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    emptyView.querySelector<HTMLInputElement>('input[aria-label="Filter navigation"]')!.dispatchEvent(emptyTab);
    expect(emptyTab.defaultPrevented).toBe(false);
  });

  it("keeps current range, checked filter, and active file semantics independent", () => {
    render();
    const range = row("folder:notes");
    const checked = row("tag:work");
    const file = row("favorite:file:notes/A.md");
    expect(range.classList.contains("is-current-range")).toBe(true);
    expect(range.classList.contains("is-checked-filter")).toBe(false);
    expect(range.hasAttribute("aria-checked")).toBe(false);
    expect(checked.classList.contains("is-checked-filter")).toBe(true);
    expect(checked.classList.contains("is-current-range")).toBe(false);
    expect(checked.hasAttribute("aria-current")).toBe(false);
    expect(checked.querySelector(".fce-tree-button")?.hasAttribute("aria-checked")).toBe(false);
    expect(file.classList.contains("is-active-file")).toBe(true);
    expect(file.classList.contains("is-current-range")).toBe(false);
    expect(file.classList.contains("is-checked-filter")).toBe(false);
    expect(file.hasAttribute("aria-current")).toBe(false);
    expect(file.hasAttribute("aria-checked")).toBe(false);
    expect(document.querySelector(".fce-tree-row.is-selected")).toBeNull();
  });

  it("renders occupied blank-query section copy in order and hides it for query no-results", async () => {
    const base = projection();
    const emptyRows = base.rows.filter((candidate) => candidate.kind === "section" || candidate.section === "folders");
    render({
      nav: nav({ projection: { ...base, rows: emptyRows } }),
      scope: { ...scope, activeBoxId: "box-1" },
      activeFilterTags: [],
    });
    expect(Array.from(document.querySelectorAll<HTMLElement>("[data-nav-empty-section]")).map((node) => [
      node.dataset.navEmptySection, node.textContent?.trim(),
    ])).toEqual([
      ["favorites", "No favorites yet — right-click an item to add one"],
      ["tags", "Tag filter is unavailable in a box"],
      ["properties", "Property filter is unavailable in a box"],
      ["boxes", "No card boxes yet — right-click to create one"],
    ]);
    await unmount(components.pop()!);
    render({ nav: nav({ projection: { ...base, rows: emptyRows } }), activeFilterTags: [] });
    expect(document.querySelector('[data-nav-empty-section="tags"]')?.textContent?.trim()).toBe("No tags found");
    await unmount(components.pop()!);
    const noMatch = projection("does-not-exist");
    render({ nav: nav({ query: "does-not-exist", projection: noMatch }) });
    expect(document.querySelector(".fce-nav-no-results")?.textContent).toBe("No navigation items found");
    expect(document.querySelector("[data-nav-empty-section]")).toBeNull();
  });

  it("keeps the first visible section as the tree's first child so filtered sections drop their separator", () => {
    render();
    const tree = document.querySelector<HTMLElement>('[role="tree"]')!;
    expect(tree.firstElementChild?.getAttribute("data-nav-row-id")).toBe("section:favorites");
    unmount(components.pop()!);
    document.body.innerHTML = "";
    const filtered = projection("child");
    expect(filtered.rows.filter((candidate) => candidate.kind === "section").map((candidate) => candidate.id))
      .toEqual(["section:folders"]);
    render({ nav: nav({ query: "child", projection: filtered, focusId: "section:folders" }) });
    const filteredTree = document.querySelector<HTMLElement>('[role="tree"]')!;
    expect(filteredTree.firstElementChild?.getAttribute("data-nav-row-id")).toBe("section:folders");
    expect(filteredTree.firstElementChild?.classList.contains("is-section")).toBe(true);
  });

  it("keeps focus and section chrome when projected section order changes", async () => {
    const focusId = "folder:notes";
    const component = renderHarness(nav({ focusId, projection: projection() }), () => undefined);
    await tick();
    expect(row(focusId).tabIndex).toBe(0);

    const reordered = ["boxes", "tags", "folders", "favorites"] as const;
    component.setNav(nav({ focusId, projection: projection("", [...reordered]) }));
    await tick();

    // C2: the stored old four-section order gains Properties before Boxes.
    expect(document.querySelectorAll('[role="tree"]')).toHaveLength(1);
    const tree = document.querySelector<HTMLElement>('[role="tree"]')!;
    expect(tree.firstElementChild?.getAttribute("data-nav-row-id")).toBe("section:properties");
    const sectionRows = Array.from(document.querySelectorAll<HTMLElement>('[data-nav-row-id^="section:"]'));
    expect(sectionRows.map((node) => node.dataset.navRowId)).toEqual([
      "section:properties", "section:boxes", "section:tags", "section:folders", "section:favorites",
    ]);
    expect(sectionRows.every((node) => node.classList.contains("is-section"))).toBe(true);
    expect(Array.from(document.querySelectorAll<HTMLElement>('[role="treeitem"]'))
      .filter((item) => item.tabIndex === 0)
      .map((item) => item.dataset.navRowId)).toEqual([focusId]);
  });

  it("maps traversal, expansion, activation, additive Space, and keyboard menu keys", async () => {
    const intents: NavigationIntent[] = [];
    const menus: NavContextMenuPayload[] = [];
    render({ onIntent: (intent) => intents.push(intent), onMenu: (payload) => menus.push(payload) });
    const first = row("section:favorites");
    first.focus();
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    row("folder:notes").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    row("tag:work").dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    row("box:box-1").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    row("box:box-1").dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }));
    await tick();
    expect(intents).toContainEqual({ type: "focus", rowId: "favorite:file:notes/A.md" });
    expect(intents).toContainEqual({ type: "set-expanded", rowId: "folder:notes", expanded: false });
    expect(intents).toContainEqual({ type: "activate", rowId: "tag:work", mode: "additive" });
    expect(intents).toContainEqual({ type: "activate", rowId: "box:box-1", mode: "ordinary" });
    expect(menus[0]).toMatchObject({ section: "boxes", scope: "item", itemId: "box-1", originId: "box:box-1", trigger: { kind: "position" } });
  });

  it("moves focus to an ancestor before publishing its descendant-removing collapse", () => {
    const intents: NavigationIntent[] = [];
    render({ onIntent: (intent) => intents.push(intent) });
    row("folder:notes/child").focus();
    row("folder:notes").querySelector<HTMLButtonElement>(".fce-tree-item-disclosure")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(row("folder:notes"));
    expect(intents.slice(-2)).toEqual([
      { type: "focus", rowId: "folder:notes" },
      { type: "set-expanded", rowId: "folder:notes", expanded: false },
    ]);
  });

  it("does not restore stale logical focus over a mounted disclosure", async () => {
    render({ nav: nav({ projection: propertyProjection(), focusId: "section:favorites" }) });
    const keyId = navigationPropertyId("status");
    const disclosure = findRow(keyId).querySelector<HTMLButtonElement>(".fce-tree-item-disclosure")!;

    disclosure.focus();
    await tick(); await tick();

    expect(document.activeElement).toBe(disclosure);
  });

  it("gives a disclosure's owning row focus before publishing its toggle", () => {
    const intents: NavigationIntent[] = [];
    render({ nav: nav({ projection: propertyProjection() }), onIntent: (intent) => intents.push(intent) });
    const keyId = navigationPropertyId("status");
    const keyRow = findRow(keyId);
    const disclosure = keyRow.querySelector<HTMLButtonElement>(".fce-tree-item-disclosure")!;
    const focus = vi.spyOn(keyRow, "focus");

    disclosure.focus();
    disclosure.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(document.activeElement).toBe(keyRow);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(intents.slice(-2)).toEqual([
      { type: "focus", rowId: keyId },
      { type: "set-expanded", rowId: keyId, expanded: false },
    ]);
  });

  it("publishes persistent filter input and Escape clear while respecting IME", () => {
    const intents: NavigationIntent[] = [];
    render({ nav: nav({ query: "wor", projection: projection("wor") }), onIntent: (intent) => intents.push(intent) });
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Filter navigation"]')!;
    input.value = "work";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(intents).toContainEqual({ type: "query-update", query: "work" });
    expect(intents.filter((intent) => intent.type === "query-clear")).toEqual([{ type: "query-clear", origin: "input" }]);
  });

  it("uses equivalent pointer and positioned menu targets", () => {
    const menus: NavContextMenuPayload[] = [];
    render({ onMenu: (payload) => menus.push(payload) });
    const target = row("tag:work");
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 8, clientY: 9 }));
    target.querySelector<HTMLButtonElement>(".fce-nav-row-more")!.click();
    expect(menus.map(({ section, scope: menuScope, itemId, originId }) => ({ section, scope: menuScope, itemId, originId }))).toEqual([
      { section: "tags", scope: "item", itemId: "work", originId: "tag:work" },
      { section: "tags", scope: "item", itemId: "work", originId: "tag:work" },
    ]);
    expect(menus.map((payload) => payload.trigger.kind)).toEqual(["pointer", "position"]);
    expect(menus.every(Object.isFrozen)).toBe(true);
  });

  it("keeps owned section actions out of the tab order and omits the persistent Include control", () => {
    render({ scope: { ...scope, activeBoxId: "box-1" } });
    expect(document.querySelector(".fce-nav-section-include")).toBeNull();
    expect(document.querySelector(".fce-favorites-menu .fce-nav-section-create")).toBeNull();
    expect(document.querySelector(".fce-folder-menu .fce-nav-section-create")).not.toBeNull();
    expect(document.querySelector(".fce-tag-menu .fce-nav-section-clear")).not.toBeNull();
    expect(document.querySelector(".fce-nav-box-menu .fce-nav-section-create")).not.toBeNull();
    expect(Array.from(document.querySelectorAll<HTMLElement>(".fce-nav-row-actions button"))
      .every((button) => button.tabIndex === -1)).toBe(true);
  });

  it("places counts and actions in one stable trailing slot", () => {
    render();
    const folder = row("folder:notes");
    const trailing = folder.querySelector<HTMLElement>(":scope > .fce-nav-row-trailing")!;
    const summary = trailing.querySelector<HTMLElement>(":scope > .fce-nav-row-summary")!;
    const actions = trailing.querySelector<HTMLElement>(":scope > .fce-nav-row-actions")!;

    expect(folder.querySelector(".fce-tree-button .fce-nav-row-count")).toBeNull();
    expect(summary.querySelector(".fce-nav-row-count")?.textContent).toBe("3");
    expect(actions.querySelector(".fce-nav-row-more")).not.toBeNull();
    expect(trailing.children).toEqual(expect.objectContaining({ length: 2 }));

    const tagHeader = row("section:tags");
    expect(tagHeader.querySelector(".fce-nav-row-summary .fce-nav-active-tag-count")?.textContent).toBe("1");
    expect(tagHeader.querySelector(".fce-nav-row-actions .fce-nav-section-clear")).not.toBeNull();
  });

  it("keeps expandable ancestors in hover affordance state while the pointer is in their subtree", async () => {
    render();
    await tick();
    const parent = row("folder:notes");
    const child = row("folder:notes/child");
    const identity = parent.querySelector(".fce-tree-item-identity");
    const chevron = parent.querySelector(".fce-tree-item-chevron");
    expect(identity).not.toBeNull();
    expect(chevron).not.toBeNull();
    expect(parent.classList.contains("is-subtree-hovered")).toBe(false);

    child.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    await tick();
    expect(parent.classList.contains("is-subtree-hovered")).toBe(true);
    expect(child.classList.contains("is-subtree-hovered")).toBe(true);
    expect(row("section:folders").classList.contains("is-subtree-hovered")).toBe(false);

    document.querySelector<HTMLElement>(".fce-nav-tree")?.dispatchEvent(new MouseEvent("pointerleave"));
    await tick();
    expect(parent.classList.contains("is-subtree-hovered")).toBe(false);
  });

  it("clears hover lineage when the filtered tree unmounts and remounts", async () => {
    const component = renderHarness(nav(), () => undefined);
    await tick();
    row("folder:notes/child").dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    await tick();
    expect(row("folder:notes").classList.contains("is-subtree-hovered")).toBe(true);

    component.setNav(nav({ query: "missing", projection: projection("missing") }));
    await tick();
    component.setNav(nav());
    await tick();
    expect(row("folder:notes").classList.contains("is-subtree-hovered")).toBe(false);
  });

  it("exposes and operates the keyboard separator including boundaries", () => {
    const widths: number[] = [];
    render({ onResize: (width) => widths.push(width) });
    const separator = document.querySelector<HTMLElement>('[role="separator"]')!;
    expect(separator.tabIndex).toBe(0);
    expect(separator.getAttribute("aria-valuemin")).toBe("160");
    expect(separator.getAttribute("aria-valuenow")).toBe("240");
    separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true, cancelable: true }));
    separator.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    separator.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    separator.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    expect(widths).toEqual([248, 216, 160, 480]);
  });

  it("cancels pointer resize without persisting the transient width", async () => {
    const widths: number[] = [];
    render({ onResize: (width) => widths.push(width) });
    const separator = document.querySelector<HTMLElement>('[role="separator"]')!;
    separator.setPointerCapture = vi.fn();
    separator.releasePointerCapture = vi.fn();
    const pointer = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
      Object.defineProperty(event, "pointerId", { value: 7 });
      separator.dispatchEvent(event);
    };
    pointer("pointerdown", 100);
    pointer("pointermove", 180);
    await tick();
    expect(document.querySelector<HTMLElement>(".fce-nav-pane")?.style.width).toBe("320px");
    pointer("pointercancel", 180);
    await tick();
    expect(widths).toEqual([]);
    expect(document.querySelector<HTMLElement>(".fce-nav-pane")?.style.width).toBe("240px");
  });

  it("consumes a mounted reveal once without scrolling a fully visible row", async () => {
    const intents: NavigationIntent[] = [];
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    render({ nav: nav({ revealRequest: { token: 4, rowId: "folder:notes" } }), onIntent: (intent) => intents.push(intent) });
    await tick(); await tick();
    expect(scroll).not.toHaveBeenCalled();
    expect(intents).toContainEqual({ type: "reveal-consumed", token: 4 });
  });

  it("restores real DOM focus after a menu closes even when the tree no longer owns focus", async () => {
    const intents: NavigationIntent[] = [];
    render({
      nav: nav({ focusId: "tag:work", focusRequest: { token: 1, rowId: "tag:work" } }),
      onIntent: (intent) => intents.push(intent),
    });
    await tick(); await tick();
    expect(document.activeElement).toBe(row("tag:work"));
    expect(intents.filter((intent) => intent.type === "focus-return-consumed")).toEqual([
      { type: "focus-return-consumed", token: 1 },
    ]);
  });

  it("scrolls an out-of-bounds reveal nearest", async () => {
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.dataset.navRowId === "folder:notes") return { top: 120, bottom: 140, left: 0, right: 100 } as DOMRect;
      if (this.classList.contains("fce-nav-pane-sections")) return { top: 0, bottom: 100, left: 0, right: 100 } as DOMRect;
      return originalRect.call(this);
    };
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    const consumed: NavigationIntent[] = [];
    render({ nav: nav({ revealRequest: { token: 5, rowId: "folder:notes" } }), onIntent: (intent) => consumed.push(intent) });
    await tick(); await tick();
    expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
    expect(consumed).toContainEqual({ type: "reveal-consumed", token: 5 });
  });

  it("defers hidden reveal requests, consumes them once when visible, and rejects stale tokens", async () => {
    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll;
    const hidden: NavigationIntent[] = [];
    const component = renderHarness(
      nav({ visible: false, revealRequest: { token: 6, rowId: "folder:notes" } }),
      (intent) => hidden.push(intent),
    );
    await tick(); await tick();
    expect(hidden).not.toContainEqual({ type: "reveal-consumed", token: 6 });
    component.setNav(nav({ visible: true, revealRequest: { token: 6, rowId: "folder:notes" } }));
    await tick(); await tick();
    expect(hidden.filter((intent) => intent.type === "reveal-consumed")).toEqual([
      { type: "reveal-consumed", token: 6 },
    ]);
    component.setNav(nav({ visible: true, revealRequest: { token: 6, rowId: "folder:notes" } }));
    await tick(); await tick();
    expect(hidden.filter((intent) => intent.type === "reveal-consumed")).toHaveLength(1);
    component.setNav(nav({ visible: false, revealRequest: { token: 7, rowId: "folder:notes" } }));
    await tick(); await tick();
    component.setNav(nav({ visible: true, revealRequest: { token: 8, rowId: "folder:notes" } }));
    await tick(); await tick();
    expect(hidden).not.toContainEqual({ type: "reveal-consumed", token: 7 });
    expect(hidden.filter((intent) => intent.type === "reveal-consumed")).toEqual([
      { type: "reveal-consumed", token: 6 },
      { type: "reveal-consumed", token: 8 },
    ]);
  });

  it("renders property key and value rows inside the single navigation tree", async () => {
    const keyId = navigationPropertyId("status");
    const valueId = navigationPropertyValueId("status", { kind: "text", value: "Open" });
    render({ nav: nav({ projection: propertyProjection() }) });
    await tick();

    expect(document.querySelectorAll('[role="tree"]')).toHaveLength(1);
    expect(document.querySelectorAll(".fce-nav-pane-sections")).toHaveLength(1);

    const keyRow = findRow(keyId);
    expect(keyRow.getAttribute("aria-level")).toBe("2");
    expect(keyRow.classList.contains("fce-property-menu")).toBe(true);
    expect(keyRow.querySelector<HTMLElement>(".fce-tree-item-identity")?.dataset.icon).toBe("list");
    expect(keyRow.querySelector<HTMLButtonElement>("button.fce-tree-item-disclosure")).not.toBeNull();

    const valueRow = findRow(valueId);
    expect(valueRow.getAttribute("aria-level")).toBe("3");
    expect(valueRow.classList.contains("fce-property-menu")).toBe(true);
    expect(valueRow.querySelector<HTMLElement>(".fce-tree-item-identity")?.dataset.icon).toBe("dot");
    expect(valueRow.querySelector<HTMLButtonElement>("button.fce-tree-item-disclosure")).toBeNull();
    expect(valueRow.querySelectorAll(".fce-tree-item-disclosure.is-placeholder")).toHaveLength(1);
  });

  it("exposes aria-checked only on property value rows, keyed to checked-filter state", () => {
    const openId = navigationPropertyValueId("status", { kind: "text", value: "Open" });
    const closedId = navigationPropertyValueId("status", { kind: "text", value: "Closed" });
    const keyId = navigationPropertyId("status");
    render({
      nav: nav({
        propertyFilterCount: 1,
        projection: propertyProjection({ clauses: [{ key: "status", values: [{ kind: "text", value: "Open" }] }] }),
      }),
    });

    expect(findRow(openId).getAttribute("aria-checked")).toBe("true");
    expect(findRow(closedId).getAttribute("aria-checked")).toBe("false");
    expect(findRow(keyId).hasAttribute("aria-checked")).toBe(false);
    expect(row("section:properties").hasAttribute("aria-checked")).toBe(false);
  });

  it("summarizes the active property filter count on the section row", async () => {
    render({ nav: nav({ propertyFilterCount: 2, projection: propertyProjection() }) });
    const summary = row("section:properties").querySelector<HTMLElement>(".fce-nav-active-property-count");
    expect(summary?.textContent).toBe("2");
    expect(summary?.getAttribute("aria-label")).toBe("2 property filters active");

    await unmount(components.pop()!);
    render({ nav: nav({ propertyFilterCount: 0, projection: propertyProjection() }) });
    expect(row("section:properties").querySelector(".fce-nav-active-property-count")).toBeNull();
  });

  it("localizes the property filter summary for Chinese", () => {
    render({ nav: nav({ propertyFilterCount: 1, projection: propertyProjection() }), strings: getUiStrings("zh") });
    const summary = row("section:properties").querySelector<HTMLElement>(".fce-nav-active-property-count");
    expect(summary?.textContent).toBe("1");
    expect(summary?.getAttribute("aria-label")).toBe("已启用 1 个属性筛选");
  });

  it("renders the choose-visible header action when no property filter is active", async () => {
    const commands: Array<{ command: "choose-visible" | "clear-filters" }> = [];
    render({
      nav: nav({ propertyFilterCount: 0, projection: propertyProjection() }),
      onPropertyCommand: (payload) => commands.push(payload),
    });
    await tick();
    const choose = row("section:properties").querySelector<HTMLButtonElement>(".fce-nav-section-choose");
    expect(choose?.dataset.icon).toBe("settings-2");
    expect(choose?.getAttribute("aria-label")).toBe("Choose visible properties");
    expect(choose?.tabIndex).toBe(-1);
    expect(row("section:properties").querySelector(".fce-nav-section-clear")).toBeNull();
    choose?.click();
    await tick();
    expect(commands).toEqual([{ command: "choose-visible" }]);
  });

  it("renders the clear header action when property filters are active", async () => {
    const commands: Array<{ command: "choose-visible" | "clear-filters" }> = [];
    render({
      nav: nav({ propertyFilterCount: 2, projection: propertyProjection() }),
      onPropertyCommand: (payload) => commands.push(payload),
    });
    await tick();
    const clear = row("section:properties").querySelector<HTMLButtonElement>(".fce-nav-section-clear");
    expect(clear?.dataset.icon).toBe("filter-x");
    expect(clear?.getAttribute("aria-label")).toBe("Clear property filters");
    expect(clear?.tabIndex).toBe(-1);
    expect(row("section:properties").querySelector(".fce-nav-section-choose")).toBeNull();
    clear?.click();
    await tick();
    expect(commands).toEqual([{ command: "clear-filters" }]);
  });

  it("maps pointer additive selection on value rows and expansion toggling on key rows", () => {
    const intents: NavigationIntent[] = [];
    render({ nav: nav({ projection: propertyProjection() }), onIntent: (intent) => intents.push(intent) });
    const valueId = navigationPropertyValueId("status", { kind: "text", value: "Open" });
    const keyId = navigationPropertyId("status");
    const valueRow = findRow(valueId);

    valueRow.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(intents).toContainEqual({ type: "activate", rowId: valueId, mode: "additive" });
    valueRow.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
    expect(intents).toContainEqual({ type: "activate", rowId: valueId, mode: "additive" });
    valueRow.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(intents).toContainEqual({ type: "activate", rowId: valueId, mode: "ordinary" });

    // A Ctrl-click on a key row still activates ordinarily — property keys are
    // never additive filter selection — and its disclosure toggles expansion.
    findRow(keyId).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(intents).not.toContainEqual({ type: "activate", rowId: keyId, mode: "additive" });
    expect(intents).toContainEqual({ type: "activate", rowId: keyId, mode: "ordinary" });
    findRow(keyId).querySelector<HTMLButtonElement>(".fce-tree-item-disclosure")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(intents).toContainEqual({ type: "set-expanded", rowId: keyId, expanded: false });
  });

  it("maps property keyboard activation and expansion keys", () => {
    const intents: NavigationIntent[] = [];
    render({ nav: nav({ projection: propertyProjection() }), onIntent: (intent) => intents.push(intent) });
    const valueId = navigationPropertyValueId("status", { kind: "text", value: "Open" });
    const keyId = navigationPropertyId("status");

    findRow(valueId).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(intents).toContainEqual({ type: "activate", rowId: valueId, mode: "ordinary" });
    findRow(valueId).dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(intents).toContainEqual({ type: "activate", rowId: valueId, mode: "additive" });

    // Enter on a key row emits an ordinary activate; the host converts it into
    // an expansion toggle (routeNavigationIntent), so no filter is selected.
    findRow(keyId).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(intents).toContainEqual({ type: "activate", rowId: keyId, mode: "ordinary" });
    // ArrowLeft on the expanded key row collapses it through set-expanded.
    findRow(keyId).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    expect(intents).toContainEqual({ type: "set-expanded", rowId: keyId, expanded: false });
  });

  it("renders the localized empty copy for an expanded empty Properties section", () => {
    render({ nav: nav({ projection: propertyProjection({ facets: [] }) }) });
    expect(document.querySelector('[role="tree"]')).not.toBeNull();
    expect(row("section:properties")).not.toBeNull();
    const empty = document.querySelector<HTMLElement>('[data-nav-empty-section="properties"]');
    expect(empty?.textContent?.trim()).toBe("No properties selected — choose which properties to show");
    expect(document.querySelector('[data-nav-row-id^="property:"]')).toBeNull();
  });

  it("renders the properties disabled-in-box copy and pins the chooser action in a box (V-S)", async () => {
    const base = projection();
    const emptyRows = base.rows.filter((candidate) => candidate.kind === "section" || candidate.section === "folders");
    const boxScope = { ...scope, activeBoxId: "box-1" };
    const commands: Array<{ command: "choose-visible" | "clear-filters" }> = [];
    render({
      nav: nav({ projection: { ...base, rows: emptyRows }, propertyFilterCount: 2 }),
      scope: boxScope,
      activeFilterTags: [],
      onPropertyCommand: (payload) => commands.push(payload),
    });
    await tick();
    expect(document.querySelector('[data-nav-empty-section="properties"]')?.textContent?.trim())
      .toBe("Property filter is unavailable in a box");
    expect(row("section:properties").querySelector(".fce-nav-section-clear")).toBeNull();
    const choose = row("section:properties").querySelector<HTMLButtonElement>(".fce-nav-section-choose");
    expect(choose).not.toBeNull();
    choose?.click();
    await tick();
    expect(commands).toEqual([{ command: "choose-visible" }]);

    await unmount(components.pop()!);
    render({
      nav: nav({ projection: { ...base, rows: emptyRows } }),
      scope: boxScope,
      activeFilterTags: [],
      strings: getUiStrings("zh"),
    });
    expect(document.querySelector('[data-nav-empty-section="properties"]')?.textContent?.trim())
      .toBe("卡片盒模式下不可使用属性筛选");
  });

  it("keeps property key/value action slots limited to the shared more button", async () => {
    render({ nav: nav({ projection: propertyProjection() }) });
    await tick();
    const keyId = navigationPropertyId("status");
    const valueId = navigationPropertyValueId("status", { kind: "text", value: "Open" });

    for (const id of [keyId, valueId]) {
      const node = findRow(id);
      expect(node.querySelector(".fce-nav-section-choose")).toBeNull();
      expect(node.querySelector(".fce-nav-section-clear")).toBeNull();
      const actionButtons = node.querySelectorAll<HTMLButtonElement>(".fce-nav-row-actions button");
      expect(actionButtons).toHaveLength(1);
      expect(actionButtons[0].classList.contains("fce-nav-row-more")).toBe(true);
      expect(actionButtons[0].tabIndex).toBe(-1);
    }

    // The section header owns the single section action button alongside the more
    // button; value rows have no disclosure and no tabbable child other than the
    // row itself (its roving tab stop lives on the treeitem, not a nested control).
    const sectionButtons = row("section:properties").querySelectorAll<HTMLButtonElement>(".fce-nav-row-actions button");
    expect(sectionButtons).toHaveLength(2);
    const valueRow = findRow(valueId);
    expect(valueRow.querySelector("button.fce-tree-item-disclosure")).toBeNull();
    expect(Array.from(valueRow.querySelectorAll<HTMLElement>("*"))
      .filter((child) => child.tabIndex === 0)).toEqual([]);
  });
});
