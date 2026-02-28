<script>
  import { setIcon } from "obsidian";
  import { createEventDispatcher } from "svelte";

  export let cards = [];
  export let folderPath = "";
  export let selectedPath = null;
  export let loading = false;
  export let generation = 0;
  export let sortField = "mtime";
  export let sortDirection = "desc";

  const dispatch = createEventDispatcher();

  const SORT_OPTIONS = [
    { field: "mtime", direction: "desc", label: "编辑时间（从新到旧）" },
    { field: "mtime", direction: "asc", label: "编辑时间（从旧到新）" },
    { type: "separator" },
    { field: "ctime", direction: "desc", label: "创建时间（从新到旧）" },
    { field: "ctime", direction: "asc", label: "创建时间（从旧到新）" },
  ];

  const ESTIMATED_CARD_HEIGHT = 220;
  const OVERSCAN = 5;
  const TOOLBAR_ACTIONS = [
    {
      id: "pick-folder",
      label: "Pick folder",
      title: "Folder scope",
      icon: "folder-open",
    },
    {
      id: "all-notes",
      label: "All notes",
      title: "All notes",
      icon: "library",
    },
    {
      id: "new-note",
      label: "New",
      title: "Create note",
      icon: "file-plus",
    },
    {
      id: "sort",
      label: "Sort",
      title: "Sort cards",
      icon: "arrow-up-down",
    },
    {
      id: "filter",
      label: "Filter",
      title: "Filter cards",
      icon: "list-filter",
    },
    {
      id: "bulk",
      label: "Bulk",
      title: "Bulk actions",
      icon: "check-check",
    },
  ];

  let viewportEl = null;
  let viewportHeight = 0;
  let scrollTop = 0;
  let activeToolbarAction = TOOLBAR_ACTIONS[0].id;
  let showSortMenu = false;
  let sortButtonEl = null;
  let sortMenuX = 0;
  let sortMenuY = 0;

  let lastRangeStart = -1;
  let lastRangeEnd = -1;
  let lastHydrateGeneration = -1;

  let heights = [];
  let positions = [];
  let totalHeight = 0;

  function rebuildPositionsFrom(fromIndex) {
    const start = Math.max(0, fromIndex);
    if (start === 0) {
      let y = 0;
      for (let i = 0; i < cards.length; i++) {
        positions[i] = y;
        y += heights[i] || ESTIMATED_CARD_HEIGHT;
      }
      totalHeight = y;
    } else {
      let y = positions[start] ?? 0;
      for (let i = start; i < cards.length; i++) {
        positions[i] = y;
        y += heights[i] || ESTIMATED_CARD_HEIGHT;
      }
      totalHeight = y;
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
    heights = [];
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
    scrollTop = viewportEl.scrollTop;
    viewportHeight = viewportEl.clientHeight;
  }

  function openNote(path) {
    dispatch("open-note", { path });
  }

  function applyIcon(node, iconName) {
    setIcon(node, iconName);

    return {
      update(nextIconName) {
        setIcon(node, nextIconName);
      },
    };
  }

  function measureHeight(node, index) {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // use borderBoxSize if available, fallback to getBoundingClientRect
        let height = entry.borderBoxSize && entry.borderBoxSize.length > 0 
          ? entry.borderBoxSize[0].blockSize 
          : entry.target.getBoundingClientRect().height;
        
        height += 12; // Add margin-bottom (12px)
        const roundedHeight = Math.round(height);
        
        if (heights[index] !== roundedHeight) {
          heights[index] = roundedHeight;
          rebuildPositionsFrom(index);
        }
      }
    });
    
    resizeObserver.observe(node);
    
    return {
      update(newIndex) {
        index = newIndex;
      },
      destroy() {
        resizeObserver.disconnect();
      }
    };
  }

  function selectToolbarAction(actionId, event) {
    if (actionId === "sort") {
      if (showSortMenu) {
        showSortMenu = false;
      } else {
        sortMenuX = event.clientX;
        sortMenuY = event.clientY;
        showSortMenu = true;
      }
      return;
    }
    showSortMenu = false;
    activeToolbarAction = actionId;
    dispatch("toolbar-action", { action: actionId });
  }

  function onCardKeydown(event, path) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openNote(path);
    }
  }

  function formatDate(timestamp) {
    return new Date(timestamp).toLocaleDateString();
  }

  function selectSortOption(option) {
    showSortMenu = false;

    if (option.field === sortField && option.direction === sortDirection) {
      return;
    }

    dispatch("sort-change", {
      field: option.field,
      direction: option.direction,
    });
  }

  let sortMenuEl = null;

  function onSortMenuClickOutside(event) {
    if (sortButtonEl && sortButtonEl.contains(event.target)) {
      return;
    }
    if (sortMenuEl && sortMenuEl.contains(event.target)) {
      return;
    }
    showSortMenu = false;
  }

  function captureSortButton(node) {
    sortButtonEl = node;
    return {
      destroy() {
        sortButtonEl = null;
      },
    };
  }

  function sortMenuAction(node) {
    sortMenuEl = node;
    document.body.appendChild(node);
    document.addEventListener("click", onSortMenuClickOutside, true);
    return {
      destroy() {
        document.removeEventListener("click", onSortMenuClickOutside, true);
        sortMenuEl = null;
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      },
    };
  }
