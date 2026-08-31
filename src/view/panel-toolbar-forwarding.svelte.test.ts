import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import { DEFAULT_GROUP_SPEC } from "../card-grouping-settings";
import { getUiStrings } from "../i18n";
import FolderCardPanel from "./FolderCardPanel.svelte";
import { createPanelModel, type PanelModelState } from "./panel-model";

/**
 * `vi.mock` is hoisted to module scope and the panel imports `Toolbar` statically,
 * so this stub lives in its own file rather than replacing the real toolbar in
 * every case of `FolderCardPanel.svelte.test.ts`.
 */
const toolbarStub = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));

vi.mock("./Toolbar.svelte", () => ({
  default: (_anchor: unknown, props: Record<string, unknown>) => {
    toolbarStub.props = props;
  },
}));

class ResizeObserverStub {
  observe(): void {
    return;
  }

  disconnect(): void {
    return;
  }
}

function createPanelState(): PanelModelState {
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
      groupSegments: [],
      groupRevision: 0,
    },
    search: { query: "", status: "idle", focusToken: 0 },
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
      projection: { normalizedQuery: "", querying: false, sections: [], rows: [], noResults: false },
      query: "",
      focusId: null,
      focusRequest: null,
      revealRequest: null,
    },
    appearance: { cardCornerRadius: "compact", previewLines: 5 },
  };
}

describe("FolderCardPanel toolbar forwarding", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    toolbarStub.props = null;
    (globalThis as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver =
      ResizeObserverStub as never;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("forwards the toolbar's group collapse command to its own host callback", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);

    const received: Array<{ command: string; key?: string }> = [];
    const component = mount(FolderCardPanel, {
      target,
      props: {
        panelModel: createPanelModel(createPanelState()),
        onGroupCollapseCommand: (payload: { command: string; key?: string }) => {
          received.push(payload);
        },
      },
    });
    await tick();

    const forward = toolbarStub.props?.onGroupCollapseCommand;
    expect(typeof forward).toBe("function");

    (forward as (payload: { command: string }) => void)({ command: "collapse-all" });
    expect(received).toEqual([{ command: "collapse-all" }]);

    await unmount(component);
  });
});
