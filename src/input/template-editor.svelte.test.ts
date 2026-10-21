import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { focusTemplateEditor, focusTemplateNote } from "./template-editor";
const pluginStyles = readFileSync("styles.css", "utf8");
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
function fixture() {
  const containerEl = document.createElement("div");
  const style = document.createElement("style");
  style.textContent = `body:not(.show-inline-title) .inline-title { display: none; }\n${pluginStyles}`;
  containerEl.appendChild(style);
  const title = document.createElement("div"); title.className = "inline-title"; title.contentEditable = "true"; title.tabIndex = 0;
  title.textContent = "请在此处编辑模板标题"; containerEl.appendChild(title); document.body.appendChild(containerEl);
  const focus = vi.fn();
  let frame: FrameRequestCallback;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frame = callback; return 1; });
  const view = { containerEl, editor: { focus } };
  return { view, title, focus, frame: () => frame!(0) };
}
describe("template editor focus", () => {
  it("selects the full title after the modal's close turn, even when inline titles were hidden", () => {
    const f = fixture(); focusTemplateEditor(f.view as never, true, () => true);
    expect(document.getSelection()?.toString()).not.toBe(f.title.textContent);
    expect(window.getComputedStyle(f.title).display).toBe("none");
    f.frame(); expect(document.activeElement).toBe(f.title); expect(document.getSelection()?.toString()).toBe(f.title.textContent);
    expect(window.getComputedStyle(f.title).display).toBe("block"); expect(f.focus).not.toHaveBeenCalled();
  });
  it("selects the editing title when a hidden preview title also exists", () => {
    const f = fixture();
    const preview = f.title.cloneNode(true) as HTMLElement; preview.textContent = "Preview";
    const source = document.createElement("div"); source.className = "markdown-source-view"; source.appendChild(f.title);
    f.view.containerEl.prepend(preview); f.view.containerEl.appendChild(source);
    focusTemplateEditor(f.view as never, true, () => true); f.frame();
    expect(document.getSelection()?.toString()).toBe(f.title.textContent); expect(document.activeElement).toBe(f.title);
  });
  it("does not steal focus after the user changes editors", () => {
    const f = fixture(); focusTemplateEditor(f.view as never, true, () => false); f.frame();
    expect(document.activeElement).not.toBe(f.title); expect(f.focus).not.toHaveBeenCalled();
  });
  it("focuses the body when editing an existing template", () => {
    const f = fixture(); focusTemplateEditor(f.view as never, false, () => true); f.frame(); expect(f.focus).toHaveBeenCalledOnce();
  });
});

function noteFixture(initialMode: "source" | "preview" = "source") {
  const containerEl = document.createElement("div"); document.body.appendChild(containerEl);
  let content = "---\nstatus: existing\n---\n\nnew body\n\nold body";
  let mode = initialMode;
  let frame!: FrameRequestCallback;
  const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frame = callback; return 1; });
  const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  const view = {
    containerEl,
    getMode: () => mode,
    getViewData: () => content,
    getState: () => ({ file: "Daily.md", mode }),
    leaf: {
      getViewState: () => ({ type: "markdown", state: { file: "Daily.md", mode } }),
      setViewState: vi.fn(async () => { mode = "source"; }),
    },
    editor: {
      getValue: () => content,
      offsetToPos: vi.fn((offset: number) => {
        const lines = content.slice(0, offset).split("\n");
        return { line: lines.length - 1, ch: lines.at(-1)!.length };
      }),
      setCursor: vi.fn(), scrollIntoView: vi.fn(), focus: vi.fn(),
    },
  };
  const cursor = { content, offset: content.indexOf("new body") + "new body".length };
  const controller = new AbortController();
  return { view, cursor, controller, request, cancel, frame: () => frame(0), edit: () => { content += "\nnew user edit"; } };
}

