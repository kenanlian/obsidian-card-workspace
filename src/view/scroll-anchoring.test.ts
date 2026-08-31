import { describe, expect, it } from "vitest";
import {
  captureLayoutAnchor,
  captureRowAnchor,
  clampLayoutScrollTop,
  computeScrollAnchorDelta,
  resolveAnchoredScrollTop,
  type AnchorCandidateRow,
} from "./scroll-anchoring";
import { projectPanelRows, type RowSegment } from "./row-projection";

function cardRow(...paths: string[]): AnchorCandidateRow {
  return { kind: "cards", key: `3:${paths.join("\u001f")}`, cards: paths.map((path) => ({ path })) };
}

function headerRow(key: string): AnchorCandidateRow {
  return { kind: "group-header", key: `h:${key}` };
}

describe("computeScrollAnchorDelta", () => {
  it("returns zero while user is actively scrolling", () => {
    expect(
      computeScrollAnchorDelta({
        heightDelta: 40,
        changedRowIndex: 10,
        firstVisibleRowIndex: 12,
        nowMs: 1_000,
        userScrollLockUntilMs: 1_050,
      }),
    ).toBe(0);
  });

  it("returns zero when changed card is below visible viewport", () => {
    expect(
      computeScrollAnchorDelta({
        heightDelta: 40,
        changedRowIndex: 15,
        firstVisibleRowIndex: 12,
        nowMs: 1_000,
        userScrollLockUntilMs: 900,
      }),
    ).toBe(0);
  });

  it("returns zero when changed card is the first visible card", () => {
    expect(
      computeScrollAnchorDelta({
        heightDelta: 40,
        changedRowIndex: 12,
        firstVisibleRowIndex: 12,
        nowMs: 1_000,
        userScrollLockUntilMs: 900,
      }),
    ).toBe(0);
  });

  it("caps very large positive deltas", () => {
    expect(
      computeScrollAnchorDelta({
        heightDelta: 220,
        changedRowIndex: 8,
        firstVisibleRowIndex: 12,
        nowMs: 1_000,
        userScrollLockUntilMs: 900,
      }),
    ).toBe(80);
  });

  it("caps very large negative deltas", () => {
    expect(
      computeScrollAnchorDelta({
        heightDelta: -220,
        changedRowIndex: 8,
        firstVisibleRowIndex: 12,
        nowMs: 1_000,
        userScrollLockUntilMs: 900,
      }),
    ).toBe(-80);
  });

  it("keeps small deltas unchanged", () => {
    expect(
      computeScrollAnchorDelta({
        heightDelta: 24,
        changedRowIndex: 8,
        firstVisibleRowIndex: 12,
        nowMs: 1_000,
        userScrollLockUntilMs: 900,
      }),
    ).toBe(24);
  });
});

describe("clampLayoutScrollTop", () => {
  it.each([
    [500, 300, 100, 200],
    [50, 300, 100, 50],
    [-20, 300, 100, 0],
    [50, 80, 100, 0],
    [Number.NaN, 300, 100, 0],
  ])("clamps scroll to the installed layout", (scrollTop, totalHeight, viewportHeight, expected) => {
    expect(clampLayoutScrollTop(scrollTop, totalHeight, viewportHeight)).toBe(expected);
  });
});

describe("row layout anchoring", () => {
  const mixedRows = [
    headerRow("a"),
    cardRow("notes/0.md", "notes/1.md", "notes/2.md"),
    cardRow("notes/3.md", "notes/4.md"),
    headerRow("b"),
    cardRow("notes/5.md", "notes/6.md", "notes/7.md"),
  ];
  const mixedPositions = [0, 40, 240, 440, 480];

  it("returns null when there is no row layout to anchor", () => {
    expect(captureLayoutAnchor({ scrollTop: 120, rowPositions: [], rows: [] })).toBeNull();
    expect(
      captureRowAnchor({ scrollTop: 120, rowPositions: [], rows: [], rowIndex: 0 }),
    ).toBeNull();
  });

  it("captures a card ref with the top visible row's offset", () => {
    expect(
      captureLayoutAnchor({ scrollTop: 300, rowPositions: mixedPositions, rows: mixedRows }),
    ).toEqual({ ref: { kind: "card", path: "notes/3.md" }, offset: 60 });
  });

  it("captures a group ref when the top visible row is a header", () => {
    expect(
      captureLayoutAnchor({ scrollTop: 460, rowPositions: mixedPositions, rows: mixedRows }),
    ).toEqual({ ref: { kind: "group", key: "h:b" }, offset: 20 });
  });

  it("captures a negative offset for a caller-chosen row below the viewport top", () => {
    expect(
      captureRowAnchor({
        scrollTop: 140,
        rowPositions: mixedPositions,
        rows: mixedRows,
        rowIndex: 3,
      }),
    ).toEqual({ ref: { kind: "group", key: "h:b" }, offset: -300 });
  });

  it("round-trips a negative toggle offset back to the original scrollTop", () => {
    const anchor = captureRowAnchor({
      scrollTop: 140,
      rowPositions: mixedPositions,
      rows: mixedRows,
      rowIndex: 3,
    });

    expect(anchor?.offset).toBeLessThan(0);
    expect(
      resolveAnchoredScrollTop({
        anchor: anchor!,
        rows: mixedRows,
        rowPositions: mixedPositions,
      }),
    ).toBe(140);
  });

  it("finds the anchor card again after a column-count change moved its row", () => {
    expect(
      resolveAnchoredScrollTop({
        anchor: { ref: { kind: "card", path: "notes/4.md" }, offset: 25 },
        rows: [
          cardRow("notes/0.md", "notes/1.md"),
          cardRow("notes/2.md", "notes/3.md"),
          cardRow("notes/4.md", "notes/5.md"),
        ],
        rowPositions: [0, 120, 260],
      }),
    ).toBe(285);
  });

  it("returns null when the anchored ref is gone", () => {
    expect(
      resolveAnchoredScrollTop({
        anchor: { ref: { kind: "card", path: "notes/removed.md" }, offset: 25 },
        rows: mixedRows,
        rowPositions: mixedPositions,
      }),
    ).toBeNull();
    expect(
      resolveAnchoredScrollTop({
        anchor: { ref: { kind: "group", key: "h:gone" }, offset: 0 },
        rows: mixedRows,
        rowPositions: mixedPositions,
      }),
    ).toBeNull();
  });

  it("holds a grouped card in place across a column reflow", () => {
    const cards = Array.from({ length: 8 }, (_value, index) => ({ path: `notes/${index}.md` }));
    const segments: RowSegment[] = [
      { key: "a", startIndex: 0, visibleCount: 5, collapsed: false },
      { key: "b", startIndex: 5, visibleCount: 3, collapsed: false },
    ];

    const wideRows = projectPanelRows(cards, segments, 3);
    const widePositions = [0, 40, 240, 440, 480];
    const anchor = captureLayoutAnchor({
      scrollTop: 500,
      rowPositions: widePositions,
      rows: wideRows,
    });

    expect(anchor).toEqual({ ref: { kind: "card", path: "notes/5.md" }, offset: 20 });

    const narrowRows = projectPanelRows(cards, segments, 2);
    const narrowPositions = [0, 40, 240, 440, 640, 680, 880];

    expect(narrowRows).toHaveLength(narrowPositions.length);
    expect(
      resolveAnchoredScrollTop({
        anchor: anchor!,
        rows: narrowRows,
        rowPositions: narrowPositions,
      }),
    ).toBe(700);
  });
});

