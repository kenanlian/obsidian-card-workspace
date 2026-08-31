import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_GROUP_SPEC, type GroupSpec } from "../../card-grouping-settings";
import { getUiStrings } from "../../i18n";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../settings";
import * as metadataUtils from "../metadata-utils";
import { createBoxScope, createFolderScope } from "../scope";
import type { CardBoxDefinition, NoteCardRecord, PipelineSearchInput, Rule } from "../types";
import type { ViewContext } from "../view-context";
import { createViewEpochs } from "../view-epochs";
import { createViewStateStore } from "../view-state-store";
import { ProjectionController } from "./ProjectionController";

function createCard(path: string): NoteCardRecord {
  const basename = path.replace(/.*\//, "").replace(/\.[^.]+$/, "");
  return {
    file: { path, basename } as NoteCardRecord["file"],
    fileKind: "markdown",
    path,
    title: basename,
    ctime: 1,
    mtime: 1,
    excerpt: "",
    previewHtml: "",
    previewMode: "empty",
    hydrated: false,
    taskSummary: null,
  };
}

function createRule(patch: Partial<Rule> = {}): Rule {
  return {
    id: "rule-1",
    name: "Alpha",
    folder: "notes",
    includeSubfolders: true,
    tags: [],
    ...patch,
  };
}

function createBox(rules: Rule[]): CardBoxDefinition {
  return {
    id: "box-1",
    name: "Ideas",
    rules,
    manualPaths: [],
    excludedPaths: [],
    pinnedPaths: [],
    sort: { field: "mtime", direction: "desc" },
    group: { ...DEFAULT_GROUP_SPEC },
  };
}

function createHarness(options: {
  scope?: ReturnType<typeof createFolderScope> | ReturnType<typeof createBoxScope>;
  filterTags?: string[];
  search?: PipelineSearchInput;
  pinnedPaths?: string[];
  group?: GroupSpec;
  collapsedGroupKeys?: ReadonlySet<string>;
  boxes?: CardBoxDefinition[];
  fileCache?: () => unknown;
} = {}) {
  const scope = options.scope ?? createFolderScope("notes", true);
  const getFileCache = vi.fn(options.fileCache ?? (() => ({ tags: [{ tag: "#work" }] })));
  const app = {
    metadataCache: { getFileCache },
    vault: { getMarkdownFiles: vi.fn(() => []), getAbstractFileByPath: vi.fn(() => null) },
  };
  const store = createViewStateStore(scope);
  const state = {
    group: options.group ?? { ...DEFAULT_GROUP_SPEC },
    collapsedGroupKeys: options.collapsedGroupKeys ?? new Set<string>(),
    boxes: options.boxes ?? [],
    language: "en" as "en" | "zh",
  };
  const saveSettings = vi.fn();
  const context = {
    getApp: () => app,
    store,
    epochs: createViewEpochs(),
    getSettings: () => ({
      ...normalizeSettings({
        ...DEFAULT_SETTINGS,
        filter: { tags: options.filterTags ?? [] },
      }),
      boxes: state.boxes,
    }),
    saveSettings,
    getUiStrings: () => getUiStrings(state.language),
    publishGroups: vi.fn(),
    requestUpdate: vi.fn(),
    notify: vi.fn(),
    getViewWindow: () => globalThis,
  } as unknown as ViewContext;
  const controller = new ProjectionController({
    context,
    getSearchInput: () => options.search ?? {
      query: "",
      execution: "indexed-unavailable",
    },
    getEffectivePinnedPaths: () => options.pinnedPaths ?? [],
    getLoadKey: () => "notes::recursive",
    getGroupConfig: () => state.group,
    getCollapsedGroupKeys: () => state.collapsedGroupKeys,
  });

  return { app, context, controller, getFileCache, saveSettings, state, store };
}

describe("ProjectionController", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("applies folder projection in tag, search, then pin order", () => {
    const cards = [createCard("a.md"), createCard("b.md"), createCard("c.md")];
    const { controller } = createHarness({
      filterTags: ["work"],
      search: {
        query: "match",
        execution: "indexed-ready",
        orderedPaths: ["c.md", "b.md", "a.md"],
      },
      pinnedPaths: ["a.md"],
    });
    vi.spyOn(metadataUtils, "matchesTagFilter").mockImplementation(
      (_app, file) => file.path !== "b.md",
    );

    expect(controller.deriveVisibleCardsFrom(cards).map((card) => card.path)).toEqual([
      "a.md",
      "c.md",
    ]);
  });

  it("skips tag filtering in box scope while retaining search and pin ordering", () => {
    const cards = [createCard("a.md"), createCard("b.md"), createCard("c.md")];
    const { controller } = createHarness({
      scope: createBoxScope("box-1"),
      filterTags: ["must-not-run"],
      search: {
        query: "match",
        execution: "indexed-ready",
        orderedPaths: ["c.md", "a.md", "b.md"],
      },
      pinnedPaths: ["b.md"],
    });
    const matches = vi.spyOn(metadataUtils, "matchesTagFilter");

    expect(controller.deriveVisibleCardsFrom(cards).map((card) => card.path)).toEqual([
      "b.md",
      "c.md",
      "a.md",
    ]);
    expect(matches).not.toHaveBeenCalled();
  });

  it("passes the explicit settings filterTags into the pipeline context", () => {
    const card = createCard("a.md");
    const { controller, app } = createHarness({ filterTags: ["#Important", "Work"] });
    const matches = vi.spyOn(metadataUtils, "matchesTagFilter").mockReturnValue(true);

    expect(controller.deriveVisibleCardsFrom([card])).toEqual([card]);
    expect(matches).toHaveBeenCalledWith(app, card.file, ["#Important", "Work"]);
  });

  it("invalidates the scope tag cache on demand", () => {
    const card = createCard("a.md");
    const { controller, getFileCache, store } = createHarness();
    store.replaceBaseCards([card]);

    const first = controller.deriveScopeTags();
    const cached = controller.deriveScopeTags();
    expect(cached).toBe(first);
    expect(getFileCache).toHaveBeenCalledTimes(2);

    controller.invalidateVaultCaches();
    const refreshed = controller.deriveScopeTags();
    expect(refreshed).not.toBe(first);
    expect(getFileCache).toHaveBeenCalledTimes(4);
  });
});

