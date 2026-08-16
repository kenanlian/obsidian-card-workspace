import { Modal, Notice, Setting, type App } from "obsidian";
import type { UiStrings } from "../../i18n";

export interface BoxNameModalOptions {
  strings: UiStrings;
  title: string;
  initialName: string;
  submitLabel: string;
  previewText?: string;
  onSubmit: (name: string) => Promise<void>;
}

/** Lightweight name-entry modal for creating/renaming/saving card boxes. */
export class BoxNameModal extends Modal {
  private readonly options: BoxNameModalOptions;
  private nextName: string;
  private submitting = false;

  constructor(app: App, options: BoxNameModalOptions) {
    super(app);
    this.options = options;
    this.nextName = options.initialName;
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const strings = this.options.strings.box;
    this.setTitle(this.options.title);
    this.contentEl.empty();

    if (this.options.previewText) {
      this.contentEl.createEl("p", {
        text: this.options.previewText,
        cls: "fce-box-name__preview",
      });
    }

    new Setting(this.contentEl).setName(strings.nameLabel).addText((text) => {
      text
        .setValue(this.nextName)
        .setPlaceholder(strings.namePlaceholder)
        .onChange((value) => {
          this.nextName = value;
        });
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this.submit();
        }
      });
    });

    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText(strings.cancel).onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        button
          .setCta()
          .setButtonText(this.options.submitLabel)
          .onClick(() => {
            void this.submit();
          });
      });
  }

  private async submit(): Promise<void> {
    if (this.submitting) {
      return;
    }

    const name = this.nextName.trim();
    if (name.length === 0) {
      new Notice(this.options.strings.box.emptyNameError);
      return;
    }

    this.submitting = true;
    try {
      await this.options.onSubmit(name);
      this.close();
    } finally {
      this.submitting = false;
    }
  }
}
