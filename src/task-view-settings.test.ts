import { DEFAULT_TASK_DATE_COLORS, normalizeTaskDateColors, taskDateColorStyle, TASK_DATE_COLORS } from "./task-view-settings";
import { describe, expect, it } from "vitest";

import type { TimeGroupGranularity } from "./card-grouping-settings";
import type { SortDirection } from "./settings";
import {
  DEFAULT_TASK_GROUP,
  DEFAULT_TASK_SORT,
  normalizeDefaultViewMode,
  normalizeOptionalBoxTaskView,
  normalizeTaskDateButtonStyle,
  normalizeTaskDateButtonsMode,
  normalizeTaskGroupSpec,
  normalizeTaskSortSpec,
  type TaskGroupDimension,
  type TaskSortField,
} from "./task-view-settings";

const SORT_FIELDS: TaskSortField[] = ["due", "created", "done", "file", "text"];
const DIRECTIONS: SortDirection[] = ["asc", "desc"];
const DIMENSIONS: TaskGroupDimension[] = ["none", "file", "status", "due", "created", "done"];
const GRANULARITIES: TimeGroupGranularity[] = ["day", "week", "biweek", "month", "year", "relative"];

describe("task view defaults", () => {
  it("sorts by due date ascending and leaves tasks ungrouped", () => {
    expect(DEFAULT_TASK_SORT).toEqual({ field: "due", direction: "asc" });
    expect(DEFAULT_TASK_GROUP).toEqual({ dimension: "none" });
    expect(DEFAULT_TASK_GROUP).not.toHaveProperty("timeGranularity");
  });
});

describe("normalizeTaskSortSpec", () => {
  it("returns a fresh default for undefined, null, and non-record values", () => {
    for (const value of [undefined, null, "due", 0, true]) {
      const normalized = normalizeTaskSortSpec(value);
      expect(normalized).toEqual(DEFAULT_TASK_SORT);
      expect(normalized).not.toBe(DEFAULT_TASK_SORT);
    }
  });

  it("returns the default spec for a record with unknown members", () => {
    expect(normalizeTaskSortSpec({ field: "mtime", direction: "sideways" })).toEqual(DEFAULT_TASK_SORT);
    expect(normalizeTaskSortSpec({})).toEqual(DEFAULT_TASK_SORT);
  });

  it("round-trips every valid field and direction", () => {
    for (const field of SORT_FIELDS) {
      expect(normalizeTaskSortSpec({ field, direction: "asc" }).field).toBe(field);
    }
    for (const direction of DIRECTIONS) {
      expect(normalizeTaskSortSpec({ field: "due", direction }).direction).toBe(direction);
    }
  });

  it("keeps valid members of a partially valid record and defaults the rest", () => {
    expect(normalizeTaskSortSpec({ field: "file", direction: null })).toEqual({
      field: "file",
      direction: "asc",
    });
    expect(normalizeTaskSortSpec({ direction: "desc" })).toEqual({
      field: "due",
      direction: "desc",
    });
  });

  it("ignores unrelated members", () => {
    expect(normalizeTaskSortSpec({ field: "text", direction: "desc", extra: true })).toEqual({
      field: "text",
      direction: "desc",
    });
  });
});

describe("normalizeTaskGroupSpec", () => {
  it("returns a fresh default for undefined, null, and non-record values", () => {
    for (const value of [undefined, null, "file", 0, true]) {
      const normalized = normalizeTaskGroupSpec(value);
      expect(normalized).toEqual(DEFAULT_TASK_GROUP);
      expect(normalized).not.toBe(DEFAULT_TASK_GROUP);
    }
  });

  it("returns the default spec for a record with an unknown dimension", () => {
    expect(normalizeTaskGroupSpec({ dimension: "folder", timeGranularity: "week" })).toEqual(DEFAULT_TASK_GROUP);
    expect(normalizeTaskGroupSpec({})).toEqual(DEFAULT_TASK_GROUP);
  });

  it("round-trips every non-time dimension without a granularity", () => {
    for (const dimension of ["none", "file", "status", "due"] as const) {
      expect(normalizeTaskGroupSpec({ dimension, timeGranularity: "month" })).toEqual({ dimension });
    }
  });

  it("round-trips every dimension", () => {
    for (const dimension of DIMENSIONS) {
      expect(normalizeTaskGroupSpec({ dimension }).dimension).toBe(dimension);
    }
  });

  it("keeps a granularity only for created and done, defaulting an invalid one to day", () => {
    for (const dimension of ["created", "done"] as const) {
      expect(normalizeTaskGroupSpec({ dimension })).toEqual({ dimension, timeGranularity: "day" });
      expect(normalizeTaskGroupSpec({ dimension, timeGranularity: "century" })).toEqual({
        dimension,
        timeGranularity: "day",
      });
      for (const timeGranularity of GRANULARITIES) {
        expect(normalizeTaskGroupSpec({ dimension, timeGranularity })).toEqual({ dimension, timeGranularity });
      }
    }
  });

  it("ignores unrelated members", () => {
    expect(normalizeTaskGroupSpec({ dimension: "status", orderBy: "count" })).toEqual({ dimension: "status" });
  });
});

