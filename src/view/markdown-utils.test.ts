import { describe, it, expect } from "vitest";
import { buildLightPreview } from "./markdown-utils";
import type { PreviewTextSource } from "./preview-source-collector";

// stripMarkdownToText moved to src/markdown-plain-text.ts; its behavior is
// covered by src/markdown-plain-text.test.ts.

// ---------------------------------------------------------------------------
// buildLightPreview
// ---------------------------------------------------------------------------
describe("buildLightPreview", () => {
  it.each([0, 1, 2])("respects a %i-line budget for text and code previews", (previewLines) => {
    for (const markdown of ["first\nsecond\nthird", "```\nfirst\nsecond\nthird\n```"]) {
      const result = buildLightPreview(markdown, 500, previewLines);
      if (previewLines === 0) {
        expect(result).toEqual({ html: "", mode: "empty" });
      } else {
        expect(result.html).toContain("first");
        expect(result.html.includes("second")).toBe(previewLines === 2);
        expect(result.html).not.toContain("third");
      }
    }
  });

  it("returns mode=empty for blank content", () => {
    const result = buildLightPreview("");
    expect(result.mode).toBe("empty");
    expect(result.html).toBe("");
  });

  it("returns mode=empty for whitespace-only content", () => {
    const result = buildLightPreview("   \n\t");
    expect(result.mode).toBe("empty");
    expect(result.html).toBe("");
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

  it("preserves CRLF preview output", () => {
    expect(buildLightPreview("---\r\ntitle: Test\r\n---\r\nFirst\r\nSecond", 500, 2)).toEqual(
      buildLightPreview("---\ntitle: Test\n---\nFirst\nSecond", 500, 2),
    );
  });

  it("recognizes frontmatter closed exactly on line 400", () => {
    const markdown = [
      "---",
      ...Array.from({ length: 398 }, (_, index) => `field-${index}: value`),
      "---",
      "Visible body",
    ].join("\n");

    expect(buildLightPreview(markdown).html).toBe("<p>Visible body</p>");
  });

  it("ignores body content after the 400-line scan window", () => {
    const markdown = [
      ...Array.from({ length: 400 }, (_, index) => `body-${index}`),
      "unique forbidden tail sentinel",
    ].join("\n");
    const result = buildLightPreview(markdown, 50_000, 400);

    expect(result.html).not.toContain("unique forbidden tail sentinel");
  });

  it("treats frontmatter closed after line 400 as body", () => {
    const markdown = ["---", ...Array.from({ length: 399 }, (_, index) => `field-${index}`), "---", "tail sentinel"].join("\n");
    const result = buildLightPreview(markdown, 500, 5);

    expect(result.html).toContain("---");
    expect(result.html).toContain("field-0");
    expect(result.html).not.toContain("tail sentinel");
  });

  it("treats unclosed leading frontmatter as body", () => {
    const result = buildLightPreview("---\ntitle: Unclosed\nBody text");

    expect(result.html).toContain("--- title: Unclosed Body text");
  });

  it("treats a non-leading delimiter as body", () => {
    const result = buildLightPreview("Before\n---\ntitle: Body\n---\nAfter", 500, 5);

    expect(result.html).toContain("Before --- title: Body --- After");
  });

  it("never reads a guarded tail through normalization before collection", () => {
    const prefix = `${Array.from({ length: 400 }, (_, index) => `line-${index}`).join("\n")}\n`;
    const raw = `${prefix}${"forbidden-tail".repeat(100_000)}`;
    const source: PreviewTextSource = {
      length: raw.length,
      readCodeUnit(index) {
        if (index >= prefix.length) {
          throw new Error("forbidden tail access");
        }
        return raw[index] ?? "";
      },
    };

    const result = buildLightPreview(source, 500, 5);

    expect(result.html).toContain("line-0");
    expect(result.html).not.toContain("forbidden-tail");
  });

  it("renders a heading with fce-preview-heading class", () => {
    const result = buildLightPreview("## Section Title");
    expect(result.html).toContain("fce-preview-heading");
    expect(result.html).toContain("Section Title");
  });

  it("renders unordered markers in flat preview rows", () => {
    const result = buildLightPreview("- item one\n* item two\n+ item three");
    expect(result.mode).toBe("text");
    expect(result.html).toBe([
      '<p class="fce-preview-list-item"><span class="fce-preview-list-marker">•</span><span class="fce-preview-list-content">item one</span></p>',
      '<p class="fce-preview-list-item"><span class="fce-preview-list-marker">•</span><span class="fce-preview-list-content">item two</span></p>',
      '<p class="fce-preview-list-item"><span class="fce-preview-list-marker">•</span><span class="fce-preview-list-content">item three</span></p>',
    ].join(""));
    expect(result.html).not.toContain("<ul>");
    expect(result.html).not.toContain("<li>");
  });

  it("preserves ordered numbers and source delimiters", () => {
    const result = buildLightPreview("1. first\n07) second");
    expect(result.mode).toBe("text");
    expect(result.html).toBe([
      '<p class="fce-preview-list-item"><span class="fce-preview-list-marker">1.</span><span class="fce-preview-list-content">first</span></p>',
      '<p class="fce-preview-list-item"><span class="fce-preview-list-marker">07)</span><span class="fce-preview-list-content">second</span></p>',
    ].join(""));
    expect(result.html).not.toContain("<ol>");
    expect(result.html).not.toContain("<li>");
  });
  it("renders task states as read-only marks, including nonstandard single characters", () => {
    const result = buildLightPreview("- [ ] first task\n- [x] done task\n1) [X] ordered done\n+ [>] in progress\n- [ ]");
    expect(result.mode).toBe("text");
    expect(result.html).toBe([
      '<p class="fce-preview-list-item"><span class="fce-preview-task"></span><span class="fce-preview-list-content">first task</span></p>',
      '<p class="fce-preview-list-item"><span class="fce-preview-task fce-preview-task-done"></span><span class="fce-preview-list-content">done task</span></p>',
      '<p class="fce-preview-list-item"><span class="fce-preview-list-marker">1)</span><span class="fce-preview-task fce-preview-task-done"></span><span class="fce-preview-list-content">ordered done</span></p>',
      '<p class="fce-preview-list-item"><span class="fce-preview-task"><span class="fce-preview-task-glyph">&gt;</span></span><span class="fce-preview-list-content">in progress</span></p>',
      '<p class="fce-preview-list-item"><span class="fce-preview-task"></span><span class="fce-preview-list-content"></span></p>',
    ].join(""));
    expect(result.html).not.toContain("<input");
  });

  it("flattens mixed nested items and joins only indented non-list continuation lines", () => {
    const result = buildLightPreview("- parent\n  continuation text\n  3) child\n    child continuation\n\n- after blank\nplain text", 500, 8);
    expect(result.html).toBe([
      '<p class="fce-preview-list-item"><span class="fce-preview-list-marker">•</span><span class="fce-preview-list-content">parent continuation text</span></p>',
      '<p class="fce-preview-list-item"><span class="fce-preview-list-marker">3)</span><span class="fce-preview-list-content">child child continuation</span></p>',
      '<p class="fce-preview-list-item"><span class="fce-preview-list-marker">•</span><span class="fce-preview-list-content">after blank</span></p>',
      '<p>plain text</p>',
    ].join(""));
  });

  it("counts continuation source lines against the preview line budget", () => {
    const result = buildLightPreview("- first\n  continued\n- second\n- outside", 500, 3);
    expect(result.html).toContain("first continued");
    expect(result.html).toContain("second");
    expect(result.html).not.toContain("outside");
  });

  it("keeps a list marker when body text is clipped by the character budget", () => {
    const result = buildLightPreview("- [x] abcdef\n- later", 4, 3);
    expect(result.html).toBe('<p class="fce-preview-list-item"><span class="fce-preview-task fce-preview-task-done"></span><span class="fce-preview-list-content">abcd...</span></p>');
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

  it("styles wiki links, aliases, and Markdown links with their existing display text", () => {
    const result = buildLightPreview("[[Note]] [[Other#section|Alias]] [Website](https://example.com) **[[Bold]]** [[Target|**Emphasis**]] [`Code`](target)");

    expect(result.html).toBe('<p><span class="fce-preview-link">Note</span> <span class="fce-preview-link">Alias</span> <span class="fce-preview-link">Website</span> <span class="fce-preview-link">Bold</span> <span class="fce-preview-link">Emphasis</span> <span class="fce-preview-link">Code</span></p>');
    expect(result.html).not.toMatch(/<a\b|href=/);
  });

  it("keeps links in inline and fenced code unstyled and skips images and embeds", () => {
    const result = buildLightPreview("`[[Code]]` ![[photo.png]] ![alt](image.png) [[Note]]\n```md\n[[Fence]] [Text](target)\n```", 500, 5);

    expect(result.html).toContain("<code>Code</code>");
    expect(result.html).toContain('<span class="fce-preview-link">Note</span>');
    expect(result.html).toContain("<code>[[Fence]] [Text](target)</code>");
    expect(result.html).not.toContain("photo.png");
    expect(result.html).not.toContain("image.png");
    expect(result.html.match(/fce-preview-link/g)).toHaveLength(1);
  });

  it("clips link display text to the existing character budget and escapes it", () => {
    expect(buildLightPreview("[[target|<svg onload=\"alert(1)\">]]", 5).html)
      .toBe('<p><span class="fce-preview-link">&lt;svg </span>...</p>');
    expect(buildLightPreview("[A&B](javascript:alert)").html)
      .toBe('<p><span class="fce-preview-link">A&amp;B</span></p>');
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
    expect(result.html).toBe('<p>First block</p><p class="fce-preview-list-item"><span class="fce-preview-list-marker">•</span><span class="fce-preview-list-content">Second block</span></p><p>Third block</p>');
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
      '<p class="fce-preview-list-item"><span class="fce-preview-list-marker">1.</span><span class="fce-preview-list-content">First item</span></p>',
      '<p class="fce-preview-code"><code>const one = 1;</code></p>',
      '<p class="fce-preview-list-item"><span class="fce-preview-list-marker">2.</span><span class="fce-preview-list-content">Second item</span></p>',
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
      '<p class="fce-preview-list-item"><span class="fce-preview-list-marker">1.</span><span class="fce-preview-list-content">First item</span></p>',
      '<p class="fce-preview-code"><code>const one = 1;</code></p>',
      '<p class="fce-preview-list-item"><span class="fce-preview-list-marker">2.</span><span class="fce-preview-list-content">Second item</span></p>',
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
});
