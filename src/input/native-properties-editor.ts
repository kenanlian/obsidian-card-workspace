import type { App, Editor } from "obsidian";
import { EditorState, Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { draftFrontmatterSource, readDraftFrontmatter, updateDraftFrontmatter, type DraftProperties } from "./draft-frontmatter";

export interface NativePropertiesEditor {
  containerEl: HTMLElement;
  headingEl: HTMLElement;
  synchronize(properties: DraftProperties): void;
  load(): void;
  unload(): void;
}
export type NativePropertiesConstructor = new (app: App, owner: Record<string, unknown>) => NativePropertiesEditor;
export interface DraftPropertiesEditor {
  extension: Extension;
  flush(): void;
  add(kind: "tags" | "property"): boolean;
  setReadOnly(value: boolean): void;
  dispose(): void;
}

class PropertiesWidget extends WidgetType {
  constructor(private readonly element: HTMLElement) { super(); }
  eq(other: PropertiesWidget): boolean { return other.element === this.element; }
  toDOM(): HTMLElement { return this.element; }
  ignoreEvent(): boolean { return true; }
}

/** The native panel edits the same complete CodeMirror document as the body. */
export function createDraftPropertiesEditor(options: {
  app: App;
  container: HTMLElement;
  editor: Editor & { cm: EditorView; undo?: () => void; redo?: () => void };
  Constructor?: NativePropertiesConstructor;
}): DraftPropertiesEditor | null {
  const { app, container, editor, Constructor } = options;
  if (!Constructor || !["synchronize", "load", "unload"].every((name) => typeof (Constructor.prototype as unknown as Record<string, unknown>)?.[name] === "function")) return null;
  let metadata: NativePropertiesEditor | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let disposed = false;
  let failed = false;
  let readOnly = false;
  let syncing = false;
  let lastSource: string | undefined;
  let cached: ReturnType<typeof readDraftFrontmatter> = null;
  let lastYaml: string | null = null;
  const refresh = StateEffect.define<void>();
  const snapshot = (text: string) => {
    const source = draftFrontmatterSource(text);
    if (source !== lastSource) { lastSource = source; cached = readDraftFrontmatter(source); }
    return cached;
  };
  const revealSource = (error: unknown) => {
    if (failed || disposed) return;
    failed = true;
    console.warn("[card-workspace] Draft properties unavailable; keeping YAML source", error);
    // Synchronization runs inside view updates; dispatching there is forbidden.
    queueMicrotask(() => { if (!disposed) editor.cm.dispatch({ effects: refresh.of() }); });
  };
  const flush = () => {
    if (disposed || readOnly || !metadata) return;
    const active = container.ownerDocument.activeElement;
    if (active && metadata.containerEl.contains(active) && typeof (active as HTMLElement).blur === "function") (active as HTMLElement).blur();
  };
  try {
    metadata = new Constructor(app, {
      getFile: () => null,
      getHoverSource: () => "card-workspace-quick-input",
      onMarkdownFold: () => editor.cm.requestMeasure(),
      focusBeforeMetadata: () => editor.cm.focus(),
      focusAfterMetadata: () => {
        const start = snapshot(editor.getValue())?.end ?? 0;
        editor.cm.dispatch({ selection: { anchor: start }, scrollIntoView: true });
        editor.cm.focus();
      },
      undo: () => { if (!readOnly) editor.undo?.(); },
      redo: () => { if (!readOnly) editor.redo?.(); },
      saveFrontmatter: (properties: DraftProperties) => {
        if (disposed || readOnly || syncing || failed) return;
        try {
          const text = editor.getValue();
          const next = updateDraftFrontmatter(text, properties);
          if (next === text) return;
          const before = snapshot(text)!;
          const after = readDraftFrontmatter(next);
          if (!after) throw new Error("Unsupported updated frontmatter");
          editor.cm.dispatch({ changes: { from: 0, to: before.end, insert: next.slice(0, after.end) }, userEvent: "input.properties" });
        } catch (error) { revealSource(error); }
      },
    });
    if (!metadata.containerEl || !metadata.headingEl) throw new Error("Missing native properties DOM");
    const panel = metadata;
    panel.containerEl.classList.add("fce-quick-input-properties");
    panel.load();
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => { if (!disposed && !failed) editor.cm.requestMeasure(); });
      resizeObserver.observe(panel.containerEl);
    }
    const synchronize = () => {
      const current = snapshot(editor.getValue());
      if (!current || failed) return;
      const yaml = editor.getValue().slice(0, current.end);
      if (yaml === lastYaml) return;
      syncing = true;
      try { panel.synchronize(current.properties); lastYaml = yaml; }
      catch (error) { revealSource(error); }
      finally { syncing = false; }
    };
    const decorations = (text: string): DecorationSet => {
      const current = snapshot(text);
      return current && !failed ? Decoration.set([
        // A metadata-only draft still needs an editable body line, including
        // when its closing fence already ends in a newline.
        Decoration.replace({ block: current.end < text.length, widget: new PropertiesWidget(panel.containerEl) }).range(0, current.end),
      ]) : Decoration.none;
    };
    const field = StateField.define<DecorationSet>({
      create: (state) => decorations(state.doc.toString()),
      update: (value, transaction) => transaction.docChanged || transaction.effects.some((effect) => effect.is(refresh))
        ? decorations(transaction.state.doc.toString()) : value,
      provide: (state) => [Prec.highest(EditorView.decorations.from(state)), EditorView.atomicRanges.of((view) => view.state.field(state))],
    });
    const showSource = () => {
      failed = true;
      editor.cm.dispatch({ effects: refresh.of() });
      return false;
    };
    synchronize();
    return {
      extension: [field, EditorState.transactionFilter.of((transaction) => {
        // A YAML-only template need not end with a newline. Add the separator
        // as part of the first body input, preserving untouched drafts exactly.
        const text = transaction.startState.doc.toString();
        const current = snapshot(text);
        if (!failed && current?.end === text.length && !text.endsWith("\n") && transaction.isUserEvent("input")) {
          let needsNewline = false;
          transaction.changes.iterChanges((from, to, _from, _to, inserted) => {
            if (from === text.length && to === from && inserted.length && !/^[\r\n]/.test(inserted.sliceString(0, 1))) needsNewline = true;
          });
          if (needsNewline) return [transaction, { changes: { from: text.length, insert: current.newline }, sequential: true }];
        }
        return transaction;
      }), EditorView.updateListener.of((update) => { if (update.docChanged) synchronize(); })],
      flush,
      add: (kind) => {
        if (disposed || readOnly || failed) return false;
        let text = editor.getValue();
        if (!draftFrontmatterSource(text)) {
          editor.cm.dispatch({ changes: { from: 0, insert: "---\n\n---\n" }, userEvent: "input.properties" });
          text = editor.getValue();
        }
        const current = snapshot(text);
        if (!current) return false;
        if (kind === "tags" && !Object.prototype.hasOwnProperty.call(current.properties, "tags")) {
          const next = updateDraftFrontmatter(text, { ...current.properties, tags: [] });
          const after = readDraftFrontmatter(next)!;
          editor.cm.dispatch({ changes: { from: 0, to: current.end, insert: next.slice(0, after.end) }, userEvent: "input.properties" });
        }
        const content = panel.containerEl.querySelector<HTMLElement>(".metadata-content");
        if (content && container.ownerDocument.defaultView?.getComputedStyle(content).display === "none") panel.headingEl.click();
        if (kind === "property") {
          const button = panel.containerEl.querySelector<HTMLElement>(".metadata-add-button");
          if (!button) return showSource();
          button.click();
        }
        const input = kind === "tags"
          ? panel.containerEl.querySelector<HTMLElement>('.metadata-property[data-property-key="tags"] .multi-select-input')
            ?? panel.containerEl.querySelector<HTMLElement>('.metadata-property[data-property-key="tags"] .metadata-property-value input')
          : panel.containerEl.querySelector<HTMLElement>('.metadata-property[data-property-key=""] .metadata-property-key-input');
        if (!input) return showSource();
        input.focus();
        return true;
      },
      setReadOnly: (value) => {
        readOnly = value;
        panel.containerEl.inert = value;
        panel.containerEl.setAttribute("aria-disabled", String(value));
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        resizeObserver?.disconnect();
        try { panel.unload(); } finally { panel.containerEl.remove(); }
      },
    };
  } catch (error) {
    disposed = true;
    resizeObserver?.disconnect();
    try { metadata?.unload(); } catch { /* Retain the Markdown editor on older hosts. */ }
    metadata?.containerEl?.remove();
    console.warn("[card-workspace] Native properties unavailable; keeping YAML source", error);
    return null;
  }
}
