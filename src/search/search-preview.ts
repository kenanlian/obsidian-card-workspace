import { shouldUsePrefixSearch, tokenizeSearchQuery } from "../search-tokenization";
import { runSearchTask, type SearchTaskDiagnostics } from "./cooperative-task";
import { prepareSearchPreviewSource, type SearchPreviewSource } from "./search-preview-source";
import { buildSearchSnippetPresentation, type SearchSnippetPresentation } from "./snippet-presentation";

export interface SearchTextRange { start: number; end: number }
export interface SearchSourcePosition { line: number; ch: number }
export interface SearchSnippetLocation {
  from: SearchSourcePosition;
  to: SearchSourcePosition;
  offset: number;
  /** Exact source text plus bounded context, used after the file is opened. */
  text: string;
  before: string;
  after: string;
}
export interface SearchPreviewSnippet {
  id: string;
  text: string;
  highlights: SearchTextRange[];
  location: SearchSnippetLocation;
  presentation?: SearchSnippetPresentation;
}
export interface SearchPreview {
  query: string;
  revision: number;
  mtime: number;
  previewLines: number;
  snippetLimit: number;
  status: "hits" | "title-only" | "unavailable";
  snippets: SearchPreviewSnippet[];
}

interface PrefixNode { terminal?: string; children: Map<string, PrefixNode> }

/** Reused by a view for the lifetime of its committed query. */
export function createSearchPreviewMatcher(query: string): (term: string) => number {
  const exact = new Set<string>();
  const root: PrefixNode = { children: new Map() };
  for (const term of tokenizeSearchQuery(query).map((value) => value.toLowerCase())) {
    if (!shouldUsePrefixSearch(term)) { exact.add(term); continue; }
    let node = root;
    for (const point of term) {
      let child = node.children.get(point);
      if (!child) { child = { children: new Map() }; node.children.set(point, child); }
      node = child;
    }
    node.terminal = term;
  }
  return (term) => {
    const normalized = term.toLowerCase();
    if (exact.has(normalized)) return term.length;
    let node = root;
    let prefix: string | undefined;
    for (const point of normalized) {
      const child = node.children.get(point);
      if (!child) break;
      node = child;
      if (node.terminal) prefix = node.terminal;
    }
    if (!prefix) return 0;
    // Unicode lowercase may change UTF-16 length (e.g. U+0130).
    let length = 0;
    let lowerLength = 0;
    for (const point of term) {
      length += point.length;
      lowerLength += point.toLowerCase().length;
      if (lowerLength >= prefix.length) break;
    }
    return length;
  };
}

export interface SearchPreviewExtractionOptions {
  limit: number;
  maxChars?: number;
  idPrefix: string;
  matcher: (term: string) => number;
  isCurrent?: () => boolean;
  onDiagnostics?: (diagnostics: SearchTaskDiagnostics) => void;
  onPrepared?: (source: SearchPreviewSource) => void;
}

function findLine(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const mid = (low + high) >>> 1;
    if (starts[mid] <= offset) low = mid;
    else high = mid;
  }
  return low;
}

function isLowSurrogate(code: number): boolean { return code >= 0xdc00 && code <= 0xdfff; }

