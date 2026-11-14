import { describe, expect, it } from "vitest";

import { isCompletedStatusChar, parseTaskLine, TASK_DATE_MARKERS } from "./task-line";
import type { ParsedTaskLine } from "./task-line";

const CREATED = TASK_DATE_MARKERS.created;
const DONE = TASK_DATE_MARKERS.done;
const DUE = TASK_DATE_MARKERS.due;
const DUE_CALENDAR = "\u{1F4C6}";
const DUE_TEAR_OFF = "\u{1F5D3}";
const VS16 = "\uFE0F";

function parsed(line: string): ParsedTaskLine {
  const result = parseTaskLine(line);
  expect(result, line).not.toBeNull();
  if (result === null) {
    throw new Error(`expected a task: ${line}`);
  }
  return result;
}

describe("isCompletedStatusChar", () => {
  it.each([
    [" ", false],
    ["x", true],
    ["X", true],
    ["-", true],
    ["/", true],
    [">", true],
  ] as const)("treats %j as completed=%s", (status, completed) => {
    expect(isCompletedStatusChar(status)).toBe(completed);
  });
});

describe("parseTaskLine", () => {
  it.each([
    ["- [ ] task", "- ", " ", false],
    ["* [ ] task", "* ", " ", false],
    ["+ [ ] task", "+ ", " ", false],
    ["1. [ ] task", "1. ", " ", false],
    ["1) [ ] task", "1) ", " ", false],
    ["12. [x] task", "12. ", "x", true],
    ["99) [/] task", "99) ", "/", true],
    ["- [-] task", "- ", "-", true],
    ["- [X] task", "- ", "X", true],
    ["  - [ ] task", "  - ", " ", false],
    ["\t- [ ] task", "\t- ", " ", false],
    ["> - [ ] task", "> - ", " ", false],
    [">- [ ] task", ">- ", " ", false],
    ["> > - [x] task", "> > - ", "x", true],
    ["> > > - [-] task", "> > > - ", "-", true],
    [">   - [ ] nested", ">   - ", " ", false],
    ["  > - [/] quoted", "  > - ", "/", true],
    [">\t- [ ] tabbed quote", ">\t- ", " ", false],
    ["-  [ ] spaced", "-  ", " ", false],
    ["1.\t[ ] tabbed", "1.\t", " ", false],
  ] as const)("parses %j with prefix %j status %j completed=%s", (line, prefix, status, completed) => {
    const task = parsed(line);
    expect(task.prefix).toBe(prefix);
    expect(task.statusChar).toBe(status);
    expect(task.completed).toBe(completed);
    expect(task.statusSpan).toEqual({ from: prefix.length + 1, to: prefix.length + 1 + status.length });
    expect(line.slice(task.statusSpan.from, task.statusSpan.to)).toBe(status);
    expect(line[task.statusSpan.from - 1]).toBe("[");
    expect(line[task.statusSpan.to]).toBe("]");
  });

  it.each([
    "",
    "   ",
    "hello",
    "- hello",
    "- [ ]nope",
    "-[] ",
    "-[]",
    "-[ ] task",
    "1.[ ] task",
    "# [ ] task",
    "> hello",
    "- [xy] task",
    "*[*] task",
    "---",
    "| a | b |",
  ])("rejects %j", (line) => {
    expect(parseTaskLine(line)).toBeNull();
  });

  it("accepts an empty checkbox and a tab after the bracket", () => {
    const empty = parsed("- [ ]");
    expect(empty.bodySpan).toEqual({ from: 5, to: 5 });
    expect(empty.description).toBe("");
    expect(empty.insertionOffset).toBe(5);

    const tabbed = parsed("- [ ]\tfoo");
    expect(tabbed.bodySpan).toEqual({ from: 5, to: tabbed.bodySpan.to });
    expect(tabbed.description).toBe("foo");
  });

  it("skips exactly one space before the body and collapses the description", () => {
    const task = parsed("- [ ]  hello   world");
    expect(task.bodySpan.from).toBe(6);
    expect(task.description).toBe("hello world");
    expect("- [ ]  hello   world".slice(task.bodySpan.from)).toBe(" hello   world");
  });

  it("reads canonical markers, variation selectors, and due alternates only inside the body", () => {
    const line = `- [ ] before ${DUE}${VS16} 2026-01-02 ${DUE_CALENDAR} 2026-03-04 ${DUE_TEAR_OFF}${VS16}   2026-05-06 ${CREATED}2026-07-08 ${DONE} 2026-09-10`;
    const task = parsed(line);
    expect(task.dateTokens.map((token) => [token.kind, token.value, token.valid])).toEqual([
      ["due", "2026-01-02", true],
      ["due", "2026-03-04", true],
      ["due", "2026-05-06", true],
      ["created", "2026-07-08", true],
      ["done", "2026-09-10", true],
    ]);
    expect(task.dates.due?.value).toBe("2026-01-02");
    expect(task.dates.created?.value).toBe("2026-07-08");
    expect(task.dates.done?.value).toBe("2026-09-10");
    expect(line.slice(task.dateTokens[0]?.span.from, task.dateTokens[0]?.span.to)).toBe(`${DUE}${VS16} 2026-01-02`);
    expect(line.slice(task.dateTokens[2]?.span.from, task.dateTokens[2]?.span.to)).toBe(`${DUE_TEAR_OFF}${VS16}   2026-05-06`);
    expect(task.description).toBe("before");
    for (const token of task.dateTokens) {
      expect(token.span.from).toBeGreaterThanOrEqual(task.bodySpan.from);
      expect(token.span.to).toBeLessThanOrEqual(task.bodySpan.to);
    }

    expect(parseTaskLine(`${DUE} 2026-01-01 - [ ] inside`)).toBeNull();
  });

  it("keeps invalid dates in dateTokens and out of dates, and keeps the first valid token", () => {
    const line = `- [ ] plan ${DUE} 2026-02-30 ${DUE} 2026-04-01 ${DUE} 2026-05-01 ${CREATED} 2026-02-31`;
    const task = parsed(line);
    expect(task.dateTokens.map((token) => [token.kind, token.value, token.valid])).toEqual([
      ["due", "2026-02-30", false],
      ["due", "2026-04-01", true],
      ["due", "2026-05-01", true],
      ["created", "2026-02-31", false],
    ]);
    expect(task.dates.due?.value).toBe("2026-04-01");
    expect(task.dates.due?.span).toEqual(task.dateTokens[1]?.span);
    expect(task.dates.created).toBeUndefined();
    expect(task.description).toBe("plan");
  });

  it("does not treat a marker without a date, or a tab before the date, as a token", () => {
    const line = `- [ ] ${DUE} soon ${DUE}\t2026-01-01 ${CREATED} ${VS16} 2026-01-02`;
    const task = parsed(line);
    expect(task.dateTokens).toEqual([]);
    expect(task.description).toBe(`${DUE} soon ${DUE} 2026-01-01 ${CREATED} ${VS16} 2026-01-02`);
  });

  it("records a trailing block id and inserts before it and before trailing whitespace", () => {
    const withIdLine = `- [ ] ship ${DUE} 2026-01-02 ^block-id`;
    const withId = parsed(withIdLine);
    expect(withId.blockId).toBe("block-id");
    expect(withId.description).toBe("ship");
    expect(withId.insertionOffset).toBe(`- [ ] ship ${DUE} 2026-01-02`.length);
    expect(withIdLine[withId.insertionOffset]).toBe(" ");
    expect(withIdLine.slice(withId.insertionOffset)).toBe(" ^block-id");

    const padded = `- [ ] ship ^block-id   \t`;
    const paddedTask = parsed(padded);
    expect(paddedTask.blockId).toBe("block-id");
    expect(paddedTask.insertionOffset).toBe(padded.indexOf(" ^block-id"));
    expect(paddedTask.description).toBe("ship");

    const trailing = parsed("- [ ] ship   \t");
    expect(trailing.blockId).toBeNull();
    expect(trailing.insertionOffset).toBe("- [ ] ship".length);

    const bare = parsed("- [ ] ^note");
    expect(bare.blockId).toBe("note");
    expect(bare.description).toBe("");
    expect(bare.insertionOffset).toBe("- [ ]".length);
  });
});
