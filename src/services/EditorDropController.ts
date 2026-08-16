import {
  Editor,
  Menu,
  MarkdownFileInfo,
  MarkdownView,
  Notice,
  TFile,
  type App,
  type EditorPosition,
} from "obsidian";
import { EditorView } from "@codemirror/view";

import type { UiStrings } from "../i18n";
import type { DragInsertAction, PluginSettings } from "../settings";
import { resolveCardFileKind } from "../view/file-kind";
import { getMenuDom } from "../view/menu-dom";
import { buildContentClipboardText, buildTitleAndContentClipboardText } from "../view/note-ops";

// Duplicated in CardItem.svelte to preserve the Svelte/services boundary; update both together.
export const CARD_WORKSPACE_DRAG_MIME = "application/x-card-workspace-note";

export interface CardWorkspaceDragPayload {
  path: string;
  title: string;
}

interface ResolvedCardDragEditorContext {
  editor: Editor;
  info: MarkdownView | MarkdownFileInfo;
}

interface EditorWithCodeMirror {
  cm?: unknown;
}

type SupportedDragInsertAction = Exclude<DragInsertAction, "ask">;

export interface EditorDropControllerDeps {
  app: App;
  getSettings: () => PluginSettings;
  getUiStrings: () => UiStrings;
}

/** Owns dropping a card onto a markdown editor: payload parsing, insert menu, insertion. */
export class EditorDropController {
  private readonly app: App;
  private readonly getSettings: () => PluginSettings;
  private readonly getUiStrings: () => UiStrings;

  constructor(deps: EditorDropControllerDeps) {
    this.app = deps.app;
    this.getSettings = deps.getSettings;
    this.getUiStrings = deps.getUiStrings;
  }

  handleDragOver(event: DragEvent): boolean {
    if (event.defaultPrevented) {
      return false;
    }

    if (!this.hasCardWorkspaceDragTypes(event)) {
      return false;
    }

    if (event.dataTransfer != null) {
      event.dataTransfer.dropEffect = "copy";
    }

    event.preventDefault();
    return true;
  }

  handleDomDrop(event: DragEvent, view: EditorView): boolean {
    if (event.defaultPrevented) {
      return false;
    }
    const payload = this.parseDragPayload(event.dataTransfer?.getData(CARD_WORKSPACE_DRAG_MIME) ?? "");
    if (!payload) {
      return false;
    }

    const context = this.resolveCardDragEditorContext(view);
    if (!context) {
      return false;
    }

    event.preventDefault();
    void this.handlePreparedDrop(payload, event, context.editor, context.info);
    return true;
  }

  handleWorkspaceEditorDrop(
    event: DragEvent,
    editor: Editor,
    info: MarkdownView | MarkdownFileInfo,
  ): void {
    if (event.defaultPrevented) {
      return;
    }
    const payload = this.parseDragPayload(event.dataTransfer?.getData(CARD_WORKSPACE_DRAG_MIME) ?? "");
    if (!payload) {
      return;
    }
    event.preventDefault();
    void this.handlePreparedDrop(payload, event, editor, info);
  }

  // Currently called only by tests; retained as the equivalent editor-drop entry point.
  async handleCardEditorDrop(
    event: DragEvent,
    editor: Editor,
    info: MarkdownView | MarkdownFileInfo,
  ): Promise<void> {
    const payload = this.parseDragPayload(event.dataTransfer?.getData(CARD_WORKSPACE_DRAG_MIME) ?? "");
    if (!payload) {
      return;
    }

    if (!event.defaultPrevented) {
      event.preventDefault();
    }

    await this.handlePreparedDrop(payload, event, editor, info);
  }

  parseDragPayload(value: string): CardWorkspaceDragPayload | null {
    if (value.length === 0) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const { path, title } = parsed as { path?: unknown; title?: unknown };
    if (typeof path !== "string" || path.length === 0 || typeof title !== "string" || title.length === 0) {
      return null;
    }

    return { path, title };
  }

  private async handlePreparedDrop(
    payload: CardWorkspaceDragPayload,
    event: DragEvent,
    editor: Editor,
    info: MarkdownView | MarkdownFileInfo,
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(payload.path);
    if (!(file instanceof TFile)) {
      new Notice(this.getUiStrings().view.dragInsertMenu.sourceFileMissing);
      return;
    }

    const position = this.resolveDropEditorPosition(event, editor, info);
    const action = this.getSettings().dragInsertAction;
    if (action === "ask") {
      this.openDragInsertMenu({ event, editor, file, position });
      return;
    }

    await this.insertCardDragContent({ editor, file, position, action });
  }

