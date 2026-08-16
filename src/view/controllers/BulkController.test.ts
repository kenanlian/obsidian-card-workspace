import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { createFolderScope } from "../scope";
import type { NoteCardRecord } from "../types";
import type { ViewContext } from "../view-context";
import { createViewEpochs } from "../view-epochs";
import { createViewStateStore } from "../view-state-store";
import { BulkController } from "./BulkController";

vi.mock("obsidian", () => ({
  TFile: class TFile {
    constructor(public path = "") {}
  },
}));

function createHarness(options: {
  visiblePaths?: string[];
  files?: Map<string, TFile>;
  markdownPaths?: Set<string>;
} = {}) {
  const visiblePaths = options.visiblePaths ?? [];
  const files = options.files ?? new Map<string, TFile>();
  const markdownPaths = options.markdownPaths ?? new Set<string>();
  const store = createViewStateStore(createFolderScope("notes", true));
  store.replaceVisibleCards(visiblePaths.map((path) => ({ path }) as NoteCardRecord));
  const publishSelection = vi.fn();
  const openNote = vi.fn();
  const context = {
    getApp: () => ({
      vault: { getAbstractFileByPath: (path: string) => files.get(path) ?? null },
    }),
    store,
    epochs: createViewEpochs(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    getUiStrings: vi.fn(),
    publishGroups: vi.fn(),
    requestUpdate: vi.fn(),
    notify: vi.fn(),
    getViewWindow: () => window,
  } as unknown as ViewContext;
  const controller = new BulkController({
    context,
    getOrderedVisiblePaths: () => [...visiblePaths],
    resolveLiveMarkdownFile: (path) => markdownPaths.has(path) ? files.get(path) ?? null : null,
    publishSelection,
    openNote,
  });
  return { controller, publishSelection, openNote };
}

describe("BulkController", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens cards outside bulk mode and preserves selection", () => {
    const { controller, openNote, publishSelection } = createHarness({ visiblePaths: ["a.md"] });
    controller.onBulkSelectCard({ path: "a.md" });
    expect(openNote).toHaveBeenCalledWith("a.md");
    expect(controller.getSelectedPaths().size).toBe(0);
    expect(publishSelection).not.toHaveBeenCalled();
  });

  it("supports toggle, range selection, select-all, and clear with one publish per change", () => {
    const { controller, publishSelection } = createHarness({
      visiblePaths: ["a.md", "b.md", "c.md"],
    });
    controller.toggleBulkMode();
    controller.onBulkSelectCard({ path: "a.md" });
    controller.onBulkSelectCard({ path: "c.md", shiftKey: true });
    expect(Array.from(controller.getSelectedPaths())).toEqual(["a.md", "b.md", "c.md"]);
    expect(controller.getAnchorPath()).toBe("a.md");

    controller.bulkClearSelection();
    controller.bulkSelectAll();
    expect(Array.from(controller.getSelectedPaths())).toEqual(["a.md", "b.md", "c.md"]);
    expect(publishSelection).toHaveBeenCalledTimes(5);
  });

  it("reconciles in visible order and keeps the mode enabled", () => {
    const { controller } = createHarness({ visiblePaths: ["c.md", "a.md"] });
    controller.toggleBulkMode();
    controller.setSelectedPaths(new Set(["a.md", "stale.md", "c.md"]));
    controller.setAnchorPath("stale.md");
    controller.reconcileToVisibleCards();
    expect(Array.from(controller.getSelectedPaths())).toEqual(["c.md", "a.md"]);
    expect(controller.getAnchorPath()).toBe("c.md");
    expect(controller.isBulkMode()).toBe(true);
  });

  it("resolves live files in selection order and derives markdown-only enablement", () => {
    const a = new TFile();
    const canvas = new TFile();
    Object.assign(a, { path: "a.md" });
    Object.assign(canvas, { path: "board.canvas" });
    const { controller } = createHarness({
      visiblePaths: ["a.md", "board.canvas"],
      files: new Map([[a.path, a], [canvas.path, canvas]]),
      markdownPaths: new Set([a.path]),
    });
    controller.toggleBulkMode();
    controller.setSelectedPaths(new Set([canvas.path, "stale.md", a.path]));
    controller.setAnchorPath(canvas.path);

    expect(controller.resolveSelectedLiveFilesInOrder()).toEqual({
      selectedPathsInOrder: [canvas.path, "stale.md", a.path],
      filesInOrder: [canvas, a],
    });
    expect(controller.buildPanelState()).toMatchObject({
      bulkMode: true,
      selectedCount: 3,
      canBulkAddTagSelected: true,
      canBulkMergeSelected: false,
    });
  });

  it("clears state on disable and dispose", () => {
    const { controller } = createHarness({ visiblePaths: ["a.md"] });
    controller.toggleBulkMode();
    controller.onBulkSelectCard({ path: "a.md" });
    controller.toggleBulkMode();
    expect(controller.isBulkMode()).toBe(false);
    expect(controller.getSelectedPaths().size).toBe(0);
    controller.setSelectedPaths(new Set(["a.md"]));
    expect(controller.dispose()).toEqual({});
    expect(controller.getSelectedPaths().size).toBe(0);
  });
});
