import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform, TFile, TFolder, type App } from "obsidian";
import { noteInputStrings } from "../i18n/noteInput";
import { DEFAULT_SETTINGS, type PluginSettings } from "../settings";
import type { QuickInputRequest, NoteInputResult } from "../note-input";
import { QuickInputDesktopError, type QuickInputDesktop, type QuickInputWindowHandle } from "./quick-input-desktop";
import { QuickInputWindowManager } from "./QuickInputWindowManager";
import { QuickInputPreflightError } from "../services/NoteCreationService";
import { createCardBox } from "../view/card-boxes";
import { installObsidianDomHelpers } from "../__mocks__/obsidian-dom";
import type { QuickInputSuggestOptions } from "./quick-input-suggest";

vi.mock("obsidian", async (importOriginal) => ({ ...await importOriginal<typeof import("obsidian")>(), moment: (await import("moment")).default }));

interface FakeConfirm { title: string; content: string; isOpen: boolean; buttons: Array<{ text: string; cta: boolean }>; click(text: string): void }
const prompts = vi.hoisted(() => ({ pickers: [] as Array<{ options: QuickInputSuggestOptions; dispose: () => void }>, confirms: [] as FakeConfirm[] }));
vi.mock("./quick-input-suggest", () => ({
  openQuickInputSuggest: (_app: unknown, options: QuickInputSuggestOptions) => {
    let open = true;
    const entry = { options, dispose: () => { if (open) { open = false; options.onClose(); } } };
    prompts.pickers.push(entry);
    return { dispose: entry.dispose };
  },
}));
vi.mock("../view/modals/compat-modal", () => ({
  CompatConfirmationModal: class {
    title = ""; content = ""; isOpen = false;
    buttons: Array<{ text: string; cta: boolean; run: () => unknown }> = [];
    constructor() { prompts.confirms.push(this as unknown as FakeConfirm); }
    setTitle(title: string) { this.title = title; return this; }
    setContent(content: string) { this.content = content; return this; }
    addButton(configure: (button: unknown) => unknown) {
      const record = { text: "", cta: false, run: (): unknown => undefined };
      const api = { setButtonText: (text: string) => { record.text = text; return api; }, setCta: () => { record.cta = true; return api; },
        setWarning: () => api, setDisabled: () => api, onClick: (run: () => unknown) => { record.run = run; return api; } };
      configure(api); this.buttons.push(record); return this;
    }
    addCancelButton(text: string) { return this.addButton((button) => (button as { setButtonText(text: string): { onClick(run: () => unknown): unknown } }).setButtonText(text).onClick(() => undefined)); }
    open() { this.isOpen = true; }
    onClose() {}
    close() { if (!this.isOpen) return; this.isOpen = false; this.onClose(); }
    click(text: string) { if (!this.buttons.find((button) => button.text === text)!.run()) this.close(); }
  },
}));

const state = vi.hoisted(() => ({ editors: [] as Array<{ container: HTMLElement; text: string; focus: ReturnType<typeof vi.fn>; flush: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; readOnly: ReturnType<typeof vi.fn>; propertiesReadOnly: ReturnType<typeof vi.fn>; addMetadata: ReturnType<typeof vi.fn>; change: () => void }>, unsupported: false }));
vi.mock("./native-markdown-editor", () => ({
  createNativeMarkdownEditor: (options: { container: HTMLElement; initialValue?: string; onChange: () => void }) => {
    if (state.unsupported) throw new Error("unsupported");
    const editor = { container: options.container, text: options.initialValue ?? "", focus: vi.fn(), flush: vi.fn(), dispose: vi.fn(), readOnly: vi.fn(), propertiesReadOnly: vi.fn(), addMetadata: vi.fn(() => true), change: options.onChange };
    state.editors.push(editor);
    return { getValue: () => editor.text, focus: editor.focus, flush: editor.flush, dispose: editor.dispose, setReadOnly: editor.readOnly, setPropertiesReadOnly: editor.propertiesReadOnly, addMetadata: editor.addMetadata, mountTitle: (element: HTMLElement) => options.container.prepend(element) };
  },
}));

let manager: QuickInputWindowManager;
let settings: PluginSettings;
let notify: ReturnType<typeof vi.fn<(message: string) => void>>;
let submit: ReturnType<typeof vi.fn<(request: QuickInputRequest) => Promise<NoteInputResult>>>;
let files: Map<string, TFile | TFolder>;
let language: "en" | "zh";
const rootFolder = Object.assign(new TFolder(), { path: "" });
type TestHandle = QuickInputWindowHandle & { moveTop: ReturnType<typeof vi.fn>; hide: ReturnType<typeof vi.fn>; setOpacity: ReturnType<typeof vi.fn>; setShape: ReturnType<typeof vi.fn> };
interface DraftWindow { win: Window; frame: HTMLIFrameElement; handle: TestHandle; dispose: ReturnType<typeof vi.fn> }
let windows: DraftWindow[];
let desktop: QuickInputDesktop;
let documentReady: Promise<void> | null;
let cursor: { x: number; y: number };
const roots = () => windows.map((item) => item.win.document.querySelector<HTMLDivElement>(".fce-quick-input")).filter((item): item is HTMLDivElement => !!item);
const root = (index = 0) => roots()[index]!;
const send = (index = 0) => root(index).querySelector<HTMLButtonElement>("button.mod-cta")!;
const cancel = (index = 0) => root(index).querySelector<HTMLButtonElement>(".fce-quick-input-cancel")!;
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function setText(text: string, index = 0) { state.editors[index].text = text; state.editors[index].change(); }

