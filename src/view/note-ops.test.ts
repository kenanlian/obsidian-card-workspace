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
  addTagToFile,
  batchAddTagToFiles,
  batchDeleteFiles,
  batchDeleteFilesUsingObsidianPreference,
  batchMoveFiles,
  batchRemoveTagFromFiles,
  batchTrashFiles,
  deleteFileUsingObsidianPreference,
  duplicateFile,
  mergeNotes,
  normalizeTagForFrontmatter,
  removeTagFromFile,
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
  fileManager: {
    trashFile: (file: TFile) => Promise<void>;
  };
  vault: {
    trash: (file: TFile, system: boolean) => Promise<void>;
  };
}

interface MockAppForDelete {
  fileManager: {
    trashFile: (file: TFile) => Promise<void>;
  };
  vault: {
    trash: (file: TFile, system: boolean) => Promise<void>;
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

interface MockTagPosition {
  start: { offset: number };
  end: { offset: number };
}

interface MockTagCacheEntry {
  tag: string;
  position: MockTagPosition;
}

interface MockAppForTagMutation {
  fileManager: {
    processFrontMatter: (file: TFile, fn: (frontmatter: Record<string, unknown>) => void) => Promise<void>;
  };
  vault: {
    process: (file: TFile, fn: (content: string) => string) => Promise<string>;
  };
  metadataCache: {
    getFileCache: (file: TFile) => { tags?: MockTagCacheEntry[] } | null;
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

function createTagCacheEntry(content: string, rawTag: string, occurrence: number = 0): MockTagCacheEntry {
  let fromIndex = 0;
  let start = -1;
  for (let index = 0; index <= occurrence; index += 1) {
    start = content.indexOf(rawTag, fromIndex);
    if (start === -1) {
      throw new Error(`Tag "${rawTag}" occurrence ${occurrence} not found.`);
    }

    fromIndex = start + rawTag.length;
  }

  return {
    tag: rawTag,
    position: {
      start: { offset: start },
      end: { offset: start + rawTag.length },
    },
  };
}


describe("normalizeTagForFrontmatter", () => {
  it("trims, removes leading hash, and lowercases tag path segments", () => {
    expect(normalizeTagForFrontmatter("  #Project / Alpha / Beta  ")).toBe("project/alpha/beta");
  });
});

describe("addTagToFile", () => {
  it("creates frontmatter tags when missing and is idempotent for existing normalized tags", async () => {
    const file = createFile("notes/tagged.md");
    const frontmatter: Record<string, unknown> = {};
    const app: MockAppForTagMutation = {
      fileManager: {
        processFrontMatter: vi.fn(async (_file, mutate) => {
          mutate(frontmatter);
        }),
      },
      vault: {
        process: vi.fn(async (_file, mutate) => mutate("")),
      },
      metadataCache: {
        getFileCache: vi.fn(() => null),
      },
    };

    const first = await addTagToFile(app as unknown as any, file, "  #Project/Alpha ");
    const second = await addTagToFile(app as unknown as any, file, "#project/alpha");

    expect(first).toEqual({ ok: true, file });
    expect(second).toEqual({ ok: true, file });
    expect(frontmatter).toEqual({ tags: ["project/alpha"] });
    expect(vi.mocked(app.fileManager.processFrontMatter)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(app.vault.process)).not.toHaveBeenCalled();
  });

  it("coerces string tag fields into a normalized tags array", async () => {
    const file = createFile("notes/string-tag.md");
    const frontmatter: Record<string, unknown> = {
      tag: "#Existing/Path",
    };
    const app: MockAppForTagMutation = {
      fileManager: {
        processFrontMatter: vi.fn(async (_file, mutate) => {
          mutate(frontmatter);
        }),
      },
      vault: {
        process: vi.fn(async (_file, mutate) => mutate("")),
      },
      metadataCache: {
        getFileCache: vi.fn(() => null),
      },
    };

    const result = await addTagToFile(app as unknown as any, file, "new/tag");

    expect(result).toEqual({ ok: true, file });
    expect(frontmatter).toEqual({ tags: ["existing/path", "new/tag"] });
  });

  it("returns a failure result when processFrontMatter throws", async () => {
    const file = createFile("notes/frontmatter-error.md");
    const app: MockAppForTagMutation = {
      fileManager: {
        processFrontMatter: vi.fn(async () => {
          throw new Error("yaml parse failed");
        }),
      },
      vault: {
        process: vi.fn(async (_file, mutate) => mutate("")),
      },
      metadataCache: {
        getFileCache: vi.fn(() => null),
      },
    };

    const result = await addTagToFile(app as unknown as any, file, "project");

    expect(result).toEqual({
      ok: false,
      error: "Error: yaml parse failed",
      path: "notes/frontmatter-error.md",
    });
  });
});

describe("removeTagFromFile", () => {
  it("removes matching parent and descendant tags from frontmatter and inline tag cache ranges", async () => {
    const file = createFile("notes/remove-tag.md");
    const frontmatter: Record<string, unknown> = {
      tag: "#Keep/Me",
      tags: ["#Project/Alpha", "project/alpha/task", "project/beta", "second/tag"],
    };
    let content = "Intro #Project/Alpha middle #project/alpha/task and #project/beta outro #Project/Alpha";
    const app: MockAppForTagMutation & { vault: { cachedRead: (file: TFile) => Promise<string> } } = {
      fileManager: {
        processFrontMatter: vi.fn(async (_file, mutate) => {
          mutate(frontmatter);
        }),
      },
      vault: {
        cachedRead: vi.fn(async () => content),
        process: vi.fn(async (_file, mutate) => {
          content = mutate(content);
          return content;
        }),
      },
      metadataCache: {
        getFileCache: vi.fn(() => ({
          tags: [
            createTagCacheEntry(content, "#Project/Alpha", 0),
            createTagCacheEntry(content, "#project/alpha/task"),
            createTagCacheEntry(content, "#project/beta"),
            createTagCacheEntry(content, "#Project/Alpha", 1),
          ],
        })),
      },
    };

    const result = await removeTagFromFile(app as unknown as any, file, "project/alpha");

    expect(result).toEqual({ ok: true, changed: true, file });
    expect(frontmatter).toEqual({ tags: ["project/beta", "second/tag", "keep/me"] });
    expect(content).toBe("Intro  middle  and #project/beta outro ");
  });

  it("keeps sibling branches untouched when removing a nested parent tag", async () => {
    const file = createFile("notes/remove-branch.md");
    const frontmatter: Record<string, unknown> = {
      tags: ["project/alpha/task", "project/beta", "project/beta/task"],
    };
    let content = "Body #project/alpha/task #project/beta #project/beta/task";
    const app: MockAppForTagMutation & { vault: { cachedRead: (file: TFile) => Promise<string> } } = {
      fileManager: {
        processFrontMatter: vi.fn(async (_file, mutate) => {
          mutate(frontmatter);
        }),
      },
      vault: {
        cachedRead: vi.fn(async () => content),
        process: vi.fn(async (_file, mutate) => {
          content = mutate(content);
          return content;
        }),
      },
      metadataCache: {
        getFileCache: vi.fn(() => ({
          tags: [
            createTagCacheEntry(content, "#project/alpha/task"),
            createTagCacheEntry(content, "#project/beta"),
            createTagCacheEntry(content, "#project/beta/task"),
          ],
        })),
      },
    };

    const result = await removeTagFromFile(app as unknown as any, file, "project/alpha");

    expect(result).toEqual({ ok: true, changed: true, file });
    expect(frontmatter).toEqual({ tags: ["project/beta", "project/beta/task"] });
    expect(content).toBe("Body  #project/beta #project/beta/task");
  });

  it("keeps stale inline ranges as a no-op while still updating frontmatter", async () => {
    const file = createFile("notes/stale-range.md");
    const frontmatter: Record<string, unknown> = {
      tags: ["project/alpha", "keep"],
    };
    let content = "Intro #project/alpha";
    const staleRange = createTagCacheEntry(content, "#project/alpha");
    content = "Intro #changed/tag";
    const app: MockAppForTagMutation & { vault: { cachedRead: (file: TFile) => Promise<string> } } = {
      fileManager: {
        processFrontMatter: vi.fn(async (_file, mutate) => {
          mutate(frontmatter);
        }),
      },
      vault: {
        cachedRead: vi.fn(async () => content),
        process: vi.fn(async (_file, mutate) => {
          content = mutate(content);
          return content;
        }),
      },
      metadataCache: {
        getFileCache: vi.fn(() => ({
          tags: [staleRange],
        })),
      },
    };

    const result = await removeTagFromFile(app as unknown as any, file, "project/alpha");

    expect(result).toEqual({ ok: true, changed: true, file });
    expect(frontmatter).toEqual({ tags: ["keep"] });
    expect(content).toBe("Intro #changed/tag");
  });

  it("returns a no-op result when the tag is absent from frontmatter and inline cache", async () => {
    const file = createFile("notes/idempotent-remove.md");
    const frontmatter: Record<string, unknown> = {
      tags: ["keep"],
    };
    let content = "Body without matching tag";
    const app: MockAppForTagMutation & { vault: { cachedRead: (file: TFile) => Promise<string> } } = {
      fileManager: {
        processFrontMatter: vi.fn(async (_file, mutate) => {
          mutate(frontmatter);
        }),
      },
      vault: {
        cachedRead: vi.fn(async () => content),
        process: vi.fn(async (_file, mutate) => {
          content = mutate(content);
          return content;
        }),
      },
      metadataCache: {
        getFileCache: vi.fn(() => null),
      },
    };

    const result = await removeTagFromFile(app as unknown as any, file, "project/alpha");

    expect(result).toEqual({ ok: true, changed: false, file });
    expect(frontmatter).toEqual({ tags: ["keep"] });
    expect(content).toBe("Body without matching tag");
    expect(vi.mocked(app.vault.process)).not.toHaveBeenCalled();
  });
  it("skips inline tags inside fenced code blocks", async () => {
    const file = createFile("notes/code-block.md");
    const frontmatter: Record<string, unknown> = { tags: ["project"] };
    let content = "Intro\n\n```\n#project\n```\n\nOutro #project";
    const app: MockAppForTagMutation & { vault: { cachedRead: (file: TFile) => Promise<string> } } = {
      fileManager: {
        processFrontMatter: vi.fn(async (_file, mutate) => {
          mutate(frontmatter);
        }),
      },
      vault: {
        cachedRead: vi.fn(async () => content),
        process: vi.fn(async (_file, mutate) => {
          content = mutate(content);
          return content;
        }),
      },
      metadataCache: {
        getFileCache: vi.fn(() => ({
          tags: [
            createTagCacheEntry(content, "#project", 0),
            createTagCacheEntry(content, "#project", 1),
          ],
        })),
      },
    };

    const result = await removeTagFromFile(app as unknown as any, file, "project");

    expect(result).toEqual({ ok: true, changed: true, file });
    expect(frontmatter).toEqual({});
    expect(content).toBe("Intro\n\n```\n#project\n```\n\nOutro ");
  });

  it("skips inline tags inside inline code spans", async () => {
    const file = createFile("notes/inline-code.md");
    const frontmatter: Record<string, unknown> = { tags: ["project"] };
    let content = "Intro `#project` outro #project";
    const app: MockAppForTagMutation & { vault: { cachedRead: (file: TFile) => Promise<string> } } = {
      fileManager: {
        processFrontMatter: vi.fn(async (_file, mutate) => {
          mutate(frontmatter);
        }),
      },
      vault: {
        cachedRead: vi.fn(async () => content),
        process: vi.fn(async (_file, mutate) => {
          content = mutate(content);
          return content;
        }),
      },
      metadataCache: {
        getFileCache: vi.fn(() => ({
          tags: [
            createTagCacheEntry(content, "#project", 0),
            createTagCacheEntry(content, "#project", 1),
          ],
        })),
      },
    };

    const result = await removeTagFromFile(app as unknown as any, file, "project");
    expect(result).toEqual({ ok: true, changed: true, file });
    expect(frontmatter).toEqual({});
    expect(content).toBe("Intro `#project` outro ");
  });

  it("skips inline tags inside HTML tags", async () => {
    const file = createFile("notes/html-tag.md");
    const frontmatter: Record<string, unknown> = { tags: ["project"] };
    let content = "Intro <span>#project</span> outro #project";
    const app: MockAppForTagMutation & { vault: { cachedRead: (file: TFile) => Promise<string> } } = {
      fileManager: {
        processFrontMatter: vi.fn(async (_file, mutate) => {
          mutate(frontmatter);
        }),
      },
      vault: {
        cachedRead: vi.fn(async () => content),
        process: vi.fn(async (_file, mutate) => {
          content = mutate(content);
          return content;
        }),
      },
      metadataCache: {
        getFileCache: vi.fn(() => ({
          tags: [
            createTagCacheEntry(content, "#project", 0),
            createTagCacheEntry(content, "#project", 1),
          ],
        })),
      },
    };

    const result = await removeTagFromFile(app as unknown as any, file, "project");

    expect(result).toEqual({ ok: true, changed: true, file });
    expect(frontmatter).toEqual({});
    expect(content).toBe("Intro <span>#project</span> outro ");
  });
});

describe("batch tag operations", () => {
  it("continues bulk add and remove after partial failures", async () => {
    const first = createFile("notes/first.md");
    const second = createFile("notes/second.md");
    const third = createFile("notes/third.md");
    const fourth = createFile("notes/fourth.md");
    const frontmatterByPath = new Map<string, Record<string, unknown>>([
      [first.path, { tags: [] }],
      [second.path, { tags: [] }],
      [third.path, { tags: ["project/alpha"] }],
      [fourth.path, { tags: ["keep"] }],
    ]);
    const contentByPath = new Map<string, string>([
      [first.path, "#project"],
      [second.path, "#project"],
      [third.path, "#project/alpha"],
      [fourth.path, "#keep"],
    ]);
    const app: MockAppForTagMutation & { vault: { cachedRead: (file: TFile) => Promise<string> } } = {
      fileManager: {
        processFrontMatter: vi.fn(async (file, mutate) => {
          if (file.path === second.path) {
            throw new Error("frontmatter blocked");
          }

          mutate(frontmatterByPath.get(file.path) ?? {});
        }),
      },
      vault: {
        cachedRead: vi.fn(async (file: TFile) => contentByPath.get(file.path) ?? ""),
        process: vi.fn(async (file, mutate) => {
          const nextContent = mutate(contentByPath.get(file.path) ?? "");
          contentByPath.set(file.path, nextContent);
          return nextContent;
        }),
      },
      metadataCache: {
        getFileCache: vi.fn((file: TFile) => {
          const content = contentByPath.get(file.path) ?? "";
          if (content.length === 0) {
            return null;
          }

          const tags: MockTagCacheEntry[] = [];
          if (content.includes("#project/alpha")) {
            tags.push(createTagCacheEntry(content, "#project/alpha"));
          }
          if (content.includes("#project")) {
            tags.push(createTagCacheEntry(content, "#project"));
          }
          if (content.includes("#keep")) {
            tags.push(createTagCacheEntry(content, "#keep"));
          }

          return tags.length > 0 ? { tags } : null;
        }),
      },
    };

    const addSummary = await batchAddTagToFiles(app as unknown as any, [first, second, third], "project");
    const removeSummary = await batchRemoveTagFromFiles(app as unknown as any, [first, second, third, fourth], "project");

    expect(addSummary.succeeded.map((entry) => entry.file.path)).toEqual(["notes/first.md", "notes/third.md"]);
    expect(addSummary.failed).toEqual([
      {
        ok: false,
        error: "Error: frontmatter blocked",
        path: "notes/second.md",
      },
    ]);
    expect(removeSummary.changed.map((entry) => entry.file.path)).toEqual(["notes/first.md", "notes/third.md"]);
    expect(removeSummary.noop.map((entry) => entry.file.path)).toEqual(["notes/fourth.md"]);
    expect(removeSummary.failed).toEqual([
      {
        ok: false,
        error: "Error: frontmatter blocked",
        path: "notes/second.md",
      },
    ]);
    expect(frontmatterByPath.get(first.path)).toEqual({});
    expect(frontmatterByPath.get(third.path)).toEqual({});
    expect(frontmatterByPath.get(fourth.path)).toEqual({ tags: ["keep"] });
    expect(contentByPath.get(first.path)).toBe("");
    expect(contentByPath.get(second.path)).toBe("#project");
    expect(contentByPath.get(third.path)).toBe("");
    expect(contentByPath.get(fourth.path)).toBe("#keep");
  });
});

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
      fileManager: {
        trashFile: vi.fn(async (file: TFile): Promise<void> => {
          if (file.path === second.path) {
            throw new Error("trash blocked");
          }
        }),
      },
      vault: {
        trash: vi.fn(async (): Promise<void> => {
          return;
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
    expect(vi.mocked(app.fileManager.trashFile)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(app.fileManager.trashFile)).toHaveBeenNthCalledWith(1, first);
    expect(vi.mocked(app.fileManager.trashFile)).toHaveBeenNthCalledWith(2, second);
    expect(vi.mocked(app.fileManager.trashFile)).toHaveBeenNthCalledWith(3, third);
    expect(vi.mocked(app.vault.trash)).not.toHaveBeenCalled();
  });
});

describe("batchDeleteFiles", () => {
  it("returns a partial-failure summary while continuing remaining delete operations", async () => {
    const first = createFile("notes/first.md");
    const second = createFile("notes/second.md");
    const third = createFile("notes/third.md");
    const app: MockAppForDelete = {
      fileManager: {
        trashFile: vi.fn(async (file: TFile): Promise<void> => {
          if (file.path === second.path) {
            throw new Error("delete blocked");
          }
        }),
      },
      vault: {
        trash: vi.fn(async (): Promise<void> => {
          return;
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
    expect(vi.mocked(app.fileManager.trashFile)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(app.fileManager.trashFile)).toHaveBeenNthCalledWith(1, first);
    expect(vi.mocked(app.fileManager.trashFile)).toHaveBeenNthCalledWith(2, second);
    expect(vi.mocked(app.fileManager.trashFile)).toHaveBeenNthCalledWith(3, third);
    expect(vi.mocked(app.vault.trash)).not.toHaveBeenCalled();
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

  it("defaults to two newlines between merged sections", async () => {
    const first = createFile("notes/first.md");
    const second = createFile("notes/second.md");
    const targetFolder = new TFolder();
    (targetFolder as unknown as { path: string }).path = "archive";

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

    const result = await mergeNotes(app as unknown as any, [first, second], targetFolder, "Merged Title");

    expect(result.ok).toBe(true);
    expect(vi.mocked(app.vault.create).mock.calls[0]?.[1]).toBe(
      "# first\n\nFirst body\n\n# second\n\nSecond body",
    );
  });
});
