<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import type { CardImageState } from "../images/types";
  import { DEFAULT_GROUP_SPEC } from "../card-grouping-settings";
  import { getUiStrings } from "../i18n";
  import Toolbar from "./Toolbar.svelte";
  import NavigationPane from "./NavigationPane.svelte";
  import CardItem from "./CardItem.svelte";
  import GroupHeaderRow from "./GroupHeaderRow.svelte";
  import type {
    OpenNotePayload,
    PanelModel,
    PanelModelState,
    PanelSearchState,
  } from "./panel-model";
  import {
    captureLayoutAnchor,
    captureRowAnchor,
    clampLayoutScrollTop,
    computeScrollAnchorDelta,
    resolveAnchoredScrollTop,
    type RowAnchorRef,
  } from "./scroll-anchoring";
  import {
    computeColumnCount,
    computeVirtualRowWindow,
    FALLBACK_GRID_GAP,
    FALLBACK_MIN_CARD_WIDTH,
    findIndexAtOffset,
    getHydrateRangeForPanelRows,
    projectPanelRows,
    type PanelRow,
  } from "./row-projection";
  import { pinnedHeaderAnchorOffset, resolveStickyGroupHeader } from "./sticky-group-header";
  import { buildRowPositions, createViewportRequest, getSpacerStyle, isBrowseFilterSwitch,
    readFiniteNumber, resolveBrowseFilterMode, resolvePanelScopeIdentity, type BrowseFilterMode } from "./virtual-layout";
  import type {
    CardHoverLinkPayload,
    FavoriteEntry,
    FolderActionPayload,
    NavContextMenuPayload,
    NavSectionId,
    NoteCardRecord,
  } from "./types";
  interface BulkSelectCardPayload {
    path: string;
    shiftKey: boolean;
  }
  interface CardContextMenuPayload {
    path: string;
    mouseEvent?: MouseEvent;
    trigger?: "button";
    position?: { x: number; y: number };
  }
  interface PinTogglePayload {
    path: string;
    pinned: boolean;
  }
  interface ToolbarActionPayload {
    action: string;
  }
  interface BoxCommandPayload {
    command: string;
    boxId?: string;
  }

  interface SortChangePayload {
    field: string;
    direction: string;
  }

  interface GroupChangePayload {
    dimension: string;
    propertyKey?: string;
    orderBy: string;
    orderDirection: string;
  }

  interface GroupCollapseCommandPayload {
    command: string;
    key?: string;
  }

  interface FilterChangePayload {
    tags: string[];
  }

  interface PropertyCommandPayload {
    command: "choose-visible" | "clear-filters";
  }
  interface IncludeSubfoldersChangePayload {
    value: boolean;
  }

  interface SearchQueryChangePayload {
    query: string;
  }

  interface SearchQueryResetPayload {
    source: "clear-button";
  }

  type SelectFolderPayload = Pick<FolderActionPayload, "path">;

  interface FolderCardPanelProps {
    panelModel: PanelModel;
    onOpenNote?: (payload: OpenNotePayload) => void;
    onToggleReferences?: (payload: { path: string }) => void;
    onBulkSelectCard?: (payload: BulkSelectCardPayload) => void;
    onCardContextMenu?: (payload: CardContextMenuPayload) => void;
    onPinToggle?: (payload: PinTogglePayload) => void;
    onCardHoverLink?: (payload: CardHoverLinkPayload) => void;
    onToolbarAction?: (payload: ToolbarActionPayload) => void;
    onSortChange?: (payload: SortChangePayload) => void;
    onGroupChange?: (payload: GroupChangePayload) => void;
    onGroupCollapseCommand?: (payload: GroupCollapseCommandPayload) => void;
    onFilterChange?: (payload: FilterChangePayload) => void;
    onPropertyCommand?: (payload: PropertyCommandPayload) => void;
    onIncludeSubfoldersChange?: (payload: IncludeSubfoldersChangePayload) => void;
    onSearchQueryChange?: (payload: SearchQueryChangePayload) => void;
    onSearchQueryReset?: (payload: SearchQueryResetPayload) => void;
    onSelectFolder?: (payload: SelectFolderPayload) => void;
    onFolderAction?: (payload: FolderActionPayload) => void;
    onBoxCommand?: (payload: BoxCommandPayload) => void;
    onNavContextMenu?: (payload: NavContextMenuPayload) => void;
    onNavigationIntent?: (payload: import("./navigation-model").NavigationIntent) => void;
    onFavoriteActivate?: (payload: { favorite: FavoriteEntry }) => void;
    onImageViewport?: (payload: import("./image-request").ImageViewportRequest) => void;
    resolveImagePlaceholder?: (path: string, generation: number) => CardImageState | undefined;
    onHydrateViewport?: (payload: ReturnType<typeof createViewportRequest>["request"]) => void;
    onNavPaneResize?: (width: number) => void;
    onShellResize?: (width: number) => void;
    onToggleNavPane?: () => void;
    onToggleNavSection?: (section: NavSectionId) => void;
  }

  const EMPTY_PANEL_STATE: PanelModelState = {
    strings: getUiStrings("en"),
    scope: {
      displayPath: "",
      includeSubfolders: true,
      activeBoxId: null,
      activeBoxName: null,
      boxExcludedCount: 0,
      emptyStateMessage: "",
      sourceIdentity: "folder::true",
      browseTagFilterEnabled: true,
      browsePropertyFilterEnabled: true,
      supportsIncludeSubfolders: true,
      supportsBoxRuleSeeding: true,
    },
    cards: {
      records: [],
      searchMatchCountsByPath: {},
      selectedPath: null,
      loading: false,
      generation: 0, sequenceRevision: 0, hydrationRevision: 0, extentCount: 0,
      groupSegments: [], groupRevision: 0,
    },
    search: { query: "", committedQuery: "", status: "idle", focusToken: 0 },
    projection: {
      sortField: "mtime",
      sortDirection: "desc",
      availableTags: [],
      tagCounts: {},
      activeFilterTags: [],
      pinnedPaths: [],
      group: DEFAULT_GROUP_SPEC,
      availableGroupDimensions: [],
      groupSegmentCount: 0, metadataStatus: "ready",
    },
    bulk: {
      bulkMode: false,
      selectedPaths: [],
      selectedCount: 0,
      bulkAnchorPath: null,
      canBulkSelectAll: false,
      canBulkClearSelection: false,
      canBulkMoveSelected: false,
      canBulkAddTagSelected: false,
      canBulkRemoveTagSelected: false,
      canBulkDeleteSelected: false,
      canBulkMergeSelected: false,
    },
    nav: {
      folderTree: [],
      favorites: [],
      boxSummaries: [],
      paneWidth: 240,
      layoutMode: "dual",
      visible: true,
      sectionCollapsed: { favorites: false, folders: false, tags: false, properties: false, boxes: false, links: false },
      showItemCounts: false,
      tooltipSide: "right",
      propertyFilterCount: 0,
      projection: { normalizedQuery: "", querying: false, sections: [], rows: [], noResults: false },
      query: "",
      focusId: null, focusRequest: null,
      revealRequest: null,
    },
    appearance: { cardCornerRadius: "compact", previewLines: 5, searchPreviewSnippetCount: 2, cardImageMode: "off", cardImageFit: "contain" },
    images: { byPath: {}, requestVersion: 0 },
  };

  let {
    panelModel,
    onOpenNote,
    onToggleReferences,
    onBulkSelectCard,
    onCardContextMenu,
    onPinToggle,
    onCardHoverLink,
    onToolbarAction,
    onSortChange,
    onGroupChange,
    onGroupCollapseCommand,
    onFilterChange,
    onPropertyCommand,
    onIncludeSubfoldersChange,
    onSearchQueryChange,
    onSearchQueryReset,
    onSelectFolder,
    onFolderAction,
    onBoxCommand,
    onNavContextMenu,
    onNavigationIntent,
    onFavoriteActivate,
    onHydrateViewport,
    onImageViewport,
    resolveImagePlaceholder,
    onNavPaneResize,
    onShellResize,
    onToggleNavPane,
    onToggleNavSection,
  }: FolderCardPanelProps = $props();

  let panelState = $state.raw<PanelModelState>(EMPTY_PANEL_STATE);

  $effect(() => {
    if (!panelModel || typeof panelModel.getState !== "function" || typeof panelModel.subscribe !== "function") {
      panelState = EMPTY_PANEL_STATE;
      return;
    }
    panelState = panelModel.getState();
    const unsubscribe = panelModel.subscribe((nextState) => {
      panelState = nextState;
    });
    return () => unsubscribe();
  });

  const strings = $derived(panelState.strings);
  const scope = $derived(panelState.scope);
  const cards = $derived(panelState.cards);
  const search = $derived(panelState.search);
  const projection = $derived(panelState.projection);
  const bulk = $derived(panelState.bulk);
  const nav = $derived(panelState.nav);
  const appearance = $derived(panelState.appearance);
  const images = $derived(panelState.images);
  const cardRecords = $derived(cards.records);
  const groupSegments = $derived(cards.groupSegments);

  function isBlockedSearchState(state: PanelSearchState): boolean {
    return (
      state.query.trim().length > 0 &&
      state.status !== "idle" &&
      state.status !== "ready"
    );
  }

  function getBlockedSearchLabel(state: PanelSearchState): string {
    const searchStrings = strings.toolbar.searchStatus;
    const status = state.status;
    const readiness = state.readiness ?? "ready";
    const persistence = state.persistence ?? "healthy";
    const rebuildReason = state.rebuildReason ?? null;

    if (status === "building") {
      return readiness === "restoring" ? searchStrings.buildingRestoring : searchStrings.building;
    }

    if (status === "rebuild-required") {
      if (rebuildReason === "version-drift") return searchStrings.rebuildVersionDrift;
      if (rebuildReason === "corrupt") return searchStrings.rebuildCorrupt;
      if (rebuildReason === "folder-rebuild-required") return searchStrings.rebuildFolderChanged;
      return searchStrings.rebuildRequired;
    }

    if (status === "storage-unavailable" || persistence === "storage-unavailable") {
      return searchStrings.storageUnavailable;
    }

    if (status === "error") {
      return searchStrings.error;
    }

    return searchStrings.unavailable;
  }

  const showSearchMatchCounts = $derived(!isBlockedSearchState(search));

  function handleCardOpenNote(detail: OpenNotePayload): void {
    onOpenNote?.(detail);
  }

  function handleCardBulkSelect(detail: BulkSelectCardPayload): void {
    onBulkSelectCard?.(detail);
  }

  function handleCardContextMenu(detail: CardContextMenuPayload): void {
    onCardContextMenu?.(detail);
  }

  function handleCardPinToggle(detail: PinTogglePayload): void {
    onPinToggle?.(detail);
  }

  function handleCardHoverLink(detail: CardHoverLinkPayload): void {
    onCardHoverLink?.(detail);
  }

  function handleBoxCommand(detail: BoxCommandPayload): void {
    onBoxCommand?.(detail);
  }

  function handleToolbarAction(detail: ToolbarActionPayload): void {
    onToolbarAction?.(detail);
  }

  function handleSortChange(detail: SortChangePayload): void {
    onSortChange?.(detail);
  }

  function handleGroupChange(detail: GroupChangePayload): void {
    onGroupChange?.(detail);
  }

  function handleGroupCollapseCommand(detail: GroupCollapseCommandPayload): void {
    onGroupCollapseCommand?.(detail);
  }

  function handleFilterChange(detail: FilterChangePayload): void {
    onFilterChange?.(detail);
  }

  function handleIncludeSubfoldersChange(detail: IncludeSubfoldersChangePayload): void {
    onIncludeSubfoldersChange?.(detail);
  }

  function handleSearchQueryChange(detail: SearchQueryChangePayload): void {
    onSearchQueryChange?.(detail);
  }

  function handleSearchQueryReset(detail: SearchQueryResetPayload): void {
    onSearchQueryReset?.(detail);
  }

  function handleSelectFolder(detail: SelectFolderPayload): void {
    onSelectFolder?.(detail);
  }

  function handleFolderAction(detail: FolderActionPayload): void {
    onFolderAction?.(detail);
  }

  function handleNavContextMenu(detail: NavContextMenuPayload): void {
    onNavContextMenu?.(detail);
  }

  function handleFavoriteActivate(detail: { favorite: FavoriteEntry }): void {
    onFavoriteActivate?.(detail);
  }

  function handleNavPaneResize(width: number): void {
    onNavPaneResize?.(width);
  }

  function handleToggleNavPane(): void {
    onToggleNavPane?.();
  }

  function handleToggleNavSection(section: NavSectionId): void {
    onToggleNavSection?.(section);
  }

  const ESTIMATED_ROW_HEIGHT = 232;
  const OVERSCAN = 5;
  const USER_SCROLL_LOCK_MS = 180;
  const panelInstanceId = $props.id();

  type ProjectedRow = PanelRow<NoteCardRecord>;
  type ProjectedCardRow = Extract<ProjectedRow, { kind: "cards" }>;

  let viewportEl = $state<HTMLDivElement | null>(null);
  let viewportHeight = $state(0);
  let viewportWidth = $state(0);
  let viewportActive = $state(false);
  let scrollTop = $state(0);
  let listPaddingTop = $state(0);
  let followingHeaderLead = $state(0);
  let listScrollbarWidth = $state(0);
  let stickyHeaderHeight = $state(0);
  let columnCount = $state(1);

  let lastRequestIdentity = $state<string | null>(null), lastProjectedScopeIdentity = $state<string | null>(null);
  let lastArrangementIdentity = $state<string | null>(null), lastBrowseFilterMode = $state<BrowseFilterMode>("none");

  /**
   * Read the old projected rows rather than incoming `groupSegments`: anchor
   * capture must describe the old layout during grouped-to-flat transitions.
   */
  function isFlatLayout(rows: readonly ProjectedRow[]): boolean {
    return rows[0]?.segmentIndex === -1;
  }

  let pendingLayoutAnchor = $state<{ ref: RowAnchorRef; offset: number } | null>(null);
  let rowHeightMap = $state<Map<string, number>>(new Map());
  let projectedRows = $state.raw<ProjectedRow[]>([]);
  let rowPositions = $state.raw<number[]>([]);
  let totalHeight = $state(0);
  let isAdjustingScroll = $state(false);
  let userScrollLockUntilMs = $state(0);
  let lastMeasuredColumnCount = $state(1);

  const scopeIdentity = $derived(resolvePanelScopeIdentity(scope));
  const baseStartRowIndex = $derived(findIndexAtOffset(scrollTop, rowPositions));
  const baseEndRowIndex = $derived(findIndexAtOffset(scrollTop + viewportHeight, rowPositions));
  const virtualWindow = $derived(computeVirtualRowWindow(
    projectedRows.length, baseStartRowIndex, baseEndRowIndex, OVERSCAN,
  ));
  const startRowIndex = $derived(virtualWindow.start);
  const endRowIndex = $derived(virtualWindow.end);
  const topPadding = $derived(rowPositions[startRowIndex] || 0);
  const bottomPadding = $derived(
    endRowIndex < projectedRows.length ? totalHeight - (rowPositions[endRowIndex] || 0) : 0,
  );
  const visibleRows = $derived(projectedRows.slice(startRowIndex, endRowIndex));
  const stickyGroupHeader = $derived(resolveStickyGroupHeader({
    scrollTop,
    listPaddingTop,
    followingHeaderLead,
    rowPositions,
    rows: projectedRows,
    headerHeight: stickyHeaderHeight,
  }));
  const viewportBounds = $derived(getHydrateRangeForPanelRows(projectedRows, startRowIndex, endRowIndex));
  const hydratePaths = $derived(cardRecords
    .slice(viewportBounds.start, viewportBounds.end)
    .map((card) => card.path));

  let lastImageRequestIdentity: string | null = null;
  const imageWindow = $derived(computeVirtualRowWindow(projectedRows.length, baseStartRowIndex, baseEndRowIndex, 1));
  const imageBounds = $derived(getHydrateRangeForPanelRows(projectedRows, imageWindow.start, imageWindow.end));
  const imagePaths = $derived(cardRecords.slice(imageBounds.start, imageBounds.end).map((card) => card.path));
  $effect(() => {
    const mode = appearance.cardImageMode ?? "off";
    if (mode === "off") { lastImageRequestIdentity = null; return; }
    if (!viewportActive) {
      const identity = `hidden:${cards.generation}:${cards.sequenceRevision}:${images.requestVersion}`;
      if (identity !== lastImageRequestIdentity) {
        lastImageRequestIdentity = identity;
        onImageViewport?.({ generation: cards.generation, sequenceRevision: cards.sequenceRevision,
          requestVersion: images.requestVersion, start: 0, end: 0, paths: [] });
      }
      return;
    }
    if (cards.loading || !viewportEl || viewportWidth === 0) { lastImageRequestIdentity = null; return; }
    const request = { generation: cards.generation, sequenceRevision: cards.sequenceRevision,
      requestVersion: images.requestVersion, start: imageBounds.start, end: imageBounds.end, paths: imagePaths };
    const identity = JSON.stringify([request.generation, request.sequenceRevision, request.requestVersion, request.paths]);
    if (identity === lastImageRequestIdentity) return;
    lastImageRequestIdentity = identity;
    onImageViewport?.(request);
  });

  // Capture the reading position before a layout switch changes mounted card sizes.
  let previousImageMode: string | null = null;
  $effect.pre(() => {
    const mode = appearance.cardImageMode ?? "off";
    untrack(() => {
      if (previousImageMode !== null && mode !== previousImageMode && projectedRows.length) {
        pendingLayoutAnchor = captureLayoutAnchor({ scrollTop, listPaddingTop, rowPositions, rows: projectedRows, preferCardIndex: false });
      }
      previousImageMode = mode;
    });
  });

  function markUserScrolling(): void {
    userScrollLockUntilMs = Date.now() + USER_SCROLL_LOCK_MS;
  }

  function applyScrollTop(nextScrollTop: number): void {
    if (!viewportEl) {
      return;
    }

    isAdjustingScroll = true;
    viewportEl.scrollTop = Math.max(0, nextScrollTop);
    scrollTop = viewportEl.scrollTop;
    isAdjustingScroll = false;
  }

  function rebuildPositionsFrom(fromIndex: number, heightDelta?: number): void {
    const start = Math.max(0, fromIndex);
    const layout = buildRowPositions(
      projectedRows, rowHeightMap, ESTIMATED_ROW_HEIGHT, rowPositions, start,
    );
    totalHeight = layout.totalHeight;

    const anchorDelta = computeScrollAnchorDelta({
      heightDelta: heightDelta ?? 0,
      changedRowIndex: start,
      firstVisibleRowIndex: baseStartRowIndex,
      nowMs: Date.now(),
      userScrollLockUntilMs,
    });

    if (anchorDelta !== 0 && viewportEl) {
      applyScrollTop(viewportEl.scrollTop + anchorDelta);
    }

    rowPositions = layout.positions;
    const clamped = clampLayoutScrollTop(scrollTop, totalHeight, viewportHeight);
    if (clamped !== scrollTop) applyScrollTop(clamped);
  }

  function syncViewportMetrics(node: HTMLDivElement): void {
    // A hidden pane measures 0 and would otherwise reset every cached row height.
    viewportActive = node.clientWidth > 0 && node.clientHeight > 0;
    if (!viewportActive) {
      return;
    }

    const styles = getComputedStyle(node);
    const horizontalPadding = readFiniteNumber(styles.paddingLeft, 0) + readFiniteNumber(styles.paddingRight, 0);
    listPaddingTop = readFiniteNumber(styles.paddingTop, 0);
    // Half the wall gap, matching `.fce-wall-group-row.is-following`. Absent in
    // unstyled tests, where the following row has no lead either.
    followingHeaderLead = readFiniteNumber(styles.getPropertyValue("--fce-wall-gap"), 0) * 0.5;
    listScrollbarWidth = Math.max(0, node.offsetWidth - node.clientWidth);
    const availableWidth = Math.max(0, node.clientWidth - horizontalPadding);
    const nextColumnCount = computeColumnCount({
      availableWidth,
      minCardWidth: readFiniteNumber(
        styles.getPropertyValue("--fce-card-min-width"),
        FALLBACK_MIN_CARD_WIDTH,
      ),
      columnGap: readFiniteNumber(styles.getPropertyValue("--fce-wall-gap"), FALLBACK_GRID_GAP),
    });

    if (nextColumnCount !== columnCount && projectedRows.length > 0) {
      pendingLayoutAnchor = captureLayoutAnchor({
        scrollTop,
        listPaddingTop,
        rowPositions,
        rows: projectedRows,
        preferCardIndex: isFlatLayout(projectedRows),
      });
    }

    viewportWidth = availableWidth;
    viewportHeight = node.clientHeight;
    columnCount = nextColumnCount;
    applyScrollTop(clampLayoutScrollTop(scrollTop, totalHeight, viewportHeight));
  }

  function bindShell(node: HTMLDivElement): { destroy: () => void } {
    const report = (): void => {
      onShellResize?.(node.clientWidth);
    };

    report();
    const resizeObserver = new ResizeObserver(report);
    resizeObserver.observe(node);

    return {
      destroy() {
        resizeObserver.disconnect();
      },
    };
  }

  function bindViewport(node: HTMLDivElement): { destroy: () => void } {
    viewportEl = node;
    syncViewportMetrics(node);

    const resizeObserver = new ResizeObserver(() => {
      syncViewportMetrics(node);
    });

    resizeObserver.observe(node);

    return {
      destroy() {
        resizeObserver.disconnect();
        if (viewportEl === node) {
          viewportEl = null;
        }
      },
    };
  }

  $effect(() => {
    if (columnCount !== lastMeasuredColumnCount) {
      lastMeasuredColumnCount = columnCount;
      rowHeightMap = new Map();
    }
  });

  $effect(() => {
    const nextScopeIdentity = scopeIdentity;
    const revision = cards.sequenceRevision;
    const groupRevision = cards.groupRevision;
    const nextArrangementIdentity = [projection.sortField, projection.sortDirection, projection.group.dimension, projection.group.propertyKey ?? "", projection.group.orderBy, projection.group.orderDirection].join("\u0000");
    const nextBrowseFilterMode = resolveBrowseFilterMode(scope, projection.activeFilterTags.length, nav.propertyFilterCount), columns = columnCount;
    untrack(() => {
      const scopeChanged = nextScopeIdentity !== lastProjectedScopeIdentity;
      const arrangementChanged = lastArrangementIdentity !== null && nextArrangementIdentity !== lastArrangementIdentity;
      const browseFilterSwitched = isBrowseFilterSwitch(lastBrowseFilterMode, nextBrowseFilterMode); lastBrowseFilterMode = nextBrowseFilterMode;
      lastProjectedScopeIdentity = nextScopeIdentity; lastArrangementIdentity = nextArrangementIdentity;
      if (scopeChanged) {
        // Keep old rows mounted through load start. On the complete scope
        // snapshot, reset scroll and project the replacement directly so no
        // empty row frame can appear between the two scopes.
        lastRequestIdentity = null;
        pendingLayoutAnchor = null;
        rowHeightMap = new Map();
        rowPositions = [];
        totalHeight = 0;
        applyScrollTop(0);
      } else if (arrangementChanged || browseFilterSwitched) {
        pendingLayoutAnchor = null; applyScrollTop(0);
      } else if (projectedRows.length > 0 && pendingLayoutAnchor === null) {
        // Ungrouped reorders hold the viewport position, as they did before
        // groups existed; only a grouped layout needs the card/group ref.
        pendingLayoutAnchor = captureLayoutAnchor({
          scrollTop, listPaddingTop, rowPositions, rows: projectedRows,
          preferCardIndex: isFlatLayout(projectedRows),
        });
      }
      projectedRows = projectPanelRows(cards.records, groupSegments, columns);
      rebuildPositionsFrom(0);
    });
    void nextScopeIdentity; void revision; void groupRevision; void nextArrangementIdentity; void nextBrowseFilterMode;
  });

  $effect(() => {
    if (!cards.loading && cardRecords.length > 0 && projectedRows.length === 0) {
      projectedRows = projectPanelRows(cardRecords, groupSegments, columnCount);
      rebuildPositionsFrom(0);
    }
  });

  $effect(() => {
    if (cards.loading) {
      lastRequestIdentity = null;
      return;
    }
    if (!viewportEl || viewportWidth === 0 || hydratePaths.length === 0) return;
    const { identity, request } = createViewportRequest(
      cards.generation, cards.hydrationRevision, viewportBounds.start, viewportBounds.end, hydratePaths,
    );
    if (identity === lastRequestIdentity) return;
    lastRequestIdentity = identity;
    onHydrateViewport?.(request);
  });

  $effect(() => {
    if (pendingLayoutAnchor && viewportEl) {
      const resolved = resolveAnchoredScrollTop({
        anchor: pendingLayoutAnchor,
        rows: projectedRows,
        rowPositions,
      });
      if (resolved !== null) {
        const next = clampLayoutScrollTop(resolved, totalHeight, viewportHeight);
        if (next !== scrollTop) applyScrollTop(next);
      }
      pendingLayoutAnchor = null;
    }
  });

  $effect(() => {
    if (cardRecords.length === 0 && groupSegments.length === 0 && pendingLayoutAnchor) {
      pendingLayoutAnchor = null;
    }
  });

  $effect(() => {
    if (viewportWidth === 0 && viewportEl) {
      syncViewportMetrics(viewportEl);
    }
  });

  function getRowCards(row: ProjectedCardRow): NoteCardRecord[] {
    return cardRecords.slice(row.startIndex, row.endIndex);
  }

  function getCardImage(path: string): CardImageState | undefined {
    if ((appearance.cardImageMode ?? "off") === "off") return undefined;
    const committed = cards.loading || images.generation === undefined || images.generation === cards.generation;
    return (committed ? images.byPath[path] : undefined)
      ?? (cards.loading ? undefined : resolveImagePlaceholder?.(path, cards.generation));
  }

  function rowNeedsMeasuredHeight(row: ProjectedRow): boolean {
    return row.kind === "group-header" || getRowCards(row).every((card) => card.hydrated);
  }

  function getGroupHeaderId(segmentIndex: number): string {
    return `${panelInstanceId}-group-${segmentIndex}`;
  }

  function getGroupAriaLabel(segmentIndex: number): string {
    const segment = groupSegments[segmentIndex];
    return segment ? strings.sortGroup.groupHeaderAria(segment.label, segment.count) : "";
  }

  function collapsesPinnedHeader(key: string): boolean {
    const segment = stickyGroupHeader ? groupSegments[stickyGroupHeader.segmentIndex] : undefined;
    return segment?.key === key && !segment.collapsed;
  }

  function handleGroupToggle(key: string): void {
    const rowIndex = projectedRows.findIndex((row) => row.kind === "group-header" && row.key === `h:${key}`);
    const row = projectedRows[rowIndex];
    const anchor = captureRowAnchor({ scrollTop, rowPositions, rows: projectedRows, rowIndex });
    // A pinned header has already left the viewport. Collapsing it parks that
    // header on the pin line, so the next group follows with no jump into later cards.
    pendingLayoutAnchor = anchor && row?.kind === "group-header" && collapsesPinnedHeader(key)
      ? {
          ref: anchor.ref,
          offset: pinnedHeaderAnchorOffset({
            listPaddingTop,
            followingHeaderLead,
            segmentIndex: row.segmentIndex,
          }),
        }
      : anchor;
    onGroupCollapseCommand?.({ command: "toggle", key });
  }

  const mountedRows = new Map<string, { node: HTMLDivElement; row: ProjectedRow }>();
  let forceRowMeasurement = false;
  let measureWindow: Window | null = null;
  const pendingRowSizes = new Map<string, { row: ProjectedRow; height: number }>();
  let measureFrame: number | null = null;
  function scheduleRowMeasurement(): void {
    if (measureFrame !== null) return;
    measureWindow = viewportEl?.ownerDocument.defaultView ?? window;
    measureFrame = measureWindow.requestAnimationFrame(flushRowSizes);
  }
  $effect(() => {
    void cardRecords;
    // A hydrated single-line/empty preview may have the same height as its
    // loading text. Recheck it even when ResizeObserver has no new size event.
    forceRowMeasurement = true;
    scheduleRowMeasurement();
  });
  function flushRowSizes(): void {
    measureFrame = null;
    if (forceRowMeasurement) {
      forceRowMeasurement = false;
      for (const [key, item] of mountedRows) if (rowNeedsMeasuredHeight(item.row)) {
        const height = item.node.getBoundingClientRect().height;
        if (height > 0) pendingRowSizes.set(key, { row: item.row, height });
      }
    }
    let first = projectedRows.length;
    const anchor = pendingLayoutAnchor ?? captureLayoutAnchor({ scrollTop, listPaddingTop, rowPositions, rows: projectedRows, preferCardIndex: false });
    for (const [key, item] of pendingRowSizes) {
      const current = projectedRows[item.row.index];
      if (current?.key !== key || !rowNeedsMeasuredHeight(current)) continue;
      const oldHeight = rowHeightMap.get(key) ?? ESTIMATED_ROW_HEIGHT;
      if (oldHeight !== item.height) { rowHeightMap.set(key, item.height); first = Math.min(first, current.index); }
    }
    pendingRowSizes.clear();
    if (first === projectedRows.length) return;
    const layout = buildRowPositions(projectedRows, rowHeightMap, ESTIMATED_ROW_HEIGHT, rowPositions, first);
    rowPositions = layout.positions; totalHeight = layout.totalHeight;
    const resolved = anchor && resolveAnchoredScrollTop({ anchor, rows: projectedRows, rowPositions });
    if (viewportEl) applyScrollTop(clampLayoutScrollTop(resolved ?? scrollTop, totalHeight, viewportHeight));
    pendingLayoutAnchor = null;
  }
  onDestroy(() => {
    if (measureFrame !== null) measureWindow?.cancelAnimationFrame(measureFrame);
    pendingRowSizes.clear(); mountedRows.clear();
  });
  function measureRow(node: HTMLDivElement, row: ProjectedRow): { update: (nextRow: ProjectedRow) => void; destroy: () => void } {
    let currentRow = row;
    mountedRows.set(row.key, { node, row });
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (!rowNeedsMeasuredHeight(currentRow)) continue;
        const height = entry.borderBoxSize && entry.borderBoxSize.length > 0
          ? entry.borderBoxSize[0].blockSize : entry.target.getBoundingClientRect().height;
        if (height > 0) pendingRowSizes.set(currentRow.key, { row: currentRow, height });
      }
      if (pendingRowSizes.size) scheduleRowMeasurement();
    });
    resizeObserver.observe(node);
    return { update(nextRow) { mountedRows.delete(currentRow.key); currentRow = nextRow; mountedRows.set(nextRow.key, { node, row: nextRow }); }, destroy() { resizeObserver.disconnect(); pendingRowSizes.delete(currentRow.key); mountedRows.delete(currentRow.key); } };
  }

  function isLastRow(rowIndex: number): boolean {
    return rowIndex === projectedRows.length - 1;
  }

  function getRowClass(rowIndex: number): string {
    return `fce-wall-row${isLastRow(rowIndex) ? " is-last" : ""}`;
  }

  function getTopPaddingStyle(): string {
    return getSpacerStyle(topPadding);
  }

  function getBottomPaddingStyle(): string {
    return getSpacerStyle(bottomPadding);
  }

  function handleScroll(): void {
    if (!viewportEl) {
      return;
    }

    if (!isAdjustingScroll) {
      markUserScrolling();
    }

    scrollTop = viewportEl.scrollTop;
    viewportHeight = viewportEl.clientHeight;
    listScrollbarWidth = Math.max(0, viewportEl.offsetWidth - viewportEl.clientWidth);
  }

  function handleStickyWheel(event: WheelEvent): void {
    if (!viewportEl || event.deltaY === 0) {
      return;
    }

    viewportEl.scrollTop += event.deltaY;
  }

  function measureStickyHeader(node: HTMLElement): { destroy: () => void } {
    const read = (): void => {
      const height = Math.round(node.offsetHeight);
      if (height > 0 && height !== stickyHeaderHeight) {
        stickyHeaderHeight = height;
      }
    };

    read();
    const resizeObserver = new ResizeObserver(read);
    resizeObserver.observe(node);

    return {
      destroy() {
        resizeObserver.disconnect();
      },
    };
  }
