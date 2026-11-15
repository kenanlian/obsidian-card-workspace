import { EditorState, EditorSelection, ChangeSet, MapMode, Prec, StateField, Transaction, type ChangeSpec, type Extension, type Line, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { applyLinePatches, parseTaskLine, setTaskDate, type ParsedTaskLine } from "../index";
import { excludedLines, TASK_DATE_USER_EVENT } from "./editor-shared";

/** Edits touching more lines than this (sync, bulk rewrites) never start tracking a task. */
export const CREATED_DATE_MAX_TOUCHED_LINES = 20;
export interface CreatedDateTrackerOptions { readonly today: () => string }

function isTrackedEdit(tr: Transaction): boolean {
  return !(tr.isUserEvent(TASK_DATE_USER_EVENT) || tr.isUserEvent("undo") || tr.isUserEvent("redo")
    || tr.isUserEvent("input.paste") || tr.isUserEvent("input.drop") || tr.isUserEvent("move")
    || tr.annotation(Transaction.remote) === true || tr.annotation(Transaction.addToHistory) === false);
}
function hasCreatedToken(parsed: ParsedTaskLine): boolean {
  return parsed.dateTokens.some(token => token.kind === "created");
}
function awaitsCreatedDate(line: Line): boolean {
  const parsed = parseTaskLine(line.text);
  return parsed !== null && !hasCreatedToken(parsed);
}
function touchesSelection(selection: EditorSelection, line: Line): boolean {
  return selection.ranges.some(range => range.from <= line.to && range.to >= line.from);
}
/** Session-local identity of newly created tasks, including their automatic date. */
const automaticTasks = StateField.define<readonly number[]>({
  create: () => [],
  update(previous, tr) {
    const mapped = previous.flatMap(position => [-1, 1].flatMap(assoc => {
      const next = tr.changes.mapPos(position, assoc, MapMode.TrackDel);
      if (next === null) return [];
      const line = tr.newDoc.lineAt(next);
      return line.from === next && parseTaskLine(line.text) !== null ? [next] : [];
    }));
    if (tr.docChanged && isTrackedEdit(tr)) mapped.push(...newTaskLines(tr, true));
    return [...new Set(mapped)].slice(-100);
  },
});

/**
 * Task lines the transaction created at the caret: a line that was not a task,
 * or a line the edit added (Enter continuing a list). A task whose text still
 * exists in the replaced lines was moved or rejoined, not created.
 */
function newTaskLines(tr: Transaction, includeDated = false): number[] {
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
      || (includeDated ? parseTaskLine(line.text) === null : !awaitsCreatedDate(line))
      || excludedLines(newDoc, line.number)(line.number)) {
      continue;
    }
    if (!found.includes(line.from)) found.push(line.from);
  }
  return found;
}

/** Enter before a trailing date must not move that date onto the new task. */
function retainDatesOnSplit(tr: Transaction): Transaction {
  if (tr.startState.selection.ranges.length !== 1 || !tr.startState.selection.main.empty) return tr;
  const caret = tr.startState.selection.main.head;
  const old = tr.startState.doc.lineAt(caret);
  const parsed = parseTaskLine(old.text);
  if (!parsed || !parsed.dateTokens.length || tr.newDoc.lines <= tr.startState.doc.lines
    || excludedLines(tr.startState.doc, old.number)(old.number)) return tr;
  const current = tr.newDoc.lineAt(tr.changes.mapPos(old.from, -1));
  const next = current.number < tr.newDoc.lines ? tr.newDoc.line(current.number + 1) : null;
  if (!next || !parseTaskLine(current.text) || !parseTaskLine(next.text)) return tr;
  const changes: ChangeSpec[] = [];
  let source = current.text, destination = next.text;
  for (const token of parsed.dateTokens) {
    if (old.from + token.span.from < caret) continue;
    if (!parseTaskLine(destination)?.dateTokens.some(item => item.kind === token.kind && item.value === token.value)) continue;
    const remove = setTaskDate(destination, token.kind, null);
    const add = setTaskDate(source, token.kind, token.value);
    if (!remove || !add) continue;
    destination = applyLinePatches(destination, remove); source = applyLinePatches(source, add);
  }
  if (source === current.text) return tr;
  // Preserve the host's caret inside the new task's text, ahead of its new date.
  const headOffset = Math.min(tr.newSelection.main.head - next.from, destination.length);
  for (const [line, text] of [[current, source], [next, destination]] as const) {
    let from = 0, end = line.text.length, textEnd = text.length;
    while (from < end && from < textEnd && line.text[from] === text[from]) from++;
    while (end > from && textEnd > from && line.text[end - 1] === text[textEnd - 1]) { end--; textEnd--; }
    changes.push({ from: line.from + from, to: line.from + end, insert: text.slice(from, textEnd) });
  }
  const patches = ChangeSet.of(changes, tr.newDoc.length);
  return tr.startState.update(tr, { changes, selection: { anchor: patches.mapPos(next.from, -1) + Math.max(0, headOffset) }, sequential: true, filter: false });
}

