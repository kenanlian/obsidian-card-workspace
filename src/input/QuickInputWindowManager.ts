import type { RuntimeActionResult } from "../runtime/platform";
import { Platform, TFile, TFolder, setIcon, type App } from "obsidian";
import type { NoteInputStrings } from "../i18n/noteInput";
import { resolveTemplateName, type NoteInputResult, type NoteTemplateDefinition, type QuickInputConfig, type QuickInputRequest } from "../note-input";
import { QUICK_INPUT_TINTS, type PluginSettings, type QuickInputTint } from "../settings";
import { QuickInputDesktopError, type QuickInputDesktop, type QuickInputDesktopWindow } from "./quick-input-desktop";
import { createNativeMarkdownEditor, type NativeMarkdownEditor } from "./native-markdown-editor";
import { installQuickInputResize } from "./quick-input-resize";
import { installQuickInputDrag } from "./quick-input-drag";

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
interface Session { displayId?: number; id: string; abort: AbortController; window: QuickInputDesktopWindow | null; draft: Draft | null; closed: boolean }
type DraftContext = Pick<QuickInputRequest, "config" | "template" | "now">;
interface QuickInputTarget {
  template: NoteTemplateDefinition | null;
  folderPath: string | null;
  insertPosition: QuickInputConfig["insertPosition"];
  valid: boolean;
}
interface Draft {
  root: HTMLDivElement;
  editor: NativeMarkdownEditor;
  destination: HTMLDivElement;
  destinationIcon: HTMLSpanElement;
  destinationText: HTMLSpanElement;
  send: HTMLButtonElement;
  sendLabel: HTMLSpanElement;
  cancel: HTMLButtonElement;
  session: Session;
  composing: boolean;
  pending: boolean;
  request: QuickInputRequest | null;
  context: DraftContext;
  templateReady: boolean;
  cleanup: Array<() => void>;
}
interface Options {
  app: App;
  desktop: QuickInputDesktop;
  getSettings: () => PluginSettings;
  getStrings: () => NoteInputStrings;
  prepareTemplate: (template: NoteTemplateDefinition, now: Date) => Promise<string>;
  submit: (request: QuickInputRequest) => Promise<NoteInputResult>;
  notify: (message: string) => void;
}

/** Owns this vault's runtime drafts; windows only host their DOM and geometry. */
export class QuickInputWindowManager {
  private readonly drafts = new Set<Draft>();
  private readonly sessions = new Map<string, Session>();
  private lastTint: QuickInputTint | null = null;
  private disposed = false;
  private sequence = 0;
  private latestOpenId = "";
  private readonly submissionPrefix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  constructor(private readonly options: Options) {}

