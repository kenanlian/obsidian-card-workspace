import { describe, expect, it } from "vitest";
import {
  buildTaskPlainText,
  buildTaskTextSegments,
  countSubtasks,
  readTaskDateParts,
  resolveTaskDueState,
  taskItemId,
} from "./task-card-display";

describe("task card display helpers", () => {
  it.each([
    ["Read [[Books/Dune|Dune]] and [[Notes]]", "Read Dune and Notes"],
    ["See [[Page#Heading]] now", "See Page now"],
    ["Visit [site](https://example.com) ![img](a.png) ![[embed.png]]", "Visit site"],
    ["**bold** __strong__ *em* _em_ ~~gone~~ ==mark== `code`", "bold strong em em gone mark code"],
    ["keep snake_case_names and 2 * 3 * 4", "keep snake_case_names and 2 * 3 * 4"],
    ["<script>alert(1)</script>", "<script>alert(1)</script>"],
    ["  spaced   out  ", "spaced out"],
  ])("strips inline Markdown from %j", (input, expected) => {
    expect(buildTaskPlainText(input)).toBe(expected);
  });

  it("splits whole-query highlights case-insensitively", () => {
    expect(buildTaskTextSegments("Ship the shipment", "SHIP")).toEqual([
      { text: "Ship", highlighted: true },
      { text: " the ", highlighted: false },
      { text: "ship", highlighted: true },
      { text: "ment", highlighted: false },
    ]);
    expect(buildTaskTextSegments("Ship", "  ")).toEqual([{ text: "Ship", highlighted: false }]);
  });

  it("resolves due urgency only for open tasks", () => {
    expect(resolveTaskDueState("2026-11-13", false, "2026-11-14")).toBe("overdue");
    expect(resolveTaskDueState("2026-11-14", false, "2026-11-14")).toBe("today");
    expect(resolveTaskDueState("2026-11-15", false, "2026-11-14")).toBe("upcoming");
    expect(resolveTaskDueState("2026-11-13", true, "2026-11-14")).toBeNull();
    expect(resolveTaskDueState(null, false, "2026-11-14")).toBeNull();
  });

  it("reads ISO date parts with a zero-based month", () => {
    expect(readTaskDateParts("2026-01-05")).toEqual({ year: 2026, month: 0, day: 5 });
    expect(readTaskDateParts("2026-13-05")).toBeNull();
    expect(readTaskDateParts("26-01-05")).toBeNull();
  });

  it("counts nested subtasks and builds item ids", () => {
    const tree = {
      completed: false,
      children: [
        { completed: true, children: [{ completed: false, children: [] }] },
        { completed: true, children: [] },
      ],
    };
    expect(countSubtasks(tree)).toEqual({ completed: 2, total: 3 });
    expect(taskItemId("a/b.md", 7)).toBe("a/b.md::L7");
  });
});
