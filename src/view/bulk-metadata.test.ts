import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { buildBulkMetadataSnapshot, filterMetadataCandidates, inferPropertyEditType, propertyValueCandidates, validIsoDate, validLocalDateTime, validPropertiesDraft } from "./bulk-metadata";

function file(path: string): TFile { const result = new TFile(); result.path = path; result.extension = "md"; return result; }

describe("bulk metadata inventory", () => {
  it("uses all cached properties, deduplicates per-note counts and excludes tags and position", () => {
    const first = file("first.md"); const second = file("second.md"); const outside = file("outside.md"); const missing = file("missing.md");
    const caches = new Map([
      [first, { tags: [{ tag: "#Work" }, { tag: "#work" }], frontmatter: { Status: "open", score: 0, list: ["one", 1], tags: ["work"], position: {} } }],
      [second, { tags: [{ tag: "#work/child" }], frontmatter: { STATUS: false, secret: "hidden" } }],
      [outside, { frontmatter: { Outside: "elsewhere", score: 2, list: ["two", 2] } }],
    ]);
    const app = { vault: { getMarkdownFiles: () => [first, second, outside, missing] }, metadataCache: { getFileCache: vi.fn((target) => caches.get(target) ?? null) } };
    const snapshot = buildBulkMetadataSnapshot(app as never, [first, second]);
    expect(snapshot.incomplete).toBe(true);
    expect(snapshot.removeTags).toEqual([{ name: "Work", count: 1 }, { name: "work/child", count: 1 }]);
    expect(snapshot.removeProperties).toEqual([{ name: "Status", count: 2 }, { name: "score", count: 1 }, { name: "list", count: 1 }, { name: "secret", count: 1 }]);
    expect(snapshot.properties.map((entry) => entry.name)).toContain("Outside");
    expect(snapshot.removeProperties.map((entry) => entry.name)).not.toContain("Outside");
    expect(inferPropertyEditType(snapshot.values.get("status")!)).toBe("text");
    expect(propertyValueCandidates(snapshot, "score", "number")).toEqual([{ name: "0" }, { name: "2" }]);
    expect(propertyValueCandidates(snapshot, "list", "list", "text")).toEqual([{ name: "one" }, { name: "two" }]);
    expect(propertyValueCandidates(snapshot, "list", "list", "number")).toEqual([{ name: "1" }, { name: "2" }]);
    expect(app.metadataCache.getFileCache).toHaveBeenCalledTimes(4); // Inventory and tag cache reads only at open.
  });
  it("matches case-insensitive substrings with prefix priority, ordering and a 20-result limit", () => {
    const names = ["zebra", "Beta", "alpha", "alphabet", ...Array.from({ length: 25 }, (_, index) => `a${index}`)];
    expect(filterMetadataCandidates(names.map((name) => ({ name })), "ALP").map((item) => item.name)).toEqual(["alpha", "alphabet"]);
    expect(filterMetadataCandidates([{ name: "beta" }, { name: "eta" }], "eta").map((item) => item.name)).toEqual(["eta", "beta"]);
    expect(filterMetadataCandidates(names.map((name) => ({ name })), "")).toHaveLength(20);
  });
  it("infers the six edit types, detects mixed values and validates strict ISO dates", () => {
    for (const [values, type] of [[[], "text"], [["plain"], "text"], [[[1, "a"]], "list"], [[0], "number"], [[false], "checkbox"], [["2024-02-29"], "date"], [["2024-02-29T12:30:00"], "datetime"], [["2024-02-29T12:30:00Z"], "datetime"], [["2024-02-29T12:30:00+08:00"], "datetime"], [["2023-02-29T12:30:00Z"], "text"], [[false, 1], "text"]] as const) {
      expect(inferPropertyEditType([...values])).toBe(type);
    }
    expect(validIsoDate("2023-02-29")).toBe(false);
    expect(validLocalDateTime("2024-02-29T25:00")).toBe(false);
    expect(validLocalDateTime("2024-02-29T00:00")).toBe(true);
  });
  it("blocks conflicting, reserved, duplicate and incomplete property operations", () => {
    const entry = { name: "Status", type: "text" as const, value: "" };
    expect(validPropertiesDraft({ setProperties: [entry], removeKeys: [] })).toBe(true);
    expect(validPropertiesDraft({ setProperties: [entry], removeKeys: ["status"] })).toBe(false);
    expect(validPropertiesDraft({ setProperties: [entry, { ...entry, name: "STATUS" }], removeKeys: [] })).toBe(false);
    for (const name of ["tags", "tag", "position", " "]) expect(validPropertiesDraft({ setProperties: [{ ...entry, name }], removeKeys: [] })).toBe(false);
    expect(validPropertiesDraft({ setProperties: [{ name: "n", type: "number", value: Infinity }], removeKeys: [] })).toBe(false);
    expect(validPropertiesDraft({ setProperties: [{ name: "d", type: "date", value: "" }], removeKeys: [] })).toBe(false);
  });
});
