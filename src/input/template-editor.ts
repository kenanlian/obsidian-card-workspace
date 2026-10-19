import type { MarkdownView } from "obsidian";
import type { TemplateNoteCursor } from "../note-input";

/** Let the host finish opening/switching modes before focusing the inserted body. */
export async function focusTemplateNote(view: MarkdownView, cursor: TemplateNoteCursor, isCurrent: () => boolean, signal: AbortSignal): Promise<void> {
  const doc = view.containerEl.ownerDocument;
  const win = doc.defaultView;
  if (!win) return;
  let interrupted = signal.aborted;
  let frame: number | null = null;
  let finishFrame: (() => void) | null = null;
  const events = ["pointerdown", "keydown", "wheel", "touchstart", "input"] as const;
  const cleanup = () => {
    for (const event of events) doc.removeEventListener(event, cancel, true);
    signal.removeEventListener("abort", cancel);
  };
  const cancel = () => {
    interrupted = true;
    if (frame !== null) win.cancelAnimationFrame(frame);
    finishFrame?.();
    cleanup();
  };
  const normalizedContent = cursor.content.replace(/\r\n/g, "\n");
  const matches = (content: string) => content === cursor.content || content.replace(/\r\n/g, "\n") === normalizedContent;
  const current = () => !interrupted && isCurrent() && matches(view.getViewData());
  for (const event of events) doc.addEventListener(event, cancel, true);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (!current()) return;
    if (view.getMode() !== "source") {
      await view.leaf.setViewState({ ...view.leaf.getViewState(), state: { ...view.getState(), mode: "source" } });
    }
    if (!current()) return;
    await new Promise<void>((resolve, reject) => {
      finishFrame = resolve;
      frame = win.requestAnimationFrame(() => {
        frame = null;
        try {
          if (!current() || !matches(view.editor.getValue())) return;
          // The native editor may normalize Windows line endings while opening.
          const lines = cursor.content.slice(0, cursor.offset).split(/\r?\n/);
          const pos = { line: lines.length - 1, ch: lines[lines.length - 1].length };
          view.editor.setCursor(pos);
          view.editor.scrollIntoView({ from: pos, to: pos }, true);
          view.editor.focus();
        } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
        finally { resolve(); }
      });
    });
  } finally { cleanup(); }
}

/** Run after the creation modal closes, so its focus restoration cannot steal the selection. */
export function focusTemplateEditor(view: MarkdownView, selectTitle: boolean, isCurrent: () => boolean): void {
  const document = view.containerEl.ownerDocument;
  document.defaultView?.requestAnimationFrame(() => {
    if (!isCurrent()) return;
    const title = view.containerEl.querySelector<HTMLElement>(".markdown-source-view .inline-title")
      ?? view.containerEl.querySelector<HTMLElement>(".inline-title");
    if (selectTitle && title) {
      // A user's global inline-title preference must not hide the new template's title entry.
      title.classList.add("fce-template-title-entry");
      title.focus();
      const range = document.createRange();
      range.selectNodeContents(title);
      const selection = document.getSelection();
      selection?.removeAllRanges(); selection?.addRange(range);
    } else view.editor.focus();
  });
}
