import { MarkdownView, TFile, TFolder, getFrontMatterInfo, moment, normalizePath, type App } from "obsidian";
import {
  DEFAULT_NOTE_TEMPLATE_DATE_FORMAT,
  DEFAULT_NOTE_TEMPLATE_TIME_FORMAT,
  NOTE_TEMPLATE_DATE_FORMATS,
  NOTE_TEMPLATE_TIME_FORMATS,
  QUICK_INPUT_DUPLICATE_TITLES,
  type NoteInputResult,
  type TemplateNoteCursor,
  type TemplateNoteResult,
  type NoteTemplateDefinition,
  type QuickInputRequest,
  type ScopeNoteRequest,
  isInitialTemplateTitle,
} from "../note-input";

export type NoteInputErrorCode = "missing-folder" | "invalid-folder" | "missing-template" | "invalid-template"
  | "missing-template-folder" | "target-conflict" | "invalid-filename" | "moment-unavailable"
  | "target-mode-changed" | "missing-box" | "invalid-date" | "empty-input" | "invalid-config" | "pending-save-unavailable" | "target-missing" | "target-changed" | "unedited-template-title";

export class NoteInputError extends Error {
  constructor(readonly code: NoteInputErrorCode) {
    super(code);
    this.name = "NoteInputError";
  }
}

/** No vault/editor write has happened, so this draft may safely edit its target. */
export class QuickInputPreflightError extends NoteInputError {}

interface QuickSubmission {
  request: QuickInputRequest;
  targetPath: string;
  pending: Promise<NoteInputResult> | null;
  result: NoteInputResult | null;
  inserted: { file: TFile; view: MarkdownView; created: boolean } | null;
  attempted: { file: TFile; original: string; expected: string } | null;
  creation: { path: string; expected: string } | null;
}

interface TemplateTarget { template: NoteTemplateDefinition; file: TFile; path: string; now: Date; date: string; time: string }

/** Plugin-owned write boundary. Vault events own every downstream card/index refresh. */
export class NoteCreationService {
  private readonly pathQueues = new Map<string, Promise<unknown>>();
  private readonly submissions = new Map<string, QuickSubmission>();

  constructor(private readonly app: App, private readonly beforeQuickWrite?: (request: QuickInputRequest) => void) {}

  async createScopeNote(request: ScopeNoteRequest): Promise<NoteInputResult> {
    const folderPath = this.requireFolder(request.folderPath);
    const baseName = sanitizeNoteFilename(request.baseName);
    const content = buildScopeContent(request);
    return this.createUniqueNote(folderPath, baseName, content);
  }

  /** Shared by draft preflight and the serialized write boundary. Never reads a note.
   * Only a titled draft can meet an existing note; numbering ignores it. */
  resolveQuickInputTarget(request: Pick<QuickInputRequest, "config" | "now" | "target">) {
    const { config } = request;
    if (config.insertPosition !== "start" && config.insertPosition !== "end") throw new NoteInputError("invalid-config");
    if (!QUICK_INPUT_DUPLICATE_TITLES.includes(config.duplicateTitle)) throw new NoteInputError("invalid-config");
    const path = request.target
      ? joinNotePath(this.requireFolder(request.target.folderPath), sanitizeNoteFilename(request.target.title))
      : joinNotePath(this.requireFolder(config.folderPath), this.defaultQuickInputTitle(request.now));
    const existing = request.target && config.duplicateTitle !== "number" ? this.app.vault.getAbstractFileByPath(path) : null;
    if (existing && (!(existing instanceof TFile) || existing.extension.toLowerCase() !== "md")) throw new NoteInputError("target-conflict");
    return { path, mode: existing ? "append" as const : "create" as const, file: existing };
  }

  defaultQuickInputTitle(now: Date): string { return `quick-note ${this.format(now, "YYYY-MM-DD HH-mm-ss")}`; }

