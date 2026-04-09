import { describe, expect, it } from "vitest";

import {
  computeColumnCount,
  findIndexAtOffset,
  getHydrateRangeForRows,
  projectCardsToRows,
} from "./row-projection";

function createCards(count: number): Array<{ path: string }> {
  return Array.from({ length: count }, (_value, index) => ({
    path: `notes/${index}.md`,
  }));
}

describe("row-projection", () => {
  it("falls back to a single column for narrow widths", () => {
    expect(
      computeColumnCount({
        availableWidth: 240,
        minCardWidth: 280,
        columnGap: 12,
      }),
    ).toBe(1);
  });

  it("computes multiple columns from width and gap", () => {
    expect(
      computeColumnCount({
        availableWidth: 900,
        minCardWidth: 280,
        columnGap: 12,
      }),
    ).toBe(3);
  });

  it("projects cards into stable sequential rows", () => {
    const rows = projectCardsToRows(createCards(7), 3);

    expect(rows.map((row) => [row.startIndex, row.endIndex])).toEqual([
      [0, 3],
      [3, 6],
      [6, 7],
    ]);
    expect(rows[1]?.cards.map((card) => card.path)).toEqual([
      "notes/3.md",
      "notes/4.md",
      "notes/5.md",
    ]);
  });

  it("maps visible rows back to a flat hydrate range", () => {
    const rows = projectCardsToRows(createCards(7), 3);

    expect(getHydrateRangeForRows(rows, 1, 3)).toEqual({
      start: 3,
      end: 7,
    });
  });

  it("finds the row index from projected offsets", () => {
    expect(findIndexAtOffset(0, [0, 120, 260])).toBe(0);
    expect(findIndexAtOffset(119, [0, 120, 260])).toBe(0);
    expect(findIndexAtOffset(120, [0, 120, 260])).toBe(1);
    expect(findIndexAtOffset(600, [0, 120, 260])).toBe(2);
  });
});
