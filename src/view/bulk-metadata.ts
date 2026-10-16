import type { App, TFile } from "obsidian";
import { normalizePropertyKey } from "../property-filter-settings";
import { getTagEntriesFromCache } from "./metadata-utils";

export type BulkPropertyType = "text" | "list" | "number" | "checkbox" | "date" | "datetime";
export type BulkPropertyValue = string | number | boolean | Array<string | number>;
export interface BulkPropertySet { name: string; type: BulkPropertyType; value: BulkPropertyValue }
export interface BulkPropertiesDraft { setProperties: BulkPropertySet[]; removeKeys: string[] }
export interface BulkTagsDraft { addTags: string[]; removeTags: string[] }
export interface MetadataCandidate { name: string; count?: number }
export interface BulkMetadataSnapshot {
  tags: MetadataCandidate[];
  removeTags: MetadataCandidate[];
  properties: MetadataCandidate[];
  removeProperties: MetadataCandidate[];
  values: Map<string, unknown[]>;
  incomplete: boolean;
}

export function editablePropertyKey(raw: string): string | null {
  const key = normalizePropertyKey(raw);
  return key === "tag" || key === "tags" ? null : key;
}

export function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validLocalDateTime(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/.exec(value);
  return !!match && validIsoDate(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4] ?? 0) < 60;
}

/** Recognizes local ISO timestamps and ISO timestamps carrying an explicit zone. */
function isoDateTimeToLocal(value: string): string | null {
  if (validLocalDateTime(value)) return value;
  const match = /^(.*)(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !validLocalDateTime(match[1])) return null;
  if (match[2] !== "Z" && (Number(match[2].slice(1, 3)) > 23 || Number(match[2].slice(4)) > 59)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function inferPropertyType(value: unknown): BulkPropertyType {
  if (Array.isArray(value)) return "list";
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "string" && validIsoDate(value)) return "date";
  if (typeof value === "string" && isoDateTimeToLocal(value) !== null) return "datetime";
  return "text";
}

export function inferPropertyEditType(values: unknown[]): BulkPropertyType {
  const types = new Set(values.map(inferPropertyType));
  return types.size === 1 ? [...types][0] : "text";
}

export function validPropertyValue(type: BulkPropertyType, value: unknown): value is BulkPropertyValue {
  switch (type) {
    case "text": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "checkbox": return typeof value === "boolean";
    case "list": return Array.isArray(value) && value.every((item) => typeof item === "string" || (typeof item === "number" && Number.isFinite(item)));
    case "date": return typeof value === "string" && validIsoDate(value);
    case "datetime": return typeof value === "string" && validLocalDateTime(value);
  }
}

export function validPropertiesDraft(draft: BulkPropertiesDraft): boolean {
  const keys = draft.setProperties.map((entry) => editablePropertyKey(entry.name));
  const removes = draft.removeKeys.map(editablePropertyKey);
  return keys.every((key) => key !== null) && removes.every((key) => key !== null)
    && new Set(keys).size === keys.length && new Set(removes).size === removes.length
    && !keys.some((key) => removes.includes(key))
    && draft.setProperties.every((entry) => validPropertyValue(entry.type, entry.value))
    && keys.length + removes.length > 0;
}

/** One cache-only inventory per open; independent of navigation visibility. */
export function buildBulkMetadataSnapshot(app: App, targets: readonly TFile[]): BulkMetadataSnapshot {
  const tagMap = new Map<string, MetadataCandidate>();
  const propertyMap = new Map<string, MetadataCandidate>();
  const removeTagMap = new Map<string, MetadataCandidate>();
  const removePropertyMap = new Map<string, MetadataCandidate>();
  const values = new Map<string, unknown[]>();
  const selected = new Set(targets);
  let incomplete = false;
  for (const file of new Set([...app.vault.getMarkdownFiles(), ...targets])) {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache) { incomplete = true; continue; }
    for (const tag of getTagEntriesFromCache(cache)) {
      if (!tagMap.has(tag.normalized)) tagMap.set(tag.normalized, { name: tag.display });
      if (selected.has(file)) {
        const entry = removeTagMap.get(tag.normalized) ?? { name: tag.display, count: 0 };
        entry.count = (entry.count ?? 0) + 1;
        removeTagMap.set(tag.normalized, entry);
      }
    }
    const seen = new Set<string>();
    for (const [raw, value] of Object.entries<unknown>(cache.frontmatter ?? {})) {
      const key = editablePropertyKey(raw);
      if (!key) continue;
      if (!propertyMap.has(key)) propertyMap.set(key, { name: raw.trim() });
      const existing = values.get(key) ?? [];
      // Copy list values: the inventory must not retain mutable metadata arrays.
      existing.push(Array.isArray(value) ? Array.from<unknown>(value) : value);
      values.set(key, existing);
      if (selected.has(file) && !seen.has(key)) {
        seen.add(key);
        const entry = removePropertyMap.get(key) ?? { name: raw.trim(), count: 0 };
        entry.count = (entry.count ?? 0) + 1;
        removePropertyMap.set(key, entry);
      }
    }
  }
  return { tags: [...tagMap.values()], properties: [...propertyMap.values()], removeTags: [...removeTagMap.values()], removeProperties: [...removePropertyMap.values()], values, incomplete };
}

/** Every vault tag with the number of notes carrying it; cache-only. */
export function buildVaultTagCandidates(app: App): MetadataCandidate[] {
  const tags = new Map<string, MetadataCandidate>();
  for (const file of app.vault.getMarkdownFiles()) {
    for (const tag of getTagEntriesFromCache(app.metadataCache.getFileCache(file))) {
      const entry = tags.get(tag.normalized) ?? { name: tag.display, count: 0 };
      entry.count = (entry.count ?? 0) + 1;
      tags.set(tag.normalized, entry);
    }
  }
  return [...tags.values()];
}

export function filterMetadataCandidates(candidates: readonly MetadataCandidate[], query: string): MetadataCandidate[] {
  const needle = query.trim().toLowerCase();
  return candidates.filter((item) => item.name.toLowerCase().includes(needle)).sort((a, b) =>
    Number(b.name.toLowerCase().startsWith(needle)) - Number(a.name.toLowerCase().startsWith(needle)) || a.name.localeCompare(b.name),
  ).slice(0, 20);
}

export function propertyValueCandidates(snapshot: BulkMetadataSnapshot, name: string, type: BulkPropertyType, listItemType: "text" | "number" = "text"): MetadataCandidate[] {
  const values = snapshot.values.get(editablePropertyKey(name) ?? "") ?? [];
  const items = type === "list" ? values.filter(Array.isArray).flat()
    : type === "datetime" ? values.map((value) => typeof value === "string" ? isoDateTimeToLocal(value) : null)
    : values;
  const targetType = type === "list" ? listItemType : type;
  return [...new Set(items.filter((value) => validPropertyValue(targetType, value)).map(String))].map((value) => ({ name: value }));
}
