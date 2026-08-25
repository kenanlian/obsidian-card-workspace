export const FALLBACK_MIN_CARD_WIDTH = 280;
export const FALLBACK_GRID_GAP = 12;

export interface RowProjectionCard {
  path: string;
}

export interface ProjectedRow<T extends RowProjectionCard = RowProjectionCard> {
  index: number;
  startIndex: number;
  endIndex: number;
  cards: T[];
  key: string;
}

export interface VirtualRowWindow {
  start: number;
  end: number;
}

export function computeVirtualRowWindow(
  rowCount: number,
  baseStart: number,
  baseEnd: number,
  overscan: number,
): VirtualRowWindow {
  const count = Number.isFinite(rowCount) ? Math.max(0, Math.trunc(rowCount)) : 0;
  if (count === 0) {
    return { start: 0, end: 0 };
  }

  const safeStart = Number.isFinite(baseStart)
    ? Math.min(count - 1, Math.max(0, Math.trunc(baseStart)))
    : 0;
  const safeEnd = Number.isFinite(baseEnd)
    ? Math.min(count - 1, Math.max(safeStart, Math.trunc(baseEnd)))
    : safeStart;
  const extra = Number.isFinite(overscan) ? Math.max(0, Math.trunc(overscan)) : 0;

  return {
    start: Math.max(0, safeStart - extra),
    end: Math.min(count, safeEnd + 1 + extra),
  };
}

export interface ColumnCountInput {
  availableWidth: number;
  minCardWidth: number;
  columnGap: number;
}

export function computeColumnCount(input: ColumnCountInput): number {
  const availableWidth = Number.isFinite(input.availableWidth)
    ? Math.max(0, input.availableWidth)
    : 0;
  const minCardWidth = Number.isFinite(input.minCardWidth)
    ? Math.max(1, input.minCardWidth)
    : FALLBACK_MIN_CARD_WIDTH;
  const columnGap = Number.isFinite(input.columnGap)
    ? Math.max(0, input.columnGap)
    : FALLBACK_GRID_GAP;

  if (availableWidth <= minCardWidth) {
    return 1;
  }

  return Math.max(1, Math.floor((availableWidth + columnGap) / (minCardWidth + columnGap)));
}

export function projectCardsToRows<T extends RowProjectionCard>(
  cards: readonly T[],
  columnCount: number,
): ProjectedRow<T>[] {
  const safeColumnCount = Math.max(1, Math.trunc(columnCount) || 1);
  const rows: ProjectedRow<T>[] = [];

  for (let startIndex = 0; startIndex < cards.length; startIndex += safeColumnCount) {
    const rowCards = cards.slice(startIndex, startIndex + safeColumnCount);
    rows.push({
      index: rows.length,
      startIndex,
      endIndex: startIndex + rowCards.length,
      cards: rowCards,
      key: `${safeColumnCount}:${rowCards.map((card) => card.path).join("\u001f")}`,
    });
  }

  return rows;
}

export function findIndexAtOffset(offset: number, positions: readonly number[]): number {
  if (positions.length === 0) {
    return 0;
  }

  const safeOffset = Number.isFinite(offset) ? offset : 0;
  let low = 0;
  let high = positions.length - 1;
  let match = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const position = positions[mid] ?? 0;

    if (position <= safeOffset) {
      match = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return match;
}

export function getHydrateRangeForRows<T extends RowProjectionCard>(
  rows: readonly ProjectedRow<T>[],
  startRowIndex: number,
  endRowIndex: number,
): { start: number; end: number } {
  if (rows.length === 0) {
    return { start: 0, end: 0 };
  }

  const safeStart = Math.max(0, Math.min(rows.length, startRowIndex));
  const safeEnd = Math.max(safeStart, Math.min(rows.length, endRowIndex));
  const firstRow = rows[safeStart];
  const lastRow = rows[safeEnd - 1];

  if (!firstRow || !lastRow) {
    const fallbackIndex = rows[safeStart]?.startIndex ?? 0;
    return { start: fallbackIndex, end: fallbackIndex };
  }

  return {
    start: firstRow.startIndex,
    end: lastRow.endIndex,
  };
}
