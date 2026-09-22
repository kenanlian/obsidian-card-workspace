import type { App, TFile } from "obsidian";

import { type CardFileKind } from "./file-kind";
import { deriveCardTaskSummary } from "./task-summary";
import type { NoteCardRecord } from "./types";

/**
 * The production constructor for base-card records.
 *
 * Every site that introduces or replaces a card in a view's base collection —
 * initial scope collection, Vault create/rename-into-scope, metadata-driven Box
 * entry, and incremental modify/rename replacement — builds its record here so
 * the live `TFile` identity, path, title, and stats always win. Test fixture
 * factories that deliberately build partial scenarios stay local to their tests.
 *
 * `deriveTasks` defaults to eager because every single-card construction site
 * reached from a Vault or Metadata event handles one file at a time, where the
 * `getFileCache` lookup is free. Only a whole-scope collection passes `false`:
 * there the lookup is once per card in the vault, so the summary starts `null`
 * and arrives through the hydration patch channel instead. `null` already means
 * "not known yet" everywhere downstream, and a scope load whose group dimension
 * is `"task"` opts back into eager derivation so task buckets stay correct.
 */
export function createCardRecord(
  app: App,
  file: TFile,
  fileKind: CardFileKind,
  deriveTasks = true,
): NoteCardRecord {
  return {
    file,
    fileKind,
    path: file.path,
    title: file.basename,
    ctime: file.stat.ctime,
    mtime: file.stat.mtime,
    excerpt: "",
    previewHtml: "",
    previewMode: "empty",
    hydrated: false,
    taskSummary: deriveTasks ? deriveCardTaskSummary(app, file, fileKind) : null,
  };
}
