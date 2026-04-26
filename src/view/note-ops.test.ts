import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class MockTFile {
    path: string;
    basename: string;
    name: string;
    extension: string;
    parent: { path: string } | null;

    constructor(path: string = "") {
      this.path = path;
      this.name = path.replace(/.*\//, "");
      this.basename = this.name.replace(/\.md$/, "");
      this.extension = "md";
      const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      this.parent = { path: parentPath };
    }
  }

  class MockTFolder {
    path: string;
    name: string;
    children: unknown[];

    constructor(path: string = "") {
      this.path = path;
      this.name = path === "" ? "/" : path.replace(/.*\//, "");
      this.children = [];
    }
  }

  class MockNotice {
    constructor(_message: string) {
      return;
    }
  }

  return {
    App: class MockApp {},
    Notice: MockNotice,
    TFile: MockTFile,
    TFolder: MockTFolder,
  };
});

import { TFile, TFolder } from "obsidian";
import {
  batchDeleteFiles,
  batchDeleteFilesUsingObsidianPreference,
  batchMoveFiles,
  batchTrashFiles,
  duplicateFile,
  deleteFileUsingObsidianPreference,
  mergeNotes,
} from "./note-ops";

interface MockAppForMove {
  vault: {
    getAbstractFileByPath: (path: string) => unknown;
  };
  fileManager: {
    renameFile: (file: TFile, newPath: string) => Promise<void>;
  };
}

interface MockAppForTrash {
  vault: {
    trash: (file: TFile, system: boolean) => Promise<void>;
  };
}

interface MockAppForDelete {
  vault: {
    delete: (file: TFile) => Promise<void>;
  };
}

interface MockAppForPreferenceDelete {
  fileManager: {
    trashFile: (file: TFile) => Promise<void>;
  };
  vault: {
    delete: (file: TFile) => Promise<void>;
  };
}

interface MockAppForMerge {
  vault: {
    read: (file: TFile) => Promise<string>;
    create: (path: string, content: string) => Promise<TFile>;
    getAbstractFileByPath: (path: string) => unknown;
  };
}

interface MockAppForDuplicate {
  vault: {
    read: (file: TFile) => Promise<string>;
    create: (path: string, content: string) => Promise<TFile>;
    getAbstractFileByPath: (path: string) => unknown;
  };
}

