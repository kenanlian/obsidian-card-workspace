import type { Editor, EditorChange, EditorPosition } from "obsidian";
import { convertLineToTask } from "../index";

/**
 * Converts the cursor line, or every line touched by the selections, in one
 * editor transaction so a single undo reverts the whole conversion.
 */
export function insertOrConvertTasks(editor: Editor, createdDate: string | null): boolean {
  const changes: EditorChange[] = [];
  let caret: EditorPosition | null = null;
  const lines = touchedLines(editor);
  for (const line of lines) {
    const result = convertLineToTask(editor.getLine(line), createdDate);
    if (result === null) {
      continue;
    }
    for (const patch of result.patches) {
      changes.push({ from: { line, ch: patch.from }, to: { line, ch: patch.to }, text: patch.insert });
    }
    caret = { line, ch: result.cursor };
  }
  if (changes.length === 0) {
    return false;
  }
  const single = lines.length === 1 ? caret : null;
  editor.transaction(single === null ? { changes } : { changes, selection: { from: single } });
  if (single !== null) {
    const cursor = editor.getCursor();
    // The caret may lie past the pre-change line end, so re-apply it if the host clipped it.
    if (cursor.line !== single.line || cursor.ch !== single.ch) {
      editor.setCursor(single);
    }
  }
  return true;
}

function touchedLines(editor: Editor): number[] {
  const lines = new Set<number>();
  for (const selection of editor.listSelections()) {
    const [start, end] = comparePositions(selection.anchor, selection.head) <= 0
      ? [selection.anchor, selection.head]
      : [selection.head, selection.anchor];
    // A selection ending at column 0 does not touch that final line.
    const last = end.line > start.line && end.ch === 0 ? end.line - 1 : end.line;
    for (let line = start.line; line <= last; line += 1) {
      lines.add(line);
    }
  }
  return [...lines].sort((left, right) => left - right);
}

function comparePositions(left: EditorPosition, right: EditorPosition): number {
  return left.line - right.line || left.ch - right.ch;
}
