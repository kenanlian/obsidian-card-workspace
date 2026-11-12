import type { App } from "obsidian";
import type { NoteInputStrings } from "../i18n/noteInput";
import { resolveTemplateName, type NoteTemplateDefinition, type QuickInputTemplateDraft } from "../note-input";
import { NoteCreationService } from "../services/NoteCreationService";
import { CompatConfirmationModal } from "../view/modals/compat-modal";
import type { NativeMarkdownEditor } from "./native-markdown-editor";
import { openQuickInputSuggest } from "./quick-input-suggest";

interface Options {
  app: App;
  editor: NativeMarkdownEditor;
  button: HTMLButtonElement;
  getTemplates(): NoteTemplateDefinition[];
  getStrings(): NoteInputStrings;
  canEdit(): boolean;
  destinationSignature(): string;
  applyDestination(draft: QuickInputTemplateDraft | null): void;
  changed(): void;
  notify(message: string): void;
}

/** One draft's template selection; never writes the default preference or a vault file. */
export class QuickInputTemplates {
  busy = false;
  private disposed = false;
  private baseline = "";
  private destinationBaseline: string;
  private selectedId: string | null = null;
  private selectedName = "";
  private popup: { dispose(): void } | null = null;
  constructor(private readonly options: Options) { this.destinationBaseline = options.destinationSignature(); }

  initialize(id: string | null): void {
    if (id) void this.apply(id, false);
    else this.paint();
  }

  refresh(locked: boolean): void {
    this.options.button.disabled = locked || this.busy;
    this.paint();
  }

  open(): void {
    if (this.disposed || this.busy || this.popup || !this.options.canEdit()) return;
    this.options.editor.flush();
    const strings = this.options.getStrings();
    const candidates = [{ id: "", name: strings.noTemplate },
      ...this.options.getTemplates().map(template => ({ id: template.id, name: resolveTemplateName(template) }))];
    const popup = openQuickInputSuggest(this.options.app, {
      candidates, multiple: false, placeholder: strings.chooseTemplate,
      emptyText: strings.templatesEmpty, noMatchText: strings.noChoiceMatches,
      selected: id => id === (this.selectedId ?? ""),
      select: id => { void this.apply(id || null, true); },
      onClose: () => {
        if (this.popup === popup) this.popup = null;
        if (!this.disposed) { this.options.changed(); this.options.editor.focus(); }
      },
    });
    this.popup = popup;
    this.options.changed();
  }

  get active(): boolean { return this.busy || this.popup !== null; }

  private async apply(id: string | null, focus: boolean): Promise<void> {
    if (this.disposed || this.busy || !this.options.canEdit()) return;
    const { editor } = this.options;
    editor.flush();
    this.busy = true;
    editor.setReadOnly(true);
    this.options.changed();
    try {
      // Unchanged template content can be switched directly. User edits require consent.
      const current = editor.getValue();
      if (((current.trim() && current !== this.baseline) || this.options.destinationSignature() !== this.destinationBaseline)
        && !await this.confirmReplacement()) return;
      if (this.disposed) return;
      const template = id ? this.options.getTemplates().find(template => template.id === id) : null;
      if (id && !template) throw new Error(this.options.getStrings().templateNotFound);
      const draft = template ? await new NoteCreationService(this.options.app).readQuickInputTemplate({ ...template }) : null;
      if (this.disposed) return;
      // A template removed/replaced during the read cannot become the selected draft source.
      if (template && !this.options.getTemplates().some(entry => entry.id === id && entry.filePath === template.filePath)) {
        throw new Error(this.options.getStrings().templateNotFound);
      }
      editor.setValue(draft?.content ?? "");
      this.options.applyDestination(draft);
      this.destinationBaseline = this.options.destinationSignature();
      this.baseline = editor.getValue();
      this.selectedId = id;
      this.selectedName = template ? resolveTemplateName(template) : "";
    } catch (error) {
      if (!this.disposed) {
        console.warn("[card-workspace] Quick input template unavailable", error);
        this.options.notify(this.options.getStrings().templateUnavailable);
      }
    } finally {
      this.busy = false;
      if (!this.disposed) {
        editor.setReadOnly(false);
        this.options.changed();
        if (focus) editor.focus();
      }
    }
  }

  private confirmReplacement(): Promise<boolean> {
    const strings = this.options.getStrings();
    return new Promise(resolve => {
      let replace = false;
      const modal = new CompatConfirmationModal(this.options.app);
      modal.setTitle(strings.replaceDraftTitle);
      modal.setContent(strings.replaceDraftBody);
      modal.addButton(button => button.setWarning().setButtonText(strings.replaceDraft).onClick(() => { replace = true; }));
      modal.addCancelButton(strings.cancel);
      const popup = { dispose: () => modal.close() };
      const onClose = modal.onClose.bind(modal);
      modal.onClose = () => {
        onClose();
        if (this.popup === popup) this.popup = null;
        resolve(replace);
      };
      this.popup = popup;
      modal.open();
    });
  }

  private paint(): void {
    const strings = this.options.getStrings();
    const label = `${strings.templates}: ${this.selectedId ? this.selectedName : strings.noTemplate}`;
    this.options.button.setAttribute("aria-label", label);
    this.options.button.setAttribute("aria-pressed", String(this.selectedId !== null));
    this.options.button.title = label;
  }

  dispose(): void {
    this.disposed = true;
    this.popup?.dispose();
    this.popup = null;
  }
}