function createFile(path: string, extension: string = "md"): TFile {
  const file = new TFile();
  (file as unknown as { path: string }).path = path;
  (file as unknown as { name: string }).name = path.replace(/.*\//, "");
  (file as unknown as { basename: string }).basename = path
    .replace(/.*\//, "")
    .replace(new RegExp(`\\.${extension}$`), "");
  (file as unknown as { extension: string }).extension = extension;
  const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  (file as unknown as { parent: { path: string } }).parent = { path: parentPath };
  return file;
}

describe("duplicateFile", () => {
  it('creates a same-folder copy and resolves name collisions', async () => {
    const source = createFile("notes/report.md");
    const firstCopy = createFile("notes/report copy.md");
    const secondCopy = createFile("notes/report copy 1.md");
    const fileMap = new Map<string, TFile>([
      [source.path, source],
      [firstCopy.path, firstCopy],
      [secondCopy.path, secondCopy],
    ]);

    const app: MockAppForDuplicate = {
      vault: {
        read: vi.fn(async (file: TFile): Promise<string> => {
          return file.path === source.path ? "Source body" : "";
        }),
        create: vi.fn(async (path: string, content: string): Promise<TFile> => {
          expect(content).toBe("Source body");
          const created = createFile(path);
          fileMap.set(path, created);
          return created;
        }),
        getAbstractFileByPath: vi.fn((path: string): unknown => fileMap.get(path) ?? null),
      },
    };

    const result = await duplicateFile(app as unknown as any, source);

    expect(result).toEqual({ ok: true, file: expect.objectContaining({ path: "notes/report copy 2.md" }) });
    expect(vi.mocked(app.vault.read)).toHaveBeenCalledWith(source);
    expect(vi.mocked(app.vault.create)).toHaveBeenCalledWith("notes/report copy 2.md", "Source body");
  });

  it("preserves non-markdown extensions and returns a failure result on create errors", async () => {
    const source = createFile("diagrams/flow.canvas", "canvas");
    const occupied = createFile("diagrams/flow copy.canvas", "canvas");
    const fileMap = new Map<string, TFile>([
      [source.path, source],
      [occupied.path, occupied],
    ]);

    const app: MockAppForDuplicate = {
      vault: {
        read: vi.fn(async (): Promise<string> => {
          return "Canvas body";
        }),
        create: vi.fn(async (path: string): Promise<TFile> => {
          if (path.endsWith("copy 1.canvas")) {
            throw new Error("create blocked");
          }

          const created = createFile(path, "canvas");
          fileMap.set(path, created);
          return created;
        }),
        getAbstractFileByPath: vi.fn((path: string): unknown => fileMap.get(path) ?? null),
      },
    };

    const result = await duplicateFile(app as unknown as any, source);

    expect(result).toEqual({
      ok: false,
      error: "Error: create blocked",
      path: "diagrams/flow.canvas",
    });
    expect(vi.mocked(app.vault.read)).toHaveBeenCalledWith(source);
    expect(vi.mocked(app.vault.create)).toHaveBeenCalledWith("diagrams/flow copy 1.canvas", "Canvas body");
  });
});

describe("batchMoveFiles", () => {
  it("returns a partial-failure summary while continuing remaining moves", async () => {
    const targetFolder = new TFolder();
    (targetFolder as unknown as { path: string }).path = "archive";
    (targetFolder as unknown as { name: string }).name = "archive";
    (targetFolder as unknown as { children: unknown[] }).children = [];
    const first = createFile("notes/first.md");
    const second = createFile("notes/second.md");
    const third = createFile("notes/third.md");
    const files = [first, second, third];

    const fileMap = new Map<string, TFile>([
      [first.path, first],
      [second.path, second],
      [third.path, third],
    ]);

    const app: MockAppForMove = {
      vault: {
        getAbstractFileByPath: (path: string): unknown => {
          return fileMap.get(path) ?? null;
        },
      },
      fileManager: {
        renameFile: vi.fn(async (file: TFile, newPath: string): Promise<void> => {
          if (file.path === second.path) {
            throw new Error("permission denied");
          }

          fileMap.delete(file.path);
          (file as unknown as { path: string }).path = newPath;
          (file as unknown as { name: string }).name = newPath.replace(/.*\//, "");
          (file as unknown as { basename: string }).basename = newPath
            .replace(/.*\//, "")
            .replace(/\.md$/, "");
          (file as unknown as { parent: { path: string } }).parent = { path: "archive" };
          fileMap.set(newPath, file);
        }),
      },
    };

    const summary = await batchMoveFiles(app as unknown as any, files, targetFolder);

    expect(summary.succeeded.map((entry: { file: TFile }) => entry.file.path)).toEqual([
      "archive/first.md",
      "archive/third.md",
    ]);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]).toMatchObject({
      ok: false,
      path: "notes/second.md",
    });
    expect(vi.mocked(app.fileManager.renameFile)).toHaveBeenCalledTimes(3);
  });
});

describe("batchTrashFiles", () => {
  it("returns a partial-failure summary while continuing remaining trash operations", async () => {
    const first = createFile("notes/first.md");
    const second = createFile("notes/second.md");
    const third = createFile("notes/third.md");
    const app: MockAppForTrash = {
      vault: {
        trash: vi.fn(async (file: TFile): Promise<void> => {
          if (file.path === second.path) {
            throw new Error("trash blocked");
          }
        }),
      },
    };

    const summary = await batchTrashFiles(app as unknown as any, [first, second, third]);

    expect(summary.succeeded.map((entry: { file: TFile }) => entry.file.path)).toEqual([
      "notes/first.md",
      "notes/third.md",
    ]);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]).toMatchObject({
      ok: false,
      path: "notes/second.md",
    });
    expect(vi.mocked(app.vault.trash)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(app.vault.trash).mock.calls[0]).toEqual([first, true]);
    expect(vi.mocked(app.vault.trash).mock.calls[1]).toEqual([second, true]);
    expect(vi.mocked(app.vault.trash).mock.calls[2]).toEqual([third, true]);
  });
});

