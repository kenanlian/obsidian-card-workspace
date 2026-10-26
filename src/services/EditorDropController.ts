import {
  Editor,
  Menu,
  Modal,
  MarkdownFileInfo,
  MarkdownView,
  Notice,
  TFile,
  type App,
  type EditorPosition,
  type HeadingCache,
  type WorkspaceLeaf,
} from "obsidian";
import { EditorView } from "@codemirror/view";

import type { UiStrings } from "../i18n";
import type { DragInsertAction, PluginSettings } from "../settings";
import { resolveCardFileKind } from "../view/file-kind";
import { getMenuDom } from "../view/menu-dom";
import { buildCardInsertText } from "../view/card-insert-text";
import { headingsEqual, snapshotHeadings } from "./heading-drag-insert";
import type { VaultMutationEvent } from "./vault-events";

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

type DragInsertTarget = { kind: "whole" } | { kind: "heading"; heading: HeadingCache };

interface DropOperation {
  editor: Editor;
  info: MarkdownView | MarkdownFileInfo;
  targetFile: TFile | null;
  targetPath: string | null;
  targetContent: string;
  targetDocument: unknown;
  sourceEditorDocuments: Array<{ editor: Editor; document: unknown }>;
  file: TFile;
  sourcePath: string;
  mtime: number;
  size: number;
  position: EditorPosition;
  menuPosition: { x: number; y: number };
  headings: HeadingCache[] | null;
  useHeadings: boolean;
  menu: Menu | null;
  inserting: boolean;
  menuTarget?: NonNullable<EditorDropController["menuTarget"]>;
}

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
  private pendingDrop: DropOperation | null = null;
  private disposed = false;
  private lastMarkdown: MarkdownView | null = null;
  private menuTarget: { view: MarkdownView; file: TFile; path: string; editor: Editor; document: unknown; content: string; position: EditorPosition } | null = null;

  constructor(deps: EditorDropControllerDeps) {
    this.app = deps.app;
    this.getSettings = deps.getSettings;
    this.getUiStrings = deps.getUiStrings;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelPendingDrop(); this.menuTarget = null; this.lastMarkdown = null;
  }

  cancelPendingDrop(): void {
    const operation = this.pendingDrop;
    this.pendingDrop = null;
    operation?.menu?.hide();
  }

  handleEditorChange(editor: Editor, info: MarkdownView | MarkdownFileInfo): void {
    const target = this.menuTarget;
    if (target && editor === target.editor && (this.getEditorDocument(editor) !== target.document || editor.getValue() !== target.content)) this.menuTarget = null;
    const operation = this.pendingDrop;
    if (!operation) return;
    // Obsidian may deliver a debounced event from before this drop. Immutable
    // CodeMirror documents distinguish that event from a change (even an undo).
    if (editor === operation.editor && !this.isDropCurrent(operation)) this.cancelPendingDrop();
    if (info.file?.path === operation.sourcePath) {
      const snapshot = operation.sourceEditorDocuments.find((entry) => entry.editor === editor);
      if (!snapshot || snapshot.document === null || this.getEditorDocument(editor) !== snapshot.document) {
        this.cancelPendingDrop();
      }
    }
  }

  handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
    if (leaf?.view instanceof MarkdownView) {
      this.lastMarkdown = leaf.view; this.menuTarget = null;
    } else if (leaf?.view?.getViewType?.() === "folder-card-view") {
      const view = this.lastMarkdown;
      if (view?.file) this.menuTarget = { view, file: view.file, path: view.file.path, editor: view.editor,
        document: this.getEditorDocument(view.editor), content: view.editor.getValue(), position: { ...view.editor.getCursor("head") } };
      this.lastMarkdown = null;
    } else { this.lastMarkdown = null; this.menuTarget = null; }
    if (this.pendingDrop && (!(leaf?.view instanceof MarkdownView)
      || leaf.view.editor !== this.pendingDrop.editor || !this.isDropCurrent(this.pendingDrop))) {
      this.cancelPendingDrop();
    }
  }

  handleTargetChange(): void {
    if (this.pendingDrop && !this.isDropCurrent(this.pendingDrop)) this.cancelPendingDrop();
  }

  handleVaultMutation(event: VaultMutationEvent): void {
    const operation = this.pendingDrop;
    if (!operation) return;
    const affects = (path: string | null) => path !== null && [event.path, event.oldPath].some(
      (changed) => changed !== null && (path === changed || (event.isFolder && path.startsWith(`${changed}/`))),
    );
    if (affects(operation.sourcePath) || affects(operation.targetPath)) this.cancelPendingDrop();
  }

  handleDragStart(event: DragEvent): void {
    if (this.hasCardWorkspaceDragTypes(event)) this.cancelPendingDrop();
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

    this.cancelPendingDrop();

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
  ): boolean {
    if (event.defaultPrevented) {
      return false;
    }
    const payload = this.parseDragPayload(event.dataTransfer?.getData(CARD_WORKSPACE_DRAG_MIME) ?? "");
    if (!payload) {
      return false;
    }
    void this.handlePreparedDrop(payload, event, editor, info);
    return true;
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
    this.cancelPendingDrop();
    if (this.disposed) return;
    const file = this.app.vault.getAbstractFileByPath(payload.path);
    if (!(file instanceof TFile)) {
      new Notice(this.getUiStrings().view.dragInsertMenu.sourceFileMissing);
      return;
    }

    const settings = this.getSettings();
    const operation = this.prepareOperation(file, editor, info, this.resolveDropEditorPosition(event, editor, info), this.resolveDragMenuPosition(event));
    const useHeadings = operation.useHeadings;
    this.pendingDrop = operation;
    const action = settings.dragInsertAction;
    if (action === "ask") {
      this.openDragInsertMenu(operation);
      return;
    }
    if (useHeadings) {
      this.openHeadingMenu(operation, action);
      return;
    }
    await this.insertCardDragContent(operation, action, { kind: "whole" });
  }

  private prepareOperation(file: TFile, editor: Editor, info: MarkdownView | MarkdownFileInfo, position: EditorPosition, menuPosition: { x: number; y: number }): DropOperation {
    const settings = this.getSettings();
    const useHeadings = settings.enableHeadingDragInsert && resolveCardFileKind(file) === "markdown";
    const cache = useHeadings ? this.app.metadataCache.getFileCache(file) : null;
    const operation: DropOperation = {
      editor, info, file, useHeadings,
      targetFile: info.file ?? null,
      targetPath: info.file?.path ?? null,
      targetContent: editor.getValue(),
      targetDocument: this.getEditorDocument(editor),
      sourceEditorDocuments: this.app.workspace.getLeavesOfType("markdown").flatMap((leaf) => {
        const view = leaf.view;
        return view instanceof MarkdownView && view.file?.path === file.path
          ? [{ editor: view.editor, document: this.getEditorDocument(view.editor) }] : [];
      }),
      sourcePath: file.path, mtime: file.stat.mtime, size: file.stat.size,
      position,
      menuPosition,
      headings: cache ? snapshotHeadings(cache.headings ?? []) : null,
      menu: null, inserting: false,
    };
    return operation;
  }

  private isMenuTargetCurrent(target: NonNullable<EditorDropController["menuTarget"]>): boolean {
    return this.menuTarget === target && target.view.file === target.file && target.file.path === target.path
      && this.app.vault.getAbstractFileByPath(target.path) === target.file && target.view.editor === target.editor
      && this.getEditorDocument(target.editor) === target.document && target.editor.getValue() === target.content
      && this.app.workspace.getLeavesOfType("markdown").some(leaf => leaf.view === target.view);
  }

  appendMobileMenu(menu: Menu, path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const sourcePath = file.path, sourceMtime = file.stat.mtime, sourceSize = file.stat.size;
    const strings = this.getUiStrings(), target = this.menuTarget;
    const valid = target && this.isMenuTargetCurrent(target);
    menu.addItem(item => item.setTitle(valid ? strings.mobile.insertInto(target.path) : strings.mobile.noTarget).setDisabled(true));
    const addAction = (destination: Menu, action: SupportedDragInsertAction, heading?: HeadingCache) => {
      const label = heading?.heading ?? this.getDragInsertMenuItemDetails(action, strings.view.dragInsertMenu, false).title;
      if (valid) destination.addItem(item => item.setTitle(label).setIcon("text-cursor-input").onClick(() => {
        if (file.path !== sourcePath || file.stat.mtime !== sourceMtime || file.stat.size !== sourceSize || !this.isMenuTargetCurrent(target)) { new Notice(strings.mobile.staleTarget); return; }
        this.cancelPendingDrop();
        const operation = this.prepareOperation(file, target.editor, target.view, target.position, { x: 0, y: 0 });
        operation.menuTarget = target;
        // Keep the snapshot from entry, rather than accepting edits made before this menu.
        operation.targetContent = target.content; operation.targetDocument = target.document;
        this.pendingDrop = operation;
        void this.insertCardDragContent(operation, action, heading ? { kind: "heading", heading } : { kind: "whole" });
      }));
      destination.addItem(item => item.setTitle(`${strings.mobile.copy} · ${label}`).setIcon("copy").onClick(() => {
        void this.copyMobile(file, action, heading);
      }));
    };
    for (const action of this.getSupportedDragInsertActions(file)) {
      addAction(menu, action);
      if (this.getSettings().enableHeadingDragInsert && resolveCardFileKind(file) === "markdown") {
        const headings = this.app.metadataCache.getFileCache(file)?.headings ?? [];
        if (headings.length) menu.addItem(item => {
          item.setTitle(`${this.getDragInsertMenuItemDetails(action, strings.view.dragInsertMenu, true).title}…`).setIcon("heading").onClick(() => {
            const sections = new Menu().setUseNativeMenu(false);
            for (const heading of headings) addAction(sections, action, heading);
            sections.showAtPosition({ x: 24, y: 80 });
          });
        });
      }
    }
  }

  private async copyMobile(file: TFile, action: SupportedDragInsertAction, heading?: HeadingCache): Promise<void> {
    const path = file.path, mtime = file.stat.mtime, size = file.stat.size;
    try {
      const headings = snapshotHeadings(this.app.metadataCache.getFileCache(file)?.headings ?? []);
      const text = await buildCardInsertText(this.app, file, action, heading ? { heading, headings } : undefined);
      if (this.disposed || file.path !== path || this.app.vault.getAbstractFileByPath(path) !== file || file.stat.mtime !== mtime || file.stat.size !== size
        || heading && !headingsEqual(headings, snapshotHeadings(this.app.metadataCache.getFileCache(file)?.headings ?? []))) return;
      if (text === null) return;
      try { await navigator.clipboard.writeText(text); }
      catch {
        const modal = new Modal(this.app); modal.setTitle(this.getUiStrings().mobile.selectText);
        const field = modal.contentEl.createEl("textarea", { cls: "fce-copy-fallback" }); field.value = text; field.readOnly = true;
        modal.open(); field.focus(); field.select();
      }
    } catch { new Notice(this.getUiStrings().view.dragInsertMenu.readFailed); }
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

  private getEditorDocument(editor: Editor): unknown {
    const cm = this.getEditorCodeMirror(editor);
    return cm instanceof EditorView ? cm.state.doc : null;
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

  private openDragInsertMenu(operation: DropOperation): void {
    const strings = this.getUiStrings().view.dragInsertMenu;
    const menu = new Menu().setUseNativeMenu(false);
    for (const action of this.getSupportedDragInsertActions(operation.file)) {
      const { icon, title } = this.getDragInsertMenuItemDetails(action, strings, operation.useHeadings);
      menu.addItem((item) => {
        item.setTitle(title).setIcon(icon);
        if (operation.useHeadings) {
          const submenu = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
          if (submenu && typeof submenu.addItem === "function") {
            submenu.setUseNativeMenu(false);
            this.appendHeadingItems(submenu, operation, action);
          } else {
            item.onClick(() => this.openHeadingMenu(operation, action));
          }
        } else {
          item.onClick(() => { void this.insertCardDragContent(operation, action, { kind: "whole" }); });
        }
      });
    }
    this.showMenu(menu, operation);
  }

  private openHeadingMenu(operation: DropOperation, action: SupportedDragInsertAction): void {
    if (!this.isDropCurrent(operation)) return;
    const menu = new Menu().setUseNativeMenu(false);
    this.appendHeadingItems(menu, operation, action);
    this.showMenu(menu, operation);
  }

  private appendHeadingItems(menu: Menu, operation: DropOperation, action: SupportedDragInsertAction): void {
    const strings = this.getUiStrings().view.dragInsertMenu;
    const menuDom = getMenuDom(menu);
    menuDom?.classList.add("fce-card-drag-heading-menu");
    menu.addItem((item) => item.setTitle(strings.wholeNote).setIcon("file-text").onClick(() => {
      void this.insertCardDragContent(operation, action, { kind: "whole" });
    }));
    menu.addSeparator();
    if (!operation.headings?.length) {
      menu.addItem((item) => item.setTitle(operation.headings === null
        ? strings.headingsUnavailable : strings.noOtherSections).setDisabled(true));
      return;
    }
    // Keep menu icon/title columns aligned; the highest level in this note is depth zero.
    const baseLevel = operation.headings.reduce((level, heading) => Math.min(level, heading.level), 6);
    for (const heading of operation.headings) {
      menu.addItem((item) => {
        item.setTitle(heading.heading).setIcon(`heading-${heading.level}`).onClick(() => {
          void this.insertCardDragContent(operation, action, { kind: "heading", heading });
        });
        // Menu attaches rows only when shown, so decorate the item's detached DOM.
        const row = (item as unknown as { dom?: HTMLElement }).dom;
        row?.style.setProperty("--fce-heading-depth", String(heading.level - baseLevel));
      });
    }
  }

  private showMenu(menu: Menu, operation: DropOperation): void {
    operation.menu = menu;
    menu.onHide(() => {
      if (operation.menu === menu) {
        operation.menu = null;
        if (!operation.inserting && this.pendingDrop === operation) this.cancelPendingDrop();
      }
    });
    menu.showAtPosition(operation.menuPosition);
    const menuDom = getMenuDom(menu);
    menuDom?.classList.add("fce-card-drag-insert-menu");
  }

  private isDropCurrent(operation: DropOperation): boolean {
    return !this.disposed && this.pendingDrop === operation
      && (!operation.menuTarget || this.isMenuTargetCurrent(operation.menuTarget))
      && operation.file.path === operation.sourcePath
      && this.app.vault.getAbstractFileByPath(operation.sourcePath) === operation.file
      && operation.file.stat.mtime === operation.mtime && operation.file.stat.size === operation.size
      && (operation.info.file ?? null) === operation.targetFile
      && (operation.info.file?.path ?? null) === operation.targetPath
      && (operation.info.editor == null || operation.info.editor === operation.editor)
      && this.getEditorDocument(operation.editor) === operation.targetDocument
      && operation.editor.getValue() === operation.targetContent
      && operation.sourceEditorDocuments.every((entry) => this.getEditorDocument(entry.editor) === entry.document);
  }

  private isHeadingCurrent(operation: DropOperation): boolean {
    const cache = this.app.metadataCache.getFileCache(operation.file);
    return operation.headings !== null && cache !== null
      && headingsEqual(operation.headings, snapshotHeadings(cache.headings ?? []));
  }

  private getDragInsertMenuItemDetails(
    action: SupportedDragInsertAction,
    strings: UiStrings["view"]["dragInsertMenu"],
    useHeadings: boolean,
  ): { icon: string; title: string } {
    switch (action) {
      case "wiki":
        return { icon: "link", title: useHeadings ? strings.insertSectionLink : strings.insertWikiLink };
      case "embed":
        return { icon: "file-input", title: strings.insertEmbedLink };
      case "content":
        return { icon: "clipboard", title: useHeadings ? strings.insertSectionContent : strings.insertContent };
      case "title-content":
        return { icon: "heading-1", title: useHeadings ? strings.insertSectionTitleAndContent : strings.insertTitleAndContent };
    }
  }

  private resolveDragMenuPosition(event: DragEvent): { x: number; y: number } {
    return { x: event.clientX, y: event.clientY };
  }

  private buildOperationText(operation: DropOperation, action: SupportedDragInsertAction, target: DragInsertTarget): string | null | Promise<string | null> {
    return buildCardInsertText(this.app, operation.file, action,
      target.kind === "heading" ? { heading: target.heading, headings: operation.headings! } : undefined, operation.targetPath ?? "");
  }

  private async insertCardDragContent(
    operation: DropOperation,
    action: SupportedDragInsertAction,
    target: DragInsertTarget,
  ): Promise<void> {
    if (operation.inserting || !this.isDropCurrent(operation)) return;
    const { editor, file, position } = operation;
    operation.inserting = true;
    const strings = this.getUiStrings().view.dragInsertMenu;
    try {
      if (!this.isDragInsertActionSupported(file, action)) {
        new Notice(strings.unsupportedForFileType);
        return;
      }
      if (target.kind === "heading" && !this.isHeadingCurrent(operation)) { new Notice(strings.staleDrop); return; }
      const generated = this.buildOperationText(operation, action, target);
      const text = typeof generated === "string" || generated === null ? generated : await generated;
      if (!this.isDropCurrent(operation)) { if (operation.menuTarget) new Notice(this.getUiStrings().mobile.staleTarget); return; }
      if (text === null || (target.kind === "heading" && !this.isHeadingCurrent(operation))) {
        new Notice(text === null && target.kind === "heading" && (action === "wiki" || action === "embed") ? strings.headingLinkUnavailable : strings.staleDrop);
        return;
      }
      // Retire before replaceRange emits editor-change synchronously.
      this.pendingDrop = null;
      if (operation.menuTarget) this.menuTarget = null;
      operation.menu?.hide();
      if (text.length === 0) return;
      editor.replaceRange(text, position, undefined, "card-workspace-drag");
      const endPosition = editor.offsetToPos(editor.posToOffset(position) + text.length);
      editor.setCursor(endPosition);
    } catch {
      if (this.isDropCurrent(operation)) new Notice(strings.readFailed);
    } finally {
      if (this.pendingDrop === operation) this.cancelPendingDrop();
    }
  }
}
