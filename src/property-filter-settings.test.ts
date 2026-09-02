import { describe, expect, it } from "vitest";

import {
  comparePropertyScalarRefs,
  countActivePropertyValues,
  hasActivePropertyFilters,
  normalizeExpandedPropertyKeys,
  normalizePropertyFilterClauses,
  normalizePropertyKey,
  normalizePropertyScalarRef,
  normalizePropertyScalarRefs,
  normalizeVisiblePropertyKeys,
  propertyFilterClausesEqual,
  propertyScalarRefsEqual,
  resolvePropertyValueSelection,
  serializePropertyScalarRef,
  type PropertyFilterClause,
  type PropertyScalarRef,
} from "./property-filter-settings";

const text = (value: string): PropertyScalarRef => ({ kind: "text", value });
const num = (value: number): PropertyScalarRef => ({ kind: "number", value });
const bool = (value: boolean): PropertyScalarRef => ({ kind: "boolean", value });
const missing: PropertyScalarRef = { kind: "missing" };

describe("normalizePropertyKey", () => {
  it("trims, lowercases, and drops empty, non-string, and sentinel keys", () => {
    expect(normalizePropertyKey("  Status ")).toBe("status");
    expect(normalizePropertyKey("STATUS")).toBe("status");
    expect(normalizePropertyKey("")).toBeNull();
    expect(normalizePropertyKey("   ")).toBeNull();
    expect(normalizePropertyKey(7)).toBeNull();
    expect(normalizePropertyKey(null)).toBeNull();
    expect(normalizePropertyKey("position")).toBeNull();
    expect(normalizePropertyKey("Position")).toBeNull();
    expect(normalizePropertyKey(" POSITION ")).toBeNull();
  });
});

describe("serializePropertyScalarRef", () => {
  it("keeps text '1', number 1, boolean true, and missing distinct", () => {
    const identities = new Set([
      serializePropertyScalarRef(text("1")),
      serializePropertyScalarRef(num(1)),
      serializePropertyScalarRef(bool(true)),
      serializePropertyScalarRef(missing),
    ]);
    expect(identities.size).toBe(4);
  });

  it("is collision-free for delimiter-like and Unicode text", () => {
    const tricky = text('["t","x"]');
    expect(serializePropertyScalarRef(tricky)).not.toBe(serializePropertyScalarRef(text("x")));
    expect(serializePropertyScalarRef(text("属性"))).toBe(serializePropertyScalarRef(text("属性")));
    expect(propertyScalarRefsEqual(text("a"), text("a"))).toBe(true);
    expect(propertyScalarRefsEqual(text("a"), text("A"))).toBe(false);
  });

  it("orders deterministically by serialized identity", () => {
    const values = [text("b"), missing, num(2), bool(false), text("a")];
    const sorted = [...values].sort(comparePropertyScalarRefs);
    const identities = sorted.map(serializePropertyScalarRef);
    expect(identities).toEqual([...identities].sort());
  });
});

describe("normalizePropertyScalarRef", () => {
  it("round-trips valid refs and drops malformed discriminants and non-finite numbers", () => {
    expect(normalizePropertyScalarRef({ kind: "text", value: "open" })).toEqual(text("open"));
    expect(normalizePropertyScalarRef({ kind: "number", value: 3 })).toEqual(num(3));
    expect(normalizePropertyScalarRef({ kind: "boolean", value: false })).toEqual(bool(false));
    expect(normalizePropertyScalarRef({ kind: "missing" })).toEqual(missing);
    expect(normalizePropertyScalarRef({ kind: "number", value: Number.NaN })).toBeNull();
    expect(normalizePropertyScalarRef({ kind: "number", value: Infinity })).toBeNull();
    expect(normalizePropertyScalarRef({ kind: "number", value: "3" })).toBeNull();
    expect(normalizePropertyScalarRef({ kind: "text", value: 3 })).toBeNull();
    expect(normalizePropertyScalarRef({ kind: "date", value: "2024-01-01" })).toBeNull();
    expect(normalizePropertyScalarRef("text:open")).toBeNull();
    expect(normalizePropertyScalarRef(null)).toBeNull();
  });
});

