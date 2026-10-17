import { Platform, TFile, TFolder, setIcon, type App } from "obsidian";
import type { NoteInputStrings } from "../i18n/noteInput";
import { resolveTemplateName, type NoteInputResult, type NoteTemplateDefinition, type QuickInputConfig, type QuickInputRequest } from "../note-input";
import { QUICK_INPUT_TINTS, type PluginSettings, type QuickInputTint } from "../settings";
import { createNativeMarkdownEditor, type NativeMarkdownEditor } from "./native-markdown-editor";

interface Geometry { x: number; y: number; width: number; height: number }
interface QuickInputTarget {
  template: NoteTemplateDefinition | null;
  folderPath: string | null;
  insertPosition: QuickInputConfig["insertPosition"];
  valid: boolean;
}
interface Draft {
  win: Window;
  root: HTMLDivElement;
  editor: NativeMarkdownEditor;
  destination: HTMLDivElement;
  destinationIcon: HTMLSpanElement;
  destinationText: HTMLSpanElement;
  send: HTMLButtonElement;
  sendLabel: HTMLSpanElement;
  cancel: HTMLButtonElement;
  geometry: Geometry;
  composing: boolean;
  pending: boolean;
  request: QuickInputRequest | null;
  cleanup: Array<() => void>;
  gestureCleanup?: () => void;
}
interface Options {
  app: App;
  getSettings: () => PluginSettings;
  getStrings: () => NoteInputStrings;
  submit: (request: QuickInputRequest) => Promise<NoteInputResult>;
  notify: (message: string) => void;
}

function boundGeometry(win: Window, geometry: Geometry): Geometry {
  const availableWidth = Math.max(1, win.innerWidth);
  const availableHeight = Math.max(1, win.innerHeight);
  const width = Math.min(availableWidth, Math.max(Math.min(320, availableWidth), geometry.width));
  const height = Math.min(availableHeight, Math.max(Math.min(200, availableHeight), geometry.height));
  return { width, height, x: Math.max(0, Math.min(availableWidth - width, geometry.x)), y: Math.max(0, Math.min(availableHeight - height, geometry.y)) };
}

/** Owns this vault's runtime drafts; windows only host their DOM and geometry. */
export class QuickInputWindowManager {
  private readonly drafts = new Set<Draft>();
  private readonly layers = new WeakMap<Window, HTMLDivElement>();
  private readonly geometry = new WeakMap<Window, Geometry>();
  private lastTint: QuickInputTint | null = null;
  private disposed = false;
  private sequence = 0;
  private readonly submissionPrefix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  constructor(private readonly options: Options) {}

