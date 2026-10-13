import { FuzzySuggestModal, type App } from "obsidian";

/** Menu submenu fallback for hosts without the optional submenu API. */
export class TemplateFormatPickerModal extends FuzzySuggestModal<string> {
  constructor(app: App, title: string, private readonly formats: readonly string[],
    private readonly formatExample: (format: string) => string, private readonly choose: (format: string) => void) {
    super(app); this.setTitle(title);
  }
  getItems(): string[] { return [...this.formats]; }
  getItemText(format: string): string { return `${format} — ${this.formatExample(format)}`; }
  onChooseItem(format: string): void { this.choose(format); }
}
