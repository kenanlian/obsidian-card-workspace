import { App, TFile, getAllTags } from "obsidian";
import type { CachedMetadata } from "obsidian";
import { normalizeTagPath, tagPathMatchesFilter } from "./tag-tree";

// ---------------------------------------------------------------------------
// Tag extraction
// ---------------------------------------------------------------------------

function getDisplayTag(value: string): string {
  return value
    .trim()
    .replace(/^#/, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("/");
}

function shouldReplaceDisplayTag(currentDisplayTag: string, nextDisplayTag: string): boolean {
  return nextDisplayTag < currentDisplayTag;
}

/**
 * Return all tags for a file (both frontmatter and inline), normalized to
 * lowercase with leading `#` stripped. Returns `[]` if no cache or tags.
 *
 * Uses Obsidian's built-in `getAllTags()` which handles both `cache.tags`
 * (inline `#tag`) and `cache.frontmatter.tags` / `cache.frontmatter.tag`.
 */
export function getFileTags(app: App, file: TFile): string[] {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache) {
    return [];
  }

  const raw = getAllTags(cache);
  if (!raw || raw.length === 0) {
    return [];
  }

  // Normalize: lowercase, strip leading "#"
  return raw
    .map((tag) => normalizeTagPath(tag))
    .filter((tag) => tag.length > 0);
}

export interface FileTagEntry {
  readonly normalized: string;
  readonly display: string;
}

/**
 * Return every distinct tag on a file as a normalized/display pair.
 *
 * Deduplication is by normalized path, keeping the lexicographically smaller
 * display form — the same rule `collectAllTags` applies. Callers get both forms
 * so they can order on `normalized` while rendering `display`, keeping `#Work`
 * from surfacing as `#work`.
 */
export function getFileTagEntries(app: App, file: TFile): FileTagEntry[] {
  const cache = app.metadataCache.getFileCache(file);
  const rawTags = cache ? getAllTags(cache) : null;
  if (!rawTags || rawTags.length === 0) {
    return [];
  }

  const displayTagsByNormalizedTag = new Map<string, string>();
  for (const rawTag of rawTags) {
    const normalizedTag = normalizeTagPath(rawTag);
    if (normalizedTag.length === 0) {
      continue;
    }

    const displayTag = getDisplayTag(rawTag);
    const currentDisplayTag = displayTagsByNormalizedTag.get(normalizedTag);
    if (!currentDisplayTag || shouldReplaceDisplayTag(currentDisplayTag, displayTag)) {
      displayTagsByNormalizedTag.set(normalizedTag, displayTag);
    }
  }

  return Array.from(displayTagsByNormalizedTag.entries()).map(([normalized, display]) => ({
    normalized,
    display,
  }));
}

/**
 * Collect all unique tags across a set of files. Returns a sorted array of
 * display tags without a leading `#`, while deduplicating by normalized tag
 * path. Useful for building a tag filter UI.
 */
export function collectAllTags(app: App, files: TFile[]): string[] {
  const displayTagsByNormalizedTag = new Map<string, string>();

  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    const rawTags = cache ? getAllTags(cache) : null;
    if (!rawTags || rawTags.length === 0) {
      continue;
    }

    for (const rawTag of rawTags) {
      const normalizedTag = normalizeTagPath(rawTag);
      const displayTag = getDisplayTag(rawTag);
      if (normalizedTag.length === 0 || displayTag.length === 0) {
        continue;
      }

      const currentDisplayTag = displayTagsByNormalizedTag.get(normalizedTag);
      if (!currentDisplayTag || shouldReplaceDisplayTag(currentDisplayTag, displayTag)) {
        displayTagsByNormalizedTag.set(normalizedTag, displayTag);
      }
    }
  }

  return Array.from(displayTagsByNormalizedTag.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, displayTag]) => displayTag);
}

/**
 * Count how many files fall under each tag path, keyed by normalized tag.
 * A file with `work/ai` counts once for `work` and once for `work/ai`, so a
 * parent count matches what selecting that parent would filter to.
 */
export function collectTagCounts(app: App, files: TFile[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    const rawTags = cache ? getAllTags(cache) : null;
    if (!rawTags || rawTags.length === 0) {
      continue;
    }

    const pathsForFile = new Set<string>();
    for (const rawTag of rawTags) {
      const normalizedTag = normalizeTagPath(rawTag);
      if (normalizedTag.length === 0) {
        continue;
      }

      const segments = normalizedTag.split("/");
      for (let index = 0; index < segments.length; index += 1) {
        pathsForFile.add(segments.slice(0, index + 1).join("/"));
      }
    }

    for (const tagPath of pathsForFile) {
      counts[tagPath] = (counts[tagPath] ?? 0) + 1;
    }
  }

  return counts;
}

export interface VaultTagIndex {
  /** Every tag path in the vault, expanded to include ancestors. */
  tagPaths: Set<string>;
  /** Notes per tag path, rolled up to ancestors exactly like `collectTagCounts`. */
  counts: Record<string, number>;
}

