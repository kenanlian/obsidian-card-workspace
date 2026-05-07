import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount, tick, unmount } from "svelte";
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
    cards: [],
    emptyStateMessage: "No supported files found in this folder.",
    folderPath: "notes",
    selectedPath: null,
    loading: false,
    generation: 0,
    searchQuery: "",
    searchStatus: "idle",
    sortField: "mtime",
    sortDirection: "desc",
    availableTags: [],
    activeFilterTags: [],
    pinnedPaths: [],
    previewLines: 5,
    folderTree: [],
    includeSubfolders: true,
    isAllNotesScope: false,
    tooltipSide: "right",
    bulkMode: false,
    selectedPaths: [],
    selectedCount: 0,
    bulkAnchorPath: null,
    canBulkSelectAll: false,
    canBulkClearSelection: false,
    canBulkMoveSelected: false,
    canBulkDeleteSelected: false,
    canBulkMergeSelected: false,
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
      state.cards = [createCard("notes/runtime.md", "Runtime note")];
      state.emptyStateMessage = "No supported files found in this folder.";
      state.generation = 1;
      state.folderPath = "notes";
    });
    await tick();

    const listEl = target.querySelector<HTMLDivElement>(".fce-list");
    expect(listEl).not.toBeNull();
    expect(target.textContent).toContain("Runtime note");
    expect(target.textContent).toContain("notes");

    expect(hydrateEvents.length).toBeGreaterThan(0);
    const event = hydrateEvents[hydrateEvents.length - 1];
    expect(typeof event?.start).toBe("number");
    expect(typeof event?.end).toBe("number");

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
      state.cards = [
        createCard("notes/reference.base", "reference.base", "base"),
        createCard("notes/flow.canvas", "flow.canvas", "canvas"),
        createCard("notes/sketch.excalidraw", "sketch.excalidraw", "excalidraw"),
      ];
      state.emptyStateMessage = "No supported files found in this folder.";
      state.generation = 2;
      state.folderPath = "notes";
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
      state.cards = [createCard("notes/action.md", "Action note")];
      state.generation = 1;
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
      state.searchQuery = "  query  ";
      state.activeFilterTags = ["tag-a"];
      state.cards = [];
      state.emptyStateMessage = 'No results for “query” in current folder and tag scope.';
      state.generation = 1;
    });
    await tick();

    expect(target.textContent).toContain('No results for “query” in current folder and tag scope.');

    panelModel.mutate((state) => {
      state.isAllNotesScope = true;
      state.emptyStateMessage = 'No results for “query” in current tag scope.';
    });
    await tick();

    expect(target.textContent).toContain('No results for “query” in current tag scope.');

    await unmount(component);
  });
});
