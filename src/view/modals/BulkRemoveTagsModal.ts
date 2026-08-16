import type { App } from "obsidian";
import { FormModal } from "./FormModal";

export interface BulkRemovableTagOption {
  normalizedTag: string;
  label: string;
}

export interface BulkRemoveTagsModalOptions {
  titleText: string;
  emptyMessage: string;
  selectionSummary: (count: number) => string;
  cancelText: string;
  submitText: string;
  submittingText: string;
  tagOptions: BulkRemovableTagOption[];
}

export class BulkRemoveTagsModal extends FormModal {
  private readonly titleText: string;
  private readonly emptyMessage: string;
  private readonly selectionSummary: (count: number) => string;
  private readonly tagOptions: BulkRemovableTagOption[];
  private readonly onSubmit: (tags: string[]) => Promise<boolean>;
  private readonly selectedTags = new Set<string>();

  constructor(app: App, options: BulkRemoveTagsModalOptions, onSubmit: (tags: string[]) => Promise<boolean>) {
    super(app, { cancel: options.cancelText, submit: options.submitText, submitting: options.submittingText });
    this.titleText = options.titleText;
    this.emptyMessage = options.emptyMessage;
    this.selectionSummary = options.selectionSummary;
    this.tagOptions = options.tagOptions;
    this.onSubmit = onSubmit;
  }

  protected override isSubmitDisabled(): boolean {
    return this.isSubmitting() || this.selectedTags.size === 0;
  }

  protected renderBody(): void {
    this.setTitle(this.titleText);
    if (this.tagOptions.length === 0) {
      this.contentEl.createEl("p", { text: this.emptyMessage });
      return;
    }
    this.contentEl.createEl("p", { text: this.selectionSummary(this.selectedTags.size) });
    const checkboxGrid = this.contentEl.createDiv({ cls: "fce-tag-checkbox-grid" });
    for (const tagOption of this.tagOptions) {
      const optionEl = checkboxGrid.createEl("label", { cls: "fce-tag-checkbox-option" });
      const checkboxEl = optionEl.createEl("input", { cls: "fce-tag-checkbox-input", type: "checkbox" });
      checkboxEl.checked = this.selectedTags.has(tagOption.normalizedTag);
      checkboxEl.addEventListener("change", () => {
        if (checkboxEl.checked) {
          this.selectedTags.add(tagOption.normalizedTag);
        } else {
          this.selectedTags.delete(tagOption.normalizedTag);
        }
        if (this.contentEl.isConnected) {
          this.render();
        }
      });
      optionEl.createEl("span", { cls: "fce-tag-checkbox-label", text: tagOption.label });
    }
  }

  protected async handleSubmit(): Promise<boolean> {
    if (this.selectedTags.size === 0) {
      return false;
    }
    return await this.onSubmit(Array.from(this.selectedTags));
  }
}
