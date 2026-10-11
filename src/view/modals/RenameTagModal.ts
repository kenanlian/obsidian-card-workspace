import { Setting, type App } from "obsidian";
import type { UiStrings } from "../../i18n";
import type { MetadataCandidate } from "../bulk-metadata";
import { attachMetadataInputSuggest, onPlainEnter } from "../metadata-input-suggest";
import { normalizeTagForFrontmatter } from "../note-tag-ops";
import { tagPathIsOrUnder } from "../tag-tree";
import { FormModal } from "./FormModal";

export interface RenameTagModalOptions {
  strings: UiStrings["view"]["tagRename"];
  /** Normalized tag path being renamed. */
  from: string;
  candidates: readonly MetadataCandidate[];
}

export class RenameTagModal extends FormModal {
  private nextTag: string;
  private inputEl: HTMLInputElement | null = null;
  private suggest: ReturnType<typeof attachMetadataInputSuggest> | null = null;

  constructor(app: App, private readonly options: RenameTagModalOptions, private readonly onSubmit: (tag: string) => Promise<boolean>) {
    super(app, { cancel: options.strings.cancel, submit: options.strings.rename, submitting: options.strings.renaming });
    this.nextTag = options.from;
  }

  protected override isSubmitDisabled(): boolean {
    const tag = normalizeTagForFrontmatter(this.nextTag);
    return tag.length === 0 || tag === this.options.from;
  }

  protected renderBody(): void {
    const { strings, from, candidates } = this.options;
    this.disposeSuggest();
    this.setTitle(strings.title);
    const intro = this.contentEl.createDiv({ cls: "fce-modal-intro" });
    intro.createDiv({ cls: "fce-modal-intro__summary", text: strings.summary(from) });
    intro.createDiv({ cls: "fce-modal-intro__description", text: strings.mergeHint });
    // The renamed subtree is never a meaningful target.
    const targets = candidates.filter((candidate) => !tagPathIsOrUnder(candidate.name, from));
    new Setting(this.contentEl).setName(strings.newTagLabel).addText((text) => {
      const input = text.inputEl;
      this.inputEl = input;
      text.setValue(this.nextTag).setPlaceholder(strings.placeholder).onChange((value) => {
        this.nextTag = value;
        this.refreshFooter();
      });
      const suggest = attachMetadataInputSuggest(this.app, input, () => targets, (name) => {
        if (this.isSubmitting()) return;
        this.nextTag = name;
        text.setValue(name);
        this.refreshFooter();
      });
      this.suggest = suggest;
      onPlainEnter(input, suggest.isOpen, () => this.requestSubmit());
    });
  }

  protected override onSubmittingChanged(submitting: boolean): void {
    if (submitting) this.suggest?.close();
    if (this.inputEl) this.inputEl.disabled = submitting;
  }

  protected async handleSubmit(): Promise<boolean> {
    return await this.onSubmit(normalizeTagForFrontmatter(this.nextTag));
  }

  override onClose(): void {
    this.disposeSuggest();
    super.onClose();
  }

  private disposeSuggest(): void {
    this.suggest?.dispose();
    this.suggest = null;
  }
}
