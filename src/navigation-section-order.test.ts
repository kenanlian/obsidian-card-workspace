import { describe, expect, it } from "vitest";

import {
  canMoveNavSection,
  defaultNavSectionOrder,
  moveNavSection,
  normalizeNavSectionOrder,
} from "./navigation-section-order";
import { NAVIGATION_SECTION_ORDER } from "./view/navigation-model";
import type { NavSectionId } from "./view/types";

const DEFAULT_ORDER: NavSectionId[] = ["favorites", "folders", "tags", "properties", "boxes"];

describe("defaultNavSectionOrder", () => {
  it("returns a distinct array instance on each call", () => {
    const first = defaultNavSectionOrder();
    const second = defaultNavSectionOrder();
    expect(first).toEqual([...NAVIGATION_SECTION_ORDER]);
    expect(second).toEqual(first);
    expect(first).not.toBe(second);
  });
});

describe("normalizeNavSectionOrder", () => {
  it("returns the default order for undefined, null, a non-array value, and []", () => {
    expect(normalizeNavSectionOrder(undefined)).toEqual(DEFAULT_ORDER);
    expect(normalizeNavSectionOrder(null)).toEqual(DEFAULT_ORDER);
    expect(normalizeNavSectionOrder(0)).toEqual(DEFAULT_ORDER);
    expect(normalizeNavSectionOrder("favorites")).toEqual(DEFAULT_ORDER);
    expect(normalizeNavSectionOrder({})).toEqual(DEFAULT_ORDER);
    expect(normalizeNavSectionOrder([])).toEqual(DEFAULT_ORDER);
  });

  it("preserves a full valid permutation exactly", () => {
    const permutation: NavSectionId[] = ["boxes", "tags", "properties", "favorites", "folders"];
    expect(normalizeNavSectionOrder(permutation)).toEqual(permutation);
  });

  it("collapses duplicates to the first occurrence", () => {
    expect(normalizeNavSectionOrder(["folders", "folders", "tags", "folders"])).toEqual([
      "folders",
      "tags",
      "favorites",
      "properties",
      "boxes",
    ]);
  });

  it("drops unknown ids", () => {
    expect(normalizeNavSectionOrder(["favorites", "nope", "folders", "mystery", "tags", "properties", "boxes"]))
      .toEqual(DEFAULT_ORDER);
  });

  it("appends missing known ids in default order after a partial input", () => {
    expect(normalizeNavSectionOrder(["boxes"])).toEqual([
      "properties",
      "boxes",
      "favorites",
      "folders",
      "tags",
    ]);
  });

  it("keeps first-wins order and fills missing ids when mixed with junk", () => {
    const value: unknown = ["tags", "tags", "nope", 7, "favorites"];
    expect(normalizeNavSectionOrder(value)).toEqual([
      "tags",
      "favorites",
      "folders",
      "properties",
      "boxes",
    ]);
  });

  it("inserts properties immediately before boxes for old four-section orders", () => {
    expect(normalizeNavSectionOrder(["favorites", "folders", "tags", "boxes"]))
      .toEqual(DEFAULT_ORDER);
    expect(normalizeNavSectionOrder(["boxes", "tags", "favorites", "folders"]))
      .toEqual(["properties", "boxes", "tags", "favorites", "folders"]);
    expect(normalizeNavSectionOrder(["tags", "boxes", "favorites", "folders"]))
      .toEqual(["tags", "properties", "boxes", "favorites", "folders"]);
  });

  it("appends properties when an old order has no boxes entry", () => {
    expect(normalizeNavSectionOrder(["folders", "tags"])).toEqual([
      "folders",
      "tags",
      "favorites",
      "properties",
      "boxes",
    ]);
  });
});

describe("moveNavSection", () => {
  const order: NavSectionId[] = ["favorites", "folders", "tags", "properties", "boxes"];

  it("swaps a middle section up and down", () => {
    expect(moveNavSection(order, "folders", -1)).toEqual([
      "folders",
      "favorites",
      "tags",
      "properties",
      "boxes",
    ]);
    expect(moveNavSection(order, "folders", 1)).toEqual([
      "favorites",
      "tags",
      "folders",
      "properties",
      "boxes",
    ]);
  });

  it("returns null for a first-element move-up, a last-element move-down, and an unknown section", () => {
    expect(moveNavSection(order, "favorites", -1)).toBeNull();
    expect(moveNavSection(order, "boxes", 1)).toBeNull();
    expect(moveNavSection(order, "nope" as NavSectionId, 1)).toBeNull();
  });

  it("returns a new array and leaves the input untouched", () => {
    const input: NavSectionId[] = ["favorites", "folders", "tags", "properties", "boxes"];
    const snapshot = [...input];
    const result = moveNavSection(input, "tags", -1);
    expect(result).not.toBeNull();
    expect(result).not.toBe(input);
    expect(input).toEqual(snapshot);
  });
});

describe("canMoveNavSection", () => {
  const order: NavSectionId[] = ["favorites", "folders", "tags", "properties", "boxes"];

  it("agrees with moveNavSection at both boundaries", () => {
    const cases: Array<{ section: NavSectionId; delta: -1 | 1 }> = [
      { section: "favorites", delta: -1 },
      { section: "favorites", delta: 1 },
      { section: "folders", delta: -1 },
      { section: "folders", delta: 1 },
      { section: "tags", delta: -1 },
      { section: "tags", delta: 1 },
      { section: "boxes", delta: -1 },
      { section: "boxes", delta: 1 },
      { section: "nope" as NavSectionId, delta: 1 },
    ];
    for (const { section, delta } of cases) {
      expect(canMoveNavSection(order, section, delta)).toBe(
        moveNavSection(order, section, delta) !== null,
      );
    }
  });
});
