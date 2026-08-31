import type { App } from "obsidian";
import { DEFAULT_GROUP_SPEC } from "../card-grouping-settings";
import { deriveRuleId } from "./box-rule-identity";
import type { CardBoxDefinition, CardBoxSortSpec, Rule } from "./types";
import { matchesRule } from "./card-box-membership";
export const DEFAULT_BOX_SORT: CardBoxSortSpec = { field: "mtime", direction: "desc" };
export const DEFAULT_BOX_NAME = "New card box";
/** Projects membership fields only: renaming a rule is a label change, not a reload. */
export function getBoxMembershipSignature(box: CardBoxDefinition): string {
  return JSON.stringify({
    rules: box.rules.map((rule) => ({
      folder: rule.folder,
      includeSubfolders: rule.includeSubfolders,
      tags: rule.tags,
    })),
    manual: box.manualPaths,
    excluded: box.excludedPaths,
  });
}
/** Browse-mode scope snapshot used to seed a rule. */
export interface BrowseScope {
  folder: string;
  includeSubfolders: boolean;
  tags: string[];
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function generateBoxId(existing: CardBoxDefinition[]): string {
  const taken = new Set(existing.map((box) => box.id));
  let id = `box-${Date.now().toString(36)}-${randomSuffix()}`;
  while (taken.has(id)) {
    id = `box-${Date.now().toString(36)}-${randomSuffix()}`;
  }
  return id;
}

export function ensureUniqueBoxName(
  desired: string,
  boxes: CardBoxDefinition[],
  excludeId?: string,
): string {
  const base = desired.trim().length > 0 ? desired.trim() : DEFAULT_BOX_NAME;
  const taken = new Set(
    boxes.filter((box) => box.id !== excludeId).map((box) => box.name),
  );
  if (!taken.has(base)) {
    return base;
  }

  let counter = 2;
  while (taken.has(`${base} (${counter})`)) {
    counter += 1;
  }
  return `${base} (${counter})`;
}

export function findCardBox(
  boxes: CardBoxDefinition[],
  id: string | null,
): CardBoxDefinition | null {
  if (id === null) {
    return null;
  }
  return boxes.find((box) => box.id === id) ?? null;
}

export function createCardBox(
  name: string,
  boxes: CardBoxDefinition[],
  init: Partial<Omit<CardBoxDefinition, "id" | "name">> = {},
): CardBoxDefinition {
  return {
    id: generateBoxId(boxes),
    name: ensureUniqueBoxName(name, boxes),
    rules: init.rules ? init.rules.map(cloneRule) : [],
    manualPaths: init.manualPaths ? [...init.manualPaths] : [],
    excludedPaths: init.excludedPaths ? [...init.excludedPaths] : [],
    pinnedPaths: init.pinnedPaths ? [...init.pinnedPaths] : [],
    sort: init.sort ? { ...init.sort } : { ...DEFAULT_BOX_SORT },
    group: init.group ? { ...init.group } : { ...DEFAULT_GROUP_SPEC },
  };
}

/** Replace the box with the same id, or append when it does not exist yet. */
export function upsertCardBox(
  boxes: CardBoxDefinition[],
  box: CardBoxDefinition,
): CardBoxDefinition[] {
  const index = boxes.findIndex((candidate) => candidate.id === box.id);
  if (index === -1) {
    return [...boxes, box];
  }
  const next = [...boxes];
  next[index] = box;
  return next;
}

export function renameCardBox(
  boxes: CardBoxDefinition[],
  id: string,
  name: string,
): CardBoxDefinition[] {
  return boxes.map((box) =>
    box.id === id ? { ...box, name: ensureUniqueBoxName(name, boxes, id) } : box,
  );
}

export function deleteCardBox(
  boxes: CardBoxDefinition[],
  id: string,
): CardBoxDefinition[] {
  return boxes.filter((box) => box.id !== id);
}

export function duplicateCardBox(
  boxes: CardBoxDefinition[],
  id: string,
): CardBoxDefinition[] {
  const source = findCardBox(boxes, id);
  if (source === null) {
    return boxes;
  }

  const copy: CardBoxDefinition = {
    id: generateBoxId(boxes),
    name: ensureUniqueBoxName(`${source.name} (copy)`, boxes),
    rules: source.rules.map(cloneRule),
    manualPaths: [...source.manualPaths],
    excludedPaths: [...source.excludedPaths],
    pinnedPaths: [...source.pinnedPaths],
    sort: { ...source.sort },
    group: { ...source.group },
  };

  const index = boxes.findIndex((box) => box.id === id);
  const next = [...boxes];
  next.splice(index + 1, 0, copy);
  return next;
}

function cloneRule(rule: Rule): Rule {
  return {
    folder: rule.folder,
    includeSubfolders: rule.includeSubfolders,
    tags: [...rule.tags],
    id: rule.id,
    name: rule.name,
  };
}

function rulesEqual(left: Rule, right: Rule): boolean {
  if (left.folder !== right.folder || left.includeSubfolders !== right.includeSubfolders) {
    return false;
  }
  if (left.tags.length !== right.tags.length) {
    return false;
  }
  const sortedLeft = [...left.tags].sort();
  const sortedRight = [...right.tags].sort();
  return sortedLeft.every((tag, index) => tag === sortedRight[index]);
}

export function translateBrowseScopeToRule(scope: BrowseScope): Rule {
  const content = {
    folder: scope.folder === "/" ? "" : scope.folder,
    includeSubfolders: scope.includeSubfolders,
    tags: [...scope.tags],
  };
  return { ...content, id: deriveRuleId(content), name: "" };
}

export function addRuleToBox(box: CardBoxDefinition, rule: Rule): CardBoxDefinition {
  const normalized = cloneRule(rule);
  if (box.rules.some((existing) => rulesEqual(existing, normalized))) {
    return box;
  }
  return { ...box, rules: [...box.rules, normalized] };
}

export function removeRuleFromBox(box: CardBoxDefinition, index: number): CardBoxDefinition {
  if (index < 0 || index >= box.rules.length) {
    return box;
  }
  return { ...box, rules: box.rules.filter((_, ruleIndex) => ruleIndex !== index) };
}

/** Add manual members, maintaining the `manual ∩ excluded = ∅` invariant. */
export function addManualPaths(box: CardBoxDefinition, paths: string[]): CardBoxDefinition {
  const additions = paths.filter((path) => path.trim().length > 0);
  if (additions.length === 0) {
    return box;
  }

  const manualSet = new Set(box.manualPaths);
  for (const path of additions) {
    manualSet.add(path);
  }
  const manualPaths = Array.from(manualSet);
  const excludedPaths = box.excludedPaths.filter((path) => !manualSet.has(path));
  return { ...box, manualPaths, excludedPaths };
}

/**
 * Remove a card entirely from a box.
 *
 * - Drops the path from `manualPaths`.
 * - If the path still matches a rule, records it in `excludedPaths` so the card
 *   leaves the box despite the rule hit.
 */
export function removeMemberFromBox(
  app: App,
  box: CardBoxDefinition,
  path: string,
): CardBoxDefinition {
  const manualPaths = box.manualPaths.filter((manualPath) => manualPath !== path);
  const stillMatchesRule = box.rules.some((rule) => matchesRule(app, path, rule));

  let excludedPaths = box.excludedPaths;
  if (stillMatchesRule && !excludedPaths.includes(path)) {
    excludedPaths = [...excludedPaths, path];
  }

  return { ...box, manualPaths, excludedPaths };
}

export interface BoxVaultMutation {
  eventType: "create" | "modify" | "delete" | "rename";
  path: string;
  oldPath: string | null;
  isFolder: boolean;
}

function rewritePath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) {
    return newPath;
  }
  const prefix = `${oldPath}/`;
  if (path.startsWith(prefix)) {
    return `${newPath}/${path.slice(prefix.length)}`;
  }
  return path;
}

