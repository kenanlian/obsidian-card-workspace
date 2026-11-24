<script lang="ts">
  import { untrack } from "svelte";
  import FolderCardPanel from "./FolderCardPanel.svelte";
  import NavigationPane from "./NavigationPane.svelte";
  import type { PanelModelState } from "./panel-model";
  import type { StreamCommand, StreamPanelEntry, StreamPanelModel, StreamPanelState } from "./stream-panel-model";
  import { tileGeometry, moveTile, dropPlacement, type Placement, type Rect, type Divider, type Tile } from "./stream-tiles";
  interface Props {
    model: StreamPanelModel;
    onSelect?: (id: string) => void;
    onCommand?: (id: string, command: StreamCommand, anchor?: HTMLElement) => void;
    onCreate?: () => void;
    onReopen?: () => void;
    onResize?: (width: number, height: number) => void;
    onSplitResize?: (id: string, ratio: number) => void;
    onPlace?: (id: string, placement: Placement) => void;
    onToggleNav?: () => void;
  }
  let { model, onSelect, onCommand, onCreate, onReopen, onResize, onSplitResize, onPlace, onToggleNav }: Props = $props();
  let workspace = $state.raw<StreamPanelState>(untrack(() => model.getState()));
  type NavigationState = Pick<PanelModelState, "nav" | "strings" | "scope">
    & Pick<PanelModelState["projection"], "viewMode" | "activeFilterTags">
    & Pick<PanelModelState["appearance"], "uiFontSize" | "uiDensity">;
  let navState = $state.raw<NavigationState | null>(null);
  const labels = $derived(workspace.labels);
  const navigationModel = $derived(workspace.navPanelModel);
  const items = $derived(workspace.entries.filter(entry => entry.display !== "hidden"));
  const firstStreamId = $derived(items.find(entry => entry.display === "stream")?.id ?? null);
  const multiple = $derived(items.length > 1);
  const single = $derived(workspace.singlePane || navState?.nav.layoutMode === "single");
  const showSources = $derived(workspace.navigationVisible && navState !== null && (!single || navState.nav.visible));
  const showStage = $derived(!single || !showSources);
  const instanceId = $props.id();
  const helpId = `${instanceId}-resize-help`;
  let stageEl: HTMLDivElement | undefined = $state();
  $effect(() => {
    const currentModel = model;
    return untrack(() => currentModel.subscribe(next => { workspace = next; }));
  });
  $effect(() => {
    const navModel = navigationModel;
    if (!navModel) { navState = null; return; }
    return untrack(() => navModel.subscribe(({ nav, strings, scope, projection, appearance }) => {
      const { viewMode, activeFilterTags } = projection;
      const { uiFontSize, uiDensity } = appearance;
      if (navState?.nav === nav && navState.strings === strings && navState.scope === scope
        && navState.viewMode === viewMode && navState.activeFilterTags === activeFilterTags
        && navState.uiFontSize === uiFontSize && navState.uiDensity === uiDensity) return;
      navState = { nav, strings, scope, viewMode, activeFilterTags, uiFontSize, uiDensity };
    }));
  });
  function measureRoot(node: HTMLDivElement) {
    const report = () => untrack(() => (workspace.navProps.onShellResize as ((width: number) => void) | undefined)?.(node.clientWidth));
    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }
  let stageWidth = $state(0), stageHeight = $state(0);
  const root = $derived<Tile | null>(workspace.maximizedStreamId ? {kind: "stream", id: workspace.maximizedStreamId} : workspace.layout);
  const collapsed = $derived(new Set(items.filter(item => item.display === "spine").map(item => item.id)));
  const geometry = $derived(tileGeometry(root, collapsed, stageWidth, stageHeight));
  const byStream = $derived(new Map(geometry.regions.map(r => [r.stream, r])));
  function bounds(rect: Rect | undefined): string {
    return rect ? `left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px` : "";
  }
  function measureStage(node: HTMLDivElement) {
    // clientWidth/clientHeight round fractional pixels up, which can toggle both scrollbars each frame.
    const observer = new ResizeObserver(([entry]) => untrack(() => {
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0 || (width === stageWidth && height === stageHeight)) return;
      stageWidth = width;
      stageHeight = height;
      onResize?.(width, height);
    }));
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  function itemElements(): HTMLElement[] {
    return Array.from(stageEl?.querySelectorAll<HTMLElement>("[data-stream-item]") ?? []);
  }

  // Streams chosen by pointer or focus are already in view; programmatic targets are revealed.
  let locallySelectedId: string | null = null;
  let revealedId: string | null = null;
  function selectLocally(entry: StreamPanelEntry): void {
    if (entry.current) return;
    locallySelectedId = entry.id;
    onSelect?.(entry.id);
  }
  $effect(() => {
    const id = workspace.currentStreamId;
    untrack(() => {
      if (id === revealedId) return;
      revealedId = id;
      const local = locallySelectedId === id;
      locallySelectedId = null;
      const stage = stageEl;
      const node = id && !local ? itemElements().find(element => element.dataset.streamItem === id) : undefined;
      if (!stage || !node) return;
      const bounds = stage.getBoundingClientRect(), rect = node.getBoundingClientRect();
      if (rect.top < bounds.top) stage.scrollTop -= bounds.top - rect.top;
      else if (rect.bottom > bounds.bottom) stage.scrollTop += Math.min(rect.bottom - bounds.bottom, rect.top - bounds.top);
      if (rect.left < bounds.left) stage.scrollLeft -= bounds.left - rect.left;
      else if (rect.right > bounds.right) stage.scrollLeft += Math.min(rect.right - bounds.right, rect.left - bounds.left);
    });
  });

  let resizing: { pointerId: number; start: number; split: Divider } | null = null;
  function resize(split: Divider, delta: number) {
    const position = Math.max(split.min, Math.min(split.max, split.position + delta));
    onSplitResize?.(split.id, position / split.span);
  }
  function startResize(event: PointerEvent, split: Divider) {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    resizing = { pointerId: event.pointerId, start: split.axis === "x" ? event.clientX : event.clientY, split };
  }
  function moveResize(event: PointerEvent) {
    if (!resizing || resizing.pointerId !== event.pointerId) return;
    const { split, start } = resizing;
    resize(split, (split.axis === "x" ? event.clientX : event.clientY) - start);
  }
  function resizeKey(event: KeyboardEvent, split: Divider) {
    const keys = split.axis === "x" ? ["ArrowLeft","ArrowRight"] : ["ArrowUp","ArrowDown"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    resize(split, (event.key === keys[1] ? 1 : -1) * (event.shiftKey ? 48 : 16));
  }

  let reorder: { pointerId: number; id: string; startX: number; startY: number; active: boolean; cancelled: boolean; doc: Document } | null = null;
  let draggingId = $state<string | null>(null);
  let drop = $state.raw<Placement | null>(null);
  let suppressClick = false;
  const preview = $derived.by(() => {
    if (!root || !drop || !draggingId) return null;
    const tree = moveTile(root, draggingId, drop);
    return tileGeometry(tree, collapsed, stageWidth, stageHeight).regions.find(r => r.stream === draggingId);
  });
  const targetRegion = $derived(drop && geometry.regions.find(region => region.key === drop?.target));
  function cancelKey(event: KeyboardEvent) {
    if (event.key !== "Escape" || !reorder?.active) return;
    reorder.cancelled = true;
    draggingId = null;
    drop = null;
  }
  function startReorder(event: PointerEvent, id: string) {
    if (!multiple || workspace.maximizedStreamId || event.button !== 0 || reorder || !(event.target instanceof (stageEl?.ownerDocument.defaultView?.Element ?? Element)) || !event.target.closest(".fce-stream-grip, .fce-stream-switcher, .fce-stream-spine")) return;
    const doc = stageEl?.ownerDocument;
    if (!doc) return;
    reorder = { pointerId: event.pointerId, id, startX: event.clientX, startY: event.clientY, active: false, cancelled: false, doc };
    doc.addEventListener("keydown", cancelKey);
    doc.addEventListener("pointermove", moveReorder);
    doc.addEventListener("pointerup", endReorder);
    doc.addEventListener("pointercancel", stopReorder);
  }
  function moveReorder(event: PointerEvent) {
    const session = reorder;
    if (!session || session.cancelled || event.pointerId !== session.pointerId) return;
    if (!session.active && Math.hypot(event.clientX-session.startX, event.clientY-session.startY) < 6) return;
    session.active = true; draggingId = session.id;
    const stage = stageEl;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    drop = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom ? null :
      dropPlacement(geometry.regions, session.id, event.clientX - rect.left + stage.scrollLeft, event.clientY - rect.top + stage.scrollTop);
  }
  function endReorder(event: PointerEvent) {
    const session = reorder;
    if (!session || event.pointerId !== session.pointerId) return;
    if (session.active) moveReorder(event);
    const placement = drop;
    stopReorder();
    if (!session.active) return;
    suppressClick = true;
    session.doc.defaultView?.setTimeout(() => { suppressClick = false; }, 0);
    if (placement) onPlace?.(session.id, placement);
  }
  function stopReorder() {
    const doc = reorder?.doc;
    doc?.removeEventListener("keydown", cancelKey);
    doc?.removeEventListener("pointermove", moveReorder);
    doc?.removeEventListener("pointerup", endReorder);
    doc?.removeEventListener("pointercancel", stopReorder);
    reorder = null; draggingId = null; drop = null;
  }
  function swallowDragClick(event: MouseEvent) {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault(); event.stopPropagation();
  }
  $effect(() => () => untrack(stopReorder));
</script>

<div class="fce-stream-workspace" class:is-single={single} class:is-source-visible={showSources} use:measureRoot>
  {#if showSources && navState}
    <div class="fce-stream-navigation fce-shell" data-fce-font-size={navState.uiFontSize ?? "default"} data-fce-density={navState.uiDensity ?? "default"}>
      <NavigationPane {...workspace.navProps} strings={navState.strings} nav={{ ...navState.nav, visible: true }} scope={navState.scope} viewMode={navState.viewMode} activeFilterTags={navState.activeFilterTags} />
    </div>
  {/if}
  <div class="fce-stream-stage" class:is-hidden={!showStage} class:has-multiple={multiple} class:is-reordering={draggingId !== null} bind:this={stageEl} use:measureStage onclickcapture={swallowDragClick}>
    {#if workspace.unsupported}
      <div class="fce-stream-empty" role="status"><p>{labels.unsupported}</p><button type="button" onclick={onCreate}>{labels.recovery}</button></div>
    {:else if items.length === 0}
      <div class="fce-stream-empty">
        <p>{labels.empty}</p>
        <button type="button" onclick={onCreate}>{labels.create}</button>
        {#if workspace.recentlyClosedCount > 0}<button type="button" onclick={onReopen}>{labels.reopen}</button>{/if}
        {#if !showSources}<button type="button" onclick={onToggleNav}>{labels.toggleNavigation}</button>{/if}
      </div>
    {/if}
    {#each items as entry, index (entry.id)}
      {@const titleId = `${instanceId}-stream-title-${index}`}
      {#if entry.display === "spine"}
        <button type="button" class="fce-stream-spine" class:is-horizontal={byStream.get(entry.id)?.axis === "y"}  class:is-dragging={draggingId === entry.id}
          data-stream-item={entry.id} style={bounds(byStream.get(entry.id))}
          onclick={() => onSelect?.(entry.id)} onpointerdown={event => startReorder(event, entry.id)}
          oncontextmenu={event => { event.preventDefault(); onCommand?.(entry.id, "menu", event.currentTarget); }}>
          <span class="fce-sr-only">{labels.expand}: </span>
          <span class="fce-stream-spine-title">{entry.title}</span>
        </button>
      {:else}
        <section class="fce-stream-panel" class:is-current={entry.current}  class:is-dragging={draggingId === entry.id}
          data-stream-id={entry.id} data-stream-item={entry.id} aria-labelledby={titleId} aria-current={multiple && entry.current ? "true" : undefined} style={bounds(byStream.get(entry.id))}
          onpointerdown={event => { selectLocally(entry); startReorder(event, entry.id); }} onfocusin={() => selectLocally(entry)}>
          <span id={titleId} hidden>{entry.title}</span>
          {#if multiple}
            <div class="fce-stream-grip" aria-hidden="true" title={labels.dragStream}></div>
          {/if}
          {#if !entry.panelModel}
            <div class="fce-stream-fallback-bar">
              <button type="button" class="fce-stream-switcher" aria-haspopup="menu" title={entry.title} onclick={event => onCommand?.(entry.id, "menu", event.currentTarget)}>{entry.title}</button>
              <button type="button" class="clickable-icon" aria-label={labels.close} title={labels.close} onclick={() => onCommand?.(entry.id, "close")}>×</button>
            </div>
          {/if}
          {#if entry.error}<div class="fce-stream-error" role="alert">{entry.error}</div>{/if}
          <div class="fce-stream-panel-content" inert={entry.pending} aria-busy={entry.pending}>
            {#if entry.panelModel}
              <FolderCardPanel {...entry.props} panelModel={entry.panelModel} showNavigation={false} onShellResize={undefined}
                stream={{ title: entry.customTitle, ordinal: entry.ordinal, closable: workspace.entries.length > 1, showNavToggle: single || entry.id === firstStreamId, switcherLabel: labels.switcher, closeLabel: labels.close }}
                onStreamMenu={(anchor: HTMLElement) => onCommand?.(entry.id, "menu", anchor)} onStreamClose={() => onCommand?.(entry.id, "close")} />
            {:else if entry.pending}<div class="fce-stream-empty" role="status">{labels.pending}</div>{/if}
          </div>
        </section>
      {/if}
    {/each}
    {#each geometry.dividers as split (split.id)}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div class="fce-stream-splitter" style={bounds(split)} role="separator" tabindex="0" aria-label={labels.resize} aria-describedby={helpId}
        aria-orientation={split.axis === "x" ? "vertical" : "horizontal"} aria-valuemin={split.min} aria-valuemax={split.max} aria-valuenow={split.position}
        onkeydown={e => resizeKey(e, split)} onpointerdown={e => startResize(e, split)} onpointermove={moveResize}
        onpointerup={() => { resizing = null; }} onpointercancel={() => { resizing = null; }}></div>
    {/each}
    {#if targetRegion}<div class="fce-stream-drop-target" style={bounds(targetRegion)}></div>{/if}
    {#if preview}<div class="fce-stream-drop-preview" style={bounds(preview)}></div>{/if}
  </div>
  <span class="fce-sr-only" id={helpId}>{labels.resizeHelp}</span>
</div>