  async createTemplateNote(template: NoteTemplateDefinition, now = new Date()): Promise<TemplateNoteResult> {
    const target = this.resolveTemplateTarget({ ...template }, new Date(now.getTime()));
    return this.serialize(target.path, async () => {
      this.validateTemplateTarget(target);
      const content = this.replaceTemplateVariables(await this.readLatest(target.file), target);
      this.validateTemplateTarget(target);
      const existing = this.existingTarget(target);
      if (existing) {
        const body = content.slice(getFrontMatterInfo(content).contentStart);
        const cursor = body.trim() ? await this.insertTemplateBody(existing, body, target.template.existingNoteInsertPosition ?? "end") : undefined;
        return { file: existing, created: false, ...(cursor ? { cursor } : {}) };
      }
      return { file: await this.app.vault.create(target.path, content), created: true, cursor: { content, offset: content.length } };
    });
  }

  private async insertTemplateBody(file: TFile, body: string, position: "start" | "end"): Promise<TemplateNoteCursor> {
    const path = file.path;
    const view = this.findMarkdownView(file);
    if (view) {
      const latest = view.editor.getValue();
      const insertion = buildInsertion(latest, body, position);
      const cursor = { content: applyInsertion(latest, insertion), offset: insertion.cursorOffset };
      view.editor.replaceRange(insertion.text, view.editor.offsetToPos(insertion.offset), undefined, "card-workspace-template");
      await view.save();
      return cursor;
    }
    let offset = 0;
    const content = await this.app.vault.process(file, (content) => {
      if (file.path !== path || this.app.vault.getAbstractFileByPath(path) !== file) throw new NoteInputError("target-changed");
      // An editor opened while process waited owns the latest unsaved content.
      if (this.findMarkdownView(file)) throw new NoteInputError("target-changed");
      const insertion = buildInsertion(content, body, position);
      offset = insertion.cursorOffset;
      return applyInsertion(content, insertion);
    });
    return { content, offset };
  }

