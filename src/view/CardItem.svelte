<script module lang="ts">
  const CARD_WORKSPACE_DRAG_MIME = "application/x-card-workspace-note"; // Duplicated in EditorDropController; update both together.
</script>

<script lang="ts">
  import { contentIcon, renderContentIcon } from "../icon-render";
  import { resolveContentIcon } from "../icon-config";
  import { type DragSession, INTERNAL_CARD_DRAG_MIME } from "./drag-session";
  import { onDestroy } from "svelte";
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
  import type { CardFileDragStarter, CardHoverLinkPayload, NoteCardRecord } from "./types";
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
    nativeFileDrag?: boolean;
    editorDrop?: boolean;
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
    onSearchSnippetsCommand?: (payload: { path: string; command: "expand" | "more" | "collapse" }) => void;
    onToggleReferences?: (payload: { path: string }) => void;
    onBulkSelectCard?: (payload: BulkSelectCardPayload) => void;
    onCardIcon?: (payload: { path: string; anchor: HTMLElement }) => void;
    onCardContextMenu?: (payload: CardContextMenuPayload) => void;
    onPinToggle?: (payload: PinTogglePayload) => void;
    onCardHoverLink?: (payload: CardHoverLinkPayload) => void;
    onCardDragStart?: CardFileDragStarter;
    dragSession?: DragSession;
    resolveCardDragPaths?: (path: string) => string[];
    onImageReveal?: (payload: import("./image-request").CardImageRevealRequest) => boolean;
    previewHtmlSanitizer?: PreviewHtmlSanitizer;
  }

  interface HighlightSegment {
    text: string;
    highlighted: boolean;
  }

  let {
    card,
    nativeFileDrag = true,
    editorDrop = true,    strings = getUiStrings("en"),
    appearance = { cardCornerRadius: "compact", previewLines: 5, searchPreviewSnippetCount: 2 },
    image,
    selected = false,
    bulkMode = false,
    bulkSelected = false,
    pinnedPaths = [],
    searchQuery = "",
    searchMatchCount = 0,
    onOpenNote,
    onSearchSnippetsCommand,
    onToggleReferences,
    onBulkSelectCard,
    onCardIcon,
    onCardContextMenu,
    onPinToggle,
    onCardHoverLink,
    onCardDragStart, dragSession, resolveCardDragPaths,
    onImageReveal,
    previewHtmlSanitizer = sanitizePreviewHtml,
  }: CardItemProps = $props();

  const resolvedIcon = $derived(resolveContentIcon(appearance, { kind: "file", ref: card.path }, getCardFileIcon(card.fileKind)));
  const cardStrings = $derived(strings.cardItem);
  const fileKindStrings = $derived(strings.fileKind);
  const cardCornerRadius = $derived(appearance.cardCornerRadius);
  const previewLines = $derived(appearance.previewLines);
  const searchPreviewSnippetCount = $derived(appearance.searchPreviewSnippetCount);
  const diagram = $derived((card.fileKind === "canvas" || card.fileKind === "excalidraw") && !card.linkPreview);
  const imageMode = $derived(diagram ? "inline" : appearance.cardImageMode ?? "off");
  const showImage = $derived(diagram || (imageMode !== "off" && image !== undefined));
  const missingExport = $derived(diagram && card.fileKind === "excalidraw"
    && image?.status === "diagram" && image.reason === "missing");
  const diagramMessage = $derived(image?.status === "diagram"
    ? ({ empty: fileKindStrings.diagramEmpty, missing: fileKindStrings.diagramMissing,
      invalid: fileKindStrings.diagramInvalid, oversized: fileKindStrings.diagramOversized })[image.reason]
    : fileKindStrings.diagramInvalid);
  let failedUrl = $state<string | null>(null);
  let loadedUrl = $state<string | null>(null);
  let revealUrl = $state<string | null>(null);
  const backgroundColor = $derived(appearance.cardBackgroundOverrides?.[card.path] ?? appearance.cardBackgroundColor ?? "theme");
  const isPinned = $derived(pinnedPaths.includes(card.path));
  const fileExtension = $derived(card.file.extension || "");
  const attachment = $derived(["image", "pdf", "audio", "video", "file"].includes(card.fileKind));
  const highlightedTitleSegments = $derived(getHighlightedTitleSegments(card.title, searchQuery));
  const normalizedSearchQuery = $derived(searchQuery.trim());
  const linkPreview = $derived(card.linkPreview);
  const searchPreview = $derived(card.searchPreview?.query === normalizedSearchQuery
    && card.searchPreview.previewLines === previewLines
    && card.searchPreview.snippetLimit === searchPreviewSnippetCount ? card.searchPreview : undefined);
  const showSearchSnippetControls = $derived(searchPreview?.status === "hits" && (searchPreview.expanded || (searchPreview.totalSnippets ?? searchPreview.snippets.length) > searchPreview.snippets.length));
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
  let snippetObserver: ResizeObserver | null = null;
  type Snippet = NonNullable<NoteCardRecord["searchPreview"]>["snippets"][number];
  const snippetSegmentCache = new Map<string, {
    snippet: Snippet; width: number; fonts: Record<string, string>; segments: SearchSnippetSegment[];
  }>();
  const snippetMeasurements = new Map<string, () => void>();
  let snippetMeasureQueued = false;
  let checkSnippetFont = true;
  function scheduleSnippetMeasures(): void {
    if (snippetMeasureQueued) return;
    snippetMeasureQueued = true;
    queueMicrotask(() => {
      snippetMeasureQueued = false;
      checkSnippetFont = true;
      for (const measure of snippetMeasurements.values()) measure();
    });
  }
  const displayedSnippets = $derived(searchPreview?.status === "hits" ? searchPreview.snippets : []);
  const snippetsById = $derived(new Map(displayedSnippets.map(snippet => [snippet.id, snippet])));

  // A font size change alters glyph widths without resizing the snippet box, so ResizeObserver misses it.
  $effect(() => {
    void appearance.uiFontSize;
    for (const key of Object.keys(measuredFonts)) delete measuredFonts[key];
    scheduleSnippetMeasures();
  });
  function measureSnippet(node: HTMLButtonElement, id: string) {
    const content = node.querySelector<HTMLElement>(".fce-search-snippet-text")!;
    const measure = (): void => {
      const width = content.clientWidth;
      if (!width) return;
      const win = node.ownerDocument.defaultView;
      if (checkSnippetFont) {
        checkSnippetFont = false;
        const currentFont = win?.getComputedStyle(node).font ?? "";
        if (measuredFonts.text !== currentFont) {
          for (const key of Object.keys(measuredFonts)) delete measuredFonts[key];
          measuredFonts.text = currentFont;
        }
      }
      const font = measuredFonts.text ?? "";
      const snippet = snippetsById.get(id);
      const presentation = snippet?.presentation;
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
      if (snippet && textMeasure) {
        const segments = getSnippetSegments(snippet, width, fonts);
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
    if (!snippetObserver && typeof ResizeObserver !== "undefined") snippetObserver = new ResizeObserver(scheduleSnippetMeasures);
    snippetObserver?.observe(content);
    return { destroy() {
      snippetObserver?.unobserve?.(content);
      snippetMeasurements.delete(id);
      snippetSegmentCache.delete(id);
      delete snippetMetrics[id];
    } };
  }
  let activeDragGhost: HTMLElement | null = null;
  let finishNativeDrag: (() => void) | null = null;
  let dragSource: { classList?: DOMTokenList } | null = null;

  function finishCardDrag(): void {
    const finish = finishNativeDrag;
    finishNativeDrag = null;
    finish?.();
    dragSource?.classList?.remove("is-dragging");
    dragSource = null;
    removeDragGhost();
  }

  onDestroy(() => {
    finishCardDrag();
    snippetObserver?.disconnect();
    snippetMeasurements.clear();
    snippetSegmentCache.clear();
  });

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

  function createDragGhost(doc: Document, count = 1): HTMLElement {
    const ghost = doc.createElement("div");
    ghost.className = "fce-card-drag-ghost";

    const self = doc.createElement("div");
    self.className = "fce-card-drag-ghost-self";

    const icon = resolvedIcon.kind === "none" ? null : doc.createElement("span");
    if (icon) {
      icon.className = "fce-card-drag-ghost-icon";
      icon.setAttribute("aria-hidden", "true");
      renderContentIcon(icon, { spec: resolvedIcon, fallback: getCardFileIcon(card.fileKind) });
    }

    const title = doc.createElement("span");
    title.className = "fce-card-drag-ghost-title";
    title.textContent = card.title;

    const action = doc.createElement("div");
    action.className = "fce-card-drag-ghost-action";
    action.textContent = cardStrings.dragInsert;

    if (icon) self.append(icon);
    self.append(title);
    if (count > 1) { const badge = doc.createElement("span"); badge.className = "fce-card-drag-count"; badge.textContent = String(count); self.append(badge); }
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

  function getSnippetSegments(snippet: Snippet, width = 0, fonts: Record<string, string> = {}): SearchSnippetSegment[] {
    const cached = snippetSegmentCache.get(snippet.id);
    if (cached?.snippet === snippet && cached.width === width
      && cached.fonts.text === fonts.text && cached.fonts.code === fonts.code
      && cached.fonts.heading === fonts.heading && cached.fonts["code-heading"] === fonts["code-heading"]) return cached.segments;
    const segments = buildSearchSnippetSegments(snippet, width, width > 0 && textMeasure ? (value, kind, heading) => {
      textMeasure!.font = fonts[kind === "code" ? heading ? "code-heading" : "code" : heading ? "heading" : "text"] ?? fonts.text;
      return textMeasure!.measureText(value).width + (kind === "code" && !snippet.presentation?.codeBlock ? 6 : 0);
    } : undefined);
    snippetSegmentCache.set(snippet.id, { snippet, width, fonts, segments });
    return segments;
  }

  function snippetSegments(snippet: Snippet): SearchSnippetSegment[] {
    const metrics = snippet.presentation?.list ? snippetMetrics[snippet.id] : { width: snippetWidth, fonts: snippetFonts };
    return getSnippetSegments(snippet, metrics?.width, metrics?.fonts);
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

  function onSearchSnippets(event: MouseEvent | KeyboardEvent, command: "expand" | "more" | "collapse"): void {
    event.stopPropagation();
    if ("key" in event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (event.repeat) return;
    }
    if (bulkMode) emitBulkSelect(event.shiftKey);
    else onSearchSnippetsCommand?.({ path: card.path, command });
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

  function handleCardDragStart(event: DragEvent): void {
    if ((!nativeFileDrag && !editorDrop && !dragSession) || event.dataTransfer == null) {
      return;
    }

    const cardEl = event.currentTarget as { classList?: DOMTokenList; ownerDocument?: Document } | null;
    const doc = cardEl?.ownerDocument;
    if (cardEl == null || doc?.body == null) {
      return;
    }

    finishCardDrag();
    finishNativeDrag = nativeFileDrag ? onCardDragStart?.({ path: card.path, event }) ?? null : null;
    // Native initialization may write transfer data. Always retain our editor protocol afterwards.
    if (editorDrop) event.dataTransfer.setData(CARD_WORKSPACE_DRAG_MIME, JSON.stringify({ path: card.path, title: card.title }));
    const paths = resolveCardDragPaths?.(card.path) ?? [card.path];
    if (dragSession) {
      dragSession.begin({ kind: "cards", paths }, doc, "native", event.clientX, event.clientY);
      event.dataTransfer.setData(INTERNAL_CARD_DRAG_MIME, JSON.stringify(paths));
    }
    event.dataTransfer.effectAllowed = dragSession ? "all" : finishNativeDrag ? "copyLink" : "copy";
    dragSource = cardEl;
    cardEl.classList?.add("is-dragging");
    if (finishNativeDrag && paths.length === 1) return;

    if (!finishNativeDrag) {
      const nativeDragImage = doc.createElement("div");
      nativeDragImage.className = "fce-card-native-drag-image";
      doc.body.appendChild(nativeDragImage);
      event.dataTransfer.setDragImage(nativeDragImage, 0, 0);
      requestAnimationFrame(() => nativeDragImage.remove());
    }

    const ghost = createDragGhost(doc, paths.length);
    doc.body.appendChild(ghost);
    activeDragGhost = ghost;
    moveDragGhost(event);
  }

  function onCardDrag(event: DragEvent): void {
    moveDragGhost(event);
  }

  function onCardDragEnd(): void {
    finishCardDrag();
    dragSession?.cancel();
  }

  function touchDrag(node: HTMLElement) {
    return dragSession?.bindTouch(node, () => ({ kind: "cards", paths: resolveCardDragPaths?.(card.path) ?? [card.path], label: card.title }));
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
    const pending = searchPreview?.status === "pending";
    const count = pending ? searchPreview.expectedSnippetCount ?? searchPreviewSnippetCount : displayedSnippets.length;
    const lines = searchPreview?.status === "hits" || (pending && count > 0) ? count * 2 : previewLines;
    const dividers = Math.max(0, count - 1);
    return `--fce-preview-line-clamp: ${lines}; --fce-preview-divider-count: ${dividers};`;
  }
</script>

{#snippet snippetBody(html: string, codeBlock: boolean)}
  <span class="fce-search-snippet-text" class:is-code={codeBlock}>{@html html}</span>
{/snippet}

<div
  class="fce-card fce-card-radius-{cardCornerRadius} {selected ? 'is-selected' : ''} {bulkSelected ? 'is-bulk-selected' : ''} {isPinned ? 'is-pinned' : ''}"
  data-fce-card-background={backgroundColor === "theme" ? undefined : backgroundColor}
  role="button"
  tabindex="0"
  draggable={nativeFileDrag || editorDrop || !!dragSession}
  onclick={onCardClick}
  onkeydown={onCardKeydown}
  use:touchDrag
  oncontextmenu={onCardContextMenuAction}
  ondragstart={handleCardDragStart}
  ondrag={onCardDrag}
  ondragend={onCardDragEnd}
>
  <div class="fce-card-body" class:has-right-image={showImage && imageMode === "right"} class:has-search-controls={showSearchSnippetControls} class:has-reference-preview={inlineReferences} class:has-reference-details={!!showReferenceList || !!canToggleReferences}>
    <div class="fce-card-header">
      <div class="fce-card-title-group" role="presentation">
        {#if resolvedIcon.kind !== "none"}
        <button type="button" class="fce-card-file-icon fce-content-icon-button" aria-label={strings.icons.change}
          data-file-kind={card.fileKind} draggable="false"
          onpointerdown={(event) => { event.preventDefault(); event.stopPropagation(); }}
          ondragstart={(event) => { event.preventDefault(); event.stopPropagation(); }}
          onkeydown={(event) => event.stopPropagation()}
          onclick={(event) => { event.preventDefault(); event.stopPropagation(); onCardIcon?.({ path: card.path, anchor: event.currentTarget }); }}
          use:contentIcon={{ spec: resolvedIcon, fallback: getCardFileIcon(card.fileKind) }}></button>
        {/if}
        <div class="fce-card-title-text" role="presentation" onmouseenter={emitCardHoverLink}>
        {#if attachment && fileExtension}<span class="fce-card-extension">{fileExtension.toUpperCase()}</span>{/if}
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
      <div class="fce-card-image" role="presentation" onmouseenter={diagram ? emitCardHoverLink : undefined} class:is-inline={imageMode === "inline"} class:is-missing-export={missingExport} class:is-cover={!diagram && appearance.cardImageFit === "cover"}>
        {#if image?.status === "ready" && image.url !== failedUrl}
          {#key image.url}
            <img src={image.url} alt="" draggable="false" decoding="async" class:is-loaded={loadedUrl === image.url}
              class:is-revealing={loadedUrl === image.url && revealUrl === image.url}
              use:revealImage={image.url} />
          {/key}
        {:else if image?.status === "loading" || (diagram && !image)}
          <span class="fce-card-image-placeholder" role="img" aria-label={cardStrings.imageLoading}></span>
        {:else if diagram}
          <span class="fce-card-image-placeholder fce-diagram-message">{diagramMessage}</span>
        {:else}
          <span class="fce-card-image-placeholder" role="img" aria-label={cardStrings.imageFailed} use:applyIcon={"image"}></span>
        {/if}
        {#if diagram && image?.status === "ready" && image.truncated}
          <span class="fce-diagram-truncated">{fileKindStrings.diagramTruncated}</span>
        {/if}
      </div>
    {/if}
    {#if !diagram && !inlineReferences && (previewLines > 0 || searchPreview?.status === "hits" || searchPreview?.status === "pending")}
    <div
      class="fce-excerpt {searchPreview?.status === 'hits' || (searchPreview?.status === 'pending' && searchPreview.expectedSnippetCount !== 0) ? 'is-search' : ''} {card.previewMode === 'code' && (!normalizedSearchQuery || searchPreview?.status === 'title-only') ? 'is-code' : ''} {searchPreview?.status === 'pending' ? 'is-search-pending' : ''} {card.hydrated && (!normalizedSearchQuery || searchPreview) ? '' : 'is-loading'} {(card.previewMode === 'empty' || (card.previewMode !== 'placeholder' && !card.previewHtml)) && card.hydrated && !normalizedSearchQuery ? 'is-empty' : ''}"
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
        {:else if searchPreview?.status === "pending"}
          <span class="fce-search-pending" role="status" aria-label={cardStrings.placeholderLoading}>
            {#each Array.from({ length: searchPreview.expectedSnippetCount === 0 ? 1 : searchPreview.expectedSnippetCount ?? searchPreviewSnippetCount }) as _, index (index)}
              {#if index > 0}<span class="fce-preview-context-divider" aria-hidden="true"></span>{/if}
              <span class="fce-search-pending-lines" aria-hidden="true"></span>
            {/each}
          </span>
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
    {#if showSearchSnippetControls && searchPreview}
      <div class="fce-search-snippet-controls">
        {#if (searchPreview.totalSnippets ?? displayedSnippets.length) > displayedSnippets.length}
          <button type="button" class="fce-search-snippets-toggle" aria-expanded={searchPreview.expanded ?? false}
            onclick={(event) => onSearchSnippets(event, searchPreview?.expanded ? "more" : "expand")}
            onkeydown={(event) => onSearchSnippets(event, searchPreview?.expanded ? "more" : "expand")}>
            {searchPreview.expanded ? cardStrings.searchSnippetsMore : cardStrings.searchSnippetsExpand((searchPreview.totalSnippets ?? displayedSnippets.length) - displayedSnippets.length)}
          </button>
        {/if}
        {#if searchPreview.expanded}
          <button type="button" class="fce-search-snippets-toggle" aria-expanded="true"
            onclick={(event) => onSearchSnippets(event, "collapse")}
            onkeydown={(event) => onSearchSnippets(event, "collapse")}>{cardStrings.searchSnippetsCollapse}</button>
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
