import { editorLivePreviewField } from "obsidian";
import type { EditorState, Line, Text } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";
import { parseTaskLine, type ParsedTaskLine } from "../index";

export const TASK_DATE_USER_EVENT = "input.task-date";

export function isLivePreview(state: EditorState): boolean {
  return state.field(editorLivePreviewField, false) === true;
}

export function livePreviewToggled(update: ViewUpdate): boolean {
  return isLivePreview(update.startState) !== isLivePreview(update.state);
}

/**
 * Line-based scan for frontmatter, fenced code and `$$` display math, independent
 * of the host parser. Results are cached per immutable document and extended
 * lazily, so a viewport-only update scans nothing new.
 */
interface BlockScan {
  /** Closed, sorted, inclusive 1-based line ranges. */
  readonly ranges: Array<[number, number]>;
  nextLine: number;
  fence: { readonly char: string; readonly length: number } | null;
  math: boolean;
  openFrom: number;
}

const scans = new WeakMap<Text, BlockScan>();
const QUOTE_PREFIX = /^[ \t]*(?:>[ \t]*)*/u;
const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/u;

export type ExcludedLineTest = (lineNumber: number) => boolean;

export function excludedLines(doc: Text, throughLine: number): ExcludedLineTest {
  let scan = scans.get(doc);
  if (scan === undefined) {
    scan = createScan(doc);
    scans.set(doc, scan);
  }
  extendScan(doc, scan, Math.min(throughLine, doc.lines));
  const result = scan;
  return (lineNumber) => isExcluded(result, lineNumber);
}

function createScan(doc: Text): BlockScan {
  const scan: BlockScan = { ranges: [], nextLine: 1, fence: null, math: false, openFrom: 0 };
  if (doc.lines < 2 || doc.line(1).text.trimEnd() !== "---") {
    return scan;
  }
  // Unclosed frontmatter is ordinary Markdown in Obsidian.
  let lineNumber = 2;
  for (const text of iterateLines(doc, 2, doc.lines)) {
    if (text.trimEnd() === "---") {
      scan.ranges.push([1, lineNumber]);
      scan.nextLine = lineNumber + 1;
      break;
    }
    lineNumber += 1;
  }
  return scan;
}

function extendScan(doc: Text, scan: BlockScan, throughLine: number): void {
  if (scan.nextLine > throughLine) {
    return;
  }
  let lineNumber = scan.nextLine;
  for (const text of iterateLines(doc, scan.nextLine, throughLine)) {
    const content = text.slice(QUOTE_PREFIX.exec(text)?.[0].length ?? 0);
    if (scan.fence !== null) {
      if (closesFence(content, scan.fence)) {
        scan.ranges.push([scan.openFrom, lineNumber]);
        scan.fence = null;
      }
    } else if (scan.math) {
      if (content.includes("$$")) {
        scan.ranges.push([scan.openFrom, lineNumber]);
        scan.math = false;
      }
    } else {
      const fence = FENCE_OPEN.exec(content);
      const marker = fence?.[1] ?? "";
      if (fence !== null && !(marker.startsWith("`") && (fence[2] ?? "").includes("`"))) {
        scan.fence = { char: marker.charAt(0), length: marker.length };
        scan.openFrom = lineNumber;
      } else if (content.startsWith("$$")) {
        if (content.includes("$$", 2)) {
          scan.ranges.push([lineNumber, lineNumber]);
        } else {
          scan.math = true;
          scan.openFrom = lineNumber;
        }
      }
    }
    lineNumber += 1;
  }
  scan.nextLine = throughLine + 1;
}

function closesFence(content: string, fence: { readonly char: string; readonly length: number }): boolean {
  let run = 0;
  while (content.charAt(run) === fence.char) {
    run += 1;
  }
  return run >= fence.length && content.slice(run).trim() === "";
}

function isExcluded(scan: BlockScan, lineNumber: number): boolean {
  if ((scan.fence !== null || scan.math) && lineNumber >= scan.openFrom) {
    return true;
  }
  let low = 0;
  let high = scan.ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const range = scan.ranges[middle];
    if (range === undefined) {
      return false;
    }
    if (lineNumber < range[0]) {
      high = middle - 1;
    } else if (lineNumber > range[1]) {
      low = middle + 1;
    } else {
      return true;
    }
  }
  return false;
}

function* iterateLines(doc: Text, fromLine: number, toLine: number): Generator<string> {
  if (fromLine > toLine) {
    return;
  }
  const iterator = doc.iterLines(fromLine, toLine + 1);
  for (let next = iterator.next(); !next.done; next = iterator.next()) {
    yield next.value;
  }
}

export interface VisibleTaskLine {
  readonly line: Line;
  readonly parsed: ParsedTaskLine;
}

/** Task lines in the viewport outside frontmatter, fenced code and display math. */
export function visibleTaskLines(view: EditorView): VisibleTaskLine[] {
  const doc = view.state.doc;
  const ranges = view.visibleRanges;
  const last = ranges[ranges.length - 1];
  if (last === undefined) {
    return [];
  }
  const excluded = excludedLines(doc, doc.lineAt(last.to).number);
  const lines: VisibleTaskLine[] = [];
  let previous = 0;
  for (const range of ranges) {
    for (let position = range.from; position <= range.to;) {
      const line = doc.lineAt(position);
      position = line.to + 1;
      if (line.number <= previous) {
        continue;
      }
      previous = line.number;
      if (excluded(line.number)) {
        continue;
      }
      const parsed = parseTaskLine(line.text);
      if (parsed !== null) {
        lines.push({ line, parsed });
      }
    }
  }
  return lines;
}
