import { Setting, type App } from "obsidian";
import type { NoteInputStrings } from "../../i18n/noteInput";
import { attachFolderInputSuggest } from "../folder-input-suggest";
import { onPlainEnter } from "../metadata-input-suggest";
import { FormModal } from "./FormModal";

/** Edit the display name or destination without renaming the template file. */
export class TemplateFieldModal extends FormModal {
  private value: string;
  private input: HTMLInputElement | null = null;
  private suggest: ReturnType<typeof attachFolderInputSuggest> | null = null;
  constructor(app: App, private readonly strings: NoteInputStrings, private readonly kind: "name" | "folder",
    initialValue: string, private readonly save: (value: string) => Promise<boolean>) {
    super(app, { cancel: strings.cancel, submit: strings.apply, submitting: strings.applying });
    this.value = initialValue;
  }
  protected renderBody(): void {
    this.suggest?.dispose();
    this.setTitle(this.kind === "name" ? this.strings.renameTemplate : this.strings.targetFolder);
    new Setting(this.contentEl).setName(this.kind === "name" ? this.strings.templateName : this.strings.targetFolder)
      .setDesc(this.kind === "name" ? this.strings.templateNameDesc : this.strings.targetFolderDesc).addText((text) => {
        this.input = text.inputEl;
        text.setValue(this.value).onChange((value) => { this.value = value; this.refreshFooter(); });
        if (this.kind === "name") this.submitOnEnter(text.inputEl);
        else {
          text.setPlaceholder(this.strings.rootFolder);
          const suggest = attachFolderInputSuggest(this.app, text.inputEl, (path) => { this.value = path; text.setValue(path); });
          this.suggest = suggest;
          onPlainEnter(text.inputEl, suggest.isOpen, () => this.requestSubmit());
        }
      });
  }
  protected isSubmitDisabled(): boolean { return this.kind === "name" && !this.value.trim(); }
  protected onSubmittingChanged(submitting: boolean): void {
    if (submitting) this.suggest?.close();
    if (this.input) this.input.disabled = submitting;
  }
  protected handleSubmit(): Promise<boolean> { return this.save(this.value.trim()); }
  onClose(): void { this.suggest?.dispose(); this.suggest = null; this.input = null; super.onClose(); }
}
