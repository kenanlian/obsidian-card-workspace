import { describe, it, expect } from "vitest";
import { stripMarkdownToText, buildLightPreview } from "./markdown-utils";

// ---------------------------------------------------------------------------
// stripMarkdownToText
// ---------------------------------------------------------------------------
describe("stripMarkdownToText", () => {
  it("returns plain text unchanged", () => {
    expect(stripMarkdownToText("hello world")).toBe("hello world");
  });

  it("strips YAML frontmatter", () => {
    const md = "---\ntitle: Test\n---\nsome content";
    expect(stripMarkdownToText(md)).toBe("some content");
  });

  it("strips fenced code blocks", () => {
    const md = "before\n```js\nconst x = 1;\n```\nafter";
    expect(stripMarkdownToText(md)).toBe("before after");
  });

  it("strips inline code", () => {
    expect(stripMarkdownToText("use `console.log` here")).toBe("use here");
  });

  it("strips markdown images", () => {
    expect(stripMarkdownToText("text ![alt](img.png) end")).toBe("text end");
  });

  it("strips Obsidian embed images ![[file]]", () => {
    expect(stripMarkdownToText("text ![[image.png]] end")).toBe("text end");
  });

  it("replaces markdown links with link text", () => {
    expect(stripMarkdownToText("[click here](https://example.com)")).toBe("click here");
  });

  it("replaces wiki links with alias when present", () => {
    expect(stripMarkdownToText("[[Note Title|alias]]")).toBe("alias");
  });

  it("replaces wiki links with note name when no alias", () => {
    expect(stripMarkdownToText("[[Note Title]]")).toBe("Note Title");
  });

  it("strips heading markers", () => {
    expect(stripMarkdownToText("## My Heading")).toBe("My Heading");
  });

  it("strips unordered list markers", () => {
    expect(stripMarkdownToText("- item one\n* item two")).toBe("item one item two");
  });

  it("strips ordered list markers", () => {
    expect(stripMarkdownToText("1. first\n2. second")).toBe("first second");
  });

  it("strips bold/italic/strikethrough markers", () => {
    // The implementation replaces marker characters with spaces and then
    // collapses all whitespace, so the result is plain text with single spaces.
    expect(stripMarkdownToText("**bold** _italic_ ~strike~")).toBe("bold italic strike");
  });

  it("truncates at maxLength and appends ellipsis", () => {
    const long = "a".repeat(300);
    const result = stripMarkdownToText(long, 20);
    expect(result).toBe("a".repeat(20) + "...");
  });

  it("does not truncate when text is within maxLength", () => {
    const short = "hello";
    expect(stripMarkdownToText(short, 20)).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// buildLightPreview
// ---------------------------------------------------------------------------
describe("buildLightPreview", () => {
  it("returns mode=empty for blank content", () => {
    const result = buildLightPreview("");
    expect(result.mode).toBe("empty");
    expect(result.html).toBe("");
  });

  it("returns mode=empty for whitespace-only content", () => {
    const result = buildLightPreview("   \n\n  ");
    expect(result.mode).toBe("empty");
  });

  it("renders a paragraph as mode=text", () => {
    const result = buildLightPreview("Hello world");
    expect(result.mode).toBe("text");
    expect(result.html).toContain("Hello world");
    expect(result.html).toContain("<p>");
  });

  it("strips frontmatter before rendering", () => {
    const md = "---\ntitle: Test\n---\nActual content";
    const result = buildLightPreview(md);
    expect(result.html).not.toContain("title");
    expect(result.html).toContain("Actual content");
  });

  it("renders a heading with fce-preview-heading class", () => {
    const result = buildLightPreview("## Section Title");
    expect(result.html).toContain("fce-preview-heading");
    expect(result.html).toContain("Section Title");
  });

  it("renders an unordered list as <ul><li>", () => {
    const result = buildLightPreview("- item one\n- item two");
    expect(result.html).toContain("<ul>");
    expect(result.html).toContain("<li>");
    expect(result.html).toContain("item one");
  });

  it("renders an ordered list as <ol><li>", () => {
    const result = buildLightPreview("1. first\n2. second");
    expect(result.html).toContain("<ol>");
    expect(result.html).toContain("first");
  });

  it("renders a blockquote as <blockquote>", () => {
    const result = buildLightPreview("> quoted text");
    expect(result.html).toContain("<blockquote>");
    expect(result.html).toContain("quoted text");
  });

  it("returns mode=code for fenced code block at top", () => {
    const result = buildLightPreview("```js\nconst x = 1;\n```");
    expect(result.mode).toBe("code");
    expect(result.html).toContain("<pre");
    expect(result.html).toContain("const x = 1;");
  });

  it("escapes HTML special chars in code preview", () => {
    const result = buildLightPreview("```\n<script>alert('xss')</script>\n```");
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
  });

  it("skips image-only lines", () => {
    const result = buildLightPreview("![[photo.png]]\nReal content");
    expect(result.html).not.toContain("photo.png");
    expect(result.html).toContain("Real content");
  });

  it("truncates content at maxVisibleChars and appends ellipsis", () => {
    const long = "word ".repeat(100);
    const result = buildLightPreview(long, 20);
    expect(result.html).toContain("...");
  });

  it("renders inline bold as <strong>", () => {
    const result = buildLightPreview("some **bold** text");
    expect(result.html).toContain("<strong>bold</strong>");
  });

  it("renders inline em as <em>", () => {
    const result = buildLightPreview("some _italic_ text");
    expect(result.html).toContain("<em>italic</em>");
  });

  it("renders inline code as <code>", () => {
    const result = buildLightPreview("use `fn()` here");
    expect(result.html).toContain("<code>fn()</code>");
  });
});
