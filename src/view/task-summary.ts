/**
 * Derive a checkbox-task count summary from Obsidian's metadata cache.
 *
 * A list item is a task iff `typeof item.task === "string"`. Incomplete means
 * `item.task === " "` (a single space). Any other string, including `"x"`,
 * `"X"`, `"-"`, and `"/"`, is complete.
 *
 * Returns `null` when there is no cache, no list items, or no tasks — never
 * `{ total: 0 }`. The metadata cache already scopes `listItems` to real list
 * structure; this module does not filter code fences, frontmatter, or nesting.
 */

import type { App, CachedMetadata, TFile } from "obsidian";
import { isMarkdownCardKind, type CardFileKind } from "./file-kind";

export interface CardTaskSummary {
  readonly total: number;
  readonly incomplete: number;
}

const INCOMPLETE_TASK_MARKER = " ";

/**
 * Count tasks in a metadata cache snapshot.
 *
 * Returns `null` when `cache` is `null`, `listItems` is absent, or no entry
 * is a task. Otherwise returns `{ total, incomplete }` with `total >= 1`.
 */
export function summarizeTaskListItems(cache: CachedMetadata | null): CardTaskSummary | null {
  if (cache === null) {
    return null;
  }

  const listItems = cache.listItems;
  if (listItems === undefined || listItems.length === 0) {
    return null;
  }

  let total = 0;
  let incomplete = 0;
  for (const item of listItems) {
    if (typeof item.task !== "string") {
      continue;
    }

    total += 1;
    if (item.task === INCOMPLETE_TASK_MARKER) {
      incomplete += 1;
    }
  }

  if (total === 0) {
    return null;
  }

  return { total, incomplete };
}

/**
 * Resolve a card's task summary from the live metadata cache.
 *
 * Non-markdown kinds return `null` without consulting the cache, so a future
 * construction site cannot forget the markdown-only guard. A `null` cache is
 * "no information yet", not "no tasks".
 */
export function deriveCardTaskSummary(
  app: App,
  file: TFile,
  fileKind: CardFileKind,
): CardTaskSummary | null {
  if (!isMarkdownCardKind(fileKind)) {
    return null;
  }

  return summarizeTaskListItems(app.metadataCache.getFileCache(file));
}
