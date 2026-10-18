import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Platform, TFile, TFolder, type App } from "obsidian";
import { noteInputStrings } from "../i18n/noteInput";
import { DEFAULT_SETTINGS, type PluginSettings } from "../settings";
import type { QuickInputRequest, NoteInputResult } from "../note-input";
import type { QuickInputView } from "./QuickInputView";
import { QuickInputDesktopError, type QuickInputDesktop, type QuickInputWindowHandle } from "./quick-input-desktop";
import { QuickInputWindowManager } from "./QuickInputWindowManager";
import { installObsidianDomHelpers } from "../__mocks__/obsidian-dom";

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
interface Popout { win: Window; frame: HTMLIFrameElement; handle: QuickInputWindowHandle; view: QuickInputView; detach: ReturnType<typeof vi.fn>; throttling: ReturnType<typeof vi.fn> }
let popouts: Popout[];
let desktop: QuickInputDesktop;
let transparent: boolean;
let cursor: { x: number; y: number };
let otherLeaves: QuickInputView["leaf"][];
let layoutReady: boolean;
let layoutCallbacks: Array<() => void>;
let viewReady: Promise<void> | null;
const roots = () => popouts.map((item) => item.win.document.querySelector<HTMLDivElement>(".fce-quick-input")).filter((item): item is HTMLDivElement => !!item);
const root = (index = 0) => roots()[index]!;
const send = (index = 0) => root(index).querySelector<HTMLButtonElement>("button.mod-cta")!;
const cancel = (index = 0) => root(index).querySelector<HTMLButtonElement>(".fce-quick-input-cancel")!;
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function setText(text: string, index = 0) { state.editors[index].text = text; state.editors[index].change(); }

