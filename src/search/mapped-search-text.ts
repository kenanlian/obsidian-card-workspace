import {
  FRONTMATTER_PATTERN, getFenceInfo, isFenceClosingLine,
  MARKDOWN_SEARCH_REPLACEMENTS, searchReplacementText,
} from "./markdown-search-text";
import { SEARCH_MARKDOWN_MAX_LENGTH } from "./document-preparation";

export interface MappedSearchText {
  text: string;
  /** UTF-16 source offsets; -1 identifies a synthetic separator. */
  offsets: number[];
  /** Boundary before separator-expanded duplicates; these never add new terms. */
  primaryLength?: number;
  /** Presentation body preserves literal inline code; matching still uses text. */
  readable?: { text: string; offsets: number[] };
  /** Paired source offsets for fenced bodies; no per-character presentation metadata. */
  fencedRanges?: number[];
}

const COPY_CHUNK = 1024;

function* copyOffsets(target: number[], source: readonly number[], start: number, end: number) {
  for (let index = start; index < end; index += 1) {
    target.push(source[index]);
    if ((index - start + 1) % COPY_CHUNK === 0) yield;
  }
}

function* join(parts: readonly MappedSearchText[]): Generator<unknown, MappedSearchText> {
  const text: string[] = [];
  const offsets: number[] = [];
  for (const part of parts) {
    if (!part.text) continue;
    if (text.length) { text.push(" "); offsets.push(-1); }
    text.push(part.text);
    yield* copyOffsets(offsets, part.offsets, 0, part.offsets.length);
    yield;
  }
  return { text: text.join(""), offsets };
}

/** Every replacement copies the retained capture's original character positions. */
function* replace(
  source: MappedSearchText, pattern: RegExp,
  replacement: (match: RegExpMatchArray) => { text: string; start: number },
  matches: Iterable<RegExpMatchArray | undefined> = source.text.matchAll(pattern),
): Generator<unknown, MappedSearchText> {
  const text: string[] = [];
  const offsets: number[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (!match) { yield; continue; }
    const start = match.index ?? 0;
    text.push(source.text.slice(cursor, start));
    yield* copyOffsets(offsets, source.offsets, cursor, start);
    const next = replacement(match);
    text.push(next.text);
    if (next.start >= 0) {
      yield* copyOffsets(offsets, source.offsets, next.start, next.start + next.text.length);
    } else {
      for (let index = 0; index < next.text.length; index += 1) offsets.push(-1);
    }
    cursor = start + match[0].length;
    yield;
  }
  if (!text.length) return source;
  text.push(source.text.slice(cursor));
  yield* copyOffsets(offsets, source.offsets, cursor, source.offsets.length);
  return { text: text.join(""), offsets };
}

function* ruleMatches(text: string, rule: typeof MARKDOWN_SEARCH_REPLACEMENTS[number]) {
  if (!rule.opener || !rule.boundary) { yield* text.matchAll(rule.pattern); return; }
  if (rule.closer && !text.includes(rule.closer)) return;
  const anchored = new RegExp(`^(?:${rule.pattern.source})`);
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(rule.opener, cursor);
    if (start < 0) return;
    const match = anchored.exec(text.slice(start));
    if (match) {
      match.index = start;
      yield match;
      cursor = start + match[0].length;
    } else {
      // Nested openers before the same first delimiter share this failed
      // suffix. Skip them together, avoiding quadratic regex retries on a
      // long malformed Markdown line, while preserving global replace order.
      const bodyStart = start + rule.opener.length;
      const boundary = text.slice(bodyStart).search(rule.boundary);
      cursor = boundary < 0 ? text.length : bodyStart + boundary;
    }
    yield;
  }
}

function* collapse(source: MappedSearchText): Generator<unknown, MappedSearchText> {
  // Most joined prose is already collapsed. Preserve its offsets instead of
  // allocating and copying another full character map for every single space.
  if (!/^\s|\s$|[^\S ]| {2}/.test(source.text)) return source;
  const collapsed = yield* replace(source, /\s+/g, (match) => ({ text: " ", start: match.index ?? 0 }));
  const left = collapsed.text.startsWith(" ") ? 1 : 0;
  const end = collapsed.text.endsWith(" ") ? collapsed.text.length - 1 : collapsed.text.length;
  return { text: collapsed.text.slice(left, end), offsets: collapsed.offsets.slice(left, end) };
}

function captureStart(match: RegExpMatchArray, group: number): number {
  // These patterns have one retained body. A wiki alias starts after the final '|'.
  return (match.index ?? 0) + (group === 2 ? match[0].indexOf("|") + 1 : match[0].indexOf(match[group], 1));
}

