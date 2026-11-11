import type { PropertyStrings, ToolbarStrings } from "../i18n";
import type { PropertyFilterClause } from "../property-filter-settings";
import type { PanelScopeState } from "./panel-model";
import { buildPropertyScalarLabel } from "./property-metadata";

export interface ScopeLabelInput {
  scope: Pick<PanelScopeState, "displayPath" | "activeBoxId" | "activeBoxName" | "linksDirection" | "linksLabel">;
  activeFilterTags: readonly string[];
  strings: ToolbarStrings;
}

function formatTags(tags: readonly string[]): string {
  return tags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(", ");
}

function buildSourceLabel(input: ScopeLabelInput, variant: "name" | "full"): string {
  const { scope, strings } = input;
  if (scope.linksDirection != null) return scope.linksLabel ?? "";
  if (scope.activeBoxId !== null) return scope.activeBoxName ?? "";
  const path = scope.displayPath;
  if (path === "/" || path === "") return strings.folderMenu.rootFolder;
  return variant === "name" ? (path.split("/").pop() ?? path) : path;
}

/** Toolbar source label, without browse filters. `full` shows the folder's vault path. */
export function buildScopeLabel(input: ScopeLabelInput, variant: "name" | "full"): string {
  return buildSourceLabel(input, variant);
}

export interface ScopeTitleInput extends ScopeLabelInput {
  scope: ScopeLabelInput["scope"] & Pick<PanelScopeState, "browseTagFilterEnabled" | "browsePropertyFilterEnabled">;
  propertyFilters: readonly PropertyFilterClause[];
  propertyStrings: PropertyStrings;
}

/** Phone header title: the source plus every browse filter that applies to it. */
export function buildScopeTitle(input: ScopeTitleInput): string {
  const { scope, activeFilterTags, propertyFilters, strings, propertyStrings } = input;
  const parts = [buildSourceLabel(input, "name")];
  if (scope.browseTagFilterEnabled && activeFilterTags.length > 0) parts.push(formatTags(activeFilterTags));
  if (scope.browsePropertyFilterEnabled) {
    for (const clause of propertyFilters) {
      parts.push(`${clause.key}: ${clause.values.map((ref) => buildPropertyScalarLabel(ref, propertyStrings)).join(", ")}`);
    }
  }
  return parts.filter((part) => part.length > 0).join(strings.scope.separator);
}
