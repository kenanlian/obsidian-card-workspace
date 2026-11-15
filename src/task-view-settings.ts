import { isTimeGroupGranularity, type TimeGroupGranularity } from "./card-grouping-settings";
import type { DefaultViewMode, SortDirection } from "./settings";

export type TaskSortField = "due" | "created" | "done" | "file" | "text";

export interface TaskSortSpec {
  field: TaskSortField;
  direction: SortDirection;
}

export type TaskGroupDimension = "none" | "file" | "status" | "due" | "created" | "done";

/**
 * How tasks are bucketed.
 *
 * - `dimension`: bucket key (`"none"` = a flat task stream).
 * - `timeGranularity`: present only for `created` and `done`; defaults to calendar day.
 *   `due` stays a single bucket and does not carry a granularity.
 */
export interface TaskGroupSpec {
  dimension: TaskGroupDimension;
  timeGranularity?: TimeGroupGranularity;
}

export const DEFAULT_TASK_SORT: TaskSortSpec = { field: "due", direction: "asc" };

export const DEFAULT_TASK_GROUP: TaskGroupSpec = { dimension: "none" };

export type TaskDateButtonsMode = "compact" | "full";

/** `chips` matches task-card date chips; `dots` keeps one coloured dot per date. */
export type TaskDateButtonStyle = "chips" | "dots";

const TASK_SORT_FIELDS: ReadonlySet<string> = new Set<TaskSortField>([
  "due",
  "created",
  "done",
  "file",
  "text",
]);

const TASK_GROUP_DIMENSIONS: ReadonlySet<string> = new Set<TaskGroupDimension>([
  "none",
  "file",
  "status",
  "due",
  "created",
  "done",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTaskTimeDimension(dimension: TaskGroupDimension): dimension is "created" | "done" {
  return dimension === "created" || dimension === "done";
}

function normalizeTaskSortField(value: unknown): TaskSortField {
  return typeof value === "string" && TASK_SORT_FIELDS.has(value)
    ? (value as TaskSortField)
    : DEFAULT_TASK_SORT.field;
}

function normalizeTaskSortDirection(value: unknown): SortDirection {
  return value === "asc" || value === "desc" ? value : DEFAULT_TASK_SORT.direction;
}

export function normalizeTaskSortSpec(value: unknown): TaskSortSpec {
  if (!isRecord(value)) {
    return { ...DEFAULT_TASK_SORT };
  }
  return {
    field: normalizeTaskSortField(value.field),
    direction: normalizeTaskSortDirection(value.direction),
  };
}

function normalizeTaskGroupDimension(value: unknown): TaskGroupDimension {
  return typeof value === "string" && TASK_GROUP_DIMENSIONS.has(value)
    ? (value as TaskGroupDimension)
    : DEFAULT_TASK_GROUP.dimension;
}

export function normalizeTaskGroupSpec(value: unknown): TaskGroupSpec {
  if (!isRecord(value)) {
    return { ...DEFAULT_TASK_GROUP };
  }
  const dimension = normalizeTaskGroupDimension(value.dimension);
  if (!isTaskTimeDimension(dimension)) {
    return { dimension };
  }
  return {
    dimension,
    timeGranularity: isTimeGroupGranularity(value.timeGranularity) ? value.timeGranularity : "day",
  };
}

export function normalizeTaskDateButtonsMode(value: unknown): TaskDateButtonsMode {
  return value === "compact" || value === "full" ? value : "compact";
}

export function normalizeTaskDateButtonStyle(value: unknown): TaskDateButtonStyle {
  return value === "chips" || value === "dots" ? value : "chips";
}

/** Accepts `"cards"` and `"tasks"`. Anything else falls back to `"cards"`. */
export function normalizeDefaultViewMode(value: unknown): DefaultViewMode {
  return value === "cards" || value === "tasks" ? value : "cards";
}

/**
 * Optional box task-view fields.
 *
 * A missing field stays absent. A present value is normalized, and an invalid
 * present value becomes the task-view default instead of throwing.
 */
export function normalizeOptionalBoxTaskView(value: unknown): {
  taskSort?: TaskSortSpec;
  taskGroup?: TaskGroupSpec;
} {
  if (!isRecord(value)) {
    return {};
  }
  const fields: {
    taskSort?: TaskSortSpec;
    taskGroup?: TaskGroupSpec;
  } = {};
  if ("taskSort" in value && value.taskSort !== undefined) {
    fields.taskSort = normalizeTaskSortSpec(value.taskSort);
  }
  if ("taskGroup" in value && value.taskGroup !== undefined) {
    fields.taskGroup = normalizeTaskGroupSpec(value.taskGroup);
  }
  return fields;
}

/** Theme colour identifiers only; arbitrary CSS never enters settings. */
export const TASK_DATE_COLORS = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"] as const;
export type TaskDateColor = typeof TASK_DATE_COLORS[number];
export type TaskDateColors = Record<"created" | "done" | "due" | "overdue", TaskDateColor>;
export const DEFAULT_TASK_DATE_COLORS: TaskDateColors = { created: "blue", done: "green", due: "orange", overdue: "red" };
export function isTaskDateColor(value: unknown): value is TaskDateColor {
  return (TASK_DATE_COLORS as readonly unknown[]).includes(value);
}
export function normalizeTaskDateColors(value: unknown): TaskDateColors {
  const record = isRecord(value) ? value : {};
  return Object.fromEntries(Object.entries(DEFAULT_TASK_DATE_COLORS).map(([kind, fallback]) =>
    [kind, isTaskDateColor(record[kind]) ? record[kind] : fallback])) as TaskDateColors;
}
export function taskDateColorStyle(value: TaskDateColors | undefined): string {
  return Object.entries(normalizeTaskDateColors(value)).map(([kind, color]) =>
    `--fce-task-${kind}-color: var(--color-${color});`).join(" ");
}
