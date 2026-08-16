import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  buttons: [] as Array<{ text: string; cta: boolean; disabled: boolean; onClick: (() => void) | null }>,
}));

vi.mock("obsidian", () => {
  class MockContentEl {
    isConnected = true;
    emptyCount = 0;

    empty(): void {
      this.emptyCount += 1;
      mockState.buttons.length = 0;
    }
  }

  class Modal {
    app: unknown;
    contentEl = new MockContentEl();

    constructor(app: unknown) {
      this.app = app;
    }

    open(): void {
      (this as unknown as { onOpen?: () => void }).onOpen?.();
    }

    close(): void {
      this.contentEl.isConnected = false;
      (this as unknown as { onClose?: () => void }).onClose?.();
    }
  }

  class Setting {
    addButton(configure: (button: unknown) => void): this {
      const record = { text: "", cta: false, disabled: false, onClick: null as (() => void) | null };
      const chain = {
        setButtonText: (text: string) => {
          record.text = text;
          return chain;
        },
        setCta: () => {
          record.cta = true;
          return chain;
        },
        setDisabled: (disabled: boolean) => {
          record.disabled = disabled;
          return chain;
        },
        onClick: (handler: () => void) => {
          record.onClick = handler;
          return chain;
        },
      };
      configure(chain);
      mockState.buttons.push(record);
      return this;
    }
  }

  return { Modal, Setting };
});

const { FormModal } = await import("./FormModal");

interface Deferred {
  promise: Promise<boolean>;
  resolve: (value: boolean) => void;
}

function createDeferred(): Deferred {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

class TestFormModal extends FormModal {
  renderBodyCount = 0;
  handleSubmitCount = 0;
  closeCount = 0;
  pending: Deferred | null = null;
  submitDisabled = false;
  error: unknown = null;

  constructor(private result: boolean | "pending") {
    super({} as never, { cancel: "Cancel", submit: "Save", submitting: "Saving" });
  }

  protected renderBody(): void {
    this.renderBodyCount += 1;
  }

  protected override isSubmitDisabled(): boolean {
    return this.submitDisabled;
  }

  protected async handleSubmit(): Promise<boolean> {
    this.handleSubmitCount += 1;
    if (this.error !== null) {
      throw this.error;
    }
    if (this.result === "pending") {
      this.pending = createDeferred();
      return await this.pending.promise;
    }
    return this.result;
  }

  override close(): void {
    this.closeCount += 1;
    super.close();
  }

  triggerSubmit(): Promise<void> {
    return this.submit();
  }
}

function getCtaButton() {
  return mockState.buttons.find((button) => button.cta);
}

describe("FormModal", () => {
  beforeEach(() => {
    mockState.buttons.length = 0;
  });

  it("runs handleSubmit once while a submit is still in flight", async () => {
    const modal = new TestFormModal("pending");
    modal.open();
    const first = modal.triggerSubmit();
    const second = modal.triggerSubmit();
    expect(modal.handleSubmitCount).toBe(1);
    modal.pending?.resolve(true);
    await Promise.all([first, second]);
    expect(modal.handleSubmitCount).toBe(1);
  });

  it("does not close on false and restores the submit state", async () => {
    const modal = new TestFormModal(false);
    modal.open();
    await modal.triggerSubmit();
    expect(modal.closeCount).toBe(0);
    expect(modal.contentEl.isConnected).toBe(true);
    expect(getCtaButton()?.text).toBe("Save");
  });

  it("closes exactly once when handleSubmit returns true", async () => {
    const modal = new TestFormModal(true);
    modal.open();
    await modal.triggerSubmit();
    expect(modal.closeCount).toBe(1);
  });

  it("propagates the original error, stays open, and permits retry", async () => {
    const modal = new TestFormModal(true);
    const failure = new Error("submit failed");
    modal.error = failure;
    modal.open();
    await expect(modal.triggerSubmit()).rejects.toBe(failure);
    expect(modal.closeCount).toBe(0);
    expect(getCtaButton()?.text).toBe("Save");
    modal.error = null;
    await modal.triggerSubmit();
    expect(modal.handleSubmitCount).toBe(2);
    expect(modal.closeCount).toBe(1);
  });

  it("does not render in finally after the modal disconnects", async () => {
    const modal = new TestFormModal(true);
    modal.open();
    const rendersBeforeSubmit = modal.renderBodyCount;
    await modal.triggerSubmit();
    expect(modal.renderBodyCount).toBe(rendersBeforeSubmit + 1);
  });
});