describe("positional anchoring for ungrouped layouts", () => {
  const cards = Array.from({ length: 9 }, (_, index) => ({ path: `notes/${index}.md` }));
  const positions = [0, 200, 400];

  it("captures a card-index ref instead of a card ref when asked", () => {
    const rows = projectPanelRows(cards, [], 3);

    expect(
      captureLayoutAnchor({
        scrollTop: 260, rowPositions: positions, rows, preferCardIndex: true,
      }),
    ).toEqual({ ref: { kind: "card-index", index: 3 }, offset: 60 });

    expect(
      captureLayoutAnchor({ scrollTop: 260, rowPositions: positions, rows }),
    ).toEqual({ ref: { kind: "card", path: "notes/3.md" }, offset: 60 });
  });

  it("holds the viewport across a reorder rather than following the card", () => {
    const rows = projectPanelRows(cards, [], 3);
    const reversedCards = Array.from(cards, (_, index) => cards[cards.length - 1 - index]);
    const reversed = projectPanelRows(reversedCards, [], 3);

    // Anchored on row 0, whose first card reversal moves to the last row, so
    // the two ref kinds are actually distinguishable here.
    const indexAnchor = captureLayoutAnchor({
      scrollTop: 60, rowPositions: positions, rows, preferCardIndex: true,
    });
    expect(indexAnchor).toEqual({ ref: { kind: "card-index", index: 0 }, offset: 60 });
    expect(
      resolveAnchoredScrollTop({ anchor: indexAnchor!, rows: reversed, rowPositions: positions }),
    ).toBe(60);

    // The path-based ref is what chases the card, and is why grouping needs it.
    const pathAnchor = captureLayoutAnchor({ scrollTop: 60, rowPositions: positions, rows });
    expect(pathAnchor).toEqual({ ref: { kind: "card", path: "notes/0.md" }, offset: 60 });
    expect(
      resolveAnchoredScrollTop({ anchor: pathAnchor!, rows: reversed, rowPositions: positions }),
    ).toBe(460);
  });

  it("selects the row spanning the index after a column change", () => {
    const anchor = {
      ref: { kind: "card-index" as const, index: 5 },
      offset: 10,
    };
    const twoColumnRows = projectPanelRows(cards, [], 2);
    const twoColumnPositions = [0, 100, 200, 300, 400];

    // Index 5 lands in row 2 at two columns, matching floor(5 / 2).
    expect(
      resolveAnchoredScrollTop({
        anchor, rows: twoColumnRows, rowPositions: twoColumnPositions,
      }),
    ).toBe(210);
  });

  it("clamps to the last card row when the array shrank below the index", () => {
    const shortRows = projectPanelRows(cards.slice(0, 4), [], 3);

    expect(
      resolveAnchoredScrollTop({
        anchor: { ref: { kind: "card-index", index: 8 }, offset: 0 },
        rows: shortRows,
        rowPositions: [0, 200],
      }),
    ).toBe(200);
  });

  it("still captures a group ref when the top row is a header", () => {
    const segments: RowSegment[] = [
      { key: "g:0", startIndex: 0, visibleCount: 9, collapsed: false },
    ];
    const rows = projectPanelRows(cards, segments, 3);

    expect(
      captureLayoutAnchor({
        scrollTop: 0, rowPositions: [0, 40, 240, 440], rows, preferCardIndex: true,
      }),
    ).toEqual({ ref: { kind: "group", key: "h:g:0" }, offset: 0 });
  });
});