describe("batchDeleteFiles", () => {
  it("returns a partial-failure summary while continuing remaining delete operations", async () => {
    const first = createFile("notes/first.md");
    const second = createFile("notes/second.md");
    const third = createFile("notes/third.md");
    const app: MockAppForDelete = {
      vault: {
        delete: vi.fn(async (file: TFile): Promise<void> => {
          if (file.path === second.path) {
            throw new Error("delete blocked");
          }
        }),
      },
    };

    const summary = await batchDeleteFiles(app as unknown as any, [first, second, third]);

    expect(summary.succeeded.map((entry: { file: TFile }) => entry.file.path)).toEqual([
      "notes/first.md",
      "notes/third.md",
    ]);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]).toMatchObject({
      ok: false,
      path: "notes/second.md",
    });
    expect(vi.mocked(app.vault.delete)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(app.vault.delete)).toHaveBeenNthCalledWith(1, first);
    expect(vi.mocked(app.vault.delete)).toHaveBeenNthCalledWith(2, second);
    expect(vi.mocked(app.vault.delete)).toHaveBeenNthCalledWith(3, third);
  });
});

describe("deleteFileUsingObsidianPreference", () => {
  it("uses fileManager.trashFile and preserves the result shape", async () => {
    const file = createFile("notes/first.md");
    const app: MockAppForPreferenceDelete = {
      fileManager: {
        trashFile: vi.fn(async (): Promise<void> => {
          return;
        }),
      },
      vault: {
        delete: vi.fn(async (): Promise<void> => {
          return;
        }),
      },
    };

    const result = await deleteFileUsingObsidianPreference(app as unknown as any, file);

    expect(result).toEqual({ ok: true, file });
    expect(vi.mocked(app.fileManager.trashFile)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(app.fileManager.trashFile)).toHaveBeenCalledWith(file);
    expect(vi.mocked(app.vault.delete)).not.toHaveBeenCalled();
  });

  it("returns a failure result when fileManager.trashFile throws", async () => {
    const file = createFile("notes/first.md");
    const app: MockAppForPreferenceDelete = {
      fileManager: {
        trashFile: vi.fn(async (): Promise<void> => {
          throw new Error("trash blocked");
        }),
      },
      vault: {
        delete: vi.fn(async (): Promise<void> => {
          return;
        }),
      },
    };

    const result = await deleteFileUsingObsidianPreference(app as unknown as any, file);

    expect(result).toMatchObject({ ok: false, path: "notes/first.md", error: "Error: trash blocked" });
    expect(vi.mocked(app.fileManager.trashFile)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(app.vault.delete)).not.toHaveBeenCalled();
  });
});

describe("batchDeleteFilesUsingObsidianPreference", () => {
  it("uses fileManager.trashFile for preference-respecting batch delete", async () => {
    const first = createFile("notes/first.md");
    const second = createFile("notes/second.md");
    const third = createFile("notes/third.md");
    const app: MockAppForPreferenceDelete = {
      fileManager: {
        trashFile: vi.fn(async (): Promise<void> => {
          return;
        }),
      },
      vault: {
        delete: vi.fn(async (): Promise<void> => {
          return;
        }),
      },
    };

    const summary = await batchDeleteFilesUsingObsidianPreference(app as unknown as any, [
      first,
      second,
      third,
    ]);

    expect(summary.succeeded.map((entry: { file: TFile }) => entry.file.path)).toEqual([
      "notes/first.md",
      "notes/second.md",
      "notes/third.md",
    ]);
    expect(summary.failed).toHaveLength(0);
    expect(vi.mocked(app.fileManager.trashFile)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(app.fileManager.trashFile).mock.calls[0]).toEqual([first]);
    expect(vi.mocked(app.fileManager.trashFile).mock.calls[1]).toEqual([second]);
    expect(vi.mocked(app.fileManager.trashFile).mock.calls[2]).toEqual([third]);
    expect(vi.mocked(app.vault.delete)).not.toHaveBeenCalled();
  });

  it("continues remaining files when one preference-respecting delete fails", async () => {
    const first = createFile("notes/first.md");
    const second = createFile("notes/second.md");
    const third = createFile("notes/third.md");
    const calls: string[] = [];
    const app: MockAppForPreferenceDelete = {
      fileManager: {
        trashFile: vi.fn(async (file: TFile): Promise<void> => {
          calls.push(file.path);
          if (file.path === second.path) {
            throw new Error("trash blocked");
          }
        }),
      },
      vault: {
        delete: vi.fn(async (): Promise<void> => {
          return;
        }),
      },
    };

    const summary = await batchDeleteFilesUsingObsidianPreference(app as unknown as any, [
      first,
      second,
      third,
    ]);

    expect(summary.succeeded.map((entry: { file: TFile }) => entry.file.path)).toEqual([
      "notes/first.md",
      "notes/third.md",
    ]);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]).toMatchObject({
      ok: false,
      path: "notes/second.md",
    });
    expect(calls).toEqual(["notes/first.md", "notes/second.md", "notes/third.md"]);
    expect(vi.mocked(app.fileManager.trashFile)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(app.vault.delete)).not.toHaveBeenCalled();
  });
});

