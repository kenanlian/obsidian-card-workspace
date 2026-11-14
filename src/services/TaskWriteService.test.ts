import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class MarkdownView {
    file: { path: string } | null = null;
    editor: {
      getLine: (line: number) => string;
      lineCount: () => number;
      transaction: (tx: unknown) => void;
    } | null = null;

    constructor(_leaf?: unknown) {}
  }

  class TFile {
    path = "";
  }

  return { MarkdownView, TFile };
});

import { MarkdownView, TFile, type App, type Editor, type EditorTransaction } from "obsidian";
import {
  TASK_DATE_MARKERS,
  applyLinePatches,
  setTaskDate,
  setTaskStatus,
  toggleTaskStatus,
  type TaskStatusOptions,
} from "../tasks";
import { TaskWriteService, type TaskWriteTarget } from "./TaskWriteService";

const PATH = "notes/task.md";
const AUTO: TaskStatusOptions = { today: "2026-11-14", autoDoneDate: true };
const MANUAL: TaskStatusOptions = { today: "2026-11-14", autoDoneDate: false };
const DONE = TASK_DATE_MARKERS.done;
const DUE = TASK_DATE_MARKERS.due;

interface VaultHarness {
  service: TaskWriteService;
  stored: Map<string, string>;
  process: ReturnType<typeof vi.fn>;
  files: Map<string, TFile>;
  leaves: Array<{ view: unknown }>;
  app: {
    workspace: {
      getLeavesOfType: ReturnType<typeof vi.fn>;
      getActiveViewOfType: ReturnType<typeof vi.fn>;
      getMostRecentLeaf: ReturnType<typeof vi.fn>;
    };
  };
}

function target(lineText: string, line = 0, filePath = PATH): TaskWriteTarget {
  return { filePath, line, lineText };
}

function createVault(contents: Record<string, string>, options?: { getFileByPath?: boolean }): VaultHarness {
  const stored = new Map(Object.entries(contents));
  const files = new Map<string, TFile>();
  for (const path of Object.keys(contents)) {
    const file = new TFile();
    file.path = path;
    files.set(path, file);
  }
  const leaves: Array<{ view: unknown }> = [];
  const process = vi.fn(async (file: TFile, change: (data: string) => string) => {
    const current = stored.get(file.path);
    if (current === undefined) throw new Error(`Missing content for ${file.path}`);
    const next = change(current);
    if (next !== current) stored.set(file.path, next);
    return next;
  });
  const useGetFileByPath = options?.getFileByPath !== false;
  const vault = {
    ...(useGetFileByPath ? { getFileByPath: (path: string) => files.get(path) ?? null } : {}),
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    process,
  };
  const workspace = {
    getLeavesOfType: vi.fn(() => leaves),
    getActiveViewOfType: vi.fn(() => null),
    getMostRecentLeaf: vi.fn(() => null),
  };
  const app = { vault, workspace } as unknown as App;
  return { service: new TaskWriteService(app), stored, process, files, leaves, app: { workspace } };
}

function openEditor(lines: string[], path = PATH): { view: MarkdownView; transaction: ReturnType<typeof vi.fn> } {
  const transaction = vi.fn();
  const view = new MarkdownView({} as never);
  const file = new TFile();
  file.path = path;
  view.file = file;
  view.editor = {
    getLine: (index: number) => lines[index] ?? "",
    lineCount: () => lines.length,
    transaction,
  } as unknown as Editor;
  return { view, transaction };
}

