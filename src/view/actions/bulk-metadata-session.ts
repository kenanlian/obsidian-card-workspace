import type { App, TFile } from "obsidian";
import { isMarkdownFile } from "../note-ops";
import type { TagMutationResult } from "../note-tag-ops";

export interface BulkMetadataResult {
  changed: number;
  noop: number;
  failed: TFile[];
  errors: string[];
}

/** Captures object identity. Rename follows the object; replacement never does. */
export class BulkMetadataSession {
  private pending: TFile[];

  constructor(files: readonly TFile[]) {
    this.pending = [...files];
  }

  async apply(app: App, mutate: (file: TFile) => Promise<TagMutationResult>): Promise<BulkMetadataResult> {
    const failed: TFile[] = [];
    const errors: string[] = [];
    let changed = 0;
    let noop = 0;
    for (const file of this.pending) {
      try {
        const result = app.vault.getAbstractFileByPath(file.path) === file && isMarkdownFile(file)
          ? await mutate(file)
          : { ok: false as const, error: `Invalid target: ${file.path}` };
        if (!result.ok) {
          failed.push(file);
          errors.push(`${file.path}: ${result.error}`);
        } else if (result.changed) {
          changed++;
        } else {
          noop++;
        }
      } catch (error) {
        failed.push(file);
        errors.push(`${file.path}: ${String(error)}`);
      }
    }
    this.pending = failed;
    return { changed, noop, failed, errors };
  }
}
