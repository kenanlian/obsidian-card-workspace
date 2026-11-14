<script lang="ts">
  import { setIcon, setTooltip } from "obsidian";
  import type { Snippet } from "svelte";

  interface ToolbarActionPayload {
    action: string;
    position?: { x: number; y: number };
  }

  interface BulkActionOption {
    id: string;
    label: string;
    icon: string;
    disabled: boolean;
    danger?: boolean;
  }

  interface BulkActionSeparatorOption {
    type: "separator";
  }

  type BulkToolbarOption = BulkActionOption | BulkActionSeparatorOption;

  interface Props {
    className?: string;
    bulkActions?: BulkToolbarOption[];
    bulkSelectionSummary?: string;
    summary?: Snippet;
    ariaLabel?: string;
    tooltipSide?: "top" | "right" | "bottom" | "left";
    onToolbarAction?: (payload: ToolbarActionPayload) => void;
  }

  let {
    className = "",
    bulkActions = [],
    bulkSelectionSummary = "",
    summary,
    ariaLabel = "",
    tooltipSide = "right",
    onToolbarAction,
  }: Props = $props();

  function applyIcon(node: HTMLElement, iconName: string): { update: (nextIconName: string) => void } {
    setIcon(node, iconName);
    return {
      update(nextIconName: string) {
        setIcon(node, nextIconName);
      },
    };
  }

  function applyTooltip(node: HTMLElement, text: string): { update: (nextText: string) => void } {
    setTooltip(node, text, { placement: tooltipSide, gap: 8 });
    return {
      update(nextText: string) {
        setTooltip(node, nextText, { placement: tooltipSide, gap: 8 });
      },
    };
  }

  function emitToolbarAction(actionId: string, event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    onToolbarAction?.(actionId === "bulk-background-color" ? { action: actionId, position: { x: rect.left, y: rect.bottom } } : { action: actionId });
  }
</script>

<div class="fce-toolbar-bulk-strip {className}" role="group" aria-label={ariaLabel}>
  <div class="fce-toolbar-bulk-actions">
    {#each bulkActions as action}
      {#if "type" in action}
        <div class="fce-toolbar-bulk-separator" role="separator" aria-hidden="true"></div>
      {:else}
        <button
          type="button"
          class="clickable-icon fce-toolbar-bulk-button {action.danger ? 'is-destructive' : ''}"
          aria-label={action.label}
          disabled={action.disabled}
          onclick={(event) => emitToolbarAction(action.id, event)}
          use:applyIcon={action.icon}
          use:applyTooltip={action.label}
        >
          <span class="fce-sr-only">{action.label}</span>
        </button>
      {/if}
    {/each}
  </div>

  <div class="fce-toolbar-bulk-summary">
    {#if summary}{@render summary()}{:else}<span>{bulkSelectionSummary}</span>{/if}
  </div>
</div>
