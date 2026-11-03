import { normalizePropertyKey, normalizePropertyScalarRef, serializePropertyScalarRef, type PropertyScalarRef } from "./property-filter-settings";
import { normalizeFavoriteRef } from "./view/favorites";
import { getCardFileIcon, resolveCardFileKindFromPath } from "./view/file-kind";
import { isPathAtOrBelow, rewritePathReference } from "./path-references";

/** `none` renders the item as plain text; its value is always empty. */
export type IconSpec = { kind: "lucide" | "emoji" | "none"; value: string };
export const NO_ICON: IconSpec = { kind: "none", value: "" };
export const ICON_CATEGORIES = ["folder", "tag", "property", "property-value", "box", "backlinks", "outgoing", "template", "markdown", "base", "canvas", "excalidraw", "image", "pdf", "audio", "video", "file"] as const;
export type IconCategory = typeof ICON_CATEGORIES[number];
export type IconDefaults = Partial<Record<IconCategory, IconSpec>>;
export type IconOverrides = Record<string, IconSpec>;
export type IconTarget =
  | { kind: "folder" | "file" | "tag" | "box" | "template"; ref: string }
  | { kind: "links"; ref: "backlinks" | "outgoing" }
  | { kind: "property"; ref: string }
  | { kind: "property-value"; ref: string; value: PropertyScalarRef };
export interface IconSettings { iconDefaults?: IconDefaults; iconOverrides?: IconOverrides }
export const RECENT_ICON_LIMIT = 24;
export const EMOJI_SKIN_TONES = ["", "🏻", "🏼", "🏽", "🏾", "🏿"] as const;
export type EmojiSkinTone = typeof EMOJI_SKIN_TONES[number];

const BUILTIN: Partial<Record<IconCategory, string>> = { folder: "folder", tag: "tag", property: "list", "property-value": "dot", box: "box", backlinks: "links-coming-in", outgoing: "links-going-out", template: "file-plus-2" };
export function builtinCategoryIcon(category: IconCategory): string { return BUILTIN[category] ?? getCardFileIcon(category as Parameters<typeof getCardFileIcon>[0]); }

/** No catalogue work here: persisted text is defensive, bounded, and rendered as text. */
export function normalizeIconSpec(raw: unknown): IconSpec | null {
  if (typeof raw !== "object" || raw === null) return null;
  const spec = raw as Partial<IconSpec>;
  if (spec.kind === "none") return { ...NO_ICON };
  if (typeof spec.value !== "string") return null;
  const value = spec.value.trim();
  if (spec.kind === "lucide") return /^[a-z0-9][a-z0-9-]{0,119}$/.test(value) ? { kind: "lucide", value } : null;
  if (spec.kind === "emoji" && value.length <= 128
    && /^(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\p{Extended_Pictographic}[\uFE0E\uFE0F]?[\u{1F3FB}-\u{1F3FF}]?(?:\u200D\p{Extended_Pictographic}[\uFE0E\uFE0F]?[\u{1F3FB}-\u{1F3FF}]?)*(?:[\u{E0020}-\u{E007E}]+\u{E007F})?)$/u.test(value)) return { kind: "emoji", value };
  return null;
}

/** Hosts register Lucide glyphs both bare and `lucide-` prefixed; both name one glyph. */
export function lucideBaseName(value: string): string { return value.startsWith("lucide-") ? value.slice(7) : value; }
export function iconSpecEquals(a: IconSpec, b: IconSpec): boolean {
  return a.kind === b.kind && (a.kind === "lucide" ? lucideBaseName(a.value) === lucideBaseName(b.value) : a.value === b.value);
}
export function normalizeRecentIcons(raw: unknown): IconSpec[] {
  if (!Array.isArray(raw)) return [];
  const result: IconSpec[] = [];
  for (const value of raw) {
    const spec = normalizeIconSpec(value);
    if (spec && spec.kind !== "none" && !result.some(entry => iconSpecEquals(entry, spec))) result.push(spec);
    if (result.length >= RECENT_ICON_LIMIT) break;
  }
  return result;
}
export function pushRecentIcon(current: readonly IconSpec[] | undefined, spec: IconSpec): IconSpec[] {
  if (spec.kind === "none") return [...(current ?? [])];
  return [{ ...spec }, ...(current ?? []).filter(entry => !iconSpecEquals(entry, spec))].slice(0, RECENT_ICON_LIMIT);
}
export function normalizeEmojiSkinTone(raw: unknown): EmojiSkinTone {
  return EMOJI_SKIN_TONES.find(tone => tone === raw) ?? "";
}

