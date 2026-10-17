import type { MarkdownView } from "obsidian";

/** Run after the creation modal closes, so its focus restoration cannot steal the selection. */
export function focusTemplateEditor(view: MarkdownView, selectTitle: boolean, isCurrent: () => boolean): void {
  const document = view.containerEl.ownerDocument;
  document.defaultView?.requestAnimationFrame(() => {
    if (!isCurrent()) return;
    const title = view.containerEl.querySelector<HTMLElement>(".markdown-source-view .inline-title")
      ?? view.containerEl.querySelector<HTMLElement>(".inline-title");
    if (selectTitle && title) {
      // A user's global inline-title preference must not hide the new template's title entry.
      title.style.display = "block";
      title.focus();
      const range = document.createRange();
      range.selectNodeContents(title);
      const selection = document.getSelection();
      selection?.removeAllRanges(); selection?.addRange(range);
    } else view.editor.focus();
  });
}