  async open(source?: Window): Promise<RuntimeActionResult> {
    const unavailable = { outcome: "unavailable", reason: "host" } as const;
    if (this.disposed || source?.closed) return unavailable;
    let session: Session | undefined;
    let mountingEditor = false;
    let preparingTemplate = false;
    try {
      this.options.desktop.check();
      const settings = this.options.getSettings();
      const config = { ...settings.quickInput };
      const selected = settings.noteTemplates.find((entry) => entry.id === config.templateId);
      const context: DraftContext = { config, template: selected ? { ...selected } : null, now: new Date() };
      const initial = this.options.desktop.position(source, settings.quickInputWidth, settings.quickInputHeight, 0);
      const ordinal = [...this.sessions.values()].filter((current) => current.displayId === initial.displayId).length;
      const placement = ordinal ? this.options.desktop.position(source, settings.quickInputWidth, settings.quickInputHeight, ordinal) : initial;
      const id = `${this.submissionPrefix}-window-${++this.sequence}`;
      this.latestOpenId = id;
      session = { id, displayId: placement.displayId, abort: new AbortController(), window: null, draft: null, closed: false };
      this.sessions.set(id, session);
      const opened = await this.options.desktop.createWindow({ id, placement, signal: session.abort.signal });
      if (session.closed || this.disposed || opened.win.closed || opened.handle.isDestroyed()) {
        opened.dispose(); this.closeSession(session); return unavailable;
      }
      session.window = opened;
      let initialValue = "";
      let templateReady = !config.templateId;
      if (context.template && this.resolveTarget(context).valid) {
        preparingTemplate = true;
        initialValue = await this.options.prepareTemplate(context.template, context.now);
        templateReady = true;
        preparingTemplate = false;
        if (session.closed || this.disposed || opened.win.closed || opened.handle.isDestroyed()) {
          this.closeSession(session); return unavailable;
        }
      }
      mountingEditor = true;
      this.mount(session, opened.win, context, initialValue, templateReady);
      mountingEditor = false;
      // Force style/layout before the first reveal. A hidden native window may
      // never deliver rAF, even with background throttling disabled.
      await this.waitForLayout(session);
      if (session.closed || this.disposed || opened.handle.isDestroyed()) return unavailable;
      if (id === this.latestOpenId) {
        opened.handle.show();
        opened.handle.focus();
        session.draft?.editor.focus();
      } else {
        // Reveal only this late draft; do not refocus or reorder other windows.
        opened.handle.showInactive();
      }
      return { outcome: "ok", value: undefined };
    } catch (error) {
      if (preparingTemplate) {
        if (session?.closed || this.disposed) return unavailable;
        if (session) this.closeSession(session);
        this.options.notify(error instanceof Error ? error.message : String(error));
      } else this.fail(session, error, mountingEditor);
      return unavailable;
    }
  }

  private waitForLayout(session: Session): Promise<void> {
    session.draft!.root.getBoundingClientRect();
    return Promise.resolve();
  }

  private mount(session: Session, win: Window, context: DraftContext, initialValue: string, templateReady: boolean): void {
    const settings = this.options.getSettings();
    const strings = this.options.getStrings();
    const root = win.document.body.createDiv({ cls: "fce-quick-input" });
    win.document.title = strings.quickInput;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", strings.quickInput);
    root.setAttribute("aria-modal", "false");
    const tint = this.resolveTint(settings);
    root.dataset.color = tint.name;
    root.style.setProperty("--fce-quick-input-tint", tint.value);
    const top = root.createDiv({ cls: "fce-quick-input-grip" });
    const grip = top.createSpan({ cls: "fce-quick-input-grip-icon", attr: { "aria-hidden": "true" } });
    setIcon(grip, "ellipsis");
    const body = root.createDiv({ cls: "fce-quick-input-editor" });
    const footer = root.createDiv({ cls: "fce-quick-input-footer" });
    const pin = footer.createEl("button", { cls: "clickable-icon fce-quick-input-pin", attr: { type: "button", "aria-label": strings.pinWindow, "aria-pressed": "true", title: strings.pinWindow } });
    setIcon(pin, "pin");
    const destination = footer.createDiv({ cls: "fce-quick-input-destination" });
    const destinationIcon = destination.createSpan({ cls: "fce-quick-input-destination-icon" });
    destinationIcon.setAttribute("aria-hidden", "true");
    const destinationText = destination.createSpan({ cls: "fce-quick-input-destination-text" });
    const cancel = footer.createEl("button", { cls: "fce-quick-input-cancel", text: strings.cancel, attr: { type: "button" } });
    const send = footer.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
    send.setAttribute("aria-label", strings.send);
    const sendIcon = send.createSpan({ cls: "fce-quick-input-send-icon" });
    sendIcon.setAttribute("aria-hidden", "true");
    setIcon(sendIcon, "send");
    const sendLabel = send.createSpan({ cls: "fce-quick-input-send-label", text: strings.send });
    let draft: Draft | undefined;
    try {
      const editor = createNativeMarkdownEditor({ app: this.options.app, container: body, placeholder: strings.inputPlaceholder, initialValue,
        onChange: () => { if (draft) this.refresh(draft); },
        onModEnter: (event) => { if (draft) this.handleModEnter(draft, event); },
      });
      draft = { root, editor, destination, destinationIcon, destinationText, send, sendLabel, cancel,
        composing: false, pending: false, request: null, cleanup: [],
        session, context, templateReady,
      };
      const current = draft;
      this.drafts.add(current);
      session.draft = current;
      let pinned = true;
      this.listen(current, pin, "click", () => {
        if (session.closed || session.window?.handle.isDestroyed()) return;
        try {
          session.window?.handle.setAlwaysOnTop(!pinned); pinned = !pinned;
          pin.setAttribute("aria-pressed", String(pinned));
        } catch (error) { console.warn("[card-workspace] Quick input pin failed", error); this.options.notify(this.options.getStrings().desktopUnavailable); }
      });
      this.listen(current, cancel, "click", () => { if (!current.pending) this.close(current); });
      this.listen(current, send, "click", () => { void this.send(current); });
      this.listen(current, root, "compositionstart", () => { current.composing = true; this.refresh(current); });
      this.listen(current, root, "compositionend", () => { current.composing = false; this.refresh(current); });
      this.listen(current, root, "keydown", (event) => {
        const key = event as KeyboardEvent;
        if ((key.ctrlKey || key.metaKey) && !key.altKey && key.key === "Enter") this.handleModEnter(current, key);
      }, true);
      this.listen(current, root, "focusin", () => this.refresh(current));
      this.listen(current, win, "focus", () => this.refresh(current));
      this.listen(current, win, "unload", () => this.closeSession(session));
      current.cleanup.push(installQuickInputDrag({ grip: top, handle: session.window!.handle, cursor: () => this.options.desktop.cursor() }));
      current.cleanup.push(installQuickInputResize({ root, handle: session.window!.handle, cursor: () => this.options.desktop.cursor(),
        minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT }));
      this.refresh(current);
    } catch (error) {
      root.remove();
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const session of this.sessions.values()) this.closeSession(session);
  }

