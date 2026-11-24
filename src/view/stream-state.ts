import { MIN_WIDTH, cloneLayout, moveTile, insert, rewrite, tileKey, tiles, validTiles, type Placement, type Tile } from "./stream-tiles";
import { normalizeGroupSpec } from "../card-grouping-settings";
import { normalizeExpandedFolderPaths, normalizeExpandedTagPaths } from "../navigation-expansion-settings";
import { normalizeExpandedPropertyKeys, normalizePropertyFilterClauses } from "../property-filter-settings";
import { NAV_PANE_WIDTH_MAX, NAV_PANE_WIDTH_MIN, normalizeLinksSort, type PluginSettings } from "../settings";
import { normalizeDefaultViewMode, normalizeTaskGroupSpec, normalizeTaskSortSpec } from "../task-view-settings";
import { isValidIsoDate } from "../tasks/task-dates";
import { scopesEqual, type CardScope } from "./scope";
import type { RowAnchor } from "./scroll-anchoring";
import type { StreamBrowseState } from "./stream-browse-state";
import type { TaskFilterSpec } from "./task-filters";
import type { NavSectionId } from "./types";

export interface StreamSnapshot {
  id: string;
  title: string | null;
  scope: CardScope;
  browse: StreamBrowseState;
  query: string;
  searchOpen: boolean;
  linksPinned: boolean;
  taskFilters: TaskFilterSpec;
  collapsedGroups: Record<string, string[]>;
  anchor: RowAnchor | null;
  anchorIndex: number;
  desiredExpanded: boolean;
  lastActive: number;
  /** Legacy pixel width used when migrating a V1 row to split proportions. */
  width: number | null;
}

/** Runtime-owned portion of a stream. Tile operations own the other fields. */
export type StreamBrowsingSnapshot = Pick<StreamSnapshot,
  "scope" | "browse" | "query" | "searchOpen" | "linksPinned" | "taskFilters" | "collapsedGroups" | "anchor" | "anchorIndex">;

export interface LeafNavigationState {
  width: number;
  collapsed: boolean;
  expandedFolderPaths: string[];
  expandedTagPaths: string[];
  expandedPropertyKeys: string[];
  sectionCollapsed: Record<NavSectionId, boolean>;
  query: string;
  focusId: string | null;
}

export interface DesktopLeafStateV1 {
  version: 1;
  streams: StreamSnapshot[];
  currentStreamId: string | null;
  maximizedStreamId: string | null;
  navigation: LeafNavigationState;
}

export interface DesktopLeafStateV2 extends Omit<DesktopLeafStateV1, "version"> { version: 2; layout: Tile | null }

export interface LeafStreamState {
  layout: Tile | null;
  streams: readonly StreamSnapshot[];
  currentStreamId: string | null;
  maximizedStreamId: string | null;
  visibleIds: readonly string[];
  width: number;
  height: number;
  revision: number;
  recentlyClosedCount: number;
}

// V1 stored column widths with a 6px gutter between them.
const LEGACY_ROW_GAP = 6;

/** One card column: the card minimum width plus list padding. */
export const STREAM_DEFAULT_WIDTH = 320;
export const STREAM_MAX_WIDTH = 4000;

function clampWidth(width: number): number {
  return Math.round(Math.max(MIN_WIDTH, Math.min(STREAM_MAX_WIDTH, width)));
}

function cloneStream(stream: StreamSnapshot): StreamSnapshot {
  return {
    id: stream.id, title: stream.title, scope: { ...stream.scope },
    browse: {
      filter: {
        tags: [...stream.browse.filter.tags],
        properties: stream.browse.filter.properties.map(clause => ({ key: clause.key, values: clause.values.map(value => ({ ...value })) })),
      },
      sort: { ...stream.browse.sort }, group: { ...stream.browse.group }, viewMode: stream.browse.viewMode,
      taskSort: { ...stream.browse.taskSort }, taskGroup: { ...stream.browse.taskGroup },
    },
    query: stream.query, searchOpen: stream.searchOpen, linksPinned: stream.linksPinned,
    taskFilters: { status: stream.taskFilters.status, date: stream.taskFilters.date ? { ...stream.taskFilters.date } : null },
    collapsedGroups: Object.fromEntries(Object.entries(stream.collapsedGroups).map(([key, values]) => [key, [...values]])),
    anchor: stream.anchor ? { offset: stream.anchor.offset, ref: { ...stream.anchor.ref } } : null,
    anchorIndex: stream.anchorIndex, desiredExpanded: stream.desiredExpanded, lastActive: stream.lastActive, width: stream.width,
  };
}

