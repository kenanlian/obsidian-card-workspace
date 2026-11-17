import { normalizeGroupSpec } from "../card-grouping-settings";
import { normalizeExpandedFolderPaths, normalizeExpandedTagPaths } from "../navigation-expansion-settings";
import { normalizeExpandedPropertyKeys, normalizePropertyFilterClauses } from "../property-filter-settings";
import { NAV_PANE_WIDTH_MAX, NAV_PANE_WIDTH_MIN, normalizeLinksSort, type PluginSettings } from "../settings";
import { normalizeDefaultViewMode, normalizeTaskGroupSpec, normalizeTaskSortSpec } from "../task-view-settings";
import { isValidIsoDate } from "../tasks/task-dates";
import type { CardScope } from "./scope";
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
  /** Pixel width in the stream strip; null shares the remaining width. */
  width: number | null;
}

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

export interface LeafStreamState {
  streams: readonly StreamSnapshot[];
  currentStreamId: string | null;
  maximizedStreamId: string | null;
  visibleIds: readonly string[];
  width: number;
  height: number;
  revision: number;
  recentlyClosedCount: number;
}

export const STREAM_MIN_WIDTH = 240;
/** One card column: the card minimum width plus list padding. */
export const STREAM_DEFAULT_WIDTH = 320;
export const STREAM_MAX_WIDTH = 4000;
export const STREAM_SPINE_WIDTH = 28;
export const STREAM_SEPARATOR_SIZE = 6;

