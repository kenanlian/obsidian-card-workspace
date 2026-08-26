import type { NavigationActivationMode, NavigationRow } from "./navigation-model";

export type NavigationKeyCommand =
  | { type: "focus"; rowId: string }
  | { type: "expand"; rowId: string; expanded: boolean }
  | { type: "activate"; rowId: string; mode: NavigationActivationMode }
  | { type: "menu"; rowId: string };

function childOf(rows: readonly NavigationRow[], row: NavigationRow): NavigationRow | undefined {
  return rows.find((candidate) => candidate.parentId === row.id);
}

export function resolveNavigationKey(
  event: Pick<KeyboardEvent, "key" | "shiftKey">,
  rows: readonly NavigationRow[],
  rowId: string,
): NavigationKeyCommand | null {
  const index = rows.findIndex((row) => row.id === rowId);
  if (index < 0) return null;
  const row = rows[index];
  if (!row) return null;

  if (event.key === "ArrowUp") {
    return index > 0 ? { type: "focus", rowId: rows[index - 1]!.id } : null;
  }
  if (event.key === "ArrowDown") {
    return index < rows.length - 1 ? { type: "focus", rowId: rows[index + 1]!.id } : null;
  }
  if (event.key === "Home") return rows[0] ? { type: "focus", rowId: rows[0].id } : null;
  if (event.key === "End") {
    const last = rows.at(-1);
    return last ? { type: "focus", rowId: last.id } : null;
  }
  if (event.key === "ArrowRight") {
    if (row.expandable && !row.expanded) return { type: "expand", rowId, expanded: true };
    const child = childOf(rows, row);
    return child ? { type: "focus", rowId: child.id } : null;
  }
  if (event.key === "ArrowLeft") {
    if (row.expandable && row.expanded) return { type: "expand", rowId, expanded: false };
    return row.parentId ? { type: "focus", rowId: row.parentId } : null;
  }
  if (event.key === "Enter") return { type: "activate", rowId, mode: "ordinary" };
  if (event.key === " " || event.key === "Spacebar") {
    return { type: "activate", rowId, mode: "additive" };
  }
  if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
    return { type: "menu", rowId };
  }
  return null;
}

export function resolveNavigationFocus(
  rows: readonly NavigationRow[],
  requestedId: string | null,
  previousIds: readonly string[] = [],
): string | null {
  if (rows.length === 0) return null;
  if (requestedId && rows.some((row) => row.id === requestedId)) return requestedId;
  const current = rows.find((row) => row.semanticState === "current-range");
  if (current) return current.id;
  const oldIndex = requestedId ? previousIds.indexOf(requestedId) : -1;
  if (oldIndex >= 0) return rows[Math.min(oldIndex, rows.length - 1)]?.id ?? rows[0]!.id;
  return rows[0]!.id;
}

export function resolveSeparatorWidth(
  key: string,
  width: number,
  shiftKey: boolean,
  rtl: boolean,
  min = 160,
  max = 480,
): number | null {
  if (key === "Home") return width === min ? null : min;
  if (key === "End") return width === max ? null : max;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const step = shiftKey ? 32 : 8;
  const direction = (key === "ArrowRight" ? 1 : -1) * (rtl ? -1 : 1);
  const next = Math.max(min, Math.min(max, width + direction * step));
  return next === width ? null : next;
}
