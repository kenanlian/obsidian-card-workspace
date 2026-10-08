<script module lang="ts">
  const CARD_WORKSPACE_DRAG_MIME = "application/x-card-workspace-note"; // Duplicated in EditorDropController; update both together.
</script>

<script lang="ts">
  import type { CardImageState } from "../images/types";
  import { setIcon } from "obsidian";
  import { getUiStrings, type UiStrings } from "../i18n";
  import { getSearchDisplayTerms } from "../search-tokenization";
  import { getCardFileIcon, getCardPlaceholderText } from "./file-kind";
  import type { OpenNotePayload, PanelAppearanceState } from "./panel-model";
  import {
    sanitizePreviewHtml,
    type PreviewHtmlSanitizer,
  } from "./preview-html";
  import type { CardHoverLinkPayload, NoteCardRecord } from "./types";
  import CardTaskFooter from "./CardTaskFooter.svelte";
  import { buildSearchSnippetSegments, buildSearchSnippetHtml, type SearchSnippetSegment } from "./search-snippet-layout";

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
    image?: CardImageState;
    selected?: boolean;
    bulkMode?: boolean;
    bulkSelected?: boolean;
    pinnedPaths?: string[];
    searchQuery?: string;
    searchMatchCount?: number;
    onOpenNote?: (payload: OpenNotePayload) => void;
    onToggleReferences?: (payload: { path: string }) => void;
    onBulkSelectCard?: (payload: BulkSelectCardPayload) => void;
    onCardContextMenu?: (payload: CardContextMenuPayload) => void;
    onPinToggle?: (payload: PinTogglePayload) => void;
    onCardHoverLink?: (payload: CardHoverLinkPayload) => void;
    onImageReveal?: (payload: import("./image-request").CardImageRevealRequest) => boolean;
    previewHtmlSanitizer?: PreviewHtmlSanitizer;
  }

  interface HighlightSegment {
    text: string;
    highlighted: boolean;
  }

  let {
    card,
    strings = getUiStrings("en"),
    appearance = { cardCornerRadius: "compact", previewLines: 5, searchPreviewSnippetCount: 2 },
    image,
    selected = false,
    bulkMode = false,
    bulkSelected = false,
    pinnedPaths = [],
    searchQuery = "",
    searchMatchCount = 0,
    onOpenNote,
    onToggleReferences,
    onBulkSelectCard,
    onCardContextMenu,
    onPinToggle,
    onCardHoverLink,
    onImageReveal,
    previewHtmlSanitizer = sanitizePreviewHtml,
  }: CardItemProps = $props();

  const cardStrings = $derived(strings.cardItem);
  const fileKindStrings = $derived(strings.fileKind);
  const cardCornerRadius = $derived(appearance.cardCornerRadius);
  const previewLines = $derived(appearance.previewLines);
  const searchPreviewSnippetCount = $derived(appearance.searchPreviewSnippetCount);
  const imageMode = $derived(appearance.cardImageMode ?? "off");
  const showImage = $derived(imageMode !== "off" && image !== undefined);
  let failedUrl = $state<string | null>(null);
  let loadedUrl = $state<string | null>(null);
  let revealUrl = $state<string | null>(null);
  const isPinned = $derived(pinnedPaths.includes(card.path));
  const highlightedTitleSegments = $derived(getHighlightedTitleSegments(card.title, searchQuery));
  const normalizedSearchQuery = $derived(searchQuery.trim());
  const linkPreview = $derived(card.linkPreview);
  const searchPreview = $derived(card.searchPreview?.query === normalizedSearchQuery
    && card.searchPreview.previewLines === previewLines
    && card.searchPreview.snippetLimit === searchPreviewSnippetCount ? card.searchPreview : undefined);
  const inlineReferences = $derived(card.referenceCount !== undefined && (!normalizedSearchQuery || searchPreview?.status === "title-only"));
  const showReferenceList = $derived(inlineReferences || linkPreview?.expanded);
  const canToggleReferences = $derived(card.referenceCount !== undefined && (linkPreview?.expanded || (!inlineReferences && normalizedSearchQuery) || (linkPreview?.totalSnippets ?? 0) > (linkPreview?.snippets.length ?? 0)));
  const sanitizedPreviewHtml = $derived(
    typeof document === "undefined"
      ? card.previewHtml
      : previewHtmlSanitizer(card.previewHtml, document),
  );
  // Only display cropping depends on width; source locations stay host-owned.
  const snippetMetrics = $state<Record<string, { width: number; fonts: Record<string, string> }>>({});
  let snippetWidth = $state(0);
  let snippetFonts = $state<Record<string, string>>({});
  let textMeasure: CanvasRenderingContext2D | null = null;
  const measuredFonts: Record<string, string> = {};
  const snippetMeasurements = new Map<string, () => void>();
  let snippetMeasureQueued = false;
  function scheduleSnippetMeasures(): void {
    if (snippetMeasureQueued) return;
    snippetMeasureQueued = true;
    queueMicrotask(() => {
      snippetMeasureQueued = false;
      for (const measure of snippetMeasurements.values()) measure();
    });
  }
  const displayedSnippets = $derived(searchPreview?.status === "hits" ? searchPreview.snippets : []);
  function measureSnippet(node: HTMLButtonElement, id: string) {
    const content = node.querySelector<HTMLElement>(".fce-search-snippet-text")!;
    const measure = (): void => {
      const width = content.clientWidth;
      if (!width) return;
      const win = node.ownerDocument.defaultView;
      const font = win?.getComputedStyle(node).font ?? "";
      if (measuredFonts.text !== font) {
        for (const key of Object.keys(measuredFonts)) delete measuredFonts[key];
        measuredFonts.text = font;
      }
      const presentation = searchPreview?.snippets.find(snippet => snippet.id === id)?.presentation;
      const keys = new Set(presentation?.runs.map(run => run.kind === "code"
        ? run.heading ? "code-heading" : "code" : run.heading ? "heading" : "text"));
      for (const key of keys) {
        if (measuredFonts[key]) continue;
        const selector = key === "code-heading" ? "code.fce-preview-heading" : key === "code" ? "code" : ".fce-preview-heading";
        const sample = node.querySelector<HTMLElement>(selector);
        if (sample) measuredFonts[key] = win?.getComputedStyle(sample).font ?? font;
      }
      const fonts = { ...measuredFonts };
      if (!textMeasure) textMeasure = node.ownerDocument.createElement("canvas").getContext("2d");
      const snippet = searchPreview?.snippets.find(value => value.id === id);
      if (snippet && textMeasure) {
        const segments = buildSearchSnippetSegments(snippet, width, (value, kind, heading) => {
          textMeasure!.font = fonts[kind === "code" ? heading ? "code-heading" : "code" : heading ? "heading" : "text"] ?? fonts.text;
          return textMeasure!.measureText(value).width + (kind === "code" && !presentation?.codeBlock ? 6 : 0);
        });
        // Short contexts already fit; storing identical metrics would cause a redundant render.
        if (content.textContent === segments.map(segment => segment.text).join("")) return;
      }
      if (presentation?.list) {
        const previous = snippetMetrics[id];
        if (previous?.width !== width || Object.keys(fonts).some(key => previous.fonts[key] !== fonts[key])) {
          snippetMetrics[id] = { width, fonts };
        }
      } else {
        snippetWidth = width;
        if (Object.keys(fonts).some(key => snippetFonts[key] !== fonts[key])) snippetFonts = fonts;
      }
    };
    snippetMeasurements.set(id, measure);
    scheduleSnippetMeasures();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleSnippetMeasures);
    observer?.observe(content);
    return { destroy() {
      observer?.disconnect();
      snippetMeasurements.delete(id);
      delete snippetMetrics[id];
    } };
  }
  let activeDragGhost: HTMLElement | null = null;

  function revealImage(node: HTMLImageElement, url: string): { destroy: () => void } {
    const path = card.path;
    let active = true;
    let decoding = false;
    loadedUrl = null;
    revealUrl = null;
    async function reveal(): Promise<void> {
      if (!active || decoding) return;
      decoding = true;
      try {
        if (typeof node.decode === "function") await node.decode();
        if (active) {
          revealUrl = onImageReveal?.({ path, url }) !== false ? url : null;
          loadedUrl = url;
        }
      } catch {
        if (active) failedUrl = url;
      }
    }
    const onLoad = (): void => { void reveal(); };
    const onError = (): void => { if (active) failedUrl = url; };
    node.addEventListener("load", onLoad);
    node.addEventListener("error", onError);
    // Cached images may finish before the action subscribes to their load event.
    if (node.complete && node.naturalWidth > 0) void reveal();
    return { destroy() { active = false; node.removeEventListener("load", onLoad); node.removeEventListener("error", onError); } };
  }

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

  function snippetSegments(snippet: NonNullable<NoteCardRecord["searchPreview"]>["snippets"][number]): SearchSnippetSegment[] {
    const metrics = snippet.presentation?.list ? snippetMetrics[snippet.id] : { width: snippetWidth, fonts: snippetFonts };
    return buildSearchSnippetSegments(snippet, metrics?.width, metrics && metrics.width > 0 && textMeasure ? (value, kind, heading) => {
      textMeasure!.font = metrics.fonts[kind === "code" ? heading ? "code-heading" : "code" : heading ? "heading" : "text"] ?? metrics.fonts.text;
      return textMeasure!.measureText(value).width + (kind === "code" && !snippet.presentation?.codeBlock ? 6 : 0);
    } : undefined);
  }

  function onSnippetClick(event: MouseEvent, snippetId: string): void {
    event.stopPropagation();
    if (bulkMode) emitBulkSelect(event.shiftKey);
    else onOpenNote?.({ path: card.path, snippetId });
  }

  function onSnippetKeydown(event: KeyboardEvent, snippetId: string): void {
    event.stopPropagation();
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (event.repeat) return;
    if (bulkMode) emitBulkSelect(event.shiftKey);
    else onOpenNote?.({ path: card.path, snippetId });
  }

  function onReferenceClick(event: MouseEvent | KeyboardEvent, referenceId: string, referenceTarget = false): void {
    event.stopPropagation();
    if ("key" in event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (event.repeat) return;
    }
    if (bulkMode) emitBulkSelect(event.shiftKey);
    else onOpenNote?.({ path: card.path, referenceId, referenceTarget });
  }
  function onReferencesToggle(event: MouseEvent | KeyboardEvent): void {
    event.stopPropagation();
    if ("key" in event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (event.repeat) return;
    }
    if (bulkMode) emitBulkSelect(event.shiftKey);
    else onToggleReferences?.({ path: card.path });
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
    const lines = searchPreview?.status === "hits" ? searchPreviewSnippetCount * 2 : previewLines;
    const dividers = Math.max(0, displayedSnippets.length - 1);
    return `--fce-preview-line-clamp: ${lines}; --fce-preview-divider-count: ${dividers};`;
  }
