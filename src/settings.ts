import { DEFAULT_GROUP_SPEC, normalizeGroupSpec, type GroupSpec } from "./card-grouping-settings";
import { normalizeExpandedFolderPaths, normalizeExpandedTagPaths } from "./navigation-expansion-settings";
import { defaultNavSectionOrder, normalizeNavSectionOrder } from "./navigation-section-order";
import {
  normalizeExpandedPropertyKeys,
  normalizePropertyFilterClauses,
  normalizeVisiblePropertyKeys,
  type PropertyFilterClause,
} from "./property-filter-settings";
import { deriveRuleId } from "./view/box-rule-identity";
import { isFavoriteKind, normalizeFavoriteRef, sortFavoritesByKind } from "./view/favorites";
import type { CardBoxDefinition, CardBoxSortSpec, FavoriteEntry, NavSectionId, Rule } from "./view/types";

export type SortField = "mtime" | "ctime" | "name";

export type SortDirection = "desc" | "asc";

export type DefaultViewMode = "cards";

export type OpenDestination = "current-area" | "new-tab" | "split-right" | "new-window";

export type DefaultCardOpenBehavior = "smart" | "new-tab" | "split-right" | "new-window";

export type DragInsertAction = "ask" | "wiki" | "embed" | "content" | "title-content";

export type CardCornerRadius = "compact" | "medium" | "rounded";

export type NewNoteTemplate = "tags-frontmatter" | "blank";

export const PREVIEW_LINES_MIN = 3;
export const PREVIEW_LINES_MAX = 8;
export const DEFAULT_PREVIEW_LINES = 5;
export const NAV_PANE_WIDTH_MIN = 160;
export const NAV_PANE_WIDTH_MAX = 480;
export const DEFAULT_NAV_PANE_WIDTH = 240;
/** Minimum width the card pane needs before the two-column layout squashes cards below --fce-card-min-width. */
export const CARD_PANE_MIN_WIDTH = 304;
export const DEFAULT_CARD_OPEN_BEHAVIOR: DefaultCardOpenBehavior = "smart";
export const DEFAULT_DRAG_INSERT_ACTION: DragInsertAction = "ask";
export const DEFAULT_CARD_CORNER_RADIUS: CardCornerRadius = "rounded";
export const DEFAULT_NEW_NOTE_TEMPLATE: NewNoteTemplate = "tags-frontmatter";

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

export const NEW_NOTE_TEMPLATE_OPTIONS: ReadonlyArray<{
  value: NewNoteTemplate;
  label: string;
}> = [
  {
    value: "tags-frontmatter",
    label: "Start with a tags property",
  },
  {
    value: "blank",
    label: "Start blank",
  },
];

export interface PluginSettings {
  sort: {
    field: SortField;
    direction: SortDirection;
  };
  group: GroupSpec;
  filter: { tags: string[]; properties: PropertyFilterClause[] };
  pinnedPaths: string[];
  includeSubfolders: boolean;
  defaultView: DefaultViewMode;
  defaultCardOpenBehavior: DefaultCardOpenBehavior;
  dragInsertAction: DragInsertAction;
  cardCornerRadius: CardCornerRadius;
  newNoteTemplate: NewNoteTemplate;
  previewLines: number;
  lastFolderPath: string;
  expandedFolderPaths: string[];
  expandedTagPaths: string[];
  visiblePropertyKeys: string[];
  expandedPropertyKeys: string[];
  boxes: CardBoxDefinition[];
  favorites: FavoriteEntry[];
  activeBoxId: string | null;
  navPaneWidth: number;
  navPaneCollapsed: boolean;
  sectionCollapsed: Record<NavSectionId, boolean>;
  showNavItemCounts: boolean;
  navSectionOrder: NavSectionId[];
}

export type PartialPluginSettings = Omit<Partial<PluginSettings>, "sort" | "filter" | "sectionCollapsed"> & {
  sort?: Partial<PluginSettings["sort"]>;
  filter?: Partial<PluginSettings["filter"]>;
  sectionCollapsed?: Partial<PluginSettings["sectionCollapsed"]>;
};

export const DEFAULT_SETTINGS: PluginSettings = {
  sort: {
    field: "mtime",
    direction: "desc",
  },
  group: { ...DEFAULT_GROUP_SPEC },
  filter: { tags: [], properties: [] },
  pinnedPaths: [],
  includeSubfolders: true,
  defaultView: "cards",
  defaultCardOpenBehavior: DEFAULT_CARD_OPEN_BEHAVIOR,
  dragInsertAction: DEFAULT_DRAG_INSERT_ACTION,
  cardCornerRadius: DEFAULT_CARD_CORNER_RADIUS,
  newNoteTemplate: DEFAULT_NEW_NOTE_TEMPLATE,
  previewLines: DEFAULT_PREVIEW_LINES,
  lastFolderPath: "",
  expandedFolderPaths: [], expandedTagPaths: [],
  visiblePropertyKeys: [], expandedPropertyKeys: [],
  boxes: [],
  favorites: [],
  activeBoxId: null,
  navPaneWidth: DEFAULT_NAV_PANE_WIDTH,
  navPaneCollapsed: false,
  sectionCollapsed: { favorites: false, folders: false, tags: false, properties: false, boxes: false },
  showNavItemCounts: false,
  navSectionOrder: defaultNavSectionOrder(),
};

