import { Platform, TFile, TFolder, setIcon, type App, type WorkspaceLeaf } from "obsidian";
import type { NoteInputStrings } from "../i18n/noteInput";
import { resolveTemplateName, type NoteInputResult, type NoteTemplateDefinition, type QuickInputConfig, type QuickInputRequest } from "../note-input";
import { QUICK_INPUT_TINTS, type PluginSettings, type QuickInputTint } from "../settings";
import type { QuickInputView } from "./QuickInputView";
import { QUICK_INPUT_VIEW, QuickInputDesktopError, type QuickInputDesktop, type QuickInputWindowHandle } from "./quick-input-desktop";
import { createNativeMarkdownEditor, type NativeMarkdownEditor } from "./native-markdown-editor";
import { installQuickInputResize } from "./quick-input-resize";

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
interface Session { displayId?: number; id: string; leaf: WorkspaceLeaf | null; win: Window | null; handle: QuickInputWindowHandle | null; draft: Draft | null; closed: boolean; usesOpacity: boolean; transparent: boolean }
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
  cleanup: Array<() => void>;
}
interface Options {
  app: App;
  desktop: QuickInputDesktop;
  getSettings: () => PluginSettings;
  getStrings: () => NoteInputStrings;
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
  private readonly submissionPrefix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  constructor(private readonly options: Options) {}

  open(source?: Window): void {
    if (this.disposed || source?.closed) return;
    let session: Session | undefined;
    try {
      this.options.desktop.check();
      this.raiseExistingWindows();
      const settings = this.options.getSettings();
      const initial = this.options.desktop.position(source, settings.quickInputWidth, settings.quickInputHeight, 0);
      const ordinal = [...this.sessions.values()].filter((current) => current.displayId === initial.displayId).length;
      const geometry = ordinal ? this.options.desktop.position(source, settings.quickInputWidth, settings.quickInputHeight, ordinal) : initial;
      const id = `${this.submissionPrefix}-window-${++this.sequence}`;
      session = { id, displayId: geometry.displayId, leaf: null, win: null, handle: null, draft: null, closed: false, usesOpacity: false, transparent: false };
      this.sessions.set(id, session);
      const opened = this.options.desktop.openPopout(() => this.options.app.workspace.openPopoutLeaf({ x: geometry.x, y: geometry.y, size: { width: geometry.width, height: geometry.height } }));
      const leaf = session.leaf = opened.value;
      session.transparent = opened.transparent;
      const win = session.win = leaf.getContainer().win;
      const handle = session.handle = this.options.desktop.handle(win);
      // Keep drawing while the entry window covers this draft, so raising it later
      // does not wait for a frame from the renderer that is building the next draft.
      handle.webContents?.setBackgroundThrottling?.(false);
      // The host already showed this popout. A transparent window keeps its initial
      // content invisible through CSS; otherwise conceal it without hiding the native
      // window and reactivating the entry window underneath.
      if (!session.transparent) {
        session.usesOpacity = (Platform.isWin || Platform.isMacOS) && typeof handle.setOpacity === "function";
        if (session.usesOpacity) handle.setOpacity!(0);
        else handle.hide();
      }
      this.raiseExistingWindows();
      // Obsidian replaces popout body.className when synchronizing host focus/theme.
      win.document.documentElement.classList.add("fce-quick-input-window");
      win.document.documentElement.classList.toggle("fce-quick-input-transparent", session.transparent);
      handle.setParentWindow(null);
      handle.setAlwaysOnTop(false);
      handle.setMinimumSize(MIN_WIDTH, MIN_HEIGHT);
      handle.setContentSize(geometry.width, geometry.height);
      const bounds = handle.getBounds();
      const fitted = this.options.desktop.position(source, bounds.width, bounds.height, ordinal);
      if (bounds.width > fitted.width || bounds.height > fitted.height) {
        handle.setContentSize(Math.max(1, geometry.width - (bounds.width - fitted.width)), Math.max(1, geometry.height - (bounds.height - fitted.height)));
      }
      handle.setPosition(fitted.x, fitted.y);
      if (Platform.isMacOS) {
        if (!handle.setWindowButtonVisibility) throw new QuickInputDesktopError("unavailable");
        handle.setWindowButtonVisibility(false);
      }
      const current = session;
      void leaf.setViewState({ type: QUICK_INPUT_VIEW, state: { sessionId: id }, active: true }).then(() => {
        if (current.closed || this.disposed || handle.isDestroyed()) return;
        if (!current.draft) throw new QuickInputDesktopError("unavailable");
        if (current.usesOpacity) { handle.moveTop(); handle.setOpacity!(1); }
        else if (current.transparent) handle.moveTop();
        else handle.show();
        handle.focus(); current.draft.editor.focus();
      }).catch((error: unknown) => this.fail(current, error));
    } catch (error) { this.fail(session, error); }
  }

