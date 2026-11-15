export {
  compareIsoDates,
  formatIsoDate,
  isValidIsoDate,
  parseIsoDateLocal,
  resolveDatePreset,
} from "./task-dates";
export type { TaskDateKind, TaskDatePreset } from "./task-dates";

export {
  isCompletedStatusChar,
  parseTaskLine,
  TASK_DATE_MARKERS,
} from "./task-line";
export type { ParsedTaskDate, ParsedTaskLine, TextSpan } from "./task-line";

export {
  applyLinePatches,
  convertLineToTask,
  setTaskDate,
  setTaskStatus,
  toggleTaskStatus,
} from "./task-edit";
export type { LineEditResult, LinePatch, TaskStatusOptions } from "./task-edit";

export { buildTaskTree, splitContentLines } from "./task-tree";
export type { TaskListItemLike, TaskNode } from "./task-tree";

export type { TaskFileEntry, TaskIndexChange, TaskIndexReader } from "./task-index-contract";
