<script lang="ts">
  import { NAVIGATION_FILTER_FOCUS_ID } from "./navigation-model";
  import { setIcon, setTooltip } from "obsidian";
  import { tick } from "svelte";
  import { getUiStrings, type UiStrings } from "../i18n";
  import { NAV_PANE_WIDTH_MAX, NAV_PANE_WIDTH_MIN } from "../settings";
  import type { PanelNavState, PanelScopeState } from "./panel-model";
  import type { NavigationIntent, NavigationRow } from "./navigation-model";
  import { navigationSubtreeHover } from "./navigation-hover";
  import { resolveNavigationFocus, resolveNavigationKey, resolveSeparatorWidth } from "./navigation-keyboard";
  import {
    canAcceptFavoriteDrop,
    favoriteRowDragState,
    resolveFavoriteDropPosition,
    type FavoriteDragState,
  } from "./navigation-favorite-dnd";
  import { folderRowDragState, resolveFolderDrop, folderDragScrollSpeed,
    type FolderDragState, type FolderDropTarget } from "./navigation-folder-dnd";
  import NavigationTreeRow from "./NavigationTreeRow.svelte";
  import { canAcceptNavigationSortDrop, navigationSortEntry, navigationSortRowDragState,
    type NavigationSortDragState } from "./navigation-sort-dnd";
  import type { FolderActionPayload, NavContextMenuPayload } from "./types";
  interface Props {
    strings?: UiStrings;
    nav?: PanelNavState;
    scope?: PanelScopeState;
    activeFilterTags?: string[];
    onFolderAction?: (payload: FolderActionPayload) => void;
    onFilterChange?: (payload: { tags: string[] }) => void;
    onPropertyCommand?: (payload: { command: "choose-visible" | "clear-filters" }) => void;
    onBoxCommand?: (payload: { command: string; boxId?: string }) => void;
    onNavContextMenu?: (payload: NavContextMenuPayload) => void;
    onNavigationIntent?: (payload: NavigationIntent) => void;
    onNavPaneResize?: (width: number) => void;
    onToggleNavPane?: () => void; [key: string]: unknown;
  }
  const EMPTY_NAV: PanelNavState = {
    folderTree: [], favorites: [], boxSummaries: [], paneWidth: 240, layoutMode: "dual", visible: true,
    sectionCollapsed: { favorites: false, folders: false, tags: false, properties: false, boxes: false, links: false }, showItemCounts: false,
    tooltipSide: "right", propertyFilterCount: 0, projection: { normalizedQuery: "", querying: false, sections: [], rows: [], noResults: false },
    query: "", focusId: null, focusRequest: null, revealRequest: null,
  };
  const EMPTY_SCOPE: PanelScopeState = {
    displayPath: "", includeSubfolders: true, activeBoxId: null, activeBoxName: null,
    boxExcludedCount: 0, emptyStateMessage: "",
    sourceIdentity: "folder::true", browseTagFilterEnabled: true, browsePropertyFilterEnabled: true,
    supportsIncludeSubfolders: true, supportsBoxRuleSeeding: true,
  };
  let {
    strings = getUiStrings("en"), nav = EMPTY_NAV, scope = EMPTY_SCOPE, activeFilterTags = [],
    onFolderAction, onFilterChange, onPropertyCommand, onBoxCommand,
    onNavContextMenu, onNavigationIntent, onNavPaneResize, onToggleNavPane,
  }: Props = $props();
  const labels = $derived(strings.toolbar.navPane);
  const rows = $derived(nav.projection.rows);
  const browseTagFilterEnabled = $derived(scope.browseTagFilterEnabled);
  const browsePropertyFilterEnabled = $derived(scope.browsePropertyFilterEnabled);
  let dragWidth = $state<number | null>(null);
  let composing = $state(false);
  let treeHasFocus = $state(false);
  let treeEl: HTMLElement | null = $state(null);
  let scrollerEl: HTMLElement | null = $state(null);
  let filterEl: HTMLInputElement | null = $state(null);
  let hoveredRowIds = $state<ReadonlySet<string>>(new Set());
  let favoriteDrag = $state<FavoriteDragState>({ source: null, target: null });
  let folderDrag = $state<FolderDragState>({ source: null, target: null });
  let sortDrag = $state<NavigationSortDragState>({ sourceId: null, target: null });
  const rowsById = $derived(new Map(rows.map((row) => [row.id, row])));
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollFrame: number | null = null;
  let scrollTime = 0;
  let pointerX = 0, pointerY = 0;
  let suppressClickUntil = 0;
  let previousRowIds: string[] = [];
  let rowElements = new Map<string, HTMLElement>();
  let consumedRevealToken = 0;
  let consumedFocusReturnToken = 0;
  let highlightedRowId: string | null = $state(null);
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const paneLabelId = $props.id();
  const resizeHelpId = `${paneLabelId}-resize-help`;
  const paneWidth = $derived(dragWidth ?? nav.paneWidth);
  const focusId = $derived(resolveNavigationFocus(rows, nav.focusId, previousRowIds));
  $effect(() => { if (dragWidth === nav.paneWidth) dragWidth = null; });
  $effect(() => {
    const ids = rows.map((row) => row.id);
    const nextFocus = resolveNavigationFocus(rows, nav.focusId, previousRowIds);
    if (nextFocus !== nav.focusId && (nav.focusId !== null || treeHasFocus)) emitIntent({ type: "focus", rowId: nextFocus });
    previousRowIds = ids;
    if (treeHasFocus && nextFocus) void tick().then(() => {
      const activeRow = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-nav-row-id]");
      if (activeRow && treeEl?.contains(activeRow)) return;
      rowElements.get(nextFocus)?.focus();
    });
  });
  $effect(() => {
    const request = nav.revealRequest;
    if (request && request.token > consumedRevealToken && nav.visible) {
      void consumeRevealAfterRender(request.token, request.rowId, request.highlight === true);
    }
  });
  $effect(() => { const request = nav.focusRequest; if (request && request.token > consumedFocusReturnToken && nav.visible)
    void consumeFocusReturnAfterRender(request.token, request.rowId); });
  $effect(() => {
    if (highlightedRowId && (!nav.visible || !rowsById.has(highlightedRowId))) clearRevealHighlight();
  });
  $effect(() => {
    if (folderDrag.source !== null && (!nav.visible || !rowsById.has(`folder:${folderDrag.source}`))) clearFolderDrag();
    else if (folderDrag.target !== null && !rowsById.has(`folder:${folderDrag.target.path}`)) updateFolderTarget(null);
  });
  $effect(() => {
    const source = sortDrag.sourceId === null ? undefined : rowsById.get(sortDrag.sourceId);
    const target = sortDrag.target === null ? undefined : rowsById.get(sortDrag.target.rowId);
    if (sortDrag.sourceId !== null && (!nav.visible || !source || !navigationSortEntry(source))) clearSortDrag();
    else if (sortDrag.target !== null && (!target || !canAcceptNavigationSortDrop(source, target))) sortDrag = { ...sortDrag, target: null };
  });
  $effect(() => () => { disposed = true; clearFolderDrag(); clearSortDrag(); clearRevealHighlight(); rowElements.clear(); });
  function icon(node: HTMLElement, name: string): { update: (next: string) => void } {
    setIcon(node, name);
    return { update: (next) => setIcon(node, next) };
  }
  function tooltip(node: HTMLElement, text: string): { update: (next: string) => void } {
    setTooltip(node, text, { placement: nav.tooltipSide, gap: 8 });
    return { update: (next) => setTooltip(node, next, { placement: nav.tooltipSide, gap: 8 }) };
  }
  function bindRow(node: HTMLElement, rowId: string): { destroy: () => void } {
    rowElements.set(rowId, node);
    return { destroy: () => { if (rowElements.get(rowId) === node) rowElements.delete(rowId); } };
  }
  function emitIntent(intent: NavigationIntent): void {
    onNavigationIntent?.(Object.freeze(intent));
  }
  function focusRow(rowId: string): void {
    emitIntent({ type: "focus", rowId });
    const target = rowElements.get(rowId);
    if (target) target.focus();
    else void tick().then(() => rowElements.get(rowId)?.focus());
  }
  function activate(event: MouseEvent, row: NavigationRow): void {
    if (row.disabled || performance.now() < suppressClickUntil) { event.preventDefault(); return; }
    focusRow(row.id);
    const additive = (row.kind === "tag" || row.kind === "property-value" || (row.kind === "favorite" && row.favorite.kind === "tag"))
      && (event.ctrlKey || event.metaKey);
    emitIntent({ type: "activate", rowId: row.id, mode: additive ? "additive" : "ordinary" });
  }
  function toggleExpansion(event: MouseEvent, row: NavigationRow): void {
    event.preventDefault(); event.stopPropagation();
    if (performance.now() < suppressClickUntil) return;
    emitIntent({ type: "focus", rowId: row.id });
    (event.currentTarget as HTMLElement).closest<HTMLElement>("[role=treeitem]")?.focus({ preventScroll: true });
    emitIntent({ type: "set-expanded", rowId: row.id, expanded: !row.expanded });
  }
  function keydown(event: KeyboardEvent, row: NavigationRow): void {
    const command = resolveNavigationKey(event, rows, row.id);
    if (!command) return;
    event.preventDefault(); event.stopPropagation();
    if (command.type === "focus") { focusRow(command.rowId); return; }
    if (command.type === "expand") {
      emitIntent({ type: "set-expanded", rowId: command.rowId, expanded: command.expanded }); return;
    }
    if (command.type === "menu") { openPositionMenu(row, event.currentTarget as HTMLElement); return; }
    if (!row.disabled) emitIntent({ type: "activate", rowId: row.id, mode: command.mode });
  }
  function menuPayload(row: NavigationRow, trigger: NavContextMenuPayload["trigger"]): NavContextMenuPayload {
    return Object.freeze({ ...row.menuTarget, originId: row.id, trigger: Object.freeze(trigger) });
  }

  // Folder drag state is presentation-only; durable decisions go through host intents.
  function stopScroll(): void {
    if (scrollFrame !== null) scrollerEl?.ownerDocument.defaultView?.cancelAnimationFrame(scrollFrame);
    scrollFrame = null; scrollTime = 0;
  }
  function updateFolderTarget(target: FolderDropTarget | null): void {
    const previous = folderDrag.target;
    if (previous?.path === target?.path && previous?.operation === target?.operation) return;
    if (hoverTimer !== null) { clearTimeout(hoverTimer); hoverTimer = null; }
    folderDrag = { ...folderDrag, target };
    if (target?.operation === "inside") {
      const row = rowsById.get(`folder:${target.path}`);
      if (row?.expandable && !row.expanded) {
        hoverTimer = setTimeout(() => {
          hoverTimer = null;
          if (folderDrag.source !== null && folderDrag.target?.path === target.path
            && folderDrag.target.operation === "inside") emitIntent({ type: "drag-expand-folder", path: target.path });
        }, 600);
      }
    }
  }
  function clearFolderDrag(): void {
    const hadSource = folderDrag.source !== null;
    stopScroll(); updateFolderTarget(null);
    if (hoverTimer !== null) { clearTimeout(hoverTimer); hoverTimer = null; }
    if (hadSource) {
      folderDrag = { source: null, target: null };
      suppressClickUntil = performance.now() + 300;
      emitIntent({ type: "clear-folder-drag" });
    }
  }
  function folderTargetAt(element: Element | null): void {
    const node = element?.closest<HTMLElement>("[data-nav-row-id]");
    const row = node && scrollerEl?.contains(node) ? rowsById.get(node.dataset.navRowId ?? "") : null;
    if (sortDrag.sourceId !== null) {
      const target = row && node && canAcceptNavigationSortDrop(rowsById.get(sortDrag.sourceId), row)
        ? { rowId: row.id, position: resolveFavoriteDropPosition(pointerY, node.getBoundingClientRect()) } : null;
      if (sortDrag.target?.rowId !== target?.rowId || sortDrag.target?.position !== target?.position) sortDrag = { ...sortDrag, target };
      return;
    }
    updateFolderTarget(row?.kind === "folder" && node
      ? resolveFolderDrop(folderDrag.source, row.folderPath, pointerY, node.getBoundingClientRect()) : null);
  }
  function scrollDragFrame(time: number): void {
    scrollFrame = null;
    if ((folderDrag.source === null && sortDrag.sourceId === null) || !scrollerEl) return;
    const speed = folderDragScrollSpeed(pointerY, scrollerEl.getBoundingClientRect());
    if (speed === 0) { scrollTime = 0; return; }
    const elapsed = scrollTime ? Math.min(time - scrollTime, 50) : 16;
    scrollTime = time;
    const previous = scrollerEl.scrollTop;
    scrollerEl.scrollTop = Math.max(0, Math.min(scrollerEl.scrollHeight - scrollerEl.clientHeight,
      previous + speed * elapsed / 1000));
    if (scrollerEl.scrollTop === previous) { scrollTime = 0; return; }
    folderTargetAt(scrollerEl.ownerDocument.elementFromPoint(pointerX, pointerY));
    if ((speed < 0 && scrollerEl.scrollTop === 0)
      || (speed > 0 && scrollerEl.scrollTop >= scrollerEl.scrollHeight - scrollerEl.clientHeight)) {
      scrollTime = 0; return;
    }
    scrollFrame = scrollerEl.ownerDocument.defaultView?.requestAnimationFrame(scrollDragFrame) ?? null;
  }
  function folderDragSurface(node: HTMLElement): { destroy: () => void } {
    const doc = node.ownerDocument;
    const over = (event: DragEvent): void => {
      if (folderDrag.source === null && sortDrag.sourceId === null) return;
      pointerX = event.clientX; pointerY = event.clientY;
      folderTargetAt((event.target as Node | null)?.nodeType === 1 ? event.target as Element : null);
      if (folderDrag.target !== null || sortDrag.target !== null) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      }
      if (folderDragScrollSpeed(pointerY, node.getBoundingClientRect()) !== 0) {
        if (scrollFrame === null) scrollFrame = doc.defaultView?.requestAnimationFrame(scrollDragFrame) ?? null;
      } else stopScroll();
    };
    const leave = (event: DragEvent): void => {
      const related = event.relatedTarget as Node | null;
      if (related?.nodeType && node.contains(related)) return;
      if (event.target !== node && related === null) return;
      stopScroll(); updateFolderTarget(null); sortDrag = { ...sortDrag, target: null };
    };
    const outside = (event: DragEvent): void => {
      if ((folderDrag.source !== null || sortDrag.sourceId !== null) && (!(event.target as Node | null)?.nodeType || !node.contains(event.target as Node))) {
        stopScroll(); updateFolderTarget(null); sortDrag = { ...sortDrag, target: null };
      }
    };
    const drop = (): void => { clearFolderDrag(); clearSortDrag(); };
    node.addEventListener("dragover", over);
    node.addEventListener("dragleave", leave);
    node.addEventListener("drop", drop);
    doc.addEventListener("dragover", outside);
    doc.addEventListener("dragend", drop);
    doc.defaultView?.addEventListener("blur", drop);
    return { destroy: () => {
      clearFolderDrag(); clearSortDrag();
      node.removeEventListener("dragover", over); node.removeEventListener("dragleave", leave);
      node.removeEventListener("drop", drop); doc.removeEventListener("dragover", outside);
      doc.removeEventListener("dragend", drop); doc.defaultView?.removeEventListener("blur", drop);
    } };
  }
  function onRowDragStart(event: DragEvent, row: NavigationRow): void {
    clearSortDrag();
    if (navigationSortEntry(row)) {
      clearFavoriteDrag(); clearFolderDrag();
      sortDrag = { sourceId: row.id, target: null };
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-card-workspace-navigation-order", row.id);
      }
      return;
    }
    if (row.kind !== "folder") { clearFolderDrag(); onFavoriteDragStart(event, row); return; }
    clearFavoriteDrag(); clearFolderDrag();
    if (!row.folderPath) { event.preventDefault(); return; }
    folderDrag = { source: row.folderPath, target: null };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-card-workspace-folder", row.folderPath);
    }
  }
  function onRowDrop(event: DragEvent, row: NavigationRow): void {
    if (sortDrag.sourceId !== null) {
      const sourceId = sortDrag.sourceId;
      const accepted = canAcceptNavigationSortDrop(rowsById.get(sourceId), row);
      const position = resolveFavoriteDropPosition(event.clientY, (event.currentTarget as HTMLElement).getBoundingClientRect());
      event.preventDefault(); clearSortDrag();
      if (accepted) emitIntent({ type: "reorder-navigation-items", sourceId, targetId: row.id, position });
      return;
    }
    if (folderDrag.source === null) { onFavoriteDrop(event, row); return; }
    const sourcePath = folderDrag.source;
    const target = row.kind === "folder"
      ? resolveFolderDrop(sourcePath, row.folderPath, event.clientY, (event.currentTarget as HTMLElement).getBoundingClientRect()) : null;
    event.preventDefault(); clearFolderDrag();
    if (!target) return;
    if (target.operation === "inside") emitIntent({ type: "move-folder", sourcePath, targetFolderPath: target.path });
    else emitIntent({ type: "reorder-folders", sourcePath, targetPath: target.path, position: target.operation });
  }
  function onRowDragEnd(): void { clearFavoriteDrag(); clearFolderDrag(); clearSortDrag(); }
  function clearSortDrag(): void {
    if (sortDrag.sourceId !== null) {
      suppressClickUntil = performance.now() + 300;
      stopScroll();
    }
    sortDrag = { sourceId: null, target: null };
  }

  // -- Favorites manual drag reorder (favorites section only) ----------------

  function clearFavoriteDrag(): void {
    favoriteDrag = { source: null, target: null };
  }

  function onFavoriteDragStart(event: DragEvent, row: NavigationRow): void {
    if (row.kind !== "favorite") return;
    favoriteDrag = { source: { ...row.favorite }, target: null };
    if (event.dataTransfer != null) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", row.id);
    }
  }

  function onFavoriteDragOver(event: DragEvent, row: NavigationRow): void {
    if (row.kind !== "favorite" || !canAcceptFavoriteDrop(favoriteDrag.source, row.favorite)) return;
    event.preventDefault();
    if (event.dataTransfer != null) event.dataTransfer.dropEffect = "move";
    favoriteDrag = {
      ...favoriteDrag,
      target: {
        rowId: row.id,
        position: resolveFavoriteDropPosition(event.clientY, (event.currentTarget as HTMLElement).getBoundingClientRect()),
      },
    };
  }

  function onFavoriteDrop(event: DragEvent, row: NavigationRow): void {
    if (row.kind !== "favorite" || !canAcceptFavoriteDrop(favoriteDrag.source, row.favorite)) {
      clearFavoriteDrag();
      return;
    }
    event.preventDefault();
    const position = favoriteDrag.target?.rowId === row.id
      ? favoriteDrag.target.position
      : resolveFavoriteDropPosition(event.clientY, (event.currentTarget as HTMLElement).getBoundingClientRect());
    const source = favoriteDrag.source;
    if (source === null) return;
    const target = { ...row.favorite };
    clearFavoriteDrag();
    emitIntent({ type: "reorder-favorites", source, target, position });
  }

  function pointerMenu(event: MouseEvent, row: NavigationRow): void {
    event.preventDefault(); event.stopPropagation();
    onNavContextMenu?.(menuPayload(row, { kind: "pointer", mouseEvent: event }));
  }
  function openPositionMenu(row: NavigationRow, anchor: Element | null | undefined): void {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const position = Object.freeze({ x: rect.left, y: rect.bottom });
    onNavContextMenu?.(menuPayload(row, { kind: "position", position }));
  }
  function onFilterInput(event: Event): void { emitIntent({ type: "query-update", query: (event.currentTarget as HTMLInputElement).value }); }
  function onFilterClick(event: MouseEvent): void {
    if (event.defaultPrevented || !(event.target instanceof Element) || event.target.closest("input, button")) return;
    filterEl?.focus();
  }
  function clearFilter(origin: "input" | "tree" | "menu" = "input"): void {
    emitIntent({ type: "query-clear", origin }); if (origin === "input") void tick().then(() => filterEl?.focus());
  }
  function onFilterKeydown(event: KeyboardEvent): void {
    if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && nav.visible && focusId && rowElements.has(focusId)) {
      event.preventDefault(); event.stopPropagation(); focusRow(focusId); return;
    }
    if (event.key !== "Escape" || composing || nav.query.trim().length === 0) return;
    event.preventDefault(); clearFilter("input");
  }
  function actionClick(event: MouseEvent, action: () => void): void {
    event.preventDefault(); event.stopPropagation(); if (performance.now() < suppressClickUntil) return; action();
  }
  function clearRevealHighlight(): void {
    if (highlightTimer !== null) clearTimeout(highlightTimer);
    highlightTimer = null;
    highlightedRowId = null;
  }
  function highlightRevealedRow(rowId: string): void {
    clearRevealHighlight();
    highlightedRowId = rowId;
    highlightTimer = setTimeout(clearRevealHighlight, 2400);
  }
  async function consumeRevealAfterRender(token: number, rowId: string, highlight: boolean): Promise<void> {
    await tick();
    if (disposed || token <= consumedRevealToken || nav.revealRequest?.token !== token || !nav.visible) return;
    const target = rowElements.get(rowId);
    if (!target || !scrollerEl) return;
    const targetRect = target.getBoundingClientRect();
    const scrollerRect = scrollerEl.getBoundingClientRect();
    const visible = targetRect.top >= scrollerRect.top && targetRect.bottom <= scrollerRect.bottom
      && targetRect.left >= scrollerRect.left && targetRect.right <= scrollerRect.right;
    if (highlight) {
      // Move only the navigation scroller; other panes keep their scroll position.
      scrollerEl.scrollTop += targetRect.top - scrollerRect.top - (scrollerRect.height - targetRect.height) / 2;
      highlightRevealedRow(rowId);
    } else {
      clearRevealHighlight();
      if (!visible) target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
    consumedRevealToken = token;
    emitIntent({ type: "reveal-consumed", token });
  }
  async function consumeFocusReturnAfterRender(token: number, rowId: string): Promise<void> {
    await tick(); if (disposed || token <= consumedFocusReturnToken || nav.focusRequest?.token !== token || !nav.visible) return;
    const target = rowId === NAVIGATION_FILTER_FOCUS_ID ? filterEl
      : rowElements.get(rowId) ?? (nav.focusId ? rowElements.get(nav.focusId) : null) ?? filterEl; if (!target) return;
    target.focus(); consumedFocusReturnToken = token;
    emitIntent({ type: "focus-return-consumed", token });
  }
  function isRtl(node: HTMLElement): boolean { return getComputedStyle(node).direction === "rtl"; }
  function beginResize(event: PointerEvent): void {
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startWidth = dragWidth ?? nav.paneWidth;
    const direction = isRtl(handle) ? -1 : 1;
    const clamp = (value: number) => Math.max(NAV_PANE_WIDTH_MIN, Math.min(NAV_PANE_WIDTH_MAX, value));
    const move = (next: PointerEvent): void => { dragWidth = clamp(Math.round(startWidth + direction * (next.clientX - startX))); };
    const cleanup = (next: PointerEvent): void => {
      handle.releasePointerCapture?.(next.pointerId);
      handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", cancel);
    };
    const end = (next: PointerEvent): void => {
      cleanup(next);
      const width = dragWidth ?? startWidth;
      if (width !== startWidth) onNavPaneResize?.(width);
    };
    const cancel = (next: PointerEvent): void => { cleanup(next); dragWidth = null; };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", cancel);
  }
  function resizeKeydown(event: KeyboardEvent): void {
    const width = resolveSeparatorWidth(event.key, paneWidth, event.shiftKey, isRtl(event.currentTarget as HTMLElement));
    if (width === null) return;
    event.preventDefault(); dragWidth = width; onNavPaneResize?.(width);
  }
</script>
<!--
  The accessible name is a hidden element rather than `aria-label`, because
  Obsidian renders a hover tooltip for every element carrying `aria-label`.
-->
<nav class="fce-nav-pane" aria-labelledby={paneLabelId} style={nav.layoutMode === "single" ? "" : `width: ${paneWidth}px;`}>
  <span class="fce-sr-only" id={paneLabelId}>{labels.ariaLabel}</span>
  <div class="fce-nav-pane-header">
    {#if nav.layoutMode === "single"}
      <button type="button" class="clickable-icon fce-nav-header-button" aria-label={labels.backToCards}
        onclick={() => onToggleNavPane?.()} use:icon={"arrow-left"} use:tooltip={labels.backToCards}></button>
    {/if}
    <!-- The wrapper extends the input's pointer target; keyboard focus stays on the native controls. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="fce-nav-filter" onclick={onFilterClick}>
      <label class="fce-sr-only" for={`${paneLabelId}-filter`}>{labels.filterLabel}</label><span class="fce-nav-filter-icon" aria-hidden="true" use:icon={"search"}></span>
      <input class="fce-nav-filter-input" id={`${paneLabelId}-filter`} bind:this={filterEl} value={nav.query} type="search"
        aria-label={labels.filterLabel} placeholder={labels.filterPlaceholder} oninput={onFilterInput} onkeydown={onFilterKeydown}
        oncompositionstart={() => composing = true} oncompositionend={() => composing = false} />
      {#if nav.query.length > 0}
        <button type="button" class="clickable-icon fce-nav-filter-clear" aria-label={labels.clearFilter}
          onclick={() => clearFilter("input")} use:icon={"x"}></button>
      {/if}
    </div>
  </div>
  <div class="fce-nav-pane-sections" bind:this={scrollerEl} use:folderDragSurface>
    {#if nav.projection.allSectionsHidden}
      <div class="fce-tree-empty">{strings.navigationVisibility.allHidden}</div>
    {:else if nav.projection.noResults}
      <div class="fce-tree-empty fce-nav-no-results">{labels.noResults}</div>
    {:else}
      <div class="fce-nav-tree" role="tree" tabindex="-1" aria-labelledby={paneLabelId} bind:this={treeEl}
        use:navigationSubtreeHover={{ rows, onChange: (ids) => hoveredRowIds = ids }}
        onfocusin={() => treeHasFocus = true}
        onfocusout={() => queueMicrotask(() => treeHasFocus = Boolean(treeEl?.contains(document.activeElement)))}>
        {#each rows as row (row.id)}
          <NavigationTreeRow {row} tabIndex={row.id === focusId ? 0 : -1}
            revealed={highlightedRowId === row.id}
            subtreeHovered={hoveredRowIds.has(row.id)} {strings} {activeFilterTags}
            activePropertyFilterCount={nav.propertyFilterCount}
            showItemCounts={nav.showItemCounts} tooltipSide={nav.tooltipSide}
            dragState={folderRowDragState(row, folderDrag) ?? favoriteRowDragState(row, favoriteDrag) ?? navigationSortRowDragState(row, sortDrag)}
            rowRef={bindRow} onFocus={(id) => emitIntent({ type: "focus", rowId: id })}
            onActivate={activate} onToggleExpansion={toggleExpansion} onKeydown={keydown} onContextMenu={pointerMenu}
            onRowDragStart={onRowDragStart} onRowDragOver={onFavoriteDragOver}
            onRowDrop={onRowDrop} onRowDragEnd={onRowDragEnd}>
            {#snippet actions()}
              {#if row.kind === "section" && row.section === "folders"}
                <button type="button" tabindex="-1" class="clickable-icon fce-nav-section-create" aria-label={labels.createFolder}
                  onclick={(event) => actionClick(event, () => onFolderAction?.({ action: "create-child-folder", path: "/" }))}
                  use:icon={"folder-plus"}></button>
              {:else if row.kind === "section" && row.section === "tags" && activeFilterTags.length > 0}
                <button type="button" tabindex="-1" class="clickable-icon fce-nav-section-clear" aria-label={labels.clearActiveTags}
                  onclick={(event) => actionClick(event, () => onFilterChange?.({ tags: [] }))} use:icon={"filter-x"}></button>
              {:else if row.kind === "section" && row.section === "properties"}
                {@const clearing = browsePropertyFilterEnabled && nav.propertyFilterCount > 0}
                <button type="button" tabindex="-1" class="clickable-icon {clearing ? 'fce-nav-section-clear' : 'fce-nav-section-choose'}"
                  aria-label={clearing ? strings.property.clearFilters : strings.property.chooseVisible}
                  onclick={(event) => actionClick(event, () => onPropertyCommand?.({ command: clearing ? "clear-filters" : "choose-visible" }))}
                  use:icon={clearing ? "filter-x" : "settings-2"}></button>
              {:else if row.kind === "section" && row.section === "boxes"}
                <button type="button" tabindex="-1" class="clickable-icon fce-nav-section-create" aria-label={labels.createBox}
                  onclick={(event) => actionClick(event, () => onBoxCommand?.({ command: "create" }))} use:icon={"plus"}></button>
              {/if}
              <button type="button" tabindex="-1" class="clickable-icon fce-nav-row-more" aria-label={labels.moreActions(row.label)}
                onclick={(event) => actionClick(event, () => openPositionMenu(row, event.currentTarget as HTMLElement))}
                use:icon={"more-horizontal"}></button>
            {/snippet}
          </NavigationTreeRow>
          {#if row.kind === "section" && row.expanded
            && (row.section === "tags" || nav.projection.sections.find((section) => section.section === row.section)?.emptyLabel)
            && !rows.some((candidate) => candidate.kind !== "section" && candidate.section === row.section)}
            <div class="fce-tree-empty fce-nav-section-empty" data-nav-empty-section={row.section} role="none">
              {row.section === "properties" && !browsePropertyFilterEnabled
                ? labels.propertiesFilterUnavailable
                : row.section === "tags"
                  ? (browseTagFilterEnabled ? strings.toolbar.filter.noTagsFound : labels.tagsFilterUnavailable)
                  : nav.projection.sections.find((section) => section.section === row.section)?.emptyLabel}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="fce-nav-resize-handle" role="separator" tabindex="0" aria-orientation="vertical"
    aria-label={labels.resizeHandle} aria-valuemin={NAV_PANE_WIDTH_MIN} aria-valuenow={paneWidth}
    aria-valuemax={NAV_PANE_WIDTH_MAX} aria-valuetext={labels.resizeValue(paneWidth)} aria-describedby={resizeHelpId}
    onpointerdown={beginResize} onkeydown={resizeKeydown}>
    <span class="fce-sr-only" id={resizeHelpId}>{labels.resizeKeyboardHelp}</span>
  </div>
</nav>
