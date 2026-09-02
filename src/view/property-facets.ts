import type { PropertyStrings } from "../i18n";
import {
  normalizePropertyKey,
  serializePropertyScalarRef,
  type PropertyFilterClause,
  type PropertyScalarRef,
} from "../property-filter-settings";
import { isMarkdownCardKind } from "./file-kind";
import {
  buildPropertyScalarLabel,
  extractPropertyScalars,
  resolvePropertyScalarLabels,
  type PropertyFrontmatterAccessor,
} from "./property-metadata";
import type { NoteCardRecord } from "./types";

/**
 * Facet aggregation over base cards (C4).
 *
 * Facets always derive from the supplied base cards, never from visible or
 * filtered cards, so selecting a value never erases sibling choices or their
 * counts.
 */

export interface PropertyValueFacet {
  ref: PropertyScalarRef;
  label: string;
  count: number;
}

export interface PropertyFacet {
  /** Normalized key identity. */
  key: string;
  /** Lexicographically smallest observed raw key spelling; falls back to the key. */
  label: string;
  /** Base cards with at least one supported scalar for this key. */
  valuedCount: number;
  /** Base cards with no supported scalar for this key. */
  missingCount: number;
  /** Scalar rows sorted by label then identity; the missing row is always last. */
  values: PropertyValueFacet[];
}

interface PropertyKeyAggregate {
  label: string | null;
  valuedCount: number;
  missingCount: number;
  counts: Map<string, { ref: PropertyScalarRef; count: number }>;
}

function collectAggregates(
  cards: readonly NoteCardRecord[],
  keys: readonly string[],
  getFrontmatter: PropertyFrontmatterAccessor,
): Map<string, PropertyKeyAggregate> {
  const aggregates = new Map<string, PropertyKeyAggregate>(
    keys.map((key) => [key, { label: null, valuedCount: 0, missingCount: 0, counts: new Map() }]),
  );

  for (const card of cards) {
    // Non-Markdown cards have no scalar values; they are missing for every key.
    const extracted = isMarkdownCardKind(card.fileKind)
      ? extractPropertyScalars(getFrontmatter(card.file))
      : [];
    const byKey = new Map(extracted.map((entry) => [entry.key, entry]));

    for (const key of keys) {
      const aggregate = aggregates.get(key);
      if (aggregate === undefined) {
        continue;
      }
      const extraction = byKey.get(key);
      if (
        extraction !== undefined &&
        (aggregate.label === null || extraction.label < aggregate.label)
      ) {
        aggregate.label = extraction.label;
      }

      const values = extraction?.values ?? [];
      if (values.length === 0) {
        aggregate.missingCount += 1;
        continue;
      }
      aggregate.valuedCount += 1;
      // A multi-valued note increments each distinct value exactly once;
      // `extractPropertyScalars` already deduped within the note.
      for (const ref of values) {
        const identity = serializePropertyScalarRef(ref);
        const entry = aggregate.counts.get(identity);
        if (entry !== undefined) {
          entry.count += 1;
        } else {
          aggregate.counts.set(identity, { ref, count: 1 });
        }
      }
    }
  }

  return aggregates;
}

/**
 * Builds one facet per enabled key, even when the current source never
 * contains that key.
 *
 * - An active scalar that disappeared from the source stays visible with
 *   count 0 so the active filter remains removable.
 * - The missing row appears whenever missingCount > 0 or missing is actively
 *   selected, and always sorts last.
 */
export function buildPropertyFacets(
  cards: readonly NoteCardRecord[],
  enabledKeys: readonly string[],
  activeClauses: readonly PropertyFilterClause[],
  getFrontmatter: PropertyFrontmatterAccessor,
  strings: PropertyStrings,
): PropertyFacet[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const raw of enabledKeys) {
    const key = normalizePropertyKey(raw);
    if (key !== null && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  keys.sort((left, right) => left.localeCompare(right));

  const aggregates = collectAggregates(cards, keys, getFrontmatter);

  return keys.map((key) => {
    const aggregate = aggregates.get(key);
    const rows = new Map<string, { ref: PropertyScalarRef; count: number }>();
    for (const [identity, entry] of aggregate?.counts ?? []) {
      rows.set(identity, { ref: entry.ref, count: entry.count });
    }

    const clause = activeClauses.find((candidate) => candidate.key === key);
    const activeRefs = clause?.values ?? [];
    for (const ref of activeRefs) {
      if (ref.kind === "missing") {
        continue;
      }
      const identity = serializePropertyScalarRef(ref);
      if (!rows.has(identity)) {
        rows.set(identity, { ref, count: 0 });
      }
    }

    const refs = [...rows.values()].map((row) => row.ref);
    const missingCount = aggregate?.missingCount ?? 0;
    const missingSelected = activeRefs.some((ref) => ref.kind === "missing");
    const emitMissing = missingCount > 0 || missingSelected;
    // The missing row joins label resolution so a text value that renders the
    // same as the Unassigned label still gains a type qualifier; the missing
    // row itself stays bare (it has no type qualifier).
    const missingRef: PropertyScalarRef = { kind: "missing" };
    const labels = resolvePropertyScalarLabels(
      emitMissing ? [...refs, missingRef] : refs,
      strings,
    );
    const values: PropertyValueFacet[] = [...rows.entries()]
      .map(([identity, row]) => ({
        ref: row.ref,
        label: labels.get(identity) ?? buildPropertyScalarLabel(row.ref, strings),
        count: row.count,
      }))
      .sort((left, right) => {
        const byLabel = left.label.localeCompare(right.label);
        if (byLabel !== 0) {
          return byLabel;
        }
        const leftId = serializePropertyScalarRef(left.ref);
        const rightId = serializePropertyScalarRef(right.ref);
        return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
      });

    if (emitMissing) {
      values.push({
        ref: missingRef,
        label: labels.get(serializePropertyScalarRef(missingRef)) ?? strings.valueUnassigned,
        count: missingCount,
      });
    }

    return {
      key,
      label: aggregate?.label ?? key,
      valuedCount: aggregate?.valuedCount ?? 0,
      missingCount,
      values,
    };
  });
}
