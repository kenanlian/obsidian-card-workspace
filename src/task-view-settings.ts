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
  viewMode?: DefaultViewMode;
  taskSort?: TaskSortSpec;
  taskGroup?: TaskGroupSpec;
} {
  if (!isRecord(value)) {
    return {};
  }
  const fields: {
    viewMode?: DefaultViewMode;
    taskSort?: TaskSortSpec;
    taskGroup?: TaskGroupSpec;
  } = {};
  if ("viewMode" in value && value.viewMode !== undefined) {
    fields.viewMode = normalizeDefaultViewMode(value.viewMode);
  }
  if ("taskSort" in value && value.taskSort !== undefined) {
    fields.taskSort = normalizeTaskSortSpec(value.taskSort);
  }
  if ("taskGroup" in value && value.taskGroup !== undefined) {
    fields.taskGroup = normalizeTaskGroupSpec(value.taskGroup);
  }
  return fields;
}
