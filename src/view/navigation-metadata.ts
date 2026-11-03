import type { PropertyStrings } from "../i18n";
import { serializePropertyScalarRef } from "../property-filter-settings";
import type { NavigationMetadataSnapshot } from "../services/NavigationMetadataCatalog";
import type { PropertyFacet } from "./property-facets";
import { resolvePropertyScalarLabels } from "./property-metadata";

/** Union stable vault identities with scope counts; never feed this into card projection. */
export function mergeNavigationPropertyFacets(
  facets: readonly PropertyFacet[],
  catalog: NavigationMetadataSnapshot | undefined,
  strings: PropertyStrings,
): PropertyFacet[] {
  return facets.map(facet => {
    const known = catalog?.properties.find(entry => entry.key === facet.key);
    if (!known) return facet;
    const byId = new Map(facet.values.map(value => [serializePropertyScalarRef(value.ref), value]));
    for (const ref of known.values) {
      const id = serializePropertyScalarRef(ref);
      if (!byId.has(id)) byId.set(id, { ref, label: "", count: 0 });
    }
    const values = [...byId.values()];
    const labels = resolvePropertyScalarLabels(values.map(value => value.ref), strings);
    return {
      ...facet, label: known.label,
      values: values.map(value => ({ ...value, label: labels.get(serializePropertyScalarRef(value.ref)) ?? value.label })),
    };
  });
}
