<script lang="ts">
  import { setIcon, setTooltip } from "obsidian";
  import { tick } from "svelte";
  import { getUiStrings, type UiStrings } from "../i18n";
  import { NAV_PANE_WIDTH_MAX, NAV_PANE_WIDTH_MIN } from "../settings";
  import type { PanelNavState, PanelScopeState } from "./panel-model";
  import type { NavigationIntent, NavigationRow } from "./navigation-model";
  import { navigationSubtreeHover } from "./navigation-hover";
  import { resolveNavigationFocus, resolveNavigationKey, resolveSeparatorWidth } from "./navigation-keyboard";
  import NavigationTreeRow from "./NavigationTreeRow.svelte";
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
    sectionCollapsed: { favorites: false, folders: false, tags: false, properties: false, boxes: false }, showItemCounts: false,
    tooltipSide: "right", propertyFilterCount: 0, projection: { normalizedQuery: "", querying: false, sections: [], rows: [], noResults: false },
    query: "", focusId: null, focusRequest: null, revealRequest: null,
  };
  const EMPTY_SCOPE: PanelScopeState = {
    displayPath: "", includeSubfolders: true, activeBoxId: null, activeBoxName: null,
    boxExcludedCount: 0, emptyStateMessage: "",
  };
  let {
    strings = getUiStrings("en"), nav = EMPTY_NAV, scope = EMPTY_SCOPE, activeFilterTags = [],
    onFolderAction, onFilterChange, onPropertyCommand, onBoxCommand,
    onNavContextMenu, onNavigationIntent, onNavPaneResize, onToggleNavPane,
  }: Props = $props();
  const labels = $derived(strings.toolbar.navPane);
  const rows = $derived(nav.projection.rows);
  const isBoxScope = $derived(scope.activeBoxId !== null);
  let dragWidth = $state<number | null>(null);
  let composing = $state(false);
  let treeHasFocus = $state(false);
  let treeEl: HTMLElement | null = $state(null);
  let scrollerEl: HTMLElement | null = $state(null);
  let filterEl: HTMLInputElement | null = $state(null);
  let hoveredRowIds = $state<ReadonlySet<string>>(new Set());
  let previousRowIds: string[] = [];
  let rowElements = new Map<string, HTMLElement>();
  let consumedRevealToken = 0;
  let consumedFocusReturnToken = 0;
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
    if (treeHasFocus && nextFocus) void tick().then(() => rowElements.get(nextFocus)?.focus());
  });
  $effect(() => {
    const request = nav.revealRequest;
    if (request && request.token > consumedRevealToken && nav.visible) {
      void consumeRevealAfterRender(request.token, request.rowId);
    }
  });
  $effect(() => { const request = nav.focusRequest; if (request && request.token > consumedFocusReturnToken && nav.visible)
    void consumeFocusReturnAfterRender(request.token, request.rowId); });
  $effect(() => () => { disposed = true; rowElements.clear(); });
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
    if (row.disabled) return;
    focusRow(row.id);
    const additive = (row.kind === "tag" || row.kind === "property-value" || (row.kind === "favorite" && row.favorite.kind === "tag"))
      && (event.ctrlKey || event.metaKey);
    emitIntent({ type: "activate", rowId: row.id, mode: additive ? "additive" : "ordinary" });
  }
  function toggleExpansion(event: MouseEvent, row: NavigationRow): void {
    event.preventDefault(); event.stopPropagation();
    if (row.expanded && focusedRowIsDescendantOf(row.id)) {
      emitIntent({ type: "focus", rowId: row.id });
      (event.currentTarget as HTMLElement).closest<HTMLElement>("[role=treeitem]")?.focus();
    }
    emitIntent({ type: "set-expanded", rowId: row.id, expanded: !row.expanded });
  }
  function focusedRowIsDescendantOf(ancestorId: string): boolean {
    const activeId = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-nav-row-id]")?.dataset.navRowId;
    let current = rows.find((candidate) => candidate.id === activeId);
    while (current?.parentId) {
      if (current.parentId === ancestorId) return true;
      current = rows.find((candidate) => candidate.id === current?.parentId);
    }
    return false;
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
    event.preventDefault(); event.stopPropagation(); action();
  }
  async function consumeRevealAfterRender(token: number, rowId: string): Promise<void> {
    await tick();
    if (disposed || token <= consumedRevealToken || nav.revealRequest?.token !== token || !nav.visible) return;
    const target = rowElements.get(rowId);
    if (!target || !scrollerEl) return;
    const targetRect = target.getBoundingClientRect();
    const scrollerRect = scrollerEl.getBoundingClientRect();
    const visible = targetRect.top >= scrollerRect.top && targetRect.bottom <= scrollerRect.bottom
      && targetRect.left >= scrollerRect.left && targetRect.right <= scrollerRect.right;
    if (!visible) target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    consumedRevealToken = token;
    emitIntent({ type: "reveal-consumed", token });
  }
  async function consumeFocusReturnAfterRender(token: number, rowId: string): Promise<void> {
    await tick(); if (disposed || token <= consumedFocusReturnToken || nav.focusRequest?.token !== token || !nav.visible) return;
    const target = rowElements.get(rowId); if (!target) return;
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
    <div class="fce-nav-filter">
      <label class="fce-sr-only" for={`${paneLabelId}-filter`}>{labels.filterLabel}</label><span class="fce-nav-filter-icon" aria-hidden="true" use:icon={"search"}></span>
      <input id={`${paneLabelId}-filter`} bind:this={filterEl} value={nav.query} type="search"
        aria-label={labels.filterLabel} placeholder={labels.filterPlaceholder} oninput={onFilterInput} onkeydown={onFilterKeydown}
        oncompositionstart={() => composing = true} oncompositionend={() => composing = false} />
      {#if nav.query.length > 0}
        <button type="button" class="clickable-icon fce-nav-filter-clear" aria-label={labels.clearFilter}
          onclick={() => clearFilter("input")} use:icon={"x"}></button>
      {/if}
    </div>
  </div>
  <div class="fce-nav-pane-sections" bind:this={scrollerEl}>
    {#if nav.projection.noResults}
      <div class="fce-tree-empty fce-nav-no-results">{labels.noResults}</div>
    {:else}
      <div class="fce-nav-tree" role="tree" tabindex="-1" aria-labelledby={paneLabelId} bind:this={treeEl}
        use:navigationSubtreeHover={{ rows, onChange: (ids) => hoveredRowIds = ids }}
        onfocusin={() => treeHasFocus = true}
        onfocusout={() => queueMicrotask(() => treeHasFocus = Boolean(treeEl?.contains(document.activeElement)))}>
        {#each rows as row (row.id)}
          <NavigationTreeRow {row} tabIndex={row.id === focusId ? 0 : -1}
            subtreeHovered={hoveredRowIds.has(row.id)} {strings} {activeFilterTags}
            activePropertyFilterCount={nav.propertyFilterCount}
            showItemCounts={nav.showItemCounts} tooltipSide={nav.tooltipSide}
            rowRef={bindRow} onFocus={(id) => emitIntent({ type: "focus", rowId: id })}
            onActivate={activate} onToggleExpansion={toggleExpansion} onKeydown={keydown} onContextMenu={pointerMenu}>
            {#snippet actions()}
              {#if row.kind === "section" && row.section === "folders"}
                <button type="button" tabindex="-1" class="clickable-icon fce-nav-section-create" aria-label={labels.createFolder}
                  onclick={(event) => actionClick(event, () => onFolderAction?.({ action: "create-child-folder", path: "/" }))}
                  use:icon={"folder-plus"}></button>
              {:else if row.kind === "section" && row.section === "tags" && activeFilterTags.length > 0}
                <button type="button" tabindex="-1" class="clickable-icon fce-nav-section-clear" aria-label={labels.clearActiveTags}
                  onclick={(event) => actionClick(event, () => onFilterChange?.({ tags: [] }))} use:icon={"filter-x"}></button>
              {:else if row.kind === "section" && row.section === "properties"}
                {@const clearing = nav.propertyFilterCount > 0}
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
              {row.section === "tags"
                ? (isBoxScope ? labels.tagsDisabledInBox : strings.toolbar.filter.noTagsFound)
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