describe("normalizeTaskDateButtonsMode", () => {
  it("accepts compact and full and defaults everything else to compact", () => {
    expect(normalizeTaskDateButtonsMode("compact")).toBe("compact");
    expect(normalizeTaskDateButtonsMode("full")).toBe("full");
    for (const value of [undefined, null, "wide", "Full", 1, true]) {
      expect(normalizeTaskDateButtonsMode(value)).toBe("compact");
    }
  });
});

describe("normalizeTaskDateButtonStyle", () => {
  it("accepts chips and dots and defaults everything else to chips", () => {
    expect(normalizeTaskDateButtonStyle("chips")).toBe("chips");
    expect(normalizeTaskDateButtonStyle("dots")).toBe("dots");
    for (const value of [undefined, null, "pills", "Dots", 1, true]) {
      expect(normalizeTaskDateButtonStyle(value)).toBe("chips");
    }
  });
});

describe("normalizeDefaultViewMode", () => {
  it("accepts cards and tasks and defaults everything else to cards", () => {
    expect(normalizeDefaultViewMode("cards")).toBe("cards");
    expect(normalizeDefaultViewMode("tasks")).toBe("tasks");
    for (const value of [undefined, null, "task", "Tasks", 1, true]) {
      expect(normalizeDefaultViewMode(value)).toBe("cards");
    }
  });
});

describe("normalizeOptionalBoxTaskView", () => {
  it("stays empty when the source or the fields are absent", () => {
    expect(normalizeOptionalBoxTaskView(undefined)).toEqual({});
    expect(normalizeOptionalBoxTaskView(null)).toEqual({});
    expect(normalizeOptionalBoxTaskView({ id: "box-1" })).toEqual({});
    expect(normalizeOptionalBoxTaskView({ viewMode: undefined, taskSort: undefined, taskGroup: undefined })).toEqual({});
  });

  it("copies valid fields and does not share the input objects", () => {
    const taskSort = { field: "file" as const, direction: "desc" as const };
    const taskGroup = { dimension: "created" as const, timeGranularity: "week" as const };
    const normalized = normalizeOptionalBoxTaskView({ viewMode: "tasks", taskSort, taskGroup });
    expect(normalized).toEqual({ taskSort, taskGroup });
    expect(normalized.taskSort).not.toBe(taskSort);
    expect(normalized.taskGroup).not.toBe(taskGroup);
  });

  it("normalizes a present invalid value to the task-view default", () => {
    expect(normalizeOptionalBoxTaskView({
      viewMode: "board",
      taskSort: null,
      taskGroup: { dimension: "folder", timeGranularity: "century" },
    })).toEqual({
      taskSort: DEFAULT_TASK_SORT,
      taskGroup: DEFAULT_TASK_GROUP,
    });
  });
});

describe("task date colors", () => {
  it("defaults each absent or invalid field independently", () => {
    expect(normalizeTaskDateColors(undefined)).toEqual(DEFAULT_TASK_DATE_COLORS);
    expect(normalizeTaskDateColors({ created: "pink", done: "bad", due: null })).toEqual({ ...DEFAULT_TASK_DATE_COLORS, created: "pink" });
  });
  it.each(TASK_DATE_COLORS)("accepts theme color %s for each date", color => {
    const colors = { created: color, done: color, due: color, overdue: color };
    expect(normalizeTaskDateColors(colors)).toEqual(colors);
    expect(taskDateColorStyle(colors)).toContain(`--fce-task-overdue-color: var(--color-${color});`);
  });
});


it.each(["tag", "link"])("accepts task %s grouping without date granularity", dimension => {
  expect(normalizeTaskGroupSpec({ dimension, timeGranularity: "month" })).toEqual({ dimension });
});
