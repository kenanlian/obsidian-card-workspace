import { describe, expect, it } from "vitest";
import type { Editor, EditorPosition, EditorSelection, EditorTransaction } from "obsidian";
import { insertOrConvertTasks } from "./task-commands";

class FakeEditor {
  readonly transactions: EditorTransaction[] = [];
  cursor: EditorPosition;
  setCursorCalls = 0;

  constructor(public lines: string[], public selections: EditorSelection[], private readonly clipSelection = false) {
    this.cursor = selections[0]?.head ?? { line: 0, ch: 0 };
  }

  getLine(line: number): string { return this.lines[line] ?? ""; }
  listSelections(): EditorSelection[] { return this.selections; }
  getCursor(): EditorPosition { return this.cursor; }
  setCursor(position: EditorPosition): void { this.setCursorCalls += 1; this.cursor = position; }

  transaction(tx: EditorTransaction): void {
    this.transactions.push(tx);
    const before = [...this.lines];
    const changes = [...(tx.changes ?? [])].sort((a, b) => b.from.line - a.from.line || b.from.ch - a.from.ch);
    for (const change of changes) {
      const text = this.lines[change.from.line] ?? "";
      const to = change.to ?? change.from;
      this.lines[change.from.line] = text.slice(0, change.from.ch) + change.text + text.slice(to.ch);
    }
    if (tx.selection) {
      const { line, ch } = tx.selection.from;
      const reference = this.clipSelection ? before : this.lines;
      this.cursor = { line, ch: Math.min(ch, (reference[line] ?? "").length) };
    }
  }
}

const caret = (line: number, ch: number): EditorSelection => ({ anchor: { line, ch }, head: { line, ch } });
const run = (editor: FakeEditor, date: string | null = "2026-11-14") => insertOrConvertTasks(editor as unknown as Editor, date);

describe("insertOrConvertTasks", () => {
  it("inserts a task on a blank line with the caret after the checkbox", () => {
    const editor = new FakeEditor([""], [caret(0, 0)]);
    expect(run(editor)).toBe(true);
    expect(editor.lines).toEqual(["- [ ]  \u2795 2026-11-14"]);
    expect(editor.transactions).toHaveLength(1);
    expect(editor.cursor).toEqual({ line: 0, ch: 6 });
  });

  it("re-applies the caret when the host resolved it against the shorter original line", () => {
    const editor = new FakeEditor([""], [caret(0, 0)], true);
    run(editor, null);
    expect(editor.lines).toEqual(["- [ ] "]);
    expect(editor.cursor).toEqual({ line: 0, ch: 6 });
    expect(editor.setCursorCalls).toBe(1);
  });

  it("converts every line touched by a multi-line selection in one transaction", () => {
    const editor = new FakeEditor(["alpha", "- beta", "- [ ] gamma", "# heading", "delta"], [{ anchor: { line: 0, ch: 2 }, head: { line: 4, ch: 0 } }]);
    expect(run(editor, null)).toBe(true);
    expect(editor.lines).toEqual(["- [ ] alpha", "- [ ] beta", "- [ ] gamma", "# heading", "delta"]);
    expect(editor.transactions).toHaveLength(1);
    expect(editor.transactions[0]!.selection).toBeUndefined();
  });

  it("covers reversed selections and every cursor", () => {
    const editor = new FakeEditor(["one", "two", "three"], [{ anchor: { line: 1, ch: 3 }, head: { line: 0, ch: 1 } }, caret(2, 0)]);
    run(editor, null);
    expect(editor.lines).toEqual(["- [ ] one", "- [ ] two", "- [ ] three"]);
    expect(editor.transactions).toHaveLength(1);
  });

  it("returns false and leaves the editor untouched when nothing converts", () => {
    const editor = new FakeEditor(["- [ ] already", "```"], [{ anchor: { line: 0, ch: 0 }, head: { line: 1, ch: 3 } }]);
    expect(run(editor)).toBe(false);
    expect(editor.transactions).toEqual([]);
  });
});
