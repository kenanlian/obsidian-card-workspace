import { afterEach, describe, expect, it, vi } from "vitest";
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
