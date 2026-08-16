import { Setting, type App } from "obsidian";
import type { UiStrings } from "../../i18n";
import { FormModal } from "./FormModal";

export interface FolderNameModalOptions {
  title: string;
  submitLabel: string;
  submittingLabel: string;
  initialName?: string;
}

export class CreateFolderModal extends FormModal {
  private readonly strings: UiStrings["view"]["folderManagement"];
  private readonly options: FolderNameModalOptions;
  private readonly onSubmit: (nextName: string) => Promise<boolean>;
  private nextName: string;

  constructor(app: App, strings: UiStrings["view"]["folderManagement"], options: FolderNameModalOptions, onSubmit: (nextName: string) => Promise<boolean>) {
    super(app, { cancel: strings.cancel, submit: options.submitLabel, submitting: options.submittingLabel });
    this.strings = strings;
    this.options = options;
    this.onSubmit = onSubmit;
    this.nextName = options.initialName ?? "";
  }

  protected renderBody(): void {
    this.setTitle(this.options.title);
    new Setting(this.contentEl).setName(this.strings.nameLabel).addText((text) => {
      text.setValue(this.nextName).onChange((value) => {
        this.nextName = value;
      });
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this.submit();
        }
      });
    });
  }

  protected async handleSubmit(): Promise<boolean> {
    return await this.onSubmit(this.nextName);
  }
}
