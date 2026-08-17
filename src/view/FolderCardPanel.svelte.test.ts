import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount, tick, unmount } from "svelte";
import { getUiStrings } from "../i18n";
import FolderCardPanel from "./FolderCardPanel.svelte";
import { createPanelModel, type PanelModelState } from "./panel-model";
import type { CardFileKind } from "./file-kind";
import type { NoteCardRecord } from "./types";

class ResizeObserverStub {
  observe(): void {
    return;
  }

  disconnect(): void {
    return;
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
    (globalThis as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
      ResizeObserverStub as never;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders empty state, populated list, and emits hydrate-range with numeric bounds", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const panelModel = createPanelModel(createInitialPanelState());
    const hydrateEvents: Array<{ start: number; end: number }> = [];

    const component = mount(FolderCardPanel, {
      target,
      props: {
        panelModel,
        onHydrateRange: (detail: { start: number; end: number }) => {
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
        generation: 2,
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
        onHydrateRange: () => {
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
        onHydrateRange: () => {
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
