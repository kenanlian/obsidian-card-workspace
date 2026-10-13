import { Setting, type App } from "obsidian";
import { attachFolderInputSuggest } from "../folder-input-suggest";
import { onPlainEnter } from "../metadata-input-suggest";
import type { NoteInputStrings } from "../../i18n/noteInput";
import { FormModal } from "./FormModal";

export class NewTemplateModal extends FormModal {
  private name = "";
  private folderPath = "";
  private suggest: ReturnType<typeof attachFolderInputSuggest> | null = null;
  private inputs: HTMLInputElement[] = [];
  constructor(app: App, private readonly strings: NoteInputStrings,
    private readonly create: (name: string, folderPath: string) => Promise<boolean>,
    private readonly closed: () => void = () => undefined) {
    super(app, { cancel: strings.cancel, submit: strings.create, submitting: strings.create });
  }
  protected renderBody(): void {
    this.setTitle(this.strings.newTemplate);
    this.suggest?.dispose(); this.inputs = [];
    new Setting(this.contentEl).setName(this.strings.templateName).setDesc(this.strings.templateNameDesc).addText((text) => {
      this.inputs.push(text.inputEl);
      text.setValue(this.name).onChange((value) => { this.name = value; this.refreshFooter(); });
      this.submitOnEnter(text.inputEl);
    });
    new Setting(this.contentEl).setName(this.strings.targetFolder).setDesc(this.strings.targetFolderDesc).addText((text) => {
      this.inputs.push(text.inputEl);
      text.setValue(this.folderPath).setPlaceholder(this.strings.rootFolder).onChange((value) => { this.folderPath = value; });
      const suggest = attachFolderInputSuggest(this.app, text.inputEl, (path) => {
        this.folderPath = path; text.setValue(path);
      });
      this.suggest = suggest;
      onPlainEnter(text.inputEl, suggest.isOpen, () => this.requestSubmit());
    });
  }
  protected onSubmittingChanged(submitting: boolean): void {
    if (submitting) this.suggest?.close();
    this.inputs.forEach((input) => { input.disabled = submitting; });
  }
  onClose(): void { this.suggest?.dispose(); this.suggest = null; this.inputs = []; super.onClose(); this.closed(); }
  protected isSubmitDisabled(): boolean { return this.name.trim().length === 0; }
  protected handleSubmit(): Promise<boolean> { return this.create(this.name, this.folderPath); }
}