beforeEach(() => {
  state.editors = []; state.unsupported = false;
  language = "en";
  settings = structuredClone(DEFAULT_SETTINGS);
  files = new Map([["", rootFolder]]);
  notify = vi.fn(); submit = vi.fn();
  popouts = []; otherLeaves = []; layoutReady = true; layoutCallbacks = []; viewReady = null; transparent = false; cursor = { x: 0, y: 0 };
  desktop = { check: vi.fn(), handle: vi.fn((win: Window) => popouts.find((item) => item.win === win)!.handle),
    openPopout: vi.fn((open) => ({ value: open(), transparent })), cursor: vi.fn(() => cursor),
    position: vi.fn((_source, width, height, ordinal) => ({ x: 100 + ordinal * 24, y: 100 + ordinal * 24, width, height })), setCornerRadius: vi.fn(), shortcuts: vi.fn() };
  const workspace = {
    iterateAllLeaves: (callback: (leaf: QuickInputView["leaf"]) => void) => [...popouts.filter((item) => !item.detach.mock.calls.length).map((item) => item.view.leaf), ...otherLeaves].forEach(callback),
    onLayoutReady: (callback: () => void) => { if (layoutReady) callback(); else layoutCallbacks.push(callback); },
    openPopoutLeaf: vi.fn(() => {
      const frame = document.createElement("iframe"); document.body.append(frame);
      const win = frame.contentWindow!; installObsidianDomHelpers(win.document);
      let destroyed = false;
      const throttling = vi.fn();
      const handle: QuickInputWindowHandle = { isDestroyed: () => destroyed, hide: vi.fn(), show: vi.fn(), focus: vi.fn(), moveTop: vi.fn(),
        setParentWindow: vi.fn(), setAlwaysOnTop: vi.fn(), setMinimumSize: vi.fn(), setContentSize: vi.fn(),
        getBounds: () => ({ x: 100, y: 100, width: 480, height: 270 }), getContentBounds: () => ({ x: 100, y: 100, width: 480, height: 270 }),
        setPosition: vi.fn(), setBounds: vi.fn(), setOpacity: vi.fn(), setShape: vi.fn(), setWindowButtonVisibility: vi.fn(),
        webContents: { getZoomFactor: () => 1, setBackgroundThrottling: throttling } };
      const detach = vi.fn(() => { manager.closeView(view); destroyed = true; });
      const leaf = { getContainer: () => ({ win }), detach,
        setViewState: vi.fn(async (state: { state: { sessionId: string } }) => {
          if (viewReady) await viewReady;
          manager.attach(state.state.sessionId, view);
        }) };
      const view = { leaf, contentEl: win.document.body.createDiv() } as unknown as QuickInputView;
      popouts.push({ frame, win, handle, view, detach, throttling });
      return leaf;
    }),
  };
  manager = new QuickInputWindowManager({
    desktop,
    app: { workspace, vault: { getRoot: () => rootFolder, getAbstractFileByPath: (path: string) => files.get(path) ?? null } } as unknown as App,
    getSettings: () => settings, getStrings: () => noteInputStrings[language], notify, submit,
  });
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 768, configurable: true });
});
afterEach(() => { manager.dispose(); Object.assign(Platform, { isMacOS: false, isWin: false }); document.body.replaceChildren(); vi.restoreAllMocks(); });

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
  it("opens independent blank drafts each time, keeps them on blur, and cancels only the chosen draft", async () => {
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
    manager.open(window); expect(state.editors[3].text).toBe("");
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
    expect(roots()).toHaveLength(1);
    expect(state.editors[2].text).toBe("later"); expect(state.editors[2].dispose).not.toHaveBeenCalled();
    expect(send().disabled).toBe(false);
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
    expect(root()).toBeUndefined(); expect(notify).toHaveBeenCalledWith("Sent to note.md");
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
    expect(root()).toBeUndefined();
  });

  it("captures the selected template and stops unavailable configuration without losing draft", async () => {
    settings.quickInput.templateId = "template";
    settings.noteTemplates = [{ id: "template", filePath: "template.md", targetFolderPath: null, dateFormat: "YYYY", timeFormat: "HH" }];
    manager.open(window); setText("draft"); expect(send().disabled).toBe(true);
    settings.noteTemplates[0].targetFolderPath = "";
    files.set("template.md", Object.assign(new TFile(), { path: "template.md", extension: "md" }));
    popouts.forEach(({ win }) => win.dispatchEvent(new Event("focus"))); expect(send().disabled).toBe(false);
    submit.mockRejectedValue(new Error("fail")); send().click(); await tick();
    const captured = submit.mock.calls[0][0] as QuickInputRequest;
    settings.noteTemplates[0].dateFormat = "YYYY-MM";
    expect(captured.template!.dateFormat).toBe("YYYY");
    files.delete("template.md"); popouts.forEach(({ win }) => win.dispatchEvent(new Event("focus"))); expect(send().disabled).toBe(true);
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
    manager.open(window); expect(root()).toBeUndefined();
    expect(notify).toHaveBeenCalledWith(noteInputStrings.en.nativeEditorUnavailable);
    expect(state.editors).toHaveLength(0);
    expect(document.querySelector(".fce-quick-input-layer")).toBeNull();
  });

  it("keeps existing drafts when another native editor fails to initialize", () => {
    manager.open(window); setText("keep");
    vi.spyOn(console, "warn").mockImplementation(() => {}); state.unsupported = true;
    manager.open(window);
    expect(roots()).toHaveLength(1);
    expect(state.editors[0].text).toBe("keep"); expect(state.editors[0].dispose).not.toHaveBeenCalled();
    expect(popouts.filter((item) => item.win.document.documentElement.classList.contains("fce-quick-input-window"))).toHaveLength(1);
    expect(send().disabled).toBe(false);
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
    popouts.forEach(({ win }) => win.dispatchEvent(new Event("focus")));
    expect(destination().textContent).toBe(`${strings.destinationLocation} · Inbox`);
    expect(destination().title).toBe("Inbox"); expect(destination().classList.contains("is-invalid")).toBe(false);
    files.set("Journal", Object.assign(new TFolder(), { path: "Journal" }));
    files.set("Templates/daily.md", Object.assign(new TFile(), { path: "Templates/daily.md", extension: "md" }));
    settings.noteTemplates = [{ id: "daily", name: "Daily", filePath: "Templates/daily.md", targetFolderPath: "Journal", dateFormat: "YYYY", timeFormat: "HH" }];
    settings.quickInput = { templateId: "daily", folderPath: "", insertPosition: "end" };
    popouts.forEach(({ win }) => win.dispatchEvent(new Event("focus")));
    expect(destination().textContent).toBe(`${strings.destinationTemplate} · Daily`);
    expect(destination().title).toBe("Journal"); expect(icon()).toBe("file-plus-2");
    settings.quickInput = { templateId: "missing", folderPath: "", insertPosition: "end" };
    popouts.forEach(({ win }) => win.dispatchEvent(new Event("focus")));
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
    popouts.forEach(({ win }) => win.dispatchEvent(new Event("focus")));
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
  it("configures and focuses only the newly created native window at the content size", async () => {
    manager.open(window); manager.open(); await tick();
    for (const popout of popouts) {
      expect(popout.handle.hide).toHaveBeenCalledOnce();
      expect(popout.handle.setParentWindow).toHaveBeenCalledExactlyOnceWith(null);
      expect(popout.handle.setContentSize).toHaveBeenCalledExactlyOnceWith(480, 270);
      expect(popout.handle.setMinimumSize).toHaveBeenCalledExactlyOnceWith(320, 200);
      expect(popout.handle.setAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(false);
      expect(popout.handle.show).toHaveBeenCalledOnce(); expect(popout.handle.focus).toHaveBeenCalledOnce();
      expect(vi.mocked(popout.handle.hide).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(popout.handle.show).mock.invocationCallOrder[0]!);
      expect(popout.win.document.documentElement.classList.contains("fce-quick-input-window")).toBe(true);
    }
    expect(desktop.position).toHaveBeenCalledWith(undefined, 480, 270, 1);
    expect(document.documentElement.classList.contains("fce-quick-input-window")).toBe(false);
    expect(root().querySelector(".fce-quick-input-resize")).toBeNull();
  });

  it.each(["en", "zh"] as const)("places the %s pin before the destination and keeps the grip free of buttons", (locale) => {
    language = locale;
    manager.open(window);
    expect(root().querySelector(".fce-quick-input-grip button")).toBeNull();
    expect(root().querySelectorAll("button")).toHaveLength(3);
    const pin = root().querySelector<HTMLButtonElement>(".fce-quick-input-pin")!;
    expect(pin.parentElement?.className).toBe("fce-quick-input-footer");
    expect(pin.nextElementSibling?.className).toBe("fce-quick-input-destination");
    expect(pin.getAttribute("aria-label")).toBe(noteInputStrings[locale].pinWindow);
    expect(pin.title).toBe(noteInputStrings[locale].pinWindow);
  });

  it("pins and cancels only the chosen window and never persists topmost state", () => {
    manager.open(window); manager.open(window);
    const first = popouts[0], second = popouts[1];
    const pin = root().querySelector<HTMLButtonElement>('[aria-pressed]')!;
    pin.click(); expect(pin.getAttribute("aria-pressed")).toBe("true");
    expect(first.handle.setAlwaysOnTop).toHaveBeenLastCalledWith(true);
    expect(second.handle.setAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(false);
    cancel().click();
    expect(first.detach).toHaveBeenCalledOnce(); expect(second.detach).not.toHaveBeenCalled();
    expect(state.editors[1].dispose).not.toHaveBeenCalled();
    manager.open(window); expect(popouts[2].handle.setAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("continues a submitted write after the OS closes its window without touching later drafts", async () => {
    let resolve!: (result: NoteInputResult) => void;
    submit.mockReturnValue(new Promise((done) => { resolve = done; }));
    manager.open(window); setText("submitted"); send().click();
    expect(cancel().disabled).toBe(true);
    popouts[0].win.dispatchEvent(new Event("unload"));
    manager.closeView(popouts[0].view); manager.handleWindowClosed(popouts[0].win);
    manager.open(window); setText("later", 1);
    resolve({ file: Object.assign(new TFile(), { path: "saved.md" }), created: true }); await tick();
    expect(notify).not.toHaveBeenCalled(); expect(state.editors[0].dispose).toHaveBeenCalledOnce();
    expect(state.editors[1].dispose).not.toHaveBeenCalled(); expect(state.editors[1].text).toBe("later");
    expect(popouts[1].detach).not.toHaveBeenCalled();
  });

  it("cleans a restored invalid session only after layout readiness without making an editor", () => {
    manager.open(window); const existing = popouts[0];
    layoutReady = false;
    const detach = vi.fn();
    manager.attach("stale-session-from-layout", { leaf: { detach } } as unknown as QuickInputView);
    expect(detach).not.toHaveBeenCalled();
    layoutReady = true; layoutCallbacks.forEach((callback) => callback());
    expect(detach).toHaveBeenCalledOnce();
    expect(state.editors).toHaveLength(1); expect(existing.detach).not.toHaveBeenCalled();
    expect(manager.ownsLeaf(existing.view.leaf)).toBe(true);
  });

  it("blocks unsupported frames before opening any window", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(desktop.check).mockImplementation(() => { throw new QuickInputDesktopError("native-frame"); });
    manager.open(window); expect(popouts).toHaveLength(0); expect(state.editors).toHaveLength(0);
    expect(notify).toHaveBeenCalledExactlyOnceWith(noteInputStrings.en.nativeFrameUnsupported);
  });

  it("does not show an unfinished window when unload wins the initialization race", async () => {
    manager.open(window); manager.dispose(); await tick();
    expect(popouts[0].handle.show).not.toHaveBeenCalled();
    expect(popouts[0].detach).toHaveBeenCalledOnce(); expect(state.editors[0].dispose).toHaveBeenCalledOnce();
  });

  it("restores host chrome in a mixed window and detaches only its owned leaf", () => {
    Object.assign(Platform, { isMacOS: true }); manager.open(window);
    const popout = popouts[0];
    expect(popout.handle.setWindowButtonVisibility).toHaveBeenLastCalledWith(false);
    const unrelated = { getContainer: () => ({ win: popout.win }), detach: vi.fn() } as unknown as QuickInputView["leaf"];
    otherLeaves.push(unrelated); manager.reconcileWindows();
    expect(popout.win.document.documentElement.classList.contains("fce-quick-input-window")).toBe(false);
    expect(popout.handle.setWindowButtonVisibility).toHaveBeenLastCalledWith(true);
    manager.dispose(); expect(unrelated.detach).not.toHaveBeenCalled(); expect(popout.detach).toHaveBeenCalledOnce();
  });

  it("cleans only the failed window when the explicit desktop handle is unavailable", () => {
    manager.open(window); setText("keep");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(desktop.handle).mockImplementationOnce(() => { throw new QuickInputDesktopError("unavailable"); });
    manager.open(window);
    expect(popouts[1].detach).toHaveBeenCalledOnce(); expect(popouts[0].detach).not.toHaveBeenCalled();
    expect(state.editors).toHaveLength(1); expect(state.editors[0].text).toBe("keep");
    expect(notify).toHaveBeenCalledWith(noteInputStrings.en.desktopUnavailable);
  });

  it("ignores a late native-editor notification after its window has closed", () => {
    manager.open(window); manager.handleWindowClosed(popouts[0].win);
    Object.defineProperty(state.editors[0], "text", { get: () => { throw new Error("Closed editor touched"); } });
    expect(() => state.editors[0].change()).not.toThrow();
  });

  it("raises earlier drafts above the entry window without focusing them or changing pins", async () => {
    manager.open(window); await tick();
    const first = popouts[0];
    root().querySelector<HTMLButtonElement>('[aria-pressed]')!.click();
    vi.mocked(first.handle.focus).mockClear(); vi.mocked(first.handle.setAlwaysOnTop).mockClear();
    manager.open(window); await tick();
    const second = popouts[1];
    expect(first.handle.moveTop).toHaveBeenCalledTimes(2); expect(first.handle.focus).not.toHaveBeenCalled();
    expect(first.handle.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(root().querySelector('[aria-pressed]')!.getAttribute("aria-pressed")).toBe("true");
    expect(vi.mocked(first.handle.moveTop).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(second.handle.show).mock.invocationCallOrder[0]!);
    manager.open(); await tick();
    expect(first.handle.moveTop).toHaveBeenCalledTimes(4); expect(second.handle.moveTop).toHaveBeenCalledTimes(2);
    expect(second.handle.setAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(false);
    expect(popouts[2].handle.focus).toHaveBeenCalledOnce();
  });

  it("keeps earlier drafts raised throughout a delayed window initialization without hiding or showing them again", async () => {
    manager.open(window); await tick();
    const first = popouts[0];
    let finish!: () => void;
    viewReady = new Promise((resolve) => { finish = resolve; });
    manager.open(window);
    const second = popouts[1];
    const raises = vi.mocked(first.handle.moveTop).mock.invocationCallOrder;
    expect(raises).toHaveLength(2);
    expect(raises[0]).toBeLessThan(vi.mocked(second.handle.hide).mock.invocationCallOrder[0]!);
    expect(raises[1]).toBeGreaterThan(vi.mocked(second.handle.hide).mock.invocationCallOrder[0]!);
    expect(raises[1]).toBeLessThan(vi.mocked(second.view.leaf.setViewState).mock.invocationCallOrder[0]!);
    expect(second.handle.show).not.toHaveBeenCalled();
    expect(first.handle.hide).toHaveBeenCalledOnce(); expect(first.handle.show).toHaveBeenCalledOnce();
    expect(state.editors).toHaveLength(1); expect(first.detach).not.toHaveBeenCalled();
    finish(); await tick();
    expect(second.handle.show).toHaveBeenCalledOnce(); expect(second.handle.focus).toHaveBeenCalledOnce();
    expect(first.handle.moveTop).toHaveBeenCalledTimes(2);
    expect(first.handle.hide).toHaveBeenCalledOnce(); expect(first.handle.show).toHaveBeenCalledOnce();
  });

  it("leaves mixed-content windows alone and continues opening if an older handle cannot be raised", async () => {
    manager.open(window); manager.open(window); await tick();
    popouts[0].win.document.documentElement.classList.remove("fce-quick-input-window");
    vi.mocked(popouts[0].handle.moveTop).mockClear();
    vi.mocked(popouts[1].handle.moveTop).mockImplementation(() => { throw new Error("closing"); });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    manager.open(window); await tick();
    expect(popouts[0].handle.moveTop).not.toHaveBeenCalled();
    expect(popouts[2].handle.show).toHaveBeenCalledOnce(); expect(popouts[2].handle.focus).toHaveBeenCalledOnce();
    expect(popouts[2].detach).not.toHaveBeenCalled();
  });

  it.each(["isWin", "isMacOS"] as const)("conceals new %s windows with opacity without hiding or reshowing native windows", async (platform) => {
    Object.assign(Platform, { [platform]: true });
    manager.open(window); await tick();
    const first = popouts[0];
    expect(first.handle.hide).not.toHaveBeenCalled(); expect(first.handle.show).not.toHaveBeenCalled();
    expect(first.handle.setOpacity).toHaveBeenNthCalledWith(1, 0);
    expect(first.handle.setOpacity).toHaveBeenNthCalledWith(2, 1);
    vi.mocked(first.handle.moveTop).mockClear();
    // The host relays its own body classes while opening/focusing another popout.
    first.win.document.body.className = "theme-dark is-frameless is-popout-window";
    expect(first.win.document.documentElement.classList.contains("fce-quick-input-window")).toBe(true);
    let finish!: () => void;
    viewReady = new Promise((resolve) => { finish = resolve; });
    manager.open(window);
    const second = popouts[1];
    expect(first.handle.moveTop).toHaveBeenCalledTimes(2);
    expect(first.handle.setOpacity).toHaveBeenCalledTimes(2);
    expect(second.handle.hide).not.toHaveBeenCalled(); expect(second.handle.show).not.toHaveBeenCalled();
    expect(second.handle.setOpacity).toHaveBeenCalledExactlyOnceWith(0);
    finish(); await tick();
    expect(second.handle.setOpacity).toHaveBeenLastCalledWith(1);
    expect(second.handle.moveTop).toHaveBeenCalledOnce();
    expect(second.handle.focus).toHaveBeenCalledOnce();
    expect(first.handle.moveTop).toHaveBeenCalledTimes(2);
    expect(first.handle.hide).not.toHaveBeenCalled(); expect(first.handle.show).not.toHaveBeenCalled();
  });

  it("uses the send button's radius and updates the shape on resize, then restores a mixed window", () => {
    manager.open(window);
    const first = popouts[0];
    send().style.borderTopLeftRadius = "32px";
    first.win.dispatchEvent(new Event("resize"));
    expect(desktop.setCornerRadius).toHaveBeenLastCalledWith(first.win, 32);
    const unrelated = { getContainer: () => ({ win: first.win }), detach: vi.fn() } as unknown as QuickInputView["leaf"];
    otherLeaves.push(unrelated); manager.reconcileWindows();
    expect(desktop.setCornerRadius).toHaveBeenLastCalledWith(first.win, null);
    vi.mocked(desktop.setCornerRadius).mockClear(); first.win.dispatchEvent(new Event("resize"));
    expect(desktop.setCornerRadius).not.toHaveBeenCalled();
    otherLeaves = []; manager.reconcileWindows();
    expect(desktop.setCornerRadius).toHaveBeenLastCalledWith(first.win, 32);
    manager.dispose();
    expect(desktop.setCornerRadius).toHaveBeenLastCalledWith(first.win, null);
    vi.mocked(desktop.setCornerRadius).mockClear(); first.win.dispatchEvent(new Event("resize"));
    expect(desktop.setCornerRadius).not.toHaveBeenCalled();
  });

  it("draws transparent Windows drafts without native concealment or regions and resizes them from edge handles", async () => {
    Object.assign(Platform, { isWin: true }); transparent = true;
    manager.open(window); await tick();
    const first = popouts[0], html = first.win.document.documentElement;
    expect(html.classList.contains("fce-quick-input-window")).toBe(true);
    expect(html.classList.contains("fce-quick-input-transparent")).toBe(true);
    expect(first.handle.setOpacity).not.toHaveBeenCalled();
    expect(first.handle.hide).not.toHaveBeenCalled(); expect(first.handle.show).not.toHaveBeenCalled();
    expect(first.handle.moveTop).toHaveBeenCalledOnce(); expect(first.handle.focus).toHaveBeenCalledOnce();
    expect(state.editors[0].focus).toHaveBeenCalledOnce();
    first.win.dispatchEvent(new Event("resize")); first.win.dispatchEvent(new Event("focus"));
    expect(desktop.setCornerRadius).not.toHaveBeenCalled();

    const handles = Array.from(root().querySelectorAll<HTMLElement>(".fce-quick-input-resize"));
    expect(handles.map((el) => el.dataset.edge)).toEqual(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);
    const pointer = (type: string, button = 0, pointerId = 1) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button });
      Object.defineProperty(event, "pointerId", { value: pointerId });
      return event;
    };
    const nw = root().querySelector<HTMLElement>('[data-edge="nw"]')!;
    cursor = { x: 500, y: 300 }; nw.dispatchEvent(pointer("pointerdown"));
    cursor = { x: 450, y: 280 }; nw.dispatchEvent(pointer("pointermove"));
    expect(first.handle.setBounds).toHaveBeenLastCalledWith({ x: 50, y: 80, width: 530, height: 290 });
    nw.dispatchEvent(pointer("pointermove", 0, 2));
    expect(first.handle.setBounds).toHaveBeenCalledOnce();
    cursor = { x: 900, y: 600 }; nw.dispatchEvent(pointer("pointerup"));
    expect(first.handle.setBounds).toHaveBeenLastCalledWith({ x: 260, y: 170, width: 320, height: 200 });
    nw.dispatchEvent(pointer("pointermove"));
    nw.dispatchEvent(pointer("pointerdown", 2)); nw.dispatchEvent(pointer("pointermove"));
    expect(first.handle.setBounds).toHaveBeenCalledTimes(2);

    cancel().click();
    expect(html.classList.contains("fce-quick-input-transparent")).toBe(false);
    expect(first.throttling).toHaveBeenLastCalledWith(true);
  });

  it("keeps quick-input windows drawing while covered and restores throttling when mixed or closed", () => {
    manager.open(window);
    const first = popouts[0];
    expect(first.throttling).toHaveBeenCalledExactlyOnceWith(false);
    expect(root().querySelector(".fce-quick-input-resize")).toBeNull();
    manager.reconcileWindows(); expect(first.throttling).toHaveBeenCalledOnce();
    const unrelated = { getContainer: () => ({ win: first.win }), detach: vi.fn() } as unknown as QuickInputView["leaf"];
    otherLeaves.push(unrelated); manager.reconcileWindows();
    expect(first.throttling).toHaveBeenLastCalledWith(true);
    manager.reconcileWindows(); expect(first.throttling).toHaveBeenCalledTimes(2);
    otherLeaves = []; manager.reconcileWindows();
    expect(first.throttling).toHaveBeenLastCalledWith(false);
    cancel().click();
    expect(first.throttling).toHaveBeenLastCalledWith(true); expect(first.throttling).toHaveBeenCalledTimes(4);
  });
});