</script>

<div
  class="fce-shell {bulk.bulkMode ? 'is-bulk-mode' : ''} {nav.layoutMode === 'single' ? 'is-single' : 'is-dual'} {nav.visible ? 'is-nav-visible' : 'is-nav-hidden'}"
  use:bindShell
>
  <NavigationPane
    {strings}
    {nav}
    {scope}
    activeFilterTags={projection.activeFilterTags}
    onFolderAction={handleFolderAction}
    onFilterChange={handleFilterChange}
    {onPropertyCommand}
    onIncludeSubfoldersChange={handleIncludeSubfoldersChange}
    onBoxCommand={handleBoxCommand}
    onNavContextMenu={handleNavContextMenu}
    {onNavigationIntent}
    onNavPaneResize={handleNavPaneResize}
    onToggleNavPane={handleToggleNavPane}
  />
  <div class="fce-main-pane {bulk.bulkMode ? 'is-bulk-mode' : ''}">
  <Toolbar
    {strings}
    {scope}
    {search}
    {projection}
    visibleGroupProperties={nav.visibleGroupProperties ?? []}
    {bulk}
    boxSummaries={nav.boxSummaries}
    navVisible={nav.visible}
    onToggleNavPane={handleToggleNavPane}
    tooltipSide={nav.tooltipSide}
    onToolbarAction={handleToolbarAction}
    onSortChange={handleSortChange}
    onGroupChange={handleGroupChange}
    onGroupCollapseCommand={handleGroupCollapseCommand}
    onSearchQueryChange={handleSearchQueryChange}
    onSearchQueryReset={handleSearchQueryReset}
    onBoxCommand={handleBoxCommand}
  />
  <div class="fce-list-frame">
  <div
    class="fce-list {bulk.bulkMode ? 'is-bulk-mode' : ''}"
    bind:this={viewportEl}
    use:bindViewport
    onscroll={handleScroll}
    onwheel={markUserScrolling}
    aria-busy={cards.loading}
  >
    {#if cards.loading && cardRecords.length === 0}
      <div class="fce-empty">{strings.panel.loadingCards}</div>
   {:else if cardRecords.length === 0 && groupSegments.length === 0}
    {#if isBlockedSearchState(search)}
      <div class="fce-empty fce-search-blocked">
        <div class="fce-search-blocked-title">{strings.panel.searchBlockedTitle}</div>
        <div class="fce-search-blocked-status">
          {strings.panel.searchBlockedStatusPrefix} {getBlockedSearchLabel(search)}
        </div>
      </div>
    {:else}
      <div class="fce-empty">{scope.emptyStateMessage}</div>
    {/if}
    {:else}
      <div class="fce-virtual-spacer" style={getTopPaddingStyle()}></div>
      {#each visibleRows as row (row.key)}
        {#if row.kind === "group-header"}
          <!-- Segments render a frame ahead of the projection effect, so a shrinking table can briefly orphan a header row. -->
          {@const segment = groupSegments[row.segmentIndex]}
          {@const pinnedSource = stickyGroupHeader?.headerRowIndex === row.index}
          <div
            class="fce-wall-group-row"
            class:is-following={row.segmentIndex > 0}
            class:is-pinned-source={pinnedSource}
            aria-hidden={pinnedSource ? true : undefined}
            use:measureRow={row}
          >
            {#if segment}
              <GroupHeaderRow
                {segment}
                {strings}
                headerId={pinnedSource ? "" : getGroupHeaderId(row.segmentIndex)}
                onToggle={handleGroupToggle}
              />
            {/if}
          </div>
        {:else}
        <div
          class={getRowClass(row.index)}
          use:measureRow={row}
          role={row.segmentIndex === -1 ? undefined : "group"}
          aria-labelledby={row.segmentIndex === -1 ? undefined : `${panelInstanceId}-row-${row.index}-label`}
        >
          {#if row.segmentIndex !== -1}<span class="fce-sr-only" id={`${panelInstanceId}-row-${row.index}-label`}>{getGroupAriaLabel(row.segmentIndex)}</span>{/if}
          <div class="fce-wall-row-grid" style={`--fce-column-count: ${columnCount};`}>
            {#each getRowCards(row) as card (card.path)}
              <CardItem
                {card}
                {strings}
                {appearance}
                image={getCardImage(card.path)}
                pinnedPaths={projection.pinnedPaths}
                searchQuery={search.committedQuery}
                bulkMode={bulk.bulkMode}
                searchMatchCount={showSearchMatchCounts ? (cards.searchMatchCountsByPath[card.path] ?? 0) : 0}
                bulkSelected={bulk.bulkMode && bulk.selectedPaths.includes(card.path)}
                selected={cards.selectedPath === card.path}
                onOpenNote={handleCardOpenNote}
                {onToggleReferences}
                onBulkSelectCard={handleCardBulkSelect}
                onCardContextMenu={handleCardContextMenu}
                onPinToggle={handleCardPinToggle}
                onCardHoverLink={handleCardHoverLink}
              />
            {/each}
          </div>
        </div>
        {/if}
      {/each}
      <div class="fce-virtual-spacer" style={getBottomPaddingStyle()}></div>
    {/if}
  </div>
  {#if stickyGroupHeader}
    {@const segment = groupSegments[stickyGroupHeader.segmentIndex]}
    {#if segment}
      <div
        class="fce-sticky-group-header"
        style={`transform: translateY(${stickyGroupHeader.offset}px); right: ${listScrollbarWidth}px`}
        onwheel={handleStickyWheel}
      >
        <div class="fce-sticky-group-header-bar" use:measureStickyHeader>
          <GroupHeaderRow
            {segment}
            {strings}
            headerId={getGroupHeaderId(stickyGroupHeader.segmentIndex)}
            onToggle={handleGroupToggle}
          />
        </div>
      </div>
    {/if}
  {/if}
  </div>
  </div>
</div>
