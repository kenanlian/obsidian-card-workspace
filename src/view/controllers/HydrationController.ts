import { DESKTOP_RESOURCE_BUDGET } from "../../runtime/resource-budget";
import { TFile } from "obsidian";
import { diagramDependencies, diagramSourceFingerprint, isDiagramKind, readDiagramPreview, type DiagramPreviewResult } from "../diagram-preview";
import { buildLinkReferenceSnippets, buildOutgoingReferenceSnippets, type LinkReferencePreview } from "../link-reference-preview";
import { collectLinkReferenceLocations, type LinkReferenceCardLocation } from "../link-card-location";
import { scopeIdentity, type LinksScope } from "../scope";
import type { EpochToken } from "../async-epoch";
import { createSearchPreviewMatcher, extractSearchPreviewSnippets, SearchPreviewSourceCache, type SearchPreview, type SearchMatchField } from "../../search";
import { isMarkdownCardKind, resolveCardFileKind } from "../file-kind";
import type { HydrateViewportRequest } from "../hydration-request";
import { buildLightPreview, DEFAULT_PREVIEW_MAX_VISIBLE_CHARS } from "../markdown-utils";
import { buildLocationPreview } from "../context-preview";
import { readLinkReferenceCount } from "../links-sources";
import { resolveLinkCardLocation } from "../link-card-location";
import type { CardScope } from "../scope";
import { createPreviewFingerprint, fingerprintsEqual, PreviewCache,
  type PreviewFingerprint } from "../preview-cache";
