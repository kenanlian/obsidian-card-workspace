import { EditorState, MapMode, StateField, Transaction, type ChangeDesc, type ChangeSpec, type EditorSelection, type Extension, type Line, type Text, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { parseTaskLine, setTaskDate, type ParsedTaskLine } from "../index";
import { excludedLines, TASK_DATE_USER_EVENT } from "./editor-shared";

/** Edits touching more lines than this (sync, bulk rewrites) never start tracking a task. */
export const CREATED_DATE_MAX_TOUCHED_LINES = 20;
const MAX_PENDING_TASKS = 100;

export interface CreatedDateTrackerOptions {
  readonly today: () => string;
}

function isTrackedEdit(tr: Transaction): boolean {
  return !(tr.isUserEvent(TASK_DATE_USER_EVENT)
    || tr.isUserEvent("undo")
    || tr.isUserEvent("redo")
    || tr.isUserEvent("input.paste")
    || tr.isUserEvent("input.drop")
    || tr.isUserEvent("move")
    || tr.annotation(Transaction.remote) === true
    || tr.annotation(Transaction.addToHistory) === false);
}

function hasCreatedToken(parsed: ParsedTaskLine): boolean {
  return parsed.dateTokens.some((token) => token.kind === "created");
}

function awaitsCreatedDate(line: Line): boolean {
  const parsed = parseTaskLine(line.text);
  return parsed !== null && !hasCreatedToken(parsed);
}

function touchesSelection(selection: EditorSelection, line: Line): boolean {
  return selection.ranges.some((range) => range.from <= line.to && range.to >= line.from);
}

/**
 * Line starts of tasks created in this editor that still lack a created date.
 * The date is written once the caret leaves the line, so typing never lands
 * after it and Enter on an empty task still ends the list.
 */
const pendingTasks = StateField.define<readonly number[]>({
  create: () => [],
  update(pending, tr) {
    if (!tr.docChanged) {
      return pending;
    }
    const next = mapPending(pending, tr.changes, tr.newDoc);
    if (isTrackedEdit(tr)) {
      for (const from of newTaskLines(tr)) {
        if (!next.includes(from)) next.push(from);
      }
    }
    return next.length > MAX_PENDING_TASKS ? next.slice(-MAX_PENDING_TASKS) : next;
  },
});

/** Text inserted at a line start may land on either side of the old position. */
function mapPending(pending: readonly number[], changes: ChangeDesc, doc: Text): number[] {
  const mapped: number[] = [];
  for (const position of pending) {
    for (const assoc of [-1, 1]) {
      const next = changes.mapPos(position, assoc, MapMode.TrackDel);
      if (next === null || mapped.includes(next)) continue;
      const line = doc.lineAt(next);
      if (line.from === next && awaitsCreatedDate(line)) {
        mapped.push(next);
        break;
      }
    }
  }
  return mapped;
}

/**
 * Task lines the transaction created at the caret: a line that was not a task,
 * or a line the edit added (Enter continuing a list). A task whose text still
 * exists in the replaced lines was moved or rejoined, not created.
 */
function newTaskLines(tr: Transaction): number[] {
  const oldDoc = tr.startState.doc;
  const newDoc = tr.newDoc;
  const pairs: Array<{ line: Line; previous: string | null }> = [];
  const previousTasks = new Set<string>();
  let touched = 0;
  let rejected = false;
  tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (rejected) {
      return;
    }
    const replacesDocument = oldDoc.length > 0 ? fromA === 0 && toA === oldDoc.length : newDoc.lines > 1;
    const oldStart = oldDoc.lineAt(fromA).number;
    const oldEnd = oldDoc.lineAt(toA).number;
    const newStart = newDoc.lineAt(fromB).number;
    const newEnd = newDoc.lineAt(toB).number;
    touched += newEnd - newStart + 1;
    if (replacesDocument || touched > CREATED_DATE_MAX_TOUCHED_LINES) {
      rejected = true;
      return;
    }
    for (let number = oldStart; number <= oldEnd; number += 1) {
      const text = oldDoc.line(number).text;
      if (parseTaskLine(text) !== null) previousTasks.add(text.trim());
    }
    for (let offset = 0; newStart + offset <= newEnd; offset += 1) {
      const previous = oldStart + offset <= oldEnd ? oldDoc.line(oldStart + offset).text : null;
      pairs.push({ line: newDoc.line(newStart + offset), previous });
    }
  });
  if (rejected) {
    return [];
  }
  const found: number[] = [];
  for (const { line, previous } of pairs) {
    if ((previous !== null && parseTaskLine(previous) !== null)
      || !touchesSelection(tr.newSelection, line)
      || previousTasks.has(line.text.trim())
      || !awaitsCreatedDate(line)
      || excludedLines(newDoc, line.number)(line.number)) {
      continue;
    }
    if (!found.includes(line.from)) found.push(line.from);
  }
  return found;
}

/** Created-date writes for pending tasks with text, skipping lines under `selection`. */
function stampChanges(doc: Text, pending: readonly number[], selection: EditorSelection | null, today: () => string): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  let date: string | null = null;
  for (const from of pending) {
    const line = doc.lineAt(from);
    const parsed = parseTaskLine(line.text);
    if (parsed === null || hasCreatedToken(parsed) || parsed.description.trim() === ""
      || (selection !== null && touchesSelection(selection, line))) {
      continue;
    }
    date ??= today();
    for (const patch of setTaskDate(line.text, "created", date) ?? []) {
      changes.push({ from: line.from + patch.from, to: line.from + patch.to, insert: patch.insert });
    }
  }
  return changes;
}

function filterCreatedDates(tr: Transaction, today: () => string): Transaction | readonly (Transaction | TransactionSpec)[] {
  const pending = tr.startState.field(pendingTasks, false);
  if (pending === undefined || pending.length === 0 || !isTrackedEdit(tr)) {
    return tr;
  }
  const positions = tr.docChanged ? mapPending(pending, tr.changes, tr.newDoc) : pending;
  const changes = stampChanges(tr.newDoc, positions, tr.newSelection, today);
  return changes.length === 0 ? tr : [tr, { changes, sequential: true }];
}

/**
 * Gives tasks created in the editor (Enter in a task list, a typed checkbox, a
 * checkbox command) today's created date once the caret leaves their line or
 * the editor loses focus, inside the edit or selection change that left it.
 */
export function createCreatedDateTracker(options: CreatedDateTrackerOptions): Extension {
  return [
    pendingTasks,
    EditorState.transactionFilter.of((tr) => filterCreatedDates(tr, options.today)),
    EditorView.domEventHandlers({
      blur: (_event, view) => {
        const pending = view.state.field(pendingTasks, false);
        if (pending === undefined || pending.length === 0 || !view.dom.isConnected) {
          return false;
        }
        const changes = stampChanges(view.state.doc, pending, null, options.today);
        if (changes.length > 0) {
          view.dispatch({ changes, userEvent: TASK_DATE_USER_EVENT });
        }
        return false;
      },
    }),
  ];
}
