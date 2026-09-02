/**
 * Property filter settings/domain contracts (C1–C3, C6).
 *
 * Owns persisted property identities and their normalization:
 * - `PropertyScalarRef` type-sensitive value identity (text/number/boolean/missing)
 * - normalized, deduplicated, sorted clause/visible-key/expansion shapes
 * - the pure C6 selection resolver consumed by chooser/actions
 *
 * Metadata extraction and facet aggregation live in view-layer modules; this
 * module performs no vault or metadata access.
 */
export type PropertyScalarRef =
  | { kind: "text"; value: string }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "missing" };

export interface PropertyFilterClause {
  /** Trimmed, lowercase top-level frontmatter-key identity. */
  key: string;
  /** Non-empty, normalized, duplicate-free stable order. */
  values: PropertyScalarRef[];
}

export interface PropertyKeyOption {
  key: string;
  label: string;
  available: boolean;
}

export interface PropertyInventorySnapshot {
  status: "ready" | "partial" | "unavailable";
  options: PropertyKeyOption[];
}

/** Metadata-cache sentinel key that must never surface as a property identity. */
const METADATA_POSITION_KEY = "position";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Normalizes a raw frontmatter/settings key to its identity: trimmed,
 * lowercased, non-empty, never the metadata-cache `position` sentinel.
 */
export function normalizePropertyKey(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const identity = raw.trim().toLowerCase();
  if (identity.length === 0 || identity === METADATA_POSITION_KEY) {
    return null;
  }
  return identity;
}

/**
 * Type-sensitive serialized identity. JSON tuple encoding keeps arbitrary
 * Unicode, punctuation, and delimiter-like text collision-free, and text "1",
 * number 1, boolean true, and missing never collide.
 */
export function serializePropertyScalarRef(ref: PropertyScalarRef): string {
  switch (ref.kind) {
    case "text":
      return JSON.stringify(["t", ref.value]);
    case "number":
      return JSON.stringify(["n", ref.value]);
    case "boolean":
      return JSON.stringify(["b", ref.value]);
    case "missing":
      return JSON.stringify(["m"]);
  }
}

export function propertyScalarRefsEqual(a: PropertyScalarRef, b: PropertyScalarRef): boolean {
  return serializePropertyScalarRef(a) === serializePropertyScalarRef(b);
}

export function comparePropertyScalarRefs(a: PropertyScalarRef, b: PropertyScalarRef): number {
  const left = serializePropertyScalarRef(a);
  const right = serializePropertyScalarRef(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Parses one persisted scalar ref; malformed discriminants and non-finite numbers drop out. */
export function normalizePropertyScalarRef(value: unknown): PropertyScalarRef | null {
  if (!isRecord(value)) {
    return null;
  }
  switch (value.kind) {
    case "text":
      return typeof value.value === "string" ? { kind: "text", value: value.value } : null;
    case "number":
      return typeof value.value === "number" && Number.isFinite(value.value)
        ? { kind: "number", value: value.value }
        : null;
    case "boolean":
      return typeof value.value === "boolean" ? { kind: "boolean", value: value.value } : null;
    case "missing":
      return { kind: "missing" };
    default:
      return null;
  }
}

/** Normalizes a persisted value list: drops malformed entries, dedupes and sorts by identity. */
export function normalizePropertyScalarRefs(value: unknown): PropertyScalarRef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: PropertyScalarRef[] = [];
  for (const entry of value) {
    const ref = normalizePropertyScalarRef(entry);
    if (ref === null) {
      continue;
    }
    const identity = serializePropertyScalarRef(ref);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    result.push(ref);
  }
  return result.sort(comparePropertyScalarRefs);
}

/**
 * Normalizes persisted/merged clauses: valid keys, non-empty deduplicated
 * values, unique keys (duplicates merge their value unions in first-occurrence
 * order), and — when `visibleKeys` is given — only keys still visible survive,
 * so no active clause can outlive a hidden key.
 */
export function normalizePropertyFilterClauses(
  value: unknown,
  visibleKeys?: ReadonlySet<string>,
): PropertyFilterClause[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const byKey = new Map<string, PropertyScalarRef[]>();
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const key = normalizePropertyKey(entry.key);
    if (key === null || (visibleKeys !== undefined && !visibleKeys.has(key))) {
      continue;
    }
    const values = normalizePropertyScalarRefs(entry.values);
    if (values.length === 0) {
      continue;
    }
    byKey.set(key, [...(byKey.get(key) ?? []), ...values]);
  }
  const result: PropertyFilterClause[] = [];
  for (const [key, values] of byKey) {
    result.push({ key, values: normalizePropertyScalarRefs(values) });
  }
  return result;
}

