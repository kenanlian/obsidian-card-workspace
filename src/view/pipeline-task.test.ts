import { describe, expect, it, vi } from "vitest";
import { getUiStrings } from "../i18n";
import type { TaskGroupSpec, TaskSortSpec } from "../task-view-settings";
import { parseTaskLine, type TaskFileEntry, type TaskNode } from "../tasks";
import * as metadataUtils from "./metadata-utils";
import {
  applyTaskSort,
  applyTaskTextFilter,
  runTaskPipeline,
  type TaskPipelineContext,
} from "./pipeline";
import { createBoxScope, createFolderScope, createLinksScope } from "./scope";
import type { NoteCardRecord, TaskCardRecord } from "./types";
import type { CardFileKind } from "./file-kind";

function task(line: number, text: string, children: TaskNode[] = []): TaskNode {
  const parsed = parseTaskLine(text);
  if (parsed === null) throw new Error(`Not a task line: ${text}`);
  return { line, lineText: text, parsed, children };
}

function card(path: string, fileKind: CardFileKind = "markdown"): NoteCardRecord {
  const basename = path.replace(/.*\//, "").replace(/\.[^.]+$/, "");
  return {
    file: { path, basename } as NoteCardRecord["file"],
    fileKind,
    path,
    title: basename,
    ctime: 1,
    mtime: 1,
    excerpt: "",
    previewHtml: "",
    previewMode: "empty",
    hydrated: false,
    taskSummary: null,
  };
}

function entries(map: Record<string, TaskNode[]>): (path: string) => TaskFileEntry | null {
  return (path) => (path in map ? { path, mtime: 1, roots: map[path] ?? [] } : null);
}

function context(overrides: Partial<TaskPipelineContext> = {}): TaskPipelineContext {
  return {
    app: {} as TaskPipelineContext["app"],
    scope: createFolderScope("", true),
    filterTags: [],
    propertyFilters: [],
    query: "",
    sort: { field: "file", direction: "asc" },
    group: { dimension: "none" },
    getTaskEntry: () => null,
    today: new Date(2026, 10, 14),
    firstDayOfWeek: 1,
    strings: getUiStrings("en").sortGroup,
    collapsedGroupKeys: new Set(),
    ...overrides,
  };
}

const texts = (cards: readonly TaskCardRecord[]): string[] => cards.map((entry) => entry.text);

describe("runTaskPipeline expansion", () => {
  it("projects one record per root task with embedded subtasks and synthetic ids", () => {
    const sub = task(2, "  - [x] child ✅ 2026-11-01");
    const result = runTaskPipeline([card("notes/a.md")], context({
      getTaskEntry: entries({ "notes/a.md": [task(1, "- [ ] parent 📅 2026-11-20 ➕ 2026-11-02", [sub]), task(5, "- [-] cancelled")] }),
    }));

    expect(result.cards).toHaveLength(2);
    const [parent, cancelled] = result.cards;
    expect(parent).toMatchObject({
      kind: "task",
      path: "notes/a.md::L1",
      filePath: "notes/a.md",
      fileTitle: "a",
      fileOrder: 0,
      line: 1,
      text: "parent",
      completed: false,
      statusChar: " ",
      dates: { created: "2026-11-02", done: null, due: "2026-11-20" },
    });
    expect(parent?.children).toEqual([expect.objectContaining({
      line: 2, text: "child", completed: true, statusChar: "x",
      dates: { created: null, done: "2026-11-01", due: null }, children: [],
    })]);
    expect(cancelled).toMatchObject({ completed: true, statusChar: "-" });
  });

  it("skips non-Markdown cards and cards whose entry is not loaded", () => {
    const getTaskEntry = vi.fn(entries({ "a.md": [task(0, "- [ ] a")], "img.png": [task(0, "- [ ] never")] }));
    const result = runTaskPipeline([card("a.md"), card("img.png", "image"), card("missing.md")], context({ getTaskEntry }));

    expect(texts(result.cards)).toEqual(["a"]);
    expect(getTaskEntry).not.toHaveBeenCalledWith("img.png");
  });

  it("records the file index in the unfiltered base order", () => {
    const spy = vi.spyOn(metadataUtils, "matchesTagFilter").mockImplementation((_app, file) => file.path !== "a.md");
    const result = runTaskPipeline([card("a.md"), card("b.md")], context({
      filterTags: ["work"],
      getTaskEntry: entries({ "a.md": [task(0, "- [ ] a")], "b.md": [task(0, "- [ ] b")] }),
    }));
    spy.mockRestore();

    expect(result.cards.map((entry) => [entry.text, entry.fileOrder])).toEqual([["b", 1]]);
  });
});

describe("runTaskPipeline browse filters", () => {
  const base = [card("a.md"), card("b.md")];
  const getTaskEntry = entries({ "a.md": [task(0, "- [ ] a")], "b.md": [task(0, "- [ ] b")] });

  it("applies the tag filter in folder and box scopes", () => {
    const spy = vi.spyOn(metadataUtils, "matchesTagFilter").mockImplementation((_app, file) => file.path === "b.md");
    for (const scope of [createFolderScope("", true), createBoxScope("box")]) {
      expect(texts(runTaskPipeline(base, context({ scope, filterTags: ["x"], getTaskEntry })).cards)).toEqual(["b"]);
    }
    spy.mockRestore();
  });

  it("applies the property filter from the metadata cache", () => {
    const app = {
      metadataCache: {
        getFileCache: (file: { path: string }) => ({ frontmatter: { status: file.path === "a.md" ? "open" : "done" } }),
      },
    } as unknown as TaskPipelineContext["app"];
    const result = runTaskPipeline(base, context({
      app,
      propertyFilters: [{ key: "status", values: [{ kind: "text", value: "open" }] }],
      getTaskEntry,
    }));
    expect(texts(result.cards)).toEqual(["a"]);
  });

  it("keeps browse filters dormant for a links scope", () => {
    const spy = vi.spyOn(metadataUtils, "matchesTagFilter").mockReturnValue(false);
    const result = runTaskPipeline(base, context({ scope: createLinksScope("a.md", "backlinks"), filterTags: ["x"], getTaskEntry }));
    expect(texts(result.cards)).toEqual(["a", "b"]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("never applies pin order", () => {
    const result = runTaskPipeline(base, context({ getTaskEntry, sort: { field: "file", direction: "asc" } }));
    expect(texts(result.cards)).toEqual(["a", "b"]);
  });
});

describe("applyTaskTextFilter", () => {
  const records = runTaskPipeline([card("Projects/Alpha.md"), card("beta.md")], context({
    getTaskEntry: entries({
      "Projects/Alpha.md": [task(0, "- [ ] Write report"), task(1, "- [ ] Call Bob")],
      "beta.md": [task(0, "- [ ] Plan trip", [task(1, "  - [ ] Book HOTEL")]), task(3, "- [ ] Unrelated")],
    }),
  })).cards;

  it("passes everything through for an empty or blank query", () => {
    expect(applyTaskTextFilter(records, "")).toBe(records);
    expect(applyTaskTextFilter(records, "   ")).toBe(records);
  });

  it("matches root text case-insensitively after trimming", () => {
    expect(texts(applyTaskTextFilter(records, "  REPORT "))).toEqual(["Write report"]);
  });

  it("matches a root through its subtask text", () => {
    expect(texts(applyTaskTextFilter(records, "hotel"))).toEqual(["Plan trip"]);
  });

  it("matches every root of a file through the file title", () => {
    expect(texts(applyTaskTextFilter(records, "alpha"))).toEqual(["Write report", "Call Bob"]);
  });

  it("filters the task stream before sorting and keeps grouping active with a query", () => {
    const result = runTaskPipeline([card("a.md"), card("b.md")], context({
      query: "x",
      group: { dimension: "file" },
      getTaskEntry: entries({ "a.md": [task(0, "- [ ] x1"), task(1, "- [ ] y")], "b.md": [task(0, "- [ ] x2")] }),
    }));
    expect(texts(result.cards)).toEqual(["x1", "x2"]);
    expect(result.segments.map((segment) => [segment.key, segment.count])).toEqual([["task-file:a.md", 1], ["task-file:b.md", 1]]);
  });
});

describe("applyTaskSort", () => {
  // fileOrder: a.md = 0, b.md = 1.
  const records = runTaskPipeline([card("a.md"), card("b.md")], context({
    getTaskEntry: entries({
      "a.md": [
        task(0, "- [ ] banana 📅 2026-11-20 ➕ 2026-11-01"),
        task(1, "- [ ] apple"),
        task(2, "- [x] cherry 📅 2026-11-18 ✅ 2026-11-10"),
      ],
      "b.md": [
        task(0, "- [ ] date 📅 2026-11-18 ➕ 2026-11-03"),
        task(4, "- [x] Apple ✅ 2026-11-12"),
      ],
    }),
  })).cards;
  const sort = (spec: TaskSortSpec): string[] => texts(applyTaskSort(records, spec));

  it("sorts due dates ascending with undated tasks last and ties by file order then line", () => {
    expect(sort({ field: "due", direction: "asc" })).toEqual(["cherry", "date", "banana", "apple", "Apple"]);
  });

  it("keeps undated tasks last when descending", () => {
    expect(sort({ field: "due", direction: "desc" })).toEqual(["banana", "cherry", "date", "apple", "Apple"]);
  });

  it("sorts created and done dates the same way", () => {
    expect(sort({ field: "created", direction: "asc" })).toEqual(["banana", "date", "apple", "cherry", "Apple"]);
    expect(sort({ field: "created", direction: "desc" })).toEqual(["date", "banana", "apple", "cherry", "Apple"]);
    expect(sort({ field: "done", direction: "asc" })).toEqual(["cherry", "Apple", "banana", "apple", "date"]);
    expect(sort({ field: "done", direction: "desc" })).toEqual(["Apple", "cherry", "banana", "apple", "date"]);
  });

  it("sorts by file order then line, reversing only the file order when descending", () => {
    expect(sort({ field: "file", direction: "asc" })).toEqual(["banana", "apple", "cherry", "date", "Apple"]);
    expect(sort({ field: "file", direction: "desc" })).toEqual(["date", "Apple", "banana", "apple", "cherry"]);
  });

  it("sorts text with localeCompare and breaks ties by file order then line", () => {
    const sorted = sort({ field: "text", direction: "asc" });
    expect(sorted.slice(2)).toEqual(["banana", "cherry", "date"]);
    expect(new Set(sorted.slice(0, 2))).toEqual(new Set(["apple", "Apple"]));
    expect(sort({ field: "text", direction: "desc" }).slice(0, 3)).toEqual(["date", "cherry", "banana"]);
  });

  it("does not mutate its input", () => {
    const before = texts(records);
    applyTaskSort(records, { field: "text", direction: "desc" });
    expect(texts(records)).toEqual(before);
  });
});

describe("task grouping", () => {
  const groupOf = (
    roots: Record<string, TaskNode[]>,
    group: TaskGroupSpec,
    extra: Partial<TaskPipelineContext> = {},
  ) => runTaskPipeline(Object.keys(roots).map((path) => card(path)), context({ getTaskEntry: entries(roots), group, ...extra }));

  it("returns a flat stream without segments for `none`", () => {
    const result = groupOf({ "a.md": [task(0, "- [ ] a")] }, { dimension: "none" });
    expect(result.segments).toEqual([]);
  });

  it("groups by file in base file order with the file title as header", () => {
    const result = groupOf({ "z/Zeta.md": [task(0, "- [ ] z")], "a/Alpha.md": [task(0, "- [ ] a"), task(1, "- [ ] a2")] },
      { dimension: "file" }, { sort: { field: "text", direction: "asc" } });
    expect(result.segments.map((segment) => ({ key: segment.key, label: segment.label, count: segment.count }))).toEqual([
      { key: "task-file:z/Zeta.md", label: "Zeta", count: 1 },
      { key: "task-file:a/Alpha.md", label: "Alpha", count: 2 },
    ]);
    expect(result.segments[0]?.header).toEqual({ kind: "task-group", dimension: "file", text: "Zeta", path: "z/Zeta.md" });
    expect(texts(result.cards)).toEqual(["z", "a", "a2"]);
  });

  it("groups by status with incomplete before completed and localized labels", () => {
    const roots = { "a.md": [task(0, "- [x] done"), task(1, "- [ ] open"), task(2, "- [/] partial")] };
    const en = groupOf(roots, { dimension: "status" });
    expect(en.segments.map((segment) => [segment.key, segment.label, segment.count])).toEqual([
      ["task-status:open", "Incomplete", 1],
      ["task-status:done", "Completed", 2],
    ]);
    const zh = groupOf(roots, { dimension: "status" }, { strings: getUiStrings("zh").sortGroup });
    expect(zh.segments.map((segment) => segment.label)).toEqual(["未完成", "已完成"]);
  });

  it("buckets due dates relative to an injected today with a Monday week start", () => {
    // Wednesday 2026-11-11; the week ends on Sunday 2026-11-15.
    const result = groupOf({
      "a.md": [
        task(0, "- [ ] later 📅 2026-11-16"),
        task(1, "- [ ] week-end 📅 2026-11-15"),
        task(2, "- [ ] none"),
        task(3, "- [ ] overdue 📅 2026-11-10"),
        task(4, "- [ ] today 📅 2026-11-11"),
        task(5, "- [ ] tomorrow 📅 2026-11-12"),
        task(6, "- [ ] week 📅 2026-11-13"),
      ],
    }, { dimension: "due" }, { today: new Date(2026, 10, 11, 15, 30), firstDayOfWeek: 1 });

    expect(result.segments.map((segment) => [segment.key, segment.label, segment.count])).toEqual([
      ["task-due:overdue", "Overdue", 1],
      ["task-due:today", "Today", 1],
      ["task-due:tomorrow", "Tomorrow", 1],
      ["task-due:thisWeek", "This week", 2],
      ["task-due:later", "Later", 1],
      ["task-due:none", "No due date", 1],
    ]);
    expect(result.segments.at(-1)?.isMissingBucket).toBe(true);
  });

  it("keeps tomorrow ahead of the week boundary and honors the first day of week", () => {
    const roots = { "a.md": [task(0, "- [ ] sun 📅 2026-11-15"), task(1, "- [ ] mon 📅 2026-11-16"), task(2, "- [ ] fri 📅 2026-11-20")] };
    const keyed = (firstDayOfWeek: number) => groupOf(roots, { dimension: "due" }, { today: new Date(2026, 10, 14), firstDayOfWeek })
      .segments.map((segment) => [segment.key, segment.count]);

    // Saturday today; Sunday-start weeks end today, so Sunday is tomorrow and Monday is later.
    expect(keyed(0)).toEqual([["task-due:tomorrow", 1], ["task-due:later", 2]]);
    expect(keyed(1)).toEqual([["task-due:tomorrow", 1], ["task-due:later", 2]]);
    // Saturday-start weeks run through Friday 2026-11-20.
    expect(keyed(6)).toEqual([["task-due:tomorrow", 1], ["task-due:thisWeek", 2]]);
  });

  it("groups created and done dates by time granularity with the missing bucket last", () => {
    const roots = {
      "a.md": [
        task(0, "- [x] one ✅ 2026-11-10 ➕ 2026-10-02"),
        task(1, "- [ ] two ➕ 2026-11-12"),
        task(2, "- [x] three ✅ 2026-11-13"),
      ],
    };
    const created = groupOf(roots, { dimension: "created", timeGranularity: "month" });
    expect(created.segments.map((segment) => [segment.key, segment.label, segment.count])).toEqual([
      ["task-created:month:2026-10", "2026-10", 1],
      ["task-created:month:2026-11", "2026-11", 1],
      ["task-created:none", "No created date", 1],
    ]);
    const done = groupOf(roots, { dimension: "done", timeGranularity: "relative" }, { today: new Date(2026, 10, 13) });
    expect(done.segments.map((segment) => [segment.key, segment.label])).toEqual([
      ["task-done:relative:week", "Past 7 days"],
      ["task-done:relative:today", "Today"],
      ["task-done:none", "No completed date"],
    ]);
    expect(done.segments[0]?.header).toEqual({ kind: "task-group", dimension: "done", text: "Past 7 days" });
  });

  it("orders date buckets by the sort direction only when sorting by the grouped date", () => {
    const roots = { "a.md": [task(0, "- [x] a ✅ 2026-10-01"), task(1, "- [x] b ✅ 2026-11-01"), task(2, "- [ ] c")] };
    const keys = (sort: TaskSortSpec) => groupOf(roots, { dimension: "done", timeGranularity: "month" }, { sort })
      .segments.map((segment) => segment.key);
    expect(keys({ field: "done", direction: "desc" })).toEqual(["task-done:month:2026-11", "task-done:month:2026-10", "task-done:none"]);
    expect(keys({ field: "text", direction: "desc" })).toEqual(["task-done:month:2026-10", "task-done:month:2026-11", "task-done:none"]);
  });

  it("drops collapsed groups' rows but keeps their segment and full count", () => {
    const result = groupOf({ "a.md": [task(0, "- [ ] open"), task(1, "- [x] done")] }, { dimension: "status" },
      { collapsedGroupKeys: new Set(["task-status:open"]) });
    expect(texts(result.cards)).toEqual(["done"]);
    expect(result.segments.map((segment) => [segment.key, segment.collapsed, segment.count, segment.visibleCount, segment.startIndex]))
      .toEqual([["task-status:open", true, 1, 0, 0], ["task-status:done", false, 1, 1, 0]]);
  });
});

describe("task copy projection", () => {
  it("keeps a complete ordered copy snapshot when every group is collapsed", () => {
    const base = [card("a.md")];
    const getTaskEntry = entries({ "a.md": [task(0, "- [ ] parent", [task(1, "  - [ ] child")]), task(3, "- [x] done")] });
    const first = runTaskPipeline(base, context({ getTaskEntry, group: { dimension: "status" } }));
    const collapsed = runTaskPipeline(base, context({ getTaskEntry, group: { dimension: "status" }, collapsedGroupKeys: new Set(first.segments.map(group => group.key)) }));
    expect(collapsed.cards).toEqual([]);
    expect(collapsed.copyGroups).toEqual(first.copyGroups);
    expect(collapsed.copyGroups?.flatMap(group => group.tasks)).toHaveLength(2);
  });
  it("filters hidden child text before the task text query", () => {
    const result = runTaskPipeline([card("a.md")], context({
      getTaskEntry: entries({ "a.md": [task(0, "- [ ] parent", [task(1, "  - [x] secret")])] }),
      taskFilters: { status: "incomplete", date: null }, query: "secret",
    }));
    expect(result.cards).toEqual([]);
  });
});


describe("task inline metadata groups", () => {
  function metadataContext(dimension: "tag" | "link") {
    const nodes = [task(0, "- [ ] parent #A #B [[Project|alias]] [[Project#Heading]]", [task(1, "  - [ ] child #C")]), task(2, "- [ ] no metadata")];
    const position = (col: number, line = 0) => ({ start: { line, col, offset: col }, end: { line, col, offset: col } });
    const source = nodes[0].lineText;
    return context({ group: { dimension }, getTaskEntry: entries({ "a.md": nodes }), app: {
      metadataCache: {
        getFileCache: () => ({
          tags: ["#A", "#B", "#A"].map(tag => ({ tag, position: position(source.indexOf(tag)) })).concat([{ tag: "#C", position: position(8, 1) }]),
          links: ["[[Project|alias]]", "[[Project#Heading]]"].map(original => ({ original, link: original.includes("Heading") ? "Project#Heading" : "Project", position: position(source.indexOf(original)) })),
        }),
        getFirstLinkpathDest: () => ({ path: "projects/Project.md", basename: "Project" }),
      },
    } as unknown as TaskPipelineContext["app"] });
  }
  it("repeats a multi-tag task per distinct tag, retains children, and captures complete collapsed copy groups", () => {
    const ctx = metadataContext("tag");
    const result = runTaskPipeline([card("a.md")], ctx);
    expect(result.segments.map(group => group.label)).toEqual(["#A", "#B", "No tag"]);
    expect(result.cards.map(task => task.line)).toEqual([0, 0, 2]);
    expect(result.cards[0].children).toHaveLength(1);
    const collapsed = runTaskPipeline([card("a.md")], { ...ctx, collapsedGroupKeys: new Set([result.segments[0].key]) });
    expect(collapsed.cards.map(task => task.line)).toEqual([0, 2]);
    expect(collapsed.copyGroups).toEqual(result.copyGroups);
  });
  it("merges aliases and heading references to one destination bucket", () => {
    const result = runTaskPipeline([card("a.md")], metadataContext("link"));
    expect(result.segments.map(group => group.label)).toEqual(["Project", "No wiki link"]);
    expect(result.cards).toHaveLength(2);
  });
});