function mergeRanges(ranges: SearchTextRange[]): SearchTextRange[] {
  const merged: SearchTextRange[] = [];
  for (const range of ranges.sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function* collectSnippets(input: string | SearchPreviewSource, options: SearchPreviewExtractionOptions, phases: Record<string, number>): Generator<unknown, SearchPreviewSnippet[]> {
  const startTime = performance.now();
  const limit = Math.max(0, Math.floor(options.limit));
  if (!limit) return [];
  const prepared = typeof input === "string" ? yield* prepareSearchPreviewSource(input) : input;
  if (typeof input === "string") options.onPrepared?.(prepared);
  const { source, body, starts, matchOffsets, displayOffsets, reverse, lineRanges, terms, fencedRanges } = prepared;
  const preparedTime = performance.now();
  phases.mappingMs = preparedTime - startTime;
  const maxChars = Math.max(4, Math.min(200, options.maxChars ?? 200));
  // The expanded tail participates in the index term budget and matching,
  // but all display ranges point back into the readable primary body.
  const hits: SearchTextRange[] = [];
  for (const [term, positions] of terms) {
    yield;
    const length = options.matcher(term);
    if (!length) continue;
    for (let index = 0; index < positions.length; index += 1) {
      const start = positions[index];
      const from = matchOffsets[start];
      const to = matchOffsets[start + length - 1];
      if (from >= 0 && to >= from && reverse[from] >= 0 && reverse[to] >= 0) {
        hits.push({ start: reverse[from], end: reverse[to] + 1 });
      }
      if (index % 1024 === 0) yield;
    }
  }
  const merged = mergeRanges(hits);
  const matchedTime = performance.now();
  phases.budgetedMatchingMs = matchedTime - preparedTime;
  const snippets: SearchPreviewSnippet[] = [];
  let formattingMs = 0;
  let previousEnd = 0;
  for (let hitIndex = 0; hitIndex < merged.length && snippets.length < limit; hitIndex += 1) {
    const first = merged[hitIndex];
    if (first.start < previousEnd) continue;
    const offset = displayOffsets[first.start];
    const line = findLine(starts, offset);
    const lineRange = lineRanges.get(line)!;
    // A short hit line borrows consecutive prose, stopping at structural
    // boundaries. Fenced code retains its literal text and stops at its fence.
    let blockEnd = lineRange.end;
    for (let next = line + 1; next < starts.length; next += 1) {
      const raw = source.slice(starts[next], starts[next + 1] ?? source.length).trim();
      if (!raw || /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|`{3,}|~{3,})/.test(raw)) break;
      const range = lineRanges.get(next);
      if (!range) break;
      blockEnd = range.end;
      if (blockEnd - first.start >= maxChars) break;
      yield;
    }
    let start = Math.max(lineRange.start,
      first.start - Math.min(60, Math.max(0, maxChars - 2 - (first.end - first.start))));
    // A context that overlaps the previous capped window does not create a
    // duplicate snippet; keep looking for a later independent context.
    if (start < previousEnd) continue;
    if (isLowSurrogate(body.charCodeAt(start))) start += 1;
    let prefix = start > lineRange.start ? "…" : "";
    let end = Math.min(blockEnd, start + maxChars - prefix.length - 1);
    // If an overlapping context can fit by spending less on the preceding
    // text, include its hit in this same 200-unit window. Never crop the target.
    for (let index = hitIndex + 1; index < merged.length; index += 1) {
      const next = merged[index];
      if (next.start < end) continue;
      if (next.start >= blockEnd || next.start - 60 >= end
        || next.end - first.start + 2 > maxChars) break;
      start = Math.max(start, next.end + 2 - maxChars);
      if (isLowSurrogate(body.charCodeAt(start))) start += 1;
      prefix = start > lineRange.start ? "…" : "";
      end = Math.min(blockEnd, start + maxChars - prefix.length - 1);
      yield;
    }
    if (isLowSurrogate(body.charCodeAt(end))) end -= 1;
    const suffix = end < blockEnd ? "…" : "";
    // Every hit inside this context is represented once; overlapping contexts
    // collapse into this window, leaving room for later independent snippets.
    const highlights: SearchTextRange[] = [];
    for (let index = hitIndex; index < merged.length && merged[index].start < end; index += 1) {
      const range = merged[index];
      highlights.push({ start: range.start - start + prefix.length,
        end: Math.min(end, range.end) - start + prefix.length });
    }
    const targetEnd = displayOffsets[Math.min(end, first.end) - 1] + 1;
    const endLine = findLine(starts, targetEnd);
    const snippet: SearchPreviewSnippet = {
      id: `${options.idPrefix}:${line}:${offset - starts[line]}`,
      text: prefix + body.slice(start, end) + suffix,
      highlights,
      location: {
        from: { line, ch: offset - starts[line] },
        to: { line: endLine, ch: targetEnd - starts[endLine] },
        offset,
        text: source.slice(offset, targetEnd),
        before: source.slice(Math.max(0, offset - 32), offset),
        after: source.slice(targetEnd, Math.min(source.length, targetEnd + 32)),
      },
    };
    let lastOffsetIndex = end - 1;
    while (lastOffsetIndex > start && displayOffsets[lastOffsetIndex] < 0) lastOffsetIndex -= 1;
    const sourceEnd = displayOffsets[lastOffsetIndex];
    const lastLine = findLine(starts, Math.max(offset, sourceEnd));
    const contextOffsets = [-1, ...displayOffsets.subarray(start, end), -1].slice(prefix ? 0 : 1, suffix ? undefined : -1);
    const ranges = fencedRanges;
    let low = 0, high = ranges.length;
    while (low < high) { const mid = (low + high) >>> 1; if (ranges[mid] <= offset) low = mid + 1; else high = mid; }
    const formatStart = performance.now();
    snippet.presentation = yield* buildSearchSnippetPresentation(source, snippet, contextOffsets,
      starts[line], starts[lastLine + 1] ?? source.length, low % 2 === 1);
    formattingMs += performance.now() - formatStart;
    snippets.push(snippet);
    previousEnd = end;
    yield;
  }
  phases.collectionMs = performance.now() - matchedTime;
  phases.formattingMs = formattingMs;
  return snippets;
}

export function extractSearchPreviewSnippets(markdown: string | SearchPreviewSource, options: SearchPreviewExtractionOptions) {
  const phases: Record<string, number> = {};
  return runSearchTask(collectSnippets(markdown, options, phases), options.isCurrent,
    (diagnostics) => options.onDiagnostics?.({ ...diagnostics, phases }));
}

/** Validate the saved offset first; relocate only a unique text+context match. */
export function* resolveSearchSnippetLocationTask(
  source: string, saved: SearchSnippetLocation,
): Generator<unknown, { from: SearchSourcePosition; to: SearchSourcePosition } | null> {
  const validAt = (offset: number) => source.slice(offset, offset + saved.text.length) === saved.text
    && source.slice(Math.max(0, offset - saved.before.length), offset) === saved.before
    && source.slice(offset + saved.text.length, offset + saved.text.length + saved.after.length) === saved.after;
  if (!saved.text) return null;
  let offset = saved.offset;
  if (!validAt(offset)) {
    const needle = saved.before + saved.text + saved.after;
    let found = -1;
    // Overlapping bounded windows avoid an unbounded full-file indexOf call.
    const chunk = Math.max(4096, needle.length * 2);
    for (let start = 0; start < source.length; start += chunk) {
      const window = source.slice(start, start + chunk + needle.length);
      let cursor = 0;
      while (cursor < chunk) {
        const hit = window.indexOf(needle, cursor);
        if (hit < 0 || hit >= chunk) break;
        const candidate = start + hit + saved.before.length;
        if (found >= 0 && found !== candidate) return null;
        found = candidate;
        cursor = hit + 1;
        yield;
      }
      yield;
    }
    if (found < 0) return null;
    offset = found;
  }
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") { line += 1; lineStart = index + 1; }
    if (index % 1024 === 0) yield;
  }
  const from = { line, ch: offset - lineStart };
  for (let index = offset; index < offset + saved.text.length; index += 1) {
    if (source[index] === "\n") { line += 1; lineStart = index + 1; }
    if (index % 1024 === 0) yield;
  }
  return { from, to: { line, ch: offset + saved.text.length - lineStart } };
}

export function resolveSearchSnippetLocation(source: string, saved: SearchSnippetLocation, isCurrent?: () => boolean) {
  return runSearchTask(resolveSearchSnippetLocationTask(source, saved), isCurrent);
}
