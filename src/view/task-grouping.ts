import type { App } from "obsidian";
import { normalizeTagPath } from "./tag-tree";
import type { SortGroupStrings } from "../i18n";
import type { TaskGroupSpec } from "../task-view-settings";
import { parseIsoDateLocal, type TaskFileEntry, type TaskNode } from "../tasks";
import type { GroupBucket } from "./card-grouping";
import type { TaskGroupHeaderDimension } from "./group-header-content";
import { localDayOrdinal, resolveTimeBucketIdentity } from "./time-grouping";
import type { NoteCardRecord, TaskCardItem, TaskCardRecord } from "./types";

/** Calendar inputs for relative due buckets; injected so projection stays deterministic. */
export interface TaskGroupClock {
  readonly today: Date;
  /** 0 = Sunday … 6 = Saturday. */
  readonly firstDayOfWeek: number;
}

type DueBucket = "overdue" | "today" | "tomorrow" | "thisWeek" | "later";

const DUE_BUCKET_ORDER: readonly DueBucket[] = ["overdue", "today", "tomorrow", "thisWeek", "later"];

function toTaskItem(node: TaskNode): TaskCardItem {
  const { parsed } = node;
  return {
    line: node.line,
    lineText: node.lineText,
    text: parsed.description,
    completed: parsed.completed,
    statusChar: parsed.statusChar,
    dates: {
      created: parsed.dates.created?.value ?? null,
      done: parsed.dates.done?.value ?? null,
      due: parsed.dates.due?.value ?? null,
    },
    children: node.children.map(toTaskItem),
  };
}

/** One record per root task of a Markdown card; subtasks stay embedded. */
export function buildTaskCardRecords(
  card: NoteCardRecord,
  fileOrder: number,
  entry: TaskFileEntry,
): TaskCardRecord[] {
  const fileTitle = card.file.basename ?? card.title;
  return entry.roots.map((root) => ({
    ...toTaskItem(root),
    kind: "task",
    path: `${card.path}::L${root.line}`,
    filePath: card.path,
    file: card.file,
    fileTitle,
    fileOrder,
  }));
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function isoDayOrdinal(value: string | null): number | null {
  const date = value === null ? null : parseIsoDateLocal(value);
  return date === null ? null : localDayOrdinal(date.getTime());
}

/** Tomorrow wins over "this week" even when it starts the next week. */
function resolveDueBucket(due: number, clock: TaskGroupClock): DueBucket {
  const today = localDayOrdinal(clock.today.getTime());
  const weekEnd = today + 6 - modulo(clock.today.getDay() - clock.firstDayOfWeek, 7);
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due === today + 1) return "tomorrow";
  return due <= weekEnd ? "thisWeek" : "later";
}

function header(dimension: TaskGroupHeaderDimension, text: string, path?: string): GroupBucket["header"] {
  return path === undefined ? { kind: "task-group", dimension, text } : { kind: "task-group", dimension, text, path };
}

function missingBucket(dimension: TaskGroupHeaderDimension, label: string): GroupBucket {
  return { key: `task-${dimension}:none`, label, detail: "", header: header(dimension, label), sortKey: "", isMissing: true };
}

function resolveTaskBucket(
  task: TaskCardRecord,
  spec: TaskGroupSpec,
  strings: SortGroupStrings,
  clock: TaskGroupClock,
): GroupBucket | null {
  const labels = strings.taskGroup;
  switch (spec.dimension) {
    case "tag":
    case "link":
    case "none":
      return null;
    case "file":
      return {
        key: `task-file:${task.filePath}`,
        label: task.fileTitle,
        detail: task.filePath,
        header: header("file", task.fileTitle, task.filePath),
        sortKey: String(task.fileOrder).padStart(9, "0"),
        isMissing: false,
      };
    case "status": {
      const label = task.completed ? labels.statusCompleted : labels.statusIncomplete;
      return {
        key: task.completed ? "task-status:done" : "task-status:open",
        label,
        detail: "",
        header: header("status", label),
        sortKey: task.completed ? "1" : "0",
        isMissing: false,
      };
    }
    case "due": {
      const due = isoDayOrdinal(task.dates.due);
      if (due === null) return missingBucket("due", labels.dueBuckets.none);
      const bucket = resolveDueBucket(due, clock);
      const label = labels.dueBuckets[bucket];
      return {
        key: `task-due:${bucket}`,
        label,
        detail: "",
        header: header("due", label),
        sortKey: String(DUE_BUCKET_ORDER.indexOf(bucket)),
        isMissing: false,
      };
    }
    case "created":
    case "done": {
      const dimension = spec.dimension;
      const date = task.dates[dimension];
      const parsed = date === null ? null : parseIsoDateLocal(date);
      if (parsed === null) {
        return missingBucket(dimension, dimension === "created" ? labels.noCreatedDate : labels.noDoneDate);
      }
      const granularity = spec.timeGranularity ?? "day";
      const time = resolveTimeBucketIdentity(parsed.getTime(), granularity, strings, clock.today.getTime());
      return {
        key: `task-${dimension}:${granularity}:${time.identity}`,
        label: time.label,
        detail: "",
        header: header(dimension, time.label),
        sortKey: time.sortKey,
        isMissing: false,
      };
    }
    default: {
      const exhaustive: never = spec.dimension;
      throw new Error(`Unhandled task group dimension: ${String(exhaustive)}`);
    }
  }
}

