import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { getUiStrings } from "../../i18n";
import type { PropertyFilterClause } from "../../property-filter-settings";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../settings";
import type { CardFileKind } from "../file-kind";
import { createFolderScope } from "../scope";
import type { NoteCardRecord } from "../types";
import type { ViewContext } from "../view-context";
import { createViewEpochs } from "../view-epochs";
import { createViewStateStore } from "../view-state-store";
import { PropertyController } from "./PropertyController";

const text = (value: string) => ({ kind: "text", value }) as const;

function createCard(path: string, fileKind: CardFileKind = "markdown"): NoteCardRecord {
  const basename = path.replace(/.*\//, "").replace(/\.[^.]+$/, "");
  return {
    file: { path, basename } as NoteCardRecord["file"],
    fileKind,
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

interface HarnessOptions {
  cards?: NoteCardRecord[];
  frontmatter?: Record<string, Record<string, unknown> | null>;
  vaultFiles?: string[];
  visiblePropertyKeys?: string[];
  filterProperties?: PropertyFilterClause[];
  loadKey?: string | null;
  language?: "en" | "zh";
  withMetadataCache?: boolean;
}

function createHarness(options: HarnessOptions = {}) {
  const cards = options.cards ?? [];
  const frontmatter = options.frontmatter ?? {};
  const state = {
    loadKey: options.loadKey === undefined ? "notes::recursive" : options.loadKey,
    language: options.language ?? ("en" as "en" | "zh"),
    settings: normalizeSettings({
      ...DEFAULT_SETTINGS,
      visiblePropertyKeys: options.visiblePropertyKeys ?? [],
      filter: { tags: [], properties: options.filterProperties ?? [] },
    }),
  };
  const getFileCache = vi.fn((file: TFile) => {
    const entry = frontmatter[file.path];
    return entry === undefined ? null : { frontmatter: entry };
  });
  const read = vi.fn(() => {
    throw new Error("property metadata must not read note bodies");
  });
  const cachedRead = vi.fn(() => {
    throw new Error("property metadata must not read note bodies");
  });
  const app = {
    metadataCache: options.withMetadataCache === false ? undefined : { getFileCache },
    vault: {
      getMarkdownFiles: vi.fn(() =>
        (options.vaultFiles ?? []).map((path) => ({ path }) as TFile)),
      read,
      cachedRead,
    },
  } as unknown as App;

  const store = createViewStateStore(createFolderScope("notes", true));
  store.replaceBaseCards([...cards]);
  const context = {
    getApp: () => app,
    store,
    epochs: createViewEpochs(),
    getSettings: () => state.settings,
    saveSettings: vi.fn(),
    getUiStrings: () => getUiStrings(state.language),
    publishGroups: vi.fn(),
    requestUpdate: vi.fn(),
    notify: vi.fn(),
    getViewWindow: () => globalThis,
  } as unknown as ViewContext;

  const controller = new PropertyController({
    context,
    getLoadKey: () => state.loadKey,
  });

  return { app, context, controller, getFileCache, read, cachedRead, state, store };
}

describe("PropertyController facet caching", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses the cached facet array for identical inputs", () => {
    const { controller, getFileCache } = createHarness({
      cards: [createCard("a.md")],
      frontmatter: { "a.md": { status: "open" } },
      visiblePropertyKeys: ["status"],
    });

    const first = controller.derivePropertyFacets();
    const second = controller.derivePropertyFacets();
    expect(second).toBe(first);
    const calls = getFileCache.mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    controller.derivePropertyFacets();
    expect(getFileCache.mock.calls.length).toBe(calls);
    expect(first[0]?.values).toEqual([
      { ref: text("open"), label: "open", count: 1 },
    ]);
  });

  it("does not alias distinct visible-key sets onto one cache entry", () => {
    // Regression: the cache key JSON-encodes components, so key sets whose
    // delimiter-joined forms coincide (["a", "bc"] vs ["ab", "c"]) must still
    // recompute and project the new key set.
    const { controller, getFileCache, state } = createHarness({
      cards: [createCard("a.md")],
      frontmatter: { "a.md": { a: "1", bc: "2", ab: "3", c: "4" } },
      visiblePropertyKeys: ["a", "bc"],
    });

    const first = controller.derivePropertyFacets();
    expect(first.map((facet) => facet.key)).toEqual(["a", "bc"]);
    const calls = getFileCache.mock.calls.length;

    state.settings = normalizeSettings({
      ...state.settings,
      visiblePropertyKeys: ["ab", "c"],
    });
    const next = controller.derivePropertyFacets();
    expect(next.map((facet) => facet.key)).toEqual(["ab", "c"]);
    expect(getFileCache.mock.calls.length).toBeGreaterThan(calls);
  });

  it("recomputes when the load key changes", () => {
    const { controller, getFileCache, state } = createHarness({
      cards: [createCard("a.md")],
      frontmatter: { "a.md": { status: "open" } },
      visiblePropertyKeys: ["status"],
    });

    controller.derivePropertyFacets();
    const calls = getFileCache.mock.calls.length;

    state.loadKey = "archive::recursive";
    const next = controller.derivePropertyFacets();
    expect(getFileCache.mock.calls.length).toBeGreaterThan(calls);
    expect(next[0]?.key).toBe("status");
  });

  it("recomputes when the base-card count changes", () => {
    const { controller, getFileCache, store } = createHarness({
      cards: [createCard("a.md")],
      frontmatter: { "a.md": { status: "open" }, "b.md": { status: "done" } },
      visiblePropertyKeys: ["status"],
    });

    controller.derivePropertyFacets();
    const calls = getFileCache.mock.calls.length;

    store.replaceBaseCards([createCard("a.md"), createCard("b.md")]);
    const next = controller.derivePropertyFacets();
    expect(getFileCache.mock.calls.length).toBeGreaterThan(calls);
    expect(next[0]?.values).toEqual([
      { ref: text("done"), label: "done", count: 1 },
      { ref: text("open"), label: "open", count: 1 },
    ]);
  });

  it("recomputes on a vault epoch bump even when the card count is unchanged", () => {
    const { context, controller, getFileCache, store } = createHarness({
      cards: [createCard("a.md")],
      frontmatter: { "a.md": { status: "open" }, "b.md": { status: "done" } },
      visiblePropertyKeys: ["status"],
    });

    controller.derivePropertyFacets();
    const calls = getFileCache.mock.calls.length;

    // Same-count vault replacement: only the epoch signals the change.
    store.replaceBaseCards([createCard("b.md")]);
    context.epochs.vaultContent.bump();
    const next = controller.derivePropertyFacets();
    expect(getFileCache.mock.calls.length).toBeGreaterThan(calls);
    expect(next[0]?.values).toEqual([
      { ref: text("done"), label: "done", count: 1 },
    ]);
  });

  it("recomputes when enabled keys or active filters change", () => {
    const { controller, getFileCache, state } = createHarness({
      cards: [createCard("a.md")],
      frontmatter: { "a.md": { status: "open", priority: 1 } },
      visiblePropertyKeys: ["status"],
    });

    controller.derivePropertyFacets();
    let calls = getFileCache.mock.calls.length;

    state.settings = normalizeSettings({
      ...state.settings,
      visiblePropertyKeys: ["status", "priority"],
    });
    expect(controller.derivePropertyFacets().map((facet) => facet.key)).toEqual([
      "priority",
      "status",
    ]);
    expect(getFileCache.mock.calls.length).toBeGreaterThan(calls);

    calls = getFileCache.mock.calls.length;
    state.settings = normalizeSettings({
      ...state.settings,
      filter: { tags: [], properties: [{ key: "status", values: [text("done")] }] },
    });
    const next = controller.derivePropertyFacets();
    expect(getFileCache.mock.calls.length).toBeGreaterThan(calls);
    expect(next[1]?.values).toContainEqual({ ref: text("done"), label: "done", count: 0 });
  });

  it("recomputes when the UI language changes the display labels", () => {
    const { controller, state } = createHarness({
      cards: [createCard("a.md"), createCard("b.md")],
      frontmatter: { "a.md": { done: true } },
      visiblePropertyKeys: ["done"],
    });

    expect(controller.derivePropertyFacets()[0]?.values).toEqual([
      { ref: { kind: "boolean", value: true }, label: "True", count: 1 },
      { ref: { kind: "missing" }, label: "Unassigned", count: 1 },
    ]);

    state.language = "zh";
    expect(controller.derivePropertyFacets()[0]?.values).toEqual([
      { ref: { kind: "boolean", value: true }, label: "是", count: 1 },
      { ref: { kind: "missing" }, label: "未分配", count: 1 },
    ]);
  });
});

