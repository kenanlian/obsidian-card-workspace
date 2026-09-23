import { normalizeGroupSpec, type GroupDimension, type GroupSpec } from "../card-grouping-settings";
import type { SortDirection, SortField } from "../settings";
import type { CardGroupSegment } from "./card-grouping";
import type { PanelModelState } from "./panel-model";
import type { NoteCardRecord } from "./types";

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
}): PanelModelState["cards"] {
  return {
    records: [...input.records],
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
    extentCount: input.records.length,
  };
}

export function buildProjectionPanelGroup(input: {
  sortField: SortField;
  sortDirection: SortDirection;
  deriveAvailableTags: () => string[];
  deriveTagCounts: () => Record<string, number>;
  activeFilterTags: string[];
  pinnedPaths: string[];
  group: GroupSpec;
  availableGroupDimensions: GroupDimension[];
  groupSegmentCount: number;
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
  };
}
