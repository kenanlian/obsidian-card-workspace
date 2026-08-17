import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS, normalizeSettings } from "../../settings";
import * as metadataUtils from "../metadata-utils";
import { createBoxScope, createFolderScope } from "../scope";
import type { NoteCardRecord, PipelineSearchInput } from "../types";
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
  };
}

function createHarness(options: {
  scope?: ReturnType<typeof createFolderScope> | ReturnType<typeof createBoxScope>;
  filterTags?: string[];
  search?: PipelineSearchInput;
  pinnedPaths?: string[];
} = {}) {
  const scope = options.scope ?? createFolderScope("notes", true);
  const getFileCache = vi.fn(() => ({ tags: [{ tag: "#work" }] }));
  const app = {
    metadataCache: { getFileCache },
    vault: { getMarkdownFiles: vi.fn(() => []) },
  };
  const store = createViewStateStore(scope);
  const context = {
    getApp: () => app,
    store,
    epochs: createViewEpochs(),
    getSettings: () => normalizeSettings({
      ...DEFAULT_SETTINGS,
      filter: { tags: options.filterTags ?? [] },
    }),
    saveSettings: vi.fn(),
    getUiStrings: vi.fn(),
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
  });

  return { app, context, controller, getFileCache, store };
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
