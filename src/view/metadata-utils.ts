import { App, TFile, getAllTags } from "obsidian";
import type { CachedMetadata } from "obsidian";

// ---------------------------------------------------------------------------
// Tag extraction
// ---------------------------------------------------------------------------

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
  return raw.map((tag) => tag.replace(/^#/, "").toLowerCase());
}

/**
 * Collect all unique tags across a set of files. Returns a sorted array
 * of normalized tags (lowercase, no `#`). Useful for building a tag filter UI.
 */
export function collectAllTags(app: App, files: TFile[]): string[] {
  const tagSet = new Set<string>();

  for (const file of files) {
    const tags = getFileTags(app, file);
    for (const tag of tags) {
      tagSet.add(tag);
    }
  }

  const result = Array.from(tagSet);
  result.sort((a, b) => a.localeCompare(b));
  return result;
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

  const fileTags = getFileTags(app, file);
  return filterTags.every((ft) => fileTags.includes(ft));
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
