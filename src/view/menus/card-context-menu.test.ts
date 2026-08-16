import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  Menu: class Menu {},
}));

import {
  decorateCardContextMenu,
  isMenuPosition,
  isMouseEventLike,
} from "./card-context-menu";

describe("card context menu helpers", () => {
  it("validates mouse and positioned triggers", () => {
    expect(isMouseEventLike({ clientX: 1, clientY: 2 })).toBe(true);
    expect(isMouseEventLike({ clientX: 1 })).toBe(false);
    expect(isMenuPosition({ x: 3, y: 4 })).toBe(true);
    expect(isMenuPosition({ x: 3 })).toBe(false);
  });

  it("decorates the menu surface even without a danger row", () => {
    const add = vi.fn();
    decorateCardContextMenu({
      classList: { add },
      querySelectorAll: () => [],
    }, null);

    expect(add).toHaveBeenCalledWith("fce-card-context-menu");
  });
});
