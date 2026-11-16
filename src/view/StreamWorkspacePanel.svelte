<script lang="ts">
  import { untrack } from "svelte";
  import FolderCardPanel from "./FolderCardPanel.svelte";
  import NavigationPane from "./NavigationPane.svelte";
  import type { PanelModelState } from "./panel-model";
  import type { StreamCommand, StreamPanelModel, StreamPanelState } from "./stream-panel-model";
  interface Props {
    model: StreamPanelModel;
    onSelect?: (id: string) => void;
    onCommand?: (id: string, command: StreamCommand, anchor?: HTMLElement) => void;
    onCreate?: () => void;
    onReopen?: () => void;
    onDirection?: (direction: "horizontal" | "vertical") => void;
    onResize?: (width: number, height: number) => void;
    onResizePair?: (firstId: string, secondId: string, deltaPx: number) => void;
    onReorder?: (id: string, delta: -1 | 1) => void;
    onToggleNav?: () => void;
  }
  let { model, onSelect, onCommand, onCreate, onReopen, onDirection, onResize, onResizePair, onReorder, onToggleNav }: Props = $props();
  let workspace = $state.raw<StreamPanelState>(untrack(() => model.getState()));
  let navState = $state.raw<PanelModelState | null>(null);
  let compactListOpen = $state(false);
  const labels = $derived(workspace.labels);
  const direction = $derived(workspace.direction);
  const navigationModel = $derived(workspace.navPanelModel);
  const expanded = $derived(workspace.entries.filter(entry => entry.expanded));
  const single = $derived(workspace.singlePane || navState?.nav.layoutMode === "single");
  const showSources = $derived(workspace.navigationVisible && navState !== null && (!single || navState.nav.visible));
  const showStage = $derived(!single || !showSources);
  const showList = $derived(!single || showSources || compactListOpen);
  const instanceId = $props.id();
  const helpId = `${instanceId}-resize-help`;
  let listEl: HTMLElement | undefined = $state();
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
    // Source navigation and compact list change the actual space available to streams.
    void showStage; void showSources; void showList; void direction;
    const node = stageEl;
    if (node && showStage) untrack(() => { if (node.clientWidth > 0 && node.clientHeight > 0) onResize?.(node.clientWidth, node.clientHeight); });
  });
  function listKey(event: KeyboardEvent, id: string) {
    if (event.target !== event.currentTarget) return;
    const buttons = Array.from(listEl?.querySelectorAll<HTMLButtonElement>(".fce-stream-select") ?? []);
    const index = buttons.indexOf(event.currentTarget as HTMLButtonElement);
    let next = index;
    if (event.key === "ArrowDown") next = Math.min(buttons.length - 1, index + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault(); onCommand?.(id, "manage", event.currentTarget as HTMLElement); return;
    } else return;
    event.preventDefault(); buttons[next]?.focus();
  }
  let dragging: { pointerId: number; first: string; second: string; position: number } | null = null;
  function startResize(event: PointerEvent, first: string, second: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragging = { pointerId: event.pointerId, first, second, position: workspace.direction === "horizontal" ? event.clientX : event.clientY };
  }
  function moveResize(event: PointerEvent) {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    const position = workspace.direction === "horizontal" ? event.clientX : event.clientY;
    onResizePair?.(dragging.first, dragging.second, position - dragging.position);
    dragging.position = position;
  }
  function resizeKey(event: KeyboardEvent, first: string, second: string) {
    const positive = workspace.direction === "horizontal" ? "ArrowRight" : "ArrowDown";
    const negative = workspace.direction === "horizontal" ? "ArrowLeft" : "ArrowUp";
    if (event.key !== positive && event.key !== negative) return;
    event.preventDefault(); onResizePair?.(first, second, (event.key === positive ? 1 : -1) * (event.shiftKey ? 48 : 16));
  }
</script>

