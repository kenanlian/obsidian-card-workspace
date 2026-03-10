export type SortField = "mtime" | "ctime";

export type SortDirection = "desc" | "asc";

export type DefaultViewMode = "cards";

export type ViewMode = "folder" | "all-notes";

export interface PluginSettings {
  sort: {
    field: SortField;
    direction: SortDirection;
  };
  filter: {
    tags: string[];
  };
  pinnedPaths: string[];
  includeSubfolders: boolean;
  defaultView: DefaultViewMode;
  lastFolderPath: string | null;
  lastViewMode: ViewMode;
}

export interface PartialPluginSettings {
  sort?: {
    field?: SortField;
    direction?: SortDirection;
  };
  filter?: {
    tags?: string[];
  };
  pinnedPaths?: string[];
  includeSubfolders?: boolean;
  defaultView?: DefaultViewMode;
  lastFolderPath?: string | null;
  lastViewMode?: ViewMode;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  sort: {
    field: "mtime",
    direction: "desc",
  },
  filter: {
    tags: [],
  },
  pinnedPaths: [],
  includeSubfolders: true,
  defaultView: "cards",
  lastFolderPath: null,
  lastViewMode: "folder",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeSortField(value: unknown): SortField {
  return value === "ctime" ? "ctime" : "mtime";
}

function normalizeSortDirection(value: unknown): SortDirection {
  return value === "asc" ? "asc" : "desc";
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0);
}

function normalizePinnedPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((path): path is string => typeof path === "string" && path.trim().length > 0);
}

function normalizeDefaultView(value: unknown): DefaultViewMode {
  return value === "cards" ? value : DEFAULT_SETTINGS.defaultView;
}

function normalizeViewMode(value: unknown): ViewMode {
  return value === "all-notes" ? "all-notes" : "folder";
}

export function normalizeSettings(raw: unknown): PluginSettings {
  const data = isRecord(raw) ? raw : {};
  const sort = isRecord(data.sort) ? data.sort : {};
  const filter = isRecord(data.filter) ? data.filter : {};

  return {
    sort: {
      field: normalizeSortField(sort.field),
      direction: normalizeSortDirection(sort.direction),
    },
    filter: {
      tags: normalizeTags(filter.tags),
    },
    pinnedPaths: normalizePinnedPaths(data.pinnedPaths),
    includeSubfolders:
      typeof data.includeSubfolders === "boolean"
        ? data.includeSubfolders
        : DEFAULT_SETTINGS.includeSubfolders,
    defaultView: normalizeDefaultView(data.defaultView),
    lastFolderPath:
      typeof data.lastFolderPath === "string" && data.lastFolderPath.length > 0
        ? data.lastFolderPath
        : null,
    lastViewMode: normalizeViewMode(data.lastViewMode),
  };
}

export function mergeSettings(current: PluginSettings, patch: PartialPluginSettings): PluginSettings {
  return normalizeSettings({
    ...current,
    ...patch,
    sort: {
      ...current.sort,
      ...(patch.sort ?? {}),
    },
    filter: {
      ...current.filter,
      ...(patch.filter ?? {}),
    },
  });
}
