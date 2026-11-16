import { ItemView, Menu, Notice, TFolder, type HoverParent, type HoverPopover, type WorkspaceLeaf, type ViewStateResult } from "obsidian";
import { mount, unmount } from "svelte";
import type CardWorkspacePlugin from "../main";
import { normalizeSettings } from "../settings";
import { CARD_WORKSPACE_ICON } from "../icons";
import { CardStreamRuntime } from "./CardStreamRuntime";
import { LeafStreamController, decodeDesktopLeafState, resolveStreamSizes, type LeafNavigationState, type StreamSnapshot } from "./stream-state";
import { createStreamBrowseState } from "./stream-browse-state";
import { createStreamPanelModel, type StreamCommand, type StreamPanelModel } from "./stream-panel-model";
import { getStreamUiStrings } from "./stream-ui-strings";
import { LeafPreviewResources } from "./leaf-preview-resources";
import { DESKTOP_RESOURCE_BUDGET } from "../runtime/resource-budget";
import { NavLayoutController } from "./controllers/NavLayoutController";
import { createViewStateStore } from "./view-state-store";
import { createViewEpochs } from "./view-epochs";
import { createFolderScope, createLinksScope, scopeIdentity, validateScope, type CardScope } from "./scope";
import { rewritePathAfterRename } from "./scope-files";
import { DEFAULT_TASK_FILTER } from "./task-filters";
import { buildPanelProps } from "./panel-props";
import { normalizePropertyFilterClauses } from "../property-filter-settings";
import { StreamNameModal } from "./modals/StreamNameModal";
import { StreamSourcePicker, type StreamSourceChoice } from "./modals/StreamSourcePicker";
import type { ViewContext } from "./view-context";
import type { FolderSelectionRequest, NavContextMenuPayload, RefreshRequest, VaultMutationEvent } from "./types";
import type { ViewUpdateIntent } from "./update-intent";
import type { RefreshReason } from "./types";

export const FOLDER_CARD_VIEW = "folder-card-view";
let streamSequence = 0;
function nextStreamId(): string { return `stream-${Date.now().toString(36)}-${(++streamSequence).toString(36)}`; }
type RuntimeEntry = { runtime: CardStreamRuntime; props: ReturnType<CardStreamRuntime["getPanelProps"]>; stop: () => void; stopActivity: (() => void) | null };

