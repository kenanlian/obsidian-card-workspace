import { TFile, type App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../settings";
import { getUiStrings } from "../../i18n";
import { ThumbnailService } from "../../images/ThumbnailService";
import { IMAGE_MAX_BYTES, type ThumbnailResult } from "../../images/types";
import { createViewStateStore } from "../view-state-store";
import { createViewEpochs } from "../view-epochs";
import { createFolderScope } from "../scope";
import type { NoteCardRecord } from "../types";
import type { ViewContext } from "../view-context";
import { CardImageController } from "./CardImageController";
function harness(mode: "off" | "right" | "inline" = "right") {
  const note = Object.assign(new TFile(), { path: "notes/n.md", stat: { mtime: 1, size: 100, ctime: 1 } });
  const image = Object.assign(new TFile(), { path: "outside/image.png", stat: { mtime: 1, size: 100, ctime: 1 } });
  const files = new Map([[note.path, note], [image.path, image]]);
  const metadata = { embeds: [{ link: "image.png", original: "![[image.png]]", position: { start: { offset: 900 } } }] };
  const getFileCache = vi.fn((): unknown => metadata), resolve = vi.fn(() => files.get(image.path) ?? null);
  const app = { vault: { getAbstractFileByPath: (path: string) => files.get(path) ?? null }, metadataCache: { getFileCache, getFirstLinkpathDest: resolve } } as unknown as App;
  const settings = { ...DEFAULT_SETTINGS, cardImageMode: mode };
  const store = createViewStateStore(createFolderScope("notes", true));
  const card = { file: note, path: note.path, title: "n", fileKind: "markdown", hydrated: true, mtime: 1, ctime: 1, taskSummary: null, excerpt: "", previewHtml: "", previewMode: "empty" } as NoteCardRecord;
  store.replaceBaseCards([card]); store.replaceVisibleCards([card]);
  const epochs = createViewEpochs(), publish = vi.fn();
  const urls = { createObjectURL: vi.fn(() => "blob:thumbnail"), revokeObjectURL: vi.fn() };
  const context = { getApp: () => app, getSettings: () => settings, store, epochs, getUiStrings: () => getUiStrings("en"), publishGroups: publish,
    getViewWindow: () => ({ setTimeout, clearTimeout, URL: urls }) } as unknown as ViewContext;
  const read = vi.fn(async () => new ArrayBuffer(100));
  const generate = vi.fn(async (_buffer: ArrayBuffer, eligible: () => void): Promise<ThumbnailResult> => { eligible(); return { status: "ready", blob: new Blob(["thumb"]) }; });
  const service = new ThumbnailService({ read, isCurrent: (f) => { const live = files.get(f.path); return live?.stat.mtime === f.mtime; },
    storage: { get: async () => null, put: async () => undefined, close: vi.fn() }, generator: { available: () => true, generate, dispose: vi.fn() } });
  const controller = new CardImageController({ context, getService: () => ({ service, vault: "v" }), isLoading: () => false });
  const demand = (paths: string[] = [note.path]) => controller.requestViewport({ generation: epochs.load.value, sequenceRevision: store.getVisibleSequenceRevision(), requestVersion: controller.getPanelState().requestVersion, start: 0, end: paths.length, paths });
  return { controller, settings, card, store, epochs, demand, getFileCache, metadata, resolve, urls, read, generate, publish, files, image, service };
}
async function settle(): Promise<void> { await vi.advanceTimersByTimeAsync(80); }
afterEach(() => vi.useRealTimers());
describe("per-view images", () => {
  it("off mode performs zero metadata/attachment work", () => {
    const h = harness("off"); h.demand(); h.controller.handleMetadataChange(h.card.path);
    expect(h.controller.resolvePlaceholder(h.card.path, h.epochs.load.value)).toBeUndefined();
    h.controller.handleVaultMutation({ eventType: "create", path: "x.png", oldPath: null, isFolder: false, fileKind: null });
    expect(h.getFileCache).not.toHaveBeenCalled(); expect(h.read).not.toHaveBeenCalled(); h.controller.dispose();
  });
  it("reserves a mounted card before thumbnail demand without starting IO", async () => {
    vi.useFakeTimers(); const h = harness("inline"); h.card.hydrated = false;
    expect(h.controller.resolvePlaceholder(h.card.path, h.epochs.load.value)).toEqual({ status: "loading" });
    expect(h.service.getDiagnostics()).toMatchObject({ jobs: 0, owners: 0 });
    expect(h.read).not.toHaveBeenCalled(); expect(h.generate).not.toHaveBeenCalled();
    expect(h.controller.resolvePlaceholder(h.card.path, h.epochs.load.value + 1)).toBeUndefined();
    h.demand();
    expect(h.controller.getPanelState().byPath[h.card.path]).toEqual({ status: "loading" });
    await settle(); expect(h.read).not.toHaveBeenCalled();
    h.card.hydrated = true; h.controller.notifyTextReady(); await settle();
    expect(h.controller.getPanelState().byPath[h.card.path]?.status).toBe("ready");
    h.controller.dispose();
  });
  it.each([0, IMAGE_MAX_BYTES + 1])("omits byte-ineligible placeholders without reading (%s)", async (size) => {
    vi.useFakeTimers(); const h = harness(); h.image.stat.size = size;
    expect(h.controller.resolvePlaceholder(h.card.path, h.epochs.load.value)).toBeUndefined();
    h.demand(); await settle();
    expect(h.controller.getPanelState().byPath[h.card.path]).toBeUndefined();
    expect(h.read).not.toHaveBeenCalled(); expect(h.generate).not.toHaveBeenCalled();
    h.controller.dispose();
  });
  it("keeps the reserved region when the Worker rejects an image before decoding", async () => {
    vi.useFakeTimers(); const h = harness(); h.generate.mockResolvedValue({ status: "skipped" });
    h.demand(); expect(h.controller.getPanelState().byPath[h.card.path]).toEqual({ status: "loading" });
    await settle();
    expect(h.controller.getPanelState().byPath[h.card.path]).toEqual({ status: "failed" });
    expect(h.controller.resolvePlaceholder(h.card.path, h.epochs.load.value)).toEqual({ status: "failed" });
    h.controller.dispose();
  });
  it("republishes delayed metadata for mounted placeholders without thumbnail demand", async () => {
    vi.useFakeTimers(); const h = harness(); h.getFileCache.mockReturnValue(null);
    expect(h.controller.resolvePlaceholder(h.card.path, h.epochs.load.value)).toBeUndefined();
    h.getFileCache.mockReturnValue(h.metadata); h.controller.handleMetadataChange(h.card.path); await settle();
    expect(h.publish).toHaveBeenCalledWith("images");
    expect(h.controller.resolvePlaceholder(h.card.path, h.epochs.load.value)).toEqual({ status: "loading" });
    expect(h.read).not.toHaveBeenCalled(); h.controller.dispose();
  });
  it("publishes images alone, reuses mode/fit changes and revokes viewport URLs", async () => {
    vi.useFakeTimers(); const h = harness(); h.demand(); await settle();
    expect(h.controller.getPanelState().byPath[h.card.path]).toEqual({ status: "ready", url: "blob:thumbnail" });
    expect(h.publish).toHaveBeenCalledWith("images"); expect(h.publish.mock.calls.every(([group]) => group === "images")).toBe(true);
    h.settings.cardImageMode = "inline"; h.settings.cardImageFit = "cover"; h.controller.onSettingsChanged(); h.demand(); await settle();
    expect(h.generate).toHaveBeenCalledOnce(); h.demand([]); expect(h.urls.revokeObjectURL).toHaveBeenCalledOnce();
    h.demand(); await settle(); expect(h.read).toHaveBeenCalledOnce();
    h.settings.cardImageMode = "off"; h.controller.onSettingsChanged(); expect(h.urls.revokeObjectURL).toHaveBeenCalledTimes(2); h.controller.dispose();
  });
  it("animates a revealed fingerprint once across URL recreation and scope generations", async () => {
    vi.useFakeTimers(); const h = harness();
    h.urls.createObjectURL.mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    h.demand(); await settle();
    expect(h.controller.handleImageReveal({ path: h.card.path, url: "blob:stale" })).toBe(false);
    expect(h.controller.handleImageReveal({ path: h.card.path, url: "blob:first" })).toBe(true);
    h.demand([]);
    expect(h.controller.handleImageReveal({ path: h.card.path, url: "blob:first" })).toBe(false);
    h.epochs.load.bump(); h.demand(); await settle();
    expect(h.controller.handleImageReveal({ path: h.card.path, url: "blob:second" })).toBe(false);
    expect(h.read).toHaveBeenCalledOnce(); expect(h.generate).toHaveBeenCalledOnce();
    expect(h.urls.revokeObjectURL).toHaveBeenCalledWith("blob:first");
    h.controller.dispose();
  });
  it("keeps first reveal available for thumbnails that were ready but never displayed", async () => {
    vi.useFakeTimers(); const h = harness(); h.demand(); await settle();
    h.demand([]); h.demand(); await settle();
    expect(h.controller.handleImageReveal({ path: h.card.path, url: "blob:thumbnail" })).toBe(true);
    h.controller.dispose();
  });
  it("allows first reveal again for updated attachments, including changes while images are off", async () => {
    vi.useFakeTimers(); const h = harness(); h.demand(); await settle();
    const request = { path: h.card.path, url: "blob:thumbnail" };
    expect(h.controller.handleImageReveal(request)).toBe(true);
    h.image.stat.mtime++; h.demand([]); h.demand(); await settle();
    expect(h.controller.handleImageReveal(request)).toBe(true);
    h.settings.cardImageMode = "off"; h.controller.onSettingsChanged();
    h.controller.handleVaultMutation({ eventType: "modify", path: h.image.path, oldPath: null, isFolder: false, fileKind: null });
    h.settings.cardImageMode = "right"; h.demand(); await settle();
    expect(h.controller.handleImageReveal(request)).toBe(true);
    h.controller.dispose(); expect(h.controller.handleImageReveal(request)).toBe(false);
  });
  it("retries delayed metadata and missing attachment creation via existing buses", async () => {
    vi.useFakeTimers(); const h = harness(); h.getFileCache.mockReturnValueOnce(null); h.demand(); await settle(); expect(h.read).not.toHaveBeenCalled();
    h.controller.handleMetadataChange(); h.demand(); await settle(); expect(h.read).toHaveBeenCalledOnce();
    h.files.delete(h.image.path); h.controller.handleVaultMutation({ eventType: "delete", path: h.image.path, oldPath: null, isFolder: false, fileKind: null }); h.demand(); await settle();
    expect(h.controller.getPanelState().byPath[h.card.path]).toBeUndefined();
    h.files.set(h.image.path, h.image); h.controller.handleVaultMutation({ eventType: "create", path: h.image.path, oldPath: null, isFolder: false, fileKind: null }); h.demand(); await settle();
    expect(h.controller.getPanelState().byPath[h.card.path]?.status).toBe("ready"); h.controller.dispose();
  });
  it("drops old scope results and invalidates out-of-scope attachment modifications and folder moves", async () => {
    vi.useFakeTimers(); const h = harness(); let finish!: (result: ThumbnailResult) => void;
    h.generate.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    h.demand(); await vi.advanceTimersByTimeAsync(40); h.epochs.load.bump(); h.controller.resetDemand();
    finish({ status: "ready", blob: new Blob(["old"]) }); await settle(); expect(h.urls.createObjectURL).not.toHaveBeenCalled();
    h.generate.mockImplementation(async (_buffer, eligible) => { eligible(); return { status: "ready", blob: new Blob(["new"]) }; });
    h.image.stat.mtime++; h.demand(); await settle(); expect(h.read).toHaveBeenCalledTimes(2);
    h.image.stat.mtime++; h.controller.handleVaultMutation({ eventType: "modify", path: h.image.path, oldPath: null, isFolder: false, fileKind: null }); h.demand(); await settle(); expect(h.read).toHaveBeenCalledTimes(3);
    h.controller.handleVaultMutation({ eventType: "rename", path: "moved", oldPath: "outside", isFolder: true, fileKind: null });
    expect(h.urls.revokeObjectURL).toHaveBeenCalledTimes(2); h.controller.dispose();
  });
  it("preserves a matching URL through a scope generation and revalidates its source", async () => {
    vi.useFakeTimers(); const h = harness(); h.demand(); await settle();
    h.epochs.load.bump(); h.controller.beginLoad(); expect(h.controller.prepareGeneration()).toBe(true);
    expect(h.controller.getPanelState().byPath[h.card.path]).toEqual({ status: "ready", url: "blob:thumbnail" });
    h.demand(); await settle();
    expect(h.urls.createObjectURL).toHaveBeenCalledOnce(); expect(h.urls.revokeObjectURL).not.toHaveBeenCalled();
    expect(h.controller.getPanelState().generation).toBe(h.epochs.load.value);
    h.getFileCache.mockReturnValue({}); h.epochs.load.bump(); h.controller.beginLoad(); expect(h.controller.prepareGeneration()).toBe(true);
    expect(h.controller.getPanelState().byPath[h.card.path]).toBeUndefined(); h.demand(); await settle();
    expect(h.urls.revokeObjectURL).toHaveBeenCalledOnce(); expect(h.controller.getPanelState().byPath[h.card.path]).toBeUndefined();
    h.controller.dispose();
  });

  it("shares one object URL for repeated attachments and retains size hints without retaining URLs", async () => {
    vi.useFakeTimers(); const h = harness();
    const other = { ...h.card, path: "notes/other.md" }; h.store.replaceBaseCards([h.card, other]); h.store.replaceVisibleCards([h.card, other]);
    h.demand([h.card.path, other.path]); await settle(); expect(h.urls.createObjectURL).toHaveBeenCalledOnce();
    h.demand([h.card.path]); expect(h.urls.revokeObjectURL).not.toHaveBeenCalled();
    expect(h.controller.getPanelState().byPath[other.path]).toEqual({ status: "loading" });
    h.demand([]); expect(h.urls.revokeObjectURL).toHaveBeenCalledOnce(); h.controller.dispose();
  });

  it("waits for current visible text and cleans up on close", async () => {
    vi.useFakeTimers(); const h = harness(); h.card.hydrated = false; h.demand(); await settle(); expect(h.read).not.toHaveBeenCalled();
    h.card.hydrated = true; h.controller.notifyTextReady(); await settle(); expect(h.read).toHaveBeenCalledOnce();
    h.controller.dispose(); await settle(); expect(h.service.getDiagnostics().jobs).toBe(0); expect(h.urls.revokeObjectURL).toHaveBeenCalledOnce();
  });
});
