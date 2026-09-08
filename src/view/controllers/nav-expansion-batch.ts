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
  input: Pick<NavigationProjectionInput, "folders" | "tags" | "properties">,
): void {
  state.expandable = {
    folder: collectExpandableFolderPaths(input.folders),
    tag: collectExpandableTagPaths(input.tags),
    property: collectExpandablePropertyKeys(input.properties ?? []),
  };
}

export async function applyNavigationExpansionBatch(input: {
  kind: NavigationBranchKind;
  collapse: boolean;
  querying: boolean;
  state: NavigationExpansionState;
  context: Pick<ViewContext, "getSettings" | "saveSettings" | "publishGroups">;
  onPropertyCollapse: () => void;
}): Promise<void> {
  const { kind, collapse, querying, state, context } = input;
  const identities = state.expandable[kind];
  if (identities.length === 0) return;
  const expanded = !collapse;

  if (querying) {
    const target = kind === "folder" ? state.queryFolders : kind === "tag" ? state.queryTags : null;
    const suppressed = kind === "folder"
      ? state.querySuppressedFolders
      : kind === "tag" ? state.querySuppressedTags : state.querySuppressedProperties;
    for (const identity of identities) {
      if (expanded) { target?.add(identity); suppressed.delete(identity); }
      else { target?.delete(identity); suppressed.add(identity); }
    }
    if (kind === "property" && collapse) input.onPropertyCollapse();
    context.publishGroups("nav");
    return;
  }

  if (kind === "folder") {
    if (collapse) state.revealFolders.clear();
    for (const identity of identities) {
      if (expanded) state.suppressedFolders.delete(identity);
      else state.suppressedFolders.add(identity);
    }
  }
  if (kind === "property" && collapse) input.onPropertyCollapse();

  const settings = context.getSettings();
  const key = kind === "folder"
    ? "expandedFolderPaths"
    : kind === "tag" ? "expandedTagPaths" : "expandedPropertyKeys";
  const next = new Set(settings[key]);
  for (const identity of identities) {
    if (expanded) next.add(identity);
    else next.delete(identity);
  }
  const nextValues = [...next].sort();
  const unchanged = nextValues.length === settings[key].length
    && nextValues.every((value, index) => value === settings[key][index]);
  if (unchanged) context.publishGroups("nav");
  else await context.saveSettings({ [key]: nextValues });
}

export function clearNavigationExpansionState(state: NavigationExpansionState): void {
  state.expandable = { folder: [], tag: [], property: [] };
  state.revealFolders.clear(); state.suppressedFolders.clear();
  state.queryFolders.clear(); state.queryTags.clear();
  state.querySuppressedFolders.clear(); state.querySuppressedTags.clear();
  state.querySuppressedProperties.clear();
}
