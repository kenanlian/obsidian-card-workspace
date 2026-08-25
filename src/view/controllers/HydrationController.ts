import type { EpochToken } from "../async-epoch";
import { getCardPlaceholderText, isMarkdownCardKind } from "../file-kind";
import type { HydrateViewportRequest } from "../hydration-request";
import { buildLightPreview, DEFAULT_PREVIEW_MAX_VISIBLE_CHARS } from "../markdown-utils";
import { createPreviewFingerprint, fingerprintsEqual, PreviewCache,
  type PreviewFingerprint } from "../preview-cache";
import type { NoteCardRecord, VaultMutationEvent } from "../types";
import type { DisposableController, DisposeReport, ViewContext } from "../view-context";
import type { CardPreviewFields, CardPreviewUpdate } from "../view-state-store";

const MAX_ACTIVE_READS = 5;
const STARTUP_PREVIEW_CARD_COUNT = 6;
const STARTUP_PREVIEW_WAIT_MS = 120;
interface HydrationJob {
  readonly path: string;
  fingerprint: PreviewFingerprint;
  generation: number;
  hydrationRevision: number;
  priority: number;
  sequence: number;
  state: "queued" | "active";
  viewport: boolean;
  startup: boolean;
  startupLate: boolean;
  forced: boolean;
  foreground: boolean;
  replacementRequested: boolean;
  readonly settled: Promise<void>;
  resolve: () => void;
}
interface PendingPatch {
  readonly update: CardPreviewUpdate;
  readonly generation: number;
  readonly hydrationRevision: number;
  readonly fingerprint: PreviewFingerprint;
  readonly publish: boolean;
  readonly resolve: () => void;
}
export interface HydrationControllerDeps {
  context: ViewContext;
  isLoading: () => boolean;
}
/** Owns the per-view preview cache, demand queue, and incremental publication. */
export class HydrationController implements DisposableController {
  private readonly cache = new PreviewCache();
  private readonly jobs = new Map<string, HydrationJob>();
  private readonly queue: HydrationJob[] = [];
  private readonly latestViewport = new Set<string>();
  private pendingPatches: PendingPatch[] = [];
  private activeReads = 0;
  private sequence = 0;
  private patchFlushQueued = false;
  private startupWaitTimer: ReturnType<Window["setTimeout"]> | null = null;
  private disposed = false;
  constructor(private readonly deps: HydrationControllerDeps) {}
  private get context(): ViewContext {
    return this.deps.context;
  }
  static get startupCardCount(): number {
    return STARTUP_PREVIEW_CARD_COUNT;
  }
  hasPending(path: string): boolean {
    return this.jobs.has(path);
  }
  deletePending(path: string): boolean {
    const job = this.jobs.get(path);
    if (!job) return false;
    job.viewport = false;
    job.startup = false;
    job.forced = false;
    job.foreground = false;
    if (job.state === "queued") this.dropQueuedJob(job);
    return true;
  }
  clearPending(): void {
    this.resetForLoad();
  }
  resetForLoad(): void {
    this.latestViewport.clear();
    for (const job of this.jobs.values()) {
      job.viewport = false;
      job.startup = false;
      job.forced = false;
      job.foreground = false;
      if (job.state === "queued") this.dropQueuedJob(job);
    }
  }
  clearPreviewCache(): void {
    this.cache.clear();
  }
  invalidateForVaultMutation(event: VaultMutationEvent): void {
    if (event.eventType === "create" || (event.isFolder && event.eventType === "modify")) return;
    const invalidate = (path: string): void => {
      if (event.isFolder) this.cache.invalidatePrefix(path);
      else this.cache.invalidateExact(path);
    };
    invalidate(event.path);
    if (event.eventType === "rename" && event.oldPath !== null) invalidate(event.oldPath);
  }
  prepareRecordsFromCache(records: NoteCardRecord[]): void {
    for (const record of records) {
      if (!isMarkdownCardKind(record.fileKind)) {
        Object.assign(record, this.placeholderPatch(record));
        continue;
      }
      const preview = this.cache.get(this.fingerprintFor(record));
      if (preview) Object.assign(record, this.previewPatch(preview));
    }
  }
  schedulePath(path: string): void {
    if (this.disposed) return;
    const visible = this.context.store.getVisibleCards().some((card) => card.path === path);
    void this.requestPath(path, visible ? 0 : 3, { forced: true, foreground: visible });
  }
  async hydrateViewport(request: HydrateViewportRequest): Promise<void> {
    if (!this.validRequestIdentity(request) || this.deps.isLoading()) return;
    const visible = this.context.store.getVisibleCards();
    const count = Math.max(0, request.end - request.start);
    const paths = request.paths.slice(0, count).filter(
      (path, offset) => visible[request.start + offset]?.path === path,
    );
    const next = new Set(paths);
    for (const job of this.jobs.values()) {
      if (job.viewport && !next.has(job.path)) {
        job.viewport = false;
        if (job.state === "queued" && !job.startup && !job.forced) this.dropQueuedJob(job);
      }
    }
    this.latestViewport.clear();
    paths.forEach((path) => this.latestViewport.add(path));
    await Promise.all(paths.map((path) => this.requestPath(path, 1, { viewport: true })));
  }
  async hydrateStartupCardPaths(paths: string[], token: EpochToken): Promise<void> {
    if (this.disposed || !this.context.epochs.load.isCurrent(token)) return;
    const targets = paths.slice(0, STARTUP_PREVIEW_CARD_COUNT);
    const jobs = targets.map((path) => this.requestPath(path, 2, { startup: true }));
    if (jobs.length === 0) return;
    const hydration = Promise.all(jobs);
    const viewWindow = this.context.getViewWindow();
    const timeout = new Promise<"timeout">((resolve) => {
      this.startupWaitTimer = viewWindow.setTimeout(() => {
        this.startupWaitTimer = null;
        resolve("timeout");
      }, STARTUP_PREVIEW_WAIT_MS);
    });
    const result = await Promise.race([hydration.then(() => "hydrated" as const), timeout]);
    if (this.startupWaitTimer !== null) {
      viewWindow.clearTimeout(this.startupWaitTimer);
      this.startupWaitTimer = null;
    }
    if (result === "timeout" && !this.disposed && this.context.epochs.load.isCurrent(token)) {
      for (const path of targets) {
        const job = this.jobs.get(path);
        if (job?.startup) job.startupLate = true;
      }
    }
  }
  /** Kept until the host seam migration removes its existing open hook. */
  hydrateVisibleCardsOnOpen(): void {
    if (this.disposed || this.deps.isLoading()) return;
    const visible = this.context.store.getVisibleCards();
    const paths = visible.slice(0, STARTUP_PREVIEW_CARD_COUNT).map((card) => card.path);
    void this.hydrateViewport({
      generation: this.context.epochs.load.value,
      hydrationRevision: this.context.store.getHydrationRevision(),
      start: 0,
      end: paths.length,
      paths,
    });
  }
  private validRequestIdentity(request: HydrateViewportRequest): boolean {
    return !this.disposed
      && Number.isInteger(request.start)
      && Number.isInteger(request.end)
      && request.start >= 0
      && request.end >= request.start
      && request.generation === this.context.epochs.load.value
      && request.hydrationRevision === this.context.store.getHydrationRevision();
  }

