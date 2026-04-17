<script>
  import { createEventDispatcher } from "svelte";
  import { setIcon } from "obsidian";

  export let card;
  export let selected = false;
  export let bulkMode = false;
  export let bulkSelected = false;
  export let pinnedPaths = [];
  export let previewLines = 5;

  const dispatch = createEventDispatcher();

  $: isPinned = pinnedPaths.includes(card.path);

  function applyIcon(node, iconName) {
    setIcon(node, iconName);
    return {
      update(nextIconName) {
        setIcon(node, nextIconName);
      },
    };
  }

  function onCardClick(event) {
    if (bulkMode) {
      dispatchBulkSelect(event.shiftKey);
      return;
    }

    dispatch("open-note", { path: card.path });
  }

  function onCardKeydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (bulkMode) {
        dispatchBulkSelect(event.shiftKey);
      } else {
        dispatch("open-note", { path: card.path });
      }
    }
    dispatch("card-keydown", { event, path: card.path });
  }

  function onCardContextMenu(event) {
    event.preventDefault();
    dispatch("card-context-menu", { path: card.path, mouseEvent: event });
  }

  function dispatchBulkSelect(shiftKey) {
    dispatch("bulk-select-card", { path: card.path, shiftKey });
  }

  function onBulkSelectClick(event) {
    event.stopPropagation();
    dispatchBulkSelect(event.shiftKey);
  }

  function onBulkSelectKeydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.stopPropagation();
      event.preventDefault();
      dispatchBulkSelect(event.shiftKey);
    }
  }

  function onPinClick(event) {
    event.stopPropagation();
    dispatch("pin-toggle", { path: card.path, pinned: !isPinned });
  }

  function onPinKeydown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.stopPropagation();
      event.preventDefault();
      dispatch("pin-toggle", { path: card.path, pinned: !isPinned });
    }
  }

  function formatDate(timestamp) {
    return new Date(timestamp).toLocaleDateString();
  }

  function getPreviewStyle() {
    return `--fce-preview-line-clamp: ${previewLines};`;
  }
</script>

<div
  class="fce-card {selected ? 'is-selected' : ''} {bulkSelected ? 'is-bulk-selected' : ''} {isPinned ? 'is-pinned' : ''}"
  role="button"
  tabindex="0"
  on:click={onCardClick}
  on:keydown={onCardKeydown}
  on:contextmenu={onCardContextMenu}
>
  <div class="fce-card-body">
    <div class="fce-card-header">
      <h4>{card.title}</h4>
      <div class="fce-card-actions">
        {#if bulkMode}
          <button
            type="button"
            class="fce-card-bulk-toggle {bulkSelected ? 'is-selected' : ''}"
            aria-label={bulkSelected ? "Deselect note from bulk selection" : "Add note to bulk selection"}
            aria-pressed={bulkSelected}
            on:click={onBulkSelectClick}
            on:keydown={onBulkSelectKeydown}
          >
            {bulkSelected ? "Selected" : "Select"}
          </button>
        {/if}

        <button
          type="button"
          class="clickable-icon fce-card-pin-btn"
          aria-label={isPinned ? "Unpin note" : "Pin note"}
          aria-pressed={isPinned}
          on:click={onPinClick}
          on:keydown={onPinKeydown}
          use:applyIcon={isPinned ? "pin-off" : "pin"}
        ></button>
      </div>
    </div>
    <div
      class="fce-excerpt {card.previewMode === 'code' ? 'is-code' : ''} {card.hydrated ? '' : 'is-loading'} {(card.previewMode === 'empty' || !card.previewHtml) && card.hydrated ? 'is-empty' : ''}"
      style={getPreviewStyle()}
    >
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
