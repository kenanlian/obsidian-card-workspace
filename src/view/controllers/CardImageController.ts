import { TFile } from "obsidian";
import type { ThumbnailService } from "../../images/ThumbnailService";
import { resolveFirstImage, type ImageSource } from "../../images/image-source";
import { IMAGE_MAX_BYTES, THUMBNAIL_VERSION, imageKey, type CardImageState, type ImageFingerprint } from "../../images/types";
import type { VaultMutationEvent } from "../../services/vault-events";
import type { DisposableController, DisposeReport, ViewContext } from "../view-context";
import type { CardImageRevealRequest, ImageViewportRequest } from "../image-request";
interface Demand { source: ImageSource; abort: AbortController; fingerprint?: ImageFingerprint; state?: CardImageState }
const LOADING_IMAGE_STATE = { status: "loading" } as const;
export interface CardImageControllerDeps {
  context: ViewContext;
  getService: () => { service: ThumbnailService; vault: string } | null;
  isLoading: () => boolean;
}
/** Per-view demand, reference dependencies, stale guards and object-URL ownership. */
export class CardImageController implements DisposableController {
  private readonly urls = new Map<string, { url: string; count: number }>();
  private readonly layoutHints = new Map<string, { attachmentPath: string; state: CardImageState }>();
  private readonly demand = new Map<string, Demand>();
  // Retain only fingerprints, never image data or URLs, across virtual unmounts.
  private readonly revealedImages = new Map<string, string>();
  private paths: readonly string[] = [];
  private generation = -1;
  private requestVersion = 0;
  private frame: number | null = null;
  private releaseService: (() => void) | null = null;
  private disposed = false;
  constructor(private readonly deps: CardImageControllerDeps) {}
  private get context(): ViewContext { return this.deps.context; }
  getPanelState(): { byPath: Record<string, CardImageState>; requestVersion: number; generation: number } {
    const byPath: Record<string, CardImageState> = Object.create(null) as Record<string, CardImageState>;
    for (const [path, hint] of this.layoutHints) byPath[path] = hint.state;
    for (const [path, item] of this.demand) if (item.state) byPath[path] = item.state;
    return { byPath, requestVersion: this.requestVersion, generation: this.generation };
  }
  /** Render-time metadata lookup for mounted cards, including text overscan.
   * Reserves space before the first paint without starting any thumbnail IO. */
  resolvePlaceholder(path: string, generation: number): CardImageState | undefined {
    if (this.disposed || this.context.getSettings().cardImageMode === "off"
      || generation !== this.context.epochs.load.value) return undefined;
    const card = this.context.store.getBaseCard(path);
    if (!card || card.fileKind !== "markdown") return undefined;
    let source: ImageSource;
    try { source = resolveFirstImage(this.context.getApp(), card.file); } catch { return undefined; }
    if (source.status !== "found" || source.file.stat.size <= 0 || source.file.stat.size > IMAGE_MAX_BYTES) return undefined;
    const state = this.demand.get(path)?.state;
    return state?.status === "failed" ? state : LOADING_IMAGE_STATE;
  }
  requestViewport(request: ImageViewportRequest): void {
    if (this.disposed || this.context.getSettings().cardImageMode === "off"
      || request.generation !== this.context.epochs.load.value
      || request.sequenceRevision !== this.context.store.getVisibleSequenceRevision()
      || request.requestVersion !== this.requestVersion) return;
    if (!Number.isInteger(request.start) || !Number.isInteger(request.end) || request.start < 0 || request.end < request.start) return;
    if (request.paths.length === 0) { this.resetDemand(); return; }
    if (this.deps.isLoading()) return;
    const visible = this.context.store.getVisibleCards();
    const generationChanged = this.generation !== request.generation;
    this.generation = request.generation;
    this.paths = request.paths.slice(0, request.end - request.start).filter((path, offset) => visible[request.start + offset]?.path === path);
    const next = new Set(this.paths);
    let changed = false;
    for (const [path, item] of this.demand) if (!next.has(path)) { this.drop(item); this.demand.delete(path); changed = true; }
    for (const path of this.paths) {
      const item = this.demand.get(path);
      if (item && generationChanged) {
        const card = this.context.store.getBaseCard(path);
        let source: ImageSource = { status: "unknown" };
        try { if (card?.fileKind === "markdown") source = resolveFirstImage(this.context.getApp(), card.file); } catch { /* no old image on an unresolved source */ }
        if (item.state?.status === "ready" && source.status === "found" && item.fingerprint
          && source.file.path === item.fingerprint.path && source.file.stat.mtime === item.fingerprint.mtime && source.file.stat.size === item.fingerprint.size) {
          item.source = source;
        } else { this.drop(item); this.demand.delete(path); this.layoutHints.delete(path); }
        changed = true;
      }
      if (!this.demand.has(path)) this.start(path);
    }
    if (changed) this.publish();
    this.notifyTextReady();
  }
  private rememberLayout(path: string, item: Demand): void {
    if (!item.state || !item.fingerprint) return;
    this.layoutHints.delete(path);
    this.layoutHints.set(path, { attachmentPath: item.fingerprint.path, state: { status: item.state.status === "failed" ? "failed" : "loading" } });
    if (this.layoutHints.size > 512) this.layoutHints.delete(this.layoutHints.keys().next().value!);
  }
  private start(path: string): void {
    const card = this.context.store.getBaseCard(path);
    if (!card || card.fileKind !== "markdown") return;
    let source: ImageSource;
    try { source = resolveFirstImage(this.context.getApp(), card.file); } catch { return; }
    const item: Demand = { source, abort: new AbortController() };
    this.demand.set(path, item);
    if (source.status !== "found" || source.file.stat.size <= 0 || source.file.stat.size > IMAGE_MAX_BYTES) {
      if (this.layoutHints.delete(path)) this.publish();
      return;
    }
    item.state = LOADING_IMAGE_STATE;
    this.publish();
    const runtime = this.deps.getService();
    if (!runtime) { item.state = { status: "failed" }; return; }
    if (!this.releaseService) this.releaseService = runtime.service.acquire();
    const fingerprint: ImageFingerprint = { vault: runtime.vault, path: source.file.path,
      mtime: source.file.stat.mtime, size: source.file.stat.size, version: THUMBNAIL_VERSION };
    item.fingerprint = fingerprint;
    this.rememberLayout(path, item);
    const generation = this.generation;
    const current = (): boolean => !this.disposed && !item.abort.signal.aborted && this.demand.get(path) === item
      && this.generation === generation && this.context.epochs.load.value === generation
      && this.context.getSettings().cardImageMode !== "off";
    void runtime.service.request(fingerprint, {
      signal: item.abort.signal,
      canGenerate: () => current() && !this.deps.isLoading() && this.paths.every((notePath) => this.context.store.getBaseCard(notePath)?.hydrated !== false),
      // Header checks still gate decoding; the layout already owns its slot.
      onEligible: () => {},
    }).then((result) => {
      if (!current()) return;
      // Validate the attachment again at publication, including out-of-scope files.
      const live = this.context.getApp().vault.getAbstractFileByPath(fingerprint.path);
      if (!(live instanceof TFile) || imageKey({ ...fingerprint, mtime: live.stat.mtime, size: live.stat.size }) !== imageKey(fingerprint)) return;
      if (result.status === "ready") {
        try { item.state = { status: "ready", url: this.acquireUrl(fingerprint, result.blob) }; }
        catch { item.state = { status: "failed" }; }
      } else item.state = { status: "failed" };
      this.rememberLayout(path, item);
      this.publish();
    }).catch(() => { if (current() && item.state) { item.state = { status: "failed" }; this.rememberLayout(path, item); this.publish(); } });
  }
  notifyTextReady(): void { if (this.releaseService) this.deps.getService()?.service.pump(); }
  /** Called after DOM decoding succeeds; only a version's first reveal animates. */
  handleImageReveal({ path, url }: CardImageRevealRequest): boolean {
    const item = this.demand.get(path);
    if (this.disposed || this.context.getSettings().cardImageMode === "off"
      || item?.state?.status !== "ready" || item.state.url !== url || !item.fingerprint
      || item.abort.signal.aborted || this.generation !== this.context.epochs.load.value) return false;
    const key = imageKey(item.fingerprint);
    if (this.revealedImages.get(item.fingerprint.path) === key) return false;
    this.revealedImages.set(item.fingerprint.path, key);
    return true;
  }
  onSettingsChanged(): void {
    if (this.context.getSettings().cardImageMode === "off") this.resetDemand();
    // Fit and right/inline switches keep identical thumbnails and demand.
  }
  /** A load retains the committed stream's URLs. The next viewport validates
   * sources and transfers matching leases to the new generation. */
  beginLoad(): void {
    for (const [path, item] of this.demand) if (item.state?.status !== "ready") { this.drop(item); this.demand.delete(path); }
  }
  /** Transfer validated cached images with the new card snapshot. Waiting for
   * the next viewport frame would remove and recreate every image/row first. */
  prepareGeneration(): boolean {
    const generation = this.context.epochs.load.value;
    if (this.disposed || this.context.getSettings().cardImageMode === "off" || this.deps.isLoading()
      || this.generation === generation || this.demand.size === 0) return false;
    this.generation = generation;
    for (const [path, item] of this.demand) {
      const card = this.context.store.getBaseCard(path);
      let source: ImageSource = { status: "unknown" };
      try { if (card?.fileKind === "markdown") source = resolveFirstImage(this.context.getApp(), card.file); } catch { /* unknown sources cannot retain an old image */ }
      if (item.state?.status === "ready" && source.status === "found" && item.fingerprint
        && source.file.path === item.fingerprint.path && source.file.stat.mtime === item.fingerprint.mtime && source.file.stat.size === item.fingerprint.size) item.source = source;
      else { this.drop(item); this.demand.delete(path); this.layoutHints.delete(path); }
    }
    this.requestVersion++;
    return true;
  }
  resetDemand(): void {
    const changed = this.demand.size > 0 || this.paths.length > 0;
    for (const item of this.demand.values()) this.drop(item);
    this.demand.clear(); this.layoutHints.clear(); this.paths = []; this.generation = -1;
    this.releaseService?.(); this.releaseService = null;
    if (changed) { this.requestVersion++; this.publish(); }
  }
  handleMetadataChange(path?: string): void {
    if (this.disposed || this.context.getSettings().cardImageMode === "off") return;
    if (path !== undefined) this.layoutHints.delete(path);
    // Mounted overscan cards may have only a metadata placeholder, no demand.
    if (path === undefined || this.context.store.getBaseCard(path)) this.publish();
    this.invalidate((notePath, item) => path === undefined ? item.source.status === "unknown" : notePath === path);
  }
  handleVaultMutation(event: VaultMutationEvent): void {
    if (this.disposed) return;
    const matches = (path: string): boolean => [event.path, event.oldPath].some((root) => root !== null
      && (path === root || (event.isFolder && path.startsWith(`${root}/`))));
    if (event.isFolder) {
      for (const path of this.revealedImages.keys()) if (matches(path)) this.revealedImages.delete(path);
    } else {
      this.revealedImages.delete(event.path);
      if (event.oldPath !== null) this.revealedImages.delete(event.oldPath);
    }
    if (this.context.getSettings().cardImageMode === "off") return;
    for (const [notePath, hint] of this.layoutHints) if (matches(notePath) || matches(hint.attachmentPath)) { this.layoutHints.delete(notePath); this.publish(); }
    this.invalidate((notePath, item) => matches(notePath)
      || (item.source.status === "found" && matches(item.source.file.path))
      || event.eventType === "create" || event.eventType === "rename");
  }
  private invalidate(matches: (path: string, item: Demand) => boolean): void {
    let changed = false;
    for (const [path, item] of this.demand) if (matches(path, item)) { this.drop(item); this.demand.delete(path); changed = true; }
    if (changed) { this.requestVersion++; this.publish(); }
  }
  private drop(item: Demand): void {
    item.abort.abort();
    if (item.state?.status === "ready" && item.fingerprint) {
      const key = imageKey(item.fingerprint), lease = this.urls.get(key);
      if (lease && --lease.count === 0) { this.urlApi().revokeObjectURL(lease.url); this.urls.delete(key); }
    }
  }
  private acquireUrl(fingerprint: ImageFingerprint, blob: Blob): string {
    const key = imageKey(fingerprint), existing = this.urls.get(key);
    if (existing) { existing.count++; return existing.url; }
    const url = this.urlApi().createObjectURL(blob);
    this.urls.set(key, { url, count: 1 });
    return url;
  }
  private urlApi(): typeof URL { return (this.context.getViewWindow() as Window & { URL?: typeof URL }).URL ?? URL; }
  private requestFrame(callback: FrameRequestCallback): number {
    const window = this.context.getViewWindow() as Pick<Window, "setTimeout" | "clearTimeout"> & Partial<Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame">>;
    return window.requestAnimationFrame ? window.requestAnimationFrame(callback) : window.setTimeout(() => callback(0), 16);
  }
  private cancelFrame(id: number): void {
    const window = this.context.getViewWindow() as Pick<Window, "setTimeout" | "clearTimeout"> & Partial<Pick<Window, "cancelAnimationFrame">>;
    if (window.cancelAnimationFrame) window.cancelAnimationFrame(id); else window.clearTimeout(id);
  }
  private publish(): void {
    if (this.disposed || this.frame !== null) return;
    this.frame = this.requestFrame(() => {
      this.frame = null;
      if (!this.disposed) this.context.publishGroups("images");
    });
  }
  dispose(): DisposeReport {
    this.disposed = true;
    this.resetDemand();
    this.revealedImages.clear();
    if (this.frame !== null) this.cancelFrame(this.frame);
    this.frame = null;
    return {};
  }
}
