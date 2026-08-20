import MiniSearch from "minisearch";
import { describe, expect, it } from "vitest";
import {
  getSearchDisplayTerms,
  shouldUsePrefixSearch,
  tokenizeSearchIndexText,
  tokenizeSearchQuery,
} from "./search-tokenization";

const defaultTokenize = MiniSearch.getDefault("tokenize") as (text: string) => string[];

describe("tokenizeSearchIndexText", () => {
  it("emits all Han unigrams followed by adjacent overlapping bigrams", () => {
    expect(tokenizeSearchIndexText("中文搜索")).toEqual([
      "中",
      "文",
      "搜",
      "索",
      "中文",
      "文搜",
      "搜索",
    ]);
  });

  it("retains repeated Han occurrences for term-frequency accounting", () => {
    expect(tokenizeSearchIndexText("哈哈哈")).toEqual(["哈", "哈", "哈", "哈哈", "哈哈"]);
  });

  it("handles a Han run larger than V8's typical spread-argument limit", () => {
    const codePointCount = 200_000;
    const terms = tokenizeSearchIndexText("哈".repeat(codePointCount));

    expect(terms).toHaveLength(codePointCount * 2 - 1);
    expect(terms[0]).toBe("哈");
    expect(terms[codePointCount - 1]).toBe("哈");
    expect(terms[codePointCount]).toBe("哈哈");
    expect(terms.at(-1)).toBe("哈哈");
  });

  it("iteratively appends a large mixed non-Han span for index and query paths", () => {
    const nonHanTermCount = 200_000;
    const text = `中${"a ".repeat(nonHanTermCount)}`;

    const indexTerms = tokenizeSearchIndexText(text);
    expect(indexTerms).toHaveLength(nonHanTermCount + 2);
    expect(indexTerms[0]).toBe("中");
    expect(indexTerms[1]).toBe("a");
    expect(indexTerms[nonHanTermCount]).toBe("a");
    expect(indexTerms.at(-1)).toBe("");

    const queryTerms = tokenizeSearchQuery(text);
    expect(queryTerms).toHaveLength(nonHanTermCount + 1);
    expect(queryTerms[0]).toBe("中");
    expect(queryTerms[1]).toBe("a");
    expect(queryTerms.at(-1)).toBe("a");
  });

  it.each(["中文，搜索", "中文 搜索", "中文OpenAI搜索"])(
    "does not create bigrams across punctuation, whitespace, or Latin boundaries in %j",
    (text) => {
      const terms = tokenizeSearchIndexText(text);

      expect(terms).toContain("中文");
      expect(terms).toContain("搜索");
      expect(terms).not.toContain("文搜");
    },
  );

  it("preserves supplementary-plane Han code points", () => {
    expect(tokenizeSearchIndexText("𠀀中")).toEqual(["𠀀", "中", "𠀀中"]);
  });

  it("preserves raw default output for every non-Han span in mixed text", () => {
    expect(tokenizeSearchIndexText("OpenAI中文-search")).toEqual([
      ...defaultTokenize("OpenAI"),
      "中",
      "文",
      "中文",
      ...defaultTokenize("-search"),
    ]);
  });

  it.each(["", "plain text", "-alpha-", " leading", "trailing!", "...", "😀 café"])(
    "exactly preserves raw default output for Han-free input %j",
    (text) => {
      expect(tokenizeSearchIndexText(text)).toEqual(defaultTokenize(text));
    },
  );
});

describe("tokenizeSearchQuery", () => {
  it("emits only adjacent bigrams for multi-code-point Han runs", () => {
    expect(tokenizeSearchQuery("中文搜索")).toEqual(["中文", "文搜", "搜索"]);
    expect(tokenizeSearchQuery("哈哈哈")).toEqual(["哈哈", "哈哈"]);
  });

  it("keeps an isolated Han code point", () => {
    expect(tokenizeSearchQuery("文")).toEqual(["文"]);
  });

  it("respects punctuation boundaries and supplementary Han code points", () => {
    expect(tokenizeSearchQuery("中文，搜索")).toEqual(["中文", "搜索"]);
    expect(tokenizeSearchQuery("𠀀中")).toEqual(["𠀀中"]);
  });

  it("combines mixed-script terms while filtering unusable default tokens", () => {
    expect(tokenizeSearchQuery("OpenAI中文-search")).toEqual(["OpenAI", "中文", "search"]);
    expect(tokenizeSearchQuery(" - ... \n")).toEqual([]);
    expect(tokenizeSearchQuery("")).toEqual([]);
  });

  it.each(["�", "😀", "e\u0301", "\uD800"])(
    "tolerates replacement, emoji, combining, and malformed input %j",
    (text) => {
      expect(() => tokenizeSearchQuery(text)).not.toThrow();
      expect(tokenizeSearchQuery(text)).toEqual(defaultTokenize(text).filter(Boolean));
      expect(() => tokenizeSearchIndexText(text)).not.toThrow();
      expect(() => getSearchDisplayTerms(text)).not.toThrow();
      expect(() => shouldUsePrefixSearch(text)).not.toThrow();
    },
  );
});

describe("getSearchDisplayTerms", () => {
  it("keeps full Han runs as literal display terms", () => {
    expect(getSearchDisplayTerms("中文搜索")).toEqual(["中文搜索"]);
    expect(getSearchDisplayTerms("OpenAI中文-search")).toEqual(["openai", "中文", "search"]);
  });

  it("deduplicates lowercase terms in first-seen order", () => {
    expect(getSearchDisplayTerms("中文 OpenAI中文-search OPENAI 中文")).toEqual([
      "中文",
      "openai",
      "search",
    ]);
  });

  it("preserves pure non-Han whitespace-delimited literal behavior", () => {
    expect(getSearchDisplayTerms("-")).toEqual(["-"]);
    expect(getSearchDisplayTerms(" Foo-Bar  BAZ! foo-bar ")).toEqual(["foo-bar", "baz!"]);
    expect(getSearchDisplayTerms(" \t\n ")).toEqual([]);
  });

  it("splits Han-containing tokens at Han, non-Han, and punctuation boundaries", () => {
    expect(getSearchDisplayTerms("alpha-中文，搜索_beta")).toEqual([
      "alpha",
      "中文",
      "搜索",
      "beta",
    ]);
  });
});

describe("shouldUsePrefixSearch", () => {
  it.each(["文", "中文", "𠀀中"])("disables prefix matching for all-Han term %j", (term) => {
    expect(shouldUsePrefixSearch(term)).toBe(false);
  });

  it.each(["", "openai", "123", "中文a", "😀", "-"])(
    "enables prefix matching for non-Han or empty term %j",
    (term) => {
      expect(shouldUsePrefixSearch(term)).toBe(true);
    },
  );
});