describe("PropertyController invalidation", () => {
  it("bumps the metadata revision through invalidateVault", () => {
    const { controller, getFileCache } = createHarness({
      cards: [createCard("a.md")],
      frontmatter: { "a.md": { status: "open" } },
      visiblePropertyKeys: ["status"],
    });

    const first = controller.derivePropertyFacets();
    controller.invalidateVault();
    const next = controller.derivePropertyFacets();

    expect(next).not.toBe(first);
    expect(getFileCache.mock.calls.length).toBeGreaterThan(1);
  });

  it("invalidates for an in-base Markdown path and recomputes", () => {
    const { controller } = createHarness({
      cards: [createCard("a.md")],
      frontmatter: { "a.md": { status: "open" } },
      visiblePropertyKeys: ["status"],
    });

    const first = controller.derivePropertyFacets();
    expect(controller.invalidateMetadata(["a.md"])).toBe(true);
    expect(controller.derivePropertyFacets()).not.toBe(first);
  });

  it("invalidates conservatively when no paths are given", () => {
    const { controller } = createHarness({
      cards: [createCard("a.md")],
      frontmatter: { "a.md": { status: "open" } },
      visiblePropertyKeys: ["status"],
    });

    const first = controller.derivePropertyFacets();
    expect(controller.invalidateMetadata()).toBe(true);
    expect(controller.derivePropertyFacets()).not.toBe(first);
  });

  it("ignores out-of-base and non-Markdown metadata events without publishing", () => {
    const { context, controller, getFileCache } = createHarness({
      cards: [createCard("a.md"), createCard("board.canvas", "canvas")],
      frontmatter: { "a.md": { status: "open" } },
      visiblePropertyKeys: ["status"],
    });

    const first = controller.derivePropertyFacets();
    const calls = getFileCache.mock.calls.length;

    expect(controller.invalidateMetadata(["elsewhere/unrelated.md"])).toBe(false);
    expect(controller.invalidateMetadata(["board.canvas"])).toBe(false);
    expect(controller.derivePropertyFacets()).toBe(first);
    expect(getFileCache.mock.calls.length).toBe(calls);
    expect(context.publishGroups).not.toHaveBeenCalled();
  });
});