describe("mergeNotes", () => {
  it("merges notes using provided order and separator", async () => {
    const first = createFile("notes/first.md");
    const second = createFile("notes/second.md");
    const targetFolder = new TFolder();
    (targetFolder as unknown as { path: string }).path = "archive";
    const separator = "\n\n***\n\n";

    const bodyByPath: Record<string, string> = {
      [first.path]: "First body",
      [second.path]: "Second body",
    };

    const app: MockAppForMerge = {
      vault: {
        read: vi.fn(async (file: TFile): Promise<string> => {
          return bodyByPath[file.path] ?? "";
        }),
        create: vi.fn(async (path: string): Promise<TFile> => {
          return createFile(path);
        }),
        getAbstractFileByPath: vi.fn(() => null),
      },
    };

    const result = await mergeNotes(
      app as unknown as any,
      [second, first],
      targetFolder,
      "Merged Title",
      separator,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sourceCount).toBe(2);
      expect(result.mergedFile.path).toBe("archive/Merged Title.md");
    }

    expect(vi.mocked(app.vault.read)).toHaveBeenNthCalledWith(1, second);
    expect(vi.mocked(app.vault.read)).toHaveBeenNthCalledWith(2, first);
    expect(vi.mocked(app.vault.create)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(app.vault.create).mock.calls[0]?.[0]).toBe("archive/Merged Title.md");
    expect(vi.mocked(app.vault.create).mock.calls[0]?.[1]).toBe(
      "# second\n\nSecond body\n\n***\n\n# first\n\nFirst body",
    );
  });

  it("normalizes merge title path separators to keep merged note in target folder", async () => {
    const first = createFile("notes/first.md");
    const second = createFile("notes/second.md");
    const targetFolder = new TFolder();
    (targetFolder as unknown as { path: string }).path = "archive";

    const app: MockAppForMerge = {
      vault: {
        read: vi.fn(async (file: TFile): Promise<string> => {
          return `${file.basename} body`;
        }),
        create: vi.fn(async (path: string): Promise<TFile> => {
          return createFile(path);
        }),
        getAbstractFileByPath: vi.fn(() => null),
      },
    };

    const result = await mergeNotes(
      app as unknown as any,
      [first, second],
      targetFolder,
      "..\\outside/merged",
      "\n\n---\n\n",
    );

    expect(result.ok).toBe(true);
    expect(vi.mocked(app.vault.create)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(app.vault.create).mock.calls[0]?.[0]).toBe("archive/.. outside merged.md");
  });

  it("falls back to default merged title when sanitized title is empty", async () => {
    const first = createFile("notes/first.md");
    const second = createFile("notes/second.md");
    const targetFolder = new TFolder();
    (targetFolder as unknown as { path: string }).path = "archive";

    const app: MockAppForMerge = {
      vault: {
        read: vi.fn(async (): Promise<string> => {
          return "body";
        }),
        create: vi.fn(async (path: string): Promise<TFile> => {
          return createFile(path);
        }),
        getAbstractFileByPath: vi.fn(() => null),
      },
    };

    const result = await mergeNotes(
      app as unknown as any,
      [first, second],
      targetFolder,
      "///\\\\",
    );

    expect(result.ok).toBe(true);
    expect(vi.mocked(app.vault.create).mock.calls[0]?.[0]).toBe("archive/Merged notes.md");
  });
});
