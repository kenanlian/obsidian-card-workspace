import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { App } from "obsidian";
import { createNativeMarkdownEditor, NativeMarkdownEditorUnavailable, type NativeMarkdownEditor } from "./native-markdown-editor";

const scopes = vi.hoisted(() => ({ instances: [] as Array<{ handler?: (event: KeyboardEvent) => unknown }> }));
vi.mock("obsidian", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, Scope: class {
    handler?: (event: KeyboardEvent) => unknown;
    constructor() { scopes.instances.push(this); }
    register(_modifiers: unknown, _key: string, handler: (event: KeyboardEvent) => unknown) { this.handler = handler; }
  } };
});

const live: NativeMarkdownEditor[] = [];
afterEach(() => { for (const adapter of live.splice(0)) adapter.dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); scopes.instances = []; });

function fixture(lazy = false) {
  const destroyed = vi.fn();
  class NativeBase {
    editor!: { cm: EditorView; getValue: () => string; focus: () => void };
    constructor(_app: App, private container: HTMLElement, public owner: Record<string, unknown>) {
      if (!lazy) this.createSurface();
    }
    private createSurface() {
      const cm = new EditorView({ state: EditorState.create({ extensions: this.buildLocalExtensions() }), parent: this.container });
      this.editor = { cm, getValue: () => cm.state.doc.toString(), focus: () => cm.focus() };
    }
    buildLocalExtensions(): Extension[] { return [EditorView.editable.of(true), EditorState.readOnly.of(false), EditorView.contentAttributes.of({ contenteditable: "true" })]; }
    set(value: string) {
      if (!this.editor) this.createSurface();
      this.editor.cm.dispatch({ changes: { from: 0, to: this.editor.cm.state.doc.length, insert: value } });
    }
    unload() { this.destroy(); }
    destroy() { destroyed(); this.editor.cm.destroy(); }
  }
  class EmbedEditor extends NativeBase {}
  const probeUnload = vi.fn();
  const create = vi.fn(() => ({ editable: false, showEditor: vi.fn(), editMode: Object.create(EmbedEditor.prototype) as object, unload: probeUnload }));
  const underlying = { marker: "underlying" };
  const workspace = { activeEditor: underlying, setActiveLeaf: vi.fn() };
  const keymap = { pushScope: vi.fn(), popScope: vi.fn() };
  const app = { scope: {}, workspace, keymap, embedRegistry: { embedByExtension: { md: create } } } as unknown as App;
  const onChange = vi.fn();
  const onModEnter = vi.fn();
  const container = document.createElement("div"); document.body.append(container);
  const open = (target = container, handleModEnter = onModEnter, initialValue = "") => {
    const adapter = createNativeMarkdownEditor({ app, container: target, placeholder: "Write", initialValue, onChange, onModEnter: handleModEnter });
    live.push(adapter); return adapter;
  };
  return { app, container, open, underlying, workspace, keymap, create, probeUnload, destroyed, onChange, onModEnter };
}

