/**
 * Node-project FolderCardView host/event-routing contracts under the panel mock seam.
 *
 * These cases span FolderCardView plus search/hydration/bulk/scope controllers and
 * cannot live in a single action/menu module. They must stay in the node project:
 * `FolderCardView.test.ts` is jsdom-only and does not apply the panel mock alias.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockState,
  resetFolderCardViewHarness,
  createViewWithFile,
  createCardRecord,
  createCardRecordFromPath,
  createMarkdownFile,
  createNonMarkdownFile,
  createFolder,
  attachChildren,
  publishAll,
  createIndexedSearchServiceStub,
  createSearchHealth,
  clickLatestModalButton,
  flushAsyncWork,
  createDeferred,
  buildNoteOpsMock,
  registerFolderCardView,
} from "../__mocks__/folder-card-view-harness";

vi.mock("./note-ops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./note-ops")>();
  return buildNoteOpsMock(actual);
});

const propertyPickerMockState = vi.hoisted(() => ({
  openedOptions: [] as Array<{
    selectedKeys: string[];
    collectPropertyInventory: () => unknown;
    onSubmit: (keys: string[]) => Promise<void>;
  }>,
  openCount: 0,
}));

vi.mock("./modals/PropertyPickerModal", () => ({
  PropertyPickerModal: class {
    constructor(
      _app: unknown,
      options: {
        selectedKeys: string[];
        collectPropertyInventory: () => unknown;
        onSubmit: (keys: string[]) => Promise<void>;
      },
    ) {
      propertyPickerMockState.openedOptions.push(options);
    }

    open(): void {
      propertyPickerMockState.openCount += 1;
    }
  },
}));

import * as markdownUtils from "./markdown-utils";
import { createBoxScope, createFolderScope } from "./scope";
import { FolderCardView } from "./FolderCardView";
import type { SearchServiceSnapshot } from "../search";
import {
  batchDeleteFilesUsingObsidianPreference,
  batchMoveFiles,
  batchTrashFiles,
  mergeNotes,
} from "./note-ops";
import { buildPanelProps } from "./panel-props";
import { getUiStrings } from "../i18n";
import type { PropertyFilterClause, PropertyScalarRef } from "../property-filter-settings";

registerFolderCardView(FolderCardView);

function propertyText(value: string): PropertyScalarRef {
  return { kind: "text", value };
}

function propertyClause(key: string, values: PropertyScalarRef[]): PropertyFilterClause {
  return { key, values };
}

function propertySettings(overrides: {
  visiblePropertyKeys?: string[];
  expandedPropertyKeys?: string[];
  filterProperties?: PropertyFilterClause[];
  navPaneWidth?: number;
} = {}): Record<string, unknown> {
  return {
    includeSubfolders: true,
    sort: { field: "mtime", direction: "desc" },
    filter: { tags: [], properties: overrides.filterProperties ?? [] },
    visiblePropertyKeys: overrides.visiblePropertyKeys ?? [],
    expandedPropertyKeys: overrides.expandedPropertyKeys ?? [],
    sectionCollapsed: { favorites: false, folders: false, tags: false, properties: false, boxes: false },
    navSectionOrder: ["favorites", "folders", "tags", "properties", "boxes"],
    defaultView: "cards",
    lastFolderPath: null,
    lastViewMode: "folder",
    pinnedPaths: [],
    previewLines: 5,
    navPaneWidth: overrides.navPaneWidth ?? 280,
    showNavItemCounts: true,
  };
}

function createPropertyHarness(options: {
  settings?: Record<string, unknown>;
  frontmatter?: Record<string, Record<string, unknown>>;
  cards?: Array<ReturnType<typeof createCardRecord>>;
} = {}): ReturnType<typeof createViewWithFile> {
  const harness = createViewWithFile("notes/a.md");
  harness.plugin.getSettings = vi.fn(() => options.settings ?? propertySettings());
  harness.app.metadataCache.getFileCache = vi.fn((file: { path: string }) => {
    const entry = options.frontmatter?.[file.path];
    return entry === undefined ? null : { frontmatter: entry };
  });
  if (options.cards) {
    (harness.view as any).baseCards = options.cards;
    (harness.view as any).visibleCards = options.cards;
  }
  return harness;
}

/** Registers the metadata listener (as `onOpen` does) and returns its emit function. */
async function openWithMetadataListener(
  view: FolderCardView,
  plugin: { subscribeMetadataEvents: ReturnType<typeof vi.fn> },
): Promise<(event: { path: string }) => void> {
  let listener: ((event: { path: string }) => void) | null = null;
  plugin.subscribeMetadataEvents = vi.fn((registered: (event: { path: string }) => void) => {
    listener = registered;
    return () => undefined;
  });
  await (view as any).onOpen();
  return (event) => listener!(event);
}

/** Panel-group identity helper mirroring the grouped-publish assertions. */
function expectGroupsReplaced(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  groups: readonly string[],
): void {
  for (const group of groups) {
    expect(after[group], `${group} should be replaced`).not.toBe(before[group]);
  }
}

function viewportRequest(view: FolderCardView, start: number, end: number) {
  const cards = (view as any).store.getVisibleCards() as Array<{ path: string }>;
  return {
    generation: (view as any).epochs.load.value,
    hydrationRevision: (view as any).store.getHydrationRevision(),
    start,
    end: Math.min(end, cards.length),
    paths: cards.slice(start, end).map((card) => card.path),
  };
}

