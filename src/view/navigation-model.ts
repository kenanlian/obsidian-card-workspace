import type { CardScope } from "./scope";
import type { TagTreeNode } from "./tag-tree";
import type { FavoriteEntry, FavoriteKind, FolderTreeNode, NavSectionId } from "./types";

export type NavigationSemanticState =
  | "none"
  | "current-range"
  | "checked-filter"
  | "active-file";

export type NavigationActivationMode = "ordinary" | "additive";

export interface NavigationRevealRequest {
  token: number;
  rowId: string;
}

export interface NavigationFocusRequest {
  token: number;
  rowId: string;
}

export interface NavigationExpansionLayer {
  manual: readonly string[];
  reveal: readonly string[];
  query: readonly string[];
  suppressed: readonly string[];
}

export interface NavigationExpansionLayers {
  folders: NavigationExpansionLayer;
  tags: NavigationExpansionLayer;
  /** Temporary query-session collapses; ignored for a blank query. */
  queryCollapsedSections: readonly NavSectionId[];
}

export interface NavigationSectionLabels {
  label: string;
  emptyLabel: string | null;
}

export interface NavigationFavoriteSource {
  kind: FavoriteKind;
  ref: string;
  label: string;
  icon: string;
  count: number;
  missing: boolean;
}

export interface NavigationBoxSource {
  id: string;
  name: string;
  cardCount: number;
}

export interface NavigationProjectionInput {
  query: string;
  scope: CardScope;
  activeTags: readonly string[];
  selectedPath: string | null;
  favorites: readonly NavigationFavoriteSource[];
  folders: readonly FolderTreeNode[];
  tags: readonly TagTreeNode[];
  boxes: readonly NavigationBoxSource[];
  tagCounts: Readonly<Record<string, number>>;
  includeSubfolders: boolean;
  tagsDisabled: boolean;
  sectionCollapsed: Readonly<Record<NavSectionId, boolean>>;
  sectionOrder: readonly NavSectionId[];
  sectionLabels: Readonly<Record<NavSectionId, NavigationSectionLabels>>;
  rootFolderLabel: string;
  expansion: NavigationExpansionLayers;
}

export type NavigationMenuTarget =
  | { section: NavSectionId; scope: "header" }
  | { section: "favorites"; scope: "item"; favorite: FavoriteEntry }
  | { section: "folders" | "tags" | "boxes"; scope: "item"; itemId: string };

interface NavigationRowBase {
  id: string;
  section: NavSectionId;
  parentId: string | null;
  level: number;
  positionInSet: number;
  setSize: number;
  expandable: boolean;
  expanded: boolean;
  disabled: boolean;
  semanticState: NavigationSemanticState;
  label: string;
  fullPath: string | null;
  count: number;
  icon: string | null;
  menuTarget: NavigationMenuTarget;
}

export interface NavigationSectionRow extends NavigationRowBase {
  kind: "section";
  section: NavSectionId;
  parentId: null;
  level: 1;
}

export interface NavigationFavoriteRow extends NavigationRowBase {
  kind: "favorite";
  section: "favorites";
  favorite: FavoriteEntry;
  missing: boolean;
}

export interface NavigationFolderRow extends NavigationRowBase {
  kind: "folder";
  section: "folders";
  folderPath: string;
  directCount: number;
  recursiveCount: number;
  recursiveFolderCount: number;
}

export interface NavigationTagRow extends NavigationRowBase {
  kind: "tag";
  section: "tags";
  tagPath: string;
  synthetic: boolean;
  descendantCount: number;
}

export interface NavigationBoxRow extends NavigationRowBase {
  kind: "box";
  section: "boxes";
  boxId: string;
}

/**
 * Stable, non-DOM row seam. Future row variants can extend this union without
 * changing focus/filter ordering.
 *
 * Row variants are extended through section-owned projection, so a future
 * Properties section may contribute Property Value rows as ordinary section
 * items. What stays prohibited is embedding an Obsidian Property Editor or an
 * arbitrary property table into the navigation pane, and anything that breaks
 * the single-ARIA-tree model.
 */
export type NavigationRow =
  | NavigationSectionRow
  | NavigationFavoriteRow
  | NavigationFolderRow
  | NavigationTagRow
  | NavigationBoxRow;

export interface NavigationProjectedSection {
  id: `section:${NavSectionId}`;
  section: NavSectionId;
  label: string;
  visible: boolean;
  expanded: boolean;
  matchedItemCount: number;
  emptyLabel: string | null;
}

export interface NavigationProjection {
  normalizedQuery: string;
  querying: boolean;
  sections: readonly NavigationProjectedSection[];
  rows: readonly NavigationRow[];
  noResults: boolean;
}

export const EMPTY_NAVIGATION_PROJECTION: NavigationProjection = {
  normalizedQuery: "",
  querying: false,
  sections: [],
  rows: [],
  noResults: false,
};

export type NavigationIntent =
  | { type: "query-update"; query: string }
  | { type: "query-clear"; origin: "input" | "tree" | "menu" }
  | { type: "focus"; rowId: string | null }
  | { type: "set-expanded"; rowId: string; expanded: boolean }
  | { type: "toggle-section"; section: NavSectionId }
  | { type: "activate"; rowId: string; mode: NavigationActivationMode }
  | { type: "reveal-consumed"; token: number }
  | { type: "focus-return-consumed"; token: number };

export const NAVIGATION_SECTION_ORDER: readonly NavSectionId[] = [
  "favorites",
  "folders",
  "tags",
  "boxes",
];

export function navigationSectionId(section: NavSectionId): `section:${NavSectionId}` {
  return `section:${section}`;
}

export function navigationFavoriteId(kind: FavoriteKind, ref: string): string {
  return `favorite:${kind}:${ref}`;
}

export function navigationFolderId(path: string): string {
  return `folder:${path === "/" ? "" : path}`;
}

export function navigationTagId(path: string): string {
  return `tag:${path}`;
}

export function navigationBoxId(id: string): string {
  return `box:${id}`;
}
