import { afterEach, describe, expect, it, vi } from "vitest";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { App, Editor } from "obsidian";
import { installObsidianDomHelpers } from "../__mocks__/obsidian-dom";
import { createDraftPropertiesEditor, type DraftPropertiesEditor, type NativePropertiesConstructor } from "./native-properties-editor";
import type { DraftProperties } from "./draft-frontmatter";
import * as frontmatter from "./draft-frontmatter";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); });

function fixture(text = "---\nstatus: draft\n---\nBody", failing = false, child = false) {
  const frame = document.createElement("iframe");
  if (child) document.body.append(frame);
  const doc = child ? frame.contentDocument! : document;
  installObsidianDomHelpers(doc);
  const container = doc.createElement("div"); doc.body.append(container);
  const compartment = new Compartment();
  const cm = new EditorView({ parent: container, state: EditorState.create({ doc: text, extensions: compartment.of([]) }) });
  const owner: { current?: Record<string, (...args: never[]) => unknown> } = {};
  const unloaded = vi.fn();
  let fail = failing;
  class Metadata {
    containerEl = doc.createElement("div");
    headingEl = doc.createElement("div");
    values = doc.createElement("div");
    properties: DraftProperties = {};
    constructor(_app: App, callbacks: Record<string, (...args: never[]) => unknown>) {
      owner.current = callbacks;
      this.containerEl.className = "metadata-container";
      this.containerEl.append(this.headingEl, this.values);
    }
    load() {}
    unload() { unloaded(); }
    synchronize(properties: DraftProperties) {
      if (fail) throw new Error("Changed host API");
      this.properties = properties;
      this.values.replaceChildren();
      for (const [key, value] of Object.entries(properties)) {
        const row = doc.createElement("div"); row.className = "metadata-property"; row.dataset.propertyKey = key;
        const keyInput = doc.createElement("input"); keyInput.className = "metadata-property-key-input"; keyInput.value = key;
        row.append(keyInput);
        const valueEl = doc.createElement("div"); valueEl.className = "metadata-property-value"; row.append(valueEl);
        const input = doc.createElement("input"); input.dataset.key = key; input.value = String(value);
        if (key === "tags") input.className = "multi-select-input";
        input.addEventListener("blur", () => {
          this.properties = { ...this.properties, [key]: input.value };
          (owner.current!.saveFrontmatter as (values: DraftProperties) => void)(this.properties);
        });
        valueEl.append(input); this.values.append(row);
      }
    }
  }
  const editor = { cm, getValue: () => cm.state.doc.toString(), focus: () => cm.focus(), undo: vi.fn(), redo: vi.fn() } as unknown as Editor & { cm: EditorView };
  const adapter = createDraftPropertiesEditor({ app: {} as App, container, editor, Constructor: Metadata as unknown as NativePropertiesConstructor });
  if (adapter) cm.dispatch({ effects: compartment.reconfigure(adapter.extension) });
  cleanups.push(() => { adapter?.dispose(); cm.destroy(); frame.remove(); });
  const input = () => container.querySelector<HTMLInputElement>('input[data-key="status"]')!;
  return { adapter: adapter!, container, cm, input, owner, unloaded, setFailure: () => { fail = true; } };
}

