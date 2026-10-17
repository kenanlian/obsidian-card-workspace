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
const root = (index = 0) => document.querySelectorAll<HTMLDivElement>(".fce-quick-input").item(index)!;
const send = (index = 0) => root(index).querySelector<HTMLButtonElement>("button.mod-cta")!;
const cancel = (index = 0) => root(index).querySelector<HTMLButtonElement>("button:not(.mod-cta)")!;
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
  it("opens independent blank drafts each time, keeps them on blur, and cancels only the chosen draft", () => {
    const underlying = document.createElement("div"); document.body.append(underlying);
    manager.open(window);
    expect(root().getAttribute("aria-modal")).toBe("false");
    expect(document.querySelector("textarea")).toBeNull();
    expect(send().disabled).toBe(true);
    setText("   \n"); expect(send().disabled).toBe(true);
    setText("draft");
    window.dispatchEvent(new Event("blur")); manager.open(window);
    manager.open(window);
    expect(state.editors).toHaveLength(3);
    for (const editor of state.editors) expect(editor.focus).toHaveBeenCalledOnce();
    expect(state.editors[0].text).toBe("draft");
    expect(state.editors[1].text).toBe(""); expect(state.editors[2].text).toBe("");
    setText("second", 1);
    cancel().click();
    expect(document.querySelectorAll(".fce-quick-input")).toHaveLength(2);
    expect(state.editors[1].text).toBe("second");
    expect(state.editors[1].dispose).not.toHaveBeenCalled();
    expect(state.editors[0].dispose).toHaveBeenCalledOnce();
    expect(underlying.isConnected).toBe(true);
    cancel().click(); cancel().click();
    expect(document.querySelector(".fce-quick-input-layer")).toBeNull();
    manager.open(window); expect(state.editors[3].text).toBe("");
  });

  it("has independent drafts owned by separate window documents and cleans on unload", () => {
    const frame = document.createElement("iframe"); document.body.append(frame);
    const other = frame.contentWindow!;
    manager.open(window); manager.open(window); manager.open(other); manager.open(other);
    setText("main", 0); setText("other", 2);
    expect(document.querySelectorAll(".fce-quick-input-layer")).toHaveLength(1);
    expect(other.document.querySelectorAll(".fce-quick-input")).toHaveLength(2);
    expect(other.document.querySelector(".fce-quick-input")!.ownerDocument).toBe(other.document);
    other.dispatchEvent(new Event("unload"));
    expect(state.editors[2].dispose).toHaveBeenCalledOnce(); expect(state.editors[3].dispose).toHaveBeenCalledOnce();
    expect(other.document.querySelector(".fce-quick-input-layer")).toBeNull();
    expect(root()).not.toBeNull(); expect(state.editors[0].text).toBe("main");
    expect(state.editors[1].dispose).not.toHaveBeenCalled();
    manager.dispose(); manager.dispose();
    expect(state.editors[0].dispose).toHaveBeenCalledOnce();
    expect(state.editors[1].dispose).toHaveBeenCalledOnce();
    expect(document.querySelector(".fce-quick-input-layer")).toBeNull();
  });

  it("cascades from the last activated draft and raises it without moving its DOM", () => {
    manager.open(window); manager.open(window); manager.open(window);
    const originalOrder = Array.from(document.querySelectorAll<HTMLDivElement>(".fce-quick-input"));
    expect(originalOrder.map((node) => [node.style.left, node.style.top])).toEqual([
      ["272px", "249px"], ["296px", "273px"], ["320px", "297px"],
    ]);
    expect(Number(root(2).style.zIndex)).toBeGreaterThan(Number(root().style.zIndex));
    pointer(root(), "pointerdown", 260, 230);
    expect(Number(root().style.zIndex)).toBeGreaterThan(Number(root(2).style.zIndex));
    root(1).dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(Number(root(1).style.zIndex)).toBeGreaterThan(Number(root().style.zIndex));
    expect(Array.from(root().parentElement!.children)).toEqual(originalOrder);
    manager.open(window);
    expect(root(3).style.left).toBe("320px"); expect(root(3).style.top).toBe("297px");
    expect(state.editors[1].dispose).not.toHaveBeenCalled();
  });

  it("moves and resizes one draft independently, wraps new placement, and clamps all drafts on resize", () => {
    manager.open(window); manager.open(window);
    const first = root().style.cssText;
    pointer(root(1).querySelector(".fce-quick-input-grip")!, "pointerdown", 0, 0);
    pointer(window, "pointermove", 1000, 1000); pointer(window, "pointerup", 1000, 1000);
    expect(root(1).style.left).toBe("544px"); expect(root(1).style.top).toBe("498px");
    pointer(root(1).querySelector('[data-direction="nw"]')!, "pointerdown", 0, 0);
    pointer(window, "pointermove", 100, 100); pointer(window, "pointerup", 100, 100);
    expect(root(1).style.width).toBe("380px"); expect(root(1).style.height).toBe("200px");
    expect(root().style.cssText).toBe(first);
    manager.open(window);
    expect(root(2).style.left).toBe("0px"); expect(root(2).style.top).toBe("0px");
    expect(root(2).style.width).toBe("480px"); expect(root(2).style.height).toBe("270px");
    Object.defineProperty(window, "innerWidth", { value: 250, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 150, configurable: true });
    window.dispatchEvent(new Event("resize"));
    for (let index = 0; index < 3; index++) {
      expect(root(index).style.width).toBe("250px"); expect(root(index).style.height).toBe("150px");
      expect(root(index).style.left).toBe("0px"); expect(root(index).style.top).toBe("0px");
    }
  });

  it("keeps composition and shortcut submission local to each draft", () => {
    submit.mockReturnValue(new Promise<NoteInputResult>(() => {}));
    manager.open(window); manager.open(window); setText("first"); setText("second", 1);
    root().dispatchEvent(new Event("compositionstart", { bubbles: true }));
    expect(send().disabled).toBe(true); expect(send(1).disabled).toBe(false);
    root(1).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    expect(submit).toHaveBeenCalledOnce(); expect(submit.mock.calls[0][0].text).toBe("second");
    root().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    expect(submit).toHaveBeenCalledOnce();
    root().dispatchEvent(new Event("compositionend", { bubbles: true }));
    expect(send().disabled).toBe(false); expect(cancel().disabled).toBe(false);
    expect(send(1).disabled).toBe(true); expect(cancel(1).disabled).toBe(true);
    expect(state.editors[0].readOnly).not.toHaveBeenCalled();
  });

  it("isolates concurrent submissions, retries and completions from later drafts", async () => {
    let resolve!: (result: NoteInputResult) => void;
    submit.mockReturnValueOnce(new Promise((done) => { resolve = done; }))
      .mockRejectedValueOnce(new Error("save failed"))
      .mockResolvedValueOnce({ file: Object.assign(new TFile(), { path: "second.md" }), created: false });
    manager.open(window); manager.open(window); setText("first"); setText("second", 1);
    const firstRoot = root(), secondRoot = root(1);
    send().click(); send(1).click(); await tick();
    const [first, second] = submit.mock.calls.map(([request]) => request);
    expect(first.submissionId).not.toBe(second.submissionId);
    expect(first.text).toBe("first"); expect(second.text).toBe("second");
    expect(send().disabled).toBe(true); expect(send(1).disabled).toBe(false);
    manager.open(window); setText("later", 2);
    send(1).click(); await tick();
    expect(submit.mock.calls[2][0]).toBe(second);
    expect(secondRoot.isConnected).toBe(false); expect(firstRoot.isConnected).toBe(true);
    resolve({ file: Object.assign(new TFile(), { path: "first.md" }), created: true }); await tick();
    expect(firstRoot.isConnected).toBe(false);
    expect(document.querySelectorAll(".fce-quick-input")).toHaveLength(1);
    expect(state.editors[2].text).toBe("later"); expect(state.editors[2].dispose).not.toHaveBeenCalled();
    expect(send().disabled).toBe(false);
  });

  it("drops completions from unloaded drafts and removes active gesture listeners", async () => {
    let resolve!: (result: NoteInputResult) => void;
    submit.mockReturnValue(new Promise((done) => { resolve = done; }));
    manager.open(window); setText("draft"); send().click();
    manager.open(window);
    const closed = root(1);
    pointer(closed.querySelector(".fce-quick-input-grip")!, "pointerdown", 0, 0);
    window.dispatchEvent(new Event("unload"));
    expect(document.querySelector(".fce-quick-input-layer")).toBeNull();
    const geometry = closed.style.cssText;
    pointer(window, "pointermove", 100, 100);
    expect(closed.style.cssText).toBe(geometry);
    manager.open(window); setText("new", 2);
    resolve({ file: Object.assign(new TFile(), { path: "old.md" }), created: true }); await tick();
    expect(notify).not.toHaveBeenCalled(); expect(root()).not.toBeNull();
    expect(state.editors[2].text).toBe("new");
    expect(state.editors[0].dispose).toHaveBeenCalledOnce(); expect(state.editors[1].dispose).toHaveBeenCalledOnce();
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
    files.delete("template.md"); window.dispatchEvent(new Event("focus")); expect(send().disabled).toBe(true);
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
    expect(document.querySelector(".fce-quick-input-layer")).toBeNull();
  });

  it("keeps existing drafts and their layer when another native editor fails to initialize", () => {
    manager.open(window); setText("keep");
    vi.spyOn(console, "warn").mockImplementation(() => {}); state.unsupported = true;
    manager.open(window);
    expect(document.querySelectorAll(".fce-quick-input")).toHaveLength(1);
    expect(state.editors[0].text).toBe("keep"); expect(state.editors[0].dispose).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".fce-quick-input-layer")).toHaveLength(1);
    expect(send().disabled).toBe(false);
  });

  it("drags and resizes all boundaries within the window, remembers position, and clamps on window resize", () => {
    manager.open(window);
    expect(root().style.width).toBe("480px"); expect(root().style.height).toBe("270px");
    expect(root().querySelectorAll(".fce-quick-input-resize")).toHaveLength(8);
    pointer(root().querySelector(".fce-quick-input-grip")!, "pointerdown", 300, 300);
    pointer(window, "pointermove", -1000, -1000); pointer(window, "pointerup", -1000, -1000);
    expect(root().style.left).toBe("0px"); expect(root().style.top).toBe("0px");
    pointer(root().querySelector('[data-direction="se"]')!, "pointerdown", 480, 270);
    pointer(window, "pointermove", 1500, 1500); pointer(window, "pointerup", 1500, 1500);
    expect(root().style.width).toBe("1024px"); expect(root().style.height).toBe("768px");
    pointer(root().querySelector('[data-direction="nw"]')!, "pointerdown", 0, 0);
    pointer(window, "pointermove", 1000, 1000); pointer(window, "pointerup", 1000, 1000);
    expect(root().style.width).toBe("320px"); expect(root().style.height).toBe("200px");
    expect(root().style.left).toBe("704px"); expect(root().style.top).toBe("568px");
    cancel().click(); manager.open(window);
    expect(root().style.width).toBe("480px"); expect(root().style.height).toBe("270px");
    expect(root().style.left).toBe("544px"); expect(root().style.top).toBe("498px");
    Object.defineProperty(window, "innerWidth", { value: 250, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 150, configurable: true });
    window.dispatchEvent(new Event("resize"));
    expect(root().style.width).toBe("250px"); expect(root().style.height).toBe("150px");
    expect(root().style.left).toBe("0px"); expect(root().style.top).toBe("0px");
  });

  it.each(["n", "ne", "e", "se", "s", "sw", "w", "nw"])("resizes the %s boundary while anchoring the opposite edge", (direction) => {
    manager.open(window);
    const initial = { x: parseFloat(root().style.left), y: parseFloat(root().style.top), width: 480, height: 270 };
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

  it("opens each new draft at the configured size and renders a centered ellipsis grip", () => {
    settings.quickInputWidth = 600; settings.quickInputHeight = 300;
    manager.open(window);
    expect(root().style.width).toBe("600px"); expect(root().style.height).toBe("300px");
    expect(root().style.left).toBe("212px"); expect(root().style.top).toBe("234px");
    expect(root().querySelector(".fce-quick-input-grip")!.getAttribute("data-icon")).toBe("ellipsis");
    pointer(root().querySelector('[data-direction="se"]')!, "pointerdown", 0, 0);
    pointer(window, "pointermove", 50, 50); pointer(window, "pointerup", 50, 50);
    expect(root().style.width).toBe("650px");
    settings.quickInputWidth = 400;
    cancel().click(); manager.open(window);
    expect(root().style.width).toBe("400px"); expect(root().style.height).toBe("300px");
    expect(root().style.left).toBe("212px"); expect(root().style.top).toBe("234px");
  });

  it.each(["en", "zh"] as const)("shows the %s destination of folder, root, template and unavailable targets", (locale) => {
    language = locale;
    const strings = noteInputStrings[locale];
    const destination = () => root().querySelector<HTMLDivElement>(".fce-quick-input-destination")!;
    const icon = () => destination().querySelector(".fce-quick-input-destination-icon")!.getAttribute("data-icon");
    files.set("Inbox", Object.assign(new TFolder(), { path: "Inbox" }));
    manager.open(window);
    expect(destination().textContent).toBe(`${strings.destinationLocation} · ${strings.rootFolder}`);
    expect(icon()).toBe("folder");
    settings.quickInput = { templateId: null, folderPath: "Inbox", insertPosition: "start" };
    window.dispatchEvent(new Event("focus"));
    expect(destination().textContent).toBe(`${strings.destinationLocation} · Inbox`);
    expect(destination().title).toBe("Inbox"); expect(destination().classList.contains("is-invalid")).toBe(false);
    files.set("Journal", Object.assign(new TFolder(), { path: "Journal" }));
    files.set("Templates/daily.md", Object.assign(new TFile(), { path: "Templates/daily.md", extension: "md" }));
    settings.noteTemplates = [{ id: "daily", name: "Daily", filePath: "Templates/daily.md", targetFolderPath: "Journal", dateFormat: "YYYY", timeFormat: "HH" }];
    settings.quickInput = { templateId: "daily", folderPath: "", insertPosition: "end" };
    window.dispatchEvent(new Event("focus"));
    expect(destination().textContent).toBe(`${strings.destinationTemplate} · Daily`);
    expect(destination().title).toBe("Journal"); expect(icon()).toBe("file-plus-2");
    settings.quickInput = { templateId: "missing", folderPath: "", insertPosition: "end" };
    window.dispatchEvent(new Event("focus"));
    expect(destination().textContent).toBe(strings.destinationUnavailable);
    expect(destination().title).toBe(strings.invalidQuickInputConfig);
    expect(destination().classList.contains("is-invalid")).toBe(true); expect(icon()).toBe("alert-triangle");
    expect(send().title).toBe(strings.invalidQuickInputConfig);
  });

  it("keeps describing the captured destination after a failed send and later settings edits", async () => {
    files.set("Inbox", Object.assign(new TFolder(), { path: "Inbox" }));
    files.set("Other", Object.assign(new TFolder(), { path: "Other" }));
    settings.quickInput = { templateId: null, folderPath: "Inbox", insertPosition: "end" };
    submit.mockRejectedValue(new Error("fail"));
    manager.open(window); setText("draft");
    expect(send().title).toBe(`${noteInputStrings.en.send} (Ctrl+Enter)`);
    send().click(); await tick();
    settings.quickInput = { templateId: null, folderPath: "Other", insertPosition: "start" };
    window.dispatchEvent(new Event("focus"));
    expect(root().querySelector(".fce-quick-input-destination")!.textContent).toBe(`${noteInputStrings.en.destinationLocation} · Inbox`);
  });

  it("picks a random frame tint without repeating the previous draft and keeps it per draft", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    manager.open(window); manager.open(window); manager.open(window);
    expect([0, 1, 2].map((index) => root(index).dataset.color)).toEqual(["red", "orange", "red"]);
    expect(root().style.getPropertyValue("--fce-quick-input-tint")).toBe("var(--color-red)");
    root().dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    window.dispatchEvent(new Event("resize"));
    expect(root().dataset.color).toBe("red");
  });

  it("uses a fixed theme color or the accent color when configured", () => {
    settings.quickInputColor = "green";
    manager.open(window); manager.open(window);
    expect(root().dataset.color).toBe("green"); expect(root(1).dataset.color).toBe("green");
    expect(root().style.getPropertyValue("--fce-quick-input-tint")).toBe("var(--color-green)");
    settings.quickInputColor = "accent";
    manager.open(window);
    expect(root(2).dataset.color).toBe("accent");
    expect(root(2).style.getPropertyValue("--fce-quick-input-tint")).toBe("var(--interactive-accent)");
  });
});
