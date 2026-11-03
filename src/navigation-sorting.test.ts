import { describe, expect, it } from "vitest";
import { migrateSettings } from "./settings";
import { serializeSettings } from "./services/SettingsStore";
import { mergeNavigationOrder, navigationSortingEqual, normalizeNavigationLinksOrder, normalizeNavigationSorting, orderNavigationItems, rewriteNavigationTagSorting } from "./navigation-sorting";

describe("navigation sorting persistence and identities", () => {
  it("restores old documents to name sorting and round trips independent authored lanes", () => {
    expect(migrateSettings({ schemaVersion: 2 }).navigationSorting).toEqual({ tags: {}, propertyKeys: { mode: "asc", order: [] }, propertyValues: {}, links: ["outgoing", "backlinks"] });
    const settings = migrateSettings({ navigationSorting: {
      tags: { "": { mode: "manual", order: ["work", "home"] }, work: { mode: "desc", order: [] } },
      propertyKeys: { mode: "manual", order: ["status", "priority"] },
      propertyValues: { status: { mode: "manual", order: ['["t","1"]', '["n",1]', '["b",true]'] } },
    } });
    const document = serializeSettings(settings);
    expect(document.schemaVersion).toBe(2);
    expect(document.userData.navigationSorting).toEqual(settings.navigationSorting);
    expect(migrateSettings(document)).toEqual(settings);
    document.userData.navigationSorting.propertyKeys.order.reverse();
    expect(settings.navigationSorting.propertyKeys.order).toEqual(["status", "priority"]);
  });
  it("normalizes paths, deduplicates identities, and rejects non-scalar/missing value identities", () => {
    expect(normalizeNavigationSorting({
      tags: { "#Work": { mode: "manual", order: ["#WORK/A", "work/a", "other/a", null] } },
      propertyKeys: { mode: "bad", order: [" Status ", "status", "position", 3] },
      propertyValues: { " Status ": { mode: "desc", order: ['["t","1"]', '["n",1]', '["m"]', 'bad', '["n",null]', '["b",true]'] } },
    })).toEqual({
      links: ["outgoing", "backlinks"],
      tags: { work: { mode: "manual", order: ["work/a"] } },
      propertyKeys: { mode: "asc", order: ["status"] },
      propertyValues: { status: { mode: "desc", order: ['["t","1"]', '["n",1]', '["b",true]'] } },
    });
  });
  it("sorts newly appearing names dynamically in descending mode and appends new manual identities", () => {
    const names = ["Beta", "Alpha", "Gamma"];
    const order = ["Beta", "Alpha"];
    expect(orderNavigationItems(names, { mode: "desc", order }, (name) => name, (name) => name)).toEqual(["Gamma", "Beta", "Alpha"]);
    expect(orderNavigationItems(names, { mode: "manual", order }, (name) => name, (name) => name)).toEqual(["Beta", "Alpha", "Gamma"]);
    expect(names).toEqual(["Beta", "Alpha", "Gamma"]);
  });
  it("keeps absent values in their slots when the current scope is reordered", () => {
    expect(mergeNavigationOrder(["Todo", "Doing", "Done"], ["Done", "Todo", "Archived"]))
      .toEqual(["Done", "Doing", "Todo", "Archived"]);
  });
});

describe("tag sorting mutation reconciliation", () => {
  const sorting = () => normalizeNavigationSorting({ tags: {
    "": { mode: "manual", order: ["keep", "work", "other"] },
    work: { mode: "manual", order: ["work/b", "work/a"] },
    "work/a": { mode: "desc", order: ["work/a/child"] },
    other: { mode: "manual", order: ["other/existing"] },
  } });
  it("rewrites a subtree while keeping its position and all descendant orders", () => {
    const before = sorting();
    const next = rewriteNavigationTagSorting(before, "work", "projects");
    expect(next.tags[""].order).toEqual(["keep", "projects", "other"]);
    expect(next.tags.projects.order).toEqual(["projects/b", "projects/a"]);
    expect(next.tags["projects/a"]).toEqual({ mode: "desc", order: ["projects/a/child"] });
    expect(before).toEqual(sorting());
  });
  it("moves subtree references to their new parent and appends to an authored destination order", () => {
    const next = rewriteNavigationTagSorting(sorting(), "work/a", "other/moved");
    expect(next.tags.work.order).toEqual(["work/b"]);
    expect(next.tags.other.order).toEqual(["other/existing", "other/moved"]);
    expect(next.tags["other/moved"].order).toEqual(["other/moved/child"]);
  });
  it("merges into an existing tag without losing the destination's mode or authored sibling order", () => {
    const next = rewriteNavigationTagSorting(sorting(), "work", "other");
    expect(next.tags.other).toEqual({ mode: "manual", order: ["other/existing", "other/b", "other/a"] });
    expect(next.tags[""].order).toEqual(["keep", "other"]);
    expect(sorting().tags.other.order).toEqual(["other/existing"]);
  });
  it("preserves old and new references after partial success; deletes only the exact subtree", () => {
    const partial = rewriteNavigationTagSorting(sorting(), "work", "projects", true);
    expect(partial.tags[""].order).toEqual(["keep", "work", "projects", "other"]);
    expect(partial.tags.work).toEqual(sorting().tags.work);
    expect(partial.tags.projects.order).toEqual(["projects/b", "projects/a"]);
    const removed = rewriteNavigationTagSorting(sorting(), "work", null);
    expect(Object.keys(removed.tags)).toEqual(["", "other"]);
    expect(removed.tags[""].order).toEqual(["keep", "other"]);
  });
});


describe("links ordering", () => {
  it("normalizes and deduplicates the fixed directions with outgoing first by default", () => {
    expect(normalizeNavigationLinksOrder(undefined)).toEqual(["outgoing", "backlinks"]);
    expect(normalizeNavigationLinksOrder(["backlinks", "bad", "backlinks", null])).toEqual(["backlinks", "outgoing"]);
    expect(normalizeNavigationLinksOrder(["outgoing", "backlinks", "outgoing"])).toEqual(["outgoing", "backlinks"]);
  });
  it("round trips shared user data and compares links order independently", () => {
    const before = migrateSettings({});
    const after = migrateSettings({ navigationSorting: { links: ["backlinks", "outgoing"] } });
    expect(navigationSortingEqual(before.navigationSorting, after.navigationSorting)).toBe(false);
    expect(migrateSettings(serializeSettings(after)).navigationSorting.links).toEqual(["backlinks", "outgoing"]);
  });
});
