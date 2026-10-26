import { createNativeMarkdownEditor, type NativeMarkdownEditor } from "./native-markdown-editor";
/** Full-source fallback preserves frontmatter and submission when optional native APIs are absent. */
export function createMobileDraftEditor(options: Parameters<typeof createNativeMarkdownEditor>[0]): NativeMarkdownEditor {
  try { return createNativeMarkdownEditor(options); }
  catch {
    options.container.replaceChildren();
    const textarea = options.container.createEl("textarea", { cls: "fce-mobile-draft-source", attr: { placeholder: options.placeholder, "aria-label": options.placeholder } });
    textarea.value = options.initialValue ?? "";
    textarea.addEventListener("input", options.onChange);
    const key = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") options.onModEnter(event); };
    textarea.addEventListener("keydown", key);
    return { getValue: () => textarea.value, focus: () => textarea.focus(), flush: () => textarea.blur(), setReadOnly: value => { textarea.readOnly = value; },
      dispose: () => { textarea.removeEventListener("input", options.onChange); textarea.removeEventListener("keydown", key); textarea.remove(); } };
  }
}
