import { isValidIsoDate, type TaskDateKind } from "./task-dates";

export interface TextSpan {
  readonly from: number;
  readonly to: number;
}

export interface ParsedTaskDate {
  readonly kind: TaskDateKind;
  readonly value: string;
  readonly valid: boolean;
  readonly span: TextSpan;
}

export interface ParsedTaskLine {
  readonly prefix: string;
  readonly statusChar: string;
  readonly statusSpan: TextSpan;
  readonly completed: boolean;
  readonly bodySpan: TextSpan;
  readonly description: string;
  readonly dates: Readonly<Partial<Record<TaskDateKind, ParsedTaskDate>>>;
  readonly dateTokens: readonly ParsedTaskDate[];
  readonly blockId: string | null;
  readonly insertionOffset: number;
}

/** Canonical writers. Due reads also accept U+1F4C6 and U+1F5D3. */
export const TASK_DATE_MARKERS: Readonly<Record<TaskDateKind, string>> = {
  created: "\u2795",
  done: "\u2705",
  due: "\u{1F4C5}",
};

const CREATED_MARKER = TASK_DATE_MARKERS.created;
const DONE_MARKER = TASK_DATE_MARKERS.done;
const DUE_MARKER = TASK_DATE_MARKERS.due;
const DUE_CALENDAR_MARKER = "\u{1F4C6}";
const DUE_TEAR_OFF_MARKER = "\u{1F5D3}";

/**
 * Indent, then blockquote markers (`>` plus the following indent), then a list
 * marker and its spacing. Nested items inside quotes stay one task line.
 * A trailing CR is optional because `.` does not consume it.
 */
const TASK_LINE_PATTERN = /^([ \t]*(?:>[ \t]*)*)((?:[-*+]|\d+[.)])[ \t]+)\[(.)\](.*)\r?$/u;

/** Any status other than a single space counts as complete. */
export function isCompletedStatusChar(statusChar: string): boolean {
  return statusChar !== " ";
}

export function parseTaskLine(line: string): ParsedTaskLine | null {
  const match = TASK_LINE_PATTERN.exec(line);
  if (match === null) {
    return null;
  }
  const indent = match[1] ?? "";
  const marker = match[2] ?? "";
  const statusChar = match[3] ?? "";
  const rest = match[4] ?? "";
  if (rest !== "" && !/^\s/u.test(rest)) {
    return null;
  }

  const prefix = indent + marker;
  const statusFrom = prefix.length + 1;
  const statusSpan: TextSpan = { from: statusFrom, to: statusFrom + statusChar.length };
  const afterBracket = statusSpan.to + 1;
  const bodyFrom = line[afterBracket] === " " ? afterBracket + 1 : afterBracket;
  const bodySpan: TextSpan = { from: bodyFrom, to: line.length };
  const dateTokens = readDateTokens(line, bodySpan);
  const { blockId, insertionOffset } = readTrailingBlock(line);
  return {
    prefix,
    statusChar,
    statusSpan,
    completed: isCompletedStatusChar(statusChar),
    bodySpan,
    description: buildDescription(line.slice(bodySpan.from, bodySpan.to), dateTokens, bodySpan.from, blockId),
    dates: firstValidDates(dateTokens),
    dateTokens,
    blockId,
    insertionOffset,
  };
}

function readDateTokens(line: string, bodySpan: TextSpan): ParsedTaskDate[] {
  const body = line.slice(bodySpan.from, bodySpan.to);
  const pattern = /(\u2795|\u2705|\u{1F4C5}|\u{1F4C6}|\u{1F5D3})\uFE0F?[ ]*(\d{4}-\d{2}-\d{2})/gu;
  const tokens: ParsedTaskDate[] = [];
  let match = pattern.exec(body);
  while (match !== null) {
    const marker = match[1] ?? "";
    const value = match[2] ?? "";
    const kind = dateKind(marker);
    if (kind !== null) {
      const from = bodySpan.from + match.index;
      tokens.push({
        kind,
        value,
        valid: isValidIsoDate(value),
        span: { from, to: from + match[0].length },
      });
    }
    match = pattern.exec(body);
  }
  return tokens;
}

function dateKind(marker: string): TaskDateKind | null {
  if (marker === CREATED_MARKER) {
    return "created";
  }
  if (marker === DONE_MARKER) {
    return "done";
  }
  if (marker === DUE_MARKER || marker === DUE_CALENDAR_MARKER || marker === DUE_TEAR_OFF_MARKER) {
    return "due";
  }
  return null;
}

function firstValidDates(tokens: readonly ParsedTaskDate[]): Partial<Record<TaskDateKind, ParsedTaskDate>> {
  const dates: Partial<Record<TaskDateKind, ParsedTaskDate>> = {};
  for (const token of tokens) {
    if (!token.valid || dates[token.kind] !== undefined) {
      continue;
    }
    dates[token.kind] = token;
  }
  return dates;
}

function readTrailingBlock(line: string): { blockId: string | null; insertionOffset: number } {
  let end = line.length;
  while (end > 0 && isTrailingWhitespace(line[end - 1] ?? "")) {
    end -= 1;
  }
  let idStart = end;
  while (idStart > 0 && isBlockIdChar(line[idStart - 1] ?? "")) {
    idStart -= 1;
  }
  if (idStart < end && idStart > 0 && line[idStart - 1] === "^") {
    const caret = idStart - 1;
    if (caret > 0 && isInlineWhitespace(line[caret - 1] ?? "")) {
      return { blockId: line.slice(idStart, end), insertionOffset: caret - 1 };
    }
  }
  return { blockId: null, insertionOffset: end };
}

function buildDescription(body: string, tokens: readonly ParsedTaskDate[], bodyFrom: number, blockId: string | null): string {
  const spans = tokens.map((token) => ({ from: token.span.from - bodyFrom, to: token.span.to - bodyFrom }));
  spans.sort((left, right) => right.from - left.from);
  let text = body;
  for (const span of spans) {
    text = text.slice(0, span.from) + text.slice(span.to);
  }
  if (blockId !== null) {
    text = withoutTrailingBlockId(text, blockId);
  }
  return text.replace(/\s+/g, " ").trim();
}

function withoutTrailingBlockId(text: string, blockId: string): string {
  let end = text.length;
  while (end > 0 && isTrailingWhitespace(text[end - 1] ?? "")) {
    end -= 1;
  }
  const suffix = `^${blockId}`;
  if (!text.slice(0, end).endsWith(suffix)) {
    return text;
  }
  let start = end - suffix.length;
  if (start > 0 && isInlineWhitespace(text[start - 1] ?? "")) {
    start -= 1;
  }
  return text.slice(0, start) + text.slice(end);
}

function isBlockIdChar(char: string): boolean {
  return (char >= "A" && char <= "Z") || (char >= "a" && char <= "z") || (char >= "0" && char <= "9") || char === "-";
}

function isInlineWhitespace(char: string): boolean {
  return char === " " || char === "\t";
}

function isTrailingWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\r";
}
