<script lang="ts">
  import { setIcon } from "obsidian";
  import type { Snippet } from "svelte";

  interface TreeSectionProps {
    title: string;
    collapsed?: boolean;
    collapseLabel?: string;
    expandLabel?: string;
    onToggle?: () => void;
    body?: Snippet;
  }

  let {
    title,
    collapsed = false,
    collapseLabel = "Collapse section",
    expandLabel = "Expand section",
    onToggle,
    body,
  }: TreeSectionProps = $props();

  function applyIcon(node: HTMLElement, iconName: string): { update: (nextIconName: string) => void } {
    setIcon(node, iconName);
    return {
      update(nextIconName: string) {
        setIcon(node, nextIconName);
      },
    };
  }
</script>

<section class="fce-tree-section {collapsed ? 'is-collapsed' : ''}">
  <div class="fce-tree-section-header">
    <button
      type="button"
      class="fce-tree-section-toggle"
      aria-expanded={!collapsed}
      aria-label={collapsed ? expandLabel : collapseLabel}
      onclick={() => onToggle?.()}
    >
      <span class="fce-tree-section-chevron" use:applyIcon={collapsed ? "chevron-right" : "chevron-down"}></span>
      <span class="fce-tree-section-title">{title}</span>
    </button>
  </div>
  {#if !collapsed}
    <div class="fce-tree-section-body">
      {#if body}
        {@render body()}
      {/if}
    </div>
  {/if}
</section>
