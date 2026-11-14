import type { TaskNode } from "./task-tree";

/** Root tasks of one Markdown file. `roots` is empty for a file without tasks. */
export interface TaskFileEntry {
  readonly path: string;
  readonly mtime: number;
  readonly roots: readonly TaskNode[];
}

/** Paths whose entry was added, replaced, or removed. A rename reports both paths. */
export interface TaskIndexChange {
  readonly paths: ReadonlySet<string>;
}

/**
 * Read side of the plugin-level task index.
 *
 * `ensure` resolves once every listed Markdown path that still exists has a
 * current entry; non-Markdown and missing paths are ignored. Only ensured paths
 * are tracked and kept current. `get` returns `null` for a path that has not
 * been ensured (or was deleted), never a stale entry.
 */
export interface TaskIndexReader {
  ensure(paths: readonly string[], signal?: AbortSignal): Promise<void>;
  get(path: string): TaskFileEntry | null;
  subscribe(listener: (change: TaskIndexChange) => void): () => void;
}
