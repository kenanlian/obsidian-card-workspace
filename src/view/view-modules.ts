import { normalizeGroupSpec, type GroupSpec } from "../card-grouping-settings";
import type { SearchService, SearchServiceSnapshot } from "../search";
import type { OpenDestination, SortDirection, SortField } from "../settings";
import { ArrangementActions } from "./actions/arrangement-actions";
import { BoxActions } from "./actions/box-actions";
import { createFavoriteActions, type FavoriteActions } from "./actions/favorite-actions";
import { FileActions } from "./actions/file-actions";
import { FolderActions } from "./actions/folder-actions";
import { LinksActions } from "./actions/links-actions";
import { MergeActions } from "./actions/merge-actions";
import { createPropertyActions, type PropertyActions } from "./actions/property-actions";
import { TagActions } from "./actions/tag-actions";
import { TagManagementActions } from "./actions/tag-manage-actions";
import { BulkController } from "./controllers/BulkController";
import { GroupCollapseController } from "./controllers/GroupCollapseController";
import { HydrationController } from "./controllers/HydrationController";
import { MetadataImpactController, type MetadataImpactBatch } from "./controllers/MetadataImpactController";
import { NavLayoutController } from "./controllers/NavLayoutController";
import { ProjectionController } from "./controllers/ProjectionController";
import { PropertyController } from "./controllers/PropertyController";
import { ScopeController } from "./controllers/ScopeController";
import { SearchController } from "./controllers/SearchController";
import { CardContextMenu, isMouseEventLike } from "./menus/card-context-menu";
import { resolveSourceCapabilities } from "./source-capabilities";
import { collectSupportedFiles, rewritePathAfterRename } from "./scope-files";
import type { SelectionResult } from "./types";
import type { ViewContext } from "./view-context";
import { resolveViewConfig } from "./view-config";

/**
 * The view-level capabilities the modules call back into. Everything here is a
 * function so `createViewModules` can run before the view finishes constructing.
 */
export interface ViewModuleHost {
  effectiveSortAndPins: () => { sortField: SortField; sortDirection: SortDirection; pinnedPaths: string[] };
  getDisplayFolderPath: () => string;
  getTooltipSide: () => "left" | "right";
  openCardWithDestination: (path: string, destination: OpenDestination) => void;
  selectFolderFromNav: (path: string) => Promise<void>;
  moveScopeToFolder: (path: string) => Promise<SelectionResult>;
  bumpSearchFocusToken: () => void;
  publishAll: () => void;
  publishSearch: () => void;
  publishSelection: () => void;
  publishHydration: () => void;
  publishLoadStart: (scopeChanged: boolean) => void;
  publishLoadCommit: () => void;
  publishGroups: ViewContext["publishGroups"];
  /** One coherent metadata publication; nav derives from the exact fresh projection snapshot. */
  publishImpactBatch: (batch: MetadataImpactBatch) => void;
  openNoteFromCard: (path: string, destination?: OpenDestination) => Promise<void>;
  createNoteInFolder: (folderPath: string, tags: string[]) => Promise<void>;
  getSearchService: () => SearchService | null;
  getSearchSnapshot: () => SearchServiceSnapshot | null;
  subscribeSearchSnapshots: (listener: (snapshot: SearchServiceSnapshot) => void) => () => void;
}

export interface ViewModules {
  projection: ProjectionController;
  groupCollapse: GroupCollapseController;
  hydration: HydrationController;
  metadataImpact: MetadataImpactController;
  search: SearchController;
  bulk: BulkController;
  navLayout: NavLayoutController;
  property: PropertyController;
  propertyActions: PropertyActions;
  scopeController: ScopeController;
  fileActions: FileActions;
  folderActions: FolderActions;
  boxActions: BoxActions;
  tagActions: TagActions;
  tagManageActions: TagManagementActions;
  favoriteActions: FavoriteActions;
  linksActions: LinksActions;
  mergeActions: MergeActions;
  cardMenu: CardContextMenu;
  arrangementActions: ArrangementActions;
}

