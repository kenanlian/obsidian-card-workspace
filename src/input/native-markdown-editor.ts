/**
 * Native editor discovery follows Fevol's embeddable-editor reference:
 * https://gist.github.com/Fevol/caa478ce303e69eabede7b12b2323838
 * Copyright 2024 Matthew Meyers, Fevol; MIT (see THIRD_PARTY_NOTICES).
 * The adapter deliberately does not patch workspace methods.
 */
import { Scope, type App, type Editor } from "obsidian";
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, placeholder } from "@codemirror/view";
import { createDraftPropertiesEditor, type DraftPropertiesEditor, type NativePropertiesConstructor } from "./native-properties-editor";

export interface NativeMarkdownEditor {
  getValue(): string;
  focus(): void;
  flush(): void;
  setReadOnly(value: boolean): void;
  dispose(): void;
}

interface InternalEditor {
  editor: Editor & { cm: EditorView };
  owner: Record<string, unknown>;
  set(value: string): void;
  buildLocalExtensions(): Extension[];
  unload(): void;
  destroy(): void;
}
interface InternalEmbed {
  editable: boolean;
  editMode?: object;
  metadataEditor?: { constructor: unknown };
  showEditor(): void;
  unload(): void;
}
type EditorConstructor = new (app: App, el: HTMLElement, owner: Record<string, unknown>) => InternalEditor;
type InternalApp = App & {
  embedRegistry?: { embedByExtension?: { md?: (context: { app: App; containerEl: HTMLElement }, file: null, subpath: string) => InternalEmbed } };
};

export class NativeMarkdownEditorUnavailable extends Error {}

interface NativeEditorCapabilities { Editor: EditorConstructor; Properties?: NativePropertiesConstructor }
const constructors = new WeakMap<App, NativeEditorCapabilities>();
const focusedDrafts = new WeakMap<App, { baseline: App["workspace"]["activeEditor"]; owners: Map<InternalEditor, Scope> }>();
function resolveConstructor(app: App, document: Document): NativeEditorCapabilities {
  const cached = constructors.get(app);
  if (cached) return cached;
  const create = (app as InternalApp).embedRegistry?.embedByExtension?.md;
  if (typeof create !== "function" || !app.keymap?.pushScope || !app.keymap?.popScope || !app.workspace || typeof Scope !== "function") {
    throw new NativeMarkdownEditorUnavailable("Missing native Markdown editor capabilities");
  }
  let probe: InternalEmbed | undefined;
  try {
    probe = create({ app, containerEl: document.defaultView!.createFragment().createDiv() }, null, "");
    if (!probe || typeof probe.showEditor !== "function" || typeof probe.unload !== "function") throw new Error("Missing embed lifecycle");
    probe.editable = true;
    probe.showEditor();
    const editModePrototype: unknown = probe.editMode && Object.getPrototypeOf(probe.editMode);
    const prototype: unknown = typeof editModePrototype === "object" && editModePrototype !== null
      ? Object.getPrototypeOf(editModePrototype) : null;
    if (typeof prototype !== "object" || prototype === null
      || !["set", "buildLocalExtensions", "unload", "destroy"].every((name) => typeof (prototype as Record<string, unknown>)[name] === "function")
      || typeof prototype.constructor !== "function") {
      throw new Error("Missing native editor prototype");
    }
    const capabilities: NativeEditorCapabilities = { Editor: prototype.constructor as EditorConstructor };
    if (typeof probe.metadataEditor?.constructor === "function") capabilities.Properties = probe.metadataEditor.constructor as NativePropertiesConstructor;
    constructors.set(app, capabilities);
    return capabilities;
  } catch (error) {
    throw new NativeMarkdownEditorUnavailable(String(error));
  } finally {
    probe?.unload?.();
  }
}

