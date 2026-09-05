import { normalizeTagPath } from "./tag-tree";
import type { FavoriteEntry, FavoriteKind } from "./types";

/** Display grouping order for the Favorites section. */
export const FAVORITE_KIND_ORDER: readonly FavoriteKind[] = ["folder", "file", "tag", "box"];

export function isFavoriteKind(value: unknown): value is FavoriteKind {
  return (
    value === "folder" || value === "file" || value === "tag" || value === "box"
  );
}

/** Returns `null` when the ref cannot be used for this kind. `""` is a valid folder ref (vault root). */
export function normalizeFavoriteRef(kind: FavoriteKind, ref: string): string | null {
  if (kind === "folder") {
    const trimmed = ref.trim();
    if (trimmed === "" || trimmed === "/") {
      return "";
    }
    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
  }

  if (kind === "tag") {
    const normalized = normalizeTagPath(ref);
    return normalized === "" ? null : normalized;
  }

  const trimmed = ref.trim();
  return trimmed === "" ? null : trimmed;
}

function indexOfFavorite(
  favorites: FavoriteEntry[],
  kind: FavoriteKind,
  ref: string,
): number {
  return favorites.findIndex((entry) => entry.kind === kind && entry.ref === ref);
}

export function isFavorite(
  favorites: FavoriteEntry[],
  kind: FavoriteKind,
  ref: string,
): boolean {
  const normalized = normalizeFavoriteRef(kind, ref);
  if (normalized === null) {
    return false;
  }
  return indexOfFavorite(favorites, kind, normalized) !== -1;
}

/**
 * Add a favorite by appending it to the end of the array.
 *
 * The array order is the user's manual order: the projection layer groups rows
 * by kind while keeping array order within each group, so an appended entry
 * shows up last inside its kind group. No kind re-sort here — that would
 * scramble a manually drag-ordered list.
 */
export function addFavorite(
  favorites: FavoriteEntry[],
  kind: FavoriteKind,
  ref: string,
): FavoriteEntry[] {
  const normalized = normalizeFavoriteRef(kind, ref);
  if (normalized === null || indexOfFavorite(favorites, kind, normalized) !== -1) {
    return favorites;
  }
  return [...favorites, { kind, ref: normalized }];
}

export function removeFavorite(
  favorites: FavoriteEntry[],
  kind: FavoriteKind,
  ref: string,
): FavoriteEntry[] {
  const normalized = normalizeFavoriteRef(kind, ref);
  if (normalized === null) {
    return favorites;
  }
  const index = indexOfFavorite(favorites, kind, normalized);
  if (index === -1) {
    return favorites;
  }
  return favorites.filter((_, position) => position !== index);
}

export function toggleFavorite(
  favorites: FavoriteEntry[],
  kind: FavoriteKind,
  ref: string,
): FavoriteEntry[] {
  return isFavorite(favorites, kind, ref)
    ? removeFavorite(favorites, kind, ref)
    : addFavorite(favorites, kind, ref);
}

export function moveFavorite(
  favorites: FavoriteEntry[],
  kind: FavoriteKind,
  ref: string,
  delta: -1 | 1,
): FavoriteEntry[] {
  const normalized = normalizeFavoriteRef(kind, ref);
  if (normalized === null) {
    return favorites;
  }

  const indices: number[] = [];
  favorites.forEach((entry, index) => {
    if (entry.kind === kind) {
      indices.push(index);
    }
  });

  const position = indices.findIndex((index) => favorites[index].ref === normalized);
  if (position === -1) {
    return favorites;
  }

  const nextPosition = position + delta;
  if (nextPosition < 0 || nextPosition >= indices.length) {
    return favorites;
  }

  const result = [...favorites];
  const from = indices[position];
  const to = indices[nextPosition];
  const swapped = result[from];
  result[from] = result[to];
  result[to] = swapped;
  return result;
}

export type FavoriteReorderPosition = "before" | "after";

function favoriteEntriesEqual(left: FavoriteEntry[], right: FavoriteEntry[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => entry.kind === right[index].kind && entry.ref === right[index].ref);
}

/**
 * Move `source` to sit immediately `before`/`after` `target` within their shared
 * kind group, leaving every other entry (and other kinds' positions) untouched.
 *
 * Display groups favorites by kind with array order inside each group, so the
 * visible reorder is exactly a reorder of the same-kind subsequence: the new
 * order is written back into the flat slots that kind already occupies. Drops
 * across kinds or onto unknown refs return the input unchanged.
 */
