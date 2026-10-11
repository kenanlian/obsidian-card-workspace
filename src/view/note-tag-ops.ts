import type { App, TFile } from "obsidian";
import type { BulkTagsDraft } from "./bulk-metadata";
import { isMarkdownFile, type BatchOpSummary, type NoteOpFailure, type NoteOpResult } from "./note-ops";
import { normalizeTagPath, renameTagPathPrefix } from "./tag-tree";

// ---------------------------------------------------------------------------
// Result types — every operation returns a typed result for caller handling.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Single-file tag operations
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

/**
 * Rename a tag (and its whole `tag/*` subtree) inside one note: frontmatter
 * tags are prefix-mapped (merging with an existing target tag), and inline
 * `#tag` occurrences are rewritten in place via cached positions. Uses the
 * standard `processFrontMatter` / `vault.process` flows, so Obsidian's own
 * Cmd+Z undo works per file.
 */
export async function renameTagInFile(
  app: App,
  file: TFile,
  from: string,
  to: string,
): Promise<TagMutationResult> {
  const normalizedFrom = normalizeTagForFrontmatter(from);
  const normalizedTo = normalizeTagForFrontmatter(to);
  if (!isMarkdownFile(file) || normalizedFrom.length === 0 || normalizedTo.length === 0) {
    return { ok: false, error: "Tag operations require a Markdown note and a non-empty tag.", path: file.path };
  }
  if (normalizedFrom === normalizedTo) {
    return { ok: true, changed: false, file };
  }

  try {
    let frontmatterChanged = false;
    const fileManager = app.fileManager as unknown as FrontmatterProcessLike;
    await fileManager.processFrontMatter(file, (frontmatter) => {
      const currentTags = readNormalizedFrontmatterTags(frontmatter);
      const nextTags: string[] = [];
      for (const tag of currentTags) {
        const mapped = renameTagPathPrefix(tag, normalizedFrom, normalizedTo);
        const nextTag = mapped ?? tag;
        if (!nextTags.includes(nextTag)) {
          nextTags.push(nextTag);
        }
      }
      frontmatterChanged = !areTagListsEqual(currentTags, nextTags);
      writeNormalizedFrontmatterTags(frontmatter, nextTags);
    });
    const inlineChanged = await renameInlineTagRangesFromFile(app, file, normalizedFrom, normalizedTo);
    return {
      ok: true,
      changed: frontmatterChanged || inlineChanged,
      file,
    };
  } catch (err) {
    return { ok: false, error: String(err), path: file.path };
  }
}

// ---------------------------------------------------------------------------
// Batch tag operations
// ---------------------------------------------------------------------------

export async function batchAddTagToFiles(
  app: App,
  files: TFile[],
  tag: string,
): Promise<BatchOpSummary> {
  const succeeded: BatchOpSummary["succeeded"] = [];
  const failed: BatchOpSummary["failed"] = [];

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

/**
 * Rename a tag across many files. Continues past individual failures like the
 * other batch operations; `noop` collects files the rename never touched.
 */
export async function batchRenameTagInFiles(
  app: App,
  files: TFile[],
  from: string,
  to: string,
): Promise<BatchTagMutationSummary> {
  const changed: TagMutationSuccess[] = [];
  const noop: TagMutationNoop[] = [];
  const failed: NoteOpFailure[] = [];

  for (const file of files) {
    const result = await renameTagInFile(app, file, from, to);
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
// Frontmatter tag helpers
// ---------------------------------------------------------------------------

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
  return editTagsInFile(app, file, { addTags: [], removeTags: tags });
}

export async function editTagsInFile(app: App, file: TFile, draft: BulkTagsDraft): Promise<TagMutationResult> {
  const addTags = Array.from(new Set(draft.addTags.map(normalizeTagForFrontmatter)));
  const removeTags = normalizeTagRemovalTargets(draft.removeTags);
  if (!isMarkdownFile(file) || addTags.some((tag) => !tag) || addTags.some((tag) => draft.removeTags.map(normalizeTagForFrontmatter).includes(tag)) || addTags.length + removeTags.length === 0) {
    return { ok: false, path: file.path, error: "Invalid tag operation." };
  }
  try {
    // Cached body positions must be consumed before frontmatter changes its length.
    const inlineChanged = await removeInlineTagRangesFromFile(app, file, removeTags);
    let frontmatterChanged = false;
    await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      const current = readNormalizedFrontmatterTags(frontmatter);
      const next = removeNormalizedFrontmatterTagsHierarchy(current, removeTags);
      for (const tag of addTags) if (!next.includes(tag)) next.push(tag);
      frontmatterChanged = !areTagListsEqual(current, next);
      if (frontmatterChanged) writeNormalizedFrontmatterTags(frontmatter, next);
    });
    return { ok: true, changed: inlineChanged || frontmatterChanged, file };
  } catch (error) { return { ok: false, path: file.path, error: String(error) }; }
}

