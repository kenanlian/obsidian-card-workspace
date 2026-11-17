<script lang="ts">
  import { untrack } from "svelte";
  import FolderCardPanel from "./FolderCardPanel.svelte";
  import NavigationPane from "./NavigationPane.svelte";
  import type { PanelModelState } from "./panel-model";
  import type { StreamCommand, StreamPanelEntry, StreamPanelModel, StreamPanelState } from "./stream-panel-model";
  interface Props {
    model: StreamPanelModel;
    onSelect?: (id: string) => void;
    onCommand?: (id: string, command: StreamCommand, anchor?: HTMLElement) => void;
    onCreate?: () => void;
    onReopen?: () => void;
    onResize?: (width: number, height: number) => void;
    onStreamWidth?: (id: string, width: number) => void;
    onMove?: (id: string, index: number) => void;
    onToggleNav?: () => void;
  }
  let { model, onSelect, onCommand, onCreate, onReopen, onResize, onStreamWidth, onMove, onToggleNav }: Props = $props();
  let workspace = $state.raw<StreamPanelState>(untrack(() => model.getState()));
  let navState = $state.raw<PanelModelState | null>(null);
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
    navState = untrack(() => navModel?.getState() ?? null);
    return untrack(() => navModel?.subscribe(next => { navState = next; }));
  });
  function measureRoot(node: HTMLDivElement) {
    const report = () => untrack(() => (workspace.navProps.onShellResize as ((width: number) => void) | undefined)?.(node.clientWidth));
    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }
  function measureStage(node: HTMLDivElement) {
    const report = () => untrack(() => { if (node.clientWidth > 0 && node.clientHeight > 0) onResize?.(node.clientWidth, node.clientHeight); });
    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }
  $effect(() => {
    // Source navigation changes the actual space available to streams.
    void showStage; void showSources;
    const node = stageEl;
    if (node && showStage) untrack(() => { if (node.clientWidth > 0 && node.clientHeight > 0) onResize?.(node.clientWidth, node.clientHeight); });
  });

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
      if (rect.left < bounds.left) stage.scrollLeft -= bounds.left - rect.left;
      else if (rect.right > bounds.right) stage.scrollLeft += Math.min(rect.right - bounds.right, rect.left - bounds.left);
    });
  });

  let resizing: { pointerId: number; id: string; startX: number; startWidth: number } | null = null;
  function startResize(event: PointerEvent, entry: StreamPanelEntry) {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    resizing = { pointerId: event.pointerId, id: entry.id, startX: event.clientX, startWidth: entry.width };
  }
  function moveResize(event: PointerEvent) {
    if (!resizing || resizing.pointerId !== event.pointerId) return;
    onStreamWidth?.(resizing.id, resizing.startWidth + event.clientX - resizing.startX);
  }
  function resizeKey(event: KeyboardEvent, entry: StreamPanelEntry) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    onStreamWidth?.(entry.id, entry.width + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 48 : 16));
  }

  // Dragging a stream title reorders streams; a press without movement keeps its click.
  let reorder: { pointerId: number; id: string; startX: number; active: boolean; doc: Document } | null = null;
  let draggingId = $state<string | null>(null);
  let dropIndex = $state<number | null>(null);
  let suppressClick = false;
  const dropTargets = $derived.by(() => {
    if (draggingId === null || dropIndex === null) return { before: null, after: null };
    const others = items.filter(entry => entry.id !== draggingId);
    return dropIndex < others.length ? { before: others[dropIndex].id, after: null } : { before: null, after: others.at(-1)?.id ?? null };
  });
  function startReorder(event: PointerEvent, id: string) {
    if (event.button !== 0 || reorder || !(event.target instanceof Element) || !event.target.closest(".fce-stream-switcher, .fce-stream-spine")) return;
    const doc = stageEl?.ownerDocument;
    if (!doc) return;
    reorder = { pointerId: event.pointerId, id, startX: event.clientX, active: false, doc };
    doc.addEventListener("pointermove", moveReorder);
    doc.addEventListener("pointerup", endReorder);
    doc.addEventListener("pointercancel", stopReorder);
  }
  function moveReorder(event: PointerEvent) {
    const session = reorder;
    if (!session || event.pointerId !== session.pointerId) return;
    if (!session.active && Math.abs(event.clientX - session.startX) < 6) return;
    session.active = true; draggingId = session.id;
    dropIndex = itemElements().filter(element => element.dataset.streamItem !== session.id).filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.left + rect.width / 2 < event.clientX;
    }).length;
  }
  function endReorder(event: PointerEvent) {
    const session = reorder;
    if (!session || event.pointerId !== session.pointerId) return;
    const index = dropIndex;
    stopReorder();
    if (!session.active) return;
    suppressClick = true;
    session.doc.defaultView?.setTimeout(() => { suppressClick = false; }, 0);
    if (index !== null) onMove?.(session.id, index);
  }
  function stopReorder() {
    const doc = reorder?.doc;
    doc?.removeEventListener("pointermove", moveReorder);
    doc?.removeEventListener("pointerup", endReorder);
    doc?.removeEventListener("pointercancel", stopReorder);
    reorder = null; draggingId = null; dropIndex = null;
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
    <div class="fce-stream-navigation fce-shell" data-fce-font-size={navState.appearance.uiFontSize ?? "default"} data-fce-density={navState.appearance.uiDensity ?? "default"}>
      <NavigationPane {...workspace.navProps} strings={navState.strings} nav={{ ...navState.nav, visible: true }} scope={navState.scope} viewMode={navState.projection.viewMode} activeFilterTags={navState.projection.activeFilterTags} />
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
    {#each items as entry (entry.id)}
      {#if entry.display === "spine"}
        <button type="button" class="fce-stream-spine" class:is-drop-before={dropTargets.before === entry.id} class:is-drop-after={dropTargets.after === entry.id} class:is-dragging={draggingId === entry.id}
          data-stream-item={entry.id} style={`flex: 0 0 ${entry.width}px`} aria-label={`${labels.expand}: ${entry.title}`} title={entry.title}
          onclick={() => onSelect?.(entry.id)} onpointerdown={event => startReorder(event, entry.id)}
          oncontextmenu={event => { event.preventDefault(); onCommand?.(entry.id, "menu", event.currentTarget); }}>
          <span class="fce-stream-spine-title">{entry.title}</span>
        </button>
      {:else}
        <section class="fce-stream-panel" class:is-current={entry.current} class:is-drop-before={dropTargets.before === entry.id} class:is-drop-after={dropTargets.after === entry.id} class:is-dragging={draggingId === entry.id}
          data-stream-id={entry.id} data-stream-item={entry.id} aria-label={entry.title} aria-current={multiple && entry.current ? "true" : undefined} style={`flex: 0 0 ${entry.width}px`}
          onpointerdown={event => { selectLocally(entry); startReorder(event, entry.id); }} onfocusin={() => selectLocally(entry)}>
          {#if !entry.panelModel}
            <div class="fce-stream-fallback-bar">
              <button type="button" class="fce-stream-switcher" aria-haspopup="menu" onclick={event => onCommand?.(entry.id, "menu", event.currentTarget)}>{entry.title}</button>
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
        {#if entry.separator}
          <!-- Focusable ARIA window splitter follows the host navigation resize pattern. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div class="fce-stream-splitter" role="separator" tabindex="0" aria-label={`${labels.resize}: ${entry.title}`} aria-describedby={helpId} aria-orientation="vertical" aria-valuenow={Math.round(entry.width)}
            onkeydown={event => resizeKey(event, entry)} onpointerdown={event => startResize(event, entry)} onpointermove={moveResize}
            onpointerup={() => { resizing = null; }} onpointercancel={() => { resizing = null; }}></div>
        {/if}
      {/if}
    {/each}
  </div>
  <span class="fce-sr-only" id={helpId}>{labels.resizeHelp}</span>
</div>
