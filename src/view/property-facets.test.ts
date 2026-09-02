import { describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import { getUiStrings } from "../i18n";
import type { PropertyFilterClause, PropertyScalarRef } from "../property-filter-settings";
import type { CardFileKind } from "./file-kind";
import { buildPropertyFacets } from "./property-facets";
import type { NoteCardRecord } from "./types";

const en = getUiStrings("en").property;
const zh = getUiStrings("zh").property;

function createCard(path: string, fileKind: CardFileKind = "markdown"): NoteCardRecord {
  const basename = path.replace(/.*\//, "").replace(/\.[^.]+$/, "");
  return {
    file: { path, basename } as NoteCardRecord["file"],
    fileKind,
    path,
    title: basename,
    ctime: 1,
    mtime: 1,
    excerpt: "",
    previewHtml: "",
    previewMode: "empty",
    hydrated: false,
    taskSummary: null,
  };
}

function accessorFor(
  frontmatterByPath: Record<string, Record<string, unknown> | null>,
): (file: TFile) => Record<string, unknown> | null {
  return (file) => frontmatterByPath[file.path] ?? null;
}

const text = (value: string): PropertyScalarRef => ({ kind: "text", value });
const num = (value: number): PropertyScalarRef => ({ kind: "number", value });
const bool = (value: boolean): PropertyScalarRef => ({ kind: "boolean", value });
const missing: PropertyScalarRef = { kind: "missing" };

function clause(key: string, ...values: PropertyScalarRef[]): PropertyFilterClause {
  return { key, values };
}

describe("buildPropertyFacets", () => {
  it("emits exactly one facet per enabled key, even when the source never has it", () => {
    const facets = buildPropertyFacets(
      [createCard("a.md")],
      ["status", "ghost"],
      [],
      accessorFor({ "a.md": { status: "open" } }),
      en,
    );

    expect(facets.map((facet) => facet.key)).toEqual(["ghost", "status"]);
    const ghost = facets[0]!;
    expect(ghost.label).toBe("ghost");
    expect(ghost.valuedCount).toBe(0);
    expect(ghost.missingCount).toBe(1);
    expect(ghost.values.map((row) => row.ref)).toEqual([missing]);
  });

  it("ignores enabled keys that fail normalization", () => {
    const facets = buildPropertyFacets(
      [createCard("a.md")],
      [" ", "position", "status", "status", "STATUS"],
      [],
      accessorFor({ "a.md": { status: "open" } }),
      en,
    );
    expect(facets.map((facet) => facet.key)).toEqual(["status"]);
  });

  it("counts base cards per key: valued once per card, missing otherwise", () => {
    const cards = [createCard("a.md"), createCard("b.md"), createCard("c.md")];
    const frontmatter = {
      "a.md": { status: ["open", "done"] },
      "b.md": { status: "open" },
      "c.md": { other: "x" },
    };
    const [facet] = buildPropertyFacets(cards, ["status"], [], accessorFor(frontmatter), en);

    expect(facet?.valuedCount).toBe(2);
    expect(facet?.missingCount).toBe(1);
    expect(facet?.values).toEqual([
      { ref: text("done"), label: "done", count: 1 },
      { ref: text("open"), label: "open", count: 2 },
      { ref: missing, label: "Unassigned", count: 1 },
    ]);
  });

  it("counts a repeated scalar in one note only once", () => {
    const cards = [createCard("a.md")];
    const frontmatter = { "a.md": { status: ["open", "open", ["open"]] } };
    const [facet] = buildPropertyFacets(cards, ["status"], [], accessorFor(frontmatter), en);
    expect(facet?.values).toEqual([
      { ref: text("open"), label: "open", count: 1 },
    ]);
    expect(facet?.valuedCount).toBe(1);
  });

  it("never narrows itself: an active filter keeps sibling values and counts", () => {
    const cards = [createCard("a.md"), createCard("b.md"), createCard("c.md")];
    const frontmatter = {
      "a.md": { status: "open" },
      "b.md": { status: "done" },
      "c.md": { status: "done" },
    };
    // The active filter would narrow visible cards to a.md only; the facets
    // must still reflect every base card.
    const [facet] = buildPropertyFacets(
      cards,
      ["status"],
      [clause("status", text("open"))],
      accessorFor(frontmatter),
      en,
    );

    expect(facet?.valuedCount).toBe(3);
    expect(facet?.values).toEqual([
      { ref: text("done"), label: "done", count: 2 },
      { ref: text("open"), label: "open", count: 1 },
    ]);
  });

  it("keeps an active scalar that disappeared from the source with count 0", () => {
    const cards = [createCard("a.md")];
    const frontmatter = { "a.md": { status: "open" } };
    const [facet] = buildPropertyFacets(
      cards,
      ["status"],
      [clause("status", text("archived"))],
      accessorFor(frontmatter),
      en,
    );

    expect(facet?.values).toEqual([
      { ref: text("archived"), label: "archived", count: 0 },
      { ref: text("open"), label: "open", count: 1 },
    ]);
  });

  it("shows the missing row when missing is selected even with zero missing cards", () => {
    const cards = [createCard("a.md")];
    const frontmatter = { "a.md": { status: "open" } };
    const [facet] = buildPropertyFacets(
      cards,
      ["status"],
      [clause("status", missing)],
      accessorFor(frontmatter),
      en,
    );

    expect(facet?.missingCount).toBe(0);
    expect(facet?.values.at(-1)).toEqual({ ref: missing, label: "Unassigned", count: 0 });
  });

  it("omits the missing row when nothing is missing and missing is not selected", () => {
    const cards = [createCard("a.md")];
    const frontmatter = { "a.md": { status: "open" } };
    const [facet] = buildPropertyFacets(cards, ["status"], [], accessorFor(frontmatter), en);
    expect(facet?.values.some((row) => row.ref.kind === "missing")).toBe(false);
  });

  it("always sorts the missing row last", () => {
    const cards = [createCard("a.md"), createCard("b.md")];
    const frontmatter = { "a.md": { status: "zebra" }, "b.md": {} };
    const [facet] = buildPropertyFacets(cards, ["status"], [], accessorFor(frontmatter), en);
    expect(facet?.values.map((row) => row.ref)).toEqual([text("zebra"), missing]);
  });

  it("sorts scalar values by display label with localeCompare", () => {
    const cards = [createCard("a.md")];
    const frontmatter = { "a.md": { level: ["banana", "Apple", 10, 3] } };
    const [facet] = buildPropertyFacets(cards, ["level"], [], accessorFor(frontmatter), en);

    // Digits collate before letters; case is tertiary, so "Apple" < "banana".
    expect(facet?.values.map((row) => row.label)).toEqual(["10", "3", "Apple", "banana"]);
  });

  it("breaks label ties by serialized identity for a deterministic order", () => {
    const cards = [createCard("a.md")];
    // text "1" collides with number 1 and gains the "(Text)" qualifier, which
    // makes its final label equal to the literal text "1 (Text)" row.
    const frontmatter = { "a.md": { level: [1, "1", "1 (Text)"] } };
    const [facet] = buildPropertyFacets(cards, ["level"], [], accessorFor(frontmatter), en);

    expect(facet?.values.map((row) => [row.label, row.ref])).toEqual([
      ["1 (Number)", num(1)],
      ["1 (Text)", text("1 (Text)")],
      ["1 (Text)", text("1")],
    ]);
  });

  it("localizes boolean, missing, and type-qualifier labels", () => {
    const cards = [createCard("a.md"), createCard("b.md")];
    const frontmatter = { "a.md": { done: true, mixed: ["1", 1] }, "b.md": {} };
    const facets = buildPropertyFacets(cards, ["done", "mixed"], [], accessorFor(frontmatter), zh);

    expect(facets[0]?.values).toEqual([
      { ref: bool(true), label: "是", count: 1 },
      { ref: missing, label: "未分配", count: 1 },
    ]);
    expect(facets[1]?.values.map((row) => row.label)).toEqual(["1 (数字)", "1 (文本)", "未分配"]);
  });

  it("qualifies a text value that collides with the Unassigned label", () => {
    const cards = [createCard("a.md"), createCard("b.md")];
    const frontmatter = { "a.md": { status: "Unassigned" }, "b.md": {} };
    const [facet] = buildPropertyFacets(cards, ["status"], [], accessorFor(frontmatter), en);

    expect(facet?.values).toEqual([
      { ref: text("Unassigned"), label: "Unassigned (Text)", count: 1 },
      { ref: missing, label: "Unassigned", count: 1 },
    ]);
  });

  it("treats non-Markdown cards as missing for every key", () => {
    const cards = [
      createCard("a.md"),
      createCard("board.canvas", "canvas"),
      createCard("db.base", "base"),
    ];
    const accessor = vi.fn(accessorFor({ "a.md": { status: "open" } }));
    const [facet] = buildPropertyFacets(cards, ["status"], [], accessor, en);

    expect(facet?.valuedCount).toBe(1);
    expect(facet?.missingCount).toBe(2);
    expect(accessor).toHaveBeenCalledTimes(1);
  });

  it("uses the lexicographically smallest observed raw spelling as the key label", () => {
    const cards = [createCard("a.md"), createCard("b.md")];
    const frontmatter = { "a.md": { STATUS: "open" }, "b.md": { Status: "done" } };
    const [facet] = buildPropertyFacets(cards, ["status"], [], accessorFor(frontmatter), en);
    expect(facet?.label).toBe("STATUS");
  });

  it("keeps labels stable across value-set changes", () => {
    const frontmatter: Record<string, Record<string, unknown> | null> = {
      "a.md": { done: true },
    };
    const cards = [createCard("a.md")];
    const before = buildPropertyFacets(cards, ["done"], [], accessorFor(frontmatter), en);

    frontmatter["b.md"] = { done: false };
    const after = buildPropertyFacets(
      [...cards, createCard("b.md")],
      ["done"],
      [],
      accessorFor(frontmatter),
      en,
    );

    expect(after[0]?.values.find((row) => row.ref.kind === "boolean" && row.ref.value)?.label)
      .toBe(before[0]?.values[0]?.label);
  });
});
