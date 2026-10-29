import { Modal, type App } from "obsidian";
import type { UiStrings } from "../i18n";
import { normalizeQuickInputVisibility, type NoteInputResult, type QuickInputRequest } from "../note-input";
import type { PluginSettings } from "../settings";
import { NoteCreationService, QuickInputPreflightError } from "../services/NoteCreationService";
import { QuickInputBoxesSaveError } from "../services/QuickInputSubmissionCoordinator";
import { CompatConfirmationModal } from "../view/modals/compat-modal";
import { installVisualViewport } from "../runtime/visual-viewport";
import type { NativeMarkdownEditor } from "./native-markdown-editor";
import { stripEmptyDraftFrontmatter } from "./draft-frontmatter";
import { createMobileDraftEditor } from "./mobile-editor";
import { openQuickInputSuggest } from "./quick-input-suggest";
import { QuickInputDraftSession, resolveQuickInputTarget, type QuickInputTarget } from "./quick-input-session";

interface Options {
  app: App; phone: boolean; getSettings: () => PluginSettings; getStrings: () => UiStrings;
  submit: (request: QuickInputRequest) => Promise<NoteInputResult>; notify: (message: string) => void;
  describeError?: (error: unknown) => string;
}
/** One runtime draft per plugin instance. Closing is guarded even for host Escape/back/dismiss. */
export class MobileQuickInput extends Modal {
  private editor: NativeMarkdownEditor | null = null;
  private submission: QuickInputDraftSession | null = null;
  private target: QuickInputTarget | null = null;
  private title: HTMLInputElement | null = null;
  private folderButton: HTMLButtonElement | null = null;
  private boxButton: HTMLButtonElement | null = null;
  private metadataButtons: HTMLButtonElement[] = [];
  private boxIds: string[] = [];
  private initialTitle = "";
  private popup: { dispose(): void } | null = null;
  private alive = false;
  private forceClose = false;
  private confirming: CompatConfirmationModal | null = null;
  private cleanup: Array<() => void> = [];
  private sendButton: HTMLButtonElement | null = null;
  private sequence = 0;
  private readonly prefix = `${Date.now()}-${Math.random()}`;
  constructor(private readonly options: Options) { super(options.app); }
  override onOpen(): void {
    this.alive = true;
    this.modalEl.addClass("fce-mobile-quick-input");
    this.modalEl.toggleClass("is-phone", this.options.phone);
    this.cleanup.push(installVisualViewport(this.modalEl));
    const strings = this.options.getStrings();
    this.setTitle(strings.noteInput.quickInput);
    const settings = this.options.getSettings(), config = { ...settings.quickInput };
    const visibility = normalizeQuickInputVisibility(settings.quickInputVisibility);
    const session = new QuickInputDraftSession({ config, now: new Date() });
    this.submission = session;
    const root = this.contentEl.createDiv({ cls: "fce-mobile-quick-input-body" });
    const body = root.createDiv({ cls: "fce-quick-input-editor" });
    const footer = root.createDiv({ cls: "fce-quick-input-footer" });
    const button = (cls: string, label: string, visible: boolean, action: () => void) => {
      const element = footer.createEl("button", { cls, text: label, attr: { type: "button" } });
      element.hidden = !visible;
      element.addEventListener("click", action);
      return element;
    };
    this.folderButton = button("fce-quick-input-folder", strings.noteInput.rootFolder, visibility.folder, () => this.openChoices("folder"));
    this.boxButton = button("fce-quick-input-boxes", strings.noteInput.boxes, visibility.boxes, () => this.openChoices("boxes"));
    this.metadataButtons = [button("fce-quick-input-tags", strings.noteInput.addTags, visibility.tags, () => this.addMetadata("tags")),
      button("fce-quick-input-property", strings.noteInput.addProperty, visibility.properties, () => this.addMetadata("property"))];
    button("fce-quick-input-cancel", strings.noteInput.cancel, true, () => this.close());
    this.sendButton = button("mod-cta", strings.noteInput.send, true, () => { void this.send(); });
    const compositionStart = () => { session.composing = true; this.refresh(); };
    const compositionEnd = () => { session.composing = false; this.refresh(); };
    root.addEventListener("compositionstart", compositionStart); root.addEventListener("compositionend", compositionEnd);
    this.cleanup.push(() => { root.removeEventListener("compositionstart", compositionStart); root.removeEventListener("compositionend", compositionEnd); });
    this.sendButton.disabled = true;
    try {
      this.editor = createMobileDraftEditor({ app: this.app, container: body, initialValue: "", placeholder: strings.noteInput.inputPlaceholder,
        onChange: () => this.refresh(), onModEnter: event => {
          if (event.defaultPrevented || event.isComposing || session.composing || this.popup) return;
          event.preventDefault(); void this.send();
        } });
      if (visibility.title) {
        this.initialTitle = new NoteCreationService(this.app).defaultQuickInputTitle(session.context.now);
        session.context.target = { title: this.initialTitle, folderPath: config.folderPath };
        const title = body.ownerDocument.createElement("input"); this.title = title;
        title.className = "inline-title fce-quick-input-title";
        title.placeholder = this.initialTitle; title.setAttribute("aria-label", strings.noteInput.title);
        this.editor.mountTitle(title);
        let timer: number | undefined;
        const settle = () => { window.clearTimeout(timer); this.updateTarget(); };
        title.addEventListener("input", () => {
          if (session.pending || session.request) return;
          session.context.target!.title = title.value.trim() || this.initialTitle;
          window.clearTimeout(timer); timer = window.setTimeout(settle, 250);
        });
        title.addEventListener("blur", settle);
        title.addEventListener("keydown", event => {
          if (event.key === "Enter" && !event.isComposing && !session.composing) {
            event.preventDefault(); if (event.ctrlKey || event.metaKey) void this.send(); else this.editor?.focus();
          }
        });
        this.cleanup.push(() => window.clearTimeout(timer));
      }
      for (const event of ["create", "delete", "rename"] as const) {
        if (typeof this.app.vault.on === "function") {
          const ref = this.app.vault.on(event as "create", () => this.updateTarget());
          this.cleanup.push(() => this.app.vault.offref(ref));
        }
      }
      this.updateTarget();
      // Opening is an explicit user action; later publications never focus the editor.
      this.editor.focus();
    } catch (error) { this.options.notify(String(error)); }
  }
  private updateTarget(): void {
    const session = this.submission;
    if (!this.alive || !session || session.pending || session.request) return;
    const target = resolveQuickInputTarget(this.app, session.context);
    if (target.mode !== this.target?.mode) this.editor?.flush();
    this.target = target;
    this.editor?.setPropertiesReadOnly(target.mode === "append");
    this.refresh();
  }
  private refresh(): void {
    const session = this.submission, editor = this.editor, target = this.target;
    if (!this.sendButton || !session) return;
    const strings = this.options.getStrings().noteInput, locked = session.pending || !!session.request;
    this.sendButton.disabled = !editor || session.pending || session.composing || !stripEmptyDraftFrontmatter(editor.getValue()).trim() || !target?.valid;
    this.sendButton.textContent = session.pending ? strings.sending : target?.mode === "append" ? strings.appendNote : strings.send;
    if (this.title) this.title.disabled = locked;
    if (this.folderButton) {
      this.folderButton.disabled = locked;
      this.folderButton.textContent = target?.folderPath || strings.rootFolder;
      this.folderButton.classList.toggle("is-invalid", !target?.valid);
    }
    if (this.boxButton) {
      this.boxButton.disabled = locked;
      this.boxButton.textContent = this.boxIds.length ? `${strings.boxes} (${this.boxIds.length})` : strings.boxes;
    }
    for (const button of this.metadataButtons) button.disabled = locked || target?.mode === "append";
    this.contentEl.setAttribute("aria-busy", String(session.pending));
  }
  private addMetadata(kind: "tags" | "property"): void {
    if (!this.submission || this.submission.pending || this.submission.request || this.target?.mode === "append") return;
    if (!this.editor?.addMetadata(kind)) this.options.notify(this.options.getStrings().noteInput.sourcePropertiesHint);
  }
  private openChoices(kind: "folder" | "boxes"): void {
    const session = this.submission;
    if (!session || session.pending || session.request || session.composing || this.popup) return;
    this.editor?.flush();
    const strings = this.options.getStrings().noteInput;
    const candidates = kind === "folder" ? [{ id: "", name: strings.rootFolder },
      ...(this.app.vault.getAllFolders?.() ?? []).filter(folder => folder.path && folder.path !== "/")
        .map(folder => ({ id: folder.path, name: folder.path })).sort((a, b) => a.name.localeCompare(b.name))]
      : this.options.getSettings().boxes.map(box => ({ id: box.id, name: box.name }));
    if (kind === "boxes") { this.boxIds = this.boxIds.filter(id => candidates.some(choice => choice.id === id)); this.refresh(); }
    const popup = openQuickInputSuggest(this.app, { candidates, multiple: kind === "boxes", emptyText: strings.boxesEmpty, noMatchText: strings.noChoiceMatches,
      placeholder: kind === "folder" ? strings.chooseFolderPlaceholder : strings.chooseBoxesPlaceholder,
      selected: id => kind === "folder" ? this.target?.folderPath === id : this.boxIds.includes(id),
      select: id => {
        if (!this.alive || session.pending || session.request) return;
        if (kind === "folder") {
          if (session.context.target) session.context.target.folderPath = id; else session.context.config.folderPath = id;
          this.updateTarget();
        } else { this.boxIds = this.boxIds.includes(id) ? this.boxIds.filter(entry => entry !== id) : [...this.boxIds, id]; this.refresh(); }
      }, onClose: () => { if (this.popup === popup) this.popup = null; if (this.alive) this.editor?.focus(); },
    });
    this.popup = popup;
  }
  private askDuplicateTitle(path: string): Promise<"append" | "number" | null> {
    const strings = this.options.getStrings().noteInput;
    return new Promise(resolve => {
      let choice: "append" | "number" | null = null;
      const modal = new CompatConfirmationModal(this.app);
      modal.setTitle(strings.duplicateTitleHeading);
      modal.setContent(strings.duplicateTitleBody(path, this.submission?.context.config.insertPosition === "start" ? strings.insertBodyStart : strings.insertEnd));
      modal.addButton(button => button.setCta().setButtonText(strings.appendNote).onClick(() => { choice = "append"; }));
      modal.addButton(button => button.setButtonText(strings.createNumberedNote).onClick(() => { choice = "number"; }));
      modal.addCancelButton(strings.cancel);
      const popup = { dispose: () => modal.close() };
      const onClose = modal.onClose.bind(modal);
      modal.onClose = () => { onClose(); if (this.popup === popup) this.popup = null; if (this.alive) this.editor?.focus(); resolve(choice); };
      this.popup = popup; modal.open();
    });
  }
  private async send(): Promise<void> {
    const session = this.submission, editor = this.editor;
    if (!this.alive || !session || !editor || session.pending || session.composing || this.popup) return;
    const strings = this.options.getStrings().noteInput;
    if (!session.request) editor.flush();
    if (!stripEmptyDraftFrontmatter(editor.getValue()).trim()) return;
    const latest = resolveQuickInputTarget(this.app, session.context);
    if (!session.request && latest.valid && latest.mode !== this.target?.mode) {
      this.updateTarget(); this.options.notify(strings.targetModeChanged); return;
    }
    if (!latest.valid) { this.options.notify(strings.invalidQuickInputConfig); return; }
    let duplicateTitle = session.request?.config.duplicateTitle ?? session.context.config.duplicateTitle;
    if (duplicateTitle === "ask") {
      const choice = latest.existing && latest.path ? await this.askDuplicateTitle(latest.path) : "number";
      if (!choice || !this.alive || session.pending || session.request) return;
      duplicateTitle = choice;
    }
    const request = session.freeze(editor, `${this.prefix}-${++this.sequence}`, duplicateTitle, latest.existing, this.boxIds);
    if (!request) return;
    this.refresh();
    try {
      const result = await this.options.submit(request);
      if (!this.alive) return;
      this.forceClose = true; this.close(); this.options.notify(strings.sent(result.file.path));
    } catch (error) {
      if (!this.alive) return;
      if (error instanceof QuickInputPreflightError) {
        session.request = null; session.pending = false; editor.setReadOnly(false); this.updateTarget();
      }
      this.options.notify(error instanceof QuickInputBoxesSaveError ? strings.savedBoxFailure(error.path)
        : strings.sendFailed(this.options.describeError?.(error) ?? (error instanceof Error ? error.message : String(error))));
    } finally { session.pending = false; if (this.alive) this.refresh(); }
  }
  override close(): void {
    if (this.forceClose || !this.alive) { super.close(); return; }
    const strings = this.options.getStrings();
    if (this.submission?.pending) { this.options.notify(strings.mobile.wait); return; }
    if (stripEmptyDraftFrontmatter(this.editor?.getValue() ?? "").trim() || this.title?.value.trim() || this.boxIds.length) {
      if (this.confirming || this.popup) return;
      const modal = new CompatConfirmationModal(this.app); this.confirming = modal;
      modal.setTitle(strings.mobile.discardTitle);
      modal.addButton(button => button.setButtonText(strings.mobile.discard).setWarning().onClick(() => { this.confirming = null; this.forceClose = true; this.close(); }));
      modal.addCancelButton(strings.mobile.keepEditing);
      const originalClose = modal.onClose.bind(modal);
      modal.onClose = () => { originalClose(); this.confirming = null; };
      modal.open(); return;
    }
    super.close();
  }
  override onClose(): void {
    this.alive = false;
    this.popup?.dispose(); this.popup = null;
    this.confirming?.close(); this.confirming = null;
    for (const stop of this.cleanup.splice(0)) stop();
    this.editor?.dispose(); this.editor = null; this.submission = null; this.sendButton = null;
    this.title = null; this.folderButton = this.boxButton = null; this.metadataButtons = []; this.boxIds = []; this.target = null;
    this.contentEl.empty();
  }
  dispose(): void { this.forceClose = true; this.close(); }
  focusDraft(): void { this.editor?.focus(); }
  isOpen(): boolean { return this.alive; }
}
