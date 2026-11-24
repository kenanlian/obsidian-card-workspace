import { tileGeometry, tileKey } from "./stream-tiles";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings";
import { LeafStreamController, decodeDesktopLeafState, type DesktopLeafStateV1, type LeafNavigationState, type StreamSnapshot } from "./stream-state";

function stream(id: string, lastActive = 0): StreamSnapshot {
  return {
    id, title: null, scope: { kind: "folder", path: id, includeSubfolders: true },
    browse: {
      filter: { tags: ["#a"], properties: [{ key: "project", values: [{ kind: "text", value: "A" }] }] },
      sort: { field: "mtime", direction: "desc" }, group: { dimension: "folder", orderBy: "name", orderDirection: "asc" },
      viewMode: "cards", taskSort: { field: "due", direction: "asc" }, taskGroup: { dimension: "file" },
    },
    query: "", searchOpen: false, linksPinned: false,
    taskFilters: { status: "incomplete", date: { field: "due", preset: "custom", start: "2026-11-01", end: "2026-11-30", weekEnd: 0 } },
    collapsedGroups: { folders: ["group-a"] }, anchor: { ref: { kind: "card", path: `${id}.md`, groupKey: "group-a" }, offset: -4 },
    anchorIndex: 2, desiredExpanded: true, lastActive, width: null,
  };
}
function navigation(): LeafNavigationState {
  return {
    width: 240, collapsed: false, expandedFolderPaths: ["Missing"], expandedTagPaths: ["tag"], expandedPropertyKeys: [],
    sectionCollapsed: { ...DEFAULT_SETTINGS.sectionCollapsed }, query: "find", focusId: "folder:Missing",
  };
}
function persisted(streams = [stream("a")]): DesktopLeafStateV1 {
  return { version: 1, streams, currentStreamId: streams[0]?.id ?? null, maximizedStreamId: null, navigation: navigation() };
}

