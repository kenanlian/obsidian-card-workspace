<script lang="ts">
  import { setIcon, setTooltip } from "obsidian";
  import type { Snippet } from "svelte";
  import type { UiStrings } from "../i18n";
  import type { NavigationRow } from "./navigation-model";
  import { resolveNavigationRowTooltip } from "./navigation-tooltip";

  interface Props {
    row: NavigationRow;
    tabIndex: number;
    strings: UiStrings;
    activeFilterTags?: string[];
    showItemCounts?: boolean;
    tooltipSide?: "left" | "right";
    subtreeHovered?: boolean;
    rowRef?: (node: HTMLElement, rowId: string) => { destroy: () => void };
    onFocus?: (rowId: string) => void;
    onActivate?: (event: MouseEvent, row: NavigationRow) => void;
    onToggleExpansion?: (event: MouseEvent, row: NavigationRow) => void;
    onKeydown?: (event: KeyboardEvent, row: NavigationRow) => void;
    onContextMenu?: (event: MouseEvent, row: NavigationRow) => void;
    actions?: Snippet;
  }

  let {
    row,
    tabIndex,
    strings,
    activeFilterTags = [],
    showItemCounts = false,
    tooltipSide = "right",
    subtreeHovered = false,
    rowRef = () => ({ destroy: () => undefined }),
    onFocus,
    onActivate,
    onToggleExpansion,
    onKeydown,
    onContextMenu,
    actions,
  }: Props = $props();

  const labels = $derived(strings.toolbar.navPane);
  const descriptionId = $props.id();
  const tagSection = $derived(row.kind === "section" && row.section === "tags");
  const visibleCount = $derived(tagSection ? activeFilterTags.length : showItemCounts ? row.count : 0);
  const summaryLabel = $derived(tagSection && activeFilterTags.length > 0
    ? labels.activeTagCount(activeFilterTags.length) : undefined);
  const tooltipText = $derived(resolveNavigationRowTooltip(row, strings));

  function icon(node: HTMLElement, name: string): { update: (next: string) => void } {
    setIcon(node, name);
    return { update: (next) => setIcon(node, next) };
  }

  function applyTooltip(node: HTMLElement, text: string): { update: (next: string) => void } {
    const apply = (value: string): void => {
      if (value) setTooltip(node, value, { placement: tooltipSide, gap: 8 });
    };
    apply(text);
    return { update: apply };
  }
</script>

<!-- svelte-ignore a11y_role_has_required_aria_props -- tree semantics use current/checked, not selection -->
<div
  class="fce-popup-row fce-tree-row fce-nav-projected-row is-{row.kind} fce-{row.section === 'folders' ? 'folder' : row.section === 'tags' ? 'tag' : row.section === 'favorites' ? 'favorites' : 'nav-box'}-menu {row.semanticState !== 'none' ? `is-${row.semanticState}` : ''} {row.disabled ? 'is-disabled' : ''} {subtreeHovered ? 'is-subtree-hovered' : ''}"
  data-nav-row-id={row.id}
  data-nav-section={row.section}
  style={`padding-inline-start: calc(var(--fce-nav-indent-step) * ${row.level - 1});`}
  role="treeitem"
  tabindex={tabIndex}
  aria-level={row.level}
  aria-posinset={row.positionInSet}
  aria-setsize={row.setSize}
  aria-expanded={row.expandable ? row.expanded : undefined}
  aria-current={row.semanticState === "current-range" ? "page" : undefined}
  aria-checked={row.kind === "tag" || (row.kind === "favorite" && row.favorite.kind === "tag")
    ? row.semanticState === "checked-filter"
    : undefined}
  aria-disabled={row.disabled || undefined}
  aria-describedby={row.semanticState === "active-file" ? descriptionId : undefined}
  use:rowRef={row.id}
  use:applyTooltip={tooltipText}
  onfocus={() => onFocus?.(row.id)}
  onclick={(event) => onActivate?.(event, row)}
  onkeydown={(event) => onKeydown?.(event, row)}
  oncontextmenu={(event) => onContextMenu?.(event, row)}
>
  <div class="fce-popup-row-leading">
    {#if row.expandable}
      <button
        type="button"
        class="fce-tree-item-icon"
        tabindex="-1"
        aria-label={row.expanded ? strings.toolbar.folderMenu.collapse : strings.toolbar.folderMenu.expand}
        onclick={(event) => onToggleExpansion?.(event, row)}
      >
        <span class="fce-tree-item-glyph" aria-hidden="true" use:icon={row.icon}></span>
        <span class="fce-tree-item-chevron" aria-hidden="true" use:icon={row.expanded ? "chevron-down" : "chevron-right"}></span>
      </button>
    {:else}
      <span class="fce-tree-item-icon is-static" aria-hidden="true">
        <span class="fce-tree-item-glyph" use:icon={row.icon}></span>
      </span>
    {/if}
  </div>
  <div class="fce-popup-row-content fce-tree-button">
    <span class="fce-tree-label">{row.label}</span>
  </div>
  <div class="fce-popup-row-trailing fce-nav-row-trailing {actions ? 'has-actions' : ''}">
    <div class="fce-nav-row-summary">
      {#if visibleCount > 0}
        <span class="fce-nav-row-count {tagSection ? 'fce-nav-active-tag-count' : ''}" aria-label={summaryLabel}>{visibleCount}</span>
      {/if}
      {#if row.semanticState === "checked-filter"}
        <span class="fce-popup-row-selected-indicator fce-tree-row-check" aria-hidden="true" use:icon={"check"}></span>
      {/if}
    </div>
    {#if actions}
      <div class="fce-nav-row-actions">{@render actions()}</div>
    {/if}
  </div>
  {#if row.semanticState === "active-file"}
    <span class="fce-sr-only" id={descriptionId}>{labels.activeFileDescription}</span>
  {/if}
</div>
