<script lang="ts">
  import { setIcon } from "obsidian";
  import type { BoxSummary } from "./panel-model";

  interface PopupLifecycleOptions {
    getButton: () => HTMLElement | null;
    setMenu: (node: HTMLElement | null) => void;
    close: () => void;
    closeOnEscape?: boolean;
  }

  interface Props {
    boxSummaries?: BoxSummary[];
    addScopeLabel?: string;
    closeNonce?: number;
    onAddToBox?: (boxId: string) => void;
  }

  let {
    boxSummaries = [],
    addScopeLabel = "",
    closeNonce = 0,
    onAddToBox,
  }: Props = $props();

  const boxPickerButtonId = "fce-box-picker-button";

  let showBoxPickerMenu = $state(false);
  let boxPickerMenuX = $state(0);
  let boxPickerMenuY = $state(0);
  let boxPickerButtonEl: HTMLElement | null = null;

  $effect(() => {
    if (closeNonce === 0) {
      return;
    }
    showBoxPickerMenu = false;
  });

  function applyIcon(node: HTMLElement, iconName: string): { update: (nextIconName: string) => void } {
    setIcon(node, iconName);
    return {
      update(nextIconName: string) {
        setIcon(node, nextIconName);
      },
    };
  }

  function createElementCapture(assign: (node: HTMLElement | null) => void): (node: HTMLElement) => { destroy: () => void } {
    return (node: HTMLElement) => {
      assign(node);
      return {
        destroy() {
          assign(null);
        },
      };
    };
  }

  function createPopupPortalAction(options: PopupLifecycleOptions): (node: HTMLElement) => { destroy: () => void } {
    return (node: HTMLElement) => {
      const onClickOutside = (event: MouseEvent): void => {
        const target = event.target;
        if (target instanceof Node) {
          const button = options.getButton();
          if (button && button.contains(target)) {
            return;
          }
          if (node.contains(target)) {
            return;
          }
        }
        options.close();
      };

      const onKeydown = (event: KeyboardEvent): void => {
        if (event.key === "Escape") {
          options.close();
        }
      };

      options.setMenu(node);
      document.body.appendChild(node);
      document.addEventListener("click", onClickOutside, true);
      if (options.closeOnEscape) {
        document.addEventListener("keydown", onKeydown, true);
      }

      return {
        destroy() {
          document.removeEventListener("click", onClickOutside, true);
          if (options.closeOnEscape) {
            document.removeEventListener("keydown", onKeydown, true);
          }
          options.setMenu(null);
          if (node.parentNode) {
            node.parentNode.removeChild(node);
          }
        },
      };
    };
  }

  const captureBoxPickerButton = createElementCapture((node) => {
    boxPickerButtonEl = node;
  });

  function closeBoxPickerMenu(): void {
    showBoxPickerMenu = false;
  }

  function toggleBoxPickerMenu(event: MouseEvent): void {
    if (showBoxPickerMenu) {
      closeBoxPickerMenu();
      return;
    }

    boxPickerMenuX = event.clientX;
    boxPickerMenuY = event.clientY;
    showBoxPickerMenu = true;
  }

  function addScopeToBox(boxId: string): void {
    closeBoxPickerMenu();
    onAddToBox?.(boxId);
  }

  const boxPickerMenuAction = createPopupPortalAction({
    getButton: () => boxPickerButtonEl,
    setMenu: () => {},
    close: closeBoxPickerMenu,
    closeOnEscape: true,
  });
</script>

<button
  type="button"
  class="clickable-icon fce-toolbar-button {showBoxPickerMenu ? 'is-selected' : ''}"
  id={boxPickerButtonId}
  aria-label={addScopeLabel}
  aria-expanded={showBoxPickerMenu}
  onclick={toggleBoxPickerMenu}
  use:applyIcon={"package-check"}
  use:captureBoxPickerButton
>
  <span class="fce-sr-only">{addScopeLabel}</span>
</button>

{#if showBoxPickerMenu}
  <div
    class="fce-popup-menu fce-box-picker-menu"
    role="menu"
    aria-labelledby={boxPickerButtonId}
    style="left: {boxPickerMenuX}px; top: {boxPickerMenuY}px;"
    use:boxPickerMenuAction
  >
    {#each boxSummaries as box (box.id)}
      <button
        type="button"
        class="fce-popup-row fce-box-picker-item"
        role="menuitem"
        onclick={() => addScopeToBox(box.id)}
      >
        <span class="fce-popup-row-leading" aria-hidden="true" use:applyIcon={"box"}></span>
        <span class="fce-popup-row-content">
          <span class="fce-box-picker-item-label">{box.name}</span>
        </span>
      </button>
    {/each}
  </div>
{/if}
