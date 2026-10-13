import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import { noteInputStrings } from "../i18n/noteInput";
import { DEFAULT_SETTINGS, type PluginSettings } from "../settings";
import type { QuickInputRequest, NoteInputResult } from "../note-input";
import { QuickInputWindowManager } from "./QuickInputWindowManager";

const state = vi.hoisted(() => ({ editors: [] as Array<{ container: HTMLElement; text: string; focus: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; readOnly: ReturnType<typeof vi.fn>; change: () => void }>, unsupported: false }));
vi.mock("./native-markdown-editor", () => ({
  createNativeMarkdownEditor: (options: { container: HTMLElement; onChange: () => void }) => {
    if (state.unsupported) throw new Error("unsupported");
    const editor = { container: options.container, text: "", focus: vi.fn(), dispose: vi.fn(), readOnly: vi.fn(), change: options.onChange };
    state.editors.push(editor);
    return { getValue: () => editor.text, focus: editor.focus, dispose: editor.dispose, setReadOnly: editor.readOnly };
  },
}));

let manager: QuickInputWindowManager;
let settings: PluginSettings;
let notify: ReturnType<typeof vi.fn<(message: string) => void>>;
let submit: ReturnType<typeof vi.fn<(request: QuickInputRequest) => Promise<NoteInputResult>>>;
let files: Map<string, TFile | TFolder>;
let language: "en" | "zh";
const rootFolder = Object.assign(new TFolder(), { path: "" });
const root = () => document.querySelector<HTMLDivElement>(".fce-quick-input")!;
const send = () => root().querySelector<HTMLButtonElement>("button.mod-cta")!;
const cancel = () => root().querySelector<HTMLButtonElement>("button:not(.mod-cta)")!;
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function setText(text: string, index = 0) { state.editors[index].text = text; state.editors[index].change(); }
function pointer(target: EventTarget, type: string, x: number, y: number) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }));
}

