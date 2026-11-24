/** A split owns geometry. Stream snapshots and runtimes are identified independently. */
export type Tile = { kind: "stream"; id: string } | Split;
export interface Split { kind: "split"; id: string; axis: "x" | "y"; ratio: number; first: Tile; second: Tile }
export type Side = "left" | "right" | "top" | "bottom";
export interface Placement { target: string; side: Side }
export interface Rect { x: number; y: number; width: number; height: number }
export interface Region extends Rect { key: string; axis: "x" | "y"; stream?: string }
export interface Divider extends Rect { id: string; axis: "x" | "y"; position: number; span: number; min: number; max: number }
export const GAP = 6;
export const MIN_WIDTH = 240;
const MIN_HEIGHT = 160;
const BAR = 28;
export const tileKey = (t: Tile) => t.kind + ":" + t.id;
export function tiles(root: Tile | null): Tile[] {
  const result: Tile[] = [];
  const pending = root ? [root] : [];
  while (pending.length) {
    const tile = pending.pop()!;
    result.push(tile);
    if (tile.kind === "split") pending.push(tile.second, tile.first);
  }
  return result;
}
export function rewrite(root: Tile, key: string, fn: (tile: Tile) => Tile | null): Tile | null {
  if (tileKey(root) === key) return fn(root);
  if (root.kind === "stream") return root;
  const first = rewrite(root.first, key, fn), second = rewrite(root.second, key, fn);
  if (!first) return second;
  if (!second) return first;
  return first === root.first && second === root.second ? root : { ...root, first, second };
}
let serial = 0;
export function insert(root: Tile | null, id: string, place: Placement, ratio = 0.5, groupId?: string): Tile {
  const leaf: Tile = { kind: "stream", id };
  if (!root) return leaf;
  const keys = new Set(tiles(root).map(tileKey));
  while (!groupId || keys.has("split:" + groupId)) groupId = String(++serial);
  const before = place.side === "left" || place.side === "top";
  return rewrite(root, place.target, target => ({
    kind: "split", id: groupId, axis: place.side === "left" || place.side === "right" ? "x" : "y",
    ratio, first: before ? leaf : target, second: before ? target : leaf,
  }))!;
}
export function validTiles(value: unknown, ids: Set<string>): value is Tile | null {
  if (value === null) return ids.size === 0;
  const seen = new Set<string>(), found = new Set<string>();
  const pending: unknown[] = [value];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== "object" || !("kind" in node) || !("id" in node) || typeof node.id !== "string") return false;
    const key = String(node.kind) + ":" + node.id;
    if (seen.has(key)) return false;
    seen.add(key);
    if (node.kind === "stream" && ids.has(node.id)) found.add(node.id);
    else if (node.kind === "split" && "axis" in node && (node.axis === "x" || node.axis === "y") && "ratio" in node && typeof node.ratio === "number" && node.ratio > 0 && node.ratio < 1 && "first" in node && "second" in node) {
      pending.push(node.first, node.second);
    } else return false;
  }
  return found.size === ids.size;
}
export function tileGeometry(root: Tile | null, collapsed: Set<string>, width: number, height: number) {
  const regions: Region[] = [], dividers: Divider[] = [];
  type Measure = { width: number; height: number; fixedX: boolean; fixedY: boolean };
  const sizes = new Map<Tile, Measure>();
  function measure(t: Tile, axis: "x" | "y"): Measure {
    let size: Measure;
    if (t.kind === "stream") {
      const fixedX = collapsed.has(t.id) && axis === "x", fixedY = collapsed.has(t.id) && axis === "y";
      size = { width: fixedX ? BAR : MIN_WIDTH, height: fixedY ? BAR : MIN_HEIGHT, fixedX, fixedY };
    } else {
      const a = measure(t.first, t.axis), b = measure(t.second, t.axis);
      const horizontal = t.axis === "x";
      size = { width: horizontal ? a.width + GAP + b.width : Math.max(a.width, b.width),
        height: horizontal ? Math.max(a.height, b.height) : a.height + GAP + b.height,
        fixedX: a.fixedX && b.fixedX, fixedY: a.fixedY && b.fixedY };
    }
    sizes.set(t, size);
    return size;
  }
  function layout(tile: Tile, rect: Rect, parentAxis: "x" | "y") {
    regions.push({ ...rect, key: tileKey(tile), axis: parentAxis, stream: tile.kind === "stream" ? tile.id : undefined });
    if (tile.kind === "stream") return;

    const { axis, first, second } = tile;
    const dimension = axis === "x" ? "width" : "height";
    const fixedDimension = axis === "x" ? "fixedX" : "fixedY";
    const firstSize = sizes.get(first)!, secondSize = sizes.get(second)!;
    const span = rect[dimension] - GAP;
    const min = firstSize[dimension], max = span - secondSize[dimension];
    let position = Math.max(min, Math.min(max, Math.round(span * tile.ratio)));
    if (firstSize[fixedDimension]) position = min;
    else if (secondSize[fixedDimension]) position = max;

    layout(first, { ...rect, [dimension]: position }, axis);
    if (!firstSize[fixedDimension] && !secondSize[fixedDimension]) {
      dividers.push({ ...rect, [axis]: rect[axis] + position, [dimension]: GAP, axis, id: tile.id, span, position, min, max });
    }
    const secondSpan = secondSize[fixedDimension] ? secondSize[dimension] : span - position;
    layout(second, { ...rect, [axis]: rect[axis] + position + GAP, [dimension]: secondSpan }, axis);
  }

  const min = root && measure(root, "x");
  if (root && min) {
    layout(root, {
      x: 0, y: 0,
      width: min.fixedX ? min.width : Math.max(width, min.width),
      height: min.fixedY ? min.height : Math.max(height, min.height),
    }, "x");
  }
  return { regions, dividers, minWidth: min?.width ?? 0 };
}
export function cloneLayout(root: Tile | null): Tile | null {
  if (!root) return null;
  if (root.kind === "stream") return { kind: "stream", id: root.id };
  return { kind: "split", id: root.id, axis: root.axis, ratio: root.ratio, first: cloneLayout(root.first)!, second: cloneLayout(root.second)! };
}

