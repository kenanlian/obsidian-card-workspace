import { Modal, Setting, type App } from "obsidian";

export interface BulkActionConfirmModalOptions {
  title: string;
  message: string;
  cancelButtonText: string;
  confirmButtonText: string;
}

export class BulkActionConfirmModal extends Modal {
  private readonly titleText: string;
  private readonly message: string;
  private readonly cancelButtonText: string;
  private readonly confirmButtonText: string;
  private readonly onDecision: (confirmed: boolean) => void;
  private resolved = false;

  constructor(app: App, options: BulkActionConfirmModalOptions, onDecision: (confirmed: boolean) => void) {
    super(app);
    this.titleText = options.title;
    this.message = options.message;
    this.cancelButtonText = options.cancelButtonText;
    this.confirmButtonText = options.confirmButtonText;
    this.onDecision = onDecision;
  }

  onOpen(): void {
    this.setTitle(this.titleText);
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText(this.cancelButtonText).onClick(() => this.resolve(false));
      })
      .addButton((button) => {
        button.setButtonText(this.confirmButtonText).setWarning().onClick(() => this.resolve(true));
      });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.onDecision(false);
    }
  }

  private resolve(confirmed: boolean): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.close();
    this.onDecision(confirmed);
  }
}
