<script>
  import { createEventDispatcher } from "svelte";
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
  import Toolbar from "./Toolbar.svelte";
  import CardItem from "./CardItem.svelte";

  export let cards = [];
  export let folderPath = "";
  export let selectedPath = null;
  export let loading = false;
  export let generation = 0;
  export let sortField = "mtime";
  export let sortDirection = "desc";
  export let availableTags = [];
  export let activeFilterTags = [];
  export let pinnedPaths = [];
  export let previewLines = 5;
  export let folderTree = [];
  export let includeSubfolders = true;
  export let isAllNotesScope = false;
  export let tooltipSide = "right";

  const dispatch = createEventDispatcher();

  const ESTIMATED_ROW_HEIGHT = 232;
  const OVERSCAN = 5;
  const USER_SCROLL_LOCK_MS = 180;

  let viewportEl = null;
  let viewportHeight = 0;
  let viewportWidth = 0;
  let scrollTop = 0;
  let columnCount = 1;

  let lastRangeStart = -1;
  let lastRangeEnd = -1;
  let lastHydrateGeneration = -1;

  let pendingLayoutAnchor = null;
  let projectedRows = [];
  let projectedRowKeys = [];
  let rowHeightMap = new Map();
  let rowKeys = [];
  let rowPositions = [];
  let totalHeight = 0;
  let visibleRows = [];
  let hydrateRange = { start: 0, end: 0 };
  let baseStartRowIndex = 0;
  let baseEndRowIndex = 0;
  let startRowIndex = 0;
  let endRowIndex = 0;
  let topPadding = 0;
  let bottomPadding = 0;
  let isAdjustingScroll = false;
  let userScrollLockUntilMs = 0;
  let lastMeasuredColumnCount = 1;

  function markUserScrolling() {
    userScrollLockUntilMs = Date.now() + USER_SCROLL_LOCK_MS;
  }

  function applyScrollTop(nextScrollTop) {
    if (!viewportEl) {
      return;
    }

    isAdjustingScroll = true;
    viewportEl.scrollTop = Math.max(0, nextScrollTop);
    scrollTop = viewportEl.scrollTop;
    isAdjustingScroll = false;
  }

  function rebuildPositionsFrom(fromIndex, heightDelta) {
    const start = Math.max(0, fromIndex);
    rowPositions.length = projectedRows.length;

    if (start === 0) {
      let y = 0;
      for (let i = 0; i < projectedRows.length; i++) {
        const row = projectedRows[i];
        rowPositions[i] = y;
        y += row ? rowHeightMap.get(row.key) || ESTIMATED_ROW_HEIGHT : ESTIMATED_ROW_HEIGHT;
      }
      totalHeight = y;
    } else {
      let y = rowPositions[start] ?? 0;
      for (let i = start; i < projectedRows.length; i++) {
        const row = projectedRows[i];
        rowPositions[i] = y;
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

    rowPositions = rowPositions;
  }

  function readNumber(value, fallbackValue) {
    const parsedValue = Number.parseFloat(value);
    return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
  }

  function syncViewportMetrics(node) {
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

  function bindViewport(node) {
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

  $: projectedRows = projectCardsToRows(cards, columnCount);
  $: projectedRowKeys = projectedRows.map((row) => row.key);
  $: baseStartRowIndex = findIndexAtOffset(scrollTop, rowPositions);
  $: baseEndRowIndex = findIndexAtOffset(scrollTop + viewportHeight, rowPositions);

  $: startRowIndex = Math.max(0, baseStartRowIndex - OVERSCAN);
  $: endRowIndex = Math.min(projectedRows.length, baseEndRowIndex + 1 + OVERSCAN);
  $: topPadding = rowPositions[startRowIndex] || 0;
  $: bottomPadding = endRowIndex < projectedRows.length ? totalHeight - (rowPositions[endRowIndex] || 0) : 0;
  $: visibleRows = projectedRows.slice(startRowIndex, endRowIndex);
  $: hydrateRange = getHydrateRangeForRows(projectedRows, startRowIndex, endRowIndex);

  $: if (generation !== lastHydrateGeneration) {
    lastHydrateGeneration = generation;
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

  $: if (columnCount !== lastMeasuredColumnCount) {
    lastMeasuredColumnCount = columnCount;
    rowHeightMap = new Map();
  }

  $: if (
    projectedRowKeys.length !== rowKeys.length ||
    projectedRowKeys.some((key, index) => key !== rowKeys[index])
  ) {
    rowKeys = projectedRowKeys;
    rebuildPositionsFrom(0);
  }

  $: {
    if (hydrateRange.start !== lastRangeStart || hydrateRange.end !== lastRangeEnd) {
      lastRangeStart = hydrateRange.start;
      lastRangeEnd = hydrateRange.end;
      dispatch("hydrate-range", hydrateRange);
    }
  }

  $: if (pendingLayoutAnchor && viewportEl) {
    applyScrollTop(
      computeAnchoredScrollTop({
        anchorCardIndex: pendingLayoutAnchor.anchorCardIndex,
        anchorOffset: pendingLayoutAnchor.anchorOffset,
        columnCount,
        rowPositions,
        cardCount: cards.length,
      }),
    );
    pendingLayoutAnchor = null;
  }

  $: if (cards.length === 0 && pendingLayoutAnchor) {
    pendingLayoutAnchor = null;
  }

  $: if (viewportWidth === 0 && viewportEl) {
    syncViewportMetrics(viewportEl);
  }

  function rowNeedsMeasuredHeight(row) {
    return row.cards.every((card) => card.hydrated);
  }

  function measureRow(node, row) {
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
      update(nextRow) {
        currentRow = nextRow;
      },
      destroy() {
        resizeObserver.disconnect();
      },
    };
  }

  function isLastRow(rowIndex) {
    return rowIndex === projectedRows.length - 1;
  }

  function getSpacerStyle(height) {
    return `height: ${height}px;`;
  }

  function getRowClass(rowIndex) {
    return `fce-wall-row${isLastRow(rowIndex) ? " is-last" : ""}`;
  }

  function getTopPaddingStyle() {
    return getSpacerStyle(topPadding);
  }

  function getBottomPaddingStyle() {
    return getSpacerStyle(bottomPadding);
  }

  function onScroll() {
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

<div class="fce-shell">
  <Toolbar
    {folderPath}
    {sortField}
    {sortDirection}
    {availableTags}
    {activeFilterTags}
    {folderTree}
    {includeSubfolders}
    {isAllNotesScope}
    {tooltipSide}
    on:toolbar-action
    on:sort-change
    on:filter-change
    on:include-subfolders-change
    on:select-folder
  />

  <div
    class="fce-list"
    bind:this={viewportEl}
    use:bindViewport
    on:scroll={onScroll}
    on:wheel={markUserScrolling}
  >
    {#if loading}
      <div class="fce-empty">Loading folder cards...</div>
    {:else if cards.length === 0}
      <div class="fce-empty">No Markdown notes found in this folder.</div>
    {:else}
      <div class="fce-virtual-spacer" style={getTopPaddingStyle()}></div>
      {#each visibleRows as row (row.key)}
        <div class={getRowClass(row.index)} use:measureRow={row}>
          <div class="fce-wall-row-grid" style={`--fce-column-count: ${columnCount};`}>
            {#each row.cards as card (card.path)}
                <CardItem
                  {card}
                  {pinnedPaths}
                  {previewLines}
                  selected={selectedPath === card.path}
                  on:open-note
                  on:card-context-menu
                  on:pin-toggle
              />
            {/each}
          </div>
        </div>
      {/each}
      <div class="fce-virtual-spacer" style={getBottomPaddingStyle()}></div>
    {/if}
  </div>
</div>
