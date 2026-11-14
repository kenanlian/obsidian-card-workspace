import { MarkdownView, TFile, type App, type Editor } from "obsidian";

import {
  applyLinePatches,
  parseTaskLine,
  setTaskDate,
  setTaskStatus,
  toggleTaskStatus,
  type LinePatch,
  type TaskDateKind,
  type TaskStatusOptions,
} from "../tasks";

/** 0-based line and the exact line text observed when the task was indexed. */
export interface TaskWriteTarget {
  readonly filePath: string;
  readonly line: number;
  readonly lineText: string;
}

export type TaskWriteResult =
  | { readonly outcome: "ok"; readonly changed: boolean; readonly line: number }
  | {
    readonly outcome: "error";
    readonly reason: "missing-file" | "line-not-found" | "not-a-task" | "write-failed";
    readonly error?: unknown;
  };

type TaskEdit = (lineText: string) => LinePatch[] | null;

/** One task line as it was before and after a successful write. */
export interface TaskLineWrite {
  readonly filePath: string;
  readonly line: number;
  readonly previousText: string;
  readonly nextText: string;
}

export interface TaskWriteServiceOptions {
  /** Runs synchronously after a write changed a line. */
  onLineWritten?: (write: TaskLineWrite) => void;
}

interface PreservedLine {
  readonly text: string;
  readonly ending: string;
}

/**
 * Applies one task-line edit.
 *
 * The indexed line is located again and must still parse as a task. An open
 * Markdown editor receives every patch in one undoable transaction and is saved
 * at once rather than on the host's autosave delay; otherwise the note is
 * updated through `vault.process`. Writes for one path run in order.
 */
export class TaskWriteService {
  private readonly pathQueues = new Map<string, Promise<unknown>>();

  constructor(private readonly app: App, private readonly options: TaskWriteServiceOptions = {}) {}

  apply(target: TaskWriteTarget, edit: TaskEdit): Promise<TaskWriteResult> {
    return this.enqueue(target.filePath, () => this.applyNow(target, edit));
  }

  setStatus(target: TaskWriteTarget, completed: boolean, options: TaskStatusOptions): Promise<TaskWriteResult> {
    return this.apply(target, (lineText) => setTaskStatus(lineText, completed, options));
  }

  toggleStatus(target: TaskWriteTarget, options: TaskStatusOptions): Promise<TaskWriteResult> {
    return this.apply(target, (lineText) => toggleTaskStatus(lineText, options));
  }

  setDate(target: TaskWriteTarget, kind: TaskDateKind, value: string | null): Promise<TaskWriteResult> {
    return this.apply(target, (lineText) => setTaskDate(lineText, kind, value));
  }

  private enqueue<T>(path: string, work: () => Promise<T>): Promise<T> {
    const previous = this.pathQueues.get(path) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(work);
    this.pathQueues.set(path, pending);
    const clear = (): void => {
      if (this.pathQueues.get(path) === pending) this.pathQueues.delete(path);
    };
    void pending.then(clear, clear);
    return pending;
  }

  private async applyNow(target: TaskWriteTarget, edit: TaskEdit): Promise<TaskWriteResult> {
    try {
      const view = this.findOpenEditor(target.filePath);
      if (view) return this.applyInEditor(view, target, edit);
      return await this.applyInVault(target, edit);
    } catch (error) {
      return failWrite(error);
    }
  }

