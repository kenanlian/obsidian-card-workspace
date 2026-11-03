import { describe, expect, it } from "vitest";
import { getUiStrings } from "../i18n";
import { mergeNavigationPropertyFacets } from "./navigation-metadata";

describe("navigation metadata identities", () => {
  it("unions vault values with scope counts and removable vanished refs, retaining typed labels", () => {
    const result = mergeNavigationPropertyFacets([{ key: "status", label: "status", valuedCount: 1, missingCount: 2, values: [
      { ref: { kind: "number", value: 1 }, label: "1", count: 1 },
      { ref: { kind: "text", value: "gone" }, label: "gone", count: 0 },
      { ref: { kind: "missing" }, label: "Unassigned", count: 2 },
    ] }], { ready: true, tags: [], properties: [{ key: "status", label: "Status", values: [{ kind: "text", value: "1" }, { kind: "boolean", value: false }] }, { key: "hidden", label: "Hidden", values: [] }] }, getUiStrings("en").property);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ label: "Status", valuedCount: 1, missingCount: 2 });
    expect(result[0]?.values).toEqual(expect.arrayContaining([
      { ref: { kind: "number", value: 1 }, label: "1 (Number)", count: 1 },
      { ref: { kind: "text", value: "1" }, label: "1 (Text)", count: 0 },
      { ref: { kind: "text", value: "gone" }, label: "gone", count: 0 },
      { ref: { kind: "missing" }, label: "Unassigned", count: 2 },
    ]));
  });
});
