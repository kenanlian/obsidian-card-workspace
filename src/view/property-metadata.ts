import type { App, CachedMetadata, TFile } from "obsidian";
import type { PropertyStrings } from "../i18n";
import {
  normalizePropertyKey,
  serializePropertyScalarRef,
  type PropertyFilterClause,
  type PropertyInventorySnapshot,
  type PropertyScalarRef,
} from "../property-filter-settings";
import { isMarkdownCardKind } from "./file-kind";
import type { NoteCardRecord } from "./types";

/**
 * Property metadata extraction, matching, inventory, and display labels (C3).
 *
 * Frontmatter is the only metadata source. No body reads, no recursion into
 * nested objects to invent dotted keys, no inferred date/link types. Scalar
 * identity is type-sensitive via the WP-01 serializer.
 */

/** Reads cached frontmatter for a file; `null` means unusable/absent. */
export type PropertyFrontmatterAccessor = (file: TFile) => Record<string, unknown> | null;

export interface PropertyKeyExtraction {
  /** Normalized identity (trimmed, lowercase, never the `position` sentinel). */
  key: string;
  /** Lexicographically smallest observed raw spelling (trimmed). */
  label: string;
  /** Distinct supported scalar values, deduped by serialized identity. */
  values: PropertyScalarRef[];
}

function addScalar(out: Map<string, PropertyScalarRef>, ref: PropertyScalarRef): void {
  const identity = serializePropertyScalarRef(ref);
  if (!out.has(identity)) {
    out.set(identity, ref);
  }
}

/** Collects supported scalars from one raw frontmatter value; arrays recurse. */
function collectScalarRefs(value: unknown, out: Map<string, PropertyScalarRef>): void {
  if (typeof value === "string") {
    // Whitespace-only strings are unsupported; everything else keeps the exact
    // parsed value for identity and case-sensitive matching.
    if (value.trim().length > 0) {
      addScalar(out, { kind: "text", value });
    }
    return;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      addScalar(out, { kind: "number", value });
    }
    return;
  }
  if (typeof value === "boolean") {
    addScalar(out, { kind: "boolean", value });
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectScalarRefs(entry, out);
    }
  }
  // null, undefined, objects, maps and other shapes contribute no scalar.
}

/**
 * Extracts per-key scalar sets from one file's frontmatter.
 *
 * Top-level own enumerable keys only. Raw keys that normalize to the same
 * identity union their supported scalars and keep the lexicographically
 * smallest trimmed raw spelling as the display candidate. A key whose union
 * is empty still appears (with `values: []`) so callers can apply `missing`
 * semantics without a second lookup.
 */
export function extractPropertyScalars(
  frontmatter: Record<string, unknown> | null,
): PropertyKeyExtraction[] {
  if (frontmatter === null) {
    return [];
  }
  const byKey = new Map<string, { label: string; values: Map<string, PropertyScalarRef> }>();
  for (const rawKey of Object.keys(frontmatter)) {
    const key = normalizePropertyKey(rawKey);
    if (key === null) {
      continue;
    }
    const spelling = rawKey.trim();
    let entry = byKey.get(key);
    if (entry === undefined) {
      entry = { label: spelling, values: new Map() };
      byKey.set(key, entry);
    } else if (spelling < entry.label) {
      entry.label = spelling;
    }
    collectScalarRefs(frontmatter[rawKey], entry.values);
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => ({ key, label: entry.label, values: [...entry.values.values()] }));
}

/**
 * Pure single-file predicate for normalized property clauses.
 *
 * Clauses combine with AND; values within one clause combine with OR;
 * `missing` matches a key with no supported scalar. Non-Markdown files have
 * no scalar values, so they match only when every clause includes `missing`,
 * and `frontmatter` is ignored for them. Clause keys are expected normalized
 * (settings persist them that way); callers pass clauses through
 * `normalizePropertyFilterClauses` first.
 */
export function matchesPropertyClauses(
  clauses: readonly PropertyFilterClause[],
  isMarkdown: boolean,
  frontmatter: Record<string, unknown> | null,
): boolean {
  if (!isMarkdown) {
    return clauses.every((clause) =>
      clause.values.some((ref) => ref.kind === "missing"));
  }

  const extracted = extractPropertyScalars(frontmatter);
  const identitiesByKey = new Map<string, Set<string>>(
    extracted.map((entry) => [
      entry.key,
      new Set(entry.values.map(serializePropertyScalarRef)),
    ]),
  );

  return clauses.every((clause) => {
    const present = identitiesByKey.get(clause.key);
    return clause.values.some((ref) =>
      ref.kind === "missing"
        ? present === undefined || present.size === 0
        : present?.has(serializePropertyScalarRef(ref)) === true);
  });
}

/**
 * Filters card records by normalized property clauses.
 *
 * Per-card semantics live in `matchesPropertyClauses`; the accessor is never
 * consulted for non-Markdown cards.
 */
