/**
 * Shared path-reference semantics for persisted vault paths (C3).
 *
 * One neutral contract — with structural inputs only — for the exact and
 * folder-boundary rules already expected by Box paths, favorites, restored
 * folder paths, and global pins:
 *
 * - a file reference matches only an exact path (`foo` never matches `foobar`);
 * - a folder reference matches itself or descendants at a `/` boundary;
 * - rename rewriting and delete pruning preserve the original order;
 * - a string path list whose entries all stayed the same keeps its array
 *   reference and is never opportunistically normalized or deduplicated;
 * - a rename that maps two string-list entries to the same path keeps the
 *   first resulting occurrence.
 */

/** How a path reference matches a mutated vault path. */
export type PathReferenceMatch = "exact" | "at-or-below";

/** Whether `path` is `rootPath` itself or a descendant at a `/` boundary. */
export function isPathAtOrBelow(path: string, rootPath: string): boolean {
  return path === rootPath || path.startsWith(`${rootPath}/`);
}

/**
 * Rewrites a path that points at or inside a renamed folder. The vault root
 * (`""`) is never rewritten: it cannot be renamed.
 */
export function rewritePathReference(
  currentPath: string,
  oldPath: string,
  newPath: string,
): string {
  if (currentPath === "") {
    return currentPath;
  }

  if (currentPath === oldPath) {
    return newPath;
  }

  const prefix = `${oldPath}/`;
  if (!currentPath.startsWith(prefix)) {
    return currentPath;
  }

  return `${newPath}${currentPath.slice(oldPath.length)}`;
}

function firstOccurrenceDedupe(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    result.push(path);
  }
  return result;
}

/**
 * Rewrites a stable string path list after a rename.
 *
 * `match: "exact"` rewrites only entries equal to `oldPath` (file rename);
 * `"at-or-below"` also rewrites descendants at a `/` boundary (folder rename).
 *
 * Returns the original array reference when no entry changed. Otherwise the
 * result preserves the mapped order and keeps the first occurrence of any
 * duplicate the rename produced; an unchanged list is never deduplicated.
 */
export function rewritePathListAfterRename(
  paths: string[],
  oldPath: string,
  newPath: string,
  match: PathReferenceMatch,
): string[] {
  const mapped = paths.map((path) =>
    match === "exact"
      ? path === oldPath
        ? newPath
        : path
      : rewritePathReference(path, oldPath, newPath),
  );

  const changed = mapped.some((path, index) => path !== paths[index]);
  return changed ? firstOccurrenceDedupe(mapped) : paths;
}

/**
 * Prunes a stable string path list after a delete.
 *
 * `match: "exact"` removes only entries equal to `deletedPath` (file delete);
 * `"at-or-below"` also removes descendants at a `/` boundary (folder delete).
 *
 * Returns the original array reference when nothing was removed.
 */
export function prunePathList(
  paths: string[],
  deletedPath: string,
  match: PathReferenceMatch,
): string[] {
  const kept = paths.filter((candidate) =>
    match === "exact" ? candidate !== deletedPath : !isPathAtOrBelow(candidate, deletedPath),
  );
  return kept.length === paths.length ? paths : kept;
}
