/**
 * Pure presentation helpers for task cards. Zero imports, so Svelte components
 * and host actions can share them without crossing a layer.
 */

export type TaskChipKind = "created" | "done" | "due";

export const TASK_CHIP_KINDS: readonly TaskChipKind[] = ["created", "done", "due"];

/** Stable id of any task item; equals `TaskCardRecord.path` for root tasks. */
export function taskItemId(filePath: string, line: number): string {
  return `${filePath}::L${line}`;
}

/**
 * Display text for a task description: inline Markdown markers are removed and
 * links show their visible label. The result is rendered as text, never HTML.
 */
export function buildTaskPlainText(text: string): string {
  const plain = text
    .replace(/!\[\[[^\]]*\]\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_match: string, target: string, alias?: string) => alias ?? target)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    // No lookbehind: older mobile WebKit rejects it when parsing the bundle.
    .replace(/(\*\*|__)(\S(?:.*?\S)?)\1/g, "$2")
    .replace(/(^|[^\w*])\*(\S(?:.*?\S)?)\*(?![\w*])/g, "$1$2")
    .replace(/(^|\W)_(\S(?:.*?\S)?)_(?!\w)/g, "$1$2")
    .replace(/~~(\S(?:.*?\S)?)~~/g, "$1")
    .replace(/==(\S(?:.*?\S)?)==/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain;
}

export interface TaskTextSegment {
  readonly text: string;
  readonly highlighted: boolean;
}

/** Case-insensitive occurrences of the whole trimmed query, matching the task text filter. */
export function buildTaskTextSegments(text: string, query: string): TaskTextSegment[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0 || text.length === 0) return [{ text, highlighted: false }];
  const haystack = text.toLocaleLowerCase();
  // Lower-casing can change string length for a few scripts; skip highlighting then.
  if (haystack.length !== text.length) return [{ text, highlighted: false }];
  const segments: TaskTextSegment[] = [];
  let from = 0;
  for (let index = haystack.indexOf(needle); index !== -1; index = haystack.indexOf(needle, from)) {
    if (index > from) segments.push({ text: text.slice(from, index), highlighted: false });
    segments.push({ text: text.slice(index, index + needle.length), highlighted: true });
    from = index + needle.length;
  }
  if (from < text.length) segments.push({ text: text.slice(from), highlighted: false });
  return segments.length > 0 ? segments : [{ text, highlighted: false }];
}

export type TaskDueState = "overdue" | "today" | "upcoming";

/** Due urgency for an open task; completed tasks and unset dates have none. */
export function resolveTaskDueState(due: string | null, completed: boolean, today: string): TaskDueState | null {
  if (due === null || completed) return null;
  if (due < today) return "overdue";
  return due === today ? "today" : "upcoming";
}

/** `YYYY-MM-DD` parts with a 0-based month, or null for anything else. */
export function readTaskDateParts(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  return { year: Number(match[1]), month, day };
}

interface TaskTreeLike {
  readonly completed: boolean;
  readonly children: readonly TaskTreeLike[];
}

/** Completed and total counts over every nested subtask. */
export function countSubtasks(item: TaskTreeLike): { completed: number; total: number } {
  let completed = 0;
  let total = 0;
  const visit = (node: TaskTreeLike): void => {
    for (const child of node.children) {
      total += 1;
      if (child.completed) completed += 1;
      visit(child);
    }
  };
  visit(item);
  return { completed, total };
}
