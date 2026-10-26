import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { TFolder } from "obsidian";
import { getUiStrings } from "../i18n";
import { DEFAULT_SETTINGS } from "../settings";
import { installObsidianDomHelpers } from "../__mocks__/obsidian-dom";
import { MobileQuickInput } from "./MobileQuickInput";

const state = vi.hoisted(() => ({ confirmations: [] as Array<{ discard: () => unknown; cancel: () => void }> }));
vi.mock("./native-markdown-editor", () => ({ createNativeMarkdownEditor: () => { throw new Error("Native capabilities absent"); } }));
vi.mock("obsidian", async importOriginal => {
  const actual = await importOriginal<typeof import("../__mocks__/obsidian")>();
  class Modal {
    contentEl = document.createElement("div"); modalEl = document.createElement("div");
    constructor(readonly app: unknown) { this.modalEl.append(this.contentEl); }
    setTitle() { return this; } onOpen() {} onClose() {}
    open() { document.body.append(this.modalEl); this.onOpen(); }
    close() { this.onClose(); this.modalEl.remove(); }
  }
  return { ...actual, Modal };
});
vi.mock("../view/modals/compat-modal", () => ({ CompatConfirmationModal: class {
  discard = () => {}; onClose = () => {};
  setTitle() {} addCancelButton() {}
  addButton(configure: (button: unknown) => void) {
    const button = { setButtonText() { return this; }, setWarning() { return this; }, onClick: (callback: () => void) => { this.discard = callback; } }; configure(button);
  }
  open() { state.confirmations.push({ discard: this.discard, cancel: () => this.onClose() }); }
  close() { this.onClose(); }
} }));
let modal: MobileQuickInput;
let submit: ReturnType<typeof vi.fn<(request: unknown) => Promise<{ file: { path: string } }>>>, notify: ReturnType<typeof vi.fn<(message: string) => void>>;
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(async () => {
  installObsidianDomHelpers(document); state.confirmations = [];
  Object.assign(HTMLElement.prototype, { addClass(this: HTMLElement, ...names: string[]) { this.classList.add(...names); }, toggleClass(this: HTMLElement, name: string, value: boolean) { this.classList.toggle(name, value); }, empty(this: HTMLElement) { this.replaceChildren(); } });
  const folder = Object.assign(new TFolder(), { path: "" });
  submit = vi.fn(async () => ({ file: { path: "new.md" } })); notify = vi.fn();
  modal = new MobileQuickInput({ app: { vault: { getRoot: () => folder } } as never, phone: true,
    getSettings: () => structuredClone(DEFAULT_SETTINGS), getStrings: () => getUiStrings("zh"),
    prepareTemplate: async () => "", submit: request => submit(request) as never, notify });
  modal.open(); await tick();
});
afterEach(() => { modal.dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); });
const field = () => document.querySelector<HTMLTextAreaElement>("textarea")!;
const send = () => document.querySelector<HTMLButtonElement>("button.mod-cta")!;
function text(value: string) { field().value = value; field().dispatchEvent(new Event("input", { bubbles: true })); }
describe("mobile draft Modal", () => {
  it("uses full Markdown source when native editor is missing and closes an empty draft immediately", () => {
    expect(field()).not.toBeNull(); expect(document.activeElement).toBe(field()); expect(send().disabled).toBe(true);
    modal.close(); expect(modal.isOpen()).toBe(false);
  });
  it("keeps a modified nonempty draft until compatible confirmation is accepted", () => {
    text("---\ntags: [中文]\n---\n草稿"); modal.close();
    expect(modal.isOpen()).toBe(true); expect(state.confirmations).toHaveLength(1);
    state.confirmations[0].cancel(); expect(field().value).toContain("草稿");
    modal.close(); state.confirmations[1].discard(); expect(modal.isOpen()).toBe(false);
  });
  it("blocks composition sends and duplicate pending sends, preserving the frozen request for retry", async () => {
    text("一次写入");
    field().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); send().click(); expect(submit).not.toHaveBeenCalled();
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true, bubbles: true })); expect(submit).not.toHaveBeenCalled();
    field().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    let reject!: (error: unknown) => void;
    submit.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    send().click(); send().click(); expect(submit).toHaveBeenCalledOnce(); expect(field().readOnly).toBe(true);
    const request = submit.mock.calls[0][0]; modal.close(); expect(modal.isOpen()).toBe(true); expect(notify).toHaveBeenCalledWith(getUiStrings("zh").mobile.wait);
    reject(new Error("write failed")); await tick(); expect(modal.isOpen()).toBe(true); expect(field().readOnly).toBe(true);
    send().click(); await tick(); expect(submit).toHaveBeenCalledTimes(2); expect(submit.mock.calls[1][0]).toBe(request); expect(modal.isOpen()).toBe(false);
  });
  it("never focuses on ordinary draft edits or pending UI updates and removes viewport listeners", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus"), remove = vi.spyOn(window, "removeEventListener");
    text("edit"); expect(focus).not.toHaveBeenCalled(); modal.dispose();
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
