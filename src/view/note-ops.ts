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

export interface TagMutationSuccess {
  ok: true;
  changed: true;
  file: TFile;
}

export interface TagMutationNoop {
  ok: true;
  changed: false;
  file: TFile;
}

export type TagMutationResult = TagMutationSuccess | TagMutationNoop | NoteOpFailure;

export interface BatchTagMutationSummary {
  changed: TagMutationSuccess[];
  noop: TagMutationNoop[];
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
): Promise<TagMutationResult> {
  return removeTagsFromFile(app, file, [tag]);
}

// ---------------------------------------------------------------------------
// Clipboard operations (Task 15)
// ---------------------------------------------------------------------------

/**
 * Build clipboard-ready title text for a file.
 */
export function buildTitleClipboardText(file: TFile): string {
  return file.basename;
}

/**
 * Build clipboard-ready full body text for a file.
 */
export async function buildContentClipboardText(app: App, file: TFile): Promise<string> {
  return await app.vault.cachedRead(file);
}

/**
 * Build "# Title\n\nBody" text for a file, ready for clipboard.
 */
export async function buildTitleAndContentClipboardText(
  app: App,
  file: TFile,
): Promise<string> {
  const body = await buildContentClipboardText(app, file);
  return `# ${file.basename}\n\n${body}`;
}

async function copyTextToClipboard(text: string, basename: string, strings: NoteOpsStrings): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    new Notice(strings.copiedToClipboard(basename));
    return true;
  } catch {
    new Notice(strings.failedToCopyToClipboard);
    return false;
  }
}

/**
 * Copy the title of a note to the system clipboard.
 * Shows an Obsidian Notice on success/failure.
 */
export async function copyTitleToClipboard(
  _app: App,
  file: TFile,
  strings: NoteOpsStrings = getUiStrings("en").noteOps,
): Promise<boolean> {
  const text = buildTitleClipboardText(file);
  return await copyTextToClipboard(text, file.basename, strings);
}

/** Copy an arbitrary path string, echoing it in the success Notice. */
export async function copyPathToClipboard(
  path: string,
  strings: NoteOpsStrings = getUiStrings("en").noteOps,
): Promise<boolean> {
  return await copyTextToClipboard(path, path, strings);
}

/**
 * Copy the full content of a note to the system clipboard.
 * Shows an Obsidian Notice on success/failure.
 */
export async function copyContentToClipboard(
  app: App,
  file: TFile,
  strings: NoteOpsStrings = getUiStrings("en").noteOps,
): Promise<boolean> {
  const text = await buildContentClipboardText(app, file);
  return await copyTextToClipboard(text, file.basename, strings);
}

/**
 * Copy the title + full content of a note to the system clipboard.
 * Shows an Obsidian Notice on success/failure.
 */
export async function copyTitleAndContentToClipboard(
  app: App,
  file: TFile,
  strings: NoteOpsStrings = getUiStrings("en").noteOps,
): Promise<boolean> {
  const text = await buildTitleAndContentClipboardText(app, file);
  return await copyTextToClipboard(text, file.basename, strings);
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
): Promise<BatchTagMutationSummary> {
  return batchRemoveTagsFromFiles(app, files, [tag]);
}

export async function batchRemoveTagsFromFiles(
  app: App,
  files: TFile[],
  tags: string[],
): Promise<BatchTagMutationSummary> {
  const changed: TagMutationSuccess[] = [];
  const noop: TagMutationNoop[] = [];
  const failed: NoteOpFailure[] = [];

  for (const file of files) {
    const result = await removeTagsFromFile(app, file, tags);
    if (!result.ok) {
      failed.push(result);
      continue;
    }

    if (result.changed) {
      changed.push(result);
      continue;
    }

    noop.push(result);
  }

  return { changed, noop, failed };
}

// ---------------------------------------------------------------------------
// Merge operations (Task 19)
// ---------------------------------------------------------------------------

/**
 * Build the merged markdown for the given notes, in the provided order. Only the
 * first note's frontmatter survives, hoisted to the top of the merged content so
 * it stays valid frontmatter. Shared by the merge preview and the merge itself.
 */
