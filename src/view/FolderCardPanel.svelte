<script lang="ts">
  import { untrack } from "svelte";
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
  import { buildRowPositions, createViewportRequest, getSpacerStyle,
    readFiniteNumber, resolvePanelScopeIdentity } from "./virtual-layout";
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
    onBulkSelectCard?: (payload: BulkSelectCardPayload) => void;
    onCardContextMenu?: (payload: CardContextMenuPayload) => void;
    onPinToggle?: (payload: PinTogglePayload) => void;
    onCardHoverLink?: (payload: CardHoverLinkPayload) => void;
    onToolbarAction?: (payload: ToolbarActionPayload) => void;
    onSortChange?: (payload: SortChangePayload) => void;
    onGroupChange?: (payload: GroupChangePayload) => void;
    onGroupCollapseCommand?: (payload: GroupCollapseCommandPayload) => void;
    onFilterChange?: (payload: FilterChangePayload) => void;
    onIncludeSubfoldersChange?: (payload: IncludeSubfoldersChangePayload) => void;
    onSearchQueryChange?: (payload: SearchQueryChangePayload) => void;
    onSearchQueryReset?: (payload: SearchQueryResetPayload) => void;
    onSelectFolder?: (payload: SelectFolderPayload) => void;
    onFolderAction?: (payload: FolderActionPayload) => void;
    onBoxCommand?: (payload: BoxCommandPayload) => void;
    onNavContextMenu?: (payload: NavContextMenuPayload) => void;
    onNavigationIntent?: (payload: import("./navigation-model").NavigationIntent) => void;
    onFavoriteActivate?: (payload: { favorite: FavoriteEntry }) => void;
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
    },
    cards: {
      records: [],
      searchMatchCountsByPath: {},
      selectedPath: null,
      loading: false,
      generation: 0, sequenceRevision: 0, hydrationRevision: 0,
      groupSegments: [], groupRevision: 0,
    },
    search: { query: "", status: "idle", focusToken: 0 },
    projection: {
      sortField: "mtime",
      sortDirection: "desc",
      availableTags: [],
      tagCounts: {},
      activeFilterTags: [],
      pinnedPaths: [],
      group: DEFAULT_GROUP_SPEC,
      availableGroupDimensions: [],
      groupSegmentCount: 0,
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
      sectionCollapsed: { favorites: false, folders: false, tags: false, boxes: false },
      showItemCounts: false,
      tooltipSide: "right",
      projection: { normalizedQuery: "", querying: false, sections: [], rows: [], noResults: false },
      query: "",
      focusId: null, focusRequest: null,
      revealRequest: null,
    },
    appearance: { cardCornerRadius: "compact", previewLines: 5 },
  };

  let {
    panelModel,
    onOpenNote,
    onBulkSelectCard,
    onCardContextMenu,
    onPinToggle,
    onCardHoverLink,
    onToolbarAction,
    onSortChange,
    onGroupChange,
    onGroupCollapseCommand,
    onFilterChange,
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
    onNavPaneResize,
    onShellResize,
    onToggleNavPane,
    onToggleNavSection,
  }: FolderCardPanelProps = $props();

  let panelState = $state.raw<PanelModelState>(EMPTY_PANEL_STATE);

  $effect(() => {
    if (
      !panelModel ||
      typeof panelModel.getState !== "function" ||
      typeof panelModel.subscribe !== "function"
    ) {
      panelState = EMPTY_PANEL_STATE;
      return;
    }

    panelState = panelModel.getState();
    const unsubscribe = panelModel.subscribe((nextState) => {
      panelState = nextState;
    });

    return () => {
      unsubscribe();
    };
  });

  const strings = $derived(panelState.strings);
  const scope = $derived(panelState.scope);
  const cards = $derived(panelState.cards);
  const search = $derived(panelState.search);
  const projection = $derived(panelState.projection);
  const bulk = $derived(panelState.bulk);
  const nav = $derived(panelState.nav);
  const appearance = $derived(panelState.appearance);
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

  type ProjectedRow = PanelRow<{ path: string }>;
  type ProjectedCardRow = Extract<ProjectedRow, { kind: "cards" }>;

  let viewportEl = $state<HTMLDivElement | null>(null);
  let viewportHeight = $state(0);
  let viewportWidth = $state(0);
  let scrollTop = $state(0);
  let columnCount = $state(1);

  let lastRequestIdentity = $state<string | null>(null);
  let lastScopeIdentity = $state<string | null>(null);

  /**
   * Whether a projected layout has no group headers. Read from the rows rather
   * than from `groupSegments`, because at capture time `groupSegments` is the
   * incoming publish while `projectedRows` is still the previous layout — on a
   * grouped-to-flat transition those disagree, and the anchor must describe the
   * layout it was captured from. `projectPanelRows` stamps `segmentIndex: -1`
   * on every row of an ungrouped projection and a header at row 0 otherwise.
   */
  function isFlatLayout(rows: readonly ProjectedRow[]): boolean {
    return rows[0]?.segmentIndex === -1;
  }

  let pendingLayoutAnchor = $state<{ ref: RowAnchorRef; offset: number } | null>(null);
  let rowHeightMap = $state<Map<string, number>>(new Map());
  let projectedRows = $state<ProjectedRow[]>([]);
  let rowPositions = $state<number[]>([]);
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
  const viewportBounds = $derived(getHydrateRangeForPanelRows(projectedRows, startRowIndex, endRowIndex));
  const hydratePaths = $derived(cardRecords
    .slice(viewportBounds.start, viewportBounds.end)
    .map((card) => card.path));

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
    if (node.clientWidth === 0) {
      return;
    }

    const styles = getComputedStyle(node);
    const horizontalPadding = readFiniteNumber(styles.paddingLeft, 0) + readFiniteNumber(styles.paddingRight, 0);
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
    if (scopeIdentity !== lastScopeIdentity) {
      lastScopeIdentity = scopeIdentity;
      lastRequestIdentity = null;
      pendingLayoutAnchor = null;
      rowHeightMap = new Map();
      projectedRows = [];
      rowPositions = [];
      totalHeight = 0;
      applyScrollTop(0);
    }
  });

  $effect(() => {
    if (columnCount !== lastMeasuredColumnCount) {
      lastMeasuredColumnCount = columnCount;
      rowHeightMap = new Map();
    }
  });

  $effect(() => {
    const revision = cards.sequenceRevision;
    const groupRevision = cards.groupRevision;
    const columns = columnCount;
    untrack(() => {
      if (projectedRows.length > 0 && pendingLayoutAnchor === null) {
        // Ungrouped reorders hold the viewport position, as they did before
        // groups existed; only a grouped layout needs the card/group ref.
        pendingLayoutAnchor = captureLayoutAnchor({
          scrollTop, rowPositions, rows: projectedRows,
          preferCardIndex: isFlatLayout(projectedRows),
        });
      }
      projectedRows = projectPanelRows(cards.records.map((card) => ({ path: card.path })), groupSegments, columns);
      rebuildPositionsFrom(0);
    });
    void revision;
    void groupRevision;
  });

  $effect(() => {
    if (!cards.loading && cardRecords.length > 0 && projectedRows.length === 0) {
      projectedRows = projectPanelRows(cardRecords.map((card) => ({ path: card.path })), groupSegments, columnCount);
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
        applyScrollTop(clampLayoutScrollTop(resolved, totalHeight, viewportHeight));
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

  function handleGroupToggle(key: string): void {
    const rowIndex = projectedRows.findIndex((row) => row.kind === "group-header" && row.key === `h:${key}`);
    pendingLayoutAnchor = captureRowAnchor({ scrollTop, rowPositions, rows: projectedRows, rowIndex });
    onGroupCollapseCommand?.({ command: "toggle", key });
  }

  function measureRow(node: HTMLDivElement, row: ProjectedRow): { update: (nextRow: ProjectedRow) => void; destroy: () => void } {
    let currentRow = row;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (!rowNeedsMeasuredHeight(currentRow)) {
          continue;
        }

        const height = entry.borderBoxSize && entry.borderBoxSize.length > 0
          ? entry.borderBoxSize[0].blockSize
          : entry.target.getBoundingClientRect().height;
        const roundedHeight = Math.round(height);
        const oldHeight = rowHeightMap.get(currentRow.key) || ESTIMATED_ROW_HEIGHT;

        if (oldHeight !== roundedHeight) {
          rowHeightMap.set(currentRow.key, roundedHeight);
          rebuildPositionsFrom(currentRow.index, roundedHeight - oldHeight);
        }
      }
    });

    resizeObserver.observe(node);

    return {
      update(nextRow: ProjectedRow) {
        currentRow = nextRow;
      },
      destroy() {
        resizeObserver.disconnect();
      },
    };
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
          <div class="fce-wall-group-row" use:measureRow={row}>
            {#if segment}
              <GroupHeaderRow
                {segment}
                {strings}
                headerId={getGroupHeaderId(row.segmentIndex)}
                onToggle={handleGroupToggle}
              />
            {/if}
          </div>
        {:else}
        <div
          class={getRowClass(row.index)}
          use:measureRow={row}
          role={row.segmentIndex === -1 ? undefined : "group"}
          aria-labelledby={row.segmentIndex === -1 ? undefined : getGroupHeaderId(row.segmentIndex)}
          aria-label={row.segmentIndex === -1 ? undefined : getGroupAriaLabel(row.segmentIndex)}
        >
          <div class="fce-wall-row-grid" style={`--fce-column-count: ${columnCount};`}>
            {#each getRowCards(row) as card (card.path)}
              <CardItem
                {card}
                {strings}
                {appearance}
                pinnedPaths={projection.pinnedPaths}
                searchQuery={search.query}
                bulkMode={bulk.bulkMode}
                searchMatchCount={showSearchMatchCounts ? (cards.searchMatchCountsByPath[card.path] ?? 0) : 0}
                bulkSelected={bulk.bulkMode && bulk.selectedPaths.includes(card.path)}
                selected={cards.selectedPath === card.path}
                onOpenNote={handleCardOpenNote}
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
  </div>
</div>