beforeEach(() => {
  state.editors = []; state.unsupported = false;
  prompts.pickers = []; prompts.confirms = [];
  language = "en";
  settings = structuredClone(DEFAULT_SETTINGS);
  files = new Map([["", rootFolder]]);
  notify = vi.fn(); submit = vi.fn();
  windows = []; documentReady = null; cursor = { x: 0, y: 0 };
  desktop = { check: vi.fn(), cursor: vi.fn(() => cursor), shortcuts: vi.fn(),
    position: vi.fn((_source, width, height, ordinal) => ({ x: 100 + ordinal * 24, y: 100 + ordinal * 24, width, height })),
    createWindow: vi.fn(async ({ signal }) => {
      const frame = document.createElement("iframe"); document.body.append(frame);
      const win = frame.contentWindow!; installObsidianDomHelpers(win.document);
      win.document.documentElement.classList.add("fce-quick-input-window");
      let destroyed = false;
      // Hidden native windows may never deliver a frame; opening must still finish.
      win.requestAnimationFrame = vi.fn(() => 1);
      const handle: TestHandle = { id: windows.length + 2, isDestroyed: () => destroyed, hide: vi.fn(), show: vi.fn(), showInactive: vi.fn(), focus: vi.fn(), moveTop: vi.fn(),
        setParentWindow: vi.fn(), setAlwaysOnTop: vi.fn(), setMinimumSize: vi.fn(), setContentSize: vi.fn(), setResizable: vi.fn(),
        getBounds: () => ({ x: 100, y: 100, width: 480, height: 270 }), getContentBounds: () => ({ x: 100, y: 100, width: 480, height: 270 }),
        setBounds: vi.fn(), setOpacity: vi.fn(), setShape: vi.fn(), setWindowButtonVisibility: vi.fn(),
        webContents: { getZoomFactor: () => 1, setZoomFactor: vi.fn(), setBackgroundThrottling: vi.fn() } };
      const dispose = vi.fn(() => {
        if (destroyed) return;
        destroyed = true;
        signal.removeEventListener("abort", dispose);
        win.document.documentElement.classList.remove("fce-quick-input-window");
        win.dispatchEvent(new Event("unload"));
      });
      signal.addEventListener("abort", dispose, { once: true });
      windows.push({ frame, win, handle, dispose });
      handle.setAlwaysOnTop(true);
      if (documentReady) await documentReady;
      return { win, handle, dispose };
    }) };
  manager = new QuickInputWindowManager({ desktop,
    app: { vault: { getRoot: () => rootFolder, getAbstractFileByPath: (path: string) => files.get(path) ?? null, getAllFolders: vi.fn(() => [...files.values()].filter((file) => file instanceof TFolder)) } } as unknown as App,
    getSettings: () => settings, getStrings: () => noteInputStrings[language], notify, submit,
  });
});
afterEach(() => { manager.dispose(); Object.assign(Platform, { isMacOS: false, isWin: false }); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("modeless quick input", async () => {
  it("opens a blank draft that ignores registered templates and submits the edited draft", async () => {
    settings.noteTemplates = [{ id: "daily", filePath: "Templates/template.md", targetFolderPath: "", dateFormat: "YYYY", timeFormat: "HH" }];
    (settings.quickInput as unknown as Record<string, unknown>).templateId = "daily";
    files.set("Templates/template.md", Object.assign(new TFile(), { path: "Templates/template.md", basename: "template", extension: "md" }));
    submit.mockReturnValue(new Promise<NoteInputResult>(() => {}));
    await manager.open(window);
    expect(state.editors[0].text).toBe("");
    setText("my input {{date}}"); send().click(); await tick();
    expect(submit.mock.calls[0][0]).toMatchObject({ text: "my input {{date}}", config: { folderPath: "", insertPosition: "end", duplicateTitle: "number" } });
    expect(submit.mock.calls[0][0]).not.toHaveProperty("template");
  });

  it.each(["en", "zh"] as const)("shows the %s Send label beside its plane and changes the pending text", async (locale) => {
    language = locale;
    submit.mockReturnValue(new Promise<NoteInputResult>(() => {}));
    await manager.open(window);
    expect(send().querySelector(".fce-quick-input-send-label")!.textContent).toBe(noteInputStrings[locale].send);
    expect(send().querySelector('.fce-quick-input-send-icon[data-icon="send"]')).not.toBeNull();
    expect(cancel().textContent).toBe(noteInputStrings[locale].cancel);
    setText("draft"); send().click();
    expect(send().querySelector(".fce-quick-input-send-label")!.textContent).toBe(noteInputStrings[locale].sending);
    expect(send().getAttribute("aria-label")).toBe(noteInputStrings[locale].sending);
    expect(send().querySelector('.fce-quick-input-send-icon[data-icon="send"]')).not.toBeNull();
  });
  it("opens independent blank drafts each time, keeps them on blur, and cancels only the chosen draft", async () => {
    const underlying = document.createElement("div"); document.body.append(underlying);
    await manager.open(window);
    expect(root().getAttribute("aria-modal")).toBe("false");
    expect(document.querySelector("textarea")).toBeNull();
    expect(send().disabled).toBe(true);
    setText("   \n"); expect(send().disabled).toBe(true);
    setText("draft");
    window.dispatchEvent(new Event("blur")); await manager.open(window);
    await manager.open(window);
    expect(state.editors).toHaveLength(3);
    await tick();
    for (const editor of state.editors) expect(editor.focus).toHaveBeenCalledOnce();
    expect(state.editors[0].text).toBe("draft");
    expect(state.editors[1].text).toBe(""); expect(state.editors[2].text).toBe("");
    setText("second", 1);
    cancel().click();
    expect(roots()).toHaveLength(2);
    expect(state.editors[1].text).toBe("second");
    expect(state.editors[1].dispose).not.toHaveBeenCalled();
    expect(state.editors[0].dispose).toHaveBeenCalledOnce();
    expect(underlying.isConnected).toBe(true);
    cancel().click(); cancel().click();
    expect(document.querySelector(".fce-quick-input-layer")).toBeNull();
    await manager.open(window); expect(state.editors[3].text).toBe("");
  });

  it("keeps composition and shortcut submission local to each draft", async () => {
    submit.mockReturnValue(new Promise<NoteInputResult>(() => {}));
    await manager.open(window); await manager.open(window); setText("first"); setText("second", 1);
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
    await manager.open(window); await manager.open(window); setText("first"); setText("second", 1);
    const firstRoot = root(), secondRoot = root(1);
    send().click(); send(1).click(); await tick();
    const [first, second] = submit.mock.calls.map(([request]) => request);
    expect(first.submissionId).not.toBe(second.submissionId);
    expect(first.text).toBe("first"); expect(second.text).toBe("second");
    expect(send().disabled).toBe(true); expect(send(1).disabled).toBe(false);
    await manager.open(window); setText("later", 2);
    send(1).click(); await tick();
    expect(submit.mock.calls[2][0]).toBe(second);
    expect(secondRoot.isConnected).toBe(false); expect(firstRoot.isConnected).toBe(true);
    resolve({ file: Object.assign(new TFile(), { path: "first.md" }), created: true }); await tick();
    expect(firstRoot.isConnected).toBe(false);
    expect(roots()).toHaveLength(1);
    expect(state.editors[2].text).toBe("later"); expect(state.editors[2].dispose).not.toHaveBeenCalled();
    expect(send().disabled).toBe(false);
  });

  it("leaves Enter alone, blocks IME submissions, and uses ModEnter with single-flight protection", async () => {
    let resolve!: (result: { file: TFile; created: boolean }) => void;
    submit.mockReturnValue(new Promise((done) => { resolve = done; }));
    await manager.open(window); setText("hello\nworld");
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
    expect(root()).toBeUndefined(); expect(notify).toHaveBeenCalledWith("Sent to note.md");
  });

  it("retains a frozen request across errors and settings changes so retry cannot duplicate an insertion", async () => {
    submit.mockRejectedValueOnce(new Error("save failed")).mockResolvedValue({ file: Object.assign(new TFile(), { path: "note.md" }), created: false });
    await manager.open(window); setText("{{date}} unchanged"); send().click(); await tick();
    const first = submit.mock.calls[0][0] as QuickInputRequest;
    expect(first.now).toBeInstanceOf(Date); expect(first.submissionId).toBeTruthy();
    expect(first.text).toBe("{{date}} unchanged"); expect(root()).not.toBeNull();
    expect(state.editors[0].readOnly).toHaveBeenCalledWith(true);
    expect(state.editors[0].flush).toHaveBeenCalledOnce();
    settings.quickInput = { folderPath: "missing", insertPosition: "start", duplicateTitle: "append" };
    send().click(); await tick();
    expect(submit.mock.calls[1][0]).toBe(first);
    expect(state.editors[0].flush).toHaveBeenCalledOnce();
    expect(first.config).toEqual({ folderPath: "", insertPosition: "end", duplicateTitle: "number" });
    expect(root()).toBeUndefined();
  });

  it("commits the active property input before capturing and locking the submitted draft", async () => {
    submit.mockReturnValue(new Promise<NoteInputResult>(() => {}));
    await manager.open(window); setText("---\ndue: old\n---\nBody");
    state.editors[0].flush.mockImplementation(() => { state.editors[0].text = "---\ndue: committed\n---\nBody"; });
    root().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(submit.mock.calls[0][0].text).toBe("---\ndue: committed\n---\nBody");
    expect(state.editors[0].flush.mock.invocationCallOrder[0]).toBeLessThan(state.editors[0].readOnly.mock.invocationCallOrder[0]);
    expect(state.editors[0].readOnly).toHaveBeenCalledWith(true);
  });

  it("stops an unavailable save folder without losing the draft and keeps a captured request after it disappears", async () => {
    settings.quickInput.folderPath = "Inbox";
    await manager.open(window); setText("draft"); expect(send().disabled).toBe(true);
    files.set("Inbox", Object.assign(new TFolder(), { path: "Inbox" }));
    windows.forEach(({ win }) => win.dispatchEvent(new Event("focus"))); expect(send().disabled).toBe(false);
    submit.mockRejectedValue(new Error("fail")); send().click(); await tick();
    const captured = submit.mock.calls[0][0] as QuickInputRequest;
    expect(captured.config.folderPath).toBe("Inbox");
    files.delete("Inbox"); windows.forEach(({ win }) => win.dispatchEvent(new Event("focus"))); expect(send().disabled).toBe(false);
    expect(state.editors[0].text).toBe("draft");
  });

  it("ignores completion after disposal and does not close a later replacement draft", async () => {
    let resolve!: (result: { file: TFile; created: boolean }) => void;
    submit.mockReturnValue(new Promise((done) => { resolve = done; }));
    await manager.open(window); setText("draft"); send().click(); manager.dispose();
    resolve({ file: Object.assign(new TFile(), { path: "note.md" }), created: true }); await tick();
    expect(notify).not.toHaveBeenCalled(); expect(state.editors[0].dispose).toHaveBeenCalledOnce();
  });

  it("fails clearly without a substitute editor when the native capability is missing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {}); state.unsupported = true;
    await manager.open(window); expect(root()).toBeUndefined();
    expect(notify).toHaveBeenCalledWith(noteInputStrings.en.nativeEditorUnavailable);
    expect(state.editors).toHaveLength(0);
    expect(document.querySelector(".fce-quick-input-layer")).toBeNull();
  });

  it("keeps existing drafts when another native editor fails to initialize", async () => {
    await manager.open(window); setText("keep");
    vi.spyOn(console, "warn").mockImplementation(() => {}); state.unsupported = true;
    await manager.open(window);
    expect(roots()).toHaveLength(1);
    expect(state.editors[0].text).toBe("keep"); expect(state.editors[0].dispose).not.toHaveBeenCalled();
    expect(windows.filter((item) => item.win.document.documentElement.classList.contains("fce-quick-input-window"))).toHaveLength(1);
    expect(send().disabled).toBe(false);
  });

  it.each(["en", "zh"] as const)("shows the %s folder, append action and unavailable targets without status text", async (locale) => {
    language = locale;
    const strings = noteInputStrings[locale];
    const sendLabel = () => send().querySelector(".fce-quick-input-send-label")!.textContent;
    const folder = () => root().querySelector<HTMLButtonElement>(".fce-quick-input-folder")!;
    files.set("Inbox", Object.assign(new TFolder(), { path: "Inbox" }));
    await manager.open(window);
    expect(root().querySelector(".fce-quick-input-destination")).toBeNull();
    expect(sendLabel()).toBe(strings.send);
    expect(folder().title).toBe(strings.rootFolder);
    settings.quickInput = { folderPath: "Inbox", insertPosition: "start", duplicateTitle: "append" };
    settings.quickInputVisibility.title = true;
    cancel().click(); await manager.open(window);
    expect(folder().title).toBe("Inbox");
    const title = root().querySelector<HTMLInputElement>(".fce-quick-input-title")!;
    title.value = "Daily"; title.dispatchEvent(new Event("input")); title.dispatchEvent(new Event("blur"));
    expect(sendLabel()).toBe(strings.send);
    files.set("Inbox/Daily.md", Object.assign(new TFile(), { path: "Inbox/Daily.md", extension: "md" }));
    windows.at(-1)!.win.dispatchEvent(new Event("focus"));
    expect(sendLabel()).toBe(strings.appendNote);
    expect(send().getAttribute("aria-label")).toBe(strings.appendNote);
    expect(folder().classList.contains("is-invalid")).toBe(false);
    settings.quickInput = { folderPath: "missing", insertPosition: "end", duplicateTitle: "append" };
    cancel().click(); await manager.open(window);
    expect(folder().classList.contains("is-invalid")).toBe(true);
    expect(folder().title).toContain(strings.destinationUnavailable);
    expect(send().title).toBe(strings.invalidQuickInputConfig);
  });

  it("keeps describing the captured destination after a failed send and later settings edits", async () => {
    files.set("Inbox", Object.assign(new TFolder(), { path: "Inbox" }));
    files.set("Other", Object.assign(new TFolder(), { path: "Other" }));
    settings.quickInput = { folderPath: "Inbox", insertPosition: "end", duplicateTitle: "ask" };
    submit.mockRejectedValue(new Error("fail"));
    await manager.open(window); setText("draft");
    expect(send().title).toBe(`${noteInputStrings.en.send} (Ctrl+Enter)`);
    send().click(); await tick();
    settings.quickInput = { folderPath: "Other", insertPosition: "start", duplicateTitle: "number" };
    windows.forEach(({ win }) => win.dispatchEvent(new Event("focus")));
    expect(root().querySelector<HTMLButtonElement>(".fce-quick-input-folder")!.title).toBe("Inbox");
  });

  it("picks a random frame tint without repeating the previous draft and keeps it per draft", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    await manager.open(window); await manager.open(window); await manager.open(window);
    expect([0, 1, 2].map((index) => root(index).dataset.color)).toEqual(["red", "orange", "red"]);
    expect(root().style.getPropertyValue("--fce-quick-input-tint")).toBe("var(--color-red)");
    root().dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    window.dispatchEvent(new Event("resize"));
    expect(root().dataset.color).toBe("red");
  });

  it("uses a fixed theme color or the accent color when configured", async () => {
    settings.quickInputColor = "green";
    await manager.open(window); await manager.open(window);
    expect(root().dataset.color).toBe("green"); expect(root(1).dataset.color).toBe("green");
    expect(root().style.getPropertyValue("--fce-quick-input-tint")).toBe("var(--color-green)");
    settings.quickInputColor = "accent";
    await manager.open(window);
    expect(root(2).dataset.color).toBe("accent");
    expect(root(2).style.getPropertyValue("--fce-quick-input-tint")).toBe("var(--interactive-accent)");
  });

  it("mounts before revealing and focuses only the new window without touching the main document", async () => {
    const pending = manager.open(window);
    expect(windows[0].handle.show).not.toHaveBeenCalled();
    await pending;
    await manager.open();
    expect(desktop.position).toHaveBeenCalledWith(undefined, 480, 400, 1);
    for (const item of windows) {
      expect(item.handle.show).toHaveBeenCalledOnce();
      expect(item.handle.focus).toHaveBeenCalledOnce();
      expect(item.handle.hide).not.toHaveBeenCalled();
      expect(item.handle.setOpacity).not.toHaveBeenCalled();
      expect(item.handle.setShape).not.toHaveBeenCalled();
    }
    expect(document.documentElement.classList.contains("fce-quick-input-window")).toBe(false);
    expect(root().querySelectorAll(".fce-quick-input-resize")).toHaveLength(8);
  });

  it.each([
    { pinned: false, global: false }, { pinned: true, global: false },
    { pinned: false, global: true }, { pinned: true, global: true },
  ])("leaves an existing draft untouched during and after opening (pinned=$pinned, global=$global)", async ({ pinned, global }) => {
    await manager.open(window); setText("keep this draft");
    const first = windows[0], original = root();
    if (!pinned) root().querySelector<HTMLButtonElement>(".fce-quick-input-pin")!.click();
    const expectUntouched = () => {
      expect(first.handle.moveTop).not.toHaveBeenCalled();
      expect(first.handle.show).toHaveBeenCalledOnce();
      expect(first.handle.showInactive).not.toHaveBeenCalled();
      expect(first.handle.focus).toHaveBeenCalledOnce();
      expect(first.handle.hide).not.toHaveBeenCalled();
      expect(first.handle.setOpacity).not.toHaveBeenCalled();
      expect(first.handle.setBounds).not.toHaveBeenCalled();
      expect(first.handle.setAlwaysOnTop).toHaveBeenCalledTimes(pinned ? 1 : 2);
      expect(first.handle.setAlwaysOnTop).toHaveBeenLastCalledWith(pinned);
      expect(first.dispose).not.toHaveBeenCalled();
      expect(root()).toBe(original);
      expect(state.editors[0].text).toBe("keep this draft");
      expect(state.editors[0].focus).toHaveBeenCalledOnce();
      expect(state.editors[0].dispose).not.toHaveBeenCalled();
    };
    let finish!: () => void;
    documentReady = new Promise((resolve) => { finish = resolve; });
    const pending = manager.open(global ? undefined : window);
    expectUntouched();
    expect(windows[1].handle.show).not.toHaveBeenCalled();
    expect(state.editors).toHaveLength(1);
    finish(); await pending;
    expectUntouched();
    expect(windows[1].handle.show).toHaveBeenCalledOnce();
    expect(windows[1].handle.focus).toHaveBeenCalledOnce();
  });

  it("reveals a slow earlier request without refocusing or raising the newest draft", async () => {
    let finish!: () => void;
    documentReady = new Promise((resolve) => { finish = resolve; });
    const earlier = manager.open();
    documentReady = null;
    await manager.open();
    finish(); await earlier;
    expect(windows[0].handle.show).not.toHaveBeenCalled();
    expect(windows[0].handle.focus).not.toHaveBeenCalled();
    expect(windows[0].handle.showInactive).toHaveBeenCalledOnce();
    expect(windows[0].handle.moveTop).not.toHaveBeenCalled();
    expect(windows[1].handle.show).toHaveBeenCalledOnce();
    expect(windows[1].handle.focus).toHaveBeenCalledOnce();
    expect(windows[1].handle.moveTop).not.toHaveBeenCalled();
  });

  it("cancels an initializing document on disposal and never mounts or shows it later", async () => {
    let finish!: () => void;
    documentReady = new Promise((resolve) => { finish = resolve; });
    const pending = manager.open();
    manager.dispose();
    expect(windows[0].dispose).toHaveBeenCalledOnce();
    finish(); await pending;
    expect(state.editors).toHaveLength(0);
    expect(windows[0].handle.show).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("cancels during initial layout without revealing a disposed editor", async () => {
    const pending = manager.open();
    const prototype = windows[0].win.document.defaultView!.HTMLElement.prototype;
    const measure = prototype.getBoundingClientRect;
    vi.spyOn(prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const bounds = measure.call(this);
      if (this.classList.contains("fce-quick-input")) manager.dispose();
      return bounds;
    });
    await pending;
    expect(state.editors[0].dispose).toHaveBeenCalledOnce();
    expect(windows[0].handle.show).not.toHaveBeenCalled();
  });

  it("releases a window that closed before document readiness without reserving its cascade position", async () => {
    const create = desktop.createWindow;
    vi.mocked(desktop.createWindow).mockImplementationOnce(async (options) => {
      const opened = await create(options); opened.dispose(); return opened;
    });
    await manager.open();
    expect(state.editors).toHaveLength(0);
    expect(windows[0].handle.show).not.toHaveBeenCalled();
    await manager.open();
    expect(desktop.position).toHaveBeenLastCalledWith(undefined, 480, 400, 0);
    expect(windows[1].handle.show).toHaveBeenCalledOnce();
  });

  it("defaults each window to pinned, toggles only the chosen window and cancels only its own editor", async () => {
    await manager.open(); await manager.open();
    const pin = root().querySelector<HTMLButtonElement>("[aria-pressed]")!;
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    expect(root(1).querySelector("[aria-pressed]")!.getAttribute("aria-pressed")).toBe("true");
    pin.click();
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    expect(windows[0].handle.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
    pin.click();
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    expect(windows[0].handle.setAlwaysOnTop).toHaveBeenLastCalledWith(true);
    expect(windows[1].handle.setAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(true);
    pin.click();
    expect(pin.parentElement?.className).toBe("fce-quick-input-footer");
    expect(pin.nextElementSibling?.classList.contains("fce-quick-input-folder")).toBe(true);
    expect(root().querySelector(".fce-quick-input-grip button")).toBeNull();
    cancel().click();
    expect(windows[0].dispose).toHaveBeenCalledOnce();
    expect(windows[1].dispose).not.toHaveBeenCalled();
    expect(state.editors[1].dispose).not.toHaveBeenCalled();
    await manager.open();
    expect(windows[2].handle.setAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(true);
    expect(root(1).querySelector("[aria-pressed]")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("continues an already submitted write after system close without touching a later draft", async () => {
    let finish!: (result: NoteInputResult) => void;
    submit.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await manager.open(); setText("submitted"); send().click();
    windows[0].win.dispatchEvent(new Event("unload"));
    await manager.open(); setText("later", 1);
    finish({ file: Object.assign(new TFile(), { path: "saved.md" }), created: true }); await tick();
    expect(state.editors[0].dispose).toHaveBeenCalledOnce();
    expect(state.editors[1].dispose).not.toHaveBeenCalled();
    expect(state.editors[1].text).toBe("later");
    expect(notify).not.toHaveBeenCalled();
    Object.defineProperty(state.editors[0], "text", { get: () => { throw new Error("Closed editor touched"); } });
    expect(() => state.editors[0].change()).not.toThrow();
  });

  it("rejects unsupported frames before creating any document", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(desktop.check).mockImplementation(() => { throw new QuickInputDesktopError("native-frame"); });
    await manager.open();
    expect(desktop.createWindow).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledExactlyOnceWith(noteInputStrings.en.nativeFrameUnsupported);
  });

  it("keeps earlier drafts usable when creating another window fails", async () => {
    await manager.open(); setText("keep");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(desktop.createWindow).mockRejectedValueOnce(new QuickInputDesktopError("unavailable"));
    await manager.open();
    expect(notify).toHaveBeenCalledWith(noteInputStrings.en.desktopUnavailable);
    expect(state.editors[0].text).toBe("keep");
    expect(windows[0].dispose).not.toHaveBeenCalled();
    await manager.open();
    expect(windows[0].handle.moveTop).not.toHaveBeenCalled();
    expect(windows[0].handle.show).toHaveBeenCalledOnce();
    expect(windows[0].handle.focus).toHaveBeenCalledOnce();
    expect(windows[1].handle.show).toHaveBeenCalledOnce();
  });

  it("resizes through card edges without native regions", async () => {
    await manager.open();
    const nw = root().querySelector<HTMLElement>('[data-edge="nw"]')!;
    const pointer = (type: string) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 });
      Object.defineProperty(event, "pointerId", { value: 1 });
      return event;
    };
    cursor = { x: 500, y: 300 }; nw.dispatchEvent(pointer("pointerdown"));
    cursor = { x: 450, y: 280 }; nw.dispatchEvent(pointer("pointermove"));
    expect(windows[0].handle.setBounds).toHaveBeenLastCalledWith({ x: 50, y: 80, width: 530, height: 290 });
    cursor = { x: 900, y: 600 }; nw.dispatchEvent(pointer("pointerup"));
    expect(windows[0].handle.setBounds).toHaveBeenLastCalledWith({ x: 260, y: 170, width: 320, height: 200 });
    expect(windows[0].handle.setShape).not.toHaveBeenCalled();
  });

  function dragGrip(index = 0) {
    const grip = root(index).querySelector<HTMLElement>(".fce-quick-input-grip")!;
    let captured: number | null = null;
    grip.setPointerCapture = vi.fn((id) => { captured = id; });
    grip.hasPointerCapture = vi.fn((id) => captured === id);
    grip.releasePointerCapture = vi.fn(() => { captured = null; });
    return grip;
  }
  function dragPointer(type: string, pointerId = 1, button = 0) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button });
    Object.defineProperty(event, "pointerId", { value: pointerId });
    return event;
  }

  it("drags only the chosen window using screen DIPs without changing its size or editor", async () => {
    await manager.open(); await manager.open(); setText("keep draft");
    const grip = dragGrip();
    cursor = { x: -500, y: 300 };
    const down = dragPointer("pointerdown"); grip.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(grip.setPointerCapture).toHaveBeenCalledWith(1);
    expect(grip.classList.contains("is-dragging")).toBe(true);
    cursor = { x: -650, y: 325 };
    grip.dispatchEvent(dragPointer("pointermove", 2));
    expect(windows[0].handle.setBounds).not.toHaveBeenCalled();
    grip.dispatchEvent(dragPointer("pointermove"));
    expect(windows[0].handle.setBounds).toHaveBeenLastCalledWith({ x: -50, y: 125, width: 480, height: 270 });
    cursor = { x: -700, y: 350 }; grip.dispatchEvent(dragPointer("pointerup"));
    expect(windows[0].handle.setBounds).toHaveBeenLastCalledWith({ x: -100, y: 150, width: 480, height: 270 });
    expect(grip.classList.contains("is-dragging")).toBe(false);
    expect(grip.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(windows[1].handle.setBounds).not.toHaveBeenCalled();
    expect(state.editors[0].text).toBe("keep draft");
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(["pointercancel", "lostpointercapture", "blur"])("stops moving on %s", async (type) => {
    await manager.open(); const grip = dragGrip();
    grip.dispatchEvent(dragPointer("pointerdown"));
    if (type === "blur") windows[0].win.dispatchEvent(new Event("blur"));
    else grip.dispatchEvent(dragPointer(type));
    cursor = { x: 900, y: 600 };
    grip.dispatchEvent(dragPointer("pointermove")); grip.dispatchEvent(dragPointer("pointerup"));
    expect(windows[0].handle.setBounds).not.toHaveBeenCalled();
    expect(grip.classList.contains("is-dragging")).toBe(false);
    expect(grip.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("ignores right clicks and removes drag listeners and capture on close", async () => {
    await manager.open(); const grip = dragGrip();
    grip.dispatchEvent(dragPointer("pointerdown", 1, 2));
    expect(grip.setPointerCapture).not.toHaveBeenCalled();
    grip.dispatchEvent(dragPointer("pointerdown"));
    cancel().click();
    expect(grip.releasePointerCapture).toHaveBeenCalledWith(1);
    grip.dispatchEvent(dragPointer("pointermove"));
    grip.dispatchEvent(dragPointer("pointerdown"));
    expect(grip.setPointerCapture).toHaveBeenCalledOnce();
    expect(windows[0].handle.setBounds).not.toHaveBeenCalled();
  });

  it("releases drag capture after a native move fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await manager.open(); const grip = dragGrip();
    vi.mocked(windows[0].handle.setBounds).mockImplementationOnce(() => { throw new Error("closed"); });
    grip.dispatchEvent(dragPointer("pointerdown"));
    grip.dispatchEvent(dragPointer("pointermove"));
    expect(grip.classList.contains("is-dragging")).toBe(false);
    expect(grip.releasePointerCapture).toHaveBeenCalledWith(1);
    grip.dispatchEvent(dragPointer("pointermove"));
    expect(windows[0].handle.setBounds).toHaveBeenCalledOnce();
    expect(send().isConnected).toBe(true);
  });
});


describe("draft target controls", () => {
  const title = () => root().querySelector<HTMLInputElement>(".fce-quick-input-title")!;
  const editTitle = (value: string) => { title().value = value; title().dispatchEvent(new Event("input", { bubbles: true })); };
  const settleTitle = () => title().dispatchEvent(new Event("blur"));
  it("snapshots visibility, focuses the body, and sends a separate title without changing text", async () => {
    settings.quickInputVisibility.title = true;
    await manager.open(); setText("Body");
    expect(title().value).toBe("");
    expect(title().placeholder).toMatch(/^quick-note /);
    expect(state.editors[0].focus).toHaveBeenCalled();
    settings.quickInputVisibility.title = false;
    expect(title()).not.toBeNull();
    editTitle("My note {{date}}");
    submit.mockReturnValue(new Promise(() => {})); send().click();
    expect(submit.mock.calls[0][0]).toMatchObject({ target: { title: "My note {{date}}", folderPath: "" }, text: "Body", boxIds: [], expectedMode: "create" });
    expect(title().disabled).toBe(true);
    await manager.open(); expect(root(1).querySelector(".fce-quick-input-title")).toBeNull();
  });
  it("keeps a cleared title empty, sends its placeholder default, and Enter focuses body only outside composition", async () => {
    settings.quickInputVisibility.title = true;
    await manager.open(); setText("Body"); const original = title().placeholder;
    editTitle("Draft"); editTitle(""); settleTitle(); expect(title().value).toBe("");
    state.editors[0].focus.mockClear();
    title().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));
    expect(state.editors[0].focus).not.toHaveBeenCalled();
    title().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(state.editors[0].focus).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled();
    submit.mockReturnValue(new Promise(() => {})); send().click();
    expect(submit.mock.calls[0][0].target!.title).toBe(original);
  });
  it("keeps Ctrl+; available when the property button is hidden", async () => {
    await manager.open();
    expect(root().querySelector<HTMLButtonElement>(".fce-quick-input-property")!.hidden).toBe(true);
    root().dispatchEvent(new KeyboardEvent("keydown", { key: ";", ctrlKey: true, bubbles: true }));
    expect(state.editors[0].addMetadata).toHaveBeenCalledWith("property");
  });
  it("previews appending to a same-name note and restores property editing for a new title", async () => {
    settings.quickInputVisibility = { title: true, folder: true, boxes: true, tags: true, properties: true };
    settings.quickInput.duplicateTitle = "append";
    files.set("Existing.md", Object.assign(new TFile(), { path: "Existing.md", extension: "md" }));
    await manager.open(); setText("Body");
    editTitle("Existing"); settleTitle();
    expect(state.editors[0].propertiesReadOnly).toHaveBeenLastCalledWith(true);
    expect(root().querySelector<HTMLButtonElement>(".fce-quick-input-tags")!.disabled).toBe(true);
    root().dispatchEvent(new KeyboardEvent("keydown", { key: ";", ctrlKey: true, bubbles: true }));
    expect(state.editors[0].addMetadata).not.toHaveBeenCalled();
    editTitle("New"); settleTitle();
    expect(state.editors[0].propertiesReadOnly).toHaveBeenLastCalledWith(false);
    expect(root().querySelector<HTMLButtonElement>(".fce-quick-input-tags")!.disabled).toBe(false);
    editTitle("Existing"); settleTitle();
    submit.mockReturnValue(new Promise(() => {})); send().click();
    expect(prompts.confirms).toHaveLength(0);
    expect(submit.mock.calls[0][0]).toMatchObject({ config: { duplicateTitle: "append" }, expectedMode: "append" });
  });
  it("creates a numbered note beside a same-name note without previewing an append", async () => {
    settings.quickInputVisibility.title = true;
    settings.quickInput.duplicateTitle = "number";
    files.set("Existing.md", Object.assign(new TFile(), { path: "Existing.md", extension: "md" }));
    await manager.open(); setText("Body");
    editTitle("Existing"); settleTitle();
    expect(send().querySelector(".fce-quick-input-send-label")!.textContent).toBe(noteInputStrings.en.send);
    expect(state.editors[0].propertiesReadOnly).not.toHaveBeenCalledWith(true);
    submit.mockReturnValue(new Promise(() => {})); send().click();
    expect(prompts.confirms).toHaveLength(0);
    expect(submit.mock.calls[0][0]).toMatchObject({ config: { duplicateTitle: "number" }, expectedMode: "create" });
  });
  it.each([
    ["appendNote", "append", "append"],
    ["createNumberedNote", "number", "create"],
  ] as const)("asks before sending to a same-name note and applies %s", async (button, duplicateTitle, expectedMode) => {
    settings.quickInputVisibility.title = true;
    settings.quickInput.insertPosition = "start";
    files.set("Existing.md", Object.assign(new TFile(), { path: "Existing.md", extension: "md" }));
    await manager.open(); setText("Body");
    editTitle("Existing"); settleTitle();
    expect(send().querySelector(".fce-quick-input-send-label")!.textContent).toBe(noteInputStrings.en.send);
    send().click();
    expect(submit).not.toHaveBeenCalled();
    const [prompt] = prompts.confirms;
    expect(prompt).toMatchObject({ isOpen: true, title: noteInputStrings.en.duplicateTitleHeading,
      content: noteInputStrings.en.duplicateTitleBody("Existing.md", noteInputStrings.en.insertBodyStart) });
    expect(prompt.buttons.map((entry) => entry.text)).toEqual([noteInputStrings.en.appendNote, noteInputStrings.en.createNumberedNote, noteInputStrings.en.cancel]);
    root().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    expect(prompts.confirms).toHaveLength(1);
    submit.mockReturnValue(new Promise(() => {}));
    prompt.click(noteInputStrings.en[button]); await tick();
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0][0]).toMatchObject({ config: { duplicateTitle, insertPosition: "start" }, expectedMode });
  });
  it("keeps the draft editable when the same-name prompt is cancelled and asks again on the next send", async () => {
    settings.quickInputVisibility.title = true;
    files.set("Existing.md", Object.assign(new TFile(), { path: "Existing.md", extension: "md" }));
    await manager.open(); setText("Body");
    editTitle("Existing"); settleTitle();
    send().click();
    state.editors[0].focus.mockClear();
    prompts.confirms[0].click(noteInputStrings.en.cancel); await tick();
    expect(submit).not.toHaveBeenCalled();
    expect(state.editors[0].focus).toHaveBeenCalledOnce();
    expect(title().disabled).toBe(false);
    expect(state.editors[0].readOnly).not.toHaveBeenCalledWith(true);
    send().click();
    expect(prompts.confirms).toHaveLength(2);
    cancel().click();
    expect(prompts.confirms[1].isOpen).toBe(false);
  });
  it("switches create/append only after the typed title settles", async () => {
    settings.quickInputVisibility.title = true;
    settings.quickInput.duplicateTitle = "append";
    files.set("Existing.md", Object.assign(new TFile(), { path: "Existing.md", extension: "md" }));
    await manager.open();
    state.editors[0].propertiesReadOnly.mockClear();
    editTitle("Existing");
    expect(state.editors[0].propertiesReadOnly).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(state.editors[0].propertiesReadOnly).toHaveBeenLastCalledWith(true);
    expect(send().querySelector(".fce-quick-input-send-label")!.textContent).toBe(noteInputStrings.en.appendNote);
  });
  it("does not send a frontmatter block left empty by an abandoned property", async () => {
    await manager.open();
    setText("---\n\n---\n");
    expect(send().disabled).toBe(true);
    setText("---\n\n---\nBody");
    submit.mockReturnValue(new Promise(() => {})); send().click();
    expect(submit.mock.calls[0][0].text).toBe("Body");
  });
  it("does not enumerate folders or boxes during long body edits", async () => {
    await manager.open();
    const app = (manager as unknown as { options: { app: App } }).options.app;
    const getFolders = vi.mocked(app.vault.getAllFolders);
    const boxes = vi.fn(() => []);
    Object.defineProperty(settings, "boxes", { get: boxes, configurable: true });
    for (let i = 0; i < 10; i++) setText("Long body ".repeat(10000) + i);
    expect(getFolders).not.toHaveBeenCalled(); expect(boxes).not.toHaveBeenCalled();
  });
});


it("lets the user reselect boxes after a missing reference blocks a pre-write submission", async () => {
  settings.quickInputVisibility.boxes = true;
  settings.boxes = [createCardBox("One", [])];
  await manager.open(); setText("Body");
  const box = settings.boxes[0];
  const boxButton = root().querySelector<HTMLButtonElement>(".fce-quick-input-boxes")!;
  const count = boxButton.querySelector<HTMLElement>(".fce-quick-input-choice-count")!;
  expect(count.hidden).toBe(true);
  boxButton.click();
  const [picker] = prompts.pickers;
  expect(picker.options).toMatchObject({ multiple: true, candidates: [{ id: box.id, name: "One" }],
    placeholder: noteInputStrings.en.chooseBoxesPlaceholder, emptyText: noteInputStrings.en.boxesEmpty });
  expect(picker.options.instructions!.map((entry) => entry.purpose)).toEqual([
    noteInputStrings.en.navigateChoices, noteInputStrings.en.toggleChoice, noteInputStrings.en.finishChoosing]);
  boxButton.click();
  expect(prompts.pickers).toHaveLength(1);
  picker.options.select(box.id);
  expect(picker.options.selected(box.id)).toBe(true);
  expect(count.hidden).toBe(false); expect(count.textContent).toBe("1");
  expect(boxButton.title).toBe(`${noteInputStrings.en.boxes} · One`);
  send().click();
  expect(submit).not.toHaveBeenCalled();
  state.editors[0].focus.mockClear();
  picker.dispose();
  expect(state.editors[0].focus).toHaveBeenCalledOnce();
  settings.boxes = [];
  submit.mockRejectedValueOnce(new QuickInputPreflightError("missing-box"));
  send().click(); await tick();
  expect(boxButton.disabled).toBe(false);
  expect(state.editors[0].readOnly).toHaveBeenLastCalledWith(false);
  boxButton.click();
  expect(prompts.pickers[1].options.candidates).toEqual([]);
  expect(count.hidden).toBe(true);
  prompts.pickers[1].dispose();
  submit.mockReturnValue(new Promise(() => {}));
  send().click();
  expect(submit.mock.calls[1][0].boxIds).toEqual([]);
  expect(submit.mock.calls[1][0].submissionId).not.toBe(submit.mock.calls[0][0].submissionId);
});

it("chooses the save folder from a native single-choice picker", async () => {
  files.set("Inbox", Object.assign(new TFolder(), { path: "Inbox" }));
  await manager.open(); setText("Body");
  const folderButton = root().querySelector<HTMLButtonElement>(".fce-quick-input-folder")!;
  folderButton.click();
  const [picker] = prompts.pickers;
  expect(picker.options).toMatchObject({ multiple: false, placeholder: noteInputStrings.en.chooseFolderPlaceholder, instructions: undefined,
    candidates: [{ id: "", name: noteInputStrings.en.rootFolder }, { id: "Inbox", name: "Inbox" }] });
  expect(picker.options.selected("")).toBe(true);
  picker.options.select("Inbox"); picker.dispose();
  expect(folderButton.title).toBe("Inbox");
  submit.mockReturnValue(new Promise(() => {})); send().click();
  expect(submit.mock.calls[0][0].config.folderPath).toBe("Inbox");
});

it("routes the property shortcut from draft-document popovers outside the editor root", async () => {
  await manager.open();
  const input = windows[0].win.document.body.createEl("input");
  input.dispatchEvent(new KeyboardEvent("keydown", { key: ";", ctrlKey: true, bubbles: true }));
  expect(state.editors[0].addMetadata).toHaveBeenCalledWith("property");
});
