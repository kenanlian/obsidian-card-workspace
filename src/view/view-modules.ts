import { normalizeGroupSpec, type GroupSpec } from "../card-grouping-settings";
import type { SearchService, SearchServiceSnapshot } from "../search";
import type { OpenDestination, SortDirection, SortField } from "../settings";
import { BoxActions } from "./actions/box-actions";
import { FavoriteActions } from "./actions/favorite-actions";
import { FileActions } from "./actions/file-actions";
import { FolderActions } from "./actions/folder-actions";
import { MergeActions } from "./actions/merge-actions";
import { createPropertyActions, type PropertyActions } from "./actions/property-actions";
import { TagActions } from "./actions/tag-actions";
import { BulkController } from "./controllers/BulkController";
import { GroupCollapseController } from "./controllers/GroupCollapseController";
import { HydrationController } from "./controllers/HydrationController";
import { NavLayoutController } from "./controllers/NavLayoutController";
import { ProjectionController } from "./controllers/ProjectionController";
import { PropertyController } from "./controllers/PropertyController";
import { ScopeController } from "./controllers/ScopeController";
import { SearchController } from "./controllers/SearchController";
import { TaskSummaryController } from "./controllers/TaskSummaryController";
import { CardContextMenu, isMouseEventLike } from "./menus/card-context-menu";
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
  taskSummary: TaskSummaryController;
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
  favoriteActions: FavoriteActions;
  mergeActions: MergeActions;
  cardMenu: CardContextMenu;
}

/** Builds and cross-wires every controller and action module for one view. */
export function createViewModules(context: ViewContext, host: ViewModuleHost): ViewModules {
  // Controllers are constructed before actions because actions reach into them
  // for scope loads and selection; every dependency is a function, so the
  // declaration order below does not have to match the call order at runtime.
  // Normalized rather than read straight through: settings supplied by older
  // persisted data (or by a partial test double) may carry no group spec.
  const resolveGroupSpec = (): GroupSpec =>
    normalizeGroupSpec(resolveViewConfig(context.store.getScope(), context.getSettings()).group);
  const groupCollapse: GroupCollapseController = new GroupCollapseController();
  const property: PropertyController = new PropertyController({
    context,
    getLoadKey: () => scopeController.getLoadKey(),
  });
  const projection: ProjectionController = new ProjectionController({
    context,
    getSearchInput: () => search.buildPipelineSearchInput(),
    getEffectivePinnedPaths: () => host.effectiveSortAndPins().pinnedPaths,
    getLoadKey: () => scopeController.getLoadKey(),
    getGroupConfig: resolveGroupSpec,
    getCollapsedGroupKeys: () =>
      groupCollapse.getCollapsedKeys(context.store.getScope(), resolveGroupSpec().dimension),
  });
  const hydration: HydrationController = new HydrationController({
    context,
    isLoading: () => scopeController.isLoading(),
  });
  const taskSummary: TaskSummaryController = new TaskSummaryController({
    context,
    getGroupDimension: () => resolveGroupSpec().dimension,
    reprojectAndPublish: () => {
      projection.reprojectCards();
      bulk.reconcileToVisibleCards();
      // Card-reprojecting metadata batches include nav (facet counts/rows move
      // with the base/visible cards) and scope (property-empty versus
      // source-empty copy), so one event lands as one coherent batch.
      host.publishGroups("nav", "scope", "cards", "projection", "bulk");
    },
    reconcileMetadataMembershipForPath: (path) =>
      scopeController.reconcileMetadataMembershipForPath(path),
    refreshGroupBucketForPath: (path) => projection.refreshGroupBucketForPath(path),
    classifyPropertyMetadataImpact: (path) => {
      if (!property.invalidateMetadata([path])) {
        return "none";
      }
      const settings = context.getSettings();
      if (settings.filter.properties.length > 0) {
        return "reproject";
      }
      return settings.visiblePropertyKeys.length > 0 ? "nav" : "none";
    },
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
    resolveLiveMarkdownFile: (path) => fileActions.resolveLiveMarkdownFile(path),
    publishSelection: () => {
      host.publishSelection();
    },
    openNote: (path) => {
      void host.openNoteFromCard(path);
    },
  });
  const navLayout: NavLayoutController = new NavLayoutController({
    context,
    onNavCountsInvalidated: () => {
      boxActions.invalidateCache();
      projection.invalidateVaultCaches();
      property.invalidateVault();
    },
    getTooltipSide: () => host.getTooltipSide(),
  });
  const scopeController: ScopeController = new ScopeController({
    context,
    collectBoxFiles: (boxId) => boxActions.collectBoxFilesById(boxId),
    isPathInBox: (path, boxId) => boxActions.isPathInBox(path, boxId),
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
    buildSiblingPath: (parentPath, fileName) =>
      folderActions.buildSiblingPath(parentPath, fileName),
  });
  const folderActions: FolderActions = new FolderActions({
    context,
    isBoxMode: () => boxActions.isBoxMode(),
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
    requestDestructiveConfirmation: (options) =>
      mergeActions.requestDestructiveConfirmation(options),
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
    isBoxMode: () => boxActions.isBoxMode(),
    getDisplayFolderPath: () => host.getDisplayFolderPath(),
    createNoteIn: (folderUiPath, tags) => folderActions.createNoteIn(folderUiPath, tags),
    returnToCardsViewIfSinglePane: () => {
      navLayout.returnToCardsViewIfSinglePane();
    },
  });
  const favoriteActions: FavoriteActions = new FavoriteActions({
    context,
    isBoxMode: () => boxActions.isBoxMode(),
    getActiveBoxId: () => boxActions.getActiveBox()?.id ?? null,
    handleBoxCommand: (detail) => {
      boxActions.handleBoxCommand(detail);
    },
    getFolderTreeCount: (path) => navLayout.getFolderTreeCount(path),
    resolveFolderFromUiPath: (folderPath) => folderActions.resolveFolderFromUiPath(folderPath),
    selectFolderFromNav: (path) => host.selectFolderFromNav(path),
    requestDestructiveConfirmation: (options) =>
      mergeActions.requestDestructiveConfirmation(options),
    openNoteFromCard: (path, destination) => host.openNoteFromCard(path, destination),
    getVaultTagCounts: () => projection.getVaultTagCounts(),
    applyTagFilter: (nextTags) => tagActions.applyTagFilter(nextTags),
  });
  const propertyActions: PropertyActions = createPropertyActions({
    getApp: () => context.getApp(),
    getSettings: () => context.getSettings(),
    saveSettings: (patch) => context.saveSettings(patch),
    collectPropertyInventory: () => property.collectPropertyInventory(),
    getStrings: () => context.getUiStrings(),
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

  return {
    projection,
    groupCollapse,
    hydration,
    taskSummary,
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
    favoriteActions,
    mergeActions,
    cardMenu,
  };
}
