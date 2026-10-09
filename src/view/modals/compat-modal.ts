import * as obsidian from "obsidian";
import { ButtonComponent, Modal, requireApiVersion, type App } from "obsidian";

/** The shared surface used by plugin dialogs; no newer runtime exports are required. */
export interface CompatConfirmationButton {
  setButtonText(text: string): this;
  setCta(): this;
  setWarning(): this;
  setDisabled(disabled: boolean): this;
  onClick(handler: (event: MouseEvent) => unknown): this;
}

export interface CompatConfirmationModal extends Modal {
  addClass(cls: string): this;
  addButton(configure: (button: CompatConfirmationButton) => unknown): this;
  addCancelButton(text?: string): this;
}

class LegacyConfirmationModal extends Modal implements CompatConfirmationModal {
  private readonly footerEl: HTMLElement;
  private closeRevision = 0;

  constructor(app: App) {
    super(app);
    this.addClass("fce-compat-modal");
    this.footerEl = this.modalEl.createDiv({ cls: "fce-compat-modal__footer" });
  }

  addClass(cls: string): this {
    this.modalEl.addClass(cls);
    return this;
  }

  addButton(configure: (button: CompatConfirmationButton) => unknown): this {
    const button = new ButtonComponent(this.footerEl);
    // Keep the public control methods, but match ConfirmationButton's asynchronous
    // close contract and suppress duplicate clicks while its handler is pending.
    let pending = false;
    const registerClick = button.onClick.bind(button);
    button.onClick = (handler) => {
      registerClick(async (event) => {
        if (pending || button.buttonEl.disabled || !this.contentEl.isConnected) {
          return;
        }
        pending = true;
        const revision = this.closeRevision;
        try {
          const keepOpen = await handler(event);
          if (!keepOpen && revision === this.closeRevision && this.contentEl.isConnected) {
            this.close();
          }
        } catch (error) {
          console.warn("Card Workspace: confirmation action failed", error);
        } finally {
          pending = false;
        }
      });
      return button;
    };
    configure(button);
    return this;
  }

  addCancelButton(text = "Cancel"): this {
    return this.addButton((button) => button.setButtonText(text).onClick(() => undefined));
  }

  override close(): void {
    this.closeRevision += 1;
    super.close();
  }
}

// Use an explicit version guard for review tooling, then check the export itself.
// Native dialogs (and their focus/keyboard behavior) remain untouched on 1.13+.
export const CompatConfirmationModal: new (app: App) => CompatConfirmationModal =
  requireApiVersion("1.13.0") && "ConfirmationModal" in obsidian && typeof obsidian.ConfirmationModal === "function"
    ? obsidian.ConfirmationModal
    : LegacyConfirmationModal;
