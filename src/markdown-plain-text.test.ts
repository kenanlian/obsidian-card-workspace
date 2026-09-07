import { describe, it, expect } from "vitest";
import { stripMarkdownToText } from "./markdown-plain-text";

// ---------------------------------------------------------------------------
// Representative corpus: byte-for-byte locked excerpts
// ---------------------------------------------------------------------------
// The expected strings below were captured from the previous view-owned
// implementation (src/view/markdown-utils.ts at plan baseline 21ce215) before
// the helper moved to this neutral module. They lock the default
// maxLength = 260 excerpt output byte-for-byte across the move (contract C7):
// frontmatter removal, fenced-code removal, link handling, whitespace
// collapsing, and truncation must not drift.
const REPRESENTATIVE_MARKDOWN_SAMPLES: readonly { name: string; markdown: string; expectedExcerpt: string }[] = [
  {
    name: "frontmatter, headings, and lists",
    markdown:
      "---\ntitle: Card Workspace\ntags: [work, project]\n---\n\n# Release Notes\n\n## Highlights\n\n- item one\n* item two\n1. first\n2. second\n- [ ] first task\n- [x] second task\n\nClosing prose.",
    expectedExcerpt:
      "Release Notes Highlights item one item two first second first task second task Closing prose.",
  },
  {
    name: "fenced code blocks are removed from the excerpt",
    markdown: "before\n```js\nconst x = 1;\nflow report\n```\nmiddle\n~~~bash\n./report_summary\n~~~\nafter",
    // The triple-tilde fence is not a ``` fence; its markers degrade to spaces
    // exactly as the previous implementation did ("~" -> " ", "_" -> " ").
    expectedExcerpt: "before middle bash ./report summary after",
  },
  {
    name: "markdown links, wiki links, and images",
    markdown:
      "See [click here](https://example.com) and ![alt](img.png) plus ![[image.png]].\n[[Note Title|alias]] [[Note Title]] [[Note#Heading|aliased]] [[Note#Heading]]",
    expectedExcerpt: "See click here and plus . alias Note Title aliased Note",
  },
  {
    name: "whitespace collapsing across CRLF, tabs, and blank runs",
    markdown: "  leading   spaces\r\n\r\ntab\tseparated   runs\n\n\nmultiple\r\n\r\nblank   lines  ",
    expectedExcerpt: "leading spaces tab separated runs multiple blank lines",
  },
  {
    name: "math delimiters are unwrapped and marker characters degrade",
    markdown: "$$x+y$$ inline $a^2+b^2=c^2$ paren \\(E=mc^2\\) bracket \\[a^2+b^2=c^2\\]",
    expectedExcerpt: "x+y inline a^2+b^2 c^2 paren E mc^2 bracket a^2+b^2 c^2",
  },
  {
    name: "emphasis and inline code",
    markdown: "**bold** _italic_ ~~strike~~ ==highlight== safe `console log` unsafe `x<b>&`",
    expectedExcerpt: "bold italic strike highlight safe console log unsafe",
  },
  {
    name: "empty input",
    markdown: "",
    expectedExcerpt: "",
  },
  {
    name: "whitespace-only input",
    markdown: "   \n\t\r\n  ",
    expectedExcerpt: "",
  },
];

describe("stripMarkdownToText representative corpus (locked excerpts)", () => {
  for (const sample of REPRESENTATIVE_MARKDOWN_SAMPLES) {
    it(`produces the locked byte-for-byte excerpt for ${sample.name}`, () => {
      expect(stripMarkdownToText(sample.markdown)).toBe(sample.expectedExcerpt);
    });
  }

  it("truncates the default 260-character excerpt and appends the ellipsis byte-for-byte", () => {
    const markdown = `start ${"x".repeat(300)} end`;
    const expected = `${"start " + "x".repeat(254)}...`;
    const result = stripMarkdownToText(markdown);

    expect(result).toBe(expected);
    expect(result.length).toBe(263);
    expect(stripMarkdownToText(markdown, 20)).toBe(`${"start " + "x".repeat(14)}...`);
  });
});

// ---------------------------------------------------------------------------
// Unit behavior (moved verbatim from src/view/markdown-utils.test.ts)
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
