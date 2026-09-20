<script lang="ts">
  import { setIcon } from "obsidian";
  import type { CardItemStrings } from "../i18n";
  import type { CardTaskSummary } from "./task-summary";

  interface CardTaskFooterProps {
    summary: CardTaskSummary;
    strings: CardItemStrings;
  }

  let { summary, strings }: CardTaskFooterProps = $props();

  const completed = $derived(summary.total - summary.incomplete);
  const ariaLabel = $derived(strings.taskProgressAria(completed, summary.total));
  const iconName = $derived(
    completed === 0 ? "circle" : completed === summary.total ? "circle-check" : "circle-dot",
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
  <span class="fce-card-task-icon" aria-hidden="true" use:applyIcon={iconName}></span>
  <span class="fce-card-task-count">{completed}/{summary.total}</span>
</div>
