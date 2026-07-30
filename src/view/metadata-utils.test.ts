import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";

vi.mock("obsidian", () => ({
  getAllTags: vi.fn(),
}));

import { getAllTags } from "obsidian";
import { collectAllTags, collectTagCounts, matchesSearchQuery, matchesTagFilter } from "./metadata-utils";

function createMockFile(basename: string): TFile {
  return {
    basename,
    path: `${basename}.md`,
  } as TFile;
}

function createMockApp(): App {
  return {
    metadataCache: {
      getFileCache: (file: TFile) => ({ path: file.path }),
    },
  } as unknown as App;
}

const getAllTagsMock = vi.mocked(getAllTags);

describe("matchesSearchQuery", () => {
  it("returns true for empty query", () => {
    expect(matchesSearchQuery(createMockFile("Roadmap"), "")).toBe(true);
  });

  it("returns true for whitespace-only query", () => {
    expect(matchesSearchQuery(createMockFile("Roadmap"), "   ")).toBe(true);
  });

  it("matches title without cached content", () => {
    expect(matchesSearchQuery(createMockFile("Quarterly-Roadmap"), "roadmap")).toBe(true);
  });

  it("matches cached content when provided", () => {
    expect(matchesSearchQuery(createMockFile("Notes"), "retrospective", "Sprint retrospective summary")).toBe(true);
  });

  it("does not match content when cached content is missing", () => {
    expect(matchesSearchQuery(createMockFile("Notes"), "retrospective")).toBe(false);
  });

  it("is case-insensitive for title and content", () => {
    expect(matchesSearchQuery(createMockFile("PROJECT-plan"), "project")).toBe(true);
    expect(matchesSearchQuery(createMockFile("Notes"), "reTroSpeCtive", "Sprint RETROSPECTIVE summary")).toBe(true);
  });
});

describe("matchesTagFilter", () => {
  beforeEach(() => {
    getAllTagsMock.mockReset();
  });

  it("matches descendant note tags when a parent tag is selected", () => {
    const file = createMockFile("Harness");
    const app = createMockApp();

    getAllTagsMock.mockReturnValue(["#领域/AI/harness"]);

    expect(matchesTagFilter(app, file, ["领域/ai"])).toBe(true);
  });

  it("does not match sibling branches for parent-style selections", () => {
    const file = createMockFile("Other");
    const app = createMockApp();

    getAllTagsMock.mockReturnValue(["#领域/ml"]);

    expect(matchesTagFilter(app, file, ["领域/ai"])).toBe(false);
  });

  it("keeps AND semantics across multiple selected tags", () => {
    const file = createMockFile("Combined");
    const app = createMockApp();

    getAllTagsMock.mockReturnValue(["#领域/AI/harness", "#project/active"]);

    expect(matchesTagFilter(app, file, ["领域", "project/active"])).toBe(true);
    expect(matchesTagFilter(app, file, ["领域", "project/archived"])).toBe(false);
  });
});
describe("collectAllTags", () => {
  beforeEach(() => {
    getAllTagsMock.mockReset();
  });

  it("preserves display casing, removes leading hashes, and deduplicates by normalized tag", () => {
    const app = createMockApp();
    const files = [createMockFile("Alpha"), createMockFile("Beta")];

    getAllTagsMock
      .mockReturnValueOnce(["#Work/AI", "#Project"])
      .mockReturnValueOnce(["#work/ai", "#personal"]);

    expect(collectAllTags(app, files)).toEqual(["personal", "Project", "Work/AI"]);
  });
});

describe("collectTagCounts", () => {
  beforeEach(() => {
    getAllTagsMock.mockReset();
  });

  it("rolls counts up to ancestor tag paths", () => {
    const app = createMockApp();
    const files = [createMockFile("Alpha"), createMockFile("Beta")];

    getAllTagsMock
      .mockReturnValueOnce(["#Work/AI"])
      .mockReturnValueOnce(["#work/ml"]);

    expect(collectTagCounts(app, files)).toEqual({
      work: 2,
      "work/ai": 1,
      "work/ml": 1,
    });
  });

  it("counts a file once per tag path even when it carries nested variants", () => {
    const app = createMockApp();
    const files = [createMockFile("Alpha")];

    getAllTagsMock.mockReturnValueOnce(["#Work/AI", "#work/ai/harness"]);

    expect(collectTagCounts(app, files)).toEqual({
      work: 1,
      "work/ai": 1,
      "work/ai/harness": 1,
    });
  });

  it("ignores files without tags", () => {
    const app = createMockApp();
    const files = [createMockFile("Alpha")];

    getAllTagsMock.mockReturnValueOnce(null);

    expect(collectTagCounts(app, files)).toEqual({});
  });
});