describe("native Markdown editor compatibility seam", () => {
  it("loads editable template properties and body with the cursor at the end", () => {
    const f = fixture(true);
    const text = "---\nstatus: draft\n---\n## Template body";
    const adapter = f.open(f.container, f.onModEnter, text);
    const cm = EditorView.findFromDOM(f.container.querySelector(".cm-content")!)!;
    expect(adapter.getValue()).toBe(text);
    expect(cm.state.selection.main.head).toBe(text.length);
    cm.dispatch({ changes: { from: text.length, insert: "\nmy input" } });
    expect(adapter.getValue()).toBe(`${text}\nmy input`);
  });
  it("initializes hosts that defer the surface until set and observes native document transactions", () => {
    const f = fixture(true); const adapter = f.open();
    const cm = EditorView.findFromDOM(f.container.querySelector(".cm-content")!)!;
    cm.dispatch({ changes: { from: 0, insert: "# Native Markdown\ntext" } });
    expect(adapter.getValue()).toBe("# Native Markdown\ntext");
    expect(f.onChange).toHaveBeenCalledOnce();
  });

  it("discovers the internal prototype in the owning document, unloads probes, and uses the native editor", () => {
    const f = fixture(); const adapter = f.open();
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.create.mock.calls[0]).toEqual([{ app: f.app, containerEl: expect.any(HTMLDivElement) }, null, ""]);
    expect(f.probeUnload).toHaveBeenCalledOnce();
    expect(f.container.querySelector(".cm-editor")).not.toBeNull();
    expect(f.container.querySelector("textarea")).toBeNull();
    expect(adapter.getValue()).toBe("");
    expect(f.workspace.setActiveLeaf).not.toHaveBeenCalled();
    adapter.dispose();
    expect(f.destroyed).toHaveBeenCalledOnce();
    expect(f.container.childElementCount).toBe(0);
    f.open(); expect(f.create).toHaveBeenCalledOnce();
  });

  it("pushes focus scope once, restores the underlying editor on blur, and never overwrites another focus owner", () => {
    const f = fixture(); const adapter = f.open();
    const content = f.container.querySelector<HTMLElement>(".cm-content")!;
    content.dispatchEvent(new FocusEvent("focus")); content.dispatchEvent(new FocusEvent("focus"));
    expect(f.keymap.pushScope).toHaveBeenCalledOnce();
    expect(f.workspace.activeEditor).not.toBe(f.underlying);
    content.dispatchEvent(new FocusEvent("focusout"));
    expect(f.workspace.activeEditor).toBe(f.underlying);
    expect(f.keymap.popScope).toHaveBeenCalledOnce();
    content.dispatchEvent(new FocusEvent("focus"));
    const other = { marker: "other-window" }; f.workspace.activeEditor = other;
    adapter.dispose(); adapter.dispose();
    expect(f.workspace.activeEditor).toBe(other);
    expect(f.keymap.popScope).toHaveBeenCalledTimes(2);
    expect(f.destroyed).toHaveBeenCalledOnce();
    content.dispatchEvent(new FocusEvent("focus")); expect(f.keymap.pushScope).toHaveBeenCalledTimes(2);
  });

  it.each(["tags", "property"])("keeps the %s completion scope above the draft scope when focusing from a toolbar button", (kind) => {
    const f = fixture();
    f.open();
    const activeScopes: unknown[] = [];
    f.keymap.pushScope.mockImplementation((scope) => { activeScopes.push(scope); });
    f.keymap.popScope.mockImplementation((scope) => { activeScopes.splice(activeScopes.indexOf(scope), 1); });
    const toolbar = document.createElement("button"); document.body.append(toolbar); toolbar.focus();
    const input: HTMLElement = document.createElement(kind === "tags" ? "div" : "input");
    if (kind === "tags") { input.contentEditable = "true"; input.tabIndex = 0; }
    f.container.append(input);
    const completion = { selectNext: vi.fn() };
    input.addEventListener("focus", () => f.app.keymap.pushScope(completion as never));
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" && activeScopes[activeScopes.length - 1] === completion) {
        completion.selectNext(); event.preventDefault();
      }
    });
    input.focus();
    const key = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
    input.dispatchEvent(key);
    expect(completion.selectNext).toHaveBeenCalledOnce();
    expect(key.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("routes ModEnter through its owned scope and removes editing permission while pending", () => {
    const f = fixture(); const adapter = f.open();
    const event = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true });
    expect(scopes.instances[scopes.instances.length - 1]!.handler!(event)).toBe(false);
    expect(f.onModEnter).toHaveBeenCalledWith(event);
    const content = f.container.querySelector<HTMLElement>(".cm-content")!;
    adapter.setReadOnly(true); expect(content.getAttribute("contenteditable")).toBe("false");
    expect(EditorView.findFromDOM(content)!.state.readOnly).toBe(true);
    adapter.setReadOnly(false); expect(content.getAttribute("contenteditable")).toBe("true");
  });

  it("releases native window activation independently of the editor's DOM focus", () => {
    const f = fixture(); const adapter = f.open();
    adapter.focus();
    const content = f.container.querySelector<HTMLElement>(".cm-content")!;
    expect(document.activeElement).toBe(content);
    expect(f.keymap.pushScope).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("blur"));
    expect(document.activeElement).toBe(content);
    expect(f.workspace.activeEditor).toBe(f.underlying);
    expect(f.keymap.popScope).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("focus"));
    expect(f.keymap.pushScope).toHaveBeenCalledTimes(2);
    adapter.dispose();
    window.dispatchEvent(new Event("focus"));
    expect(f.keymap.pushScope).toHaveBeenCalledTimes(2);
    expect(f.workspace.activeEditor).toBe(f.underlying);
  });

  it("hands editor ownership and shortcuts between two drafts without disposing the focused sibling", () => {
    const f = fixture();
    const activeScopes: typeof scopes.instances = [];
    f.keymap.pushScope.mockImplementation((scope) => { activeScopes.push(scope); });
    f.keymap.popScope.mockImplementation((scope) => { activeScopes.splice(activeScopes.indexOf(scope), 1); });
    const first = f.open();
    const otherContainer = document.createElement("div"); document.body.append(otherContainer);
    const otherSend = vi.fn();
    const second = f.open(otherContainer, otherSend);
    const firstContent = f.container.querySelector<HTMLElement>(".cm-content")!;
    const secondContent = otherContainer.querySelector<HTMLElement>(".cm-content")!;
    const cm = EditorView.findFromDOM(firstContent)!;
    cm.dispatch({ changes: { from: 0, insert: "first draft" } });
    const event = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true });

    first.focus();
    expect(document.activeElement).toBe(firstContent);
    expect(activeScopes).toHaveLength(1);
    activeScopes[0].handler!(event);
    expect(f.onModEnter).toHaveBeenCalledOnce(); expect(otherSend).not.toHaveBeenCalled();

    second.focus();
    expect(document.activeElement).toBe(secondContent);
    expect(activeScopes).toHaveLength(1);
    activeScopes[0].handler!(event);
    expect(otherSend).toHaveBeenCalledOnce(); expect(f.onModEnter).toHaveBeenCalledOnce();
    const owner = f.workspace.activeEditor;
    expect(first.getValue()).toBe("first draft"); expect(second.getValue()).toBe("");

    first.focus(); second.focus();
    first.dispose();
    expect(f.workspace.activeEditor).toBe(owner);
    expect(document.activeElement).toBe(secondContent);
    expect(activeScopes).toHaveLength(1);
    second.dispose();
    expect(f.workspace.activeEditor).toBe(f.underlying);
    expect(activeScopes).toHaveLength(0);
    expect(f.destroyed).toHaveBeenCalledTimes(2);
  });

  it("rejects missing host capabilities with a clear error instead of creating a fallback", () => {
    const container = document.createElement("div"); document.body.append(container);
    expect(() => createNativeMarkdownEditor({ app: {} as App, container, placeholder: "", onChange: vi.fn(), onModEnter: vi.fn() })).toThrow(NativeMarkdownEditorUnavailable);
    expect(container.childElementCount).toBe(0);
  });

  it("unloads the temporary embed even when prototype discovery fails", () => {
    const f = fixture();
    f.create.mockReturnValueOnce({ editable: false, showEditor: vi.fn(), editMode: {}, unload: f.probeUnload });
    expect(() => f.open()).toThrow(NativeMarkdownEditorUnavailable);
    expect(f.probeUnload).toHaveBeenCalledOnce(); expect(f.destroyed).not.toHaveBeenCalled();
  });
});


