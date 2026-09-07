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
 * the live `TFile` identity, path, title, and stats always win and the Markdown
 * task summary is derived exactly once from current metadata. Test fixture
 * factories that deliberately build partial scenarios stay local to their tests.
 */
export function createCardRecord(app: App, file: TFile, fileKind: CardFileKind): NoteCardRecord {
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
    taskSummary: deriveCardTaskSummary(app, file, fileKind),
  };
}