describe("template note cursor and focus", () => {
  it("positions at the end of the inserted body, before the old body and its separator", async () => {
    const f = noteFixture();
    const pending = focusTemplateNote(f.view as never, f.cursor, () => true, f.controller.signal);
    expect(f.view.editor.setCursor).not.toHaveBeenCalled();
    f.frame(); await pending;
    const pos = { line: 4, ch: 8 };
    expect(f.view.editor.setCursor).toHaveBeenCalledWith(pos);
    expect(f.view.editor.scrollIntoView).toHaveBeenCalledWith({ from: pos, to: pos }, true);
    expect(f.view.editor.focus).toHaveBeenCalledOnce();
  });

  it("switches a note opened in reading mode to editing before positioning", async () => {
    const f = noteFixture("preview");
    const pending = focusTemplateNote(f.view as never, f.cursor, () => true, f.controller.signal);
    expect(f.view.leaf.setViewState).toHaveBeenCalledWith({ type: "markdown", state: { file: "Daily.md", mode: "source" } });
    await Promise.resolve(); f.frame(); await pending;
    expect(f.view.editor.focus).toHaveBeenCalledOnce();
  });

  it("positions correctly when a Windows CRLF note is normalized by the editor", async () => {
    const f = noteFixture();
    const cursor = {
      content: f.cursor.content.replace(/\n/g, "\r\n"),
      offset: f.cursor.content.slice(0, f.cursor.offset).replace(/\n/g, "\r\n").length,
    };
    const pending = focusTemplateNote(f.view as never, cursor, () => true, f.controller.signal);
    f.frame(); await pending;
    expect(f.view.editor.setCursor).toHaveBeenCalledWith({ line: 4, ch: 8 });
    expect(f.view.editor.focus).toHaveBeenCalledOnce();
  });

  it.each(["pointerdown", "keydown", "wheel", "touchstart", "input"])("cancels pending positioning after %s without stealing focus", async (event) => {
    const f = noteFixture();
    const pending = focusTemplateNote(f.view as never, f.cursor, () => true, f.controller.signal);
    document.dispatchEvent(new Event(event));
    await pending;
    expect(f.cancel).toHaveBeenCalledWith(1);
    f.frame();
    expect(f.view.editor.setCursor).not.toHaveBeenCalled();
    expect(f.view.editor.focus).not.toHaveBeenCalled();
  });

  it("cancels and releases a pending animation frame when the request is aborted", async () => {
    const f = noteFixture();
    const pending = focusTemplateNote(f.view as never, f.cursor, () => true, f.controller.signal);
    f.controller.abort(); await pending;
    expect(f.cancel).toHaveBeenCalledWith(1);
    expect(f.view.editor.focus).not.toHaveBeenCalled();
  });

  it("skips positioning if the note changed after writing", async () => {
    const f = noteFixture();
    const pending = focusTemplateNote(f.view as never, f.cursor, () => true, f.controller.signal);
    f.edit(); f.frame(); await pending;
    expect(f.view.editor.setCursor).not.toHaveBeenCalled();
    expect(f.view.editor.focus).not.toHaveBeenCalled();
  });

  it("skips positioning if another editor becomes current during mode switching", async () => {
    const f = noteFixture("preview");
    let current = true;
    let release!: () => void;
    f.view.leaf.setViewState.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve; }));
    const pending = focusTemplateNote(f.view as never, f.cursor, () => current, f.controller.signal);
    current = false; release(); await pending;
    expect(f.request).not.toHaveBeenCalled();
    expect(f.view.editor.focus).not.toHaveBeenCalled();
  });

  it("does not switch a stale note out of reading mode", async () => {
    const f = noteFixture("preview"); f.edit();
    await focusTemplateNote(f.view as never, f.cursor, () => true, f.controller.signal);
    expect(f.view.leaf.setViewState).not.toHaveBeenCalled();
    expect(f.request).not.toHaveBeenCalled();
  });

  it("reports positioning errors through the caller and releases listeners", async () => {
    const f = noteFixture();
    const remove = vi.spyOn(document, "removeEventListener");
    f.view.editor.setCursor.mockImplementationOnce(() => { throw new Error("editor unavailable"); });
    const pending = focusTemplateNote(f.view as never, f.cursor, () => true, f.controller.signal);
    const rejected = expect(pending).rejects.toThrow("editor unavailable");
    f.frame(); await rejected;
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    expect(f.view.editor.focus).not.toHaveBeenCalled();
  });
});
