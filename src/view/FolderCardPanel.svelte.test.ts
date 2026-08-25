import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import { getUiStrings } from "../i18n";
import FolderCardPanel from "./FolderCardPanel.svelte";
import { createPanelModel, type PanelModelState } from "./panel-model";
import type { CardFileKind } from "./file-kind";
import type { HydrateViewportRequest } from "./hydration-request";
import type { NoteCardRecord } from "./types";

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  private nodes: Element[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.instances.push(this);
  }

  observe(node: Element): void {
    this.nodes.push(node);
  }

  disconnect(): void {
    this.nodes = [];
  }

  static reset(): void {
    ResizeObserverStub.instances = [];
  }

  static trigger(): void {
    for (const observer of ResizeObserverStub.instances) {
      observer.callback(observer.nodes.map((target) => ({ target }) as ResizeObserverEntry), observer as never);
    }
  }
}

function createCard(path: string, title: string, fileKind: CardFileKind = "markdown"): NoteCardRecord {
  return {
    file: {} as never,
    fileKind,
    path,
    title,
    ctime: new Date("2024-01-02T10:00:00Z").getTime(),
    mtime: new Date("2024-02-03T12:00:00Z").getTime(),
    excerpt: "excerpt",
    previewHtml: "<p>Preview text</p>",
    previewMode: "text",
    hydrated: true,
  };
}

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
    },
    cards: {
      records: [],
      searchMatchCountsByPath: {},
      selectedPath: null,
      loading: false,
      generation: 0,
      sequenceRevision: 0,
      hydrationRevision: 0,
    },
    search: { query: "", status: "idle", focusToken: 0 },
    projection: {
      sortField: "mtime",
      sortDirection: "desc",
      availableTags: [],
      tagCounts: {},
      activeFilterTags: [],
      pinnedPaths: [],
    },
    bulk: {
      bulkMode: false,
      selectedPaths: [],
      selectedCount: 0,
      bulkAnchorPath: null,
      canBulkSelectAll: false,
      canBulkClearSelection: false,
      canBulkMoveSelected: false,
      canBulkAddTagSelected: false,
      canBulkRemoveTagSelected: false,
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
      sectionCollapsed: { favorites: false, folders: false, tags: false, boxes: false },
      showItemCounts: false,
      tooltipSide: "right",
    },
    appearance: { cardCornerRadius: "compact", previewLines: 5 },
  };
}