export function buildMergedNoteContent(
  notes: ReadonlyArray<{ basename: string; content: string }>,
  separator: string = "\n\n",
): string {
  const sections: string[] = [];
  let leadingFrontmatter = "";

  for (const note of notes) {
    const { frontmatter, body } = splitFrontmatter(note.content);
    if (sections.length === 0) {
      leadingFrontmatter = frontmatter;
    }
    sections.push(`# ${note.basename}\n\n${body}`);
  }

  return `${leadingFrontmatter}${sections.join(separator)}`;
}

/**
 * Merge multiple notes into a single new file. Content is concatenated
 * in the provided order with a configurable separator. Only the first note's
 * frontmatter survives, hoisted to the top of the merged file so it stays valid.
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

  if (files.some((file) => !isMarkdownFile(file))) {
    return { ok: false, error: strings.mergeMarkdownOnly };
  }

  try {
    const notes: Array<{ basename: string; content: string }> = [];
    for (const file of files) {
      notes.push({ basename: file.basename, content: await app.vault.read(file) });
    }

    const merged = buildMergedNoteContent(notes, separator);
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

/**
 * Split a leading YAML frontmatter block from the note body. The block only
 * counts when the note opens with a `---` line; anything else is body text.
 * The returned frontmatter keeps a trailing blank line so it can be prepended
 * directly to merged content.
 */
function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const normalized = content.replace(/^\uFEFF/, "");
  const lines = normalized.split("\n");
  if (lines[0]?.trimEnd() !== "---") {
    return { frontmatter: "", body: normalized };
  }

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]?.trimEnd();
    if (line !== "---" && line !== "...") {
      continue;
    }

    const frontmatter = lines.slice(0, index + 1).join("\n");
    const body = lines
      .slice(index + 1)
      .join("\n")
      .replace(/^(?:[ \t]*\r?\n)+/, "");

    return { frontmatter: `${frontmatter}\n\n`, body };
  }

  return { frontmatter: "", body: normalized };
}

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
export function resolveUniquePath(app: App, fileName: string, folderPath: string): string {
  // `TFolder.path` is "/" for the vault root, which would produce a "//" prefix.
  const prefix = folderPath && folderPath !== "/" ? `${folderPath}/` : "";
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

function removeNormalizedFrontmatterTagsHierarchy(frontmatterTags: string[], normalizedTags: string[]): string[] {
  return frontmatterTags.filter((tag) => !matchesAnyTagRemovalTarget(tag, normalizedTags));
}

function areTagListsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function tagPathMatchesRemovalTarget(candidateTag: string, removalTarget: string): boolean {
  const normalizedCandidateTag = normalizeTagForFrontmatter(candidateTag);
  const normalizedRemovalTarget = normalizeTagForFrontmatter(removalTarget);
  if (normalizedCandidateTag.length === 0 || normalizedRemovalTarget.length === 0) {
    return false;
  }

  return normalizedCandidateTag === normalizedRemovalTarget
    || normalizedCandidateTag.startsWith(`${normalizedRemovalTarget}/`);
}

function matchesAnyTagRemovalTarget(candidateTag: string, removalTargets: string[]): boolean {
  return removalTargets.some((removalTarget) => tagPathMatchesRemovalTarget(candidateTag, removalTarget));
}

function normalizeTagRemovalTargets(tags: string[]): string[] {
  const normalizedTags = Array.from(new Set(
    tags
      .map((tag) => normalizeTagForFrontmatter(tag))
      .filter((tag) => tag.length > 0),
  ));
  normalizedTags.sort((left, right) => left.length - right.length || left.localeCompare(right));

  const collapsedTags: string[] = [];
  for (const normalizedTag of normalizedTags) {
    if (collapsedTags.some((candidate) => tagPathMatchesRemovalTarget(normalizedTag, candidate))) {
      continue;
    }

    collapsedTags.push(normalizedTag);
  }

  return collapsedTags;
}

async function removeTagsFromFile(
  app: App,
  file: TFile,
  tags: string[],
): Promise<TagMutationResult> {
  const normalizedTags = normalizeTagRemovalTargets(tags);
  if (!isMarkdownFile(file) || normalizedTags.length === 0) {
    return { ok: false, error: "Tag operations require a Markdown note and a non-empty tag.", path: file.path };
  }

  try {
    let frontmatterChanged = false;
    const fileManager = app.fileManager as unknown as FrontmatterProcessLike;
    await fileManager.processFrontMatter(file, (frontmatter) => {
      const currentTags = readNormalizedFrontmatterTags(frontmatter);
      const nextTags = removeNormalizedFrontmatterTagsHierarchy(currentTags, normalizedTags);
      frontmatterChanged = !areTagListsEqual(currentTags, nextTags);
      writeNormalizedFrontmatterTags(frontmatter, nextTags);
    });
    const inlineChanged = await removeInlineTagRangesFromFile(app, file, normalizedTags);
    return {
      ok: true,
      changed: frontmatterChanged || inlineChanged,
      file,
    };
  } catch (err) {
    return { ok: false, error: String(err), path: file.path };
  }
}

function writeNormalizedFrontmatterTags(frontmatter: Record<string, unknown>, normalizedTags: string[]): void {
  if (normalizedTags.length > 0) {
    frontmatter["tags"] = normalizedTags;
  } else {
    delete frontmatter["tags"];
  }

  delete frontmatter["tag"];
}

function findFencedCodeBlockRanges(content: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const lines = content.split("\n");
  let currentStart = -1;
  let fenceMarker = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trimStart();
    if (currentStart === -1) {
      if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
        currentStart = lines.slice(0, index).join("\n").length + (index > 0 ? 1 : 0);
        fenceMarker = trimmed.startsWith("```") ? "```" : "~~~";
      }
    } else {
      if (trimmed.startsWith(fenceMarker)) {
        const end = lines.slice(0, index + 1).join("\n").length;
        ranges.push({ start: currentStart, end });
        currentStart = -1;
        fenceMarker = "";
      }
    }
  }

  return ranges;
}

