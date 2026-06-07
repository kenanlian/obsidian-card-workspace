import { App, Notice, TAbstractFile, TFile, TFolder } from "obsidian";
import { getUiStrings, type NoteOpsStrings } from "../i18n";
import { normalizeTagPath } from "./tag-tree";

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

interface FileManagerTrashLike {
  trashFile?: (file: TAbstractFile) => Promise<void>;
}

interface VaultTrashLike {
  trash: (file: TAbstractFile, system: boolean) => Promise<void>;
}

interface FrontmatterProcessLike {
  processFrontMatter: (file: TFile, fn: (frontmatter: Record<string, unknown>) => void) => Promise<void>;
}

interface MetadataCacheLike {
  tags?: Array<{
    tag?: string;
    position?: {
      start?: { offset?: number };
      end?: { offset?: number };
    };
  }>;
}

export async function trashAbstractFileUsingObsidianPreference(
  app: App,
  file: TAbstractFile,
): Promise<void> {
  const fileManager = app.fileManager as unknown as FileManagerTrashLike;
  const trashFile = fileManager["trashFile"];
  if (typeof trashFile === "function") {
    await trashFile(file);
    return;
  }

  const vault = app.vault as unknown as VaultTrashLike;
  await vault.trash(file, true);
}
/**
 * Move a file to a target folder. Generates a unique name if a file with
 * the same basename already exists in the destination.
 */
export async function moveFile(
  app: App,
  file: TFile,
  targetFolder: TFolder,
  strings: NoteOpsStrings = getUiStrings("en").noteOps,
): Promise<NoteOpResult> {
  try {
    const newPath = resolveUniquePath(app, file.name, targetFolder.path);
    await app.fileManager.renameFile(file, newPath);
    const moved = app.vault.getAbstractFileByPath(newPath);
    if (!(moved instanceof TFile)) {
      return { ok: false, error: strings.fileNotFoundAfterMove, path: file.path };
    }
    return { ok: true, file: moved };
  } catch (err) {
    return { ok: false, error: String(err), path: file.path };
  }
}

/**
 * Delete a file using Obsidian's configured trash behavior.
 */
export async function deleteFile(
  app: App,
  file: TFile,
): Promise<NoteOpResult> {
  const path = file.path;
  try {
    await trashAbstractFileUsingObsidianPreference(app, file);
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: String(err), path };
  }
}

/**
 * Move a file to trash using Obsidian's configured trash behavior.
 */
export async function trashFile(
  app: App,
  file: TFile,
): Promise<NoteOpResult> {
  const path = file.path;
  try {
    await trashAbstractFileUsingObsidianPreference(app, file);
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: String(err), path };
  }
}

/**
 * Move a file to trash using Obsidian's user preference.
 */