function cloneNavigation(navigation: LeafNavigationState): LeafNavigationState {
  return {
    width: navigation.width, collapsed: navigation.collapsed,
    expandedFolderPaths: [...navigation.expandedFolderPaths], expandedTagPaths: [...navigation.expandedTagPaths],
    expandedPropertyKeys: [...navigation.expandedPropertyKeys], sectionCollapsed: { ...navigation.sectionCollapsed },
    query: navigation.query, focusId: navigation.focusId,
  };
}

function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left), b = Object.keys(right);
  return a.length === b.length && a.every(key => Object.prototype.hasOwnProperty.call(right, key)
    && equal((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

/** Public values are deep copies: consumers cannot mutate controller-owned snapshots. */
export class LeafStreamController {
  private layout: Tile | null = null;
  private awaitingMeasurement = false;
  private streams: StreamSnapshot[];
  private currentStreamId: string | null;
  private maximizedStreamId: string | null = null;
  private width = 0;
  private height = 0;
  private revision = 0;
  private clock = 0;
  private readonly listeners = new Set<(state: LeafStreamState) => void>();
  private readonly closed: { stream: StreamSnapshot; place?: Placement; ratio?: number; groupId?: string }[] = [];

  constructor(initialStreams: StreamSnapshot[] = []) {
    if (new Set(initialStreams.map(stream => stream.id)).size !== initialStreams.length) throw new Error("Duplicate stream ID");
    this.streams = initialStreams.map(cloneStream);
    this.layout = this.legacyLayout();
    this.currentStreamId = this.streams.find(stream => stream.desiredExpanded)?.id ?? null;
    this.clock = this.streams.reduce((clock, stream) => Math.max(clock, stream.lastActive), 0);
  }

  getCurrentStreamId(): string | null { return this.currentStreamId; }

  getStream(id: string): StreamSnapshot | null {
    const stream = this.streams.find(item => item.id === id);
    return stream ? cloneStream(stream) : null;
  }

  /** Saving live browsing must not re-enter the tile and runtime lifecycle. */
  updateBrowsing(id: string, browsing: StreamBrowsingSnapshot): "unchanged" | "browsing" | "scope" {
    const index = this.streams.findIndex(stream => stream.id === id);
    const previous = this.streams[index];
    if (!previous) return "unchanged";
    const next = { ...previous, ...browsing };
    if (equal(previous, next)) return "unchanged";
    this.streams[index] = cloneStream(next);
    return scopesEqual(previous.scope, next.scope) ? "browsing" : "scope";
  }

  getState(): LeafStreamState {
    return {
      layout: cloneLayout(this.layout), streams: this.streams.map(cloneStream), currentStreamId: this.currentStreamId, maximizedStreamId: this.maximizedStreamId,
      visibleIds: this.visibleIds(), width: this.width, height: this.height,
      revision: this.revision, recentlyClosedCount: this.closed.length,
    };
  }

  subscribe(listener: (state: LeafStreamState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private legacyLayout(): Tile | null {
    const widths = legacyExpandedWidths(this.streams, this.width);
    let root: Tile | null = null;
    let total = 0;
    for (const [id, width] of widths) {
      const span = total + width;
      const gap = root ? LEGACY_ROW_GAP : 0;
      root = insert(root, id, { target: root ? tileKey(root) : "", side: "right" }, total / span);
      total = span + gap;
    }
    return root;
  }

  private sortByLayout(): void {
    const byId = new Map(this.streams.map(stream => [stream.id, stream]));
    this.streams = tiles(this.layout).flatMap(tile => tile.kind === "stream" ? [byId.get(tile.id)!] : []);
  }

  add(snapshot: StreamSnapshot, placement?: Placement, ratio?: number, groupId?: string): void {
    if (this.streams.some(stream => stream.id === snapshot.id)) return;
    const target = placement ?? { target: this.currentStreamId ? "stream:" + this.currentStreamId : this.layout ? tileKey(this.layout) : "", side: "right" };
    if (this.layout && !tiles(this.layout).some(tile => tileKey(tile) === target.target)) return;
    this.awaitingMeasurement = false;
    this.layout = insert(this.layout, snapshot.id, target, ratio, groupId);
    this.maximizedStreamId = null;
    const stream = cloneStream(snapshot);
    stream.desiredExpanded = true;
    this.clock = Math.max(this.clock, stream.lastActive);
    stream.lastActive = ++this.clock;
    this.streams.push(stream);
    this.sortByLayout();
    this.currentStreamId = stream.id;
    this.publish();
  }

  update(id: string, patch: Partial<StreamSnapshot>): void {
    const index = this.streams.findIndex(stream => stream.id === id);
    if (index < 0) return;
    const previous = this.streams[index];
    const next = cloneStream({ ...previous, ...patch, id });
    if (equal(previous, next)) return;
    if (!next.desiredExpanded && this.maximizedStreamId === id) this.maximizedStreamId = null;
    const visible = this.visibleIds();
    this.streams[index] = next;
    this.clock = Math.max(this.clock, next.lastActive);
    if (!next.desiredExpanded && this.currentStreamId === id) this.selectAdjacent(index, visible.filter(value => value !== id));
    this.publish();
  }

  /** Selecting while maximized moves the maximized view to the selected stream. */
  select(id: string): void {
    const stream = this.streams.find(value => value.id === id);
    if (!stream) return;
    const moveMaximized = this.maximizedStreamId !== null && this.maximizedStreamId !== id;
    if (this.currentStreamId === id && stream.desiredExpanded && !moveMaximized) return;
    stream.desiredExpanded = true;
    stream.lastActive = ++this.clock;
    this.currentStreamId = id;
    if (moveMaximized) this.maximizedStreamId = id;
    this.publish();
  }

  setExpanded(id: string, expanded: boolean): void {
    const stream = this.streams.find(value => value.id === id);
    if (!stream || stream.desiredExpanded === expanded) return;
    if (expanded) { this.select(id); return; }
    if (this.maximizedStreamId === id) this.maximizedStreamId = null;
    const visible = this.visibleIds();
    stream.desiredExpanded = false;
    if (this.currentStreamId === id) this.selectAdjacent(this.streams.indexOf(stream), visible.filter(value => value !== id));
    this.publish();
  }

  toggleMaximized(id: string): void {
    const stream = this.streams.find(value => value.id === id);
    if (!stream) return;
    if (this.maximizedStreamId === id) { this.maximizedStreamId = null; this.publish(); return; }
    stream.desiredExpanded = true;
    this.maximizedStreamId = id;
    if (this.currentStreamId !== id) { stream.lastActive = ++this.clock; this.currentStreamId = id; }
    this.publish();
  }

  reorder(id: string, delta: -1 | 1): void {
    const index = this.streams.findIndex(stream => stream.id === id);
    if (index < 0) return;
    this.move(id, index + delta);
  }

  /** Moves a stream to an index of the list without it. */
  move(id: string, index: number): void {
    const from = this.streams.findIndex(stream => stream.id === id);
    if (from < 0 || !Number.isFinite(index)) return;
    const target = Math.max(0, Math.min(this.streams.length - 1, Math.trunc(index)));
    if (target === from) return;
    const neighbor = this.streams[target];
    this.place(id, { target: "stream:" + neighbor.id, side: target < from ? "left" : "right" });
  }

  place(id: string, placement: Placement): void {
    if (!this.layout || !this.streams.some(s => s.id === id)) return;
    const layout = moveTile(this.layout, id, placement);
    if (!layout) return;
    this.layout = layout;
    this.awaitingMeasurement = false;
    this.maximizedStreamId = null;
    this.sortByLayout();
    this.publish();
  }

  resizeSplit(id: string, ratio: number): void {
    if (!this.layout || !(ratio > 0 && ratio < 1)) return;
    const next = rewrite(this.layout, "split:" + id, node => node.kind === "split" && node.ratio !== ratio ? { ...node, ratio } : node);
    if (next === this.layout) return;
    this.layout = next;
    this.awaitingMeasurement = false;
    this.publish();
  }

  remove(id: string, remember = true): StreamSnapshot | undefined {
    const index = this.streams.findIndex(stream => stream.id === id);
    if (index < 0) return undefined;
    if (this.maximizedStreamId === id) this.maximizedStreamId = null;
    const visible = this.visibleIds();
    const [stream] = this.streams.splice(index, 1);
    const key = "stream:" + id;
    const parent = tiles(this.layout).find(t => t.kind === "split" && (tileKey(t.first) === key || tileKey(t.second) === key));
    this.layout = this.layout && rewrite(this.layout, key, () => null);
    this.awaitingMeasurement = false;
    if (remember) {
      const first = parent?.kind === "split" && tileKey(parent.first) === key;
      const position: { groupId?: string; ratio?: number; place?: Placement } = parent?.kind === "split" ? { groupId: parent.id, ratio: parent.ratio, place: {
        target: tileKey(first ? parent.second : parent.first),
        side: (parent.axis === "x" ? first ? "left" : "right" : first ? "top" : "bottom"),
      } } : {};
      this.closed.push({ stream: cloneStream(stream), ...position });
      if (this.closed.length > 10) this.closed.shift();
    }
    if (this.currentStreamId === id) this.selectAdjacent(index, visible.filter(value => value !== id), true);
    this.publish();
    return cloneStream(stream);
  }

  reopen(): StreamSnapshot | undefined {
    const closed = this.closed.pop();
    if (!closed) return undefined;
    // IDs can re-enter through a transfer; never merge that distinct live stream.
    if (this.streams.some(stream => stream.id === closed.stream.id)) {
      let suffix = 1;
      const original = closed.stream.id;
      while (this.streams.some(stream => stream.id === `${original}-${suffix}`)) suffix++;
      closed.stream.id = `${original}-${suffix}`;
    }
    const place = tiles(this.layout).some(t => tileKey(t) === closed.place?.target) ? closed.place : undefined;
    this.add(closed.stream, place, place ? closed.ratio : undefined, closed.groupId);
    return cloneStream(this.streams.find(stream => stream.id === closed.stream.id)!);
  }

  setSize(width: number, height: number): void {
    const nextWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
    const nextHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
    if (nextWidth === this.width && nextHeight === this.height) return;
    this.width = nextWidth; this.height = nextHeight;
    if (this.awaitingMeasurement && nextWidth > 0) { this.layout = this.legacyLayout(); this.awaitingMeasurement = false; }
    this.publish();
  }

  /** Rewrite live and closed snapshots together, without changing their identities. */
  mapSnapshots(rewrite: (snapshot: StreamSnapshot) => StreamSnapshot): void {
    const rewriteStream = (stream: StreamSnapshot): StreamSnapshot =>
      cloneStream({ ...rewrite(cloneStream(stream)), id: stream.id });
    // Build the complete replacement before publication, including when a rewrite throws.
    const streams = this.streams.map(rewriteStream);
    const closed = this.closed.map(entry => ({ ...entry, stream: rewriteStream(entry.stream) }));
    if (equal(this.streams, streams) && equal(this.closed, closed)) return;
    this.streams = streams;
    this.closed.splice(0, this.closed.length, ...closed);
    this.clock = streams.reduce((clock, stream) => Math.max(clock, stream.lastActive), this.clock);
    this.publish();
  }

  restore(state: DesktopLeafStateV1 | DesktopLeafStateV2): void {
    const changed = state.version === 1 || !equal(this.layout, state.layout) || !equal(this.streams, state.streams) || this.currentStreamId !== state.currentStreamId
      || this.maximizedStreamId !== state.maximizedStreamId || this.closed.length > 0;
    if (!changed) return;
    this.streams = state.streams.map(cloneStream);
    this.awaitingMeasurement = state.version === 1 && this.width === 0;
    this.layout = state.version === 2 ? cloneLayout(state.layout) : this.legacyLayout();
    this.sortByLayout();
    this.currentStreamId = state.currentStreamId;
    this.maximizedStreamId = state.maximizedStreamId;
    this.clock = this.streams.reduce((clock, stream) => Math.max(clock, stream.lastActive), this.clock);
    this.closed.length = 0;
    this.publish();
  }

  toJSON(navigation: LeafNavigationState): DesktopLeafStateV1 | DesktopLeafStateV2 {
    return {
      ...(this.awaitingMeasurement ? {version: 1 as const} : {version: 2 as const, layout: cloneLayout(this.layout)}), streams: this.streams.map(cloneStream), currentStreamId: this.currentStreamId,
      maximizedStreamId: this.maximizedStreamId, navigation: cloneNavigation(navigation),
    };
  }

  private visibleIds(): string[] {
    if (this.maximizedStreamId !== null && this.streams.some(stream => stream.id === this.maximizedStreamId)) return [this.maximizedStreamId];
    return this.streams.filter(stream => stream.desiredExpanded).map(stream => stream.id);
  }

  private selectAdjacent(index: number, visibleIds: string[], removed = false): void {
    const visible = new Set(visibleIds);
    const after = this.streams.slice(removed ? index : index + 1).find(stream => visible.has(stream.id));
    const before = this.streams.slice(0, index).reverse().find(stream => visible.has(stream.id));
    const next = after ?? before;
    this.currentStreamId = next?.id ?? null;
    if (next) next.lastActive = ++this.clock;
  }

  private publish(): void {
    this.revision++;
    for (const listener of this.listeners) listener(this.getState());
  }
}

/** Reconstruct V1's expanded row. Unsized columns share space and the last absorbs the remainder. */
function legacyExpandedWidths(streams: StreamSnapshot[], stageWidth: number): Map<string, number> {
  const available = stageWidth - (streams.length - 1) * LEGACY_ROW_GAP;
  const flexible = streams.filter(stream => stream.width === null).length;
  const fixed = streams.reduce((sum, stream) => sum + (stream.width ?? 0), 0);
  const share = stageWidth > 0 && flexible > 0
    ? Math.max(MIN_WIDTH, Math.floor((available - fixed) / flexible))
    : STREAM_DEFAULT_WIDTH;
  const widths = new Map(streams.map(stream => [stream.id, stream.width ?? share]));
  const spare = available - [...widths.values()].reduce((sum, width) => sum + width, 0);
  const last = streams.at(-1);
  if (last && spare > 0) widths.set(last.id, widths.get(last.id)! + spare);
  return widths;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}
function readScope(value: unknown): CardScope | null {
  if (!isRecord(value)) return null;
  if (value.kind === "folder" && typeof value.path === "string" && typeof value.includeSubfolders === "boolean") {
    return { kind: "folder", path: value.path === "/" ? "" : value.path, includeSubfolders: value.includeSubfolders };
  }
  if (value.kind === "box" && typeof value.boxId === "string" && value.boxId.length > 0) return { kind: "box", boxId: value.boxId };
  if (value.kind === "links" && typeof value.notePath === "string" && value.notePath.length > 0
    && (value.direction === "backlinks" || value.direction === "outgoing")) {
    return { kind: "links", notePath: value.notePath, direction: value.direction };
  }
  return null;
}
function readAnchor(value: unknown): RowAnchor | null {
  if (!isRecord(value) || !isRecord(value.ref) || typeof value.offset !== "number" || !Number.isFinite(value.offset)) return null;
  const ref = value.ref;
  if (ref.kind === "card" && typeof ref.path === "string") {
    return { offset: value.offset, ref: { kind: "card", path: ref.path, ...(typeof ref.groupKey === "string" ? { groupKey: ref.groupKey } : {}) } };
  }
  if (ref.kind === "group" && typeof ref.key === "string") return { offset: value.offset, ref: { kind: "group", key: ref.key } };
  if (ref.kind === "card-index" && typeof ref.index === "number" && Number.isInteger(ref.index) && ref.index >= 0) {
    return { offset: value.offset, ref: { kind: "card-index", index: ref.index } };
  }
  return null;
}
function readTaskFilters(value: unknown): TaskFilterSpec {
  const record = isRecord(value) ? value : {};
  const result: TaskFilterSpec = { status: record.status === "completed" || record.status === "incomplete" ? record.status : "all", date: null };
  const date = record.date;
  if (isRecord(date) && (date.field === "created" || date.field === "done" || date.field === "due")
    && (date.preset === "week" || date.preset === "previous-week" || date.preset === "report" || date.preset === "previous-report" || date.preset === "custom")
    && typeof date.start === "string" && typeof date.end === "string"
    && (date.preset !== "custom" || (isValidIsoDate(date.start) && isValidIsoDate(date.end) && date.start <= date.end))) {
    result.date = { field: date.field, preset: date.preset, start: date.start, end: date.end, weekEnd: Math.max(0, Math.min(6, Math.trunc(finite(date.weekEnd, 0)))) };
  }
  return result;
}
function readStream(value: unknown, settings: PluginSettings): StreamSnapshot | null {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.trim().length === 0) return null;
  const scope = readScope(value.scope);
  if (!scope || !isRecord(value.browse)) return null;
  const browse = value.browse;
  const filter = isRecord(browse.filter) ? browse.filter : {};
  const collapsed = isRecord(value.collapsedGroups) ? value.collapsedGroups : {};
  return {
    id: value.id, title: typeof value.title === "string" ? value.title : null, scope,
    browse: {
      filter: { tags: strings(filter.tags).filter(tag => tag.trim().length > 0), properties: normalizePropertyFilterClauses(filter.properties) },
      sort: normalizeLinksSort(browse.sort ?? settings.sort), group: normalizeGroupSpec(browse.group ?? settings.group),
      viewMode: normalizeDefaultViewMode(browse.viewMode ?? settings.defaultView),
      taskSort: normalizeTaskSortSpec(browse.taskSort ?? settings.taskSort), taskGroup: normalizeTaskGroupSpec(browse.taskGroup ?? settings.taskGroup),
    },
    query: typeof value.query === "string" ? value.query : "", searchOpen: value.searchOpen === true, linksPinned: value.linksPinned === true,
    taskFilters: readTaskFilters(value.taskFilters),
    collapsedGroups: Object.fromEntries(Object.entries(collapsed).map(([key, entries]) => [key, strings(entries)])),
    anchor: readAnchor(value.anchor), anchorIndex: Math.max(0, Math.trunc(finite(value.anchorIndex, 0))),
    desiredExpanded: value.desiredExpanded !== false, lastActive: Math.max(0, finite(value.lastActive, 0)),
    width: typeof value.width === "number" && Number.isFinite(value.width) ? clampWidth(value.width) : null,
  };
}

export type DesktopLeafDecodeResult = { kind: "legacy" } | { kind: "ready"; state: DesktopLeafStateV1 | DesktopLeafStateV2 }
  | { kind: "unsupported"; raw: Record<string, unknown> };

/** Decode shape only. Unavailable vault sources remain authored stream references. */
export function decodeDesktopLeafState(value: unknown, settings: PluginSettings): DesktopLeafDecodeResult {
  if (value === undefined || value === null || (isRecord(value) && Object.keys(value).length === 0)) return { kind: "legacy" };
  const raw = isRecord(value) ? value : { value };
  const unsupported = (): DesktopLeafDecodeResult => ({ kind: "unsupported", raw });
  if ((raw.version !== 1 && raw.version !== 2) || !Array.isArray(raw.streams) || !isRecord(raw.navigation)
    || (raw.currentStreamId !== null && typeof raw.currentStreamId !== "string")) return unsupported();
  const streams: StreamSnapshot[] = [];
  const ids = new Set<string>();
  for (const value of raw.streams) {
    const stream = readStream(value, settings);
    if (!stream || ids.has(stream.id)) return unsupported();
    streams.push(stream); ids.add(stream.id);
  }
  const layout = raw.layout;
  if (raw.version === 2 && !validTiles(layout, ids)) return unsupported();
  if (typeof raw.currentStreamId === "string" && !ids.has(raw.currentStreamId)) return unsupported();
  if (raw.currentStreamId !== null) streams.find(stream => stream.id === raw.currentStreamId)!.desiredExpanded = true;
  // Maximizing is a view preference: an unknown target degrades to the tiled strip.
  const maximizedStreamId = typeof raw.maximizedStreamId === "string" && ids.has(raw.maximizedStreamId) ? raw.maximizedStreamId : null;
  if (maximizedStreamId !== null) streams.find(stream => stream.id === maximizedStreamId)!.desiredExpanded = true;
  const navigation = raw.navigation;
  const collapsed = isRecord(navigation.sectionCollapsed) ? navigation.sectionCollapsed : {};
  const sectionCollapsed = { ...settings.sectionCollapsed };
  for (const key of Object.keys(sectionCollapsed) as NavSectionId[]) {
    if (typeof collapsed[key] === "boolean") sectionCollapsed[key] = collapsed[key];
  }
  return {
    kind: "ready",
    state: {
      ...(raw.version === 2 ? {version: 2 as const, layout: layout as Tile | null} : {version: 1 as const}), streams, currentStreamId: raw.currentStreamId, maximizedStreamId,
      navigation: {
        width: Math.max(NAV_PANE_WIDTH_MIN, Math.min(NAV_PANE_WIDTH_MAX, finite(navigation.width, settings.navPaneWidth))),
        collapsed: typeof navigation.collapsed === "boolean" ? navigation.collapsed : settings.navPaneCollapsed,
        expandedFolderPaths: normalizeExpandedFolderPaths(navigation.expandedFolderPaths),
        expandedTagPaths: normalizeExpandedTagPaths(navigation.expandedTagPaths),
        expandedPropertyKeys: normalizeExpandedPropertyKeys(navigation.expandedPropertyKeys, new Set(settings.visiblePropertyKeys)),
        sectionCollapsed, query: typeof navigation.query === "string" ? navigation.query : "",
        focusId: typeof navigation.focusId === "string" ? navigation.focusId : null,
      },
    },
  };
}