import type { NoteCardRecord, VaultMutationEvent } from "../types";
import type { DisposableController, DisposeReport, ViewContext } from "../view-context";
import type { CardPreviewFields, CardPreviewUpdate } from "../view-state-store";
import { buildEmptyPreviewPatch, buildPlaceholderPatch, buildPreviewPatch,
  type HydrationPreview } from "./hydration-patch";

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
  explicit: boolean;
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
  getCommittedQuery?: () => string;
  getSearchContentRevision?: () => number;
  isCommittedQueryCurrent?: () => boolean;
  getMatchFields?: (path: string) => readonly SearchMatchField[] | undefined;
  getActiveSelectionVersion?: () => number;
}
/** Owns the per-view preview cache, demand queue, and incremental publication. */
export class HydrationController implements DisposableController {
  private readonly cache: PreviewCache;
  private readonly searchSources: SearchPreviewSourceCache;
  private get budget() { return this.context.resourceBudget ?? DESKTOP_RESOURCE_BUDGET; }
  private readonly appliedFingerprints = new Map<string, PreviewFingerprint>();
  private readonly jobs = new Map<string, HydrationJob>();
  private readonly queue: HydrationJob[] = [];
  private latestViewportRequest: HydrateViewportRequest | null = null;
  private readonly stopWorkGate: () => void;
  private readonly latestViewport = new Set<string>();
  private pendingPatches: PendingPatch[] = [];
  private activeReads = 0;
  private sequence = 0;
  private patchFlushQueued = false;
  private startupWaitTimer: ReturnType<Window["setTimeout"]> | null = null;
  private disposed = false;
  private matcherQuery = "";
  private matcher = createSearchPreviewMatcher("");
  private mutationRevision = 0;
  private expansionScope = "";
  private snippetCount: import("../../settings").BacklinkSnippetCount = 3;
  private readonly expandedReferences = new Set<string>();
  private sourceRead: { key: string; promise: Promise<string> } | null = null;
  private readonly fileRevisions = new WeakMap<object, number>();
  getFileRevision(file: NoteCardRecord["file"]): number { return this.fileRevisions.get(file) ?? 0; }
  constructor(private readonly deps: HydrationControllerDeps) {
    this.stopWorkGate = this.context.workGate?.subscribe((active) => {
      if (!active || this.disposed) return;
      for (const job of this.queue.slice()) if (!this.currentFingerprint(job)) this.dropQueuedJob(job);
      if (this.latestViewportRequest) void this.hydrateViewport(this.latestViewportRequest);
      this.pump();
    }) ?? (() => {});
    this.cache = new PreviewCache(this.budget.preview.entries, this.budget.preview.diagramBytes);
    this.searchSources = new SearchPreviewSourceCache(this.budget.searchPreview.bytes, this.budget.searchPreview.entries);
  }
  private get context(): ViewContext {
    return this.deps.context;
  }
  private ensureExpansionScope(scope: CardScope): void {
    const identity = scopeIdentity(scope);
    const count = this.context.getSettings().backlinkSnippetCount;
    if (identity !== this.expansionScope || count !== this.snippetCount) {
      this.expandedReferences.clear();
      this.sourceRead = null;
      this.expansionScope = identity;
      this.snippetCount = count;
    }
  }
  private linkContextKey(card: NoteCardRecord, scope: LinksScope): string {
    const sourcePath = scope.direction === "backlinks" ? card.path : scope.notePath;
    const source = this.context.getApp().vault.getAbstractFileByPath(sourcePath);
    const version = source instanceof TFile ? `${source.stat.mtime}:${this.getFileRevision(source)}` : "missing";
    const locations = collectLinkReferenceLocations(this.context.getApp(), scope, card.path)
      .map((reference) => `${reference.offset}:${reference.source.line}:${reference.source.ch}:${reference.original}:${reference.target?.line}:${reference.target?.endLine}`);
    return `${scopeIdentity(scope)}:${sourcePath}:${version}:${readLinkReferenceCount(this.context.getApp(), scope, card.path)}:${this.snippetCount}:${this.expandedReferences.has(card.path)}:${JSON.stringify(locations)}`;
  }
  private emptyLinkPreview(card: NoteCardRecord, scope: LinksScope): LinkReferencePreview {
    const sourcePath = scope.direction === "backlinks" ? card.path : scope.notePath;
    const source = this.context.getApp().vault.getAbstractFileByPath(sourcePath);
    return { direction: scope.direction, expanded: this.expandedReferences.has(card.path),
      status: "loading", sourcePath, sourceMtime: source instanceof TFile ? source.stat.mtime : 0,
      sourceRevision: source instanceof TFile ? this.getFileRevision(source) : 0,
      contextKey: this.linkContextKey(card, scope), totalSnippets: 0, snippets: [] };
  }
  async toggleReferences(path: string): Promise<void> {
    const scope = this.context.store.getScope();
    if (this.disposed || scope.kind !== "links" || !this.context.store.getBaseCard(path)) return;
    this.ensureExpansionScope(scope);
    if (this.expandedReferences.has(path)) this.expandedReferences.delete(path);
    else this.expandedReferences.add(path);
    const card = this.context.store.getBaseCard(path)!;
    const previous = card.linkPreview;
    const initial = this.emptyLinkPreview(card, scope);
    this.context.store.patchCardPreviews([{ path, patch: { linkPreview: previous
      ? { ...initial, totalSnippets: previous.totalSnippets, snippets: [] } : initial } }]);
    this.context.publishGroups("cards");
    await this.requestPath(path, 0, { forced: true, foreground: true, explicit: true });
  }
  /** Count-only changes must re-sort too; metadata positions invalidate existing previews. */
  invalidateLinkMetadata(path?: string): boolean {
    const scope = this.context.store.getScope();
    if (this.disposed || scope.kind !== "links") return false;
    this.ensureExpansionScope(scope);
    const cards = this.context.store.getBaseCards().filter((card) => path === undefined
      || path === card.path || (scope.direction === "outgoing" && path === scope.notePath));
    if (!cards.length) return false;
    this.sourceRead = null;
    this.mutationRevision++;
    const source = path ? this.context.getApp().vault.getAbstractFileByPath(path) : null;
    if (source) this.fileRevisions.set(source, this.mutationRevision);
    if (path === undefined) {
      for (const card of cards) this.fileRevisions.set(card.file, this.mutationRevision);
      const note = this.context.getApp().vault.getAbstractFileByPath(scope.notePath);
      if (note) this.fileRevisions.set(note, this.mutationRevision);
    }
    this.context.store.patchCardPreviews(cards.map((card) => {
      this.cache.invalidateExact(card.path);
      this.searchSources.invalidateExact(card.path);
      this.appliedFingerprints.delete(card.path);
      return { path: card.path, patch: { referenceCount: readLinkReferenceCount(this.context.getApp(), scope, card.path),
        linkPreview: this.emptyLinkPreview(card, scope), hydrated: false } };
    }));
    const visible = this.context.store.getVisibleCards();
    const visiblePaths = new Set(visible.map((card) => card.path));
    const startupPaths = new Set(visible.slice(0, this.budget.preview.startupCards).map((card) => card.path));
    for (const card of cards) {
      if (visiblePaths.has(card.path) && (this.latestViewport.has(card.path) || startupPaths.has(card.path))) {
        this.schedulePath(card.path);
      }
    }
    return true;
  }
  private async buildLinkPreview(card: NoteCardRecord, scope: LinksScope, markdown: string, job: HydrationJob, leading: HydrationPreview): Promise<LinkReferencePreview> {
    const initial = this.emptyLinkPreview(card, scope);
    if (!initial.expanded && !this.hasInlineLinkPreview(card)) return initial;
    const targetMarkdown = markdown;
    const references = collectLinkReferenceLocations(this.context.getApp(), scope, card.path);
    const source = this.context.getApp().vault.getAbstractFileByPath(initial.sourcePath);
    if (!(source instanceof TFile) || resolveCardFileKind(source) !== "markdown" || !references.length) return { ...initial, status: "unavailable" };
    if (scope.direction === "outgoing") {
      const key = `${scopeIdentity(scope)}:${source.path}:${source.stat.mtime}:${this.getFileRevision(source)}`;
      if (this.sourceRead?.key !== key) this.sourceRead = { key, promise: this.context.getApp().vault.cachedRead(source) };
      const sourceRead = this.sourceRead;
      try { markdown = await sourceRead.promise; } catch {
        if (this.sourceRead === sourceRead) this.sourceRead = null;
        return { ...initial, status: "unavailable" };
      }
      if (!this.currentFingerprint(job)) return initial;
    }
    const limit = scope.direction === "outgoing" || initial.expanded || this.snippetCount === "all" ? Infinity : this.snippetCount;
    const prefix = `${job.generation}:${job.hydrationRevision}:${card.path}`;
    const isCurrent = () => this.currentFingerprint(job);
    const result = scope.direction === "outgoing"
      ? await buildOutgoingReferenceSnippets(markdown, targetMarkdown, references, prefix, isCurrent, leading)
      : await buildLinkReferenceSnippets(markdown, references, limit, prefix, isCurrent);
    return result ? { ...initial, ...result, status: result.snippets.length ? "ready" : "unavailable" } : initial;
  }
  resolveReferenceLocation(path: string, id: string, target: boolean): { path: string; location: LinkReferenceCardLocation } | null {
    const scope = this.context.store.getScope();
    const card = this.context.store.getBaseCard(path);
    const preview = card?.linkPreview;
    if (this.disposed || scope.kind !== "links" || !card || !preview || this.deps.isCommittedQueryCurrent?.() === false
      || preview.contextKey !== this.linkContextKey(card, scope)) return null;
    const snippet = preview.snippets.find((entry) => entry.id === id);
    const location = target ? snippet?.targetLocation : snippet?.location;
    const openPath = target ? card.path : preview.sourcePath;
    const file = this.context.getApp().vault.getAbstractFileByPath(openPath);
    const source = this.context.getApp().vault.getAbstractFileByPath(preview.sourcePath);
    if (!location || !(file instanceof TFile) || !(source instanceof TFile)) return null;
    const selectionVersion = this.deps.getActiveSelectionVersion?.();
    const query = this.deps.getCommittedQuery?.();
    const sourceMtime = source.stat.mtime;
    const fileMtime = file.stat.mtime;
    const sourceRevision = this.getFileRevision(source);
    const fileRevision = this.getFileRevision(file);
    const count = this.context.getSettings().backlinkSnippetCount;
    const isCurrent = (): boolean => !this.disposed
      && this.context.getApp().vault.getAbstractFileByPath(openPath) === file
      && this.context.getApp().vault.getAbstractFileByPath(preview.sourcePath) === source
      && source.stat.mtime === sourceMtime && file.stat.mtime === fileMtime
      && this.getFileRevision(source) === sourceRevision && this.getFileRevision(file) === fileRevision
      && this.deps.getActiveSelectionVersion?.() === selectionVersion
      && this.deps.getCommittedQuery?.() === query && this.deps.isCommittedQueryCurrent?.() !== false
      && this.context.getSettings().backlinkSnippetCount === count;
    return { path: openPath, location: { kind: "link-reference", location: { ...location }, isCurrent } };
  }
  static get startupCardCount(): number {
    return DESKTOP_RESOURCE_BUDGET.preview.startupCards;
  }
  get startupCardCount(): number { return this.budget.preview.startupCards; }
  getDiagnostics() {
    return { gate: this.context.workGate?.getDiagnostics(), active: this.activeReads, queued: this.queue.length, cacheEntries: this.cache.size,
      diagramBytes: this.cache.diagramBytes, searchSources: this.searchSources.getDiagnostics() };
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
    this.searchSources.clear();
    this.appliedFingerprints.clear();
    this.sourceRead = null;
  }
  getDiagramFingerprint(path: string): string {
    return diagramSourceFingerprint(this.context.getApp().vault, path, (file) => this.getFileRevision(file));
  }
  private diagramFingerprintFor(card: NoteCardRecord): PreviewFingerprint {
    return createPreviewFingerprint(card.path, card.file.stat.mtime, 1, 0, `diagram:${this.getDiagramFingerprint(card.path)}`);
  }
  async requestDiagramPreview(path: string): Promise<DiagramPreviewResult | undefined> {
    const card = this.context.store.getBaseCard(path);
    if (!card || !isDiagramKind(card.fileKind) || this.context.store.getScope().kind === "links" || this.disposed) return undefined;
    const fingerprint = this.diagramFingerprintFor(card);
    const generation = this.context.epochs.load.value, revision = this.context.store.getHydrationRevision();
    const cached = this.cache.get(fingerprint)?.diagramPreview;
    if (cached) return cached;
    await this.requestPath(path, 0, { forced: true, foreground: true });
    if (this.disposed || generation !== this.context.epochs.load.value || revision !== this.context.store.getHydrationRevision()
      || !fingerprintsEqual(fingerprint, this.diagramFingerprintFor(card))) return undefined;
    return this.cache.get(fingerprint)?.diagramPreview;
  }
  invalidateForVaultMutation(event: VaultMutationEvent): void {
    // Include inactive cache entries and both export candidates, before scope filtering.
    const paths = new Set([...this.cache.paths(), ...this.jobs.keys(), ...this.context.store.getBaseCards().map((card) => card.path)]);
    const diagramAffected = new Set([...paths].filter((path) => /\.(?:canvas|excalidraw(?:\.md)?)$/i.test(path)
      && diagramDependencies(path).some((dependency) => [event.path, event.oldPath].some((root) => root !== null
        && (dependency === root || (event.isFolder && dependency.startsWith(`${root}/`)))))));
    if (diagramAffected.size) {
      this.mutationRevision++;
      for (const path of diagramAffected) {
        this.cache.invalidateExact(path);
        this.appliedFingerprints.delete(path);
        const file = this.context.getApp().vault.getAbstractFileByPath(path);
        if (file) this.fileRevisions.set(file, this.mutationRevision);
        const job = this.jobs.get(path);
        if (job) job.replacementRequested = true;
      }
    }
    if (event.eventType === "create" || (event.isFolder && event.eventType === "modify")) return;
    this.mutationRevision += 1;
    this.sourceRead = null;
    const scope = this.context.store.getScope();
    const affectsOutgoingSource = scope.kind === "links" && scope.direction === "outgoing"
      && (scope.notePath === event.path || scope.notePath === event.oldPath || (event.isFolder && scope.notePath.startsWith(`${event.path}/`)));
    const affected = this.context.store.getBaseCards().filter((card) => affectsOutgoingSource ||
      card.path === event.path || (event.isFolder && card.path.startsWith(`${event.path}/`))
      || (event.oldPath && (card.path === event.oldPath || (event.isFolder && card.path.startsWith(`${event.oldPath}/`)))));
    for (const card of affected) this.fileRevisions.set(card.file, this.mutationRevision);
    const liveFile = this.context.getApp().vault.getAbstractFileByPath?.(event.path);
    if (liveFile) this.fileRevisions.set(liveFile, this.mutationRevision);
    this.context.store.patchCardPreviews(affected.map((card) => ({
      path: card.path, patch: { searchPreview: undefined, linkPreview: undefined, hydrated: false, previewHtml: "", previewMode: "empty" },
    })));
    if (affected.length) this.context.publishGroups("cards");
    for (const job of this.jobs.values()) {
      if (job.path === event.path || (event.isFolder && job.path.startsWith(`${event.path}/`))
        || (event.oldPath && (job.path === event.oldPath || (event.isFolder && job.path.startsWith(`${event.oldPath}/`))))) {
        job.replacementRequested = true;
      }
    }
    const invalidate = (path: string): void => {
      if (event.isFolder) {
        this.cache.invalidatePrefix(path);
        this.searchSources.invalidatePrefix(path);
        for (const key of this.appliedFingerprints.keys()) {
          if (key === path || key.startsWith(`${path}/`)) this.appliedFingerprints.delete(key);
        }
      } else {
        this.cache.invalidateExact(path);
        this.searchSources.invalidateExact(path);
        this.appliedFingerprints.delete(path);
      }
    };
    invalidate(event.path);
    if (event.eventType === "rename" && event.oldPath !== null) invalidate(event.oldPath);
  }
  prepareRecordsFromCache(records: NoteCardRecord[], scope?: CardScope): void {
    const effectiveScope = scope ?? this.context.store.getScope();
    this.ensureExpansionScope(effectiveScope);
    if (scope) {
      const retainedPaths = new Set(records.map((record) => record.path));
      for (const path of this.expandedReferences) if (!retainedPaths.has(path)) this.expandedReferences.delete(path);
    }
    for (const record of records) {
      if (effectiveScope.kind === "links") {
        record.referenceCount = readLinkReferenceCount(this.context.getApp(), effectiveScope, record.path);
        record.linkPreview = this.emptyLinkPreview(record, effectiveScope);
      }
      if (!isMarkdownCardKind(record.fileKind)) {
        Object.assign(record, this.placeholderPatch(record, effectiveScope));
        continue;
      }
      if (!this.cache.hasPath(record.path)) continue;
      const fingerprint = this.fingerprintFor(record, scope);
      const preview = this.cache.get(fingerprint);
      if (preview) {
        Object.assign(record, this.previewPatch(record, preview));
        this.rememberAppliedFingerprint(record.path, fingerprint);
      }
    }
  }
  schedulePath(path: string): void {
    if (this.disposed) return;
    const visible = this.context.store.getVisibleCards().some((card) => card.path === path);
    void this.requestPath(path, visible ? 0 : 3, { forced: true, foreground: visible });
  }
  async hydrateViewport(request: HydrateViewportRequest): Promise<void> {
    if (!this.validRequestIdentity(request) || this.deps.isLoading()) return;
    this.latestViewportRequest = { ...request, paths: [...request.paths] };
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
    const targets = paths.slice(0, this.budget.preview.startupCards);
    const jobs = targets.map((path) => this.requestPath(path, 2, { startup: true }));
    if (jobs.length === 0) return;
    const hydration = Promise.all(jobs);
    const viewWindow = this.context.getViewWindow();
    const timeout = new Promise<"timeout">((resolve) => {
      this.startupWaitTimer = viewWindow.setTimeout(() => {
        this.startupWaitTimer = null;
        resolve("timeout");
      }, this.budget.preview.startupWaitMs);
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
    const paths = visible.slice(0, this.budget.preview.startupCards).map((card) => card.path);
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

  private hasInlineLinkPreview(card: NoteCardRecord): boolean {
    if (!this.deps.getCommittedQuery?.().trim()) return true;
    const fields = this.deps.getMatchFields?.(card.path);
    return !isMarkdownCardKind(card.fileKind) || (fields?.includes("title") === true && !fields.includes("content"));
  }

  private requestPath(path: string, priority: number,
    owner: { viewport?: boolean; startup?: boolean; forced?: boolean; foreground?: boolean; explicit?: boolean }): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const card = this.context.store.getBaseCard(path);
    if (!card || (this.deps.isCommittedQueryCurrent?.() === false && !this.wantsDiagram(card))) return Promise.resolve();
    const scope = this.context.store.getScope();
    const wantsReferences = scope.kind === "links"
      && (this.expandedReferences.has(path) || (scope.direction === "outgoing" && this.hasInlineLinkPreview(card)));
    if (!isMarkdownCardKind(card.fileKind) && !wantsReferences && !this.wantsDiagram(card)) {
      if (card.hydrated && !this.deps.getCommittedQuery?.().trim()) return Promise.resolve();
      return this.enqueuePatch(
        path, this.placeholderPatch(card), this.fingerprintFor(card),
        owner.viewport === true || owner.foreground === true || owner.startup === true,
      );
    }
    const fingerprint = this.fingerprintFor(card);
    const existing = this.jobs.get(path);
    if (existing) {
      existing.explicit ||= owner.explicit === true;
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
    if (!owner.forced && !(this.wantsDiagram(card) && !this.cache.get(this.diagramFingerprintFor(card))?.diagramPreview)) {
      const applied = this.appliedFingerprints.get(path);
      if (card.hydrated && applied && fingerprintsEqual(applied, fingerprint)
        && (!wantsReferences || (card.linkPreview !== undefined && card.linkPreview.status !== "loading"))) return Promise.resolve();
      const cached = this.cache.get(fingerprint);
      if (cached) {
        return this.enqueuePatch(
          path, isMarkdownCardKind(card.fileKind) ? this.previewPatch(card, cached)
            : { ...this.placeholderPatch(card), linkPreview: this.previewPatch(card, cached).linkPreview }, fingerprint,
          owner.viewport === true || owner.startup === true,
        );
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
      explicit: owner.explicit === true,
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
    while (!this.disposed && this.activeReads < this.budget.preview.concurrency && this.queue.length > 0) {
      if (this.context.workGate?.isClosed) return;
      const index = this.context.workGate?.isPaused ? this.queue.findIndex(job => job.explicit) : 0;
      if (index < 0) return;
      const [job] = this.queue.splice(index, 1);
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
    if (!this.currentFingerprint(job)) return;
    const card = this.context.store.getBaseCard(job.path);
    if (!card) return;
    if (this.wantsDiagram(card)) {
      const fingerprint = this.diagramFingerprintFor(card);
      const result = this.cache.get(fingerprint)?.diagramPreview ?? await readDiagramPreview(
        this.context.getApp().vault, card.path, () => this.currentFingerprint(job),
        (this.context.getViewWindow() as Window & { DOMParser?: typeof DOMParser }).DOMParser);
      if (!result || !this.currentFingerprint(job)) return;
      this.cache.set(fingerprint, { html: "", mode: "empty", diagramPreview: result });
      if (this.shouldPatch(job)) await this.enqueuePatch(job.path, this.placeholderPatch(card), job.fingerprint, true);
      return;
    }
    const query = this.deps.getCommittedQuery?.().trim() ?? "";
    const fields = this.deps.getMatchFields?.(card.path);
    const titleOnly = !!query && fields?.includes("title") && !fields.includes("content");
    const ordinaryFingerprint = createPreviewFingerprint(card.path, card.mtime,
      job.fingerprint.previewLines, job.fingerprint.maxVisibleChars, `|file:${this.getFileRevision(card.file)}|live:${card.file.stat?.mtime ?? card.mtime}`);
    const ordinary = this.cache.get(ordinaryFingerprint);
    if (titleOnly && ordinary && this.context.store.getScope().kind !== "links") {
      const preview = { ...ordinary, searchPreview: this.searchPreviewFor(card, "title-only") };
      this.cache.set(job.fingerprint, preview);
      if (this.shouldPatch(job)) await this.enqueuePatch(job.path, this.previewPatch(card, preview), job.fingerprint,
        job.viewport || job.foreground || job.startup || job.startupLate);
      return;
    }
    let patch: Partial<CardPreviewFields>;
    try {
      const sourceVersion = `${card.mtime}:${card.file.stat?.mtime ?? card.mtime}:${this.getFileRevision(card.file)}`;
      const prepared = query && !titleOnly ? this.searchSources.get(card.path, sourceVersion) : undefined;
      const markdown = prepared && ordinary && this.context.store.getScope().kind !== "links"
        ? prepared.source
        : isMarkdownCardKind(card.fileKind) ? await this.context.getApp().vault.cachedRead(card.file) : "";
      if (!this.currentFingerprint(job)) return;
      const scope = this.context.store.getScope();
      const location = !query && scope.kind === "links"
        ? resolveLinkCardLocation(this.context.getApp(), scope, card.path) : null;
      let preview: HydrationPreview;
      const leading = ordinary ?? buildLightPreview(markdown, job.fingerprint.maxVisibleChars, job.fingerprint.previewLines);
      if (query && titleOnly) {
        preview = { ...leading, searchPreview: this.searchPreviewFor(card, "title-only") };
      } else if (query) {
        if (this.matcherQuery !== query) {
          this.matcherQuery = query;
          this.matcher = createSearchPreviewMatcher(query);
        }
        const snippets = await extractSearchPreviewSnippets(prepared ?? markdown, {
          limit: this.context.getSettings().searchPreviewSnippetCount,
          maxChars: 200,
          idPrefix: `${job.generation}:${job.hydrationRevision}:${job.fingerprint.contextKey}`,
          matcher: this.matcher,
          isCurrent: () => this.currentFingerprint(job),
          onPrepared: (source) => {
            if (this.currentFingerprint(job)) this.searchSources.set(card.path, sourceVersion, source);
          },
        });
        if (!snippets || !this.currentFingerprint(job)) return;
        preview = { ...leading, searchPreview: this.searchPreviewFor(card, snippets.length ? "hits" : "unavailable", snippets) };
      } else {
        preview = (location
          ? buildLocationPreview(markdown, location, job.fingerprint.maxVisibleChars, job.fingerprint.previewLines)
          : null)
        ?? leading;
      }
      if (scope.kind === "links") {
        const linkPreview = await this.buildLinkPreview(card, scope, markdown, job, leading);
        if (!this.currentFingerprint(job)) return;
        const primary = linkPreview.snippets[0];
        preview = this.hasInlineLinkPreview(card)
          ? { ...preview, html: primary?.html ?? "", mode: primary?.mode ?? "empty", linkPreview }
          : { ...preview, linkPreview };
      }
      if (!this.currentFingerprint(job)) return;
      this.cache.set(ordinaryFingerprint, leading);
      this.cache.set(job.fingerprint, preview);
      patch = isMarkdownCardKind(card.fileKind) ? this.previewPatch(card, preview)
        : { ...this.placeholderPatch(card), linkPreview: preview.linkPreview };
    } catch {
      if (!this.currentFingerprint(job)) return;
      patch = isMarkdownCardKind(card.fileKind) ? buildEmptyPreviewPatch(this.context.getApp(), card) : this.placeholderPatch(card);
      const scope = this.context.store.getScope();
      if (scope.kind === "links") patch.linkPreview = { ...this.emptyLinkPreview(card, scope), status: "unavailable" };
      if (this.deps.getCommittedQuery?.().trim()) {
        patch.searchPreview = this.searchPreviewFor(card, "unavailable");
      }
    }
    if (this.shouldPatch(job)) {
      await this.enqueuePatch(job.path, patch, job.fingerprint,
        job.viewport || job.foreground || job.startup || job.startupLate);
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
      && (this.deps.isCommittedQueryCurrent?.() !== false || (!!card && this.wantsDiagram(card)))
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
        && this.deps.isCommittedQueryCurrent?.() !== false
        && item.generation === this.context.epochs.load.value
        && item.hydrationRevision === this.context.store.getHydrationRevision()
        && card !== undefined
        && fingerprintsEqual(item.fingerprint, this.fingerprintFor(card));
    });
    if (valid.length > 0) {
      this.context.store.patchCardPreviews(valid.map((item) => item.update));
      for (const item of valid) this.rememberAppliedFingerprint(item.update.path, item.fingerprint);
      if (valid.some((item) => item.publish)) this.context.publishGroups("cards");
    }
    pending.forEach((item) => item.resolve());
  }
  private wantsDiagram(card: NoteCardRecord): boolean {
    return isDiagramKind(card.fileKind) && this.context.store.getScope().kind !== "links";
  }
  private fingerprintFor(card: NoteCardRecord, scopeOverride?: CardScope): PreviewFingerprint {
    const query = this.deps.getCommittedQuery?.().trim() ?? "";
    const scope = scopeOverride ?? this.context.store.getScope();
    this.ensureExpansionScope(scope);
    const location = !query && scope.kind === "links"
      ? resolveLinkCardLocation(this.context.getApp(), scope, card.path) : null;
    return createPreviewFingerprint(
      card.path,
      card.mtime,
      this.context.getSettings().previewLines,
      DEFAULT_PREVIEW_MAX_VISIBLE_CHARS,
      `${isDiagramKind(card.fileKind) ? `source:${this.getDiagramFingerprint(card.path)}|` : ""}${query ? `search:${this.deps.getSearchContentRevision?.() ?? 0}:${query}:snippets:${this.context.getSettings().searchPreviewSnippetCount}` : location ? `link:${location.identity}` : ""}${scope.kind === "links" ? `|links:${this.linkContextKey(card, scope)}` : ""}|file:${this.getFileRevision(card.file)}|live:${card.file.stat?.mtime ?? card.mtime}`,
    );
  }
  private rememberAppliedFingerprint(path: string, fingerprint: PreviewFingerprint): void {
    this.appliedFingerprints.delete(path);
    this.appliedFingerprints.set(path, fingerprint);
    if (this.appliedFingerprints.size > this.budget.preview.entries) {
      const oldest = this.appliedFingerprints.keys().next().value;
      if (oldest !== undefined) this.appliedFingerprints.delete(oldest);
    }
  }
  private previewPatch(card: NoteCardRecord, preview: HydrationPreview): Partial<CardPreviewFields> {
    const patch = buildPreviewPatch(this.context.getApp(), card, preview);
    if (patch.linkPreview) patch.linkPreview = { ...patch.linkPreview, snippets: patch.linkPreview.snippets.map((snippet) => ({ ...snippet, id: `${this.context.epochs.load.value}:${this.context.store.getHydrationRevision()}:${card.path}:${snippet.location.identity}` })) };
    if (preview.searchPreview) {
      patch.searchPreview = {
        ...preview.searchPreview,
        snippets: preview.searchPreview.snippets.map((snippet) => ({
          ...snippet,
          id: `${this.context.epochs.load.value}:${this.context.store.getHydrationRevision()}:${card.path}:${snippet.location.offset}`,
        })),
      };
    }
    return patch;
  }
  private placeholderPatch(card: NoteCardRecord, scopeOverride?: CardScope): Partial<CardPreviewFields> {
    const patch = buildPlaceholderPatch(card, this.context.getUiStrings().fileKind);
    const scope = scopeOverride ?? this.context.store.getScope();
    if (scope.kind === "links") patch.linkPreview = this.emptyLinkPreview(card, scope);
    if (this.deps.getCommittedQuery?.().trim()) patch.searchPreview = this.searchPreviewFor(card, "title-only");
    return patch;
  }
  private searchPreviewFor(card: NoteCardRecord, status: SearchPreview["status"], snippets: SearchPreview["snippets"] = []): SearchPreview {
    return {
      query: this.deps.getCommittedQuery?.().trim() ?? "",
      revision: this.deps.getSearchContentRevision?.() ?? 0,
      mtime: card.file.stat?.mtime ?? card.mtime,
      previewLines: this.context.getSettings().previewLines,
      snippetLimit: this.context.getSettings().searchPreviewSnippetCount,
      status, snippets,
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
    this.stopWorkGate(); this.latestViewportRequest = null;
    this.sourceRead = null;
    this.expandedReferences.clear();
    this.cache.clear();
    this.searchSources.clear();
    this.appliedFingerprints.clear();
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