  submitQuickInput(request: QuickInputRequest): Promise<NoteInputResult> {
    let submission = this.submissions.get(request.submissionId);
    if (!submission) {
      try {
        const snapshot: QuickInputRequest = { ...request, config: { ...request.config }, now: new Date(request.now.getTime()) };
        if (!snapshot.submissionId || !snapshot.text.trim()) throw new NoteInputError("empty-input");
        if (snapshot.config.insertPosition !== "start" && snapshot.config.insertPosition !== "end") {
          throw new NoteInputError("invalid-config");
        }
        if (snapshot.config.duplicateTitle === "ask") throw new NoteInputError("invalid-config");
        snapshot.target = request.target ? { ...request.target } : undefined;
        snapshot.boxIds = request.boxIds ? [...request.boxIds] : undefined;
        const targetPath = this.resolveQuickInputTarget(snapshot).path;
        submission = { request: snapshot, targetPath, pending: null, result: null, inserted: null, attempted: null, creation: null };
        this.submissions.set(snapshot.submissionId, submission);
      } catch (error) {
        return Promise.reject(error instanceof NoteInputError ? new QuickInputPreflightError(error.code) : error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (submission.result) return Promise.resolve(submission.result);
    if (submission.pending) return submission.pending;
    const captured = submission;
    // Unique notes acquire their final numbered path inside createUniqueNote.
    const lockedPath = captured.creation?.path ?? (appendsToTitle(captured.request) ? captured.targetPath : null);
    const writing = lockedPath !== null
      ? this.serialize(lockedPath, () => this.writeQuickSubmission(captured))
      : this.writeQuickSubmission(captured);
    const pending = writing.catch((error: unknown) => {
      if (error instanceof QuickInputPreflightError && (captured.attempted || captured.creation || captured.inserted)) throw new NoteInputError(error.code);
      throw error;
    });
    captured.pending = pending;
    void pending.then((result) => {
      captured.result = result;
      captured.pending = null;
      captured.request.text = "";
      captured.inserted = null;
      captured.attempted = null;
      captured.creation = null;
    }, (error: unknown) => {
      captured.pending = null;
      if (error instanceof QuickInputPreflightError && !captured.attempted && !captured.creation && !captured.inserted) {
        this.submissions.delete(captured.request.submissionId);
      }
    });
    return pending;
  }

  private async writeQuickSubmission(submission: QuickSubmission): Promise<NoteInputResult> {
    if (submission.inserted) {
      const { file, view, created } = submission.inserted;
      if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw new NoteInputError("target-missing");
      if (view.file !== file || !this.app.workspace.getLeavesOfType("markdown").some((leaf) => leaf.view === view)) {
        throw new NoteInputError("pending-save-unavailable");
      }
      await view.save();
      return { file, created };
    }
    if (submission.creation) {
      const { path, expected } = submission.creation;
      this.requireFolder(path.slice(0, Math.max(0, path.lastIndexOf("/"))));
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file) return { file: await this.app.vault.create(path, expected), created: true };
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") throw new NoteInputError("target-changed");
      const { view, content } = await this.readCurrentTarget(file);
      if (content !== expected) throw new NoteInputError("target-changed");
      if (view) {
        submission.inserted = { file, view, created: true };
        await view.save();
      }
      return { file, created: true };
    }
    if (submission.attempted) {
      const { file, original, expected } = submission.attempted;
      if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw new NoteInputError("target-missing");
      const { view, content: latest } = await this.readCurrentTarget(file);
      if (latest === expected) {
        if (view) {
          submission.inserted = { file, view, created: false };
          await view.save();
        }
        return { file, created: false };
      }
      if (latest !== original) throw new NoteInputError("target-changed");
    }
    const { request } = submission;
    const resolved = this.preflightQuickInput(request);
    if (!appendsToTitle(request)) {
      const folder = this.requireFolder(request.target?.folderPath ?? request.config.folderPath);
      const baseName = request.target ? sanitizeNoteFilename(request.target.title) : this.defaultQuickInputTitle(request.now);
      return this.createUniqueNote(folder, baseName, request.text, (path) => {
        this.preflightQuickInput(request);
        submission.creation = { path, expected: request.text };
      });
    }
    const file = resolved.file;
    if (!file) {
      submission.creation = { path: resolved.path, expected: request.text };
      return { file: await this.app.vault.create(resolved.path, request.text), created: true };
    }
    // Existing notes retain their own properties; only the draft body is inserted.
    const body = request.text.slice(getFrontMatterInfo(request.text).contentStart);
    if (!body.trim()) return { file, created: false };
    const view = this.findMarkdownView(file);
    if (view) {
      const latest = view.editor.getValue();
      const attempt = submission.attempted;
      if (attempt && (attempt.file !== file || (latest !== attempt.original && latest !== attempt.expected))) {
        throw new NoteInputError("target-changed");
      }
      if (!attempt || latest !== attempt.expected) {
        const insertion = buildInsertion(latest, body, request.config.insertPosition);
        view.editor.replaceRange(insertion.text, view.editor.offsetToPos(insertion.offset), undefined, "card-workspace-quick-input");
      }
      // Saving may reject after the editor has changed; retries must only repeat the save.
      submission.inserted = { file, view, created: false };
      await view.save();
    } else {
      await this.app.vault.process(file, (content) => {
        // Vault.process may wait for another writer before invoking this callback.
        // An editor opened meanwhile owns newer unsaved content; retry through it.
        const latestTarget = this.preflightQuickInput(request);
        if (latestTarget.file !== file || file.path !== resolved.path) throw new QuickInputPreflightError("target-mode-changed");
        if (this.findMarkdownView(file)) throw new NoteInputError("target-changed");
        const attempt = submission.attempted;
        if (attempt) {
          if (attempt.file !== file) throw new NoteInputError("target-changed");
          if (content === attempt.expected) return content;
          if (content !== attempt.original) throw new NoteInputError("target-changed");
        }
        const expected = applyInsertion(content, buildInsertion(content, body, request.config.insertPosition));
        // A rejected process may already have reached disk. Preserve both states to
        // distinguish a completed write from a safe retry, without guessing after edits.
        submission.attempted = { file, original: content, expected };
        return expected;
      });
    }
    return { file, created: false };
  }

  private preflightQuickInput(request: QuickInputRequest) {
    try {
      const resolved = this.resolveQuickInputTarget(request);
      if (request.expectedMode && resolved.mode !== request.expectedMode) throw new NoteInputError("target-mode-changed");
      this.beforeQuickWrite?.(request);
      return resolved;
    } catch (error) {
      if (error instanceof NoteInputError) throw new QuickInputPreflightError(error.code);
      throw error;
    }
  }

  private resolveTemplateTarget(template: NoteTemplateDefinition, now: Date): TemplateTarget {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(template.filePath));
    if (!(file instanceof TFile)) throw new NoteInputError("missing-template");
    if (file.extension.toLowerCase() !== "md") throw new NoteInputError("invalid-template");
    if (isInitialTemplateTitle(file.basename)) throw new NoteInputError("unedited-template-title");
    if (template.targetFolderPath === null) throw new NoteInputError("missing-template-folder");
    const folder = this.requireFolder(template.targetFolderPath);
    const dateFormat = NOTE_TEMPLATE_DATE_FORMATS.includes(template.dateFormat as typeof NOTE_TEMPLATE_DATE_FORMATS[number])
      ? template.dateFormat : DEFAULT_NOTE_TEMPLATE_DATE_FORMAT;
    const timeFormat = NOTE_TEMPLATE_TIME_FORMATS.includes(template.timeFormat as typeof NOTE_TEMPLATE_TIME_FORMATS[number])
      ? template.timeFormat : DEFAULT_NOTE_TEMPLATE_TIME_FORMAT;
    const date = this.format(now, dateFormat);
    const time = this.format(now, timeFormat);
    const target = { template, file, path: "", now, date, time };
    target.path = joinNotePath(folder, sanitizeNoteFilename(this.replaceTemplateVariables(file.basename, target)));
    if (target.path === file.path) throw new NoteInputError("target-conflict");
    return target;
  }

  private validateTemplateTarget(target: TemplateTarget): void {
    if (this.app.vault.getAbstractFileByPath(target.file.path) !== target.file
      || target.file.path !== normalizePath(target.template.filePath)) throw new NoteInputError("missing-template");
    this.requireFolder(target.template.targetFolderPath!);
  }

  private existingTarget(target: TemplateTarget): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(target.path);
    if (!file) return null;
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md" || file === target.file) {
      throw new NoteInputError("target-conflict");
    }
    return file;
  }

  private requireFolder(path: string): string {
    // Obsidian normalizes the vault root to "/"; note paths are vault-relative.
    // Keeping it as a folder prefix would make lookups use "//note.md" while
    // Vault.create normalizes that back to "note.md" and rejects existing notes.
    const hostPath = normalizePath(path);
    const normalized = hostPath === "/" ? "" : hostPath;
    if (normalized.split("/").some((part) => part === "." || part === "..") || [...normalized].some((character) => character.charCodeAt(0) < 32)) {
      throw new NoteInputError("invalid-folder");
    }
    const folder = normalized === "" ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(normalized);
    if (!(folder instanceof TFolder)) throw new NoteInputError("missing-folder");
    return normalized;
  }

  private uniquePath(folder: string, baseName: string): string {
    let path = joinNotePath(folder, baseName);
    for (let suffix = 1; this.app.vault.getAbstractFileByPath(path); suffix++) {
      path = joinNotePath(folder, `${baseName} ${suffix}`);
    }
    return path;
  }

  private async createUniqueNote(folder: string, baseName: string, content: string, beforeCreate?: (path: string) => void): Promise<NoteInputResult> {
    while (true) {
      const path = this.uniquePath(folder, baseName);
      const file = await this.serialize(path, async () => {
        // Another filename sequence or a template may have claimed this numbered path.
        if (this.app.vault.getAbstractFileByPath(path)) return null;
        // Quick-input preflight must run before recording an uncertain creation,
        // including when the destination disappeared while this path was queued.
        beforeCreate?.(path);
        this.requireFolder(folder);
        return this.app.vault.create(path, content);
      });
      if (file) return { file, created: true };
    }
  }

  private format(now: Date, format: string): string {
    if (!Number.isFinite(now.getTime())) throw new NoteInputError("invalid-date");
    const formatDate = moment as unknown as ((date: Date) => { format(pattern: string): string });
    if (typeof formatDate !== "function") throw new NoteInputError("moment-unavailable");
    return formatDate(now).format(format);
  }

  private replaceTemplateVariables(text: string, target: Pick<TemplateTarget, "now" | "date" | "time">): string {
    return text.replace(/\{\{(date|time)(?::([^{}\r\n]*))?\}\}/g,
      (_match, variable: "date" | "time", format?: string) => format ? this.format(target.now, format) : target[variable]);
  }

  private findMarkdownView(file: TFile): MarkdownView | null {
    // Prefer the active editor when a note is visible in several leaves.
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active?.file === file) return active;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView && leaf.view.file === file) return leaf.view;
    }
    return null;
  }

  private async readLatest(file: TFile): Promise<string> {
    const view = this.findMarkdownView(file);
    return view ? view.editor.getValue() : this.app.vault.cachedRead(file);
  }

  private async readCurrentTarget(file: TFile): Promise<{ view: MarkdownView | null; content: string }> {
    let view = this.findMarkdownView(file);
    let content = view ? view.editor.getValue() : await this.app.vault.read(file);
    if (this.app.vault.getAbstractFileByPath(file.path) !== file) throw new NoteInputError("target-missing");
    // A note may have opened during the read; its unsaved text is authoritative.
    if (!view) {
      view = this.findMarkdownView(file);
      if (view) content = view.editor.getValue();
    }
    return { view, content };
  }

  private serialize<T>(path: string, work: () => Promise<T>): Promise<T> {
    const previous = this.pathQueues.get(path) ?? Promise.resolve();
    const pending = previous.catch(() => undefined).then(work);
    this.pathQueues.set(path, pending);
    const clear = (): void => { if (this.pathQueues.get(path) === pending) this.pathQueues.delete(path); };
    void pending.then(clear, clear);
    return pending;
  }
}

