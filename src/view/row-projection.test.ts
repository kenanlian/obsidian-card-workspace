import { describe, expect, it } from "vitest";

import {
  computeColumnCount,
  computeVirtualRowWindow,
  findIndexAtOffset,
  getHydrateRangeForPanelRows,
  getHydrateRangeForRows,
  projectCardsToRows,
  projectPanelRows,
  type RowSegment,
} from "./row-projection";

function createCards(count: number): Array<{ path: string }> {
  return Array.from({ length: count }, (_value, index) => ({
    path: `notes/${index}.md`,
  }));
}

function createSegment(
  key: string,
  startIndex: number,
  visibleCount: number,
  collapsed = false,
): RowSegment {
  return { key, startIndex, visibleCount, collapsed };
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

  it.each([
    [0, 99, 101, 5, { start: 0, end: 0 }],
    [3, 99, 101, 0, { start: 2, end: 3 }],
    [12, 2, 4, 2, { start: 0, end: 7 }],
    [4, -8, -2, 1, { start: 0, end: 2 }],
    [4, Number.NaN, Number.NaN, Number.NaN, { start: 0, end: 1 }],
  ])("computes a valid virtual window for stale or invalid inputs", (count, start, end, overscan, expected) => {
    const window = computeVirtualRowWindow(count, start, end, overscan);
    expect(window).toEqual(expected);
    if (count > 0) {
      expect(window.start).toBeGreaterThanOrEqual(0);
      expect(window.start).toBeLessThan(window.end);
      expect(window.end).toBeLessThanOrEqual(count);
    }
  });
});

describe("projectPanelRows", () => {
  it("reproduces the ungrouped projection when there are no segments", () => {
    const cards = createCards(7);
    const rows = projectPanelRows(cards, [], 3);

    expect(rows).toEqual(
      projectCardsToRows(cards, 3).map((row) => ({
        kind: "cards",
        index: row.index,
        startIndex: row.startIndex,
        endIndex: row.endIndex,
        cards: row.cards,
        key: row.key,
        segmentIndex: -1,
      })),
    );
    expect(rows.every((row) => row.segmentIndex === -1)).toBe(true);
  });

  it("numbers mixed rows globally across segments and their partial tail rows", () => {
    const rows = projectPanelRows(
      createCards(8),
      [createSegment("a", 0, 5), createSegment("b", 5, 3)],
      3,
    );

    expect(rows.map((row) => row.kind)).toEqual([
      "group-header",
      "cards",
      "cards",
      "group-header",
      "cards",
    ]);
    expect(rows[0]).toEqual({ kind: "group-header", index: 0, key: "h:a", segmentIndex: 0 });
    expect(rows[1]).toMatchObject({ index: 1, startIndex: 0, endIndex: 3, segmentIndex: 0 });
    expect(rows[2]).toMatchObject({ index: 2, startIndex: 3, endIndex: 5, segmentIndex: 0 });
    expect(rows[3]).toEqual({ kind: "group-header", index: 3, key: "h:b", segmentIndex: 1 });
    expect(rows[4]).toMatchObject({ index: 4, startIndex: 5, endIndex: 8, segmentIndex: 1 });
  });

  it("slices each segment's own cards under its own header", () => {
    const rows = projectPanelRows(
      createCards(8),
      [createSegment("a", 0, 5), createSegment("b", 5, 3)],
      3,
    );

    expect(rows[4].kind === "cards" && rows[4].cards.map((card) => card.path)).toEqual([
      "notes/5.md",
      "notes/6.md",
      "notes/7.md",
    ]);
  });

  it("gives a collapsed segment a header and no card rows", () => {
    const rows = projectPanelRows(
      createCards(3),
      [createSegment("a", 0, 0, true), createSegment("b", 0, 3)],
      3,
    );

    expect(rows.map((row) => row.kind)).toEqual(["group-header", "group-header", "cards"]);
    expect(rows[2]).toMatchObject({ index: 2, startIndex: 0, endIndex: 3, segmentIndex: 1 });
  });

  it("clamps a segment that overruns the published card array", () => {
    const rows = projectPanelRows(createCards(2), [createSegment("a", 0, 5)], 3);

    expect(rows[1].kind === "cards" && rows[1].cards).toEqual([
      { path: "notes/0.md" },
      { path: "notes/1.md" },
    ]);
    expect(rows[1]).toMatchObject({ startIndex: 0, endIndex: 2 });
  });

  it("keeps header keys and card keys in separate namespaces", () => {
    const rows = projectPanelRows(
      createCards(4),
      [createSegment("a", 0, 2), createSegment("b", 2, 2)],
      3,
    );
    const keys = rows.map((row) => row.key);

    expect(new Set(keys).size).toBe(keys.length);
    for (const row of rows) {
      expect(row.key.startsWith("h:")).toBe(row.kind === "group-header");
    }
  });
});

describe("getHydrateRangeForPanelRows", () => {
  const rows = projectPanelRows(
    createCards(8),
    [createSegment("a", 0, 5), createSegment("b", 5, 3)],
    3,
  );

  it("skips header rows inside the window", () => {
    expect(getHydrateRangeForPanelRows(rows, 0, 5)).toEqual({ start: 0, end: 8 });
    expect(getHydrateRangeForPanelRows(rows, 2, 5)).toEqual({ start: 3, end: 8 });
  });

  it("returns an empty range for a header-only window", () => {
    expect(getHydrateRangeForPanelRows(rows, 3, 4)).toEqual({ start: 0, end: 0 });
    expect(getHydrateRangeForPanelRows([], 0, 0)).toEqual({ start: 0, end: 0 });
  });
});
