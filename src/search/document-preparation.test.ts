import { afterEach, describe, expect, it, vi } from "vitest";
import { stripMarkdownToText } from "../markdown-plain-text";
import * as documentPreparation from "./document-preparation";

describe("prepareSearchableDocument", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles fenced Markdown content for searchable content", () => {
    const document = documentPreparation.prepareSearchableDocument({
      path: "notes/fenced.md",
      title: "  Fenced Note  ",
      markdown: "```sh\nflow report\n```",
      mtime: 12,
      ctime: 6,
    });

    expect(document.title).toBe("Fenced Note");
    expect(document.normalizedTitle).toBe("fenced note");
    expect(document.content).toContain("flow report");
    expect(document.excerpt).not.toContain("flow report");
  });

  it("handles fenced Markdown code paths for searchable content", () => {
    const document = documentPreparation.prepareSearchableDocument({
      path: "notes/path.md",
      title: "Path Note",
      markdown: "~~~bash\n./report_summary\n~~~",
      mtime: 12,
      ctime: 6,
    });

    expect(document.content).toContain("./report_summary");
    expect(document.content).toContain("report summary");
    expect(document.excerpt).not.toContain("./report_summary");
    expect(document.excerpt).not.toContain("```");
  });

  it("keeps non-Markdown input empty for content and excerpt", () => {
    const document = documentPreparation.prepareSearchableDocument({
      path: "assets/brief.pdf",
      title: "  Project Brief  ",
      mtime: 12,
      ctime: 6,
    });

    expect(document.title).toBe("Project Brief");
    expect(document.normalizedTitle).toBe("project brief");
    expect(document.content).toBe("");
    expect(document.excerpt).toBe("");
  });

  it("builds excerpts from the neutral helper byte-for-byte on the representative corpus", () => {
    // The excerpt lane must equal the neutral src/markdown-plain-text.ts helper
    // (moved from src/view/markdown-utils.ts) for the same corpus samples whose
    // locked default-260 excerpts are asserted in src/markdown-plain-text.test.ts.
    const corpus: { name: string; markdown: string }[] = [
      {
        name: "frontmatter-headings-lists",
        markdown:
          "---\ntitle: Card Workspace\ntags: [work, project]\n---\n\n# Release Notes\n\n## Highlights\n\n- item one\n* item two\n1. first\n2. second\n- [ ] first task\n- [x] second task\n\nClosing prose.",
      },
      {
        name: "fenced-code-blocks",
        markdown: "before\n```js\nconst x = 1;\nflow report\n```\nmiddle\n~~~bash\n./report_summary\n~~~\nafter",
      },
      {
        name: "links",
        markdown:
          "See [click here](https://example.com) and ![alt](img.png) plus ![[image.png]].\n[[Note Title|alias]] [[Note Title]] [[Note#Heading|aliased]] [[Note#Heading]]",
      },
      {
        name: "whitespace",
        markdown: "  leading   spaces\r\n\r\ntab\tseparated   runs\n\n\nmultiple\r\n\r\nblank   lines  ",
      },
    ];

    for (const sample of corpus) {
      const document = documentPreparation.prepareSearchableDocument({
        path: `notes/${sample.name}.md`,
        title: sample.name,
        markdown: sample.markdown,
        mtime: 12,
        ctime: 6,
      });

      expect(document.excerpt).toBe(stripMarkdownToText(sample.markdown));
    }

    // One locked spot-check proving the corpus excerpts themselves are the
    // pre-move outputs, not merely self-consistent with the helper.
    expect(stripMarkdownToText(corpus[0]!.markdown)).toBe(
      "Release Notes Highlights item one item two first second first task second task Closing prose.",
    );
    expect(stripMarkdownToText(corpus[1]!.markdown)).toBe(
      "before middle bash ./report summary after",
    );
  });
});

describe("prepareSearchableDocuments", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps inputs through prepareSearchableDocument", () => {
    const documents = documentPreparation.prepareSearchableDocuments([
      {
        path: "notes/one.md",
        title: " One ",
        markdown: "# One",
        mtime: 1,
        ctime: 2,
      },
      {
        path: "notes/two.md",
        title: " Two ",
        markdown: "# Two",
        mtime: 3,
        ctime: 4,
      },
    ]);

    expect(documents).toEqual([
      {
        path: "notes/one.md",
        title: "One",
        normalizedTitle: "one",
        content: "One",
        excerpt: "One",
        folderPath: "notes",
        mtime: 1,
        ctime: 2,
      },
      {
        path: "notes/two.md",
        title: "Two",
        normalizedTitle: "two",
        content: "Two",
        excerpt: "Two",
        folderPath: "notes",
        mtime: 3,
        ctime: 4,
      },
    ]);
  });
});
