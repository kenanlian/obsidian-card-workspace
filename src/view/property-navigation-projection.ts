import {
  normalizePropertyScalarRef,
  serializePropertyScalarRef,
  type PropertyFilterClause,
} from "../property-filter-settings";
import type { PropertyFacet, PropertyValueFacet } from "./property-facets";
import {
  navigationPropertyId,
  navigationPropertyValueId,
  navigationSectionId,
  type NavigationExpansionLayer,
  type NavigationPropertyRow,
  type NavigationPropertyValueRow,
} from "./navigation-model";

/**
 * Property navigation projection (C7/C8).
 *
 * Extracted from `navigation-projection.ts` to keep that module under its line
 * budget. Consumes an immutable `PropertyFacet[]` snapshot plus active clauses
 * and emits the flat property key/value rows for the Properties section. Rows
 * are returned with zeroed set metadata; the caller assigns positions with the
 * shared `assignSetMetadata` helper so property rows participate in the same
 * set-position model as every other section.
 */

export interface PropertyProjectionResult {
  rows: (NavigationPropertyRow | NavigationPropertyValueRow)[];
  /** Enabled keys retained for the current query (all enabled keys when blank). */
  matchedItemCount: number;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function matches(needle: string, ...candidates: string[]): boolean {
  return candidates.some((candidate) => candidate.toLowerCase().includes(needle));
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

function isPropertyFacet(value: unknown): value is PropertyFacet {
  return typeof value === "object" && value !== null
    && typeof (value as PropertyFacet).key === "string"
    && (value as PropertyFacet).key.length > 0;
}

function validValueFacet(value: unknown): value is PropertyValueFacet {
  if (typeof value !== "object" || value === null) return false;
  const facet = value as PropertyValueFacet;
  return normalizePropertyScalarRef(facet.ref) !== null && typeof facet.label === "string";
}

export function projectPropertyRows(
  facets: readonly PropertyFacet[],
  clauses: readonly PropertyFilterClause[],
  needle: string,
  expansion: NavigationExpansionLayer,
): PropertyProjectionResult {
  const querying = needle.length > 0;

  // Active refs per key drive value-row checked state.
  const activeRefsByKey = new Map<string, Set<string>>();
  for (const clause of clauses) {
    const key = typeof clause?.key === "string" ? clause.key : "";
    if (key.length === 0 || !Array.isArray(clause?.values)) continue;
    const set = activeRefsByKey.get(key) ?? new Set<string>();
    for (const ref of clause.values) {
      const normalized = normalizePropertyScalarRef(ref);
      if (normalized !== null) set.add(serializePropertyScalarRef(normalized));
    }
    activeRefsByKey.set(key, set);
  }

  const expandedKeys = buildExpansionSet(expansion, querying);
  const rows: (NavigationPropertyRow | NavigationPropertyValueRow)[] = [];

  for (const facet of Array.isArray(facets) ? facets : []) {
    if (!isPropertyFacet(facet)) continue;
    const key = facet.key;

    // Query matches enabled key labels and projected value labels only.
    const keyMatches = !querying || matches(needle, facet.label ?? key, key);
    const sourceValues = Array.isArray(facet.values) ? facet.values : [];
    const matchedValues = querying
      ? sourceValues.filter((value) => validValueFacet(value) && matches(needle, value.label))
      : sourceValues.filter(validValueFacet);
    if (querying && !keyMatches && matchedValues.length === 0) continue;

    const valueRows: NavigationPropertyValueRow[] = [];
    for (const valueFacet of matchedValues) {
      const ref = normalizePropertyScalarRef(valueFacet.ref);
      if (ref === null) continue;
      const checked = activeRefsByKey.get(key)?.has(serializePropertyScalarRef(ref)) === true;
      valueRows.push({
        id: navigationPropertyValueId(key, ref),
        kind: "property-value",
        section: "properties",
        parentId: navigationPropertyId(key),
        level: 3,
        positionInSet: 0,
        setSize: 0,
        expandable: false,
        expanded: false,
        disabled: false,
        semanticState: checked ? "checked-filter" : "none",
        label: valueFacet.label,
        fullPath: null,
        count: count(valueFacet.count),
        icon: "dot",
        menuTarget: { section: "properties", scope: "item", itemId: key, value: ref },
        propertyKey: key,
        value: ref,
      });
    }

    const expandable = valueRows.length > 0;
    // A value match auto-expands its key to the matching values.
    const autoExpanded = querying && matchedValues.length > 0;
    const expanded = expandable
      && !isSuppressed(expansion, key)
      && (expandedKeys.has(key) || autoExpanded);

    rows.push({
      id: navigationPropertyId(key),
      kind: "property",
      section: "properties",
      parentId: navigationSectionId("properties"),
      level: 2,
      positionInSet: 0,
      setSize: 0,
      expandable,
      expanded,
      disabled: false,
      semanticState: "none",
      label: typeof facet.label === "string" && facet.label.length > 0 ? facet.label : key,
      fullPath: null,
      count: count(facet.valuedCount),
      icon: "list",
      menuTarget: { section: "properties", scope: "item", itemId: key },
      propertyKey: key,
    });
    if (expanded) rows.push(...valueRows);
  }

  return {
    rows,
    matchedItemCount: rows.filter((row) => row.kind === "property").length,
  };
}
