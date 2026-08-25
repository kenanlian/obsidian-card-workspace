import { ItemView, Menu, Notice, TFolder, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import { CARD_WORKSPACE_ICON } from "../icons";
import type { UiStrings } from "../i18n";
import type { OpenDestination, PartialPluginSettings, SortDirection, SortField } from "../settings";
import type CardWorkspacePlugin from "../main";
import { compareCards } from "./card-sort";
import { findCardBox } from "./card-boxes";
import { getMenuDom } from "./menu-dom";
import { buildNavContextMenu, resolveNavMenuDangerLabel } from "./nav-context-menu";
import { createFolderScope, isBoxScope, isFolderScope, normalizeScopePath, scopeDisplayPath, type CardScope } from "./scope";
import type { ViewUpdateIntent } from "./update-intent";
import { createViewEpochs, type ViewEpochs } from "./view-epochs";
import type { ViewContext } from "./view-context";
import { createViewModules, type ViewModules } from "./view-modules";
import { createViewStateStore, type ViewStateStore } from "./view-state-store";
import { remapFavoriteSelection } from "./actions/favorite-actions";
import { buildNavMenuDeps as buildNavMenuDepsFor } from "./menus/nav-menu-deps";
import { decorateCardContextMenu, isMouseEventLike } from "./menus/card-context-menu";
import {
  PANEL_GROUPS,
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
      effectiveSortAndPins: () => {
        const settings = this.plugin.getSettings();
        const scope = this.store.getScope();
        const box = isBoxScope(scope) ? findCardBox(settings.boxes ?? [], scope.boxId) : null;
        return box
          ? { sortField: box.sort.field, sortDirection: box.sort.direction, pinnedPaths: box.pinnedPaths }
          : { sortField: settings.sort.field, sortDirection: settings.sort.direction, pinnedPaths: settings.pinnedPaths };
      },
      getDisplayFolderPath: () => this.getDisplayFolderPath(),
      getTooltipSide: () => this.resolveTooltipSide(),
      openCardWithDestination: (path, destination) => this.openCardWithDestination(path, destination),
      selectFolderFromNav: (path) => this.selectFolderFromNav(path),
      moveScopeToFolder: (path) => this.modules.scopeController.moveScopeToFolder(path),
      bumpSearchFocusToken: () => this.modules.search.bumpFocusToken(),
      publishAll: () => this.publishGroups(...PANEL_GROUPS),
      publishSearch: () => {
        this.modules.projection.reprojectCards();
        this.modules.bulk.reconcileToVisibleCards();
        this.publishGroups("search", "cards", "bulk", "scope");
      },
      publishSelection: () => this.publishGroups("bulk", "cards"),
      publishHydration: () => this.publishGroups("cards"),
      publishLoadStart: (scopeChanged) => this.publishLoadStart(scopeChanged),
      publishLoadCommit: () => this.publishGroups("cards", "search", "projection", "bulk"),
      publishGroups: (...groups) => this.publishGroups(...groups),
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
    });
  }
  private get cardScope(): CardScope { return this.store.getScope(); } private set cardScope(scope: CardScope) { this.store.setScope(scope); }
  private get baseCards(): NoteCardRecord[] { return this.store.getBaseCards() as NoteCardRecord[]; } private set baseCards(cards: NoteCardRecord[]) { this.store.replaceBaseCards(cards); }
  private get visibleCards(): NoteCardRecord[] { return this.store.getVisibleCards() as NoteCardRecord[]; } private set visibleCards(cards: NoteCardRecord[]) { this.store.replaceVisibleCards(cards); }
  private get selectedPath(): string | null { return this.store.getSelectedPath(); } private set selectedPath(path: string | null) { this.store.setSelectedPath(path); }
  getViewType(): string {
    return FOLDER_CARD_VIEW;
  }

  getDisplayText(): string {
    return this.strings.view.displayName;
  }

  getIcon(): string {
    return CARD_WORKSPACE_ICON;
  }

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
    const strings = this.strings.view;
    const query = this.modules.search.getQuery().trim();

    if (query.length === 0) {
      return strings.emptyFolder;
    }

    const hasActiveTags = this.plugin.getSettings().filter.tags.length > 0;

    return hasActiveTags
      ? strings.emptySearchCurrentFolderWithTags(query)
      : strings.emptySearchCurrentFolder(query);
  }

  private openCardWithDestination(path: string, destination: OpenDestination): void {
    void this.plugin.openNoteFromCard(path, destination);
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
      const result = this.modules.scopeController.handleVaultMutation(event);
      if (result.shouldRefresh) {
        this.modules.scopeController.scheduleVaultRefresh();
      }
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
      void this.plugin.createNoteInCurrentFolder().catch((error: unknown) => {
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
  /**
   * Applies the weakest update that still reflects a change. Only `"reload"`
   * re-collects files; the weaker tiers keep scroll position and loaded previews.
   */
  async applyUpdateIntent(intent: ViewUpdateIntent, reason: RefreshReason): Promise<void> {
    switch (intent) {
      case "reload":
        await this.refresh({ reason, forceRefresh: true });
        return;
      case "rehydrate":
        this.modules.hydration.clearPreviewCache();
        this.modules.hydration.resetForLoad();
        this.store.advanceHydrationRevision();
        this.baseCards = this.baseCards.map((card) => ({
          ...card, hydrated: false, previewHtml: "", previewMode: "empty",
        }));
        this.projectVisibleCards();
        this.publishForIntent(intent);
        return;
      case "reproject":
        this.sortAndReprojectCards();
        this.publishForIntent(intent);
        return;
      case "patch":
        if (this.suppressScopeProjectionPatch) return;
        this.publishForIntent(intent);
        return;
    }
  }

  /** Re-sorts a copied card collection and republishes; never re-collects files. */
  private sortAndReprojectCards(): void {
    const projection = this.buildProjectionGroup();
    this.baseCards = [...this.baseCards].sort((left, right) =>
      compareCards(left, right, projection.sortField, projection.sortDirection),
    );
    this.modules.scopeController.refreshLoadKeyForCurrentScope();
    this.projectVisibleCards();
  }

  handleVaultMutation(event: VaultMutationEvent): VaultMutationResult {
    return this.modules.scopeController.handleVaultMutation(event);
  }

  /** Re-push nav-derived state after the plugin reconciled boxes/favorites outside the view. */
  refreshNavState(): void {
    this.modules.navLayout.refreshNavState();
  }

  cleanupLifecycle(): CleanupResult {
    this.viewEventUnsubscribe?.();
    this.viewEventUnsubscribe = null;
    const scopeReport = this.modules.scopeController.dispose();
    const navLayoutReport = this.modules.navLayout.dispose();
    this.modules.bulk.dispose();
    const searchReport = this.modules.search.dispose();
    const hydrationReport = this.modules.hydration.dispose();

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
    this.publishGroups("cards", "bulk");
  }

  getCurrentFolderPath(): string | null {
    return isFolderScope(this.cardScope) ? this.cardScope.path : null;
  }

  openNavContextMenu(payload: NavContextMenuPayload): void {
    if (!isMouseEventLike(payload.mouseEvent)) {
      return;
    }

    const deps = buildNavMenuDepsFor({
      context: this.context,
      modules: this.modules,
      onIncludeSubfoldersChange: (detail) => this.onIncludeSubfoldersChange(detail),
    });
    const menu = new Menu();
    if (!buildNavContextMenu(menu, payload, deps)) {
      return;
    }

    menu.showAtMouseEvent(payload.mouseEvent);

    const menuDom = getMenuDom(menu);
    if (menuDom) {
      decorateCardContextMenu(menuDom, resolveNavMenuDangerLabel(payload, deps));
    }
  }

  async onSortChange(detail: {
    field?: unknown;
    direction?: unknown;
  }): Promise<void> {
    const nextField: SortField =
      detail.field === "ctime" || detail.field === "name" ? detail.field : "mtime";
    const nextDirection: SortDirection = detail.direction === "asc" ? "asc" : "desc";
    const activeBox = this.modules.boxActions.getActiveBox();

    if (activeBox) {
      if (
        activeBox.sort.field === nextField &&
        activeBox.sort.direction === nextDirection
      ) {
        return;
      }
      await this.modules.boxActions.updateActiveBox((box) => ({
        ...box,
        sort: { field: nextField, direction: nextDirection },
      }));
      this.sortAndReprojectCards();
      return;
    }

    const currentSettings = this.plugin.getSettings();

    if (
      currentSettings.sort.field === nextField &&
      currentSettings.sort.direction === nextDirection
    ) {
      return;
    }

    await this.plugin.saveSettings({
      sort: {
        field: nextField,
        direction: nextDirection,
      },
    });
  }

  private projectVisibleCards(): void {
    this.modules.projection.reprojectCards();
    this.modules.bulk.reconcileToVisibleCards();
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

    return {
      displayPath: this.getDisplayFolderPath(),
      includeSubfolders: settings.includeSubfolders,
      activeBoxId: isBoxScope(this.cardScope) ? this.cardScope.boxId : null,
      activeBoxName: box?.name ?? null,
      boxExcludedCount: box?.excludedPaths.length ?? 0,
      emptyStateMessage: this.buildEmptyStateMessage(),
    };
  }

  private buildCardsGroup(): PanelModelState["cards"] {
    return {
      records: [...this.visibleCards],
      searchMatchCountsByPath: { ...this.modules.search.getMatchCountsByPath() },
      selectedPath: this.selectedPath,
      loading: this.modules.scopeController.isLoading(),
      generation: this.epochs.load.value, sequenceRevision: this.store.getVisibleSequenceRevision(), hydrationRevision: this.store.getHydrationRevision(),
    };
  }

  private buildSearchGroup(): PanelModelState["search"] {
    return {
      query: this.modules.search.getQuery(),
      status: this.modules.search.getStatus(),
      readiness: this.modules.search.getSnapshot()?.health?.readiness,
      persistence: this.modules.search.getSnapshot()?.health?.persistence,
      rebuildReason: this.modules.search.getSnapshot()?.health?.rebuildReason ?? null,
      focusToken: this.modules.search.getFocusToken(),
    };
  }

  private buildProjectionGroup(): PanelModelState["projection"] {
    const settings = this.plugin.getSettings();
    const scope = this.store.getScope();
    const box = isBoxScope(scope) ? findCardBox(settings.boxes ?? [], scope.boxId) : null;
    return {
      sortField: box?.sort.field ?? settings.sort.field,
      sortDirection: box?.sort.direction ?? settings.sort.direction,
      availableTags: this.modules.projection.deriveAvailableTags(),
      tagCounts: this.modules.projection.deriveTagCounts(),
      activeFilterTags: settings.filter.tags,
      pinnedPaths: box?.pinnedPaths ?? settings.pinnedPaths,
    };
  }

  private buildBulkGroup(): PanelModelState["bulk"] {
    return this.modules.bulk.buildPanelState();
  }

  private buildNavGroup(): PanelModelState["nav"] {
    const settings = this.plugin.getSettings();
    const boxSummaries = this.modules.boxActions.buildBoxSummaries();
    return {
      folderTree: this.modules.navLayout.getFolderTree(),
      favorites: this.modules.favoriteActions.buildFavoriteRowModels({ boxSummaries }),
      boxSummaries,
      paneWidth: settings.navPaneWidth,
      layoutMode: this.modules.navLayout.getLayoutMode(),
      visible: this.modules.navLayout.getNavVisible(),
      sectionCollapsed: {
        favorites: settings.favoritesSectionCollapsed,
        folders: settings.folderSectionCollapsed,
        tags: settings.tagSectionCollapsed,
        boxes: settings.boxSectionCollapsed,
      },
      showItemCounts: settings.showNavItemCounts,
      tooltipSide: this.modules.navLayout.getTooltipSide(),
    };
  }

  private buildAppearanceGroup(): PanelModelState["appearance"] {
    const settings = this.plugin.getSettings();
    return {
      cardCornerRadius: settings.cardCornerRadius,
      previewLines: settings.previewLines,
    };
  }

  /** Runtime events replace only the requested groups and notify listeners once. */
  private publishGroups(...groups: PanelGroup[]): void {
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
          case "appearance":
            state.appearance = this.buildAppearanceGroup();
            break;
        }
      }
    });
  }

  private publishLoadStart(scopeChanged: boolean): void {
    this.panelModel.batch((state) => {
      this.publishGroups("scope", "cards", "search", "projection", "bulk");
      if (state.appearance.previewLines !== this.plugin.getSettings().previewLines) {
        this.publishGroups("appearance");
      }
      if (!scopeChanged) return;
      const favorites = remapFavoriteSelection(
        state.nav.favorites, this.cardScope, this.plugin.getSettings().filter.tags, this.selectedPath,
      );
      if (favorites !== state.nav.favorites) state.nav = { ...state.nav, favorites };
    });
  }
  /** Settings changes translate their four update tiers into explicit groups. */
  private publishForIntent(intent: ViewUpdateIntent): void {
    switch (intent) {
      case "patch":
        this.publishGroups("nav", "appearance", "strings", "scope");
        return;
      case "reproject":
      case "rehydrate":
        this.publishGroups("nav", "appearance", "strings", "scope", "cards", "projection", "bulk");
        return;
      case "reload":
        this.publishGroups(...PANEL_GROUPS);
        return;
    }
  }

  async selectFolderFromNav(path: string): Promise<void> {
    this.modules.navLayout.returnToCardsViewIfSinglePane();

    const targetFolderPath = normalizeScopePath(path);
    const inBoxMode = isBoxScope(this.cardScope);
    // Leaving a card box counts as a scope change: tag filters never applied
    // inside a box, so browse mode should resume from a clean state.
    const scopeChanged = inBoxMode || targetFolderPath !== scopeDisplayPath(this.cardScope);
    const hasTagFilter = this.plugin.getSettings().filter.tags.length > 0;

    const patch: PartialPluginSettings = {};
    if (scopeChanged && hasTagFilter) {
      patch.filter = { tags: [] };
    }
    if (Object.keys(patch).length > 0) {
      await this.plugin.saveSettings(patch);
    }

    await this.plugin.selectFolderByPath(path, "panel-picker");
  }

  async onIncludeSubfoldersChange(detail: { value?: unknown }): Promise<void> {
    this.modules.navLayout.returnToCardsViewIfSinglePane();
    if (isBoxScope(this.cardScope)) {
      return;
    }
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

  async onPinToggle(detail: { path?: unknown; pinned?: unknown }): Promise<void> {
    const path = typeof detail.path === "string" ? detail.path : "";
    if (path.length === 0) {
      return;
    }

    const activeBox = this.modules.boxActions.getActiveBox();
    const currentPinnedPaths = activeBox ? activeBox.pinnedPaths : this.plugin.getSettings().pinnedPaths;
    const currentlyPinned = currentPinnedPaths.includes(path);
    const shouldPin = typeof detail.pinned === "boolean" ? detail.pinned : !currentlyPinned;

    if (shouldPin === currentlyPinned) {
      return;
    }

    const nextPinnedPaths = shouldPin
      ? [...currentPinnedPaths, path]
      : currentPinnedPaths.filter((pinnedPath) => pinnedPath !== path);

    if (activeBox) {
      await this.modules.boxActions.updateActiveBox((box) => ({ ...box, pinnedPaths: nextPinnedPaths }));
      return;
    }

    await this.plugin.saveSettings({
      pinnedPaths: nextPinnedPaths,
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
