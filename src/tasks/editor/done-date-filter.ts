import { EditorState, Transaction, type ChangeSpec, type Extension, type Line, type TransactionSpec } from "@codemirror/state";
import { parseTaskLine, setTaskDate } from "../index";
import { TASK_DATE_USER_EVENT } from "./editor-shared";

/**
 * Transactions touching more lines than this (paste, sync, bulk edits) are left
 * alone; a checkbox click or typed status change touches one line.
 */
export const DONE_DATE_MAX_TOUCHED_LINES = 20;

export interface DoneDateFilterOptions {
  readonly today: () => string;
}

/**
 * Adds today's done date when a task becomes complete and removes done dates
 * when it is reopened, inside the same undo step as the status change.
 */
export function createDoneDateFilter(options: DoneDateFilterOptions): Extension {
  return EditorState.transactionFilter.of((tr) => filterDoneDates(tr, options.today));
}

export function filterDoneDates(tr: Transaction, today: () => string): Transaction | readonly (Transaction | TransactionSpec)[] {
  if (!tr.docChanged
    || tr.isUserEvent(TASK_DATE_USER_EVENT)
    || tr.isUserEvent("undo")
    || tr.isUserEvent("redo")
    || tr.isUserEvent("input.paste")
    || tr.isUserEvent("input.drop")
    || tr.annotation(Transaction.remote) === true
    || tr.annotation(Transaction.addToHistory) === false) {
    return tr;
  }
  const pairs = pairChangedLines(tr);
  if (pairs === null) {
    return tr;
  }
  // Typing and deleting may rewrite more than the status character; other
  // sources (Live Preview checkbox clicks, toggle commands) must be a pure flip.
  const typed = tr.isUserEvent("input") || tr.isUserEvent("delete");
  const changes: ChangeSpec[] = [];
  let date: string | null = null;
  for (const [before, after] of pairs) {
    const previous = parseTaskLine(before.text);
    const next = parseTaskLine(after.text);
    if (previous === null || next === null) {
      continue;
    }
    const completed = previous.statusChar === " " && next.statusChar !== " ";
    const reopened = previous.statusChar !== " " && next.statusChar === " ";
    if (!completed && !reopened) {
      continue;
    }
    if (!typed) {
      const flipped = before.text.slice(0, previous.statusSpan.from) + next.statusChar + before.text.slice(previous.statusSpan.to);
      if (flipped !== after.text) {
        continue;
      }
    }
    let patches = null;
    if (completed && next.dates.done === undefined) {
      date ??= today();
      patches = setTaskDate(after.text, "done", date);
    } else if (reopened && next.dateTokens.some((token) => token.kind === "done")) {
      patches = setTaskDate(after.text, "done", null);
    }
    for (const patch of patches ?? []) {
      changes.push({ from: after.from + patch.from, to: after.from + patch.to, insert: patch.insert });
    }
  }
  return changes.length === 0 ? tr : [tr, { changes, sequential: true }];
}

/**
 * Pairs old and new lines inside each changed range. Returns null when the
 * transaction touches too many lines or adds/removes line breaks, since a
 * status change never alters the line structure.
 */
function pairChangedLines(tr: Transaction): Array<[Line, Line]> | null {
  const oldDoc = tr.startState.doc;
  const newDoc = tr.newDoc;
  const pairs = new Map<number, [Line, Line]>();
  let touched = 0;
  let rejected = false;
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (rejected) {
      return;
    }
    const oldStart = oldDoc.lineAt(fromA).number;
    const oldEnd = oldDoc.lineAt(toA).number;
    const newStart = newDoc.lineAt(fromB).number;
    const newEnd = newDoc.lineAt(toB).number;
    touched += newEnd - newStart + 1;
    if (touched > DONE_DATE_MAX_TOUCHED_LINES || oldEnd - oldStart !== newEnd - newStart) {
      rejected = true;
      return;
    }
    for (let offset = 0; offset <= newEnd - newStart; offset += 1) {
      pairs.set(newStart + offset, [oldDoc.line(oldStart + offset), newDoc.line(newStart + offset)]);
    }
  });
  return rejected ? null : [...pairs.values()];
}
