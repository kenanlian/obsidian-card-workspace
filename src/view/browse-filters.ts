import type { PropertyStrings } from "../i18n";
import type { PartialPluginSettings, PluginSettings } from "../settings";
import {
  propertyScalarRefsEqual,
  serializePropertyScalarRef,
  type PropertyScalarRef,
} from "../property-filter-settings";
import type { PropertyFacet } from "./property-facets";
import { buildPropertyScalarLabel, resolvePropertyScalarLabels } from "./property-metadata";
import type { SourceCapabilities } from "./source-capabilities";

export type BrowseFilterTarget =
  | { kind: "tag"; tag: string }
  | { kind: "property"; key: string; ref: PropertyScalarRef };

export interface BrowseFilterChip {
  id: string;
  label: string;
  property?: { name: string; value: string };
  target: BrowseFilterTarget;
}

/** Presentation of effective filters only; labels reuse the navigation facets. */
export function buildBrowseFilterChips(
  filter: PluginSettings["filter"],
  capabilities: SourceCapabilities,
  facets: readonly PropertyFacet[],
  strings: PropertyStrings,
): BrowseFilterChip[] {
  const chips: BrowseFilterChip[] = capabilities.browseTagFilter
    ? filter.tags.map((tag) => ({ id: JSON.stringify(["tag", tag]), label: tag, target: { kind: "tag", tag } }))
    : [];
  if (!capabilities.browsePropertyFilter) return chips;
  const facetsByKey = new Map(facets.map((facet) => [facet.key, facet]));
  for (const clause of filter.properties) {
    const facet = facetsByKey.get(clause.key);
    const labels = facet
      ? new Map(facet.values.map((value) => [serializePropertyScalarRef(value.ref), value.label]))
      : resolvePropertyScalarLabels(clause.values, strings);
    for (const ref of clause.values) {
      const identity = serializePropertyScalarRef(ref);
      const name = facet?.label ?? clause.key;
      const value = labels.get(identity) ?? buildPropertyScalarLabel(ref, strings);
      chips.push({
        id: JSON.stringify(["property", clause.key, identity]),
        label: `${name}: ${value}`,
        property: { name, value },
        target: { kind: "property", key: clause.key, ref },
      });
    }
  }
  return chips;
}

/** Removal is idempotent and preserves every other filter, including the other lane. */
export function buildBrowseFilterRemovalPatch(
  filter: PluginSettings["filter"],
  target: BrowseFilterTarget,
  capabilities: SourceCapabilities,
): PartialPluginSettings | null {
  if (target.kind === "tag") {
    if (!capabilities.browseTagFilter || !filter.tags.includes(target.tag)) return null;
    return { filter: { tags: filter.tags.filter((tag) => tag !== target.tag) } };
  }
  if (!capabilities.browsePropertyFilter || !filter.properties.some((clause) =>
    clause.key === target.key && clause.values.some((ref) => propertyScalarRefsEqual(ref, target.ref)))) return null;
  const properties = filter.properties.map((clause) => clause.key === target.key
    ? { ...clause, values: clause.values.filter((ref) => !propertyScalarRefsEqual(ref, target.ref)) }
    : clause).filter((clause) => clause.values.length > 0);
  return { filter: { properties } };
}
