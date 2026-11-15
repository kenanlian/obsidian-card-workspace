import { afterEach, describe, expect, it } from "vitest";
import { EditorSelection, EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createCreatedDateTracker, CREATED_DATE_MAX_TOUCHED_LINES } from "./created-date-filter";

const TODAY = "2026-11-14";
const CREATED = "\u2795";
const STAMP = ` ${CREATED} ${TODAY}`;

function stateOf(doc: string, caret = doc.length): EditorState {
  return EditorState.create({ doc, selection: { anchor: caret }, extensions: [createCreatedDateTracker({ today: () => TODAY })] });
}

function lineEnd(state: EditorState, line: number): number {
  return state.doc.line(line).to;
}

/** Moves the caret to the start of `line` with a selection-only transaction. */
function moveTo(state: EditorState, line: number): EditorState {
  return state.update({ selection: { anchor: state.doc.line(line).from }, userEvent: "select" }).state;
}

/** Enter at the end of `line`, continuing the list the way the host does. */
function enter(state: EditorState, line: number, marker = "- [ ] "): EditorState {
  const at = lineEnd(state, line);
  return state.update({ changes: { from: at, insert: `\n${marker}` }, selection: { anchor: at + 1 + marker.length }, userEvent: "input" }).state;
}

function type(state: EditorState, text: string, extra: Omit<TransactionSpec, "changes" | "selection"> = { userEvent: "input.type" }): EditorState {
  const at = state.selection.main.head;
  return state.update({ changes: { from: at, insert: text }, selection: { anchor: at + text.length }, ...extra }).state;
}

