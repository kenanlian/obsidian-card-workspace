<script>
  import { createEventDispatcher } from "svelte";

  export let cards = [];
  export let folderPath = "";
  export let selectedPath = null;
  export let loading = false;
  export let generation = 0;

  const dispatch = createEventDispatcher();

  const CARD_HEIGHT = 220;
  const OVERSCAN = 5;

  let viewportEl = null;
  let viewportHeight = 0;
  let scrollTop = 0;

  let lastRangeStart = -1;
  let lastRangeEnd = -1;
  let lastHydrateGeneration = -1;

  $: visibleCount = Math.max(1, Math.ceil(viewportHeight / CARD_HEIGHT) + OVERSCAN * 2);
  $: startIndex = Math.max(0, Math.floor(scrollTop / CARD_HEIGHT) - OVERSCAN);
  $: endIndex = Math.min(cards.length, startIndex + visibleCount);
  $: topPadding = startIndex * CARD_HEIGHT;
  $: bottomPadding = Math.max(0, (cards.length - endIndex) * CARD_HEIGHT);
  $: visibleCards = cards.slice(startIndex, endIndex);

  $: if (generation !== lastHydrateGeneration) {
    lastHydrateGeneration = generation;
    lastRangeStart = -1;
    lastRangeEnd = -1;
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

  function onCardKeydown(event, path) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openNote(path);
    }
  }

  function formatDate(timestamp) {
    return new Date(timestamp).toLocaleDateString();
  }
</script>

<div class="fce-shell">
  <header class="fce-header">
    <h3>Folder Card Explorer</h3>
    {#if folderPath}
      <p class="fce-folder">{folderPath}</p>
      <p class="fce-count">{cards.length} notes</p>
    {:else}
      <p class="fce-folder">Click a folder in File Explorer to preview notes.</p>
    {/if}
  </header>

  <div class="fce-list" bind:this={viewportEl} on:scroll={onScroll}>
    {#if loading}
      <div class="fce-empty">Loading folder cards...</div>
    {:else if cards.length === 0}
      <div class="fce-empty">No Markdown notes found in this folder.</div>
    {:else}
      <div style={`height: ${topPadding}px;`} />
      {#each visibleCards as card}
        <div
          class="fce-card {selectedPath === card.path ? 'is-selected' : ''}"
          role="button"
          tabindex="0"
          on:click={() => openNote(card.path)}
          on:keydown={(event) => onCardKeydown(event, card.path)}
        >
          {#if card.cover}
            <img class="fce-cover" src={card.cover} alt={card.title} loading="lazy" />
          {/if}
          <div class="fce-card-body">
            <h4>{card.title}</h4>
            <p class="fce-meta">Modified {formatDate(card.mtime)} · Created {formatDate(card.ctime)}</p>
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
          </div>
        </div>
      {/each}
      <div style={`height: ${bottomPadding}px;`} />
    {/if}
  </div>
</div>