function isUnderPath(path: string, scopePath: string): boolean {
  return path === scopePath || path.startsWith(`${scopePath}/`);
}

function dedupe(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    if (!seen.has(path)) {
      seen.add(path);
      result.push(path);
    }
  }
  return result;
}

function mapPathList(paths: string[], mapper: (path: string) => string): string[] {
  let changed = false;
  const mapped = paths.map((path) => {
    const next = mapper(path);
    if (next !== path) {
      changed = true;
    }
    return next;
  });
  return changed ? dedupe(mapped) : paths;
}

function filterPathList(paths: string[], keep: (path: string) => boolean): string[] {
  const filtered = paths.filter(keep);
  return filtered.length === paths.length ? paths : filtered;
}

/**
 * Keep a box consistent with a vault mutation.
 *
 * - File rename: rewrite exact matches in manual/excluded/pinned paths.
 * - Folder rename: prefix-migrate path lists and `rule.folder`.
 * - File delete: drop the path from all path lists.
 * - Folder delete: drop paths under the folder; rules are left dangling
 *   (they resolve to zero hits) rather than silently falling back to root.
 *
 * Returns the same box reference when nothing changes.
 */
export function reconcileBoxForVaultMutation(
  box: CardBoxDefinition,
  event: BoxVaultMutation,
): CardBoxDefinition {
  if (event.eventType === "rename" && event.oldPath) {
    return event.isFolder
      ? migrateBoxForFolderRename(box, event.oldPath, event.path)
      : migrateBoxForFileRename(box, event.oldPath, event.path);
  }

  if (event.eventType === "delete") {
    return event.isFolder
      ? cleanupBoxForFolderDelete(box, event.path)
      : cleanupBoxForFileDelete(box, event.path);
  }

  return box;
}

