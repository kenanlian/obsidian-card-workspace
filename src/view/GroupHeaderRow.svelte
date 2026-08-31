<script lang="ts">
  import { setIcon } from "obsidian";
  import type { UiStrings } from "../i18n";
  import type { CardGroupSegment } from "./card-grouping";

  interface GroupHeaderRowProps {
    segment: CardGroupSegment;
    strings: UiStrings;
    headerId: string;
    onToggle: (key: string) => void;
  }

  let { segment, strings, headerId, onToggle }: GroupHeaderRowProps = $props();

  const groupStrings = $derived(strings.sortGroup);
  const accessibleName = $derived(groupStrings.groupHeaderAria(segment.label, segment.count));
  const chevronIcon = $derived(segment.collapsed ? "chevron-right" : "chevron-down");

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
</script>

<button
  type="button"
  class="fce-card-group-header"
  class:is-collapsed={segment.collapsed}
  id={headerId}
  aria-expanded={!segment.collapsed}
  aria-label={accessibleName}
  onclick={handleClick}
>
  <span class="fce-card-group-chevron" use:applyIcon={chevronIcon}></span>
  <span class="fce-card-group-label">{segment.label}</span>
  <span class="fce-card-group-count">{groupStrings.groupCount(segment.count)}</span>
  {#if segment.detail !== ""}
    <span class="fce-card-group-detail">{segment.detail}</span>
  {/if}
</button>