</script>

{#snippet snippetBody(html: string, codeBlock: boolean)}
  <span class="fce-search-snippet-text" class:is-code={codeBlock}>{@html html}</span>
{/snippet}

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
  <div class="fce-card-body" class:has-right-image={showImage && imageMode === "right"} class:has-reference-preview={inlineReferences} class:has-reference-details={!!showReferenceList || !!canToggleReferences}>
    <div class="fce-card-header">
      <div class="fce-card-title-group" role="presentation" onmouseenter={emitCardHoverLink}>
        <span class="fce-card-file-icon" aria-hidden="true" data-file-kind={card.fileKind} use:applyIcon={getCardFileIcon(card.fileKind)}></span>
        <h4>{#each highlightedTitleSegments as segment, index (index)}{#if segment.highlighted}<mark class="fce-search-hit">{segment.text}</mark>{:else}{segment.text}{/if}{/each}</h4>
        {#if card.referenceCount !== undefined}
          <span class="fce-card-reference-count">{strings.links.referenceCount(card.referenceCount)}</span>
        {/if}
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
    {#if showImage}
      <div class="fce-card-image" class:is-inline={imageMode === "inline"} class:is-cover={appearance.cardImageFit === "cover"}>
        {#if image?.status === "ready" && image.url !== failedUrl}
          {#key image.url}
            <img src={image.url} alt="" draggable="false" decoding="async" class:is-loaded={loadedUrl === image.url}
              class:is-revealing={loadedUrl === image.url && revealUrl === image.url}
              use:revealImage={image.url} />
          {/key}
        {:else if image?.status === "loading"}
          <span class="fce-card-image-placeholder" role="img" aria-label={cardStrings.imageLoading}></span>
        {:else}
          <span class="fce-card-image-placeholder" role="img" aria-label={cardStrings.imageFailed} use:applyIcon={"image"}></span>
        {/if}
      </div>
    {/if}
    {#if !inlineReferences && (previewLines > 0 || searchPreview?.status === "hits")}
    <div
      class="fce-excerpt {searchPreview?.status === 'hits' ? 'is-search' : ''} {card.previewMode === 'code' && (!normalizedSearchQuery || searchPreview?.status === 'title-only') ? 'is-code' : ''} {card.hydrated && (!normalizedSearchQuery || searchPreview) ? '' : 'is-loading'} {(card.previewMode === 'empty' || (card.previewMode !== 'placeholder' && !card.previewHtml)) && card.hydrated && !normalizedSearchQuery ? 'is-empty' : ''}"
      role="presentation"
      style={getPreviewStyle()}
      onmouseenter={emitCardHoverLink}
    >
      {#if normalizedSearchQuery}
        {#if searchPreview?.status === "hits"}
          {#each displayedSnippets as snippet, index (snippet.id)}
            {@const segments = snippetSegments(snippet)}
            {@const html = snippet.presentation ? buildSearchSnippetHtml(segments) : ""}
            {#if index > 0}<div class="fce-preview-context-divider" aria-hidden="true"></div>{/if}
            <button
              type="button"
              class="fce-search-snippet"
              use:measureSnippet={snippet.id}
              aria-label={snippet.text}
              onclick={(event) => onSnippetClick(event, snippet.id)}
              onkeydown={(event) => onSnippetKeydown(event, snippet.id)}
            >
              {#if !snippet.presentation}
                <span class="fce-search-snippet-text">
                  {#each segments as segment, index (index)}
                    {#if segment.highlighted}<mark class="fce-search-hit">{segment.text}</mark>{:else}<span class="fce-search-snippet-context">{segment.text}</span>{/if}
                  {/each}
                </span>
              {:else if snippet.presentation.list}
                {@const list = snippet.presentation.list}
                <span class="fce-search-snippet-layout">
                  {#if list.marker}<span class="fce-preview-list-marker" aria-hidden="true">{list.marker}</span>{/if}
                  {#if list.taskKind !== "none"}
                    <span class="fce-preview-task" class:fce-preview-task-done={list.taskKind === "done"} aria-hidden="true">
                      {#if list.taskKind === "custom"}<span class="fce-preview-task-glyph">{list.taskGlyph}</span>{/if}
                    </span>
                  {/if}
                  {@render snippetBody(html, snippet.presentation.codeBlock)}
                </span>
              {:else}
                {@render snippetBody(html, snippet.presentation.codeBlock)}
              {/if}
            </button>
          {/each}
        {:else if searchPreview?.status === "title-only"}
          {#if card.previewMode === "placeholder"}
            <p class="fce-preview-placeholder">{getCardPlaceholderText(card.fileKind, fileKindStrings)}</p>
          {:else if card.previewMode === "empty" || !card.previewHtml}
            <p class="fce-preview-empty">{cardStrings.placeholderEmpty}</p>
          {:else}
            {@html sanitizedPreviewHtml}
          {/if}
        {:else if searchPreview}
          <p class="fce-preview-empty">{cardStrings.searchBodyUnavailable}</p>
        {:else}
          <p class="fce-preview-empty">{cardStrings.placeholderLoading}</p>
        {/if}
      {:else if card.hydrated}
        {#if card.previewMode === "placeholder"}
          <p class="fce-preview-placeholder">{getCardPlaceholderText(card.fileKind, fileKindStrings)}</p>
        {:else if card.previewMode === "empty" || !card.previewHtml}
          <p class="fce-preview-empty">{cardStrings.placeholderEmpty}</p>
        {:else}
          {@html sanitizedPreviewHtml}
        {/if}
      {:else}
        <p class="fce-preview-empty">{cardStrings.placeholderLoading}</p>
      {/if}
    </div>
    {/if}
    {#if showReferenceList || canToggleReferences}
    <div class="fce-reference-details">
    {#if showReferenceList}
      <div class="fce-excerpt fce-reference-list" aria-label={strings.links.showReferences}>
        {#if linkPreview?.status === "ready"}
          {#each linkPreview.snippets as snippet, index (snippet.id)}
            {#if index > 0}<div class="fce-preview-context-divider" aria-hidden="true"></div>{/if}
            <div class="fce-reference-entry">
              <button type="button" class="fce-search-snippet fce-reference-snippet" class:is-opening={snippet.openingPreview === true} aria-label={snippet.text || card.title} onclick={(event) => onReferenceClick(event, snippet.id, snippet.displayTarget === true)} onkeydown={(event) => onReferenceClick(event, snippet.id, snippet.displayTarget === true)}>
                <div class={snippet.openingPreview ? "fce-excerpt" : "fce-reference-content"} class:is-code={snippet.mode === "code"} style={snippet.openingPreview ? `--fce-preview-line-clamp: ${previewLines};` : undefined} role="presentation" onmouseenter={emitCardHoverLink}>
                  {#if snippet.openingPreview && card.fileKind !== "markdown"}
                    <p class="fce-preview-placeholder">{getCardPlaceholderText(card.fileKind, fileKindStrings)}</p>
                  {:else if snippet.openingPreview && (snippet.mode === "empty" || !snippet.html)}
                    <p class="fce-preview-empty">{cardStrings.placeholderEmpty}</p>
                  {:else}
                    {@html typeof document === "undefined" ? snippet.html : previewHtmlSanitizer(snippet.html, document)}
                  {/if}
                </div>
              </button>
              {#if snippet.referenceCount > 1}<span class="fce-reference-paragraph-count">{snippet.displayTarget ? strings.links.referenceCount(snippet.referenceCount) : strings.links.paragraphCount(snippet.referenceCount)}</span>{/if}
              {#if snippet.targetLocation && !snippet.displayTarget}
                <button type="button" class="fce-reference-target" onclick={(event) => onReferenceClick(event, snippet.id, true)} onkeydown={(event) => onReferenceClick(event, snippet.id, true)}>{strings.links.openTarget}</button>
              {/if}
            </div>
          {/each}
        {:else}
          <p class="fce-preview-empty">{linkPreview?.status === "loading" || !card.hydrated ? cardStrings.placeholderLoading : card.fileKind === "markdown" ? strings.links.referencesUnavailable : getCardPlaceholderText(card.fileKind, fileKindStrings)}</p>
        {/if}
      </div>
    {/if}
    {#if canToggleReferences}
      <button type="button" class="fce-references-toggle" aria-expanded={linkPreview?.expanded ?? false} onclick={onReferencesToggle} onkeydown={onReferencesToggle}>
        {#if linkPreview?.expanded}{strings.links.collapseReferences}
        {:else if normalizedSearchQuery}{strings.links.showReferences}
        {:else}{strings.links.remainingReferences((linkPreview?.totalSnippets ?? 0) - (linkPreview?.snippets.length ?? 0))}{/if}
      </button>
    {/if}
    </div>
    {/if}
    {#if card.taskSummary}
      <CardTaskFooter summary={card.taskSummary} strings={cardStrings} />
    {/if}
  </div>
</div>
