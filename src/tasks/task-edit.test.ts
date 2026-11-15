import { describe, expect, it } from "vitest";

import { applyLinePatches, convertLineToTask, setTaskDate, setTaskStatus, toggleTaskStatus } from "./task-edit";
import type { LinePatch, TaskStatusOptions } from "./task-edit";
import { parseTaskLine, TASK_DATE_MARKERS } from "./task-line";
import type { TaskDateKind } from "./task-dates";

const CREATED = TASK_DATE_MARKERS.created;
const DONE = TASK_DATE_MARKERS.done;
const DUE = TASK_DATE_MARKERS.due;
const DUE_CALENDAR = "\u{1F4C6}";
const DUE_TEAR_OFF = "\u{1F5D3}";
const VS16 = "\uFE0F";
const TODAY = "2026-11-14";

const AUTO: TaskStatusOptions = { today: TODAY, autoDoneDate: true };
const MANUAL: TaskStatusOptions = { today: TODAY, autoDoneDate: false };

function expectEdit(line: string, patches: readonly LinePatch[] | null, expected: string | null): void {
  if (expected === null) {
    expect(patches).toBeNull();
    return;
  }
  expect(patches).not.toBeNull();
  if (patches === null) {
    return;
  }
  for (let index = 1; index < patches.length; index += 1) {
    const previous = patches[index - 1];
    const current = patches[index];
    expect(current?.from).toBeGreaterThanOrEqual(previous?.to ?? 0);
  }
  expect(applyLinePatches(line, patches)).toBe(expected);
}

describe("applyLinePatches", () => {
  it("applies sorted patches from the end so earlier offsets stay put", () => {
    const line = "abcdef";
    const patches: LinePatch[] = [
      { from: 0, to: 1, insert: "XX" },
      { from: 2, to: 3, insert: "Y" },
    ];
    expect(applyLinePatches(line, patches)).toBe("XXbYdef");
    expect(applyLinePatches(line, [])).toBe(line);
  });
});

describe("setTaskDate", () => {
  it.each<[string, TaskDateKind, string | null, string | null]>([
    ["- [ ] a", "due", "2026-05-01", `- [ ] a ${DUE} 2026-05-01`],
    ["- [ ]", "due", "2026-05-01", `- [ ] ${DUE} 2026-05-01`],
    ["- [ ] a  ", "due", "2026-05-01", `- [ ] a ${DUE} 2026-05-01  `],
    ["- [ ] a ^block-id", "due", "2026-05-01", `- [ ] a ${DUE} 2026-05-01 ^block-id`],
    [`- [ ] a  ^block-id`, "created", "2026-05-01", `- [ ] a ${CREATED} 2026-05-01 ^block-id`],
    [`- [ ] a ${DUE_CALENDAR} 2026-01-01`, "due", "2026-05-01", `- [ ] a ${DUE} 2026-05-01`],
    [`- [ ] a ${DUE_TEAR_OFF}${VS16} 2026-01-01`, "due", "2026-05-01", `- [ ] a ${DUE} 2026-05-01`],
    [`- [ ] a ${DUE}   2026-05-01`, "due", "2026-05-01", `- [ ] a ${DUE} 2026-05-01`],
    [`- [ ] a ${DUE}${VS16} 2026-05-01`, "due", "2026-05-01", `- [ ] a ${DUE} 2026-05-01`],
    [`- [ ] a ${DUE} 2026-02-30`, "due", "2026-05-01", `- [ ] a ${DUE} 2026-05-01`],
    [`- [ ] a ${DUE} 2026-01-01 ${DUE_CALENDAR} 2026-02-02`, "due", "2026-05-01", `- [ ] a ${DUE} 2026-05-01`],
    [`- [ ] a ${DUE} 2026-02-30 ${DUE} 2026-03-01`, "due", "2026-04-01", `- [ ] a ${DUE} 2026-04-01`],
    [`- [ ] a ${CREATED} 2026-01-01 ${DUE} 2026-02-02 ${DONE} 2026-03-03`, "due", null, `- [ ] a ${CREATED} 2026-01-01 ${DONE} 2026-03-03`],
    [`- [ ] a ${DUE} 2026-01-01 b`, "due", null, "- [ ] a b"],
    [`- [ ] a  ${DUE} 2026-01-01`, "due", null, "- [ ] a "],
    [`- [ ] a${DUE} 2026-01-01 b`, "due", null, "- [ ] ab"],
    [`- [ ] ${DUE} 2026-01-01`, "due", null, "- [ ]"],
    [`- [ ] a ${DUE} 2026-01-01 ${DUE} 2026-02-02`, "due", null, "- [ ] a"],
    [`- [ ] a ${DUE} 2026-01-01 ^block-id`, "due", null, "- [ ] a ^block-id"],
    [`- [ ] a\t${DUE} 2026-01-01`, "due", null, "- [ ] a\t"],
    [`- [ ] a ${DUE} 2026-05-01`, "due", "2026-05-01", null],
    ["- [ ] a", "due", null, null],
    ["- [ ] a", "due", "2026-02-30", null],
    ["- [ ] a", "due", "2026-1-01", null],
    ["not a task", "due", "2026-05-01", null],
    ["- [ ]nope", "created", "2026-05-01", null],
  ])("edits %j %s %j into %j", (line, kind, value, expected) => {
    expectEdit(line, setTaskDate(line, kind, value), expected);
  });

  it("removes the preceding space of the first due token on the original line", () => {
    const line = `- [ ] a ${DUE} 2026-01-01 b`;
    const token = parseTaskLine(line)?.dateTokens[0];
    expect(token).toBeDefined();
    expect(setTaskDate(line, "due", null)).toEqual([
      { from: (token?.span.from ?? 0) - 1, to: token?.span.to, insert: "" },
    ]);
  });

  it("inserts before a block id using the original insertion offset", () => {
    const line = "- [ ] a ^block-id";
    const parsed = parseTaskLine(line);
    const patches = setTaskDate(line, "due", "2026-05-01");
    expect(patches).toEqual([{
      from: parsed?.insertionOffset,
      to: parsed?.insertionOffset,
      insert: ` ${DUE} 2026-05-01`,
    }]);
  });
});

