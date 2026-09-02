import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockState,
  resetFolderCardViewHarness,
  createViewWithFile,
  createCardRecord,
  createMarkdownFile,
  createNonMarkdownFile,
  clickLatestModalButton,
  setLatestModalTextInput,
  setLatestModalCheckbox,
  getLatestModalButton,
  buildNoteOpsMock,
  registerFolderCardView,
} from "../../__mocks__/folder-card-view-harness";

vi.mock("../note-ops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../note-ops")>();
  return buildNoteOpsMock(actual);
});

import { TagActions } from "./tag-actions";
import { FolderCardView } from "../FolderCardView";
import {
  addTagToFile,
  batchAddTagToFiles,
  batchRemoveTagsFromFiles,
  removeTagFromFile,
} from "../note-ops";

registerFolderCardView(FolderCardView);

describe("TagActions", () => {
  it("collapses duplicate and descendant removable tags", () => {
    const actions = new TagActions({ context: {} } as never);

    expect(actions.collapseBulkRemovableTags([
      "#project/alpha",
      "project",
      "project/alpha/deep",
      "status/open",
      "status/open",
    ])).toEqual(["project", "status/open"]);
  });
});

describe("TagActions single and bulk card workflows", () => {
  beforeEach(() => {
    resetFolderCardViewHarness();
  });

  it("single tag actions keep add freeform and require explicit remove selection", async () => {
    const { view, file, app, plugin } = createViewWithFile("notes/tag-action.md");

    await (view as any).modules.cardMenu.routeAction("add-tag", file.path);
    expect(mockState.modalInstances.at(-1)?.title).toBe("Add tag");
    setLatestModalTextInput(0, "  #Project/Alpha ");
    clickLatestModalButton("Add tag");
    await vi.waitFor(() => {
      expect(addTagToFile).toHaveBeenCalledWith(app, file, "project/alpha");
    });
    expect(mockState.noticeMessages).toContain('Added #project/alpha to "tag-action".');

    app.metadataCache.getFileCache = vi.fn(() => ({
      tags: [{ tag: "#Project/Alpha" }],
    }));
    vi.mocked(removeTagFromFile).mockResolvedValueOnce({
      ok: true,
      changed: false,
      file,
    } as any);

    await (view as any).modules.cardMenu.routeAction("remove-tag", file.path);
    const singleTagModal = mockState.modalInstances.at(-1);
    expect(singleTagModal?.title).toBe("Remove tags");
    expect(singleTagModal?.textInputs).toEqual([]);
    expect(singleTagModal?.checkboxes.map((checkbox) => checkbox.label)).toEqual(["Project/Alpha (1)"]);
    expect(removeTagFromFile).not.toHaveBeenCalled();
    setLatestModalCheckbox("Project/Alpha (1)", true);
    clickLatestModalButton("Remove selected tags");
    await vi.waitFor(() => {
      expect(removeTagFromFile).toHaveBeenCalledWith(app, file, "project/alpha");
    });
    expect(mockState.noticeMessages).toContain('#project/alpha was not present on "tag-action".');
    expect(plugin.saveSettings).not.toHaveBeenCalled();

    app.metadataCache.getFileCache = vi.fn(() => ({
      tags: [{ tag: "#Other" }, { tag: "#Project/Alpha" }],
    }));
    vi.mocked(batchRemoveTagsFromFiles).mockResolvedValueOnce({
      changed: [{ ok: true, changed: true, file }],
      noop: [],
      failed: [],
    } as any);

    await (view as any).modules.cardMenu.routeAction("remove-tag", file.path);
    const multiTagModal = mockState.modalInstances.at(-1);
    expect(multiTagModal?.title).toBe("Remove tags");
    expect(multiTagModal?.checkboxes.map((checkbox) => checkbox.label)).toEqual([
      "Other (1)",
      "Project/Alpha (1)",
    ]);
    setLatestModalCheckbox("Other (1)", true);
    setLatestModalCheckbox("Project/Alpha (1)", true);
    clickLatestModalButton("Remove selected tags");
    await vi.waitFor(() => {
      expect(batchRemoveTagsFromFiles).toHaveBeenCalledWith(app, [file], ["other", "project/alpha"]);
    });
    await vi.waitFor(() => {
      expect(mockState.noticeMessages).toContain("Removed 2 tags from 1 note.");
    });
  });

  it("bulk add tag reconciles selection to failed markdown paths only", async () => {
    const { view, app } = createViewWithFile("notes/primary.md");
    const first = createMarkdownFile("notes/first.md");
    const second = createMarkdownFile("notes/second.md");
    const third = createNonMarkdownFile("notes/third.canvas", "canvas");
    const visibleCards = [
      createCardRecord(first),
      createCardRecord(second),
      createCardRecord(third, "canvas"),
    ];
    const fileMap = new Map([
      [first.path, first],
      [second.path, second],
      [third.path, third],
    ]);

    app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => fileMap.get(requestedPath) ?? null);
    (view as any).visibleCards = visibleCards;
    (view as any).modules.projection.deriveVisibleCards = vi.fn(() => visibleCards);
    (view as any).modules.bulk.bulkMode = true;
    (view as any).modules.bulk.selectedPaths = new Set([first.path, second.path, third.path]);
    (view as any).modules.bulk.anchorPath = first.path;

    vi.mocked(batchAddTagToFiles).mockResolvedValueOnce({
      succeeded: [{ ok: true, file: first }],
      failed: [{ ok: false, error: "denied", path: second.path }],
    } as any);

    await (view as any).onOpen();

    const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
    toolbarActionHandler({ detail: { action: "bulk-add-tag-selected" } });
    expect(mockState.modalInstances.at(-1)?.title).toBe("Add tag");
    setLatestModalTextInput(0, "#Project");
    clickLatestModalButton("Add tag");

    await vi.waitFor(() => {
      expect(batchAddTagToFiles).toHaveBeenCalledWith(app, [first, second], "project");
    });

    expect(Array.from((view as any).modules.bulk.selectedPaths)).toEqual([second.path]);
    expect((view as any).modules.bulk.anchorPath).toBe(second.path);
    expect(mockState.noticeMessages).toContain("Added #project to 1 note; 1 failed.");
  });

  it("bulk remove opens a checkbox modal, collapses redundant tags, and clears a stale filter", async () => {
    const { view, app, plugin } = createViewWithFile("notes/primary.md");
    const first = createMarkdownFile("notes/first.md");
    const second = createMarkdownFile("notes/second.md");
    const third = createNonMarkdownFile("notes/third.canvas", "canvas");
    const visibleCards = [
      createCardRecord(first),
      createCardRecord(second),
      createCardRecord(third, "canvas"),
    ];
    const fileMap = new Map([
      [first.path, first],
      [second.path, second],
      [third.path, third],
    ]);
    const tagsByPath = new Map<string, string[]>([
      [first.path, ["#project/alpha", "#other"]],
      [second.path, ["#project", "#project/alpha"]],
      [third.path, ["#canvas-only"]],
    ]);

    plugin.getSettings = vi.fn(() => ({
      includeSubfolders: true,
      sort: { field: "mtime", direction: "desc" },
      visiblePropertyKeys: [],
      expandedPropertyKeys: [],
      filter: { tags: ["project/alpha"], properties: [] },
      defaultView: "cards",
      lastFolderPath: null,
      lastViewMode: "folder",
      pinnedPaths: [],
      previewLines: 5,
    }));
    app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => fileMap.get(requestedPath) ?? null);
    app.metadataCache.getFileCache = vi.fn((targetFile: InstanceType<typeof mockState.MockTFile>) => {
      const tags = tagsByPath.get(targetFile.path) ?? [];
      return tags.length > 0 ? { tags: tags.map((tag) => ({ tag })) } : null;
    });
    (view as any).baseCards = visibleCards;
    (view as any).visibleCards = visibleCards;
    (view as any).modules.projection.deriveVisibleCards = vi.fn(() => visibleCards);
    (view as any).modules.bulk.bulkMode = true;
    (view as any).modules.bulk.selectedPaths = new Set([first.path, second.path, third.path]);
    (view as any).modules.bulk.anchorPath = first.path;

    vi.mocked(batchRemoveTagsFromFiles).mockImplementationOnce(async () => {
      tagsByPath.set(first.path, []);
      tagsByPath.set(second.path, []);
      return {
        changed: [
          { ok: true, changed: true, file: first },
          { ok: true, changed: true, file: second },
        ],
        noop: [],
        failed: [],
      } as any;
    });

    await (view as any).onOpen();

    const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
    toolbarActionHandler({ detail: { action: "bulk-remove-tag-selected" } });

    const modal = mockState.modalInstances.at(-1);
    expect(modal?.title).toBe("Remove tags");
    expect(modal?.textInputs).toEqual([]);
    expect(modal?.checkboxes.map((checkbox) => checkbox.label)).toEqual([
      "other (1)",
      "project (1)",
      "project/alpha (2)",
    ]);
    expect(getLatestModalButton("Remove selected tags")?.disabled).toBe(true);

    setLatestModalCheckbox("project (1)", true);
    expect(getLatestModalButton("Remove selected tags")?.disabled).toBe(false);
    setLatestModalCheckbox("project/alpha (2)", true);
    setLatestModalCheckbox("other (1)", true);
    clickLatestModalButton("Remove selected tags");

    await vi.waitFor(() => {
      expect(batchRemoveTagsFromFiles).toHaveBeenCalledWith(app, [first, second], ["other", "project"]);
    });

    expect(plugin.saveSettings).toHaveBeenCalledWith({
      filter: {
        tags: [],
      },
    });
    expect(Array.from((view as any).modules.bulk.selectedPaths)).toEqual([]);
    expect((view as any).modules.bulk.anchorPath).toBeNull();
    await vi.waitFor(() => {
      expect(mockState.noticeMessages).toContain("Removed 2 tags from 2 notes.");
    });
  });

  it("bulk remove reports noop-only results without claiming success", async () => {
    const { view, app, plugin } = createViewWithFile("notes/primary.md");
    const first = createMarkdownFile("notes/first.md");
    const second = createMarkdownFile("notes/second.md");
    const visibleCards = [
      createCardRecord(first),
      createCardRecord(second),
    ];
    const fileMap = new Map([
      [first.path, first],
      [second.path, second],
    ]);

    app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => fileMap.get(requestedPath) ?? null);
    app.metadataCache.getFileCache = vi.fn(() => ({
      tags: [{ tag: "#project" }],
    }));
    (view as any).baseCards = visibleCards;
    (view as any).visibleCards = visibleCards;
    (view as any).modules.projection.deriveVisibleCards = vi.fn(() => visibleCards);
    (view as any).modules.bulk.bulkMode = true;
    (view as any).modules.bulk.selectedPaths = new Set([first.path, second.path]);
    (view as any).modules.bulk.anchorPath = first.path;

    vi.mocked(batchRemoveTagsFromFiles).mockResolvedValueOnce({
      changed: [],
      noop: [
        { ok: true, changed: false, file: first },
        { ok: true, changed: false, file: second },
      ],
      failed: [],
    } as any);

    await (view as any).onOpen();

    const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
    toolbarActionHandler({ detail: { action: "bulk-remove-tag-selected" } });
    setLatestModalCheckbox("project (2)", true);
    clickLatestModalButton("Remove selected tags");

    await vi.waitFor(() => {
      expect(batchRemoveTagsFromFiles).toHaveBeenCalledWith(app, [first, second], ["project"]);
    });

    expect(plugin.saveSettings).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(mockState.noticeMessages).toContain(
        "No selected notes contained the 1 chosen tag (2 notes unchanged).",
      );
    });
  });
});
