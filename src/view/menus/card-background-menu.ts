import type { Menu } from "obsidian";
import { CARD_BACKGROUND_TINTS, type CardBackgroundTint } from "../../card-background";
import { getCardBackgroundIcon } from "../../icons";
import type { UiStrings } from "../../i18n";

/** Shared immediate-apply palette for single-card and bulk menus. */
export function buildCardBackgroundMenu(menu: Menu, strings: UiStrings["cardBackground"], current: CardBackgroundTint | null | undefined, apply: (color: CardBackgroundTint | null) => void): void {
  menu.addItem(item => item.setTitle(strings.inherit).setIcon("rotate-ccw").setChecked(current === null).onClick(() => apply(null)));
  menu.addSeparator();
  for (const tint of CARD_BACKGROUND_TINTS) {
    menu.addItem(item => item
      .setTitle(strings.colors[tint])
      .setIcon(getCardBackgroundIcon(tint))
      .setChecked(current === tint)
      .onClick(() => apply(tint)));
  }
}
