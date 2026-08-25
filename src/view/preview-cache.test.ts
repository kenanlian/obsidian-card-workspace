import { describe, expect, it } from "vitest";
import { createPreviewFingerprint, PREVIEW_CACHE_CAPACITY, PreviewCache } from "./preview-cache";

const fingerprint = (path: string, mtime = 1, lines = 5) =>
  createPreviewFingerprint(path, mtime, lines, 200);

describe("PreviewCache", () => {
  it("requires exact normalized fingerprints and caches empty results", () => {
    const cache = new PreviewCache();
    cache.set(fingerprint("a.md", 2, 5.4), { html: "", mode: "empty" });
    expect(cache.get(fingerprint("a.md", 2, 5))).toEqual({ html: "", mode: "empty" });
    expect(cache.get(fingerprint("a.md", 3, 5))).toBeUndefined();
    expect(cache.get(createPreviewFingerprint("a.md", 2, 5, 201))).toBeUndefined();
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
