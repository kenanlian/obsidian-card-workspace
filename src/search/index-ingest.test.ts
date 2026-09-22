import MiniSearch from "minisearch";
import { describe, expect, it, vi } from "vitest";

import { tokenizeSearchIndexText } from "../search-tokenization";
import { addDocumentsWithYield, INGEST_YIELD_TERM_BUDGET } from "./index-ingest";
import { createMiniSearchOptions } from "./minisearch-options";
import type { SearchableDocument } from "./types";

type IngestEvent = { kind: "add"; terms: number } | { kind: "yield" };

const HAN_ALPHABET = "中文搜索引测汉字词语篇章节段";

function buildHanContent(length: number, offset = 0): string {
  let text = "";
  for (let index = 0; index < length; index += 1) {
    text += HAN_ALPHABET[(index * 7 + offset) % HAN_ALPHABET.length];
  }
  return text;
}

function createDocument(path: string, title: string, content: string): SearchableDocument {
  return {
    path,
    title,
    normalizedTitle: title.toLowerCase(),
    content,
    excerpt: content.slice(0, 32),
    folderPath: "notes",
    mtime: 1_700_000_000,
    ctime: 1_600_000_000,
  };
}

/** Terms MiniSearch actually receives, counted with the production tokenizer. */
function countIndexedTerms(document: SearchableDocument): number {
  return tokenizeSearchIndexText(document.title).length + tokenizeSearchIndexText(document.content).length;
}

function createRecordingIndex(
  events: IngestEvent[],
  onAdd?: (addCount: number) => void,
): MiniSearch<SearchableDocument> {
  let addCount = 0;
  return {
    add(document: SearchableDocument): void {
      addCount += 1;
      events.push({ kind: "add", terms: countIndexedTerms(document) });
      onAdd?.(addCount);
    },
  } as unknown as MiniSearch<SearchableDocument>;
}

/** Marks every cooperative yield so add events can be grouped into intervals. */
function recordYieldBoundaries(events: IngestEvent[]): () => void {
  const nativeSetTimeout = globalThis.setTimeout;
  const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    handler: () => void,
    timeout?: number,
  ) => {
    events.push({ kind: "yield" });
    return nativeSetTimeout(handler, timeout);
  }) as unknown as typeof globalThis.setTimeout);
  return () => spy.mockRestore();
}