function* normalize(source: MappedSearchText): Generator<unknown, MappedSearchText> {
  if (!/[[#$\\`*_~=>]|^\s*(?:[-+]\s|\d+\.\s)/.test(source.text)) return yield* collapse(source);
  for (const rule of MARKDOWN_SEARCH_REPLACEMENTS) {
    source = yield* replace(source, rule.pattern, (match) => {
      const text = searchReplacementText(rule, match);
      const group = rule.aliasGroup && match[rule.aliasGroup] !== undefined ? rule.aliasGroup : rule.group;
      return { text, start: group && text === match[group] ? captureStart(match, group) : -1 };
    }, ruleMatches(source.text, rule));
    yield;
  }
  return yield* collapse(source);
}

function* readableLine(source: MappedSearchText): Generator<unknown, MappedSearchText> {
  const parts: MappedSearchText[] = [];
  let cursor = 0;
  for (const match of source.text.matchAll(/`([^`]*)`/g)) {
    const start = match.index;
    parts.push(yield* normalize({ text: source.text.slice(cursor, start), offsets: source.offsets.slice(cursor, start) }));
    parts.push({ text: match[1], offsets: source.offsets.slice(start + 1, start + 1 + match[1].length) });
    cursor = start + match[0].length;
    yield;
  }
  if (!cursor) return yield* normalize(source);
  parts.push(yield* normalize({ text: source.text.slice(cursor), offsets: source.offsets.slice(cursor) }));
  return yield* collapse(yield* join(parts));
}

function* expand(source: MappedSearchText): Generator<unknown, MappedSearchText> {
  if (!/[._/\\-]/.test(source.text) || !/[A-Za-z0-9]/.test(source.text)) return { text: "", offsets: [] };
  const parts: MappedSearchText[] = [];
  for (const match of source.text.matchAll(/\S+/g)) {
    const token = match[0];
    if (/[._/\\-]/.test(token) && /[A-Za-z0-9]/.test(token)) {
      const offsets: number[] = [];
      yield* copyOffsets(offsets, source.offsets, match.index, match.index + token.length);
      const replaced = yield* replace({ text: token, offsets }, /[._/\\-]+/g, () => ({ text: " ", start: -1 }));
      const expanded = yield* collapse(replaced);
      if (expanded.text && expanded.text !== token) parts.push(expanded);
    }
    yield;
  }
  return yield* join(parts);
}

/** Same frontmatter, fences, normalizer and expanded-tail order as index preparation. */
export function* mapMarkdownSearchText(markdown: string): Generator<unknown, MappedSearchText> {
  const bounded = markdown.slice(0, SEARCH_MARKDOWN_MAX_LENGTH);
  const bodyStart = bounded.match(FRONTMATTER_PATTERN)?.[0].length ?? 0;
  const parts: MappedSearchText[] = [];
  const expanded: MappedSearchText[] = [];
  const readable: MappedSearchText[] = [];
  let fence: ReturnType<typeof getFenceInfo> = null;
  let fenceParts: MappedSearchText[] = [];
  const fencedRanges: number[] = [];
  function* append(part: MappedSearchText, display = part) {
    if (display.text) readable.push(display);
    if (!part.text) return;
    parts.push(part);
    const extra = yield* expand(part);
    if (extra.text) expanded.push(extra);
  }
  let start = bodyStart;
  while (start <= bounded.length) {
    const newline = bounded.indexOf("\n", start);
    const end = newline < 0 ? bounded.length : newline;
    const lineEnd = bounded[end - 1] === "\r" && newline >= 0 ? end - 1 : end;
    const line = bounded.slice(start, lineEnd);
    const trimmed = line.trim();
    if (fence && isFenceClosingLine(trimmed, fence.marker, fence.size)) {
      fencedRanges.push(start);
      yield* append(yield* collapse(yield* join(fenceParts)));
      fence = null;
      fenceParts = [];
    } else if (!fence && getFenceInfo(trimmed)) {
      fence = getFenceInfo(trimmed);
      fencedRanges.push(end + 1);
    } else if (fence || trimmed) {
      const offsets: number[] = [];
      for (let index = start; index < lineEnd; index += 1) {
        offsets.push(index);
        if ((index - start + 1) % COPY_CHUNK === 0) yield;
      }
      const part = { text: line, offsets };
      if (fence) fenceParts.push(part);
      else {
        const normalized = yield* normalize(part);
        const display = line.includes("`") ? yield* readableLine(part) : normalized;
        yield* append(normalized, display);
      }
    }
    yield;
    if (newline < 0) break;
    start = end + 1;
  }
  if (fence) {
    fencedRanges.push(bounded.length);
    yield* append(yield* collapse(yield* join(fenceParts)));
  }
  const mapped = yield* collapse(yield* join([...parts, ...expanded]));
  mapped.readable = yield* collapse(yield* join(readable));
  mapped.fencedRanges = fencedRanges;
  mapped.primaryLength = parts.reduce((length, part) => length + part.text.length, 0) + Math.max(0, parts.length - 1);
  return mapped;
}