  open(win: Window): void {
    if (this.disposed || win.closed) return;
    let previous: Draft | undefined;
    for (const draft of this.drafts) if (draft.win === win) previous = draft;
    const settings = this.options.getSettings();
    const width = settings.quickInputWidth;
    const height = settings.quickInputHeight;
    const anchor = previous?.geometry ?? this.geometry.get(win);
    let geometry = boundGeometry(win, anchor ? { x: anchor.x, y: anchor.y, width, height }
      : { x: (win.innerWidth - width) / 2, y: (win.innerHeight - height) / 2, width, height });
    if (previous) {
      geometry = { ...geometry,
        x: geometry.x + 24 + geometry.width <= win.innerWidth ? geometry.x + 24 : 0,
        y: geometry.y + 24 + geometry.height <= win.innerHeight ? geometry.y + 24 : 0,
      };
    }
    const document = win.document;
    const strings = this.options.getStrings();
    const root = document.defaultView!.createFragment().createDiv({ cls: "fce-quick-input" });
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", strings.quickInput);
    root.setAttribute("aria-modal", "false");
    const tint = this.resolveTint(settings);
    root.dataset.color = tint.name;
    root.style.setProperty("--fce-quick-input-tint", tint.value);
    const top = root.createDiv({ cls: "fce-quick-input-grip" });
    top.setAttribute("aria-hidden", "true");
    setIcon(top, "ellipsis");
    const body = root.createDiv({ cls: "fce-quick-input-editor" });
    const footer = root.createDiv({ cls: "fce-quick-input-footer" });
    const destination = footer.createDiv({ cls: "fce-quick-input-destination" });
    const destinationIcon = destination.createSpan({ cls: "fce-quick-input-destination-icon" });
    destinationIcon.setAttribute("aria-hidden", "true");
    const destinationText = destination.createSpan({ cls: "fce-quick-input-destination-text" });
    const cancel = footer.createEl("button", { text: strings.cancel, attr: { type: "button" } });
    const send = footer.createEl("button", { cls: "mod-cta", attr: { type: "button" } });
    send.setAttribute("aria-label", strings.send);
    const sendIcon = send.createSpan({ cls: "fce-quick-input-send-icon" });
    sendIcon.setAttribute("aria-hidden", "true");
    setIcon(sendIcon, "send");
    const sendLabel = send.createSpan({ cls: "fce-quick-input-send-label", text: strings.send });
    let layer = this.layers.get(win);
    if (!layer) {
      layer = document.body.createDiv({ cls: "fce-quick-input-layer" });
      this.layers.set(win, layer);
    }
    layer.append(root);
    let draft: Draft | undefined;
    try {
      const editor = createNativeMarkdownEditor({ app: this.options.app, container: body, placeholder: strings.inputPlaceholder,
        onChange: () => { if (draft) this.refresh(draft); },
        onModEnter: (event) => { if (draft) this.handleModEnter(draft, event); },
      });
      draft = { win, root, editor, destination, destinationIcon, destinationText, send, sendLabel, cancel,
        composing: false, pending: false, request: null, cleanup: [],
        geometry,
      };
      const current = draft;
      this.drafts.add(current);
      this.bringToFront(current);
      this.paint(current);
      this.listen(current, cancel, "click", () => { if (!current.pending) this.close(current); });
      this.listen(current, send, "click", () => { void this.send(current); });
      this.listen(current, root, "compositionstart", () => { current.composing = true; this.refresh(current); });
      this.listen(current, root, "compositionend", () => { current.composing = false; this.refresh(current); });
      this.listen(current, root, "keydown", (event) => {
        const key = event as KeyboardEvent;
        if ((key.ctrlKey || key.metaKey) && !key.altKey && key.key === "Enter") this.handleModEnter(current, key);
      }, true);
      this.listen(current, root, "pointerdown", () => this.bringToFront(current), true);
      this.listen(current, root, "focusin", () => { this.bringToFront(current); this.refresh(current); });
      this.listen(current, win, "focus", () => this.refresh(current));
      this.listen(current, win, "resize", () => { current.geometry = boundGeometry(win, current.geometry); this.paint(current); });
      this.listen(current, win, "unload", () => this.close(current));
      this.listen(current, top, "pointerdown", (event) => this.startGesture(current, event as PointerEvent, "move"));
      for (const direction of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) {
        const handle = root.createDiv({ cls: `fce-quick-input-resize fce-quick-input-resize-${direction}` });
        handle.dataset.direction = direction;
        handle.setAttribute("aria-hidden", "true");
        this.listen(current, handle, "pointerdown", (event) => this.startGesture(current, event as PointerEvent, direction));
      }
      this.refresh(current);
      editor.focus();
    } catch (error) {
      if (draft) this.close(draft);
      else { root.remove(); this.removeEmptyLayer(win); }
      console.warn("[card-workspace] Native quick input unavailable", error);
      this.options.notify(strings.nativeEditorUnavailable);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const draft of this.drafts) this.close(draft);
  }