describe("normalizePropertyScalarRefs", () => {
  it("deduplicates by identity and sorts by identity", () => {
    const result = normalizePropertyScalarRefs([
      { kind: "text", value: "b" },
      { kind: "text", value: "b" },
      { kind: "text", value: "a" },
      { kind: "number", value: 1 },
      { kind: "text", value: "1" },
      "junk",
      { kind: "number", value: Number.NaN },
    ]);
    expect(result.map(serializePropertyScalarRef)).toEqual(
      [num(1), text("1"), text("a"), text("b")].map(serializePropertyScalarRef).sort(),
    );
    expect(normalizePropertyScalarRefs("nope")).toEqual([]);
    expect(normalizePropertyScalarRefs(undefined)).toEqual([]);
  });
});

describe("normalizeVisiblePropertyKeys", () => {
  it("normalizes, dedupes case-insensitively, and sorts with localeCompare", () => {
    expect(normalizeVisiblePropertyKeys([" Status ", "status", "PRIORITY", "", 5, "position"]))
      .toEqual(["priority", "status"]);
    expect(normalizeVisiblePropertyKeys("status")).toEqual([]);
    expect(normalizeVisiblePropertyKeys(undefined)).toEqual([]);
  });
});

describe("normalizeExpandedPropertyKeys", () => {
  it("retains only normalized keys that are still visible", () => {
    expect(
      normalizeExpandedPropertyKeys(["Status", "hidden", "status", ""], new Set(["status"])),
    ).toEqual(["status"]);
    expect(normalizeExpandedPropertyKeys(undefined, new Set(["status"]))).toEqual([]);
  });
});