export function reorderFavorite(
  favorites: FavoriteEntry[],
  source: Pick<FavoriteEntry, "kind" | "ref">,
  target: Pick<FavoriteEntry, "kind" | "ref">,
  position: FavoriteReorderPosition,
): FavoriteEntry[] {
  if (source.kind !== target.kind) {
    return favorites;
  }

  const slots: number[] = [];
  favorites.forEach((entry, index) => {
    if (entry.kind === source.kind) {
      slots.push(index);
    }
  });

  const sourcePosition = slots.findIndex((index) => favorites[index].ref === source.ref);
  const targetPosition = slots.findIndex((index) => favorites[index].ref === target.ref);
  if (sourcePosition === -1 || targetPosition === -1) {
    return favorites;
  }

  const groupEntries = slots.map((index) => favorites[index]);
  groupEntries.splice(sourcePosition, 1);
  const insertAt = position === "before" ? targetPosition : targetPosition + 1;
  groupEntries.splice(sourcePosition < insertAt ? insertAt - 1 : insertAt, 0, {
    kind: source.kind,
    ref: source.ref,
  });

  const result = [...favorites];
  slots.forEach((flatIndex, groupIndex) => {
    result[flatIndex] = groupEntries[groupIndex];
  });
  return favoriteEntriesEqual(result, favorites) ? favorites : result;
}

export function pruneFavoriteBoxes(
  favorites: FavoriteEntry[],
  boxIds: string[],
): FavoriteEntry[] {
  const known = new Set(boxIds);
  const filtered = favorites.filter((entry) => entry.kind !== "box" || known.has(entry.ref));
  return filtered.length === favorites.length ? favorites : filtered;
}

/**
 * Drop favorited tags that no longer exist anywhere in the vault, matching how
 * folder/file/box favorites disappear once their target is gone.
 *
 * `existingTagPaths` must already contain ancestor paths; callers get that from
 * `collectVaultTagPaths`. Returns the same array reference when nothing changes.
 */
export function pruneFavoriteTags(
  favorites: FavoriteEntry[],
  existingTagPaths: Set<string>,
): FavoriteEntry[] {
  const filtered = favorites.filter(
    (entry) => entry.kind !== "tag" || existingTagPaths.has(normalizeTagPath(entry.ref)),
  );
  return filtered.length === favorites.length ? favorites : filtered;
}

export interface FavoriteVaultMutation {
  eventType: "create" | "modify" | "delete" | "rename";
  path: string;
  oldPath: string | null;
  isFolder: boolean;
}

function rewritePath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) {
    return newPath;
  }
  const prefix = `${oldPath}/`;
  if (path.startsWith(prefix)) {
    return `${newPath}/${path.slice(prefix.length)}`;
  }
  return path;
}

function isUnderPath(path: string, scopePath: string): boolean {
  return path === scopePath || path.startsWith(`${scopePath}/`);
}

/**
 * Keep path-based favorites consistent with a vault mutation.
 *
 * Tag entries are untouched here because tag existence is a metadata question,
 * not a path one; `pruneFavoriteTags` handles them.
 *
 * Returns the same array reference when nothing changes.
 */
export function reconcileFavoritesForVaultMutation(
  favorites: FavoriteEntry[],
  event: FavoriteVaultMutation,
): FavoriteEntry[] {
  if (event.eventType === "rename" && event.oldPath) {
    const oldPath = event.oldPath;
    let changed = false;
    const mapped = favorites.map((entry) => {
      if (event.isFolder) {
        if (entry.kind !== "folder" && entry.kind !== "file") {
          return entry;
        }
      } else if (entry.kind !== "file") {
        return entry;
      }

      const nextRef = event.isFolder
        ? rewritePath(entry.ref, oldPath, event.path)
        : entry.ref === oldPath
          ? event.path
          : entry.ref;
      if (nextRef === entry.ref) {
        return entry;
      }
      changed = true;
      return { kind: entry.kind, ref: nextRef };
    });
    return changed ? mapped : favorites;
  }

  if (event.eventType === "delete") {
    const filtered = favorites.filter((entry) => {
      if (event.isFolder) {
        if (entry.kind !== "folder" && entry.kind !== "file") {
          return true;
        }
        return !isUnderPath(entry.ref, event.path);
      }
      if (entry.kind !== "file") {
        return true;
      }
      return entry.ref !== event.path;
    });
    return filtered.length === favorites.length ? favorites : filtered;
  }

  return favorites;
}
