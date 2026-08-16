import { describe, expect, it } from "vitest";

import type { NoteCardRecord } from "./types";
import { compareCards, findSortedInsertIndex } from "./card-sort";

function card(path: string, title: string, ctime = 0, mtime = 0): NoteCardRecord {
  return { path, title, ctime, mtime } as NoteCardRecord;
}

describe("card-sort", () => {
  it("uses path as a stable tiebreak for every sort direction", () => {
    const a = card("a.md", "same", 1, 1);
    const b = card("b.md", "same", 1, 1);
    expect(compareCards(a, b, "name", "asc")).toBeLessThan(0);
    expect(compareCards(a, b, "mtime", "desc")).toBeLessThan(0);
  });

  it("finds the binary insertion point without disturbing sorted order", () => {
    const cards = [card("a.md", "Alpha"), card("c.md", "Charlie")];
    const next = card("b.md", "Bravo");
    expect(findSortedInsertIndex(cards, next, "name", "asc")).toBe(1);
  });
});
