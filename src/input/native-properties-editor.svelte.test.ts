import { afterEach, describe, expect, it, vi } from "vitest";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { App, Editor } from "obsidian";
import { installObsidianDomHelpers } from "../__mocks__/obsidian-dom";
import { createDraftPropertiesEditor, type DraftPropertiesEditor, type NativePropertiesConstructor } from "./native-properties-editor";
import type { DraftProperties } from "./draft-frontmatter";

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
        const input = doc.createElement("input"); input.dataset.key = key; input.value = String(value);
        input.addEventListener("blur", () => {
          this.properties = { ...this.properties, [key]: input.value };
          (owner.current!.saveFrontmatter as (values: DraftProperties) => void)(this.properties);
        });
        this.values.append(input);
      }
    }
  }
  const editor = { cm, getValue: () => cm.state.doc.toString(), focus: () => cm.focus(), undo: vi.fn(), redo: vi.fn() } as unknown as Editor & { cm: EditorView };
  const adapter = createDraftPropertiesEditor({ app: {} as App, container, editor, Constructor: Metadata as unknown as NativePropertiesConstructor,
    labels: { showSource: "YAML", showProperties: "Properties" } });
  if (adapter) cm.dispatch({ effects: compartment.reconfigure(adapter.extension) });
  cleanups.push(() => { adapter?.dispose(); cm.destroy(); frame.remove(); });
  const input = () => container.querySelector<HTMLInputElement>('input[data-key="status"]')!;
  const toggle = () => container.querySelector<HTMLButtonElement>(".fce-quick-input-properties-toggle")!;
  return { adapter: adapter!, container, cm, input, toggle, owner, unloaded, setFailure: () => { fail = true; } };
}

describe("native draft properties", () => {
  it("replaces the YAML display with a native widget while keeping the full document", () => {
    const f = fixture();
    expect(f.container.querySelector(".cm-content .metadata-container")).not.toBeNull();
    expect(f.cm.contentDOM.textContent).not.toContain("status: draft");
    expect(f.cm.contentDOM.textContent).toContain("Body");
    expect(f.cm.state.doc.toString()).toBe("---\nstatus: draft\n---\nBody");
    expect(f.owner.current!.getFile()).toBeNull();
  });

  it("flushes a child-document property input before the draft snapshot is read", () => {
    const f = fixture(undefined, false, true);
    f.input().focus(); f.input().value = "edited";
    expect(f.cm.state.doc.toString()).toContain("status: draft");
    f.adapter.flush();
    expect(f.cm.state.doc.toString()).toContain("status: edited");
    expect(f.cm.state.doc.toString()).toContain("---\nBody");
  });

  it("switches to YAML and back without changing text, and reflects source edits", () => {
    const f = fixture(); const original = f.cm.state.doc.toString();
    f.toggle().click();
    expect(f.cm.contentDOM.textContent).toContain("status: draft");
    expect(f.cm.state.doc.toString()).toBe(original);
    const from = original.indexOf("draft");
    f.cm.dispatch({ changes: { from, to: from + 5, insert: "changed" } });
    f.toggle().click();
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

  it.each(["---\nstatus: [\n---\nBody", "---\nstatus:\n  nested: value\n---\nBody", "---\nstatus: &a value\nother: *a\n---\nBody"])("keeps complex or invalid YAML visible and intact", (text) => {
    const f = fixture(text);
    expect(f.container.querySelector(".cm-content .metadata-container")).toBeNull();
    expect(f.cm.state.doc.toString()).toBe(text);
    expect(f.container.querySelector<HTMLElement>(".fce-quick-input-properties-bar")!.hidden).toBe(true);
  });

  it("locks native controls and ignores late commits while a request is frozen", () => {
    const f = fixture();
    f.adapter.setReadOnly(true);
    expect(f.container.querySelector<HTMLElement>(".metadata-container")!.inert).toBe(true);
    expect(f.toggle().disabled).toBe(true);
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