  private findOpenEditor(filePath: string): MarkdownView | null {
    const matches: MarkdownView[] = [];
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file?.path === filePath) matches.push(view);
    }
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0] ?? null;
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active && matches.includes(active)) return active;
    const recent = this.app.workspace.getMostRecentLeaf()?.view;
    if (recent instanceof MarkdownView && matches.includes(recent)) return recent;
    return matches[0] ?? null;
  }

  private applyInEditor(view: MarkdownView, target: TaskWriteTarget, edit: TaskEdit): TaskWriteResult {
    const editor: Editor = view.editor;
    const lines: string[] = [];
    const count = editor.lineCount();
    for (let index = 0; index < count; index += 1) lines.push(editor.getLine(index));
    const prepared = prepareLine(lines, target, edit);
    if (prepared.outcome === "error") return prepared;
    const next = prepared.patches === null ? prepared.text : applyLinePatches(prepared.text, prepared.patches);
    if (prepared.patches === null || next === prepared.text) {
      return { outcome: "ok", changed: false, line: prepared.line };
    }
    editor.transaction({
      changes: prepared.patches.map((patch) => ({
        from: { line: prepared.line, ch: patch.from },
        to: { line: prepared.line, ch: patch.to },
        text: patch.insert,
      })),
    });
    this.notifyWritten(target.filePath, prepared.line, prepared.text, next);
    // The metadata cache only re-parses saved content.
    if (typeof view.save === "function") {
      view.save().catch((error: unknown) => console.warn("[Card Workspace] Task note save failed.", error));
    }
    return { outcome: "ok", changed: true, line: prepared.line };
  }

  private notifyWritten(filePath: string, line: number, previousText: string, nextText: string): void {
    try {
      this.options.onLineWritten?.({ filePath, line, previousText, nextText });
    } catch (error) {
      console.warn("[Card Workspace] Task write listener failed.", error);
    }
  }

  private async applyInVault(target: TaskWriteTarget, edit: TaskEdit): Promise<TaskWriteResult> {
    const file = this.resolveFile(target.filePath);
    if (!file) return { outcome: "error", reason: "missing-file" };
    let line = 0;
    let written: { previous: string; next: string } | null = null;
    try {
      await this.app.vault.process(file, (content) => {
        written = null;
        const preserved = splitPreservedLines(content);
        const prepared = prepareLine(preserved.map((entry) => entry.text), target, edit);
        if (prepared.outcome === "error") throw new TaskWriteAbort(prepared.reason);
        line = prepared.line;
        if (prepared.patches === null) return content;
        const next = applyLinePatches(prepared.text, prepared.patches);
        if (next === prepared.text) return content;
        const current = preserved[prepared.line];
        if (current === undefined) throw new TaskWriteAbort("line-not-found");
        const updated = preserved.slice();
        updated[prepared.line] = { text: next, ending: current.ending };
        written = { previous: prepared.text, next };
        return joinPreservedLines(updated);
      });
    } catch (error) {
      const reason = abortReason(error);
      if (reason) return { outcome: "error", reason };
      return failWrite(error);
    }
    // Assigned inside the callback, which control-flow narrowing cannot see.
    const change = written as { previous: string; next: string } | null;
    if (change === null) return { outcome: "ok", changed: false, line };
    this.notifyWritten(target.filePath, line, change.previous, change.next);
    return { outcome: "ok", changed: true, line };
  }

  /** `getFileByPath` is the task-subsystem lookup; older fakes only expose abstract files. */
  private resolveFile(filePath: string): TFile | null {
    const vault = this.app.vault;
    if (typeof vault.getFileByPath === "function") return vault.getFileByPath(filePath);
    const abstract = vault.getAbstractFileByPath(filePath);
    return abstract instanceof TFile ? abstract : null;
  }
}

class TaskWriteAbort extends Error {
  constructor(readonly reason: "line-not-found" | "not-a-task") {
    super(reason);
    this.name = "TaskWriteAbort";
  }
}

type PreparedLine =
  | { readonly outcome: "error"; readonly reason: "line-not-found" | "not-a-task" }
  | { readonly outcome: "ok"; readonly line: number; readonly text: string; readonly patches: readonly LinePatch[] | null };

function prepareLine(lines: readonly string[], target: TaskWriteTarget, edit: TaskEdit): PreparedLine {
  const line = locateLine(lines, target);
  if (line === null) return { outcome: "error", reason: "line-not-found" };
  const text = comparableLine(lines[line] ?? "");
  if (parseTaskLine(text) === null) return { outcome: "error", reason: "not-a-task" };
  return { outcome: "ok", line, text, patches: edit(text) };
}

function locateLine(lines: readonly string[], target: TaskWriteTarget): number | null {
  const at = target.line;
  if (Number.isInteger(at) && at >= 0 && at < lines.length && comparableLine(lines[at] ?? "") === target.lineText) {
    return at;
  }
  let match = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (comparableLine(lines[index] ?? "") !== target.lineText) continue;
    if (match !== -1) return null;
    match = index;
  }
  return match === -1 ? null : match;
}

function comparableLine(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

/**
 * Line texts match `splitContentLines`. Each ending is the exact break that
 * followed that line, so an edit can replace one line and leave every other byte.
 */
function splitPreservedLines(content: string): PreservedLine[] {
  const segments = content.split("\n");
  return segments.map((segment, index) => {
    const carriageReturn = segment.endsWith("\r");
    const text = carriageReturn ? segment.slice(0, -1) : segment;
    const last = index === segments.length - 1;
    const ending = last ? (carriageReturn ? "\r" : "") : (carriageReturn ? "\r\n" : "\n");
    return { text, ending };
  });
}

function joinPreservedLines(lines: readonly PreservedLine[]): string {
  const parts: string[] = [];
  for (const line of lines) parts.push(line.text, line.ending);
  return parts.join("");
}

function abortReason(error: unknown): "line-not-found" | "not-a-task" | null {
  return error instanceof TaskWriteAbort ? error.reason : null;
}

function failWrite(error: unknown): TaskWriteResult {
  console.warn("[Card Workspace] Task write failed.", error);
  return { outcome: "error", reason: "write-failed", error };
}
