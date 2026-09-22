import { describe, expect, it } from "vitest";

import { SearchDocumentCatalog } from "./document-catalog";

function catalogOf(entries: Record<string, number>): SearchDocumentCatalog {
  const catalog = new SearchDocumentCatalog();
  catalog.loadFrom(entries);
  return catalog;
}

describe("SearchDocumentCatalog", () => {
  it("matches a snapshot with identical entries regardless of insertion order", () => {
    const catalog = new SearchDocumentCatalog();
    catalog.set("notes/b.md", 20);
    catalog.set("notes/a.md", 10);

    expect(catalog.matches({ "notes/a.md": 10, "notes/b.md": 20 })).toBe(true);
  });

  it("does not match when an mtime differs", () => {
    const catalog = catalogOf({ "notes/a.md": 10, "notes/b.md": 20 });

    expect(catalog.matches({ "notes/a.md": 10, "notes/b.md": 21 })).toBe(false);
  });

  it("does not match when the snapshot carries an extra path", () => {
    const catalog = catalogOf({ "notes/a.md": 10 });

    expect(catalog.matches({ "notes/a.md": 10, "notes/new.md": 30 })).toBe(false);
  });

  it("does not match when the snapshot is missing a catalogued path", () => {
    const catalog = catalogOf({ "notes/a.md": 10, "notes/b.md": 20 });

    expect(catalog.matches({ "notes/a.md": 10 })).toBe(false);
  });

  it("treats two empty sides as equal", () => {
    expect(new SearchDocumentCatalog().matches({})).toBe(true);
  });

  it("moves an entry on rename and leaves the old key absent", () => {
    const catalog = catalogOf({ "notes/old.md": 10, "notes/other.md": 20 });

    catalog.rename("notes/old.md", "notes/new.md");

    expect(catalog.toSerializable()).toEqual({ "notes/new.md": 10, "notes/other.md": 20 });
    expect(catalog.size).toBe(2);
  });

  it("ignores a rename of a path it does not hold", () => {
    const catalog = catalogOf({ "notes/a.md": 10 });

    catalog.rename("notes/missing.md", "notes/new.md");

    expect(catalog.toSerializable()).toEqual({ "notes/a.md": 10 });
  });

  it("round-trips through loadFrom and toSerializable", () => {
    const original = { "notes/a.md": 10, "notes/nested/b.md": 20 };
    const catalog = new SearchDocumentCatalog();

    catalog.loadFrom(original);
    const serialized = catalog.toSerializable();

    expect(serialized).toEqual(original);
    expect(serialized).not.toBe(original);
    expect(catalogOf(serialized).matches(original)).toBe(true);
  });

  it("drops prior entries on loadFrom and replaceAll", () => {
    const catalog = catalogOf({ "notes/stale.md": 1 });

    catalog.loadFrom({ "notes/a.md": 10 });
    expect(catalog.toSerializable()).toEqual({ "notes/a.md": 10 });

    catalog.replaceAll([["notes/b.md", 20], ["notes/c.md", 30]]);
    expect(catalog.toSerializable()).toEqual({ "notes/b.md": 20, "notes/c.md": 30 });
    expect(catalog.size).toBe(2);
  });

  it("removes entries on delete and clear", () => {
    const catalog = catalogOf({ "notes/a.md": 10, "notes/b.md": 20 });

    catalog.delete("notes/a.md");
    expect(catalog.toSerializable()).toEqual({ "notes/b.md": 20 });

    catalog.clear();
    expect(catalog.size).toBe(0);
    expect(catalog.toSerializable()).toEqual({});
  });
});