describe("append mode property protection", () => {
  it.each(["---\nstatus: draft\n---\nBody", "---\nstatus: [\n---\nBody", "---\nstatus:\n  nested: value\n---\nBody"])("protects source properties while allowing body edits: %s", (text) => {
    const f = fixture(); const editor = f.open(f.container, f.onModEnter, text);
    const cm = EditorView.findFromDOM(f.container.querySelector(".cm-content")!)!;
    editor.setPropertiesReadOnly(true);
    cm.dispatch({ changes: { from: 5, to: 6, insert: "X" } });
    expect(editor.getValue()).toBe(text);
    cm.dispatch({ changes: { from: text.length, insert: " edited" } });
    expect(editor.getValue()).toBe(`${text} edited`);
    editor.setPropertiesReadOnly(false);
    cm.dispatch({ changes: { from: 5, to: 6, insert: "X" } });
    expect(editor.getValue()).toContain("X");
  });
  it("keeps body input available in an append draft without frontmatter", () => {
    const f = fixture(); const editor = f.open();
    editor.setPropertiesReadOnly(true);
    const cm = EditorView.findFromDOM(f.container.querySelector(".cm-content")!)!;
    cm.dispatch({ changes: { from: 0, insert: "Body" } });
    expect(editor.getValue()).toBe("Body");
    editor.setReadOnly(true);
    cm.dispatch({ changes: { from: 4, insert: "no" } });
    expect(editor.getValue()).toBe("Body");
  });
});


it("clamps body focus out of frontmatter while preserving an existing body selection", () => {
  const f = fixture(); const editor = f.open(f.container, f.onModEnter, "---\ntags: []\n---\nBody");
  const cm = EditorView.findFromDOM(f.container.querySelector(".cm-content")!)!;
  cm.dispatch({ selection: { anchor: 3 } });
  editor.focus(); expect(cm.state.selection.main.head).toBe(17);
  cm.dispatch({ selection: { anchor: 18, head: 20 } });
  editor.focus(); expect(cm.state.selection.main.anchor).toBe(18); expect(cm.state.selection.main.head).toBe(20);
});
