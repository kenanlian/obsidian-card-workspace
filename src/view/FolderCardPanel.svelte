<script>
  import { computeScrollAnchorDelta } from "./scroll-anchoring";
  import { createEventDispatcher } from "svelte";
  import Toolbar from "./Toolbar.svelte";
  import CardItem from "./CardItem.svelte";

  export let cards = [];
  export let folderPath = "";
  export let selectedPath = null;
  export let loading = false;
  export let generation = 0;
  export let sortField = "mtime";
  export let sortDirection = "desc";
  export let folderTree = [];
  export let tooltipSide = "right";

  const dispatch = createEventDispatcher();

  const ESTIMATED_CARD_HEIGHT = 220;
  const OVERSCAN = 5;
  const USER_SCROLL_LOCK_MS = 180;

  let viewportEl = null;
  let viewportHeight = 0;
  let scrollTop = 0;

  let lastRangeStart = -1;
  let lastRangeEnd = -1;
  let lastHydrateGeneration = -1;

  let heightMap = new Map();
  let positions = [];
  let totalHeight = 0;
  let isAdjustingScroll = false;
  let userScrollLockUntilMs = 0;

  function markUserScrolling() {
    userScrollLockUntilMs = Date.now() + USER_SCROLL_LOCK_MS;
  }

  function rebuildPositionsFrom(fromIndex, heightDelta) {
    const start = Math.max(0, fromIndex);
    if (start === 0) {
      let y = 0;
      for (let i = 0; i < cards.length; i++) {
        positions[i] = y;
        y += heightMap.get(cards[i]?.path) || ESTIMATED_CARD_HEIGHT;
      }
      totalHeight = y;
    } else {
      let y = positions[start] ?? 0;
      for (let i = start; i < cards.length; i++) {
        positions[i] = y;
        y += heightMap.get(cards[i]?.path) || ESTIMATED_CARD_HEIGHT;
      }
      totalHeight = y;
    }

    // Scroll anchoring: if a card at or above the first visible card changed
    // height, compensate scrollTop so the visible content stays in place.
    const anchorDelta = computeScrollAnchorDelta({
      heightDelta: heightDelta ?? 0,
      changedIndex: start,
      firstVisibleIndex: baseStartIndex,
      nowMs: Date.now(),
      userScrollLockUntilMs,
    });

    if (anchorDelta !== 0 && viewportEl) {
      isAdjustingScroll = true;
      viewportEl.scrollTop += anchorDelta;
      scrollTop = viewportEl.scrollTop;
      isAdjustingScroll = false;
    }

    positions = positions; // single reactive assignment to trigger viewport recalc
  }

  function findStartIndex(scrollTopValue, posArray) {
    if (posArray.length === 0) return 0;
    let low = 0;
    let high = posArray.length - 1;
    let match = 0;
    while (low <= high) {
      let mid = Math.floor((low + high) / 2);
      if (posArray[mid] <= scrollTopValue) {
        match = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return match;
  }

  $: baseStartIndex = findStartIndex(scrollTop, positions);
  $: baseEndIndex = findStartIndex(scrollTop + viewportHeight, positions);

  $: startIndex = Math.max(0, baseStartIndex - OVERSCAN);
  $: endIndex = Math.min(cards.length, baseEndIndex + 1 + OVERSCAN);
  $: topPadding = positions[startIndex] || 0;
  $: bottomPadding = endIndex < cards.length ? totalHeight - (positions[endIndex] || 0) : 0;
  $: visibleCards = cards.slice(startIndex, endIndex);

  $: if (generation !== lastHydrateGeneration) {
    lastHydrateGeneration = generation;
    lastRangeStart = -1;
    lastRangeEnd = -1;
    heightMap = new Map();
    positions = [];
    totalHeight = 0;
    rebuildPositionsFrom(0);
  }

  $: if (cards.length !== positions.length) {
    rebuildPositionsFrom(0);
  }

  $: {
    if (startIndex !== lastRangeStart || endIndex !== lastRangeEnd) {
      lastRangeStart = startIndex;
      lastRangeEnd = endIndex;
      dispatch("hydrate-range", { start: startIndex, end: endIndex });
    }
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

  function measureHeight(node, cardPath) {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Skip measurement for cards that haven't been hydrated yet.
        // Their placeholder height ("Loading preview...") is much smaller
        // than the estimated height, and recording it causes totalHeight
        // to fluctuate wildly during scrolling, which destabilizes the
        // scroll position.
        const card = cards.find((c) => c.path === cardPath);
        if (card && !card.hydrated) {
          continue;
        }

        // use borderBoxSize if available, fallback to getBoundingClientRect
        let height = entry.borderBoxSize && entry.borderBoxSize.length > 0 
          ? entry.borderBoxSize[0].blockSize 
          : entry.target.getBoundingClientRect().height;
        
        height += 12; // Add margin-bottom (12px)
        const roundedHeight = Math.round(height);
        
        const oldHeight = heightMap.get(cardPath) || ESTIMATED_CARD_HEIGHT;
        if (oldHeight !== roundedHeight) {
          heightMap.set(cardPath, roundedHeight);
          const cardIndex = cards.findIndex((c) => c.path === cardPath);
          if (cardIndex !== -1) {
            rebuildPositionsFrom(cardIndex, roundedHeight - oldHeight);
          }
        }
      }
    });
    
    resizeObserver.observe(node);
    
    return {
      update(newCardPath) {
        cardPath = newCardPath;
      },
      destroy() {
        resizeObserver.disconnect();
      }
    };
  }
</script>

<div class="fce-shell">
  <Toolbar
    {folderPath}
    {sortField}
    {sortDirection}
    {folderTree}
    {tooltipSide}
    on:toolbar-action
    on:sort-change
    on:select-folder
  />

  <div class="fce-list" bind:this={viewportEl} on:scroll={onScroll} on:wheel={markUserScrolling}>
    {#if loading}
      <div class="fce-empty">Loading folder cards...</div>
    {:else if cards.length === 0}
      <div class="fce-empty">No Markdown notes found in this folder.</div>
    {:else}
      <div style={`height: ${topPadding}px;`} />
       {#each visibleCards as card, i}
         <div use:measureHeight={card.path}>
           <CardItem
             {card}
             selected={selectedPath === card.path}
             on:open-note
             on:card-context-menu
           />
         </div>
       {/each}
      <div style={`height: ${bottomPadding}px;`} />
    {/if}
  </div>
</div>
