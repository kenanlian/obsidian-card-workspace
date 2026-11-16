import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings";
import { LeafStreamController, decodeDesktopLeafState, resolveStreamSizes, type DesktopLeafStateV1, type LeafNavigationState, type StreamSnapshot } from "./stream-state";

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
    anchorIndex: 2, desiredExpanded: true, lastActive, widthWeight: 1, heightWeight: 1,
  };
}
function navigation(): LeafNavigationState {
  return {
    width: 240, collapsed: false, expandedFolderPaths: ["Missing"], expandedTagPaths: ["tag"], expandedPropertyKeys: [],
    sectionCollapsed: { ...DEFAULT_SETTINGS.sectionCollapsed }, query: "find", focusId: "folder:Missing",
  };
}
function persisted(streams = [stream("a")]): DesktopLeafStateV1 {
  return { version: 1, streams, currentStreamId: streams[0]?.id ?? null, direction: "horizontal", navigation: navigation() };
}

describe("LeafStreamController", () => {
  it("keeps current and MRU tiles when shrinking, then restores desired streams in list order", () => {
    const controller = new LeafStreamController([stream("a", 1), stream("b", 2), stream("c", 3), stream("d", 4)]);
    expect(controller.getState().visibleIds).toEqual(["a", "b", "c", "d"]);
    controller.setSize(732, 800);
    expect(controller.getState().visibleIds).toEqual(["a", "c", "d"]);
    controller.setSize(486, 800);
    expect(controller.getState().visibleIds).toEqual(["a", "d"]);
    controller.select("b");
    expect(controller.getState().visibleIds).toEqual(["b", "d"]);
    expect(controller.getState().streams.every(value => value.desiredExpanded)).toBe(true);
    controller.setSize(1000, 800);
    expect(controller.getState().visibleIds).toEqual(["a", "b", "c", "d"]);
    controller.setDirection("vertical");
    controller.setSize(1000, 406);
    expect(controller.getState().visibleIds).toEqual(["b", "d"]);
  });

  it("breaks MRU ties by stream order and handles zero sizes and space smaller than one tile", () => {
    const controller = new LeafStreamController([stream("a"), stream("b"), stream("c"), stream("d")]);
    controller.setSize(486, 0);
    expect(controller.getState().visibleIds).toEqual(["a", "b"]);
    controller.setSize(1, 1);
    expect(controller.getState().visibleIds).toEqual(["a"]);
    expect(resolveStreamSizes(controller.getState())).toEqual({ a: 1 });
    controller.setSize(0, 0);
    expect(controller.getState().visibleIds).toEqual(["a", "b", "c", "d"]);
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

  it("does not select an automatically collapsed tile after manually collapsing the sole effective current", () => {
    const controller = new LeafStreamController([stream("a"), stream("b"), stream("c")]);
    controller.setSize(240, 200);
    controller.setExpanded("a", false);
    expect(controller.getState().currentStreamId).toBeNull();
    expect(controller.getState().streams.find(value => value.id === "b")?.desiredExpanded).toBe(true);
  });

  it("showOnly changes desired expansion and add inserts after current with no stream cap", () => {
    const controller = new LeafStreamController([stream("a"), stream("b"), stream("c")]);
    controller.showOnly("b");
    controller.add(stream("d"));
    expect(controller.getState().streams.map(value => value.id)).toEqual(["a", "b", "d", "c"]);
    expect(controller.getState().visibleIds).toEqual(["b", "d"]);
    expect(controller.getState().currentStreamId).toBe("d");
    controller.showOnly("c");
    controller.setSize(10000, 10000);
    expect(controller.getState().visibleIds).toEqual(["c"]);
    for (let index = 0; index < 20; index++) controller.add(stream(`extra-${index}`));
    expect(controller.getState().streams).toHaveLength(24);
    controller.reorder("extra-19", -1);
    expect(controller.getState().streams[controller.getState().streams.findIndex(value => value.id === "extra-18") - 1].id).toBe("extra-19");
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
    controller.setDirection("horizontal");
    controller.showOnly("a");
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
    expect(controller.getState().streams.map(value => value.id)).toEqual(["b-1", "b"]);
  });

  it("resizes only an adjacent visible pair with minimums, independent directional weights and fixed other sizes", () => {
    const controller = new LeafStreamController([stream("a"), stream("b"), stream("c")]);
    controller.setSize(1200, 1000);
    expect(resolveStreamSizes(controller.getState())).toEqual({ a: 396, b: 396, c: 396 });
    controller.resizePair("a", "c", 100);
    expect(resolveStreamSizes(controller.getState()).a).toBe(396);
    controller.resizePair("a", "b", 100);
    expect(resolveStreamSizes(controller.getState())).toEqual({ a: 496, b: 296, c: 396 });
    controller.resizePair("a", "b", -1000);
    const sizes = resolveStreamSizes(controller.getState());
    expect(sizes.a).toBeCloseTo(240);
    expect(sizes.b).toBeCloseTo(552);
    expect(sizes.c).toBe(396);
    expect(controller.getState().streams.every(value => value.widthWeight > 0 && value.heightWeight === 1)).toBe(true);
    controller.setDirection("vertical");
    controller.resizePair("a", "b", 50);
    const vertical = resolveStreamSizes(controller.getState());
    expect(vertical.a - vertical.b).toBeCloseTo(100);
    expect(vertical.c).toBeCloseTo((1000 - 12) / 3);
    controller.setDirection("horizontal");
    expect(resolveStreamSizes(controller.getState()).c).toBe(396);
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
    saved.direction = "vertical";
    controller.restore(saved);
    saved.streams[0].browse.filter.tags.push("external");
    controller.select("y");
    expect(controller.getState().streams.find(value => value.id === "y")!.lastActive).toBeGreaterThan(100);
    expect(controller.getState().streams[0].browse.filter.tags).toEqual(["#a"]);
    expect(controller.getState().recentlyClosedCount).toBe(0);
    expect(controller.getState().direction).toBe("vertical");
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
    { ...persisted(), direction: "diagonal" },
    { ...persisted(), streams: [null] },
    { ...persisted(), streams: "invalid" },
  ])("rejects malformed v1 without replacing it with a vault root: %j", input => {
    expect(decodeDesktopLeafState(input, DEFAULT_SETTINGS)).toEqual({ kind: "unsupported", raw: input });
  });

  it("sanitizes bounded serializable fields and strips unrelated settings or cache data", () => {
    const input = persisted() as unknown as Record<string, unknown>;
    const snapshot = (input.streams as Record<string, unknown>[])[0];
    snapshot.widthWeight = Number.NaN;
    snapshot.heightWeight = -1;
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
    expect(result.widthWeight).toBe(1);
    expect(result.heightWeight).toBeGreaterThan(0);
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
});
