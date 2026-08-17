import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockState,
  resetFolderCardViewHarness,
  createViewWithFile,
  createCardRecord,
  getMenuStructure,
  getTopLevelMenuSignature,
  getDangerMenuTitles,
  registerFolderCardView,
} from "../../__mocks__/folder-card-view-harness";
import {
  decorateCardContextMenu,
  isMenuPosition,
  isMouseEventLike,
} from "./card-context-menu";
import { FolderCardView } from "../FolderCardView";

registerFolderCardView(FolderCardView);

describe("card context menu helpers", () => {
  it("validates mouse and positioned triggers", () => {
    expect(isMouseEventLike({ clientX: 1, clientY: 2 })).toBe(true);
    expect(isMouseEventLike({ clientX: 1 })).toBe(false);
    expect(isMenuPosition({ x: 3, y: 4 })).toBe(true);
    expect(isMenuPosition({ x: 3 })).toBe(false);
  });

  it("decorates the menu surface even without a danger row", () => {
    const add = vi.fn();
    decorateCardContextMenu({
      classList: { add },
      querySelectorAll: () => [],
    }, null);

    expect(add).toHaveBeenCalledWith("fce-card-context-menu");
  });
});

describe("card context menu contract", () => {
  beforeEach(() => {
    resetFolderCardViewHarness();
  });

    it("openCardContextMenu shows the shared menu with destination items for contextmenu trigger", () => {
      const { view, file } = createViewWithFile();
      const mouseEvent = { clientX: 12, clientY: 24 } as MouseEvent;

      (view as any).modules.cardMenu.open({
        notePath: file.path,
        trigger: "contextmenu",
        mouseEvent,
      });

      expect(mockState.menuInstances).toHaveLength(1);
      const [menu] = mockState.menuInstances;
      expect(getMenuStructure(menu!)).toEqual([
        "Open in current window",
        "Open in new tab",
        "Open to the right",
        "Open in new window",
        "separator",
        "Make a copy",
        "Move file to...",
        "separator",
        "Add to card box -> New card box…",
        "Add to favorites",
        "Copy title",
        "Copy content",
        "Copy title & content",
        "separator",
        "Add tag...",
        "Remove tag...",
        "separator",
        "Rename...",
        "Delete",
      ]);
      expect(menu?.showAtMouseEvent).toHaveBeenCalledTimes(1);
      expect(menu?.showAtMouseEvent).toHaveBeenCalledWith(mouseEvent);
      expect(menu?.showAtPosition).not.toHaveBeenCalled();
      expect(menu?.dom.classList.add).toHaveBeenCalledWith("fce-card-context-menu");
      expect(getDangerMenuTitles(menu!)).toEqual(["Delete"]);
    });

  it("desktop markdown cards render the reduced card menu contract exactly", () => {
    const { view, file } = createViewWithFile("notes/desktop-markdown-parity.md", {
      isDesktopApp: true,
      fullPath: "/vault/notes/desktop-markdown-parity.md",
    });

    (view as any).modules.cardMenu.open({
      notePath: file.path,
      trigger: "contextmenu",
      mouseEvent: { clientX: 16, clientY: 24 },
    });

    expect(mockState.menuInstances).toHaveLength(1);
    const [menu] = mockState.menuInstances;
    expect(menu).toBeDefined();
    expect(getTopLevelMenuSignature(menu!)).toEqual([
      { kind: "item", title: "Open in current window", icon: "folder-open" },
      { kind: "item", title: "Open in new tab", icon: "file-plus" },
      { kind: "item", title: "Open to the right", icon: "separator-vertical" },
      { kind: "item", title: "Open in new window", icon: "picture-in-picture-2" },
      { kind: "separator" },
      { kind: "item", title: "Make a copy", icon: "copy" },
      { kind: "item", title: "Move file to...", icon: "folder-input" },
      { kind: "separator" },
      { kind: "item", title: "Add to card box", icon: "box" },
      { kind: "item", title: "Add to favorites", icon: "star" },
      { kind: "item", title: "Copy title", icon: "clipboard" },
      { kind: "item", title: "Copy content", icon: "clipboard-list" },
      { kind: "item", title: "Copy title & content", icon: "clipboard-plus" },
      { kind: "separator" },
      { kind: "item", title: "Add tag...", icon: "card-workspace-tag-plus" },
      { kind: "item", title: "Remove tag...", icon: "card-workspace-tag-minus" },
      { kind: "separator" },
      { kind: "item", title: "Rename...", icon: "pencil" },
      { kind: "item", title: "Delete", icon: "trash" },
    ]);
  });

  it("openCardContextMenu aborts and does not render menu on invalid inputs", () => {
    const { view } = createViewWithFile();

    (view as any).modules.cardMenu.open({
      notePath: 123,
      trigger: "contextmenu",
      mouseEvent: { clientX: 12, clientY: 24 },
    });
    (view as any).modules.cardMenu.open({ notePath: "path.md", trigger: "contextmenu", mouseEvent: null });
    (view as any).modules.cardMenu.open({
      notePath: "path.md",
      trigger: "contextmenu",
      mouseEvent: { clientX: 12 },
    });
    (view as any).modules.cardMenu.open({ notePath: "path.md", trigger: "button", position: null });
    (view as any).modules.cardMenu.open({
      notePath: "path.md",
      trigger: "button",
      position: { x: 12 },
    });

    expect(mockState.menuInstances).toHaveLength(0);
  });

  it("routeCardMenuAction opens note for destination actions and preserves remaining file-mutation routes", async () => {
    const { view, file, plugin } = createViewWithFile("notes/context-route.md");
    const makeCopySpy = vi.spyOn((view as any).modules.fileActions, "makeCardFileCopy").mockResolvedValue(undefined);
    const moveSpy = vi.spyOn((view as any).modules.fileActions, "moveCardNote");
    const renameSpy = vi.spyOn((view as any).modules.fileActions, "renameCardFile").mockImplementation(() => undefined);
    const addTagSpy = vi.spyOn((view as any).modules.tagActions, "openSingleTagModal").mockImplementation(() => undefined);
    const deleteSpy = vi.spyOn((view as any).modules.fileActions, "deleteCardFile").mockResolvedValue(undefined);
    const copyTitleSpy = vi.spyOn((view as any).modules.fileActions, "copyCardTitle").mockResolvedValue(undefined);
    const copyContentSpy = vi.spyOn((view as any).modules.fileActions, "copyCardContent").mockResolvedValue(undefined);
    const copyTitleAndContentSpy = vi.spyOn((view as any).modules.fileActions, "copyCardTitleAndContent").mockResolvedValue(undefined);

    await (view as any).modules.cardMenu.routeAction("current-area", file.path);
    await (view as any).modules.cardMenu.routeAction("new-tab", file.path);
    await (view as any).modules.cardMenu.routeAction("split-right", file.path);
    await (view as any).modules.cardMenu.routeAction("new-window", file.path);
    await (view as any).modules.cardMenu.routeAction("make-copy", file.path);
    await (view as any).modules.cardMenu.routeAction("move", file.path);
    await (view as any).modules.cardMenu.routeAction("rename", file.path);
    await (view as any).modules.cardMenu.routeAction("add-tag", file.path);
    await (view as any).modules.cardMenu.routeAction("remove-tag", file.path);
    await (view as any).modules
      .cardMenu.routeAction("delete", file.path);
    await (view as any).modules.cardMenu.routeAction("copy-title", file.path);
    await (view as any).modules.cardMenu.routeAction("copy-content", file.path);
    await (view as any).modules.cardMenu.routeAction("copy-title-and-content", file.path);

    expect(plugin.openNoteFromCard).toHaveBeenNthCalledWith(1, file.path, "current-area");
    expect(plugin.openNoteFromCard).toHaveBeenNthCalledWith(2, file.path, "new-tab");
    expect(plugin.openNoteFromCard).toHaveBeenNthCalledWith(3, file.path, "split-right");
    expect(plugin.openNoteFromCard).toHaveBeenNthCalledWith(4, file.path, "new-window");
    expect(plugin.openNoteFromCard).toHaveBeenCalledTimes(4);
    expect(makeCopySpy).toHaveBeenCalledTimes(1);
    expect(makeCopySpy).toHaveBeenCalledWith(file.path);
    expect(moveSpy).toHaveBeenCalledTimes(1);
    expect(moveSpy).toHaveBeenCalledWith(file.path);
    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(renameSpy).toHaveBeenCalledWith(file.path);
    expect(addTagSpy).toHaveBeenNthCalledWith(1, file.path, "add");
    expect(addTagSpy).toHaveBeenNthCalledWith(2, file.path, "remove");
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(file.path);
    expect(copyTitleSpy).toHaveBeenCalledTimes(1);
    expect(copyTitleSpy).toHaveBeenCalledWith(file.path);
    expect(copyContentSpy).toHaveBeenCalledTimes(1);
    expect(copyContentSpy).toHaveBeenCalledWith(file.path);
    expect(copyTitleAndContentSpy).toHaveBeenCalledTimes(1);
    expect(copyTitleAndContentSpy).toHaveBeenCalledWith(file.path);
  });
  it("conditional menu variants keep separators clean after removing optional actions", () => {
    const { view: desktopNonMarkdownView, file: desktopNonMarkdownFile } = createViewWithFile(
      "notes/non-markdown.canvas",
      {
        isDesktopApp: true,
        fullPath: "/vault/notes/non-markdown.canvas",
      },
    );
    const desktopNonMarkdownCard = createCardRecord(desktopNonMarkdownFile, "canvas");
    (desktopNonMarkdownView as any).baseCards = [desktopNonMarkdownCard];
    (desktopNonMarkdownView as any).visibleCards = [desktopNonMarkdownCard];

    (desktopNonMarkdownView as any).modules.cardMenu.open({
      notePath: desktopNonMarkdownFile.path,
      trigger: "contextmenu",
      mouseEvent: { clientX: 2, clientY: 2 },
    });

    expect(mockState.menuInstances).toHaveLength(1);
    const [desktopNonMarkdownMenu] = mockState.menuInstances;
    expect(getTopLevelMenuSignature(desktopNonMarkdownMenu!)).toEqual([
      { kind: "item", title: "Open in current window", icon: "folder-open" },
      { kind: "item", title: "Open in new tab", icon: "file-plus" },
      { kind: "item", title: "Open to the right", icon: "separator-vertical" },
      { kind: "item", title: "Open in new window", icon: "picture-in-picture-2" },
      { kind: "separator" },
      { kind: "item", title: "Make a copy", icon: "copy" },
      { kind: "item", title: "Move file to...", icon: "folder-input" },
      { kind: "separator" },
      { kind: "item", title: "Add to card box", icon: "box" },
      { kind: "item", title: "Add to favorites", icon: "star" },
      { kind: "separator" },
      { kind: "item", title: "Rename...", icon: "pencil" },
      { kind: "item", title: "Delete", icon: "trash" },
    ]);

    mockState.menuInstances.length = 0;

    const { view: nonDesktopMarkdownView, file: nonDesktopMarkdownFile } = createViewWithFile("notes/non-desktop.md", {
      isDesktopApp: false,
      fullPath: null,
    });

    (nonDesktopMarkdownView as any).modules.cardMenu.open({
      notePath: nonDesktopMarkdownFile.path,
      trigger: "button",
      position: { x: 12, y: 18 },
    });

    expect(mockState.menuInstances).toHaveLength(1);
    const [nonDesktopMarkdownMenu] = mockState.menuInstances;
    expect(getTopLevelMenuSignature(nonDesktopMarkdownMenu!)).toEqual([
      { kind: "item", title: "Open in current window", icon: "folder-open" },
      { kind: "item", title: "Open in new tab", icon: "file-plus" },
      { kind: "item", title: "Open to the right", icon: "separator-vertical" },
      { kind: "item", title: "Open in new window", icon: "picture-in-picture-2" },
      { kind: "separator" },
      { kind: "item", title: "Make a copy", icon: "copy" },
      { kind: "item", title: "Move file to...", icon: "folder-input" },
      { kind: "separator" },
      { kind: "item", title: "Add to card box", icon: "box" },
      { kind: "item", title: "Add to favorites", icon: "star" },
      { kind: "item", title: "Copy title", icon: "clipboard" },
      { kind: "item", title: "Copy content", icon: "clipboard-list" },
      { kind: "item", title: "Copy title & content", icon: "clipboard-plus" },
      { kind: "separator" },
      { kind: "item", title: "Add tag...", icon: "card-workspace-tag-plus" },
      { kind: "item", title: "Remove tag...", icon: "card-workspace-tag-minus" },
      { kind: "separator" },
      { kind: "item", title: "Rename...", icon: "pencil" },
      { kind: "item", title: "Delete", icon: "trash" },
    ]);
    expect(nonDesktopMarkdownMenu?.showAtPosition).toHaveBeenCalledWith({ x: 12, y: 18 });
    expect(nonDesktopMarkdownMenu?.showAtMouseEvent).not.toHaveBeenCalled();
    expect(nonDesktopMarkdownMenu?.dom.classList.add).toHaveBeenCalledWith("fce-card-context-menu");
  });

  it("menu destination clicks call plugin.openNoteFromCard with bound this", () => {
    const { view, file, plugin } = createViewWithFile("notes/runtime-binding.md");
    const receiverCalls: Array<{ receiver: unknown; path: string; destination: string }> = [];

    plugin.openNoteFromCard = function(this: unknown, path: string, destination: string): void {
      receiverCalls.push({ receiver: this, path, destination });
    } as unknown as typeof plugin.openNoteFromCard;

    (view as any).modules.cardMenu.open({
      notePath: file.path,
      trigger: "button",
      position: { x: 32, y: 64 },
    });

    const [menu] = mockState.menuInstances;
    expect(menu).toBeDefined();

    const destinationTitles = [
      "Open in current window",
      "Open in new tab",
      "Open to the right",
      "Open in new window",
    ];

    for (const title of destinationTitles) {
      const menuItem = menu?.items.find((item) => item.title === title);
      expect(menuItem?.clickHandler).toBeTypeOf("function");
      menuItem?.clickHandler?.();
    }

    expect(receiverCalls).toEqual([
      { receiver: plugin, path: file.path, destination: "current-area" },
      { receiver: plugin, path: file.path, destination: "new-tab" },
      { receiver: plugin, path: file.path, destination: "split-right" },
      { receiver: plugin, path: file.path, destination: "new-window" },
    ]);
  });
});
