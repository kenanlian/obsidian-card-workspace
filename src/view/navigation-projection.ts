import { PLAIN_FOLDER_ICON } from "../icons";
import { normalizeNavSectionOrder } from "../navigation-section-order";
import { normalizeScopePath } from "./scope";
import { normalizeTagPath, type TagTreeNode } from "./tag-tree";
import type { FavoriteKind, FolderTreeNode, NavSectionId } from "./types";
import {
  navigationBoxId,
  navigationFavoriteId,
  navigationFolderId,
  navigationSectionId,
  navigationTagId,
  type NavigationBoxRow,
  type NavigationExpansionLayer,
  type NavigationFavoriteRow,
  type NavigationFolderRow,
  type NavigationProjectedSection,
  type NavigationProjection,
  type NavigationProjectionInput,
  type NavigationRow,
  type NavigationSemanticState,
  type NavigationTagRow,
} from "./navigation-model";

interface MatchedTreeNode<T> {
  source: T;
  children: MatchedTreeNode<T>[];
  selfMatches: boolean;
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

function matches(needle: string, ...candidates: string[]): boolean {
  return candidates.some((candidate) => candidate.toLowerCase().includes(needle));
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function validString(value: unknown, allowEmpty = false): value is string {
  return typeof value === "string" && (allowEmpty || value.length > 0);
}

function buildExpansionSet(layer: NavigationExpansionLayer, querying: boolean): Set<string> {
  const expanded = new Set([...layer.manual, ...layer.reveal]);
  if (querying) {
    for (const value of layer.query) expanded.add(value);
  }
  for (const value of layer.suppressed) expanded.delete(value);
  return expanded;
}

function isSuppressed(layer: NavigationExpansionLayer, identity: string): boolean {
  return layer.suppressed.includes(identity);
}

function favoriteSemanticState(
  kind: FavoriteKind,
  ref: string,
  input: NavigationProjectionInput,
  activeTags: ReadonlySet<string>,
): NavigationSemanticState {
  if (kind === "folder") {
    return input.scope.kind === "folder" && normalizeScopePath(ref) === input.scope.path
      ? "current-range"
      : "none";
  }
  if (kind === "box") {
    return input.scope.kind === "box" && ref === input.scope.boxId ? "current-range" : "none";
  }
  if (kind === "tag") {
    return activeTags.has(normalizeTagPath(ref)) ? "checked-filter" : "none";
  }
  return ref === input.selectedPath ? "active-file" : "none";
}

function filterFolderTree(
  nodes: readonly FolderTreeNode[],
  needle: string,
  rootFolderLabel: string,
): MatchedTreeNode<FolderTreeNode>[] {
  const result: MatchedTreeNode<FolderTreeNode>[] = [];
  for (const node of nodes) {
    if (!validString(node?.path, true) || !validString(node?.name, true)) continue;
    const children = filterFolderTree(Array.isArray(node.children) ? node.children : [], needle, rootFolderLabel);
    const canonicalPath = normalizeScopePath(node.path);
    const selfMatches = matches(needle, node.name || "/", canonicalPath || "/", canonicalPath === "" ? rootFolderLabel : "");
    if (selfMatches || children.length > 0) result.push({ source: node, children, selfMatches });
  }
  return result;
}

function filterTagTree(nodes: readonly TagTreeNode[], needle: string): MatchedTreeNode<TagTreeNode>[] {
  const result: MatchedTreeNode<TagTreeNode>[] = [];
  for (const node of nodes) {
    const tag = normalizeTagPath(node?.tag ?? "");
    if (tag.length === 0 || !validString(node?.label)) continue;
    const children = filterTagTree(Array.isArray(node.children) ? node.children : [], needle);
    const selfMatches = matches(needle, node.label, tag);
    if (selfMatches || children.length > 0) result.push({ source: node, children, selfMatches });
  }
  return result;
}

function assignSetMetadata<T extends NavigationRow>(rows: T[]): T[] {
  const byParent = new Map<string | null, T[]>();
  for (const row of rows) {
    const siblings = byParent.get(row.parentId) ?? [];
    siblings.push(row);
    byParent.set(row.parentId, siblings);
  }
  return rows.map((row) => {
    const siblings = byParent.get(row.parentId) ?? [row];
    return {
      ...row,
      positionInSet: siblings.findIndex((candidate) => candidate.id === row.id) + 1,
      setSize: siblings.length,
    };
  });
}

function projectFolders(
  input: NavigationProjectionInput,
  needle: string,
  sectionExpanded: boolean,
): NavigationFolderRow[] {
  if (!sectionExpanded) return [];
  const querying = needle.length > 0;
  const matched = querying
    ? filterFolderTree(input.folders, needle, input.rootFolderLabel)
    : input.folders
        .filter((node) => validString(node?.path, true) && validString(node?.name, true))
        .map((source) => ({ source, children: [], selfMatches: true }));
  const expandedPaths = buildExpansionSet(input.expansion.folders, querying);
  const rows: NavigationFolderRow[] = [];

  const walk = (
    nodes: readonly (MatchedTreeNode<FolderTreeNode> | { source: FolderTreeNode })[],
    parentId: string,
    level: number,
  ): void => {
    for (const matchedNode of nodes) {
      const node = matchedNode.source;
      const canonicalPath = normalizeScopePath(node.path);
      const id = navigationFolderId(canonicalPath);
      const sourceChildren = Array.isArray(node.children) ? node.children : [];
      const matchedChildren = "children" in matchedNode ? matchedNode.children : [];
      const children = querying ? matchedChildren : sourceChildren.map((source) => ({ source }));
      const expandable = sourceChildren.length > 0;
      const autoExpanded = querying && matchedChildren.length > 0;
      const expanded = expandable
        && !isSuppressed(input.expansion.folders, canonicalPath)
        && (expandedPaths.has(canonicalPath) || autoExpanded);
      rows.push({
        id,
        kind: "folder",
        section: "folders",
        parentId,
        level,
        positionInSet: 0,
        setSize: 0,
        expandable,
        expanded,
        disabled: false,
        semanticState:
          input.scope.kind === "folder" && canonicalPath === input.scope.path
            ? "current-range"
            : "none",
        label: canonicalPath === "" ? input.rootFolderLabel : node.name || "/",
        fullPath: canonicalPath || "/",
        count: count(input.includeSubfolders ? node.recursiveCount : node.directCount),
        icon: canonicalPath === "" ? "house" : PLAIN_FOLDER_ICON,
        menuTarget: { section: "folders", scope: "item", itemId: node.path },
        folderPath: canonicalPath,
        directCount: count(node.directCount),
        recursiveCount: count(node.recursiveCount),
        recursiveFolderCount: count(node.recursiveFolderCount),
      });
      if (expanded) walk(children, id, level + 1);
    }
  };

  walk(matched, navigationSectionId("folders"), 2);
  return assignSetMetadata(rows);
}

function projectTags(
  input: NavigationProjectionInput,
  needle: string,
  sectionExpanded: boolean,
  activeTags: ReadonlySet<string>,
): NavigationTagRow[] {
  if (!sectionExpanded) return [];
  const querying = needle.length > 0;
  const matched = querying
    ? filterTagTree(input.tags, needle)
    : input.tags
        .filter((node) => normalizeTagPath(node?.tag ?? "").length > 0 && validString(node?.label))
        .map((source) => ({ source, children: [], selfMatches: true }));
  const expandedPaths = buildExpansionSet(input.expansion.tags, querying);
  const rows: NavigationTagRow[] = [];

  const descendantCount = (nodes: readonly TagTreeNode[]): number =>
    nodes.reduce((total, node) => total + 1 + descendantCount(node.children ?? []), 0);

  const walk = (
    nodes: readonly (MatchedTreeNode<TagTreeNode> | { source: TagTreeNode })[],
    parentId: string,
    level: number,
  ): void => {
    for (const matchedNode of nodes) {
      const node = matchedNode.source;
      const tagPath = normalizeTagPath(node.tag);
      const id = navigationTagId(tagPath);
      const sourceChildren = Array.isArray(node.children) ? node.children : [];
      const matchedChildren = "children" in matchedNode ? matchedNode.children : [];
      const children = querying ? matchedChildren : sourceChildren.map((source) => ({ source }));
      const expandable = sourceChildren.length > 0;
      const autoExpanded = querying && matchedChildren.length > 0;
      const expanded = expandable
        && !isSuppressed(input.expansion.tags, tagPath)
        && (expandedPaths.has(tagPath) || autoExpanded);
      rows.push({
        id,
        kind: "tag",
        section: "tags",
        parentId,
        level,
        positionInSet: 0,
        setSize: 0,
        expandable,
        expanded,
        disabled: input.tagsDisabled,
        semanticState: activeTags.has(tagPath) ? "checked-filter" : "none",
        label: node.label,
        fullPath: tagPath,
        count: count(input.tagCounts[tagPath]),
        icon: "tag",
        menuTarget: { section: "tags", scope: "item", itemId: tagPath },
        tagPath,
        synthetic: Boolean(node.synthetic),
        descendantCount: descendantCount(sourceChildren),
      });
      if (expanded) walk(children, id, level + 1);
    }
  };

  walk(matched, navigationSectionId("tags"), 2);
  return assignSetMetadata(rows);
}

export function projectNavigation(input: NavigationProjectionInput): NavigationProjection {
  const normalizedQuery = normalizeQuery(input.query ?? "");
  const querying = normalizedQuery.length > 0;
  const activeTags = new Set(input.activeTags.map((tag) => normalizeTagPath(tag)).filter(Boolean));
  const queryCollapsedSections = new Set(input.expansion.queryCollapsedSections);
  const matchedCounts = new Map<NavSectionId, number>();

  const favoriteRows: NavigationFavoriteRow[] = [];
  for (const favorite of input.favorites) {
    if (!validString(favorite?.ref, favorite?.kind === "folder") || !validString(favorite?.label)) continue;
    if (querying && !matches(normalizedQuery, favorite.label)) continue;
    const favoriteEntry = { kind: favorite.kind, ref: favorite.ref };
    favoriteRows.push({
      id: navigationFavoriteId(favorite.kind, favorite.ref),
      kind: "favorite",
      section: "favorites",
      parentId: navigationSectionId("favorites"),
      level: 2,
      positionInSet: 0,
      setSize: 0,
      expandable: false,
      expanded: false,
      disabled: favorite.missing,
      semanticState: favoriteSemanticState(favorite.kind, favorite.ref, input, activeTags),
      label: favorite.label,
      fullPath: favorite.ref,
      count: count(favorite.count),
      icon: validString(favorite.icon) ? favorite.icon : "star",
      menuTarget: { section: "favorites", scope: "item", favorite: favoriteEntry },
      favorite: favoriteEntry,
      missing: favorite.missing,
    });
  }
  matchedCounts.set("favorites", favoriteRows.length);

  const folderMatches = querying ? filterFolderTree(input.folders, normalizedQuery, input.rootFolderLabel).length : input.folders.length;
  matchedCounts.set("folders", folderMatches);
  const tagMatches = querying ? filterTagTree(input.tags, normalizedQuery).length : input.tags.length;
  matchedCounts.set("tags", tagMatches);

  const boxRows: NavigationBoxRow[] = [];
  for (const box of input.boxes) {
    if (!validString(box?.id) || !validString(box?.name)) continue;
    if (querying && !matches(normalizedQuery, box.name)) continue;
    boxRows.push({
      id: navigationBoxId(box.id),
      kind: "box",
      section: "boxes",
      parentId: navigationSectionId("boxes"),
      level: 2,
      positionInSet: 0,
      setSize: 0,
      expandable: false,
      expanded: false,
      disabled: false,
      semanticState:
        input.scope.kind === "box" && input.scope.boxId === box.id ? "current-range" : "none",
      label: box.name,
      fullPath: null,
      count: count(box.cardCount),
      icon: "box",
      menuTarget: { section: "boxes", scope: "item", itemId: box.id },
      boxId: box.id,
    });
  }
  matchedCounts.set("boxes", boxRows.length);

  const visibleSectionIds = normalizeNavSectionOrder(input.sectionOrder).filter((section) =>
    !querying || (matchedCounts.get(section) ?? 0) > 0,
  );
  const sections: NavigationProjectedSection[] = [];
  const rows: NavigationRow[] = [];

  for (let index = 0; index < visibleSectionIds.length; index += 1) {
    const section = visibleSectionIds[index];
    const expanded = querying
      ? !queryCollapsedSections.has(section)
      : !input.sectionCollapsed[section];
    const sectionRow = {
      id: navigationSectionId(section),
      kind: "section" as const,
      section,
      parentId: null,
      level: 1 as const,
      positionInSet: index + 1,
      setSize: visibleSectionIds.length,
      expandable: true,
      expanded,
      disabled: false,
      semanticState: "none" as const,
      label: input.sectionLabels[section].label,
      fullPath: null,
      count: 0,
      icon: null,
      menuTarget: { section, scope: "header" as const },
    };
    rows.push(sectionRow);

    let children: NavigationRow[] = [];
    if (section === "favorites") children = expanded ? assignSetMetadata(favoriteRows) : [];
    if (section === "folders") children = projectFolders(input, normalizedQuery, expanded);
    if (section === "tags") children = projectTags(input, normalizedQuery, expanded, activeTags);
    if (section === "boxes") children = expanded ? assignSetMetadata(boxRows) : [];
    rows.push(...children);
    sections.push({
      id: navigationSectionId(section),
      section,
      label: input.sectionLabels[section].label,
      visible: true,
      expanded,
      matchedItemCount: matchedCounts.get(section) ?? 0,
      emptyLabel: querying ? null : input.sectionLabels[section].emptyLabel,
    });
  }

  return {
    normalizedQuery,
    querying,
    sections,
    rows,
    noResults: querying && visibleSectionIds.length === 0,
  };
}

/** C25 recovery order: same ID, current range, prior logical index, first section. */
export function resolveNavigationFocus(
  previousRows: readonly NavigationRow[],
  nextRows: readonly NavigationRow[],
  previousFocusId: string | null,
): string | null {
  if (nextRows.length === 0) return null;
  if (previousFocusId !== null && nextRows.some((row) => row.id === previousFocusId)) {
    return previousFocusId;
  }
  const currentRange = nextRows.find((row) => row.semanticState === "current-range");
  if (currentRange) return currentRange.id;
  const previousIndex = previousFocusId === null
    ? -1
    : previousRows.findIndex((row) => row.id === previousFocusId);
  if (previousIndex >= 0) {
    return nextRows[Math.min(previousIndex, nextRows.length - 1)]?.id ?? null;
  }
  return nextRows.find((row) => row.kind === "section")?.id ?? nextRows[0]?.id ?? null;
}
