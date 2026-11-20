import { filterTaskTrees, DEFAULT_TASK_FILTER, type TaskFilterSpec, type TaskCopyGroup } from "./task-filters";
import type { App } from "obsidian";
import type { GroupSpec } from "../card-grouping-settings";
import type { SortGroupStrings } from "../i18n";
import type { SortDirection } from "../settings";
import type { TaskGroupSpec, TaskSortSpec } from "../task-view-settings";
import { compareIsoDates, type TaskFileEntry } from "../tasks";
import {
  normalizePropertyFilterClauses,
  type PropertyFilterClause,
} from "../property-filter-settings";
import { arrangeCardsByGroup, type CardGroupSegment, type GroupBucket } from "./card-grouping";
import { getFileFrontmatter, matchesTagFilter } from "./metadata-utils";
import { matchesPropertyFilters } from "./property-metadata";
import type { CardScope } from "./scope";
import { buildTaskCardRecords, buildTaskMembershipBuckets } from "./task-grouping";
import type { NoteCardRecord, PipelineSearchInput, TaskCardItem, TaskCardRecord } from "./types";

export interface PipelineContext {
  drawPaths?: readonly string[] | null;
  app: App;
  filterTags: string[];
  // Workspace-persisted property clauses; applied in folder and box scopes.
  propertyFilters: readonly PropertyFilterClause[];
  // Runtime-only input from FolderCardView; query stays out of persisted settings.
  search: PipelineSearchInput;
  // Explicit ordered pin input for projection; prevents reaching through settings with casts.
  pinnedPaths: string[];
  group: {
    spec: GroupSpec;
    /** One bucket per card, keyed by card path. */
    buckets: ReadonlyMap<string, GroupBucket>;
  };
  // Runtime-only per-view collapse state; never persisted.
  collapsedGroupKeys: ReadonlySet<string>;
}

export interface PipelineResult {
  readonly cards: NoteCardRecord[];
  readonly segments: CardGroupSegment[];
}

export type PipelineStep = (
  cards: NoteCardRecord[],
  context: PipelineContext,
) => NoteCardRecord[];

/** The inputs the file-level browse filters read; shared by the card and task streams. */
export type BrowseFilterContext = Pick<PipelineContext, "app" | "filterTags" | "propertyFilters">;

type BrowseFilterStep = (cards: NoteCardRecord[], context: BrowseFilterContext) => NoteCardRecord[];

export function runPipeline(
  cards: NoteCardRecord[],
  steps: PipelineStep[],
  context: PipelineContext,
): PipelineResult {
  let result = cards;
  for (const step of steps) {
    result = step(result, context);
  }
  return steps.includes(applyDrawSelection) ? { cards: result, segments: [] } : applyGroupArrangement(result, context);
}

/**
 * Group arrangement stage.
 *
 * This is a stage rather than a `PipelineStep` because it produces two outputs
 * — the collapse-filtered cards and the segment table — which the
 * `(cards, context) => cards` step signature cannot carry.
 *
 * A non-empty query pauses grouping outright, regardless of search execution
 * state: search results have their own order, and bucketing them would fight
 * that ordering. The collapse set is left untouched while paused, so clearing
 * the query restores both grouping and collapse.
 */
function applyGroupArrangement(
  cards: NoteCardRecord[],
  context: PipelineContext,
): PipelineResult {
  if (context.search.query.trim().length > 0) {
    return { cards, segments: [] };
  }

  return arrangeCardsByGroup(
    cards,
    context.group.buckets,
    context.group.spec,
    context.collapsedGroupKeys,
  );
}

/** Explicit box-only stage: search pauses the saved group without consuming it. */
export function applyDrawSelection(cards: NoteCardRecord[], context: PipelineContext): NoteCardRecord[] {
  if (context.search.query.trim()) return applyPinReorder(applySearchFilter(cards, context), context);
  const byPath = new Map(cards.map(card => [card.path, card]));
  return (context.drawPaths ?? []).flatMap(path => {
    const card = byPath.get(path);
    return card ? [card] : [];
  });
}

/** Tag filter step — filter cards by metadata tags using AND logic. */
export function applyTagFilter(cards: NoteCardRecord[], context: BrowseFilterContext): NoteCardRecord[] {
  const filterTags = context.filterTags;

  // Pass-through when no tags are selected (empty filter always matches)
  if (filterTags.length === 0) {
    return cards;
  }

  // Filter cards to only include those matching all selected tags (AND semantics)
  return cards.filter((card) => matchesTagFilter(context.app, card.file, filterTags));
}

/**
 * Property filter step.
 *
 * Values within one clause combine with OR; clauses for different keys combine
 * with AND; `missing` matches a card with no supported scalar for that key.
 * Frontmatter comes from the metadata cache only — no body reads. Passes the
 * original array through (same reference) when no normalized clauses remain.
 */
