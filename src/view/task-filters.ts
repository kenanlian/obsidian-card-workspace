import { formatIsoDate, isValidIsoDate, parseTaskLine, type TaskDateKind } from "../tasks";
import { buildTaskPlainText } from "./task-card-display";
import type { TaskCardItem, TaskCardRecord } from "./types";

export type TaskStatusFilter = "all" | "incomplete" | "completed";
export type TaskRangePreset = "week" | "previous-week" | "report" | "previous-report" | "custom";
export interface TaskDateFilter {
  field: TaskDateKind;
  preset: TaskRangePreset;
  start: string;
  end: string;
  weekEnd: number;
}
export interface TaskFilterSpec { status: TaskStatusFilter; date: TaskDateFilter | null }
export const DEFAULT_TASK_FILTER: TaskFilterSpec = { status: "all", date: null };
export type TaskCopyFormat = "text" | "unordered" | "tasks";
export interface TaskCopyGroup { key: string; label: string; tasks: readonly TaskCardRecord[] }

export function resolveTaskRange(filter: TaskDateFilter, today: Date, firstDay: number): { start: string; end: string } {
  if (filter.preset === "custom") return { start: filter.start, end: filter.end };
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);
  if (filter.preset === "week" || filter.preset === "previous-week") {
    start.setDate(start.getDate() - (start.getDay() - firstDay + 7) % 7 - (filter.preset === "previous-week" ? 7 : 0));
    end.setTime(start.getTime()); end.setDate(end.getDate() + 6);
  } else {
    end.setDate(end.getDate() + (filter.weekEnd - end.getDay() + 7) % 7 - (filter.preset === "previous-report" ? 7 : 0));
    start.setTime(end.getTime()); start.setDate(start.getDate() - 6);
  }
  return { start: formatIsoDate(start), end: formatIsoDate(end) };
}
export function validTaskRange(start: string, end: string): boolean {
  return isValidIsoDate(start) && isValidIsoDate(end) && start <= end;
}

/** Remove unmatched nodes, reconnecting descendants to the closest retained ancestor. */
export function filterTaskTrees(tasks: readonly TaskCardRecord[], filter: TaskFilterSpec, today: Date, firstDay: number): TaskCardRecord[] {
  if (filter.status === "all" && filter.date === null) return [...tasks];
  const range = filter.date ? resolveTaskRange(filter.date, today, firstDay) : null;
  const visit = (item: TaskCardItem): TaskCardItem[] => {
    const children = item.children.flatMap(visit);
    const status = filter.status === "all" || item.completed === (filter.status === "completed");
    const date = filter.date ? item.dates[filter.date.field] : null;
    const matchesDate = range === null || (date !== null && date >= range.start && date <= range.end);
    return status && matchesDate ? [{ ...item, children }] : children;
  };
  return tasks.flatMap(root => visit(root).map(item => ({ ...root, ...item, path: `${root.filePath}::L${item.line}` })));
}
export function taskTreeCount(item: TaskCardItem): number {
  return 1 + item.children.reduce((sum, child) => sum + taskTreeCount(child), 0);
}
export function buildTaskCopyText(groups: readonly TaskCopyGroup[], format: TaskCopyFormat, original: boolean, headings: boolean): { text: string; count: number } {
  let count = 0;
  const render = (item: TaskCardItem, depth: number): string[] => {
    count++;
    let body = buildTaskPlainText(item.text);
    if (original) {
      const parsed = parseTaskLine(item.lineText);
      if (parsed) body = item.lineText.slice(parsed.bodySpan.from).replace(/(?:^|\s+)\^[A-Za-z0-9-]+\s*$/, "").trim();
    }
    const prefix = format === "tasks" ? `- [${item.statusChar}] ` : format === "unordered" ? "- " : "";
    return [`${"  ".repeat(depth)}${prefix}${body}`, ...item.children.flatMap(child => render(child, depth + 1))];
  };
  const text = groups.filter(group => group.tasks.length > 0).map(group => {
    const lines = group.tasks.flatMap(task => render(task, 0));
    return [...(headings && group.label ? [group.label] : []), ...lines].join("\n");
  }).join("\n\n");
  return { text, count };
}
