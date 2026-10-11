import { SettingGroup, setIcon, type App } from "obsidian";
import type { BulkMetadataStrings } from "../../i18n";
import type { BulkMetadataSnapshot, MetadataCandidate } from "../bulk-metadata";
import { attachMetadataInputSuggest, onPlainEnter } from "../metadata-input-suggest";
import { FormModal } from "./FormModal";

export interface BulkMetadataModalOptions {
  strings: BulkMetadataStrings;
  snapshot: BulkMetadataSnapshot;
  targetCount: number;
}

export interface MetadataPickerOptions {
  heading: string;
  candidates: readonly MetadataCandidate[];
  selected: string[];
  normalize: (name: string) => string;
  allowNew: boolean;
  onChange: () => void;
  tone?: "add" | "remove";
}

export abstract class BulkMetadataModal extends FormModal {
  protected readonly strings: BulkMetadataStrings;
  protected readonly snapshot: BulkMetadataSnapshot;
  private suggestions = new Set<ReturnType<typeof attachMetadataInputSuggest>>();
  private locks = new Set<(locked: boolean) => void>();
  private targetEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private validationEl: HTMLElement | null = null;
  protected constructor(app: App, protected readonly options: BulkMetadataModalOptions) {
    super(app, { cancel: options.strings.cancel, submit: options.strings.apply, submitting: options.strings.applying });
    this.strings = options.strings;
    this.snapshot = options.snapshot;
    this.useScrollableLayout();
    this.addClass("fce-bulk-metadata-modal");
  }
  protected override render(): void {
    this.disposeSuggestions();
    this.locks.clear();
    super.render();
  }
  protected renderIntro(description?: string): void {
    const intro = this.contentEl.createDiv({ cls: "fce-modal-intro" });
    this.targetEl = intro.createDiv({ cls: "fce-modal-intro__summary", text: this.strings.targetCount(this.options.targetCount) });
    if (description) intro.createDiv({ cls: "fce-modal-intro__description", text: description });
    if (this.snapshot.incomplete) this.contentEl.createDiv({ cls: "fce-bulk-metadata-notice", text: this.strings.incomplete });
  }
  /** Validation and apply results sit next to the footer, where the user acts on them. */
  protected renderFeedback(): void {
    const feedback = this.contentEl.createDiv({ cls: "fce-bulk-metadata-feedback" });
    this.validationEl = feedback.createDiv({ cls: "fce-bulk-metadata-validation", attr: { role: "status" } });
    this.statusEl = feedback.createDiv({ cls: "fce-bulk-metadata-result", attr: { role: "status" } });
  }
  protected updateValidation(valid: boolean, hasDraft: boolean): void {
    this.validationEl?.setText(!valid && hasDraft ? this.strings.invalid : "");
    this.refreshFooter();
  }
  showResult(text: string, remainingCount: number): void {
    this.statusEl?.setText(text);
    this.statusEl?.toggleClass("is-error", remainingCount > 0);
    this.targetEl?.setText(this.strings.targetCount(remainingCount));
  }
  protected attachSuggest(input: HTMLInputElement, candidates: () => readonly MetadataCandidate[], onSelect: (name: string) => void) {
    const handle = attachMetadataInputSuggest(this.app, input, candidates, (name) => { if (!this.isSubmitting()) onSelect(name); });
    const owned = {
      ...handle,
      dispose: () => { handle.dispose(); this.suggestions.delete(owned); },
    };
    this.suggestions.add(owned);
    return owned;
  }
  /** Enter confirms one draft item. Never submits the modal. */
  protected confirmOnEnter(input: HTMLInputElement, isOpen: () => boolean, confirm: () => void): void {
    onPlainEnter(input, isOpen, () => { if (!this.isSubmitting()) confirm(); });
  }
  protected createIconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "clickable-icon", attr: { type: "button", "aria-label": label } });
    setIcon(button, icon);
    button.addEventListener("click", () => { if (!this.isSubmitting()) onClick(); });
    return button;
  }
  protected paintChips<T extends string | number>(chips: HTMLElement, items: readonly T[], onRemove: (item: T, index: number) => void): void {
    chips.empty();
    items.forEach((item, index) => {
      const chip = chips.createEl("button", { cls: "fce-metadata-chip", attr: { type: "button", "aria-label": `${this.strings.remove}: ${item}` } });
      chip.createSpan({ cls: "fce-metadata-chip__label", text: String(item) });
      setIcon(chip.createSpan({ cls: "fce-metadata-chip__remove" }), "x");
      chip.addEventListener("click", () => { if (!this.isSubmitting()) onRemove(item, index); });
    });
  }
  protected renderPicker({ heading, candidates, selected, normalize, allowNew, onChange, tone }: MetadataPickerOptions): void {
    const group = new SettingGroup(this.contentEl).setHeading(heading);
    group.addSetting((setting) => {
      setting.setClass("fce-metadata-picker");
      let input!: HTMLInputElement;
      const chips = setting.settingEl.createDiv({ cls: "fce-metadata-chips" });
      if (tone) chips.addClass(`mod-${tone}`);
      const paint = () => this.paintChips(chips, selected, (_name, index) => { selected.splice(index, 1); paint(); onChange(); });
      const commit = (raw: string) => {
        const candidate = candidates.find((item) => normalize(item.name) === normalize(raw));
        const name = candidate?.name ?? (allowNew ? raw.trim() : "");
        if (!name || !normalize(name)) return;
        if (!selected.some((item) => normalize(item) === normalize(name))) selected.push(name);
        input.value = ""; paint(); onChange();
      };
      setting.addText((text) => {
        input = text.inputEl;
        input.setAttribute("aria-label", heading);
        text.setPlaceholder(heading);
        const handle = this.attachSuggest(input, () => candidates.filter((item) => !selected.some((name) => normalize(name) === normalize(item.name))), commit);
        this.confirmOnEnter(input, handle.isOpen, () => commit(input.value));
      });
      this.createIconButton(setting.controlEl, "plus", this.strings.add, () => commit(input.value));
      paint();
    });
  }
  protected registerLock(lock: (locked: boolean) => void): () => void {
    this.locks.add(lock);
    return () => this.locks.delete(lock);
  }
  protected override onSubmittingChanged(submitting: boolean): void {
    this.locks.forEach((lock) => lock(submitting));
    if (submitting) this.suggestions.forEach((handle) => handle.close());
    this.contentEl.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button").forEach((el) => { el.disabled = submitting; });
  }
  private disposeSuggestions(): void { this.suggestions.forEach((handle) => handle.dispose()); this.suggestions.clear(); }
  override onClose(): void { this.disposeSuggestions(); this.locks.clear(); super.onClose(); }
}
