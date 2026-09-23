import { describe, expect, it } from "vitest";

import type { NoteCardRecord } from "./types";
import { compareCards, findSortedInsertIndex } from "./card-sort";

function card(path: string, title: string, ctime = 0, mtime = 0): NoteCardRecord {
  return { path, title, ctime, mtime } as NoteCardRecord;
}

describe("card-sort", () => {
  it("uses path as a stable tiebreak for every sort field and direction", () => {
    const a = card("a.md", "same", 1, 1);
    const b = card("b.md", "same", 1, 1);
    for (const field of ["name", "mtime", "ctime"] as const) {
      for (const direction of ["asc", "desc"] as const) {
        expect(compareCards(a, b, field, direction)).toBeLessThan(0);
        expect(compareCards(b, a, field, direction)).toBeGreaterThan(0);
        expect(compareCards(a, a, field, direction)).toBe(0);
      }
    }
  });

  it("orders name, mtime, and ctime in both directions", () => {
    const older = card("z.md", "Alpha", 1, 10);
    const newer = card("a.md", "Bravo", 2, 20);
    for (const field of ["name", "mtime", "ctime"] as const) {
      const ascending = compareCards(older, newer, field, "asc");
      expect(ascending).toBeLessThan(0);
      expect(compareCards(older, newer, field, "desc")).toBe(-ascending);
    }
  });

  it("finds the binary insertion point without disturbing sorted order", () => {
    const cards = [card("a.md", "Alpha"), card("c.md", "Charlie")];
    const next = card("b.md", "Bravo");
    expect(findSortedInsertIndex(cards, next, "name", "asc")).toBe(1);
  });
});
