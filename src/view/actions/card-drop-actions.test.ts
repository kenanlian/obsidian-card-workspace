import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder } from "obsidian";
import { applyDroppedProperty, CardDropActions } from "./card-drop-actions";
import { createViewStateStore } from "../view-state-store";
import { createFolderScope } from "../scope";
import { getUiStrings } from "../../i18n";

function file(path: string, extension = "md") { const result = new TFile(); result.path = path; result.extension = extension; return result; }
function setup(frontmatter: Record<string, unknown> = {}) {
  const first = file("first.md"), second = file("second.md"), image = file("pic.png", "png");
  const live = new Map([first, second, image].map(entry => [entry.path, entry]));
  const processFrontMatter = vi.fn(async (_file: TFile, mutate: (fm: Record<string, unknown>) => void) => mutate(frontmatter));
  const app = { vault: { getAbstractFileByPath: (path: string) => live.get(path) ?? null }, fileManager: { processFrontMatter } };
  const store = createViewStateStore(createFolderScope("", true));
  let selection = new Set([first.path, second.path, image.path]);
  const notify = vi.fn();
  const context = { getApp: () => app, store, notify, getUiStrings: () => getUiStrings("en") };
  const action = new CardDropActions({ context: context as never, getVisiblePaths: () => [...live.keys()], getSelection: () => selection,
    isBulkMode: () => true, setSelection: paths => { selection = new Set(paths); } });
  return { app, first, second, image, live, store, action, notify, processFrontMatter, selection: () => selection, changeSelection: (paths: string[]) => { selection = new Set(paths); } };
}
describe("dropped properties", () => {
  it("replaces scalars and appends typed list values without discarding existing entries", async () => {
    const fm = { Status: "old", items: ["1", 1] };
    const { app, first } = setup(fm);
    expect(await applyDroppedProperty(app as never, first, { kind: "property", key: "status", value: { kind: "boolean", value: false } })).toBe(true);
    expect(fm.Status).toBe(false);
    expect(await applyDroppedProperty(app as never, first, { kind: "property", key: "items", value: { kind: "number", value: 1 } })).toBe(false);
    await applyDroppedProperty(app as never, first, { kind: "property", key: "items", value: { kind: "boolean", value: true } });
    expect(fm.items).toEqual(["1", 1, true]);
  });
  it("refuses missing destinations, reserved keys and structured values", async () => {
    const fm = { Status: { nested: true } }; const { app, first } = setup(fm);
    for (const target of [{ kind: "property", key: "status", value: { kind: "missing" } }, { kind: "property", key: "tags", value: { kind: "text", value: "x" } }, { kind: "property", key: "status", value: { kind: "text", value: "x" } }] as const) {
      await expect(applyDroppedProperty(app as never, first, target)).rejects.toThrow();
    }
    expect(fm.Status).toEqual({ nested: true });
  });
});
describe("card drop sessions", () => {
  const target = { kind: "property", key: "status", value: { kind: "text", value: "new" } } as const;
  it("freezes selection, skips attachments, continues failures and submits once", async () => {
    const { action, first, second, image, processFrontMatter, selection } = setup();
    const paths = action.resolvePaths(first.path); action.begin(paths);
    processFrontMatter.mockImplementation(async (file, mutate) => { if (file === second) throw new Error("denied"); mutate({}); });
    expect(await action.drop(target, paths)).toEqual({ changed: 1, noop: 0, skipped: 1, failed: 1 });
    expect([...selection()]).toEqual([second.path, image.path]);
    expect(await action.drop(target, paths)).toBeNull();
  });
  it("follows renamed file identities and rejects same-path replacements", async () => {
    const { action, first, second, live, processFrontMatter } = setup();
    action.begin([first.path, second.path]);
    live.delete(first.path); first.path = "renamed.md"; live.set(first.path, first);
    live.set(second.path, file(second.path));
    expect(await action.drop(target, ["first.md", "second.md"])).toMatchObject({ changed: 1, failed: 1 });
    expect(processFrontMatter).toHaveBeenCalledExactlyOnceWith(first, expect.any(Function));
  });
  it("refuses stale scope drops and leaves a newer selection alone", async () => {
    const { action, first, store, changeSelection, selection } = setup();
    action.begin([first.path]); store.setScope(createFolderScope("other", false));
    expect(await action.drop(target, [first.path])).toBeNull();
    action.begin([first.path]); changeSelection(["later.md"]);
    await action.drop(target, [first.path]); expect([...selection()]).toEqual(["later.md"]);
  });
});

it("moves to root with collision numbering and skips same-folder files", async () => {
  const first = file("nested/a.md"); first.name = "a.md";
  const same = file("b.md"); same.name = "b.md";
  const root = new TFolder(); root.path = "";
  const nested = new TFolder(); nested.path = "nested"; first.parent = nested; same.parent = root;
  const live = new Map<string, TFile | TFolder>([[first.path, first], [same.path, same], ["a.md", file("a.md")]]);
  const renameFile = vi.fn(async (entry: TFile, path: string) => { live.delete(entry.path); entry.path = path; live.set(path, entry); });
  const app = { vault: { getRoot: () => root, getAbstractFileByPath: (path: string) => live.get(path) ?? null }, fileManager: { renameFile } };
  const action = new CardDropActions({ context: { getApp: () => app, store: createViewStateStore(createFolderScope("", true)), getUiStrings: () => getUiStrings("en"), notify: vi.fn() } as never,
    getVisiblePaths: () => [first.path, same.path], getSelection: () => new Set(), isBulkMode: () => false, setSelection: vi.fn() });
  action.begin([first.path, same.path]);
  expect(await action.drop({ kind: "folder", path: "" }, ["nested/a.md", "b.md"])).toMatchObject({ changed: 1, noop: 1, failed: 0 });
  expect(renameFile).toHaveBeenCalledOnce(); expect(first.path).not.toBe("a.md"); expect(first.path).not.toContain("/");
});
it("adds a box member and clears its exclusion without moving files", async () => {
  const h = setup();
  let boxes = [{ id: "box", manualPaths: [] as string[], excludedPaths: [h.first.path] }];
  const saveSettings = vi.fn(async (patch: { boxes: typeof boxes }) => { boxes = patch.boxes; });
  const action = new CardDropActions({ context: { getApp: () => h.app, store: h.store, getUiStrings: () => getUiStrings("en"), notify: h.notify, getSettings: () => ({ boxes }), saveSettings } as never,
    getVisiblePaths: () => [h.first.path], getSelection: () => new Set(), isBulkMode: () => false, setSelection: vi.fn() });
  action.begin([h.first.path]);
  expect(await action.drop({ kind: "box", boxId: "box" }, [h.first.path])).toMatchObject({ changed: 1, failed: 0 });
  expect(boxes[0]).toMatchObject({ manualPaths: [h.first.path], excludedPaths: [] });
  expect(h.processFrontMatter).not.toHaveBeenCalled();
});
