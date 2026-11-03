import type { PartialPluginSettings } from "../../settings";
import type { NavSectionId } from "../types";
import { pruneHiddenNavigationTree } from "../../navigation-visibility";
import { normalizeScopePath } from "../scope";
import { normalizeTagPath } from "../tag-tree";
import type { NavigationProjectionInput } from "../navigation-model";
import { collectExpandablePropertyKeys } from "../property-navigation-projection";
import { collectExpandableTagPaths } from "../tag-tree";
import type { ViewContext } from "../view-context";
import { collectExpandableFolderPaths } from "./nav-folder-tree";

export type NavigationBranchKind = "folder" | "tag" | "property";

export interface NavigationExpansionState {
  expandable: Record<NavigationBranchKind, string[]>;
  revealFolders: Set<string>;
  suppressedFolders: Set<string>;
  queryFolders: Set<string>;
  queryTags: Set<string>;
  querySuppressedFolders: Set<string>;
  querySuppressedTags: Set<string>;
  querySuppressedProperties: Set<string>;
}

export function createNavigationExpansionState(): NavigationExpansionState {
  return {
    expandable: { folder: [], tag: [], property: [] },
    revealFolders: new Set(), suppressedFolders: new Set(),
    queryFolders: new Set(), queryTags: new Set(),
    querySuppressedFolders: new Set(), querySuppressedTags: new Set(),
    querySuppressedProperties: new Set(),
  };
}

export function captureExpandableNavigationBranches(
  state: NavigationExpansionState,
  input: Pick<NavigationProjectionInput, "folders" | "tags" | "properties" | "hiddenFolderPaths" | "hiddenTagPaths">,
): void {
  state.expandable = {
    folder: collectExpandableFolderPaths(pruneHiddenNavigationTree(input.folders, input.hiddenFolderPaths ?? [], (node) => normalizeScopePath(node.path))),
    tag: collectExpandableTagPaths(pruneHiddenNavigationTree(input.tags, input.hiddenTagPaths ?? [], (node) => normalizeTagPath(node.tag))),
    property: collectExpandablePropertyKeys(input.properties ?? []),
  };
}

export async function applyNavigationExpansionBatch(input: {
  kinds: readonly NavigationBranchKind[];
  collapse: boolean;
  querying: boolean;
  sectionCollapsed?: Partial<Record<NavSectionId, boolean>>;
  state: NavigationExpansionState;
  context: Pick<ViewContext, "getSettings" | "saveSettings" | "publishGroups">;
  onPropertyCollapse: () => void;
}): Promise<void> {
  const { kinds, collapse, querying, state, context } = input;
  if (!input.sectionCollapsed && kinds.every((kind) => state.expandable[kind].length === 0)) return;
  const expanded = !collapse;
  const settings = context.getSettings();
  const patch: PartialPluginSettings = {};
  if (input.sectionCollapsed && Object.entries(input.sectionCollapsed).some(
    ([section, value]) => settings.sectionCollapsed[section as NavSectionId] !== value,
  )) patch.sectionCollapsed = input.sectionCollapsed;

  for (const kind of kinds) {
    const identities = state.expandable[kind];
    if (querying) {
      const target = kind === "folder" ? state.queryFolders : kind === "tag" ? state.queryTags : null;
      const suppressed = kind === "folder"
        ? state.querySuppressedFolders
        : kind === "tag" ? state.querySuppressedTags : state.querySuppressedProperties;
      for (const identity of identities) {
        if (expanded) { target?.add(identity); suppressed.delete(identity); }
        else { target?.delete(identity); suppressed.add(identity); }
      }
    } else {
      if (kind === "folder") {
        if (collapse) state.revealFolders.clear();
        for (const identity of identities) {
          if (expanded) state.suppressedFolders.delete(identity);
          else state.suppressedFolders.add(identity);
        }
      }
      const key = kind === "folder"
        ? "expandedFolderPaths"
        : kind === "tag" ? "expandedTagPaths" : "expandedPropertyKeys";
      const next = new Set(settings[key]);
      for (const identity of identities) {
        if (expanded) next.add(identity);
        else next.delete(identity);
      }
      const nextValues = [...next].sort();
      if (nextValues.length !== settings[key].length
        || nextValues.some((value, index) => value !== settings[key][index])) patch[key] = nextValues;
    }
    if (kind === "property" && collapse) input.onPropertyCollapse();
  }

  if (querying || Object.keys(patch).length === 0) context.publishGroups("nav");
  else await context.saveSettings(patch);
}

export function clearNavigationExpansionState(state: NavigationExpansionState): void {
  state.expandable = { folder: [], tag: [], property: [] };
  state.revealFolders.clear(); state.suppressedFolders.clear();
  state.queryFolders.clear(); state.queryTags.clear();
  state.querySuppressedFolders.clear(); state.querySuppressedTags.clear();
  state.querySuppressedProperties.clear();
}