export function matchesPropertyFilters(
  cards: readonly NoteCardRecord[],
  clauses: readonly PropertyFilterClause[],
  getFrontmatter: PropertyFrontmatterAccessor,
): NoteCardRecord[] {
  if (clauses.length === 0) {
    return [...cards];
  }

  return cards.filter((card) => {
    const isMarkdown = isMarkdownCardKind(card.fileKind);
    return matchesPropertyClauses(
      clauses,
      isMarkdown,
      isMarkdown ? getFrontmatter(card.file) : null,
    );
  });
}

/**
 * Base display label for one scalar ref: text verbatim, finite numbers via
 * `String(value)`, localized boolean and unassigned labels.
 */
export function buildPropertyScalarLabel(
  ref: PropertyScalarRef,
  strings: PropertyStrings,
): string {
  switch (ref.kind) {
    case "text":
      return ref.value;
    case "number":
      return String(ref.value);
    case "boolean":
      return ref.value ? strings.valueTrue : strings.valueFalse;
    case "missing":
      return strings.valueUnassigned;
  }
}

function propertyTypeLabel(
  kind: PropertyScalarRef["kind"],
  strings: PropertyStrings,
): string | null {
  switch (kind) {
    case "text":
      return strings.typeText;
    case "number":
      return strings.typeNumber;
    case "boolean":
      return strings.typeBoolean;
    case "missing":
      return null;
  }
}

/**
 * Resolves display labels for a set of refs, keyed by serialized identity.
 *
 * When two refs under one key render to the same base label, each colliding
 * row gains a localized type qualifier (`label (Text)`) so both stay
 * distinguishable. `missing` has no type qualifier; a colliding text row still
 * gets qualified, which keeps the rows apart.
 */
export function resolvePropertyScalarLabels(
  refs: readonly PropertyScalarRef[],
  strings: PropertyStrings,
): ReadonlyMap<string, string> {
  const groups = new Map<string, number>();
  const baseLabels = new Map<string, string>();
  for (const ref of refs) {
    const identity = serializePropertyScalarRef(ref);
    const base = buildPropertyScalarLabel(ref, strings);
    baseLabels.set(identity, base);
    groups.set(base, (groups.get(base) ?? 0) + 1);
  }

  const labels = new Map<string, string>();
  for (const ref of refs) {
    const identity = serializePropertyScalarRef(ref);
    const base = baseLabels.get(identity) ?? buildPropertyScalarLabel(ref, strings);
    const qualifier =
      (groups.get(base) ?? 0) > 1 ? propertyTypeLabel(ref.kind, strings) : null;
    labels.set(identity, qualifier === null ? base : `${base} (${qualifier})`);
  }
  return labels;
}

/**
 * Vault-wide property-key inventory for the chooser.
 *
 * Scans `vault.getMarkdownFiles()` and `metadataCache.getFileCache(file)
 * ?.frontmatter` only — never `vault.read()`/`cachedRead()` and never
 * Base/Canvas/Excalidraw contents. Status:
 * - `unavailable`: vault or metadata APIs are missing/unusable.
 * - `partial`: a non-empty Markdown file list where at least one file has a
 *   null cache; options still reflect every available cache.
 * - `ready`: everything else, including an empty Markdown vault (`ready` with
 *   `[]` uniquely means "no properties found").
 */
export function collectPropertyInventory(app: App): PropertyInventorySnapshot {
  const metadataCache = app.metadataCache as { getFileCache?: unknown } | undefined;
  if (typeof metadataCache?.getFileCache !== "function") {
    return { status: "unavailable", options: [] };
  }
  const getMarkdownFiles = app.vault?.getMarkdownFiles as (() => TFile[]) | undefined;
  if (typeof getMarkdownFiles !== "function") {
    return { status: "unavailable", options: [] };
  }
  const getFileCache = metadataCache.getFileCache.bind(metadataCache) as (
    file: TFile,
  ) => CachedMetadata | null;

  const files = getMarkdownFiles.call(app.vault);
  let sawMissingCache = false;
  const labelByKey = new Map<string, string>();
  for (const file of files) {
    const cache = getFileCache(file);
    if (cache === null || cache === undefined) {
      sawMissingCache = true;
      continue;
    }
    const frontmatter = cache.frontmatter as Record<string, unknown> | undefined;
    if (frontmatter === undefined || frontmatter === null) {
      continue;
    }
    for (const extraction of extractPropertyScalars(frontmatter)) {
      const current = labelByKey.get(extraction.key);
      if (current === undefined || extraction.label < current) {
        labelByKey.set(extraction.key, extraction.label);
      }
    }
  }

  const options = [...labelByKey.entries()]
    .map(([key, label]) => ({ key, label, available: true }))
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) || (left.key < right.key ? -1 : 1),
    );

  return {
    status: files.length > 0 && sawMissingCache ? "partial" : "ready",
    options,
  };
}
