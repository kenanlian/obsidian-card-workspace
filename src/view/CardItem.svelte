<script lang="ts">
  import { setIcon } from "obsidian";
  import { getCardFileIcon, getCardPlaceholderText } from "./file-kind";
  import type { OpenNotePayload } from "./panel-model";
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
    selected?: boolean;
    bulkMode?: boolean;
    bulkSelected?: boolean;
    pinnedPaths?: string[];
    previewLines?: number;
    searchQuery?: string;
    searchMatchCount?: number;
    onOpenNote?: (payload: OpenNotePayload) => void;
    onBulkSelectCard?: (payload: BulkSelectCardPayload) => void;
    onCardContextMenu?: (payload: CardContextMenuPayload) => void;
    onPinToggle?: (payload: PinTogglePayload) => void;
    onCardHoverLink?: (payload: CardHoverLinkPayload) => void;
  }

  interface HighlightSegment {
    text: string;
    highlighted: boolean;
  }

  const ALLOWED_PREVIEW_TAGS = new Set(["P", "CODE", "MARK"]);
  const ALLOWED_PREVIEW_CLASSES = {
    P: new Set(["fce-preview-code", "fce-preview-heading"]),
    CODE: new Set<string>(),
    MARK: new Set(["fce-search-hit"]),
  } as const;

  let {
    card,
    selected = false,
    bulkMode = false,
    bulkSelected = false,
    pinnedPaths = [],
    previewLines = 5,
    searchQuery = "",
    searchMatchCount = 0,
    onOpenNote,
    onBulkSelectCard,
    onCardContextMenu,
    onPinToggle,
    onCardHoverLink,
  }: CardItemProps = $props();

  const isPinned = $derived(pinnedPaths.includes(card.path));
  const highlightedTitleSegments = $derived(getHighlightedTitleSegments(card.title, searchQuery));
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
    const tokens = getSearchTokens(query);
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

  function createHighlightedFragment(value: string, query: string): DocumentFragment | null {
    const segments = buildHighlightedSegments(value, query);
    if (!segments) {
      return null;
    }

    const fragment = document.createDocumentFragment();
    for (const segment of segments) {
      if (segment.highlighted) {
        const mark = document.createElement("mark");
        mark.className = "fce-search-hit";
        mark.textContent = segment.text;
        fragment.appendChild(mark);
        continue;
      }

      fragment.appendChild(document.createTextNode(segment.text));
    }

    return fragment;
  }

  function appendSanitizedPreviewNode(parent: Node, node: Node): void {
    if (node instanceof Text) {
      parent.appendChild(document.createTextNode(node.nodeValue ?? ""));
      return;
    }

    if (!(node instanceof Element)) {
      return;
    }

    if (!ALLOWED_PREVIEW_TAGS.has(node.tagName)) {
      for (const child of Array.from(node.childNodes)) {
        appendSanitizedPreviewNode(parent, child);
      }
      return;
    }

    const safeElement = document.createElement(node.tagName.toLowerCase());
    const allowedClasses = ALLOWED_PREVIEW_CLASSES[node.tagName as keyof typeof ALLOWED_PREVIEW_CLASSES];
    const nextClassName = (node.getAttribute("class") ?? "")
      .split(/\s+/)
      .map((className) => className.trim())
      .filter((className) => allowedClasses.has(className))
      .join(" ");

    if (nextClassName.length > 0) {
      safeElement.className = nextClassName;
    }

    for (const child of Array.from(node.childNodes)) {
      appendSanitizedPreviewNode(safeElement, child);
    }

    parent.appendChild(safeElement);
  }

  function applyPreviewHighlights(root: ParentNode, query: string): void {
    const tokens = getSearchTokens(query);
    if (tokens.length === 0) {
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let currentNode = walker.nextNode();

    while (currentNode) {
      if (currentNode instanceof Text && !currentNode.parentElement?.closest("mark.fce-search-hit")) {
        textNodes.push(currentNode);
      }
      currentNode = walker.nextNode();
    }

    for (const textNode of textNodes) {
      const value = textNode.nodeValue ?? "";
      const fragment = createHighlightedFragment(value, query);
      if (!fragment) {
        continue;
      }

      textNode.replaceWith(fragment);
    }
  }

  function serializeFragment(fragment: DocumentFragment): string {
    const container = document.createElement("div");
    container.appendChild(fragment);
    return container.innerHTML;
  }

  function getHighlightedPreviewHtml(previewHtml: string, query: string): string {
    if (previewHtml.length === 0 || typeof document === "undefined") {
      return previewHtml;
    }

    const template = document.createElement("template");
    template.innerHTML = previewHtml;

    const sanitizedFragment = document.createDocumentFragment();
    for (const child of Array.from(template.content.childNodes)) {
      appendSanitizedPreviewNode(sanitizedFragment, child);
    }

    applyPreviewHighlights(sanitizedFragment, query);
    return serializeFragment(sanitizedFragment);
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
  class="fce-card {selected ? 'is-selected' : ''} {bulkSelected ? 'is-bulk-selected' : ''} {isPinned ? 'is-pinned' : ''}"
  role="button"
  tabindex="0"
  onclick={onCardClick}
  onkeydown={onCardKeydown}
  oncontextmenu={onCardContextMenuAction}
>
  <div class="fce-card-body">
    <div class="fce-card-header">
      <div class="fce-card-title-group" role="presentation" onmouseenter={emitCardHoverLink}>
        <span class="fce-card-file-icon" aria-hidden="true" data-file-kind={card.fileKind} use:applyIcon={getCardFileIcon(card.fileKind)}></span>
        <h4>{#each highlightedTitleSegments as segment, index (index)}{#if segment.highlighted}<mark class="fce-search-hit">{segment.text}</mark>{:else}{segment.text}{/if}{/each}</h4>
        {#if searchQuery.trim().length > 0 && searchMatchCount > 0}
          <span
            class="fce-card-search-count"
            aria-label="{searchMatchCount} match{searchMatchCount === 1 ? "" : "es"} in this note"
          >
            {searchMatchCount === 1 ? "1 match" : `${searchMatchCount} matches`}
          </span>
        {/if}
      </div>
      <div class="fce-card-actions">
        {#if bulkMode}
          <input
            type="checkbox"
            class="fce-card-bulk-checkbox"
            aria-label={bulkSelected ? "Deselect note from bulk selection" : "Add note to bulk selection"}
            checked={bulkSelected}
            onclick={onBulkSelectClick}
            onkeydown={onBulkSelectKeydown}
          />
        {:else}
          <button
            type="button"
            class="clickable-icon fce-card-pin-btn"
            aria-label={isPinned ? "Unpin note" : "Pin note"}
            aria-pressed={isPinned}
            onclick={onPinClick}
            onkeydown={onPinKeydown}
            use:applyIcon={isPinned ? "pin-off" : "pin"}
          ></button>
          <button
            type="button"
            class="clickable-icon fce-more-actions-btn"
            aria-label="More actions"
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
          <p class="fce-preview-placeholder">{getCardPlaceholderText(card.fileKind)}</p>
        {:else if card.previewMode === "empty" || !card.previewHtml}
          <p class="fce-preview-empty">No previewable text near the top.</p>
        {:else}
          {@html highlightedPreviewHtml}
        {/if}
      {:else}
        <p class="fce-preview-empty">Loading preview...</p>
      {/if}
    </div>
  </div>
</div>