function splitIntervals(events: IngestEvent[]): number[][] {
  const intervals: number[][] = [];
  let current: number[] = [];
  for (const event of events) {
    if (event.kind === "add") {
      current.push(event.terms);
      continue;
    }
    intervals.push(current);
    current = [];
  }
  if (current.length > 0) intervals.push(current);
  return intervals;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function countAdds(events: readonly IngestEvent[]): number {
  return events.filter((event) => event.kind === "add").length;
}

function countYields(events: readonly IngestEvent[]): number {
  return events.filter((event) => event.kind === "yield").length;
}

describe("addDocumentsWithYield", () => {
  it("declares the fixed ingest yield budget", () => {
    expect(INGEST_YIELD_TERM_BUDGET).toBe(20_000);
  });

  it("produces an index identical to addAllAsync over the same ordered list", async () => {
    const documents = [
      createDocument("notes/latin.md", "Latin Note", "alpha beta gamma delta epsilon"),
      createDocument("notes/han-large.md", "汉字长文", buildHanContent(12_000)),
      createDocument("notes/mixed.md", "Mixed 混合", `prefix ${buildHanContent(240, 3)} suffix`),
      createDocument("notes/tiny.md", "Tiny", "x"),
    ];

    const yielded = new MiniSearch<SearchableDocument>(createMiniSearchOptions());
    await addDocumentsWithYield(yielded, documents, 0, () => true);

    const baseline = new MiniSearch<SearchableDocument>(createMiniSearchOptions());
    await baseline.addAllAsync(documents);

    // Deep equality covers documentIds and fieldLength, so it also proves the
    // ingest order matches addAllAsync order.
    expect(yielded.toJSON()).toEqual(baseline.toJSON());

    const split = new MiniSearch<SearchableDocument>(createMiniSearchOptions());
    const carryOver = await addDocumentsWithYield(split, documents.slice(0, 2), 0, () => true);
    await addDocumentsWithYield(split, documents.slice(2), carryOver, () => true);

    expect(split.toJSON()).toEqual(baseline.toJSON());
  });

  it("bounds every yield interval by the term budget", async () => {
    const documents = Array.from({ length: 50 }, (_, index) =>
      createDocument(`notes/han-${index}.md`, `note-${index}`, buildHanContent(900, index)),
    );
    const events: IngestEvent[] = [];
    const index = createRecordingIndex(events);

    const restore = recordYieldBoundaries(events);
    try {
      await addDocumentsWithYield(index, documents, 0, () => true);
    } finally {
      restore();
    }

    expect(countAdds(events)).toBe(documents.length);
    expect(countYields(events)).toBeGreaterThan(1);

    const perDocumentTerms = documents.map(countIndexedTerms);
    const maxDocumentTerms = Math.max(...perDocumentTerms);
    for (const interval of splitIntervals(events)) {
      const total = sum(interval);
      // A document is added whole, so an interval can only be bounded by the
      // budget up to the start of its final document; the per-field tokenizer
      // cap is what bounds that final document.
      expect(total - interval[interval.length - 1]).toBeLessThan(INGEST_YIELD_TERM_BUDGET);
      expect(total).toBeLessThanOrEqual(INGEST_YIELD_TERM_BUDGET + maxDocumentTerms);
    }
  });

  it("carries the accumulator across successive batches", async () => {
    const first = [createDocument("notes/first.md", "a", buildHanContent(9_500))];
    const second = [createDocument("notes/second.md", "b", buildHanContent(600, 5))];

    const firstEvents: IngestEvent[] = [];
    const firstIndex = createRecordingIndex(firstEvents);
    let restore = recordYieldBoundaries(firstEvents);
    let carryOver: number;
    try {
      carryOver = await addDocumentsWithYield(firstIndex, first, 0, () => true);
    } finally {
      restore();
    }

    expect(countYields(firstEvents)).toBe(0);
    expect(carryOver).toBe(2 * (1 + 9_500));

    const carriedEvents: IngestEvent[] = [];
    const carriedIndex = createRecordingIndex(carriedEvents);
    restore = recordYieldBoundaries(carriedEvents);
    let carriedResult: number;
    try {
      carriedResult = await addDocumentsWithYield(carriedIndex, second, carryOver, () => true);
    } finally {
      restore();
    }

    expect(countYields(carriedEvents)).toBe(1);
    expect(carriedResult).toBe(0);

    const freshEvents: IngestEvent[] = [];
    const freshIndex = createRecordingIndex(freshEvents);
    restore = recordYieldBoundaries(freshEvents);
    try {
      await addDocumentsWithYield(freshIndex, second, 0, () => true);
    } finally {
      restore();
    }

    // Same batch, no carry-over: the boundary only exists because the
    // accumulator survived the previous call.
    expect(countYields(freshEvents)).toBe(0);
  });

  it("returns the carry-over unchanged for an empty batch", async () => {
    const events: IngestEvent[] = [];
    const index = createRecordingIndex(events);

    await expect(addDocumentsWithYield(index, [], 4_321, () => true)).resolves.toBe(4_321);
    expect(events).toEqual([]);
  });

  it("adds nothing when the signal is already aborted", async () => {
    const documents = Array.from({ length: 5 }, (_, index) =>
      createDocument(`notes/${index}.md`, `note-${index}`, buildHanContent(100, index)),
    );
    const events: IngestEvent[] = [];
    const index = createRecordingIndex(events);
    const controller = new AbortController();
    controller.abort();

    await expect(
      addDocumentsWithYield(index, documents, 77, () => true, controller.signal),
    ).resolves.toBe(77);
    expect(countAdds(events)).toBe(0);
  });

  it("stops without throwing when the signal aborts mid-list", async () => {
    const documents = Array.from({ length: 10 }, (_, index) =>
      createDocument(`notes/${index}.md`, `note-${index}`, buildHanContent(100, index)),
    );
    const events: IngestEvent[] = [];
    const controller = new AbortController();
    const index = createRecordingIndex(events, (addCount) => {
      if (addCount === 3) controller.abort();
    });

    await expect(
      addDocumentsWithYield(index, documents, 0, () => true, controller.signal),
    ).resolves.toBeGreaterThan(0);
    expect(countAdds(events)).toBe(3);
  });

  it("stops without throwing when isCurrent flips mid-list", async () => {
    const documents = Array.from({ length: 10 }, (_, index) =>
      createDocument(`notes/${index}.md`, `note-${index}`, buildHanContent(100, index)),
    );
    const events: IngestEvent[] = [];
    let current = true;
    const index = createRecordingIndex(events, (addCount) => {
      if (addCount === 4) current = false;
    });

    await expect(
      addDocumentsWithYield(index, documents, 0, () => current),
    ).resolves.toBeGreaterThan(0);
    expect(countAdds(events)).toBe(4);
  });
});
