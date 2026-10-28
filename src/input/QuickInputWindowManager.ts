import { Platform, setIcon, type App } from "obsidian";
import type { NoteInputStrings } from "../i18n/noteInput";
import { normalizeQuickInputVisibility, type QuickInputVisibility, type QuickInputMode, type NoteInputResult, type QuickInputRequest } from "../note-input";
import { NoteCreationService, QuickInputPreflightError } from "../services/NoteCreationService";
import { QuickInputBoxesSaveError } from "../services/QuickInputSubmissionCoordinator";
import { CompatConfirmationModal } from "../view/modals/compat-modal";
import { openQuickInputSuggest } from "./quick-input-suggest";
import { QUICK_INPUT_TINTS, type PluginSettings, type QuickInputTint } from "../settings";
import { QuickInputDesktopError, type QuickInputDesktop, type QuickInputDesktopWindow } from "./quick-input-desktop";
import { createNativeMarkdownEditor, type NativeMarkdownEditor } from "./native-markdown-editor";
import { stripEmptyDraftFrontmatter } from "./draft-frontmatter";
import { installQuickInputResize } from "./quick-input-resize";
import { installQuickInputDrag } from "./quick-input-drag";

const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;
/** Typing a title passes through other note names; only a settled title switches create/append. */
const TITLE_TARGET_DELAY = 250;
interface Session { displayId?: number; id: string; abort: AbortController; window: QuickInputDesktopWindow | null; draft: Draft | null; closed: boolean }
type DraftContext = Pick<QuickInputRequest, "config" | "now" | "target">;
interface QuickInputTarget {
  folderPath: string;
  path: string | null;
  valid: boolean;
  /** A same-name note exists and the duplicate-title policy may append to it. */
  existing: boolean;
  /** What this draft shows; only the "append" policy previews appending. */
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
  boxIds: string[];
  target: QuickInputTarget;
  popup: { dispose(): void } | null;
  titleTimer: number | null;
  root: HTMLDivElement;
  editor: NativeMarkdownEditor;
  send: HTMLButtonElement;
  sendLabel: HTMLSpanElement;
  cancel: HTMLButtonElement;
  session: Session;
  composing: boolean;
  pending: boolean;
  request: QuickInputRequest | null;
  context: DraftContext;
  cleanup: Array<() => void>;
}
interface Options {
  app: App;
  desktop: QuickInputDesktop;
  getSettings: () => PluginSettings;
  getStrings: () => NoteInputStrings;
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
    try {
      this.options.desktop.check();
      const settings = this.options.getSettings();
      const config = { ...settings.quickInput };
      const visibility = normalizeQuickInputVisibility(settings.quickInputVisibility);
      const context: DraftContext = { config, now: new Date() };
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
      mountingEditor = true;
      this.mount(session, opened.win, context, visibility);
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
      this.fail(session, error, mountingEditor);
    }
  }

  private waitForLayout(session: Session): Promise<void> {
    session.draft!.root.getBoundingClientRect();
    return Promise.resolve();
  }

  private mount(session: Session, win: Window, context: DraftContext, visibility: QuickInputVisibility): void {
    const settings = this.options.getSettings();
    const strings = this.options.getStrings();
    const root = win.document.body.createDiv({ cls: "fce-quick-input" });
    win.document.title = strings.quickInput;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", strings.quickInput);
    root.setAttribute("aria-modal", "false");
    const tint = this.resolveTint(settings);
    win.document.body.dataset.quickInputRadius = settings.quickInputCornerRadius;
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
    boxButton.createSpan({ cls: "fce-quick-input-choice-count" }).hidden = true;
    const tagButton = button("fce-quick-input-tags", strings.addTags, "tags", visibility.tags);
    const propertyButton = button("fce-quick-input-property", strings.addProperty, "list", visibility.properties);
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
      const editor = createNativeMarkdownEditor({ app: this.options.app, container: body, placeholder: strings.inputPlaceholder, initialValue: "",
        onChange: () => { if (draft) this.refresh(draft); },
        onModEnter: (event) => { if (draft) this.handleModEnter(draft, event); },
      });
      const defaultTitle = this.targets.defaultQuickInputTitle(context.now);
      if (visibility.title) context.target = { title: defaultTitle, folderPath: context.config.folderPath };
      let title: HTMLInputElement | null = null;
      if (visibility.title) {
        title = win.document.body.createEl("input");
        title.type = "text";
        title.className = "inline-title fce-quick-input-title";
        title.placeholder = defaultTitle;
        title.setAttribute("aria-label", strings.title);
        editor.mountTitle(title);
      }
      draft = { visibility, title, defaultTitle, folderButton, boxButton, tagButton, propertyButton,
        boxIds: [], popup: null, titleTimer: null, target: this.resolveTarget(context), root, editor, send, sendLabel, cancel,
        composing: false, pending: false, request: null, cleanup: [],
        session, context,
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
        const settleTitle = () => {
          if (current.titleTimer === null) return;
          win.clearTimeout(current.titleTimer);
          current.titleTimer = null;
          this.updateTarget(current);
        };
        this.listen(current, title, "input", () => {
          if (current.pending || current.request) return;
          current.context.target!.title = title.value.trim() || current.defaultTitle;
          if (current.titleTimer !== null) win.clearTimeout(current.titleTimer);
          current.titleTimer = win.setTimeout(settleTitle, TITLE_TARGET_DELAY);
        });
        this.listen(current, title, "blur", settleTitle);
        current.cleanup.push(() => { if (current.titleTimer !== null) win.clearTimeout(current.titleTimer); });
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
        // An open prompt owns the keyboard until it closes.
        if (current.popup) return;
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
    const folderPath = context.target?.folderPath ?? context.config.folderPath;
    try {
      const resolved = this.targets.resolveQuickInputTarget(context);
      const existing = resolved.mode === "append";
      return { folderPath, path: resolved.path, valid: true, existing,
        mode: existing && context.config.duplicateTitle === "append" ? "append" : "create" };
    } catch {
      return { folderPath, path: null, valid: false, existing: false, mode: "create" };
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
    if (draft.pending || draft.request || draft.composing || draft.popup) return;
    draft.editor.flush();
    const strings = this.options.getStrings();
    const candidates = kind === "folder" ? [
      { id: "", name: strings.rootFolder },
      ...(this.options.app.vault.getAllFolders?.() ?? []).filter((folder) => folder.path && folder.path !== "/")
        .map((folder) => ({ id: folder.path, name: folder.path })).sort((a, b) => a.name.localeCompare(b.name)),
    ] : this.options.getSettings().boxes.map((box) => ({ id: box.id, name: box.name }));
    if (kind === "boxes") {
      // Opening the picker is an explicit reselection after a stale-box error.
      const available = new Set(candidates.map((choice) => choice.id));
      draft.boxIds = draft.boxIds.filter((id) => available.has(id));
      this.paintBoxes(draft);
    }
    const popup = openQuickInputSuggest(this.options.app, {
      candidates, multiple: kind === "boxes", emptyText: strings.boxesEmpty, noMatchText: strings.noChoiceMatches,
      placeholder: kind === "folder" ? strings.chooseFolderPlaceholder : strings.chooseBoxesPlaceholder,
      instructions: kind === "boxes" ? [
        { command: "↑↓", purpose: strings.navigateChoices },
        { command: "↵", purpose: strings.toggleChoice },
        { command: "esc", purpose: strings.finishChoosing },
      ] : undefined,
      selected: (id) => kind === "folder" ? draft.target.folderPath === id : draft.boxIds.includes(id),
      select: (id) => {
        if (!this.drafts.has(draft) || draft.pending || draft.request) return;
        if (kind === "folder") {
          if (draft.context.target) draft.context.target.folderPath = id;
          else draft.context.config.folderPath = id;
          this.updateTarget(draft);
        } else {
          draft.boxIds = draft.boxIds.includes(id) ? draft.boxIds.filter((entry) => entry !== id) : [...draft.boxIds, id];
          this.paintBoxes(draft);
        }
      },
      onClose: () => {
        if (draft.popup === popup) draft.popup = null;
        if (this.drafts.has(draft)) draft.editor.focus();
      },
    });
    draft.popup = popup;
  }

  /** Resolves "ask" for one send; null keeps the draft unchanged. */
  private askDuplicateTitle(draft: Draft, path: string): Promise<"append" | "number" | null> {
    const strings = this.options.getStrings();
    return new Promise((resolve) => {
      let choice: "append" | "number" | null = null;
      const modal = new CompatConfirmationModal(this.options.app);
      modal.setTitle(strings.duplicateTitleHeading);
      modal.setContent(strings.duplicateTitleBody(path, draft.context.config.insertPosition === "start"
        ? strings.insertBodyStart : strings.insertEnd));
      modal.addButton((button) => button.setCta().setButtonText(strings.appendNote).onClick(() => { choice = "append"; }));
      modal.addButton((button) => button.setButtonText(strings.createNumberedNote).onClick(() => { choice = "number"; }));
      modal.addCancelButton(strings.cancel);
      const popup = { dispose: () => modal.close() };
      const onClose = modal.onClose.bind(modal);
      modal.onClose = () => {
        onClose();
        if (draft.popup === popup) draft.popup = null;
        if (this.drafts.has(draft)) draft.editor.focus();
        resolve(choice);
      };
      draft.popup = popup;
      modal.open();
    });
  }

  private paintBoxes(draft: Draft): void {
    const names = draft.boxIds.map((id) => this.options.getSettings().boxes.find((box) => box.id === id)?.name ?? id);
    const label = this.options.getStrings().boxes;
    const count = draft.boxButton.querySelector<HTMLElement>("span.fce-quick-input-choice-count")!;
    count.textContent = String(names.length);
    count.hidden = !names.length;
    draft.boxButton.title = names.length ? `${label} · ${names.join(", ")}` : label;
    draft.boxButton.setAttribute("aria-label", draft.boxButton.title);
  }

  private resolveTint(settings: PluginSettings): { name: string; value: string } {
    const color = settings.quickInputColor;
    if (color === "primary" || color === "secondary") return { name: color, value: `var(--background-${color})` };
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
    const target = draft.target;
    draft.send.disabled = draft.pending || draft.composing || !stripEmptyDraftFrontmatter(draft.editor.getValue()).trim() || !target.valid;
    draft.cancel.disabled = draft.pending;
    const locked = draft.pending || !!draft.request;
    if (draft.title) draft.title.disabled = locked;
    draft.folderButton.disabled = draft.boxButton.disabled = locked;
    draft.tagButton.disabled = draft.propertyButton.disabled = locked || target.mode === "append";
    draft.cancel.textContent = strings.cancel;
    const action = draft.pending ? strings.sending : target.mode === "append" ? strings.appendNote : strings.send;
    draft.sendLabel.textContent = action;
    draft.send.setAttribute("aria-label", action);
    const shortcut = Platform.isMacOS ? "⌘+Enter" : "Ctrl+Enter";
    draft.send.title = target.valid ? (draft.pending ? action : `${action} (${shortcut})`) : strings.invalidQuickInputConfig;
    draft.root.setAttribute("aria-busy", String(draft.pending));
    this.paintFolder(draft, target, strings);
  }

  private paintFolder(draft: Draft, target: QuickInputTarget, strings: NoteInputStrings): void {
    const folderLabel = target.folderPath || strings.rootFolder;
    draft.folderButton.querySelector("span.fce-quick-input-choice-name")!.textContent = folderLabel;
    draft.folderButton.classList.toggle("is-invalid", !target.valid);
    draft.folderButton.title = target.valid ? folderLabel : `${folderLabel} · ${strings.destinationUnavailable}`;
  }

  private handleModEnter(draft: Draft, event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.isComposing && !draft.composing) void this.send(draft);
  }

  private async send(draft: Draft): Promise<void> {
    if (!this.drafts.has(draft) || draft.pending || draft.composing || draft.popup) return;
    if (!draft.request) draft.editor.flush();
    const text = stripEmptyDraftFrontmatter(draft.editor.getValue());
    if (!text.trim()) return;
    const strings = this.options.getStrings();
    const latest = this.resolveTarget(draft.context);
    if (!draft.request && latest.valid && latest.mode !== draft.target.mode) {
      this.updateTarget(draft); this.options.notify(strings.targetModeChanged); return;
    }
    if (!latest.valid) { this.refresh(draft); this.options.notify(strings.invalidQuickInputConfig); return; }
    if (!draft.request) {
      let duplicateTitle = draft.context.config.duplicateTitle;
      if (duplicateTitle === "ask") {
        const choice = latest.existing && latest.path ? await this.askDuplicateTitle(draft, latest.path) : "number";
        if (!choice || !this.drafts.has(draft) || draft.pending || draft.request) return;
        duplicateTitle = choice;
      }
      draft.request = { ...draft.context, config: { ...draft.context.config, duplicateTitle }, now: new Date(),
        submissionId: `${this.submissionPrefix}-${++this.sequence}`, text,
        target: draft.context.target ? { ...draft.context.target } : undefined, boxIds: [...draft.boxIds],
        expectedMode: duplicateTitle === "append" && latest.existing ? "append" : "create" };
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