describe("FolderCardView host/event-routing contracts (node mock seam)", () => {
  beforeEach(() => {
    resetFolderCardViewHarness();
  });

  describe("Task 2: Event contract verification via real onOpen() subscriptions", () => {
    it("hydrates preloaded cards when onOpen runs after startup restore", async () => {
      const { view, app, file } = createViewWithFile("notes/startup-restore.md");
      const card = createCardRecord(file);

      app.vault.cachedRead = vi.fn(async () => "# Startup restore\nHydrated preview body");
      (view as any).baseCards = [card];
      (view as any).visibleCards = [card];
      (view as any).modules.scopeController.loading = false;

      await (view as any).onOpen();
      await flushAsyncWork();

      expect(app.vault.cachedRead).toHaveBeenCalledTimes(1);
      const hydratedCard = (view as any).baseCards.find((entry: { path: string }) => entry.path === card.path);
      expect(hydratedCard?.hydrated).toBe(true);
      expect(hydratedCard?.previewMode).not.toBe("empty");
    });

    it("onOpen() registers open-note subscription that calls plugin.openNoteFromCard", async () => {
      const { view, plugin, file } = createViewWithFile("notes/test-note.md");

      await (view as any).onOpen();

      expect(mockState.panelEventHandlers["open-note"]).toBeDefined();

      const openNoteHandler = mockState.panelEventHandlers["open-note"];
      openNoteHandler({ detail: { path: file.path } });

      expect(plugin.openNoteFromCard).toHaveBeenCalledTimes(1);
      expect(plugin.openNoteFromCard).toHaveBeenCalledWith(file.path);
    });

    it("onOpen() registers card-context-menu subscription that calls openCardContextMenu", async () => {
      const { view, plugin, file } = createViewWithFile("notes/context-note.md");
      const mockMouseEvent = { clientX: 100, clientY: 200 };

      await (view as any).onOpen();

      expect(mockState.panelEventHandlers["card-context-menu"]).toBeDefined();

      const contextMenuHandler = mockState.panelEventHandlers["card-context-menu"];
      contextMenuHandler({
        detail: { path: file.path, trigger: "contextmenu", mouseEvent: mockMouseEvent },
      });

      expect(plugin.openNoteFromCard).not.toHaveBeenCalled();
      expect(mockState.menuInstances).toHaveLength(1);
      const [menu] = mockState.menuInstances;
      expect(menu?.showAtMouseEvent).toHaveBeenCalledWith(mockMouseEvent);
    });

    it("open-note subscription (registered in onOpen) routes multiple paths to openNoteFromCard", async () => {
      const { view, plugin } = createViewWithFile("notes/left-click.md");

      await (view as any).onOpen();

      const openNoteHandler = mockState.panelEventHandlers["open-note"];

      openNoteHandler({ detail: { path: "notes/first.md" } });
      openNoteHandler({ detail: { path: "notes/second.md" } });

      expect(plugin.openNoteFromCard).toHaveBeenCalledTimes(2);
      expect(plugin.openNoteFromCard).toHaveBeenNthCalledWith(1, "notes/first.md");
      expect(plugin.openNoteFromCard).toHaveBeenNthCalledWith(2, "notes/second.md");
    });

    it("card-context-menu subscription (registered in onOpen) creates menu without calling openNoteFromCard", async () => {
      const { view, plugin, file } = createViewWithFile("notes/right-click.md");
      const event1 = { clientX: 50, clientY: 100 };
      const event2 = { clientX: 75, clientY: 150 };

      await (view as any).onOpen();

      const contextMenuHandler = mockState.panelEventHandlers["card-context-menu"];

      contextMenuHandler({
        detail: { path: file.path, trigger: "contextmenu", mouseEvent: event1 },
      });
      contextMenuHandler({
        detail: { path: file.path, trigger: "contextmenu", mouseEvent: event2 },
      });

      expect(plugin.openNoteFromCard).not.toHaveBeenCalled();
      expect(mockState.menuInstances).toHaveLength(2);
      expect(mockState.menuInstances[0]?.showAtMouseEvent).toHaveBeenCalledWith(event1);
      expect(mockState.menuInstances[1]?.showAtMouseEvent).toHaveBeenCalledWith(event2);
    });

    it("event paths are isolated: open-note does not trigger menu creation", async () => {
      const { view, plugin, file } = createViewWithFile("notes/isolation.md");

      await (view as any).onOpen();

      const openNoteHandler = mockState.panelEventHandlers["open-note"];
      openNoteHandler({ detail: { path: file.path } });

      expect(mockState.menuInstances).toHaveLength(0);
      expect(plugin.openNoteFromCard).toHaveBeenCalledTimes(1);
    });

    it("event paths are isolated: card-context-menu does not trigger openNoteFromCard", async () => {
      const { view, plugin, file } = createViewWithFile("notes/isolation2.md");
      const mockMouseEvent = { clientX: 10, clientY: 20 };

      await (view as any).onOpen();

      const contextMenuHandler = mockState.panelEventHandlers["card-context-menu"];
      contextMenuHandler({
        detail: { path: file.path, trigger: "contextmenu", mouseEvent: mockMouseEvent },
      });

      expect(plugin.openNoteFromCard).not.toHaveBeenCalled();
      expect(mockState.menuInstances).toHaveLength(1);
    });

     it("both subscriptions exist after onOpen (open-note and card-context-menu)", async () => {
       const { view } = createViewWithFile("notes/dual-subscription.md");

       await (view as any).onOpen();

       expect(mockState.panelEventHandlers["open-note"]).toBeDefined();
       expect(mockState.panelEventHandlers["card-context-menu"]).toBeDefined();
       expect(typeof mockState.panelEventHandlers["open-note"]).toBe("function");
       expect(typeof mockState.panelEventHandlers["card-context-menu"]).toBe("function");
     });

     it("onOpen() registers filter-change subscription that persists all selected tags", async () => {
       const { view, plugin } = createViewWithFile("notes/test-filter.md");

       await (view as any).onOpen();

       expect(mockState.panelEventHandlers["filter-change"]).toBeDefined();

       const filterChangeHandler = mockState.panelEventHandlers["filter-change"];
       filterChangeHandler({ detail: { tags: ["important", "archived"] } });

        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(plugin.saveSettings).toHaveBeenCalledWith({
          filter: {
            tags: ["important", "archived"],
          },
        });
      });

      it("filter-change handler sanitizes, normalizes, and dedupes multi-tag input", async () => {
       const { view, plugin } = createViewWithFile("notes/tag-normalize.md");

       await (view as any).onOpen();

       const filterChangeHandler = mockState.panelEventHandlers["filter-change"];
       filterChangeHandler({ detail: { tags: ["#Important", " WORK ", "", "   ", "important"] } });

        expect(plugin.saveSettings).toHaveBeenCalledWith({
          filter: {
            tags: ["important", "work"],
          },
        });
      });

      it("filter-change handler validates that tags is an array before processing", async () => {
        const { view, plugin } = createViewWithFile("notes/invalid-filter.md");

        await (view as any).onOpen();

        const filterChangeHandler = mockState.panelEventHandlers["filter-change"];
        filterChangeHandler({ detail: { tags: "not-an-array" } });

        expect(plugin.saveSettings).not.toHaveBeenCalled();
      });

      it("filter-change handler handles empty array input gracefully", async () => {
        const { view, plugin } = createViewWithFile("notes/empty-array-filter.md");

        await (view as any).onOpen();

        const filterChangeHandler = mockState.panelEventHandlers["filter-change"];
        filterChangeHandler({ detail: { tags: [] } });

        expect(plugin.saveSettings).not.toHaveBeenCalled();
      });

     it("event paths are isolated: filter-change does not trigger menu creation", async () => {
       const { view, plugin } = createViewWithFile("notes/filter-isolation.md");

       await (view as any).onOpen();

       const filterChangeHandler = mockState.panelEventHandlers["filter-change"];
       filterChangeHandler({ detail: { tags: ["work"] } });

       expect(mockState.menuInstances).toHaveLength(0);
       expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
     });

     it("event paths are isolated: filter-change does not trigger openNoteFromCard", async () => {
       const { view, plugin } = createViewWithFile("notes/filter-isolation2.md");

       await (view as any).onOpen();

       const filterChangeHandler = mockState.panelEventHandlers["filter-change"];
       filterChangeHandler({ detail: { tags: ["personal"] } });

       expect(plugin.openNoteFromCard).not.toHaveBeenCalled();
       expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
     });

      it("filter-change subscription is registered alongside open-note and card-context-menu", async () => {
        const { view } = createViewWithFile("notes/multi-subscription.md");

        await (view as any).onOpen();

        expect(mockState.panelEventHandlers["open-note"]).toBeDefined();
        expect(mockState.panelEventHandlers["card-context-menu"]).toBeDefined();
        expect(mockState.panelEventHandlers["filter-change"]).toBeDefined();
        expect(typeof mockState.panelEventHandlers["filter-change"]).toBe("function");
      });
    });
    describe("Task 2: Search query coordinator ownership", () => {
      it("search queries run only after the 120ms debounce boundary", async () => {
        vi.useFakeTimers();
        try {
          const { view, plugin } = createViewWithFile("notes/search-service-boundary.md");
          const visibleCards = [
            createCardRecordFromPath("notes/search-service-boundary.md"),
            createCardRecordFromPath("notes/second.md"),
          ];

          const service = createIndexedSearchServiceStub();
          const querySpy = service.query;
          plugin.getSearchService = vi.fn(() => service);

          (view as any).cardScope = createFolderScope("notes", true);
          (view as any).baseCards = visibleCards;
          (view as any).visibleCards = visibleCards;

          await (view as any).onOpen();

          const queryChangeHandler = mockState.panelEventHandlers["search-query-change"];
          queryChangeHandler({ detail: { query: "roadmap" } });

          expect(querySpy).not.toHaveBeenCalled();

          vi.advanceTimersByTime(119);
          await flushAsyncWork();
          expect(querySpy).not.toHaveBeenCalled();

          vi.advanceTimersByTime(1);
          await flushAsyncWork();

          expect((view as any).modules.search.query).toBe("roadmap");
          expect(plugin.saveSettings).not.toHaveBeenCalled();
          expect(querySpy).toHaveBeenCalledWith({
            query: "roadmap",
            scope: {
              folderPath: "notes",
              includeSubfolders: true,
            },
            candidatePaths: visibleCards.map((card) => card.path),
          });
          expect((view as any).visibleCards).toEqual([]);
          expect((view as any).modules.search.status).toBe("unavailable");
          expect((view as any).modules.search.orderedPaths).toBeUndefined();
          expect(mockState.panelInstances[0]?.modelSnapshots.at(-1)).toMatchObject({
            search: { query: "roadmap", status: "unavailable" },
            cards: { records: [] },
          });
        } finally {
          vi.useRealTimers();
        }
      });

      it("reset clears query state but keeps snapshot-driven health visibility", async () => {
        vi.useFakeTimers();
        try {
          const { view, plugin } = createViewWithFile("notes/search-reset-health.md");
          const service = createIndexedSearchServiceStub();
          const getSearchService = vi.fn(() => service);
          plugin.getSearchService = getSearchService;
          plugin.getSearchSnapshot = vi.fn(() => ({
            initialized: true,
            disposed: false,
            mode: "indexed",
            status: "error",
            lastError: "index unavailable",
            health: createSearchHealth({
              outcome: "failed",
              readiness: "error",
              healthy: false,
              rebuilding: false,
              rebuildRequired: false,
              documentCount: null,
              lastIndexedAt: null,
              lastError: "index unavailable",
              detail: "failed",
            }),
          }));

          await (view as any).onOpen();

          expect((view as any).modules.search.status).toBe("error");

          const queryChangeHandler = mockState.panelEventHandlers["search-query-change"];
          const queryResetHandler = mockState.panelEventHandlers["search-query-reset"];

          queryChangeHandler({ detail: { query: "alpha" } });
          expect((view as any).modules.search.status).toBe("error");

            queryResetHandler({ detail: { source: "clear-button" } });
            expect((view as any).modules.search.query).toBe("");
            expect((view as any).modules.search.orderedPaths).toBeUndefined();
            expect((view as any).modules.search.status).toBe("error");

          vi.advanceTimersByTime(200);
          await flushAsyncWork();
          expect(getSearchService).not.toHaveBeenCalled();
          expect(plugin.saveSettings).not.toHaveBeenCalled();
        } finally {
          vi.useRealTimers();
        }
      });

      it("drops stale async results after snapshot transition and folder switch", async () => {
        vi.useFakeTimers();
        try {
          const { view, plugin } = createViewWithFile("notes/search-stale-protection.md");
          const visibleCards = [
            createCardRecordFromPath("notes/search-stale-protection.md"),
            createCardRecordFromPath("notes/second.md"),
          ];

          const pending: Array<{ resolve: (result: any) => void }> = [];
          const query = vi.fn((_request: unknown) => {
            return new Promise((resolve) => {
              pending.push({ resolve });
            });
          });

          let snapshotListener: ((snapshot: SearchServiceSnapshot) => void) | null = null;
          const emitSnapshot = (snapshot: SearchServiceSnapshot): void => {
            const listener = snapshotListener;
            if (!listener) {
              return;
            }

            listener(snapshot);
          };
          plugin.getSearchSnapshot = vi.fn(() => ({

            initialized: true,
            disposed: false,
            mode: "indexed",
            status: "ready",
            lastError: null,
            health: createSearchHealth({
              documentCount: 2,
              lastSuccessfulRestore: {
                outcome: "restored",
                at: 1,
                documentCount: 2,
                detail: "restored",
              },
            }),
          }));
          plugin.subscribeSearchSnapshots = vi.fn((listener: (snapshot: SearchServiceSnapshot) => void) => {
            snapshotListener = listener;
            return () => {
              snapshotListener = null;
            };
          });
          plugin.getSearchService = vi.fn(() => ({ query }));

          (view as any).cardScope = createFolderScope("notes", true);
          (view as any).baseCards = visibleCards;
          (view as any).visibleCards = visibleCards;

          await (view as any).onOpen();

          const queryChangeHandler = mockState.panelEventHandlers["search-query-change"];

          queryChangeHandler({ detail: { query: "alpha" } });
          vi.advanceTimersByTime(120);
          await flushAsyncWork();
          expect(query).toHaveBeenCalledTimes(1);

          queryChangeHandler({ detail: { query: "beta" } });
          vi.advanceTimersByTime(120);
          await flushAsyncWork();
          expect(query).toHaveBeenCalledTimes(2);

          emitSnapshot({
            initialized: true,
            disposed: false,
            mode: "indexed",
            status: "building",
            lastError: null,
            health: createSearchHealth({
              outcome: "rebuild-required",
              readiness: "rebuild-required",
              healthy: false,
              rebuilding: true,
              rebuildRequired: true,
              documentCount: null,
              lastIndexedAt: null,
              rebuildReason: "version-drift",
              detail: "rebuilding",
            }),
          });

          pending[1]?.resolve({
            mode: "indexed",
            status: "ready",
            execution: "indexed-ready",
            orderedPaths: [visibleCards[1].path],
          });
          await flushAsyncWork();

          expect((view as any).modules.search.status).toBe("rebuild-required");
          expect((view as any).modules.search.orderedPaths).toBeUndefined();

          queryChangeHandler({ detail: { query: "gamma" } });
          vi.advanceTimersByTime(120);
          await flushAsyncWork();
          expect(query).toHaveBeenCalledTimes(3);

          (view as any).epochs.load.bump();
          (view as any).cardScope = createFolderScope("archive", true);

          pending[2]?.resolve({
            mode: "indexed",
            status: "ready",
            execution: "indexed-ready",
            orderedPaths: [visibleCards[0].path],
          });
          pending[0]?.resolve({
            mode: "indexed",
            status: "ready",
            execution: "indexed-ready",
            orderedPaths: [visibleCards[0].path],
          });
          await flushAsyncWork();

          expect((view as any).modules.search.query).toBe("gamma");
          expect((view as any).modules.search.status).toBe("rebuild-required");
          expect((view as any).modules.search.orderedPaths).toBeUndefined();
        } finally {
          vi.useRealTimers();
        }
      });
    });
    describe("Task 11: Event contract verification for pin-toggle persistence flow", () => {
      it("onOpen() registers pin-toggle subscription", async () => {
        const { view } = createViewWithFile("notes/pin-register.md");

        await (view as any).onOpen();

        expect(mockState.panelEventHandlers["pin-toggle"]).toBeDefined();
        expect(typeof mockState.panelEventHandlers["pin-toggle"]).toBe("function");
      });

      it("pin-toggle subscription appends path to pinnedPaths when pinning", async () => {
        const { view, plugin } = createViewWithFile("notes/pin-me.md");

        await (view as any).onOpen();

        const pinToggleHandler = mockState.panelEventHandlers["pin-toggle"];
        pinToggleHandler({ detail: { path: "notes/pin-me.md", pinned: true } });

        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(plugin.saveSettings).toHaveBeenCalledWith({
          pinnedPaths: ["notes/pin-me.md"],
        });
      });

      it("pin-toggle subscription removes path from pinnedPaths when unpinning", async () => {
        const { view, plugin } = createViewWithFile("notes/unpin-me.md");
        const initialPinnedPaths = ["notes/pinned-first.md", "notes/unpin-me.md", "notes/pinned-last.md"];
        plugin.getSettings = vi.fn(() => ({
          includeSubfolders: true,
          sort: { field: "mtime", direction: "desc" },
          visiblePropertyKeys: [],
          expandedPropertyKeys: [],
          filter: { tags: [], properties: [] },
          defaultView: "cards",
          lastFolderPath: null,
          lastViewMode: "folder",
          pinnedPaths: initialPinnedPaths,
        }));

        await (view as any).onOpen();

        const pinToggleHandler = mockState.panelEventHandlers["pin-toggle"];
        pinToggleHandler({ detail: { path: "notes/unpin-me.md", pinned: false } });

        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(plugin.saveSettings).toHaveBeenCalledWith({
          pinnedPaths: ["notes/pinned-first.md", "notes/pinned-last.md"],
        });
      });

      it("pin-toggle subscription appends multiple paths independently", async () => {
        const { view, plugin } = createViewWithFile("notes/multi-pin.md");
        let pinnedState: string[] = [];
        plugin.getSettings = vi.fn(() => ({
          includeSubfolders: true,
          sort: { field: "mtime", direction: "desc" },
          visiblePropertyKeys: [],
          expandedPropertyKeys: [],
          filter: { tags: [], properties: [] },
          defaultView: "cards",
          lastFolderPath: null,
          lastViewMode: "folder",
          pinnedPaths: pinnedState,
        }));
        plugin.saveSettings = vi.fn(async (settings: any) => {
          pinnedState = settings.pinnedPaths;
        });

        await (view as any).onOpen();

        const pinToggleHandler = mockState.panelEventHandlers["pin-toggle"];
        pinToggleHandler({ detail: { path: "notes/first-pin.md", pinned: true } });
        pinToggleHandler({ detail: { path: "notes/second-pin.md", pinned: true } });

        expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
        expect(plugin.saveSettings).toHaveBeenNthCalledWith(1, {
          pinnedPaths: ["notes/first-pin.md"],
        });
        expect(plugin.saveSettings).toHaveBeenNthCalledWith(2, {
          pinnedPaths: ["notes/first-pin.md", "notes/second-pin.md"],
        });
      });

      it("pin-toggle avoids duplicate persistence when path is already pinned", async () => {
        const { view, plugin } = createViewWithFile("notes/already-pinned.md");
        plugin.getSettings = vi.fn(() => ({
          includeSubfolders: true,
          sort: { field: "mtime", direction: "desc" },
          visiblePropertyKeys: [],
          expandedPropertyKeys: [],
          filter: { tags: [], properties: [] },
          defaultView: "cards",
          lastFolderPath: null,
          lastViewMode: "folder",
          pinnedPaths: ["notes/already-pinned.md"],
        }));

        await (view as any).onOpen();

        const pinToggleHandler = mockState.panelEventHandlers["pin-toggle"];
        pinToggleHandler({ detail: { path: "notes/already-pinned.md", pinned: true } });

        expect(plugin.saveSettings).not.toHaveBeenCalled();
      });

      it("pin-toggle ignores stale unpin request for missing pinned path", async () => {
        const { view, plugin } = createViewWithFile("notes/stale-unpin.md");
        plugin.getSettings = vi.fn(() => ({
          includeSubfolders: true,
          sort: { field: "mtime", direction: "desc" },
          visiblePropertyKeys: [],
          expandedPropertyKeys: [],
          filter: { tags: [], properties: [] },
          defaultView: "cards",
          lastFolderPath: null,
          lastViewMode: "folder",
          pinnedPaths: ["notes/other-pinned.md"],
        }));

        await (view as any).onOpen();

        const pinToggleHandler = mockState.panelEventHandlers["pin-toggle"];
        pinToggleHandler({ detail: { path: "notes/stale-unpin.md", pinned: false } });

        expect(plugin.saveSettings).not.toHaveBeenCalled();
      });

      it("pin-toggle event isolation: does not trigger open-note or card-context-menu handlers", async () => {
        const { view, plugin } = createViewWithFile("notes/isolation-pin.md");

        await (view as any).onOpen();

        const pinToggleHandler = mockState.panelEventHandlers["pin-toggle"];
        pinToggleHandler({ detail: { path: "notes/isolation-pin.md", pinned: true } });

        expect(mockState.menuInstances).toHaveLength(0);
        expect(plugin.openNoteFromCard).not.toHaveBeenCalled();
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
      });

      it("all major subscriptions (open-note, card-context-menu, filter-change, pin-toggle) exist after onOpen", async () => {
        const { view } = createViewWithFile("notes/quad-subscription.md");

        await (view as any).onOpen();

        expect(mockState.panelEventHandlers["open-note"]).toBeDefined();
        expect(mockState.panelEventHandlers["card-context-menu"]).toBeDefined();
        expect(mockState.panelEventHandlers["filter-change"]).toBeDefined();
        expect(mockState.panelEventHandlers["include-subfolders-change"]).toBeDefined();
        expect(mockState.panelEventHandlers["search-query-change"]).toBeDefined();
        expect(mockState.panelEventHandlers["search-query-reset"]).toBeDefined();
        expect(mockState.panelEventHandlers["pin-toggle"]).toBeDefined();
        expect(typeof mockState.panelEventHandlers["pin-toggle"]).toBe("function");
      });

      it("registers bulk subscriptions", async () => {
        const { view } = createViewWithFile("notes/bulk-subscriptions.md");

        (view as any).modules.bulk.bulkMode = true;
        (view as any).modules.bulk.selectedPaths = new Set(["notes/bulk-subscriptions.md"]);
        (view as any).modules.bulk.anchorPath = "notes/bulk-subscriptions.md";

        await (view as any).onOpen();

        expect(mockState.panelEventHandlers["toolbar-action"]).toBeDefined();
        expect(mockState.panelEventHandlers["bulk-select-card"]).toBeDefined();
        expect(typeof mockState.panelEventHandlers["toolbar-action"]).toBe("function");
        expect(typeof mockState.panelEventHandlers["bulk-select-card"]).toBe("function");
        expect(mockState.panelInstances).toHaveLength(1);
        expect(mockState.panelInstances[0]?.initialProps).toMatchObject({
          bulk: {
            bulkMode: true,
            selectedPaths: ["notes/bulk-subscriptions.md"],
            selectedCount: 1,
            bulkAnchorPath: "notes/bulk-subscriptions.md",
            canBulkSelectAll: false,
            canBulkClearSelection: true,
            canBulkMoveSelected: true,
            canBulkAddTagSelected: true,
            canBulkRemoveTagSelected: true,
            canBulkDeleteSelected: true,
            canBulkMergeSelected: false,
          },
        });
      });

      it("bulk selection state machine", async () => {
        const { view, app } = createViewWithFile("notes/bulk-state-machine.md");
        const visibleCards = [
          createCardRecordFromPath("notes/alpha.md"),
          createCardRecordFromPath("notes/gamma.md"),
          createCardRecordFromPath("notes/beta.md"),
        ];
        const fileMap = new Map(visibleCards.map((card) => [card.path, card.file]));

        app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => fileMap.get(requestedPath) ?? null);
        (view as any).visibleCards = visibleCards;
        (view as any).modules.projection.deriveVisibleCards = vi.fn(() => visibleCards);
        (view as any).modules.bulk.bulkMode = true;
        (view as any).modules.bulk.selectedPaths = new Set(["notes/gamma.md"]);
        (view as any).modules.bulk.anchorPath = "notes/alpha.md";

        await (view as any).onOpen();

        const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
        toolbarActionHandler({ detail: { action: "bulk-select-all" } });

        expect(Array.from((view as any).modules.bulk.selectedPaths)).toEqual([
          "notes/alpha.md",
          "notes/gamma.md",
          "notes/beta.md",
        ]);
        expect((view as any).modules.bulk.anchorPath).toBe("notes/alpha.md");

        const afterSelectAll = mockState.panelInstances[0]?.modelSnapshots.at(-1);
        expect(afterSelectAll).toMatchObject({
          bulk: {
            selectedPaths: ["notes/alpha.md", "notes/gamma.md", "notes/beta.md"],
            selectedCount: 3,
            bulkAnchorPath: "notes/alpha.md",
            canBulkSelectAll: true,
            canBulkClearSelection: true,
            canBulkMoveSelected: true,
            canBulkAddTagSelected: true,
            canBulkRemoveTagSelected: true,
            canBulkDeleteSelected: true,
            canBulkMergeSelected: true,
          },
        });

        toolbarActionHandler({ detail: { action: "bulk-clear-selection" } });

        expect((view as any).modules.bulk.selectedPaths.size).toBe(0);
        expect((view as any).modules.bulk.anchorPath).toBeNull();

        const afterClear = mockState.panelInstances[0]?.modelSnapshots.at(-1);
        expect(afterClear).toMatchObject({
          bulk: {
            selectedPaths: [],
            selectedCount: 0,
            bulkAnchorPath: null,
            canBulkSelectAll: true,
            canBulkClearSelection: false,
            canBulkMoveSelected: false,
            canBulkAddTagSelected: false,
            canBulkRemoveTagSelected: false,
            canBulkDeleteSelected: false,
            canBulkMergeSelected: false,
          },
        });
      });

      it("bulk toolbar actions and enablement", async () => {
        const { view, app } = createViewWithFile("notes/bulk-toolbar.md");
        const visibleCards = [
          createCardRecordFromPath("notes/alpha.md"),
          createCardRecordFromPath("notes/beta.md"),
          createCardRecordFromPath("notes/gamma.md"),
        ];
        const fileMap = new Map(visibleCards.map((card) => [card.path, card.file]));

        app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => fileMap.get(requestedPath) ?? null);
        (view as any).visibleCards = visibleCards;
        (view as any).modules.projection.deriveVisibleCards = vi.fn(() => visibleCards);
        (view as any).modules.bulk.bulkMode = true;

        await (view as any).onOpen();

        expect(mockState.panelInstances).toHaveLength(1);
        expect(mockState.panelInstances[0]?.initialProps).toMatchObject({
          bulk: {
            bulkMode: true,
            selectedPaths: [],
            selectedCount: 0,
            bulkAnchorPath: null,
            canBulkSelectAll: true,
            canBulkClearSelection: false,
            canBulkMoveSelected: false,
            canBulkAddTagSelected: false,
            canBulkRemoveTagSelected: false,
            canBulkDeleteSelected: false,
            canBulkMergeSelected: false,
          },
        });

        (view as any).modules.bulk.selectedPaths = new Set(["notes/beta.md"]);
        (view as any).modules.bulk.anchorPath = "notes/beta.md";
        publishAll(view);

        const afterSingleSelect = mockState.panelInstances[0]?.modelSnapshots.at(-1);
        expect(afterSingleSelect).toMatchObject({
          bulk: {
            selectedPaths: ["notes/beta.md"],
            selectedCount: 1,
            bulkAnchorPath: "notes/beta.md",
            canBulkSelectAll: true,
            canBulkClearSelection: true,
            canBulkMoveSelected: true,
            canBulkAddTagSelected: true,
            canBulkRemoveTagSelected: true,
            canBulkDeleteSelected: true,
            canBulkMergeSelected: false,
          },
        });

        const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
        toolbarActionHandler({ detail: { action: "bulk-select-all" } });

        expect(Array.from((view as any).modules.bulk.selectedPaths)).toEqual([
          "notes/alpha.md",
          "notes/beta.md",
          "notes/gamma.md",
        ]);

        const afterSelectAll = mockState.panelInstances[0]?.modelSnapshots.at(-1);
        expect(afterSelectAll).toMatchObject({
          bulk: {
            selectedPaths: ["notes/alpha.md", "notes/beta.md", "notes/gamma.md"],
            selectedCount: 3,
            bulkAnchorPath: "notes/beta.md",
            canBulkSelectAll: true,
            canBulkClearSelection: true,
            canBulkMoveSelected: true,
            canBulkAddTagSelected: true,
            canBulkRemoveTagSelected: true,
            canBulkDeleteSelected: true,
            canBulkMergeSelected: true,
          },
        });
      });

      it("exiting bulk mode clears selection", async () => {
        const { view } = createViewWithFile("notes/bulk-exit.md");
        const visibleCards = [
          createCardRecordFromPath("notes/alpha.md"),
          createCardRecordFromPath("notes/beta.md"),
        ];

        (view as any).visibleCards = visibleCards;
        (view as any).modules.projection.deriveVisibleCards = vi.fn(() => visibleCards);
        (view as any).modules.bulk.bulkMode = true;
        (view as any).modules.bulk.selectedPaths = new Set(["notes/alpha.md", "notes/beta.md"]);
        (view as any).modules.bulk.anchorPath = "notes/alpha.md";

        await (view as any).onOpen();

        const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
        toolbarActionHandler({ detail: { action: "bulk" } });

        expect((view as any).modules.bulk.bulkMode).toBe(false);
        expect((view as any).modules.bulk.selectedPaths.size).toBe(0);
        expect((view as any).modules.bulk.anchorPath).toBeNull();
        expect(mockState.panelInstances[0]?.modelSnapshots.at(-1)).toMatchObject({
          bulk: {
            bulkMode: false,
            selectedPaths: [],
            selectedCount: 0,
            bulkAnchorPath: null,
            canBulkSelectAll: true,
            canBulkClearSelection: false,
            canBulkMoveSelected: false,
            canBulkAddTagSelected: false,
            canBulkRemoveTagSelected: false,
            canBulkDeleteSelected: false,
            canBulkMergeSelected: false,
          },
        });
      });

      it("onOpen passes includeSubfolders and folder scope props to the panel", async () => {
        const { view } = createViewWithFile("notes/folder-scope-props.md");

        (view as any).cardScope = createFolderScope("projects/active", true);

        await (view as any).onOpen();

        expect(mockState.panelInstances).toHaveLength(1);
        expect(mockState.panelInstances[0]?.initialProps).toMatchObject({
          scope: { displayPath: "projects/active", includeSubfolders: true },
          appearance: { previewLines: 5 },
        });
      });

      it("onOpen passes a legible root folder scope state to the panel", async () => {
        const { view } = createViewWithFile("notes/root-props.md");

        (view as any).cardScope = createFolderScope("", true);

        await (view as any).onOpen();

        expect(mockState.panelInstances).toHaveLength(1);
        expect(mockState.panelInstances[0]?.initialProps).toMatchObject({
          scope: { displayPath: "/", includeSubfolders: true },
        });
      });

      it("include-subfolders-change persists valid boolean values in folder scope", async () => {
        const { view, plugin } = createViewWithFile("notes/include-subfolders.md");

        (view as any).cardScope = createFolderScope("projects/active", true);

        await (view as any).onOpen();

        const includeSubfoldersHandler = mockState.panelEventHandlers["include-subfolders-change"];
        expect(includeSubfoldersHandler).toBeDefined();

        includeSubfoldersHandler({ detail: { value: false } });

        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(plugin.saveSettings).toHaveBeenCalledWith({
          includeSubfolders: false,
        });
      });

      it("include-subfolders-change ignores invalid values", async () => {
        const { view, plugin } = createViewWithFile("notes/include-subfolders-invalid.md");

        (view as any).cardScope = createFolderScope("projects/active", true);

        await (view as any).onOpen();

        const includeSubfoldersHandler = mockState.panelEventHandlers["include-subfolders-change"];
        includeSubfoldersHandler({ detail: { value: "nope" } });

        expect(plugin.saveSettings).not.toHaveBeenCalled();
      });

      it("include-subfolders-change persists valid boolean values in root folder scope", async () => {
        const { view, plugin } = createViewWithFile("notes/include-subfolders-root.md");

        (view as any).cardScope = createFolderScope("", true);

        await (view as any).onOpen();

        const includeSubfoldersHandler = mockState.panelEventHandlers["include-subfolders-change"];
        includeSubfoldersHandler({ detail: { value: false } });

        expect(plugin.saveSettings).toHaveBeenCalledWith({
          includeSubfolders: false,
        });
      });

      it("include-subfolders-change is a no-op when the requested value already matches settings", async () => {
        const { view, plugin } = createViewWithFile("notes/include-subfolders-same-value.md");

        (view as any).cardScope = createFolderScope("projects/active", true);

        await (view as any).onOpen();

        const includeSubfoldersHandler = mockState.panelEventHandlers["include-subfolders-change"];
        includeSubfoldersHandler({ detail: { value: true } });

        expect(plugin.saveSettings).not.toHaveBeenCalled();
      });

      it("sort-change subscription persists the requested sort settings", async () => {
        const { view, plugin } = createViewWithFile("notes/sort-change.md");

        await (view as any).onOpen();

        const sortChangeHandler = mockState.panelEventHandlers["sort-change"];
        expect(sortChangeHandler).toBeDefined();

        sortChangeHandler({ detail: { field: "ctime", direction: "asc" } });

        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(plugin.saveSettings).toHaveBeenCalledWith({
          sort: {
            field: "ctime",
            direction: "asc",
          },
        });
      });

      it("group-change subscription persists the requested group settings in folder scope", async () => {
        const { view, plugin } = createViewWithFile("notes/group-change.md");

        await (view as any).onOpen();

        const groupChangeHandler = mockState.panelEventHandlers["group-change"];
        expect(groupChangeHandler).toBeDefined();

        groupChangeHandler({ detail: { dimension: "folder", orderBy: "name", orderDirection: "desc" } });
        await flushAsyncWork();

        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(plugin.saveSettings).toHaveBeenCalledWith({
          group: { dimension: "folder", orderBy: "name", orderDirection: "desc" },
        });
      });

      it("group-change writes nothing for an equal or malformed request", async () => {
        const { view, plugin } = createViewWithFile("notes/group-change-noop.md");

        await (view as any).onOpen();

        const groupChangeHandler = mockState.panelEventHandlers["group-change"];
        groupChangeHandler({ detail: { dimension: "none", orderBy: "default", orderDirection: "asc" } });
        groupChangeHandler({ detail: { dimension: "not-a-dimension" } });
        groupChangeHandler({ detail: {} });
        await flushAsyncWork();

        expect(plugin.saveSettings).not.toHaveBeenCalled();
      });

      it("group-change in box scope updates the active box instead of the global group", async () => {
        const { view, plugin } = createViewWithFile("notes/group-change-box.md");
        const box = {
          id: "box-1",
          name: "Box",
          rules: [],
          manualPaths: [],
          excludedPaths: [],
          pinnedPaths: [],
          sort: { field: "mtime", direction: "desc" },
          group: { dimension: "none", orderBy: "default", orderDirection: "asc" },
        };
        plugin.getSettings = vi.fn(() => ({
          includeSubfolders: true,
          sort: { field: "mtime", direction: "desc" },
          visiblePropertyKeys: [],
          expandedPropertyKeys: [],
          filter: { tags: [], properties: [] },
          pinnedPaths: [],
          previewLines: 5,
          group: { dimension: "none", orderBy: "default", orderDirection: "asc" },
          boxes: [box],
          favorites: [],
          activeBoxId: box.id,
          sectionCollapsed: { favorites: false, folders: false, tags: false, properties: false, boxes: false },
        }));
        (view as any).cardScope = createBoxScope(box.id);

        await (view as any).onOpen();

        mockState.panelEventHandlers["group-change"]({ detail: { dimension: "box-rule" } });
        await flushAsyncWork();

        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        const patch = plugin.saveSettings.mock.calls[0][0];
        expect(patch.group).toBeUndefined();
        expect(patch.boxes[0].group).toEqual({
          dimension: "box-rule",
          orderBy: "default",
          orderDirection: "asc",
        });
      });

      it("group-collapse routes into runtime collapse state without any settings write", async () => {
        const { view, plugin } = createViewWithFile("notes/group-collapse.md");
        plugin.getSettings = vi.fn(() => ({
          includeSubfolders: true,
          sort: { field: "mtime", direction: "desc" },
          visiblePropertyKeys: [],
          expandedPropertyKeys: [],
          filter: { tags: [], properties: [] },
          pinnedPaths: [],
          previewLines: 5,
          group: { dimension: "folder", orderBy: "default", orderDirection: "asc" },
        }));

        await (view as any).onOpen();

        const collapseHandler = mockState.panelEventHandlers["group-collapse"];
        expect(collapseHandler).toBeDefined();

        const scope = view.getCardScope();
        const collapsedKeys = () => (view as any).modules.groupCollapse.getCollapsedKeys(scope, "folder");

        collapseHandler({ detail: { command: "toggle", key: "folder:notes" } });
        expect(collapsedKeys().has("folder:notes")).toBe(true);

        collapseHandler({ detail: { command: "expand-all" } });
        expect(collapsedKeys().size).toBe(0);

        collapseHandler({ detail: { command: "collapse-all" } });
        collapseHandler({ detail: { command: "toggle" } });
        collapseHandler({ detail: { command: "not-a-command" } });

        expect(plugin.saveSettings).not.toHaveBeenCalled();
      });

      it("select-folder subscription routes to plugin.selectFolderByPath with panel-picker source", async () => {
        const { view, plugin } = createViewWithFile("notes/select-folder.md");

        await (view as any).onOpen();

        const selectFolderHandler = mockState.panelEventHandlers["select-folder"];
        expect(selectFolderHandler).toBeDefined();

        selectFolderHandler({ detail: { path: "projects/archive" } });

        expect(plugin.selectFolderByPath).toHaveBeenCalledTimes(1);
        expect(plugin.selectFolderByPath).toHaveBeenCalledWith("projects/archive", "panel-picker");
      });


      it("hydrate-viewport subscription forwards an identity-bearing request", async () => {
        const { view, app, file } = createViewWithFile("notes/hydrate-viewport.md");
        const card = createCardRecord(file);

        app.vault.cachedRead = vi.fn(async () => "# Hydrate me\nBody");
        (view as any).baseCards = [card];
        (view as any).visibleCards = [card];
        (view as any).modules.scopeController.loading = false;

        await (view as any).onOpen();
        const hydrateViewportSpy = vi.spyOn((view as any).modules.hydration, "hydrateViewport");

        const hydrateViewportHandler = mockState.panelEventHandlers["hydrate-viewport"];
        expect(hydrateViewportHandler).toBeDefined();

        hydrateViewportHandler({ detail: null });
        hydrateViewportHandler({ detail: { start: 0, end: 1 } });
        hydrateViewportHandler({ detail: { generation: "0", hydrationRevision: 0, start: 0, end: 1, paths: [card.path] } });
        hydrateViewportHandler({ detail: { generation: 0, hydrationRevision: 0, start: 0, end: 1, paths: [42] } });
        await flushAsyncWork(1);
        expect(hydrateViewportSpy).not.toHaveBeenCalled();

        const request = viewportRequest(view, 0, 1);
        hydrateViewportHandler({ detail: request });
        await flushAsyncWork(1);
        await flushAsyncWork(1);

        expect(hydrateViewportSpy).toHaveBeenCalledOnce();
        expect(hydrateViewportSpy).toHaveBeenCalledWith(request);
        expect(app.vault.cachedRead).toHaveBeenCalledTimes(1);
        expect(app.vault.cachedRead).toHaveBeenCalledWith(file);
        const hydratedCard = (view as any).baseCards.find((entry: { path: string }) => entry.path === card.path);
        expect(hydratedCard?.hydrated).toBe(true);
      });
      it("prewarms projected startup cards within the first-screen wait budget", async () => {
        const { view, app, plugin } = createViewWithFile("notes/prewarm-projection-seed.md");
        const pinnedFile = createMarkdownFile("notes/pinned.md");
        const remainingTaggedFiles = Array.from({ length: 12 }, (_, index) =>
          createMarkdownFile(`notes/tagged-${index + 2}.md`),
        );
        const filteredOutFile = createMarkdownFile("notes/filtered-out.md");
        const files = [pinnedFile, ...remainingTaggedFiles, filteredOutFile];

        files.forEach((file, index) => {
          (file as unknown as { stat: { ctime: number; mtime: number } }).stat = {
            ctime: index + 1,
            mtime: file.path === filteredOutFile.path ? 200 : index + 1,
          };
        });

        const notesFolder = attachChildren(createFolder("notes"), files);
        const fileByPath = new Map(files.map((file) => [file.path, file] as const));

        plugin.getSettings = vi.fn(() => ({
          includeSubfolders: true,
          sort: { field: "mtime", direction: "desc" },
          visiblePropertyKeys: [],
          expandedPropertyKeys: [],
          filter: { tags: ["focus"], properties: [] },
          defaultView: "cards",
          lastFolderPath: null,
          lastViewMode: "folder",
          pinnedPaths: [pinnedFile.path],
          previewLines: 5,
        }));

        app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
          if (requestedPath === "notes") {
            return notesFolder;
          }
          return fileByPath.get(requestedPath) ?? null;
        });
        app.metadataCache.getFileCache = vi.fn((file: { path: string }) => {
          if (file.path === filteredOutFile.path) {
            return { tags: [{ tag: "#other" }] };
          }
          return { tags: [{ tag: "#focus" }] };
        });
        app.vault.cachedRead = vi.fn(async (file: { basename: string }) => `# ${file.basename}\nBody ${file.basename}`);

        await (view as any).onOpen();
        await (view as any).handleScopeSelection({
          requestId: 6,
          scope: createFolderScope("notes", true),
          source: "programmatic",
          requestedAtMs: Date.now(),
          forceRefresh: false,
        });

        const firstStableSnapshot = mockState.panelInstances[0]?.modelSnapshots.find(
          (snapshot: any) =>
            snapshot.cards.loading === false &&
            Array.isArray(snapshot.cards.records) &&
            snapshot.cards.records.length > 0,
        ) as { cards?: { records: Array<{ path: string; hydrated: boolean }> } } | undefined;

        expect(firstStableSnapshot).toBeDefined();
        expect(firstStableSnapshot?.cards?.records).toHaveLength(13);
        expect(firstStableSnapshot?.cards?.records?.[0]?.path).toBe(pinnedFile.path);
        expect(
          firstStableSnapshot?.cards?.records?.slice(0, 6).every((card) => card.hydrated),
        ).toBe(true);
        expect(firstStableSnapshot?.cards?.records?.[6]?.hydrated).toBe(false);
        expect(app.vault.cachedRead).toHaveBeenCalledTimes(6);
        expect(app.vault.cachedRead).not.toHaveBeenCalledWith(filteredOutFile);
      });

      it("startup prewarm prevents duplicate viewport reads on open", async () => {
        const { view, app } = createViewWithFile("notes/prewarm-no-dup.md");
        const files = Array.from({ length: 13 }, (_, index) => {
          const file = createMarkdownFile(`notes/prewarm-${index + 1}.md`);
          (file as unknown as { stat: { ctime: number; mtime: number } }).stat = {
            ctime: index + 1,
            mtime: index + 1,
          };
          return file;
        });
        const notesFolder = attachChildren(createFolder("notes"), files);
        const fileByPath = new Map(files.map((file) => [file.path, file] as const));

        app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
          if (requestedPath === "notes") {
            return notesFolder;
          }
          return fileByPath.get(requestedPath) ?? null;
        });
        app.vault.cachedRead = vi.fn(async (file: { basename: string }) => `# ${file.basename}\nBody`);

        await (view as any).onOpen();
        await (view as any).handleScopeSelection({
          requestId: 7,
          scope: createFolderScope("notes", true),
          source: "programmatic",
          requestedAtMs: Date.now(),
          forceRefresh: false,
        });

        expect(app.vault.cachedRead).toHaveBeenCalledTimes(6);

        const hydrateViewportHandler = mockState.panelEventHandlers["hydrate-viewport"];
        expect(hydrateViewportHandler).toBeDefined();

        hydrateViewportHandler({ detail: viewportRequest(view, 0, 12) });
        await flushAsyncWork(8);

        expect(app.vault.cachedRead).toHaveBeenCalledTimes(12);
      });

      it("releases the first stable card snapshot when startup preview hydration exceeds the wait budget", async () => {
        vi.useFakeTimers();
        try {
          const { view, app } = createViewWithFile("notes/prewarm-timeout.md");
          const file = createMarkdownFile("notes/prewarm-timeout.md");
          (file as unknown as { stat: { ctime: number; mtime: number } }).stat = {
            ctime: 1,
            mtime: 1,
          };
          const notesFolder = attachChildren(createFolder("notes"), [file]);
          const delayedRead = createDeferred<string>();

          app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
            if (requestedPath === "notes") {
              return notesFolder;
            }
            return requestedPath === file.path ? file : null;
          });
          app.vault.cachedRead = vi.fn(() => delayedRead.promise);

          const loadPromise = (view as any).modules.scopeController.loadScope(
            {
              scope: createFolderScope("notes", true),
              sort: { field: "mtime", direction: "desc" },
            },
            "notes|true|mtime|desc",
          );

          await flushAsyncWork(1);
          expect((view as any).modules.scopeController.loading).toBe(true);
          expect((view as any).modules.hydration.hasPending(file.path)).toBe(true);

          vi.advanceTimersByTime(120);
          await loadPromise;

          const card = (view as any).baseCards[0];
          expect((view as any).modules.scopeController.loading).toBe(false);
          expect(card?.hydrated).toBe(false);
          expect(card?.previewHtml).toBe("");

          delayedRead.resolve("# delayed\ncontent");
          await flushAsyncWork(8);

          const hydratedCard = (view as any).baseCards.find(
            (entry: { path: string }) => entry.path === file.path,
          );
          expect(hydratedCard?.hydrated).toBe(true);
          expect(hydratedCard?.previewHtml).not.toBe("");
          expect((view as any).modules.hydration.hasPending(file.path)).toBe(false);
        } finally {
          vi.useRealTimers();
        }
      });

      it("drops stale startup prewarm results after generation changes", async () => {
        const { view, app } = createViewWithFile("notes/stale-startup-prewarm.md");
        const file = createMarkdownFile("notes/stale-startup-prewarm.md");
        (file as unknown as { stat: { ctime: number; mtime: number } }).stat = {
          ctime: 1,
          mtime: 1,
        };
        const notesFolder = attachChildren(createFolder("notes"), [file]);
        const staleRead = createDeferred<string>();

        app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
          if (requestedPath === "notes") {
            return notesFolder;
          }
          return requestedPath === file.path ? file : null;
        });
        app.vault.cachedRead = vi.fn(() => staleRead.promise);

        const loadPromise = (view as any).modules.scopeController.loadScope(
          {
            scope: createFolderScope("notes", true),
            sort: { field: "mtime", direction: "desc" },
          },
          "notes|true|mtime|desc",
        );

        await flushAsyncWork(1);

        expect((view as any).modules.hydration.hasPending(file.path)).toBe(true);

        (view as any).epochs.load.bump();
        (view as any).modules.hydration.clearPending();

        staleRead.resolve("# stale\ncontent");
        await loadPromise;

        const card = (view as any).baseCards[0];
        expect(card?.hydrated).toBe(false);
        expect(card?.previewHtml).toBe("");
        expect(card?.previewMode).toBe("empty");
        expect((view as any).modules.hydration.hasPending(file.path)).toBe(false);
      });

      it("hydrateViewport publishes each bounded scheduler batch", async () => {
        const { view, app } = createViewWithFile("notes/range-single-push.md");
        const files = Array.from({ length: 12 }, (_, index) => {
          const file = createMarkdownFile(`notes/range-${index + 1}.md`);
          (file as unknown as { stat: { ctime: number; mtime: number } }).stat = {
            ctime: index + 1,
            mtime: index + 1,
          };
          return file;
        });
        const notesFolder = attachChildren(createFolder("notes"), files);
        const fileByPath = new Map(files.map((file) => [file.path, file] as const));

        app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
          if (requestedPath === "notes") {
            return notesFolder;
          }
          return fileByPath.get(requestedPath) ?? null;
        });
        app.vault.cachedRead = vi.fn(async (file: { basename: string }) => `# ${file.basename}\nBody`);

        await (view as any).handleScopeSelection({
          requestId: 8,
          scope: createFolderScope("notes", true),
          source: "programmatic",
          requestedAtMs: Date.now(),
          forceRefresh: false,
        });

        vi.mocked(app.vault.cachedRead).mockClear();
        for (const card of (view as any).baseCards) {
          card.hydrated = false;
          card.previewHtml = "";
          card.previewMode = "empty";
        }
        (view as any).modules.hydration.clearPreviewCache();
        (view as any).modules.hydration.clearPending();

        const publishHydrationSpy = vi.spyOn((view as any).context, "publishGroups");
        publishHydrationSpy.mockClear();

        await (view as any).modules.hydration.hydrateViewport(viewportRequest(view, 0, 12));

        expect(app.vault.cachedRead).toHaveBeenCalledTimes(12);
        expect(publishHydrationSpy).toHaveBeenCalledTimes(3);
        expect((view as any).baseCards.every((card: { hydrated: boolean }) => card.hydrated)).toBe(true);
      });


      it("onClose unmounts the panel instance and clears registered handlers", async () => {
        const { view } = createViewWithFile("notes/close-cleanup.md");

        (view as any).modules.scopeController.queuedRequest = { requestId: 1 };
        (view as any).modules.scopeController.refreshQueued = true;
        (view as any).modules.scopeController.inFlight = Promise.resolve();
        (view as any).modules.scopeController.inFlightKey = "notes/close-cleanup.md";
        (view as any).modules.scopeController.loading = true;
        const generationBeforeClose = (view as any).epochs.load.value;

        await (view as any).onOpen();

        const mountedComponent = (view as any).component;

        await (view as any).onClose();

        expect(mockState.svelteUnmountMock).toHaveBeenCalledTimes(1);
        expect(mockState.svelteUnmountMock).toHaveBeenCalledWith(mountedComponent);
        expect((view as any).component).toBeNull();
        expect((view as any).hostEl).toBeNull();
        expect((view as any).modules.scopeController.queuedRequest).toBeNull();
        expect((view as any).modules.scopeController.refreshQueued).toBe(false);
        expect((view as any).modules.hydration.hasPending("notes/close-cleanup.md")).toBe(false);
        expect((view as any).modules.scopeController.inFlight).toBeNull();
        expect((view as any).modules.scopeController.inFlightKey).toBeNull();
        expect((view as any).modules.scopeController.loading).toBe(false);
        expect((view as any).epochs.load.value).toBe(generationBeforeClose + 1);
      });

      describe("Task 6: preview settings refresh wiring and generation safety", () => {
        it("hydrates with updated previewLines after settings-change refresh", async () => {
          const { view, app, plugin } = createViewWithFile("notes/preview-refresh.md");
          const file = createMarkdownFile("notes/preview-refresh.md");
          (file as unknown as { stat: { ctime: number; mtime: number } }).stat = {
            ctime: 1,
            mtime: 1,
          };
          const notesFolder = attachChildren(createFolder("notes"), [file]);
          let previewLines = 3;
          const previewSpy = vi.spyOn(markdownUtils, "buildLightPreview");

          plugin.getSettings = vi.fn(() => ({
            includeSubfolders: true,
            sort: { field: "mtime", direction: "desc" },
            visiblePropertyKeys: [],
            expandedPropertyKeys: [],
            filter: { tags: [], properties: [] },
            defaultView: "cards",
            lastFolderPath: null,
            lastViewMode: "folder",
            pinnedPaths: [],
            previewLines,
          }));

          app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
            if (requestedPath === "notes") {
              return notesFolder;
            }
            if (requestedPath === file.path) {
              return file;
            }
            return null;
          });
          app.vault.cachedRead = vi.fn(async () => "line1\nline2\nline3\nline4");

          await (view as any).handleScopeSelection({
            requestId: 1,
            scope: createFolderScope("notes", true),
            source: "programmatic",
            requestedAtMs: Date.now(),
            forceRefresh: false,
          });
          await (view as any).modules.hydration.hydrateViewport(viewportRequest(view, 0, 1));

          expect(previewSpy).toHaveBeenLastCalledWith(
            "line1\nline2\nline3\nline4",
            expect.any(Number),
            3,
          );

          previewLines = 9;

          await (view as any).refresh({
            reason: "settings-change",
            folderPath: "notes",
            forceRefresh: true,
          });
          await (view as any).modules.hydration.hydrateViewport(viewportRequest(view, 0, 1));

          expect(previewSpy).toHaveBeenLastCalledWith(
            "line1\nline2\nline3\nline4",
            expect.any(Number),
            8,
          );
        });

        it("ignores stale hydration errors after previewLines change bumps generation", async () => {
          const { view, app, plugin } = createViewWithFile("notes/stale-refresh.md");
          const files = Array.from({ length: 13 }, (_, index) => {
            const file = createMarkdownFile(`notes/stale-refresh-${index + 1}.md`);
            (file as unknown as { stat: { ctime: number; mtime: number } }).stat = {
              ctime: index + 1,
              mtime: index + 1,
            };
            return file;
          });
          const staleFile = files[0];
          const notesFolder = attachChildren(createFolder("notes"), files);
          const firstReadError = new Error("stale read failed");
          const staleRead = createDeferred<string>();
          let previewLines = 4;
          const previewSpy = vi.spyOn(markdownUtils, "buildLightPreview");

          plugin.getSettings = vi.fn(() => ({
            includeSubfolders: true,
            sort: { field: "mtime", direction: "desc" },
            visiblePropertyKeys: [],
            expandedPropertyKeys: [],
            filter: { tags: [], properties: [] },
            defaultView: "cards",
            lastFolderPath: null,
            lastViewMode: "folder",
            pinnedPaths: [],
            previewLines,
          }));

          const fileByPath = new Map(files.map((file) => [file.path, file] as const));
          app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
            if (requestedPath === "notes") {
              return notesFolder;
            }
            return fileByPath.get(requestedPath) ?? null;
          });

          app.vault.cachedRead = vi.fn((file: { path: string }) => {
            if (file.path === staleFile?.path) {
              return staleRead.promise;
            }
            return Promise.resolve("fresh\npreview\ncontent");
          });

          await (view as any).handleScopeSelection({
            requestId: 2,
            scope: createFolderScope("notes", true),
            source: "programmatic",
            requestedAtMs: Date.now(),
            forceRefresh: false,
          });

          vi.mocked(app.vault.cachedRead).mockClear();
          previewSpy.mockClear();

          const staleHydration = (view as any).modules.hydration.hydrateViewport(viewportRequest(view, 12, 13));
          await flushAsyncWork(1);

          previewLines = 8;
          (view as any).epochs.load.bump();
          (view as any).modules.hydration.clearPending();
          staleRead.reject(firstReadError);
          await staleHydration;
          vi.mocked(app.vault.cachedRead).mockImplementation(async () => "fresh\npreview\ncontent");


          const staleCard = (view as any).baseCards.find((card: { path: string }) => card.path === staleFile?.path);
          expect(staleCard?.hydrated).toBe(false);
          expect(staleCard?.previewHtml).toBe("");
          expect(staleCard?.previewMode).toBe("empty");

          await (view as any).modules.hydration.hydrateViewport(viewportRequest(view, 12, 13));

          expect(previewSpy).toHaveBeenCalledTimes(1);
          expect(previewSpy).toHaveBeenLastCalledWith(
            "fresh\npreview\ncontent",
            expect.any(Number),
            8,
          );
          expect((view as any).baseCards[0]?.hydrated).toBe(true);
        });

        it("settings-change previewLines refresh keeps sort/filter/includeSubfolders panel props stable", async () => {
          const { view, app, plugin } = createViewWithFile("notes/preview-props.md");
          const file = createMarkdownFile("notes/preview-props.md");
          (file as unknown as { stat: { ctime: number; mtime: number } }).stat = {
            ctime: 2,
            mtime: 2,
          };
          const notesFolder = attachChildren(createFolder("notes"), [file]);
          const pinnedPaths = [file.path];
          let previewLines = 4;
          const previewSpy = vi.spyOn(markdownUtils, "buildLightPreview");

          plugin.getSettings = vi.fn(() => ({
            includeSubfolders: false,
            sort: { field: "ctime", direction: "asc" },
            visiblePropertyKeys: [],
            expandedPropertyKeys: [],
            filter: { tags: [], properties: [] },
            defaultView: "cards",
            lastFolderPath: null,
            lastViewMode: "folder",
            pinnedPaths,
            previewLines,
          }));

          app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
            if (requestedPath === "notes") {
              return notesFolder;
            }
            if (requestedPath === file.path) {
              return file;
            }
            return null;
          });
          app.vault.cachedRead = vi.fn(async () => "only\none\ntwo\nthree");

          await (view as any).onOpen();
          await (view as any).handleScopeSelection({
            requestId: 3,
            scope: createFolderScope("notes", true),
            source: "programmatic",
            requestedAtMs: Date.now(),
            forceRefresh: false,
          });
          await (view as any).modules.hydration.hydrateViewport(viewportRequest(view, 0, 1));

          expect(previewSpy).toHaveBeenLastCalledWith(
            "only\none\ntwo\nthree",
            expect.any(Number),
            4,
          );
          expect(mockState.panelInstances).toHaveLength(1);
          expect(mockState.panelInstances[0]?.modelSnapshots.at(-1)).toMatchObject({
            projection: {
              sortField: "ctime",
              sortDirection: "asc",
              activeFilterTags: [],
              pinnedPaths,
            },
            scope: { includeSubfolders: false },
            appearance: { previewLines: 4 },
          });

          previewLines = 10;
          await (view as any).refresh({
            reason: "settings-change",
            folderPath: "notes",
            forceRefresh: true,
          });
          await (view as any).modules.hydration.hydrateViewport(viewportRequest(view, 0, 1));

          expect(previewSpy).toHaveBeenLastCalledWith(
            "only\none\ntwo\nthree",
            expect.any(Number),
            8,
          );
          expect(mockState.panelInstances[0]?.modelSnapshots.at(-1)).toMatchObject({
            projection: {
              sortField: "ctime",
              sortDirection: "asc",
              activeFilterTags: [],
              pinnedPaths,
            },
            scope: { includeSubfolders: false },
            appearance: { previewLines: 10 },
          });
        });

        it("hydrateViewport keeps sparse content non-empty while empty markdown remains empty", async () => {
          const { view, app } = createViewWithFile("notes/preview-sparse-empty.md");
          const emptyFile = createMarkdownFile("notes/empty.md");
          const sparseFile = createMarkdownFile("notes/sparse.md");
          (emptyFile as unknown as { stat: { ctime: number; mtime: number } }).stat = {
            ctime: 3,
            mtime: 3,
          };
          (sparseFile as unknown as { stat: { ctime: number; mtime: number } }).stat = {
            ctime: 4,
            mtime: 4,
          };
          const notesFolder = attachChildren(createFolder("notes"), [emptyFile, sparseFile]);

          app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
            if (requestedPath === "notes") {
              return notesFolder;
            }
            if (requestedPath === emptyFile.path) {
              return emptyFile;
            }
            if (requestedPath === sparseFile.path) {
              return sparseFile;
            }
            return null;
          });

          app.vault.cachedRead = vi.fn(async (file: { path: string }) => {
            if (file.path === emptyFile.path) {
              return "\n  \n\t";
            }
            if (file.path === sparseFile.path) {
              return "single real preview line";
            }
            return "";
          });

          await (view as any).handleScopeSelection({
            requestId: 4,
            scope: createFolderScope("notes", true),
            source: "programmatic",
            requestedAtMs: Date.now(),
            forceRefresh: false,
          });
          await (view as any).modules.hydration.hydrateViewport(viewportRequest(view, 0, 2));

          const emptyCard = (view as any).baseCards.find((card: { path: string }) => card.path === emptyFile.path);
          const sparseCard = (view as any).baseCards.find((card: { path: string }) => card.path === sparseFile.path);

          expect(emptyCard?.hydrated).toBe(true);
          expect(emptyCard?.previewMode).toBe("empty");
          expect(emptyCard?.previewHtml).toBe("");

          expect(sparseCard?.hydrated).toBe(true);
          expect(sparseCard?.previewMode).not.toBe("empty");
          expect(sparseCard?.previewHtml).not.toBe("");
        });

        it("hydrateViewport keeps code previews in the normalized paragraph clamp surface", async () => {
          const { view, app } = createViewWithFile("notes/preview-code-clamp.md");
          const codeFile = createMarkdownFile("notes/code.md");
          (codeFile as unknown as { stat: { ctime: number; mtime: number } }).stat = {
            ctime: 5,
            mtime: 5,
          };
          const notesFolder = attachChildren(createFolder("notes"), [codeFile]);

          app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
            if (requestedPath === "notes") {
              return notesFolder;
            }
            if (requestedPath === codeFile.path) {
              return codeFile;
            }
            return null;
          });

          app.vault.cachedRead = vi.fn(async () => "```ts\nconst alpha = 1;\nconst beta = 2;\nconst gamma = 3;\n```");

          await (view as any).handleScopeSelection({
            requestId: 5,
            scope: createFolderScope("notes", true),
            source: "programmatic",
            requestedAtMs: Date.now(),
            forceRefresh: false,
          });
          await (view as any).modules.hydration.hydrateViewport(viewportRequest(view, 0, 1));

          const codeCard = (view as any).baseCards.find((card: { path: string }) => card.path === codeFile.path);

          expect(codeCard?.hydrated).toBe(true);
          expect(codeCard?.previewMode).toBe("code");
          expect(codeCard?.previewHtml).toContain('<p class="fce-preview-code">');
          expect(codeCard?.previewHtml).not.toContain("<pre");
        });
      });
    });

  // Cross-module: view.handleVaultMutation -> incremental mutation + scope refresh.
  // Call entry is FolderCardView, not applyIncrementalMutation directly.
  describe("rename-driven incremental refresh after move", () => {
    it("rename removes card when move leaves current folder scope", () => {
      const { view, file } = createViewWithFile("notes/inside.md");
      (view as any).cardScope = createFolderScope("notes", true);
      (view as any).baseCards = [createCardRecord(file)];

      const result = (view as any).handleVaultMutation({
        eventType: "rename",
        oldPath: "notes/inside.md",
        path: "archive/inside.md",
        isFolder: false,
        fileKind: "markdown",
      });

      expect(result.shouldRefresh).toBe(false);
      expect(result.queueAction).toBe("ignored");
      expect(result.incrementalResult).toEqual({ handled: true, action: "removed" });
      expect((view as any).baseCards).toHaveLength(0);
      expect((view as any).modules.scopeController.refreshQueued).toBe(false);
    });

    it("rename updates card path when move stays visible in recursive root scope", () => {
      const { view, app, file } = createViewWithFile("notes/move-me.md");
      const movedFile = new mockState.MockTFile("archive/move-me.md");
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        return requestedPath === movedFile.path ? movedFile : null;
      });

      (view as any).cardScope = createFolderScope("", true);
      (view as any).baseCards = [createCardRecord(file)];

      const result = (view as any).handleVaultMutation({
        eventType: "rename",
        oldPath: "notes/move-me.md",
        path: "archive/move-me.md",
        isFolder: false,
        fileKind: "markdown",
      });

      expect(result.shouldRefresh).toBe(false);
      expect(result.queueAction).toBe("ignored");
      expect(result.incrementalResult).toEqual({ handled: true, action: "updated" });
      expect((view as any).baseCards).toHaveLength(1);
      expect((view as any).baseCards[0]?.path).toBe("archive/move-me.md");
      expect((view as any).baseCards[0]?.title).toBe("move-me");
      expect((view as any).baseCards[0]?.file).toBe(movedFile);
      expect((view as any).modules.scopeController.refreshQueued).toBe(false);
    });
  });
  describe("Phase 2 regression hardening", () => {
    it("restores single-note open and context-menu behavior after exiting bulk mode", async () => {
      const { view, plugin, file } = createViewWithFile("notes/single-note-after-bulk.md");
      const mouseEvent = { clientX: 44, clientY: 99 };

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      const openNoteHandler = mockState.panelEventHandlers["open-note"];
      const contextMenuHandler = mockState.panelEventHandlers["card-context-menu"];

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set([file.path]);
      (view as any).modules.bulk.anchorPath = file.path;

      openNoteHandler({ detail: { path: file.path } });
      expect(plugin.openNoteFromCard).not.toHaveBeenCalled();

      toolbarActionHandler({ detail: { action: "bulk" } });

      expect((view as any).modules.bulk.bulkMode).toBe(false);
      expect((view as any).modules.bulk.selectedPaths.size).toBe(0);
      expect((view as any).modules.bulk.anchorPath).toBeNull();

      openNoteHandler({ detail: { path: file.path } });
      contextMenuHandler({
        detail: { path: file.path, trigger: "contextmenu", mouseEvent },
      });

      expect(plugin.openNoteFromCard).toHaveBeenCalledTimes(1);
      expect(plugin.openNoteFromCard).toHaveBeenCalledWith(file.path);
      expect(mockState.menuInstances).toHaveLength(1);
      expect(mockState.menuInstances[0]?.showAtMouseEvent).toHaveBeenCalledWith(mouseEvent);
    });

    it("keeps filter, pin, and include-subfolders toolbar actions functional after bulk mode toggles", async () => {
      const { view, plugin } = createViewWithFile("projects/active/phase2-toggle.md");

      (view as any).cardScope = createFolderScope("projects/active", true);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      const filterChangeHandler = mockState.panelEventHandlers["filter-change"];
      const pinToggleHandler = mockState.panelEventHandlers["pin-toggle"];
      const includeSubfoldersHandler = mockState.panelEventHandlers["include-subfolders-change"];

      toolbarActionHandler({ detail: { action: "bulk" } });
      toolbarActionHandler({ detail: { action: "bulk" } });

      filterChangeHandler({ detail: { tags: ["#Work"] } });
      pinToggleHandler({ detail: { path: "projects/active/phase2-toggle.md", pinned: true } });
      includeSubfoldersHandler({ detail: { value: false } });
      await flushAsyncWork();

      expect(plugin.saveSettings).toHaveBeenNthCalledWith(1, {
        filter: {
          tags: ["work"],
        },
      });
      expect(plugin.saveSettings).toHaveBeenNthCalledWith(2, {
        pinnedPaths: ["projects/active/phase2-toggle.md"],
      });
      expect(plugin.saveSettings).toHaveBeenNthCalledWith(3, {
        includeSubfolders: false,
      });
    });

    it("treats zero-selection bulk actions as safe no-ops", async () => {
      const { view } = createViewWithFile("notes/zero-selection.md");

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set<string>();
      (view as any).modules.bulk.anchorPath = null;

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-move-selected" } });
      toolbarActionHandler({ detail: { action: "bulk-delete-selected" } });
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();

      expect(mockState.folderPickerInstances).toHaveLength(0);
      expect(mockState.modalInstances).toHaveLength(0);
      expect(batchMoveFiles).not.toHaveBeenCalled();
      expect(batchTrashFiles).not.toHaveBeenCalled();
      expect(batchDeleteFilesUsingObsidianPreference).not.toHaveBeenCalled();
      expect(mergeNotes).not.toHaveBeenCalled();
      expect(mockState.noticeMessages).toEqual([]);
    });

    it("avoids pipeline and tag recomputation for bulk selection-only state updates", async () => {
      const { view } = createViewWithFile("notes/selection-hot-path.md");
      const firstPath = "notes/first.md";
      const secondPath = "notes/second.md";
      const visibleCards = [
        createCardRecordFromPath(firstPath),
        createCardRecordFromPath(secondPath),
      ];

      (view as any).modules.bulk.bulkMode = true;
      (view as any).baseCards = visibleCards;
      (view as any).visibleCards = visibleCards;
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => visibleCards);

      await (view as any).onOpen();

      const deriveVisibleCardsSpy = vi.spyOn((view as any).modules.projection, "deriveVisibleCardsFrom");
      const deriveAvailableTagsSpy = vi.spyOn((view as any).modules.projection, "deriveAvailableTags");

      const bulkSelectCardHandler = mockState.panelEventHandlers["bulk-select-card"];
      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];

      bulkSelectCardHandler({ detail: { path: firstPath, shiftKey: false } });
      bulkSelectCardHandler({ detail: { path: secondPath, shiftKey: false } });
      toolbarActionHandler({ detail: { action: "bulk-clear-selection" } });
      toolbarActionHandler({ detail: { action: "bulk" } });
      toolbarActionHandler({ detail: { action: "bulk" } });

      expect(deriveVisibleCardsSpy).not.toHaveBeenCalled();
      expect(deriveAvailableTagsSpy).not.toHaveBeenCalled();
    });

    it("bulk delete uses Obsidian preference-respecting confirmation and reconciles stale selection", async () => {
      const { view, app } = createViewWithFile("notes/delete-stale.md");
      const liveFile = createMarkdownFile("notes/live.md");
      const stalePath = "notes/stale.md";

      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === liveFile.path) {
          return liveFile;
        }
        return null;
      });

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set([stalePath, liveFile.path]);
      (view as any).modules.bulk.anchorPath = stalePath;
      (view as any).baseCards = [
        createCardRecordFromPath(stalePath),
        createCardRecordFromPath(liveFile.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(stalePath),
        createCardRecordFromPath(liveFile.path),
      ];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(stalePath),
        createCardRecordFromPath(liveFile.path),
      ]);

      vi.mocked(batchDeleteFilesUsingObsidianPreference).mockResolvedValueOnce({
        succeeded: [{ ok: true, file: liveFile as unknown as any }],
        failed: [],
      } as any);

      await (view as any).onOpen();

      expect(mockState.panelInstances).toHaveLength(1);

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-delete-selected" } });
      await flushAsyncWork(1);

      expect(Array.from((view as any).modules.bulk.selectedPaths)).toEqual([liveFile.path]);
      expect((view as any).modules.bulk.anchorPath).toBe(liveFile.path);
      expect(mockState.modalInstances).toHaveLength(1);
      expect(mockState.modalInstances[0]?.title).toBe("Delete selected notes?");
      expect(mockState.modalInstances[0]?.messages).toEqual([
        "Delete 1 selected note? Obsidian will use your Files & Links delete preference.",
      ]);

      clickLatestModalButton("Delete");
      await flushAsyncWork();

      expect(batchDeleteFilesUsingObsidianPreference).toHaveBeenCalledTimes(1);
      expect(batchDeleteFilesUsingObsidianPreference).toHaveBeenCalledWith(app, [liveFile] as unknown as any);
      expect(batchTrashFiles).not.toHaveBeenCalled();
      expect(Array.from((view as any).modules.bulk.selectedPaths)).toEqual([]);
      expect((view as any).modules.bulk.anchorPath).toBeNull();
      expect(mockState.noticeMessages).toEqual(["Deleted 1 note."]);
    });

    it("keeps the bulk merge modal usable when submit throws unexpectedly", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const notesFolder = createFolder("notes");

      app.vault.read = vi.fn(async () => "body");
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === "notes") {
          return notesFolder;
        }
        return null;
      });

      vi.mocked(mergeNotes).mockReset();
      vi.mocked(mergeNotes).mockRejectedValueOnce(new Error("boom"));

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set([first.path, second.path]);
      (view as any).modules.bulk.anchorPath = first.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();

      clickLatestModalButton("Merge notes");
      await flushAsyncWork();

      expect(mergeNotes).toHaveBeenCalledTimes(1);
      expect(mockState.noticeMessages).toContain("Failed to merge notes: Error: boom");
      expect(mockState.modalInstances.at(-1)?.title).toBe("Merge selected notes");
      expect(mockState.modalInstances.at(-1)?.buttons.some((button) => button.text === "Merge notes")).toBe(true);
      expect(batchTrashFiles).not.toHaveBeenCalled();
    });

    it("clears bulk selection after successful merge while keeping selectedPath stable", async () => {
      const { view, app } = createViewWithFile("notes/merge-clears-selection.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const notesFolder = createFolder("notes");

      app.vault.read = vi.fn(async () => "body");
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === "notes") {
          return notesFolder;
        }
        return null;
      });

      (view as any).selectedPath = "notes/editor-focused.md";
      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set([first.path, second.path]);
      (view as any).modules.bulk.anchorPath = first.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ]);

      vi.mocked(mergeNotes).mockResolvedValueOnce({
        ok: true,
        mergedFile: createMarkdownFile("notes/Merged notes.md") as unknown as any,
        sourceCount: 2,
      });

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();

      clickLatestModalButton("Merge notes");
      await flushAsyncWork();

      expect(mergeNotes).toHaveBeenCalledTimes(1);
      expect(batchTrashFiles).not.toHaveBeenCalled();
      expect(Array.from((view as any).modules.bulk.selectedPaths)).toEqual([]);
      expect((view as any).modules.bulk.anchorPath).toBeNull();
      expect((view as any).selectedPath).toBe("notes/editor-focused.md");
      expect((view as any).modules.bulk.bulkMode).toBe(true);
    });
  });
  describe("Phase 1 regression hardening", () => {
    it("pushState updates the panel to root scope while preserving sort, filter, and pinned props", () => {
      const { view, plugin } = createViewWithFile("notes/push-state-root.md");

      plugin.getSettings = vi.fn(() => ({
        includeSubfolders: false,
        sort: { field: "ctime", direction: "asc" },
        visiblePropertyKeys: [],
        expandedPropertyKeys: [],
        filter: { tags: ["alpha", "beta"], properties: [] },
        defaultView: "cards",
        lastFolderPath: "",
        pinnedPaths: ["notes/pinned.md"],
      }));

      (view as any).component = mockState.createMountedPanel({
        props: { panelModel: (view as any).panelModel },
      });
      (view as any).cardScope = createFolderScope("", true);
      (view as any).baseCards = [createCardRecord(createMarkdownFile("notes/pinned.md"))];

      publishAll(view);

      expect((view as any).component.modelSnapshots.at(-1)).toMatchObject({
        scope: {
          displayPath: "/",
          includeSubfolders: false,
        },
        projection: {
          sortField: "ctime",
          sortDirection: "asc",
          activeFilterTags: ["alpha", "beta"],
          pinnedPaths: ["notes/pinned.md"],
        },
      });
    });

    it("selectedPath stays independent from bulk selection", () => {
      const { view } = createViewWithFile("notes/independent-selection.md");
      const selectedPaths = new Set(["notes/a.md", "notes/b.md"]);
      const visibleCards = [
        createCardRecordFromPath("notes/a.md"),
        createCardRecordFromPath("notes/b.md"),
      ];

      (view as any).component = mockState.createMountedPanel({
        props: { panelModel: (view as any).panelModel },
      });
      (view as any).selectedPath = "notes/previous.md";
      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = selectedPaths;
      (view as any).modules.bulk.anchorPath = "notes/a.md";
      (view as any).baseCards = visibleCards;
      (view as any).visibleCards = visibleCards;
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => visibleCards);
      const reprojectCards = vi.spyOn((view as any).modules.projection, "reprojectCards");
      const deriveAvailableTags = vi.spyOn((view as any).modules.projection, "deriveAvailableTags");
      const searchRefresh = vi.spyOn((view as any).modules.search, "refreshProjection");

      (view as any).setSelectedFile("notes/independent-selection.md");

      expect((view as any).selectedPath).toBe("notes/independent-selection.md");
      expect(Array.from((view as any).modules.bulk.selectedPaths)).toEqual(["notes/a.md", "notes/b.md"]);
      expect((view as any).modules.bulk.anchorPath).toBe("notes/a.md");
      expect((view as any).component.modelSnapshots.at(-1)).toMatchObject({
        cards: { selectedPath: "notes/independent-selection.md" },
        bulk: {
          bulkMode: true,
          selectedPaths: ["notes/a.md", "notes/b.md"],
          selectedCount: 2,
        },
      });
      expect(reprojectCards).not.toHaveBeenCalled();
      expect(deriveAvailableTags).not.toHaveBeenCalled();
      expect(searchRefresh).not.toHaveBeenCalled();
    });

    it("pushState includes bulk runtime payload", () => {
      const { view, app, plugin } = createViewWithFile("notes/bulk-runtime-payload.md");
      const firstSelectedPath = "notes/first.md";
      const secondSelectedPath = "notes/second.md";
      const firstFile = createMarkdownFile(firstSelectedPath);
      const secondFile = createMarkdownFile(secondSelectedPath);

      plugin.getSettings = vi.fn(() => ({
        includeSubfolders: true,
        sort: { field: "mtime", direction: "desc" },
        visiblePropertyKeys: [],
        expandedPropertyKeys: [],
        filter: { tags: [], properties: [] },
        defaultView: "cards",
        lastFolderPath: null,
        lastViewMode: "folder",
        pinnedPaths: [],
        previewLines: 5,
      }));

      (view as any).component = mockState.createMountedPanel({
        props: { panelModel: (view as any).panelModel },
      });
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === firstSelectedPath) {
          return firstFile;
        }
        if (requestedPath === secondSelectedPath) {
          return secondFile;
        }
        return null;
      });
      (view as any).visibleCards = [createCardRecord(firstFile), createCardRecord(secondFile)];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => (view as any).visibleCards);
      (view as any).cardScope = createFolderScope("notes", true);
      (view as any).selectedPath = "notes/editor-sync.md";
      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set([firstSelectedPath, secondSelectedPath]);
      (view as any).modules.bulk.anchorPath = firstSelectedPath;
      publishAll(view);

      expect((view as any).component.modelSnapshots.at(-1)).toMatchObject({
        cards: { selectedPath: "notes/editor-sync.md" },
        bulk: {
          bulkMode: true,
          selectedPaths: [firstSelectedPath, secondSelectedPath],
          selectedCount: 2,
          bulkAnchorPath: firstSelectedPath,
          canBulkSelectAll: true,
          canBulkClearSelection: true,
          canBulkMoveSelected: true,
          canBulkDeleteSelected: true,
          canBulkMergeSelected: true,
        },
      });
    });

    it("supports base canvas and excalidraw cards without non-markdown cachedRead", () => {
      const { view, app } = createViewWithFile("projects/active/direct.md");
      const root = attachChildren(createFolder("projects/active"), [
        createMarkdownFile("projects/active/direct.md"),
        createNonMarkdownFile("projects/active/reference.base", "base"),
        createNonMarkdownFile("projects/active/flow.canvas", "canvas"),
        createNonMarkdownFile("projects/active/sketch.excalidraw", "excalidraw"),
        createMarkdownFile("projects/active/sketch.excalidraw.md"),
        createNonMarkdownFile("projects/active/image.png"),
      ]);

      app.vault.getAbstractFileByPath = vi.fn(() => root);

      expect((view as any).modules.scopeController.collectScopeFiles(createFolderScope("projects/active", false)).map((file: { path: string }) => file.path)).toEqual([
        "projects/active/direct.md",
        "projects/active/reference.base",
        "projects/active/flow.canvas",
        "projects/active/sketch.excalidraw",
        "projects/active/sketch.excalidraw.md",
      ]);
    });

    it("collectSupportedFiles recurses nested markdown files when includeSubfolders is true", () => {
      const { view, app } = createViewWithFile("projects/active/direct.md");
      const root = attachChildren(createFolder("projects/active"), [
        createMarkdownFile("projects/active/direct.md"),
        attachChildren(createFolder("projects/active/nested"), [
          createMarkdownFile("projects/active/nested/deep.md"),
        ]),
      ]);

      app.vault.getAbstractFileByPath = vi.fn(() => root);

      expect((view as any).modules.scopeController.collectScopeFiles(createFolderScope("projects/active", true)).map((file: { path: string }) => file.path)).toEqual([
        "projects/active/direct.md",
        "projects/active/nested/deep.md",
      ]);
    });

    it("collectSupportedFiles recurses from root when includeSubfolders is true", () => {
      const { view, app } = createViewWithFile("projects/active/direct.md");
      const root = attachChildren(createFolder(""), [
        createMarkdownFile("projects/active/direct.md"),
        attachChildren(createFolder("projects/active/nested"), [
          createMarkdownFile("projects/active/nested/deep.md"),
        ]),
      ]);

      app.vault.getRoot = vi.fn(() => root);

      expect((view as any).modules.scopeController.collectScopeFiles(createFolderScope("", true)).map((file: { path: string }) => file.path)).toEqual([
        "projects/active/direct.md",
        "projects/active/nested/deep.md",
      ]);
    });

    it("isPathInScope excludes nested descendants for direct root scope and includes them recursively", () => {
      const { view } = createViewWithFile("notes/root.md");

      (view as any).cardScope = createFolderScope("", true);

      expect((view as any).modules.scopeController.isPathInScope("root.md", false)).toBe(true);
      expect((view as any).modules.scopeController.isPathInScope("archive/nested.md", false)).toBe(false);
      expect((view as any).modules.scopeController.isPathInScope("archive/nested.md", true)).toBe(true);
    });

    it("vault mutations ignore nested descendants when includeSubfolders is false", () => {
      const { view, plugin } = createViewWithFile("projects/active/direct.md");

      (view as any).cardScope = createFolderScope("projects/active", false);
      plugin.getSettings = vi.fn(() => ({
        includeSubfolders: false,
        sort: { field: "mtime", direction: "desc" },
        visiblePropertyKeys: [],
        expandedPropertyKeys: [],
        filter: { tags: [], properties: [] },
        defaultView: "cards",
        lastFolderPath: null,
        lastViewMode: "folder",
        pinnedPaths: [],
      }));

      expect(
        (view as any).modules.scopeController.shouldRefreshForVaultEvent({
          eventType: "create",
          path: "projects/active/nested/deep.md",
          isFolder: false,
          fileKind: "markdown",
          oldPath: null,
        }),
      ).toBe(false);
    });

    it("vault mutations include nested descendants when includeSubfolders is true", () => {
      const { view, plugin } = createViewWithFile("projects/active/direct.md");

      (view as any).cardScope = createFolderScope("projects/active", true);
      plugin.getSettings = vi.fn(() => ({
        includeSubfolders: true,
        sort: { field: "mtime", direction: "desc" },
        visiblePropertyKeys: [],
        expandedPropertyKeys: [],
        filter: { tags: [], properties: [] },
        defaultView: "cards",
        lastFolderPath: null,
        lastViewMode: "folder",
        pinnedPaths: [],
      }));

      expect(
        (view as any).modules.scopeController.shouldRefreshForVaultEvent({
          eventType: "create",
          path: "projects/active/nested/deep.md",
          isFolder: false,
          fileKind: "markdown",
        }),
      ).toBe(true);
    });

    it("bulk selection reconciliation", () => {
      const { view } = createViewWithFile("notes/reconcile-reorder.md");
      const cardA = createCardRecordFromPath("notes/a.md");
      const cardB = createCardRecordFromPath("notes/b.md");
      const cardC = createCardRecordFromPath("notes/c.md");

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set(["notes/a.md", "notes/c.md"]);
      (view as any).modules.bulk.anchorPath = "notes/a.md";
      (view as any).baseCards = [cardA, cardB, cardC];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [cardC, cardA]);

      publishAll(view);

      expect(Array.from((view as any).modules.bulk.selectedPaths)).toEqual(["notes/c.md", "notes/a.md"]);
      expect((view as any).modules.bulk.anchorPath).toBe("notes/a.md");

      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [cardC]);
      publishAll(view);

      expect(Array.from((view as any).modules.bulk.selectedPaths)).toEqual(["notes/c.md"]);
      expect((view as any).modules.bulk.anchorPath).toBe("notes/c.md");

      (view as any).modules.bulk.selectedPaths = new Set(["notes/stale.md"]);
      (view as any).modules.bulk.anchorPath = "notes/stale.md";
      (view as any).cleanupLifecycle();

      expect((view as any).modules.bulk.selectedPaths.size).toBe(0);
      expect((view as any).modules.bulk.anchorPath).toBeNull();
      expect((view as any).modules.bulk.bulkMode).toBe(true);
    });

    it("filter and scope changes reconcile bulk selection", async () => {
      const { view, app, plugin } = createViewWithFile("notes/scope-reconcile.md");
      const directFile = createMarkdownFile("notes/direct.md");
      const nestedFile = createMarkdownFile("notes/nested/deep.md");
      (directFile as unknown as { stat: { ctime: number; mtime: number } }).stat = { ctime: 10, mtime: 10 };
      (nestedFile as unknown as { stat: { ctime: number; mtime: number } }).stat = { ctime: 11, mtime: 11 };

      const nestedFolder = attachChildren(createFolder("notes/nested"), [nestedFile]);
      const notesFolder = attachChildren(createFolder("notes"), [directFile, nestedFolder]);
      const rootFolder = attachChildren(createFolder(""), [notesFolder]);
      let includeSubfolders = true;

      plugin.getSettings = vi.fn(() => ({
        includeSubfolders,
        sort: { field: "mtime", direction: "desc" },
        visiblePropertyKeys: [],
        expandedPropertyKeys: [],
        filter: { tags: [], properties: [] },
        defaultView: "cards",
        lastFolderPath: null,
        lastViewMode: "folder",
        pinnedPaths: [],
        previewLines: 5,
      }));

      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === "notes") {
          return notesFolder;
        }
        if (requestedPath === directFile.path) {
          return directFile;
        }
        if (requestedPath === nestedFile.path) {
          return nestedFile;
        }
        return null;
      });
      app.vault.getRoot = vi.fn(() => rootFolder);
      app.vault.cachedRead = vi.fn(async () => "preview");

      await (view as any).handleScopeSelection({
        requestId: 21,
        scope: createFolderScope("notes", true),
        source: "programmatic",
        requestedAtMs: Date.now(),
        forceRefresh: false,
      });

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set(["notes/direct.md", "notes/nested/deep.md"]);
      (view as any).modules.bulk.anchorPath = "notes/direct.md";
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [createCardRecordFromPath("notes/direct.md")]);

      publishAll(view);

      expect(Array.from((view as any).modules.bulk.selectedPaths)).toEqual(["notes/direct.md"]);
      expect((view as any).modules.bulk.anchorPath).toBe("notes/direct.md");

      includeSubfolders = false;
      await (view as any).handleScopeSelection({
        requestId: 22,
        scope: createFolderScope("notes", includeSubfolders),
        source: "programmatic",
        requestedAtMs: Date.now(),
        forceRefresh: true,
      });

      expect((view as any).modules.bulk.bulkMode).toBe(true);
      expect((view as any).modules.bulk.selectedPaths.size).toBe(0);
      expect((view as any).modules.bulk.anchorPath).toBeNull();

      (view as any).modules.bulk.selectedPaths = new Set(["notes/direct.md"]);
      (view as any).modules.bulk.anchorPath = "notes/direct.md";
      await (view as any).handleScopeSelection({
        requestId: 23,
        scope: createFolderScope("", true),
        source: "programmatic",
        requestedAtMs: Date.now(),
        forceRefresh: true,
      });

      expect((view as any).modules.bulk.bulkMode).toBe(true);
      expect((view as any).modules.bulk.selectedPaths.size).toBe(0);
      expect((view as any).modules.bulk.anchorPath).toBeNull();
    });

    it("scope changes clear bulk selection immediately while load is in flight", async () => {
      const { view, app, plugin } = createViewWithFile("notes/inflight-scope-change.md");
      const component = mockState.createMountedPanel({
        props: { panelModel: (view as any).panelModel },
      });
      const notesFolder = createFolder("notes");

      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        return requestedPath === "notes" ? notesFolder : null;
      });

      (view as any).component = component;
      (view as any).modules.bulk.bulkMode = true;
      (view as any).cardScope = createFolderScope("notes", true);
      (view as any).modules.bulk.selectedPaths = new Set(["notes/keep.md", "notes/drop.md"]);
      (view as any).modules.bulk.anchorPath = "notes/keep.md";
      (view as any).baseCards = [
        createCardRecordFromPath("notes/keep.md"),
        createCardRecordFromPath("notes/drop.md"),
      ];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath("notes/keep.md"),
        createCardRecordFromPath("notes/drop.md"),
      ]);
      (view as any).modules.scopeController.inFlight = Promise.resolve();
      (view as any).modules.scopeController.inFlightKey = "notes::true::mtime::desc";
      (view as any).modules.scopeController.inFlightLoadKey = {
        scope: createFolderScope("notes", true),
        sort: { field: "mtime", direction: "desc" },
      };

      plugin.getSettings = vi.fn(() => ({
        includeSubfolders: false,
        sort: { field: "mtime", direction: "desc" },
        visiblePropertyKeys: [],
        expandedPropertyKeys: [],
        filter: { tags: [], properties: [] },
        defaultView: "cards",
        lastFolderPath: null,
        lastViewMode: "folder",
        pinnedPaths: [],
        previewLines: 5,
      }));

      const result = await (view as any).handleScopeSelection({
        requestId: 24,
        scope: createFolderScope("notes", false),
        source: "programmatic",
        requestedAtMs: Date.now(),
        forceRefresh: true,
      });

      expect(result.action).toBe("queued_latest");
      expect((view as any).modules.bulk.bulkMode).toBe(true);
      expect((view as any).modules.bulk.selectedPaths.size).toBe(0);
      expect((view as any).modules.bulk.anchorPath).toBeNull();
      expect(component.modelSnapshots.at(-1)).toMatchObject({
        bulk: {
          bulkMode: true,
          selectedPaths: [],
          selectedCount: 0,
          bulkAnchorPath: null,
        },
      });
    });

    it("rename and delete mutations update selectedPaths", () => {
      const { view, app } = createViewWithFile("notes/mutation-selected.md");
      const fileA = createMarkdownFile("notes/mutation-selected.md");
      const fileB = createMarkdownFile("notes/keep-or-delete.md");
      const renamedFile = createMarkdownFile("notes/renamed-selected.md");

      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === renamedFile.path) {
          return renamedFile;
        }
        return null;
      });

      (view as any).cardScope = createFolderScope("notes", true);
      (view as any).modules.bulk.bulkMode = true;
      (view as any).baseCards = [createCardRecord(fileA), createCardRecord(fileB)];
      (view as any).modules.bulk.selectedPaths = new Set([fileA.path, fileB.path]);
      (view as any).modules.bulk.anchorPath = fileA.path;

      const renameResult = (view as any).handleVaultMutation({
        eventType: "rename",
        oldPath: fileA.path,
        path: renamedFile.path,
        isFolder: false,
        fileKind: "markdown",
      });

      expect(renameResult.shouldRefresh).toBe(false);
      expect(renameResult.incrementalResult).toEqual({ handled: true, action: "updated" });
      expect((view as any).modules.bulk.selectedPaths.has(fileA.path)).toBe(false);
      expect((view as any).modules.bulk.selectedPaths.has(renamedFile.path)).toBe(true);
      expect((view as any).modules.bulk.anchorPath).toBe(renamedFile.path);

      const deleteResult = (view as any).handleVaultMutation({
        eventType: "delete",
        path: fileB.path,
        isFolder: false,
        fileKind: "markdown",
      });

      expect(deleteResult.shouldRefresh).toBe(false);
      expect(deleteResult.incrementalResult).toEqual({ handled: true, action: "removed" });
      expect(Array.from((view as any).modules.bulk.selectedPaths)).toEqual([renamedFile.path]);

      const movedOutOfScopeResult = (view as any).handleVaultMutation({
        eventType: "rename",
        oldPath: renamedFile.path,
        path: "archive/renamed-selected.md",
        isFolder: false,
        fileKind: "markdown",
      });

      expect(movedOutOfScopeResult.shouldRefresh).toBe(false);
      expect(movedOutOfScopeResult.incrementalResult).toEqual({ handled: true, action: "removed" });
      expect((view as any).modules.bulk.selectedPaths.size).toBe(0);
      expect((view as any).modules.bulk.anchorPath).toBeNull();
    });

    it("open-note, sort-change, filter-change, and pin-toggle still work after switching to root scope", async () => {
      const { view, plugin } = createViewWithFile("notes/phase1-regression.md");

      plugin.getSettings = vi.fn(() => ({
        includeSubfolders: true,
        sort: { field: "mtime", direction: "desc" },
        visiblePropertyKeys: [],
        expandedPropertyKeys: [],
        filter: { tags: [], properties: [] },
        defaultView: "cards",
        lastFolderPath: "",
        pinnedPaths: [],
              }));

      (view as any).cardScope = createFolderScope("", true);
      await (view as any).onOpen();
      await (view as any).onOpen();

      mockState.panelEventHandlers["open-note"]({ detail: { path: "notes/phase1-regression.md" } });
      mockState.panelEventHandlers["sort-change"]({ detail: { field: "ctime", direction: "asc" } });
      mockState.panelEventHandlers["filter-change"]({ detail: { tags: ["#Project"] } });
      mockState.panelEventHandlers["pin-toggle"]({ detail: { path: "notes/phase1-regression.md", pinned: true } });

      expect(plugin.openNoteFromCard).toHaveBeenCalledWith("notes/phase1-regression.md");
      expect(plugin.saveSettings).toHaveBeenNthCalledWith(1, {
        sort: {
          field: "ctime",
          direction: "asc",
        },
      });
      expect(plugin.saveSettings).toHaveBeenNthCalledWith(2, {
        filter: {
          tags: ["project"],
        },
      });
      expect(plugin.saveSettings).toHaveBeenNthCalledWith(3, {
        pinnedPaths: ["notes/phase1-regression.md"],
      });
    });
  });
});

