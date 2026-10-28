import { Platform, setIcon, setTooltip, type App } from "obsidian";
import type { NoteInputStrings } from "../i18n/noteInput";
import { normalizeQuickInputVisibility, type QuickInputVisibility, type PreparedQuickInput, type QuickInputMode, type NoteInputResult, type NoteTemplateDefinition, type QuickInputConfig, type QuickInputRequest } from "../note-input";
import { NoteCreationService, QuickInputPreflightError } from "../services/NoteCreationService";
import { QuickInputBoxesSaveError } from "../services/QuickInputSubmissionCoordinator";
import { openQuickInputSuggest } from "./quick-input-suggest";
import { QUICK_INPUT_TINTS, type PluginSettings, type QuickInputTint } from "../settings";
import { QuickInputDesktopError, type QuickInputDesktop, type QuickInputDesktopWindow } from "./quick-input-desktop";
import { createNativeMarkdownEditor, type NativeMarkdownEditor } from "./native-markdown-editor";
import { installQuickInputResize } from "./quick-input-resize";
import { installQuickInputDrag } from "./quick-input-drag";

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
interface Session { displayId?: number; id: string; abort: AbortController; window: QuickInputDesktopWindow | null; draft: Draft | null; closed: boolean }
type DraftContext = Pick<QuickInputRequest, "config" | "template" | "now" | "target" | "templateSource">;
interface QuickInputTarget {
  template: NoteTemplateDefinition | null;
  folderPath: string | null;
  insertPosition: QuickInputConfig["insertPosition"];
  valid: boolean;
  mode: QuickInputMode;
}
interface Draft {
  visibility: QuickInputVisibility;
  title: HTMLInputElement | null;
  defaultTitle: string;
  folderButton: HTMLButtonElement;
  boxButton: HTMLButtonElement;
  tagButton: HTMLButtonElement;
  propertyButton: HTMLButtonElement;
  hint: HTMLSpanElement;
  boxIds: string[];
  target: QuickInputTarget;
  popup: { dispose(): void } | null;
  root: HTMLDivElement;
  editor: NativeMarkdownEditor;
  destination: HTMLDivElement;
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
  prepareTemplate: (template: NoteTemplateDefinition, now: Date) => Promise<PreparedQuickInput | string>;
  submit: (request: QuickInputRequest) => Promise<NoteInputResult>;
  describeError?: (error: unknown) => string;
  notify: (message: string) => void;
}

/** Owns this vault's runtime drafts; windows only host their DOM and geometry. */
export class QuickInputWindowManager {
  private readonly targets: NoteCreationService;
  private readonly drafts = new Set<Draft>();
  private readonly sessions = new Map<string, Session>();
  private lastTint: QuickInputTint | null = null;
  private disposed = false;
  private sequence = 0;
  private latestOpenId = "";
  private readonly submissionPrefix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  constructor(private readonly options: Options) { this.targets = new NoteCreationService(options.app); }