/**
 * Tag index for the whole vault, independent of the browse scope.
 *
 * Ancestors are included so a favorited `work` stays alive — and keeps a
 * count — while only `work/ai` is in use, matching what selecting `work`
 * actually filters to.
 *
 * Only markdown is scanned: the metadata cache never reports tags for the
 * other supported card kinds, so widening the walk would cost lookups without
 * changing the answer.
 *
 * Returns `null` when the answer cannot be trusted — no usable metadata cache,
 * or a vault that reports no markdown files (indistinguishable from one that
 * has not finished loading). Callers must treat `null` as "no usable data"
 * rather than "the vault has no tags".
 */
export function collectVaultTagIndex(app: App): VaultTagIndex | null {
  const metadataCache = app.metadataCache as { getFileCache?: unknown } | undefined;
  if (typeof metadataCache?.getFileCache !== "function") {
    return null;
  }

  const getMarkdownFiles = app.vault?.getMarkdownFiles as (() => TFile[]) | undefined;
  if (typeof getMarkdownFiles !== "function") {
    return null;
  }

  const files = getMarkdownFiles.call(app.vault);
  if (files.length === 0) {
    return null;
  }

  const tagPaths = new Set<string>();
  const counts: Record<string, number> = {};
  for (const file of files) {
    const pathsForFile = new Set<string>();
    for (const tag of getFileTags(app, file)) {
      const segments = tag.split("/");
      for (let index = 0; index < segments.length; index += 1) {
        pathsForFile.add(segments.slice(0, index + 1).join("/"));
      }
    }

    for (const tagPath of pathsForFile) {
      tagPaths.add(tagPath);
      counts[tagPath] = (counts[tagPath] ?? 0) + 1;
    }
  }

  return { tagPaths, counts };
}

/**
 * Check whether already-cached metadata matches a tag filter. The cache is the
 * single read: a `null` cache means the file has no tags. A file matches if it
 * contains ALL of the specified filter tags (AND logic). Filter tags should be
 * normalized (lowercase, no `#`).
 *
 * Returns `true` if `filterTags` is empty (no filter applied).
 */
export function matchesTagFilterFromCache(
  cache: CachedMetadata | null,
  filterTags: string[],
): boolean {
  if (filterTags.length === 0) {
    return true;
  }

  const raw = cache ? getAllTags(cache) : null;
  const fileTags = raw
    ?.map((tag) => normalizeTagPath(tag))
    .filter((tag) => tag.length > 0) ?? [];

  const normalizedFilterTags = filterTags
    .map((tag) => normalizeTagPath(tag))
    .filter((tag) => tag.length > 0);

  if (normalizedFilterTags.length === 0) {
    return true;
  }

  return normalizedFilterTags.every((filterTag) => {
    return fileTags.some((fileTag) => tagPathMatchesFilter(fileTag, filterTag));
  });
}

/**
 * Check whether a file matches a tag filter. A file matches if it contains
 * ALL of the specified filter tags (AND logic). Filter tags should be
 * normalized (lowercase, no `#`).
 *
 * Returns `true` if `filterTags` is empty (no filter applied).
 */
export function matchesTagFilter(app: App, file: TFile, filterTags: string[]): boolean {
  if (filterTags.length === 0) {
    return true;
  }

  return matchesTagFilterFromCache(app.metadataCache.getFileCache(file), filterTags);
}

// ---------------------------------------------------------------------------
// Frontmatter access
// ---------------------------------------------------------------------------

/**
 * Return the raw frontmatter object for a file, or `null` if unavailable.
 * The caller should not mutate the returned object.
 */
export function getFileFrontmatter(
  app: App,
  file: TFile,
): Record<string, unknown> | null {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache?.frontmatter) {
    return null;
  }

  return cache.frontmatter as Record<string, unknown>;
}

/**
 * Return the cached metadata for a file, or `null` if not yet indexed.
 * Thin wrapper — mainly exists so callers don't import `CachedMetadata` directly.
 */
export function getFileCache(app: App, file: TFile): CachedMetadata | null {
  return app.metadataCache.getFileCache(file);
}

// ---------------------------------------------------------------------------
// Search helpers (Task 23 foundation)
// ---------------------------------------------------------------------------

/**
 * Check whether a file's title or cached content matches a search query.
 * Matching is case-insensitive substring search.
 *
 * If `cachedContent` is provided it is searched directly (avoids async read).
 * Otherwise only the title is matched — callers should hydrate content
 * before calling for full-text search.
 */
export function matchesSearchQuery(
  file: TFile,
  query: string,
  cachedContent: string | null = null,
): boolean {
  if (!query || query.trim().length === 0) {
    return true;
  }

  const normalizedQuery = query.toLowerCase().trim();
  const titleMatch = file.basename.toLowerCase().includes(normalizedQuery);
  if (titleMatch) {
    return true;
  }

  if (cachedContent !== null) {
    return cachedContent.toLowerCase().includes(normalizedQuery);
  }

  return false;
}