describe("created date tracker", () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    document.body.replaceChildren();
  });

  it("dates an empty continued task immediately and keeps the caret before its date", () => {
    let state = enter(stateOf("- [ ] first"), 1);
    expect(state.doc.line(2).text).toBe(`- [ ] ${STAMP}`);
    expect(state.selection.main.head - state.doc.line(2).from).toBe(6);
    state = type(state, "second");
    expect(state.doc.line(2).text).toBe(`- [ ] second${STAMP}`);
    const at = state.selection.main.head;
    const tr = state.update({ changes: { from: at, insert: "\n- [ ] " }, selection: { anchor: at + 7 }, userEvent: "input" });
    expect(tr.newDoc.toString()).toBe(`- [ ] first\n- [ ] second${STAMP}\n- [ ] ${STAMP}`);
    expect(tr.changes.invert(state.doc).apply(tr.newDoc).toString()).toBe(state.doc.toString());
    expect(tr.newSelection.main.head - tr.newDoc.line(3).from).toBe(6);
  });

  it("dates a typed checkbox in its creating transaction", () => {
    const state = type(stateOf("- [] buy milk\nnext", 3), " ");
    expect(state.doc.toString()).toBe(`- [ ] buy milk${STAMP}\nnext`);
    expect(state.selection.main.head).toBe(4);
    expect(moveTo(state, 2).doc.toString()).toBe(state.doc.toString());
  });

  it("dates checkbox-command conversions including a multi-line selection immediately", () => {
    const state = stateOf("buy milk\nwalk dog\nnext", 0).update({
      changes: [{ from: 0, insert: "- [ ] " }, { from: 9, insert: "- [ ] " }], selection: EditorSelection.single(0, 26),
    }).state;
    expect(state.doc.toString()).toBe(`- [ ] buy milk${STAMP}\n- [ ] walk dog${STAMP}\nnext`);
  });

  it("ends an automatically dated empty list with Enter", () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const view = new EditorView({ parent, state: stateOf("", 0) });
    cleanups.push(() => view.destroy());
    view.dispatch({ changes: { from: 0, insert: "- [ ] " }, selection: { anchor: 6 }, userEvent: "input.type" });
    expect(view.state.doc.toString()).toBe(`- [ ] ${STAMP}`);
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe("");
  });

  it("does not date tasks that already existed, were reopened, or already have a created date", () => {
    let state = stateOf(`- [ ] old\n- [x] done\n- [] dated ${CREATED} 2026-01-01\nend`, 9);
    state = type(state, " edit");
    state = state.update({ changes: { from: 18, to: 19, insert: " " }, selection: { anchor: 19 }, userEvent: "input.type" }).state;
    state = state.update({ changes: { from: 29, insert: " " }, selection: { anchor: 30 }, userEvent: "input.type" }).state;
    state = moveTo(state, 4);
    expect(state.doc.toString()).toBe(`- [ ] old edit\n- [ ] done\n- [ ] dated ${CREATED} 2026-01-01\nend`);
  });

  it.each([
    ["paste", { userEvent: "input.paste" }],
    ["drop", { userEvent: "input.drop" }],
    ["undo", { userEvent: "undo" }],
    ["remote changes", { annotations: Transaction.remote.of(true) }],
    ["changes outside history", { annotations: Transaction.addToHistory.of(false) }],
    ["task date edits", { userEvent: "input.task-date" }],
  ])("ignores tasks created by %s", (_label, extra) => {
    let state = stateOf("x\n", 2);
    state = type(state, "- [ ] pasted", extra);
    state = moveTo(state, 1);
    expect(state.doc.toString()).toBe("x\n- [ ] pasted");
  });

  it("treats a task whose text was rejoined or moved as existing", () => {
    let state = stateOf("\n- [ ] keep\nend", 1);
    state = state.update({ changes: { from: 0, to: 1, insert: "" }, selection: { anchor: 0 }, userEvent: "delete.backward" }).state;
    state = moveTo(state, 2);
    expect(state.doc.toString()).toBe("- [ ] keep\nend");
  });

  it("ignores whole-document replacements, tasks away from the caret, and fenced code", () => {
    let replaced = stateOf("old", 0);
    replaced = replaced.update({ changes: { from: 0, to: 3, insert: "- [ ] loaded\nend" }, selection: { anchor: 0 } }).state;
    expect(moveTo(replaced, 2).doc.toString()).toBe("- [ ] loaded\nend");

    let remote = stateOf("a\nb\nc", 0);
    remote = remote.update({ changes: { from: 4, insert: "- [ ] " } }).state;
    expect(moveTo(remote, 2).doc.toString()).toBe("a\nb\n- [ ] c");

    let fenced = stateOf("```\n- [] code\n```\nend", 7);
    fenced = type(fenced, " ");
    expect(moveTo(fenced, 4).doc.toString()).toBe("```\n- [ ] code\n```\nend");
  });

  it(`starts tracking only from edits touching at most ${CREATED_DATE_MAX_TOUCHED_LINES} lines`, () => {
    const lines = (count: number) => Array.from({ length: count }, (_, index) => `t${index}`).join("\n");
    const convertAll = (count: number) => {
      let state = stateOf(`${lines(count)}\nend`, 0);
      const changes = Array.from({ length: count }, (_, index) => ({ from: state.doc.line(index + 1).from, insert: "- [ ] " }));
      state = state.update({ changes, selection: EditorSelection.single(0, lineEnd(state, count) + count * 6) }).state;
      return moveTo(state, count + 1).doc.toString();
    };
    expect(convertAll(CREATED_DATE_MAX_TOUCHED_LINES).split("\n").slice(0, -1).every((line) => line.endsWith(STAMP))).toBe(true);
    expect(convertAll(CREATED_DATE_MAX_TOUCHED_LINES + 1)).not.toContain(CREATED);
  });
});


it("keeps dates on the sole original task when Enter splits before its trailing dates", () => {
  let state = stateOf(`- [ ] first${STAMP}`, 11);
  state = state.update({ changes: { from: 11, insert: "\n- [ ] " }, selection: { anchor: 18 }, userEvent: "input" }).state;
  expect(state.doc.toString()).toBe(`- [ ] first${STAMP}\n- [ ] ${STAMP}`);
  expect(state.selection.main.head - state.doc.line(2).from).toBe(6);
});
