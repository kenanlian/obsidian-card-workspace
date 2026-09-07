import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_GROUP_SPEC, type GroupSpec } from "../../card-grouping-settings";
import { getUiStrings } from "../../i18n";
import type { PropertyFilterClause } from "../../property-filter-settings";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../settings";
import * as metadataUtils from "../metadata-utils";
import * as pipeline from "../pipeline";
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
    properties: [],
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
  filterProperties?: PropertyFilterClause[];
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
        filter: { tags: options.filterTags ?? [], properties: options.filterProperties ?? [] },
        visiblePropertyKeys: options.filterProperties?.map((clause) => clause.key) ?? [],
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

  it("keeps the full member set visible in box scope despite active workspace property clauses", () => {
    const cards = [createCard("a.md"), createCard("b.md")];
    const { controller } = createHarness({
      scope: createBoxScope("box-1"),
      filterTags: ["must-not-run"],
      filterProperties: [{ key: "status", values: [{ kind: "text", value: "open" }] }],
    });
    const frontmatter = vi.spyOn(metadataUtils, "getFileFrontmatter");

    expect(controller.deriveVisibleCardsFrom(cards)).toEqual(cards);
    expect(frontmatter).not.toHaveBeenCalled();
  });

  it("injects empty propertyFilters into the pipeline context in box scope", () => {
    const cards = [createCard("a.md"), createCard("b.md")];
    const clause: PropertyFilterClause = { key: "status", values: [{ kind: "text", value: "open" }] };
    const box = createHarness({
      scope: createBoxScope("box-1"),
      filterProperties: [clause],
    });
    const folder = createHarness({ filterProperties: [clause] });
    const runPipeline = vi.spyOn(pipeline, "runPipeline");

    box.controller.deriveVisibleCardsFrom(cards);
    expect(runPipeline.mock.calls[0]?.[2].propertyFilters).toEqual([]);

    folder.controller.deriveVisibleCardsFrom(cards);
    expect(runPipeline.mock.calls[1]?.[2].propertyFilters).toEqual([clause]);
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

  describe("refreshMetadataGroupBuckets", () => {
    it("retains a refreshed cache and reports a move when a card's tags changed", () => {
      let tag = "#work";
      const { controller, getFileCache, store } = createHarness({
        group: { ...DEFAULT_GROUP_SPEC, dimension: "tag" },
        fileCache: () => ({ tags: [{ tag }] }),
      });
      store.replaceBaseCards([createCard("notes/a.md")]);

      controller.reprojectCards();
      expect(controller.getGroupSegments()[0]?.key).toBe("tag:work");
      const afterProject = getFileCache.mock.calls.length;

      // A metadata-only edit: no vault-content bump, so the cache key is
      // unchanged and only this full-set rebuild can notice the move.
      tag = "#personal";
      expect(controller.refreshMetadataGroupBuckets()).toBe(true);

      controller.reprojectCards();
      expect(controller.getGroupSegments()[0]?.key).toBe("tag:personal");
      // The retained refreshed cache serves the reprojection without a second
      // metadata scan: only the refresh itself read the cache.
      expect(getFileCache.mock.calls.length).toBe(afterProject + 1);
    });

    it("reports no move when the full signature is unchanged", () => {
      const { controller, getFileCache, store } = createHarness({
        group: { ...DEFAULT_GROUP_SPEC, dimension: "tag" },
        fileCache: () => ({ tags: [{ tag: "#work" }] }),
      });
      store.replaceBaseCards([createCard("notes/a.md")]);
      controller.reprojectCards();
      const afterProject = getFileCache.mock.calls.length;

      expect(controller.refreshMetadataGroupBuckets()).toBe(false);
      expect(getFileCache.mock.calls.length).toBe(afterProject + 1);
    });

    it("catches a canonical label-only change such as #Work to #work", () => {
      // Bucket labels are canonicalized across the whole set, so the per-path
      // key-only comparison this replaced could never see a casing change:
      // when every holder of the tag re-spells it, the key stays `tag:work`
      // while the canonical label — and therefore the rendered header — moves.
      let tag = "#Work";
      const { controller, store } = createHarness({
        group: { ...DEFAULT_GROUP_SPEC, dimension: "tag" },
        fileCache: () => ({ tags: [{ tag }] }),
      });
      store.replaceBaseCards([createCard("notes/holder.md")]);
      controller.reprojectCards();
      expect(controller.getGroupSegments()[0]?.label).toBe("#Work");

      tag = "#work";
      expect(controller.refreshMetadataGroupBuckets()).toBe(true);

      controller.reprojectCards();
      expect(controller.getGroupSegments()[0]?.label).toBe("#work");
      expect(controller.getGroupSegments()[0]?.key).toBe("tag:work");
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

      expect(controller.refreshMetadataGroupBuckets()).toBe(true);
    });

    it("skips the rebuild when nothing has been projected at all", () => {
      const { controller, getFileCache, store } = createHarness({
        group: { ...DEFAULT_GROUP_SPEC, dimension: "tag" },
      });
      store.replaceBaseCards([createCard("notes/a.md")]);
      const before = getFileCache.mock.calls.length;

      expect(controller.getGroupSegments()).toEqual([]);
      expect(controller.refreshMetadataGroupBuckets()).toBe(false);
      expect(getFileCache.mock.calls.length).toBe(before);
    });

    it("ignores dimensions that do not read vault metadata", () => {
      const { controller, getFileCache, store } = createHarness({
        group: { ...DEFAULT_GROUP_SPEC, dimension: "folder" },
      });
      store.replaceBaseCards([createCard("notes/a.md")]);
      controller.reprojectCards();
      const before = getFileCache.mock.calls.length;

      expect(controller.refreshMetadataGroupBuckets()).toBe(false);
      expect(getFileCache.mock.calls.length).toBe(before);
    });

    it("reports a move when the base set itself changed between cache and refresh", () => {
      const { controller, store } = createHarness({
        group: { ...DEFAULT_GROUP_SPEC, dimension: "tag" },
      });
      store.replaceBaseCards([createCard("notes/a.md")]);
      controller.reprojectCards();

      // A membership change outside this controller (base-card replacement
      // without a vault-content bump) leaves stale cached paths behind.
      store.replaceBaseCards([createCard("notes/a.md"), createCard("notes/b.md")]);
      expect(controller.refreshMetadataGroupBuckets()).toBe(true);
    });
  });

  describe("metadata-lane cache split", () => {
    it("invalidateMetadataDerivedCaches clears tag caches but keeps bucket comparison input", () => {
      const { controller, getFileCache, store } = createHarness({
        group: { ...DEFAULT_GROUP_SPEC, dimension: "tag" },
        fileCache: () => ({ tags: [{ tag: "#work" }] }),
      });
      store.replaceBaseCards([createCard("notes/a.md")]);
      controller.reprojectCards();
      const afterProject = getFileCache.mock.calls.length;

      controller.invalidateMetadataDerivedCaches();

      // Scope tag data recomputes on next derive...
      controller.deriveScopeTags();
      expect(getFileCache.mock.calls.length).toBeGreaterThan(afterProject);
      // ...while the group-bucket cache survives, so a later metadata refresh
      // can still compare signatures against the pre-edit buckets.
      expect(controller.refreshMetadataGroupBuckets()).toBe(false);
    });

    it("refreshScopeTagData reports value changes and reinstalls the refreshed cache", () => {
      let tag: string | null = "#work";
      const { controller, getFileCache, store } = createHarness({
        fileCache: () => (tag === null ? null : { tags: [{ tag }] }),
      });
      store.replaceBaseCards([createCard("notes/a.md")]);

      // Cold cache: no comparison possible, but the refreshed value installs.
      expect(controller.refreshScopeTagData()).toBe(false);
      expect(controller.deriveAvailableTags()).toEqual(["work"]);

      tag = "#personal";
      expect(controller.refreshScopeTagData()).toBe(true);
      expect(controller.deriveTagCounts()).toEqual({ personal: 1 });

      tag = "#personal";
      expect(controller.refreshScopeTagData()).toBe(false);

      tag = null;
      expect(controller.refreshScopeTagData()).toBe(true);
      expect(controller.deriveAvailableTags()).toEqual([]);
      expect(getFileCache).toHaveBeenCalled();
    });
  });
});
