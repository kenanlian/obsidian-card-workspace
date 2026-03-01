import { describe, expect, it } from "vitest";
import { computeScrollAnchorDelta } from "./scroll-anchoring";

describe("computeScrollAnchorDelta", () => {
  it("returns zero while user is actively scrolling", () => {
    expect(
      computeScrollAnchorDelta({
        heightDelta: 40,
        changedIndex: 10,
        firstVisibleIndex: 12,
        nowMs: 1_000,
        userScrollLockUntilMs: 1_050,
      }),
    ).toBe(0);
  });

  it("returns zero when changed card is below visible viewport", () => {
    expect(
      computeScrollAnchorDelta({
        heightDelta: 40,
        changedIndex: 15,
        firstVisibleIndex: 12,
        nowMs: 1_000,
        userScrollLockUntilMs: 900,
      }),
    ).toBe(0);
  });

  it("returns zero when changed card is the first visible card", () => {
    expect(
      computeScrollAnchorDelta({
        heightDelta: 40,
        changedIndex: 12,
        firstVisibleIndex: 12,
        nowMs: 1_000,
        userScrollLockUntilMs: 900,
      }),
    ).toBe(0);
  });

  it("caps very large positive deltas", () => {
    expect(
      computeScrollAnchorDelta({
        heightDelta: 220,
        changedIndex: 8,
        firstVisibleIndex: 12,
        nowMs: 1_000,
        userScrollLockUntilMs: 900,
      }),
    ).toBe(80);
  });

  it("caps very large negative deltas", () => {
    expect(
      computeScrollAnchorDelta({
        heightDelta: -220,
        changedIndex: 8,
        firstVisibleIndex: 12,
        nowMs: 1_000,
        userScrollLockUntilMs: 900,
      }),
    ).toBe(-80);
  });

  it("keeps small deltas unchanged", () => {
    expect(
      computeScrollAnchorDelta({
        heightDelta: 24,
        changedIndex: 8,
        firstVisibleIndex: 12,
        nowMs: 1_000,
        userScrollLockUntilMs: 900,
      }),
    ).toBe(24);
  });
});
