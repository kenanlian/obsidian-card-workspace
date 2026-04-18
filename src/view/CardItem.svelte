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
    searchQuery?: string;
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
    searchQuery = "",
    onOpenNote,
    onBulkSelectCard,
    onCardContextMenu,
    onPinToggle,
  }: CardItemProps = $props();

  const isPinned = $derived(pinnedPaths.includes(card.path));
  const highlightedTitleHtml = $derived(getHighlightedTitleHtml(card.title, searchQuery));
  const highlightedPreviewHtml = $derived(getHighlightedPreviewHtml(card.previewHtml, searchQuery));

  function getSearchTokens(query: string): string[] {
    const seen = new Set<string>();

    return query
      .split(/\s+/)
      .map((token) => token.trim().toLowerCase())
      .filter((token) => {
        if (token.length === 0 || seen.has(token)) {
          return false;
        }

        seen.add(token);
        return true;
      });
  }

  function escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function createTokenPattern(tokens: string[]): RegExp | null {
    if (tokens.length === 0) {
      return null;
    }

    const pattern = tokens
      .map((token) => escapeRegExp(token))
      .sort((left, right) => right.length - left.length)
      .join("|");

    return new RegExp(`(${pattern})`, "gi");
  }

  function highlightTextValue(value: string, query: string): string | null {
    const tokens = getSearchTokens(query);
    const pattern = createTokenPattern(tokens);
    if (!pattern) {
      return null;
    }

    let highlighted = "";
    let lastIndex = 0;
    let hasMatch = false;

    for (const match of value.matchAll(pattern)) {
      const index = match.index ?? 0;
      highlighted += escapeHtml(value.slice(lastIndex, index));
      highlighted += `<mark class="fce-search-hit">${escapeHtml(match[0])}</mark>`;
      lastIndex = index + match[0].length;
      hasMatch = true;
    }

    if (!hasMatch) {
      return null;
    }

    highlighted += escapeHtml(value.slice(lastIndex));
    return highlighted;
  }

  function getHighlightedTitleHtml(title: string, query: string): string {
    return highlightTextValue(title, query) ?? escapeHtml(title);
  }

  function getHighlightedPreviewHtml(previewHtml: string, query: string): string {
    const tokens = getSearchTokens(query);
    if (tokens.length === 0 || previewHtml.length === 0 || typeof document === "undefined") {
      return previewHtml;
    }

    const template = document.createElement("template");
    template.innerHTML = previewHtml;

    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let currentNode = walker.nextNode();

    while (currentNode) {
      if (currentNode instanceof Text && !currentNode.parentElement?.closest("mark.fce-search-hit")) {
        textNodes.push(currentNode);
      }
      currentNode = walker.nextNode();
    }

    let hasMatch = false;

    for (const textNode of textNodes) {
      const value = textNode.nodeValue ?? "";
      const highlighted = highlightTextValue(value, query);
      if (!highlighted) {
        continue;
      }

      hasMatch = true;
      const replacement = document.createElement("template");
      replacement.innerHTML = highlighted;
      textNode.replaceWith(replacement.content.cloneNode(true));
    }

    return hasMatch ? template.innerHTML : previewHtml;
  }

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
      <h4>{@html highlightedTitleHtml}</h4>
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
          {@html highlightedPreviewHtml}
        {/if}
      {:else}
        <p class="fce-preview-empty">Loading preview...</p>
      {/if}
    </div>
    <p class="fce-meta">Modified {formatDate(card.mtime)} · Created {formatDate(card.ctime)}</p>
  </div>
</div>