describe("PropertyController inventory", () => {
  it("reports exact ready-empty, partial, and unavailable states", () => {
    const readyEmpty = createHarness({ vaultFiles: ["a.md", "b.md"] });
    // Both files are cached (empty frontmatter), so this is a trustworthy
    // "no properties found", not a partial scan.
    readyEmpty.getFileCache.mockReturnValue({ frontmatter: {} } as never);
    expect(readyEmpty.controller.collectPropertyInventory()).toEqual({
      status: "ready",
      options: [],
    });

    const partial = createHarness({ vaultFiles: ["a.md", "b.md"] });
    partial.getFileCache.mockImplementation((file: TFile) =>
      file.path === "a.md" ? { frontmatter: { status: "open" } } : null);
    expect(partial.controller.collectPropertyInventory()).toEqual({
      status: "partial",
      options: [{ key: "status", label: "status", available: true }],
    });

    const unavailable = createHarness({ withMetadataCache: false, vaultFiles: ["a.md"] });
    expect(unavailable.controller.collectPropertyInventory()).toEqual({
      status: "unavailable",
      options: [],
    });
  });

  it("collects a fresh scan on every call, with no retained state", () => {
    const { controller, getFileCache } = createHarness({ vaultFiles: ["a.md"] });

    getFileCache.mockReturnValue(null);
    expect(controller.collectPropertyInventory()).toEqual({ status: "partial", options: [] });

    getFileCache.mockReturnValue({ frontmatter: { status: "open" } } as never);
    expect(controller.collectPropertyInventory()).toEqual({
      status: "ready",
      options: [{ key: "status", label: "status", available: true }],
    });
  });

  it("never reads note bodies for the inventory", () => {
    const { controller, read, cachedRead } = createHarness({
      vaultFiles: ["a.md"],
      frontmatter: { "a.md": { status: "open" } },
    });

    controller.collectPropertyInventory();
    expect(read).not.toHaveBeenCalled();
    expect(cachedRead).not.toHaveBeenCalled();
  });
});

describe("PropertyController disposal", () => {
  it("prevents later work after dispose", () => {
    const { controller, getFileCache } = createHarness({
      cards: [createCard("a.md")],
      frontmatter: { "a.md": { status: "open" } },
      visiblePropertyKeys: ["status"],
      vaultFiles: ["a.md"],
    });

    controller.derivePropertyFacets();
    const calls = getFileCache.mock.calls.length;

    controller.dispose();

    expect(controller.derivePropertyFacets()).toEqual([]);
    expect(controller.collectPropertyInventory()).toEqual({
      status: "unavailable",
      options: [],
    });
    expect(controller.invalidateMetadata(["a.md"])).toBe(false);
    expect(controller.invalidateVault()).toBeUndefined();
    expect(getFileCache.mock.calls.length).toBe(calls);
  });
});