describe("normalizePropertyFilterClauses", () => {
  it("drops malformed clauses, empty clauses, and duplicate values", () => {
    const result = normalizePropertyFilterClauses([
      { key: " Status ", values: [text("open"), text("open"), text("closed")] },
      { key: "", values: [text("x")] },
      { key: "position", values: [text("x")] },
      { key: "empty", values: [] },
      { key: "broken", values: [{ kind: "number", value: Number.NaN }] },
      "not-a-clause",
      { key: "no-values" },
    ]);
    expect(result).toEqual([
      { key: "status", values: [text("closed"), text("open")] },
    ]);
  });

  it("merges duplicate keys into one clause with a deduplicated value union", () => {
    const result = normalizePropertyFilterClauses([
      { key: "status", values: [text("open")] },
      { key: "STATUS", values: [text("open"), num(1)] },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("status");
    expect(result[0].values.map(serializePropertyScalarRef).sort())
      .toEqual([text("open"), num(1)].map(serializePropertyScalarRef).sort());
  });

  it("drops clauses whose key is not currently visible", () => {
    const clauses: unknown[] = [
      { key: "status", values: [text("open")] },
      { key: "hidden", values: [text("x")] },
    ];
    expect(normalizePropertyFilterClauses(clauses, new Set(["status"]))).toEqual([
      { key: "status", values: [text("open")] },
    ]);
    expect(normalizePropertyFilterClauses(clauses)).toHaveLength(2);
    expect(normalizePropertyFilterClauses("nope")).toEqual([]);
  });
});

describe("propertyFilterClausesEqual", () => {
  const clauses: PropertyFilterClause[] = [
    { key: "status", values: [text("open")] },
    { key: "priority", values: [num(1)] },
  ];

  it("compares key order and type-sensitive value identity", () => {
    const clone: PropertyFilterClause[] = [
      { key: "status", values: [{ kind: "text", value: "open" }] },
      { key: "priority", values: [{ kind: "number", value: 1 }] },
    ];
    expect(propertyFilterClausesEqual(clauses, clone)).toBe(true);
    expect(propertyFilterClausesEqual(clauses, [])).toBe(false);
    expect(propertyFilterClausesEqual(clauses, [
      { key: "priority", values: [num(1)] },
      { key: "status", values: [text("open")] },
    ])).toBe(false);
    expect(propertyFilterClausesEqual(clauses, [
      { key: "status", values: [num(1)] },
      { key: "priority", values: [num(1)] },
    ])).toBe(false);
  });
});

describe("resolvePropertyValueSelection", () => {
  it("ordinary select replaces all clauses with the single key/value", () => {
    const active = normalizePropertyFilterClauses([
      { key: "status", values: [text("open")] },
      { key: "priority", values: [num(1)] },
    ]);
    expect(resolvePropertyValueSelection(active, "status", text("closed"), false)).toEqual([
      { key: "status", values: [text("closed")] },
    ]);
  });

  it("ordinary select on the sole active value clears all property filters", () => {
    const active = [{ key: "status", values: [text("open")] }];
    expect(resolvePropertyValueSelection(active, "status", text("open"), false)).toEqual([]);
    // Not sole: another key is active, so this replaces rather than clears.
    const multi = normalizePropertyFilterClauses([
      { key: "status", values: [text("open")] },
      { key: "priority", values: [num(2)] },
    ]);
    expect(resolvePropertyValueSelection(multi, "status", text("open"), false)).toEqual([
      { key: "status", values: [text("open")] },
    ]);
    // Sole key but the value list has more than one entry: replace, not clear.
    const twoValues = [{ key: "status", values: [text("closed"), text("open")] }];
    expect(resolvePropertyValueSelection(twoValues, "status", text("open"), false)).toEqual([
      { key: "status", values: [text("open")] },
    ]);
  });

  it("additive toggles within one key (OR), preserving other keys", () => {
    const active = normalizePropertyFilterClauses([
      { key: "status", values: [text("open")] },
      { key: "priority", values: [num(1)] },
    ]);
    const added = resolvePropertyValueSelection(active, "status", text("closed"), true);
    expect(added).toEqual([
      { key: "status", values: [text("closed"), text("open")] },
      { key: "priority", values: [num(1)] },
    ]);
    const removed = resolvePropertyValueSelection(added, "status", text("open"), true);
    expect(removed).toEqual([
      { key: "status", values: [text("closed")] },
      { key: "priority", values: [num(1)] },
    ]);
  });

  it("additive removes a clause whose last value is toggled off", () => {
    const active = [{ key: "status", values: [text("open")] }];
    expect(resolvePropertyValueSelection(active, "status", text("open"), true)).toEqual([]);
  });

  it("additive appends a new clause for a key that has none", () => {
    const active = [{ key: "priority", values: [num(1)] }];
    expect(resolvePropertyValueSelection(active, "status", missing, true)).toEqual([
      { key: "priority", values: [num(1)] },
      { key: "status", values: [missing] },
    ]);
  });

  it("ignores an unresolvable key without dropping existing clauses", () => {
    const active = [{ key: "status", values: [text("open")] }];
    expect(resolvePropertyValueSelection(active, " position ", text("x"), false)).toEqual(active);
    expect(resolvePropertyValueSelection(active, "", text("x"), true)).toEqual(active);
  });
});

describe("active filter helpers", () => {
  it("counts every active value ref including missing", () => {
    const clauses = normalizePropertyFilterClauses([
      { key: "status", values: [text("open"), missing] },
      { key: "priority", values: [num(1)] },
    ]);
    expect(countActivePropertyValues(clauses)).toBe(3);
    expect(hasActivePropertyFilters(clauses)).toBe(true);
    expect(hasActivePropertyFilters([])).toBe(false);
    expect(countActivePropertyValues([])).toBe(0);
  });
});