function findInlineCodeRanges(content: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const regex = /`[^`]+`/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
}

function findHtmlTagRanges(content: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];

  // Self-closing tags
  const selfClosingRegex = /<[^>]+?\/>/g;
  let match: RegExpExecArray | null;
  while ((match = selfClosingRegex.exec(content)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  // Paired tags (non-greedy to match the shortest valid pair)
  const pairedRegex = /<(\w+)[^>]*>[\s\S]*?<\/\1>/g;
  while ((match = pairedRegex.exec(content)) !== null) {
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  return ranges;
}

function computeExclusionRanges(content: string): Array<{ start: number; end: number }> {
  return [
    ...findFencedCodeBlockRanges(content),
    ...findInlineCodeRanges(content),
    ...findHtmlTagRanges(content),
  ];
}

function isRangeInExclusionRanges(
  range: { start: number; end: number },
  exclusionRanges: Array<{ start: number; end: number }>,
): boolean {
  return exclusionRanges.some((exclusion) => range.start >= exclusion.start && range.end <= exclusion.end);
}
function getInlineTagHierarchyRemovalRanges(
  app: App,
  file: TFile,
  normalizedTags: string[],
): Array<{ start: number; end: number }> {
  const cache = app.metadataCache.getFileCache(file) as MetadataCacheLike | null;
  if (!cache?.tags?.length || normalizedTags.length === 0) {
    return [];
  }

  const ranges: Array<{ start: number; end: number }> = [];
  for (const tagEntry of cache.tags) {
    if (!matchesAnyTagRemovalTarget(tagEntry.tag ?? "", normalizedTags)) {
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

async function removeInlineTagRangesFromFile(app: App, file: TFile, normalizedTags: string[]): Promise<boolean> {
  const ranges = getInlineTagHierarchyRemovalRanges(app, file, normalizedTags);
  if (ranges.length === 0) {
    return false;
  }

  const content = await app.vault.cachedRead(file);
  const exclusionRanges = computeExclusionRanges(content);
  const safeRanges = ranges.filter((range) => !isRangeInExclusionRanges(range, exclusionRanges));
  if (safeRanges.length === 0) {
    return false;
  }

  let changed = false;
  await app.vault.process(file, (content) => {
    let nextContent = content;
    for (const range of safeRanges) {
      const currentSlice = nextContent.slice(range.start, range.end);
      if (!matchesAnyTagRemovalTarget(currentSlice, normalizedTags)) {
        continue;
      }

      nextContent = nextContent.slice(0, range.start) + nextContent.slice(range.end);
      changed = true;
    }

    return nextContent;
  });
  return changed;
}