function statusPatch(lineText: string): { from: number; to: number; insert: string }[] | null {
  return lineText.startsWith("- [ ] ") ? [{ from: 3, to: 4, insert: "x" }] : null;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TaskWriteService", () => {
  it("updates the exact indexed line and leaves a duplicate later in the file", async () => {
    const harness = createVault({ [PATH]: "- [ ] task\n- [ ] other\n- [ ] task\n" });
    const result = await harness.service.apply(target("- [ ] task", 0), statusPatch);
    expect(result).toEqual({ outcome: "ok", changed: true, line: 0 });
    expect(harness.stored.get(PATH)).toBe("- [x] task\n- [ ] other\n- [ ] task\n");
  });

  it("follows a task that moved when that line text is unique", async () => {
    const harness = createVault({ [PATH]: "note\n- [ ] task\n" });
    const result = await harness.service.apply(target("- [ ] task", 0), statusPatch);
    expect(result).toEqual({ outcome: "ok", changed: true, line: 1 });
    expect(harness.stored.get(PATH)).toBe("note\n- [x] task\n");
  });

  it("refuses an ambiguous duplicate and a missing line without writing", async () => {
    const duplicate = createVault({ [PATH]: "- [ ] task\nnote\n- [ ] task\n" });
    const ambiguous = await duplicate.service.apply(target("- [ ] task", 1), statusPatch);
    expect(ambiguous).toEqual({ outcome: "error", reason: "line-not-found" });
    expect(duplicate.stored.get(PATH)).toBe("- [ ] task\nnote\n- [ ] task\n");

    const missing = createVault({ [PATH]: "note\n" });
    const absent = await missing.service.apply(target("- [ ] task", 0), statusPatch);
    expect(absent).toEqual({ outcome: "error", reason: "line-not-found" });
    expect(missing.stored.get(PATH)).toBe("note\n");
    expect(missing.process).toHaveBeenCalledTimes(1);
  });

  it("rejects a located line that is no longer a task", async () => {
    const harness = createVault({ [PATH]: "note\nhello\n" });
    const result = await harness.service.apply(target("hello", 0), () => [{ from: 0, to: 0, insert: "x" }]);
    expect(result).toEqual({ outcome: "error", reason: "not-a-task" });
    expect(harness.stored.get(PATH)).toBe("note\nhello\n");
  });

  it("preserves each line ending and only replaces the edited line", async () => {
    const harness = createVault({
      [PATH]: "keep\r\n- [ ] task\n- [ ] bare\r",
    });
    const first = await harness.service.apply(target("- [ ] task", 1), statusPatch);
    expect(first).toEqual({ outcome: "ok", changed: true, line: 1 });
    expect(harness.stored.get(PATH)).toBe("keep\r\n- [x] task\n- [ ] bare\r");

    const second = await harness.service.apply(target("- [ ] bare", 2), statusPatch);
    expect(second).toEqual({ outcome: "ok", changed: true, line: 2 });
    expect(harness.stored.get(PATH)).toBe("keep\r\n- [x] task\n- [x] bare\r");
  });

  it("reports a null edit and a no-op patch without modifying the file", async () => {
    const original = "- [ ] task\r\nkeep\n";
    const harness = createVault({ [PATH]: original });
    const skipped = await harness.service.apply(target("- [ ] task"), () => null);
    expect(skipped).toEqual({ outcome: "ok", changed: false, line: 0 });
    const same = await harness.service.apply(target("- [ ] task"), () => [{ from: 3, to: 4, insert: " " }]);
    expect(same).toEqual({ outcome: "ok", changed: false, line: 0 });
    expect(harness.stored.get(PATH)).toBe(original);
    expect(harness.process).toHaveBeenCalledTimes(2);
    const returned = harness.process.mock.results.map((entry) => entry.value);
    await expect(Promise.all(returned)).resolves.toEqual([original, original]);
  });

  it("writes an open editor with one transaction and does not call vault.process", async () => {
    const line = "- [ ] task";
    const patches = setTaskStatus(line, true, AUTO);
    expect(patches).not.toBeNull();
    const harness = createVault({ [PATH]: "stale vault\n" });
    const editor = openEditor([line]);
    harness.leaves.push({ view: editor.view });

    const result = await harness.service.setStatus(target(line), true, AUTO);

    expect(result).toEqual({ outcome: "ok", changed: true, line: 0 });
    expect(editor.transaction).toHaveBeenCalledTimes(1);
    expect(editor.transaction).toHaveBeenCalledWith({
      changes: patches!.map((patch) => ({
        from: { line: 0, ch: patch.from },
        to: { line: 0, ch: patch.to },
        text: patch.insert,
      })),
    } satisfies EditorTransaction);
    expect(patches?.[0]).toEqual({ from: 3, to: 4, insert: "x" });
    expect(harness.process).not.toHaveBeenCalled();
    expect(harness.stored.get(PATH)).toBe("stale vault\n");
  });

  it("locates a shifted editor line and ignores a trailing carriage return", async () => {
    const harness = createVault({ [PATH]: "- [ ] task\n" });
    const editor = openEditor(["preface", "- [ ] task\r"]);
    harness.leaves.push({ view: editor.view });
    const result = await harness.service.apply(target("- [ ] task", 4), statusPatch);
    expect(result).toEqual({ outcome: "ok", changed: true, line: 1 });
    expect(editor.transaction).toHaveBeenCalledWith({
      changes: [{ from: { line: 1, ch: 3 }, to: { line: 1, ch: 4 }, text: "x" }],
    });
    expect(harness.process).not.toHaveBeenCalled();
  });

  it("does not fall through to the vault when the open editor no longer has the line", async () => {
    const harness = createVault({ [PATH]: "- [ ] task\n" });
    const editor = openEditor(["something else"]);
    harness.leaves.push({ view: editor.view });
    const result = await harness.service.apply(target("- [ ] task"), statusPatch);
    expect(result).toEqual({ outcome: "error", reason: "line-not-found" });
    expect(editor.transaction).not.toHaveBeenCalled();
    expect(harness.process).not.toHaveBeenCalled();
    expect(harness.stored.get(PATH)).toBe("- [ ] task\n");
  });

  it("skips a non-markdown leaf and a null editor edit without a transaction", async () => {
    const harness = createVault({ [PATH]: "- [ ] task\n" });
    const ignored = { file: { path: PATH }, editor: { getLine: () => "- [ ] task", lineCount: () => 1, transaction: vi.fn() } };
    harness.leaves.push({ view: ignored });
    const written = await harness.service.apply(target("- [ ] task"), statusPatch);
    expect(written).toEqual({ outcome: "ok", changed: true, line: 0 });
    expect(ignored.editor.transaction).not.toHaveBeenCalled();
    expect(harness.stored.get(PATH)).toBe("- [x] task\n");

    const editor = openEditor(["- [ ] task"]);
    harness.leaves.push({ view: editor.view });
    const skipped = await harness.service.apply(target("- [ ] task"), () => null);
    expect(skipped).toEqual({ outcome: "ok", changed: false, line: 0 });
    expect(editor.transaction).not.toHaveBeenCalled();
    expect(harness.process).toHaveBeenCalledTimes(1);
  });

  it("prefers the active editor, then the most recent leaf, when the file is open more than once", async () => {
    const harness = createVault({ [PATH]: "- [ ] task\n" });
    const older = openEditor(["- [ ] task"]);
    const newer = openEditor(["- [ ] task"]);
    const elsewhere = openEditor(["- [ ] other"], "notes/other.md");
    harness.leaves.push({ view: older.view }, { view: newer.view }, { view: elsewhere.view });

    harness.app.workspace.getActiveViewOfType.mockReturnValue(newer.view);
    harness.app.workspace.getMostRecentLeaf.mockReturnValue({ view: older.view });
    const active = await harness.service.apply(target("- [ ] task"), statusPatch);
    expect(active).toEqual({ outcome: "ok", changed: true, line: 0 });
    expect(newer.transaction).toHaveBeenCalledTimes(1);
    expect(older.transaction).not.toHaveBeenCalled();

    harness.app.workspace.getActiveViewOfType.mockReturnValue(elsewhere.view);
    harness.app.workspace.getMostRecentLeaf.mockReturnValue({ view: older.view });
    const recent = await harness.service.apply(target("- [ ] task"), statusPatch);
    expect(recent).toEqual({ outcome: "ok", changed: true, line: 0 });
    expect(older.transaction).toHaveBeenCalledTimes(1);
    expect(newer.transaction).toHaveBeenCalledTimes(1);
    expect(harness.process).not.toHaveBeenCalled();
  });

  it("returns missing-file when the note is gone, and falls back to abstract files", async () => {
    const missing = createVault({});
    const absent = await missing.service.apply(target("- [ ] task"), statusPatch);
    expect(absent).toEqual({ outcome: "error", reason: "missing-file" });
    expect(missing.process).not.toHaveBeenCalled();

    const shadowed = createVault({ [PATH]: "- [ ] task\n" });
    const shadowedVault = (shadowed.service as unknown as { app: App }).app.vault;
    shadowedVault.getFileByPath = () => null;
    const ignored = await shadowed.service.apply(target("- [ ] task"), statusPatch);
    expect(ignored).toEqual({ outcome: "error", reason: "missing-file" });
    expect(shadowed.process).not.toHaveBeenCalled();
    expect(shadowed.stored.get(PATH)).toBe("- [ ] task\n");

    const fallback = createVault({ [PATH]: "- [ ] task\n" }, { getFileByPath: false });
    const written = await fallback.service.apply(target("- [ ] task"), statusPatch);
    expect(written).toEqual({ outcome: "ok", changed: true, line: 0 });
    expect(fallback.stored.get(PATH)).toBe("- [x] task\n");

    const folder = createVault({}, { getFileByPath: false });
    const folderVault = (folder.service as unknown as { app: App }).app.vault;
    folderVault.getAbstractFileByPath = (() => ({ path: PATH })) as unknown as App["vault"]["getAbstractFileByPath"];
    const notFile = await folder.service.apply(target("- [ ] task"), statusPatch);
    expect(notFile).toEqual({ outcome: "error", reason: "missing-file" });
  });

  it("maps a process failure to write-failed and leaves a locate abort unwarned", async () => {
    const failure = new Error("disk");
    const harness = createVault({ [PATH]: "- [ ] task\n" });
    harness.process.mockRejectedValueOnce(failure);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const rejected = await harness.service.apply(target("- [ ] task"), statusPatch);
      expect(rejected).toEqual({ outcome: "error", reason: "write-failed", error: failure });
      expect(warn).toHaveBeenCalledWith("[Card Workspace] Task write failed.", failure);
      expect(harness.stored.get(PATH)).toBe("- [ ] task\n");

      warn.mockClear();
      harness.process.mockImplementation(async (_file: TFile, change: (data: string) => string) => {
        change("- [ ] task\n");
        throw new Error("callback boom");
      });
      const thrown = await harness.service.apply(target("- [ ] task"), () => {
        throw new Error("callback boom");
      });
      expect(thrown.outcome).toBe("error");
      if (thrown.outcome === "error") expect(thrown.reason).toBe("write-failed");
      expect(harness.stored.get(PATH)).toBe("- [ ] task\n");

      warn.mockClear();
      const editor = openEditor(["- [ ] task"]);
      editor.transaction.mockImplementation(() => {
        throw failure;
      });
      harness.leaves.push({ view: editor.view });
      const editorFailed = await harness.service.apply(target("- [ ] task"), statusPatch);
      expect(editorFailed).toEqual({ outcome: "error", reason: "write-failed", error: failure });

      warn.mockClear();
      harness.leaves.length = 0;
      harness.process.mockImplementation(async (file: TFile, change: (data: string) => string) => change(harness.stored.get(file.path) ?? ""));
      const notFound = await harness.service.apply(target("- [ ] missing"), statusPatch);
      expect(notFound).toEqual({ outcome: "error", reason: "line-not-found" });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("serializes writes per file path and still runs a different file", async () => {
    const harness = createVault({
      [PATH]: "- [ ] task\n",
      "notes/other.md": "- [ ] other\n",
    });
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let started: string[] = [];
    harness.process.mockImplementation(async (file: TFile, change: (data: string) => string) => {
      started.push(file.path);
      if (file.path === PATH && started.length === 1) await gate;
      const current = harness.stored.get(file.path) ?? "";
      const next = change(current);
      if (next !== current) harness.stored.set(file.path, next);
      return next;
    });

    const first = harness.service.apply(target("- [ ] task"), statusPatch);
    const other = harness.service.apply(target("- [ ] other", 0, "notes/other.md"), statusPatch);
    const second = harness.service.apply(target("- [ ] task"), statusPatch);
    await flush();
    expect(started).toEqual([PATH, "notes/other.md"]);
    await other;
    expect(harness.stored.get("notes/other.md")).toBe("- [x] other\n");
    expect(harness.stored.get(PATH)).toBe("- [ ] task\n");

    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual({ outcome: "ok", changed: true, line: 0 });
    expect(secondResult).toEqual({ outcome: "error", reason: "line-not-found" });
    expect(harness.stored.get(PATH)).toBe("- [x] task\n");
    expect(started).toEqual([PATH, "notes/other.md", PATH]);
  });

  it("continues the file queue after a failed write", async () => {
    const harness = createVault({ [PATH]: "- [ ] task\n" });
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    harness.process.mockImplementation(async (file: TFile, change: (data: string) => string) => {
      calls += 1;
      if (calls === 1) {
        await gate;
        throw new Error("disk");
      }
      const current = harness.stored.get(file.path) ?? "";
      const next = change(current);
      harness.stored.set(file.path, next);
      return next;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const first = harness.service.apply(target("- [ ] task"), statusPatch);
      const second = harness.service.apply(target("- [ ] task"), statusPatch);
      await flush();
      expect(calls).toBe(1);
      releaseFirst();
      const [failed, written] = await Promise.all([first, second]);
      expect(failed).toMatchObject({ outcome: "error", reason: "write-failed" });
      expect(written).toEqual({ outcome: "ok", changed: true, line: 0 });
      expect(harness.stored.get(PATH)).toBe("- [x] task\n");
      expect(calls).toBe(2);
    } finally {
      warn.mockRestore();
    }
  });

  it("applies setStatus, setDate, and toggleStatus through the real task edits", async () => {
    const harness = createVault({ [PATH]: `- [ ] task\n- [ ] dated ${DUE} 2026-01-01\n` });
    const completed = await harness.service.setStatus(target("- [ ] task"), true, AUTO);
    const completedLine = applyLinePatches("- [ ] task", setTaskStatus("- [ ] task", true, AUTO)!);
    expect(completed).toEqual({ outcome: "ok", changed: true, line: 0 });
    expect(harness.stored.get(PATH)?.split("\n")[0]).toBe(completedLine);
    expect(completedLine).toBe(`- [x] task ${DONE} 2026-11-14`);

    const cleared = await harness.service.setDate(target(`- [ ] dated ${DUE} 2026-01-01`, 1), "due", null);
    const clearedLine = applyLinePatches(`- [ ] dated ${DUE} 2026-01-01`, setTaskDate(`- [ ] dated ${DUE} 2026-01-01`, "due", null)!);
    expect(cleared).toEqual({ outcome: "ok", changed: true, line: 1 });
    expect(harness.stored.get(PATH)?.split("\n")[1]).toBe(clearedLine);
    expect(clearedLine).toBe("- [ ] dated");

    const opened = `- [ ] again`;
    harness.stored.set(PATH, `${opened}\n`);
    const toggled = await harness.service.toggleStatus(target(opened), MANUAL);
    const toggledLine = applyLinePatches(opened, toggleTaskStatus(opened, MANUAL)!);
    expect(toggled).toEqual({ outcome: "ok", changed: true, line: 0 });
    expect(harness.stored.get(PATH)).toBe(`${toggledLine}\n`);
    expect(toggledLine).toBe("- [x] again");

    const unchanged = await harness.service.setStatus(target(toggledLine), true, MANUAL);
    expect(unchanged).toEqual({ outcome: "ok", changed: false, line: 0 });
    expect(harness.stored.get(PATH)).toBe(`${toggledLine}\n`);

    const reopened = await harness.service.toggleStatus(target(toggledLine), AUTO);
    const reopenedLine = applyLinePatches(toggledLine, toggleTaskStatus(toggledLine, AUTO)!);
    expect(reopened).toEqual({ outcome: "ok", changed: true, line: 0 });
    expect(harness.stored.get(PATH)).toBe(`${reopenedLine}\n`);
    expect(reopenedLine).toBe("- [ ] again");
  });
});
