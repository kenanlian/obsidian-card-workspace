<script lang="ts">
  import { getUiStrings } from "../i18n";
  import Toolbar from "./Toolbar.svelte";
  import NavigationPane from "./NavigationPane.svelte";
  import CardItem from "./CardItem.svelte";
  import type {
    OpenNotePayload,
    PanelModel,
    PanelModelState,
    PanelSearchState,
  } from "./panel-model";
  import {
    captureScrollAnchor,
    computeAnchoredScrollTop,
    computeScrollAnchorDelta,
  } from "./scroll-anchoring";
  import {
    computeColumnCount,
    FALLBACK_GRID_GAP,
    FALLBACK_MIN_CARD_WIDTH,
    findIndexAtOffset,
    getHydrateRangeForRows,
    projectCardsToRows,
  } from "./row-projection";
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

  interface HydrateRangePayload {
    start: number;
    end: number;
  }

  interface FolderCardPanelProps {
    panelModel: PanelModel;
    onOpenNote?: (payload: OpenNotePayload) => void;
    onBulkSelectCard?: (payload: BulkSelectCardPayload) => void;
    onCardContextMenu?: (payload: CardContextMenuPayload) => void;
    onPinToggle?: (payload: PinTogglePayload) => void;
    onCardHoverLink?: (payload: CardHoverLinkPayload) => void;
    onToolbarAction?: (payload: ToolbarActionPayload) => void;
    onSortChange?: (payload: SortChangePayload) => void;
    onFilterChange?: (payload: FilterChangePayload) => void;
    onIncludeSubfoldersChange?: (payload: IncludeSubfoldersChangePayload) => void;
    onSearchQueryChange?: (payload: SearchQueryChangePayload) => void;
    onSearchQueryReset?: (payload: SearchQueryResetPayload) => void;
    onSelectFolder?: (payload: SelectFolderPayload) => void;
    onFolderAction?: (payload: FolderActionPayload) => void;
    onBoxCommand?: (payload: BoxCommandPayload) => void;
    onNavContextMenu?: (payload: NavContextMenuPayload) => void;
    onFavoriteActivate?: (payload: { favorite: FavoriteEntry }) => void;
    onHydrateRange?: (payload: HydrateRangePayload) => void;
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
      generation: 0,
    },
    search: { query: "", status: "idle", focusToken: 0 },
    projection: {
      sortField: "mtime",
      sortDirection: "desc",
      availableTags: [],
      tagCounts: {},
      activeFilterTags: [],
      pinnedPaths: [],
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
    onFilterChange,
    onIncludeSubfoldersChange,
    onSearchQueryChange,
    onSearchQueryReset,
    onSelectFolder,
    onFolderAction,
    onBoxCommand,
    onNavContextMenu,
    onFavoriteActivate,
    onHydrateRange,
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

  type ProjectedRow = ReturnType<typeof projectCardsToRows<NoteCardRecord>>[number];

  let viewportEl = $state<HTMLDivElement | null>(null);
  let viewportHeight = $state(0);
  let viewportWidth = $state(0);
  let scrollTop = $state(0);
  let columnCount = $state(1);

  let lastRangeStart = $state(-1);
  let lastRangeEnd = $state(-1);
  let lastHydrateGeneration = $state(-1);

  let pendingLayoutAnchor = $state<{ anchorCardIndex: number; anchorOffset: number } | null>(null);
  let rowHeightMap = $state<Map<string, number>>(new Map());
  let rowKeys = $state<string[]>([]);
  let rowPositions = $state<number[]>([]);
  let totalHeight = $state(0);
  let isAdjustingScroll = $state(false);
  let userScrollLockUntilMs = $state(0);
  let lastMeasuredColumnCount = $state(1);

  const projectedRows = $derived(projectCardsToRows(cardRecords, columnCount));
  const projectedRowKeys = $derived(projectedRows.map((row) => row.key));
  const baseStartRowIndex = $derived(findIndexAtOffset(scrollTop, rowPositions));
  const baseEndRowIndex = $derived(findIndexAtOffset(scrollTop + viewportHeight, rowPositions));
  const startRowIndex = $derived(Math.max(0, baseStartRowIndex - OVERSCAN));
  const endRowIndex = $derived(Math.min(projectedRows.length, baseEndRowIndex + 1 + OVERSCAN));
  const topPadding = $derived(rowPositions[startRowIndex] || 0);
  const bottomPadding = $derived(
    endRowIndex < projectedRows.length ? totalHeight - (rowPositions[endRowIndex] || 0) : 0,
  );
  const visibleRows = $derived(projectedRows.slice(startRowIndex, endRowIndex));
  const hydrateRange = $derived(getHydrateRangeForRows(projectedRows, startRowIndex, endRowIndex));

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
    const nextRowPositions = [...rowPositions];
    nextRowPositions.length = projectedRows.length;

    if (start === 0) {
      let y = 0;
      for (let i = 0; i < projectedRows.length; i += 1) {
        const row = projectedRows[i];
        nextRowPositions[i] = y;
        y += row ? rowHeightMap.get(row.key) || ESTIMATED_ROW_HEIGHT : ESTIMATED_ROW_HEIGHT;
      }
      totalHeight = y;
    } else {
      let y = nextRowPositions[start] ?? 0;
      for (let i = start; i < projectedRows.length; i += 1) {
        const row = projectedRows[i];
        nextRowPositions[i] = y;
        y += row ? rowHeightMap.get(row.key) || ESTIMATED_ROW_HEIGHT : ESTIMATED_ROW_HEIGHT;
      }
      totalHeight = y;
    }

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

    rowPositions = nextRowPositions;
  }

  function readNumber(value: string, defaultValue: number): number {
    const parsedValue = Number.parseFloat(value);
    return Number.isFinite(parsedValue) ? parsedValue : defaultValue;
  }

  function syncViewportMetrics(node: HTMLDivElement): void {
    // A hidden pane measures 0 and would otherwise reset every cached row height.
    if (node.clientWidth === 0) {
      return;
    }

    const styles = getComputedStyle(node);
    const horizontalPadding = readNumber(styles.paddingLeft, 0) + readNumber(styles.paddingRight, 0);
    const availableWidth = Math.max(0, node.clientWidth - horizontalPadding);
    const nextColumnCount = computeColumnCount({
      availableWidth,
      minCardWidth: readNumber(
        styles.getPropertyValue("--fce-card-min-width"),
        FALLBACK_MIN_CARD_WIDTH,
      ),
      columnGap: readNumber(styles.getPropertyValue("--fce-wall-gap"), FALLBACK_GRID_GAP),
    });

    if (nextColumnCount !== columnCount && projectedRows.length > 0) {
      pendingLayoutAnchor = captureScrollAnchor({
        scrollTop,
        rowPositions,
        rows: projectedRows,
      });
    }

    viewportWidth = availableWidth;
    viewportHeight = node.clientHeight;
    columnCount = nextColumnCount;
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
    if (cards.generation !== lastHydrateGeneration) {
      lastHydrateGeneration = cards.generation;
      lastRangeStart = -1;
      lastRangeEnd = -1;
      pendingLayoutAnchor = null;
      rowHeightMap = new Map();
      rowKeys = [];
      rowPositions = [];
      totalHeight = 0;
      lastMeasuredColumnCount = columnCount;
      rebuildPositionsFrom(0);
    }
  });

  $effect(() => {
    if (columnCount !== lastMeasuredColumnCount) {
      lastMeasuredColumnCount = columnCount;
      rowHeightMap = new Map();
    }
  });

  $effect(() => {
    if (
      projectedRowKeys.length !== rowKeys.length ||
      projectedRowKeys.some((key, index) => key !== rowKeys[index])
    ) {
      rowKeys = projectedRowKeys;
      rebuildPositionsFrom(0);
    }
  });

  $effect(() => {
    if (hydrateRange.start !== lastRangeStart || hydrateRange.end !== lastRangeEnd) {
      lastRangeStart = hydrateRange.start;
      lastRangeEnd = hydrateRange.end;
      onHydrateRange?.(hydrateRange);
    }
  });

  $effect(() => {
    if (pendingLayoutAnchor && viewportEl) {
      applyScrollTop(
        computeAnchoredScrollTop({
          anchorCardIndex: pendingLayoutAnchor.anchorCardIndex,
          anchorOffset: pendingLayoutAnchor.anchorOffset,
          columnCount,
          rowPositions,
          cardCount: cardRecords.length,
        }),
      );
      pendingLayoutAnchor = null;
    }
  });

  $effect(() => {
    if (cardRecords.length === 0 && pendingLayoutAnchor) {
      pendingLayoutAnchor = null;
    }
  });

  $effect(() => {
    if (viewportWidth === 0 && viewportEl) {
      syncViewportMetrics(viewportEl);
    }
  });

  function rowNeedsMeasuredHeight(row: ProjectedRow): boolean {
    return row.cards.every((card) => card.hydrated);
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

  function getSpacerStyle(height: number): string {
    return `height: ${height}px;`;
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
    availableTags={projection.availableTags}
    tagCounts={projection.tagCounts}
    activeFilterTags={projection.activeFilterTags}
    onSelectFolder={handleSelectFolder}
    onFolderAction={handleFolderAction}
    onFilterChange={handleFilterChange}
    onIncludeSubfoldersChange={handleIncludeSubfoldersChange}
    onBoxCommand={handleBoxCommand}
    onNavContextMenu={handleNavContextMenu}
    onFavoriteActivate={handleFavoriteActivate}
    onNavPaneResize={handleNavPaneResize}
    onToggleNavPane={handleToggleNavPane}
    onToggleNavSection={handleToggleNavSection}
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
  >
    {#if cards.loading}
      <div class="fce-empty">{strings.panel.loadingCards}</div>
   {:else if cardRecords.length === 0}
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
        <div class={getRowClass(row.index)} use:measureRow={row}>
          <div class="fce-wall-row-grid" style={`--fce-column-count: ${columnCount};`}>
            {#each row.cards as card (card.path)}
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
      {/each}
      <div class="fce-virtual-spacer" style={getBottomPaddingStyle()}></div>
    {/if}
  </div>
  </div>
</div>