export function moveTile(root: Tile, id: string, placement: Placement): Tile | null {
  const source = "stream:" + id;
  const target = tiles(root).find(t => tileKey(t) === placement.target);
  const after = target && rewrite(target, source, () => null);
  if (!after) return null;
  const remaining = rewrite(root, source, () => null);
  return insert(remaining, id, { ...placement, target: tileKey(after) });
}

function edge(region: Rect, side: Side): number {
  switch (side) {
    case "left": return region.x;
    case "right": return region.x + region.width;
    case "top": return region.y;
    case "bottom": return region.y + region.height;
  }
}

/** Shared edges have nested hit bands: outside for the group, inside for individual streams. */
export function dropPlacement(regions: Region[], source: string, x: number, y: number): Placement | null {
  const containing = regions.filter(region => region.stream !== source && x >= region.x && x <= region.x + region.width
    && y >= region.y && y <= region.y + region.height);
  for (const [index, region] of containing.entries()) {
    const edges: [Side, number][] = [
      ["top", y - region.y], ["bottom", edge(region, "bottom") - y],
      ["left", x - region.x], ["right", edge(region, "right") - x],
    ];
    edges.sort((a, b) => a[1] - b[1]);
    const [side, distance] = edges[0];
    const boundary = edge(region, side);
    const shared = containing.slice(0, index).filter(parent => boundary === edge(parent, side)).length;
    if (distance < 12 * (shared + 1) || (region.stream && distance <= Math.min(region.width, region.height) / 3)) {
      return { target: region.key, side };
    }
  }
  return null;
}
