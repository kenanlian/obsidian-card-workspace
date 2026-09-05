import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockState,
  resetFolderCardViewHarness,
  createViewWithFile,
  createMarkdownFile,
  clickLatestModalButton,
  getLatestModalButton,
  setLatestModalTextInput,
  buildNoteTagOpsMock,
  registerFolderCardView,
} from "../../__mocks__/folder-card-view-harness";

vi.mock("../note-tag-ops", () => buildNoteTagOpsMock());

import { FolderCardView } from "../FolderCardView";
import { batchRemoveTagsFromFiles, batchRenameTagInFiles } from "../note-tag-ops";
import { DEFAULT_GROUP_SPEC } from "../../card-grouping-settings";

registerFolderCardView(FolderCardView);

function makeBox(id: string, ruleTags: string[]) {
  return {
    id,
    name: id,
    rules: [{
      folder: "",
      includeSubfolders: true,
      tags: ruleTags,
      properties: [],
      id: "rule-1",
      name: "",
    }],
    manualPaths: [],
    excludedPaths: [],
    pinnedPaths: [],
    sort: { field: "mtime", direction: "desc" },
    group: { ...DEFAULT_GROUP_SPEC },
  };
}

function setupVaultWithTaggedNotes(tagsByPath: Record<string, string[]>) {
  const { view, app, plugin } = createViewWithFile("notes/primary.md");
  const files = Object.keys(tagsByPath).map((path) => createMarkdownFile(path));
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  app.vault.getMarkdownFiles = vi.fn(() => files);
  app.metadataCache.getFileCache = vi.fn((target: { path: string }) => {
    const tags = tagsByPath[target.path] ?? [];
    return tags.length > 0 ? { tags: tags.map((tag) => ({ tag: `#${tag}` })) } : null;
  });
  app.vault.getAbstractFileByPath = vi.fn((path: string) => fileByPath.get(path) ?? null);
  return { view, app, plugin, files };
}

describe("TagManagementActions rename flow", () => {
  beforeEach(() => {
    resetFolderCardViewHarness();
  });

  it("renames the tag subtree, syncs favorites/filter/box rules, and notices the count", async () => {
    const { view, app, plugin, files } = setupVaultWithTaggedNotes({
      "notes/one.md": ["a/b", "keep"],
      "notes/two.md": ["a/b/child", "other"],
      "notes/three.md": ["unrelated"],
    });
    plugin.getSettings = vi.fn(() => ({
      includeSubfolders: true,
      sort: { field: "mtime", direction: "desc" },
      filter: { tags: ["a/b"], properties: [] },
      favorites: [{ kind: "tag", ref: "a/b" }, { kind: "folder", ref: "notes" }],
      boxes: [makeBox("box-1", ["a/b", "keep"])],
      visiblePropertyKeys: [],
      expandedPropertyKeys: [],
      defaultView: "cards",
      lastFolderPath: null,
      lastViewMode: "folder",
      pinnedPaths: [],
      previewLines: 5,
    }));

    (view as any).modules.tagManageActions.openRenameTagModal("a/b");

    const inputModal = mockState.modalInstances.at(-1);
    expect(inputModal?.title).toBe("Rename tag");
    expect(inputModal?.textInputs[0]?.value).toBe("a/b");
    setLatestModalTextInput(0, "#X/Y ");
    clickLatestModalButton("Rename");

    const confirmModal = mockState.modalInstances.at(-1);
    expect(confirmModal).not.toBe(inputModal);
    expect(confirmModal?.title).toBe("Rename tag");
    expect(confirmModal?.messages[0]).toContain("Rename #a/b to #x/y?");
    expect(confirmModal?.messages[0]).toContain("2 notes will be rewritten");
    expect(confirmModal?.messages[0]).toContain("1 subtag");
    expect(confirmModal?.messages[0]).toContain("1 card box rule tag condition");
    clickLatestModalButton("Rename");

    await vi.waitFor(() => {
      expect(batchRenameTagInFiles).toHaveBeenCalledWith(app, files.slice(0, 2), "a/b", "x/y");
    });
    expect(plugin.saveSettings).toHaveBeenCalledWith({
      favorites: [{ kind: "tag", ref: "x/y" }, { kind: "folder", ref: "notes" }],
      filter: { tags: ["x/y"] },
      boxes: [makeBox("box-1", ["x/y", "keep"])],
    });
    expect(mockState.noticeMessages).toContain("Renamed #a/b to #x/y in 2 notes.");
  });

  it("mentions merging when notes already carry the rename target", async () => {
    const { view } = setupVaultWithTaggedNotes({
      "notes/one.md": ["a/b", "x/y"],
    });

    (view as any).modules.tagManageActions.openRenameTagModal("a/b");
    setLatestModalTextInput(0, "x/y");
    clickLatestModalButton("Rename");

    const confirmModal = mockState.modalInstances.at(-1);
    expect(confirmModal?.messages[0]).toContain("tags will be merged");
    clickLatestModalButton("Rename");
    await vi.waitFor(() => {
      expect(mockState.noticeMessages).toContain("Renamed #a/b to #x/y in 1 note.");
    });
  });

  it("skips execution when the confirm modal is cancelled", async () => {
    const { view } = setupVaultWithTaggedNotes({ "notes/one.md": ["a/b"] });

    (view as any).modules.tagManageActions.openRenameTagModal("a/b");
    setLatestModalTextInput(0, "x/y");
    clickLatestModalButton("Rename");
    clickLatestModalButton("Cancel");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(batchRenameTagInFiles).not.toHaveBeenCalled();
  });

  it("closes without scanning when the new name equals the old one", async () => {
    const { view } = setupVaultWithTaggedNotes({ "notes/one.md": ["a/b"] });

    (view as any).modules.tagManageActions.openRenameTagModal("a/b");
    setLatestModalTextInput(0, "#A/B");
    clickLatestModalButton("Rename");

    expect(mockState.modalInstances.length).toBe(1);
    expect(batchRenameTagInFiles).not.toHaveBeenCalled();
  });
});

