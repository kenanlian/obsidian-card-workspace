import { describe, expect, it } from "vitest";
import { createPreviewFingerprint, DIAGRAM_CACHE_MAX_BYTES, PREVIEW_CACHE_CAPACITY, PreviewCache } from "./preview-cache";

const fingerprint = (path: string, mtime = 1, lines = 5) =>
  createPreviewFingerprint(path, mtime, lines, 200);

describe("PreviewCache", () => {
  it("requires exact normalized fingerprints and caches empty results", () => {
    const cache = new PreviewCache();
    cache.set(fingerprint("a.md", 2, 5.4), { html: "", mode: "empty" });
    expect(cache.get(fingerprint("a.md", 2, 5))).toEqual({ html: "", mode: "empty" });
    expect(cache.get(fingerprint("a.md", 3, 5))).toBeUndefined();
    expect(cache.get(createPreviewFingerprint("a.md", 2, 5, 201))).toBeUndefined();
    expect(cache.get(createPreviewFingerprint("a.md", 2, 5, 200, "link:line-2"))).toBeUndefined();
  });

  it("retains ordinary previews and only the current query inside a single LRU entry", () => {
    const cache = new PreviewCache();
    const ordinary = createPreviewFingerprint("a.md", 2, 5, 200, "|live:2");
    const oldQuery = {...ordinary, contextKey: "search:1:needle|live:2"};
    const currentQuery = {...ordinary, contextKey: "search:2:other|live:2"};
    cache.set(ordinary, {html: "opening", mode: "text"});
    cache.set(oldQuery, {html: "old", mode: "text"});
    cache.set(currentQuery, {html: "current", mode: "text"});
    expect(cache.size).toBe(1);
    expect(cache.get(ordinary)?.html).toBe("opening");
    expect(cache.get(oldQuery)).toBeUndefined();
    expect(cache.get(currentQuery)?.html).toBe("current");
    cache.set({...currentQuery, contextKey: "search:2:other|live:3"}, {html: "changed", mode: "text"});
    expect(cache.get(ordinary)).toBeUndefined();
  });

  it("evicts exactly the least-recently-used entry above 512", () => {
    const cache = new PreviewCache();
    for (let index = 0; index < PREVIEW_CACHE_CAPACITY; index += 1) {
      cache.set(fingerprint(`${index}.md`), { html: `${index}`, mode: "text" });
    }
    cache.get(fingerprint("0.md"));
    cache.set(fingerprint("overflow.md"), { html: "new", mode: "text" });
    expect(cache.size).toBe(512);
    expect(cache.get(fingerprint("0.md"))?.html).toBe("0");
    expect(cache.get(fingerprint("1.md"))).toBeUndefined();
  });

  it("invalidates exact files and boundary-safe folder descendants", () => {
    const cache = new PreviewCache();
    for (const path of ["folder", "folder/a.md", "folder/sub/b.md", "folderish/c.md"]) {
      cache.set(fingerprint(path), { html: path, mode: "text" });
    }
    cache.invalidateExact("folder/a.md");
    expect(cache.get(fingerprint("folder/a.md"))).toBeUndefined();
    cache.invalidatePrefix("folder");
    expect(cache.get(fingerprint("folder/sub/b.md"))).toBeUndefined();
    expect(cache.get(fingerprint("folderish/c.md"))?.html).toBe("folderish/c.md");
    cache.clear();
    expect(cache.size).toBe(0);
  });
});


describe("diagram cache budgets", () => {
  it("evicts by Blob bytes in LRU order and accounts for replacement/invalidation", () => {
    const cache = new PreviewCache();
    const key = (path: string) => createPreviewFingerprint(path, 1, 1, 0, "diagram:source");
    const blob = new Blob([new Uint8Array(DIAGRAM_CACHE_MAX_BYTES / 2)]);
    const preview = { html: "", mode: "empty" as const, diagramPreview: { status: "ready" as const, blob, truncated: false } };
    cache.set(key("a.canvas"), preview); cache.set(key("b.canvas"), preview);
    expect(cache.diagramBytes).toBe(DIAGRAM_CACHE_MAX_BYTES);
    cache.get(key("a.canvas")); cache.set(key("c.canvas"), preview);
    expect(cache.get(key("b.canvas"))).toBeUndefined(); expect(cache.get(key("a.canvas"))).toBeDefined();
    cache.set(key("a.canvas"), { html: "", mode: "empty", diagramPreview: { status: "empty" } });
    expect(cache.diagramBytes).toBe(blob.size);
    cache.invalidateExact("c.canvas"); expect(cache.diagramBytes).toBe(0);
    cache.set(key("folder/a.canvas"), preview); cache.invalidatePrefix("folder"); expect(cache.diagramBytes).toBe(0);
    cache.set(key("a.canvas"), preview); cache.clear(); expect(cache.diagramBytes).toBe(0);
  });
  it("counts diagrams and Markdown against the same 512-entry bound", () => {
    const cache = new PreviewCache();
    for (let index = 0; index < 513; index++) cache.set(createPreviewFingerprint(`${index}.canvas`, 1, 1, 0, "diagram:source"),
      { html: "", mode: "empty", diagramPreview: { status: "missing" } });
    expect(cache.size).toBe(512); expect(cache.hasPath("0.canvas")).toBe(false);
  });
});