function sanitizeNoteFilename(name: string): string {
  const sanitized = [...name].map((character) => character.charCodeAt(0) < 32 ? "-" : character).join("")
    .replace(/[\\/:*?"<>|]/g, "-").trim().replace(/[. ]+$/, "");
  if (!sanitized) throw new NoteInputError("invalid-filename");
  return sanitized;
}

function joinNotePath(folder: string, basename: string): string { return `${folder ? `${folder}/` : ""}${basename}.md`; }

/** Only these submissions write to one exact title path; all others pick a numbered free path. */
function appendsToTitle(request: QuickInputRequest): boolean { return !!request.target && request.config.duplicateTitle === "append"; }

function buildScopeContent(request: ScopeNoteRequest): string {
  const properties = Object.entries(request.properties).filter(([key]) => key.toLowerCase() !== "tags" && key.toLowerCase() !== "tag");
  const tags = [...new Set(request.tags.map((tag) => tag.replace(/^#/, "")).filter(Boolean))];
  const lines: string[] = [];
  if (tags.length || request.emptyTags) {
    lines.push("tags:");
    for (const tag of tags) {
      const safePlain = /^[\p{L}_][\p{L}\p{N}_/-]*$/u.test(tag) && !/^(true|false|yes|no|on|off|null|~)$/i.test(tag);
      lines.push(`  - ${safePlain ? tag : JSON.stringify(tag)}`);
    }
  }
  for (const [key, value] of properties) {
    if (typeof value === "number" && !Number.isFinite(value)) throw new NoteInputError("invalid-config");
    // JSON-quoted strings, keys and scalar values are valid YAML, with no implicit type coercion.
    lines.push(`${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  }
  return lines.length ? `---\n${lines.join("\n")}\n---\n\n` : "";
}

interface TextInsertion { offset: number; text: string; cursorOffset: number }

function buildInsertion(content: string, text: string, position: "start" | "end"): TextInsertion {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const offset = position === "end" ? content.length : getFrontMatterInfo(content).contentStart;
  const before = content.slice(0, offset);
  const after = content.slice(offset);
  const leading = before.length ? Math.max(0, 2 - trailingNewlines(before)) : 0;
  const trailing = after.length ? Math.max(0, 2 - leadingNewlines(after)) : 0;
  return { offset, text: `${newline.repeat(leading)}${text}${newline.repeat(trailing)}`, cursorOffset: offset + leading * newline.length + text.length };
}

function trailingNewlines(text: string): number { return text.match(/(?:\r?\n)+$/)?.[0].match(/\n/g)?.length ?? 0; }
function leadingNewlines(text: string): number { return text.match(/^(?:\r?\n)+/)?.[0].match(/\n/g)?.length ?? 0; }
function applyInsertion(content: string, insertion: TextInsertion): string {
  return content.slice(0, insertion.offset) + insertion.text + content.slice(insertion.offset);
}
