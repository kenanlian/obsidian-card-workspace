import type { PanelModel } from "./panel-model";
import type { HydrateViewportRequest } from "./hydration-request";
import type { CardHoverLinkPayload, FolderActionPayload, NavContextMenuPayload } from "./types";
import type { ViewModules } from "./view-modules";
import type { NavigationIntent } from "./navigation-model";

/** The slice of `FolderCardView` the panel callbacks route through. */
export interface PanelHost {
  panelModel: PanelModel;
  modules: ViewModules;
  plugin: {
    openNoteFromCard: (path: string, destination?: never) => Promise<void>;
  };
  handleToolbarAction: (detail: { action?: unknown }) => void;
  onSortChange: (detail: { field?: unknown; direction?: unknown }) => Promise<void>;
  onIncludeSubfoldersChange: (detail: { value?: unknown }) => Promise<void>;
  onPinToggle: (detail: { path?: unknown; pinned?: unknown }) => Promise<void>;
  onCardHoverLink: (detail: CardHoverLinkPayload) => void;
  selectFolderFromNav: (path: string) => Promise<void>;
  handleFolderActionRequest: (detail: FolderActionPayload) => void;
  openNavContextMenu: (payload: NavContextMenuPayload) => void;
  handleNavigationIntent: (intent: NavigationIntent) => void;
}

type PanelCallbackProps = { panelModel: PanelModel } & Record<string, unknown>;

/** Builds the props the Svelte panel is mounted with. */
export function buildPanelProps(view: PanelHost): PanelCallbackProps {
  return {
    panelModel: view.panelModel,
    onOpenNote: (detail: { path?: unknown }) => {
      if (view.modules.bulk.isBulkMode() || typeof detail.path !== "string") {
        return;
      }
      void view.plugin.openNoteFromCard(detail.path);
    },
    onBulkSelectCard: (detail: { path?: unknown; shiftKey?: unknown }) => {
      view.modules.bulk.onBulkSelectCard(detail);
    },
    onCardContextMenu: (detail: {
      path?: unknown;
      mouseEvent?: unknown;
      trigger?: unknown;
      position?: unknown;
    }) => {
      view.modules.cardMenu.open({
        notePath: detail.path,
        trigger: detail.trigger,
        mouseEvent: detail.mouseEvent,
        position: detail.position,
      });
    },
    onHydrateViewport: (detail: unknown) => {
      if (typeof detail !== "object" || detail === null) return;
      const request = detail as Partial<Record<keyof HydrateViewportRequest, unknown>>;
      if (
        typeof request.generation !== "number"
        || typeof request.hydrationRevision !== "number"
        || typeof request.start !== "number"
        || typeof request.end !== "number"
        || !Array.isArray(request.paths)
        || !request.paths.every((path) => typeof path === "string")
      ) {
        return;
      }
      void view.modules.hydration.hydrateViewport({
        generation: request.generation,
        hydrationRevision: request.hydrationRevision,
        start: request.start,
        end: request.end,
        paths: request.paths,
      });
    },
    onToolbarAction: (detail: { action?: unknown }) => {
      view.handleToolbarAction(detail);
    },
    onSortChange: (detail: { field?: unknown; direction?: unknown }) => {
      void view.onSortChange(detail);
    },
    onFilterChange: (detail: { tags?: unknown }) => {
      void view.modules.tagActions.onFilterChange(detail);
    },
    onIncludeSubfoldersChange: (detail: { value?: unknown }) => {
      void view.onIncludeSubfoldersChange(detail);
    },
    onSearchQueryChange: (detail: { query?: unknown }) => {
      view.modules.search.onQueryChange(detail);
    },
    onSearchQueryReset: () => {
      view.modules.search.resetQuery();
    },
    onPinToggle: (detail: { path?: unknown; pinned?: unknown }) => {
      void view.onPinToggle(detail);
    },
    onCardHoverLink: (detail: CardHoverLinkPayload) => {
      view.onCardHoverLink(detail);
    },
    onSelectFolder: (detail: { path?: unknown }) => {
      if (typeof detail.path !== "string") {
        return;
      }
      void view.selectFolderFromNav(detail.path);
    },
    onFolderAction: (detail: FolderActionPayload) => {
      view.handleFolderActionRequest(detail);
    },
    onBoxCommand: (detail: { command?: unknown; boxId?: unknown }) => {
      view.modules.boxActions.handleBoxCommand(detail);
    },
    onNavContextMenu: (detail: NavContextMenuPayload) => {
      view.openNavContextMenu(detail);
    },
    onNavigationIntent: (detail: NavigationIntent) => {
      view.handleNavigationIntent(detail);
    },
    onFavoriteActivate: (detail: { favorite?: unknown }) => {
      view.modules.favoriteActions.handleFavoriteActivate(detail);
    },
    onNavPaneResize: (width: number) => {
      void view.modules.navLayout.onNavPaneResize(width);
    },
    onShellResize: (width: number) => {
      view.modules.navLayout.onShellResize(width);
    },
    onToggleNavPane: () => {
      void view.modules.navLayout.onToggleNavPane();
    },
    onToggleNavSection: (section: unknown) => {
      void view.modules.navLayout.onToggleNavSection(section);
    },
  };
}