</script>

<div class="fce-shell">
  <header class="fce-header">
    <div class="fce-toolbar" role="toolbar" aria-label="Folder card actions">
      <div class="fce-toolbar-buttons">
        {#each TOOLBAR_ACTIONS as action}
          {#if action.id === "sort"}
            <button
              type="button"
              class="clickable-icon fce-toolbar-button {showSortMenu ? 'is-selected' : ''}"
              aria-label={action.title}
              on:click={(e) => selectToolbarAction(action.id, e)}
              use:applyIcon={action.icon}
              use:captureSortButton
            >
              <span class="fce-sr-only">{action.label}</span>
            </button>
          {:else}
            <button
              type="button"
              class="clickable-icon fce-toolbar-button {activeToolbarAction === action.id ? 'is-selected' : ''}"
              aria-label={action.title}
              on:click={(e) => selectToolbarAction(action.id, e)}
              use:applyIcon={action.icon}
            >
              <span class="fce-sr-only">{action.label}</span>
            </button>
          {/if}
        {/each}
      </div>
    </div>

    <div class="fce-toolbar-content">
      {#if folderPath}
        {folderPath}
      {:else}
        Pick a folder to preview notes.
      {/if}
    </div>
  </header>

  <div class="fce-list" bind:this={viewportEl} on:scroll={onScroll}>
    {#if loading}
      <div class="fce-empty">Loading folder cards...</div>
    {:else if cards.length === 0}
      <div class="fce-empty">No Markdown notes found in this folder.</div>
    {:else}
      <div style={`height: ${topPadding}px;`} />
      {#each visibleCards as card, i}
        <div
          class="fce-card {selectedPath === card.path ? 'is-selected' : ''}"
          role="button"
          tabindex="0"
          on:click={() => openNote(card.path)}
          on:keydown={(event) => onCardKeydown(event, card.path)}
          use:measureHeight={startIndex + i}
        >
          <div class="fce-card-body">
            <h4>{card.title}</h4>
            <div class="fce-excerpt {card.previewMode === 'code' ? 'is-code' : ''}">
              {#if card.hydrated}
                {#if card.previewMode === "empty" || !card.previewHtml}
                  <p class="fce-preview-empty">No previewable text near the top.</p>
                {:else}
                  {@html card.previewHtml}
                {/if}
              {:else}
                <p class="fce-preview-empty">Loading preview...</p>
              {/if}
            </div>
            <p class="fce-meta">Modified {formatDate(card.mtime)} · Created {formatDate(card.ctime)}</p>
          </div>
        </div>
      {/each}
      <div style={`height: ${bottomPadding}px;`} />
    {/if}
  </div>
</div>

{#if showSortMenu}
  <div
    class="fce-sort-menu"
    role="menu"
    style="left: {sortMenuX}px; top: {sortMenuY}px;"
    use:sortMenuAction
  >
    {#each SORT_OPTIONS as option}
      {#if option.type === "separator"}
        <div class="fce-sort-menu-separator"></div>
      {:else}
        {@const selected = sortField === option.field && sortDirection === option.direction}
        <button
          type="button"
          class="fce-sort-menu-item"
          role="menuitemradio"
          aria-checked={selected}
          on:click={() => selectSortOption(option)}
        >
          <span class="fce-sort-menu-item-label">{option.label}</span>
          {#if selected}
            <span class="fce-sort-menu-item-check" use:applyIcon={"check"}></span>
          {/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}