describe("ProjectionController group arrangement", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("writes both the cards and the segments on reprojectCards", () => {
    const cards = [createCard("notes/a.md"), createCard("archive/b.md")];
    const { controller, store } = createHarness({
      group: { ...DEFAULT_GROUP_SPEC, dimension: "folder" },
    });
    store.replaceBaseCards(cards);

    controller.reprojectCards();

    expect(store.getVisibleCards().map((card) => card.path)).toEqual([
      "archive/b.md",
      "notes/a.md",
    ]);
    expect(controller.getGroupSegments().map((segment) => segment.key)).toEqual([
      "folder:archive",
      "folder:notes",
    ]);
  });

  it("leaves the segments empty rather than stale when a query is active", () => {
    const cards = [createCard("notes/a.md"), createCard("archive/b.md")];
    const search: PipelineSearchInput = {
      query: "",
      execution: "indexed-ready",
      orderedPaths: ["notes/a.md", "archive/b.md"],
    };
    const { controller, store } = createHarness({
      group: { ...DEFAULT_GROUP_SPEC, dimension: "folder" },
      search,
    });
    store.replaceBaseCards(cards);

    controller.reprojectCards();
    expect(controller.getGroupSegments()).toHaveLength(2);

    search.query = "roadmap";
    controller.reprojectCards();
    expect(controller.getGroupSegments()).toEqual([]);
  });

  it("caches tag buckets per vaultContent epoch and rebuilds after a bump", () => {
    const cards = [createCard("notes/a.md"), createCard("notes/b.md")];
    const { context, controller, getFileCache, store } = createHarness({
      group: { ...DEFAULT_GROUP_SPEC, dimension: "tag" },
    });
    store.replaceBaseCards(cards);

    controller.reprojectCards();
    const afterFirst = getFileCache.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    controller.reprojectCards();
    expect(getFileCache.mock.calls.length).toBe(afterFirst);

    context.epochs.vaultContent.bump();
    controller.reprojectCards();
    expect(getFileCache.mock.calls.length).toBe(afterFirst * 2);
  });

  it("rebuilds tag buckets after invalidateVaultCaches", () => {
    const cards = [createCard("notes/a.md")];
    const { controller, getFileCache, store } = createHarness({
      group: { ...DEFAULT_GROUP_SPEC, dimension: "tag" },
    });
    store.replaceBaseCards(cards);

    controller.reprojectCards();
    const afterFirst = getFileCache.mock.calls.length;

    controller.invalidateVaultCaches();
    controller.reprojectCards();

    expect(getFileCache.mock.calls.length).toBe(afterFirst * 2);
  });

  it("does not cache the task dimension, so a summary change moves the bucket", () => {
    const card = createCard("notes/a.md");
    const { controller, store } = createHarness({
      group: { ...DEFAULT_GROUP_SPEC, dimension: "task" },
    });
    store.replaceBaseCards([card]);

    controller.reprojectCards();
    expect(controller.getGroupSegments().map((segment) => segment.key)).toEqual(["task:none"]);

    store.patchCardPreviews([{ path: card.path, patch: { taskSummary: { total: 2, incomplete: 1 } } }]);
    controller.reprojectCards();

    expect(controller.getGroupSegments().map((segment) => segment.key)).toEqual([
      "task:incomplete",
    ]);
  });

  it("does not cache the folder dimension, so a moved path moves the bucket", () => {
    const { controller, store } = createHarness({
      group: { ...DEFAULT_GROUP_SPEC, dimension: "folder" },
    });
    store.replaceBaseCards([createCard("notes/a.md")]);
    controller.reprojectCards();
    expect(controller.getGroupSegments().map((segment) => segment.key)).toEqual(["folder:notes"]);

    store.replaceBaseCards([createCard("archive/a.md")]);
    controller.reprojectCards();

    expect(controller.getGroupSegments().map((segment) => segment.key)).toEqual(["folder:archive"]);
  });

  it("re-labels box-rule buckets after a rule rename at an unchanged load key and epoch", () => {
    const rule = createRule();
    const { context, controller, state, store } = createHarness({
      scope: createBoxScope("box-1"),
      group: { ...DEFAULT_GROUP_SPEC, dimension: "box-rule" },
      boxes: [createBox([rule])],
    });
    store.replaceBaseCards([createCard("notes/a.md")]);
    const epochBefore = context.epochs.vaultContent.value;

    controller.reprojectCards();
    expect(controller.getGroupSegments().map((segment) => segment.label)).toEqual(["Alpha"]);

    state.boxes = [createBox([createRule({ name: "Renamed" })])];
    controller.reprojectCards();

    expect(controller.getGroupSegments().map((segment) => segment.label)).toEqual(["Renamed"]);
    expect(context.epochs.vaultContent.value).toBe(epochBefore);
  });

  it("re-labels the missing tag bucket after a UI language switch without invalidation", () => {
    const { controller, state, store } = createHarness({
      group: { ...DEFAULT_GROUP_SPEC, dimension: "tag" },
      fileCache: () => null,
    });
    store.replaceBaseCards([createCard("notes/a.md")]);

    controller.reprojectCards();
    expect(controller.getGroupSegments().map((segment) => segment.label)).toEqual(["No tag"]);

    state.language = "zh";
    controller.reprojectCards();

    expect(controller.getGroupSegments().map((segment) => segment.label)).toEqual(["无标签"]);
  });

  it("bumps groupRevision only when the segment signature changes", () => {
    const cards = [createCard("notes/a.md"), createCard("archive/b.md")];
    const { controller, state, store } = createHarness({
      group: { ...DEFAULT_GROUP_SPEC, dimension: "folder" },
    });
    store.replaceBaseCards(cards);

    controller.reprojectCards();
    const afterFirst = controller.getGroupRevision();

    controller.reprojectCards();
    expect(controller.getGroupRevision()).toBe(afterFirst);

    state.collapsedGroupKeys = new Set(["folder:archive"]);
    controller.reprojectCards();
    const afterCollapse = controller.getGroupRevision();
    expect(afterCollapse).toBeGreaterThan(afterFirst);

    store.replaceBaseCards([...cards, createCard("notes/c.md")]);
    controller.reprojectCards();
    const afterCount = controller.getGroupRevision();
    expect(afterCount).toBeGreaterThan(afterCollapse);

    state.group = { ...DEFAULT_GROUP_SPEC, dimension: "task" };
    controller.reprojectCards();
    expect(controller.getGroupRevision()).toBeGreaterThan(afterCount);
  });

  it("coerces box-rule to none outside a box without writing settings", () => {
    const cards = [createCard("notes/a.md"), createCard("archive/b.md")];
    const { controller, saveSettings, state, store } = createHarness({
      group: { ...DEFAULT_GROUP_SPEC, dimension: "box-rule" },
    });
    store.replaceBaseCards(cards);

    controller.reprojectCards();

    expect(controller.getGroupSegments()).toEqual([]);
    expect(store.getVisibleCards().map((card) => card.path)).toEqual([
      "notes/a.md",
      "archive/b.md",
    ]);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(state.group.dimension).toBe("box-rule");
  });

  describe("refreshGroupBucketForPath", () => {
    it("drops the cache and reports a move when a card's tags changed", () => {
      let tag = "#work";
      const { controller, store } = createHarness({
        group: { ...DEFAULT_GROUP_SPEC, dimension: "tag" },
        fileCache: () => ({ tags: [{ tag }] }),
      });
      store.replaceBaseCards([createCard("notes/a.md")]);

      controller.reprojectCards();
      expect(controller.getGroupSegments()[0]?.key).toBe("tag:work");

      // A metadata-only edit: no vault-content bump, so the cache key is
      // unchanged and only this call can notice the move.
      tag = "#personal";
      expect(controller.refreshGroupBucketForPath("notes/a.md")).toBe(true);

      controller.reprojectCards();
      expect(controller.getGroupSegments()[0]?.key).toBe("tag:personal");
    });

    it("reports no move when the bucket is unchanged", () => {
      const { controller, store } = createHarness({
        group: { ...DEFAULT_GROUP_SPEC, dimension: "tag" },
      });
      store.replaceBaseCards([createCard("notes/a.md")]);
      controller.reprojectCards();

      expect(controller.refreshGroupBucketForPath("notes/a.md")).toBe(false);
    });

    it("does not mistake canonical tag casing for a move", () => {
      // The cached label is canonical across the scope ("#Work"), while a
      // single-card rebuild for the lower-cased note yields "#work". Comparing
      // labels reported a move on every save; only the key is meaningful.
      const { controller, store } = createHarness({
        group: { ...DEFAULT_GROUP_SPEC, dimension: "tag" },
        fileCache: (file?: unknown) => {
          const path = (file as { path?: string } | undefined)?.path ?? "";
          return { tags: [{ tag: path === "notes/lower.md" ? "#work" : "#Work" }] };
        },
      });
      store.replaceBaseCards([createCard("notes/upper.md"), createCard("notes/lower.md")]);
      controller.reprojectCards();
      expect(controller.getGroupSegments()[0]?.label).toBe("#Work");

      expect(controller.refreshGroupBucketForPath("notes/lower.md")).toBe(false);
      expect(controller.refreshGroupBucketForPath("notes/upper.md")).toBe(false);
    });

    it("still refreshes when the cache was cleared under a rendered arrangement", () => {
      const { controller, store } = createHarness({
        group: { ...DEFAULT_GROUP_SPEC, dimension: "tag" },
      });
      store.replaceBaseCards([createCard("notes/a.md")]);
      controller.reprojectCards();
      expect(controller.getGroupSegments().length).toBeGreaterThan(0);

      // The nav-count path clears vault caches without reprojecting cards, so a
      // cold cache here means the rendered headers outlived their buckets.
      controller.invalidateVaultCaches();

      expect(controller.refreshGroupBucketForPath("notes/a.md")).toBe(true);
    });

    it("skips the rebuild when nothing has been projected at all", () => {
      const { controller, getFileCache, store } = createHarness({
        group: { ...DEFAULT_GROUP_SPEC, dimension: "tag" },
      });
      store.replaceBaseCards([createCard("notes/a.md")]);
      const before = getFileCache.mock.calls.length;

      expect(controller.getGroupSegments()).toEqual([]);
      expect(controller.refreshGroupBucketForPath("notes/a.md")).toBe(false);
      expect(getFileCache.mock.calls.length).toBe(before);
    });

    it("ignores dimensions that do not read vault metadata, and unknown paths", () => {
      const { controller, store } = createHarness({
        group: { ...DEFAULT_GROUP_SPEC, dimension: "folder" },
      });
      store.replaceBaseCards([createCard("notes/a.md")]);
      controller.reprojectCards();

      expect(controller.refreshGroupBucketForPath("notes/a.md")).toBe(false);
      expect(controller.refreshGroupBucketForPath("notes/missing.md")).toBe(false);
    });
  });
});