export function createNativeMarkdownEditor(options: {
  app: App;
  container: HTMLElement;
  placeholder: string;
  initialValue?: string;
  onChange: () => void;
  onModEnter: (event: KeyboardEvent) => void;
}): NativeMarkdownEditor {
  const { app, container, onChange, onModEnter } = options;
  const capabilities = resolveConstructor(app, container.ownerDocument);
  const Base = capabilities.Editor;
  const editable = new Compartment();
  const propertiesExtension = new Compartment();
  class DraftEditor extends Base {
    private destroyed = false;
    buildLocalExtensions(): Extension[] {
      return [...super.buildLocalExtensions(),
        placeholder(options.placeholder),
        // Native Chromium carets use the full line height beside an empty
        // placeholder. CodeMirror measures text bounds consistently instead.
        drawSelection(),
        Prec.highest(editable.of([EditorState.readOnly.of(false), EditorView.editable.of(true), EditorView.contentAttributes.of({ contenteditable: "true" })])),
        propertiesExtension.of([]),
        EditorView.updateListener.of((update) => { if (update.docChanged) onChange(); }),
      ];
    }
    destroy(): void {
      if (this.destroyed) return;
      this.destroyed = true;
      super.destroy();
    }
  }
  let native: DraftEditor | undefined;
  let disposed = false;
  let properties: DraftPropertiesEditor | null = null;
  let ownsScope = false;
  const scope = new Scope(app.scope);
  const releaseFocus = () => {
    if (ownsScope) { app.keymap.popScope(scope); ownsScope = false; }
    const group = focusedDrafts.get(app);
    if (!group || !native) return;
    group.owners.delete(native);
    if (app.workspace.activeEditor === (native.owner as unknown)) {
      const previous = [...group.owners.keys()].pop();
      app.workspace.activeEditor = previous ? previous.owner as unknown as App["workspace"]["activeEditor"] : group.baseline;
    }
    if (!group.owners.size) focusedDrafts.delete(app);
  };
  const takeFocus = () => {
    if (disposed || !native) return;
    // Modern host keymaps bind scopes to activeWindow at push time.
    window.activeWindow = container.ownerDocument.defaultView!;
    window.activeDocument = container.ownerDocument;
    if (ownsScope && app.workspace.activeEditor === (native.owner as unknown)) return;
    if (ownsScope) app.keymap.popScope(scope);
    let group = focusedDrafts.get(app);
    if (!group) {
      group = { baseline: app.workspace.activeEditor, owners: new Map() };
      focusedDrafts.set(app, group);
    } else if (![...group.owners.keys()].some((entry) => entry.owner === (app.workspace.activeEditor as unknown))) {
      group.baseline = app.workspace.activeEditor;
    }
    group.owners.delete(native);
    group.owners.set(native, scope);
    app.workspace.activeEditor = native.owner as unknown as App["workspace"]["activeEditor"];
    app.keymap.pushScope(scope);
    ownsScope = true;
  };
  // Host hotkeys run before CodeMirror. Handle this shortcut in our own scope.
  scope.register(["Mod"], "Enter", (event) => { onModEnter(event); return false; });
  try {
    const owner: Record<string, unknown> = { app, onMarkdownScroll: () => {}, syncScroll: () => {}, getMode: () => "source",
      get editor() { return native?.editor; }, get editMode() { return native; } };
    native = new DraftEditor(app, container, owner);
    // Some host versions create their CodeMirror surface only on the first set.
    native.set(options.initialValue ?? "");
    if (!native.editor?.getValue || !native.editor.focus || !native.editor.cm?.contentDOM || !native.editor.cm.dispatch) {
      throw new Error("Missing native editor instance capabilities");
    }
    if (options.initialValue) native.editor.cm.dispatch({ selection: { anchor: native.editor.cm.state.doc.length }, scrollIntoView: true });
    properties = createDraftPropertiesEditor({ app, container, editor: native.editor, Constructor: capabilities.Properties });
    if (properties) native.editor.cm.dispatch({ effects: propertiesExtension.reconfigure(properties.extension) });
    const focusOut = (event: FocusEvent) => { if (!container.contains(event.relatedTarget as Node | null)) releaseFocus(); };
    container.addEventListener("focusin", takeFocus, true);
    container.addEventListener("focusout", focusOut, true);
    const win = container.ownerDocument.defaultView!;
    const focusWindow = () => {
      if (container.contains(container.ownerDocument.activeElement)) takeFocus();
    };
    // A native window can lose activation while its contentDOM remains the
    // document's activeElement. Release its scope before another draft takes it.
    win.addEventListener("blur", releaseFocus);
    win.addEventListener("focus", focusWindow);
    const editor = native;
    return {
      getValue: () => editor.editor.getValue(),
      focus: () => { if (!disposed) editor.editor.focus(); },
      flush: () => properties?.flush(),
      setReadOnly: (value) => {
        if (!disposed) {
          properties?.setReadOnly(value);
          editor.editor.cm.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(value), EditorView.editable.of(!value),
            EditorView.contentAttributes.of({ contenteditable: String(!value) })]) });
        }
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        container.removeEventListener("focusin", takeFocus, true);
        container.removeEventListener("focusout", focusOut, true);
        win.removeEventListener("blur", releaseFocus);
        win.removeEventListener("focus", focusWindow);
        releaseFocus();
        try { properties?.dispose(); } finally {
          try { editor.unload(); } finally { editor.destroy(); container.replaceChildren(); }
        }
      },
    };
  } catch (error) {
    releaseFocus();
    try { properties?.dispose(); } finally {
      try { native?.unload(); } finally { native?.destroy(); container.replaceChildren(); }
    }
    throw new NativeMarkdownEditorUnavailable(String(error));
  }
}
