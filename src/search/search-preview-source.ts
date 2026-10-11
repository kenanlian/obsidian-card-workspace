import { iterateSearchIndexTerms } from "../search-tokenization";
import { SEARCH_MARKDOWN_MAX_LENGTH } from "./document-preparation";
import { mapMarkdownSearchText } from "./mapped-search-text";

/** Query-independent source data; the owner validates the file version before reuse. */
export interface SearchPreviewSource {
  readonly source: string;
  readonly body: string;
  readonly starts: readonly number[];
  readonly matchOffsets: Int32Array;
  readonly displayOffsets: Int32Array;
  readonly reverse: Int32Array;
  readonly lineRanges: ReadonlyMap<number, { start: number; end: number }>;
  readonly terms: ReadonlyMap<string, readonly number[]>;
  readonly fencedRanges: readonly number[];
  readonly estimatedBytes: number;
}

function* compactOffsets(offsets: readonly number[]): Generator<unknown, Int32Array> {
  const result = new Int32Array(offsets.length);
  for (let index = 0; index < offsets.length; index += 1) {
    result[index] = offsets[index];
    if (index % 1024 === 0) yield;
  }
  return result;
}

function* boundSource(markdown: string): Generator<unknown, string> {
  if (markdown.length <= SEARCH_MARKDOWN_MAX_LENGTH) return markdown;
  // A sliced string can retain the entire oversized note. Copy bounded UTF-16
  // chunks so the source cache cannot keep that backing string alive.
  const chunks: string[] = [];
  for (let start = 0; start < SEARCH_MARKDOWN_MAX_LENGTH; start += 1024) {
    const codes: number[] = [];
    const end = Math.min(start + 1024, SEARCH_MARKDOWN_MAX_LENGTH);
    for (let index = start; index < end; index += 1) codes.push(markdown.charCodeAt(index));
    chunks.push(String.fromCharCode(...codes));
    yield;
  }
  return chunks.join("");
}

export function* prepareSearchPreviewSource(markdown: string): Generator<unknown, SearchPreviewSource> {
  const source = yield* boundSource(markdown);
  const mapped = yield* mapMarkdownSearchText(source);
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
    if (index % 1024 === 0) yield;
  }
  const body = mapped.readable?.text ?? mapped.text.slice(0, mapped.primaryLength ?? mapped.text.length);
  const matchOffsets = yield* compactOffsets(mapped.offsets);
  const displayOffsets = yield* compactOffsets(mapped.readable?.offsets ?? mapped.offsets.slice(0, body.length));
  const reverse = new Int32Array(source.length).fill(-1);
  const lineRanges = new Map<number, { start: number; end: number }>();
  let line = 0;
  // Readable source offsets preserve order. Advance the line once instead of
  // binary-searching the line table for every displayed character.
  for (let index = 0; index < body.length; index += 1) {
    const offset = displayOffsets[index];
    if (offset >= 0) {
      reverse[offset] = index;
      while (line + 1 < starts.length && starts[line + 1] <= offset) line += 1;
      const range = lineRanges.get(line);
      if (range) range.end = index + 1;
      else lineRanges.set(line, { start: index, end: index + 1 });
    }
    if (index % 1024 === 0) yield;
  }
  const terms = new Map<string, number[]>();
  let termBytes = 0;
  // Preserve the index tokenizer's order and cap, including expanded terms.
  // A subsequent query tests each distinct spelling once without retokenizing.
  for (const term of iterateSearchIndexTerms(mapped.text)) {
    yield;
    if (!term) continue;
    const positions = terms.get(term.text);
    if (positions) positions.push(term.start);
    else {
      terms.set(term.text, [term.start]);
      termBytes += 128 + term.text.length * 2;
    }
    termBytes += 16;
  }
  const fencedRanges = mapped.fencedRanges ?? [];
  // Include possible backing strings retained by sliced token spellings and
  // conservative array/map overhead, as well as compact offset buffers.
  const estimatedBytes = (source.length + body.length + mapped.text.length) * 2
    + matchOffsets.byteLength + displayOffsets.byteLength + reverse.byteLength
    + starts.length * 16 + fencedRanges.length * 16 + lineRanges.size * 128 + termBytes;
  return { source, body, starts, matchOffsets, displayOffsets, reverse, lineRanges, terms, fencedRanges, estimatedBytes };
}

interface SearchPreviewSourceEntry {
  readonly version: string;
  readonly prepared: SearchPreviewSource;
}

/** Per-view LRU, bounded by both file count and estimated retained bytes. */
export class SearchPreviewSourceCache {
  private readonly entries = new Map<string, SearchPreviewSourceEntry>();
  private retainedBytes = 0;

  constructor(private readonly maxBytes = 16 * 1024 * 1024, private readonly maxEntries = 64) {}

  get(path: string, version: string): SearchPreviewSource | undefined {
    const entry = this.entries.get(path);
    if (!entry) return undefined;
    if (entry.version !== version) {
      this.invalidateExact(path);
      return undefined;
    }
    this.entries.delete(path);
    this.entries.set(path, entry);
    return entry.prepared;
  }

  set(path: string, version: string, prepared: SearchPreviewSource): void {
    this.invalidateExact(path);
    if (prepared.estimatedBytes > this.maxBytes || this.maxEntries <= 0) return;
    this.entries.set(path, { version, prepared });
    this.retainedBytes += prepared.estimatedBytes;
    while (this.retainedBytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.invalidateExact(oldest.value);
    }
  }

  invalidateExact(path: string): void {
    const entry = this.entries.get(path);
    if (!entry) return;
    this.retainedBytes -= entry.prepared.estimatedBytes;
    this.entries.delete(path);
  }

  invalidatePrefix(prefix: string): void {
    for (const path of this.entries.keys()) {
      if (path === prefix || path.startsWith(`${prefix}/`)) this.invalidateExact(path);
    }
  }

  clear(): void {
    this.entries.clear();
    this.retainedBytes = 0;
  }
}
