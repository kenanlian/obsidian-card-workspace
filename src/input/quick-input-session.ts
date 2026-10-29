import type { App } from "obsidian";
import type { QuickInputDuplicateTitle, QuickInputMode, QuickInputRequest } from "../note-input";
import { NoteCreationService } from "../services/NoteCreationService";
import { stripEmptyDraftFrontmatter } from "./draft-frontmatter";
import type { NativeMarkdownEditor } from "./native-markdown-editor";

export type QuickInputDraftContext = Pick<QuickInputRequest, "config" | "now" | "target">;
export interface QuickInputTarget {
  folderPath: string;
  path: string | null;
  valid: boolean;
  existing: boolean;
  mode: QuickInputMode;
}
/** Both presentations use the same preflight as the serialized note writer. */
export function resolveQuickInputTarget(app: App, context: QuickInputDraftContext): QuickInputTarget {
  const folderPath = context.target?.folderPath ?? context.config.folderPath;
  try {
    const resolved = new NoteCreationService(app).resolveQuickInputTarget(context);
    const existing = resolved.mode === "append";
    return { folderPath, path: resolved.path, valid: true, existing,
      mode: existing && context.config.duplicateTitle === "append" ? "append" : "create" };
  } catch {
    return { folderPath, path: null, valid: false, existing: false, mode: "create" };
  }
}
/** Mobile submission state retains one immutable request through uncertain writes. */
export class QuickInputDraftSession {
  composing = false;
  pending = false;
  request: QuickInputRequest | null = null;
  constructor(readonly context: QuickInputDraftContext) {}
  freeze(editor: NativeMarkdownEditor, submissionId: string, duplicateTitle: Exclude<QuickInputDuplicateTitle, "ask">,
    existing: boolean, boxIds: readonly string[]): QuickInputRequest | null {
    if (this.pending || this.composing) return null;
    if (!this.request) {
      editor.flush();
      const text = stripEmptyDraftFrontmatter(editor.getValue());
      if (!text.trim()) return null;
      this.request = { ...this.context, config: { ...this.context.config, duplicateTitle },
        target: this.context.target ? { ...this.context.target } : undefined,
        now: new Date(), submissionId, text, boxIds: [...boxIds],
        expectedMode: duplicateTitle === "append" && existing ? "append" : "create" };
    }
    this.pending = true;
    editor.setReadOnly(true);
    return this.request;
  }
}