describe("native draft properties", () => {
  it("creates tags from an empty draft and focuses the value rather than the preceding key", () => {
    const f = fixture("Body");
    expect(f.adapter.add("tags")).toBe(true);
    expect(f.cm.state.doc.toString()).toBe("---\ntags: []\n---\nBody");
    const input = f.container.querySelector(".multi-select-input");
    expect(input).toBe(document.activeElement);
  });

  it("reveals source when a native panel cannot provide the add control", () => {
    const f = fixture("Body");
    expect(f.adapter.add("property")).toBe(false);
    expect(f.cm.state.doc.toString()).toBe("---\n\n---\nBody");
    expect(f.container.querySelector(".cm-content .metadata-container")).toBeNull();
    expect(f.cm.contentDOM.textContent).toContain("---");
  });

  it("keeps the panel a block above an editable body line for a metadata-only draft", () => {
    const text = "---\nstatus: draft\n---\n";
    const f = fixture(text);
    const [panel, line] = Array.from(f.cm.contentDOM.children);
    expect(panel.classList.contains("metadata-container")).toBe(true);
    expect(line.classList.contains("cm-line")).toBe(true);
    expect(f.cm.contentDOM.querySelector(".cm-line .metadata-container")).toBeNull();
    f.cm.dispatch({ changes: { from: text.length, insert: "Body" }, userEvent: "input.type" });
    expect(f.cm.state.doc.toString()).toBe(`${text}Body`);
  });

  it("keeps the panel decoration unchanged when the first body character arrives, so IME composition is not redrawn", () => {
    const text = "---\ntags: [a]\n---\n";
    const f = fixture(text);
    const ranges = () => {
      const found: Array<[number, number]> = [];
      for (const source of f.cm.state.facet(EditorView.decorations)) {
        if (typeof source === "function") continue;
        source.between(0, f.cm.state.doc.length, (from, to, value) => { if (value.spec.widget) found.push([from, to]); });
      }
      return found;
    };
    expect(ranges()).toEqual([[0, text.length - 1]]);
    const line = f.cm.contentDOM.querySelector(".cm-line");
    f.cm.dispatch({ changes: { from: text.length, insert: "c" }, userEvent: "input.type.compose" });
    expect(ranges()).toEqual([[0, text.length - 1]]);
    expect(f.cm.contentDOM.querySelector(".cm-line")).toBe(line);
    f.cm.dispatch({ changes: { from: text.length + 1, insert: "测试一下" }, userEvent: "input.type.compose" });
    expect(f.cm.state.doc.toString()).toBe(`${text}c测试一下`);
  });

  it("does not let Backspace or Delete beside the panel break or remove the properties", () => {
    const text = "---\ntags: [a]\n---\nBody";
    const f = fixture(text);
    f.cm.dispatch({ changes: { from: 17, to: 18 }, userEvent: "delete.backward" });
    f.cm.dispatch({ changes: { from: 0, to: 18 }, userEvent: "delete.backward" });
    expect(f.cm.state.doc.toString()).toBe(text);
    f.cm.dispatch({ changes: { from: 21, to: 22 }, userEvent: "delete.backward" });
    expect(f.cm.state.doc.toString()).toBe("---\ntags: [a]\n---\nBod");
    f.cm.dispatch({ selection: { anchor: 0, head: f.cm.state.doc.length } });
    f.cm.dispatch({ changes: { from: 0, to: f.cm.state.doc.length }, userEvent: "delete.selection" });
    expect(f.cm.state.doc.toString()).toBe("");
  });

  it("moves a caret left at either panel edge to the start of the body", () => {
    const f = fixture("---\nstatus: draft\n---\nBody");
    for (const anchor of [0, 21]) {
      f.cm.dispatch({ selection: { anchor } });
      expect(f.cm.state.selection.main.head).toBe(22);
    }
    f.cm.dispatch({ selection: { anchor: 0, head: 26 } });
    expect(f.cm.state.selection.main.from).toBe(0);
  });

  it("retains an editable body line for a metadata-only draft ending in a newline", () => {
    const text = "---\nstatus: draft\n---\n";
    const f = fixture(text);
    expect(f.cm.contentDOM.querySelector(".cm-line")).not.toBeNull();
    f.cm.dispatch({ changes: { from: text.length, insert: "Body" }, userEvent: "input.type" });
    expect(f.cm.state.doc.toString()).toBe(`${text}Body`);
    expect(f.cm.contentDOM.textContent).toContain("Body");
    expect(f.cm.contentDOM.textContent).not.toContain("status: draft");
  });

  it("reuses the YAML parse during repeated long body edits", () => {
    const read = vi.spyOn(frontmatter, "readDraftFrontmatter");
    const f = fixture("---\nstatus: draft\n---\n" + "Body ".repeat(10000));
    read.mockClear();
    for (let i = 0; i < 10; i++) f.cm.dispatch({ changes: { from: f.cm.state.doc.length, insert: String(i) } });
    expect(read).not.toHaveBeenCalled();
  });

  it("replaces the YAML display with a native widget while keeping the full document", () => {
    const f = fixture();
    expect(f.container.querySelector(".cm-content .metadata-container")).not.toBeNull();
    expect(f.cm.contentDOM.textContent).not.toContain("status: draft");
    expect(f.cm.contentDOM.textContent).toContain("Body");
    expect(f.cm.state.doc.toString()).toBe("---\nstatus: draft\n---\nBody");
    expect(f.owner.current!.getFile()).toBeNull();
    expect(f.container.querySelector("button")).toBeNull();
  });

  it("flushes a child-document property input before the draft snapshot is read", () => {
    const f = fixture(undefined, false, true);
    f.input().focus(); f.input().value = "edited";
    expect(f.cm.state.doc.toString()).toContain("status: draft");
    f.adapter.flush();
    expect(f.cm.state.doc.toString()).toContain("status: edited");
    expect(f.cm.state.doc.toString()).toContain("---\nBody");
  });

  it("keeps properties synchronized with document changes while YAML stays hidden", () => {
    const f = fixture(); const original = f.cm.state.doc.toString();
    const from = original.indexOf("draft");
    f.cm.dispatch({ changes: { from, to: from + 5, insert: "changed" } });
    expect(f.cm.contentDOM.textContent).not.toContain("status: changed");
    expect(f.input().value).toBe("changed");
  });

  it("keeps a YAML-only template intact until typing a body, then inserts the separator in that transaction", () => {
    const text = "---\nstatus: draft\n---";
    const f = fixture(text);
    expect(f.cm.state.doc.toString()).toBe(text);
    f.cm.dispatch({ changes: { from: text.length, insert: "Body" }, selection: { anchor: text.length + 4 }, userEvent: "input.type" });
    expect(f.cm.state.doc.toString()).toBe(`${text}\nBody`);
    expect(f.cm.state.selection.main.head).toBe(text.length + 5);
    expect(f.container.querySelector(".cm-content .metadata-container")).not.toBeNull();
  });

  it.each([
    ["an IME keydown", (cm: EditorView) => cm.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Process", bubbles: true }))],
    ["composition start", (cm: EditorView) => cm.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }))],
  ])("adds a YAML-only template's separator before %s, so composing never changes the panel", (_name, start) => {
    const text = "---\nstatus: draft\n---";
    const f = fixture(text);
    f.cm.dispatch({ selection: { anchor: text.length } });
    const ranges = () => {
      const found: Array<[number, number, boolean]> = [];
      for (const source of f.cm.state.facet(EditorView.decorations)) {
        if (typeof source !== "function") source.between(0, f.cm.state.doc.length, (from, to, value) => { if (value.spec.widget) found.push([from, to, !!value.spec.block]); });
      }
      return found;
    };
    expect(f.cm.state.doc.toString()).toBe(text);
    start(f.cm);
    expect(f.cm.state.doc.toString()).toBe(`${text}\n`);
    expect(f.cm.state.selection.main.head).toBe(text.length + 1);
    expect(ranges()).toEqual([[0, text.length, true]]);
    const line = f.cm.contentDOM.querySelector(".cm-line");
    f.cm.dispatch({ changes: { from: text.length + 1, insert: "c" }, userEvent: "input.type.compose" });
    expect(ranges()).toEqual([[0, text.length, true]]);
    expect(f.cm.contentDOM.querySelector(".cm-line")).toBe(line);
    start(f.cm);
    expect(f.cm.state.doc.toString()).toBe(`${text}\nc`);
  });

  it("does not add a separator for ordinary keys or a caret away from the end", () => {
    const text = "---\nstatus: draft\n---";
    const f = fixture(text);
    f.cm.dispatch({ selection: { anchor: text.length } });
    f.cm.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(f.cm.state.doc.toString()).toBe(text);
    const body = fixture("---\nstatus: draft\n---\nBody");
    body.cm.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(body.cm.state.doc.toString()).toBe("---\nstatus: draft\n---\nBody");
  });

  it.each(["---\nstatus: [\n---\nBody", "---\nstatus:\n  nested: value\n---\nBody", "---\nstatus: &a value\nother: *a\n---\nBody"])("keeps complex or invalid YAML visible and intact", (text) => {
    const f = fixture(text);
    expect(f.container.querySelector(".cm-content .metadata-container")).toBeNull();
    expect(f.cm.state.doc.toString()).toBe(text);
  });

  it("locks native controls and ignores late commits while a request is frozen", () => {
    const f = fixture();
    f.adapter.setReadOnly(true);
    expect(f.container.querySelector<HTMLElement>(".metadata-container")!.inert).toBe(true);
    (f.owner.current!.saveFrontmatter as (properties: DraftProperties) => void)({ status: "late edit" });
    expect(f.cm.state.doc.toString()).toContain("status: draft");
    f.adapter.setReadOnly(false);
    expect(f.container.querySelector<HTMLElement>(".metadata-container")!.inert).toBe(false);
  });

  it("falls back to unchanged YAML if native synchronization fails, and unloads once", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fixture(); f.setFailure();
    const text = f.cm.state.doc.toString();
    f.cm.dispatch({ changes: { from: text.indexOf("draft"), to: text.indexOf("draft") + 5, insert: "changed" } });
    await Promise.resolve();
    expect(f.cm.contentDOM.textContent).toContain("status: changed");
    expect(f.container.querySelector(".cm-content .metadata-container")).toBeNull();
    f.adapter.dispose(); f.adapter.dispose();
    expect(f.unloaded).toHaveBeenCalledOnce();
  });

  it("preserves the document when initial native initialization fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fixture(undefined, true);
    await Promise.resolve();
    expect(f.cm.contentDOM.textContent).toContain("status: draft");
    expect(f.cm.state.doc.toString()).toBe("---\nstatus: draft\n---\nBody");
  });
});
