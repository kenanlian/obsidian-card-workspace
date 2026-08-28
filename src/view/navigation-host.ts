import { Menu } from "obsidian";
import type { UiStrings } from "../i18n";
import type { PluginSettings } from "../settings";
import { remapFavoriteSelection } from "./actions/favorite-actions";
import type { NavLayoutController } from "./controllers/NavLayoutController";
import type { NavigationIntent } from "./navigation-model";
import type {
  BoxSummary,
  FavoriteRowModel,
  PanelGroup,
  PanelModel,
  PanelModelState,
  PanelProjectionState,
} from "./panel-model";
import { isBoxScope, type CardScope } from "./scope";
import { buildTagTree, resolveTagSelection } from "./tag-tree";
import type { FavoriteEntry, FolderTreeNode, NavContextMenuPayload } from "./types";
import { getMenuDom } from "./menu-dom";
import { buildNavContextMenu, resolveNavMenuDangerLabel, type NavMenuDeps } from "./nav-context-menu";
import { decorateCardContextMenu, isMouseEventLike } from "./menus/card-context-menu";

export function buildNavigationPanelState(input: {
  settings: PluginSettings;
  strings: UiStrings;
  scope: CardScope;
  selectedPath: string | null;
  folderTree: FolderTreeNode[];
  favorites: FavoriteRowModel[];
  boxSummaries: BoxSummary[];
  cardProjection: PanelProjectionState;
  navLayout: NavLayoutController;
  tooltipSide: "left" | "right";
}): PanelModelState["nav"] {
  const { settings, strings, scope, navLayout } = input;
  const sectionCollapsed = settings.sectionCollapsed;
  const projection = navLayout.project({
    scope,
    activeTags: settings.filter.tags,
    selectedPath: input.selectedPath,
    favorites: input.favorites,
    folders: input.folderTree,
    tags: buildTagTree(input.cardProjection.availableTags),
    boxes: input.boxSummaries,
    tagCounts: input.cardProjection.tagCounts,
    includeSubfolders: settings.includeSubfolders,
    tagsDisabled: isBoxScope(scope),
    sectionCollapsed,
    sectionLabels: {
      favorites: { label: strings.toolbar.navPane.favoritesSection, emptyLabel: strings.toolbar.navPane.favoritesEmpty },
      folders: { label: strings.toolbar.navPane.foldersSection, emptyLabel: null },
      tags: { label: strings.toolbar.navPane.tagsSection, emptyLabel: null },
      boxes: { label: strings.toolbar.navPane.boxesSection, emptyLabel: strings.toolbar.navPane.boxesEmpty },
    },
    rootFolderLabel: strings.toolbar.folderMenu.rootFolder,
  });
  return {
    folderTree: input.folderTree, favorites: input.favorites, boxSummaries: input.boxSummaries,
    paneWidth: settings.navPaneWidth, layoutMode: navLayout.getLayoutMode(),
    visible: navLayout.getNavVisible(), sectionCollapsed,
    showItemCounts: settings.showNavItemCounts, tooltipSide: input.tooltipSide,
    projection, query: navLayout.getQuery(), focusId: navLayout.getFocusId(),
    focusRequest: navLayout.getFocusRequest(),
    revealRequest: navLayout.getRevealRequest(),
  };
}

export interface LoadBoundaryHost {
  panelModel: PanelModel;
  publishGroups: (...groups: PanelGroup[]) => void;
  projectNav: (
    folderTree: FolderTreeNode[], favorites: FavoriteRowModel[],
    boxSummaries: BoxSummary[], cardProjection: PanelProjectionState,
  ) => PanelModelState["nav"];
  getSettings: () => PluginSettings;
  getScope: () => CardScope;
  getSelectedPath: () => string | null;
}

/** Load boundaries reproject navigation from published sources; only the view host rebuilds those sources. */
function reprojectNavigation(
  host: LoadBoundaryHost,
  favorites: FavoriteRowModel[] | null,
): PanelModelState["nav"] {
  const { nav, projection } = host.panelModel.getState();
  return host.projectNav(nav.folderTree, favorites ?? nav.favorites, nav.boxSummaries, projection);
}

export function publishLoadStart(host: LoadBoundaryHost, scopeChanged: boolean): void {
  host.panelModel.batch((state) => {
    host.publishGroups("scope", "cards", "search", "projection", "bulk");
    if (state.appearance.previewLines !== host.getSettings().previewLines) {
      host.publishGroups("appearance");
    }
    if (!scopeChanged) return;
    state.nav = reprojectNavigation(host, remapFavoriteSelection(
      state.nav.favorites, host.getScope(), host.getSettings().filter.tags, host.getSelectedPath(),
    ));
  });
}

