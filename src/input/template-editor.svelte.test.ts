import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { focusTemplateEditor } from "./template-editor";
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