  private listen(draft: Draft, target: EventTarget, type: string, handler: EventListener, capture = false): void {
    target.addEventListener(type, handler, capture);
    draft.cleanup.push(() => target.removeEventListener(type, handler, capture));
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

  private async send(draft: Draft): Promise<void> {
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
    try {
      const result = await this.options.submit(draft.request);
      if (this.disposed || !this.drafts.has(draft)) return;
      this.close(draft);
      this.options.notify(this.options.getStrings().sent(result.file.path));
    } catch (error) {
      if (this.disposed || !this.drafts.has(draft)) return;
      this.options.notify(this.options.getStrings().sendFailed(error instanceof Error ? error.message : String(error)));
    } finally {
      if (this.drafts.has(draft)) { draft.pending = false; this.refresh(draft); }
    }
  }

  private close(draft: Draft): void {
    if (!this.drafts.delete(draft)) return;
    this.geometry.set(draft.win, draft.geometry);
    for (const cleanup of draft.cleanup) cleanup();
    try { draft.editor.dispose(); } finally { draft.root.remove(); this.removeEmptyLayer(draft.win); }
  }

  private removeEmptyLayer(win: Window): void {
    const layer = this.layers.get(win);
    if (layer && layer.childElementCount === 0) { layer.remove(); this.layers.delete(win); }
  }

  private bringToFront(draft: Draft): void {
    if (this.disposed || !this.drafts.delete(draft)) return;
    this.drafts.add(draft);
    // Keep editor DOM mounted so raising a draft preserves selection and IME state.
    let layer = 0;
    for (const current of this.drafts) {
      if (current.win === draft.win) current.root.style.zIndex = String(layer++);
    }
  }

  private paint(draft: Draft): void {
    const { x, y, width, height } = draft.geometry;
    Object.assign(draft.root.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
    this.geometry.set(draft.win, draft.geometry);
  }

  private startGesture(draft: Draft, event: PointerEvent, direction: string): void {
    if (event.button !== 0) return;
    event.preventDefault();
    draft.gestureCleanup?.();
    const initial = { ...draft.geometry };
    if (direction === "move") draft.root.classList.add("is-dragging");
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (next: Event) => {
      const pointer = next as PointerEvent;
      if (pointer.pointerId !== event.pointerId) return;
      const dx = pointer.clientX - startX;
      const dy = pointer.clientY - startY;
      let geometry = { ...initial };
      if (direction === "move") { geometry.x += dx; geometry.y += dy; }
      else {
        const minWidth = Math.min(320, draft.win.innerWidth);
        const minHeight = Math.min(200, draft.win.innerHeight);
        if (direction.includes("e")) geometry.width = Math.max(minWidth, Math.min(initial.width + dx, draft.win.innerWidth - initial.x));
        if (direction.includes("s")) geometry.height = Math.max(minHeight, Math.min(initial.height + dy, draft.win.innerHeight - initial.y));
        if (direction.includes("w")) { geometry.x = Math.max(0, Math.min(initial.x + dx, initial.x + initial.width - minWidth)); geometry.width = initial.x + initial.width - geometry.x; }
        if (direction.includes("n")) { geometry.y = Math.max(0, Math.min(initial.y + dy, initial.y + initial.height - minHeight)); geometry.height = initial.y + initial.height - geometry.y; }
      }
      draft.geometry = boundGeometry(draft.win, geometry);
      this.paint(draft);
    };
    const end = (next?: Event) => {
      if (next && (next as PointerEvent).pointerId !== event.pointerId) return;
      draft.win.removeEventListener("pointermove", move);
      draft.win.removeEventListener("pointerup", end);
      draft.win.removeEventListener("pointercancel", end);
      draft.root.classList.remove("is-dragging");
      const index = draft.cleanup.indexOf(end);
      if (index >= 0) draft.cleanup.splice(index, 1);
      if (draft.gestureCleanup === end) draft.gestureCleanup = undefined;
    };
    draft.win.addEventListener("pointermove", move);
    draft.win.addEventListener("pointerup", end);
    draft.win.addEventListener("pointercancel", end);
    draft.cleanup.push(end);
    draft.gestureCleanup = end;
  }
}
