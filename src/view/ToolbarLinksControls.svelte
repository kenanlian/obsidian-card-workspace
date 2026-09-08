<script lang="ts">
  import { setIcon, setTooltip } from "obsidian";
  import type { LinksStrings } from "../i18n";

  interface ToolbarActionPayload {
    action: string;
  }

  interface Props {
    linksDirection?: "backlinks" | "outgoing" | null;
    linksPinned?: boolean;
    supportsLinksSnapshot?: boolean;
    strings: LinksStrings;
    tooltipSide?: "top" | "right" | "bottom" | "left";
    onToolbarAction?: (payload: ToolbarActionPayload) => void;
  }

  let {
    linksDirection = null,
    linksPinned = false,
    supportsLinksSnapshot = false,
    strings,
    tooltipSide = "right",
    onToolbarAction,
  }: Props = $props();

  const isLinksMode = $derived(linksDirection !== null);

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

  function emit(action: string): void {
    onToolbarAction?.({ action });
  }
</script>

<div class="fce-toolbar-links" role="group">
  <button
    type="button"
    class="clickable-icon fce-toolbar-button {linksDirection === 'backlinks' ? 'is-selected' : ''}"
    aria-label={strings.enterBacklinks}
    aria-pressed={linksDirection === "backlinks"}
    onclick={() => emit("links-backlinks")}
    use:applyIcon={"links"}
    use:applyTooltip={strings.enterBacklinks}
  >
    <span class="fce-sr-only">{strings.enterBacklinks}</span>
  </button>
  <button
    type="button"
    class="clickable-icon fce-toolbar-button {linksDirection === 'outgoing' ? 'is-selected' : ''}"
    aria-label={strings.enterOutgoing}
    aria-pressed={linksDirection === "outgoing"}
    onclick={() => emit("links-outgoing")}
    use:applyIcon={"arrow-up-right"}
    use:applyTooltip={strings.enterOutgoing}
  >
    <span class="fce-sr-only">{strings.enterOutgoing}</span>
  </button>
  {#if isLinksMode}
    <button
      type="button"
      class="clickable-icon fce-toolbar-button {linksPinned ? 'is-selected' : ''}"
      aria-label={linksPinned ? strings.resumeFollow : strings.pinToNote}
      aria-pressed={linksPinned}
      onclick={() => emit("links-pin-toggle")}
      use:applyIcon={"pin"}
      use:applyTooltip={linksPinned ? strings.resumeFollow : strings.pinToNote}
    >
      <span class="fce-sr-only">{linksPinned ? strings.resumeFollow : strings.pinToNote}</span>
    </button>
  {/if}
  {#if supportsLinksSnapshot}
    <button
      type="button"
      class="clickable-icon fce-toolbar-button"
      aria-label={strings.saveSnapshot}
      onclick={() => emit("links-save-snapshot")}
      use:applyIcon={"package-plus"}
      use:applyTooltip={strings.saveSnapshot}
    >
      <span class="fce-sr-only">{strings.saveSnapshot}</span>
    </button>
  {/if}
</div>
