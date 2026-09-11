<script lang="ts">
  import { setIcon, setTooltip } from "obsidian";

  interface ToolbarActionPayload {
    action: string;
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
    bulkActions?: BulkToolbarOption[];
    bulkSelectionSummary?: string;
    ariaLabel?: string;
    tooltipSide?: "top" | "right" | "bottom" | "left";
    onToolbarAction?: (payload: ToolbarActionPayload) => void;
  }

  let {
    bulkActions = [],
    bulkSelectionSummary = "",
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

  function emitToolbarAction(actionId: string): void {
    onToolbarAction?.({ action: actionId });
  }
</script>

<div class="fce-toolbar-bulk-strip" role="group" aria-label={ariaLabel}>
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
          onclick={() => emitToolbarAction(action.id)}
          use:applyIcon={action.icon}
          use:applyTooltip={action.label}
        >
          <span class="fce-sr-only">{action.label}</span>
        </button>
      {/if}
    {/each}
  </div>

  <div class="fce-toolbar-bulk-summary">
    <span>{bulkSelectionSummary}</span>
  </div>
</div>