describe("setTaskStatus and toggleTaskStatus", () => {
  it.each<[string, boolean, TaskStatusOptions, string | null]>([
    ["- [ ] task", true, AUTO, `- [x] task ${DONE} ${TODAY}`],
    ["- [ ] task", true, MANUAL, "- [x] task"],
    ["- [x] task", true, AUTO, `- [x] task ${DONE} ${TODAY}`],
    ["- [-] task", true, AUTO, `- [-] task ${DONE} ${TODAY}`],
    ["- [/] task", true, MANUAL, null],
    [`- [ ] task ${DONE} 2026-01-01`, true, AUTO, `- [x] task ${DONE} 2026-01-01`],
    [`- [ ] task ${DONE} 2026-02-30`, true, AUTO, `- [x] task ${DONE} ${TODAY}`],
    [`- [x] task ${DONE} ${TODAY}`, true, AUTO, null],
    [`- [x] task ${CREATED} 2026-01-01 ${DUE} 2026-02-02`, false, AUTO, `- [ ] task ${CREATED} 2026-01-01 ${DUE} 2026-02-02`],
    [`- [x] task ${DONE} 2026-01-01`, false, AUTO, "- [ ] task"],
    [`- [x] task ${DONE} 2026-02-30 ${DONE} 2026-03-01`, false, AUTO, "- [ ] task"],
    [`- [x] task ${DONE} 2026-01-01`, false, MANUAL, `- [ ] task ${DONE} 2026-01-01`],
    ["- [ ] task", false, AUTO, null],
    ["- [-] task", false, MANUAL, "- [ ] task"],
    ["- [x] task", true, { today: "2026-02-30", autoDoneDate: true }, null],
    ["hello", true, AUTO, null],
  ])("setTaskStatus(%j, %s) -> %j", (line, completed, options, expected) => {
    expectEdit(line, setTaskStatus(line, completed, options), expected);
  });

  it("toggles from the completed flag and keeps other dates", () => {
    const open = "- [ ] a";
    const completed = toggleTaskStatus(open, AUTO);
    expectEdit(open, completed, `- [x] a ${DONE} ${TODAY}`);

    const checked = `- [x] a ${CREATED} 2026-01-01 ${DONE} ${TODAY}`;
    expectEdit(checked, toggleTaskStatus(checked, AUTO), `- [ ] a ${CREATED} 2026-01-01`);

    const custom = "- [-] a";
    expectEdit(custom, toggleTaskStatus(custom, MANUAL), "- [ ] a");
    expect(toggleTaskStatus("plain", AUTO)).toBeNull();
  });

  it("keeps the status patch and the done-date patch on the original line", () => {
    const line = `- [ ] task ${DUE} 2026-02-02`;
    const patches = setTaskStatus(line, true, AUTO);
    expect(patches?.[0]).toEqual({ from: 3, to: 4, insert: "x" });
    expect(patches?.[1]?.from).toBe(line.length);
    expectEdit(line, patches ?? null, `- [x] task ${DUE} 2026-02-02 ${DONE} ${TODAY}`);
  });
});

