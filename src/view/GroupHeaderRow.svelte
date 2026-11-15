<script lang="ts">
  import { setIcon, setTooltip } from "obsidian";
  import type { UiStrings } from "../i18n";
  import type { CardGroupSegment } from "./card-grouping";
  import { resolveGroupHeaderParts } from "./group-header-content";

  interface GroupHeaderRowProps {
    segment: CardGroupSegment;
    strings: UiStrings;
    headerId: string;
    onToggle: (key: string) => void;
    onMenu?: (key: string, anchor: HTMLElement, position?: { x: number; y: number }) => void;
    taskCount?: number;
  }

  let { segment, strings, headerId, onToggle, onMenu, taskCount }: GroupHeaderRowProps = $props();
  let menuButton = $state<HTMLButtonElement | null>(null);

  const groupStrings = $derived(strings.sortGroup);
  const accessibleName = $derived(groupStrings.groupHeaderAria(segment.label, taskCount ?? segment.count));
  const chevronIcon = $derived(segment.collapsed ? "chevron-right" : "chevron-down");
  const parts = $derived(resolveGroupHeaderParts(segment.header, segment.label, groupStrings));

  function applyIcon(node: HTMLElement, iconName: string): { update: (nextIconName: string) => void } {
    setIcon(node, iconName);
    return {
      update(nextIconName: string) {
        setIcon(node, nextIconName);
      },
    };
  }

  function handleClick(): void {
    onToggle(segment.key);
  }

  function handleContextMenu(event: MouseEvent): void {
    if (!onMenu || !menuButton) return;
    event.preventDefault(); event.stopPropagation();
    onMenu(segment.key, menuButton, { x: event.clientX, y: event.clientY });
  }

  function handleMenuKey(event: KeyboardEvent): void {
    if (!onMenu || !menuButton || event.isComposing) return;
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault(); event.stopPropagation();
    onMenu(segment.key, menuButton);
  }

  function applyTooltip(node: HTMLElement, text: string): { update: (next: string) => void } {
    setTooltip(node, text, { placement: "top" });
    return { update: next => setTooltip(node, next, { placement: "top" }) };
  }
</script>

<div class="fce-group-header-actions" class:has-menu={onMenu !== undefined} role="group" aria-label={accessibleName} oncontextmenu={handleContextMenu}>
<button
  type="button"
  class="fce-card-group-header"
  class:is-collapsed={segment.collapsed}
  class:is-missing={segment.isMissingBucket}
  id={headerId || undefined}
  aria-expanded={!segment.collapsed}
  aria-label={accessibleName}
  onclick={handleClick}
  onkeydown={handleMenuKey}
>
  <span class="fce-card-group-chevron" use:applyIcon={chevronIcon}></span>
  <span class="fce-card-group-label">{#if parts.dimension}<span class="fce-card-group-dimension"><span
          class="fce-card-group-dimension-icon"
          use:applyIcon={parts.dimension.icon}
        ></span><span class="fce-card-group-dimension-text">{parts.dimension.label}</span></span><span
        class="fce-card-group-divider"
        aria-hidden="true"
      ></span>{/if}<span class="fce-card-group-values">{#each parts.chips as chip, index (index)}<span
          class="fce-card-group-value"
          class:is-off={chip.iconOff}
          title={chip.title}
        >{#if chip.icon}<span class="fce-card-group-value-icon" use:applyIcon={chip.icon}></span>{/if}{#if chip.prefix}<span
              class="fce-card-group-value-prefix">{chip.prefix}</span>{/if}<span class="fce-card-group-value-text"
            >{chip.text}</span></span>{/each}</span></span>
  <span class="fce-card-group-count">{groupStrings.groupCount(taskCount ?? segment.count)}</span>
</button>

{#if onMenu}
  <button
    type="button"
    class="clickable-icon fce-group-more"
    bind:this={menuButton}
    aria-label={strings.tasks.tools.groupMore}
    aria-haspopup="menu"
    onclick={event => onMenu?.(segment.key, event.currentTarget)}
    onkeydown={handleMenuKey}
    use:applyIcon={"ellipsis"}
    use:applyTooltip={strings.tasks.tools.groupMore}
  ></button>
{/if}
</div>
