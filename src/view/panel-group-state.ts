import { normalizeGroupSpec, type GroupDimension, type GroupSpec } from "../card-grouping-settings";
import type { DefaultViewMode, SortDirection, LinksSortField } from "../settings";
import {
  DEFAULT_TASK_GROUP,
  DEFAULT_TASK_SORT,
  normalizeTaskGroupSpec,
  normalizeTaskSortSpec,
  type TaskGroupSpec,
  type TaskSortSpec,
} from "../task-view-settings";
import type { CardGroupSegment } from "./card-grouping";
import type { PanelModelState } from "./panel-model";
import type { NoteCardRecord, TaskCardRecord, TaskViewStatus } from "./types";

export function buildCardsPanelGroup(input: {
  records: readonly NoteCardRecord[];
  searchMatchCountsByPath: Record<string, number>;
  selectedPath: string | null;
  loading: boolean;
  generation: number;
  sequenceRevision: number;
  hydrationRevision: number;
  groupSegments: readonly CardGroupSegment[];
  groupRevision: number;
  streamMode?: DefaultViewMode;
  taskRecords?: readonly TaskCardRecord[];
  taskGroupCounts?: Record<string, number>;
  taskStatus?: TaskViewStatus;
  pendingTaskIds?: readonly string[];
  pendingTaskStatuses?: Record<string, boolean>;
}): PanelModelState["cards"] {
  const streamMode = input.streamMode ?? "cards";
  const records = streamMode === "tasks" ? [] : [...input.records];
  return {
    records,
    searchMatchCountsByPath: { ...input.searchMatchCountsByPath },
    selectedPath: input.selectedPath,
    loading: input.loading,
    generation: input.generation,
    sequenceRevision: input.sequenceRevision,
    hydrationRevision: input.hydrationRevision,
    groupSegments: [...input.groupSegments],
    groupRevision: input.groupRevision,
    // Kept in the panel contract for compatibility; rendering is based only
    // on materialized, projected records and never infers blank tail rows.
    extentCount: records.length,
    streamMode,
    taskGroupCounts: input.taskGroupCounts,
    taskRecords: streamMode === "tasks" ? [...input.taskRecords ?? []] : [],
    taskStatus: streamMode === "tasks" ? input.taskStatus ?? "idle" : "idle",
    pendingTaskIds: streamMode === "tasks" ? [...input.pendingTaskIds ?? []] : [],
    pendingTaskStatuses: streamMode === "tasks" ? input.pendingTaskStatuses : {},
  };
}

export function buildProjectionPanelGroup(input: {
  sortField: LinksSortField;
  sortDirection: SortDirection;
  deriveAvailableTags: () => string[];
  deriveTagCounts: () => Record<string, number>;
  activeFilterTags: string[];
  pinnedPaths: string[];
  group: GroupSpec;
  availableGroupDimensions: GroupDimension[];
  groupSegmentCount: number;
  viewMode?: DefaultViewMode;
  taskSort?: TaskSortSpec;
  taskGroup?: TaskGroupSpec;
  taskViewAvailable?: boolean;
}): PanelModelState["projection"] {
  return {
    sortField: input.sortField,
    sortDirection: input.sortDirection,
    availableTags: input.deriveAvailableTags(),
    tagCounts: input.deriveTagCounts(),
    activeFilterTags: input.activeFilterTags,
    pinnedPaths: input.pinnedPaths,
    group: normalizeGroupSpec(input.group),
    availableGroupDimensions: input.availableGroupDimensions,
    groupSegmentCount: input.groupSegmentCount,
    // Retained as a compatibility field; facets are only published with the
    // complete scope commit, so the panel has no pending metadata phase.
    metadataStatus: "ready",
    viewMode: input.viewMode === "tasks" ? "tasks" : "cards",
    taskSort: input.taskSort ? normalizeTaskSortSpec(input.taskSort) : { ...DEFAULT_TASK_SORT },
    taskGroup: input.taskGroup ? normalizeTaskGroupSpec(input.taskGroup) : { ...DEFAULT_TASK_GROUP },
    taskViewAvailable: input.taskViewAvailable ?? false,
  };
}
