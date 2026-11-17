<script lang="ts">
  import { Menu, setIcon, setTooltip } from "obsidian";
  import type { BoxSummary } from "./panel-model";
  import { getMenuDom } from "./menu-dom";

  interface Props {
    boxSummaries?: BoxSummary[];
    menuLabel?: string;
    saveScopeLabel?: string;
    addScopeLabel?: string;
    tooltipSide?: "top" | "right" | "bottom" | "left";
    closeNonce?: number;
    onSaveScope?: () => void;
    onAddToBox?: (boxId: string) => void;
  }

  let {
    boxSummaries = [],
    menuLabel = "",
    saveScopeLabel = "",
    addScopeLabel = "",
    tooltipSide = "right",
    closeNonce = 0,
    onSaveScope,
    onAddToBox,
  }: Props = $props();

  let menu = $state.raw<Menu | null>(null);

  $effect(() => {
    // Close when another toolbar menu opens, and when the button is unmounted.
    closeNonce;
    return closeBoxPickerMenu;
  });

  function applyIcon(node: HTMLElement, iconName: string): { update: (nextIconName: string) => void } {
    setIcon(node, iconName);
    return {
      update(nextIconName: string) {
        setIcon(node, nextIconName);
      },
    };
  }

  function applyTooltip(node: HTMLElement, text: string): { update: (text: string) => void } {
    const update = (text: string): void => setTooltip(node, text, { placement: tooltipSide, gap: 8 });
    update(text);
    return { update };
  }

  function closeBoxPickerMenu(): void {
    menu?.hide();
    menu = null;
  }

  function toggleBoxPickerMenu(event: MouseEvent): void {
    if (menu) {
      closeBoxPickerMenu();
      return;
    }

    const nextMenu = new Menu().setUseNativeMenu(false);
    menu = nextMenu;
    nextMenu.onHide(() => { if (menu === nextMenu) menu = null; });
    nextMenu.addItem(item => item.setTitle(saveScopeLabel).setIcon("package-plus").onClick(() => {
      closeBoxPickerMenu();
      onSaveScope?.();
    }));
    if (boxSummaries.length > 0) {
      nextMenu.addSeparator();
      nextMenu.addItem(item => item.setTitle(addScopeLabel).setIcon("package-check").setDisabled(true));
      for (const box of boxSummaries) {
        nextMenu.addItem(item => item.setTitle(box.name).setIcon("box").onClick(() => {
          closeBoxPickerMenu();
          onAddToBox?.(box.id);
        }));
      }
    }

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    nextMenu.showAtPosition({ x: rect.left, y: rect.bottom, overlap: true });
    const menuDom = getMenuDom(nextMenu);
    menuDom?.classList.add("fce-box-picker-menu");
    if (boxSummaries.length > 0) {
      // The save action precedes the heading; separators are not menu items.
      const heading = Array.from(menuDom?.querySelectorAll?.(".menu-item") ?? [])[1];
      heading?.classList.add("fce-menu-section-title");
    }
  }
</script>

<button
  type="button"
  class="clickable-icon fce-toolbar-button {menu ? 'is-selected' : ''}"
  aria-label={menuLabel}
  aria-haspopup="menu"
  aria-expanded={menu !== null}
  onclick={toggleBoxPickerMenu}
  use:applyIcon={"box"}
  use:applyTooltip={menuLabel}
>
  <span class="fce-sr-only">{menuLabel}</span>
</button>