/** ItemView owns leaves and navigation; each plain runtime owns one browsing context. */
export class FolderCardView extends ItemView implements HoverParent {
  readonly plugin: CardWorkspacePlugin;
  readonly streams: LeafStreamController;
  readonly streamPanelModel: StreamPanelModel;
  private readonly desktop: boolean;
  private readonly runtimes = new Map<string, RuntimeEntry>();
  private readonly pending = new Map<string, Promise<CardStreamRuntime | null>>();
  private readonly sessions = new Map<string, ReturnType<CardStreamRuntime["captureSelection"]>>();
  private readonly failures = new Map<string, string>();
  private readonly transferring = new Set<string>();
  private readonly resources: LeafPreviewResources;
  private readonly navLayout: NavLayoutController;
  private readonly fallback: CardStreamRuntime;
  private navigationState: LeafNavigationState;
  private component: ReturnType<typeof mount> | null = null;
  private foreground: Promise<void> = Promise.resolve();
  private hostEl: HTMLElement | null = null;
  private stopped = false;
  private syncing = false;
  private restoring = false;
  private opened = false;
  private restored = false;
  private readyToLoad = false;
  private legacySeedPending = true;
  private navigationTouched = false;
  private stagedTransfer: StreamSnapshot | null = null;
  private leafStateEpoch = 0;
  private unsupported: Record<string, unknown> | null = null;
  private stopStreams: (() => void) | null = null;
  private stopVault: (() => void) | null = null;
  private stopMetadata: (() => void) | null = null;
  private saveTimer: ReturnType<Window["setTimeout"]> | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: CardWorkspacePlugin) {
    super(leaf); this.plugin = plugin;
    this.desktop = (plugin.runtimePlatform?.device ?? "desktop") === "desktop";
    this.navigation = !this.desktop;
    const settings = normalizeSettings(plugin.getSettings());
    this.navigationState = { width: settings.navPaneWidth, collapsed: settings.navPaneCollapsed,
      expandedFolderPaths: [...settings.expandedFolderPaths], expandedTagPaths: [...settings.expandedTagPaths],
      expandedPropertyKeys: [...settings.expandedPropertyKeys], sectionCollapsed: { ...settings.sectionCollapsed }, query: "", focusId: null };
    this.resources = new LeafPreviewResources(plugin.resourceBudget ?? DESKTOP_RESOURCE_BUDGET);
    const navStore = createViewStateStore(createFolderScope("", settings.includeSubfolders));
    const getNavigationStore = () => this.currentRuntime?.store ?? navStore;
    const context: ViewContext = {
      getApp: () => this.app, getSettings: () => plugin.getSettings(), saveSettings: patch => plugin.saveSettings(patch),
      getUiStrings: () => plugin.getUiStrings(), notify: message => { new Notice(message); },
      get store() { return getNavigationStore(); }, epochs: createViewEpochs(), runtimePlatform: plugin.runtimePlatform,
      publishGroups: () => { this.navigationRuntime?.refreshNavigationMetadata(); this.publishStreams(); this.requestSave(); },
      requestUpdate: async (intent, reason) => this.applyUpdateIntent(intent, reason),
      getViewWindow: () => this.containerEl.ownerDocument?.defaultView ?? window,
    };
    this.navLayout = new NavLayoutController({ context, getTooltipSide: () => leaf.getRoot() === this.app.workspace.leftSplit ? "right" : "left",
      onNavCountsInvalidated: () => {
        for (const runtime of [this.fallback, ...[...this.runtimes.values()].map(entry => entry.runtime)]) {
          if (!runtime) continue;
          runtime.modules.boxActions.invalidateCache(); runtime.modules.projection.invalidateVaultCaches();
          runtime.modules.property.invalidateVault(); runtime.epochs.navCount.bump();
        }
      },
      ...(this.desktop ? { localState: { get: () => this.navigationState, update: (patch: Partial<LeafNavigationState>) => {
        this.navigationTouched = true;
        this.navigationState = { ...this.navigationState, ...patch }; this.requestSave();
      } } } : {}),
    });
    const initial = this.makeSnapshot(createFolderScope(settings.lastFolderPath ?? "", settings.includeSubfolders));
    // Migrating the old leaf preserves its existing browse filter. Explicit new streams start empty.
    initial.browse.filter = { tags: [...settings.filter.tags], properties: normalizePropertyFilterClauses(settings.filter.properties) };
    this.streams = new LeafStreamController(this.desktop ? [initial] : []);
    this.fallback = new CardStreamRuntime(this, plugin, this.desktop ? {
      snapshot: initial, navLayout: this.navLayout, previewResources: this.resources,
      onToggleNav: () => { void this.navLayout.onToggleNavPane(); },
      appendStreamMenu: (menu, payload) => this.appendNewStreamMenu(menu, payload),
      isCurrent: () => this.currentRuntime === null,
      getNavigationSnapshot: () => this.currentRuntime?.panelModel.getState().nav,
    } : {});
    this.streamPanelModel = createStreamPanelModel({ entries: [], currentStreamId: null, direction: "horizontal",
      navigationVisible: this.navLayout.getNavVisible(), singlePane: false, navPanelModel: this.fallback.panelModel,
      navProps: {}, labels: getStreamUiStrings(plugin.getUiLanguage()), recentlyClosedCount: 0, unsupported: false });
    this.stopStreams = this.desktop ? this.streams.subscribe(() => this.syncStreams()) : null;
  }
  private get currentRuntime(): CardStreamRuntime | null {
    const id = this.streams.getState().currentStreamId;
    return id ? this.runtimes.get(id)?.runtime ?? null : null;
  }
  private get navigationRuntime(): CardStreamRuntime { return this.currentRuntime ?? this.fallback; }
  get modules() { return this.desktop ? this.navigationRuntime.modules : this.fallback.modules; }
  get panelModel() { return this.desktop ? this.navigationRuntime.panelModel : this.fallback.panelModel; }
  get hoverPopover(): HoverPopover | null { return this.navigationRuntime.hoverPopover; }
  set hoverPopover(value: HoverPopover | null) { this.navigationRuntime.hoverPopover = value; }
  getViewType(): string { return FOLDER_CARD_VIEW; }
  getDisplayText(): string { return this.plugin.getUiStrings().view.displayName; }
  getIcon(): string { return CARD_WORKSPACE_ICON; }
  hasCurrentStream(): boolean { return !this.desktop || this.streams.getState().currentStreamId !== null; }
  getCardScopes(): readonly CardScope[] { return this.desktop ? this.streams.getState().streams.map(stream => stream.scope) : [this.fallback.getCardScope()]; }
  async waitForForeground(): Promise<void> {
    if (!this.desktop) { await this.fallback.modules.scopeController.waitForIdle(); return; }
    await this.foreground;
    await this.plugin.waitForSettingsReady?.();
    if (this.stopped) return;
    this.seedLegacyState(); this.readyToLoad = true; this.syncStreams();
    const id = this.streams.getState().currentStreamId; if (id) await this.ensureRuntime(id);
  }
  getCardScope(): CardScope { return this.navigationRuntime.getCardScope(); }
  getCurrentFolderPath(): string | null { return this.navigationRuntime.getCurrentFolderPath(); }
  hasLoadedScope(): boolean { return this.desktop ? this.restored || this.currentRuntime?.hasLoadedScope() === true : this.fallback.hasLoadedScope(); }
  getSourceSummary(): string {
    const state = this.streams.getState(); const current = state.streams.find(stream => stream.id === state.currentStreamId);
    return current ? this.streamTitle(current) : getStreamUiStrings(this.plugin.getUiLanguage()).empty;
  }
  private seedLegacyState(): void {
    if (!this.legacySeedPending || this.restored) return;
    this.legacySeedPending = false;
    const state = this.streams.getState(), previous = state.streams[0];
    if (state.streams.length !== 1 || !previous || this.runtimes.size > 0) return;
    const settings = this.plugin.getSettings();
    const snapshot = this.makeSnapshot(createFolderScope(settings.lastFolderPath ?? "", settings.includeSubfolders));
    snapshot.browse.filter = { tags: [...settings.filter.tags], properties: normalizePropertyFilterClauses(settings.filter.properties) };
    if (!this.navigationTouched) this.navigationState = { ...this.navigationState,
      width: settings.navPaneWidth, collapsed: settings.navPaneCollapsed,
      expandedFolderPaths: [...settings.expandedFolderPaths], expandedTagPaths: [...settings.expandedTagPaths],
      expandedPropertyKeys: [...settings.expandedPropertyKeys], sectionCollapsed: { ...settings.sectionCollapsed } };
    this.streams.update(previous.id, { ...snapshot, id: previous.id, title: previous.title });
  }
  private makeSnapshot(scope: CardScope): StreamSnapshot {
    return { id: nextStreamId(), title: null, scope: { ...scope }, browse: createStreamBrowseState(scope, this.plugin.getSettings()),
      query: "", searchOpen: false, linksPinned: scope.kind === "links", taskFilters: { ...DEFAULT_TASK_FILTER },
      collapsedGroups: {}, anchor: null, anchorIndex: 0, desiredExpanded: true, lastActive: 0, widthWeight: 1, heightWeight: 1 };
  }
  private sourceLabel(scope: CardScope): string {
    if (scope.kind === "folder") return scope.path || "/";
    if (scope.kind === "box") return this.plugin.getSettings().boxes.find(box => box.id === scope.boxId)?.name ?? scope.boxId;
    const direction = scope.direction === "backlinks" ? this.plugin.getUiStrings().links.directionBacklinks : this.plugin.getUiStrings().links.directionOutgoing;
    return `${scope.notePath} · ${direction}`;
  }
  private streamTitle(stream: StreamSnapshot): string {
    if (stream.title) return stream.title;
    const peers = this.streams.getState().streams.filter(candidate => scopeIdentity(candidate.scope) === scopeIdentity(stream.scope));
    const label = this.sourceLabel(stream.scope);
    return peers.length > 1 ? `${label} (${peers.findIndex(candidate => candidate.id === stream.id) + 1})` : label;
  }
  private capture(id: string): void {
    const entry = this.runtimes.get(id); const base = this.streams.getState().streams.find(stream => stream.id === id);
    if (entry && base && (entry.runtime.hasLoadedScope() || entry.runtime.missing) && !this.pending.has(id)) this.streams.update(id, entry.runtime.captureSnapshot(base));
  }
  private captureAll(): void {
    const previous = this.syncing; this.syncing = true;
    try { for (const id of this.runtimes.keys()) this.capture(id); }
    finally { this.syncing = previous; }
  }
  private syncStreams(): void {
    if (!this.desktop || this.stopped || this.syncing || this.restoring) return;
    this.syncing = true;
    try {
      const state = this.streams.getState();
      const dimension = state.direction === "horizontal" ? state.width : state.height;
      const visible = new Set(dimension > 0 ? state.visibleIds : state.currentStreamId ? [state.currentStreamId] : []);
      for (const [id, entry] of this.runtimes) {
        if (visible.has(id) || this.transferring.has(id)) continue;
        this.capture(id);
        if (state.streams.some(stream => stream.id === id)) this.sessions.set(id, entry.runtime.captureSelection());
        else this.sessions.delete(id);
        entry.stop(); entry.stopActivity?.(); entry.runtime.cleanupLifecycle(); this.runtimes.delete(id); this.pending.delete(id);
      }
      if (this.opened && this.readyToLoad) for (const id of visible) void this.ensureRuntime(id);
      const current = this.currentRuntime;
      this.resources.setCurrent(current?.modules.hydration ?? null);
      current?.refreshNavigationMetadata();
      this.publishStreams(); this.requestSave();
    } finally { this.syncing = false; }
  }
  private ensureRuntime(id: string): Promise<CardStreamRuntime | null> {
    const underway = this.pending.get(id); if (underway) return underway;
    const existing = this.runtimes.get(id); if (existing) return Promise.resolve(existing.runtime);
    const snapshot = this.streams.getState().streams.find(stream => stream.id === id) ?? (this.stagedTransfer?.id === id ? this.stagedTransfer : null);
    if (!snapshot || this.stopped) return Promise.resolve(null);
    const runtime = new CardStreamRuntime(this, this.plugin, { snapshot, navLayout: this.navLayout, previewResources: this.resources,
      onChange: () => { this.capture(id); this.publishStreams(); this.requestSave(); },
      onToggleNav: () => { void this.navLayout.onToggleNavPane(); },
      appendStreamMenu: (menu, payload) => this.appendNewStreamMenu(menu, payload),
      isCurrent: () => this.streams.getState().currentStreamId === id,
      getNavigationSnapshot: () => this.navigationRuntime.panelModel.getState().nav,
    });
    runtime.connect();
    const entry: RuntimeEntry = { runtime, props: runtime.getPanelProps(), stop: () => {}, stopActivity: null };
    this.runtimes.set(id, entry);
    entry.stop = runtime.panelModel.subscribe(() => {
      if (this.syncing || this.stopped || this.runtimes.get(id)?.runtime !== runtime) return;
      this.capture(id); this.publishStreams(); this.requestSave();
    });
    const loading = Promise.resolve().then(async () => {
      await this.plugin.waitForSettingsReady?.();
      if (this.stopped || this.runtimes.get(id)?.runtime !== runtime) return null;
      await runtime.restoreSnapshot(snapshot);
      if (this.stopped || this.runtimes.get(id)?.runtime !== runtime) return null;
      const selection = this.sessions.get(id); if (selection) runtime.restoreSelection(selection);
      this.failures.delete(id); return runtime;
    }).catch((error: unknown) => {
      if (this.stopped || this.runtimes.get(id)?.runtime !== runtime) return null;
      this.failures.set(id, String(error)); console.warn("[Card Workspace] Stream restore failed", error); return null;
    }).finally(() => {
      if (this.stopped || this.runtimes.get(id)?.runtime !== runtime) return;
      if (this.pending.get(id) === loading) this.pending.delete(id);
      this.capture(id); this.publishStreams(); this.requestSave();
    });
    this.pending.set(id, loading);
    this.publishStreams(); return loading;
  }
  private publishStreams(): void {
    if (!this.desktop || !this.streamPanelModel || this.stopped) return;
    const state = this.streams.getState(), visible = new Set(state.visibleIds), sizes = resolveStreamSizes(state);
    const nav = this.navigationRuntime;
    const counts = new Map<string, number>(), ordinals = new Map<string, number>();
    for (const stream of state.streams) { const key = scopeIdentity(stream.scope); counts.set(key, (counts.get(key) ?? 0) + 1); }
    const titleFor = (stream: StreamSnapshot): string => {
      const key = scopeIdentity(stream.scope), ordinal = (ordinals.get(key) ?? 0) + 1; ordinals.set(key, ordinal);
      return stream.title ?? `${this.sourceLabel(stream.scope)}${(counts.get(key) ?? 0) > 1 ? ` (${ordinal})` : ""}`;
    };
    const requireCurrent = (): CardStreamRuntime | null => {
      const runtime = this.currentRuntime;
      if (!runtime) new Notice(this.plugin.getUiLanguage() === "zh" ? "请先选择或新建卡片流。" : "Select or create a card stream first.");
      const id = state.currentStreamId;
      return id && this.transferring.has(id) ? null : runtime;
    };
    const navProps = { ...buildPanelProps(nav),
      onViewModeChange: (detail: { mode?: unknown }) => { void requireCurrent()?.modules.arrangementActions.onViewModeChange(detail); },
      onIncludeSubfoldersChange: (detail: { value?: unknown }) => { void requireCurrent()?.onIncludeSubfoldersChange(detail); },
      onSelectFolder: (detail: { path?: unknown }) => {
      if (typeof detail.path === "string") void this.selectFolderFromNav(detail.path);
    }, onNavigationIntent: (intent: import("./navigation-model").NavigationIntent) => this.handleNavigationIntent(intent),
      onToggleNavPane: () => { void this.navLayout.onToggleNavPane(); }, onShellResize: (width: number) => this.navLayout.onShellResize(width) };
    this.streamPanelModel.setState({
      entries: state.streams.map(stream => { const entry = this.runtimes.get(stream.id); return {
        id: stream.id, title: titleFor(stream), sourceLabel: this.sourceLabel(stream.scope),
        expanded: visible.has(stream.id), autoCollapsed: stream.desiredExpanded && !visible.has(stream.id),
        current: stream.id === state.currentStreamId, pending: this.pending.has(stream.id) || this.transferring.has(stream.id),
        error: this.failures.get(stream.id), panelModel: entry?.runtime.panelModel ?? null, props: entry?.props ?? {},
        weight: state.direction === "horizontal" ? stream.widthWeight : stream.heightWeight, size: sizes[stream.id],
      }; }), currentStreamId: state.currentStreamId, direction: state.direction,
      navigationVisible: this.navLayout.getNavVisible(), singlePane: this.navLayout.getLayoutMode() === "single",
      navPanelModel: nav.panelModel, navProps, labels: getStreamUiStrings(this.plugin.getUiLanguage()),
      recentlyClosedCount: state.recentlyClosedCount, unsupported: this.unsupported !== null,
    });
  }
  private requestSave(): void {
    if (!this.opened || this.stopped || this.saveTimer !== null || this.desktop && this.legacySeedPending) return;
    const win = this.containerEl.ownerDocument?.defaultView ?? window;
    this.saveTimer = win.setTimeout(() => { this.saveTimer = null; if (!this.stopped) this.app.workspace.requestSaveLayout?.(); }, 200);
  }
  override getState(): Record<string, unknown> {
    if (!this.desktop) return this.fallback.getState();
    if (this.unsupported) return this.unsupported;
    this.captureAll();
    return { ...this.streams.toJSON({ ...this.navigationState, query: this.navLayout.getQuery(), focusId: this.navLayout.getFocusId() }) };
  }
  override async setState(value: unknown, result: ViewStateResult): Promise<void> {
    if (!this.desktop) return this.fallback.setState(value, result);
    result.history = false;
    const parsed = decodeDesktopLeafState(value, this.plugin.getSettings());
    if (parsed.kind === "legacy") {
      const epoch = this.leafStateEpoch;
      await this.plugin.waitForSettingsReady?.();
      if (this.stopped || epoch !== this.leafStateEpoch || !this.legacySeedPending) return;
      // Deferred legacy leaves can open after layout-ready startup has finished.
      // Native state restoration must therefore initialize them without relying
      // on the startup pass over already visible leaves.
      this.seedLegacyState(); this.readyToLoad = true; this.syncStreams();
      const current = this.streams.getState().currentStreamId;
      if (this.opened && current) await this.ensureRuntime(current);
      return;
    }
    this.leafStateEpoch++; this.stagedTransfer = null; this.legacySeedPending = false;
    if (parsed.kind === "unsupported") {
      this.restoring = true;
      for (const entry of this.runtimes.values()) { entry.stop(); entry.stopActivity?.(); entry.runtime.cleanupLifecycle(); }
      this.runtimes.clear(); this.pending.clear(); this.sessions.clear();
      this.streams.restore({ version: 1, streams: [], currentStreamId: null, direction: "horizontal", navigation: this.navigationState });
      this.unsupported = parsed.raw; this.restored = true; this.restoring = false; this.publishStreams(); return;
    }
    this.restoring = true;
    try {
      for (const entry of this.runtimes.values()) { entry.stop(); entry.stopActivity?.(); entry.runtime.cleanupLifecycle(); }
      this.runtimes.clear(); this.pending.clear(); this.sessions.clear(); this.failures.clear();
      this.navigationState = parsed.state.navigation;
      this.navLayout.restoreLocalPosition(parsed.state.navigation.query, parsed.state.navigation.focusId);
      this.streams.restore(parsed.state); this.readyToLoad = true; this.restored = true; this.unsupported = null;
    } finally { this.restoring = false; }
    this.syncStreams();
    const current = this.streams.getState().currentStreamId; if (this.opened && current) await this.ensureRuntime(current);
  }
  onOpen(): Promise<void> { return this.foreground = this.openView(); }
  private async openView(): Promise<void> {
    this.opened = true;
    if (!this.desktop) { await this.fallback.onOpen(); return; }
    const Panel = (await import("./StreamWorkspacePanel.svelte")).default;
    if (this.stopped) return;
    const target = (this.containerEl.children[1] as HTMLElement) ?? this.containerEl; target.empty();
    this.hostEl = target.createDiv({ cls: "folder-card-view" });
    this.component = mount(Panel, { target: this.hostEl, props: {
      model: this.streamPanelModel, onSelect: (id: string) => { if (!this.transferring.has(id)) this.streams.select(id); },
      onCommand: (id: string, command: StreamCommand, anchor?: HTMLElement) => this.handleStreamCommand(id, command, anchor),
      onCreate: () => this.openNewStreamPicker(), onReopen: () => { this.streams.reopen(); },
      onDirection: (direction: "horizontal" | "vertical") => this.streams.setDirection(direction),
      onResize: (width: number, height: number) => this.streams.setSize(width, height),
      onResizePair: (a: string, b: string, delta: number) => this.streams.resizePair(a, b, delta),
      onReorder: (id: string, delta: -1 | 1) => this.streams.reorder(id, delta),
      onToggleNav: () => { void this.navLayout.onToggleNavPane(); },
    } });
    this.navLayout.refreshFolderTreeState();
    this.stopVault = this.plugin.subscribeVaultEvents(event => {
      this.handleNavigationVaultMutation(event);
      this.reconcileSnapshots(event);
      for (const entry of this.runtimes.values()) {
        const result = entry.runtime.handleVaultMutation(event);
        if (result.shouldRefresh) entry.runtime.modules.scopeController.scheduleVaultRefresh();
      }
    });
    this.stopMetadata = this.plugin.subscribeMetadataEvents(async event => {
      await Promise.all([this.fallback, ...[...this.runtimes.values()].map(entry => entry.runtime)].map(async runtime => {
        if (event.kind === "resolved") {
          runtime.modules.metadataImpact.handleMetadataResolved();
          if (runtime.getCardScope().kind === "links") runtime.modules.scopeController.scheduleVaultRefresh();
        } else await runtime.modules.metadataImpact.handleMetadataChange(event.path);
      }));
    });
    this.syncStreams();
    const current = this.streams.getState().currentStreamId; if (current && this.readyToLoad) await this.ensureRuntime(current);
  }
  async onClose(): Promise<void> {
    if (!this.desktop) { this.cleanupLifecycle(); await this.fallback.onClose(); return; }
    this.captureAll(); this.cleanupLifecycle();
    if (this.component) await unmount(this.component);
    this.component = null; this.hostEl = null;
  }
  cleanupLifecycle() {
    if (!this.desktop) { this.stopped = true; this.navLayout.dispose(); this.resources.dispose(); return this.fallback.cleanupLifecycle(); }
    this.stopped = true; this.stopStreams?.(); this.stopVault?.(); this.stopMetadata?.();
    if (this.saveTimer !== null) (this.containerEl.ownerDocument?.defaultView ?? window).clearTimeout(this.saveTimer);
    this.saveTimer = null;
    for (const entry of this.runtimes.values()) { entry.stop(); entry.stopActivity?.(); entry.runtime.cleanupLifecycle(); }
    this.runtimes.clear(); this.pending.clear(); this.sessions.clear(); this.fallback.cleanupLifecycle(); this.navLayout.dispose(); this.resources.dispose();
    return { cancelledDebounce: true, clearedQueuedRequest: true, clearedPendingHydration: true };
  }
  async handleScopeSelection(request: FolderSelectionRequest) {
    if (!this.desktop) return this.fallback.handleScopeSelection(request);
    const currentId = this.streams.getState().currentStreamId;
    if (this.unsupported || this.stagedTransfer || (currentId && this.transferring.has(currentId))) return { action: "rejected_invalid" as const, scope: request.scope, generationChanged: false, preserveUiState: true };
    if (request.source === "restore") this.seedLegacyState();
    this.legacySeedPending = false; this.readyToLoad = true;
    let id = this.streams.getState().currentStreamId;
    if (!id) { const stream = this.makeSnapshot(request.scope); this.streams.add(stream); id = stream.id; }
    if (!this.runtimes.has(id) && !this.pending.has(id)) {
      const previous = this.streams.getState().streams.find(stream => stream.id === id);
      if (previous && scopeIdentity(previous.scope) !== scopeIdentity(request.scope)) this.streams.update(id, {
        scope: request.scope, browse: createStreamBrowseState(request.scope, this.plugin.getSettings()), query: previous.query, anchor: null,
      });
    }
    const runtime = await this.ensureRuntime(id);
    if (!runtime) return { action: "rejected_invalid" as const, scope: request.scope, generationChanged: false, preserveUiState: true };
    return runtime.handleScopeSelection(request);
  }
  async setFolder(folder: TFolder) {
    return this.handleScopeSelection({ requestId: Date.now(), scope: createFolderScope(folder.path, this.plugin.getSettings().includeSubfolders), source: "panel-picker", requestedAtMs: Date.now(), forceRefresh: false });
  }
  async selectFolderFromNav(path: string): Promise<void> {
    if (!this.desktop) return this.fallback.selectFolderFromNav(path);
    this.navLayout.returnToCardsViewIfSinglePane();
    const current = this.getCardScope();
    await this.handleScopeSelection({ requestId: Date.now(), scope: createFolderScope(path, current.kind === "folder" ? current.includeSubfolders : this.plugin.getSettings().includeSubfolders), source: "panel-picker", requestedAtMs: Date.now(), forceRefresh: false });
  }
  handleNavigationIntent(intent: import("./navigation-model").NavigationIntent): void {
    if (!this.desktop) { this.fallback.handleNavigationIntent(intent); return; }
    const currentId = this.streams.getState().currentStreamId;
    if (this.unsupported || this.stagedTransfer || (currentId && this.transferring.has(currentId))) return;
    if (!this.hasCurrentStream() && intent.type === "activate") {
      const row = this.navLayout.getProjection().rows.find(candidate => candidate.id === intent.rowId);
      if (row && this.openNavigationSource(row.menuTarget)) return;
    }
    this.navigationRuntime.handleNavigationIntent(intent);
  }
  handleVaultMutation(event: VaultMutationEvent) {
    if (!this.desktop) return this.fallback.handleVaultMutation(event);
    this.reconcileSnapshots(event);
    return this.navigationRuntime.handleVaultMutation(event);
  }
  async refresh(request: RefreshRequest = { reason: "manual" }) { return this.navigationRuntime.refresh(request); }
  async applyUpdateIntent(intent: ViewUpdateIntent, reason: RefreshReason): Promise<void> {
    if (!this.desktop) return this.fallback.applyUpdateIntent(intent, reason);
    const visibleKeys = new Set(this.plugin.getSettings().visiblePropertyKeys);
    for (const stream of this.streams.getState().streams) {
      const filter = { ...stream.browse.filter, properties: normalizePropertyFilterClauses(stream.browse.filter.properties, visibleKeys) };
      const group = stream.browse.group.dimension === "property" && !visibleKeys.has(stream.browse.group.propertyKey ?? "")
        ? { ...stream.browse.group, dimension: "none" as const } : stream.browse.group;
      if (!this.runtimes.has(stream.id)) this.streams.update(stream.id, { browse: { ...stream.browse, filter, group } });
      else this.runtimes.get(stream.id)?.runtime.context.browse?.update({ filter, group });
    }
    await Promise.all([...this.runtimes.values()].map(entry => entry.runtime.applyUpdateIntent(intent, reason)));
    this.fallback.refreshNavigationMetadata(); this.publishStreams();
  }
  setSelectedFile(path: string | null, preserveScope = false): void {
    if (!this.desktop) { this.fallback.setSelectedFile(path, preserveScope); return; }
    this.fallback.setSelectedFile(path, true);
    for (const stream of this.streams.getState().streams) {
      const runtime = this.runtimes.get(stream.id)?.runtime;
      if (runtime) runtime.setSelectedFile(path, preserveScope);
      else if (!preserveScope && !stream.linksPinned && stream.scope.kind === "links" && path) {
        this.streams.update(stream.id, { scope: { ...stream.scope, notePath: path } });
      }
    }
  }
  refreshNavState(): void { if (!this.desktop) { this.fallback.refreshNavState(); return; } this.navLayout.refreshNavState(); this.publishStreams(); }
  refreshNavigationMetadata(): void { this.navigationRuntime.refreshNavigationMetadata(); this.publishStreams(); }
  async transferToSidebar(target: FolderCardView, current: () => boolean): Promise<boolean> { return this.fallback.transferToSidebar(target.fallback, current); }
  registerReadingPosition(bridge: import("./scope-history").ReadingPositionBridge | null): void { this.navigationRuntime.registerReadingPosition(bridge); }
  handleToolbarAction(detail: Parameters<CardStreamRuntime["handleToolbarAction"]>[0]): void { this.navigationRuntime.handleToolbarAction(detail); }
  handleFolderActionRequest(detail: Parameters<CardStreamRuntime["handleFolderActionRequest"]>[0]): void { this.navigationRuntime.handleFolderActionRequest(detail); }
  openNavContextMenu(payload: NavContextMenuPayload): void { this.navigationRuntime.openNavContextMenu(payload); }
  onIncludeSubfoldersChange(detail: { value?: unknown }): Promise<void> { return this.navigationRuntime.onIncludeSubfoldersChange(detail); }
  onCardHoverLink(detail: Parameters<CardStreamRuntime["onCardHoverLink"]>[0]): void { this.navigationRuntime.onCardHoverLink(detail); }
  resolveCardLocation(path: string) { return this.navigationRuntime.resolveCardLocation(path); }
  resolveSearchSnippetLocation(path: string, id: string) { return this.navigationRuntime.resolveSearchSnippetLocation(path, id); }
  changeSearchSnippets(path: string, command: "expand" | "more" | "collapse") { return this.navigationRuntime.changeSearchSnippets(path, command); }
  getRuntimeDiagnostics(): ReturnType<CardStreamRuntime["getRuntimeDiagnostics"]> & { streams?: { total: number; active: number; transferring: number } } {
    if (!this.desktop) return this.fallback.getRuntimeDiagnostics();
    const diagnostics = this.navigationRuntime.getRuntimeDiagnostics(), resources = this.resources.getDiagnostics();
    return { ...diagnostics, preview: { ...diagnostics.preview, ...resources },
      images: { ...diagnostics.images, objectUrls: [...this.runtimes.values()].reduce((count, entry) => count + entry.runtime.getRuntimeDiagnostics().images.objectUrls, 0) },
      streams: { total: this.streams.getState().streams.length, active: this.runtimes.size, transferring: this.transferring.size } };
  }
  async createStream(choice: StreamSourceChoice): Promise<string | null> {
    if (!this.desktop || this.stopped || this.unsupported || this.stagedTransfer) return null;
    this.legacySeedPending = false; this.readyToLoad = true;
    const snapshot = this.makeSnapshot(choice.scope);
    if (choice.filter) snapshot.browse.filter = choice.filter;
    this.streams.add(snapshot); this.navLayout.returnToCardsViewIfSinglePane();
    await this.ensureRuntime(snapshot.id); return snapshot.id;
  }
  openNewStreamPicker(): void {
    if (this.unsupported) {
      void this.plugin.createCardStreamLeaf(this.leaf).then(async leaf => {
        await leaf.setViewState({ type: FOLDER_CARD_VIEW, active: true });
        await this.app.workspace.revealLeaf(leaf); await leaf.loadIfDeferred?.();
        if (leaf.view instanceof FolderCardView) await leaf.view.waitForForeground();
      }).catch(error => console.warn("[Card Workspace] Recovery pane failed", error));
      return;
    }
    new StreamSourcePicker(this.app, this.plugin, choice => { void this.createStream(choice); }).open();
  }
  handleStreamCommand(id: string, command: StreamCommand, anchor?: HTMLElement): void {
    if (this.transferring.has(id) || this.stopped) return;
    this.legacySeedPending = false;
    this.capture(id);
    const snapshot = this.streams.getState().streams.find(stream => stream.id === id); if (!snapshot) return;
    const labels = getStreamUiStrings(this.plugin.getUiLanguage());
    switch (command) {
      case "show-only": this.streams.showOnly(id); break;
      case "tile": this.streams.select(id); break;
      case "collapse": this.streams.setExpanded(id, false); break;
      case "close": this.sessions.delete(id); this.streams.remove(id); break;
      case "duplicate": {
        const duplicate = { ...snapshot, id: nextStreamId(), title: snapshot.title ? `${snapshot.title} (2)` : null, linksPinned: snapshot.scope.kind === "links" ? true : snapshot.linksPinned };
        this.streams.add(duplicate); break;
      }
      case "rename": new StreamNameModal(this.app, { strings: this.plugin.getUiStrings(), title: labels.rename, name: snapshot.title,
        sourceLabel: this.sourceLabel(snapshot.scope), language: this.plugin.getUiLanguage(), submit: title => { this.streams.update(id, { title }); } }).open(); break;
      case "move-to-pane": case "copy-to-pane": void this.transferStream(id, command === "copy-to-pane"); break;
      case "manage": {
        const menu = new Menu();
        for (const [action, title] of [["show-only", labels.showOnly], ["tile", labels.tile], ["collapse", labels.collapse], ["duplicate", labels.duplicate], ["rename", labels.rename], ["move-to-pane", labels.moveToPane], ["copy-to-pane", labels.copyToPane], ["close", labels.close]] as const) {
          menu.addItem(item => item.setTitle(title).onClick(() => this.handleStreamCommand(id, action)));
        }
        if (anchor) { const rect = anchor.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom }, anchor.ownerDocument); }
        break;
      }
    }
  }
  async transferStream(id: string, copy = false): Promise<boolean> {
    if (!this.desktop || this.stopped || this.transferring.has(id)) return false;
    this.capture(id); const original = this.streams.getState().streams.find(stream => stream.id === id); if (!original) return false;
    this.transferring.add(id); this.publishStreams();
    let leaf: WorkspaceLeaf | null = null;
    let createdTarget: FolderCardView | null = null;
    const sourceEpoch = this.leafStateEpoch;
    let targetToken: StreamSnapshot | null = null;
    try {
      const runtime = this.runtimes.get(id)?.runtime;
      runtime?.endTransientInteractions();
      const selection = runtime?.captureSelection() ?? this.sessions.get(id);
      const snapshot = copy ? { ...original, id: nextStreamId(), linksPinned: original.scope.kind === "links" ? true : original.linksPinned } : original;
      const targetLeaf = await this.plugin.createCardStreamLeaf(this.leaf);
      leaf = targetLeaf;
      await targetLeaf.setViewState({ type: FOLDER_CARD_VIEW, state: { version: 1, streams: [], currentStreamId: null, direction: "horizontal", navigation: this.navigationState } });
      await targetLeaf.loadIfDeferred?.();
      const target = targetLeaf.view;
      if (!(target instanceof FolderCardView) || target.stopped || this.stopped || !this.streams.getState().streams.some(stream => stream.id === id)) throw new Error("Stream transfer cancelled");
      createdTarget = target;
      const targetEpoch = target.leafStateEpoch;
      target.restoring = true;
      targetToken = { ...snapshot, desiredExpanded: true };
      target.stagedTransfer = targetToken;
      const transferred = await target.ensureRuntime(snapshot.id);
      if (!transferred || target.stopped || this.stopped || !validateScope(this.app, snapshot.scope, this.plugin.getSettings().boxes)) throw new Error("Stream transfer failed");
      if (!copy && selection) transferred.restoreSelection(selection);
      await this.app.workspace.revealLeaf(targetLeaf); this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
      if (target.stopped || this.stopped || sourceEpoch !== this.leafStateEpoch || targetEpoch !== target.leafStateEpoch
        || target.stagedTransfer !== targetToken || target.runtimes.get(snapshot.id)?.runtime !== transferred
        || (runtime && this.runtimes.get(id)?.runtime !== runtime)) throw new Error("Stream transfer cancelled");
      this.capture(id);
      const latest = this.streams.getState().streams.find(stream => stream.id === id);
      const signature = (value: StreamSnapshot): string => JSON.stringify([value.scope, value.browse, value.query, value.searchOpen, value.linksPinned, value.taskFilters, value.collapsedGroups]);
      if (!latest || signature(latest) !== signature(original)) throw new Error("Source browsing changed during transfer");
      // The staged target is excluded from getState until both ownership changes commit.
      target.streams.add(transferred.captureSnapshot({ ...snapshot, desiredExpanded: true }));
      if (!copy) { this.sessions.delete(id); this.streams.remove(id, false); }
      target.stagedTransfer = null; target.restoring = false; target.readyToLoad = true; target.restored = true; target.syncStreams();
      this.transferring.delete(id); this.syncStreams(); target.requestSave(); this.requestSave();
      return true;
    } catch (error) {
      if (leaf && (createdTarget ? leaf.view === createdTarget && createdTarget.stagedTransfer === targetToken
        : [FOLDER_CARD_VIEW, "empty"].includes(leaf.view.getViewType?.()))) leaf.detach();
      new Notice(this.plugin.getUiLanguage() === "zh" ? "移动卡片流失败，原卡片流已保留。" : "Unable to transfer the stream. The original stream is preserved.");
      console.warn("[Card Workspace] Stream transfer failed", error); return false;
    } finally { this.transferring.delete(id); this.syncStreams(); }
  }
  private appendNewStreamMenu(menu: Menu, payload: NavContextMenuPayload): boolean {
    const label = this.plugin.getUiLanguage() === "zh" ? "在新卡片流中打开" : "Open in a new card stream";
    if (payload.scope !== "item" || !["folders", "tags", "properties", "boxes", "links", "favorites"].includes(payload.section)) return false;
    menu.addItem(item => item.setTitle(label).setIcon("panels-top-left").onClick(() => { this.openNavigationSource(payload as import("./navigation-model").NavigationMenuTarget); })); return true;
  }
  private openNavigationSource(payload: import("./navigation-model").NavigationMenuTarget): boolean {
    if (payload.scope !== "item") return false;
    const root = createFolderScope("", true); let choice: StreamSourceChoice | null = null;
    if (payload.section === "folders" && typeof payload.itemId === "string") choice = { scope: createFolderScope(payload.itemId, this.plugin.getSettings().includeSubfolders) };
    else if (payload.section === "boxes" && typeof payload.itemId === "string") choice = { scope: { kind: "box", boxId: payload.itemId } };
    else if (payload.section === "tags" && typeof payload.itemId === "string") choice = { scope: root, filter: { tags: [payload.itemId], properties: [] } };
    else if (payload.section === "links" && (payload.itemId === "backlinks" || payload.itemId === "outgoing")) {
      const active = this.app.workspace.getActiveFile(); if (active) choice = { scope: createLinksScope(active.path, payload.itemId) };
    } else if (payload.section === "properties") {
      if (payload.itemId && payload.value) choice = { scope: root, filter: { tags: [], properties: [{ key: payload.itemId, values: [payload.value] }] } };
    } else if (payload.section === "favorites" && payload.favorite) {
      const favorite = payload.favorite;
      if (favorite.kind === "folder") choice = { scope: createFolderScope(favorite.ref, this.plugin.getSettings().includeSubfolders) };
      else if (favorite.kind === "box") choice = { scope: { kind: "box", boxId: favorite.ref } };
      else if (favorite.kind === "tag") choice = { scope: root, filter: { tags: [favorite.ref], properties: [] } };
    }
    if (!choice) return false;
    void this.createStream(choice); return true;
  }
  private handleNavigationVaultMutation(event: VaultMutationEvent): void {
    if (event.eventType === "rename" && event.isFolder && event.oldPath) {
      const rewrite = (path: string): string => rewritePathAfterRename(path, event.oldPath!, event.path);
      this.navigationState = { ...this.navigationState, expandedFolderPaths: this.navigationState.expandedFolderPaths.map(rewrite) };
      this.navLayout.rewriteFolderIdentity(rewrite);
    }
    if (event.isFolder) this.navLayout.refreshFolderTreeState();
    else if (event.eventType !== "modify") this.navLayout.scheduleFolderTreeRefresh();
    this.navLayout.scheduleNavCountRefresh();
  }
  private reconcileSnapshots(event: VaultMutationEvent): void {
    if (event.eventType !== "rename" || !event.oldPath) return;
    this.streams.mapSnapshots(stream => {
      const scope = stream.scope.kind === "box" ? stream.scope : stream.scope.kind === "folder"
        ? { ...stream.scope, path: rewritePathAfterRename(stream.scope.path, event.oldPath!, event.path) }
        : { ...stream.scope, notePath: rewritePathAfterRename(stream.scope.notePath, event.oldPath!, event.path) };
      const anchor = stream.anchor?.ref.kind === "card" ? { ...stream.anchor, ref: { ...stream.anchor.ref,
        path: rewritePathAfterRename(stream.anchor.ref.path, event.oldPath!, event.path) } } : stream.anchor;
      return { ...stream, scope, anchor };
    });
    for (const [id, selection] of this.sessions) this.sessions.set(id, { ...selection,
      paths: selection.paths.map(path => rewritePathAfterRename(path, event.oldPath!, event.path)) });
  }
}
