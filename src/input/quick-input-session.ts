import { TFile, TFolder, type App } from "obsidian";
import type { NoteTemplateDefinition, QuickInputConfig, QuickInputRequest } from "../note-input";
import type { NativeMarkdownEditor } from "./native-markdown-editor";

export type QuickInputDraftContext = Pick<QuickInputRequest, "config" | "template" | "now">;
export interface QuickInputTarget {
  template: NoteTemplateDefinition | null;
  folderPath: string | null;
  insertPosition: QuickInputConfig["insertPosition"];
  valid: boolean;
}
export function resolveQuickInputTarget(app: App, context: QuickInputDraftContext): QuickInputTarget {
  const { config, template } = context;
  const folderPath = config.templateId ? template?.targetFolderPath ?? null : config.folderPath;
  const target = { template, folderPath, insertPosition: config.insertPosition, valid: false };
  if (folderPath === null || folderPath === undefined) return target;
  const folder = folderPath === "" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(folderPath);
  if (!(folder instanceof TFolder)) return target;
  if (config.templateId && !template) return target;
  if (template) {
    const file = app.vault.getAbstractFileByPath(template.filePath);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") return target;
  }
  return { ...target, valid: config.insertPosition === "start" || config.insertPosition === "end" };
}
/** Shared submission state for desktop windows and the single mobile Modal. */
export class QuickInputDraftSession {
  composing = false;
  pending = false;
  request: QuickInputRequest | null = null;
  constructor(readonly context: QuickInputDraftContext, public templateReady: boolean) {}
  freeze(editor: NativeMarkdownEditor, submissionId: string): QuickInputRequest | null {
    if (this.pending || this.composing || !this.templateReady) return null;
    if (!this.request) {
      editor.flush();
      const text = editor.getValue();
      if (!text.trim()) return null;
      this.request = { ...this.context, now: this.context.template ? this.context.now : new Date(), submissionId, text };
    }
    this.pending = true;
    editor.setReadOnly(true);
    return this.request;
  }
}