export function applyPropertyFilter(cards: NoteCardRecord[], context: BrowseFilterContext): NoteCardRecord[] {
  const clauses = normalizePropertyFilterClauses(context.propertyFilters);
  if (clauses.length === 0) {
    return cards;
  }

  const app = context.app;
  return matchesPropertyFilters(cards, clauses, (file) => getFileFrontmatter(app, file));
}

/**
 * Search filter step.
 *
 * Indexed-only semantics:
 * - Empty/whitespace query returns all cards.
 * - Non-empty queries filter only when indexed search explicitly ran.
 * - Non-ready indexed states are blocked query states and project zero cards.
 */
export function applySearchFilter(cards: NoteCardRecord[], context: PipelineContext): NoteCardRecord[] {
  const query = context.search.query;
  if (query.trim().length === 0) {
    return cards;
  }

  if (context.search.execution !== "indexed-ready") {
    return [];
  }

  const orderedPaths = context.search.orderedPaths ?? [];
  const cardsByPath = new Map(cards.map((card) => [card.path, card]));
  const orderedMatches: NoteCardRecord[] = [];

  for (const path of orderedPaths) {
    const card = cardsByPath.get(path);
    if (card) {
      orderedMatches.push(card);
    }
  }

  const { sort, matchCountsByPath } = context.search;
  if (!sort || sort === "relevance") return orderedMatches;

  const [field, direction] = sort.split("-");
  const sortValue = (card: NoteCardRecord): number => {
    if (field === "matches") return matchCountsByPath?.[card.path] ?? 0;
    return field === "mtime" ? card.mtime : card.ctime;
  };
  const sign = direction === "asc" ? 1 : -1;
  // Stable sort keeps relevance order for equal counts or timestamps.
  return orderedMatches.sort((left, right) => sign * (sortValue(left) - sortValue(right)));
}

/** Pin reorder step — reorder cards to put pinned paths first while preserving relative order. */
export function applyPinReorder(
  cards: NoteCardRecord[],
  context: Pick<PipelineContext, "pinnedPaths"> & { search?: PipelineSearchInput },
): NoteCardRecord[] {
  const { search } = context;
  if (search?.sort && search.sort !== "relevance" && search.query.trim()) {
    return cards;
  }
  // Guard: empty cards
  if (cards.length === 0) {
    return cards;
  }

  // Guard: no pinnedPaths in explicit pipeline inputs
  const pinnedPaths = context.pinnedPaths;
  if (pinnedPaths.length === 0) {
    return cards;
  }

  // Convert pinnedPaths array to Set for O(1) lookups
  const pinnedSet = new Set(pinnedPaths);

  // Partition cards into pinned and unpinned groups, preserving original relative order
  const pinnedCards: NoteCardRecord[] = [];
  const unpinnedCards: NoteCardRecord[] = [];

  for (const card of cards) {
    if (pinnedSet.has(card.path)) {
      pinnedCards.push(card);
    } else {
      unpinnedCards.push(card);
    }
  }

  // Return pinned cards first, then unpinned cards (both groups preserve input order)
  return [...pinnedCards, ...unpinnedCards];
}

/** Box membership is resolved before projection; browse filters narrow that set.
 * Links keeps browse filters dormant. Dispatch stays exhaustive over CardScope.
 */
