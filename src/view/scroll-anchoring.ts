const DEFAULT_MAX_ANCHOR_DELTA = 80;

export interface ScrollAnchorInput {
  heightDelta: number;
  changedRowIndex: number;
  firstVisibleRowIndex: number;
  nowMs: number;
  userScrollLockUntilMs: number;
  maxAnchorDelta?: number;
}

export interface ScrollAnchorRow {
  startIndex: number;
}

export interface LayoutScrollAnchorInput {
  scrollTop: number;
  rowPositions: readonly number[];
  rows: readonly ScrollAnchorRow[];
}

export interface LayoutScrollAnchor {
  anchorCardIndex: number;
  anchorOffset: number;
}

export interface AnchoredScrollTopInput {
  anchorCardIndex: number;
  anchorOffset: number;
  columnCount: number;
  rowPositions: readonly number[];
  cardCount: number;
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

export function captureScrollAnchor(input: LayoutScrollAnchorInput): LayoutScrollAnchor | null {
  const { scrollTop, rowPositions, rows } = input;

  if (rowPositions.length === 0 || rows.length === 0) {
    return null;
  }

  const rowIndex = findRowIndexAtOffset(scrollTop, rowPositions);
  const row = rows[rowIndex];
  if (!row) {
    return null;
  }

  const rowTop = rowPositions[rowIndex] ?? 0;
  return {
    anchorCardIndex: row.startIndex,
    anchorOffset: Math.max(0, scrollTop - rowTop),
  };
}

export function computeAnchoredScrollTop(input: AnchoredScrollTopInput): number {
  const { anchorCardIndex, anchorOffset, columnCount, rowPositions, cardCount } = input;
  if (rowPositions.length === 0 || cardCount <= 0) {
    return 0;
  }

  const safeColumnCount = Math.max(1, Math.trunc(columnCount) || 1);
  const safeCardIndex = Math.max(0, Math.min(cardCount - 1, Math.trunc(anchorCardIndex) || 0));
  const rowIndex = Math.min(rowPositions.length - 1, Math.floor(safeCardIndex / safeColumnCount));
  const rowTop = rowPositions[rowIndex] ?? 0;

  return Math.max(0, rowTop + Math.max(0, anchorOffset));
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
