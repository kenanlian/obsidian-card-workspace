import { describe, expect, it } from "vitest";
import {
  captureScrollAnchor,
  computeAnchoredScrollTop,
  computeScrollAnchorDelta,
} from "./scroll-anchoring";

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

describe("row layout anchoring", () => {
  it("returns null when there is no row layout to anchor", () => {
    expect(
      captureScrollAnchor({
        scrollTop: 120,
        rowPositions: [],
        rows: [],
      }),
    ).toBeNull();
  });

  it("captures the first visible row's leading card index and offset", () => {
    expect(
      captureScrollAnchor({
        scrollTop: 255,
        rowPositions: [0, 120, 260, 390],
        rows: [
          { startIndex: 0 },
          { startIndex: 3 },
          { startIndex: 6 },
          { startIndex: 9 },
        ],
      }),
    ).toEqual({
      anchorCardIndex: 3,
      anchorOffset: 135,
    });
  });

  it("recomputes scrollTop after a column-count change using the same anchor card", () => {
    expect(
      computeAnchoredScrollTop({
        anchorCardIndex: 3,
        anchorOffset: 20,
        columnCount: 2,
        rowPositions: [0, 100, 220, 330, 470],
        cardCount: 10,
      }),
    ).toBe(120);
  });

  it("keeps the same anchor card when column count shrinks", () => {
    expect(
      computeAnchoredScrollTop({
        anchorCardIndex: 5,
        anchorOffset: 18,
        columnCount: 1,
        rowPositions: [0, 100, 220, 360, 500, 660, 820],
        cardCount: 7,
      }),
    ).toBe(678);
  });

  it("treats invalid column counts as single-column during anchor restoration", () => {
    expect(
      computeAnchoredScrollTop({
        anchorCardIndex: 2,
        anchorOffset: 10,
        columnCount: 0,
        rowPositions: [0, 120, 260, 420],
        cardCount: 4,
      }),
    ).toBe(270);
  });

  it("clamps negative anchor offsets to zero", () => {
    expect(
      computeAnchoredScrollTop({
        anchorCardIndex: 2,
        anchorOffset: -15,
        columnCount: 2,
        rowPositions: [0, 120, 260],
        cardCount: 6,
      }),
    ).toBe(120);
  });

  it("clamps anchor scroll calculations to the last available card", () => {
    expect(
      computeAnchoredScrollTop({
        anchorCardIndex: 999,
        anchorOffset: 12,
        columnCount: 3,
        rowPositions: [0, 100, 220, 360],
        cardCount: 10,
      }),
    ).toBe(372);
  });

  it("restores the same anchor card across a wide-to-narrow resize sequence", () => {
    const anchor = captureScrollAnchor({
      scrollTop: 255,
      rowPositions: [0, 120, 260, 390],
      rows: [
        { startIndex: 0 },
        { startIndex: 3 },
        { startIndex: 6 },
        { startIndex: 9 },
      ],
    });

    expect(anchor).toEqual({
      anchorCardIndex: 3,
      anchorOffset: 135,
    });

    expect(
      computeAnchoredScrollTop({
        anchorCardIndex: anchor?.anchorCardIndex ?? 0,
        anchorOffset: anchor?.anchorOffset ?? 0,
        columnCount: 1,
        rowPositions: [0, 90, 210, 330, 470, 610, 760, 920, 1080, 1260],
        cardCount: 10,
      }),
    ).toBe(465);
  });
});