export function stepsForScope(scope: CardScope, drawActive = false): PipelineStep[] {
  switch (scope.kind) {
    case "folder":
      return [applyTagFilter, applyPropertyFilter, applySearchFilter, applyPinReorder];
    case "box":
      return drawActive ? [applyDrawSelection] : [applyTagFilter, applyPropertyFilter, applySearchFilter, applyPinReorder];
    case "links":
      return [applySearchFilter, applyPinReorder];
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export interface TaskPipelineContext {
  taskFilters?: TaskFilterSpec;
  app: App;
  /** Selects the file-level browse filters, exactly as `stepsForScope` does for cards. */
  scope: CardScope;
  filterTags: string[];
  propertyFilters: readonly PropertyFilterClause[];
  /** Local task-text query; the task stream never issues indexed full-text queries. */
  query: string;
  sort: TaskSortSpec;
  group: TaskGroupSpec;
  getTaskEntry: (path: string) => TaskFileEntry | null;
  /** Local "now" for relative due/created/done buckets. */
  today: Date;
  /** 0 = Sunday … 6 = Saturday; bounds the "this week" due bucket. */
  firstDayOfWeek: number;
  strings: SortGroupStrings;
  // Runtime-only per-view collapse state, namespaced apart from card-stream keys.
  collapsedGroupKeys: ReadonlySet<string>;
}

export interface TaskPipelineResult {
  readonly copyGroups?: readonly TaskCopyGroup[];
  readonly cards: TaskCardRecord[];
  readonly segments: CardGroupSegment[];
}

/**
 * Task-stream projection: file-level browse filters -> root-task expansion ->
 * task text filter -> task sort -> task grouping.
 *
 * Search and pin steps never run here: the query is a local text match and
 * pins order files, not tasks. Grouping stays active with a non-empty query
 * because the task order is the chosen sort, not search relevance.
 */
export function runTaskPipeline(baseCards: NoteCardRecord[], context: TaskPipelineContext): TaskPipelineResult {
  let cards = baseCards;
  for (const step of taskBrowseStepsForScope(context.scope)) {
    cards = step(cards, context);
  }
  const fileOrderByPath = new Map(baseCards.map((card, index) => [card.path, index]));
  const tasks = expandTaskCards(cards, fileOrderByPath, context.getTaskEntry);
  const filtered = filterTaskTrees(tasks, context.taskFilters ?? DEFAULT_TASK_FILTER, context.today, context.firstDayOfWeek);
  const sorted = applyTaskSort(applyTaskTextFilter(filtered, context.query), context.sort);
  return applyTaskGroupArrangement(sorted, context);
}

/** Markdown cards only; a card whose entry is not loaded contributes no tasks yet. */
export function expandTaskCards(
  cards: readonly NoteCardRecord[],
  fileOrderByPath: ReadonlyMap<string, number>,
  getTaskEntry: (path: string) => TaskFileEntry | null,
): TaskCardRecord[] {
  const tasks: TaskCardRecord[] = [];
  for (const card of cards) {
    if (card.fileKind !== "markdown") {
      continue;
    }
    const entry = getTaskEntry(card.path);
    if (entry === null || entry.roots.length === 0) {
      continue;
    }
    for (const task of buildTaskCardRecords(card, fileOrderByPath.get(card.path) ?? 0, entry)) {
      tasks.push(task);
    }
  }
  return tasks;
}

function taskItemMatches(item: TaskCardItem, needle: string): boolean {
  return item.text.toLocaleLowerCase().includes(needle)
    || item.children.some((child) => taskItemMatches(child, needle));
}

/** Case-insensitive substring match on root text, any subtask text, or the file title. */
export function applyTaskTextFilter(tasks: TaskCardRecord[], query: string): TaskCardRecord[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0) {
    return tasks;
  }
  return tasks.filter((task) => task.fileTitle.toLocaleLowerCase().includes(needle) || taskItemMatches(task, needle));
}

function compareDocumentOrder(left: TaskCardRecord, right: TaskCardRecord): number {
  return left.fileOrder - right.fileOrder || left.line - right.line;
}

/**
 * Stable task sort. Date fields put undated tasks last in both directions;
 * every field breaks ties by file order, then line.
 */
export function applyTaskSort(tasks: TaskCardRecord[], sort: TaskSortSpec): TaskCardRecord[] {
  const sign = sort.direction === "desc" ? -1 : 1;
  const sorted = [...tasks];
  switch (sort.field) {
    case "due":
    case "created":
    case "done": {
      const field = sort.field;
      sorted.sort((left, right) => {
        const leftDate = left.dates[field];
        const rightDate = right.dates[field];
        if (leftDate === null || rightDate === null) {
          if (leftDate !== rightDate) return leftDate === null ? 1 : -1;
          return compareDocumentOrder(left, right);
        }
        return sign * compareIsoDates(leftDate, rightDate) || compareDocumentOrder(left, right);
      });
      return sorted;
    }
    case "file":
      sorted.sort((left, right) => sign * (left.fileOrder - right.fileOrder) || left.line - right.line);
      return sorted;
    case "text":
      sorted.sort((left, right) => sign * left.text.localeCompare(right.text) || compareDocumentOrder(left, right));
      return sorted;
    default: {
      const exhaustive: never = sort.field;
      throw new Error(`Unhandled task sort field: ${String(exhaustive)}`);
    }
  }
}

/** Date buckets follow the sort direction when sorting by the grouped date; others stay ascending. */
function resolveTaskGroupDirection(group: TaskGroupSpec, sort: TaskSortSpec): SortDirection {
  return (group.dimension === "created" || group.dimension === "done") && sort.field === group.dimension
    ? sort.direction
    : "asc";
}

function applyTaskGroupArrangement(tasks: TaskCardRecord[], context: TaskPipelineContext): TaskPipelineResult {
  const group = context.group;
  if (group.dimension === "none") {
    return { cards: tasks, segments: [], copyGroups: [{ key: "", label: "", tasks }] };
  }
  const buckets = buildTaskMembershipBuckets(context.app, tasks, group, context.strings, {
    today: context.today,
    firstDayOfWeek: context.firstDayOfWeek,
  });
  const result = arrangeCardsByGroup(tasks, buckets,
    { dimension: group.dimension, orderBy: "default", orderDirection: resolveTaskGroupDirection(group, context.sort) }, context.collapsedGroupKeys, true);
  return { cards: result.cards, segments: result.segments,
    copyGroups: result.groups?.map(group => ({ key: group.key, label: group.label, tasks: group.cards })) };

}

/** File-level browse filters for tasks; Links keeps browse filters dormant. */
function taskBrowseStepsForScope(scope: CardScope): BrowseFilterStep[] {
  switch (scope.kind) {
    case "folder":
    case "box":
      return [applyTagFilter, applyPropertyFilter];
    case "links":
      return [];
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
    }
  }
}
