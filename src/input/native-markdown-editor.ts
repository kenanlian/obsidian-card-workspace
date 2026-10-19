/**
 * Native editor discovery follows Fevol's embeddable-editor reference:
 * https://gist.github.com/Fevol/caa478ce303e69eabede7b12b2323838
 * Copyright 2024 Matthew Meyers, Fevol; MIT (see THIRD_PARTY_NOTICES).
 * The adapter deliberately does not patch workspace methods.
 */
import { Scope, type App, type Editor } from "obsidian";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, placeholder } from "@codemirror/view";

export interface NativeMarkdownEditor {
  getValue(): string;
  focus(): void;
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
  showEditor(): void;
  unload(): void;
}
type EditorConstructor = new (app: App, el: HTMLElement, owner: Record<string, unknown>) => InternalEditor;
type InternalApp = App & {
  embedRegistry?: { embedByExtension?: { md?: (context: { app: App; containerEl: HTMLElement }, file: null, subpath: string) => InternalEmbed } };
};

export class NativeMarkdownEditorUnavailable extends Error {}

const constructors = new WeakMap<App, EditorConstructor>();
function resolveConstructor(app: App, document: Document): EditorConstructor {
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
    const prototype = probe.editMode && Object.getPrototypeOf(Object.getPrototypeOf(probe.editMode));
    if (!prototype || !["set", "buildLocalExtensions", "unload", "destroy"].every((name) => typeof prototype[name] === "function")) {
      throw new Error("Missing native editor prototype");
    }
    const constructor = prototype.constructor as EditorConstructor;
    constructors.set(app, constructor);
    return constructor;
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
  onChange: () => void;
  onModEnter: (event: KeyboardEvent) => void;
}): NativeMarkdownEditor {
  const { app, container, onChange, onModEnter } = options;
  const Base = resolveConstructor(app, container.ownerDocument);
  const editable = new Compartment();
  class DraftEditor extends Base {
    private destroyed = false;
    buildLocalExtensions(): Extension[] {
      return [...super.buildLocalExtensions(),
        placeholder(options.placeholder),
        // Native Chromium carets use the full line height beside an empty
        // placeholder. CodeMirror measures text bounds consistently instead.
        drawSelection(),
        editable.of([EditorState.readOnly.of(false), EditorView.editable.of(true)]),
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
  let ownsScope = false;
  let previousEditor: App["workspace"]["activeEditor"] = null;
  const scope = new Scope(app.scope);
  const releaseFocus = () => {
    if (ownsScope) { app.keymap.popScope(scope); ownsScope = false; }
    if (native && app.workspace.activeEditor === (native.owner as unknown)) app.workspace.activeEditor = previousEditor;
    previousEditor = null;
  };
  const takeFocus = () => {
    if (disposed || !native || ownsScope) return;
    previousEditor = app.workspace.activeEditor;
    app.workspace.activeEditor = native.owner as unknown as App["workspace"]["activeEditor"];
    app.keymap.pushScope(scope);
    ownsScope = true;
  };
  // Host hotkeys run before CodeMirror. Handle this shortcut in our own scope.
  scope.register(["Mod"], "Enter", (event) => { onModEnter(event); return false; });
  try {
    const owner: Record<string, unknown> = { app, onMarkdownScroll: () => {}, getMode: () => "source" };
    native = new DraftEditor(app, container, owner);
    // Some host versions create their CodeMirror surface only on the first set.
    native.set("");
    if (!native.editor?.getValue || !native.editor.focus || !native.editor.cm?.contentDOM || !native.editor.cm.dispatch) {
      throw new Error("Missing native editor instance capabilities");
    }
    native.owner.editMode = native;
    native.owner.editor = native.editor;
    native.editor.cm.contentDOM.addEventListener("focusin", takeFocus);
    native.editor.cm.contentDOM.addEventListener("focusout", releaseFocus);
    const win = container.ownerDocument.defaultView!;
    const focusWindow = () => {
      if (native?.editor.cm.contentDOM.contains(container.ownerDocument.activeElement)) takeFocus();
    };
    // A native window can lose activation while its contentDOM remains the
    // document's activeElement. Release its scope before another draft takes it.
    win.addEventListener("blur", releaseFocus);
    win.addEventListener("focus", focusWindow);
    const editor = native;
    return {
      getValue: () => editor.editor.getValue(),
      focus: () => { if (!disposed) editor.editor.focus(); },
      setReadOnly: (value) => {
        if (!disposed) editor.editor.cm.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(value), EditorView.editable.of(!value)]) });
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        editor.editor.cm.contentDOM.removeEventListener("focusin", takeFocus);
        editor.editor.cm.contentDOM.removeEventListener("focusout", releaseFocus);
        win.removeEventListener("blur", releaseFocus);
        win.removeEventListener("focus", focusWindow);
        releaseFocus();
        try { editor.unload(); } finally { editor.destroy(); container.replaceChildren(); }
      },
    };
  } catch (error) {
    releaseFocus();
    try { native?.unload(); } finally { native?.destroy(); container.replaceChildren(); }
    throw new NativeMarkdownEditorUnavailable(String(error));
  }
}
