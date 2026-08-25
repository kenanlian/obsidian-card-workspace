<script module lang="ts">
  const CARD_WORKSPACE_DRAG_MIME = "application/x-card-workspace-note"; // Duplicated in EditorDropController; update both together.
</script>

<script lang="ts">
  import { setIcon } from "obsidian";
  import { getUiStrings, type UiStrings } from "../i18n";
  import { getSearchDisplayTerms } from "../search-tokenization";
  import { getCardFileIcon, getCardPlaceholderText } from "./file-kind";
  import type { OpenNotePayload, PanelAppearanceState } from "./panel-model";
  import {
    highlightSanitizedPreviewHtml,
    sanitizePreviewHtml,
    type PreviewHtmlSanitizer,
  } from "./preview-html";
  import type { CardHoverLinkPayload, NoteCardRecord } from "./types";

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

  interface CardItemProps {
    card: NoteCardRecord;
    strings?: UiStrings;
    appearance?: PanelAppearanceState;
    selected?: boolean;
    bulkMode?: boolean;
    bulkSelected?: boolean;
    pinnedPaths?: string[];
    searchQuery?: string;
    searchMatchCount?: number;
    onOpenNote?: (payload: OpenNotePayload) => void;
    onBulkSelectCard?: (payload: BulkSelectCardPayload) => void;
    onCardContextMenu?: (payload: CardContextMenuPayload) => void;
    onPinToggle?: (payload: PinTogglePayload) => void;
    onCardHoverLink?: (payload: CardHoverLinkPayload) => void;
    previewHtmlSanitizer?: PreviewHtmlSanitizer;
  }

  interface HighlightSegment {
    text: string;
    highlighted: boolean;
  }

  let {
    card,
    strings = getUiStrings("en"),
    appearance = { cardCornerRadius: "compact", previewLines: 5 },
    selected = false,
    bulkMode = false,
    bulkSelected = false,
    pinnedPaths = [],
    searchQuery = "",
    searchMatchCount = 0,
    onOpenNote,
    onBulkSelectCard,
    onCardContextMenu,
    onPinToggle,
    onCardHoverLink,
    previewHtmlSanitizer = sanitizePreviewHtml,
  }: CardItemProps = $props();

  const cardStrings = $derived(strings.cardItem);
  const fileKindStrings = $derived(strings.fileKind);
  const cardCornerRadius = $derived(appearance.cardCornerRadius);
  const previewLines = $derived(appearance.previewLines);
  const isPinned = $derived(pinnedPaths.includes(card.path));
  const highlightedTitleSegments = $derived(getHighlightedTitleSegments(card.title, searchQuery));
  const normalizedSearchQuery = $derived(searchQuery.trim());
  const sanitizedPreviewHtml = $derived(
    typeof document === "undefined"
      ? card.previewHtml
      : previewHtmlSanitizer(card.previewHtml, document),
  );
  const highlightedPreviewHtml = $derived(
    typeof document === "undefined"
      ? sanitizedPreviewHtml
      : highlightSanitizedPreviewHtml(sanitizedPreviewHtml, normalizedSearchQuery, document),
  );
  let activeDragGhost: HTMLElement | null = null;

  function moveDragGhost(event: DragEvent): void {
    const { clientX, clientY } = event;
    if (
      activeDragGhost == null ||
      typeof clientX !== "number" ||
      typeof clientY !== "number" ||
      (clientX === 0 && clientY === 0)
    ) {
      return;
    }

    activeDragGhost.style.left = `${clientX + 12}px`;
    activeDragGhost.style.top = `${clientY + 12}px`;
  }

  function removeDragGhost(): void {
    activeDragGhost?.remove();
    activeDragGhost = null;
  }

  function createDragGhost(doc: Document): HTMLElement {
    const ghost = doc.createElement("div");
    ghost.className = "fce-card-drag-ghost";

    const self = doc.createElement("div");
    self.className = "fce-card-drag-ghost-self";

    const icon = doc.createElement("span");
    icon.className = "fce-card-drag-ghost-icon";
    icon.setAttribute("aria-hidden", "true");
    setIcon(icon, getCardFileIcon(card.fileKind));

    const title = doc.createElement("span");
    title.className = "fce-card-drag-ghost-title";
    title.textContent = card.title;

    const action = doc.createElement("div");
    action.className = "fce-card-drag-ghost-action";
    action.textContent = cardStrings.dragInsert;

    self.append(icon, title);
    ghost.append(self, action);

    return ghost;
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

  function buildHighlightedSegments(value: string, query: string): HighlightSegment[] | null {
    const tokens = getSearchDisplayTerms(query);
    const pattern = createTokenPattern(tokens);
    if (!pattern) {
      return null;
    }

    const segments: HighlightSegment[] = [];
    let lastIndex = 0;
    let hasMatch = false;

    for (const match of value.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (index > lastIndex) {
        segments.push({
          text: value.slice(lastIndex, index),
          highlighted: false,
        });
      }

      segments.push({
        text: match[0],
        highlighted: true,
      });
      lastIndex = index + match[0].length;
      hasMatch = true;
    }

    if (!hasMatch) {
      return null;
    }

    if (lastIndex < value.length) {
      segments.push({
        text: value.slice(lastIndex),
        highlighted: false,
      });
    }

    return segments;
  }

  function getHighlightedTitleSegments(title: string, query: string): HighlightSegment[] {
    return buildHighlightedSegments(title, query) ?? [{ text: title, highlighted: false }];
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
    onOpenNote?.({
      path: card.path,
    });
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

  function onCardDragStart(event: DragEvent): void {
    if (event.dataTransfer == null) {
      return;
    }

    const cardEl = event.currentTarget as { classList?: DOMTokenList; ownerDocument?: Document } | null;
    const doc = cardEl?.ownerDocument;
    if (cardEl == null || doc?.body == null) {
      return;
    }

    event.dataTransfer.setData(CARD_WORKSPACE_DRAG_MIME, JSON.stringify({ path: card.path, title: card.title }));
    event.dataTransfer.effectAllowed = "copy";

    removeDragGhost();

    const nativeDragImage = doc.createElement("div");
    nativeDragImage.className = "fce-card-native-drag-image";
    doc.body.appendChild(nativeDragImage);
    event.dataTransfer.setDragImage(nativeDragImage, 0, 0);
    requestAnimationFrame(() => nativeDragImage.remove());

    const ghost = createDragGhost(doc);
    doc.body.appendChild(ghost);
    activeDragGhost = ghost;
    moveDragGhost(event);

    cardEl.classList?.add("is-dragging");
  }

  function onCardDrag(event: DragEvent): void {
    moveDragGhost(event);
  }

  function onCardDragEnd(event: DragEvent): void {
    const cardEl = event.currentTarget as { classList?: DOMTokenList } | null;
    cardEl?.classList?.remove("is-dragging");
    removeDragGhost();
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

  function emitMoreActionsContextMenu(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    onCardContextMenu?.({
      path: card.path,
      trigger: "button",
      position: { x: rect.left, y: rect.bottom },
    });
  }

  function onMoreActionsClick(event: MouseEvent): void {
    event.stopPropagation();
    emitMoreActionsContextMenu(event.currentTarget as HTMLElement);
  }

  function onMoreActionsKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter" || event.key === " ") {
      event.stopPropagation();
      event.preventDefault();
      emitMoreActionsContextMenu(event.currentTarget as HTMLElement);
    }
  }

  function emitCardHoverLink(event: MouseEvent): void {
    const targetEl = event.currentTarget;
    if (!(targetEl instanceof HTMLElement)) {
      return;
    }

    onCardHoverLink?.({
      path: card.path,
      targetEl,
      mouseEvent: event,
    });
  }

  function getPreviewStyle(): string {
    return `--fce-preview-line-clamp: ${previewLines};`;
  }
</script>

<div
  class="fce-card fce-card-radius-{cardCornerRadius} {selected ? 'is-selected' : ''} {bulkSelected ? 'is-bulk-selected' : ''} {isPinned ? 'is-pinned' : ''}"
  role="button"
  tabindex="0"
  draggable="true"
  onclick={onCardClick}
  onkeydown={onCardKeydown}
  oncontextmenu={onCardContextMenuAction}
  ondragstart={onCardDragStart}
  ondrag={onCardDrag}
  ondragend={onCardDragEnd}
>
  <div class="fce-card-body">
    <div class="fce-card-header">
      <div class="fce-card-title-group" role="presentation" onmouseenter={emitCardHoverLink}>
        <span class="fce-card-file-icon" aria-hidden="true" data-file-kind={card.fileKind} use:applyIcon={getCardFileIcon(card.fileKind)}></span>
        <h4>{#each highlightedTitleSegments as segment, index (index)}{#if segment.highlighted}<mark class="fce-search-hit">{segment.text}</mark>{:else}{segment.text}{/if}{/each}</h4>
        {#if searchQuery.trim().length > 0 && searchMatchCount > 0}
          <span
            class="fce-card-search-count"
              aria-label={cardStrings.searchCountAria(searchMatchCount)}
            >
              {cardStrings.searchCount(searchMatchCount)}
            </span>
        {/if}
      </div>
      <div class="fce-card-actions">
        {#if bulkMode}
          <input
            type="checkbox"
            class="fce-card-bulk-checkbox"
            aria-label={bulkSelected ? cardStrings.bulkCheckboxRemove : cardStrings.bulkCheckboxAdd}
            checked={bulkSelected}
            onclick={onBulkSelectClick}
            onkeydown={onBulkSelectKeydown}
          />
        {:else}
          <button
            type="button"
            class="clickable-icon fce-card-pin-btn"
            aria-label={isPinned ? cardStrings.unpin : cardStrings.pin}
            aria-pressed={isPinned}
            onclick={onPinClick}
            onkeydown={onPinKeydown}
            use:applyIcon={isPinned ? "pin-off" : "pin"}
          ></button>
          <button
            type="button"
            class="clickable-icon fce-more-actions-btn"
            aria-label={cardStrings.moreActions}
            onclick={onMoreActionsClick}
            onkeydown={onMoreActionsKeydown}
            use:applyIcon={"ellipsis"}
          ></button>
        {/if}
      </div>
    </div>
    <div
      class="fce-excerpt {card.previewMode === 'code' ? 'is-code' : ''} {card.hydrated ? '' : 'is-loading'} {(card.previewMode === 'empty' || (card.previewMode !== 'placeholder' && !card.previewHtml)) && card.hydrated ? 'is-empty' : ''}"
      role="presentation"
      style={getPreviewStyle()}
      onmouseenter={emitCardHoverLink}
    >
      {#if card.hydrated}
        {#if card.previewMode === "placeholder"}
          <p class="fce-preview-placeholder">{getCardPlaceholderText(card.fileKind, fileKindStrings)}</p>
        {:else if card.previewMode === "empty" || !card.previewHtml}
          <p class="fce-preview-empty">{cardStrings.placeholderEmpty}</p>
        {:else}
          {@html highlightedPreviewHtml}
        {/if}
      {:else}
        <p class="fce-preview-empty">{cardStrings.placeholderLoading}</p>
      {/if}
    </div>
  </div>
</div>