function clampWidth(width: number): number {
  return Math.round(Math.max(STREAM_MIN_WIDTH, Math.min(STREAM_MAX_WIDTH, width)));
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
  private streams: StreamSnapshot[];
  private currentStreamId: string | null;
  private maximizedStreamId: string | null = null;
  private width = 0;
  private height = 0;
  private revision = 0;
  private clock = 0;
  private readonly listeners = new Set<(state: LeafStreamState) => void>();
  private readonly closed: { stream: StreamSnapshot; index: number }[] = [];

  constructor(initialStreams: StreamSnapshot[] = []) {
    if (new Set(initialStreams.map(stream => stream.id)).size !== initialStreams.length) throw new Error("Duplicate stream ID");
    this.streams = initialStreams.map(cloneStream);
    this.currentStreamId = this.streams.find(stream => stream.desiredExpanded)?.id ?? null;
    this.clock = this.streams.reduce((clock, stream) => Math.max(clock, stream.lastActive), 0);
  }

  getState(): LeafStreamState {
    return {
      streams: this.streams.map(cloneStream), currentStreamId: this.currentStreamId, maximizedStreamId: this.maximizedStreamId,
      visibleIds: this.visibleIds(), width: this.width, height: this.height,
      revision: this.revision, recentlyClosedCount: this.closed.length,
    };
  }

  subscribe(listener: (state: LeafStreamState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  /** Inserts after the current stream. Existing streams keep their rendered widths; the new one starts as one column. */
  add(snapshot: StreamSnapshot, index?: number): void {
    if (this.streams.some(stream => stream.id === snapshot.id)) return;
    const currentIndex = this.streams.findIndex(stream => stream.id === this.currentStreamId);
    const insertion = index === undefined ? (currentIndex < 0 ? this.streams.length : currentIndex + 1) : this.boundIndex(index);
    this.maximizedStreamId = null;
    this.freezeWidths();
    const stream = cloneStream(snapshot);
    stream.desiredExpanded = true;
    stream.width = stream.width === null ? STREAM_DEFAULT_WIDTH : clampWidth(stream.width);
    this.clock = Math.max(this.clock, stream.lastActive);
    stream.lastActive = ++this.clock;
    this.streams.splice(insertion, 0, stream);
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
    const [stream] = this.streams.splice(from, 1);
    this.streams.splice(target, 0, stream);
    this.publish();
  }

  remove(id: string, remember = true): StreamSnapshot | undefined {
    const index = this.streams.findIndex(stream => stream.id === id);
    if (index < 0) return undefined;
    if (this.maximizedStreamId === id) this.maximizedStreamId = null;
    const visible = this.visibleIds();
    const [stream] = this.streams.splice(index, 1);
    if (remember) {
      this.closed.push({ stream: cloneStream(stream), index });
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
    this.add(closed.stream, closed.index);
    return cloneStream(this.streams.find(stream => stream.id === closed.stream.id)!);
  }

  setSize(width: number, height: number): void {
    const nextWidth = Number.isFinite(width) ? Math.max(0, width) : 0;
    const nextHeight = Number.isFinite(height) ? Math.max(0, height) : 0;
    if (nextWidth === this.width && nextHeight === this.height) return;
    this.width = nextWidth; this.height = nextHeight;
    this.publish();
  }

  /** Resizing one stream moves the streams after it instead of shrinking them. */
  setWidth(id: string, width: number): void {
    const stream = this.streams.find(value => value.id === id);
    if (!stream || !Number.isFinite(width)) return;
    const next = clampWidth(width);
    if (stream.width === next) return;
    stream.width = next;
    this.publish();
  }

  /** Rewrite live and closed snapshots together, without changing their identities. */
  mapSnapshots(rewrite: (snapshot: StreamSnapshot) => StreamSnapshot): void {
    const rewriteStream = (stream: StreamSnapshot): StreamSnapshot =>
      cloneStream({ ...rewrite(cloneStream(stream)), id: stream.id });
    // Build the complete replacement before publication, including when a rewrite throws.
    const streams = this.streams.map(rewriteStream);
    const closed = this.closed.map(entry => ({ stream: rewriteStream(entry.stream), index: entry.index }));
    if (equal(this.streams, streams) && equal(this.closed, closed)) return;
    this.streams = streams;
    this.closed.splice(0, this.closed.length, ...closed);
    this.clock = streams.reduce((clock, stream) => Math.max(clock, stream.lastActive), this.clock);
    this.publish();
  }

  restore(state: DesktopLeafStateV1): void {
    const changed = !equal(this.streams, state.streams) || this.currentStreamId !== state.currentStreamId
      || this.maximizedStreamId !== state.maximizedStreamId || this.closed.length > 0;
    if (!changed) return;
    this.streams = state.streams.map(cloneStream);
    this.currentStreamId = state.currentStreamId;
    this.maximizedStreamId = state.maximizedStreamId;
    this.clock = this.streams.reduce((clock, stream) => Math.max(clock, stream.lastActive), this.clock);
    this.closed.length = 0;
    this.publish();
  }

  toJSON(navigation: LeafNavigationState): DesktopLeafStateV1 {
    return {
      version: 1, streams: this.streams.map(cloneStream), currentStreamId: this.currentStreamId,
      maximizedStreamId: this.maximizedStreamId, navigation: cloneNavigation(navigation),
    };
  }

  private visibleIds(): string[] {
    if (this.maximizedStreamId !== null && this.streams.some(stream => stream.id === this.maximizedStreamId)) return [this.maximizedStreamId];
    return this.streams.filter(stream => stream.desiredExpanded).map(stream => stream.id);
  }

  private freezeWidths(): void {
    if (this.width <= 0) return;
    for (const item of resolveStreamLayout(this.getState())) {
      const stream = item.display === "stream" ? this.streams.find(value => value.id === item.id) : undefined;
      if (stream) stream.width = clampWidth(item.width);
    }
  }

  private selectAdjacent(index: number, visibleIds: string[], removed = false): void {
    const visible = new Set(visibleIds);
    const after = this.streams.slice(removed ? index : index + 1).find(stream => visible.has(stream.id));
    const before = this.streams.slice(0, index).reverse().find(stream => visible.has(stream.id));
    const next = after ?? before;
    this.currentStreamId = next?.id ?? null;
    if (next) next.lastActive = ++this.clock;
  }

  private boundIndex(index: number): number {
    return Number.isFinite(index) ? Math.max(0, Math.min(this.streams.length, Math.trunc(index))) : this.streams.length;
  }

  private publish(): void {
    this.revision++;
    for (const listener of this.listeners) listener(this.getState());
  }
}

export interface StreamLayoutItem {
  id: string;
  display: "stream" | "spine";
  width: number;
  /** A resize separator follows this expanded item only when another item follows. */
  separator: boolean;
}

/**
 * Strip layout in list order. Fixed widths never shrink to fit; null widths share
 * the rest, and the last expanded stream absorbs spare space. Without a measured
 * stage the layout reports each stream's own width.
 */
export function resolveStreamLayout(state: Pick<LeafStreamState, "streams" | "maximizedStreamId" | "width">): StreamLayoutItem[] {
  const stage = Math.max(0, state.width);
  const maximized = state.maximizedStreamId === null ? undefined : state.streams.find(stream => stream.id === state.maximizedStreamId);
  if (maximized) return [{ id: maximized.id, display: "stream", width: stage > 0 ? stage : maximized.width ?? STREAM_DEFAULT_WIDTH, separator: false }];
  const expanded = state.streams.filter(stream => stream.desiredExpanded);
  const lastStream = state.streams.at(-1);
  // The host owns resizing at the outer edge; only internal boundaries need handles.
  const separatorCount = expanded.length - (lastStream?.desiredExpanded ? 1 : 0);
  const widths = new Map<string, number>();
  if (stage <= 0) {
    for (const stream of expanded) widths.set(stream.id, stream.width ?? STREAM_DEFAULT_WIDTH);
  } else {
    const base = stage - (state.streams.length - expanded.length) * STREAM_SPINE_WIDTH - separatorCount * STREAM_SEPARATOR_SIZE;
    if (expanded.length === 1) widths.set(expanded[0].id, Math.max(0, base));
    else if (expanded.length > 1) {
      const flexible = expanded.filter(stream => stream.width === null);
      const remaining = base - expanded.reduce((sum, stream) => sum + (stream.width ?? 0), 0);
      const share = flexible.length > 0 ? Math.max(STREAM_MIN_WIDTH, Math.floor(remaining / flexible.length)) : 0;
      for (const stream of expanded) widths.set(stream.id, stream.width ?? share);
      const spare = base - [...widths.values()].reduce((sum, width) => sum + width, 0);
      const last = expanded[expanded.length - 1];
      if (spare > 0) widths.set(last.id, widths.get(last.id)! + spare);
    }
  }
  return state.streams.map((stream): StreamLayoutItem => stream.desiredExpanded
    ? { id: stream.id, display: "stream", width: widths.get(stream.id)!, separator: stream.id !== lastStream?.id }
    : { id: stream.id, display: "spine", width: STREAM_SPINE_WIDTH, separator: false });
}

/** Strip width that shows every stream at its own width without stretching any of them. */
export function resolveRequiredStripWidth(state: Pick<LeafStreamState, "streams" | "maximizedStreamId">): number {
  return resolveStreamLayout({ ...state, width: 0 })
    .reduce((sum, item) => sum + item.width + (item.separator ? STREAM_SEPARATOR_SIZE : 0), 0);
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

export type DesktopLeafDecodeResult = { kind: "legacy" } | { kind: "ready"; state: DesktopLeafStateV1 }
  | { kind: "unsupported"; raw: Record<string, unknown> };

/** Decode shape only. Unavailable vault sources remain authored stream references. */
export function decodeDesktopLeafState(value: unknown, settings: PluginSettings): DesktopLeafDecodeResult {
  if (value === undefined || value === null || (isRecord(value) && Object.keys(value).length === 0)) return { kind: "legacy" };
  const raw = isRecord(value) ? value : { value };
  const unsupported = (): DesktopLeafDecodeResult => ({ kind: "unsupported", raw });
  if (raw.version !== 1 || !Array.isArray(raw.streams) || !isRecord(raw.navigation)
    || (raw.currentStreamId !== null && typeof raw.currentStreamId !== "string")) return unsupported();
  const streams: StreamSnapshot[] = [];
  const ids = new Set<string>();
  for (const value of raw.streams) {
    const stream = readStream(value, settings);
    if (!stream || ids.has(stream.id)) return unsupported();
    streams.push(stream); ids.add(stream.id);
  }
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
      version: 1, streams, currentStreamId: raw.currentStreamId, maximizedStreamId,
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
