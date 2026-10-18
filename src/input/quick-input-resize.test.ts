import { describe, expect, it } from "vitest";
import { resizeQuickInputBounds } from "./quick-input-resize";

const start = { x: 100, y: 100, width: 480, height: 270 };
describe("quick input edge resizing", () => {
  it("moves only the dragged edges", () => {
    expect(resizeQuickInputBounds(start, "e", 40, 99, 320, 200)).toEqual({ x: 100, y: 100, width: 520, height: 270 });
    expect(resizeQuickInputBounds(start, "s", 99, 30, 320, 200)).toEqual({ x: 100, y: 100, width: 480, height: 300 });
    expect(resizeQuickInputBounds(start, "w", -40, 99, 320, 200)).toEqual({ x: 60, y: 100, width: 520, height: 270 });
    expect(resizeQuickInputBounds(start, "n", 99, -30, 320, 200)).toEqual({ x: 100, y: 70, width: 480, height: 300 });
    expect(resizeQuickInputBounds(start, "se", 20, 10, 320, 200)).toEqual({ x: 100, y: 100, width: 500, height: 280 });
    expect(resizeQuickInputBounds(start, "ne", 20, 10, 320, 200)).toEqual({ x: 100, y: 110, width: 500, height: 260 });
    expect(resizeQuickInputBounds(start, "sw", 20, 10, 320, 200)).toEqual({ x: 120, y: 100, width: 460, height: 280 });
  });
  it("anchors the opposite edges at the minimum size and rounds to whole DIPs", () => {
    expect(resizeQuickInputBounds(start, "nw", 1000, 1000, 320, 200)).toEqual({ x: 260, y: 170, width: 320, height: 200 });
    expect(resizeQuickInputBounds(start, "se", -1000, -1000, 320, 200)).toEqual({ x: 100, y: 100, width: 320, height: 200 });
    expect(resizeQuickInputBounds(start, "e", 0.6, 0, 320, 200).width).toBe(481);
  });
});