  private listen(draft: Draft, target: EventTarget, type: string, handler: EventListener, capture = false): void {
    target.addEventListener(type, handler, capture);
    draft.cleanup.push(() => target.removeEventListener(type, handler, capture));
  }

  /** A captured request keeps describing its own destination across later settings edits. */
  private resolveTarget(context: DraftContext): QuickInputTarget {
    const { config, template } = context;
    const folderPath = config.templateId ? template?.targetFolderPath ?? null : config.folderPath;
    const target = { template, folderPath, insertPosition: config.insertPosition, valid: false };
    if (folderPath === null || folderPath === undefined) return target;
    const folder = folderPath === "" ? this.options.app.vault.getRoot() : this.options.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) return target;
    if (template) {
      const file = this.options.app.vault.getAbstractFileByPath(template.filePath);
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") return target;
    }
    return { ...target, valid: config.insertPosition === "start" || config.insertPosition === "end" };
  }

  private resolveTint(settings: PluginSettings): { name: string; value: string } {
    const color = settings.quickInputColor;
    if (color === "accent") return { name: "accent", value: "var(--interactive-accent)" };
    let tint: QuickInputTint;
    if (color === "random") {
      const choices = QUICK_INPUT_TINTS.filter((candidate) => candidate !== this.lastTint);
      tint = choices[Math.min(choices.length - 1, Math.floor(Math.random() * choices.length))];
    } else {
      tint = color;
    }
    this.lastTint = tint;
    return { name: tint, value: `var(--color-${tint})` };
  }

  private refresh(draft: Draft): void {
    if (this.disposed || !this.drafts.has(draft)) return;
    const strings = this.options.getStrings();
    const target = this.resolveTarget(draft.context);
    target.valid = target.valid && draft.templateReady;
    draft.send.disabled = draft.pending || draft.composing || !draft.editor.getValue().trim() || !target.valid;
    draft.cancel.disabled = draft.pending;
    draft.cancel.textContent = strings.cancel;
    draft.sendLabel.textContent = draft.pending ? strings.sending : strings.send;
    draft.send.setAttribute("aria-label", draft.pending ? strings.sending : strings.send);
    const shortcut = Platform.isMacOS ? "⌘+Enter" : "Ctrl+Enter";
    draft.send.title = target.valid ? (draft.pending ? strings.sending : `${strings.send} (${shortcut})`) : strings.invalidQuickInputConfig;
    draft.root.setAttribute("aria-busy", String(draft.pending));
    this.paintDestination(draft, target, strings);
  }

  private paintDestination(draft: Draft, target: QuickInputTarget, strings: NoteInputStrings): void {
    const folderLabel = target.folderPath ? target.folderPath : strings.rootFolder;
    const icon = !target.valid ? "alert-triangle" : target.template ? "file-plus-2" : "folder";
    const text = !target.valid ? strings.destinationUnavailable
      : target.template ? `${strings.destinationTemplate} · ${resolveTemplateName(target.template)}`
      : `${strings.destinationLocation} · ${folderLabel}`;
    draft.destination.classList.toggle("is-invalid", !target.valid);
    draft.destination.title = target.valid ? folderLabel : strings.invalidQuickInputConfig;
    draft.destinationText.textContent = text;
    if (draft.destinationIcon.dataset.icon !== icon) {
      draft.destinationIcon.replaceChildren();
      setIcon(draft.destinationIcon, icon);
      draft.destinationIcon.dataset.icon = icon;
    }
  }

  private handleModEnter(draft: Draft, event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.isComposing && !draft.composing) void this.send(draft);
  }

  private send(draft: Draft): void {
    if (!this.drafts.has(draft) || draft.pending || draft.composing) return;
    if (!draft.request) draft.editor.flush();
    if (!draft.editor.getValue().trim()) return;
    const strings = this.options.getStrings();
    if (!draft.templateReady || !this.resolveTarget(draft.context).valid) { this.refresh(draft); this.options.notify(strings.invalidQuickInputConfig); return; }
    if (!draft.request) {
      draft.request = { ...draft.context, now: draft.context.template ? draft.context.now : new Date(),
        submissionId: `${this.submissionPrefix}-${++this.sequence}`, text: draft.editor.getValue() };
    }
    draft.pending = true;
    draft.editor.setReadOnly(true);
    this.refresh(draft);
    void this.submitSession(draft.session, draft.request);
  }

  /** Pending writes retain only a session token and request, never the closed UI. */
  private async submitSession(session: Session, request: QuickInputRequest): Promise<void> {
    try {
      const result = await this.options.submit(request);
      if (this.disposed || session.closed || !session.draft) return;
      this.close(session.draft);
      this.options.notify(this.options.getStrings().sent(result.file.path));
    } catch (error) {
      if (this.disposed || session.closed || !session.draft) return;
      this.options.notify(this.options.getStrings().sendFailed(error instanceof Error ? error.message : String(error)));
    } finally {
      const draft = session.draft;
      if (draft && !session.closed) { draft.pending = false; this.refresh(draft); }
    }
  }

  private fail(session: Session | undefined, error: unknown, mountingEditor = false): void {
    if (session?.closed) return;
    if (session) this.closeSession(session);
    if (this.disposed) return;
    console.warn("[card-workspace] Quick input window unavailable", error);
    const strings = this.options.getStrings();
    this.options.notify(error instanceof QuickInputDesktopError
      ? error.code === "native-frame" ? strings.nativeFrameUnsupported : strings.desktopUnavailable
      : mountingEditor ? strings.nativeEditorUnavailable : strings.openQuickInputFailed);
  }

  private close(draft: Draft): void { this.closeSession(draft.session); }

  private closeSession(session: Session): void {
    if (session.closed) return;
    session.closed = true;
    this.sessions.delete(session.id);
    const draft = session.draft;
    if (draft) {
      this.drafts.delete(draft);
      for (const cleanup of draft.cleanup) cleanup();
      try { draft.editor.dispose(); } catch (error) { console.warn("[card-workspace] Quick input editor cleanup failed", error); }
      draft.root.remove();
    }
    session.draft = null;
    try { session.window?.dispose(); }
    catch (error) { console.warn("[card-workspace] Quick input window cleanup failed", error); }
    finally { session.window = null; session.abort.abort(); }
  }
}
