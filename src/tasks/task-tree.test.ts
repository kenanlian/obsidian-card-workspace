import { describe, expect, it } from "vitest";

import { buildTaskTree, splitContentLines } from "./task-tree";
import type { TaskListItemLike, TaskNode } from "./task-tree";

function item(line: number, parent: number, task?: string): TaskListItemLike {
  return { position: { start: { line } }, parent, task };
}

function shape(nodes: readonly TaskNode[]): unknown {
  return nodes.map((node) => ({
    line: node.line,
    text: node.lineText,
    status: node.parsed.statusChar,
    children: shape(node.children),
  }));
}

describe("splitContentLines", () => {
  it.each([
    ["", [""]],
    ["a", ["a"]],
    ["a\nb", ["a", "b"]],
    ["a\n", ["a", ""]],
    ["\n", ["", ""]],
    ["a\r\nb\r\n", ["a", "b", ""]],
    ["a\r\n b\r", ["a", " b"]],
    ["\r\n", ["", ""]],
    ["a\rb", ["a\rb"]],
    ["a\r", ["a"]],
    ["a\r\r", ["a\r"]],
  ] as const)("splits %j", (content, expected) => {
    expect(splitContentLines(content)).toEqual([...expected]);
  });
});

describe("buildTaskTree", () => {
  const content = [
    "- [ ] parent",
    "  - note",
    "    - also plain",
    "      - [ ] child",
    "  - [x] sibling",
    "- [/] root",
    "not a list",
  ];

  it("nests a task under a non-task under a task and keeps document order", () => {
    const items = [
      item(5, -1, "/"),
      item(4, 0, "x"),
      item(3, 2, " "),
      item(2, 1),
      item(1, 0),
      item(0, -1, " "),
    ];
    const roots = buildTaskTree(items, content);
    expect(shape(roots)).toEqual([
      {
        line: 0,
        text: "- [ ] parent",
        status: " ",
        children: [
          {
            line: 3,
            text: "      - [ ] child",
            status: " ",
            children: [],
          },
          {
            line: 4,
            text: "  - [x] sibling",
            status: "x",
            children: [],
          },
        ],
      },
      {
        line: 5,
        text: "- [/] root",
        status: "/",
        children: [],
      },
    ]);
    expect(roots[0]?.parsed.description).toBe("parent");
    expect(roots[0]?.children[0]?.parsed.completed).toBe(false);
    expect(roots[0]?.children[1]?.parsed.completed).toBe(true);
  });

  it("builds multi-level task nesting from the parent chain", () => {
    const lines = ["- [ ] a", "  - [ ] b", "    - [x] c", "      - [-] d"];
    const items = [
      item(0, -1, " "),
      item(1, 0, " "),
      item(2, 1, "x"),
      item(3, 2, "-"),
    ];
    expect(shape(buildTaskTree(items, lines))).toEqual([
      {
        line: 0,
        text: "- [ ] a",
        status: " ",
        children: [
          {
            line: 1,
            text: "  - [ ] b",
            status: " ",
            children: [
              {
                line: 2,
                text: "    - [x] c",
                status: "x",
                children: [
                  { line: 3, text: "      - [-] d", status: "-", children: [] },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("skips metadata that claims a task when the line does not parse, then walks through it", () => {
    const lines = ["- [ ] parent", "not a checkbox", "  - [ ] child"];
    const items = [
      item(0, -1, " "),
      item(1, 0, "x"),
      item(2, 1, " "),
    ];
    const roots = buildTaskTree(items, lines);
    expect(shape(roots)).toEqual([
      {
        line: 0,
        text: "- [ ] parent",
        status: " ",
        children: [
          { line: 2, text: "  - [ ] child", status: " ", children: [] },
        ],
      },
    ]);
  });

  it("ignores checkbox lines that have no list-item metadata", () => {
    const lines = ["- [ ] visible", "- [ ] hidden"];
    expect(shape(buildTaskTree([item(0, -1, " ")], lines))).toEqual([
      { line: 0, text: "- [ ] visible", status: " ", children: [] },
    ]);
  });

  it("treats an empty task string as task metadata", () => {
    const roots = buildTaskTree([item(0, -1, "")], ["- [ ] named"]);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.parsed.description).toBe("named");
  });

  it("makes a task a root when its parent line is missing", () => {
    const roots = buildTaskTree([item(0, 40, " ")], ["- [ ] orphan"]);
    expect(shape(roots)).toEqual([
      { line: 0, text: "- [ ] orphan", status: " ", children: [] },
    ]);
  });

  it("does not loop when the parent chain cycles", () => {
    const lines = ["- [ ] a", "- [ ] b"];
    const roots = buildTaskTree([
      item(0, 1, " "),
      item(1, 0, "x"),
    ], lines);
    expect(roots.map((node) => node.line)).toEqual([0, 1]);
    expect(roots.every((node) => node.children.length === 0)).toBe(true);
  });

  it("treats a self-parent and a negative parent as roots", () => {
    const lines = ["- [ ] self", "- [ ] top"];
    const roots = buildTaskTree([
      item(0, 0, " "),
      item(1, -1, " "),
    ], lines);
    expect(roots.map((node) => node.line)).toEqual([0, 1]);
  });

  it("reads CRLF content without keeping the carriage return on the task line", () => {
    const content = "- [ ] parent\r\n  - note\r\n    - [ ] child\r\n";
    const roots = buildTaskTree([
      item(0, -1, " "),
      item(1, 0),
      item(2, 1, " "),
    ], content);
    expect(roots[0]?.lineText).toBe("- [ ] parent");
    expect(roots[0]?.children[0]?.lineText).toBe("    - [ ] child");
    expect(roots[0]?.children[0]?.parsed.description).toBe("child");
  });

  it("uses a pre-split array without stripping a caller-supplied carriage return", () => {
    const roots = buildTaskTree([item(0, -1, " ")], ["- [ ] task\r"]);
    expect(roots[0]?.lineText).toBe("- [ ] task\r");
    expect(roots[0]?.parsed.description).toBe("task");
  });

  it("returns no roots for an empty item list", () => {
    expect(buildTaskTree([], "- [ ] unused")).toEqual([]);
  });
});
