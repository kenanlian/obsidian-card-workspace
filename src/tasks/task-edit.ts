import { isValidIsoDate, type TaskDateKind } from "./task-dates";
import { parseTaskLine, TASK_DATE_MARKERS, type ParsedTaskDate, type TextSpan } from "./task-line";

export interface LinePatch {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface TaskStatusOptions {
  readonly today: string;
  readonly autoDoneDate: boolean;
}

export interface LineEditResult {
  readonly patches: LinePatch[];
  readonly cursor: number;
}

const CHECKBOX_SUFFIX = "[ ] ";
const TASK_PREFIX = "- [ ] ";

/** Patches are sorted and original-line offsets, so later patches are applied first. */
export function applyLinePatches(line: string, patches: readonly LinePatch[]): string {
  let next = line;
  for (let index = patches.length - 1; index >= 0; index -= 1) {
    const patch = patches[index];
    if (patch === undefined) {
      continue;
    }
    next = next.slice(0, patch.from) + patch.insert + next.slice(patch.to);
  }
  return next;
}

export function setTaskStatus(line: string, completed: boolean, options: TaskStatusOptions): LinePatch[] | null {
  const parsed = parseTaskLine(line);
  if (parsed === null) {
    return null;
  }
  const patches: LinePatch[] = [];
  if (completed) {
    if (parsed.statusChar === " ") {
      patches.push({ from: parsed.statusSpan.from, to: parsed.statusSpan.to, insert: "x" });
    }
    if (options.autoDoneDate && parsed.dates.done === undefined) {
      const dated = setTaskDate(line, "done", options.today);
      if (dated !== null) {
        patches.push(...dated);
      }
    }
  } else {
    if (parsed.statusChar !== " ") {
      patches.push({ from: parsed.statusSpan.from, to: parsed.statusSpan.to, insert: " " });
    }
    if (options.autoDoneDate && parsed.dateTokens.some((token) => token.kind === "done")) {
      const cleared = setTaskDate(line, "done", null);
      if (cleared !== null) {
        patches.push(...cleared);
      }
    }
  }
  return finishPatches(line, patches);
}

export function toggleTaskStatus(line: string, options: TaskStatusOptions): LinePatch[] | null {
  const parsed = parseTaskLine(line);
  if (parsed === null) {
    return null;
  }
  return setTaskStatus(line, !parsed.completed, options);
}

export function setTaskDate(line: string, kind: TaskDateKind, value: string | null): LinePatch[] | null {
  const parsed = parseTaskLine(line);
  if (parsed === null || (value !== null && !isValidIsoDate(value))) {
    return null;
  }
  const tokens = parsed.dateTokens.filter((token) => token.kind === kind);
  if (value === null) {
    return tokens.length === 0 ? null : finishPatches(line, removalPatches(line, tokens));
  }
  const canonical = `${TASK_DATE_MARKERS[kind]} ${value}`;
  if (tokens.length === 0) {
    const insert = dateInsertion(line, parsed.insertionOffset, kind, value);
    return finishPatches(line, [{ from: parsed.insertionOffset, to: parsed.insertionOffset, insert }]);
  }
  const patches: LinePatch[] = [];
  const first = tokens[0];
  if (first !== undefined && line.slice(first.span.from, first.span.to) !== canonical) {
    patches.push({ from: first.span.from, to: first.span.to, insert: canonical });
  }
  if (tokens.length > 1) {
    patches.push(...removalPatches(line, tokens.slice(1)));
  }
  return finishPatches(line, patches);
}

export function convertLineToTask(line: string, createdDate: string | null): LineEditResult | null {
  if (parseTaskLine(line) !== null) {
    return null;
  }
  const content = line.slice(structuralPrefixLength(line));
  if (isHeading(content) || isFence(content) || isTableRow(content) || isHorizontalRule(content)) {
    return null;
  }
  if (/^[ \t\r]*$/u.test(line)) {
    return convertBlankLine(line, createdDate);
  }
  const contentStart = listContentStart(line);
  if (contentStart !== null) {
    return convertMarkedLine(line, contentStart, CHECKBOX_SUFFIX, createdDate);
  }
  return convertMarkedLine(line, structuralPrefixLength(line), TASK_PREFIX, createdDate);
}

function convertBlankLine(line: string, createdDate: string | null): LineEditResult {
  let kept = 0;
  while (kept < line.length && isPaddingWhitespace(line[kept] ?? "")) {
    kept += 1;
  }
  let insert = TASK_PREFIX;
  if (createdDate !== null && isValidIsoDate(createdDate)) {
    insert += ` ${TASK_DATE_MARKERS.created} ${createdDate}`;
  }
  // The caret sits in the gap after `- [ ] `, before a created date's own space.
  return {
    patches: [{ from: kept, to: line.length, insert }],
    cursor: kept + TASK_PREFIX.length,
  };
}

function convertMarkedLine(line: string, at: number, checkbox: string, createdDate: string | null): LineEditResult {
  const intermediate = line.slice(0, at) + checkbox + line.slice(at);
  const date = createdDate !== null && isValidIsoDate(createdDate) ? createdDate : null;
  const parsed = date === null ? null : parseTaskLine(intermediate);
  const createdExists = parsed?.dateTokens.some((token) => token.kind === "created") ?? false;
  if (parsed === null || date === null || createdExists) {
    return { patches: [{ from: at, to: at, insert: checkbox }], cursor: intermediate.length };
  }
  const dateAt = parsed.insertionOffset;
  const dateText = dateInsertion(intermediate, dateAt, "created", date);
  const patches = conversionPatches(at, checkbox, dateAt, dateText);
  return {
    patches,
    cursor: cursorBeforeInsertedMarker(applyLinePatches(line, patches), dateAt, dateText),
  };
}

function conversionPatches(at: number, checkbox: string, dateAt: number, dateText: string): LinePatch[] {
  const checkboxEnd = at + checkbox.length;
  if (dateAt < checkboxEnd) {
    const relative = dateAt - at;
    return [{
      from: at,
      to: at,
      insert: checkbox.slice(0, relative) + dateText + checkbox.slice(relative),
    }];
  }
  const originalAt = dateAt - checkbox.length;
  if (originalAt === at) {
    return [{ from: at, to: at, insert: checkbox + dateText }];
  }
  return [
    { from: at, to: at, insert: checkbox },
    { from: originalAt, to: originalAt, insert: dateText },
  ];
}

function cursorBeforeInsertedMarker(finalLine: string, dateTextStart: number, dateText: string): number {
  const markerOffset = dateText.indexOf(TASK_DATE_MARKERS.created);
  const markerIndex = dateTextStart + (markerOffset < 0 ? 0 : markerOffset);
  if (markerIndex > 0 && isPaddingWhitespace(finalLine[markerIndex - 1] ?? "")) {
    return markerIndex - 1;
  }
  return markerIndex;
}

function dateInsertion(line: string, offset: number, kind: TaskDateKind, value: string): string {
  let insert = `${TASK_DATE_MARKERS[kind]} ${value}`;
  const previous = offset > 0 ? line[offset - 1] : undefined;
  const next = offset < line.length ? line[offset] : undefined;
  if (previous !== undefined && !isPaddingWhitespace(previous)) {
    insert = ` ${insert}`;
  }
  if (next !== undefined && !isPaddingWhitespace(next)) {
    insert = `${insert} `;
  }
  return insert;
}

/** Drop exactly one adjacent U+0020, preferring the character before the token. */
function removalPatches(line: string, tokens: readonly ParsedTaskDate[]): LinePatch[] {
  const blocked: TextSpan[] = tokens.map((token) => token.span);
  const patches: LinePatch[] = [];
  for (const token of tokens) {
    const span = expandedRemoval(line, token.span, blocked);
    patches.push({ from: span.from, to: span.to, insert: "" });
    blocked.push(span);
  }
  return patches;
}

function expandedRemoval(line: string, span: TextSpan, blocked: readonly TextSpan[]): TextSpan {
  const before = span.from - 1;
  if (before >= 0 && line[before] === " " && !indexCovered(blocked, before)) {
    return { from: before, to: span.to };
  }
  const after = span.to;
  if (after < line.length && line[after] === " " && !indexCovered(blocked, after)) {
    return { from: span.from, to: after + 1 };
  }
  return span;
}

function indexCovered(spans: readonly TextSpan[], index: number): boolean {
  return spans.some((span) => index >= span.from && index < span.to);
}

function finishPatches(line: string, patches: readonly LinePatch[]): LinePatch[] | null {
  if (patches.length === 0) {
    return null;
  }
  const sorted = [...patches].sort((left, right) => left.from - right.from || left.to - right.to);
  return applyLinePatches(line, sorted) === line ? null : sorted;
}

function structuralPrefixLength(line: string): number {
  const match = /^[ \t]*(?:>[ \t]*)*/u.exec(line);
  return match === null ? 0 : match[0].length;
}

function listContentStart(line: string): number | null {
  const match = /^([ \t]*(?:>[ \t]*)*)((?:[-*+]|\d+[.)])[ \t]+)(.*)\r?$/u.exec(line);
  if (match === null) {
    return null;
  }
  return (match[1] ?? "").length + (match[2] ?? "").length;
}

function isHeading(content: string): boolean {
  return /^#{1,6} /u.test(content);
}

function isFence(content: string): boolean {
  return /^(?:`{3,}|~{3,})/u.test(content);
}

function isTableRow(content: string): boolean {
  return content.startsWith("|");
}

function isHorizontalRule(content: string): boolean {
  return /^(?:-[ \t]*){3,}\r?$/u.test(content)
    || /^(?:_[ \t]*){3,}\r?$/u.test(content)
    || /^(?:\*[ \t]*){3,}\r?$/u.test(content);
}

function isPaddingWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\r";
}
