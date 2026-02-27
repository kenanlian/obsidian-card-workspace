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
