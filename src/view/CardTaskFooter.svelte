<script lang="ts">
  import { setIcon } from "obsidian";
  import type { CardItemStrings } from "../i18n";
  import type { CardTaskSummary } from "./task-summary";

  interface CardTaskFooterProps {
    summary: CardTaskSummary;
    strings: CardItemStrings;
  }

  let { summary, strings }: CardTaskFooterProps = $props();

  const ariaLabel = $derived(
    summary.incomplete === 0
      ? strings.taskAllCompleteAria
      : strings.taskIncompleteAria(summary.incomplete),
  );

  function applyIcon(node: HTMLElement, iconName: string) {
    setIcon(node, iconName);
    return {
      update(nextIconName: string) {
        setIcon(node, nextIconName);
      },
    };
  }
</script>

<div class="fce-card-task-footer {summary.incomplete === 0 ? 'is-complete' : ''}" role="img" aria-label={ariaLabel}>
  <span class="fce-card-task-icon" aria-hidden="true" use:applyIcon={summary.incomplete === 0 ? "check" : "list-checks"}></span>
  {#if summary.incomplete > 0}<span class="fce-card-task-count">{summary.incomplete}</span>{/if}
</div>
