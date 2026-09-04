import { describe, expect, it } from "vitest";

import {
  navigationPropertyId,
  navigationPropertyValueId,
  type NavigationRow,
} from "./navigation-model";
import { resolveNavigationFocus, resolveNavigationKey } from "./navigation-keyboard";

function propertyKeyRow(expanded = false): NavigationRow {
  return {
    id: navigationPropertyId("status"), kind: "property", section: "properties",
    parentId: "section:properties", level: 2, positionInSet: 1, setSize: 1,
    expandable: true, expanded, disabled: false, semanticState: "none",
    label: "Status", fullPath: null, count: 3, icon: "list",
    menuTarget: { section: "properties", scope: "item", itemId: "status" },
    propertyKey: "status",
  };
}

function propertyValueRow(): NavigationRow {
  return {
    id: navigationPropertyValueId("status", { kind: "text", value: "open" }),
    kind: "property-value", section: "properties", parentId: navigationPropertyId("status"),
    level: 3, positionInSet: 1, setSize: 1, expandable: false, expanded: false, disabled: false,
    semanticState: "checked-filter", label: "open", fullPath: null, count: 2, icon: "dot",
    menuTarget: {
      section: "properties", scope: "item", itemId: "status", value: { kind: "text", value: "open" },
    },
    propertyKey: "status", value: { kind: "text", value: "open" },
  };
}

describe("resolveNavigationKey — property rows", () => {
  it("returns an ordinary activate for Enter on key and value rows", () => {
    const key = propertyKeyRow();
    const value = propertyValueRow();
    const rows = [key, value];
    expect(resolveNavigationKey({ key: "Enter", shiftKey: false }, rows, key.id))
      .toEqual({ type: "activate", rowId: key.id, mode: "ordinary" });
    expect(resolveNavigationKey({ key: "Enter", shiftKey: false }, rows, value.id))
      .toEqual({ type: "activate", rowId: value.id, mode: "ordinary" });
  });

  it("returns an additive activate for Space on a property-value row", () => {
    const value = propertyValueRow();
    const rows = [propertyKeyRow(), value];
    expect(resolveNavigationKey({ key: " ", shiftKey: false }, rows, value.id))
      .toEqual({ type: "activate", rowId: value.id, mode: "additive" });
  });

  it("focuses the parent key on ArrowLeft from a value row and expands a collapsed key on ArrowRight", () => {
    const key = propertyKeyRow(false);
    const value = propertyValueRow();
    const rows = [key, value];
    expect(resolveNavigationKey({ key: "ArrowLeft", shiftKey: false }, rows, value.id))
      .toEqual({ type: "focus", rowId: key.id });
    expect(resolveNavigationKey({ key: "ArrowRight", shiftKey: false }, rows, key.id))
      .toEqual({ type: "expand", rowId: key.id, expanded: true });
  });
});

describe("resolveNavigationFocus", () => {
  it("prefers the requested ID, then current range, then prior index, then the first row", () => {
    const key = propertyKeyRow();
    const value = propertyValueRow();
    const rows = [key, value];
    expect(resolveNavigationFocus(rows, value.id)).toBe(value.id);
    // A known-but-absent requested ID falls back by its prior logical index.
    expect(resolveNavigationFocus(rows, "gone", ["gone", value.id])).toBe(key.id);
    expect(resolveNavigationFocus(rows, "gone", [value.id, "gone"])).toBe(value.id);
    // An unknown ID falls back to the first row.
    expect(resolveNavigationFocus(rows, "gone", [])).toBe(key.id);
    expect(resolveNavigationFocus([], value.id)).toBeNull();
  });
});
