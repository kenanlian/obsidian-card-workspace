import {
  navigationLinksId,
  navigationSectionId,
  type NavigationLinksRow,
  type NavigationProjectionInput,
} from "./navigation-model";
import { isLinksScope } from "./scope";

/**
 * Links navigation projection (C4).
 *
 * Two fixed leaves — outgoing then backlinks — with no deeper nesting and no
 * count badges (v1). Disabled is host-owned via `input.linksDisabled`; this
 * module never derives enablement. Rows are returned with zeroed set metadata
 * regardless of section expansion; the caller assigns positions with
 * `assignSetMetadata` and gates on `expanded`.
 */

export interface LinksProjectionResult {
  rows: NavigationLinksRow[];
  /** Matched leaves for the current query (always 2 when the query is blank). */
  matchedItemCount: number;
}

const LINK_DIRECTIONS = ["outgoing", "backlinks"] as const;

function matches(needle: string, ...candidates: string[]): boolean {
  return candidates.some((candidate) => candidate.toLowerCase().includes(needle));
}

function leafLabel(
  labels: NavigationProjectionInput["linksLeafLabels"],
  direction: (typeof LINK_DIRECTIONS)[number],
): string {
  const raw = direction === "outgoing" ? labels.outgoing : labels.backlinks;
  return typeof raw === "string" && raw.length > 0 ? raw : direction;
}

export function projectLinksRows(
  input: NavigationProjectionInput,
  needle: string,
): LinksProjectionResult {
  const querying = needle.length > 0;
  const rows: NavigationLinksRow[] = [];

  for (const direction of LINK_DIRECTIONS) {
    const label = leafLabel(input.linksLeafLabels, direction);
    if (querying && !matches(needle, label)) continue;
    rows.push({
      id: navigationLinksId(direction),
      kind: "links",
      section: "links",
      parentId: navigationSectionId("links"),
      level: 2,
      positionInSet: 0,
      setSize: 0,
      expandable: false,
      expanded: false,
      disabled: input.linksDisabled,
      semanticState: isLinksScope(input.scope) && input.scope.direction === direction
        ? "current-range"
        : "none",
      label,
      fullPath: null,
      count: 0,
      icon: direction === "outgoing" ? "arrow-up-right" : "links",
      menuTarget: { section: "links", scope: "item", itemId: direction },
      direction,
    });
  }

  return {
    rows,
    matchedItemCount: querying ? rows.length : 2,
  };
}