describe("FolderCardPanel.svelte", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    ResizeObserverStub.reset();
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
    (globalThis as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
      ResizeObserverStub as never;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders empty state, populated list, and emits an identity-bearing viewport request", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const panelModel = createPanelModel(createInitialPanelState());
    const hydrateEvents: Array<{ generation: number; hydrationRevision: number; start: number; end: number; paths: readonly string[] }> = [];

    const component = mount(FolderCardPanel, {
      target,
      props: {
        panelModel,
        onHydrateViewport: (detail: HydrateViewportRequest) => {
          hydrateEvents.push(detail);
        },
      },
    });

    await tick();
    expect(target.textContent).toContain("No supported files found in this folder.");

    panelModel.mutate((state) => {
      state.cards = {
        ...state.cards,
        records: [createCard("notes/runtime.md", "Runtime note")],
        generation: 1,
      };
      state.scope = {
        ...state.scope,
        emptyStateMessage: "No supported files found in this folder.",
        displayPath: "notes",
      };
    });
    await tick();

    const listEl = target.querySelector<HTMLDivElement>(".fce-list");
    expect(listEl).not.toBeNull();
    expect(target.querySelector(".fce-nav-pane")).not.toBeNull();
    expect(target.querySelector(".fce-main-pane")).not.toBeNull();
    expect(target.textContent).toContain("Runtime note");

    expect(hydrateEvents.length).toBeGreaterThan(0);
    const event = hydrateEvents[hydrateEvents.length - 1];
    expect(typeof event?.start).toBe("number");
    expect(typeof event?.end).toBe("number");
    expect(event?.paths).toEqual(["notes/runtime.md"]);

    await unmount(component);
  });

  it("updates only the hydrated card while preserving its keyed sibling DOM", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const panelModel = createPanelModel(createInitialPanelState());
    const targetCard = {
      ...createCard("notes/target.md", "Target note"),
      hydrated: false,
      previewHtml: "",
    };
    const siblingCard = createCard("notes/sibling.md", "Sibling note");
    panelModel.mutate((state) => {
      state.cards = {
        ...state.cards,
        records: [targetCard, siblingCard],
        generation: 1,
      };
    });

    const component = mount(FolderCardPanel, {
      target,
      props: { panelModel },
    });
    await tick();

    const findCard = (title: string): Element | undefined =>
      Array.from(target.querySelectorAll(".fce-card")).find((card) =>
        card.querySelector("h4")?.textContent?.includes(title),
      );
    const siblingElement = findCard("Sibling note");
    expect(siblingElement).toBeDefined();
    expect(findCard("Target note")?.textContent).toContain("Loading preview");

    const hydratedTarget = {
      ...targetCard,
      hydrated: true,
      previewHtml: "<p>Hydrated target preview</p>",
    };
    panelModel.mutate((state) => {
      state.cards = {
        ...state.cards,
        records: [hydratedTarget, siblingCard],
        hydrationRevision: 1,
      };
    });
    await tick();

    expect(findCard("Target note")?.textContent).toContain("Hydrated target preview");
    expect(findCard("Sibling note")).toBe(siblingElement);

    await unmount(component);
  });

  it("keeps the list scrollable inside the main pane and survives scroll events", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const panelModel = createPanelModel(createInitialPanelState());
    const component = mount(FolderCardPanel, {
      target,
      props: { panelModel },
    });

    panelModel.mutate((state) => {
      state.cards = {
        ...state.cards,
        records: Array.from({ length: 40 }, (_unused, index) =>
          createCard(`notes/card-${index}.md`, `Card ${index}`),
        ),
        generation: 1,
      };
    });
    await tick();

    const listEl = target.querySelector<HTMLDivElement>(".fce-main-pane .fce-list");
    expect(listEl).not.toBeNull();

    listEl?.dispatchEvent(new Event("scroll", { bubbles: true }));
    listEl?.dispatchEvent(new Event("wheel", { bubbles: true }));
    await tick();

    expect(target.querySelector(".fce-nav-pane")).not.toBeNull();
    expect(target.querySelector(".fce-main-pane .fce-list")).not.toBeNull();

    await unmount(component);
  });

  it("resets cross-scope scroll and clamps same-scope replacements", async () => {
    let width = 600;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
    const target = document.createElement("div");
    document.body.appendChild(target);
    const panelModel = createPanelModel(createInitialPanelState());
    panelModel.mutate((state) => {
      state.scope = { ...state.scope, displayPath: "/" };
      state.cards = {
        ...state.cards,
        records: Array.from({ length: 20 }, (_, index) => createCard(`root/${index}.md`, `Root ${index}`)),
        generation: 1,
        sequenceRevision: 1,
      };
    });
    const component = mount(FolderCardPanel, { target, props: { panelModel } });
    await tick();
    const list = target.querySelector<HTMLDivElement>(".fce-list")!;
    list.scrollTop = 900;
    list.dispatchEvent(new Event("scroll"));
    await tick();

    panelModel.mutate((state) => {
      state.scope = { ...state.scope, displayPath: "short" };
      state.cards = {
        ...state.cards,
        records: [createCard("short/first.md", "Short first")],
        loading: false,
        generation: 2,
        sequenceRevision: 2,
      };
    });
    await tick();
    expect(list.scrollTop).toBe(0);
    expect(target.textContent).toContain("Short first");
    expect(target.textContent).not.toContain("Root 0");

    panelModel.mutate((state) => {
      state.scope = { ...state.scope, displayPath: "/" };
      state.cards = {
        ...state.cards,
        records: [createCard("root/returned.md", "Root returned")],
        generation: 3,
        sequenceRevision: 3,
      };
    });
    await tick();
    expect(list.scrollTop).toBe(0);
    expect(target.textContent).toContain("Root returned");
    expect(target.textContent).not.toContain("Short first");

    panelModel.mutate((state) => {
      state.scope = { ...state.scope, displayPath: "short" };
      state.cards = {
        ...state.cards,
        records: Array.from({ length: 20 }, (_, index) => createCard(`short/${index}.md`, `Short ${index}`)),
        generation: 4,
        sequenceRevision: 4,
      };
    });
    await tick();
    list.scrollTop = 900;
    list.dispatchEvent(new Event("scroll"));
    await tick();

    const rowBeforeMaintenance = target.querySelector(".fce-wall-row");
    panelModel.mutate((state) => {
      state.cards = { ...state.cards, generation: 5 };
    });
    await tick();
    expect(list.scrollTop).toBe(900);
    expect(target.querySelector(".fce-wall-row")).toBe(rowBeforeMaintenance);
    panelModel.mutate((state) => {
      state.cards = { ...state.cards, hydrationRevision: 1 };
    });
    await tick();
    expect(list.scrollTop).toBe(900);
    panelModel.mutate((state) => {
      state.cards = {
        ...state.cards,
        records: state.cards.records.map((card, index) => index === 0
          ? { ...card, previewHtml: "<p>Updated</p>" }
          : card),
      };
    });
    await tick();
    expect(list.scrollTop).toBe(900);
    expect(target.querySelector(".fce-wall-row")).toBe(rowBeforeMaintenance);

    panelModel.mutate((state) => {
      state.cards = {
        ...state.cards,
        records: [...state.cards.records].reverse(),
        sequenceRevision: 5,
      };
    });
    await tick();
    expect(list.scrollTop).toBe(900);
    width = 900;
    ResizeObserverStub.trigger();
    await tick();
    expect(list.scrollTop).toBe(668);

    panelModel.mutate((state) => {
      state.cards = {
        ...state.cards,
        records: Array.from({ length: 4 }, (_, index) => createCard(`short/new-${index}.md`, `New ${index}`)),
        generation: 6,
        sequenceRevision: 6,
      };
    });
    await tick();
    expect(list.scrollTop).toBe(164);
    expect(target.querySelectorAll(".fce-wall-row").length).toBeGreaterThan(0);
    for (const spacer of Array.from(target.querySelectorAll<HTMLElement>(".fce-virtual-spacer"))) {
      expect(Number.parseFloat(spacer.style.height)).toBeGreaterThanOrEqual(0);
    }
    await unmount(component);
  });

  it("emits stable viewport demand by generation, hydration revision, and ordered paths", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const panelModel = createPanelModel(createInitialPanelState());
    const requests: Array<{ generation: number; hydrationRevision: number; paths: readonly string[] }> = [];
    panelModel.mutate((state) => {
      state.cards = {
        ...state.cards,
        records: [createCard("notes/a.md", "A"), createCard("notes/b.md", "B")],
        generation: 1,
        sequenceRevision: 1,
      };
    });
    const component = mount(FolderCardPanel, {
      target,
      props: { panelModel, onHydrateViewport: (request: HydrateViewportRequest) => requests.push(request) },
    });
    await tick();
    expect(requests).toHaveLength(1);

    panelModel.mutate((state) => {
      state.cards = { ...state.cards, records: [...state.cards.records] };
    });
    await tick();
    expect(requests).toHaveLength(1);

    panelModel.mutate((state) => {
      state.cards = { ...state.cards, loading: true };
    });
    await tick();
    expect(requests).toHaveLength(1);
    expect(target.querySelector(".fce-list")?.getAttribute("aria-busy")).toBe("true");
    expect(target.textContent).toContain("A");
    panelModel.mutate((state) => {
      state.cards = { ...state.cards, loading: false };
    });
    await tick();
    expect(requests).toHaveLength(2);

    panelModel.mutate((state) => {
      state.cards = {
        ...state.cards,
        records: [createCard("notes/c.md", "C"), createCard("notes/d.md", "D")],
        sequenceRevision: 2,
      };
    });
    await tick();
    expect(requests.at(-1)?.paths).toEqual(["notes/c.md", "notes/d.md"]);
    panelModel.mutate((state) => {
      state.cards = { ...state.cards, hydrationRevision: 1 };
    });
    await tick();
    expect(requests.at(-1)?.hydrationRevision).toBe(1);
    panelModel.mutate((state) => {
      state.cards = { ...state.cards, generation: 2 };
    });
    await tick();
    expect(requests.at(-1)?.generation).toBe(2);
    expect(requests).toHaveLength(5);
    await unmount(component);
  });

  it("retains hidden geometry and emits once when first becoming visible", async () => {
    let width = 0;
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
    const target = document.createElement("div");
    document.body.appendChild(target);
    const panelModel = createPanelModel(createInitialPanelState());
    panelModel.mutate((state) => {
      state.cards = {
        ...state.cards,
        records: [createCard("notes/visible.md", "Visible")],
        generation: 1,
        sequenceRevision: 1,
      };
    });
    const requests: unknown[] = [];
    const component = mount(FolderCardPanel, {
      target,
      props: { panelModel, onHydrateViewport: (request: HydrateViewportRequest) => requests.push(request) },
    });
    await tick();
    expect(requests).toHaveLength(0);
    width = 600;
    ResizeObserverStub.trigger();
    await tick();
    expect(requests).toHaveLength(1);
    ResizeObserverStub.trigger();
    await tick();
    expect(requests).toHaveLength(1);
    await unmount(component);
  });

  it("applies card corner radius classes from panel state", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const panelModel = createPanelModel(createInitialPanelState());
    const component = mount(FolderCardPanel, {
      target,
      props: {
        panelModel,
      },
    });

    panelModel.mutate((state) => {
      state.cards = {
        ...state.cards,
        records: [createCard("notes/runtime.md", "Runtime note")],
        generation: 1,
      };
      state.appearance = { ...state.appearance, cardCornerRadius: "rounded" };
    });
    await tick();

    expect(target.querySelector(".fce-card")?.classList.contains("fce-card-radius-rounded")).toBe(true);

    await unmount(component);
  });

  it("supports base canvas and excalidraw cards", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const panelModel = createPanelModel(createInitialPanelState());
    const component = mount(FolderCardPanel, {
      target,
      props: {
        panelModel,
        onHydrateViewport: () => {
          return;
        },
      },
    });

    await tick();
    expect(target.textContent).toContain("No supported files found in this folder.");

    panelModel.mutate((state) => {
      state.cards = {
        ...state.cards,
        records: [
          createCard("notes/reference.base", "reference.base", "base"),
          createCard("notes/flow.canvas", "flow.canvas", "canvas"),
          createCard("notes/sketch.excalidraw", "sketch.excalidraw", "excalidraw"),
        ],
        generation: 2,
      };
      state.scope = {
        ...state.scope,
        emptyStateMessage: "No supported files found in this folder.",
        displayPath: "notes",
      };
    });
    await tick();

    expect(target.textContent).toContain("reference.base");
    expect(target.textContent).toContain("flow.canvas");
    expect(target.textContent).toContain("sketch.excalidraw");

    await unmount(component);
  });

  it("delegates card context menu actions with updated shape", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const panelModel = createPanelModel(createInitialPanelState());
    const contextEvents: Array<unknown> = [];

    const component = mount(FolderCardPanel, {
      target,
      props: {
        panelModel,
        onCardContextMenu: (payload: unknown) => {
          contextEvents.push(payload);
        }
      },
    });

    panelModel.mutate((state) => {
      state.cards = {
        ...state.cards,
        records: [createCard("notes/action.md", "Action note")],
        generation: 1,
      };
    });
    await tick();

    const moreActionsBtn = target.querySelector<HTMLButtonElement>(".fce-more-actions-btn");
    
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => ({
      bottom: 100, height: 20, left: 50, right: 70, top: 80, width: 20, x: 50, y: 80, toJSON: () => {}
    });

    moreActionsBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(contextEvents).toEqual([
      {
        path: "notes/action.md",
        trigger: "button",
        position: { x: 50, y: 100 },
      }
    ]);

    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    await unmount(component);
  });

  it("renders search empty-state copy for folder scope and tags", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const panelModel = createPanelModel(createInitialPanelState());
    const component = mount(FolderCardPanel, {
      target,
      props: {
        panelModel,
        onHydrateViewport: () => {
          return;
        },
      },
    });

    await tick();
    panelModel.mutate((state) => {
      state.search = { ...state.search, query: "  query  " };
      state.projection = { ...state.projection, activeFilterTags: ["tag-a"] };
      state.cards = { ...state.cards, records: [], generation: 1 };
      state.scope = {
        ...state.scope,
        emptyStateMessage: "No results for “query” in current folder and tag scope.",
      };
    });
    await tick();

    expect(target.textContent).toContain("No results for “query” in current folder and tag scope.");

    panelModel.mutate((state) => {
      state.scope = {
        ...state.scope,
        emptyStateMessage: "No results for “query” in current folder.",
      };
    });
    await tick();

    expect(target.textContent).toContain("No results for “query” in current folder.");

    await unmount(component);
  });

  it("renders search blocked state explicitly with index status", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const panelModel = createPanelModel(createInitialPanelState());
    const component = mount(FolderCardPanel, {
      target,
      props: {
        panelModel,
      },
    });

    await tick();
    panelModel.mutate((state) => {
      state.search = {
        ...state.search,
        query: "blocked query",
        status: "building",
        readiness: "restoring",
      };
      state.cards = { ...state.cards, records: [], generation: 1 };
      state.scope = { ...state.scope, emptyStateMessage: "This should not be shown" };
    });
    await tick();

    expect(target.textContent).toContain("Search is currently blocked");
    expect(target.textContent).toContain("Index status: Restoring index");
    expect(target.textContent).not.toContain("This should not be shown");

    panelModel.mutate((state) => {
      state.search = {
        ...state.search,
        status: "rebuild-required",
        rebuildReason: "corrupt",
      };
    });
    await tick();

    expect(target.textContent).toContain("Index status: Rebuild required (corrupted)");

    await unmount(component);
  });

  it("renders search hit match badge", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const panelModel = createPanelModel(createInitialPanelState());
    const component = mount(FolderCardPanel, {
      target,
      props: { panelModel },
    });

    panelModel.mutate((state) => {
      state.cards = {
        ...state.cards,
        records: [
          createCard("notes/singular.md", "Singular note"),
          createCard("notes/plural.md", "Plural note"),
          createCard("notes/zero.md", "Zero note"),
          createCard("notes/missing.md", "Missing note"),
        ],
        searchMatchCountsByPath: {
          "notes/singular.md": 1,
          "notes/plural.md": 3,
          "notes/zero.md": 0,
        },
        generation: 1,
      };
      state.search = { ...state.search, query: "test" };
    });
    await tick();

    const singularCard = Array.from(target.querySelectorAll(".fce-card")).find((c: Element) => c.textContent?.includes("Singular note"));
    const singularBadge = singularCard?.querySelector(".fce-card-search-count");
    expect(singularBadge).not.toBeNull();
    expect(singularBadge?.textContent?.trim()).toBe("1 match");
    expect(singularBadge?.getAttribute("aria-label")).toBe("1 match in this note");

    const pluralCard = Array.from(target.querySelectorAll(".fce-card")).find((c: Element) => c.textContent?.includes("Plural note"));
    const pluralBadge = pluralCard?.querySelector(".fce-card-search-count");
    expect(pluralBadge).not.toBeNull();
    expect(pluralBadge?.textContent?.trim()).toBe("3 matches");
    expect(pluralBadge?.getAttribute("aria-label")).toBe("3 matches in this note");

    const zeroCard = Array.from(target.querySelectorAll(".fce-card")).find((c: Element) => c.textContent?.includes("Zero note"));
    expect(zeroCard?.querySelector(".fce-card-search-count")).toBeNull();

    const missingCard = Array.from(target.querySelectorAll(".fce-card")).find((c: Element) => c.textContent?.includes("Missing note"));
    expect(missingCard?.querySelector(".fce-card-search-count")).toBeNull();

    panelModel.mutate((state) => {
      state.search = { ...state.search, query: "   " };
    });
    await tick();
    expect(target.querySelectorAll(".fce-card-search-count").length).toBe(0);

    await unmount(component);
  });

  it("suppresses search badges for blocked, unavailable, and cleared states even if count metadata is present", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const panelModel = createPanelModel(createInitialPanelState());
    const component = mount(FolderCardPanel, {
      target,
      props: { panelModel },
    });

    panelModel.mutate((state) => {
      state.cards = {
        ...state.cards,
        records: [createCard("notes/blocked.md", "Blocked note")],
        searchMatchCountsByPath: { "notes/blocked.md": 6 },
        generation: 1,
      };
      state.search = {
        ...state.search,
        query: "alpha",
        status: "building",
        readiness: "restoring",
      };
    });
    await tick();

    expect(target.querySelector(".fce-card-search-count")).toBeNull();

    panelModel.mutate((state) => {
      state.search = { ...state.search, status: "unavailable", readiness: "ready" };
      state.cards = {
        ...state.cards,
        searchMatchCountsByPath: { "notes/blocked.md": 6 },
      };
    });
    await tick();

    expect(target.querySelector(".fce-card-search-count")).toBeNull();

    panelModel.mutate((state) => {
      state.search = { ...state.search, status: "ready", query: "   " };
      state.cards = {
        ...state.cards,
        searchMatchCountsByPath: { "notes/blocked.md": 6 },
      };
    });
    await tick();

    expect(target.querySelector(".fce-card-search-count")).toBeNull();

    await unmount(component);
  });
});
