import { Modal, Setting, type App, type ButtonComponent } from "obsidian";

export interface FormModalLabels {
  cancel: string;
  submit: string;
  submitting: string;
}

export abstract class FormModal extends Modal {
  private submitting = false;

  protected constructor(app: App, private readonly labels: FormModalLabels) {
    super(app);
  }

  protected abstract handleSubmit(): Promise<boolean>;
  protected abstract renderBody(): void;

  protected isSubmitting(): boolean {
    return this.submitting;
  }

  protected isSubmitDisabled(): boolean {
    return false;
  }

  protected render(): void {
    this.contentEl.empty();
    this.renderBody();
    this.renderActions();
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  protected renderActions(): void {
    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText(this.labels.cancel).onClick(() => {
          this.close();
        });
      })
      .addButton((button: ButtonComponent) => {
        button
          .setCta()
          .setButtonText(this.submitting ? this.labels.submitting : this.labels.submit)
          .onClick(() => {
            void this.submit();
          });
        button.setDisabled(this.isSubmitDisabled());
      });
  }

  protected async submit(): Promise<void> {
    if (this.submitting) {
      return;
    }

    this.submitting = true;
    this.render();
    try {
      if (await this.handleSubmit()) {
        this.close();
      }
    } finally {
      this.submitting = false;
      if (this.contentEl.isConnected) {
        this.render();
      }
    }
  }
}
