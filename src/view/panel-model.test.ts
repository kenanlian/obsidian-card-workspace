import { describe, expect, it, vi } from "vitest";

import { getUiStrings } from "../i18n";
import { EMPTY_NAVIGATION_PROJECTION } from "./navigation-model";
import {
  createPanelModel,
  type PanelModelState,
  type PanelStateDraft,
} from "./panel-model";

function buildState(): PanelModelState {
  return {
    strings: getUiStrings("en"),
    scope: {
      displayPath: "Notes",
      includeSubfolders: false,
      activeBoxId: null,
      activeBoxName: null,
      boxExcludedCount: 0,
      emptyStateMessage: "Empty",
    },
    cards: {
      records: [],
      searchMatchCountsByPath: {},
      selectedPath: null,
      loading: false,
      generation: 1,
      sequenceRevision: 0,
      hydrationRevision: 0,
    },
    search: {
      query: "",
      status: "idle",
      focusToken: 0,
    },
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
      paneWidth: 260,
      layoutMode: "dual",
      visible: true,
      sectionCollapsed: {
        favorites: false,
        folders: false,
        tags: false,
        boxes: false,
      },
      showItemCounts: true,
      tooltipSide: "right",
      projection: EMPTY_NAVIGATION_PROJECTION,
      query: "",
      focusId: null,
      focusRequest: null,
      revealRequest: null,
    },
    appearance: {
      cardCornerRadius: "medium",
      previewLines: 8,
    },
  };
}

function assertDraftIsDeeplyReadonly(draft: PanelStateDraft): void {
  const matchLabel: string = draft.strings.cardItem.searchCount(3);
  // @ts-expect-error nested group state must be replaced instead of mutated in place
  draft.nav.sectionCollapsed.tags = true;
  // @ts-expect-error card records must be replaced instead of mutated in place
  draft.cards.records.push(draft.cards.records[0]!);
  void matchLabel;
}

void assertDraftIsDeeplyReadonly;

describe("createPanelModel", () => {
  it("preserves references for groups not assigned by mutate", () => {
    const initial = buildState();
    const model = createPanelModel(initial);
    const nextSearch = { ...initial.search, query: "needle" };

    model.mutate((draft) => {
      draft.search = nextSearch;
    });

    const next = model.getState();
    expect(next).not.toBe(initial);
    expect(next.search).toBe(nextSearch);
    expect(next.scope).toBe(initial.scope);
    expect(next.cards).toBe(initial.cards);
    expect(next.projection).toBe(initial.projection);
    expect(next.bulk).toBe(initial.bulk);
    expect(next.nav).toBe(initial.nav);
    expect(next.appearance).toBe(initial.appearance);
    expect(next.strings).toBe(initial.strings);
  });

  it("does not notify when mutate assigns no groups", () => {
    const model = createPanelModel(buildState());
    const listener = vi.fn();
    model.subscribe(listener);
    listener.mockClear();

    model.mutate(() => {});

    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies once for multiple writes in a batch", () => {
    const model = createPanelModel(buildState());
    const listener = vi.fn();
    model.subscribe(listener);
    listener.mockClear();

    model.batch((draft) => {
      draft.search = { ...draft.search, query: "needle" };
      model.mutate((nestedDraft) => {
        nestedDraft.appearance = { ...nestedDraft.appearance, previewLines: 12 };
      });
      draft.nav = { ...draft.nav, visible: false };
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(model.getState().search.query).toBe("needle");
    expect(model.getState().appearance.previewLines).toBe(12);
    expect(model.getState().nav.visible).toBe(false);
  });

  it("notifies once for nested batches", () => {
    const model = createPanelModel(buildState());
    const listener = vi.fn();
    model.subscribe(listener);
    listener.mockClear();

    model.batch((draft) => {
      draft.scope = { ...draft.scope, displayPath: "Archive" };
      model.batch((nestedDraft) => {
        nestedDraft.search = { ...nestedDraft.search, query: "nested" };
        model.mutate((innerDraft) => {
          innerDraft.cards = { ...innerDraft.cards, loading: true };
        });
      });
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(model.getState().scope.displayPath).toBe("Archive");
    expect(model.getState().search.query).toBe("nested");
    expect(model.getState().cards.loading).toBe(true);
  });

  it("publishes a new outer snapshot without mutating the previous one", () => {
    const initial = buildState();
    const model = createPanelModel(initial);
    const snapshots: PanelModelState[] = [];
    model.subscribe((state) => snapshots.push(state));

    model.mutate((draft) => {
      draft.scope = { ...draft.scope, displayPath: "Archive" };
    });

    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).not.toBe(snapshots[0]);
    expect(snapshots[0].scope.displayPath).toBe("Notes");
    expect(snapshots[1].scope.displayPath).toBe("Archive");
  });
});
