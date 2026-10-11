import { SettingGroup, type App } from "obsidian";
import type { BulkMetadataStrings } from "../../i18n";
import type { BulkMetadataSnapshot, MetadataCandidate } from "../bulk-metadata";
import { attachMetadataInputSuggest } from "../metadata-input-suggest";
import { FormModal } from "./FormModal";

export interface BulkMetadataModalOptions {
  strings: BulkMetadataStrings;
  snapshot: BulkMetadataSnapshot;
  targetCount: number;
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
  protected renderIntro(): void {
    this.targetEl = this.contentEl.createEl("p", { text: this.strings.targetCount(this.options.targetCount) });
    if (this.snapshot.incomplete) this.contentEl.createEl("p", { cls: "mod-warning", text: this.strings.incomplete });
    this.statusEl = this.contentEl.createEl("p", { attr: { role: "status" } });
    this.validationEl = this.contentEl.createEl("p", { cls: "mod-warning", attr: { role: "status" } });
  }
  protected updateValidation(valid: boolean, hasDraft: boolean): void {
    this.validationEl?.setText(!valid && hasDraft ? this.strings.invalid : "");
    this.refreshFooter();
  }
  showResult(text: string, remainingCount: number): void {
    this.statusEl?.setText(text);
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
    let composing = false;
    input.addEventListener("compositionstart", () => { composing = true; });
    input.addEventListener("compositionend", () => { composing = false; });
    input.addEventListener("keydown", (event) => {
      if (!composing && event.key === "Enter" && !event.isComposing && event.keyCode !== 229 && !event.defaultPrevented && !isOpen()) {
        event.preventDefault();
        event.stopPropagation();
        if (!this.isSubmitting()) confirm();
      }
    });
  }
  protected renderPicker(heading: string, candidates: readonly MetadataCandidate[], selected: string[], normalize: (name: string) => string, allowNew: boolean, onChange: () => void): void {
    const group = new SettingGroup(this.contentEl).setHeading(heading);
    group.addSetting((setting) => {
      setting.setName(heading);
      const chips = setting.settingEl.createDiv({ cls: "fce-metadata-chips" });
      let input: HTMLInputElement;
      const paint = () => {
        chips.empty();
        for (const name of selected) {
          const button = chips.createEl("button", { text: `${name} ×`, attr: { type: "button", "aria-label": `${this.strings.remove}: ${name}` } });
          button.addEventListener("click", () => {
            if (this.isSubmitting()) return;
            selected.splice(selected.indexOf(name), 1); paint(); onChange();
          });
        }
      };
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
        const handle = this.attachSuggest(input, () => candidates.filter((item) => !selected.some((name) => normalize(name) === normalize(item.name))), commit);
        this.confirmOnEnter(input, handle.isOpen, () => commit(input.value));
      }).addButton((button) => button.setButtonText(this.strings.add).onClick(() => { if (!this.isSubmitting()) commit(input.value); }));
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
