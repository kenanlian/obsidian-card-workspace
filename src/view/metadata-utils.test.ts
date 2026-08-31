import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";

vi.mock("obsidian", () => ({
  getAllTags: vi.fn(),
}));

import { getAllTags } from "obsidian";
import {
  collectAllTags,
  collectTagCounts,
  collectVaultTagIndex,
  getFileTagEntries,
  matchesSearchQuery,
  matchesTagFilter,
} from "./metadata-utils";

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
describe("getFileTagEntries", () => {
  beforeEach(() => {
    getAllTagsMock.mockReset();
  });

  it("returns normalized and display forms for every tag", () => {
    getAllTagsMock.mockReturnValue(["#Work/AI", "#project"]);

    expect(getFileTagEntries(createMockApp(), createMockFile("Alpha"))).toEqual([
      { normalized: "work/ai", display: "Work/AI" },
      { normalized: "project", display: "project" },
    ]);
  });

  it("keeps the lexicographically smaller display form on a normalized collision", () => {
    getAllTagsMock.mockReturnValue(["#Work", "#work", "#WORK"]);

    expect(getFileTagEntries(createMockApp(), createMockFile("Alpha"))).toEqual([
      { normalized: "work", display: "WORK" },
    ]);
  });

  it("drops tags whose normalized form is empty", () => {
    getAllTagsMock.mockReturnValue(["#", "  ", "#kept"]);

    expect(getFileTagEntries(createMockApp(), createMockFile("Alpha"))).toEqual([
      { normalized: "kept", display: "kept" },
    ]);
  });

  it("returns an empty array for a null cache", () => {
    const app = {
      metadataCache: {
        getFileCache: () => null,
      },
    } as unknown as App;

    expect(getFileTagEntries(app, createMockFile("Alpha"))).toEqual([]);
    expect(getAllTagsMock).not.toHaveBeenCalled();
  });

  it("returns an empty array when the file carries no tags", () => {
    getAllTagsMock.mockReturnValue(null);

    expect(getFileTagEntries(createMockApp(), createMockFile("Alpha"))).toEqual([]);
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

describe("collectVaultTagIndex", () => {
  function createVaultApp(files: TFile[]): App {
    return {
      metadataCache: {
        getFileCache: (file: TFile) => ({ path: file.path }),
      },
      vault: {
        getMarkdownFiles: () => files,
      },
    } as unknown as App;
  }

  beforeEach(() => {
    getAllTagsMock.mockReset();
  });

  it("collects normalized tags from every markdown file, including ancestors", () => {
    const app = createVaultApp([createMockFile("Alpha"), createMockFile("Beta")]);

    getAllTagsMock
      .mockReturnValueOnce(["#Work/AI/harness"])
      .mockReturnValueOnce(["#personal"]);

    expect(collectVaultTagIndex(app)?.tagPaths).toEqual(
      new Set(["work", "work/ai", "work/ai/harness", "personal"]),
    );
  });

  it("rolls counts up to ancestors and counts each note once per tag path", () => {
    const app = createVaultApp([
      createMockFile("Alpha"),
      createMockFile("Beta"),
      createMockFile("Gamma"),
    ]);

    getAllTagsMock
      .mockReturnValueOnce(["#Work/AI", "#work/ai/harness"])
      .mockReturnValueOnce(["#work/ml"])
      .mockReturnValueOnce(["#personal"]);

    expect(collectVaultTagIndex(app)?.counts).toEqual({
      work: 2,
      "work/ai": 1,
      "work/ai/harness": 1,
      "work/ml": 1,
      personal: 1,
    });
  });

  it("returns empty data when files exist but carry no tags", () => {
    const app = createVaultApp([createMockFile("Alpha")]);

    getAllTagsMock.mockReturnValueOnce(null);

    expect(collectVaultTagIndex(app)).toEqual({ tagPaths: new Set(), counts: {} });
  });

  it("returns null when the answer cannot be trusted", () => {
    expect(collectVaultTagIndex(createVaultApp([]))).toBeNull();
    expect(collectVaultTagIndex({ vault: {} } as unknown as App)).toBeNull();
    expect(
      collectVaultTagIndex({
        metadataCache: { getFileCache: () => null },
        vault: {},
      } as unknown as App),
    ).toBeNull();
  });
});