beforeEach(() => {
  state.editors = []; state.unsupported = false;
  language = "en";
  settings = structuredClone(DEFAULT_SETTINGS);
  files = new Map([["", rootFolder]]);
  notify = vi.fn(); submit = vi.fn();
  manager = new QuickInputWindowManager({
    app: { vault: { getRoot: () => rootFolder, getAbstractFileByPath: (path: string) => files.get(path) ?? null } } as unknown as App,
    getSettings: () => settings, getStrings: () => noteInputStrings[language], notify, submit,
  });
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
});
afterEach(() => { manager.dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("modeless quick input", () => {
  it.each(["en", "zh"] as const)("shows the %s Send label beside its plane and changes the pending text", (locale) => {
    language = locale;
    submit.mockReturnValue(new Promise<NoteInputResult>(() => {}));
    manager.open(window);
    expect(send().querySelector(".fce-quick-input-send-label")!.textContent).toBe(noteInputStrings[locale].send);
    expect(send().querySelector('.fce-quick-input-send-icon[data-icon="send"]')).not.toBeNull();
    expect(cancel().textContent).toBe(noteInputStrings[locale].cancel);
    setText("draft"); send().click();
    expect(send().querySelector(".fce-quick-input-send-label")!.textContent).toBe(noteInputStrings[locale].sending);
    expect(send().getAttribute("aria-label")).toBe(noteInputStrings[locale].sending);
    expect(send().querySelector('.fce-quick-input-send-icon[data-icon="send"]')).not.toBeNull();
  });
  it("keeps the blank draft on blur, focuses repeated opens, and discards on cancel", () => {
    const underlying = document.createElement("div"); document.body.append(underlying);
    manager.open(window);
    expect(root().getAttribute("aria-modal")).toBe("false");
    expect(document.querySelector("textarea")).toBeNull();
    expect(send().disabled).toBe(true);
    setText("   \n"); expect(send().disabled).toBe(true);
    setText("draft");
    window.dispatchEvent(new Event("blur")); manager.open(window);
    expect(state.editors).toHaveLength(1);
    expect(state.editors[0].focus).toHaveBeenCalledTimes(2);
    expect(state.editors[0].text).toBe("draft");
    cancel().click(); expect(root()).toBeNull();
    expect(state.editors[0].dispose).toHaveBeenCalledOnce();
    expect(underlying.isConnected).toBe(true);
    manager.open(window); expect(state.editors[1].text).toBe("");
  });

  it("has independent drafts owned by separate window documents and cleans on unload", () => {
    const frame = document.createElement("iframe"); document.body.append(frame);
    const other = frame.contentWindow!;
    manager.open(window); manager.open(other);
    setText("main", 0); setText("other", 1);
    expect(other.document.querySelector(".fce-quick-input")!.ownerDocument).toBe(other.document);
    other.dispatchEvent(new Event("unload"));
    expect(state.editors[1].dispose).toHaveBeenCalledOnce();
    expect(root()).not.toBeNull(); expect(state.editors[0].text).toBe("main");
    manager.dispose(); manager.dispose();
    expect(state.editors[0].dispose).toHaveBeenCalledOnce();
    expect(document.querySelector(".fce-quick-input")).toBeNull();
  });

  it("leaves Enter alone, blocks IME submissions, and uses ModEnter with single-flight protection", async () => {
    let resolve!: (result: { file: TFile; created: boolean }) => void;
    submit.mockReturnValue(new Promise((done) => { resolve = done; }));
    manager.open(window); setText("hello\nworld");
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }); root().dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false); expect(submit).not.toHaveBeenCalled();
    root().dispatchEvent(new Event("compositionstart", { bubbles: true }));
    root().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    expect(submit).not.toHaveBeenCalled(); expect(send().disabled).toBe(true);
    root().dispatchEvent(new Event("compositionend", { bubbles: true }));
    root().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, isComposing: true }));
    expect(submit).not.toHaveBeenCalled();
    root().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    root().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    expect(submit).toHaveBeenCalledOnce(); expect(send().disabled).toBe(true); expect(cancel().disabled).toBe(true);
    resolve({ file: Object.assign(new TFile(), { path: "note.md" }), created: true }); await tick();
    expect(root()).toBeNull(); expect(notify).toHaveBeenCalledWith("Sent to note.md");
  });

  it("retains a frozen request across errors and settings changes so retry cannot duplicate an insertion", async () => {
    submit.mockRejectedValueOnce(new Error("save failed")).mockResolvedValue({ file: Object.assign(new TFile(), { path: "note.md" }), created: false });
    manager.open(window); setText("{{date}} unchanged"); send().click(); await tick();
    const first = submit.mock.calls[0][0] as QuickInputRequest;
    expect(first.now).toBeInstanceOf(Date); expect(first.submissionId).toBeTruthy();
    expect(first.text).toBe("{{date}} unchanged"); expect(root()).not.toBeNull();
    expect(state.editors[0].readOnly).toHaveBeenCalledWith(true);
    settings.quickInput = { templateId: "missing", folderPath: "missing", insertPosition: "start" };
    send().click(); await tick();
    expect(submit.mock.calls[1][0]).toBe(first);
    expect(first.config).toEqual({ templateId: null, folderPath: "", insertPosition: "end" });
    expect(root()).toBeNull();
  });

  it("captures the selected template and stops unavailable configuration without losing draft", async () => {
    settings.quickInput.templateId = "template";
    settings.noteTemplates = [{ id: "template", filePath: "template.md", targetFolderPath: null, dateFormat: "YYYY", timeFormat: "HH" }];
    manager.open(window); setText("draft"); expect(send().disabled).toBe(true);
    settings.noteTemplates[0].targetFolderPath = "";
    files.set("template.md", Object.assign(new TFile(), { path: "template.md", extension: "md" }));
    window.dispatchEvent(new Event("focus")); expect(send().disabled).toBe(false);
    submit.mockRejectedValue(new Error("fail")); send().click(); await tick();
    const captured = submit.mock.calls[0][0] as QuickInputRequest;
    settings.noteTemplates[0].dateFormat = "YYYY-MM";
    expect(captured.template!.dateFormat).toBe("YYYY");
    files.delete("template.md"); manager.open(window); expect(send().disabled).toBe(true);
    expect(state.editors[0].text).toBe("draft");
  });

  it("ignores completion after disposal and does not close a later replacement draft", async () => {
    let resolve!: (result: { file: TFile; created: boolean }) => void;
    submit.mockReturnValue(new Promise((done) => { resolve = done; }));
    manager.open(window); setText("draft"); send().click(); manager.dispose();
    resolve({ file: Object.assign(new TFile(), { path: "note.md" }), created: true }); await tick();
    expect(notify).not.toHaveBeenCalled(); expect(state.editors[0].dispose).toHaveBeenCalledOnce();
  });

  it("fails clearly without a substitute editor when the native capability is missing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {}); state.unsupported = true;
    manager.open(window); expect(root()).toBeNull();
    expect(notify).toHaveBeenCalledWith(noteInputStrings.en.nativeEditorUnavailable);
    expect(state.editors).toHaveLength(0);
  });

  it("drags and resizes all boundaries within the window, remembers geometry, and clamps on window resize", () => {
    manager.open(window);
    expect(root().style.width).toBe("520px"); expect(root().style.height).toBe("320px");
    expect(root().querySelectorAll(".fce-quick-input-resize")).toHaveLength(8);
    pointer(root().querySelector(".fce-quick-input-grip")!, "pointerdown", 300, 300);
    pointer(window, "pointermove", -1000, -1000); pointer(window, "pointerup", -1000, -1000);
    expect(root().style.left).toBe("0px"); expect(root().style.top).toBe("0px");
    pointer(root().querySelector('[data-direction="se"]')!, "pointerdown", 520, 320);
    pointer(window, "pointermove", 1500, 1500); pointer(window, "pointerup", 1500, 1500);
    expect(root().style.width).toBe("1024px"); expect(root().style.height).toBe("768px");
    pointer(root().querySelector('[data-direction="nw"]')!, "pointerdown", 0, 0);
    pointer(window, "pointermove", 1000, 1000); pointer(window, "pointerup", 1000, 1000);
    expect(root().style.width).toBe("320px"); expect(root().style.height).toBe("200px");
    const saved = root().style.cssText; cancel().click(); manager.open(window); expect(root().style.cssText).toBe(saved);
    Object.defineProperty(window, "innerWidth", { value: 250, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 150, configurable: true });
    window.dispatchEvent(new Event("resize"));
    expect(root().style.width).toBe("250px"); expect(root().style.height).toBe("150px");
    expect(root().style.left).toBe("0px"); expect(root().style.top).toBe("0px");
  });

  it.each(["n", "ne", "e", "se", "s", "sw", "w", "nw"])("resizes the %s boundary while anchoring the opposite edge", (direction) => {
    manager.open(window);
    const initial = { x: parseFloat(root().style.left), y: parseFloat(root().style.top), width: 520, height: 320 };
    pointer(root().querySelector(`[data-direction="${direction}"]`)!, "pointerdown", 0, 0);
    pointer(window, "pointermove", 50, 50); pointer(window, "pointerup", 50, 50);
    expect(parseFloat(root().style.width)).toBe(initial.width + (direction.includes("e") ? 50 : direction.includes("w") ? -50 : 0));
    expect(parseFloat(root().style.height)).toBe(initial.height + (direction.includes("s") ? 50 : direction.includes("n") ? -50 : 0));
    expect(parseFloat(root().style.left)).toBe(initial.x + (direction.includes("w") ? 50 : 0));
    expect(parseFloat(root().style.top)).toBe(initial.y + (direction.includes("n") ? 50 : 0));
    const saved = root().style.cssText;
    pointer(window, "pointermove", 100, 100);
    expect(root().style.cssText).toBe(saved);
  });
});
