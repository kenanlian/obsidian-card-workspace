import { describe, expect, it } from "vitest";
import { iterateSearchIndexTerms, tokenizeSearchIndexText } from "../search-tokenization";
import { runSearchTask } from "./cooperative-task";
import { SEARCH_MARKDOWN_MAX_LENGTH } from "./document-preparation";
import { mapMarkdownSearchText } from "./mapped-search-text";
import { extractMarkdownSearchText } from "./markdown-search-text";
import { createSearchPreviewMatcher, extractSearchPreviewSnippets, resolveSearchSnippetLocation } from "./search-preview";

async function extract(markdown: string, query: string, limit = 5) {
  return (await extractSearchPreviewSnippets(markdown, { limit, idPrefix: "test", matcher: createSearchPreviewMatcher(query) }))!;
}

describe("source-mapped search previews", () => {
  it.each([1, 2, 3, 4, 5])("collects up to %i independent hit snippets", async (limit) => {
    const source = Array.from({ length: 12 }, (_, index) => `line ${index} needle needle`).join("\n\n");
    const snippets = await extract(source, "needle", limit);
    expect(snippets).toHaveLength(limit);
    expect(snippets.map((snippet) => snippet.location.from.line)).toEqual(Array.from({ length: limit }, (_, i) => i * 2));
    expect(snippets[0].highlights).toHaveLength(2);
    expect(snippets[0].location.text).toBe("needle");
  });

  it("fills short lines with readable consecutive prose, merges overlapping contexts, and continues to independent hits", async () => {
    const source = "# first needle\ncontinuation **other** [[target|alias]]\nsecond needle `code_text`\n\nindependent final needle\n# next heading\nignored text";
    const snippets = await extract(source, "needle other", 2);
    expect(snippets).toHaveLength(2);
    expect(snippets[0].text).toBe("first needle continuation other alias second needle code_text");
    expect(snippets[0].highlights.map(r => snippets[0].text.slice(r.start, r.end))).toEqual(["needle", "other", "needle"]);
    expect(snippets[1].text).toBe("independent final needle");
    const [code] = await extract("needle `x+y` `中文代码`", "needle");
    expect(code.text).toBe("needle x+y 中文代码");
    expect(snippets.map(s => s.location.from.line)).toEqual([0, 4]);
  });

  it("merges overlapping long-line contexts by reducing the prefix and then finds later independent hits", async () => {
    const source = "prefix ".repeat(15) + "needle " + "padding ".repeat(20) + "other" + " tail ".repeat(100) + "needle";
    const snippets = await extract(source, "needle other", 2);
    expect(snippets).toHaveLength(2);
    expect(snippets[0].text).toContain("other");
    expect(snippets[0].highlights.map(range => snippets[0].text.slice(range.start, range.end))).toEqual(["needle", "other"]);
    expect(snippets[0].location.offset).toBe(source.indexOf("needle"));
    expect(snippets[1].location.offset).toBe(source.lastIndexOf("needle"));
    expect(snippets.every(snippet => snippet.text.length <= 200)).toBe(true);
  });

  it.each(["", "# heading", "- list item", "1. item", "> quote", "```js", "~~~"])("stops continuation at a structural boundary: %s", async (boundary) => {
    const [snippet] = await extract(`short needle\n${boundary}\nfollowing prose`, "needle");
    expect(snippet.text).toBe("short needle");
  });

  it("does not split surrogate pairs when cropping and selects the merged Chinese highlight", async () => {
    const source = "𠮷".repeat(100) + " 中文文档 " + "😀".repeat(150);
    const [snippet] = await extract(source, "中文文档");
    expect(snippet.location.text).toBe("中文文档");
    expect(snippet.text.length).toBeLessThanOrEqual(200);
    expect(snippet.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]…$/);
    expect(await resolveSearchSnippetLocation(source, snippet.location)).toEqual({from: snippet.location.from, to: snippet.location.to});
  });

  it("keeps normalization and exact index term order unchanged", async () => {
    const samples = [
      "---\r\nsecret: hidden\r\n---\r\n# 中文标题\r\n- 文本 *bold* [label](url) [[label|label]] [[dest#head|a|b]] ![[hidden]] ![hidden](url)",
      "## One\n1. Two\n$$x+y$$ $z$ \\(math\\) \\[math2\\] `code_text` `x+y`",
      "before\n````ts\n\nfoo_bar ./path-file [[literal|literal]]\r\n```\nend\n````\nafter",
      "~~~js\n中文代码 flow_report\n\nlast", "\r\n", "----odd--- text", "中文English中文.Example",
      "plain ordinary prose\n1. numbered item\n  + list\n  - list\nstandalone + and - and !\nwith\ttabs\u00a0and  spaces\nplain/file-name",
    ];
    for (const source of samples) {
      const mapped = (await runSearchTask(mapMarkdownSearchText(source)))!;
      expect(mapped.text).toBe(extractMarkdownSearchText(source));
      expect(mapped.offsets).toHaveLength(mapped.text.length);
      for (let i = 0; i < mapped.text.length; i += 1) {
        if (mapped.offsets[i] >= 0 && !/\s/.test(mapped.text[i])) expect(source[mapped.offsets[i]]).toBe(mapped.text[i]);
      }
      expect([...iterateSearchIndexTerms(mapped.text)].filter((term) => term !== undefined).map((term) => term.text))
        .toEqual(tokenizeSearchIndexText(mapped.text));
    }
  });

  it("maps aliases, math, ASCII inline code, and fenced separators to their real source", async () => {
    const source = "---\r\nsummary: needle\r\n---\r\n[[needle|other needle]]\r\n[needle](https://needle)\r\n```js\r\nfoo_needle-bar\r\n```\r\n`needle` $$needle$$ ![needle](url)";
    const snippets = await extract(source, "need");
    expect(snippets.map((entry) => entry.location.from.line)).toEqual([3, 6, 8]);
    expect(snippets[0].location.from.ch).toBe(15);
    expect(snippets[0].text).toBe("other needle needle");
    expect(snippets[1].location.from.ch).toBe(4);
    expect(snippets[1].text).toBe("foo_needle-bar");
    for (const { location } of snippets) {
      expect(source.slice(location.offset, location.offset + location.text.length)).toBe(location.text);
      expect(location.text).toBe("need");
    }
    expect(await extract("---\nsummary: needle\n---\n![needle](url) ![[needle]] `x+needle`", "needle")).toEqual([]);
  });

  it("preserves global replacement behavior for nested and malformed markup", async () => {
    let seed = 42;
    const tokens = ["[[", "![", "![[", "[", "]", "]]", "](", ")", "|", "#", "alias", "word", "\\(", "\\)", "\\[", "\\]", "\r", " "];
    for (let sample = 0; sample < 150; sample += 1) {
      let source = "";
      for (let index = 0; index < 40; index += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        source += tokens[seed % tokens.length];
      }
      expect((await runSearchTask(mapMarkdownSearchText(source)))!.text).toBe(extractMarkdownSearchText(source));
    }
    const malformed = "[".repeat(480_000) + "#|alias]] needle";
    const [snippet] = await extract(malformed, "needle");
    expect(snippet.location.offset).toBe(malformed.indexOf("needle"));
    expect(snippet.text).toContain("needle");
  });

  it("matches prefixes and Chinese overlapping terms; document AND does not become line AND", async () => {
    expect((await extract("application\n\ncapital application\n\nAPPROACH", "app other")).map((entry) => entry.location.from.ch)).toEqual([0, 8, 0]);
    expect(await extract("capital", "app")).toEqual([]);
    const han = await extract("中文文档\n\n文档中文", "中文文档");
    expect(han[0].highlights).toEqual([{ start: 0, end: 4 }]);
    expect(han[0].location.text).toBe("中文文档");
    expect(await extract("中 文", "中文")).toEqual([]);
  });

  it("crops long lines around the first hit, including an EOF hit", async () => {
    const source = "longword".repeat(30_000) + " needle";
    const [snippet] = await extract(source, "needle");
    expect(snippet.text.startsWith("…")).toBe(true);
    expect(snippet.text.length).toBeLessThanOrEqual(200);
    expect(snippet.text.slice(snippet.highlights[0].start, snippet.highlights[0].end)).toBe("needle");
    expect(snippet.location.from.ch).toBe(240_001);
  });

  it("honors the markdown truncation and 50,000-term budgets, including Han prefix rules", async () => {
    expect(await extract("z".repeat(SEARCH_MARKDOWN_MAX_LENGTH) + " needle", "needle")).toEqual([]);
    expect(await extract("word ".repeat(50_000) + "needle", "needle")).toEqual([]);
    expect((await extract("word ".repeat(49_999) + "needle", "needle"))[0].location.text).toBe("needle");
    for (const text of ["中".repeat(30_000), "word ".repeat(49_999) + "中文 z", "word ".repeat(49_998) + "中文 z", " ", "", ".a 中文 z."]) {
      expect([...iterateSearchIndexTerms(text)].filter((term) => term !== undefined).map((term) => term.text)).toEqual(tokenizeSearchIndexText(text));
    }
  });

  it("drops a task invalidated during a cooperative yield", async () => {
    let current = true;
    let yields = 0;
    setTimeout(() => { current = false; }, 0);
    const result = await extractSearchPreviewSnippets("long_word ".repeat(50_000), {
      limit: 5, idPrefix: "cancel", matcher: createSearchPreviewMatcher("long"), isCurrent: () => current,
      onDiagnostics: (diagnostics) => { yields = diagnostics.yields; },
    });
    expect(result).toBeUndefined();
    expect(yields).toBeGreaterThan(0);
  });
});

describe("snippet position validation", () => {
  it("selects the exact source hit and relocates it after lines are inserted", async () => {
    const source = "intro\r\nunique context needle ending\r\nlast";
    const [{ location }] = await extract(source, "needle");
    expect(await resolveSearchSnippetLocation(source, location)).toEqual({ from: { line: 1, ch: 15 }, to: { line: 1, ch: 21 } });
    expect(await resolveSearchSnippetLocation("inserted\n" + source, location)).toEqual({ from: { line: 2, ch: 15 }, to: { line: 2, ch: 21 } });
    expect(await resolveSearchSnippetLocation(source.replace("needle", "removed"), location)).toBeNull();
  });

  it("rejects ambiguous relocated contexts instead of choosing a same-named hit", async () => {
    const source = "context needle ending";
    const [{ location }] = await extract(source, "needle");
    expect(await resolveSearchSnippetLocation("prefix\n" + source + "\n" + source, location)).toBeNull();
    expect(await resolveSearchSnippetLocation(source, location, () => false)).toBeUndefined();
  });
});