  async open(source?: Window): Promise<void> {
    if (this.disposed || source?.closed) return;
    let session: Session | undefined;
    let mountingEditor = false;
    let preparingTemplate = false;
    try {
      this.options.desktop.check();
      const settings = this.options.getSettings();
      const config = { ...settings.quickInput };
      const visibility = normalizeQuickInputVisibility(settings.quickInputVisibility);
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
        opened.dispose(); this.closeSession(session); return;
      }
      session.window = opened;
      let initialValue = "";
      let templateReady = !config.templateId;
      if (context.template && this.resolveTarget(context).valid) {
        preparingTemplate = true;
        const prepared = await this.options.prepareTemplate(context.template, context.now);
        if (typeof prepared === "string") initialValue = prepared;
        else {
          initialValue = prepared.text;
          context.target = { title: prepared.title, folderPath: prepared.folderPath };
          context.templateSource = prepared.sourceFile;
        }
        templateReady = true;
        preparingTemplate = false;
        if (session.closed || this.disposed || opened.win.closed || opened.handle.isDestroyed()) {
          this.closeSession(session); return;
        }
      }
      mountingEditor = true;
      this.mount(session, opened.win, context, initialValue, templateReady, visibility);
      mountingEditor = false;
      // Force style/layout before the first reveal. A hidden native window may
      // never deliver rAF, even with background throttling disabled.
      await this.waitForLayout(session);
      if (session.closed || this.disposed || opened.handle.isDestroyed()) return;
      if (id === this.latestOpenId) {
        opened.handle.show();
        opened.handle.focus();
        session.draft?.editor.focus();
      } else {
        // Reveal only this late draft; do not refocus or reorder other windows.
        opened.handle.showInactive();
      }
    } catch (error) {
      if (preparingTemplate) {
        if (session?.closed || this.disposed) return;
        if (session) this.closeSession(session);
        this.options.notify(error instanceof Error ? error.message : String(error));
      } else this.fail(session, error, mountingEditor);
    }
  }

  private waitForLayout(session: Session): Promise<void> {
    session.draft!.root.getBoundingClientRect();
    return Promise.resolve();
  }

  private mount(session: Session, win: Window, context: DraftContext, initialValue: string, templateReady: boolean, visibility: QuickInputVisibility): void {
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
    const button = (cls: string, label: string, icon: string, visible: boolean) => {
      const el = footer.createEl("button", { cls: `clickable-icon ${cls}`, attr: { type: "button", "aria-label": label, title: label } });
      setIcon(el, icon);
      el.hidden = !visible;
      return el;
    };
    const folderButton = button("fce-quick-input-folder", strings.targetFolder, "folder", visibility.folder);
    folderButton.createSpan({ cls: "fce-quick-input-choice-name" });
    const boxButton = button("fce-quick-input-boxes", strings.boxes, "box", visibility.boxes);
    boxButton.createSpan({ cls: "fce-quick-input-choice-name", text: strings.boxes });
    const tagButton = button("fce-quick-input-tags", strings.addTags, "tags", visibility.tags);
    const propertyButton = button("fce-quick-input-property", strings.addProperty, "list", visibility.properties);
    const destination = footer.createDiv({ cls: "fce-quick-input-destination" });
    const destinationText = destination.createSpan({ cls: "fce-quick-input-destination-text" });
    destination.hidden = !visibility.status;
    const hint = destination.createSpan({ cls: "fce-quick-input-append-hint", attr: { tabindex: "0", role: "img" } });
    setIcon(hint, "circle-alert");
    const actions = footer.createDiv({ cls: "fce-quick-input-actions" });
    const cancel = actions.createEl("button", { cls: "fce-quick-input-cancel", text: strings.cancel, attr: { type: "button" } });
    const send = actions.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
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
      let defaultTitle = context.target?.title ?? this.targets.defaultQuickInputTitle(context.now);
      if (context.template && !context.target) {
        try { defaultTitle = this.targets.resolveQuickInputTarget(context).path.split("/").pop()!.slice(0, -3); } catch { /* Invalid destination stays visible. */ }
      }
      if (!context.target && (context.template || visibility.title)) context.target = {
        title: defaultTitle, folderPath: context.template?.targetFolderPath ?? context.config.folderPath,
      };
      let title: HTMLInputElement | null = null;
      if (visibility.title) {
        title = win.document.body.createEl("input");
        title.type = "text";
        title.className = "inline-title fce-quick-input-title";
        title.value = defaultTitle;
        title.setAttribute("aria-label", strings.title);
        editor.mountTitle(title);
      }
      draft = { visibility, title, defaultTitle, folderButton, boxButton, tagButton, propertyButton, hint,
        boxIds: [], popup: null, target: this.resolveTarget(context), root, editor, destination, destinationText, send, sendLabel, cancel,
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
      if (title) {
        this.listen(current, title, "input", () => {
          if (current.pending || current.request) return;
          current.context.target!.title = title.value.trim() || current.defaultTitle;
          this.updateTarget(current);
        });
        this.listen(current, title, "blur", () => { if (!title.value.trim()) title.value = current.defaultTitle; });
        this.listen(current, title, "keydown", (event) => {
          const key = event as KeyboardEvent;
          key.stopPropagation();
          if (key.key === "Enter" && !key.ctrlKey && !key.metaKey && !key.isComposing && !current.composing) {
            key.preventDefault(); key.stopPropagation(); current.editor.focus();
          }
        });
      }
      this.listen(current, folderButton, "click", () => this.openChoices(current, "folder"));
      this.listen(current, boxButton, "click", () => this.openChoices(current, "boxes"));
      this.listen(current, tagButton, "click", () => this.addMetadata(current, "tags"));
      this.listen(current, propertyButton, "click", () => this.addMetadata(current, "property"));
      for (const event of ["create", "delete", "rename"] as const) {
        if (typeof this.options.app.vault.on === "function") {
          const ref = this.options.app.vault.on(event as "create", () => this.updateTarget(current));
          current.cleanup.push(() => this.options.app.vault.offref(ref));
        }
      }
      this.listen(current, cancel, "click", () => { if (!current.pending) this.close(current); });
      this.listen(current, send, "click", () => { void this.send(current); });
      this.listen(current, win.document, "compositionstart", () => { current.composing = true; this.refresh(current); });
      this.listen(current, win.document, "compositionend", () => { current.composing = false; this.refresh(current); });
      this.listen(current, win.document, "keydown", (event) => {
        const key = event as KeyboardEvent;
        if (key.ctrlKey && !key.altKey && key.key === ";") {
          key.preventDefault(); key.stopPropagation();
          if (!key.isComposing && !current.composing) this.addMetadata(current, "property");
          return;
        }
        if ((key.ctrlKey || key.metaKey) && !key.altKey && key.key === "Enter") this.handleModEnter(current, key);
      }, true);
      this.listen(current, root, "focusin", () => this.refresh(current));
      this.listen(current, win, "focus", () => this.updateTarget(current));
      this.listen(current, win, "unload", () => this.closeSession(session));
      current.cleanup.push(installQuickInputDrag({ grip: top, handle: session.window!.handle, cursor: () => this.options.desktop.cursor() }));
      current.cleanup.push(installQuickInputResize({ root, handle: session.window!.handle, cursor: () => this.options.desktop.cursor(),
        minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT }));
      this.updateTarget(current);
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
    const folderPath = context.target?.folderPath ?? (config.templateId ? template?.targetFolderPath ?? null : config.folderPath);
    try {
      const resolved = this.targets.resolveQuickInputTarget(context);
      return { template, folderPath, insertPosition: config.insertPosition, valid: true, mode: resolved.mode };
    } catch {
      return { template, folderPath, insertPosition: config.insertPosition, valid: false, mode: "create" };
    }
  }

  private updateTarget(draft: Draft): void {
    if (draft.pending || draft.request || !this.drafts.has(draft)) return;
    const target = this.resolveTarget(draft.context);
    if (target.mode !== draft.target.mode) draft.editor.flush();
    draft.target = target;
    draft.editor.setPropertiesReadOnly(draft.target.mode === "append");
    this.refresh(draft);
  }

  private addMetadata(draft: Draft, kind: "tags" | "property"): void {
    if (draft.pending || draft.request || draft.target.mode === "append") return;
    if (!draft.editor.addMetadata(kind)) this.options.notify(this.options.getStrings().sourcePropertiesHint);
  }

  private openChoices(draft: Draft, kind: "folder" | "boxes"): void {
    if (draft.pending || draft.request || draft.composing) return;
    draft.editor.flush();
    draft.popup?.dispose();
    const candidates = kind === "folder" ? [
      { id: "", name: this.options.getStrings().rootFolder },
      ...(this.options.app.vault.getAllFolders?.() ?? []).filter((folder) => folder.path && folder.path !== "/").map((folder) => ({ id: folder.path, name: folder.path })),
    ] : this.options.getSettings().boxes.map((box) => ({ id: box.id, name: box.name }));
    if (kind === "boxes") {
      // Opening the picker is an explicit reselection after a stale-box error.
      const available = new Set(candidates.map((choice) => choice.id));
      draft.boxIds = draft.boxIds.filter((id) => available.has(id));
      this.paintBoxes(draft);
    }
    draft.popup = openQuickInputSuggest({ app: this.options.app, anchor: kind === "folder" ? draft.folderButton : draft.boxButton,
      candidates, multiple: kind === "boxes",
      selected: (id) => kind === "folder" ? draft.target.folderPath === id : draft.boxIds.includes(id),
      select: (id) => {
        if (kind === "folder") {
          if (draft.context.target) draft.context.target.folderPath = id;
          else draft.context.config.folderPath = id;
          this.updateTarget(draft);
        } else {
          draft.boxIds = draft.boxIds.includes(id) ? draft.boxIds.filter((entry) => entry !== id) : [...draft.boxIds, id];
          this.paintBoxes(draft);
        }
      },
      restoreFocus: () => draft.editor.focus(),
    });
  }

  private paintBoxes(draft: Draft): void {
    const names = draft.boxIds.map((id) => this.options.getSettings().boxes.find((box) => box.id === id)?.name ?? id);
    draft.boxButton.querySelector("span.fce-quick-input-choice-name")!.textContent = names.length ? `${names[0]}${names.length > 1 ? ` +${names.length - 1}` : ""}` : this.options.getStrings().boxes;
    draft.boxButton.title = names.join(", ") || this.options.getStrings().boxes;
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
    const target = { ...draft.target };
    target.valid = target.valid && draft.templateReady;
    draft.send.disabled = draft.pending || draft.composing || !draft.editor.getValue().trim() || !target.valid;
    draft.cancel.disabled = draft.pending;
    const locked = draft.pending || !!draft.request;
    if (draft.title) draft.title.disabled = locked;
    draft.folderButton.disabled = draft.boxButton.disabled = locked;
    draft.tagButton.disabled = draft.propertyButton.disabled = locked || target.mode === "append";
    draft.cancel.textContent = strings.cancel;
    draft.sendLabel.textContent = draft.pending ? strings.sending : strings.send;
    draft.send.setAttribute("aria-label", draft.pending ? strings.sending : strings.send);
    const shortcut = Platform.isMacOS ? "⌘+Enter" : "Ctrl+Enter";
    draft.send.title = target.valid ? (draft.pending ? strings.sending : `${strings.send} (${shortcut})`) : strings.invalidQuickInputConfig;
    draft.root.setAttribute("aria-busy", String(draft.pending));
    this.paintDestination(draft, target, strings);
  }

  private paintDestination(draft: Draft, target: QuickInputTarget, strings: NoteInputStrings): void {
    const folderLabel = target.folderPath || strings.rootFolder;
    draft.folderButton.querySelector("span.fce-quick-input-choice-name")!.textContent = folderLabel;
    draft.folderButton.title = folderLabel;
    draft.destination.classList.toggle("is-invalid", !target.valid);
    draft.destinationText.textContent = !target.valid ? strings.destinationUnavailable : target.mode === "append" ? strings.appendNote : strings.newNote;
    draft.hint.hidden = target.mode !== "append";
    draft.hint.setAttribute("aria-label", strings.appendHint);
    if (draft.hint.dataset.hint !== strings.appendHint) {
      setTooltip(draft.hint, strings.appendHint);
      draft.hint.dataset.hint = strings.appendHint;
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
    const latest = this.resolveTarget(draft.context);
    if (!draft.request && latest.valid && latest.mode !== draft.target.mode) {
      this.updateTarget(draft); this.options.notify(strings.targetModeChanged); return;
    }
    if (!draft.templateReady || !latest.valid) { this.refresh(draft); this.options.notify(strings.invalidQuickInputConfig); return; }
    if (!draft.request) {
      draft.request = { ...draft.context, now: draft.context.template ? draft.context.now : new Date(),
        submissionId: `${this.submissionPrefix}-${++this.sequence}`, text: draft.editor.getValue(),
        target: draft.context.target ? { ...draft.context.target } : undefined, boxIds: [...draft.boxIds], expectedMode: latest.mode };
    }
    draft.popup?.dispose();
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
      const draft = session.draft;
      if (error instanceof QuickInputPreflightError) {
        draft.request = null;
        draft.pending = false;
        draft.editor.setReadOnly(false);
        this.updateTarget(draft);
      }
      const strings = this.options.getStrings();
      this.options.notify(error instanceof QuickInputBoxesSaveError ? strings.savedBoxFailure(error.path)
        : strings.sendFailed(this.options.describeError?.(error) ?? (error instanceof Error ? error.message : String(error))));
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
      draft.popup?.dispose();
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