describe("TagManagementActions delete flow", () => {
  beforeEach(() => {
    resetFolderCardViewHarness();
  });

  it("removes the tag subtree, cleans references, and notices the count", async () => {
    const { view, app, plugin, files } = setupVaultWithTaggedNotes({
      "notes/one.md": ["a/b", "keep"],
      "notes/two.md": ["a/b/child"],
    });
    plugin.getSettings = vi.fn(() => ({
      includeSubfolders: true,
      sort: { field: "mtime", direction: "desc" },
      filter: { tags: ["keep", "a/b/child"], properties: [] },
      favorites: [{ kind: "tag", ref: "a/b" }, { kind: "tag", ref: "keep" }],
      boxes: [makeBox("box-1", ["a/b/child", "keep"])],
      visiblePropertyKeys: [],
      expandedPropertyKeys: [],
      defaultView: "cards",
      lastFolderPath: null,
      lastViewMode: "folder",
      pinnedPaths: [],
      previewLines: 5,
    }));

    const request = (view as any).modules.tagManageActions.requestDeleteTag("#A/B");

    const confirmModal = mockState.modalInstances.at(-1);
    expect(confirmModal?.title).toBe("Delete tag");
    expect(confirmModal?.messages[0]).toContain("Delete #a/b?");
    expect(confirmModal?.messages[0]).toContain("removed from 2 notes");
    expect(confirmModal?.messages[0]).toContain("1 subtag");
    expect((getLatestModalButton("Delete") as { warning?: boolean } | undefined)?.warning).toBe(true);
    vi.mocked(batchRemoveTagsFromFiles).mockResolvedValueOnce({
      changed: files.map((file) => ({ ok: true as const, changed: true as const, file })),
      noop: [],
      failed: [],
    } as never);
    clickLatestModalButton("Delete");
    await request;

    await vi.waitFor(() => {
      expect(batchRemoveTagsFromFiles).toHaveBeenCalledWith(app, files, ["a/b"]);
    });
    expect(plugin.saveSettings).toHaveBeenCalledWith({
      favorites: [{ kind: "tag", ref: "keep" }],
      filter: { tags: ["keep"] },
      boxes: [makeBox("box-1", ["keep"])],
    });
    expect(mockState.noticeMessages).toContain("Removed #a/b from 2 notes.");
  });

  it("notifies and skips the modal when the tag is unknown everywhere", async () => {
    const { view } = setupVaultWithTaggedNotes({ "notes/one.md": ["other"] });

    await (view as any).modules.tagManageActions.requestDeleteTag("ghost");

    expect(mockState.modalInstances.length).toBe(0);
    expect(mockState.noticeMessages).toContain("#ghost is not used by any note, favorite, filter, or card box rule.");
    expect(batchRemoveTagsFromFiles).not.toHaveBeenCalled();
  });
});
