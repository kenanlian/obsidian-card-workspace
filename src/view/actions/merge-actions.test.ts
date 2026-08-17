import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockState,
  resetFolderCardViewHarness,
  createViewWithFile,
  createCardRecordFromPath,
  createCardRecord,
  createMarkdownFile,
  createNonMarkdownFile,
  createFolder,
  clickLatestModalButton,
  setLatestModalTextInput,
  flushAsyncWork,
  createDeferred,
  buildNoteOpsMock,
  registerFolderCardView,
} from "../../__mocks__/folder-card-view-harness";

vi.mock("../note-ops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../note-ops")>();
  return buildNoteOpsMock(actual);
});

import { MergeActions } from "./merge-actions";
import { FolderCardView } from "../FolderCardView";
import { getUiStrings } from "../../i18n";
import {
  batchDeleteFilesUsingObsidianPreference,
  batchMoveFiles,
  batchTrashFiles,
  mergeNotes,
} from "../note-ops";

registerFolderCardView(FolderCardView);

describe("MergeActions", () => {
  it("keeps zero-selection bulk move as a safe no-op", () => {
    const getSelectedPaths = vi.fn(() => new Set<string>());
    const actions = new MergeActions({
      context: {} as never,
      getBulkMode: () => true,
      getSelectedPaths,
    } as never);

    expect(() => actions.bulkMoveSelected()).not.toThrow();
    expect(getSelectedPaths).toHaveBeenCalledTimes(1);
  });
});

