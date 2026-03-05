import { App, TFile, TFolder, Notice } from "obsidian";

// ---------------------------------------------------------------------------
// Result types — every operation returns a typed result for caller handling.
// ---------------------------------------------------------------------------

export interface NoteOpSuccess {
  ok: true;
  file: TFile;
}

export interface NoteOpFailure {
  ok: false;
  error: string;
  path: string;
}

export type NoteOpResult = NoteOpSuccess | NoteOpFailure;

export interface BatchOpSummary {
  succeeded: NoteOpSuccess[];
  failed: NoteOpFailure[];
}

export interface MergeResult {
  ok: true;
  mergedFile: TFile;
  sourceCount: number;
}

export interface MergeFailure {
  ok: false;
  error: string;
}

export type MergeOpResult = MergeResult | MergeFailure;

// ---------------------------------------------------------------------------
// Single-file operations
// ---------------------------------------------------------------------------

/**
 * Move a file to a target folder. Generates a unique name if a file with
 * the same basename already exists in the destination.
 */
export async function moveFile(
  app: App,
  file: TFile,
  targetFolder: TFolder,
): Promise<NoteOpResult> {
  try {
    const newPath = resolveUniquePath(app, file.name, targetFolder.path);
    await app.fileManager.renameFile(file, newPath);
    const moved = app.vault.getAbstractFileByPath(newPath);
    if (!(moved instanceof TFile)) {
      return { ok: false, error: "File not found after move", path: file.path };
    }
    return { ok: true, file: moved };
  } catch (err) {
    return { ok: false, error: String(err), path: file.path };
  }
}

/**
 * Permanently delete a file (no trash).
 */
export async function deleteFile(
  app: App,
  file: TFile,
): Promise<NoteOpResult> {
  const path = file.path;
  try {
    await app.vault.delete(file);
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: String(err), path };
  }
}

/**
 * Move a file to the system trash (or Obsidian .trash, based on user prefs).
 */
export async function trashFile(
  app: App,
  file: TFile,
): Promise<NoteOpResult> {
  const path = file.path;
  try {
    await app.vault.trash(file, true);
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: String(err), path };
  }
}

/**
 * Duplicate a file into the same folder (appends " copy" or " copy N").
 */
export async function duplicateFile(
  app: App,
  file: TFile,
): Promise<NoteOpResult> {
  try {
    const content = await app.vault.read(file);
    const parentPath = file.parent?.path ?? "";
    const stem = file.basename;
    const ext = file.extension;
    const copyName = `${stem} copy.${ext}`;
    const newPath = resolveUniquePath(app, copyName, parentPath);
    const created = await app.vault.create(newPath, content);
    return { ok: true, file: created };
  } catch (err) {
    return { ok: false, error: String(err), path: file.path };
  }
}

// ---------------------------------------------------------------------------
// Clipboard operations (Task 15)
// ---------------------------------------------------------------------------

/**
 * Build "# Title\n\nBody" text for a file, ready for clipboard.
 */
export async function buildClipboardText(
  app: App,
  file: TFile,
): Promise<string> {
  const body = await app.vault.cachedRead(file);
  return `# ${file.basename}\n\n${body}`;
}

/**
 * Copy the title + full content of a note to the system clipboard.
 * Shows an Obsidian Notice on success/failure.
 */
export async function copyNoteToClipboard(
  app: App,
  file: TFile,
): Promise<boolean> {
  try {
    const text = await buildClipboardText(app, file);
    await navigator.clipboard.writeText(text);
    new Notice(`Copied "${file.basename}" to clipboard`);
    return true;
  } catch {
    new Notice("Failed to copy to clipboard");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Batch operations (Task 17 / 18)
// ---------------------------------------------------------------------------

/**
 * Move multiple files to a target folder. Continues even if individual
 * moves fail, collecting results.
 */
export async function batchMoveFiles(
  app: App,
  files: TFile[],
  targetFolder: TFolder,
): Promise<BatchOpSummary> {
  const succeeded: NoteOpSuccess[] = [];
  const failed: NoteOpFailure[] = [];

  for (const file of files) {
    const result = await moveFile(app, file, targetFolder);
    if (result.ok) {
      succeeded.push(result);
    } else {
      failed.push(result);
    }
  }

  return { succeeded, failed };
}

/**
 * Trash multiple files. Continues even if individual ops fail.
 */
export async function batchTrashFiles(
  app: App,
  files: TFile[],
): Promise<BatchOpSummary> {
  const succeeded: NoteOpSuccess[] = [];
  const failed: NoteOpFailure[] = [];

  for (const file of files) {
    const result = await trashFile(app, file);
    if (result.ok) {
      succeeded.push(result);
    } else {
      failed.push(result);
    }
  }

  return { succeeded, failed };
}

/**
 * Permanently delete multiple files. Continues even if individual ops fail.
 */
export async function batchDeleteFiles(
  app: App,
  files: TFile[],
): Promise<BatchOpSummary> {
  const succeeded: NoteOpSuccess[] = [];
  const failed: NoteOpFailure[] = [];

  for (const file of files) {
    const result = await deleteFile(app, file);
    if (result.ok) {
      succeeded.push(result);
    } else {
      failed.push(result);
    }
  }

  return { succeeded, failed };
}

// ---------------------------------------------------------------------------
// Merge operations (Task 19)
// ---------------------------------------------------------------------------

/**
 * Merge multiple notes into a single new file. Content is concatenated
 * in the provided order with a configurable separator.
 *
 * Does NOT delete the source files — callers decide whether to trash them.
 */
export async function mergeNotes(
  app: App,
  files: TFile[],
  targetFolder: TFolder,
  mergedTitle: string,
  separator: string = "\n\n---\n\n",
): Promise<MergeOpResult> {
  if (files.length === 0) {
    return { ok: false, error: "No files to merge" };
  }

  try {
    const sections: string[] = [];
    for (const file of files) {
      const content = await app.vault.read(file);
      sections.push(`# ${file.basename}\n\n${content}`);
    }

    const merged = sections.join(separator);
    const fileName = `${mergedTitle}.md`;
    const newPath = resolveUniquePath(app, fileName, targetFolder.path);
    const created = await app.vault.create(newPath, merged);

    return { ok: true, mergedFile: created, sourceCount: files.length };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a unique file path inside `folderPath`. If `fileName` already
 * exists, appends " 1", " 2", etc. before the extension.
 */
function resolveUniquePath(app: App, fileName: string, folderPath: string): string {
  const prefix = folderPath ? `${folderPath}/` : "";
  const candidate = `${prefix}${fileName}`;

  if (!app.vault.getAbstractFileByPath(candidate)) {
    return candidate;
  }

  const dotIndex = fileName.lastIndexOf(".");
  const stem = dotIndex !== -1 ? fileName.slice(0, dotIndex) : fileName;
  const ext = dotIndex !== -1 ? fileName.slice(dotIndex) : "";

  for (let counter = 1; counter < 10000; counter += 1) {
    const numbered = `${prefix}${stem} ${counter}${ext}`;
    if (!app.vault.getAbstractFileByPath(numbered)) {
      return numbered;
    }
  }

  return `${prefix}${stem} ${Date.now()}${ext}`;
}
