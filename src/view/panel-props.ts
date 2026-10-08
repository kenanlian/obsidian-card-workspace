import type { PanelModel } from "./panel-model";
import type { HydrateViewportRequest } from "./hydration-request";
import type { CardHoverLinkPayload, FolderActionPayload, NavContextMenuPayload } from "./types";
import type { ViewModules } from "./view-modules";
import type { NavigationIntent } from "./navigation-model";
import type { CardOpenLocation } from "./link-card-location";

/** The slice of `FolderCardView` the panel callbacks route through. */
export interface PanelHost {
  panelModel: PanelModel;
  modules: ViewModules;
  plugin: {
    openNoteFromCard: (path: string, destination?: never, location?: CardOpenLocation) => Promise<void>;
  };
  resolveCardLocation?: (path: string) => CardOpenLocation | null;
  resolveSearchSnippetLocation?: (path: string, snippetId: string) => CardOpenLocation | null;
    handleToolbarAction: (detail: { action?: unknown }) => void;
    onIncludeSubfoldersChange: (detail: { value?: unknown }) => Promise<void>;
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
    onOpenNote: (detail: { path?: unknown; snippetId?: unknown; referenceId?: unknown; referenceTarget?: unknown }) => {
      if (view.modules.bulk.isBulkMode() || typeof detail.path !== "string") {
        return;
      }
      if (detail.referenceId !== undefined) {
        if (typeof detail.referenceId !== "string" || (detail.referenceTarget !== undefined && typeof detail.referenceTarget !== "boolean")) return;
        const resolved = view.modules.hydration.resolveReferenceLocation(detail.path, detail.referenceId, detail.referenceTarget === true);
        if (resolved) void view.plugin.openNoteFromCard(resolved.path, undefined, resolved.location);
        return;
      }
      if (detail.snippetId !== undefined && typeof detail.snippetId !== "string") return;
      const location = typeof detail.snippetId === "string"
        ? view.resolveSearchSnippetLocation?.(detail.path, detail.snippetId)
        : view.resolveCardLocation?.(detail.path);
      if (detail.snippetId !== undefined && !location) return;
      if (location) void view.plugin.openNoteFromCard(detail.path, undefined, location);
      else void view.plugin.openNoteFromCard(detail.path);
    },
    onToggleReferences: (detail: { path?: unknown }) => {
      if (typeof detail.path === "string" && !view.modules.bulk.isBulkMode()) void view.modules.hydration.toggleReferences(detail.path).catch((error: unknown) => console.warn("Card Workspace reference preview failed", error));
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
    onImageViewport: (detail: unknown) => {
      if (typeof detail !== "object" || detail === null) return;
      const request = detail as import("./image-request").ImageViewportRequest;
      if (!Number.isInteger(request.generation) || !Number.isInteger(request.sequenceRevision)
        || !Number.isInteger(request.requestVersion) || !Number.isInteger(request.start) || !Number.isInteger(request.end) || !Array.isArray(request.paths)
        || !request.paths.every((path: unknown) => typeof path === "string")) return;
      view.modules.images.requestViewport(request);
    },
    resolveImagePlaceholder: (path: string, generation: number) =>
      view.modules.images.resolvePlaceholder(path, generation),
    onImageReveal: (detail: import("./image-request").CardImageRevealRequest) =>
      view.modules.images.handleImageReveal(detail),
    onToolbarAction: (detail: { action?: unknown }) => {
      view.handleToolbarAction(detail);
    },
    onSortChange: (detail: { field?: unknown; direction?: unknown }) => {
      void view.modules.arrangementActions.onSortChange(detail);
    },
    onGroupChange: (detail: { dimension?: unknown; propertyKey?: unknown; orderBy?: unknown; orderDirection?: unknown }) => {
      void view.modules.arrangementActions.onGroupChange(detail);
    },
    onGroupCollapseCommand: (detail: { command?: unknown; key?: unknown }) => {
      view.modules.arrangementActions.onGroupCollapseCommand(detail);
    },
    onFilterChange: (detail: { tags?: unknown }) => {
      void view.modules.tagActions.onFilterChange(detail);
    },
    onPropertyCommand: (detail: { command?: unknown }) => {
      if (detail.command === "choose-visible") {
        view.modules.propertyActions.chooseVisibleProperties();
      } else if (detail.command === "clear-filters") {
        void view.modules.propertyActions.clearPropertyFilters();
      }
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
      void view.modules.arrangementActions.onPinToggle(detail);
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
