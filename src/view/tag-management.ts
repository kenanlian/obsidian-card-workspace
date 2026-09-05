import type { App, TFile } from "obsidian";
import { getFileTags } from "./metadata-utils";
import { normalizeTagPath, renameTagPathPrefix, tagPathIsOrUnder } from "./tag-tree";
import type { CardBoxDefinition, FavoriteEntry, Rule } from "./types";

/** Markdown files only: the metadata cache never reports tags for other card kinds. */
function getVaultMarkdownFiles(app: App): TFile[] {
  const getMarkdownFiles = app.vault?.getMarkdownFiles as (() => TFile[]) | undefined;
  if (typeof getMarkdownFiles !== "function") {
    return [];
  }
  return getMarkdownFiles.call(app.vault);
}

export interface TagManagementScan {
  /** Markdown files carrying `tag` or any `tag/*` descendant. */
  files: TFile[];
  /** Distinct strict-descendant tag paths (`tag/*`) found in the vault, sorted. */
  descendantTags: string[];
  favoriteCount: number;
  boxRuleClauseCount: number;
  affectedBoxCount: number;
  filterTagCount: number;
}

export interface TagReferenceSnapshot {
  favorites: FavoriteEntry[];
  filterTags: string[];
  boxes: CardBoxDefinition[];
}

/**
 * Vault-wide impact scan for rename/delete: which notes carry the tag (or a
 * descendant), and how many plugin-side references (favorites, active tag
 * filter, box rule tag clauses) point at it.
 */
export function scanTagManagementTargets(
  app: App,
  tag: string,
  refs: TagReferenceSnapshot,
): TagManagementScan {
  const normalizedTag = normalizeTagPath(tag);

  const files: TFile[] = [];
  const descendantTags = new Set<string>();
  if (normalizedTag.length > 0) {
    for (const file of getVaultMarkdownFiles(app)) {
      let carriesTarget = false;
      for (const fileTag of getFileTags(app, file)) {
        if (tagPathIsOrUnder(fileTag, normalizedTag)) {
          carriesTarget = true;
          if (fileTag !== normalizedTag) {
            // Expand intermediate ancestors too: `a/b` used via `a/b/c` still
            // shows as a subtag node in the tree, so the confirm copy counts it.
            let descendant = fileTag;
            while (descendant.startsWith(`${normalizedTag}/`)) {
              descendantTags.add(descendant);
              const slash = descendant.lastIndexOf("/");
              if (slash <= normalizedTag.length) {
                break;
              }
              descendant = descendant.slice(0, slash);
            }
          }
        }
      }
      if (carriesTarget) {
        files.push(file);
      }
    }
  }

  const favoriteCount = refs.favorites.filter(
    (entry) => entry.kind === "tag" && tagPathIsOrUnder(entry.ref, normalizedTag),
  ).length;
  const filterTagCount = refs.filterTags.filter(
    (filterTag) => tagPathIsOrUnder(filterTag, normalizedTag),
  ).length;

  let boxRuleClauseCount = 0;
  const affectedBoxes = new Set<string>();
  for (const box of refs.boxes) {
    for (const rule of box.rules) {
      const matchingClauses = rule.tags.filter((ruleTag) => tagPathIsOrUnder(ruleTag, normalizedTag));
      if (matchingClauses.length > 0) {
        boxRuleClauseCount += matchingClauses.length;
        affectedBoxes.add(box.id);
      }
    }
  }

  return {
    files,
    descendantTags: [...descendantTags].sort((left, right) => left.localeCompare(right)),
    favoriteCount,
    boxRuleClauseCount,
    affectedBoxCount: affectedBoxes.size,
    filterTagCount,
  };
}

/**
 * Files that carry both the renamed subtree and a tag already at (or under)
 * the rename target — rewriting those notes merges onto existing tags, which
 * the confirm copy must call out. Notes outside the rename never count.
 */
export function countRenameTargetConflicts(app: App, from: string, to: string): number {
  const normalizedFrom = normalizeTagPath(from);
  const normalizedTo = normalizeTagPath(to);
  if (normalizedFrom.length === 0 || normalizedTo.length === 0 || normalizedFrom === normalizedTo) {
    return 0;
  }

  let conflicts = 0;
  for (const file of getVaultMarkdownFiles(app)) {
    const tags = getFileTags(app, file);
    const carriesSource = tags.some((fileTag) => tagPathIsOrUnder(fileTag, normalizedFrom));
    const carriesTarget = tags.some(
      (fileTag) => tagPathIsOrUnder(fileTag, normalizedTo) && !tagPathIsOrUnder(fileTag, normalizedFrom),
    );
    if (carriesSource && carriesTarget) {
      conflicts += 1;
    }
  }
  return conflicts;
}

export interface TagReferenceRewrite {
  favorites: FavoriteEntry[];
  favoritesChanged: boolean;
  filterTags: string[];
  filterChanged: boolean;
  boxes: CardBoxDefinition[];
  boxesChanged: boolean;
}

/**
 * Rewrite plugin-side references for `from` → `to`. Tag favorites and filter
 * tags are prefix-mapped (deduped when the target already exists); box rule tag
 * clauses are prefix-mapped within their rule, deduped the same way. Untouched
 * arrays keep their reference and `changed` stays false.
 */
