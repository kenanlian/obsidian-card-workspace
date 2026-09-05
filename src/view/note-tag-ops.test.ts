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

  class MockNotice {
    constructor(_message: string) {
      return;
    }
  }

  return {
    App: class MockApp {},
    Notice: MockNotice,
    TFile: MockTFile,
  };
});

import { TFile } from "obsidian";
import {
  addTagToFile,
  batchAddTagToFiles,
  batchRemoveTagFromFiles,
  batchRenameTagInFiles,
  normalizeTagForFrontmatter,
  removeTagFromFile,
  renameTagInFile,
} from "./note-tag-ops";


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
    cachedRead?: (file: TFile) => Promise<string>;
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


describe("renameTagInFile", () => {
  it("renames the tag and its descendants in frontmatter and inline ranges", async () => {
    const file = createFile("notes/rename-branch.md");
    const frontmatter: Record<string, unknown> = {
      tags: ["project/alpha/task", "project/beta", "keep"],
    };
    let content = "Body #Project/Alpha/Task tail #project/beta";
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
            createTagCacheEntry(content, "#Project/Alpha/Task"),
            createTagCacheEntry(content, "#project/beta"),
          ],
        })),
      },
    };

    const result = await renameTagInFile(app as unknown as any, file, "#Project/Alpha", "work/done");

    expect(result).toEqual({ ok: true, changed: true, file });
    expect(frontmatter).toEqual({ tags: ["work/done/task", "project/beta", "keep"] });
    expect(content).toBe("Body #work/done/task tail #project/beta");
  });

  it("merges frontmatter duplicates when the target tag already exists", async () => {
    const file = createFile("notes/merge-target.md");
    const frontmatter: Record<string, unknown> = {
      tags: ["old", "existing"],
    };
    const app: MockAppForTagMutation = {
      fileManager: {
        processFrontMatter: vi.fn(async (_file, mutate) => {
          mutate(frontmatter);
        }),
      },
      vault: {
        process: vi.fn(async () => ""),
      },
      metadataCache: {
        getFileCache: vi.fn(() => null),
      },
    };

    const result = await renameTagInFile(app as unknown as any, file, "old", "existing");

    expect(result).toEqual({ ok: true, changed: true, file });
    expect(frontmatter).toEqual({ tags: ["existing"] });
  });

  it("is a no-op for an unchanged name or an absent tag", async () => {
    const file = createFile("notes/noop-rename.md");
    const frontmatter: Record<string, unknown> = { tags: ["keep"] };
    const app: MockAppForTagMutation & { vault: { cachedRead: (file: TFile) => Promise<string> } } = {
      fileManager: {
        processFrontMatter: vi.fn(async (_file, mutate) => {
          mutate(frontmatter);
        }),
      },
      vault: {
        cachedRead: vi.fn(async () => "Body"),
        process: vi.fn(async () => "Body"),
      },
      metadataCache: {
        getFileCache: vi.fn(() => null),
      },
    };

    const sameName = await renameTagInFile(app as unknown as any, file, "keep", "keep");
    expect(sameName).toEqual({ ok: true, changed: false, file });

    const absent = await renameTagInFile(app as unknown as any, file, "missing", "renamed");
    expect(absent).toEqual({ ok: true, changed: false, file });
    expect(frontmatter).toEqual({ tags: ["keep"] });
    expect(vi.mocked(app.vault.process as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("skips inline rename ranges inside fenced code blocks while renaming frontmatter", async () => {
    const file = createFile("notes/code-rename.md");
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
            createTagCacheEntry(content, "#project"),
            createTagCacheEntry(content, "#project", 1),
          ],
        })),
      },
    };

    const result = await renameTagInFile(app as unknown as any, file, "project", "renamed");

    expect(result).toEqual({ ok: true, changed: true, file });
    expect(frontmatter).toEqual({ tags: ["renamed"] });
    expect(content).toBe("Intro\n\n```\n#project\n```\n\nOutro #renamed");
  });

  it("returns a failure result for non-markdown files", async () => {
    const file = createFile("notes/picture.png", "png");
    const app: MockAppForTagMutation = {
      fileManager: { processFrontMatter: vi.fn() },
      vault: { process: vi.fn() },
      metadataCache: { getFileCache: vi.fn(() => null) },
    };

    const result = await renameTagInFile(app as unknown as any, file, "a", "b");
    expect(result).toEqual({ ok: false, error: expect.any(String), path: file.path });
  });
});

describe("batchRenameTagInFiles", () => {
  it("aggregates changed, noop, and failed results and continues past failures", async () => {
    const first = createFile("notes/first.md");
    const second = createFile("notes/second.md");
    const third = createFile("notes/third.md");
    const frontmatterByPath = new Map<string, Record<string, unknown>>([
      [first.path, { tags: ["a/one", "keep"] }],
      [second.path, { tags: ["keep"] }],
    ]);
    const app: MockAppForTagMutation = {
      fileManager: {
        processFrontMatter: vi.fn(async (file, mutate) => {
          if (file.path === third.path) {
            throw new Error("write denied");
          }
          mutate(frontmatterByPath.get(file.path) ?? {});
        }),
      },
      vault: { process: vi.fn(async () => "") },
      metadataCache: { getFileCache: vi.fn(() => null) },
    };

    const summary = await batchRenameTagInFiles(app as unknown as any, [first, second, third], "a", "b");

    expect(summary.changed).toHaveLength(1);
    expect(summary.changed[0]?.file).toBe(first);
    expect(summary.noop).toHaveLength(1);
    expect(summary.noop[0]?.file).toBe(second);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]).toMatchObject({ ok: false, path: third.path });
  });
});