/** Visible keys: normalized identities, deduplicated, sorted with localeCompare. */
export function normalizeVisiblePropertyKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  for (const entry of value) {
    const key = normalizePropertyKey(entry);
    if (key !== null) {
      seen.add(key);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** Expansion retains only normalized keys that are still visible. */
export function normalizeExpandedPropertyKeys(
  value: unknown,
  visibleKeys: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  for (const entry of value) {
    const key = normalizePropertyKey(entry);
    if (key !== null && visibleKeys.has(key)) {
      seen.add(key);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export function propertyFilterClausesEqual(
  a: readonly PropertyFilterClause[],
  b: readonly PropertyFilterClause[],
): boolean {
  return a.length === b.length && a.every((clause, index) => {
    const other = b[index];
    return other !== undefined
      && clause.key === other.key
      && clause.values.length === other.values.length
      && clause.values.every((ref, refIndex) =>
        other.values[refIndex] !== undefined
        && propertyScalarRefsEqual(ref, other.values[refIndex]));
  });
}

export function countActivePropertyValues(clauses: readonly PropertyFilterClause[]): number {
  return clauses.reduce((total, clause) => total + clause.values.length, 0);
}

export function hasActivePropertyFilters(clauses: readonly PropertyFilterClause[]): boolean {
  return clauses.length > 0;
}

/**
 * C6 selection semantics. Input clauses are expected normalized; the result is
 * always normalized.
 *
 * - Ordinary: if the exact ref is the sole active property value across all
 *   clauses, clear everything; otherwise replace all clauses with the single
 *   key/value.
 * - Additive: toggle the ref within its key's clause (OR within one key),
 *   preserving other keys and dropping a clause that becomes empty.
 */
export function resolvePropertyValueSelection(
  activeClauses: readonly PropertyFilterClause[],
  key: string,
  ref: PropertyScalarRef,
  additive: boolean,
): PropertyFilterClause[] {
  const normalizedKey = normalizePropertyKey(key);
  const clauses = normalizePropertyFilterClauses(activeClauses);
  if (normalizedKey === null) {
    return clauses;
  }

  if (!additive) {
    const sole =
      clauses.length === 1
      && clauses[0].key === normalizedKey
      && clauses[0].values.length === 1
      && propertyScalarRefsEqual(clauses[0].values[0], ref);
    return sole ? [] : [{ key: normalizedKey, values: [ref] }];
  }

  const index = clauses.findIndex((clause) => clause.key === normalizedKey);
  if (index < 0) {
    return [...clauses, { key: normalizedKey, values: [ref] }];
  }
  const clause = clauses[index];
  const active = clause.values.some((value) => propertyScalarRefsEqual(value, ref));
  const nextValues = active
    ? clause.values.filter((value) => !propertyScalarRefsEqual(value, ref))
    : [...clause.values, ref].sort(comparePropertyScalarRefs);
  if (nextValues.length === 0) {
    return clauses.filter((_, clauseIndex) => clauseIndex !== index);
  }
  return clauses.map((existing, clauseIndex) =>
    clauseIndex === index ? { key: normalizedKey, values: nextValues } : existing);
}
