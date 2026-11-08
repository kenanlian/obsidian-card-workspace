import { describe, expect, it } from "vitest";
import { getUiStrings } from "../i18n";
import type { PluginSettings } from "../settings";
import { buildBrowseFilterChips, buildBrowseFilterRemovalPatch } from "./browse-filters";
import { createFolderScope, createLinksScope } from "./scope";
import { resolveSourceCapabilities } from "./source-capabilities";

const capabilities = resolveSourceCapabilities(createFolderScope("notes", true));
const filter: PluginSettings["filter"] = {
  tags: ["work", "project/nested"],
  properties: [
    { key: "status", values: [{ kind: "text", value: "open" }, { kind: "text", value: "closed" }] },
    { key: "priority", values: [{ kind: "text", value: "1" }, { kind: "number", value: 1 }] },
  ],
};

describe("browse filter chips", () => {
  it("uses facet labels and keeps equal-looking typed values distinguishable", () => {
    const chips = buildBrowseFilterChips(filter, capabilities, [
      { key: "status", label: "Status", valuedCount: 0, missingCount: 0,
        values: [{ ref: { kind: "text", value: "open" }, label: "Open label", count: 0 }] },
    ], getUiStrings("en").property);
    expect(chips.map((chip) => chip.label)).toEqual([
      "work", "project/nested", "Status: Open label", "Status: closed", "priority: 1 (Text)", "priority: 1 (Number)",
    ]);
    expect(new Set(chips.map((chip) => chip.id)).size).toBe(chips.length);
  });

  it("removes just the chosen typed value, retaining sibling values and other keys", () => {
    expect(buildBrowseFilterRemovalPatch(filter, { kind: "property", key: "priority", ref: { kind: "number", value: 1 } }, capabilities))
      .toEqual({ filter: { properties: [filter.properties[0], { key: "priority", values: [{ kind: "text", value: "1" }] }] } });
    expect(filter.properties[1].values).toHaveLength(2);
  });

  it("drops the clause when its last value is removed and ignores repeated removal", () => {
    const single = { tags: ["keep"], properties: [{ key: "done", values: [{ kind: "boolean" as const, value: false }] }] };
    const target = { kind: "property" as const, key: "done", ref: { kind: "boolean" as const, value: false } };
    expect(buildBrowseFilterRemovalPatch(single, target, capabilities)).toEqual({ filter: { properties: [] } });
    expect(buildBrowseFilterRemovalPatch({ ...single, properties: [] }, target, capabilities)).toBeNull();
  });

  it("removes a tag without changing the other lane and ignores a stale tag", () => {
    expect(buildBrowseFilterRemovalPatch(filter, { kind: "tag", tag: "work" }, capabilities))
      .toEqual({ filter: { tags: ["project/nested"] } });
    expect(buildBrowseFilterRemovalPatch(filter, { kind: "tag", tag: "gone" }, capabilities)).toBeNull();
  });

  it("never exposes or removes dormant filters in links scopes", () => {
    const paused = resolveSourceCapabilities(createLinksScope("notes/a.md", "backlinks"));
    expect(buildBrowseFilterChips(filter, paused, [], getUiStrings("en").property)).toEqual([]);
    expect(buildBrowseFilterRemovalPatch(filter, { kind: "tag", tag: "work" }, paused)).toBeNull();
    expect(buildBrowseFilterRemovalPatch(filter, { kind: "property", key: "status", ref: { kind: "text", value: "open" } }, paused)).toBeNull();
  });
});
