import { NAVIGATION_SECTION_ORDER } from "./view/navigation-model";
import type { NavSectionId } from "./view/types";

const KNOWN_NAV_SECTION_IDS: ReadonlySet<string> = new Set(NAVIGATION_SECTION_ORDER);

function isNavSectionId(value: unknown): value is NavSectionId {
  return typeof value === "string" && KNOWN_NAV_SECTION_IDS.has(value);
}

export function defaultNavSectionOrder(): NavSectionId[] {
  return [...NAVIGATION_SECTION_ORDER];
}

export function normalizeNavSectionOrder(value: unknown): NavSectionId[] {
  if (!Array.isArray(value)) return defaultNavSectionOrder();

  const seen = new Set<NavSectionId>();
  const result: NavSectionId[] = [];
  for (const entry of value) {
    if (!isNavSectionId(entry) || seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }
  for (const id of NAVIGATION_SECTION_ORDER) {
    if (!seen.has(id)) result.push(id);
  }
  return result;
}

export function moveNavSection(
  order: readonly NavSectionId[],
  section: NavSectionId,
  delta: -1 | 1,
): NavSectionId[] | null {
  const next = normalizeNavSectionOrder(order);
  const index = next.indexOf(section);
  if (index < 0) return null;
  const target = index + delta;
  if (target < 0 || target >= next.length) return null;
  const swapped = next[index];
  next[index] = next[target];
  next[target] = swapped;
  return next;
}

export function canMoveNavSection(
  order: readonly NavSectionId[],
  section: NavSectionId,
  delta: -1 | 1,
): boolean {
  return moveNavSection(order, section, delta) !== null;
}