export function rewriteTagReferencesForRename(
  refs: TagReferenceSnapshot,
  from: string,
  to: string,
): TagReferenceRewrite {
  const normalizedFrom = normalizeTagPath(from);
  const normalizedTo = normalizeTagPath(to);
  if (normalizedFrom.length === 0 || normalizedTo.length === 0 || normalizedFrom === normalizedTo) {
    return {
      favorites: refs.favorites,
      favoritesChanged: false,
      filterTags: refs.filterTags,
      filterChanged: false,
      boxes: refs.boxes,
      boxesChanged: false,
    };
  }

  let favoritesChanged = false;
  const favorites = refs.favorites.map((entry) => {
    if (entry.kind !== "tag") {
      return entry;
    }
    const mappedRef = renameTagPathPrefix(entry.ref, normalizedFrom, normalizedTo);
    return mappedRef === null ? entry : { kind: entry.kind, ref: mappedRef };
  });
  // Two favorites can collide after rename (a/b and c/d with a/b → c/d); keep the first.
  const seenFavoriteRefs = new Set<string>();
  const dedupedFavorites = favorites.filter((entry) => {
    const key = `${entry.kind}\u0000${entry.ref}`;
    if (seenFavoriteRefs.has(key)) {
      return false;
    }
    seenFavoriteRefs.add(key);
    return true;
  });
  favoritesChanged = !favoriteEntriesEqual(dedupedFavorites, refs.favorites);

  let filterChanged = false;
  const seenFilterTags = new Set<string>();
  const filterTags: string[] = [];
  for (const filterTag of refs.filterTags) {
    const mappedTag = renameTagPathPrefix(filterTag, normalizedFrom, normalizedTo) ?? filterTag;
    if (seenFilterTags.has(mappedTag)) {
      continue;
    }
    seenFilterTags.add(mappedTag);
    filterTags.push(mappedTag);
  }
  filterChanged = !stringListsEqual(filterTags, refs.filterTags);

  let boxesChanged = false;
  const boxes = refs.boxes.map((box) => {
    let boxTouched = false;
    const rules = box.rules.map((rule) => {
      if (!rule.tags.some((ruleTag) => tagPathIsOrUnder(ruleTag, normalizedFrom))) {
        return rule;
      }
      boxTouched = true;
      return { ...rule, tags: mapRuleTagsForRename(rule, normalizedFrom, normalizedTo) };
    });
    return boxTouched ? { ...box, rules } : box;
  });
  boxesChanged = boxes.some((box, index) => box !== refs.boxes[index]);

  return {
    favorites: favoritesChanged ? dedupedFavorites : refs.favorites,
    favoritesChanged,
    filterTags: filterChanged ? filterTags : refs.filterTags,
    filterChanged,
    boxes: boxesChanged ? boxes : refs.boxes,
    boxesChanged,
  };
}

function favoriteEntriesEqual(left: FavoriteEntry[], right: FavoriteEntry[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => entry.kind === right[index].kind && entry.ref === right[index].ref);
}

function stringListsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function mapRuleTagsForRename(rule: Rule, normalizedFrom: string, normalizedTo: string): string[] {
  const nextTags: string[] = [];
  for (const ruleTag of rule.tags) {
    const mappedTag = renameTagPathPrefix(ruleTag, normalizedFrom, normalizedTo) ?? ruleTag;
    if (!nextTags.includes(mappedTag)) {
      nextTags.push(mappedTag);
    }
  }
  return nextTags;
}

/**
 * Clean plugin-side references for a deleted tag: tag favorites under the tag
 * are dropped, filter tags are removed, and box rule tag clauses pointing at
 * the tag (or a descendant) are removed from their rule.
 */
export function rewriteTagReferencesForDelete(
  refs: TagReferenceSnapshot,
  tag: string,
): TagReferenceRewrite {
  const normalizedTag = normalizeTagPath(tag);

  const favorites = refs.favorites.filter(
    (entry) => !(entry.kind === "tag" && tagPathIsOrUnder(entry.ref, normalizedTag)),
  );

  const filterTags = refs.filterTags.filter((filterTag) => !tagPathIsOrUnder(filterTag, normalizedTag));

  let boxesChanged = false;
  const boxes = refs.boxes.map((box) => {
    let boxTouched = false;
    const rules = box.rules.map((rule) => {
      const nextTags = rule.tags.filter((ruleTag) => !tagPathIsOrUnder(ruleTag, normalizedTag));
      if (nextTags.length === rule.tags.length) {
        return rule;
      }
      boxTouched = true;
      return { ...rule, tags: nextTags };
    });
    return boxTouched ? { ...box, rules } : box;
  });
  boxesChanged = boxes.some((box, index) => box !== refs.boxes[index]);

  return {
    favorites: favorites.length === refs.favorites.length ? refs.favorites : favorites,
    favoritesChanged: favorites.length !== refs.favorites.length,
    filterTags: filterTags.length === refs.filterTags.length ? refs.filterTags : filterTags,
    filterChanged: filterTags.length !== refs.filterTags.length,
    boxes: boxesChanged ? boxes : refs.boxes,
    boxesChanged,
  };
}