export async function deleteFileUsingObsidianPreference(
  app: App,
  file: TFile,
): Promise<NoteOpResult> {
  const path = file.path;
  try {
    await trashAbstractFileUsingObsidianPreference(app, file);
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
// Tag operations
// ---------------------------------------------------------------------------

export function normalizeTagForFrontmatter(value: string): string {
  return normalizeTagPath(value);
}

export async function addTagToFile(
  app: App,
  file: TFile,
  tag: string,
): Promise<NoteOpResult> {
  const normalizedTag = normalizeTagForFrontmatter(tag);
  if (!isMarkdownFile(file) || normalizedTag.length === 0) {
    return { ok: false, error: "Tag operations require a Markdown note and a non-empty tag.", path: file.path };
  }

  try {
    const fileManager = app.fileManager as unknown as FrontmatterProcessLike;
    await fileManager.processFrontMatter(file, (frontmatter) => {
      const nextTags = mergeFrontmatterTags(frontmatter, normalizedTag);
      writeNormalizedFrontmatterTags(frontmatter, nextTags);
    });
    return { ok: true, file };
  } catch (err) {
    return { ok: false, error: String(err), path: file.path };
  }
}

export async function removeTagFromFile(
  app: App,
  file: TFile,
  tag: string,
): Promise<NoteOpResult> {
  const normalizedTag = normalizeTagForFrontmatter(tag);
  if (!isMarkdownFile(file) || normalizedTag.length === 0) {
    return { ok: false, error: "Tag operations require a Markdown note and a non-empty tag.", path: file.path };
  }

  try {
    const fileManager = app.fileManager as unknown as FrontmatterProcessLike;
    await fileManager.processFrontMatter(file, (frontmatter) => {
      const nextTags = removeNormalizedFrontmatterTag(frontmatter, normalizedTag);
      writeNormalizedFrontmatterTags(frontmatter, nextTags);
    });
    await removeInlineTagRangesFromFile(app, file, normalizedTag);
    return { ok: true, file };
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
  strings: NoteOpsStrings = getUiStrings("en").noteOps,
): Promise<boolean> {
  try {
    const text = await buildClipboardText(app, file);
    await navigator.clipboard.writeText(text);
    new Notice(strings.copiedToClipboard(file.basename));
    return true;
  } catch {
    new Notice(strings.failedToCopyToClipboard);
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
  strings: NoteOpsStrings = getUiStrings("en").noteOps,
): Promise<BatchOpSummary> {
  const succeeded: NoteOpSuccess[] = [];
  const failed: NoteOpFailure[] = [];

  for (const file of files) {
    const result = await moveFile(app, file, targetFolder, strings);
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
 * Move multiple files to trash using Obsidian's user preference.
 */
export async function batchDeleteFilesUsingObsidianPreference(
  app: App,
  files: TFile[],
): Promise<BatchOpSummary> {
  const succeeded: NoteOpSuccess[] = [];
  const failed: NoteOpFailure[] = [];

  for (const file of files) {
    const result = await deleteFileUsingObsidianPreference(app, file);
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

export async function batchAddTagToFiles(
  app: App,
  files: TFile[],
  tag: string,
): Promise<BatchOpSummary> {
  const succeeded: NoteOpSuccess[] = [];
  const failed: NoteOpFailure[] = [];

  for (const file of files) {
    const result = await addTagToFile(app, file, tag);
    if (result.ok) {
      succeeded.push(result);
    } else {
      failed.push(result);
    }
  }

  return { succeeded, failed };
}

export async function batchRemoveTagFromFiles(
  app: App,
  files: TFile[],
  tag: string,
): Promise<BatchOpSummary> {
  const succeeded: NoteOpSuccess[] = [];
  const failed: NoteOpFailure[] = [];

  for (const file of files) {
    const result = await removeTagFromFile(app, file, tag);
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
  separator: string = "\n\n",
  strings: NoteOpsStrings = getUiStrings("en").noteOps,
): Promise<MergeOpResult> {
  if (files.length === 0) {
    return { ok: false, error: strings.noFilesToMerge };
  }

  try {
    const sections: string[] = [];
    for (const file of files) {
      const content = await app.vault.read(file);
      sections.push(`# ${file.basename}\n\n${content}`);
    }

    const merged = sections.join(separator);
    const safeMergedTitle = normalizeMergedTitle(mergedTitle, strings.mergedNotesDefaultTitle);
    const fileName = `${safeMergedTitle}.md`;
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

function normalizeMergedTitle(mergedTitle: string, defaultTitle: string): string {
  const collapsed = mergedTitle
    .replace(/[\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return collapsed.length > 0 ? collapsed : defaultTitle;
}

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

function isMarkdownFile(file: TFile): boolean {
  return file.extension.toLowerCase() === "md";
}

function readNormalizedFrontmatterTags(frontmatter: Record<string, unknown>): string[] {
  const normalizedTags: string[] = [];
  const seen = new Set<string>();

  for (const rawValue of [frontmatter["tags"], frontmatter["tag"]]) {
    for (const rawTag of coerceFrontmatterTags(rawValue)) {
      const normalizedTag = normalizeTagForFrontmatter(rawTag);
      if (normalizedTag.length === 0 || seen.has(normalizedTag)) {
        continue;
      }

      seen.add(normalizedTag);
      normalizedTags.push(normalizedTag);
    }
  }

  return normalizedTags;
}

function coerceFrontmatterTags(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }

  return [];
}

function mergeFrontmatterTags(frontmatter: Record<string, unknown>, normalizedTag: string): string[] {
  const nextTags = readNormalizedFrontmatterTags(frontmatter);
  if (!nextTags.includes(normalizedTag)) {
    nextTags.push(normalizedTag);
  }

  return nextTags;
}

function removeNormalizedFrontmatterTag(frontmatter: Record<string, unknown>, normalizedTag: string): string[] {
  return readNormalizedFrontmatterTags(frontmatter).filter((tag) => tag !== normalizedTag);
}

function writeNormalizedFrontmatterTags(frontmatter: Record<string, unknown>, normalizedTags: string[]): void {
  if (normalizedTags.length > 0) {
    frontmatter["tags"] = normalizedTags;
  } else {
    delete frontmatter["tags"];
  }

  delete frontmatter["tag"];
}

function getInlineTagRemovalRanges(
  app: App,
  file: TFile,
  normalizedTag: string,
): Array<{ start: number; end: number }> {
  const cache = app.metadataCache.getFileCache(file) as MetadataCacheLike | null;
  if (!cache?.tags?.length) {
    return [];
  }

  const ranges: Array<{ start: number; end: number }> = [];
  for (const tagEntry of cache.tags) {
    if (normalizeTagForFrontmatter(tagEntry.tag ?? "") !== normalizedTag) {
      continue;
    }

    const startOffset = tagEntry.position?.start?.offset;
    const endOffset = tagEntry.position?.end?.offset;
    if (
      typeof startOffset !== "number"
      || typeof endOffset !== "number"
      || !Number.isInteger(startOffset)
      || !Number.isInteger(endOffset)
      || startOffset < 0
      || endOffset <= startOffset
    ) {
      continue;
    }

    ranges.push({ start: startOffset, end: endOffset });
  }

  ranges.sort((left, right) => right.start - left.start);
  return ranges;
}

async function removeInlineTagRangesFromFile(app: App, file: TFile, normalizedTag: string): Promise<void> {
  const ranges = getInlineTagRemovalRanges(app, file, normalizedTag);
  if (ranges.length === 0) {
    return;
  }

  await app.vault.process(file, (content) => {
    let nextContent = content;
    for (const range of ranges) {
      const currentSlice = nextContent.slice(range.start, range.end);
      if (normalizeTagForFrontmatter(currentSlice) !== normalizedTag) {
        continue;
      }

      nextContent = nextContent.slice(0, range.start) + nextContent.slice(range.end);
    }

    return nextContent;
  });
}