/** Add dates inside the creating edit, with explicit selection mapping. */
function filterCreatedDates(tr: Transaction, today: () => string): Transaction | readonly (Transaction | TransactionSpec)[] {
  if (!tr.docChanged || !isTrackedEdit(tr)) return tr;
  tr = retainDatesOnSplit(tr);
  const changes: ChangeSpec[] = [];
  const newLines = newTaskLines(tr);
  for (const from of newLines) {
    const line = tr.newDoc.lineAt(from);
    const parsed = parseTaskLine(line.text)!;
    if (parsed.description === "" && parsed.dateTokens.length === 0 && parsed.blockId === null) {
      // Keep an editable gap before the date, as the insert-task command does.
      const at = parsed.statusSpan.to + 1;
      changes.push({ from: from + at, to: line.to, insert: `  ➕ ${today()}` });
    } else {
      for (const patch of setTaskDate(line.text, "created", today()) ?? []) changes.push({ from: from + patch.from, to: from + patch.to, insert: patch.insert });
    }
  }
  if (!changes.length) return tr;
  const patchSet = ChangeSet.of(changes, tr.newDoc.length);
  const selection = EditorSelection.create(tr.newSelection.ranges.map(range => {
    const map = (position: number) => {
      const line = tr.newDoc.lineAt(position);
      const parsed = parseTaskLine(line.text);
      if (newLines.includes(line.from) && parsed?.description === "" && parsed.dateTokens.length === 0 && parsed.blockId === null
        && position >= line.from + parsed.statusSpan.to + 1) return patchSet.mapPos(line.from + parsed.statusSpan.to + 1, -1) + 1;
      return patchSet.mapPos(position, -1);
    };
    return EditorSelection.range(map(range.anchor), map(range.head));
  }), tr.newSelection.mainIndex);
  return [tr, { changes, selection, sequential: true }];
}

/** Only empty tasks automatically dated in this editor get special Enter handling. */
function exitAutomaticEmptyTask(view: EditorView): boolean {
  const { state } = view;
  if (view.composing || state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;
  const line = state.doc.lineAt(state.selection.main.head);
  if (!state.field(automaticTasks).includes(line.from)) return false;
  const parsed = parseTaskLine(line.text);
  if (!parsed || parsed.completed || parsed.description !== "" || parsed.blockId !== null
    || parsed.dateTokens.length !== 1 || parsed.dateTokens[0].kind !== "created") return false;
  // Remove this empty list item, retaining its surrounding quote/indent context.
  const prefix = /^[ \t]*(?:>[ \t]*)*/u.exec(line.text)?.[0] ?? "";
  view.dispatch({ changes: { from: line.from, to: line.to, insert: prefix }, selection: { anchor: line.from + prefix.length }, userEvent: "input" });
  return true;
}

export function createCreatedDateTracker(options: CreatedDateTrackerOptions): Extension {
  return [automaticTasks, EditorState.transactionFilter.of(tr => filterCreatedDates(tr, options.today)),
    Prec.highest(keymap.of([{ key: "Enter", run: exitAutomaticEmptyTask }])),
    EditorView.inputHandler.of((view, _from, _to, text) => text === "\n" && exitAutomaticEmptyTask(view)),
  ];
}