export const SETTINGS_SCHEMA_VERSION = 2;

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

export function isNewNoteTemplate(value: string): value is NewNoteTemplate {
  return value === "tags-frontmatter" || value === "blank";
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

function normalizeNewNoteTemplate(value: unknown): NewNoteTemplate {
  return typeof value === "string" && isNewNoteTemplate(value)
    ? value
    : DEFAULT_NEW_NOTE_TEMPLATE;
}

function normalizeLastFolderPath(value: unknown, rawLastViewMode: unknown): string {
  if (typeof value === "string") {
    return value === "/" ? "" : value;
  }

  return rawLastViewMode === "all-notes" ? "" : DEFAULT_SETTINGS.lastFolderPath;
}

function normalizeNavPaneWidth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_NAV_PANE_WIDTH;
  }

  const rounded = Math.round(value);
  if (rounded < NAV_PANE_WIDTH_MIN) {
    return NAV_PANE_WIDTH_MIN;
  }
  if (rounded > NAV_PANE_WIDTH_MAX) {
    return NAV_PANE_WIDTH_MAX;
  }
  return rounded;
}

function normalizeBooleanSetting(value: unknown, defaultValue: boolean): boolean {
  return typeof value === "boolean" ? value : defaultValue;
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

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function normalizeBoxSort(value: unknown): CardBoxSortSpec {
  const sort = isRecord(value) ? value : {};
  return {
    field: normalizeSortField(sort.field),
    direction: normalizeSortDirection(sort.direction),
  };
}

function normalizeRule(value: unknown): Rule | null {
  if (!isRecord(value)) {
    return null;
  }

  const folder = typeof value.folder === "string" ? (value.folder === "/" ? "" : value.folder) : "";
  const includeSubfolders =
    typeof value.includeSubfolders === "boolean" ? value.includeSubfolders : true;
  const tags = normalizeTags(value.tags);
  const rawId = typeof value.id === "string" ? value.id.trim() : "";
  const content = { folder, includeSubfolders, tags };

  return {
    ...content,
    id: rawId.length > 0 ? rawId : deriveRuleId(content),
    name: typeof value.name === "string" ? value.name.trim() : "",
  };
}

function normalizeRules(value: unknown): Rule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: Rule[] = [];
  const seenIds = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const rule = normalizeRule(entry);
    if (rule === null) {
      continue;
    }
    if (seenIds.has(rule.id)) {
      // A hand-edited box can carry an explicit id equal to the indexed
      // candidate, so keep advancing the suffix until it is genuinely free.
      const derived = deriveRuleId(rule);
      let candidate = derived;
      let suffix = index;
      while (seenIds.has(candidate)) {
        candidate = `${derived}#${suffix}`;
        suffix += 1;
      }
      rule.id = candidate;
    }
    seenIds.add(rule.id);
    result.push(rule);
  }
  return result;
}

function normalizeBox(value: unknown): CardBoxDefinition | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (id.length === 0) {
    return null;
  }

  const name = typeof value.name === "string" && value.name.trim().length > 0 ? value.name : id;
  const manualPaths = normalizeStringArray(value.manualPaths);
  const manualSet = new Set(manualPaths);
  // Invariant: manualPaths ∩ excludedPaths = ∅ (manual add wins over exclude).
  const excludedPaths = normalizeStringArray(value.excludedPaths).filter(
    (path) => !manualSet.has(path),
  );

  return {
    id,
    name,
    rules: normalizeRules(value.rules),
    manualPaths,
    excludedPaths,
    pinnedPaths: normalizeStringArray(value.pinnedPaths),
    sort: normalizeBoxSort(value.sort),
    group: normalizeGroupSpec(value.group),
  };
}

function normalizeBoxes(value: unknown): CardBoxDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: CardBoxDefinition[] = [];
  const seenIds = new Set<string>();
  for (const entry of value) {
    const box = normalizeBox(entry);
    if (box === null || seenIds.has(box.id)) {
      continue;
    }
    seenIds.add(box.id);
    result.push(box);
  }
  return result;
}

