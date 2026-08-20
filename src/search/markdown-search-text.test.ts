import { describe, expect, it } from "vitest";
import { extractMarkdownSearchText } from "./markdown-search-text";

describe("extractMarkdownSearchText", () => {
  it("keeps fenced code body text while excluding opener and closer markers", () => {
    const text = extractMarkdownSearchText("```sh\nflow report \n```");

    expect(text).toContain("flow report");
    expect(text).not.toContain("```");
    expect(text).not.toContain("sh");
  });

  it("adds a separator-expanded variant for fenced code paths and report_summary", () => {
    const text = extractMarkdownSearchText("~~~bash\n./report_summary\n~~~");

    expect(text).toContain("./report_summary");
    expect(text).toContain("report summary");
  });

  it("keeps ordinary markdown prose searchable", () => {
    const text = extractMarkdownSearchText("# Title\nSee [docs](https://example.com) and ![alt](img.png).");

    expect(text).toContain("Title");
    expect(text).toContain("See docs and");
    expect(text).not.toContain("Title Title");
  });

  it("excludes leading frontmatter values while retaining body prose and inline tags", () => {
    const text = extractMarkdownSearchText(
      "---\ntags: [secret-frontmatter-tag]\nsummary: hidden frontmatter prose\n---\nVisible body prose with #inline-tag.",
    );

    expect(text).not.toContain("secret-frontmatter-tag");
    expect(text).not.toContain("hidden frontmatter prose");
    expect(text).toContain("Visible body prose");
    expect(text).toContain("#inline-tag");
  });

  it("does not duplicate plain headings or prose", () => {
    const text = extractMarkdownSearchText("# One\nTwo");

    expect(text).toBe("One Two");
  });

  it("expands only the separator token in mixed prose", () => {
    const text = extractMarkdownSearchText("foo ./report-summary bar");

    expect(text).toContain("foo ./report-summary bar");
    expect(text).toContain("report summary");
    expect(text).not.toContain("foo report summary bar");
  });

  it("preserves unclosed fence bodies through EOF", () => {
    const text = extractMarkdownSearchText("before\n```ts\nconst value = 1;\nmore text");

    expect(text).toContain("before");
    expect(text).toContain("const value = 1;");
    expect(text).toContain("more text");
  });

  it("expands headings, lists, wiki links, and math bodies", () => {
    const text = extractMarkdownSearchText("## Heading\n- item one\n[[Note Name|alias]]\n$$x+y$$");

    expect(text).toContain("Heading");
    expect(text).toContain("item one");
    expect(text).toContain("alias");
    expect(text).toContain("x+y");
  });
});
