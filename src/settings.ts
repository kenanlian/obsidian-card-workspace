export type SortField = "mtime" | "ctime" | "name";

export type SortDirection = "desc" | "asc";

export type DefaultViewMode = "cards";

export type OpenDestination = "current-area" | "new-tab" | "split-right" | "new-window";

export type DefaultCardOpenBehavior = "smart" | "new-tab" | "split-right" | "new-window";

export type DragInsertAction = "ask" | "wiki" | "embed" | "content" | "title-content";

export type CardCornerRadius = "compact" | "medium" | "rounded";

export const PREVIEW_LINES_MIN = 3;
export const PREVIEW_LINES_MAX = 8;
export const DEFAULT_PREVIEW_LINES = 5;
export const DEFAULT_CARD_OPEN_BEHAVIOR: DefaultCardOpenBehavior = "smart";
export const DEFAULT_DRAG_INSERT_ACTION: DragInsertAction = "ask";
export const DEFAULT_CARD_CORNER_RADIUS: CardCornerRadius = "compact";

export const DEFAULT_CARD_OPEN_BEHAVIOR_OPTIONS: ReadonlyArray<{
  value: DefaultCardOpenBehavior;
  label: string;
}> = [
  {
    value: "smart",
    label: "Current pane / current tab",
  },
  {
    value: "new-tab",
    label: "Open in new tab",
  },
  {
    value: "split-right",
    label: "Open to the right",
  },
  {
    value: "new-window",
    label: "Open in new window",
  },
];

export const DRAG_INSERT_ACTION_OPTIONS: ReadonlyArray<{
  value: DragInsertAction;
  label: string;
}> = [
  {
    value: "ask",
    label: "Ask every time",
  },
  {
    value: "wiki",
    label: "Insert wiki link",
  },
  {
    value: "embed",
    label: "Insert embed link",
  },
  {
    value: "content",
    label: "Insert card content",
  },
  {
    value: "title-content",
    label: "Insert card title & content",
  },
];

export const CARD_CORNER_RADIUS_OPTIONS: ReadonlyArray<{
  value: CardCornerRadius;
  label: string;
}> = [
  {
    value: "compact",
    label: "Compact",
  },
  {
    value: "medium",
    label: "Softer",
  },
  {
    value: "rounded",
    label: "Rounded",
  },
];

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
  enableFileExplorerFolderClicks: boolean;
  defaultView: DefaultViewMode;
  defaultCardOpenBehavior: DefaultCardOpenBehavior;
  dragInsertAction: DragInsertAction;
  cardCornerRadius: CardCornerRadius;
  previewLines: number;
  lastFolderPath: string;
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
  enableFileExplorerFolderClicks?: boolean;
  defaultView?: DefaultViewMode;
  defaultCardOpenBehavior?: DefaultCardOpenBehavior;
  dragInsertAction?: DragInsertAction;
  cardCornerRadius?: CardCornerRadius;
  previewLines?: number;
  lastFolderPath?: string;
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
  enableFileExplorerFolderClicks: false,
  defaultView: "cards",
  defaultCardOpenBehavior: DEFAULT_CARD_OPEN_BEHAVIOR,
  dragInsertAction: DEFAULT_DRAG_INSERT_ACTION,
  cardCornerRadius: DEFAULT_CARD_CORNER_RADIUS,
  previewLines: DEFAULT_PREVIEW_LINES,
  lastFolderPath: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeSortField(value: unknown): SortField {
  return value === "ctime" || value === "name" ? value : "mtime";
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

export function isDefaultCardOpenBehavior(value: string): value is DefaultCardOpenBehavior {
  return value === "smart" || value === "new-tab" || value === "split-right" || value === "new-window";
}

export function isDragInsertAction(value: string): value is DragInsertAction {
  return value === "ask" || value === "wiki" || value === "embed" || value === "content" || value === "title-content";
}

export function isCardCornerRadius(value: string): value is CardCornerRadius {
  return value === "compact" || value === "medium" || value === "rounded";
}

function normalizeDefaultCardOpenBehavior(value: unknown): DefaultCardOpenBehavior {
  return typeof value === "string" && isDefaultCardOpenBehavior(value)
    ? value
    : DEFAULT_CARD_OPEN_BEHAVIOR;
}

function normalizeDragInsertAction(value: unknown): DragInsertAction {
  return typeof value === "string" && isDragInsertAction(value)
    ? value
    : DEFAULT_DRAG_INSERT_ACTION;
}

function normalizeCardCornerRadius(value: unknown): CardCornerRadius {
  return typeof value === "string" && isCardCornerRadius(value)
    ? value
    : DEFAULT_CARD_CORNER_RADIUS;
}

function normalizeLastFolderPath(value: unknown, rawLastViewMode: unknown): string {
  if (typeof value === "string") {
    return value === "/" ? "" : value;
  }

  return rawLastViewMode === "all-notes" ? "" : DEFAULT_SETTINGS.lastFolderPath;
}

function normalizePreviewLines(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PREVIEW_LINES;
  }

  const rounded = Math.round(value);
  if (rounded < PREVIEW_LINES_MIN) {
    return PREVIEW_LINES_MIN;
  }
  if (rounded > PREVIEW_LINES_MAX) {
    return PREVIEW_LINES_MAX;
  }
  return rounded;
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
    enableFileExplorerFolderClicks:
      typeof data.enableFileExplorerFolderClicks === "boolean"
        ? data.enableFileExplorerFolderClicks
        : DEFAULT_SETTINGS.enableFileExplorerFolderClicks,
    defaultView: normalizeDefaultView(data.defaultView),
    defaultCardOpenBehavior: normalizeDefaultCardOpenBehavior(data.defaultCardOpenBehavior),
    dragInsertAction: normalizeDragInsertAction(data.dragInsertAction),
    cardCornerRadius: normalizeCardCornerRadius(data.cardCornerRadius),
    previewLines: normalizePreviewLines(data.previewLines),
    lastFolderPath: normalizeLastFolderPath(data.lastFolderPath, data.lastViewMode),
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