  private requestPath(path: string, priority: number,
    owner: { viewport?: boolean; startup?: boolean; forced?: boolean; foreground?: boolean }): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const card = this.context.store.getBaseCard(path);
    if (!card) return Promise.resolve();
    if (!isMarkdownCardKind(card.fileKind)) {
      if (card.hydrated) return Promise.resolve();
      return this.enqueuePatch(
        path, this.placeholderPatch(card), this.fingerprintFor(card),
        owner.viewport === true || owner.foreground === true,
      );
    }
    const fingerprint = this.fingerprintFor(card);
    const existing = this.jobs.get(path);
    if (existing) {
      existing.viewport ||= owner.viewport === true;
      existing.startup ||= owner.startup === true;
      existing.forced ||= owner.forced === true;
      existing.foreground ||= owner.foreground === true;
      existing.priority = Math.min(existing.priority, priority);
      if (!fingerprintsEqual(existing.fingerprint, fingerprint)
        || existing.generation !== this.context.epochs.load.value
        || existing.hydrationRevision !== this.context.store.getHydrationRevision()) {
        existing.replacementRequested = true;
      }
      this.sortQueue();
      return existing.settled;
    }
    if (!owner.forced) {
      if (card.hydrated) return Promise.resolve();
      const cached = this.cache.get(fingerprint);
      if (cached) {
        return this.enqueuePatch(path, this.previewPatch(cached), fingerprint, owner.viewport === true);
      }
    }
    let resolve!: () => void;
    const settled = new Promise<void>((done) => { resolve = done; });
    const job: HydrationJob = {
      path, fingerprint,
      generation: this.context.epochs.load.value,
      hydrationRevision: this.context.store.getHydrationRevision(),
      priority, sequence: this.sequence++, state: "queued",
      viewport: owner.viewport === true,
      startup: owner.startup === true,
      startupLate: false,
      forced: owner.forced === true,
      foreground: owner.foreground === true,
      replacementRequested: false,
      settled, resolve,
    };
    this.jobs.set(path, job);
    this.queue.push(job);
    this.sortQueue();
    this.pump();
    return settled;
  }
  private pump(): void {
    while (!this.disposed && this.activeReads < MAX_ACTIVE_READS && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job || this.jobs.get(job.path) !== job) continue;
      job.state = "active";
      this.activeReads += 1;
      void this.runJob(job).finally(() => {
        this.activeReads -= 1;
        this.finishJob(job);
        this.pump();
      });
    }
  }
  private async runJob(job: HydrationJob): Promise<void> {
    let patch: Partial<CardPreviewFields>;
    try {
      const card = this.context.store.getBaseCard(job.path);
      if (!card) return;
      const markdown = await this.context.getApp().vault.cachedRead(card.file);
      if (!this.currentFingerprint(job)) return;
      const preview = buildLightPreview(markdown, job.fingerprint.maxVisibleChars, job.fingerprint.previewLines);
      this.cache.set(job.fingerprint, preview);
      patch = this.previewPatch(preview);
    } catch {
      if (!this.currentFingerprint(job)) return;
      patch = { excerpt: "", previewHtml: "", previewMode: "empty", hydrated: true };
    }
    if (this.shouldPatch(job)) {
      await this.enqueuePatch(job.path, patch, job.fingerprint,
        job.viewport || job.foreground || job.startupLate);
    }
  }
  private finishJob(job: HydrationJob): void {
    if (this.jobs.get(job.path) !== job) return;
    if (!this.disposed && job.replacementRequested && this.hasDemand(job)) {
      const card = this.context.store.getBaseCard(job.path);
      if (card) {
        job.fingerprint = this.fingerprintFor(card);
        job.generation = this.context.epochs.load.value;
        job.hydrationRevision = this.context.store.getHydrationRevision();
        job.replacementRequested = false;
        job.state = "queued";
        job.sequence = this.sequence++;
        this.queue.push(job);
        this.sortQueue();
        return;
      }
    }
    this.jobs.delete(job.path);
    job.resolve();
  }
  private currentFingerprint(job: HydrationJob): boolean {
    const card = this.context.store.getBaseCard(job.path);
    return !this.disposed
      && job.generation === this.context.epochs.load.value
      && job.hydrationRevision === this.context.store.getHydrationRevision()
      && card !== undefined
      && fingerprintsEqual(job.fingerprint, this.fingerprintFor(card));
  }
  private hasDemand(job: HydrationJob): boolean {
    return job.forced || job.startup || job.viewport;
  }
  private shouldPatch(job: HydrationJob): boolean {
    return job.startup || job.foreground || (job.viewport && this.latestViewport.has(job.path));
  }

  private enqueuePatch(path: string, patch: Partial<CardPreviewFields>,
    fingerprint: PreviewFingerprint, publish: boolean): Promise<void> {
    return new Promise((resolve) => {
      this.pendingPatches.push({
        update: { path, patch },
        generation: this.context.epochs.load.value,
        hydrationRevision: this.context.store.getHydrationRevision(),
        fingerprint,
        publish,
        resolve,
      });
      if (this.patchFlushQueued) return;
      this.patchFlushQueued = true;
      queueMicrotask(() => this.flushPatches());
    });
  }
  private flushPatches(): void {
    this.patchFlushQueued = false;
    const pending = this.pendingPatches;
    this.pendingPatches = [];
    const valid = pending.filter((item) => {
      const card = this.context.store.getBaseCard(item.update.path);
      return !this.disposed
        && item.generation === this.context.epochs.load.value
        && item.hydrationRevision === this.context.store.getHydrationRevision()
        && card !== undefined
        && fingerprintsEqual(item.fingerprint, this.fingerprintFor(card));
    });
    if (valid.length > 0) {
      this.context.store.patchCardPreviews(valid.map((item) => item.update));
      if (valid.some((item) => item.publish)) this.context.publishGroups("cards");
    }
    pending.forEach((item) => item.resolve());
  }
  private fingerprintFor(card: NoteCardRecord): PreviewFingerprint {
    return createPreviewFingerprint(
      card.path,
      card.mtime,
      this.context.getSettings().previewLines,
      DEFAULT_PREVIEW_MAX_VISIBLE_CHARS,
    );
  }
  private previewPatch(preview: { html: string; mode: "text" | "code" | "empty" }): Partial<CardPreviewFields> {
    return { previewHtml: preview.html, previewMode: preview.mode, hydrated: true };
  }
  private placeholderPatch(card: NoteCardRecord): Partial<CardPreviewFields> {
    const text = getCardPlaceholderText(card.fileKind, this.context.getUiStrings().fileKind);
    return {
      excerpt: "",
      previewHtml: `<p class="fce-preview-placeholder">${text}</p>`,
      previewMode: "placeholder",
      hydrated: true,
    };
  }
  private sortQueue(): void {
    this.queue.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
  }
  private dropQueuedJob(job: HydrationJob): void {
    const index = this.queue.indexOf(job);
    if (index >= 0) this.queue.splice(index, 1);
    this.jobs.delete(job.path);
    job.resolve();
  }

  dispose(): DisposeReport {
    const clearedPendingHydration = this.jobs.size > 0;
    const cancelledDebounce = this.startupWaitTimer !== null;
    if (this.startupWaitTimer !== null) {
      this.context.getViewWindow().clearTimeout(this.startupWaitTimer);
      this.startupWaitTimer = null;
    }
    this.disposed = true;
    this.cache.clear();
    this.latestViewport.clear();
    for (const job of this.jobs.values()) job.resolve();
    this.jobs.clear();
    this.queue.length = 0;
    const pending = this.pendingPatches;
    this.pendingPatches = [];
    pending.forEach((item) => item.resolve());
    this.patchFlushQueued = false;
    return {
      clearedPendingHydration,
      ...(cancelledDebounce ? { cancelledDebounce: true } : {}),
    };
  }
}
