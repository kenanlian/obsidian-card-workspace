import { describe, expect, it } from "vitest";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import { createDoneDateFilter, DONE_DATE_MAX_TOUCHED_LINES } from "./done-date-filter";

const TODAY = "2026-11-14";
const DONE = "\u2705";
const DUE = "\u{1F4C5}";

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [createDoneDateFilter({ today: () => TODAY })] });
}

function statusAt(doc: string, line = 0): number {
  return doc.split("\n").slice(0, line).reduce((sum, text) => sum + text.length + 1, 0) + doc.split("\n")[line]!.indexOf("[") + 1;
}

function flip(doc: string, insert: string, spec: Omit<TransactionSpec, "changes"> = {}, line = 0): Transaction {
  const from = statusAt(doc, line);
  return stateOf(doc).update({ changes: { from, to: from + 1, insert }, ...spec });
}

describe("done date transaction filter", () => {
  it("adds today's done date to a Live Preview style checkbox flip in the same transaction", () => {
    const doc = `- [ ] write ${DUE} 2026-11-20\n- [ ] other`;
    const tr = flip(doc, "x");
    expect(tr.newDoc.toString()).toBe(`- [x] write ${DUE} 2026-11-20 ${DONE} ${TODAY}\n- [ ] other`);
    // One transaction is one history event; inverting it restores the original.
    expect(tr.changes.invert(tr.startState.doc).apply(tr.newDoc).toString()).toBe(doc);
  });

  it("treats any non-space status as complete and keeps block ids last", () => {
    expect(flip("- [ ] task ^abc", "/", { userEvent: "input.type" }).newDoc.toString()).toBe(`- [/] task ${DONE} ${TODAY} ^abc`);
  });

  it("removes every done token when a task is reopened", () => {
    expect(flip(`- [x] task ${DONE} 2026-11-01 ${DUE} 2026-11-02 ${DONE} 2026-11-03`, " ").newDoc.toString())
      .toBe(`- [ ] task ${DUE} 2026-11-02`);
  });

  it("is idempotent with an existing valid done date written alongside the status", () => {
    const doc = `- [ ] task ${DONE} 2026-11-01`;
    expect(flip(doc, "x").newDoc.toString()).toBe(`- [x] task ${DONE} 2026-11-01`);
    const state = stateOf("- [ ] task");
    const whole = state.update({ changes: { from: 0, to: 10, insert: `- [x] task ${DONE} 2026-11-02` } });
    expect(whole.newDoc.toString()).toBe(`- [x] task ${DONE} 2026-11-02`);
  });

  it("replaces an invalid done date when completing", () => {
    expect(flip(`- [ ] task ${DONE} 2026-02-30`, "x").newDoc.toString()).toBe(`- [x] task ${DONE} ${TODAY}`);
  });

  it.each([
    ["task date edits", { userEvent: "input.task-date" }],
    ["remote changes", { annotations: Transaction.remote.of(true) }],
    ["changes outside history", { annotations: Transaction.addToHistory.of(false) }],
    ["undo", { userEvent: "undo" }],
    ["redo", { userEvent: "redo" }],
    ["paste", { userEvent: "input.paste" }],
  ])("ignores %s", (_label, spec) => {
    expect(flip("- [ ] task", "x", spec).newDoc.toString()).toBe("- [x] task");
  });

  it("ignores programmatic rewrites that change more than the status", () => {
    const tr = stateOf("- [ ] task").update({ changes: { from: 0, to: 10, insert: "- [x] task!" } });
    expect(tr.newDoc.toString()).toBe("- [x] task!");
    const typed = stateOf("- [ ] task").update({ changes: { from: 0, to: 10, insert: "- [x] task!" }, userEvent: "input.type" });
    expect(typed.newDoc.toString()).toBe(`- [x] task! ${DONE} ${TODAY}`);
  });

  it("ignores transactions without document changes and lines that stop being tasks", () => {
    const state = stateOf("- [ ] task");
    expect(state.update({ selection: { anchor: 2 } }).changes.empty).toBe(true);
    expect(state.update({ changes: { from: 2, to: 5, insert: "" }, userEvent: "delete" }).newDoc.toString()).toBe("-  task");
  });

  it("ignores edits that add or remove line breaks", () => {
    const doc = "- [ ] a\n- [ ] b";
    const tr = stateOf(doc).update({ changes: [{ from: 3, to: 4, insert: "x" }, { from: 7, to: 7, insert: "\nmore" }], userEvent: "input" });
    expect(tr.newDoc.toString()).toBe("- [x] a\nmore\n- [ ] b");
  });

  it(`reacts to at most ${DONE_DATE_MAX_TOUCHED_LINES} touched lines`, () => {
    const lines = (count: number) => Array.from({ length: count }, (_, index) => `- [ ] t${index}`).join("\n");
    const checkAll = (count: number) => {
      const doc = lines(count);
      const changes = Array.from({ length: count }, (_, index) => ({ from: statusAt(doc, index), to: statusAt(doc, index) + 1, insert: "x" }));
      return stateOf(doc).update({ changes, userEvent: "input" }).newDoc.toString();
    };
    expect(checkAll(DONE_DATE_MAX_TOUCHED_LINES).split("\n").every(line => line.endsWith(`${DONE} ${TODAY}`))).toBe(true);
    expect(checkAll(DONE_DATE_MAX_TOUCHED_LINES + 1)).not.toContain(DONE);
  });

  it("only edits lines whose status changed", () => {
    const doc = "- [ ] a\n- [ ] b\n- [x] c";
    expect(flip(doc, "x", {}, 1).newDoc.toString()).toBe(`- [ ] a\n- [x] b ${DONE} ${TODAY}\n- [x] c`);
  });
});
