import { isPathAtOrBelow, rewritePathReference } from "../path-references";
import { normalizeTagPath } from "./tag-tree";
import type { FavoriteEntry, FavoriteKind } from "./types";

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
 * The array order is the user's manual order and the projection layer renders
 * it verbatim, so an appended entry shows up last. No kind re-sort here — that
 * would scramble a manually drag-ordered list.
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

/** Swap with the neighbouring entry, whatever kind that neighbour happens to be. */
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

  const index = indexOfFavorite(favorites, kind, normalized);
  if (index === -1) {
    return favorites;
  }

  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= favorites.length) {
    return favorites;
  }

  const result = [...favorites];
  result[index] = favorites[nextIndex];
  result[nextIndex] = favorites[index];
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
 * Move `source` to sit immediately `before`/`after` `target` in the favorites
 * array, which is also the display order — kinds may interleave freely.
 *
 * Drops onto an unknown ref, and drops that land the entry back where it
 * started, return the input unchanged.
 */
export function reorderFavorite(
  favorites: FavoriteEntry[],
  source: Pick<FavoriteEntry, "kind" | "ref">,
  target: Pick<FavoriteEntry, "kind" | "ref">,
  position: FavoriteReorderPosition,
): FavoriteEntry[] {
  const sourceIndex = indexOfFavorite(favorites, source.kind, source.ref);
  const targetIndex = indexOfFavorite(favorites, target.kind, target.ref);
  if (sourceIndex === -1 || targetIndex === -1) {
    return favorites;
  }

  const result = [...favorites];
  const [moved] = result.splice(sourceIndex, 1);
  const insertAt = position === "before" ? targetIndex : targetIndex + 1;
  result.splice(sourceIndex < insertAt ? insertAt - 1 : insertAt, 0, moved);
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
        ? rewritePathReference(entry.ref, oldPath, event.path)
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
        return !isPathAtOrBelow(entry.ref, event.path);
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