  private resolveDropEditorPosition(
    event: DragEvent,
    editor: Editor,
    info: MarkdownView | MarkdownFileInfo,
  ): EditorPosition {
    const sourceEditor = info.editor ?? editor;
    const cm = this.getEditorCodeMirror(sourceEditor);
    if (cm instanceof EditorView) {
      const offset = cm.posAtCoords({ x: event.clientX, y: event.clientY });
      if (typeof offset === "number") {
        return editor.offsetToPos(offset);
      }
    }

    return editor.getCursor();
  }

  private resolveCardDragEditorContext(view: EditorView): ResolvedCardDragEditorContext | null {
    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of markdownLeaves) {
      const leafView = leaf.view;
      if (!(leafView instanceof MarkdownView)) {
        continue;
      }

      const editor = leafView.editor;
      const editorView = this.getEditorCodeMirror(editor);
      if (editorView === view) {
        return { editor, info: leafView };
      }
    }

    return null;
  }

  private getEditorCodeMirror(editor: Editor): unknown {
    return (editor as Editor & EditorWithCodeMirror).cm;
  }

  private hasCardWorkspaceDragTypes(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    if (types == null) {
      return false;
    }

    for (let i = 0; i < types.length; i++) {
      if (types[i] === CARD_WORKSPACE_DRAG_MIME) {
        return true;
      }
    }

    return false;
  }

  private getSupportedDragInsertActions(file: TFile): SupportedDragInsertAction[] {
    const fileKind = resolveCardFileKind(file);
    if (fileKind === "markdown") {
      return ["wiki", "embed", "content", "title-content"];
    }
    if (fileKind === "base" || fileKind === "canvas") {
      return ["wiki", "embed"];
    }

    return ["wiki"];
  }

  private isDragInsertActionSupported(file: TFile, action: SupportedDragInsertAction): boolean {
    return this.getSupportedDragInsertActions(file).includes(action);
  }

  private openDragInsertMenu({
    event,
    editor,
    file,
    position,
  }: {
    event: DragEvent;
    editor: Editor;
    file: TFile;
    position: EditorPosition;
  }): void {
    const strings = this.getUiStrings().view.dragInsertMenu;
    const menu = new Menu();
    for (const action of this.getSupportedDragInsertActions(file)) {
      const { icon, title } = this.getDragInsertMenuItemDetails(action, strings);
      menu.addItem((item) => {
        item.setTitle(title).setIcon(icon).onClick(() => {
          void this.insertCardDragContent({ editor, file, position, action });
        });
      });
    }

    menu.showAtPosition(this.resolveDragMenuPosition(event));
    const menuDom = getMenuDom(menu);
    menuDom?.classList.add("fce-card-drag-insert-menu");
  }

  private getDragInsertMenuItemDetails(
    action: SupportedDragInsertAction,
    strings: UiStrings["view"]["dragInsertMenu"],
  ): { icon: string; title: string } {
    switch (action) {
      case "wiki":
        return { icon: "link", title: strings.insertWikiLink };
      case "embed":
        return { icon: "file-input", title: strings.insertEmbedLink };
      case "content":
        return { icon: "clipboard", title: strings.insertContent };
      case "title-content":
        return { icon: "heading-1", title: strings.insertTitleAndContent };
    }
  }

  private resolveDragMenuPosition(event: DragEvent): { x: number; y: number } {
    return { x: event.clientX, y: event.clientY };
  }

  private async buildDragInsertText(file: TFile, action: SupportedDragInsertAction): Promise<string | null> {
    switch (action) {
      case "wiki":
        return `[[${file.basename}]]`;
      case "embed":
        return `![[${file.basename}]]`;
      case "content":
        return await buildContentClipboardText(this.app, file);
      case "title-content":
        return await buildTitleAndContentClipboardText(this.app, file);
    }
  }

  private async insertCardDragContent({
    editor,
    file,
    position,
    action,
  }: {
    editor: Editor;
    file: TFile;
    position: EditorPosition;
    action: SupportedDragInsertAction;
  }): Promise<void> {
    if (!this.isDragInsertActionSupported(file, action)) {
      new Notice(this.getUiStrings().view.dragInsertMenu.unsupportedForFileType);
      return;
    }

    const text = (await this.buildDragInsertText(file, action)) ?? "";
    editor.replaceRange(text, position, undefined, "card-workspace-drag");
    const endPosition = editor.offsetToPos(editor.posToOffset(position) + text.length);
    editor.setCursor(endPosition);
  }
}