function normalizeFavorites(value: unknown): FavoriteEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const result: FavoriteEntry[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isFavoriteKind(entry.kind) || typeof entry.ref !== "string") {
      continue;
    }
    const ref = normalizeFavoriteRef(entry.kind, entry.ref);
    if (ref === null) {
      continue;
    }
    const dedupeKey = `${entry.kind}\u0000${ref}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    result.push({ kind: entry.kind, ref });
  }
  return sortFavoritesByKind(result);
}

function normalizeActiveBoxId(value: unknown, boxes: CardBoxDefinition[]): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  return boxes.some((box) => box.id === value) ? value : null;
}

function flattenV2(raw: Record<string, unknown>): Record<string, unknown> {
  const preferences = isRecord(raw.preferences) ? raw.preferences : {};
  const workspace = isRecord(raw.workspace) ? raw.workspace : {};
  const userData = isRecord(raw.userData) ? raw.userData : {};
  return {
    ...preferences,
    lastFolderPath: workspace.lastFolderPath,
    expandedFolderPaths: workspace.expandedFolderPaths, expandedTagPaths: workspace.expandedTagPaths,
    expandedPropertyKeys: workspace.expandedPropertyKeys,
    activeBoxId: workspace.activeBoxId,
    filter: { tags: workspace.filterTags, properties: workspace.filterProperties },
    navPaneWidth: workspace.navPaneWidth,
    navPaneCollapsed: workspace.navPaneCollapsed,
    sectionCollapsed: workspace.sectionCollapsed,
    boxes: userData.boxes,
    favorites: userData.favorites,
    pinnedPaths: userData.pinnedPaths,
  };
}

function normalizeSectionCollapsed(data: Record<string, unknown>): Record<NavSectionId, boolean> {
  const record = isRecord(data.sectionCollapsed) ? data.sectionCollapsed : {};
  const legacyKeys: Partial<Record<NavSectionId, string>> = {
    favorites: "favoritesSectionCollapsed",
    folders: "folderSectionCollapsed",
    tags: "tagSectionCollapsed",
    boxes: "boxSectionCollapsed",
  };
  const result = { ...DEFAULT_SETTINGS.sectionCollapsed };
  for (const section of Object.keys(result) as NavSectionId[]) {
    const legacyKey = legacyKeys[section];
    const legacy = legacyKey === undefined ? undefined : data[legacyKey];
    if (typeof legacy === "boolean") result[section] = legacy;
    if (typeof record[section] === "boolean") result[section] = record[section];
  }
  return result;
}

function normalizeFlatSettings(raw: unknown): PluginSettings {
  const data = isRecord(raw) ? raw : {};
  const sort = isRecord(data.sort) ? data.sort : {};
  const filter = isRecord(data.filter) ? data.filter : {};
  const boxes = normalizeBoxes(data.boxes);
  // Cross-field pass: visible keys first, then expansion/filters against them,
  // so no active clause or expansion can survive a hidden key.
  const visiblePropertyKeys = normalizeVisiblePropertyKeys(data.visiblePropertyKeys);
  const visiblePropertyKeySet = new Set(visiblePropertyKeys);

  return {
    sort: {
      field: normalizeSortField(sort.field),
      direction: normalizeSortDirection(sort.direction),
    },
    group: normalizeGroupSpec(data.group),
    filter: {
      tags: normalizeTags(filter.tags),
      properties: normalizePropertyFilterClauses(filter.properties, visiblePropertyKeySet),
    },
    pinnedPaths: normalizePinnedPaths(data.pinnedPaths),
    includeSubfolders: normalizeBooleanSetting(data.includeSubfolders, DEFAULT_SETTINGS.includeSubfolders),
    defaultView: normalizeDefaultView(data.defaultView),
    defaultCardOpenBehavior: normalizeDefaultCardOpenBehavior(data.defaultCardOpenBehavior),
    dragInsertAction: normalizeDragInsertAction(data.dragInsertAction),
    cardCornerRadius: normalizeCardCornerRadius(data.cardCornerRadius),
    newNoteTemplate: normalizeNewNoteTemplate(data.newNoteTemplate),
    previewLines: normalizePreviewLines(data.previewLines),
    lastFolderPath: normalizeLastFolderPath(data.lastFolderPath, data.lastViewMode),
    expandedFolderPaths: normalizeExpandedFolderPaths(data.expandedFolderPaths), expandedTagPaths: normalizeExpandedTagPaths(data.expandedTagPaths),
    visiblePropertyKeys,
    expandedPropertyKeys: normalizeExpandedPropertyKeys(data.expandedPropertyKeys, visiblePropertyKeySet),
    boxes,
    favorites: normalizeFavorites(data.favorites),
    activeBoxId: normalizeActiveBoxId(data.activeBoxId, boxes),
    navPaneWidth: normalizeNavPaneWidth(data.navPaneWidth),
    navPaneCollapsed: normalizeBooleanSetting(data.navPaneCollapsed, DEFAULT_SETTINGS.navPaneCollapsed),
    sectionCollapsed: normalizeSectionCollapsed(data),
    showNavItemCounts: normalizeBooleanSetting(data.showNavItemCounts, DEFAULT_SETTINGS.showNavItemCounts),
    navSectionOrder: normalizeNavSectionOrder(data.navSectionOrder),
  };
}

export function migrateSettings(raw: unknown): PluginSettings {
  const data = isRecord(raw) ? raw : {};
  return normalizeFlatSettings(data.schemaVersion === 2 ? flattenV2(data) : data);
}

export function normalizeSettings(raw: unknown): PluginSettings {
  return migrateSettings(raw);
}

export function mergeSettings(current: PluginSettings, patch: PartialPluginSettings): PluginSettings {
  return normalizeSettings({
    ...current,
    ...patch,
    sort: { ...current.sort, ...patch.sort },
    filter: { ...current.filter, ...patch.filter },
    sectionCollapsed: { ...current.sectionCollapsed, ...patch.sectionCollapsed },
  });
}