function writeNormalizedFrontmatterTags(frontmatter: Record<string, unknown>, normalizedTags: string[]): void {
  if (normalizedTags.length > 0) {
    frontmatter["tags"] = normalizedTags;
  } else {
    delete frontmatter["tags"];
  }

  delete frontmatter["tag"];
}

// ---------------------------------------------------------------------------
// Inline tag range helpers
// ---------------------------------------------------------------------------

function findFencedCodeBlockRanges(content: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let offset = 0;
  let open: { start: number; marker: string; length: number } | null = null;
  for (const line of content.split("\n")) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!open && fence) open = { start: offset, marker: fence[1][0], length: fence[1].length };
    else if (open && fence && fence[1][0] === open.marker && fence[1].length >= open.length && !fence[2].trim()) {
      ranges.push({ start: open.start, end: offset + line.length });
      open = null;
    } else if (!open && /^(?: {4}|\t)/.test(line)) ranges.push({ start: offset, end: offset + line.length });
    offset += line.length + 1;
  }
  if (open) ranges.push({ start: open.start, end: content.length });
  return ranges;
}

function findInlineCodeRanges(content: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const runs = /`+/g;
  let match: RegExpExecArray | null;
  while ((match = runs.exec(content)) !== null) {
    const start = match.index;
    const width = match[0].length;
    let end: RegExpExecArray | null;
    while ((end = runs.exec(content)) !== null) {
      if (end[0].length === width) { ranges.push({ start, end: runs.lastIndex }); break; }
    }
    if (!end) runs.lastIndex = start + width;
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

  let changed = false;
  await app.vault.process(file, (content) => {
    const exclusionRanges = computeExclusionRanges(content);
    const frontmatterEnd = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(content)?.[0].length ?? 0;
    const seen = new Set<string>();
    const safeRanges = ranges.filter((range) => {
      const identity = `${range.start}:${range.end}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return range.start >= frontmatterEnd && !isRangeInExclusionRanges(range, exclusionRanges);
    });
    let nextContent = content;
    for (const range of safeRanges) {
      const currentSlice = nextContent.slice(range.start, range.end);
      if (!/^#[^\s#]+$/.test(currentSlice) || !matchesAnyTagRemovalTarget(currentSlice, normalizedTags)
        || /[\p{L}\p{N}_/-]/u.test(nextContent[range.end] ?? "")) {
        continue;
      }

      nextContent = nextContent.slice(0, range.start) + nextContent.slice(range.end);
      changed = true;
    }

    return nextContent;
  });
  return changed;
}

interface InlineTagRenameRange {
  start: number;
  end: number;
  replacement: string;
}

function getInlineTagRenameRanges(
  app: App,
  file: TFile,
  normalizedFrom: string,
  normalizedTo: string,
): InlineTagRenameRange[] {
  const cache = app.metadataCache.getFileCache(file) as MetadataCacheLike | null;
  if (!cache?.tags?.length) {
    return [];
  }

  const ranges: InlineTagRenameRange[] = [];
  for (const tagEntry of cache.tags) {
    const mappedTag = renameTagPathPrefix(tagEntry.tag ?? "", normalizedFrom, normalizedTo);
    if (mappedTag === null) {
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

    ranges.push({ start: startOffset, end: endOffset, replacement: `#${mappedTag}` });
  }

  ranges.sort((left, right) => right.start - left.start);
  return ranges;
}

async function renameInlineTagRangesFromFile(
  app: App,
  file: TFile,
  normalizedFrom: string,
  normalizedTo: string,
): Promise<boolean> {
  const ranges = getInlineTagRenameRanges(app, file, normalizedFrom, normalizedTo);
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
      if (renameTagPathPrefix(currentSlice, normalizedFrom, normalizedTo) === null) {
        continue;
      }

      nextContent = nextContent.slice(0, range.start)
        + range.replacement
        + nextContent.slice(range.end);
      changed = true;
    }

    return nextContent;
  });
  return changed;
}
