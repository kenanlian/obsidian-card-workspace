import { describe, expect, it } from "vitest";
import { parseTaskLine } from "../tasks";
import { buildTaskCopyText, filterTaskTrees, resolveTaskRange, validTaskRange, type TaskDateFilter } from "./task-filters";
import type { TaskCardRecord } from "./types";

function task(line: number, text: string, children: TaskCardRecord[] = []): TaskCardRecord {
  const parsed = parseTaskLine(text)!;
  return { kind: "task", path: `a.md::L${line}`, filePath: "a.md", fileTitle: "a", file: {} as never, fileOrder: 0,
    line, lineText: text, text: parsed.description, statusChar: parsed.statusChar, completed: parsed.completed,
    dates: { created: parsed.dates.created?.value ?? null, done: parsed.dates.done?.value ?? null, due: parsed.dates.due?.value ?? null }, children };
}
const date: TaskDateFilter = { field: "done", preset: "previous-report", weekEnd: 4, start: "", end: "" };
const today = new Date(2026, 10, 15);

describe("task reporting ranges", () => {
  it("resolves adjacent inclusive seven-day periods and includes the deadline day", () => {
    expect(resolveTaskRange(date, today, 1)).toEqual({ start: "2026-11-06", end: "2026-11-12" });
    expect(resolveTaskRange({ ...date, preset: "report" }, today, 1)).toEqual({ start: "2026-11-13", end: "2026-11-19" });
    expect(resolveTaskRange({ ...date, preset: "report" }, new Date(2026, 10, 12), 1)).toEqual({ start: "2026-11-06", end: "2026-11-12" });
  });
  it("resolves calendar weeks with host week start across a year boundary", () => {
    expect(resolveTaskRange({ ...date, preset: "week" }, new Date(2027, 0, 1), 1)).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(resolveTaskRange({ ...date, preset: "week" }, today, 0)).toEqual({ start: "2026-11-15", end: "2026-11-21" });
    expect(validTaskRange("2026-02-30", "2026-03-01")).toBe(false);
    expect(validTaskRange("2026-11-12", "2026-11-06")).toBe(false);
    expect(validTaskRange("2026-11-12", "2026-11-12")).toBe(true);
  });
});
describe("task tree filtering", () => {
  it("promotes matching descendants, prunes completed children and reconnects retained ancestors", () => {
    const tree = task(0, "- [x] parent", [task(1, "  - [ ] first", [task(2, "    - [x] skip", [task(3, "      - [ ] grandchild")])]), task(4, "  - [x] hidden"), task(5, "  - [ ] second")]);
    const result = filterTaskTrees([tree], { status: "incomplete", date: null }, today, 1);
    expect(result.map(item => item.path)).toEqual(["a.md::L1", "a.md::L5"]);
    expect(result[0]?.children.map(item => item.line)).toEqual([3]);
    expect(tree.children).toHaveLength(3);
  });
  it("intersects dates and status independently without inheriting missing dates", () => {
    const root = task(0, "- [ ] parent ➕ 2026-11-06", [task(1, "  - [x] start ✅ 2026-11-06"), task(2, "  - [-] end ✅ 2026-11-12"), task(3, "  - [x] outside ✅ 2026-11-13"), task(4, "  - [x] undated")]);
    expect(filterTaskTrees([root], { status: "completed", date }, today, 1).map(item => item.line)).toEqual([1, 2]);
  });
});
describe("task clipboard formats", () => {
  const root = task(0, "- [x] **Ship** [[Note|label]] ✅ 2026-11-12 ^abc", [task(1, "  - [/] child")]);
  const groups = [{ key: "one", label: "Last week", tasks: [root] }];
  it("copies plain text, unordered and original-status task lists with children", () => {
    expect(buildTaskCopyText(groups, "text", false, true)).toEqual({ text: "Last week\nShip label\n  child", count: 2 });
    expect(buildTaskCopyText(groups, "unordered", false, false).text).toBe("- Ship label\n  - child");
    expect(buildTaskCopyText(groups, "tasks", false, false).text).toBe("- [x] Ship label\n  - [/] child");
  });
  it("preserves original body information in all formats while removing block ids", () => {
    for (const format of ["text", "unordered", "tasks"] as const) {
      const result = buildTaskCopyText(groups, format, true, false);
      expect(result.text).toContain("**Ship** [[Note|label]] ✅ 2026-11-12");
      expect(result.text).not.toContain("^abc");
    }
  });
  it("keeps group order and same-text distinct tasks without truncating results", () => {
    const many = Array.from({ length: 1000 }, (_, line) => task(line, "- [ ] same"));
    expect(buildTaskCopyText([{ key: "", label: "", tasks: many }], "text", false, true).count).toBe(1000);
    expect(buildTaskCopyText([...groups, { ...groups[0]!, key: "two", label: "Next" }], "text", false, true).text).toContain("\n\nNext\n");
  });
});
