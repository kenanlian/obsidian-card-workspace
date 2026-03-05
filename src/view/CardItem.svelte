<script>
  import { createEventDispatcher } from "svelte";

  export let card;
  export let selected = false;

  const dispatch = createEventDispatcher();

  function onCardClick() {
    dispatch("open-note", { path: card.path });
  }

  function onCardKeydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      dispatch("open-note", { path: card.path });
    }
    dispatch("card-keydown", { event, path: card.path });
  }

  function formatDate(timestamp) {
    return new Date(timestamp).toLocaleDateString();
  }
</script>

<div
  class="fce-card {selected ? 'is-selected' : ''}"
  role="button"
  tabindex="0"
  on:click={onCardClick}
  on:keydown={onCardKeydown}
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
