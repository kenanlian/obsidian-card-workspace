import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { matchesSearchQuery } from "./metadata-utils";

function createMockFile(basename: string): TFile {
  return {
    basename,
    path: `${basename}.md`,
  } as TFile;
}

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
