import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { TFile, TFolder } from "obsidian";
import { getUiStrings } from "../i18n";
import { QuickInputPreflightError } from "../services/NoteCreationService";
import { DEFAULT_SETTINGS, type PluginSettings } from "../settings";
import { installObsidianDomHelpers } from "../__mocks__/obsidian-dom";
import { MobileQuickInput } from "./MobileQuickInput";

const state = vi.hoisted(() => ({ confirmations: [] as Array<{ discard: () => unknown; cancel: () => void; choose: (index: number) => void }>,
  picker: null as import("./quick-input-suggest").QuickInputSuggestOptions | null }));
vi.mock("./quick-input-suggest", () => ({ openQuickInputSuggest: (_app: unknown, options: import("./quick-input-suggest").QuickInputSuggestOptions) => {
  state.picker = options; return { dispose: () => options.onClose() };
} }));
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
  return { ...actual, Modal, MarkdownView: class {}, moment: (await import("moment")).default };
});
vi.mock("../view/modals/compat-modal", () => ({ CompatConfirmationModal: class {
  discard = () => {}; onClose = () => {}; actions: Array<() => void> = [];
  setTitle() {} setContent() {} addCancelButton() {}
  addButton(configure: (button: unknown) => void) {
    const button = { setButtonText() { return this; }, setWarning() { return this; }, setCta() { return this; }, onClick: (callback: () => void) => { this.discard = callback; this.actions.push(callback); } }; configure(button);
  }
  open() { state.confirmations.push({ discard: this.discard, cancel: () => this.onClose(), choose: index => { this.actions[index](); this.onClose(); } }); }
  close() { this.onClose(); }
} }));
let modal: MobileQuickInput;
let settings: PluginSettings;
let files: Map<string, TFile | TFolder>;
let readTemplate: ReturnType<typeof vi.fn<(file: TFile) => Promise<string>>>;
let submit: ReturnType<typeof vi.fn<(request: unknown) => Promise<{ file: { path: string } }>>>, notify: ReturnType<typeof vi.fn<(message: string) => void>>;
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(async () => {
  installObsidianDomHelpers(document); state.confirmations = []; state.picker = null; settings = structuredClone(DEFAULT_SETTINGS); files = new Map();
  Object.assign(HTMLElement.prototype, { addClass(this: HTMLElement, ...names: string[]) { this.classList.add(...names); }, toggleClass(this: HTMLElement, name: string, value: boolean) { this.classList.toggle(name, value); }, empty(this: HTMLElement) { this.replaceChildren(); } });
  readTemplate = vi.fn(async () => "---\ntags: [template]\n---\n模板 {{date:YYYY}}");
  const folder = Object.assign(new TFolder(), { path: "" });
  submit = vi.fn(async () => ({ file: { path: "new.md" } })); notify = vi.fn();
  modal = new MobileQuickInput({ app: { workspace: { getActiveViewOfType: () => null, getLeavesOfType: () => [] }, vault: { cachedRead: (file: TFile) => readTemplate(file), getRoot: () => folder, getAbstractFileByPath: (path: string) => files.get(path) ?? null } } as never, phone: true,
    getSettings: () => settings, getStrings: () => getUiStrings("zh"),
    submit: request => submit(request) as never, notify });
  modal.open(); await tick();
});
afterEach(() => { modal.dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); });
const field = () => document.querySelector<HTMLTextAreaElement>("textarea")!;
const send = () => document.querySelector<HTMLButtonElement>("button.mod-cta")!;
function text(value: string) { field().value = value; field().dispatchEvent(new Event("input", { bubbles: true })); }
describe("mobile draft Modal", () => {
  it("uses full Markdown source when native editor is missing and closes an empty draft immediately", () => {
    expect(document.querySelector<HTMLButtonElement>(".fce-quick-input-template")!.hidden).toBe(true);
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

describe("merged mobile quick-input contracts", () => {
  const title = () => document.querySelector<HTMLInputElement>(".fce-quick-input-title")!;
  const inputTitle = (value: string) => {
    title().value = value; title().dispatchEvent(new Event("input", { bubbles: true }));
    title().dispatchEvent(new Event("blur"));
  };
  it("resolves the default ask policy to numbering for a new note and captures the title", async () => {
    inputTitle("移动草稿"); text("正文"); send().click(); await tick();
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ target: { title: "移动草稿", folderPath: "" },
      config: expect.objectContaining({ duplicateTitle: "number" }), expectedMode: "create" }));
  });
  it("asks before appending to a same-name note and freezes metadata through retry", async () => {
    files.set("已有.md", Object.assign(new TFile(), { path: "已有.md", extension: "md" }));
    inputTitle("已有"); text("追加正文");
    send().click(); expect(submit).not.toHaveBeenCalled(); expect(state.confirmations).toHaveLength(1);
    state.confirmations[0].choose(0); await tick();
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ duplicateTitle: "append" }), expectedMode: "append" }));
  });
  it("snapshots the selected folder and boxes with the note request", async () => {
    files.set("Inbox", Object.assign(new TFolder(), { path: "Inbox" }));
    settings.boxes = [{ id: "box", name: "收件箱" } as never];
    document.querySelector<HTMLButtonElement>(".fce-quick-input-folder")!.click();
    state.picker!.select("Inbox"); state.picker!.onClose();
    document.querySelector<HTMLButtonElement>(".fce-quick-input-boxes")!.click();
    state.picker!.select("box"); state.picker!.onClose();
    text("内容"); send().click(); await tick();
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ target: expect.objectContaining({ folderPath: "Inbox" }), boxIds: ["box"] }));
  });
  it("unlocks a rejected preflight while uncertain writes keep their identity", async () => {
    text("草稿"); submit.mockRejectedValueOnce(new QuickInputPreflightError("missing-box"));
    send().click(); await tick(); const first = submit.mock.calls[0][0];
    expect(field().readOnly).toBe(false); expect(title().disabled).toBe(false);
    inputTitle("可修改"); send().click(); await tick();
    expect(submit.mock.calls[1][0]).not.toBe(first);
    expect(submit.mock.calls[1][0]).toMatchObject({ target: { title: "可修改" } });
  });
  it("keeps cancel and send in its own header and paints the target in the toolbar", () => {
    const header = document.querySelector(".fce-mobile-quick-input-header")!;
    expect(header.querySelector(".fce-quick-input-cancel")).not.toBeNull();
    expect(header.contains(send())).toBe(true);
    expect(send().querySelector(".fce-quick-input-send-label")!.textContent).toBe("发送");
    files.set("Inbox", Object.assign(new TFolder(), { path: "Inbox" }));
    settings.boxes = [{ id: "box", name: "收件箱" } as never];
    const folder = document.querySelector<HTMLButtonElement>(".fce-quick-input-folder")!;
    expect(folder.querySelector(".fce-quick-input-choice-name")!.textContent).toBe("仓库根目录");
    folder.click(); state.picker!.select("Inbox"); state.picker!.onClose();
    expect(folder.querySelector(".fce-quick-input-choice-name")!.textContent).toBe("Inbox");
    const count = document.querySelector<HTMLElement>(".fce-quick-input-boxes .fce-quick-input-choice-count")!;
    expect(count.hidden).toBe(true);
    document.querySelector<HTMLButtonElement>(".fce-quick-input-boxes")!.click(); state.picker!.select("box"); state.picker!.onClose();
    expect(count.hidden).toBe(false); expect(count.textContent).toBe("1");
  });
  it("does not send an empty frontmatter skeleton", () => {
    text("---\n\n---\n"); expect(send().disabled).toBe(true);
  });
});


