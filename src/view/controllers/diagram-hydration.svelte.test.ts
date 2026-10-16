import { TFile, type App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../settings";
import { getUiStrings } from "../../i18n";
import { createFolderScope, createLinksScope } from "../scope";
import { createViewEpochs } from "../view-epochs";
import { createViewStateStore } from "../view-state-store";
import type { ViewContext } from "../view-context";
import type { NoteCardRecord, VaultMutationEvent } from "../types";
import { HydrationController } from "./HydrationController";
import { CardImageController } from "./CardImageController";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
const canvas = '{"nodes":[{"id":"n","type":"text","x":0,"y":0,"width":100,"height":100,"text":"Hello"}],"edges":[]}';
function harness(paths = ["notes/a.excalidraw"], mode: "off" | "right" | "inline" = "off") {
  const files = new Map<string, TFile>();
  const add = (path: string): TFile => { const file = Object.assign(new TFile(), { path, stat: { mtime: 1, size: 100, ctime: 1 } }); files.set(path, file); return file; };
  const records = paths.map((path): NoteCardRecord => ({ file: add(path), path, title: path, fileKind: path.endsWith(".canvas") ? "canvas" : path.includes(".excalidraw") ? "excalidraw" : "markdown",
    hydrated: false, mtime: 1, ctime: 1, excerpt: "", previewHtml: "", previewMode: "empty", taskSummary: null }));
  const read = vi.fn(async (file: TFile): Promise<string> => file.path.endsWith(".svg") ? svg : file.path.endsWith(".canvas") ? canvas : "markdown");
  const app = { vault: { cachedRead: read, getAbstractFileByPath: (path: string) => files.get(path) ?? null }, metadataCache: { getFileCache: () => null } } as unknown as App;
  const epochs = createViewEpochs(), store = createViewStateStore(createFolderScope("notes", true));
  store.replaceBaseCards(records); store.replaceVisibleCards(records);
  const settings = { ...DEFAULT_SETTINGS, cardImageMode: mode };
  let query = "";
  let urlCount = 0;
  const urls = { createObjectURL: vi.fn(() => `blob:${++urlCount}`), revokeObjectURL: vi.fn() };
  const publish = vi.fn();
  const context = { getApp: () => app, store, epochs, getSettings: () => settings, getUiStrings: () => getUiStrings("en"),
    getViewWindow: () => ({ setTimeout, clearTimeout, DOMParser, URL: urls }), publishGroups: publish } as unknown as ViewContext;
  const hydration = new HydrationController({ context, isLoading: () => false, getCommittedQuery: () => query });
  const getService = vi.fn(() => null);
  const images = new CardImageController({ context, getService, isLoading: () => false,
    getDiagramFingerprint: (path) => hydration.getDiagramFingerprint(path), requestDiagramPreview: (path) => hydration.requestDiagramPreview(path) });
  const viewport = (targets = records) => hydration.hydrateViewport({ generation: epochs.load.value, hydrationRevision: store.getHydrationRevision(), start: 0, end: targets.length, paths: targets.map((card) => card.path) });
  const demand = (targets = records) => images.requestViewport({ generation: epochs.load.value, sequenceRevision: store.getVisibleSequenceRevision(), requestVersion: images.getPanelState().requestVersion, start: 0, end: targets.length, paths: targets.map((card) => card.path) });
  const mutate = (path: string, eventType: VaultMutationEvent["eventType"] = "modify", oldPath: string | null = null, isFolder = false) => {
    const event = { eventType, path, oldPath, isFolder, fileKind: null };
    images.handleVaultMutation(event); hydration.invalidateForVaultMutation(event);
  };
  const dispose = () => { images.dispose(); hydration.dispose(); };
  return { records, files, add, read, context, epochs, store, settings, urls, hydration, images, getService, publish, viewport, demand, mutate, dispose, setQuery: (value: string) => { query = value; } };
}
afterEach(() => vi.useRealTimers());

describe("diagram scheduling and lifecycle", () => {
  it("shares the five-read queue between Markdown, Canvas and exported SVG", async () => {
    vi.useFakeTimers();
    const h = harness(Array.from({ length: 15 }, (_, index) => `notes/${index}${[".md", ".canvas", ".excalidraw"][index % 3]}`));
    for (const card of h.records.filter((record) => record.fileKind === "excalidraw")) h.add(card.path.replace(".excalidraw", ".svg"));
    let active = 0, maximum = 0;
    h.read.mockImplementation(async (file) => {
      active++; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5)); active--;
      if (file.path.includes("excalidraw")) throw new Error("must never read scenes");
      return file.path.endsWith(".svg") ? svg : file.path.endsWith(".canvas") ? canvas : "markdown";
    });
    const pending = h.viewport(); await vi.runAllTimersAsync(); await pending;
    expect(maximum).toBe(5); expect(h.read).toHaveBeenCalledTimes(15);
    expect(h.store.getBaseCards().every((card) => card.hydrated)).toBe(true); h.dispose();
  });
  it("prewarms only the first six cards and marks late reads without blocking the caller", async () => {
    vi.useFakeTimers(); const h = harness(Array.from({ length: 9 }, (_, index) => `notes/${index}.canvas`));
    h.read.mockImplementation(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); return canvas; });
    const pending = h.hydration.hydrateStartupCardPaths(h.records.map((card) => card.path), h.epochs.load.token());
    await vi.advanceTimersByTimeAsync(120); await pending;
    expect(h.store.getBaseCards()).toHaveLength(9); expect(h.read).toHaveBeenCalledTimes(5);
    await vi.runAllTimersAsync(); expect(h.read).toHaveBeenCalledTimes(6);
    expect(h.store.getBaseCards().slice(0, 6).every((card) => card.hydrated)).toBe(true); h.dispose();
  });
  it.each(["off", "right", "inline"] as const)("displays diagrams in %s mode, reuses hydration and releases URLs on unmount/close", async (mode) => {
    vi.useFakeTimers(); const h = harness(undefined, mode); h.add("notes/a.svg");
    await h.viewport(); h.demand(); await vi.runAllTimersAsync();
    expect(h.images.getPanelState().byPath[h.records[0].path]).toMatchObject({ status: "ready" });
    expect(h.getService).not.toHaveBeenCalled(); expect(h.read).toHaveBeenCalledTimes(1);
    h.settings.cardImageMode = "off"; h.images.onSettingsChanged();
    expect(h.urls.revokeObjectURL).not.toHaveBeenCalled();
    h.demand([]); expect(h.urls.revokeObjectURL).toHaveBeenCalledTimes(1);
    h.demand(); await vi.runAllTimersAsync(); expect(h.read).toHaveBeenCalledTimes(1);
    h.dispose(); expect(h.urls.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
  it("refreshes missing, modified, renamed and deleted exports even with unchanged stats", async () => {
    vi.useFakeTimers(); const h = harness(); h.demand(); await vi.runAllTimersAsync();
    expect(h.images.getPanelState().byPath[h.records[0].path]).toEqual({ status: "diagram", reason: "missing" });
    h.add("notes/a.svg"); h.mutate("notes/a.svg", "create"); h.demand(); await vi.runAllTimersAsync();
    expect(h.read).toHaveBeenCalledTimes(1); expect(h.urls.createObjectURL).toHaveBeenCalledTimes(1);
    h.mutate("notes/a.svg"); h.demand(); await vi.runAllTimersAsync();
    expect(h.read).toHaveBeenCalledTimes(2); expect(h.urls.revokeObjectURL).toHaveBeenCalledTimes(1);
    h.files.delete("notes/a.svg"); h.add("notes/a.excalidraw.svg");
    h.mutate("notes/a.excalidraw.svg", "rename", "notes/a.svg"); h.demand(); await vi.runAllTimersAsync();
    expect(h.read).toHaveBeenLastCalledWith(h.files.get("notes/a.excalidraw.svg"));
    h.files.delete("notes/a.excalidraw.svg"); h.mutate("notes/a.excalidraw.svg", "delete"); h.demand(); await vi.runAllTimersAsync();
    expect(h.images.getPanelState().byPath[h.records[0].path]).toEqual({ status: "diagram", reason: "missing" });
    expect(h.read.mock.calls.some(([file]) => file.path.endsWith(".excalidraw"))).toBe(false); h.dispose();
  });
  it("invalidates inactive scope cache entries and missing-export entries before scope filtering", async () => {
    const h = harness(); await h.hydration.requestDiagramPreview(h.records[0].path);
    h.store.replaceBaseCards([]); h.store.replaceVisibleCards([]);
    h.add("notes/a.svg"); h.mutate("notes/a.svg", "create");
    h.store.replaceBaseCards(h.records); h.store.replaceVisibleCards(h.records);
    expect(await h.hydration.requestDiagramPreview(h.records[0].path)).toMatchObject({ status: "ready" });
    h.store.replaceBaseCards([]); h.store.replaceVisibleCards([]); h.mutate("elsewhere", "rename", "notes", true);
    h.store.replaceBaseCards(h.records); h.store.replaceVisibleCards(h.records);
    await h.hydration.requestDiagramPreview(h.records[0].path);
    expect(h.read).toHaveBeenCalledTimes(2); h.dispose();
  });
  it.each(["generation", "revision", "mutation", "dispose"])("discards results after %s changes", async (change) => {
    const h = harness(); h.add("notes/a.svg"); let finish!: (value: string) => void;
    h.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = h.hydration.requestDiagramPreview(h.records[0].path);
    if (change === "generation") h.epochs.load.bump();
    if (change === "revision") h.store.advanceHydrationRevision();
    if (change === "mutation") { h.mutate("notes/a.svg"); h.hydration.deletePending(h.records[0].path); }
    if (change === "dispose") h.dispose();
    finish(svg); expect(await pending).toBeUndefined(); expect(h.urls.createObjectURL).not.toHaveBeenCalled();
    if (change !== "dispose") {
      expect(await h.hydration.requestDiagramPreview(h.records[0].path)).toMatchObject({ status: "ready" });
      expect(h.read).toHaveBeenCalledTimes(2); h.dispose();
    }
  });
  it.each(["unmount", "close"])("never acquires a URL when a diagram finishes after %s", async (action) => {
    vi.useFakeTimers(); const h = harness(); h.add("notes/a.svg"); let finish!: (value: string) => void;
    h.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    h.demand();
    if (action === "unmount") h.demand([]); else h.dispose();
    finish(svg); await vi.runAllTimersAsync(); expect(h.urls.createObjectURL).not.toHaveBeenCalled();
    if (action === "unmount") h.dispose();
  });
  it("retains a current URL through generations and ignores unrelated metadata changes", async () => {
    vi.useFakeTimers(); const h = harness(undefined, "inline"); h.add("notes/a.svg"); h.demand(); await vi.runAllTimersAsync();
    h.epochs.load.bump(); h.images.beginLoad(); expect(h.images.prepareGeneration()).toBe(true);
    h.demand(); h.images.handleMetadataChange(); h.images.handleMetadataChange(h.records[0].path); await vi.runAllTimersAsync();
    expect(h.read).toHaveBeenCalledTimes(1); expect(h.urls.createObjectURL).toHaveBeenCalledTimes(1);
    expect(h.urls.revokeObjectURL).not.toHaveBeenCalled(); h.dispose();
  });
  it("re-requests evicted diagrams even when cards are already hydrated", async () => {
    const h = harness(); h.add("notes/a.svg"); await h.hydration.requestDiagramPreview(h.records[0].path);
    h.hydration.clearPreviewCache(); expect(h.store.getBaseCard(h.records[0].path)?.hydrated).toBe(true);
    await h.hydration.requestDiagramPreview(h.records[0].path); expect(h.read).toHaveBeenCalledTimes(2); h.dispose();
  });
  it("reuses exports during title search and preserves the existing links scope preview", async () => {
    const h = harness(); h.add("notes/a.svg"); await h.hydration.requestDiagramPreview(h.records[0].path);
    h.setQuery("a"); await h.viewport(); await h.hydration.requestDiagramPreview(h.records[0].path);
    expect(h.read).toHaveBeenCalledTimes(1); expect(h.store.getBaseCard(h.records[0].path)?.searchPreview?.status).toBe("title-only");
    h.store.setScope(createLinksScope("notes/source.md", "backlinks"));
    expect(await h.hydration.requestDiagramPreview(h.records[0].path)).toBeUndefined(); h.dispose();
  });
});
