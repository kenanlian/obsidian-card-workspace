import { Setting, type App } from "obsidian";
import type { UiStrings } from "../../i18n";
import { FormModal } from "./FormModal";

export interface RenameFileModalOptions {
  initialName: string;
  strings: UiStrings["view"]["rename"];
}

export class RenameFileModal extends FormModal {
  private readonly strings: UiStrings["view"]["rename"];
  private readonly initialName: string;
  private readonly onSubmit: (nextName: string) => Promise<boolean>;
  private nextName: string;

  constructor(app: App, options: RenameFileModalOptions, onSubmit: (nextName: string) => Promise<boolean>) {
    super(app, { cancel: options.strings.cancel, submit: options.strings.rename, submitting: options.strings.renaming });
    this.initialName = options.initialName;
    this.strings = options.strings;
    this.nextName = options.initialName;
    this.onSubmit = onSubmit;
  }

  protected renderBody(): void {
    this.setTitle(this.strings.title);
    new Setting(this.contentEl).setName(this.strings.nameLabel).addText((text) => {
      text.setValue(this.nextName).setPlaceholder(this.initialName).onChange((value) => {
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