describe("FolderCardView property lane host integration (WP-05)", () => {
  beforeEach(() => {
    resetFolderCardViewHarness();
    propertyPickerMockState.openedOptions.length = 0;
    propertyPickerMockState.openCount = 0;
  });

  describe("chooser command routing", () => {
    it("routes choose-visible to the picker modal with a modules.property inventory callback", () => {
      const { view } = createPropertyHarness({
        settings: propertySettings({ visiblePropertyKeys: ["status"] }),
      });
      const collectSpy = vi.spyOn((view as any).modules.property, "collectPropertyInventory");
      const props = buildPanelProps(view as any) as unknown as {
        onPropertyCommand: (detail: { command?: unknown }) => void;
      };

      props.onPropertyCommand({ command: "choose-visible" });

      expect(propertyPickerMockState.openCount).toBe(1);
      const opened = propertyPickerMockState.openedOptions[0];
      expect(opened?.selectedKeys).toEqual(["status"]);
      expect(typeof opened?.collectPropertyInventory).toBe("function");

      // The callback is sourced from the per-view PropertyController.
      opened?.collectPropertyInventory();
      expect(collectSpy).toHaveBeenCalledTimes(1);
    });

    it("routes clear-filters to an empty clause save only when a filter is active", async () => {
      const { view, plugin } = createPropertyHarness({
        settings: propertySettings({
          visiblePropertyKeys: ["status"],
          filterProperties: [propertyClause("status", [propertyText("open")])],
        }),
      });
      const props = buildPanelProps(view as any) as unknown as {
        onPropertyCommand: (detail: { command?: unknown }) => void;
      };

      props.onPropertyCommand({ command: "clear-filters" });
      await flushAsyncWork();

      expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
      expect(plugin.saveSettings).toHaveBeenCalledWith({ filter: { properties: [] } });
    });

    it("writes nothing for clear-filters when no property filter is active", async () => {
      const { view, plugin } = createPropertyHarness({
        settings: propertySettings({ visiblePropertyKeys: ["status"] }),
      });
      const props = buildPanelProps(view as any) as unknown as {
        onPropertyCommand: (detail: { command?: unknown }) => void;
      };

      props.onPropertyCommand({ command: "clear-filters" });
      await flushAsyncWork();

      expect(plugin.saveSettings).not.toHaveBeenCalled();
    });
  });

  describe("selection persistence", () => {
    it("routes a projected property-value activation to applyValueFilter and persists the clause", async () => {
      const { view, plugin } = createPropertyHarness({
        settings: propertySettings({ visiblePropertyKeys: ["status"], expandedPropertyKeys: ["status"] }),
        frontmatter: { "notes/a.md": { status: "open" } },
        cards: [createCardRecordFromPath("notes/a.md")],
      });

      (view as any).publishGroups("nav");

      const rows = (view as any).modules.navLayout.getProjection().rows;
      const valueRow = rows.find(
        (row: any) => row.kind === "property-value" && row.propertyKey === "status",
      );
      expect(valueRow).toBeDefined();

      view.handleNavigationIntent({ type: "activate", rowId: valueRow.id, mode: "ordinary" });
      await flushAsyncWork();

      expect(plugin.saveSettings).toHaveBeenCalledWith({
        filter: { properties: [{ key: "status", values: [{ kind: "text", value: "open" }] }] },
      });
    });
  });

  describe("facet freshness across nav patches", () => {
    it("publishes fresh property rows on a visible-key patch and reuses facets on unrelated patches", async () => {
      const { view, app } = createPropertyHarness({
        settings: propertySettings({ visiblePropertyKeys: ["status"], expandedPropertyKeys: ["status"] }),
        frontmatter: { "notes/a.md": { status: "open" } },
        cards: [createCardRecordFromPath("notes/a.md")],
      });

      await view.applyUpdateIntent("patch", "settings-change");

      let rows = (view as any).modules.navLayout.getProjection().rows;
      expect(rows.some((row: any) => row.kind === "property" && row.propertyKey === "status")).toBe(true);

      const getFileCache = app.metadataCache.getFileCache as ReturnType<typeof vi.fn>;
      const callsAfterVisiblePatch = getFileCache.mock.calls.length;

      // An unrelated nav-chrome patch (navPaneWidth) republishes nav from cache.
      await view.applyUpdateIntent("patch", "settings-change");
      expect(getFileCache.mock.calls.length).toBe(callsAfterVisiblePatch);

      // Explicit metadata invalidation clears the facet cache and forces a rescan.
      (view as any).modules.property.invalidateMetadata(["notes/a.md"]);
      (view as any).publishGroups("nav");
      expect(getFileCache.mock.calls.length).toBeGreaterThan(callsAfterVisiblePatch);
    });
  });

  describe("reproject vs patch publication", () => {
    it("keeps cards identity for a visible-key patch and replaces it for a clause reproject", async () => {
      const { view, plugin } = createPropertyHarness({
        settings: propertySettings({ visiblePropertyKeys: ["status"] }),
        frontmatter: { "notes/a.md": { status: "open" } },
        cards: [createCardRecordFromPath("notes/a.md")],
      });

      const initial = view.panelModel.getState();

      await view.applyUpdateIntent("patch", "settings-change");
      const afterPatch = view.panelModel.getState();
      expect(afterPatch.cards).toBe(initial.cards);
      expect(afterPatch.nav).not.toBe(initial.nav);

      plugin.getSettings = vi.fn(() => propertySettings({
        visiblePropertyKeys: ["status"],
        filterProperties: [propertyClause("status", [propertyText("open")])],
      }));
      await view.applyUpdateIntent("reproject", "settings-change");
      const afterReproject = view.panelModel.getState();

      expect(afterReproject.cards).not.toBe(afterPatch.cards);
      expectGroupsReplaced(
        afterPatch as unknown as Record<string, unknown>,
        afterReproject as unknown as Record<string, unknown>,
        ["nav", "scope", "cards", "projection", "bulk"],
      );
    });
  });

  describe("metadata coordination through the view", () => {
    it("publishes one nav/scope/cards/projection/bulk batch for an in-base change with an active filter", async () => {
      const { view, plugin } = createPropertyHarness({
        settings: propertySettings({
          visiblePropertyKeys: ["status"],
          filterProperties: [propertyClause("status", [propertyText("open")])],
        }),
        frontmatter: { "notes/a.md": { status: "open" } },
        cards: [createCardRecordFromPath("notes/a.md")],
      });

      const emitMetadata = await openWithMetadataListener(view, plugin);

      const listener = vi.fn();
      view.panelModel.subscribe(listener);
      listener.mockClear();
      const initial = view.panelModel.getState();

      emitMetadata({ path: "notes/a.md" });

      expect(listener).toHaveBeenCalledTimes(1);
      const next = view.panelModel.getState();
      expectGroupsReplaced(
        initial as unknown as Record<string, unknown>,
        next as unknown as Record<string, unknown>,
        ["nav", "scope", "cards", "projection", "bulk"],
      );
      expect(next.search).toBe(initial.search);
      expect(next.appearance).toBe(initial.appearance);
    });

    it("publishes nav only for an in-base change with visible keys but no active filter", async () => {
      const { view, plugin } = createPropertyHarness({
        settings: propertySettings({ visiblePropertyKeys: ["status"] }),
        frontmatter: { "notes/a.md": { status: "open" } },
        cards: [createCardRecordFromPath("notes/a.md")],
      });

      const emitMetadata = await openWithMetadataListener(view, plugin);

      const listener = vi.fn();
      view.panelModel.subscribe(listener);
      listener.mockClear();
      const initial = view.panelModel.getState();

      emitMetadata({ path: "notes/a.md" });

      expect(listener).toHaveBeenCalledTimes(1);
      const next = view.panelModel.getState();
      expect(next.nav).not.toBe(initial.nav);
      expect(next.cards).toBe(initial.cards);
      expect(next.scope).toBe(initial.scope);
      expect(next.projection).toBe(initial.projection);
      expect(next.bulk).toBe(initial.bulk);
    });

    it("performs no property-owned publication for an out-of-base metadata event", async () => {
      const { view, plugin } = createPropertyHarness({
        settings: propertySettings({
          visiblePropertyKeys: ["status"],
          filterProperties: [propertyClause("status", [propertyText("open")])],
        }),
        frontmatter: { "notes/a.md": { status: "open" } },
        cards: [createCardRecordFromPath("notes/a.md")],
      });

      const emitMetadata = await openWithMetadataListener(view, plugin);

      const listener = vi.fn();
      view.panelModel.subscribe(listener);
      listener.mockClear();
      const initial = view.panelModel.getState();

      emitMetadata({ path: "elsewhere/unrelated.md" });

      expect(listener).not.toHaveBeenCalled();
      expect(view.panelModel.getState()).toBe(initial);
    });
  });

  describe("empty-state classification", () => {
    it("classifies property-filter, source-empty, and query empty copies", () => {
      const { view } = createPropertyHarness({
        settings: propertySettings({
          visiblePropertyKeys: ["status"],
          filterProperties: [propertyClause("status", [propertyText("open")])],
        }),
        cards: [createCardRecordFromPath("notes/a.md")],
      });
      const strings = getUiStrings("en");
      const card = createCardRecordFromPath("notes/a.md");

      (view as any).baseCards = [card];
      (view as any).visibleCards = [];
      expect((view as any).buildScopeGroup().emptyStateMessage).toBe(strings.property.emptyPropertyFilter);

      (view as any).baseCards = [];
      expect((view as any).buildScopeGroup().emptyStateMessage).toBe(strings.view.emptyFolder);

      (view as any).baseCards = [card];
      (view as any).modules.search.query = "needle";
      expect((view as any).buildScopeGroup().emptyStateMessage).toBe(
        strings.view.emptySearchCurrentFolder("needle"),
      );

      // An active tag filter keeps the source-empty copy even while property
      // clauses exist: the property message claims property filtering alone.
      (view as any).modules.search.query = "";
      const settings = (view as any).plugin.getSettings() as {
        filter: { tags: string[]; properties: unknown };
      };
      settings.filter = { ...settings.filter, tags: ["work"] };
      (view as any).baseCards = [card];
      (view as any).visibleCards = [];
      expect((view as any).buildScopeGroup().emptyStateMessage).toBe(strings.view.emptyFolder);
    });
  });

  describe("disposal", () => {
    it("disposes the property controller in cleanupLifecycle", () => {
      const { view } = createPropertyHarness({
        settings: propertySettings({ visiblePropertyKeys: ["status"] }),
        cards: [createCardRecordFromPath("notes/a.md")],
      });

      expect((view as any).modules.property.derivePropertyFacets().length).toBe(1);

      view.cleanupLifecycle();

      expect((view as any).modules.property.derivePropertyFacets()).toEqual([]);
      expect((view as any).modules.property.collectPropertyInventory()).toEqual({
        status: "unavailable",
        options: [],
      });
    });
  });

  describe("vault invalidation", () => {
    it("clears the property facet cache through the nav-count invalidation path", () => {
      const { view, app } = createPropertyHarness({
        settings: propertySettings({ visiblePropertyKeys: ["status"] }),
        frontmatter: { "notes/a.md": { status: "open" } },
        cards: [createCardRecordFromPath("notes/a.md")],
      });

      (view as any).publishGroups("nav");
      const getFileCache = app.metadataCache.getFileCache as ReturnType<typeof vi.fn>;
      const callsAfterFirstBuild = getFileCache.mock.calls.length;

      view.refreshNavState();

      expect(getFileCache.mock.calls.length).toBeGreaterThan(callsAfterFirstBuild);
    });
  });
});