/**
 * Construction-time smoke gate: a callback that closes over a module declared
 * later throws if a constructor invokes it before assembly finishes (C8).
 */
export function createModuleConstructionGate(): {
  guard<Args extends unknown[], Result>(name: string, fn: (...args: Args) => Result): (...args: Args) => Result;
  markAssembled(): void;
} {
  let assembled = false;
  return {
    guard<Args extends unknown[], Result>(name: string, fn: (...args: Args) => Result): (...args: Args) => Result {
      return (...args: Args) => {
        if (!assembled) {
          throw new Error(`Uninitialized module callback invoked during construction: ${name}`);
        }
        return fn(...args);
      };
    },
    markAssembled() {
      assembled = true;
    },
  };
}

/** Builds and cross-wires every controller and action module for one view. */
export function createViewModules(context: ViewContext, host: ViewModuleHost): ViewModules {
  // Controllers are constructed before actions because actions reach into them
  // for scope loads and selection; every dependency is a function, so the
  // declaration order below does not have to match the call order at runtime.
  // Normalized rather than read straight through: settings supplied by older
  // persisted data (or by a partial test double) may carry no group spec.
  const gate = createModuleConstructionGate();
  const resolveGroupSpec = (): GroupSpec =>
    normalizeGroupSpec(resolveViewConfig(context.store.getScope(), context.getSettings()).group);
  const groupCollapse: GroupCollapseController = new GroupCollapseController();
  const property: PropertyController = new PropertyController({
    context,
    getLoadKey: gate.guard("scopeController.getLoadKey", () => scopeController.getLoadKey()),
  });
  const projection: ProjectionController = new ProjectionController({
    context,
    getSearchInput: gate.guard("search.buildPipelineSearchInput", () => search.buildPipelineSearchInput()),
    getEffectivePinnedPaths: () => host.effectiveSortAndPins().pinnedPaths,
    getLoadKey: gate.guard("scopeController.getLoadKey", () => scopeController.getLoadKey()),
    getGroupConfig: resolveGroupSpec,
    getCollapsedGroupKeys: () =>
      groupCollapse.getCollapsedKeys(context.store.getScope(), resolveGroupSpec().dimension),
  });
  const hydration: HydrationController = new HydrationController({
    context,
    isLoading: gate.guard("scopeController.isLoading", () => scopeController.isLoading()),
  });
  const search: SearchController = new SearchController({
    context,
    getSearchService: () => host.getSearchService(),
    getSearchSnapshot: () => host.getSearchSnapshot(),
    subscribeSearchSnapshots: (listener) => host.subscribeSearchSnapshots(listener),
    publishSearchProjection: () => {
      host.publishSearch();
    },
  });
  const bulk: BulkController = new BulkController({
    context,
    getOrderedVisiblePaths: () => projection.getOrderedVisiblePaths(),
    resolveLiveMarkdownFile: gate.guard(
      "fileActions.resolveLiveMarkdownFile",
      (path) => fileActions.resolveLiveMarkdownFile(path),
    ),
    publishSelection: () => {
      host.publishSelection();
    },
    openNote: (path) => {
      void host.openNoteFromCard(path);
    },
  });
  const navLayout: NavLayoutController = new NavLayoutController({
    context,
    onNavCountsInvalidated: gate.guard("boxActions.invalidateCache", () => {
      boxActions.invalidateCache();
      projection.invalidateVaultCaches();
      property.invalidateVault();
    }),
    getTooltipSide: () => host.getTooltipSide(),
  });
  const scopeController: ScopeController = new ScopeController({
    context,
    collectBoxFiles: gate.guard("boxActions.collectBoxFilesById", (boxId) =>
      boxActions.collectBoxFilesById(boxId),
    ),
    isPathInBox: gate.guard("boxActions.isPathInBox", (path, boxId) =>
      boxActions.isPathInBox(path, boxId),
    ),
    deriveVisibleCardsFrom: (cards) => projection.deriveVisibleCardsFrom(cards),
    projectVisibleCards: () => projection.reprojectCards(),
    getBulkSelection: () => ({
      selectedPaths: bulk.getSelectedPaths(),
      anchorPath: bulk.getAnchorPath(),
    }),
    setBulkSelection: (state) => {
      bulk.setSelectedPaths(state.selectedPaths);
      bulk.setAnchorPath(state.anchorPath);
    },
    clearBulkSelection: () => bulk.clearSelectionState(),
    hasPendingHydration: (path) => hydration.hasPending(path),
    deletePendingHydration: (path) => hydration.deletePending(path),
    resetHydrationForLoad: () => hydration.resetForLoad(),
    prepareRecordsFromCache: (records) => hydration.prepareRecordsFromCache(records),
    invalidateForVaultMutation: (event) => hydration.invalidateForVaultMutation(event),
    hydrateStartupCardPaths: (paths, token) =>
      hydration.hydrateStartupCardPaths(paths, token),
    scheduleHydrationPath: (path) => hydration.schedulePath(path),
    resetSearchForLoad: () => {
      search.resetForLoad();
    },
    refreshSearchProjection: () => {
      void search.refreshProjection();
    },
    scheduleNavCountRefresh: () => navLayout.scheduleNavCountRefresh(),
    refreshFolderTreeState: () => {
      navLayout.refreshFolderTreeState();
    },
    scheduleFolderTreeRefresh: () => navLayout.scheduleFolderTreeRefresh(),
    publishLoadStart: (scopeChanged) => host.publishLoadStart(scopeChanged),
    publishLoadCommit: () => host.publishLoadCommit(),
    startupCardCount: HydrationController.startupCardCount,
  });

  const fileActions: FileActions = new FileActions({
    context,
    buildSiblingPath: gate.guard("folderActions.buildSiblingPath", (parentPath, fileName) =>
      folderActions.buildSiblingPath(parentPath, fileName),
    ),
  });
  const folderActions: FolderActions = new FolderActions({
    context,
    getScope: () => context.store.getScope(),
    selectFolderFromNav: (path) => host.selectFolderFromNav(path),
    moveScopeToFolder: (path) => host.moveScopeToFolder(path),
    resetSearchQuery: () => {
      search.resetQuery();
    },
    bumpSearchFocusToken: () => {
      host.bumpSearchFocusToken();
    },
    refreshFolderTreeState: () => {
      navLayout.refreshFolderTreeState();
    },
    rewritePathAfterRename,
    requestDestructiveConfirmation: gate.guard(
      "mergeActions.requestDestructiveConfirmation",
      (options) => mergeActions.requestDestructiveConfirmation(options),
    ),
    createNoteInFolder: (folderPath, tags) => host.createNoteInFolder(folderPath, tags),
    openNoteFromCard: (path, destination) => host.openNoteFromCard(path, destination),
  });
  const boxActions: BoxActions = new BoxActions({
    context,
    getSelectedPaths: () => bulk.getSelectedPaths(),
    getOrderedVisiblePaths: () => projection.getOrderedVisiblePaths(),
    isMouseEventLike,
    resolveFolderFromUiPath: (folderPath) => folderActions.resolveFolderFromUiPath(folderPath),
    collectSupportedFiles: (folderPath, includeSubfolders) =>
      collectSupportedFiles(context.getApp(), folderPath, includeSubfolders),
    createProgrammaticSelectionRequest: (scope, forceRefresh) =>
      scopeController.createProgrammaticSelectionRequest(scope, forceRefresh),
    handleScopeSelection: (request) => scopeController.handleScopeSelection(request),
    moveScopeToFolder: (path) => host.moveScopeToFolder(path),
    returnToCardsViewIfSinglePane: () => {
      navLayout.returnToCardsViewIfSinglePane();
    },
  });
  const tagActions: TagActions = new TagActions({
    context,
    resolveLiveMarkdownFile: (path) => fileActions.resolveLiveMarkdownFile(path),
    isBulkMode: () => bulk.isBulkMode(),
    getSelectedPaths: () => bulk.getSelectedPaths(),
    resolveSelectedLiveMarkdownFilesInOrder: () =>
      bulk.resolveSelectedLiveMarkdownFilesInOrder(),
    reconcileSelectionToOrderedPaths: (paths) => {
      bulk.reconcileSelectionToOrderedPaths(paths);
    },
    deriveAvailableTags: () => projection.deriveAvailableTags(),
    browseTagFilterEnabled: () => resolveSourceCapabilities(context.store.getScope()).browseTagFilter,
    getDisplayFolderPath: () => host.getDisplayFolderPath(),
    createNoteIn: (folderUiPath, tags) => folderActions.createNoteIn(folderUiPath, tags),
    returnToCardsViewIfSinglePane: () => {
      navLayout.returnToCardsViewIfSinglePane();
    },
  });
  const tagManageActions: TagManagementActions = new TagManagementActions({
    context,
    requestDestructiveConfirmation: gate.guard(
      "mergeActions.requestDestructiveConfirmation",
      (options) => mergeActions.requestDestructiveConfirmation(options),
    ),
  });
  const propertyActions: PropertyActions = createPropertyActions({
    getApp: () => context.getApp(),
    getSettings: () => context.getSettings(),
    saveSettings: (patch) => context.saveSettings(patch),
    collectPropertyInventory: () => property.collectPropertyInventory(),
    getStrings: () => context.getUiStrings(),
    browsePropertyFilterEnabled: () => resolveSourceCapabilities(context.store.getScope()).browsePropertyFilter,
  });
  const mergeActions: MergeActions = new MergeActions({
    context,
    getBulkMode: () => bulk.isBulkMode(),
    getSelectedPaths: () => bulk.getSelectedPaths(),
    setSelectedPaths: (paths) => {
      bulk.setSelectedPaths(paths);
    },
    setBulkAnchorPath: (path) => {
      bulk.setAnchorPath(path);
    },
    publishSelection: () => {
      host.publishSelection();
    },
    reconcileSelectionToOrderedPaths: (paths) => {
      bulk.reconcileSelectionToOrderedPaths(paths);
    },
    resolveSelectedLiveFilesInOrder: () => bulk.resolveSelectedLiveFilesInOrder(),
  });
  const favoriteActions = createFavoriteActions({
    context, boxActions, navLayout, folderActions, host, projection, tagActions,
    requestDestructiveConfirmation: (options) => mergeActions.requestDestructiveConfirmation(options),
  });
  const linksActions = new LinksActions({
    context,
    createProgrammaticSelectionRequest: (scope, forceRefresh) =>
      scopeController.createProgrammaticSelectionRequest(scope, forceRefresh),
    handleScopeSelection: (request) => scopeController.handleScopeSelection(request),
    openCreateBoxModalWithPaths: (paths) => boxActions.openCreateBoxModalWithPaths(paths),
  });
  const cardMenu: CardContextMenu = new CardContextMenu({
    context,
    resolveLiveMarkdownFile: (path) => fileActions.resolveLiveMarkdownFile(path),
    isBoxMode: () => boxActions.isBoxMode(),
    appendAddToBoxMenu: (menu, paths) => {
      boxActions.appendAddToBoxMenu(menu, paths);
    },
    appendCardFavoriteMenuItem: (menu, notePath) => {
      favoriteActions.appendCardFavoriteMenuItem(menu, notePath);
    },
    removeMemberFromActiveBox: (notePath) => boxActions.removeMemberFromActiveBox(notePath),
    copyCardTitle: (notePath) => fileActions.copyCardTitle(notePath),
    copyCardContent: (notePath) => fileActions.copyCardContent(notePath),
    copyCardTitleAndContent: (notePath) => fileActions.copyCardTitleAndContent(notePath),
    makeCardFileCopy: (notePath) => fileActions.makeCardFileCopy(notePath),
    moveCardNote: (notePath) => {
      fileActions.moveCardNote(notePath);
    },
    renameCardFile: (notePath) => {
      fileActions.renameCardFile(notePath);
    },
    deleteCardFile: (notePath) => fileActions.deleteCardFile(notePath),
    openSingleTagModal: (notePath, mode) => {
      tagActions.openSingleTagModal(notePath, mode);
    },
    openCardWithDestination: (notePath, destination) => {
      host.openCardWithDestination(notePath, destination);
    },
  });

  // Constructed after every module it calls into (projection, property, search,
  // bulk, navLayout, scopeController, boxActions) so it adds no forward
  // reference; its callbacks only run once the view is live.
  const metadataImpact: MetadataImpactController = new MetadataImpactController({
    context,
    getGroupDimension: () => resolveGroupSpec().dimension,
    isBrowseTagFilterActive: () =>
      resolveSourceCapabilities(context.store.getScope()).browseTagFilter
      && context.getSettings().filter.tags.length > 0,
    isSearchActive: () => search.getQuery().trim().length > 0,
    reconcileMetadataMembershipForPath: (path) =>
      scopeController.reconcileMetadataMembershipForPath(path),
    refreshMetadataGroupBuckets: () => projection.refreshMetadataGroupBuckets(),
    refreshScopeTagData: () => projection.refreshScopeTagData(),
    classifyPropertyMetadataImpact: (path) => {
      if (!property.invalidateMetadata([path])) {
        return "none";
      }
      const settings = context.getSettings();
      if (resolveSourceCapabilities(context.store.getScope()).browsePropertyFilter
        && settings.filter.properties.length > 0) {
        return "reproject";
      }
      return settings.visiblePropertyKeys.length > 0 ? "nav" : "none";
    },
    invalidateMetadataDerivedCaches: () => {
      boxActions.invalidateCache();
      projection.invalidateMetadataDerivedCaches();
      navLayout.scheduleNavCountRefresh();
    },
    refreshSearchCandidatesSilently: () => search.refreshProjection({ publish: false }),
    reprojectCardsForMetadata: () => {
      projection.reprojectCards();
      bulk.reconcileToVisibleCards();
    },
    publishImpactBatch: (batch) => host.publishImpactBatch(batch),
    scheduleVisibleHydrationCandidates: (paths) =>
      scopeController.scheduleVisibleHydrationCandidates(paths),
  });

  // Constructed after BoxActions, ProjectionController, BulkController,
  // GroupCollapseController, and ScopeController so it adds no forward reference.
  const arrangementActions: ArrangementActions = new ArrangementActions({
    context,
    saveSettings: (patch) => context.saveSettings(patch),
    getActiveBox: () => boxActions.getActiveBox(),
    updateActiveBox: (mutate) => boxActions.updateActiveBox(mutate),
    resolveCapabilities: () => resolveSourceCapabilities(context.store.getScope()),
    publishGroups: (...groups) => host.publishGroups(...groups),
    refreshLoadKeyForCurrentScope: () => scopeController.refreshLoadKeyForCurrentScope(),
    reprojectCards: () => projection.reprojectCards(),
    reconcileToVisibleCards: () => bulk.reconcileToVisibleCards(),
    groupCollapse,
    getGroupSegmentKeys: () => projection.getGroupSegments().map((segment) => segment.key),
  });

  gate.markAssembled();

  return {
    projection,
    groupCollapse,
    hydration,
    metadataImpact,
    search,
    bulk,
    navLayout,
    property,
    propertyActions,
    scopeController,
    fileActions,
    folderActions,
    boxActions,
    tagActions,
    tagManageActions,
    favoriteActions,
    linksActions,
    mergeActions,
    cardMenu,
    arrangementActions,
  };
}
