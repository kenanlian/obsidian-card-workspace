import type { HydrateViewportRequest } from "./hydration-request";
import type { PanelScopeState } from "./panel-model";

export interface LayoutRowIdentity {
  key: string;
}

export function buildRowPositions(
  rows: readonly LayoutRowIdentity[],
  measuredHeights: ReadonlyMap<string, number>,
  estimatedHeight: number,
  priorPositions: readonly number[],
  fromIndex: number,
): { positions: number[]; totalHeight: number } {
  const start = Math.max(0, Math.min(rows.length, Math.trunc(fromIndex) || 0));
  const positions = [...priorPositions];
  positions.length = rows.length;
  let y = start === 0 ? 0 : positions[start] ?? 0;
  for (let index = start; index < rows.length; index += 1) {
    const row = rows[index];
    positions[index] = y;
    y += row ? measuredHeights.get(row.key) || estimatedHeight : estimatedHeight;
  }
  return { positions, totalHeight: y };
}

export function readFiniteNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolvePanelScopeIdentity(scope: PanelScopeState): string {
  return scope.activeBoxId !== null
    ? `box:${scope.activeBoxId}`
    : `folder:${scope.displayPath}:${scope.includeSubfolders}`;
}

export function createViewportRequest(
  generation: number,
  hydrationRevision: number,
  start: number,
  end: number,
  paths: readonly string[],
): { identity: string; request: HydrateViewportRequest } {
  return {
    identity: `${generation}\u001e${hydrationRevision}\u001e${paths.join("\u001f")}`,
    request: { generation, hydrationRevision, start, end, paths },
  };
}

export function getSpacerStyle(height: number): string {
  return `height: ${height}px;`;
}
