import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { getUiStrings } from "../i18n";
import type { PropertyFilterClause, PropertyScalarRef } from "../property-filter-settings";
import type { CardFileKind } from "./file-kind";
import {
  buildPropertyScalarLabel,
  collectPropertyInventory,
  extractPropertyScalars,
  matchesPropertyClauses,
  matchesPropertyFilters,
  resolvePropertyScalarLabels,
} from "./property-metadata";
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

function clause(key: string, ...values: PropertyScalarRef[]): PropertyFilterClause {
  return { key, values };
}

const text = (value: string): PropertyScalarRef => ({ kind: "text", value });
const num = (value: number): PropertyScalarRef => ({ kind: "number", value });
const bool = (value: boolean): PropertyScalarRef => ({ kind: "boolean", value });
const missing: PropertyScalarRef = { kind: "missing" };

// ---------------------------------------------------------------------------
// extractPropertyScalars (C3)
// ---------------------------------------------------------------------------

describe("extractPropertyScalars", () => {
  it("returns no keys for null frontmatter or an empty object", () => {
    expect(extractPropertyScalars(null)).toEqual([]);
    expect(extractPropertyScalars({})).toEqual([]);
  });

  it("extracts text, finite number, and boolean scalars with exact identity", () => {
    const result = extractPropertyScalars({
      status: "Open",
      priority: 1.5,
      done: false,
    });

    expect(result).toEqual([
      { key: "done", label: "done", values: [bool(false)] },
      { key: "priority", label: "priority", values: [num(1.5)] },
      { key: "status", label: "status", values: [text("Open")] },
    ]);
  });

  it("trims keys, normalizes case, and drops empty keys", () => {
    const result = extractPropertyScalars({ " Status ": "x", "   ": "y" });
    expect(result).toEqual([{ key: "status", label: "Status", values: [text("x")] }]);
  });

  it("excludes the position sentinel case-insensitively", () => {
    const result = extractPropertyScalars({
      position: { start: 0 },
      Position: 1,
      POSITION: "x",
      real: "y",
    });
    expect(result.map((entry) => entry.key)).toEqual(["real"]);
  });

  it("unions values and keeps the smallest raw spelling for case-colliding keys", () => {
    const result = extractPropertyScalars({ status: "a", Status: "b", STATUS: "a" });
    expect(result).toEqual([
      { key: "status", label: "STATUS", values: [text("a"), text("b")] },
    ]);
  });

  it("handles Unicode keys and Unicode case collisions", () => {
    const result = extractPropertyScalars({ "Äbc": 1, "äBC": 2, "别名": "x" });
    expect(result).toEqual([
      { key: "äbc", label: "Äbc", values: [num(1), num(2)] },
      { key: "别名", label: "别名", values: [text("x")] },
    ]);
  });

  it("flattens nested arrays and dedupes repeated scalars within one note", () => {
    const result = extractPropertyScalars({
      tags: ["a", ["b", "a"], [["c", "b"]]],
      nums: [1, [2, 1]],
    });
    expect(result).toEqual([
      { key: "nums", label: "nums", values: [num(1), num(2)] },
      { key: "tags", label: "tags", values: [text("a"), text("b"), text("c")] },
    ]);
  });

  it("treats whitespace-only and empty strings as unsupported", () => {
    const result = extractPropertyScalars({ status: "   ", other: "" });
    expect(result).toEqual([
      { key: "other", label: "other", values: [] },
      { key: "status", label: "status", values: [] },
    ]);
  });

  it("preserves surrounding whitespace and case of meaningful strings", () => {
    const result = extractPropertyScalars({ status: " Open " });
    expect(result[0]?.values).toEqual([text(" Open ")]);
  });

  it("contributes no scalar for null, undefined, objects, and non-finite numbers", () => {
    const result = extractPropertyScalars({
      a: null,
      b: undefined,
      c: { nested: "x" },
      d: Number.NaN,
      e: Number.POSITIVE_INFINITY,
      f: [],
      g: [{ nested: true }, null],
    });
    expect(result.every((entry) => entry.values.length === 0)).toBe(true);
    expect(result.map((entry) => entry.key)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("does not recurse into objects to invent dotted keys", () => {
    const result = extractPropertyScalars({ outer: { inner: "x" } });
    expect(result).toEqual([{ key: "outer", label: "outer", values: [] }]);
  });
});

// ---------------------------------------------------------------------------
// matchesPropertyFilters (C5 semantics)
// ---------------------------------------------------------------------------

describe("matchesPropertyFilters", () => {
  const cards = [createCard("a.md"), createCard("b.md"), createCard("c.md")];

  it("matches every card when there are no clauses", () => {
    const accessor = vi.fn(accessorFor({}));
    expect(matchesPropertyFilters(cards, [], accessor)).toEqual(cards);
    expect(accessor).not.toHaveBeenCalled();
  });

  it("combines values within one clause with OR", () => {
    const frontmatter = {
      "a.md": { status: "open" },
      "b.md": { status: "done" },
      "c.md": { status: "archived" },
    };
    const result = matchesPropertyFilters(
      cards,
      [clause("status", text("open"), text("done"))],
      accessorFor(frontmatter),
    );
    expect(result.map((card) => card.path)).toEqual(["a.md", "b.md"]);
  });

  it("combines clauses for different keys with AND", () => {
    const frontmatter = {
      "a.md": { status: "open", priority: 1 },
      "b.md": { status: "open", priority: 2 },
      "c.md": { status: "done", priority: 1 },
    };
    const result = matchesPropertyFilters(
      cards,
      [clause("status", text("open")), clause("priority", num(1))],
      accessorFor(frontmatter),
    );
    expect(result.map((card) => card.path)).toEqual(["a.md"]);
  });

  it("matches clause keys against raw keys case-insensitively", () => {
    const frontmatter = { "a.md": { "  STATUS  ": "open" } };
    const result = matchesPropertyFilters(
      [cards[0]!],
      [clause("status", text("open"))],
      accessorFor(frontmatter),
    );
    expect(result).toHaveLength(1);
  });

  it("matches text case-sensitively and type-sensitively", () => {
    const frontmatter = { "a.md": { status: "Open", level: "1" } };
    const accessor = accessorFor(frontmatter);
    expect(
      matchesPropertyFilters([cards[0]!], [clause("status", text("open"))], accessor),
    ).toEqual([]);
    expect(
      matchesPropertyFilters([cards[0]!], [clause("level", num(1))], accessor),
    ).toEqual([]);
    expect(
      matchesPropertyFilters([cards[0]!], [clause("level", text("1"))], accessor),
    ).toHaveLength(1);
  });

  it("matches missing when a card has no supported scalar for the key", () => {
    const frontmatter = {
      "a.md": { status: "open" },
      "b.md": { status: { nested: true } },
      "c.md": { other: "x" },
    };
    const result = matchesPropertyFilters(
      cards,
      [clause("status", missing)],
      accessorFor(frontmatter),
    );
    expect(result.map((card) => card.path)).toEqual(["b.md", "c.md"]);
  });

  it("matches missing for a null cache and degrades hostile values to missing", () => {
    const frontmatter = {
      "a.md": null,
      "b.md": { status: [null, [], {}] },
      "c.md": { status: "open" },
    };
    const result = matchesPropertyFilters(
      cards,
      [clause("status", missing)],
      accessorFor(frontmatter),
    );
    expect(result.map((card) => card.path)).toEqual(["a.md", "b.md"]);
  });

  it("treats non-Markdown cards as missing without consulting the accessor", () => {
    const mixed = [
      createCard("a.md"),
      createCard("board.canvas", "canvas"),
      createCard("db.base", "base"),
      createCard("sketch.excalidraw.md", "excalidraw"),
    ];
    const accessor = vi.fn((_file: TFile) => ({ status: "open" }));

    const missingResult = matchesPropertyFilters(mixed, [clause("status", missing)], accessor);
    expect(missingResult.map((card) => card.path)).toEqual([
      "board.canvas",
      "db.base",
      "sketch.excalidraw.md",
    ]);
    expect(accessor).toHaveBeenCalledTimes(1);
    expect(accessor).toHaveBeenCalledWith(mixed[0]!.file);

    const valuedResult = matchesPropertyFilters(
      mixed,
      [clause("status", text("open"))],
      accessor,
    );
    expect(valuedResult.map((card) => card.path)).toEqual(["a.md"]);
  });

  it("counts a multi-valued note against each distinct value (OR hit on any)", () => {
    const frontmatter = { "a.md": { status: ["open", "done"] } };
    const accessor = accessorFor(frontmatter);
    expect(
      matchesPropertyFilters([cards[0]!], [clause("status", text("done"))], accessor),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// matchesPropertyClauses (C3 single-file predicate)
// ---------------------------------------------------------------------------

describe("matchesPropertyClauses", () => {
  it("matches every file when there are no clauses", () => {
    expect(matchesPropertyClauses([], true, { status: "open" })).toBe(true);
    expect(matchesPropertyClauses([], false, null)).toBe(true);
  });

  it("ANDs clauses and ORs values for markdown frontmatter", () => {
    const frontmatter = { status: "open", priority: 1 };
    expect(
      matchesPropertyClauses(
        [clause("status", text("open")), clause("priority", num(1))],
        true,
        frontmatter,
      ),
    ).toBe(true);
    expect(
      matchesPropertyClauses(
        [clause("status", text("open"), text("done")), clause("priority", num(2))],
        true,
        frontmatter,
      ),
    ).toBe(false);
  });

  it("treats null frontmatter as missing every key", () => {
    expect(matchesPropertyClauses([clause("status", missing)], true, null)).toBe(true);
    expect(matchesPropertyClauses([clause("status", text("open"))], true, null)).toBe(false);
  });

  it("matches non-markdown only when every clause includes missing", () => {
    const frontmatter = { status: "open" };
    expect(matchesPropertyClauses([clause("status", missing)], false, frontmatter)).toBe(true);
    expect(matchesPropertyClauses([clause("status", text("open"))], false, frontmatter)).toBe(false);
    expect(
      matchesPropertyClauses([clause("a", missing), clause("b", text("x"))], false, frontmatter),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Display labels (C3)
// ---------------------------------------------------------------------------

describe("buildPropertyScalarLabel", () => {
  it("renders text verbatim, numbers via String, and localized boolean/missing", () => {
    expect(buildPropertyScalarLabel(text(" Open "), en)).toBe(" Open ");
    expect(buildPropertyScalarLabel(num(1.5), en)).toBe("1.5");
    expect(buildPropertyScalarLabel(bool(true), en)).toBe("True");
    expect(buildPropertyScalarLabel(bool(false), en)).toBe("False");
    expect(buildPropertyScalarLabel(missing, en)).toBe("Unassigned");
    expect(buildPropertyScalarLabel(bool(true), zh)).toBe("是");
    expect(buildPropertyScalarLabel(missing, zh)).toBe("未分配");
  });
});

describe("resolvePropertyScalarLabels", () => {
  it("keeps bare labels when nothing collides", () => {
    const labels = resolvePropertyScalarLabels([text("open"), num(1), bool(true)], en);
    expect(labels.get(JSON.stringify(["t", "open"]))).toBe("open");
    expect(labels.get(JSON.stringify(["n", 1]))).toBe("1");
    expect(labels.get(JSON.stringify(["b", true]))).toBe("True");
  });

  it("qualifies colliding text/number labels with localized type names", () => {
    const labels = resolvePropertyScalarLabels([text("1"), num(1)], en);
    expect(labels.get(JSON.stringify(["t", "1"]))).toBe("1 (Text)");
    expect(labels.get(JSON.stringify(["n", 1]))).toBe("1 (Number)");
  });

  it("qualifies colliding text/boolean labels in zh", () => {
    const labels = resolvePropertyScalarLabels([text("是"), bool(true)], zh);
    expect(labels.get(JSON.stringify(["t", "是"]))).toBe("是 (文本)");
    expect(labels.get(JSON.stringify(["b", true]))).toBe("是 (布尔值)");
  });

  it("keeps the missing row bare while qualifying a colliding text row", () => {
    const labels = resolvePropertyScalarLabels([text("Unassigned"), missing], en);
    expect(labels.get(JSON.stringify(["t", "Unassigned"]))).toBe("Unassigned (Text)");
    expect(labels.get(JSON.stringify(["m"]))).toBe("Unassigned");
  });
});

// ---------------------------------------------------------------------------
// collectPropertyInventory (C3)
// ---------------------------------------------------------------------------

interface InventoryAppOptions {
  caches?: Record<string, { frontmatter?: Record<string, unknown> } | null>;
  withMetadataCache?: boolean;
  withMarkdownFiles?: boolean;
}

function createInventoryApp(options: InventoryAppOptions = {}) {
  const caches = options.caches ?? {};
  const files = Object.keys(caches).map((path) => ({ path }) as TFile);
  const read = vi.fn(() => {
    throw new Error("inventory must not read note bodies");
  });
  const cachedRead = vi.fn(() => {
    throw new Error("inventory must not read note bodies");
  });
  const app = {
    vault: {
      getMarkdownFiles:
        options.withMarkdownFiles === false ? undefined : () => files,
      read,
      cachedRead,
    },
    metadataCache:
      options.withMetadataCache === false
        ? undefined
        : { getFileCache: (file: TFile) => caches[file.path] ?? null },
  } as unknown as App;
  return { app, read, cachedRead };
}

describe("collectPropertyInventory", () => {
  it("reports unavailable when the metadata cache or vault API is unusable", () => {
    expect(
      collectPropertyInventory(createInventoryApp({ withMetadataCache: false }).app),
    ).toEqual({ status: "unavailable", options: [] });
    expect(
      collectPropertyInventory(createInventoryApp({ withMarkdownFiles: false }).app),
    ).toEqual({ status: "unavailable", options: [] });
  });

  it("reports ready with an empty option list for an empty Markdown vault", () => {
    expect(collectPropertyInventory(createInventoryApp().app)).toEqual({
      status: "ready",
      options: [],
    });
  });

  it("reports ready with an empty option list when no properties exist", () => {
    const { app } = createInventoryApp({
      caches: { "a.md": {}, "b.md": { frontmatter: {} } },
    });
    expect(collectPropertyInventory(app)).toEqual({ status: "ready", options: [] });
  });

  it("collects normalized keys with smallest raw spellings, sorted by label", () => {
    const { app } = createInventoryApp({
      caches: {
        "a.md": { frontmatter: { Status: "open", priority: 1, position: {} } },
        "b.md": { frontmatter: { status: "done", "别名": "x" } },
      },
    });
    expect(collectPropertyInventory(app)).toEqual({
      status: "ready",
      options: [
        { key: "priority", label: "priority", available: true },
        { key: "status", label: "Status", available: true },
        { key: "别名", label: "别名", available: true },
      ],
    });
  });

  it("reports partial when a cache is null while retaining available options", () => {
    const { app } = createInventoryApp({
      caches: {
        "a.md": { frontmatter: { status: "open" } },
        "b.md": null,
      },
    });
    expect(collectPropertyInventory(app)).toEqual({
      status: "partial",
      options: [{ key: "status", label: "status", available: true }],
    });
  });

  it("includes keys whose values are all unsupported", () => {
    const { app } = createInventoryApp({
      caches: { "a.md": { frontmatter: { obj: { nested: 1 } } } },
    });
    expect(collectPropertyInventory(app).options).toEqual([
      { key: "obj", label: "obj", available: true },
    ]);
  });

  it("never reads note bodies", () => {
    const { app, read, cachedRead } = createInventoryApp({
      caches: { "a.md": { frontmatter: { status: "open" } }, "b.md": null },
    });
    collectPropertyInventory(app);
    expect(read).not.toHaveBeenCalled();
    expect(cachedRead).not.toHaveBeenCalled();
  });
});