/** Tag rows are derived from the card projection, so a committed load must reproject navigation too. */
export function publishLoadCommit(host: LoadBoundaryHost): void {
  host.panelModel.batch((state) => {
    host.publishGroups("cards", "search", "projection", "bulk");
    state.nav = reprojectNavigation(host, null);
  });
}

export function isCurrentNavigationMenuTarget(input: {
  payload: NavContextMenuPayload;
  settings: PluginSettings;
  navLayout: NavLayoutController;
  resolveFolder: (path: string) => unknown | null;
}): boolean {
  const { payload, settings } = input;
  if (payload.scope === "header") return payload.originId === `section:${payload.section}`;
  if (payload.section === "boxes") {
    return typeof payload.itemId === "string" && settings.boxes.some((box) => box.id === payload.itemId);
  }
  if (payload.section === "favorites") {
    return Boolean(payload.favorite) && settings.favorites.some(
      (entry) => entry.kind === payload.favorite?.kind && entry.ref === payload.favorite.ref,
    );
  }
  if (payload.section === "folders") {
    return typeof payload.itemId === "string" && input.resolveFolder(payload.itemId) !== null;
  }
  return input.navLayout.getProjection().rows.some((row) =>
    row.id === payload.originId && row.kind === "tag" && row.tagPath === payload.itemId);
}

export function openNavigationContextMenu(input: {
  payload: NavContextMenuPayload;
  disposed: boolean;
  targetCurrent: boolean;
  deps: NavMenuDeps;
  restoreFocus: (originId: string) => void;
}): void {
  const { payload, deps } = input;
  const trigger = payload.trigger;
  const validTrigger = trigger?.kind === "pointer"
    ? isMouseEventLike(trigger.mouseEvent)
    : trigger?.kind === "position"
      && Number.isFinite(trigger.position?.x) && Number.isFinite(trigger.position?.y);
  if (input.disposed || !validTrigger || !input.targetCurrent) return;
  const menu = new Menu();
  if (!buildNavContextMenu(menu, payload, deps)) return;
  menu.onHide(() => input.restoreFocus(payload.originId));
  if (trigger.kind === "pointer") menu.showAtMouseEvent(trigger.mouseEvent);
  else menu.showAtPosition(trigger.position);
  const menuDom = getMenuDom(menu);
  if (menuDom) decorateCardContextMenu(menuDom, resolveNavMenuDangerLabel(payload, deps));
}

export function routeNavigationIntent(input: {
  intent: NavigationIntent;
  navLayout: NavLayoutController;
  scope: CardScope;
  activeTags: readonly string[];
  selectFolder: (path: string) => void;
  switchBox: (boxId: string) => void;
  applyTagFilter: (tags: string[]) => void;
  activateFavorite: (favorite: FavoriteEntry) => void;
}): void {
  const { intent, navLayout } = input;
  if (intent.type === "query-update") { navLayout.updateQuery(intent.query); return; }
  if (intent.type === "query-clear") { navLayout.clearQuery(); return; }
  if (intent.type === "focus") { navLayout.setFocus(intent.rowId); return; }
  if (intent.type === "reveal-consumed") { navLayout.consumeReveal(intent.token); return; }
  if (intent.type === "focus-return-consumed") { navLayout.consumeFocusReturn(intent.token); return; }
  if (intent.type === "toggle-section") {
    const section = navLayout.getProjection().rows.find(
      (row) => row.kind === "section" && row.section === intent.section,
    );
    if (section) void navLayout.setExpanded(section, !section.expanded);
    return;
  }
  const row = navLayout.getProjection().rows.find((candidate) => candidate.id === intent.rowId);
  if (!row) return;
  if (intent.type === "set-expanded") { void navLayout.setExpanded(row, intent.expanded); return; }
  if (row.disabled) return;
  if (row.kind === "section") { void navLayout.setExpanded(row, !row.expanded); return; }
  if (row.kind === "folder") { input.selectFolder(row.folderPath); return; }
  if (row.kind === "box") {
    if (input.scope.kind !== "box" || input.scope.boxId !== row.boxId) input.switchBox(row.boxId);
    return;
  }
  if (row.kind === "tag") {
    input.applyTagFilter(resolveTagSelection([...input.activeTags], row.tagPath, intent.mode === "additive"));
    return;
  }
  if (row.favorite.kind === "tag" && intent.mode === "additive") {
    input.applyTagFilter(resolveTagSelection([...input.activeTags], row.favorite.ref, true));
    return;
  }
  input.activateFavorite(row.favorite);
}
