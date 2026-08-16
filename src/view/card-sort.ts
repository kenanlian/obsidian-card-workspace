import type { SortDirection, SortField } from "../settings";
import type { NoteCardRecord } from "./types";

/** Stable card ordering; ties use path so reloads retain deterministic order. */
export function compareCards(
  left: NoteCardRecord,
  right: NoteCardRecord,
  field: SortField,
  direction: SortDirection,
): number {
  let difference: number;
  if (field === "name") {
    difference = left.title.localeCompare(right.title);
  } else {
    const leftValue = field === "ctime" ? left.ctime : left.mtime;
    const rightValue = field === "ctime" ? right.ctime : right.mtime;
    difference = leftValue - rightValue;
  }

  if (difference !== 0) {
    return direction === "asc" ? difference : -difference;
  }
  return left.path.localeCompare(right.path);
}

/** Binary insertion point for an already-sorted card array. */
export function findSortedInsertIndex(
  cards: readonly NoteCardRecord[],
  card: NoteCardRecord,
  field: SortField,
  direction: SortDirection,
): number {
  let low = 0;
  let high = cards.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const existing = cards[mid];
    if (!existing) {
      break;
    }
    if (compareCards(existing, card, field, direction) <= 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}
