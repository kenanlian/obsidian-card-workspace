const DEFAULT_MAX_ANCHOR_DELTA = 80;

export interface ScrollAnchorInput {
  heightDelta: number;
  changedRowIndex: number;
  firstVisibleRowIndex: number;
  nowMs: number;
  userScrollLockUntilMs: number;
  maxAnchorDelta?: number;
}

/**
 * Structural stand-in for `PanelRow`. Declared locally so this module keeps
 * zero imports, which is what exempts it from the Svelte layering rule.
 */
export interface AnchorCandidateRow {
  readonly kind: "group-header" | "cards";
  readonly key: string;
  readonly cards?: readonly { readonly path: string }[];
  readonly startIndex?: number;
  readonly endIndex?: number;
}

/**
 * `card-index` names a position in the card array rather than a card, which is
 * how anchoring behaved before groups existed: a reorder holds the viewport
 * still instead of chasing the card that used to be there. It stays valid only
 * while rows are uniform, so callers select it exactly when there are no
 * segments; grouped layouts must use `card` or `group`, whose row lookup
 * survives the partial tail row a segment boundary produces.
 */
export type RowAnchorRef =
  | { kind: "card"; path: string }
  | { kind: "card-index"; index: number }
  | { kind: "group"; key: string };

/** `offset` is `scrollTop - rowTop` and may be negative. */
export interface RowAnchor {
  ref: RowAnchorRef;
  offset: number;
}

export function computeScrollAnchorDelta(input: ScrollAnchorInput): number {
  const {
    heightDelta,
    changedRowIndex,
    firstVisibleRowIndex,
    nowMs,
    userScrollLockUntilMs,
    maxAnchorDelta = DEFAULT_MAX_ANCHOR_DELTA,
  } = input;

  if (!Number.isFinite(heightDelta) || heightDelta === 0) {
    return 0;
  }

  if (changedRowIndex >= firstVisibleRowIndex) {
    return 0;
  }

  if (nowMs <= userScrollLockUntilMs) {
    return 0;
  }

  const magnitude = Math.abs(heightDelta);
  if (magnitude <= maxAnchorDelta) {
    return heightDelta;
  }

  return Math.sign(heightDelta) * maxAnchorDelta;
}

/**
 * Anchors on the top visible row, so its offset is structurally non-negative.
 *
 * `preferCardIndex` selects the pre-group positional ref for ungrouped layouts;
 * see `RowAnchorRef`.
 */
export function captureLayoutAnchor(input: {
  scrollTop: number;
  rowPositions: readonly number[];
  rows: readonly AnchorCandidateRow[];
  preferCardIndex?: boolean;
}): RowAnchor | null {
  const { scrollTop, rowPositions, rows, preferCardIndex = false } = input;

  if (rowPositions.length === 0 || rows.length === 0) {
    return null;
  }

  const rowIndex = findRowIndexAtOffset(scrollTop, rowPositions);
  const row = rows[rowIndex];
  if (!row) {
    return null;
  }

  return {
    ref: buildRowAnchorRef(row, preferCardIndex),
    offset: Math.max(0, scrollTop - (rowPositions[rowIndex] ?? 0)),
  };
}

/**
 * Anchors on a caller-chosen row. A row below the viewport top yields a
 * negative offset, which is the whole point: an interaction anchor names the
 * row the user acted on, not the row that happens to be scrolled to.
 */
export function captureRowAnchor(input: {
  scrollTop: number;
  rowPositions: readonly number[];
  rows: readonly AnchorCandidateRow[];
  rowIndex: number;
}): RowAnchor | null {
  const { scrollTop, rowPositions, rows, rowIndex } = input;

  const row = rows[rowIndex];
  if (!row || rowPositions.length === 0) {
    return null;
  }

  return {
    // Always identity-based: this anchor exists for the group-header toggle,
    // which only happens when segments are present.
    ref: buildRowAnchorRef(row, false),
    offset: scrollTop - (rowPositions[rowIndex] ?? 0),
  };
}

export function resolveAnchoredScrollTop(input: {
  anchor: RowAnchor;
  rows: readonly AnchorCandidateRow[];
  rowPositions: readonly number[];
}): number | null {
  const { anchor, rows, rowPositions } = input;
  const rowIndex = findAnchorRowIndex(rows, anchor.ref);
  if (rowIndex === -1) {
    return null;
  }

  const rowTop = rowPositions[rowIndex];
  if (rowTop === undefined) {
    return null;
  }

  return rowTop + anchor.offset;
}

function buildRowAnchorRef(row: AnchorCandidateRow, preferCardIndex: boolean): RowAnchorRef {
  const firstCard = row.cards?.[0];
  if (!firstCard) {
    return { kind: "group", key: row.key };
  }
  return preferCardIndex && row.startIndex !== undefined
    ? { kind: "card-index", index: row.startIndex }
    : { kind: "card", path: firstCard.path };
}

/**
 * Locates the card row whose span covers `index`, falling back to the last card
 * row when the array shrank. For the uniform rows an ungrouped layout produces
 * this is the same row `Math.floor(index / columnCount)` selected before groups
 * existed, without needing the column count.
 */
function findCardIndexRow(rows: readonly AnchorCandidateRow[], index: number): number {
  let lastCardRow = -1;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (row.startIndex === undefined || row.endIndex === undefined) {
      continue;
    }
    lastCardRow = rowIndex;
    if (index >= row.startIndex && index < row.endIndex) {
      return rowIndex;
    }
  }

  return lastCardRow;
}

function findAnchorRowIndex(rows: readonly AnchorCandidateRow[], ref: RowAnchorRef): number {
  if (ref.kind === "card-index") {
    return findCardIndexRow(rows, ref.index);
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const matches = ref.kind === "group"
      ? row.key === ref.key
      : (row.cards?.some((card) => card.path === ref.path) ?? false);
    if (matches) {
      return index;
    }
  }

  return -1;
}

export function clampLayoutScrollTop(
  scrollTop: number,
  totalHeight: number,
  viewportHeight: number,
): number {
  const safeScrollTop = Number.isFinite(scrollTop) ? scrollTop : 0;
  const safeTotalHeight = Number.isFinite(totalHeight) ? Math.max(0, totalHeight) : 0;
  const safeViewportHeight = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  return Math.min(Math.max(0, safeScrollTop), Math.max(0, safeTotalHeight - safeViewportHeight));
}

function findRowIndexAtOffset(offset: number, rowPositions: readonly number[]): number {
  const safeOffset = Number.isFinite(offset) ? offset : 0;
  let low = 0;
  let high = rowPositions.length - 1;
  let match = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const position = rowPositions[mid] ?? 0;

    if (position <= safeOffset) {
      match = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return match;
}