describe("LeafStreamController", () => {
  it("keeps every expanded stream visible at any size and maximizes one stream at a time", () => {
    const controller = new LeafStreamController([stream("a", 1), stream("b", 2), stream("c", 3)]);
    controller.setSize(300, 800);
    expect(controller.getState().visibleIds).toEqual(["a", "b", "c"]);
    controller.toggleMaximized("b");
    expect(controller.getState()).toMatchObject({ maximizedStreamId: "b", currentStreamId: "b", visibleIds: ["b"] });
    controller.select("c");
    expect(controller.getState()).toMatchObject({ maximizedStreamId: "c", currentStreamId: "c", visibleIds: ["c"] });
    controller.toggleMaximized("c");
    expect(controller.getState()).toMatchObject({ maximizedStreamId: null, visibleIds: ["a", "b", "c"] });
    controller.toggleMaximized("a");
    controller.add(stream("d"));
    expect(controller.getState()).toMatchObject({ maximizedStreamId: null, currentStreamId: "d" });
    expect(controller.getState().streams.map(value => value.id)).toEqual(["a", "d", "b", "c"]);
    controller.toggleMaximized("d");
    controller.setExpanded("d", false);
    expect(controller.getState()).toMatchObject({ maximizedStreamId: null, currentStreamId: "b", visibleIds: ["a", "b", "c"] });
    controller.toggleMaximized("b");
    controller.remove("b");
    expect(controller.getState()).toMatchObject({ maximizedStreamId: null, currentStreamId: "c", visibleIds: ["a", "c"] });
  });

  it("splits a group across its full width and preserves nested proportions and identities", () => {
    const controller = new LeafStreamController([stream("a")]);
    controller.add(stream("b"));
    const row = controller.getState().layout!;
    controller.add(stream("c"), {target:tileKey(row), side:"bottom"});
    controller.setSize(1000,800);
    const geometry = () => {
      const state = controller.getState();
      return tileGeometry(state.layout, new Set(state.streams.filter(s => !s.desiredExpanded).map(s => s.id)),state.width,state.height);
    };
    const region = (id: string) => geometry().regions.find(r => r.stream === id);
    expect(region("a")).toMatchObject({width:500,height:400});
    expect(region("c")).toMatchObject({x:0,y:400,width:1000,height:400});
    controller.resizeSplit(row.id,0.3);
    expect(region("a")?.width).toBe(300);
    controller.setExpanded("c",false);
    expect(region("c")?.height).toBe(28);
    controller.select("c");
    const saved = controller.toJSON(navigation());
    controller.remove("c"); controller.reopen();
    expect(controller.getState().layout).toEqual(saved.version === 2 && saved.layout);
    controller.place("c",{target:"stream:b",side:"top"});
    expect(region("a")?.height).toBe(800);
    expect(region("b")?.y).toBe(400);
    controller.restore(saved);
    expect(region("c")?.width).toBe(1000);
    expect(decodeDesktopLeafState(saved,DEFAULT_SETTINGS).kind).toBe("ready");
    expect(decodeDesktopLeafState({...saved, layout:row},DEFAULT_SETTINGS).kind).toBe("unsupported");
  });

  it("migrates v1 widths on measurement, then keeps the split ratio", () => {
    const controller = new LeafStreamController();
    controller.restore(persisted([{...stream("a"),width:300},stream("b")]));
    controller.setSize(1006,600);
    expect(controller.getState().layout).toMatchObject({axis:"x",ratio:0.3});
    controller.setSize(1506,600);
    expect(controller.getState().layout).toMatchObject({ratio:0.3});
  });

  it("uses the next effective tile then the previous tile when collapsing or closing current", () => {
    const controller = new LeafStreamController([stream("a"), stream("b"), stream("c"), stream("d")]);
    controller.select("b");
    controller.setExpanded("b", false);
    expect(controller.getState().currentStreamId).toBe("c");
    controller.remove("c");
    expect(controller.getState().currentStreamId).toBe("d");
    controller.setExpanded("d", false);
    expect(controller.getState().currentStreamId).toBe("a");
    controller.setExpanded("a", false);
    expect(controller.getState().currentStreamId).toBeNull();
    expect(controller.getState().visibleIds).toEqual([]);
    controller.setSize(5000, 5000);
    expect(controller.getState().visibleIds).toEqual([]);
  });

  it("adds after current with no stream cap and moves streams by index", () => {
    const controller = new LeafStreamController([stream("a"), stream("b"), stream("c")]);
    controller.select("b");
    controller.add(stream("d"));
    expect(controller.getState().streams.map(value => value.id)).toEqual(["a", "b", "d", "c"]);
    expect(controller.getState().currentStreamId).toBe("d");
    for (let index = 0; index < 20; index++) controller.add(stream(`extra-${index}`));
    expect(controller.getState().streams).toHaveLength(24);
    controller.reorder("extra-19", -1);
    expect(controller.getState().streams[controller.getState().streams.findIndex(value => value.id === "extra-18") - 1].id).toBe("extra-19");
    controller.move("a", 99);
    expect(controller.getState().streams.at(-1)!.id).toBe("a");
    controller.move("a", 0);
    expect(controller.getState().streams[0].id).toBe("a");
  });

  it("isolates input, public state, update payloads, closed snapshots and serialization", () => {
    const input = stream("a");
    const controller = new LeafStreamController([input]);
    input.browse.filter.tags.push("#external");
    const state = controller.getState();
    state.streams[0].browse.filter.properties[0].values[0] = { kind: "text", value: "changed" };
    state.streams[0].taskFilters.date!.start = "bad";
    state.streams[0].collapsedGroups.folders.push("changed");
    state.streams[0].anchor!.ref = { kind: "group", key: "changed" };
    const browse = stream("b").browse;
    controller.update("a", { browse });
    browse.filter.tags.push("#other");
    expect(controller.getState().streams[0]).toEqual(stream("a"));
    const nav = navigation();
    const serialized = controller.toJSON(nav);
    nav.expandedFolderPaths.push("external");
    serialized.streams[0].browse.group.dimension = "none";
    serialized.navigation.sectionCollapsed.folders = true;
    expect(controller.toJSON(navigation()).streams[0].browse.group.dimension).toBe("folder");
    const removed = controller.remove("a")!;
    removed.browse.filter.tags.push("#external");
    expect(controller.reopen()!.browse.filter.tags).toEqual(["#a"]);
  });

  it("notifies immediately, suppresses equal updates, and unsubscribes", () => {
    const controller = new LeafStreamController([stream("a")]);
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    controller.update("a", { browse: stream("a").browse });
    controller.update("a", { query: "" });
    controller.select("a");
    controller.setExpanded("a", true);
    controller.setSize(0, 0);
    controller.resizeSplit("missing", Number.NaN);
    controller.move("a", 0);
    controller.reorder("a", -1);
    expect(listener).toHaveBeenCalledTimes(1);
    controller.update("a", { query: "search" });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(controller.getState().revision).toBe(1);
    unsubscribe();
    controller.update("a", { query: "next" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("retains ten recent closes, reopens in reverse close order and preserves positions", () => {
    const controller = new LeafStreamController([stream("a"), stream("b"), stream("c")]);
    controller.remove("b");
    controller.remove("a");
    controller.reopen();
    controller.reopen();
    expect(controller.getState().streams.map(value => value.id)).toEqual(["a", "b", "c"]);
    expect(controller.getState().currentStreamId).toBe("b");
    const many = new LeafStreamController(Array.from({ length: 12 }, (_, index) => stream(`${index}`)));
    for (let index = 0; index < 12; index++) many.remove(`${index}`);
    expect(many.getState().recentlyClosedCount).toBe(10);
    for (let index = 11; index >= 2; index--) expect(many.reopen()!.id).toBe(`${index}`);
    expect(many.reopen()).toBeUndefined();
    expect(many.getState().streams).toHaveLength(10);
  });

  it("does not remember transfer removal and gives reopened colliding IDs distinct identities", () => {
    const controller = new LeafStreamController([stream("a"), stream("b")]);
    expect(controller.remove("a", false)?.id).toBe("a");
    expect(controller.getState().recentlyClosedCount).toBe(0);
    expect(controller.reopen()).toBeUndefined();
    controller.remove("b");
    controller.add(stream("b"));
    expect(controller.reopen()?.id).toBe("b-1");
    expect(controller.getState().streams.map(value => value.id)).toEqual(["b", "b-1"]);
  });

  it("atomically rewrites live and recently closed sources and anchors without changing identities", () => {
    const controller = new LeafStreamController([stream("a"), stream("b"), stream("c")]);
    controller.remove("b");
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.mapSnapshots(snapshot => ({
      ...snapshot,
      id: "replacement-id",
      scope: snapshot.scope.kind === "folder" ? { ...snapshot.scope, path: `renamed/${snapshot.scope.path}` } : snapshot.scope,
      anchor: snapshot.anchor?.ref.kind === "card"
        ? { ...snapshot.anchor, ref: { ...snapshot.anchor.ref, path: `renamed/${snapshot.anchor.ref.path}` } }
        : snapshot.anchor,
    }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(controller.getState().streams.map(value => value.id)).toEqual(["a", "c"]);
    expect(controller.getState().currentStreamId).toBe("a");
    expect(controller.getState().streams[0].scope).toEqual({ kind: "folder", path: "renamed/a", includeSubfolders: true });
    controller.mapSnapshots(snapshot => snapshot);
    expect(listener).toHaveBeenCalledTimes(2);
    const reopened = controller.reopen()!;
    expect(reopened.id).toBe("b");
    expect(reopened.scope).toEqual({ kind: "folder", path: "renamed/b", includeSubfolders: true });
    expect(reopened.anchor).toEqual({ ref: { kind: "card", path: "renamed/b.md", groupKey: "group-a" }, offset: -4 });
    expect(controller.getState().streams.map(value => value.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves all snapshots untouched when an atomic rewrite fails", () => {
    const controller = new LeafStreamController([stream("a"), stream("b")]);
    controller.remove("b");
    const before = controller.getState();
    expect(() => controller.mapSnapshots(snapshot => {
      snapshot.query = "changed";
      if (snapshot.id === "b") throw new Error("rewrite failed");
      return snapshot;
    })).toThrow("rewrite failed");
    expect(controller.getState()).toEqual(before);
    expect(controller.reopen()!.query).toBe("");
  });

  it("restores deep state, clears recent closes, and keeps MRU monotonic across restores", () => {
    const controller = new LeafStreamController([stream("a", 100)]);
    controller.remove("a");
    const saved = persisted([stream("x", 5), stream("y", 10)]);
    saved.maximizedStreamId = "y";
    controller.restore(saved);
    saved.streams[0].browse.filter.tags.push("external");
    controller.select("y");
    expect(controller.getState().streams.find(value => value.id === "y")!.lastActive).toBeGreaterThan(100);
    expect(controller.getState().streams[0].browse.filter.tags).toEqual(["#a"]);
    expect(controller.getState().recentlyClosedCount).toBe(0);
    expect(controller.getState().maximizedStreamId).toBe("y");
  });
});

describe("decodeDesktopLeafState", () => {
  it("recognizes legacy state, retains valid empty leaves and preserves unknown version raw state", () => {
    expect(decodeDesktopLeafState(undefined, DEFAULT_SETTINGS)).toEqual({ kind: "legacy" });
    expect(decodeDesktopLeafState({}, DEFAULT_SETTINGS)).toEqual({ kind: "legacy" });
    expect(decodeDesktopLeafState(persisted([]), DEFAULT_SETTINGS)).toEqual({ kind: "ready", state: persisted([]) });
    const future = { version: 23, futureStreams: [{ source: "unknown" }] };
    const decoded = decodeDesktopLeafState(future, DEFAULT_SETTINGS);
    expect(decoded).toEqual({ kind: "unsupported", raw: future });
    if (decoded.kind === "unsupported") expect(decoded.raw).toBe(future);
  });

  it("round-trips all scope kinds without requiring folders, boxes or notes to exist", () => {
    const snapshots = [stream("folder"), stream("box"), stream("links")];
    snapshots[0].scope = { kind: "folder", path: "Missing/Folder", includeSubfolders: false };
    snapshots[1].scope = { kind: "box", boxId: "deleted-box" };
    snapshots[2].scope = { kind: "links", notePath: "Deleted.md", direction: "outgoing" };
    const input = persisted(snapshots);
    const decoded = decodeDesktopLeafState(input, DEFAULT_SETTINGS);
    expect(decoded).toEqual({ kind: "ready", state: input });
    if (decoded.kind === "ready") {
      decoded.state.streams[0].browse.filter.properties[0].values.push({ kind: "missing" });
      expect(input.streams[0].browse.filter.properties[0].values).toHaveLength(1);
    }
  });

  it.each([
    { version: 1 },
    { ...persisted(), streams: [{ ...stream("a"), scope: { kind: "folder" } }] },
    { ...persisted(), streams: [{ ...stream("a"), scope: { kind: "unknown" } }] },
    { ...persisted(), streams: [{ ...stream("a"), browse: null }] },
    { ...persisted(), streams: [stream("same"), stream("same")], currentStreamId: "same" },
    { ...persisted(), currentStreamId: "missing" },
    { ...persisted(), streams: [null] },
    { ...persisted(), streams: "invalid" },
  ])("rejects malformed v1 without replacing it with a vault root: %j", input => {
    expect(decodeDesktopLeafState(input, DEFAULT_SETTINGS)).toEqual({ kind: "unsupported", raw: input });
  });

  it("sanitizes bounded serializable fields and strips unrelated settings or cache data", () => {
    const input = persisted() as unknown as Record<string, unknown>;
    const snapshot = (input.streams as Record<string, unknown>[])[0];
    snapshot.width = Number.NaN;
    snapshot.anchor = { ref: { kind: "card-index", index: -1 }, offset: 3 };
    snapshot.anchorIndex = -50;
    snapshot.collapsedGroups = { good: ["a", 3, "b"] };
    snapshot.settings = DEFAULT_SETTINGS;
    snapshot.cache = { large: true };
    snapshot.taskFilters = { status: "unknown", date: { field: "due", preset: "custom", start: "invalid", end: "invalid", weekEnd: 99 } };
    const browse = snapshot.browse as Record<string, unknown>;
    browse.filter = { tags: ["#a", 3, ""], properties: [{ key: " Project ", values: [{ kind: "number", value: Infinity }, { kind: "text", value: "A" }] }] };
    browse.group = { dimension: "ctime", timeGranularity: "invalid" };
    input.navigation = { ...navigation(), width: Infinity, expandedFolderPaths: ["Missing", "Missing", 4] };
    const decoded = decodeDesktopLeafState(input, DEFAULT_SETTINGS);
    expect(decoded.kind).toBe("ready");
    if (decoded.kind !== "ready") return;
    const result = decoded.state.streams[0];
    expect(result.width).toBeNull();
    expect(result.anchor).toBeNull();
    expect(result.anchorIndex).toBe(0);
    expect(result.collapsedGroups).toEqual({ good: ["a", "b"] });
    expect(result.browse.filter).toEqual({ tags: ["#a"], properties: [{ key: "project", values: [{ kind: "text", value: "A" }] }] });
    expect(result.browse.group).toEqual({ dimension: "ctime", timeGranularity: "day", orderBy: "default", orderDirection: "asc" });
    expect(result.taskFilters).toEqual({ status: "all", date: null });
    expect(result).not.toHaveProperty("settings");
    expect(result).not.toHaveProperty("cache");
    expect(decoded.state.navigation.width).toBe(DEFAULT_SETTINGS.navPaneWidth);
    expect(decoded.state.navigation.expandedFolderPaths).toEqual(["Missing"]);
  });

  it("ignores earlier arrangement fields, clamps saved widths and keeps a maximized stream expanded", () => {
    const input = { ...persisted([stream("a"), stream("b")]), direction: "vertical", maximizedStreamId: "b" } as Record<string, unknown>;
    const streams = input.streams as Record<string, unknown>[];
    Object.assign(streams[0], { widthWeight: 3, width: 12 });
    Object.assign(streams[1], { width: "wide", desiredExpanded: false });
    const decoded = decodeDesktopLeafState(input, DEFAULT_SETTINGS);
    expect(decoded.kind).toBe("ready");
    if (decoded.kind !== "ready") return;
    expect(decoded.state).not.toHaveProperty("direction");
    expect(decoded.state.maximizedStreamId).toBe("b");
    expect(decoded.state.streams.map(value => [value.width, value.desiredExpanded])).toEqual([[240, true], [null, true]]);
    expect(decoded.state.streams[0]).not.toHaveProperty("widthWeight");
    const unknown = decodeDesktopLeafState({ ...persisted(), maximizedStreamId: "missing" }, DEFAULT_SETTINGS);
    expect(unknown.kind === "ready" && unknown.state.maximizedStreamId).toBeNull();
  });
});
