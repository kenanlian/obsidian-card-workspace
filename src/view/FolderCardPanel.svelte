<script>
  import { setIcon } from "obsidian";
  import { createEventDispatcher } from "svelte";

  export let cards = [];
  export let folderPath = "";
  export let selectedPath = null;
  export let loading = false;
  export let generation = 0;

  const dispatch = createEventDispatcher();

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
  $: activeToolbarConfig =
    TOOLBAR_ACTIONS.find((action) => action.id === activeToolbarAction) ?? TOOLBAR_ACTIONS[0];
  $: activeToolbarDescription = describeToolbarAction(activeToolbarConfig.id, folderPath);

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

  function selectToolbarAction(actionId) {
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

  function describeToolbarAction(actionId, currentFolderPath) {
    if (actionId === "pick-folder") {
      return currentFolderPath
        ? "Current folder can be changed from File Explorer."
        : "Click a folder in File Explorer to load cards.";
    }

    if (actionId === "new-note") {
      return currentFolderPath
        ? "Create note action will be mounted here in next tasks."
        : "Select a folder first, then create note in place.";
    }

    if (actionId === "sort") {
      return "Sort controls will be mounted here.";
    }

    if (actionId === "filter") {
      return "Filter controls will be mounted here.";
    }

    return "Bulk selection actions will be mounted here.";
  }
</script>

<div class="fce-shell">
  <header class="fce-header">
    <div class="fce-toolbar" role="toolbar" aria-label="Folder card actions">
      <div class="fce-toolbar-buttons">
        {#each TOOLBAR_ACTIONS as action}
          <button
            type="button"
            class="clickable-icon fce-toolbar-button {activeToolbarAction === action.id ? 'is-selected' : ''}"
            aria-label={action.title}
            on:click={() => selectToolbarAction(action.id)}
            use:applyIcon={action.icon}
          >
            <span class="fce-sr-only">{action.label}</span>
          </button>
        {/each}
      </div>
    </div>

    <div class="fce-toolbar-content">
      <p class="fce-toolbar-title">{activeToolbarConfig.title}</p>
      <p class="fce-toolbar-description">{activeToolbarDescription}</p>
      {#if folderPath}
        <p class="fce-folder">{folderPath}</p>
        <p class="fce-count">{cards.length} notes</p>
      {:else}
        <p class="fce-folder">Click a folder in File Explorer to preview notes.</p>
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
