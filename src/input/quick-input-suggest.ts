import { FuzzySuggestModal, setIcon, type App, type FuzzyMatch, type Instruction } from "obsidian";

export interface QuickInputChoice { id: string; name: string }

/** The host's command-palette prompt, opened in the focused draft window; candidates are snapshotted on open. */
class QuickInputChoiceModal extends FuzzySuggestModal<QuickInputChoice> {
  private readonly checks = new Map<string, HTMLElement>();

  constructor(app: App, private readonly options: QuickInputSuggestOptions) {
    super(app);
    this.setPlaceholder(options.placeholder);
    if (options.instructions) this.setInstructions(options.instructions);
    this.emptyStateText = options.candidates.length ? options.noMatchText : options.emptyText;
    // Closing returns focus to the draft body, never to the footer button that opened the prompt.
    this.shouldRestoreSelection = false;
  }

  getItems(): QuickInputChoice[] { return this.options.candidates; }
  getItemText(item: QuickInputChoice): string { return item.name; }

  renderSuggestion(match: FuzzyMatch<QuickInputChoice>, el: HTMLElement): void {
    el.addClass("fce-quick-input-choice-row");
    const check = el.createSpan({ cls: "fce-quick-input-choice-check" });
    this.checks.set(match.item.id, check);
    this.paint(match.item.id);
    super.renderSuggestion(match, el.createSpan({ cls: "fce-quick-input-choice-name" }));
  }

  selectSuggestion(match: FuzzyMatch<QuickInputChoice>, evt: MouseEvent | KeyboardEvent): void {
    if (!this.options.multiple) { super.selectSuggestion(match, evt); return; }
    this.options.select(match.item.id);
    this.paint(match.item.id);
  }

  onChooseItem(item: QuickInputChoice): void { this.options.select(item.id); }

  onClose(): void {
    super.onClose();
    this.options.onClose();
  }

  private paint(id: string): void {
    const check = this.checks.get(id);
    if (!check) return;
    const selected = this.options.selected(id);
    check.empty();
    if (selected) setIcon(check, "check");
    check.parentElement?.setAttribute("aria-selected", String(selected));
  }
}

export interface QuickInputSuggestOptions {
  candidates: QuickInputChoice[];
  placeholder: string;
  instructions?: Instruction[];
  emptyText: string;
  noMatchText: string;
  selected(id: string): boolean;
  /** Multiple choices toggle in place and keep the prompt open until Escape. */
  multiple: boolean;
  select(id: string): void;
  onClose(): void;
}

export function openQuickInputSuggest(app: App, options: QuickInputSuggestOptions): { dispose(): void } {
  const modal = new QuickInputChoiceModal(app, options);
  modal.open();
  return { dispose: () => modal.close() };
}
