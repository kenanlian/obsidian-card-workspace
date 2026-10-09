import { ItemView, Notice, TFolder, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import { CARD_WORKSPACE_ICON } from "../icons";
import type { UiStrings } from "../i18n";
import type { OpenDestination, PartialPluginSettings } from "../settings";
import { resolveLinkCardLocation, type CardOpenLocation } from "./link-card-location";
import type CardWorkspacePlugin from "../main";
import {
  createFolderScope,
  isBoxScope, isLinksScope,
  normalizeScopePath,
  resolveNewNoteFolderPath as folderPathForNewNote,
  resolveScopeFolderPath,
  scopeDisplayPath,
  scopeIdentity,
  type CardScope,
} from "./scope";
import { resolveSourceCapabilities } from "./source-capabilities";
import type { ViewUpdateIntent } from "./update-intent";
import { resolveViewConfig } from "./view-config";
import { createViewEpochs, type ViewEpochs } from "./view-epochs";
import type { ViewContext } from "./view-context";
import { createViewModules, type ViewModules } from "./view-modules";
import type { MetadataImpactBatch } from "./controllers/MetadataImpactController";
import { resolveEmptyStateMessage } from "./empty-state";
import { createViewStateStore, type ViewStateStore } from "./view-state-store";
import { resolveLinksFollowScope } from "./links-sources";
import { rewritePathAfterRename } from "./scope-files";
import type { NavigationIntent } from "./navigation-model";
import {
  buildNavigationPanelState,
  isCurrentNavigationMenuTarget,
  openNavigationContextMenu,
  publishLoadStart,
  publishPreparedCards,
  publishSettledScope,
  routeNavigationIntent,
  type LoadBoundaryHost,
} from "./navigation-host";
import { buildCardsPanelGroup, buildProjectionPanelGroup } from "./panel-group-state";
import { buildNavMenuDeps as buildNavMenuDepsFor } from "./menus/nav-menu-deps";
import {
  PANEL_GROUPS, buildLinksScopeGroupFields, resolveBrowseFiltersPaused,
  createPanelModel,
  type PanelGroup,
  type PanelModel,
  type PanelModelState,
} from "./panel-model";
import { buildPanelProps } from "./panel-props";
import type { CardHoverLinkPayload, CleanupResult, FolderActionPayload, FolderSelectionRequest, NavContextMenuPayload,
  NoteCardRecord, RefreshReason, RefreshRequest, RefreshResult, SelectionResult, VaultMutationEvent, VaultMutationResult } from "./types";

export const FOLDER_CARD_VIEW = "folder-card-view";

export class FolderCardView extends ItemView {
  plugin: CardWorkspacePlugin;
  private component: ReturnType<typeof mount> | null = null;
  private hostEl: HTMLElement | null = null; private viewEventUnsubscribe: (() => void) | null = null;
  private metadataEventUnsubscribe: (() => void) | null = null;
  private suppressScopeProjectionPatch = false;
  readonly panelModel: PanelModel;

  private readonly store: ViewStateStore = createViewStateStore(createFolderScope("", true));
  private readonly epochs: ViewEpochs = createViewEpochs();
  private readonly context: ViewContext; readonly modules: ViewModules;

  constructor(leaf: WorkspaceLeaf, plugin: CardWorkspacePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.context = {
      getApp: () => this.app, store: this.store, epochs: this.epochs,
      getSettings: () => this.plugin.getSettings(), saveSettings: (patch) => this.saveViewSettings(patch),
      getUiStrings: () => this.plugin.getUiStrings(), publishGroups: (...groups) => this.publishGroups(...groups),
      requestUpdate: (intent, reason) => this.applyUpdateIntent(intent, reason),
      notify: (message) => { new Notice(message); }, getViewWindow: () => this.getViewWindow(),
    };
    this.modules = createViewModules(this.context, {
      getThumbnailService: () => this.plugin.getThumbnailService?.() ?? null,
      effectiveSortAndPins: () => {
        const { sort, pinnedPaths } = resolveViewConfig(this.store.getScope(), this.plugin.getSettings());
        return { sortField: sort.field, sortDirection: sort.direction, pinnedPaths };
      },
      getDisplayFolderPath: () => this.getDisplayFolderPath(),
      getTooltipSide: () => this.resolveTooltipSide(),
      openCardWithDestination: (path, destination) => this.openCardWithDestination(path, destination),
      selectFolderFromNav: (path) => this.selectFolderFromNav(path),
      moveScopeToFolder: (path) => this.modules.scopeController.moveScopeToFolder(path),
      bumpSearchFocusToken: () => this.modules.search.bumpFocusToken(),
      publishAll: () => this.publishGroups(...PANEL_GROUPS),
      publishSearch: () => {
        if (!this.modules.scopeController.isScopeSettled()) return;
        this.modules.projection.reprojectCards();
        this.modules.bulk.reconcileToVisibleCards();
        // "projection" is in the set because pausing or resuming search moves
        // `groupSegmentCount`, which the toolbar reads to enable collapse-all.
        this.publishGroups("search", "cards", "bulk", "scope", "projection");
      },
      publishSelection: () => this.publishGroups("bulk", "cards"),
      publishHydration: () => this.publishGroups("cards"),
      publishLoadStart: (scopeChanged) => publishLoadStart(this.buildLoadBoundaryHost(), scopeChanged),
      publishPreparedCards: () => publishPreparedCards(this.buildLoadBoundaryHost()),
      publishSettledScope: () => publishSettledScope(this.buildLoadBoundaryHost()),
      publishGroups: (...groups) => this.publishGroups(...groups),
      publishImpactBatch: (batch) => this.publishImpactBatch(batch),
      openNoteFromCard: (path, destination) => this.plugin.openNoteFromCard(path, destination),
      createNoteInFolder: (folderPath, tags) => this.plugin.createNoteInFolder(folderPath, tags),
      getSearchService: () => this.plugin.getSearchService(),
      getSearchSnapshot: () => this.plugin.getSearchSnapshot(),
      subscribeSearchSnapshots: (listener) => this.plugin.subscribeSearchSnapshots(listener),
    });
    this.panelModel = createPanelModel({
      strings: this.strings,
      scope: this.buildScopeGroup(),
      cards: this.buildCardsGroup(),
      search: this.buildSearchGroup(),
      projection: this.buildProjectionGroup(),
      bulk: this.buildBulkGroup(),
      nav: this.buildNavGroup(),
      appearance: this.buildAppearanceGroup(),
      images: this.modules.images.getPanelState(),
    });
  }
  private get cardScope(): CardScope { return this.store.getScope(); } private set cardScope(scope: CardScope) { this.store.setScope(scope); }
  private get baseCards(): NoteCardRecord[] { return this.store.getBaseCards() as NoteCardRecord[]; } private set baseCards(cards: NoteCardRecord[]) { this.store.replaceBaseCards(cards); }
  private get visibleCards(): NoteCardRecord[] { return this.store.getVisibleCards() as NoteCardRecord[]; } private set visibleCards(cards: NoteCardRecord[]) { this.store.replaceVisibleCards(cards); }
  private get selectedPath(): string | null { return this.store.getSelectedPath(); } private set selectedPath(path: string | null) { this.store.setSelectedPath(path); }
  getViewType(): string { return FOLDER_CARD_VIEW; }
  getDisplayText(): string { return this.strings.view.displayName; }
  getIcon(): string { return CARD_WORKSPACE_ICON; }
  private get strings(): UiStrings {
    return this.plugin.getUiStrings();
  }
  private saveViewSettings(patch: PartialPluginSettings): Promise<void> {
    const scopeOnly = Object.keys(patch).every((key) => key === "lastFolderPath" || key === "activeBoxId");
    if (!scopeOnly) return this.plugin.saveSettings(patch);
    this.suppressScopeProjectionPatch = true; try { return this.plugin.saveSettings(patch); }
    finally { this.suppressScopeProjectionPatch = false; }
  }
  private resolveTooltipSide(): "left" | "right" {
    const root = this.leaf.getRoot();
    return root === this.app.workspace.leftSplit ? "right" : "left";
  }
  private buildEmptyStateMessage(): string {
    const settings = this.plugin.getSettings();
    const capabilities = resolveSourceCapabilities(this.cardScope);
    return resolveEmptyStateMessage({
      strings: this.strings, query: this.modules.search.getQuery().trim(),
      // Dormant filters never narrow a non-folder scope, so they must not shape its copy.
      activeTagCount: capabilities.browseTagFilter ? settings.filter.tags.length : 0,
      baseCardCount: this.baseCards.length,
      visibleCardCount: this.visibleCards.length,
      propertyClauseCount: capabilities.browsePropertyFilter ? settings.filter.properties.length : 0,
      emptyBaseMessage: isLinksScope(this.cardScope) ? this.strings.links.emptyLinks : undefined,
    });
  }
  private openCardWithDestination(path: string, destination: OpenDestination): void {
    const location = this.resolveCardLocation(path);
    if (location) void this.plugin.openNoteFromCard(path, destination, location);
    else void this.plugin.openNoteFromCard(path, destination);
  }

  resolveCardLocation(path: string): CardOpenLocation | null {
    const scope = this.store.getScope();
    if (!this.plugin.getSettings().locateLinkCardOnOpen || scope.kind !== "links"
      || !this.store.getBaseCard(path)) return null;
    const query = this.modules.search.getCommittedQuery().trim();
    if (query) return { query };
    return resolveLinkCardLocation(this.app, scope, path);
  }
  resolveSearchSnippetLocation(path: string, snippetId: string): CardOpenLocation | null {
    const card = this.store.getBaseCard(path);
    const preview = card?.searchPreview;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!card || !preview || file !== card.file || !this.component
      || !this.modules.search.isCommittedQueryCurrent()
      || this.modules.search.getCommittedQuery().trim() !== preview.query
      || this.modules.search.getContentRevision() !== preview.revision
      || this.plugin.getSettings().previewLines !== preview.previewLines
      || this.plugin.getSettings().searchPreviewSnippetCount !== preview.snippetLimit
      || (card.file.stat?.mtime ?? card.mtime) !== preview.mtime) return null;
    const snippet = preview.snippets.find((entry) => entry.id === snippetId);
    if (!snippet) return null;
    const { query, revision, previewLines, snippetLimit, mtime } = preview;
    const selectionVersion = this.modules.scopeController.getActiveSelectionVersion();
    const fileVersion = this.modules.hydration.getFileRevision(card.file);
    const size = card.file.stat?.size;
    const pathAtClick = card.file.path;
    const isCurrent = (): boolean => this.component !== null
      && this.modules.search.isCommittedQueryCurrent()
      && this.modules.search.getCommittedQuery().trim() === query
      && this.modules.search.getContentRevision() === revision
      && this.modules.hydration.getFileRevision(card.file) === fileVersion
      && this.modules.scopeController.getActiveSelectionVersion() === selectionVersion
      && this.plugin.getSettings().previewLines === previewLines
      && this.plugin.getSettings().searchPreviewSnippetCount === snippetLimit
      && this.app.vault.getAbstractFileByPath(pathAtClick) === file
      && card.file.path === pathAtClick
      && card.file.stat?.size === size
      && (card.file.stat?.mtime ?? card.mtime) === mtime;
    return { kind: "search-snippet", snippet: {
      ...snippet.location, from: { ...snippet.location.from }, to: { ...snippet.location.to },
    }, isCurrent };
  }

  async onOpen(): Promise<void> {
    const FolderCardPanel = (await import("./FolderCardPanel.svelte")).default;
    this.modules.search.initializeSnapshotState();
    this.publishGroups(...PANEL_GROUPS);

    const target = (this.containerEl.children[1] as HTMLElement) ?? this.containerEl;
    target.empty();

    this.hostEl = target.createDiv({ cls: "folder-card-view" });
    this.component = mount(FolderCardPanel, {
      target: this.hostEl,
      props: buildPanelProps(this),
    });

    this.modules.navLayout.refreshFolderTreeState();
    this.modules.hydration.hydrateVisibleCardsOnOpen();
    this.viewEventUnsubscribe?.();
    this.viewEventUnsubscribe = this.plugin.subscribeVaultEvents((event) => {
      const result = this.handleVaultMutation(event);
      if (result.shouldRefresh) {
        this.modules.scopeController.scheduleVaultRefresh();
      }
    });
    this.metadataEventUnsubscribe?.();
    this.metadataEventUnsubscribe = this.plugin.subscribeMetadataEvents((event) => {
      if (event.kind === "resolved") {
        this.modules.metadataImpact.handleMetadataResolved();
        if (isLinksScope(this.cardScope)) this.modules.scopeController.scheduleVaultRefresh();
        return Promise.resolve();
      }
      return this.modules.metadataImpact.handleMetadataChange(event.path);
    });
  }

  async onClose(): Promise<void> {
    this.cleanupLifecycle();

    if (this.component) {
      await unmount(this.component);
    }

    this.component = null;
    this.hostEl = null;
  }

  handleToolbarAction(detail: { action?: unknown }): void {
    const action = detail.action;

    if (action === "new-note") {
      void this.plugin.createNoteInFolder(this.resolveNewNoteFolderPath()).catch((error: unknown) => {
        new Notice(this.modules.folderActions.getFolderManagementStrings().createFileFailed(String(error)));
      });
      return;
    }

    if (action === "bulk") {
      this.modules.bulk.toggleBulkMode();
      return;
    }

    if (action === "bulk-select-all") {
      this.modules.bulk.bulkSelectAll();
      return;
    }

    if (action === "bulk-clear-selection") {
      this.modules.bulk.bulkClearSelection();
      return;
    }

    if (action === "bulk-move-selected") {
      this.modules.mergeActions.bulkMoveSelected();
      return;
    }

    if (action === "bulk-add-tag-selected") {
      this.modules.tagActions.bulkAddTagSelected();
      return;
    }

    if (action === "bulk-remove-tag-selected") {
      this.modules.tagActions.bulkRemoveTagSelected();
      return;
    }

    if (action === "bulk-delete-selected") {
      void this.modules.mergeActions.bulkDeleteSelected();
      return;
    }

    if (action === "bulk-merge-selected") {
      this.modules.mergeActions.bulkMergeSelected();
      return;
    }

    if (action === "bulk-add-to-box") {
      this.modules.boxActions.bulkAddToBox();
      return;
    }

    if (action === "bulk-remove-from-box") {
      void this.modules.boxActions.bulkRemoveFromBox();
    }

    if (typeof action === "string" && this.modules.linksActions.handleToolbarCommand(action)) return;
  }

  handleFolderActionRequest(detail: FolderActionPayload): void {
    if (typeof detail.path !== "string") {
      return;
    }

    if (detail.action === "create-child-folder") {
      void this.modules.folderActions.createFromFolderTree(detail.path, "folder");
    }
  }

  async setFolder(folder: TFolder): Promise<SelectionResult> {
    const scope = createFolderScope(folder.path, this.plugin.getSettings().includeSubfolders);
    return this.modules.scopeController.handleScopeSelection(
      this.modules.scopeController.createProgrammaticSelectionRequest(scope, false),
    );
  }

  async handleScopeSelection(request: FolderSelectionRequest): Promise<SelectionResult> {
    return this.modules.scopeController.handleScopeSelection(request);
  }

  async refresh(request: RefreshRequest = { reason: "manual" }): Promise<RefreshResult> {
    return this.modules.scopeController.refresh(request);
  }

  getCardScope(): CardScope { return this.cardScope; }
  hasLoadedScope(): boolean { return this.modules.scopeController.getLoadKey() !== null; }
  /**
   * Applies the weakest update that still reflects a change. Only `"reload"`
   * re-collects files; the weaker tiers keep scroll position and loaded previews.
   */
  async applyUpdateIntent(intent: ViewUpdateIntent, reason: RefreshReason): Promise<void> {
    this.modules.images.onSettingsChanged();
    const effective = !this.modules.scopeController.isScopeSettled() && (intent === "reproject" || intent === "rehydrate") ? "reload" : intent;
    switch (effective) {
      case "reload":
        await this.refresh({ reason, forceRefresh: true });
        return;
      case "rehydrate":
        this.modules.hydration.clearPreviewCache();
        this.modules.hydration.resetForLoad();
        this.store.advanceHydrationRevision();
        this.baseCards = this.baseCards.map((card) => ({
          ...card, hydrated: false, previewHtml: "", previewMode: "empty", searchPreview: undefined, linkPreview: undefined,
        }));
        this.projectVisibleCards();
        this.publishForIntent(intent);
        return;
      case "reproject":
        this.modules.arrangementActions.sortAndReprojectCards();
        this.publishForIntent(intent);
        return;
      case "patch":
        if (this.suppressScopeProjectionPatch) return;
        this.publishForIntent(intent);
        return;
    }
  }

  /** Reprojects visible cards and reconciles bulk selection; never re-collects files. */
  private projectVisibleCards(): void {
    this.modules.projection.reprojectCards();
    this.modules.bulk.reconcileToVisibleCards();
  }

  handleVaultMutation(event: VaultMutationEvent): VaultMutationResult {
    this.modules.images.handleVaultMutation(event);
    if (event.eventType === "rename" && event.isFolder && event.oldPath) {
      this.modules.navLayout.rewriteFolderIdentity((path) =>
        rewritePathAfterRename(path, event.oldPath ?? "", event.path));
    }
    return this.modules.scopeController.handleVaultMutation(event);
  }

  /**
   * The one coherent immediate publication for a metadata event.
   *
   * Navigation is derived from the exact fresh projection snapshot built for
   * this batch — never from the previously published projection — so tag
   * sources/counts, facets, and the card projection cannot disagree inside a
   * single notification.
   */
  private publishImpactBatch(batch: MetadataImpactBatch): void {
    const projectionGroup = this.buildProjectionGroup();
    const boxSummaries = this.modules.boxActions.buildBoxSummaries();
    const navGroup = this.projectNavGroup(
      this.modules.navLayout.getFolderTree(),
      this.modules.favoriteActions.buildFavoriteRowModels({ boxSummaries }),
      boxSummaries,
      projectionGroup,
    );
    this.panelModel.batch((state) => {
      if (batch.kind === "reprojected") {
        state.scope = this.buildScopeGroup();
        state.cards = this.buildCardsGroup();
        state.bulk = this.buildBulkGroup();
        if (batch.includeSearch) {
          state.search = this.buildSearchGroup();
        }
      } else if (batch.includeCards) {
        state.cards = this.buildCardsGroup();
      }
      state.projection = projectionGroup;
      state.nav = navGroup;
    });
  }

  /** Re-push nav-derived state after the plugin reconciled boxes/favorites outside the view. */
  refreshNavState(): void {
    this.modules.navLayout.refreshNavState();
  }

  cleanupLifecycle(): CleanupResult {
    this.viewEventUnsubscribe?.();
    this.viewEventUnsubscribe = null;
    this.metadataEventUnsubscribe?.();
    this.metadataEventUnsubscribe = null;
    const scopeReport = this.modules.scopeController.dispose();
    const navLayoutReport = this.modules.navLayout.dispose();
    this.modules.bulk.dispose();
    const searchReport = this.modules.search.dispose();
    const hydrationReport = this.modules.hydration.dispose();
    this.modules.metadataImpact.dispose();
    this.modules.images.dispose();
    this.modules.groupCollapse.dispose();
    this.modules.property.dispose();

    return {
      cancelledDebounce:
        (searchReport.cancelledDebounce ?? false)
        || (navLayoutReport.cancelledDebounce ?? false)
        || (scopeReport.cancelledDebounce ?? false)
        || (hydrationReport.cancelledDebounce ?? false),
      clearedQueuedRequest: scopeReport.clearedQueuedRequest ?? false,
      clearedPendingHydration: hydrationReport.clearedPendingHydration ?? false,
    };
  }

  setSelectedFile(path: string | null): void {
    if (this.selectedPath === path) {
      return;
    }

    this.selectedPath = path;
    const next = resolveLinksFollowScope(this.cardScope, path, this.store.getLinksPinned());
    if (next) {
      void this.modules.scopeController.handleScopeSelection(
        this.modules.scopeController.createProgrammaticSelectionRequest(next, false, "links-follow"),
      );
    }
    this.publishGroups("cards", "bulk", "nav");
  }

  getCurrentFolderPath(): string | null {
    return resolveScopeFolderPath(this.cardScope);
  }

  /**
   * C5: toolbar new-note resolves its folder from this view's runtime scope.
   * Folder uses `cardScope.path` (including `""` for Vault root). Box and links
   * keep the persisted `lastFolderPath` fallback and do not switch scope or auto-add.
   */
  private resolveNewNoteFolderPath(): string {
    return folderPathForNewNote(this.cardScope, this.plugin.getSettings().lastFolderPath);
  }

  openNavContextMenu(payload: NavContextMenuPayload): void {
    const targetCurrent = isCurrentNavigationMenuTarget({
      payload,
      settings: this.plugin.getSettings(),
      navLayout: this.modules.navLayout,
      resolveFolder: (path) => this.modules.folderActions.resolveFolderFromUiPath(path),
    });
    openNavigationContextMenu({
      payload, disposed: this.modules.navLayout.isDisposed(), targetCurrent,
      deps: buildNavMenuDepsFor({
        context: this.context, modules: this.modules,
        onIncludeSubfoldersChange: (detail) => this.onIncludeSubfoldersChange(detail),
      }),
      restoreFocus: (originId) => this.modules.navLayout.restoreFocus(originId),
    });
  }

  handleNavigationIntent(intent: NavigationIntent): void {
    routeNavigationIntent({
      intent, navLayout: this.modules.navLayout, scope: this.cardScope,
      activeTags: this.plugin.getSettings().filter.tags,
      selectFolder: (path) => { void this.selectFolderFromNav(path); },
      switchBox: (boxId) => this.modules.boxActions.handleBoxCommand({ command: "switch", boxId }),
      applyTagFilter: (tags) => { void this.modules.tagActions.applyTagFilter(tags); },
      activateFavorite: (favorite) => this.modules.favoriteActions.handleFavoriteActivate({ favorite }),
      selectPropertyValue: (key, ref, additive) => void this.modules.propertyActions.applyValueFilter(key, ref, additive),
      selectLinksDirection: (direction) => this.modules.linksActions.enterOrSwitchLinks(direction),
      moveFolder: (sourcePath, targetFolderPath) => void this.modules.folderActions.moveFolderTo(sourcePath, targetFolderPath),
      reorderFavorites: (source, target, position) => void this.modules.favoriteActions.reorderFavoriteEntries(source, target, position),
    });
  }

  private getViewWindow(): Pick<Window, "setTimeout" | "clearTimeout"> {
    return this.hostEl?.ownerDocument?.defaultView
      ?? (typeof activeWindow !== "undefined" ? activeWindow : window);
  }

  private getDisplayFolderPath(): string {
    const path = scopeDisplayPath(this.cardScope);
    return path === "" ? "/" : path;
  }
  private buildScopeGroup(): PanelModelState["scope"] {
    const settings = this.plugin.getSettings();
    const box = this.modules.boxActions.getActiveBox();
    const capabilities = resolveSourceCapabilities(this.cardScope);
    return {
      displayPath: this.getDisplayFolderPath(),
      includeSubfolders: settings.includeSubfolders,
      activeBoxId: isBoxScope(this.cardScope) ? this.cardScope.boxId : null,
      activeBoxName: box?.name ?? null,
      boxExcludedCount: box?.excludedPaths.length ?? 0,
      emptyStateMessage: this.buildEmptyStateMessage(),
      sourceIdentity: scopeIdentity(this.cardScope),
      browseTagFilterEnabled: capabilities.browseTagFilter,
      browsePropertyFilterEnabled: capabilities.browsePropertyFilter,
      browseFiltersPaused: resolveBrowseFiltersPaused(this.cardScope, settings.filter),
      supportsIncludeSubfolders: capabilities.supportsIncludeSubfolders,
      supportsBoxRuleSeeding: capabilities.supportsBoxRuleSeeding,
      ...buildLinksScopeGroupFields(this.cardScope, this.store, this.strings),
    };
  }

  private buildCardsGroup(): PanelModelState["cards"] {
    const scope = this.modules.scopeController;
    return buildCardsPanelGroup({
      records: this.visibleCards, searchMatchCountsByPath: this.modules.search.getMatchCountsByPath(),
      selectedPath: this.selectedPath, loading: scope.isLoading(), generation: this.epochs.load.value,
      sequenceRevision: this.store.getVisibleSequenceRevision(), hydrationRevision: this.store.getHydrationRevision(),
      groupSegments: this.modules.projection.getGroupSegments(), groupRevision: this.modules.projection.getGroupRevision(),
    });
  }

  private buildSearchGroup(): PanelModelState["search"] {
    return {
      history: this.plugin.getSettings().searchHistory,
      query: this.modules.search.getQuery(), committedQuery: this.modules.search.getCommittedQuery(),
      status: this.modules.search.getStatus(),
      readiness: this.modules.search.getSnapshot()?.health?.readiness,
      persistence: this.modules.search.getSnapshot()?.health?.persistence,
      rebuildReason: this.modules.search.getSnapshot()?.health?.rebuildReason ?? null,
      focusToken: this.modules.search.getFocusToken(),
    };
  }

  private buildProjectionGroup(): PanelModelState["projection"] {
    const settings = this.plugin.getSettings(); const scope = this.store.getScope();
    const { sort, pinnedPaths, group } = resolveViewConfig(scope, settings);
    const projection = this.modules.projection;
    return buildProjectionPanelGroup({
      sortField: sort.field, sortDirection: sort.direction,
      deriveAvailableTags: () => projection.deriveAvailableTags(), deriveTagCounts: () => projection.deriveTagCounts(),
      activeFilterTags: settings.filter.tags, pinnedPaths, group,
      availableGroupDimensions: [...resolveSourceCapabilities(scope).groupDimensions],
      groupSegmentCount: projection.getGroupSegments().length,
    });
  }

  private buildBulkGroup(): PanelModelState["bulk"] {
    return this.modules.bulk.buildPanelState();
  }

  private buildNavGroup(): PanelModelState["nav"] {
    const boxSummaries = this.modules.boxActions.buildBoxSummaries(); const folderTree = this.modules.navLayout.getFolderTree();
    const favorites = this.modules.favoriteActions.buildFavoriteRowModels({ boxSummaries });
    // Navigation-only republishes reuse published Tag sources/counts, staying off the card projection path.
    const projectionGroup = this.panelModel?.getState().projection ?? this.buildProjectionGroup();
    return this.projectNavGroup(folderTree, favorites, boxSummaries, projectionGroup);
  }
  private projectNavGroup(folderTree: PanelModelState["nav"]["folderTree"], favorites: PanelModelState["nav"]["favorites"],
    boxSummaries: PanelModelState["nav"]["boxSummaries"], projectionGroup: PanelModelState["projection"]): PanelModelState["nav"] {
    return buildNavigationPanelState({
      settings: this.plugin.getSettings(), strings: this.strings, scope: this.cardScope, selectedPath: this.selectedPath,
      folderTree, favorites, boxSummaries, cardProjection: projectionGroup, navLayout: this.modules.navLayout, tooltipSide: this.modules.navLayout.getTooltipSide(),
      propertyFacets: this.modules.property.derivePropertyFacets(),
    });
  }
  private buildImagesGroup(): PanelModelState["images"] { return this.modules.images.getPanelState(); }
  private buildAppearanceGroup(): PanelModelState["appearance"] {
    const settings = this.plugin.getSettings();
    return {
      cardCornerRadius: settings.cardCornerRadius,
      previewLines: settings.previewLines,
      searchPreviewSnippetCount: settings.searchPreviewSnippetCount,
      cardImageMode: settings.cardImageMode,
      cardImageFit: settings.cardImageFit,
    };
  }

  /** Runtime events replace only the requested groups and notify listeners once. */
  private publishGroups(...groups: PanelGroup[]): void {
    if (groups.includes("cards") && this.modules?.images.prepareGeneration() && !groups.includes("images")) groups.push("images");
    if (groups.includes("cards")) this.modules?.images.notifyTextReady();
    const uniqueGroups = new Set(groups);
    this.panelModel.batch((state) => {
      for (const group of uniqueGroups) {
        switch (group) {
          case "strings":
            state.strings = this.strings;
            break;
          case "scope":
            state.scope = this.buildScopeGroup();
            break;
          case "cards":
            state.cards = this.buildCardsGroup();
            break;
          case "search":
            state.search = this.buildSearchGroup();
            break;
          case "projection":
            state.projection = this.buildProjectionGroup();
            break;
          case "bulk":
            state.bulk = this.buildBulkGroup();
            break;
          case "nav":
            state.nav = this.buildNavGroup();
            break;
          case "images":
            state.images = this.buildImagesGroup();
            break;
          case "appearance":
            state.appearance = this.buildAppearanceGroup();
            break;
        }
      }
    });
  }
  private buildLoadBoundaryHost(): LoadBoundaryHost {
    return {
      panelModel: this.panelModel, publishGroups: (...groups) => this.publishGroups(...groups),
      projectNav: (folderTree, favorites, boxSummaries, cardProjection) =>
        this.projectNavGroup(folderTree, favorites, boxSummaries, cardProjection),
      getSettings: () => this.plugin.getSettings(), getScope: () => this.cardScope,
      getSelectedPath: () => this.selectedPath,
    };
  }
  /** Settings changes translate their four update tiers into explicit groups. */
  private publishForIntent(intent: ViewUpdateIntent): void {
    switch (intent) {
      case "patch":
        this.publishGroups("nav", "appearance", "strings", "scope", "search");
        return;
      case "reproject":
      case "rehydrate":
        this.publishGroups("nav", "appearance", "strings", "scope", "search", "cards", "projection", "bulk");
        return;
      case "reload":
        this.publishGroups(...PANEL_GROUPS);
        return;
    }
  }

  async selectFolderFromNav(path: string): Promise<void> {
    this.modules.navLayout.returnToCardsViewIfSinglePane();

    const targetFolderPath = normalizeScopePath(path);
    // Folder-to-folder moves reset filters; box/links kept them dormant, so entering a folder resumes them.
    const currentFolderPath = resolveScopeFolderPath(this.cardScope);
    const leavingFolderScope = currentFolderPath !== null && normalizeScopePath(currentFolderPath) !== targetFolderPath;
    const { tags, properties } = this.plugin.getSettings().filter;

    const patch: PartialPluginSettings = {};
    if (leavingFolderScope && (tags.length > 0 || properties.length > 0)) {
      patch.filter = { tags: [], properties: [] };
    }
    if (Object.keys(patch).length > 0) {
      await this.plugin.saveSettings(patch);
    }

    await this.plugin.selectFolderByPath(path, "panel-picker");
  }

  async onIncludeSubfoldersChange(detail: { value?: unknown }): Promise<void> {
    if (!resolveSourceCapabilities(this.cardScope).supportsIncludeSubfolders) {
      return;
    }
    this.modules.navLayout.returnToCardsViewIfSinglePane();
    if (typeof detail.value !== "boolean") {
      return;
    }

    if (this.plugin.getSettings().includeSubfolders === detail.value) {
      return;
    }

    await this.plugin.saveSettings({
      includeSubfolders: detail.value,
    });
  }

  onCardHoverLink(detail: CardHoverLinkPayload): void {
    this.app.workspace.trigger("hover-link", {
      event: detail.mouseEvent,
      source: "card-workspace",
      hoverParent: this,
      targetEl: detail.targetEl,
      linktext: detail.path,
    });
  }
}