describe("convertLineToTask", () => {
  function expectedCursor(line: string, createdDate: string | null, expectedLine: string): number {
    if (createdDate !== TODAY || line.includes(CREATED)) {
      return expectedLine.length;
    }
    const inserted = expectedLine.indexOf(` ${CREATED} ${TODAY}`);
    return inserted < 0 ? expectedLine.length : inserted;
  }

  it.each<[string, string | null, string | null]>([
    ["", null, "- [ ] "],
    ["", TODAY, `- [ ]  ${CREATED} ${TODAY}`],
    ["   ", null, "   - [ ] "],
    ["\t", TODAY, `\t- [ ]  ${CREATED} ${TODAY}`],
    [" \t", TODAY, ` \t- [ ]  ${CREATED} ${TODAY}`],
    ["", "2026-02-30", "- [ ] "],
    ["- foo", null, "- [ ] foo"],
    ["- foo", TODAY, `- [ ] foo ${CREATED} ${TODAY}`],
    ["* foo", TODAY, `* [ ] foo ${CREATED} ${TODAY}`],
    ["+ foo", TODAY, `+ [ ] foo ${CREATED} ${TODAY}`],
    ["1. foo", TODAY, `1. [ ] foo ${CREATED} ${TODAY}`],
    ["2) foo", null, "2) [ ] foo"],
    ["  - foo", TODAY, `  - [ ] foo ${CREATED} ${TODAY}`],
    ["> - foo", TODAY, `> - [ ] foo ${CREATED} ${TODAY}`],
    [">- foo", TODAY, `>- [ ] foo ${CREATED} ${TODAY}`],
    ["-   foo", null, "-   [ ] foo"],
    [`- foo ${CREATED} 2026-01-01`, TODAY, `- [ ] foo ${CREATED} 2026-01-01`],
    [`- foo ${CREATED} 2026-02-30`, TODAY, `- [ ] foo ${CREATED} 2026-02-30`],
    ["hello", null, "- [ ] hello"],
    ["hello", TODAY, `- [ ] hello ${CREATED} ${TODAY}`],
    ["  hello", TODAY, `  - [ ] hello ${CREATED} ${TODAY}`],
    ["> hello", TODAY, `> - [ ] hello ${CREATED} ${TODAY}`],
    [">hello", TODAY, `>- [ ] hello ${CREATED} ${TODAY}`],
    ["> > hello", TODAY, `> > - [ ] hello ${CREATED} ${TODAY}`],
    ["hello ^bid", TODAY, `- [ ] hello ${CREATED} ${TODAY} ^bid`],
    ["hello   ", TODAY, `- [ ] hello ${CREATED} ${TODAY}   `],
    ["# heading", TODAY, null],
    ["## heading", TODAY, null],
    ["###### heading", TODAY, null],
    ["####### heading", TODAY, `- [ ] ####### heading ${CREATED} ${TODAY}`],
    ["#heading", null, "- [ ] #heading"],
    ["> # Title", TODAY, null],
    ["># Title", TODAY, null],
    ["> #Title", null, "> - [ ] #Title"],
    ["```", TODAY, null],
    ["````js", TODAY, null],
    ["~~~", TODAY, null],
    ["~~~python", TODAY, null],
    ["> ```", TODAY, null],
    [">~~~", TODAY, null],
    ["`` not a fence", null, "- [ ] `` not a fence"],
    ["| a | b |", TODAY, null],
    ["  | a |", TODAY, null],
    ["> | a |", TODAY, null],
    [">| a |", TODAY, null],
    ["---", TODAY, null],
    ["***", TODAY, null],
    ["___", TODAY, null],
    ["- - -", TODAY, null],
    ["* * *", TODAY, null],
    ["> ---", TODAY, null],
    ["   ---", TODAY, null],
    ["--", null, "- [ ] --"],
    ["- [ ] already", TODAY, null],
    ["> - [x] already", TODAY, null],
    ["- [-] already", null, null],
    ["+ [/] already", TODAY, null],
  ])("converts %j with %j into %j", (line, createdDate, expectedLine) => {
    const result = convertLineToTask(line, createdDate);
    if (expectedLine === null) {
      expect(result).toBeNull();
      return;
    }
    expect(result).not.toBeNull();
    if (result === null) {
      return;
    }
    expect(applyLinePatches(line, result.patches)).toBe(expectedLine);
    const cursor = expectedCursor(line, createdDate, expectedLine);
    expect(result.cursor).toBe(cursor);
    if (cursor !== expectedLine.length) {
      expect(expectedLine[cursor]).toBe(" ");
      expect(expectedLine.slice(cursor + 1).startsWith(`${CREATED} ${TODAY}`)).toBe(true);
    }
  });
});
