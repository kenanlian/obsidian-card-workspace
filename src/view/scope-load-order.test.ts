import type { TFile } from "obsidian";
import { describe, expect, it } from "vitest";

import { type SortDirection, type SortField } from "../settings";
import { compareCards } from "./card-sort";
import { applyPinReorder, type PipelineContext } from "./pipeline";
import {
  orderScopeFiles,
} from "./scope-load-order";
import type { NoteCardRecord } from "./types";

const SORT_FIELDS: readonly SortField[] = ["mtime", "ctime", "name"];
const SORT_DIRECTIONS: readonly SortDirection[] = ["asc", "desc"];

function makeFile(path: string, ctime: number, mtime: number): TFile {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return {
    path,
    basename: dot === -1 ? name : name.slice(0, dot),
    stat: { ctime, mtime },
  } as TFile;
}

function recordFromFile(file: TFile): NoteCardRecord {
  return {
    path: file.path,
    title: file.basename,
    ctime: file.stat.ctime,
    mtime: file.stat.mtime,
  } as NoteCardRecord;
}

function oraclePaths(
  files: readonly TFile[],
  field: SortField,
  direction: SortDirection,
  pinnedPaths: readonly string[],
): string[] {
  const records = files.map(recordFromFile);
  records.sort((left, right) => compareCards(left, right, field, direction));
  return applyPinReorder(records, { pinnedPaths: [...pinnedPaths] } as PipelineContext)
    .map((card) => card.path);
}

const scopeFiles = [
  makeFile("notes/zeta.md", 40, 10),
  makeFile("notes/alpha.md", 10, 40),
  makeFile("dir/same.md", 20, 20),
  makeFile("aaa/same.md", 20, 20),
  makeFile("notes/mid.md", 30, 30),
];

describe("orderScopeFiles", () => {
  it("returns an empty order for an empty file list", () => {
    expect(orderScopeFiles([], { field: "mtime", direction: "desc" }, ["notes/alpha.md"])).toEqual([]);
  });

  it("does not mutate the input file list", () => {
    const input = [...scopeFiles];
    const before = input.map((file) => file.path);
    orderScopeFiles(input, { field: "name", direction: "asc" }, ["notes/zeta.md"]);
    expect(input.map((file) => file.path)).toEqual(before);
  });

  it.each(SORT_FIELDS)("matches compareCards for %s in both directions without pins", (field) => {
    for (const direction of SORT_DIRECTIONS) {
      expect(orderScopeFiles(scopeFiles, { field, direction }, []).map((file) => file.path))
        .toEqual(oraclePaths(scopeFiles, field, direction, []));
    }
  });

  it.each(SORT_FIELDS)("matches applyPinReorder for %s in both directions", (field) => {
    for (const direction of SORT_DIRECTIONS) {
      const sorted = oraclePaths(scopeFiles, field, direction, []);
      const first = sorted[0] ?? "";
      const last = sorted[sorted.length - 1] ?? "";
      const pinnedPaths = ["not-in-scope.md", last, last, first];
      const ordered = orderScopeFiles(scopeFiles, { field, direction }, pinnedPaths)
        .map((file) => file.path);

      expect(ordered).toEqual(oraclePaths(scopeFiles, field, direction, pinnedPaths));
      expect(ordered).not.toContain("not-in-scope.md");
      expect(ordered[0]).toBe(first);
      expect(ordered).toContain(last);
    }
  });
});