  /** Clicking an entry point raises the host first. Bring older drafts back above it
   * without focusing them or changing their independent always-on-top settings. */
  private raiseExistingWindows(): void {
    for (const session of this.sessions.values()) {
      if (session.closed || !session.draft || !session.handle
        || !session.win?.document.documentElement.classList.contains("fce-quick-input-window")) continue;
      try { if (!session.handle.isDestroyed()) session.handle.moveTop(); }
      catch (error) { console.warn("[card-workspace] Quick input window raise failed", error); }
    }
  }

  attach(sessionId: string, view: QuickInputView): void {
    const session = this.sessions.get(sessionId);
    if (session?.draft && session.leaf === view.leaf) return;
    if (!session || session.closed || session.leaf !== view.leaf || !session.win || session.draft) {
      this.options.app.workspace.onLayoutReady(() => { if (!this.disposed) view.leaf.detach(); });
      return;
    }
    const win = session.win;
    const settings = this.options.getSettings();
    const strings = this.options.getStrings();
    const root = view.contentEl.createDiv({ cls: "fce-quick-input" });
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
    const pin = footer.createEl("button", { cls: "clickable-icon fce-quick-input-pin", attr: { type: "button", "aria-label": strings.pinWindow, "aria-pressed": "false", title: strings.pinWindow } });
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
      const editor = createNativeMarkdownEditor({ app: this.options.app, container: body, placeholder: strings.inputPlaceholder,
        onChange: () => { if (draft) this.refresh(draft); },
        onModEnter: (event) => { if (draft) this.handleModEnter(draft, event); },
      });
      draft = { root, editor, destination, destinationIcon, destinationText, send, sendLabel, cancel,
        composing: false, pending: false, request: null, cleanup: [],
        session,
      };
      const current = draft;
      this.drafts.add(current);
      session.draft = current;
      let pinned = false;
      this.listen(current, pin, "click", () => {
        if (session.closed || session.handle?.isDestroyed()) return;
        try {
          session.handle?.setAlwaysOnTop(!pinned); pinned = !pinned;
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
      const updateCorners = () => {
        try { this.updateCorners(current); }
        catch (error) { console.warn("[card-workspace] Quick input window shape update failed", error); }
      };
      this.listen(current, win, "focus", () => { this.refresh(current); updateCorners(); });
      this.listen(current, win, "resize", updateCorners);
      this.listen(current, win, "unload", () => this.closeSession(session, false));
      if (session.transparent && session.handle) {
        current.cleanup.push(installQuickInputResize({ root, handle: session.handle, cursor: () => this.options.desktop.cursor(),
          minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT }));
      }
      this.updateCorners(current);
      this.refresh(current);
    } catch (error) {
      root.remove();
      this.closeSession(session);
      console.warn("[card-workspace] Native quick input unavailable", error);
      this.options.notify(error instanceof QuickInputDesktopError ? strings.desktopUnavailable : strings.nativeEditorUnavailable);
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

  private updateCorners(draft: Draft): void {
    const { win, closed, transparent } = draft.session;
    if (transparent || closed || this.disposed || !win?.document.documentElement.classList.contains("fce-quick-input-window")) return;
    const radius = parseFloat(win.getComputedStyle(draft.send).borderTopLeftRadius);
    this.options.desktop.setCornerRadius(win, Number.isFinite(radius) ? radius : 24);
  }

  /** A captured request keeps describing its own destination across later settings edits. */
  private resolveTarget(request?: QuickInputRequest | null): QuickInputTarget {
    const settings = this.options.getSettings();
    const config = request?.config ?? settings.quickInput;
    const template = request?.template
      ?? (config.templateId ? settings.noteTemplates.find((entry) => entry.id === config.templateId) ?? null : null);
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
    const target = this.resolveTarget(draft.request);
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
    if (!this.drafts.has(draft) || draft.pending || draft.composing || !draft.editor.getValue().trim()) return;
    const strings = this.options.getStrings();
    if (!this.resolveTarget(draft.request).valid) { this.refresh(draft); this.options.notify(strings.invalidQuickInputConfig); return; }
    if (!draft.request) {
      const settings = this.options.getSettings();
      const config = { ...settings.quickInput };
      const template = config.templateId ? settings.noteTemplates.find((entry) => entry.id === config.templateId)! : null;
      draft.request = { submissionId: `${this.submissionPrefix}-${++this.sequence}`, text: draft.editor.getValue(), config,
        template: template ? { ...template } : null, now: new Date() };
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

  ownsLeaf(leaf: WorkspaceLeaf): boolean {
    return [...this.sessions.values()].some((session) => session.leaf === leaf);
  }

  handleWindowClosed(win: Window): void {
    for (const session of this.sessions.values()) if (session.win === win) this.closeSession(session, false);
  }

  /** If another leaf joins, restore host chrome and never close its window. */
  reconcileWindows(): void {
    for (const session of this.sessions.values()) {
      if (!session.leaf || !session.win || !session.handle || session.handle.isDestroyed()) continue;
      if (session.leaf.getContainer().win !== session.win) { this.closeSession(session); continue; }
      let exclusive = true;
      this.options.app.workspace.iterateAllLeaves((leaf) => {
        if (leaf !== session.leaf && leaf.getContainer().win === session.win) exclusive = false;
      });
      const classes = session.win.document.documentElement.classList;
      if (classes.contains("fce-quick-input-window") !== exclusive) session.handle.webContents?.setBackgroundThrottling?.(!exclusive);
      classes.toggle("fce-quick-input-window", exclusive);
      if (exclusive && session.draft) this.updateCorners(session.draft);
      else if (!exclusive) {
        this.options.desktop.setCornerRadius(session.win, null);
        if (session.usesOpacity) session.handle.setOpacity!(1);
      }
      if (Platform.isMacOS) session.handle.setWindowButtonVisibility?.(!exclusive);
    }
  }

  closeView(view: QuickInputView): void {
    for (const session of this.sessions.values()) {
      if (session.leaf === view.leaf) this.closeSession(session, false);
    }
  }

  private fail(session: Session | undefined, error: unknown): void {
    if (session?.closed) return;
    if (session) this.closeSession(session);
    if (this.disposed) return;
    console.warn("[card-workspace] Quick input window unavailable", error);
    const strings = this.options.getStrings();
    this.options.notify(error instanceof QuickInputDesktopError
      ? error.code === "native-frame" ? strings.nativeFrameUnsupported : strings.desktopUnavailable
      : strings.openQuickInputFailed);
  }

  private close(draft: Draft): void { this.closeSession(draft.session); }

  private closeSession(session: Session, detach = true): void {
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
    try {
      session.win?.document.documentElement.classList.remove("fce-quick-input-window", "fce-quick-input-transparent");
      if (session.handle && !session.handle.isDestroyed()) {
        if (session.win) this.options.desktop.setCornerRadius(session.win, null);
        session.handle.webContents?.setBackgroundThrottling?.(true);
        session.handle.setAlwaysOnTop(false);
        if (Platform.isMacOS) session.handle.setWindowButtonVisibility?.(true);
      }
    } catch (error) { console.warn("[card-workspace] Quick input window cleanup failed", error); }
    // Detaching only our leaf lets Obsidian close an empty popout. Other leaves survive.
    try { if (detach) session.leaf?.detach(); }
    catch (error) { console.warn("[card-workspace] Quick input leaf cleanup failed", error); }
    finally { session.draft = null; session.handle = null; session.win = null; session.leaf = null; }
  }
}
