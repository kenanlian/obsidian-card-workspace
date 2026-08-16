import { Menu, type TFile } from "obsidian";

import type { OpenDestination } from "../../settings";
import { getMenuDom, type MenuDomLike } from "../menu-dom";
import type { TagMutationMode } from "../modals/TagInputModal";
import type { ViewContext } from "../view-context";

const TAG_ADD_ICON = "card-workspace-tag-plus";
const TAG_REMOVE_ICON = "card-workspace-tag-minus";

export type CardMenuAction =
  | OpenDestination
  | "make-copy"
  | "move"
  | "rename"
  | "delete"
  | "add-tag"
  | "remove-tag"
  | "copy-title"
  | "copy-content"
  | "copy-title-and-content";

export interface CardContextMenuDeps {
  context: ViewContext;
  resolveLiveMarkdownFile: (notePath: string) => TFile | null;
  isBoxMode: () => boolean;
  appendAddToBoxMenu: (menu: Menu, paths: string[]) => void;
  appendCardFavoriteMenuItem: (menu: Menu, notePath: string) => void;
  removeMemberFromActiveBox: (notePath: string) => Promise<void>;
  copyCardTitle: (notePath: string) => Promise<void>;
  copyCardContent: (notePath: string) => Promise<void>;
  copyCardTitleAndContent: (notePath: string) => Promise<void>;
  makeCardFileCopy: (notePath: string) => Promise<void>;
  moveCardNote: (notePath: string) => void;
  renameCardFile: (notePath: string) => void;
  deleteCardFile: (notePath: string) => Promise<void>;
  openSingleTagModal: (notePath: string, mode: TagMutationMode) => void;
  openCardWithDestination: (notePath: string, destination: OpenDestination) => void;
}

export function isMouseEventLike(event: unknown): event is MouseEvent {
  if (typeof event !== "object" || event === null) {
    return false;
  }

  return "clientX" in event && "clientY" in event;
}

export function isMenuPosition(position: unknown): position is { x: number; y: number } {
  if (typeof position !== "object" || position === null) {
    return false;
  }

  if (!("x" in position) || !("y" in position)) {
    return false;
  }

  const x = (position as { x?: unknown }).x;
  const y = (position as { y?: unknown }).y;
  return typeof x === "number" && typeof y === "number";
}

/** Obsidian has no danger variant, so the destructive row is marked after render. */
export function markMenuItemAsDanger(menuDom: MenuDomLike, label: string): void {
  if (typeof menuDom.querySelectorAll !== "function") {
    return;
  }

  for (const item of menuDom.querySelectorAll(".menu-item")) {
    const titleElement = item.querySelector(".menu-item-title");
    if (titleElement?.textContent?.trim() !== label) {
      continue;
    }

    item.classList.add("fce-menu-item-danger");
  }
}

export function decorateCardContextMenu(menuDom: MenuDomLike, deleteLabel: string | null): void {
  menuDom.classList.add("fce-card-context-menu");
  if (deleteLabel !== null) {
    markMenuItemAsDanger(menuDom, deleteLabel);
  }
}

export class CardContextMenu {
  constructor(private readonly deps: CardContextMenuDeps) {}

  private get strings() {
    return this.deps.context.getUiStrings();
  }

  open(detail: {
    notePath?: unknown;
    trigger?: unknown;
    mouseEvent?: unknown;
    position?: unknown;
  }): void {
    if (typeof detail.notePath !== "string") {
      return;
    }

    if (detail.trigger === "button") {
      if (!isMenuPosition(detail.position)) {
        return;
      }
    } else if (!isMouseEventLike(detail.mouseEvent)) {
      return;
    }

    const menu = new Menu();
    this.addItems(menu, detail.notePath);

    if (detail.trigger === "button") {
      const position = detail.position;
      if (!isMenuPosition(position)) {
        return;
      }
      menu.showAtPosition(position);
    } else {
      const mouseEvent = detail.mouseEvent;
      if (!isMouseEventLike(mouseEvent)) {
        return;
      }
      menu.showAtMouseEvent(mouseEvent);
    }

    const menuDom = getMenuDom(menu);
    if (menuDom) {
      decorateCardContextMenu(menuDom, this.strings.view.contextMenu.delete);
    }
  }

  addItems(menu: Menu, notePath: string): void {
    const strings = this.strings.view.contextMenu;
    const liveMarkdownFile = this.deps.resolveLiveMarkdownFile(notePath);
    const addAction = (title: string, icon: string, action: CardMenuAction): void => {
      menu.addItem((item) => {
        item
          .setTitle(title)
          .setIcon(icon)
          .onClick(() => {
            void this.routeAction(action, notePath);
          });
      });
    };

    addAction(strings.openInCurrentWindow, "folder-open", "current-area");
    addAction(strings.openInNewTab, "file-plus", "new-tab");
    addAction(strings.openToTheRight, "separator-vertical", "split-right");
    addAction(strings.openInNewWindow, "picture-in-picture-2", "new-window");

    menu.addSeparator();

    addAction(strings.makeCopy, "copy", "make-copy");
    addAction(strings.moveFileTo, "folder-input", "move");

    menu.addSeparator();
    this.deps.appendAddToBoxMenu(menu, [notePath]);
    this.deps.appendCardFavoriteMenuItem(menu, notePath);
    if (this.deps.isBoxMode()) {
      menu.addItem((item) => {
        item
          .setTitle(this.strings.box.removeFromBox)
          .setIcon("gallery-thumbnails")
          .onClick(() => {
            void this.deps.removeMemberFromActiveBox(notePath);
          });
      });
    }

    if (liveMarkdownFile) {
      addAction(strings.copyTitle, "clipboard", "copy-title");
      addAction(strings.copyContent, "clipboard-list", "copy-content");
      addAction(strings.copyTitleAndContent, "clipboard-plus", "copy-title-and-content");

      menu.addSeparator();

      addAction(strings.addTag, TAG_ADD_ICON, "add-tag");
      addAction(strings.removeTag, TAG_REMOVE_ICON, "remove-tag");
    }

    menu.addSeparator();

    addAction(strings.rename, "pencil", "rename");
    addAction(strings.delete, "trash", "delete");
  }

  async routeAction(action: CardMenuAction, notePath: string): Promise<void> {
    switch (action) {
      case "copy-title":
        await this.deps.copyCardTitle(notePath);
        return;
      case "copy-content":
        await this.deps.copyCardContent(notePath);
        return;
      case "copy-title-and-content":
        await this.deps.copyCardTitleAndContent(notePath);
        return;
      case "make-copy":
        await this.deps.makeCardFileCopy(notePath);
        return;
      case "move":
        this.deps.moveCardNote(notePath);
        return;
      case "rename":
        this.deps.renameCardFile(notePath);
        return;
      case "add-tag":
        this.deps.openSingleTagModal(notePath, "add");
        return;
      case "remove-tag":
        this.deps.openSingleTagModal(notePath, "remove");
        return;
      case "delete":
        await this.deps.deleteCardFile(notePath);
        return;
      default:
        this.deps.openCardWithDestination(notePath, action);
    }
  }
}