export function normalizeIconTarget(raw: unknown): IconTarget | null {
  if (typeof raw !== "object" || raw === null) return null;
  const target = raw as Partial<IconTarget>;
  if (typeof target.ref !== "string") return null;
  const kind = target.kind;
  if (kind === "folder" || kind === "file" || kind === "tag" || kind === "box") {
    const ref = normalizeFavoriteRef(kind, target.ref);
    return ref === null ? null : { kind, ref };
  }
  if (kind === "template") return target.ref.trim() ? { kind, ref: target.ref.trim() } : null;
  if (kind === "links") return target.ref === "backlinks" || target.ref === "outgoing" ? { kind, ref: target.ref } : null;
  if (kind === "property" || kind === "property-value") {
    const ref = normalizePropertyKey(target.ref);
    if (ref === null) return null;
    if (kind === "property") return { kind, ref };
    const value = normalizePropertyScalarRef("value" in target ? target.value : null);
    return value ? { kind, ref, value } : null;
  }
  return null;
}

/** JSON tuples keep paths/IDs and type-sensitive scalar values collision-free. */
export function iconTargetKey(target: IconTarget): string {
  const normalized = normalizeIconTarget(target);
  if (!normalized) throw new Error("Invalid icon target");
  return JSON.stringify(normalized.kind === "property-value"
    ? [normalized.kind, normalized.ref, serializePropertyScalarRef(normalized.value)]
    : [normalized.kind, normalized.ref]);
}
export function parseIconTargetKey(key: string): IconTarget | null {
  try {
    const tuple: unknown = JSON.parse(key);
    if (!Array.isArray(tuple) || tuple.length < 2 || tuple.length > 3) return null;
    let value: unknown;
    if (tuple[0] === "property-value") {
      const scalar: unknown = JSON.parse(String(tuple[2]));
      if (!Array.isArray(scalar)) return null;
      const kind = ({ t: "text", n: "number", b: "boolean", m: "missing" } as Record<string, string>)[String(scalar[0])];
      value = { kind, value: scalar[1] };
    }
    return normalizeIconTarget({ kind: tuple[0], ref: tuple[1], value });
  } catch { return null; }
}
export function normalizeIconDefaults(raw: unknown): IconDefaults {
  const result: IconDefaults = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const category of ICON_CATEGORIES) {
    const spec = normalizeIconSpec((raw as Record<string, unknown>)[category]);
    if (spec) result[category] = spec;
  }
  return result;
}
export function normalizeIconOverrides(raw: unknown): IconOverrides {
  const result: IconOverrides = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const [key, value] of Object.entries(raw)) {
    const target = parseIconTargetKey(key);
    const spec = normalizeIconSpec(value);
    if (target && spec) result[iconTargetKey(target)] = spec;
  }
  return result;
}
export function iconTargetCategory(target: IconTarget): IconCategory {
  if (target.kind === "file") return resolveCardFileKindFromPath(target.ref) ?? "file";
  return target.kind === "links" ? target.ref : target.kind;
}
export function resolveContentIcon(settings: IconSettings, target: IconTarget, fallback: string = target.kind === "folder" && target.ref === "" ? "house" : builtinCategoryIcon(iconTargetCategory(target))): IconSpec {
  return settings.iconOverrides?.[iconTargetKey(target)] ?? settings.iconDefaults?.[iconTargetCategory(target)] ?? { kind: "lucide", value: fallback };
}

/** Called only for explicit authored tag operations, never for a transient facet snapshot. */
export function rewriteTagIconOverrides(current: IconOverrides, from: string, to: string | null, partial = false): IconOverrides {
  const next = { ...current };
  for (const [key, spec] of Object.entries(current)) {
    const target = parseIconTargetKey(key);
    if (!target || target.kind !== "tag" || !isPathAtOrBelow(target.ref, from)) continue;
    if (!partial) delete next[key];
    if (to !== null) {
      const newKey = iconTargetKey({ kind: "tag", ref: rewritePathReference(target.ref, from, to) });
      if (!Object.prototype.hasOwnProperty.call(current, newKey)) next[newKey] = spec;
    }
  }
  return JSON.stringify(current) === JSON.stringify(next) ? current : next;
}
