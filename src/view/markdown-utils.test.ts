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
  it("strips task list markers", () => {
    expect(stripMarkdownToText("- [ ] first\n- [x] second")).toBe("first second");
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

  it("renders unordered lists as normalized summary lines", () => {
    const result = buildLightPreview("- item one\n- item two");
    expect(result.mode).toBe("text");
    expect(result.html).toBe("<p>item one</p><p>item two</p>");
    expect(result.html).not.toContain("<ul>");
    expect(result.html).not.toContain("<li>");
  });

  it("renders ordered lists as normalized summary lines", () => {
    const result = buildLightPreview("1. first\n2. second");
    expect(result.mode).toBe("text");
    expect(result.html).toBe("<p>first</p><p>second</p>");
    expect(result.html).not.toContain("<ol>");
    expect(result.html).not.toContain("<li>");
  });
  it("renders task lists as normalized summary lines", () => {
    const result = buildLightPreview("- [ ] first task\n- [x] done task");
    expect(result.mode).toBe("text");
    expect(result.html).toBe("<p>first task</p><p>done task</p>");
    expect(result.html).not.toContain("[ ]");
    expect(result.html).not.toContain("[x]");
  });


  it("renders quotes with only a weak body-text cue", () => {
    const result = buildLightPreview("> quoted text");
    expect(result.mode).toBe("text");
    expect(result.html).toBe("<p>quoted text</p>");
    expect(result.html).not.toContain("<blockquote>");
    expect(result.html).not.toContain("> quoted text");
  });

  it("keeps code-only previews in code mode when the note starts with a fenced block", () => {
    const result = buildLightPreview("```js\nconst x = 1;\n```");
    expect(result.mode).toBe("code");
    expect(result.html).toContain('<p class="fce-preview-code">');
    expect(result.html).not.toContain("<pre");
    expect(result.html).toContain("const x = 1;");
  });

  it("escapes HTML special chars in code preview", () => {
    const result = buildLightPreview("```\n<script>alert('xss')</script>\n```");
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
  });
  it("keeps later text after a leading fenced code block when preview budget remains", () => {
    const result = buildLightPreview("```ts\nconst x = 1;\n```\nAfter code should still preview.", 500, 5);
    expect(result.mode).toBe("text");
    expect(result.html).toBe(
      '<p class="fce-preview-code"><code>const x = 1;</code></p><p>After code should still preview.</p>',
    );
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

  it("renders inline bold as plain text", () => {
    const result = buildLightPreview("some **bold** text");
    expect(result.html).toContain("some bold text");
    expect(result.html).not.toContain("<strong>");
    expect(result.html).not.toContain("**");
  });

  it("renders inline em as plain text", () => {
    const result = buildLightPreview("some _italic_ text");
    expect(result.html).toContain("some italic text");
    expect(result.html).not.toContain("<em>");
    expect(result.html).not.toContain("_");
  });

  it("renders inline code as <code>", () => {
    const result = buildLightPreview("use `fn()` here");
    expect(result.html).toContain("<code>fn()</code>");
  });
  it("keeps later paragraphs after inline code in an earlier paragraph", () => {
    const result = buildLightPreview("Use `fn()` here.\n\nAfter inline code should still preview.", 500, 5);
    expect(result.mode).toBe("text");
    expect(result.html).toBe("<p>Use <code>fn()</code> here.</p><p>After inline code should still preview.</p>");
  });


  it("keeps sparse one-line content as standard text preview", () => {
    const result = buildLightPreview("Only one truthful line.");
    expect(result.mode).toBe("text");
    expect(result.html).toBe("<p>Only one truthful line.</p>");
  });

  it("keeps sparse two-line content as standard text preview", () => {
    const result = buildLightPreview("First truthful line.\nSecond truthful line.");
    expect(result.mode).toBe("text");
    expect(result.html).toBe("<p>First truthful line. Second truthful line.</p>");
  });

  it("treats image-only note as explicit empty", () => {
    const result = buildLightPreview("![[photo.png]]\n![alt](img.png)");
    expect(result.mode).toBe("empty");
    expect(result.html).toBe("");
  });

  it("treats embed-only note as explicit empty", () => {
    const result = buildLightPreview("![[diagram.excalidraw]]\n![[audio.mp3]]");
    expect(result.mode).toBe("empty");
    expect(result.html).toBe("");
  });

  it("renders later body text after frontmatter, not empty", () => {
    const md = "---\ntitle: Sample\ntags:\n  - note\n---\n\nAfter metadata this content must preview.";
    const result = buildLightPreview(md);
    expect(result.mode).toBe("text");
    expect(result.html).toBe("<p>After metadata this content must preview.</p>");
  });

  it("applies the same previewLines budget policy to text content", () => {
    const md = "line one\nline two\nline three\nline four\nline five";
    const result = buildLightPreview(md, 500, 3);

    expect(result.mode).toBe("text");
    expect(result.html).toContain("line one");
    expect(result.html).toContain("line two");
    expect(result.html).toContain("line three");
    expect(result.html).not.toContain("line four");
    expect(result.html).not.toContain("line five");
  });

  it("applies the same previewLines budget policy to code content", () => {
    const md = "```ts\nline one\nline two\nline three\nline four\nline five\n```";
    const result = buildLightPreview(md, 500, 3);

    expect(result.mode).toBe("code");
    expect(result.html).toContain("line one");
    expect(result.html).toContain("line two");
    expect(result.html).toContain("line three");
    expect(result.html).not.toContain("line four");
    expect(result.html).not.toContain("line five");
  });

  it("keeps multi-block text previews in a margin-free summary shape", () => {
    const result = buildLightPreview("First block\n- Second block\n> Third block", 500, 3);

    expect(result.mode).toBe("text");
    expect(result.html).toBe("<p>First block</p><p>Second block</p><p>Third block</p>");
  });

  it("renders code previews in the same paragraph-shaped clamp surface", () => {
    const result = buildLightPreview("```ts\nconst one = 1;\nconst two = 2;\n```", 500, 2);

    expect(result.mode).toBe("code");
    expect(result.html).toContain('<p class="fce-preview-code">');
    expect(result.html).toContain("<code>");
    expect(result.html).not.toContain("<pre");
  });

  it("preserves source order across text and multiple fenced code blocks within previewLines", () => {
    const result = buildLightPreview(
      [
        "1. First item",
        "```ts",
        "const one = 1;",
        "```",
        "2. Second item",
        "```ts",
        "const two = 2;",
        "```",
      ].join("\n"),
      500,
      4,
    );

    expect(result.mode).toBe("text");
    expect(result.html).toBe([
      "<p>First item</p>",
      '<p class="fce-preview-code"><code>const one = 1;</code></p>',
      "<p>Second item</p>",
      '<p class="fce-preview-code"><code>const two = 2;</code></p>',
    ].join(""));
  });

  it("stops mixed text and multiple fenced code blocks at the shared previewLines budget", () => {
    const result = buildLightPreview(
      [
        "1. First item",
        "```ts",
        "const one = 1;",
        "```",
        "2. Second item",
        "```ts",
        "const two = 2;",
        "```",
      ].join("\n"),
      500,
      3,
    );

    expect(result.mode).toBe("text");
    expect(result.html).toBe([
      "<p>First item</p>",
      '<p class="fce-preview-code"><code>const one = 1;</code></p>',
      "<p>Second item</p>",
    ].join(""));
    expect(result.html).not.toContain("const two = 2;");
  });

  it("normalizes weak-cue inline markers without leaking raw delimiters", () => {
    const result = buildLightPreview("**Bold** _Italic_ ~~Strike~~ ==Highlight== `Code` plain");

    expect(result.mode).toBe("text");
    expect(result.html).toContain("Bold");
    expect(result.html).toContain("Italic");
    expect(result.html).toContain("Strike");
    expect(result.html).toContain("Highlight");
    expect(result.html).toContain("Code");
    expect(result.html).toContain("plain");

    expect(result.html).not.toContain("**");
    expect(result.html).not.toContain("_");
    expect(result.html).not.toContain("<strong>");
    expect(result.html).not.toContain("<em>");
    expect(result.html).not.toContain("~~");
    expect(result.html).not.toContain("==");
    expect(result.html).not.toContain("`");
  });

  it("normalizes inline math delimiters while keeping math text", () => {
    const result = buildLightPreview("Energy is $E=mc^2$ and block $$a^2+b^2=c^2$$ math.");

    expect(result.mode).toBe("text");
    expect(result.html).toContain("E=mc^2");
    expect(result.html).toContain("a^2+b^2=c^2");
    expect(result.html).not.toContain("$");
    expect(result.html).not.toContain("\\(");
    expect(result.html).not.toContain("\\)");
    expect(result.html).not.toContain("\\[");
    expect(result.html).not.toContain("\\]");
  });

  it("does not leak inline marker delimiters in stripped summary text", () => {
    const text = stripMarkdownToText("**Bold** _Italic_ ~~Strike~~ ==Highlight== `Code` $Math$");
    expect(text).toContain("Bold");
    expect(text).toContain("Italic");
    expect(text).toContain("Strike");
    expect(text).toContain("Highlight");
    expect(text).toContain("Code");
    expect(text).toContain("Math");
    expect(text).not.toContain("**");
    expect(text).not.toContain("_");
    expect(text).not.toContain("~~");
    expect(text).not.toContain("==");
    expect(text).not.toContain("`");
    expect(text).not.toContain("$");
  });
});