describe("MergeActions batch move, bulk delete, and merge workflows", () => {
  beforeEach(() => {
    resetFolderCardViewHarness();
  });

  describe("batch move workflow", () => {
    it("resolves selected paths to live files in selection order before batch execution", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const third = createMarkdownFile("notes/third.md");
      const destination = createFolder("archive");

      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === third.path) {
          return third;
        }
        return null;
      });

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set([
        second.path,
        "notes/missing.md",
        first.path,
        third.path,
      ]);
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(third.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(third.path),
      ];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(third.path),
      ]);

      vi.mocked(batchMoveFiles).mockResolvedValueOnce({
        succeeded: [
          { ok: true, file: second as unknown as any },
          { ok: true, file: first as unknown as any },
          { ok: true, file: third as unknown as any },
        ],
        failed: [],
      } as any);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-move-selected" } });

      const picker = mockState.folderPickerInstances.at(-1);
      await picker?.onChoose(destination);

      expect(batchMoveFiles).toHaveBeenCalledTimes(1);
      expect(batchMoveFiles).toHaveBeenCalledWith(
        app,
        [second, first, third] as unknown as any,
        destination,
        getUiStrings("en").noteOps,
      );
    });

    it("bulk move workflow reconciles selection after execution", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const successA = createMarkdownFile("notes/success-a.md");
      const failedB = createMarkdownFile("notes/failed-b.md");
      const successC = createMarkdownFile("notes/success-c.md");
      const destination = createFolder("archive");

      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === successA.path) {
          return successA;
        }
        if (requestedPath === failedB.path) {
          return failedB;
        }
        if (requestedPath === successC.path) {
          return successC;
        }
        return null;
      });

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set([
        successA.path,
        "notes/stale.md",
        failedB.path,
        successC.path,
      ]);
      (view as any).modules.bulk.anchorPath = successA.path;
      (view as any).baseCards = [
        createCardRecordFromPath(successA.path),
        createCardRecordFromPath(failedB.path),
        createCardRecordFromPath(successC.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(successA.path),
        createCardRecordFromPath(failedB.path),
        createCardRecordFromPath(successC.path),
      ];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(successA.path),
        createCardRecordFromPath(failedB.path),
        createCardRecordFromPath(successC.path),
      ]);

      vi.mocked(batchMoveFiles).mockResolvedValueOnce({
        succeeded: [
          { ok: true, file: successA as unknown as any },
          { ok: true, file: successC as unknown as any },
        ],
        failed: [{ ok: false, error: "permission denied", path: failedB.path }],
      } as any);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-move-selected" } });

      const picker = mockState.folderPickerInstances.at(-1);
      await picker?.onChoose(destination);

      expect(Array.from((view as any).modules.bulk.selectedPaths)).toEqual([failedB.path]);
      expect((view as any).modules.bulk.anchorPath).toBe(failedB.path);
      expect(mockState.noticeMessages).toEqual(["Moved 2 notes; 1 failed."]);
    });

    it("clears stale selections when bulk move resolves to zero live files", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const destination = createFolder("archive");

      app.vault.getAbstractFileByPath = vi.fn(() => null);

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set(["notes/stale-a.md", "notes/stale-b.md"]);
      (view as any).modules.bulk.anchorPath = "notes/stale-a.md";
      (view as any).baseCards = [
        createCardRecordFromPath("notes/stale-a.md"),
        createCardRecordFromPath("notes/stale-b.md"),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath("notes/stale-a.md"),
        createCardRecordFromPath("notes/stale-b.md"),
      ];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => []);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-move-selected" } });

      const picker = mockState.folderPickerInstances.at(-1);
      await picker?.onChoose(destination);

      expect(batchMoveFiles).not.toHaveBeenCalled();
      expect((view as any).modules.bulk.selectedPaths.size).toBe(0);
      expect((view as any).modules.bulk.anchorPath).toBeNull();
      expect(mockState.noticeMessages).toEqual(["No selected notes are available to move."]);
    });

    it("clears stale selections when bulk move resolves to already-target live files", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const alreadyFirst = createMarkdownFile("archive/already-first.md");
      const alreadySecond = createMarkdownFile("archive/already-second.md");
      const destination = createFolder("archive");

      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === alreadyFirst.path) {
          return alreadyFirst;
        }
        if (requestedPath === alreadySecond.path) {
          return alreadySecond;
        }
        return null;
      });

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set([
        "notes/stale-before.md",
        alreadySecond.path,
        "notes/stale-middle.md",
        alreadyFirst.path,
      ]);
      (view as any).modules.bulk.anchorPath = "notes/stale-before.md";
      (view as any).baseCards = [
        createCardRecordFromPath(alreadyFirst.path),
        createCardRecordFromPath(alreadySecond.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(alreadySecond.path),
        createCardRecordFromPath(alreadyFirst.path),
      ];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(alreadySecond.path),
        createCardRecordFromPath(alreadyFirst.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-move-selected" } });

      const picker = mockState.folderPickerInstances.at(-1);
      await picker?.onChoose(destination);

      expect(batchMoveFiles).not.toHaveBeenCalled();
      expect(Array.from((view as any).modules.bulk.selectedPaths)).toEqual([
        alreadySecond.path,
        alreadyFirst.path,
      ]);
      expect((view as any).modules.bulk.anchorPath).toBe(alreadySecond.path);
      expect(mockState.noticeMessages).toEqual(["All selected notes are already in the target folder."]);
    });
  });
  describe("bulk delete workflows", () => {
    it("reconciles stale selection and no-ops when bulk delete has no live files at confirm time", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");

      app.vault.getAbstractFileByPath = vi.fn(() => null);

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set(["notes/stale-a.md", "notes/stale-b.md"]);
      (view as any).modules.bulk.anchorPath = "notes/stale-a.md";
      (view as any).baseCards = [
        createCardRecordFromPath("notes/stale-a.md"),
        createCardRecordFromPath("notes/stale-b.md"),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath("notes/stale-a.md"),
        createCardRecordFromPath("notes/stale-b.md"),
      ];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => []);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-delete-selected" } });
      await flushAsyncWork(1);

      expect(mockState.modalInstances).toHaveLength(0);
      expect(batchDeleteFilesUsingObsidianPreference).not.toHaveBeenCalled();
      expect(Array.from((view as any).modules.bulk.selectedPaths)).toEqual([]);
      expect((view as any).modules.bulk.anchorPath).toBeNull();
      expect(mockState.noticeMessages).toEqual(["No selected notes are available to delete."]);

    });
  });
  describe("bulk delete workflows require confirmation", () => {
    it("does not execute bulk delete helper when confirmation is denied", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");

      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        return null;
      });

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set([first.path, second.path]);
      (view as any).modules.bulk.anchorPath = first.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-delete-selected" } });
      await flushAsyncWork(1);

      expect(batchDeleteFilesUsingObsidianPreference).not.toHaveBeenCalled();
      expect(mockState.modalInstances).toHaveLength(1);
      expect(mockState.modalInstances[0]?.title).toBe("Delete selected notes?");
      expect(mockState.modalInstances[0]?.messages).toEqual([
        "Delete 2 selected notes? Obsidian will use your Files & Links delete preference.",
      ]);

      clickLatestModalButton("Cancel");
      await flushAsyncWork();

      expect(batchDeleteFilesUsingObsidianPreference).not.toHaveBeenCalled();
      expect(Array.from((view as any).modules.bulk.selectedPaths)).toEqual([first.path, second.path]);
      expect((view as any).modules.bulk.anchorPath).toBe(first.path);
      expect(mockState.noticeMessages).toEqual([]);
    });
  });
  describe("merge workflow", () => {
    it("uses frozen visible-order selection, supports reorder, and keeps preview aligned with merge inputs", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const third = createMarkdownFile("notes/third.md");
      const notesFolder = createFolder("notes");
      const bodyByPath: Record<string, string> = {
        [first.path]: "First body",
        [second.path]: "Second body",
        [third.path]: "Third body",
      };

      app.vault.read = vi.fn(async (file: { path: string }) => {
        return bodyByPath[file.path] ?? "";
      });
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === third.path) {
          return third;
        }
        if (requestedPath === "notes") {
          return notesFolder;
        }
        return null;
      });

      vi.mocked(mergeNotes).mockResolvedValueOnce({
        ok: true,
        mergedFile: createMarkdownFile("notes/Merged notes.md") as unknown as any,
        sourceCount: 3,
      });

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set([third.path, first.path, second.path]);
      (view as any).modules.bulk.anchorPath = third.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(third.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(third.path),
      ];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(third.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();

      expect(mockState.modalInstances).toHaveLength(1);
      expect(mockState.modalInstances[0]?.title).toBe("Merge selected notes");
      expect(mockState.modalInstances[0]?.renderOrder.indexOf("button:Cancel")).toBeLessThan(
        mockState.modalInstances[0]?.renderOrder.indexOf("h4:Preview") ?? -1,
      );
      expect(mockState.modalInstances[0]?.renderOrder.indexOf("button:Merge notes")).toBeLessThan(
        mockState.modalInstances[0]?.renderOrder.indexOf("h4:Preview") ?? -1,
      );

      clickLatestModalButton("Down", 0);
      await flushAsyncWork();

      expect(mockState.modalInstances[0]?.textInputs[1]?.value).toBe("\n\n");
      const defaultPreview = [
        "# second\n\nSecond body",
        "# first\n\nFirst body",
        "# third\n\nThird body",
      ].join("\n\n");
      expect(mockState.modalInstances.at(-1)?.renderedPreviewText).toBe(defaultPreview);

      setLatestModalTextInput(1, "\n\n***\n\n");
      await flushAsyncWork();

      const expectedPreview = [
        "# second\n\nSecond body",
        "# first\n\nFirst body",
        "# third\n\nThird body",
      ].join("\n\n***\n\n");

      expect(mockState.modalInstances.at(-1)?.renderedPreviewText).toBe(expectedPreview);
      expect(mergeNotes).not.toHaveBeenCalled();

      clickLatestModalButton("Merge notes");
      await flushAsyncWork();

      expect(mergeNotes).toHaveBeenCalledTimes(1);
      expect(mergeNotes).toHaveBeenCalledWith(
        app,
        [second, first, third],
        notesFolder,
        "Merged notes",
        "\n\n***\n\n",
        getUiStrings("en").noteOps,
      );
    });

    it("blocks merging and disables the action when a non-markdown file is selected", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const canvas = createNonMarkdownFile("notes/board.canvas", "canvas");
      const visibleCards = [createCardRecord(first), createCardRecord(canvas, "canvas")];
      const fileMap = new Map([
        [first.path, first],
        [canvas.path, canvas],
      ]);

      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => fileMap.get(requestedPath) ?? null);
      (view as any).visibleCards = visibleCards;
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => visibleCards);
      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set([first.path, canvas.path]);
      (view as any).modules.bulk.anchorPath = first.path;

      await (view as any).onOpen();

      expect((view as any).modules.bulk.buildPanelState().canBulkMergeSelected).toBe(false);

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();

      expect(mockState.modalInstances).toHaveLength(0);
      expect(mergeNotes).not.toHaveBeenCalled();
      expect(mockState.noticeMessages).toContain(
        "Only Markdown notes can be merged. Deselect the other file types first.",
      );
    });

    it("previews merged content with only the first note's frontmatter", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const notesFolder = createFolder("notes");
      const bodyByPath: Record<string, string> = {
        [first.path]: "---\ntags:\n  - keep\n---\n\nFirst body",
        [second.path]: "---\ntags:\n  - drop\n---\n\nSecond body",
      };

      app.vault.read = vi.fn(async (file: { path: string }) => {
        return bodyByPath[file.path] ?? "";
      });
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === "notes") {
          return notesFolder;
        }
        return null;
      });

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set([first.path, second.path]);
      (view as any).modules.bulk.anchorPath = first.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();

      expect(mockState.modalInstances.at(-1)?.renderedPreviewText).toBe(
        "---\ntags:\n  - keep\n---\n\n# first\n\nFirst body\n\n# second\n\nSecond body",
      );
    });

    it("preserves modal scroll position across reorder and cleanup actions", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const third = createMarkdownFile("notes/third.md");
      const notesFolder = createFolder("notes");
      const bodyByPath: Record<string, string> = {
        [first.path]: "First body",
        [second.path]: "Second body",
        [third.path]: "Third body",
      };

      app.vault.read = vi.fn(async (file: { path: string }) => {
        return bodyByPath[file.path] ?? "";
      });
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === third.path) {
          return third;
        }
        if (requestedPath === "notes") {
          return notesFolder;
        }
        return null;
      });

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set([third.path, first.path, second.path]);
      (view as any).modules.bulk.anchorPath = third.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(third.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(third.path),
      ];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
        createCardRecordFromPath(third.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();

      const modal = mockState.modalInstances.at(-1);
      expect(modal).toBeDefined();

      modal!.modalEl.scrollTop = 180;
      clickLatestModalButton("Keep source notes");
      expect(modal!.modalEl.scrollTop).toBe(180);

      modal!.modalEl.scrollTop = 240;
      clickLatestModalButton("Down", 0);
      expect(modal!.modalEl.scrollTop).toBe(240);
      await flushAsyncWork();
      expect(modal!.modalEl.scrollTop).toBe(240);
    });

    it("does not rerender bulk merge preview after the modal closes", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const notesFolder = createFolder("notes");
      const pendingRead = createDeferred<string>();

      app.vault.read = vi.fn(() => pendingRead.promise);
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === "notes") {
          return notesFolder;
        }
        return null;
      });

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set([first.path, second.path]);
      (view as any).modules.bulk.anchorPath = first.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork(1);

      const modal = mockState.modalInstances.at(-1);
      expect(modal).toBeDefined();
      expect(app.vault.read).toHaveBeenCalledTimes(1);

      clickLatestModalButton("Cancel");
      expect(modal?.buttons).toEqual([]);
      expect(modal?.renderedPreviewText).toBe("");

      pendingRead.resolve("First body");
      await flushAsyncWork();

      expect(app.vault.read).toHaveBeenCalledTimes(1);
      expect(modal?.buttons).toEqual([]);
      expect(modal?.messages).toEqual([]);
      expect(modal?.renderedPreviewText).toBe("");
    });

    it("drops stale bulk merge preview refreshes when a newer refresh wins", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const notesFolder = createFolder("notes");
      const immediateBodies: Record<string, string> = {
        [first.path]: "First body",
        [second.path]: "Second body",
      };
      const pendingReads: Array<ReturnType<typeof createDeferred<string>>> = [];

      app.vault.read = vi.fn(async (file: { path: string }) => {
        return immediateBodies[file.path] ?? "";
      });
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === "notes") {
          return notesFolder;
        }
        return null;
      });

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set([first.path, second.path]);
      (view as any).modules.bulk.anchorPath = first.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();

      app.vault.read = vi.fn(() => {
        const deferred = createDeferred<string>();
        pendingReads.push(deferred);
        return deferred.promise;
      });

      setLatestModalTextInput(1, "\n\n***\n\n");
      await flushAsyncWork(1);
      setLatestModalTextInput(1, "\n\n===\n\n");
      await flushAsyncWork(1);

      expect(pendingReads).toHaveLength(2);

      pendingReads[1]!.resolve("First body");
      await flushAsyncWork(1);
      expect(pendingReads).toHaveLength(3);

      pendingReads[2]!.resolve("Second body");
      await flushAsyncWork();

      expect(mockState.modalInstances.at(-1)?.renderedPreviewText).toBe([
        "# first\n\nFirst body",
        "# second\n\nSecond body",
      ].join("\n\n===\n\n"));

      pendingReads[0]!.resolve("First body");
      await flushAsyncWork();

      expect(app.vault.read).toHaveBeenCalledTimes(3);
      expect(mockState.modalInstances.at(-1)?.renderedPreviewText).toBe([
        "# first\n\nFirst body",
        "# second\n\nSecond body",
      ].join("\n\n===\n\n"));
    });

    it("does not rerender bulk merge modal after successful submit closes it", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const notesFolder = createFolder("notes");

      app.vault.read = vi.fn(async (file: { path: string }) => {
        return `${file.path} body`;
      });
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === "notes") {
          return notesFolder;
        }
        return null;
      });

      vi.mocked(mergeNotes).mockResolvedValueOnce({
        ok: true,
        mergedFile: createMarkdownFile("notes/Merged notes.md") as unknown as any,
        sourceCount: 2,
      });

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set([first.path, second.path]);
      (view as any).modules.bulk.anchorPath = first.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];
      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();

      const modal = mockState.modalInstances.at(-1);
      expect(modal).toBeDefined();

      clickLatestModalButton("Merge notes");
      await flushAsyncWork();

      expect(mergeNotes).toHaveBeenCalledTimes(1);
      expect(modal?.buttons).toEqual([]);
      expect(modal?.messages).toEqual([]);
      expect(modal?.renderedPreviewText).toBe("");
    });

    it("runs post-merge trash only after merge success", async () => {
      const { view, app } = createViewWithFile("notes/seed.md");
      const first = createMarkdownFile("notes/first.md");
      const second = createMarkdownFile("notes/second.md");
      const notesFolder = createFolder("notes");

      app.vault.read = vi.fn(async (file: { path: string }) => {
        return `${file.path} body`;
      });
      app.vault.getAbstractFileByPath = vi.fn((requestedPath: string) => {
        if (requestedPath === first.path) {
          return first;
        }
        if (requestedPath === second.path) {
          return second;
        }
        if (requestedPath === "notes") {
          return notesFolder;
        }
        return null;
      });

      (view as any).modules.bulk.bulkMode = true;
      (view as any).modules.bulk.selectedPaths = new Set([first.path, second.path]);
      (view as any).modules.bulk.anchorPath = first.path;
      (view as any).baseCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).visibleCards = [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ];
      (view as any).modules.projection.deriveVisibleCards = vi.fn(() => [
        createCardRecordFromPath(first.path),
        createCardRecordFromPath(second.path),
      ]);

      await (view as any).onOpen();

      const toolbarActionHandler = mockState.panelEventHandlers["toolbar-action"];

      vi.mocked(mergeNotes).mockReset();
      vi.mocked(mergeNotes).mockResolvedValue({ ok: false, error: "merge failed" } as any);
      vi.mocked(batchTrashFiles).mockClear();

      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();
      clickLatestModalButton("Trash source notes after merge");
      await flushAsyncWork(1);
      clickLatestModalButton("Merge notes");
      await flushAsyncWork();

      expect(mergeNotes).toHaveBeenCalledTimes(1);
      expect(batchTrashFiles).not.toHaveBeenCalled();
      expect(mockState.noticeMessages).toContain("Failed to merge notes: merge failed");
      expect(mockState.modalInstances.at(-1)?.title).toBe("Merge selected notes");
      expect(mockState.modalInstances.at(-1)?.buttons.some((button) => button.text === "Merge notes")).toBe(true);

      vi.mocked(mergeNotes).mockResolvedValueOnce({
        ok: true,
        mergedFile: createMarkdownFile("notes/Merged notes.md") as unknown as any,
        sourceCount: 2,
      });
      vi.mocked(batchTrashFiles).mockResolvedValueOnce({
        succeeded: [{ ok: true, file: first as unknown as any }],
        failed: [{ ok: false, error: "trash blocked", path: second.path }],
      });

      toolbarActionHandler({ detail: { action: "bulk-merge-selected" } });
      await flushAsyncWork();
      clickLatestModalButton("Trash source notes after merge");
      await flushAsyncWork(1);
      clickLatestModalButton("Merge notes");
      await flushAsyncWork();

      expect(batchTrashFiles).toHaveBeenCalledTimes(1);
      expect(batchTrashFiles).toHaveBeenCalledWith(app, [first, second]);
      expect(Array.from((view as any).modules.bulk.selectedPaths)).toEqual([second.path]);
      expect((view as any).modules.bulk.anchorPath).toBe(second.path);
    });
  });
});
