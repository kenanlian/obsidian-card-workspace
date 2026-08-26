import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import { getUiStrings } from "../i18n";
import type { PanelNavState, PanelScopeState } from "./panel-model";
import type { NavigationIntent } from "./navigation-model";
import { resolveNavigationKey, resolveSeparatorWidth } from "./navigation-keyboard";
import { projectNavigation } from "./navigation-projection";
import NavigationPane from "./NavigationPane.svelte";
import NavigationPaneHarness from "../__mocks__/NavigationPaneHarness.svelte";
import type { NavContextMenuPayload } from "./types";

const components: Array<Record<string, unknown>> = [];
const originalRect = HTMLElement.prototype.getBoundingClientRect;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

function projection(query = "") {
  return projectNavigation({
    query,
    scope: { kind: "folder", path: "notes", includeSubfolders: true },
    activeTags: ["work"], selectedPath: "notes/A.md",
    favorites: [{ kind: "file", ref: "notes/A.md", label: "A", icon: "file-text", count: 0, missing: false }],
    folders: [
      { name: "notes", path: "notes", depth: 0, directCount: 2, recursiveCount: 3, recursiveFolderCount: 1,
        children: [{ name: "child", path: "notes/child", depth: 1, directCount: 1, recursiveCount: 1, recursiveFolderCount: 0, children: [] }] },
    ],
    tags: [{ label: "work", displayTag: "Work", tag: "work", depth: 0, synthetic: false, children: [] }],
    boxes: [{ id: "box-1", name: "Inbox", cardCount: 2 }], tagCounts: { work: 2 },
    includeSubfolders: true, showItemCounts: true, tagsDisabled: false,
    sectionCollapsed: { favorites: false, folders: false, tags: false, boxes: false },
    sectionLabels: {
      favorites: { label: "Favorites", emptyLabel: "No favorites yet — right-click an item to add one" },
      folders: { label: "Folders", emptyLabel: null }, tags: { label: "Tags", emptyLabel: null },
      boxes: { label: "Boxes", emptyLabel: "No card boxes yet — right-click to create one" },
    },
    expansion: {
      folders: { manual: ["notes"], reveal: [], query: [], suppressed: [] },
      tags: { manual: [], reveal: [], query: [], suppressed: [] }, queryCollapsedSections: [],
    },
  });
}

function nav(overrides: Partial<PanelNavState> = {}): PanelNavState {
  return {
    folderTree: [], favorites: [], boxSummaries: [], paneWidth: 240, layoutMode: "dual", visible: true,
    sectionCollapsed: { favorites: false, folders: false, tags: false, boxes: false }, showItemCounts: true,
    tooltipSide: "right", projection: projection(), query: "", focusId: "section:favorites",
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
  onIntent?: (intent: NavigationIntent) => void;
  onMenu?: (payload: NavContextMenuPayload) => void;
  onResize?: (width: number) => void;
} = {}) {
  const target = document.createElement("div");
  target.className = "folder-card-view";
  document.body.appendChild(target);
  const component = mount(NavigationPane, { target, props: {
    strings: getUiStrings("en"), nav: options.nav ?? nav(), scope: options.scope ?? scope,
    activeFilterTags: options.activeFilterTags ?? ["work"], onNavigationIntent: options.onIntent,
    onNavContextMenu: options.onMenu, onNavPaneResize: options.onResize,
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
    expect(row("folder:notes").querySelector(".fce-tree-label")?.getAttribute("title")).toBe("notes");
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
    row("folder:notes").querySelector<HTMLButtonElement>(".fce-tree-item-icon")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(row("folder:notes"));
    expect(intents.slice(-2)).toEqual([
      { type: "focus", rowId: "folder:notes" },
      { type: "set-expanded", rowId: "folder:notes", expanded: false },
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
    const identity = parent.querySelector(".fce-tree-item-glyph");
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
});