<div class="fce-stream-workspace" class:is-single={single} class:is-source-visible={showSources} use:measureRoot>
  <div class="fce-stream-workspace-bar">
    <button type="button" class="fce-stream-list-toggle" aria-expanded={showList} onclick={() => { compactListOpen = !compactListOpen; }}>{labels.streams}</button>
    {#if workspace.currentStreamId === null}<span class="fce-stream-status" role="status">{labels.noCurrent}</span>{/if}
    <button type="button" title={labels.create} aria-label={labels.create} onclick={onCreate} disabled={workspace.unsupported}>＋</button>
    <button type="button" title={labels.reopen} aria-label={labels.reopen} onclick={onReopen} disabled={workspace.recentlyClosedCount === 0 || workspace.unsupported}>↶</button>
    <button type="button" aria-label={labels.horizontal} aria-pressed={workspace.direction === "horizontal"} onclick={() => onDirection?.("horizontal")} disabled={workspace.unsupported}>↔</button>
    <button type="button" aria-label={labels.vertical} aria-pressed={workspace.direction === "vertical"} onclick={() => onDirection?.("vertical")} disabled={workspace.unsupported}>↕</button>
    <button type="button" aria-label={labels.toggleNavigation} aria-pressed={showSources} onclick={onToggleNav}>☰</button>
  </div>
  <div class="fce-stream-workspace-body">
    {#if showList || showSources}
      <aside class="fce-stream-navigation fce-shell" data-fce-font-size={navState?.appearance.uiFontSize ?? "default"} data-fce-density={navState?.appearance.uiDensity ?? "default"} style={`--fce-stream-nav-width: ${navState?.nav.paneWidth ?? 240}px`} aria-label={labels.streams}>
        {#if showList}
          <div class="fce-stream-list" bind:this={listEl}>
            {#each workspace.entries as entry, index (entry.id)}
              <div class="fce-stream-list-entry" class:is-current={entry.current} data-stream-list-id={entry.id}>
                <button type="button" class="fce-stream-select" aria-current={entry.current ? "true" : undefined} onclick={() => onSelect?.(entry.id)} onkeydown={event => listKey(event, entry.id)} oncontextmenu={event => { event.preventDefault(); onCommand?.(entry.id, "manage", event.currentTarget); }}>
                  <span class="fce-stream-title">{entry.title}</span>
                  <span class="fce-stream-source">{entry.sourceLabel}</span>
                  {#if entry.current}<span class="fce-stream-status">{labels.current}</span>{/if}
                  {#if entry.autoCollapsed}<span class="fce-stream-status">{labels.autoCollapsed}</span>{:else if !entry.expanded}<span class="fce-stream-status">{labels.collapsed}</span>{/if}
                </button>
                <div class="fce-stream-entry-actions">
                  <button type="button" aria-label={labels.showOnly} title={labels.showOnly} onclick={() => onCommand?.(entry.id, "show-only")}>▣</button>
                  <button type="button" aria-label={labels.tile} title={labels.tile} onclick={() => onCommand?.(entry.id, "tile")}>▥</button>
                  <button type="button" aria-label={labels.collapse} title={labels.collapse} disabled={!entry.expanded} onclick={() => onCommand?.(entry.id, "collapse")}>−</button>
                  <button type="button" aria-label={labels.manage} title={labels.manage} onclick={event => onCommand?.(entry.id, "manage", event.currentTarget)}>⋯</button>
                  <button type="button" aria-label={labels.moveEarlier} title={labels.moveEarlier} disabled={index === 0} onclick={() => onReorder?.(entry.id, -1)}>↑</button>
                  <button type="button" aria-label={labels.moveLater} title={labels.moveLater} disabled={index === workspace.entries.length - 1} onclick={() => onReorder?.(entry.id, 1)}>↓</button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
        {#if showSources && navState}
          <NavigationPane {...workspace.navProps} strings={navState.strings} nav={{ ...navState.nav, visible: true }} scope={navState.scope} viewMode={navState.projection.viewMode} activeFilterTags={navState.projection.activeFilterTags} />
        {/if}
      </aside>
    {/if}
    <div class="fce-stream-stage" class:is-hidden={!showStage} class:is-vertical={workspace.direction === "vertical"} bind:this={stageEl} use:measureStage>
      {#if workspace.unsupported}
        <div class="fce-stream-empty" role="status"><p>{labels.unsupported}</p><button type="button" onclick={onCreate}>{labels.recovery}</button></div>
      {:else if expanded.length === 0}
        <div class="fce-stream-empty"><p>{labels.empty}</p><button type="button" onclick={onCreate}>{labels.create}</button>{#if workspace.recentlyClosedCount > 0}<button type="button" onclick={onReopen}>{labels.reopen}</button>{/if}</div>
      {/if}
      {#each expanded as entry, index (entry.id)}
        <section class="fce-stream-panel" class:is-current={entry.current} data-stream-id={entry.id} aria-label={entry.title} style={entry.size === undefined ? `flex: ${entry.weight} 1 0px` : `flex: 0 0 ${entry.size}px`} onpointerdown={() => onSelect?.(entry.id)} onfocusin={() => onSelect?.(entry.id)}>
          <header class="fce-stream-panel-header">
            <button type="button" class="fce-stream-title" onclick={() => onSelect?.(entry.id)}>{entry.title}{#if entry.current}<span class="fce-stream-status"> · {labels.current}</span>{/if}</button>
            <button type="button" aria-label={labels.collapse} title={labels.collapse} onclick={() => onCommand?.(entry.id, "collapse")}>−</button>
            <button type="button" aria-label={labels.manage} title={labels.manage} onclick={event => onCommand?.(entry.id, "manage", event.currentTarget)}>⋯</button>
            <button type="button" aria-label={labels.close} title={labels.close} onclick={() => onCommand?.(entry.id, "close")}>×</button>
          </header>
          {#if entry.error}<div class="fce-stream-error" role="alert">{entry.error}</div>{/if}
          <div class="fce-stream-panel-content" inert={entry.pending} aria-busy={entry.pending}>
            {#if entry.panelModel}<FolderCardPanel {...entry.props} panelModel={entry.panelModel} showNavigation={false} onShellResize={undefined} />{:else if entry.pending}<div class="fce-stream-empty" role="status">{labels.pending}</div>{/if}
          </div>
        </section>
        {#if index < expanded.length - 1}
          {@const next = expanded[index + 1]}
          <!-- Focusable ARIA window splitter follows the host navigation resize pattern. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div class="fce-stream-splitter" role="separator" tabindex="0" aria-label={labels.resize} aria-describedby={helpId} aria-orientation={workspace.direction === "horizontal" ? "vertical" : "horizontal"} aria-valuenow={Math.round(entry.size ?? entry.weight * 100)} onkeydown={event => resizeKey(event, entry.id, next.id)} onpointerdown={event => startResize(event, entry.id, next.id)} onpointermove={moveResize} onpointerup={() => { dragging = null; }} onpointercancel={() => { dragging = null; }}></div>
        {/if}
      {/each}
    </div>
  </div>
  <span class="fce-sr-only" id={helpId}>{labels.resizeHelp}</span>
</div>
