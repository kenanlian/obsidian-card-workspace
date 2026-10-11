import type { App } from "obsidian";
import { CompatConfirmationModal, type CompatConfirmationButton } from "./compat-modal";

export interface FormModalLabels {
  cancel: string;
  submit: string;
  submitting: string;
}

/**
 * Draft-and-submit dialog on top of the native or compatible confirmation footer.
 *
 * The footer is built once; submit state is patched onto the existing button,
 * so typing in the body is never interrupted by a re-render. Subclasses own
 * `renderBody()` and call `render()` only when the body itself must change.
 */
export abstract class FormModal extends CompatConfirmationModal {
  private submitting = false;
  private lifecycleRevision = 0;
  private submitButton: CompatConfirmationButton | null = null;

  protected constructor(app: App, private readonly labels: FormModalLabels) {
    super(app);
    this.addClass("fce-modal");
    this.addButton((button) => {
      this.submitButton = button;
      button
        .setCta()
        .setButtonText(labels.submit)
        .onClick(() => {
          void this.submit().catch((error) => {
            console.warn("Card Workspace: form submission failed", error);
          });
          // Truthy keeps the dialog open; `submit()` closes it once the work succeeds.
          return true;
        });
    });
    this.addCancelButton(labels.cancel);
  }

  protected abstract handleSubmit(): Promise<boolean>;
  protected abstract renderBody(): void;

  protected isSubmitting(): boolean {
    return this.submitting;
  }

  protected onSubmittingChanged(_submitting: boolean): void {}

  protected isSubmitDisabled(): boolean {
    return false;
  }

  /** Tall dialogs opt in to the scrolling body with a pinned footer. */
  protected useScrollableLayout(): void {
    this.addClass("mod-scrollable-content");
  }

  protected render(): void {
    this.contentEl.empty();
    this.renderBody();
    this.refreshFooter();
  }

  protected refreshFooter(): void {
    const button = this.submitButton;
    if (button === null) {
      return;
    }
    button.setButtonText(this.submitting ? this.labels.submitting : this.labels.submit);
    button.setDisabled(this.submitting || this.isSubmitDisabled());
  }

  protected submitOnEnter(inputEl: HTMLInputElement): void {
    inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        void this.submit().catch((error) => {
          console.warn("Card Workspace: form submission failed", error);
        });
      }
    });
  }

  onOpen(): void {
    this.lifecycleRevision += 1;
    this.submitting = false;
    this.render();
  }

  onClose(): void {
    this.lifecycleRevision += 1;
    this.submitting = false;
    super.onClose();
    this.contentEl.empty();
  }

  protected async submit(): Promise<void> {
    if (this.submitting || this.isSubmitDisabled() || !this.contentEl.isConnected) {
      return;
    }

    this.submitting = true;
    this.onSubmittingChanged(true);
    const revision = this.lifecycleRevision;
    this.refreshFooter();
    try {
      if (await this.handleSubmit() && revision === this.lifecycleRevision && this.contentEl.isConnected) {
        this.close();
      }
    } finally {
      if (revision === this.lifecycleRevision) {
        this.submitting = false;
        this.onSubmittingChanged(false);
        if (this.contentEl.isConnected) {
          this.refreshFooter();
        }
      }
    }
  }
}
