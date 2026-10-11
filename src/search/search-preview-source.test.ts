import { describe, expect, it } from "vitest";
import { runSearchTask } from "./cooperative-task";
import { SEARCH_MARKDOWN_MAX_LENGTH } from "./document-preparation";
import { createSearchPreviewMatcher, extractSearchPreviewSnippets } from "./search-preview";
import { prepareSearchPreviewSource, SearchPreviewSourceCache } from "./search-preview-source";

describe("prepared search preview sources", () => {
  it("bounds oversized source retention without changing UTF-16 at the truncation boundary", async () => {
    const markdown = "z".repeat(SEARCH_MARKDOWN_MAX_LENGTH - 1) + "😀" + "outside needle";
    const prepared = (await runSearchTask(prepareSearchPreviewSource(markdown)))!;
    expect(prepared.source).toBe(markdown.slice(0, SEARCH_MARKDOWN_MAX_LENGTH));
    expect(prepared.source).toHaveLength(SEARCH_MARKDOWN_MAX_LENGTH);
    expect(prepared.source.charCodeAt(prepared.source.length - 1)).toBe(0xd83d);
  });

  it("reuses mapping and token positions across queries without changing snippets or source locations", async () => {
    const markdown = "---\nsecret: hidden\n---\n# 中文文档 APPROACH\n\n- [ ] application [[dest|alias]] `flow_report`\n\n```ts\nother_needle-bar\n中文文档\n```";
    const prepared = (await runSearchTask(prepareSearchPreviewSource(markdown)))!;
    for (const query of ["app", "APPROACH", "中文文档", "alias", "flow", "need", "hidden"]) {
      const options = { limit: 5, idPrefix: "reuse", matcher: createSearchPreviewMatcher(query) };
      expect(await extractSearchPreviewSnippets(prepared, options)).toEqual(await extractSearchPreviewSnippets(markdown, options));
    }
  });

  it("bounds retention by estimated bytes and refreshes LRU order on a hit", async () => {
    const prepared = (await runSearchTask(prepareSearchPreviewSource("needle")))!;
    const cache = new SearchPreviewSourceCache(prepared.estimatedBytes * 2, 64);
    cache.set("a.md", "v1", prepared);
    cache.set("b.md", "v1", prepared);
    expect(cache.get("a.md", "v1")).toBe(prepared);
    cache.set("c.md", "v1", prepared);
    expect(cache.get("b.md", "v1")).toBeUndefined();
    expect(cache.get("a.md", "v1")).toBe(prepared);
    expect(cache.get("c.md", "v1")).toBe(prepared);
    cache.set("oversized.md", "v1", { ...prepared, estimatedBytes: prepared.estimatedBytes * 3 });
    expect(cache.get("oversized.md", "v1")).toBeUndefined();
    expect(cache.get("a.md", "v1")).toBe(prepared);
  });

  it("limits file count and invalidates changed versions, exact paths, and folder prefixes", async () => {
    const prepared = (await runSearchTask(prepareSearchPreviewSource("needle")))!;
    const cache = new SearchPreviewSourceCache(Infinity, 2);
    cache.set("old.md", "v1", prepared);
    cache.set("folder/a.md", "v1", prepared);
    cache.set("folder-other/b.md", "v1", prepared);
    expect(cache.get("old.md", "v1")).toBeUndefined();
    cache.invalidatePrefix("folder");
    expect(cache.get("folder/a.md", "v1")).toBeUndefined();
    expect(cache.get("folder-other/b.md", "v1")).toBe(prepared);
    expect(cache.get("folder-other/b.md", "v2")).toBeUndefined();
    expect(cache.get("folder-other/b.md", "v1")).toBeUndefined();
    cache.set("a.md", "v1", prepared);
    cache.invalidateExact("a.md");
    expect(cache.get("a.md", "v1")).toBeUndefined();
    cache.set("a.md", "v1", prepared);
    cache.clear();
    expect(cache.get("a.md", "v1")).toBeUndefined();
  });
});
