import { Notice, Setting, type App } from "obsidian";
import type { UiStrings } from "../../i18n";
import { normalizeTagForFrontmatter } from "../note-ops";
import { FormModal } from "./FormModal";

export type TagMutationMode = "add" | "remove";

export interface TagInputModalOptions {
  mode: TagMutationMode;
  strings: UiStrings["view"]["tagInput"];
}

export class TagInputModal extends FormModal {
  private readonly strings: UiStrings["view"]["tagInput"];
  private readonly mode: TagMutationMode;
  private readonly onSubmit: (tag: string) => Promise<boolean>;
  private tagValue = "";

  constructor(app: App, options: TagInputModalOptions, onSubmit: (tag: string) => Promise<boolean>) {
    super(app, {
      cancel: options.strings.cancel,
      submit: options.mode === "add" ? options.strings.add : options.strings.remove,
      submitting: options.mode === "add" ? options.strings.adding : options.strings.removing,
    });
    this.mode = options.mode;
    this.strings = options.strings;
    this.onSubmit = onSubmit;
  }

  protected renderBody(): void {
    this.setTitle(this.mode === "add" ? this.strings.addTitle : this.strings.removeTitle);
    new Setting(this.contentEl).setName(this.strings.tagLabel).addText((text) => {
      text.setValue(this.tagValue).setPlaceholder(this.strings.tagPlaceholder).onChange((value) => {
        this.tagValue = value;
      });
    });
  }

  protected async handleSubmit(): Promise<boolean> {
    const normalizedTag = normalizeTagForFrontmatter(this.tagValue);
    if (normalizedTag.length === 0) {
      new Notice(this.strings.invalidTag);
      return false;
    }
    return await this.onSubmit(normalizedTag);
  }
}