describe("mobile quick input templates", () => {
  beforeEach(async () => {
    settings.quickInputVisibility.template = true;
    const app = modal.app; modal.dispose();
    modal = new MobileQuickInput({ app, phone: true, getSettings: () => settings, getStrings: () => getUiStrings("zh"), submit: request => submit(request) as never, notify });
    modal.open(); await tick();
    expect(document.querySelector<HTMLButtonElement>(".fce-quick-input-template")!.hidden).toBe(false);
  });
  function register() {
    settings.noteTemplates = [{ id: "daily", name: "日记", filePath: "Templates/Daily {{date:YYYY}}.md", targetFolderPath: "Inbox", dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm" }];
    files.set("Inbox", Object.assign(new TFolder(), { path: "Inbox" }));
    files.set(settings.noteTemplates[0].filePath, Object.assign(new TFile(), { path: settings.noteTemplates[0].filePath, basename: "Daily {{date:YYYY}}", extension: "md" }));
  }
  const templateButton = () => document.querySelector<HTMLButtonElement>(".fce-quick-input-template")!;
  it("selects a full template into source fallback and submits its title and folder", async () => {
    register(); templateButton().click();
    expect(state.picker!.candidates).toEqual([{ id: "", name: "不使用模板" }, { id: "daily", name: "日记" }]);
    state.picker!.onClose(); state.picker!.select("daily"); await tick(); await tick();
    expect(field().value).toMatch(/模板 \d{4}/);
    const title = document.querySelector<HTMLInputElement>(".fce-quick-input-title")!.value;
    expect(title).toMatch(/^Daily \d{4}$/);
    expect(document.querySelector(".fce-quick-input-folder")!.textContent).toBe("Inbox");
    expect(settings.quickInputTemplateId).toBeNull();
    send().click(); await tick();
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("tags: [template]"), target: { title, folderPath: "Inbox" } }));
  });
  it("loads a configured default and clears it for only this draft", async () => {
    register(); settings.quickInputTemplateId = "daily";
    const app = modal.app; modal.dispose();
    modal = new MobileQuickInput({ app, phone: true, getSettings: () => settings, getStrings: () => getUiStrings("zh"), submit: request => submit(request) as never, notify });
    modal.open(); await tick(); await tick();
    expect(field().value).toContain("模板");
    templateButton().click(); state.picker!.onClose(); state.picker!.select(""); await tick();
    expect(field().value).toBe(""); expect(settings.quickInputTemplateId).toBe("daily");
    expect(document.querySelector<HTMLInputElement>(".fce-quick-input-title")!.value).toBe("");
    expect(document.querySelector(".fce-quick-input-folder")!.textContent).toBe(getUiStrings("zh").noteInput.rootFolder);
  });
  it("cancels template replacement without losing typed text or unlocking a frozen submission", async () => {
    register(); text("保留正文"); templateButton().click(); state.picker!.onClose(); state.picker!.select("daily");
    expect(field().readOnly).toBe(true); expect(send().disabled).toBe(true);
    state.confirmations.at(-1)!.cancel(); await tick(); await tick();
    expect(field().value).toBe("保留正文"); expect(field().readOnly).toBe(false);
    submit.mockRejectedValueOnce(new Error("uncertain")); send().click(); await tick(); await tick();
    expect(templateButton().disabled).toBe(true); expect(field().readOnly).toBe(true);
  });
});