/** One bucket per task, keyed by the task's synthetic path; `none` returns an empty map. */
export function buildTaskGroupBuckets(
  tasks: readonly TaskCardRecord[],
  spec: TaskGroupSpec,
  strings: SortGroupStrings,
  clock: TaskGroupClock,
): Map<string, GroupBucket> {
  const buckets = new Map<string, GroupBucket>();
  for (const task of tasks) {
    const bucket = resolveTaskBucket(task, spec, strings, clock);
    if (bucket !== null) buckets.set(task.path, bucket);
  }
  return buckets;
}

/** Position-indexed metadata keeps inline code, escaped text and note-level tags out. */
export function buildTaskMembershipBuckets(
  app: App, tasks: readonly TaskCardRecord[], spec: TaskGroupSpec,
  strings: SortGroupStrings, clock: TaskGroupClock,
): Map<string, GroupBucket | readonly GroupBucket[]> {
  if (spec.dimension !== "tag" && spec.dimension !== "link") return buildTaskGroupBuckets(tasks, spec, strings, clock);
  const dimension = spec.dimension;
  const result = new Map<string, GroupBucket | readonly GroupBucket[]>();
  const byFile = new Map<string, Map<number, Array<{ value: string; original: string; col: number }>>>();
  for (const task of tasks) {
    let lines = byFile.get(task.filePath);
    if (!lines) {
      lines = new Map(); byFile.set(task.filePath, lines);
      const cache = app.metadataCache.getFileCache(task.file);
      for (const item of dimension === "tag" ? cache?.tags ?? [] : cache?.links ?? []) {
        const original = "tag" in item ? item.tag : item.original;
        if (dimension === "link" && !original.startsWith("[[")) continue;
        const value = "tag" in item ? item.tag : item.link;
        const { line, col } = item.position.start;
        const entries = lines.get(line) ?? [];
        entries.push({ value, original, col }); lines.set(line, entries);
      }
    }
    const memberships = new Map<string, GroupBucket>();
    for (const item of lines.get(task.line) ?? []) {
      if (!task.lineText.startsWith(item.original, item.col)) continue;
      let identity: string, label: string, path: string | undefined;
      if (dimension === "tag") {
        identity = normalizeTagPath(item.value); label = `#${item.value.replace(/^#/, "")}`;
      } else {
        const target = item.value.split("#", 1)[0].trim();
        const dest = target ? app.metadataCache.getFirstLinkpathDest(target, task.filePath) : task.file;
        identity = dest ? `resolved:${dest.path}` : `unresolved:${target}`;
        label = dest?.basename ?? target; path = dest?.path ?? target;
      }
      if (!identity) continue;
      const key = `task-${dimension}:value:${identity}`;
      memberships.set(key, { key, label, detail: path ?? "", header: header(dimension, label, path), sortKey: dimension === "tag" ? identity : path ?? label, isMissing: false });
    }
    result.set(task.path, memberships.size ? [...memberships.values()] : missingBucket(dimension, dimension === "tag" ? strings.bucketNoTag : strings.taskGroup.noLink));
  }
  // Stable tag spelling independent of source/task sort order.
  const canonical = new Map<string, GroupBucket>();
  for (const membership of result.values()) for (const bucket of Array.isArray(membership) ? membership : [membership]) {
    const old = canonical.get(bucket.key);
    if (!old || bucket.label < old.label) canonical.set(bucket.key, bucket);
  }
  for (const [id, membership] of result) result.set(id, (Array.isArray(membership) ? membership : [membership]).map(bucket => canonical.get(bucket.key)!));
  return result;
}
