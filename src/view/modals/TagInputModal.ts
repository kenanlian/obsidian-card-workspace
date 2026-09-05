import { Notice, Setting, type App } from "obsidian";
import type { UiStrings } from "../../i18n";
import { normalizeTagForFrontmatter } from "../note-tag-ops";
import { FormModal } from "./FormModal";

export type TagMutationMode = "add" | "remove" | "rename";

export interface TagInputModalOptions {
  mode: TagMutationMode;
  strings: UiStrings["view"]["tagInput"];
  /** Pre-fills the input (rename flow opens with the current tag path). */
  initialValue?: string;
}

export class TagInputModal extends FormModal {
  private readonly strings: UiStrings["view"]["tagInput"];
  private readonly mode: TagMutationMode;
  private readonly initialValue: string;
  private readonly onSubmit: (tag: string) => Promise<boolean>;
  private tagValue = "";

  constructor(app: App, options: TagInputModalOptions, onSubmit: (tag: string) => Promise<boolean>) {
    super(app, {
      cancel: options.strings.cancel,
      submit:
        options.mode === "add"
          ? options.strings.add
          : options.mode === "remove"
            ? options.strings.remove
            : options.strings.rename,
      submitting:
        options.mode === "add"
          ? options.strings.adding
          : options.mode === "remove"
            ? options.strings.removing
            : options.strings.renaming,
    });
    this.mode = options.mode;
    this.initialValue = options.initialValue ?? "";
    this.tagValue = this.initialValue;
    this.strings = options.strings;
    this.onSubmit = onSubmit;
  }

  protected renderBody(): void {
    this.setTitle(
      this.mode === "add"
        ? this.strings.addTitle
        : this.mode === "remove"
          ? this.strings.removeTitle
          : this.strings.renameTitle,
    );
    new Setting(this.contentEl)
      .setName(this.mode === "rename" ? this.strings.renameNewTagLabel : this.strings.tagLabel)
      .addText((text) => {
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
