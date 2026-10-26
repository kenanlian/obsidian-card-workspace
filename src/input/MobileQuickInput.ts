import { Modal, type App } from "obsidian";
import type { UiStrings } from "../i18n";
import type { NoteInputResult, NoteTemplateDefinition, QuickInputRequest } from "../note-input";
import type { PluginSettings } from "../settings";
import { CompatConfirmationModal } from "../view/modals/compat-modal";
import { installVisualViewport } from "../runtime/visual-viewport";
import type { NativeMarkdownEditor } from "./native-markdown-editor";
import { createMobileDraftEditor } from "./mobile-editor";
import { QuickInputDraftSession, resolveQuickInputTarget } from "./quick-input-session";

interface Options {
  app: App; phone: boolean; getSettings: () => PluginSettings; getStrings: () => UiStrings;
  prepareTemplate: (template: NoteTemplateDefinition, now: Date) => Promise<string>;
  submit: (request: QuickInputRequest) => Promise<NoteInputResult>; notify: (message: string) => void;
}
/** One runtime draft per plugin instance. Closing is guarded even for host Escape/back/dismiss. */
export class MobileQuickInput extends Modal {
  private editor: NativeMarkdownEditor | null = null;
  private submission: QuickInputDraftSession | null = null;
  private initial = "";
  private revision = 0;
  private alive = false;
  private forceClose = false;
  private confirming: CompatConfirmationModal | null = null;
  private cleanup: Array<() => void> = [];
  private sendButton: HTMLButtonElement | null = null;
  private readonly prefix = `${Date.now()}-${Math.random()}`;
  constructor(private readonly options: Options) { super(options.app); }
  override onOpen(): void {
    this.alive = true;
    const generation = ++this.revision;
    this.modalEl.addClass("fce-mobile-quick-input");
    this.modalEl.toggleClass("is-phone", this.options.phone);
    this.cleanup.push(installVisualViewport(this.modalEl));
    const strings = this.options.getStrings();
    this.setTitle(strings.noteInput.quickInput);
    const settings = this.options.getSettings(), config = { ...settings.quickInput };
    const template = settings.noteTemplates.find(entry => entry.id === config.templateId);
    const session = new QuickInputDraftSession({ config, template: template ? { ...template } : null, now: new Date() }, !config.templateId);
    this.submission = session;
    const root = this.contentEl.createDiv({ cls: "fce-mobile-quick-input-body" });
    const body = root.createDiv({ cls: "fce-quick-input-editor" });
    const footer = root.createDiv({ cls: "fce-quick-input-footer" });
    const target = resolveQuickInputTarget(this.app, session.context);
    footer.createDiv({ cls: "fce-quick-input-destination", text: target.valid ? target.folderPath || strings.noteInput.rootFolder : strings.noteInput.destinationUnavailable });
    const cancel = footer.createEl("button", { text: strings.noteInput.cancel });
    cancel.addEventListener("click", () => this.close());
    const send = footer.createEl("button", { cls: "mod-cta", text: strings.noteInput.send }); this.sendButton = send;
    send.addEventListener("click", () => { void this.send(); });
    const compositionStart = () => { session.composing = true; this.refresh(); };
    const compositionEnd = () => { session.composing = false; this.refresh(); };
    root.addEventListener("compositionstart", compositionStart); root.addEventListener("compositionend", compositionEnd);
    this.cleanup.push(() => { root.removeEventListener("compositionstart", compositionStart); root.removeEventListener("compositionend", compositionEnd); });
    send.disabled = true;
    void (async () => {
      try {
        const text = template && target.valid ? await this.options.prepareTemplate(template, session.context.now) : "";
        if (!this.alive || generation !== this.revision) return;
        session.templateReady = !config.templateId || !!template && target.valid;
        this.initial = text;
        this.editor = createMobileDraftEditor({ app: this.app, container: body, initialValue: text, placeholder: strings.noteInput.inputPlaceholder,
          onChange: () => this.refresh(), onModEnter: event => {
            if (event.defaultPrevented || event.isComposing || session.composing) return;
            event.preventDefault(); void this.send();
          } });
        this.refresh();
        // Opening is an explicit user action; later publications never focus the editor.
        this.editor.focus();
      } catch (error) { if (this.alive) this.options.notify(String(error)); }
    })();
  }
  private refresh(): void {
    const session = this.submission, editor = this.editor;
    if (!this.sendButton || !session) return;
    this.sendButton.disabled = !editor || session.pending || session.composing || !session.templateReady || !editor.getValue().trim() || !resolveQuickInputTarget(this.app, session.context).valid;
    this.sendButton.textContent = session.pending ? this.options.getStrings().noteInput.sending : this.options.getStrings().noteInput.send;
    this.contentEl.setAttribute("aria-busy", String(session.pending));
  }
  private async send(): Promise<void> {
    const session = this.submission, editor = this.editor;
    if (!this.alive || !session || !editor || session.pending || session.composing) return;
    if (!resolveQuickInputTarget(this.app, session.context).valid) { this.options.notify(this.options.getStrings().noteInput.invalidQuickInputConfig); return; }
    const request = session.freeze(editor, this.prefix);
    if (!request) return;
    this.refresh();
    try {
      const result = await this.options.submit(request);
      if (!this.alive) return;
      this.forceClose = true; this.close(); this.options.notify(this.options.getStrings().noteInput.sent(result.file.path));
    } catch (error) {
      if (this.alive) this.options.notify(this.options.getStrings().noteInput.sendFailed(error instanceof Error ? error.message : String(error)));
    } finally { session.pending = false; if (this.alive) this.refresh(); }
  }
  override close(): void {
    if (this.forceClose || !this.alive) { super.close(); return; }
    const strings = this.options.getStrings();
    if (this.submission?.pending) { this.options.notify(strings.mobile.wait); return; }
    if (this.editor?.getValue().trim() && this.editor.getValue() !== this.initial) {
      if (this.confirming) return;
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
    this.alive = false; ++this.revision;
    this.confirming?.close(); this.confirming = null;
    for (const stop of this.cleanup.splice(0)) stop();
    this.editor?.dispose(); this.editor = null; this.submission = null; this.sendButton = null; this.contentEl.empty();
  }
  dispose(): void { this.forceClose = true; this.close(); }
  focusDraft(): void { this.editor?.focus(); }
  isOpen(): boolean { return this.alive; }
}
