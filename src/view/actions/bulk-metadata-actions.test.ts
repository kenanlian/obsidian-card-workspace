import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockState, resetFolderCardViewHarness, createViewWithFile, createCardRecord, createMarkdownFile, createNonMarkdownFile, registerFolderCardView, buildNoteTagOpsMock } from "../../__mocks__/folder-card-view-harness";
import type { BulkPropertiesDraft, BulkTagsDraft } from "../bulk-metadata";
import type { BulkMetadataModalOptions } from "../modals/BulkMetadataModal";
const modals = vi.hoisted(() => ({ tags: null as null | { options: BulkMetadataModalOptions; submit: (draft: BulkTagsDraft) => Promise<boolean>; showResult: ReturnType<typeof vi.fn> }, properties: null as null | { options: BulkMetadataModalOptions; submit: (draft: BulkPropertiesDraft) => Promise<boolean>; showResult: ReturnType<typeof vi.fn> } }));
vi.mock("../modals/BulkTagsModal", () => ({ BulkTagsModal: class {
  showResult = vi.fn();
  constructor(_app: unknown, options: BulkMetadataModalOptions, submit: (draft: BulkTagsDraft) => Promise<boolean>) { modals.tags = { options, submit, showResult: this.showResult }; }
  open() {}
} }));
vi.mock("../modals/BulkPropertiesModal", () => ({ BulkPropertiesModal: class {
  showResult = vi.fn();
  constructor(_app: unknown, options: BulkMetadataModalOptions, submit: (draft: BulkPropertiesDraft) => Promise<boolean>) { modals.properties = { options, submit, showResult: this.showResult }; }
  open() {}
} }));
vi.mock("../note-tag-ops", () => ({ ...buildNoteTagOpsMock(), editTagsInFile: vi.fn() }));
import { editTagsInFile } from "../note-tag-ops";
import { FolderCardView } from "../FolderCardView";
registerFolderCardView(FolderCardView);

function setup() {
  const { view, app, plugin } = createViewWithFile("primary.md");
  const first = createMarkdownFile("first.md"); const second = createMarkdownFile("second.md"); const canvas = createNonMarkdownFile("mixed.canvas", "canvas");
  const live = new Map([[first.path, first], [second.path, second], [canvas.path, canvas]]);
  app.vault.getAbstractFileByPath = (path: string) => live.get(path) ?? null;
  app.vault.getMarkdownFiles = () => [first, second];
  app.metadataCache.getFileCache = () => ({ tags: [{ tag: "#work" }], frontmatter: { Status: "old" } });
  const bulk = (view as any).modules.bulk;
  bulk.bulkMode = true; bulk.selectedPaths = new Set([first.path, second.path, canvas.path]);
  (view as any).visibleCards = [createCardRecord(first), createCardRecord(second), createCardRecord(canvas, "canvas")];
  return { view, app, plugin, first, second, canvas, live, bulk };
}
describe("unified bulk toolbar routes", () => {
  beforeEach(() => { resetFolderCardViewHarness(); modals.tags = null; modals.properties = null; vi.mocked(editTagsInFile).mockReset(); });
  it("freezes Markdown targets and retries only failures even if selection changes", async () => {
    const { view, app, first, second, bulk } = setup();
    await (view as any).onOpen();
    mockState.panelEventHandlers["toolbar-action"]({ detail: { action: "bulk-edit-tags-selected" } });
    expect(modals.tags?.options.targetCount).toBe(2);
    const draft = { addTags: ["new", "other"], removeTags: ["work"] };
    vi.mocked(editTagsInFile).mockResolvedValueOnce({ ok: true, changed: true, file: first } as never).mockResolvedValueOnce({ ok: false, path: second.path, error: "denied" });
    bulk.selectedPaths = new Set(["later.md"]);
    expect(await modals.tags!.submit(draft)).toBe(false);
    expect(editTagsInFile).toHaveBeenNthCalledWith(1, app, first, draft);
    expect(editTagsInFile).toHaveBeenNthCalledWith(2, app, second, draft);
    expect([...bulk.selectedPaths]).toEqual([second.path]);
    expect(mockState.noticeMessages.at(-1)).toContain("partially modified");
    vi.mocked(editTagsInFile).mockResolvedValueOnce({ ok: true, changed: false, file: second } as never);
    expect(await modals.tags!.submit(draft)).toBe(true);
    expect(editTagsInFile).toHaveBeenCalledTimes(3);
    expect([...bulk.selectedPaths]).toEqual([]);
  });
  it("runs tag filter cleanup after a combined removal", async () => {
    const { view, plugin, first, second } = setup();
    const settings = plugin.getSettings();
    settings.filter.tags = ["work"];
    plugin.getSettings.mockReturnValue(settings);
    vi.mocked(editTagsInFile).mockImplementation(async (_app, file) => ({ ok: true, changed: true, file }));
    (view as any).modules.tagActions.bulkEditTagsSelected();
    expect(await modals.tags!.submit({ addTags: ["new"], removeTags: ["work"] })).toBe(true);
    expect(vi.mocked(editTagsInFile).mock.calls.map((call) => call[1])).toEqual([first, second]);
    expect(plugin.saveSettings).toHaveBeenCalledWith({ filter: { tags: [] } });
  });
  it("routes properties to their action, continues failure and follows rename on retry", async () => {
    const { view, app, first, second, live, bulk } = setup();
    await (view as any).onOpen();
    mockState.panelEventHandlers["toolbar-action"]({ detail: { action: "bulk-edit-properties-selected" } });
    expect(modals.properties?.options.targetCount).toBe(2);
    const frontmatter = new Map([[first, { Status: "old" }], [second, { Status: "old" }]]);
    app.fileManager.processFrontMatter = vi.fn(async (file, mutate) => { if (file === second) throw new Error("denied"); mutate(frontmatter.get(file)); });
    const draft: BulkPropertiesDraft = { setProperties: [{ name: "status", type: "text", value: "new" }], removeKeys: [] };
    expect(await modals.properties!.submit(draft)).toBe(false);
    expect(frontmatter.get(first)).toEqual({ Status: "new" });
    expect([...bulk.selectedPaths]).toEqual([second.path]);
    live.delete(second.path); second.path = "renamed.md"; live.set(second.path, second);
    app.fileManager.processFrontMatter.mockImplementation(async (file: typeof second, mutate: (value: unknown) => void) => mutate(frontmatter.get(file)));
    expect(await modals.properties!.submit(draft)).toBe(true);
    expect(app.fileManager.processFrontMatter).toHaveBeenCalledTimes(3);
    expect(frontmatter.get(second)).toEqual({ Status: "new" });
    expect([...bulk.selectedPaths]).toEqual([]);
  });
  it("does not open an editor without Markdown targets or outside bulk mode", () => {
    const { view, bulk, canvas } = setup();
    bulk.selectedPaths = new Set([canvas.path]);
    (view as any).modules.tagActions.bulkEditTagsSelected(); (view as any).modules.bulkPropertyActions.bulkEditPropertiesSelected();
    expect(modals.tags).toBeNull(); expect(modals.properties).toBeNull();
  });
});