function migrateBoxForFileRename(
  box: CardBoxDefinition,
  oldPath: string,
  newPath: string,
): CardBoxDefinition {
  const map = (path: string) => (path === oldPath ? newPath : path);
  const manualPaths = mapPathList(box.manualPaths, map);
  const excludedPaths = mapPathList(box.excludedPaths, map);
  const pinnedPaths = mapPathList(box.pinnedPaths, map);
  if (
    manualPaths === box.manualPaths &&
    excludedPaths === box.excludedPaths &&
    pinnedPaths === box.pinnedPaths
  ) {
    return box;
  }
  return { ...box, manualPaths, excludedPaths, pinnedPaths };
}

function migrateBoxForFolderRename(
  box: CardBoxDefinition,
  oldPath: string,
  newPath: string,
): CardBoxDefinition {
  const map = (path: string) => rewritePath(path, oldPath, newPath);
  const manualPaths = mapPathList(box.manualPaths, map);
  const excludedPaths = mapPathList(box.excludedPaths, map);
  const pinnedPaths = mapPathList(box.pinnedPaths, map);

  let rulesChanged = false;
  const rules = box.rules.map((rule) => {
    if (rule.folder === "") {
      return rule;
    }
    const nextFolder = rewritePath(rule.folder, oldPath, newPath);
    if (nextFolder === rule.folder) {
      return rule;
    }
    rulesChanged = true;
    return { ...rule, folder: nextFolder };
  });

  if (
    manualPaths === box.manualPaths &&
    excludedPaths === box.excludedPaths &&
    pinnedPaths === box.pinnedPaths &&
    !rulesChanged
  ) {
    return box;
  }

  return {
    ...box,
    rules: rulesChanged ? rules : box.rules,
    manualPaths,
    excludedPaths,
    pinnedPaths,
  };
}

function cleanupBoxForFileDelete(box: CardBoxDefinition, path: string): CardBoxDefinition {
  const keep = (candidate: string) => candidate !== path;
  const manualPaths = filterPathList(box.manualPaths, keep);
  const excludedPaths = filterPathList(box.excludedPaths, keep);
  const pinnedPaths = filterPathList(box.pinnedPaths, keep);
  if (
    manualPaths === box.manualPaths &&
    excludedPaths === box.excludedPaths &&
    pinnedPaths === box.pinnedPaths
  ) {
    return box;
  }
  return { ...box, manualPaths, excludedPaths, pinnedPaths };
}

function cleanupBoxForFolderDelete(box: CardBoxDefinition, folderPath: string): CardBoxDefinition {
  const keep = (candidate: string) => !isUnderPath(candidate, folderPath);
  const manualPaths = filterPathList(box.manualPaths, keep);
  const excludedPaths = filterPathList(box.excludedPaths, keep);
  const pinnedPaths = filterPathList(box.pinnedPaths, keep);
  if (
    manualPaths === box.manualPaths &&
    excludedPaths === box.excludedPaths &&
    pinnedPaths === box.pinnedPaths
  ) {
    return box;
  }
  return { ...box, manualPaths, excludedPaths, pinnedPaths };
}

/** Restore previously removed rule hits by clearing exclusions. */
export function restoreExcludedPaths(
  box: CardBoxDefinition,
  paths?: string[],
): CardBoxDefinition {
  if (paths === undefined) {
    return { ...box, excludedPaths: [] };
  }
  const removeSet = new Set(paths);
  return { ...box, excludedPaths: box.excludedPaths.filter((path) => !removeSet.has(path)) };
}
