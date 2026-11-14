import { describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { BoxDrawController } from "./BoxDrawController";
import { createViewStateStore } from "../view-state-store";
import { createBoxScope, createFolderScope } from "../scope";
import { createCardBox } from "../card-boxes";
import { normalizeSettings } from "../../settings";
import { getUiStrings } from "../../i18n";
import type { ViewContext } from "../view-context";
import { createViewEpochs } from "../view-epochs";

function harness(mode: "random" | "cycle" | "daily" = "cycle") {
  const files = new Map(["a.md", "b.md", "c.md"].map(path => [path, Object.assign(new TFile(), { path })]));
  const box = { ...createCardBox("Box", []), id: "box", manualPaths: [...files.keys()], draw: { mode, count: 2 } };
  const settings = normalizeSettings({ boxes: [box] });
  const store = createViewStateStore(createBoxScope("box"));
  let query = "";
  let pool = [...files.keys()];
  const publish = vi.fn();
  const save = vi.fn(async patch => { Object.assign(settings, patch); });
  const context: ViewContext = {
    store, epochs: createViewEpochs(), getSettings: () => settings,
    getApp: () => ({ vault: { getAbstractFileByPath: (path: string) => files.get(path) }, metadataCache: { getFileCache: () => ({}) } }) as unknown as App,
    getUiStrings: () => getUiStrings("en"), saveSettings: save, publishGroups: publish,
    requestUpdate: async () => {}, notify: vi.fn(), getViewWindow: () => globalThis as unknown as Window,
  };
  const controller = new BoxDrawController(context, { pool: () => pool, query: () => query, reproject: vi.fn() });
  return { controller, context, settings, store, files, save, setQuery: (value: string) => { query = value; }, setPool: (paths: string[]) => { pool = paths; } };
}

describe("BoxDrawController", () => {
  it("keeps random groups local and stable across maintenance, and discards them on scope changes", async () => {
    const h = harness("random");
    await h.controller.enter();
    const first = h.store.getDrawPaths();
    h.controller.sync(); h.controller.reconcile();
    expect(h.store.getDrawPaths()).toEqual(first);
    expect(h.save).not.toHaveBeenCalled();
    h.store.setScope(createFolderScope("", true));
    expect(h.controller.active).toBe(false);
    expect(h.controller.available).toBe(false);
  });
  it("restores persisted groups and pauses next during search", async () => {
    const h = harness();
    await h.controller.enter();
    const first = [...h.store.getDrawPaths()!];
    h.controller.exit(); await h.controller.enter();
    expect(h.store.getDrawPaths()).toEqual(first);
    expect(h.save).toHaveBeenCalledTimes(1);
    h.setQuery("search"); await h.controller.next();
    expect(h.save).toHaveBeenCalledTimes(1);
    h.setQuery(""); await h.controller.next();
    expect(h.store.getDrawPaths()).toHaveLength(1);
  });
  it("does not refill hidden cards or partial departures, but refills after the last departure", async () => {
    const h = harness();
    await h.controller.enter();
    const first = [...h.store.getDrawPaths()!];
    h.setPool([]); h.controller.reconcile();
    expect(h.store.getDrawPaths()).toEqual(first);
    h.files.delete(first[0]!); h.controller.reconcile();
    expect(h.store.getDrawPaths()).toEqual(first.slice(1));
    h.files.delete(first[1]!);
    h.settings.boxes[0]!.drawProgress!.currentGroup!.paths = [];
    h.setPool([...h.files.keys()]); h.controller.reconcile();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(h.store.getDrawPaths()).toEqual([...h.files.keys()]);
  });
  it("never offers an extra daily group and reset immediately generates a new first round", async () => {
    const h = harness("daily");
    await h.controller.enter();
    expect(h.controller.canNext).toBe(false);
    await h.controller.reset("box");
    expect(h.settings.boxes[0]!.drawProgress?.round).toBe(1);
    expect(h.settings.boxes[0]!.drawProgress?.drawnPaths).toHaveLength(2);
  });
  it("drops an enter waiting for settings when disposed", async () => {
    const h = harness();
    let release!: () => void;
    h.context.waitForSettings = () => new Promise(resolve => { release = resolve; });
    const enter = h.controller.enter();
    h.controller.dispose(); release(); await enter;
    expect(h.save).not.toHaveBeenCalled();
    expect(h.store.getDrawPaths()).toBeNull();
  });
});

it("adopts a newer shared group after its earlier save settles", async () => {
  const h = harness();
  let release!: () => void;
  h.save.mockImplementationOnce(async patch => {
    Object.assign(h.settings, patch);
    await new Promise<void>(resolve => { release = resolve; });
  });
  const enter = h.controller.enter();
  await Promise.resolve();
  h.settings.boxes[0]!.drawProgress = { round: 2, drawnPaths: ["c.md"], currentGroup: { paths: ["c.md"] } };
  h.controller.sync();
  release(); await enter;
  expect(h.store.getDrawPaths()).toEqual(["c.md"]);
  expect(h.controller.snapshot().round).toBe(2);
});
