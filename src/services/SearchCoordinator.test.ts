import { describe, expect, it, vi } from "vitest";

import { getUiStrings } from "../i18n";
import { SearchCoordinator } from "./SearchCoordinator";

vi.mock("../search", () => {
  return {
    IndexStore: class MockIndexStore {},
    SearchIndexManager: class MockSearchIndexManager {},
    IndexedSearchService: class MockIndexedSearchService {},
    prepareSearchableDocument: vi.fn((input: { path: string; title: string; markdown?: string; mtime: number; ctime: number }) => ({
      path: input.path,
      title: input.title,
      normalizedTitle: input.title.toLowerCase(),
      content: input.markdown ?? "",
      excerpt: input.markdown ?? "",
      folderPath: "",
      mtime: input.mtime,
      ctime: input.ctime,
    })),
  };
});

vi.mock("obsidian", () => {
  class MockTAbstractFile {
    path = "";
  }

  class MockTFile extends MockTAbstractFile {
    basename = "";
    stat: { mtime: number; ctime: number } = { mtime: 0, ctime: 0 };
  }

  return {
    Notice: class MockNotice {},
    TAbstractFile: MockTAbstractFile,
    TFile: MockTFile,
  };
});

interface CardFileLike {
  path: string;
  basename: string;
  stat: { mtime: number; ctime: number };
}

interface DocumentSourceHarness {
  coordinator: SearchCoordinator;
  cachedRead: ReturnType<typeof vi.fn>;
}

function createHarness(markdown: string): DocumentSourceHarness {
  const cachedRead = vi.fn(async () => markdown);
  const app = {
    vault: {
      cachedRead,
      adapter: { basePath: "/vault/base" },
      getAbstractFileByPath: vi.fn(() => null),
    },
  };

  const coordinator = new SearchCoordinator({
    getApp: () => app as never,
    getUiStrings: () => getUiStrings("en"),
    getPluginVersion: () => "1.0.2",
  });

  return { coordinator, cachedRead };
}

function createFile(path: string, basename: string, mtime: number, ctime: number): CardFileLike {
  return { path, basename, stat: { mtime, ctime } };
}

describe("SearchCoordinator document preparation", () => {
  it("prepares markdown documents with cached reads and title-only pdf documents without cached reads", async () => {
    const { coordinator, cachedRead } = createHarness("# Markdown Note\n\nunique-markdown-term");
    const prepare = (coordinator as unknown as {
      prepareSearchableDocumentFromFile(file: unknown): Promise<unknown>;
    }).prepareSearchableDocumentFromFile.bind(coordinator);

    const markdownFile = createFile("notes/Markdown Note.md", "Markdown Note", 20, 10);
    const nonMarkdownFile = createFile("Assets/Project Brief.pdf", "Project Brief", 30, 15);

    const markdownDocument = await prepare(markdownFile);
    const nonMarkdownDocument = await prepare(nonMarkdownFile);

    expect(cachedRead).toHaveBeenCalledTimes(1);
    expect(markdownDocument).toEqual(
      expect.objectContaining({
        path: markdownFile.path,
        title: markdownFile.basename,
        content: expect.stringContaining("unique-markdown-term"),
      }),
    );
    expect(nonMarkdownDocument).toEqual(
      expect.objectContaining({
        path: nonMarkdownFile.path,
        title: nonMarkdownFile.basename,
        content: "",
        excerpt: "",
      }),
    );
  });
});
