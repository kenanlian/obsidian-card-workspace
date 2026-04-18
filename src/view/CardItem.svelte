<script lang="ts">
  import { setIcon } from "obsidian";
  import type { NoteCardRecord } from "./types";

  interface OpenNotePayload {
    path: string;
  }

  interface BulkSelectCardPayload {
    path: string;
    shiftKey: boolean;
  }

  interface CardContextMenuPayload {
    path: string;
    mouseEvent: MouseEvent;
  }

  interface PinTogglePayload {
    path: string;
    pinned: boolean;
  }

  interface CardItemProps {
    card: NoteCardRecord;
    selected?: boolean;
    bulkMode?: boolean;
    bulkSelected?: boolean;
    pinnedPaths?: string[];
    previewLines?: number;
    onOpenNote?: (payload: OpenNotePayload) => void;
    onBulkSelectCard?: (payload: BulkSelectCardPayload) => void;
    onCardContextMenu?: (payload: CardContextMenuPayload) => void;
    onPinToggle?: (payload: PinTogglePayload) => void;
  }

  let {
    card,
    selected = false,
    bulkMode = false,
    bulkSelected = false,
    pinnedPaths = [],
    previewLines = 5,
    onOpenNote,
    onBulkSelectCard,
    onCardContextMenu,
    onPinToggle,
  }: CardItemProps = $props();

  const isPinned = $derived(pinnedPaths.includes(card.path));

  function applyIcon(node: HTMLElement, iconName: string) {
    setIcon(node, iconName);
    return {
      update(nextIconName: string) {
        setIcon(node, nextIconName);
      },
    };
  }

  function emitOpenNote(): void {
    onOpenNote?.({ path: card.path });
  }

  function emitBulkSelect(shiftKey: boolean): void {
    onBulkSelectCard?.({ path: card.path, shiftKey });
  }

  function emitPinToggle(pinned: boolean): void {
    onPinToggle?.({ path: card.path, pinned });
  }

  function onCardClick(event: MouseEvent): void {
    if (bulkMode) {
      emitBulkSelect(event.shiftKey);
      return;
    }

    emitOpenNote();
  }

  function onCardKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (bulkMode) {
        emitBulkSelect(event.shiftKey);
      } else {
        emitOpenNote();
      }
    }
  }

  function onCardContextMenuAction(event: MouseEvent): void {
    event.preventDefault();
    onCardContextMenu?.({ path: card.path, mouseEvent: event });
  }

  function onBulkSelectClick(event: MouseEvent): void {
    event.stopPropagation();
    emitBulkSelect(event.shiftKey);
  }

  function onBulkSelectKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" || event.key === " ") {
      event.stopPropagation();
      event.preventDefault();
      emitBulkSelect(event.shiftKey);
    }
  }

  function onPinClick(event: MouseEvent): void {
    event.stopPropagation();
    emitPinToggle(!isPinned);
  }

  function onPinKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" || event.key === " ") {
      event.stopPropagation();
      event.preventDefault();
      emitPinToggle(!isPinned);
    }
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString();
  }

  function getPreviewStyle(): string {
    return `--fce-preview-line-clamp: ${previewLines};`;
  }
</script>

<div
  class="fce-card {selected ? 'is-selected' : ''} {bulkSelected ? 'is-bulk-selected' : ''} {isPinned ? 'is-pinned' : ''}"
  role="button"
  tabindex="0"
  onclick={onCardClick}
  onkeydown={onCardKeydown}
  oncontextmenu={onCardContextMenuAction}
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
            onclick={onBulkSelectClick}
            onkeydown={onBulkSelectKeydown}
          >
            {bulkSelected ? "Selected" : "Select"}
          </button>
        {/if}

        <button
          type="button"
          class="clickable-icon fce-card-pin-btn"
          aria-label={isPinned ? "Unpin note" : "Pin note"}
          aria-pressed={isPinned}
          onclick={onPinClick}
          onkeydown={onPinKeydown}
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
