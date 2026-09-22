import type MiniSearch from "minisearch";
import type { SearchableDocument } from "./types";

/**
 * Emitted-term budget that bounds one continuous ingestion slice.
 *
 * Yielding on document count is wrong in both directions: ten oversized
 * documents are a single multi-hundred-millisecond slice, while ten ordinary
 * notes are a yield boundary that buys nothing and costs a clamped timer.
 * A term budget scales the yield interval with the work actually done.
 */
export const INGEST_YIELD_TERM_BUDGET = 20_000;

/**
 * Upper bound on the terms `tokenizeSearchIndexText` can emit for a document.
 *
 * Han runs emit one unigram plus one overlapping bigram per code point, so a
 * Han-dense field approaches two terms per character; every other script emits
 * strictly fewer. Counting characters without the factor of two is a lower
 * bound, which would let a yield interval run past the budget.
 */
function estimateEmittedTerms(document: SearchableDocument): number {
  return 2 * (document.title.length + document.content.length);
}

/**
 * Adds documents to `index` in list order, yielding to the event loop whenever
 * the accumulated term estimate reaches `INGEST_YIELD_TERM_BUDGET`.
 *
 * The accumulator is threaded through the caller so a read-window boundary
 * does not silently reset it back into a fixed-count yield. Ingestion stops
 * early when the signal aborts or `isCurrent()` goes stale; both guards are
 * required because `isCurrent()` can flip across a yield without the signal
 * aborting. A partially populated index is safe: the caller discards the
 * replacement unless `isCurrent()` still holds at cutover.
 *
 * @returns the carry-over term count for the next batch.
 */
export async function addDocumentsWithYield(
  index: MiniSearch<SearchableDocument>,
  documents: readonly SearchableDocument[],
  carryOverTerms: number,
  isCurrent: () => boolean,
  signal?: AbortSignal,
): Promise<number> {
  let accumulated = carryOverTerms;
  for (const document of documents) {
    if (signal?.aborted || !isCurrent()) return accumulated;
    index.add(document);
    accumulated += estimateEmittedTerms(document);
    if (accumulated < INGEST_YIELD_TERM_BUDGET) continue;
    accumulated = 0;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return accumulated;
}
