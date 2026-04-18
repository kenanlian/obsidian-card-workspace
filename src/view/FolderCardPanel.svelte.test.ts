import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mount, tick, unmount } from "svelte";
import FolderCardPanel from "./FolderCardPanel.svelte";
import { createPanelModel, type PanelModelState } from "./panel-model";
import type { NoteCardRecord } from "./types";

class ResizeObserverStub {
  observe(): void {
    return;
  }

  disconnect(): void {
    return;
  }
}

function createCard(path: string, title: string): NoteCardRecord {
  return {
    file: {} as never,
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
    canBulkTrashSelected: false,
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

    expect(target.textContent).toContain("No Markdown notes found in this folder.");

    panelModel.mutate((state) => {
      state.cards = [createCard("notes/runtime.md", "Runtime note")];
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
});
