import { describe, expect, it, vi } from "vitest";
import actualMoment from "moment";

vi.mock("obsidian", async () => {
  const { default: realMoment } = await import("moment");
  class TFile { path = ""; basename = ""; extension = "md"; }
  class TFolder { path = ""; }
  class MarkdownView { file: unknown = null; }
  return {
    TFile, TFolder, MarkdownView,
    moment: vi.fn(realMoment),
    normalizePath: (path: string) => path.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "").normalize("NFC") || "/",
    getFrontMatterInfo: (content: string) => {
      const match = content.match(/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/);
      return { exists: !!match, contentStart: match?.[0].length ?? 0 };
    },
  };
});

import { MarkdownView, TFile, TFolder, moment, normalizePath, type App } from "obsidian";
import { NOTE_TEMPLATE_DATE_FORMATS, NOTE_TEMPLATE_TIME_FORMATS, type NoteTemplateDefinition, type QuickInputRequest } from "../note-input";
import { NoteCreationService } from "./NoteCreationService";
import { getUiStrings } from "../i18n";

function fixture() {
  const entries = new Map<string, TFile | TFolder>();
  const contents = new Map<string, string>();
  const root = new TFolder();
  root.path = "/";
  entries.set("/", root);
  const leaves: Array<{ view: MarkdownView }> = [];
  let active: MarkdownView | null = null;
  function folder(path: string) { const entry = new TFolder(); entry.path = path; entries.set(path, entry); return entry; }
  function file(path: string, content = "") {
    const entry = new TFile();
    const parts = path.split(".");
    Object.assign(entry, { path, basename: path.replace(/.*\//, "").replace(/\.[^.]+$/, ""), extension: parts[parts.length - 1] });
    entries.set(path, entry); contents.set(path, content); return entry;
  }
  const vault = {
    getRoot: () => root,
    getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
    create: vi.fn(async (path: string, content: string) => {
      const normalized = normalizePath(path);
      if (entries.has(normalized)) throw new Error("File already exists.");
      return file(normalized, content);
    }),
    cachedRead: vi.fn(async (target: TFile) => contents.get(target.path) ?? ""),
    read: vi.fn(async (target: TFile) => contents.get(target.path) ?? ""),
    process: vi.fn(async (target: TFile, change: (data: string) => string) => {
      const content = change(contents.get(target.path) ?? "");
      contents.set(target.path, content); return content;
    }),
  };
  const app = {
    vault,
    workspace: { getLeavesOfType: () => leaves, getActiveViewOfType: () => active },
  } as unknown as App;
  function open(target: TFile, initial: string) {
    let value = initial;
    const view = new MarkdownView({} as never);
    view.file = target;
    const replaceRange = vi.fn((text: string, position: { line: number; ch: number }) => {
      const lines = value.split("\n");
      const offset = lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.ch;
      value = value.slice(0, offset) + text + value.slice(offset);
    });
    view.editor = {
      getValue: () => value,
      offsetToPos: (offset: number) => { const parts = value.slice(0, offset).split("\n"); return { line: parts.length - 1, ch: parts[parts.length - 1]!.length }; },
      replaceRange,
    } as unknown as MarkdownView["editor"];
    view.save = vi.fn(async () => { contents.set(target.path, value); });
    leaves.push({ view }); active = view;
    return { view, replaceRange, getValue: () => value, setValue: (text: string) => { value = text; } };
  }
  return { service: new NoteCreationService(app), app, entries, contents, folder, file, vault, open, leaves };
}

const now = new Date(2026, 9, 12, 14, 5, 9);
function template(overrides: Partial<NoteTemplateDefinition> = {}): NoteTemplateDefinition {
  return { id: "daily", filePath: "Templates/{{date}} {{time}}.md", targetFolderPath: "Notes", dateFormat: "YYYY-MM-DD", timeFormat: "HH-mm-ss", ...overrides };
}
function request(overrides: Partial<QuickInputRequest> = {}): QuickInputRequest {
  return { submissionId: "one", text: "user {{date}} {{time}}", config: { templateId: "daily", folderPath: "ignored", insertPosition: "end" }, template: template(), now, ...overrides };
}
function templateFixture(content = "template {{date}} {{time}}") {
  const f = fixture(); f.folder("Notes"); f.file(template().filePath, content); return f;
}

describe("NoteCreationService scope notes", () => {
  it("creates blank root notes with unique numbering, including concurrent calls", async () => {
    const f = fixture(); f.file("Untitled.md"); f.folder("Untitled 1.md");
    const scope = { folderPath: "", baseName: "Untitled", tags: [], properties: {}, emptyTags: false };
    const results = await Promise.all([f.service.createScopeNote(scope), f.service.createScopeNote(scope)]);
    expect(results.map((result) => result.file.path)).toEqual(["Untitled 2.md", "Untitled 3.md"]);
    expect(f.contents.get("Untitled 2.md")).toBe("");
  });
  it("writes YAML tags and scalar properties without coercing string types", async () => {
    const f = fixture(); f.folder("Work");
    const result = await f.service.createScopeNote({ folderPath: "Work", baseName: "Untitled", tags: ["#a/b", "a/b", "yes"], properties: { status: "true", count: 42, enabled: false, "a: b": "one\ntwo", tags: "ignored" }, emptyTags: false });
    expect(f.contents.get(result.file.path)).toBe('---\ntags:\n  - a/b\n  - "yes"\n"status": "true"\n"count": 42\n"enabled": false\n"a: b": "one\\ntwo"\n---\n\n');
  });
  it("serializes overlapping numbering sequences by the final target path", async () => {
    const f = fixture(); f.file("Untitled.md");
    const scope = { folderPath: "", baseName: "Untitled", tags: [], properties: {}, emptyTags: false };
    const results = await Promise.all([f.service.createScopeNote(scope), f.service.createScopeNote({ ...scope, baseName: "Untitled 1" })]);
    expect(new Set(results.map((result) => result.file.path)).size).toBe(2);
    expect(f.vault.create).toHaveBeenCalledTimes(2);
  });
  it("writes empty tags frontmatter only when requested", async () => {
    const f = fixture();
    const result = await f.service.createScopeNote({ folderPath: "", baseName: "Untitled", tags: [], properties: {}, emptyTags: true });
    expect(f.contents.get(result.file.path)).toBe("---\ntags:\n---\n\n");
  });
  it("rejects missing folders and nonfinite property numbers without creating fallback notes", async () => {
    const f = fixture();
    await expect(f.service.createScopeNote({ folderPath: "Missing", baseName: "Untitled", tags: [], properties: {}, emptyTags: false })).rejects.toMatchObject({ code: "missing-folder" });
    await expect(f.service.createScopeNote({ folderPath: "", baseName: "Untitled", tags: [], properties: { count: Infinity }, emptyTags: false })).rejects.toMatchObject({ code: "invalid-config" });
    expect(f.vault.create).not.toHaveBeenCalled();
  });
});

describe("NoteCreationService templates", () => {
  it("replaces every date/time variable in the filename and full content at one captured local date", async () => {
    const f = templateFixture("---\nwhen: {{date}}\n---\n{{time}} {{date}} {{time}} {{other}}");
    const result = await f.service.createTemplateNote(template(), now);
    expect(result).toMatchObject({ created: true, file: { path: "Notes/2026-10-12 14-05-09.md" } });
    expect(f.contents.get(result.file.path)).toBe("---\nwhen: 2026-10-12\n---\n14-05-09 2026-10-12 14-05-09 {{other}}");
    expect(result.cursor).toEqual({ content: f.contents.get(result.file.path), offset: f.contents.get(result.file.path)!.length });
  });
  it("sanitizes slashes and forbidden filename characters without creating folders", async () => {
    const f = templateFixture();
    const result = await f.service.createTemplateNote(template({ dateFormat: "YYYY/MM/DD", timeFormat: "HH:mm:ss" }), now);
    expect(result.file.path).toBe("Notes/2026-10-12 14-05-09.md");
    expect(f.contents.get(result.file.path)).toBe("template 2026/10/12 14:05:09");
  });
  it("overrides individual date/time formats in properties and body without changing template defaults", async () => {
    const f = templateFixture('---\nwhen: "{{date:YYYY-MM-DD[T]HH:mm:ss}}"\n---\n{{date}} | {{date:YYYY-MMMM-DD}} | {{date:YYYY/MM/DD}}\n{{time}} | {{time:HH:mm}} | {{date:HH:mm:ss}} | {{time:YYYY-MM-DD}}\n{{date:YYYY-MMMM-DD}}');
    const result = await f.service.createTemplateNote(template(), now);
    const longDate = actualMoment(now).format("YYYY-MMMM-DD");
    expect(result.file.path).toBe("Notes/2026-10-12 14-05-09.md");
    expect(f.contents.get(result.file.path)).toBe(`---\nwhen: "2026-10-12T14:05:09"\n---\n2026-10-12 | ${longDate} | 2026/10/12\n14-05-09 | 14:05 | 14:05:09 | 2026-10-12\n${longDate}`);
  });
  it("keeps literal format text, uses defaults for empty formats and preserves unknown or incomplete variables", async () => {
    const f = templateFixture("{{date:[Today is] YYYY-MM-DD}} | {{time:[At] HH:mm:ss}} | {{date:[cost $&]}}\n{{date:}} {{time:}} {{other:YYYY}} {{date:YYYY {{time:HH\nmm}}");
    const result = await f.service.createTemplateNote(template(), now);
    expect(f.contents.get(result.file.path)).toBe("Today is 2026-10-12 | At 14:05:09 | cost $&\n2026-10-12 14-05-09 {{other:YYYY}} {{date:YYYY {{time:HH\nmm}}");
  });
  it("uses the captured date for overrides even when the caller changes its date during the template read", async () => {
    const f = templateFixture();
    const captured = new Date(now.getTime());
    f.vault.cachedRead.mockImplementationOnce(async () => {
      captured.setFullYear(2040);
      return "{{date:YYYY-MM-DD}} {{time:HH:mm:ss}}";
    });
    const result = await f.service.createTemplateNote(template(), captured);
    expect(result.file.path).toBe("Notes/2026-10-12 14-05-09.md");
    expect(f.contents.get(result.file.path)).toBe("2026-10-12 14:05:09");
  });
  it.each(["start", "end"] as const)("applies overrides when inserting a template at the %s of an existing note", async (position) => {
    const f = templateFixture("---\nwhen: {{date:YYYY}}\n---\n{{date:YYYY/MM/DD}} {{time:HH:mm}}");
    const properties = "---\nstatus: existing\n---\n";
    const target = f.file("Notes/2026-10-12 14-05-09.md", `${properties}keep me`);
    const result = await f.service.createTemplateNote(template({ existingNoteInsertPosition: position }), now);
    expect(result).toMatchObject({ file: target, created: false });
    expect(f.contents.get(target.path)).toBe(position === "start"
      ? `${properties}\n2026/10/12 14:05\n\nkeep me`
      : `${properties}keep me\n\n2026/10/12 14:05`);
  });
  it.each(NOTE_TEMPLATE_DATE_FORMATS)("supports date format %s through Obsidian moment", async (format) => {
    const f = templateFixture(); const result = await f.service.createTemplateNote(template({ dateFormat: format }), now);
    expect(f.contents.get(result.file.path)).toBe(`template ${actualMoment(now).format(format)} 14-05-09`);
  });
  it.each(NOTE_TEMPLATE_TIME_FORMATS)("supports time format %s through Obsidian moment", async (format) => {
    const f = templateFixture(); const result = await f.service.createTemplateNote(template({ timeFormat: format }), now);
    expect(f.contents.get(result.file.path)).toBe(`template 2026-10-12 ${actualMoment(now).format(format)}`);
  });
  it("appends the latest template body to an existing note while preserving its properties and content", async () => {
    const f = templateFixture("---\nstatus: template\n---\n## Updated {{date}}\n{{time}}");
    const target = f.file("Notes/2026-10-12 14-05-09.md", "---\nstatus: existing\n---\nkeep me");
    const result = await f.service.createTemplateNote(template(), now);
    expect(result).toMatchObject({ file: target, created: false });
    expect(f.contents.get(target.path)).toBe("---\nstatus: existing\n---\nkeep me\n\n## Updated 2026-10-12\n14-05-09");
    expect(result.cursor).toEqual({ content: f.contents.get(target.path), offset: f.contents.get(target.path)!.length });
    expect(f.vault.process).toHaveBeenCalledOnce();
    expect(f.vault.create).not.toHaveBeenCalled();
  });
  it("reads edited template content again on each click for the same target", async () => {
    const f = templateFixture("original");
    const first = await f.service.createTemplateNote(template(), now);
    f.contents.set(template().filePath, "updated {{date}}");
    const second = await f.service.createTemplateNote(template(), now);
    expect(second).toMatchObject({ file: first.file, created: false });
    expect(f.contents.get(first.file.path)).toBe("original\n\nupdated 2026-10-12");
  });
  it.each([
    { content: "old body", expected: "new body\n\nold body", open: false },
    { content: "old body", expected: "new body\n\nold body", open: true },
    { content: "---\nstatus: existing\n---\n\nold body", expected: "---\nstatus: existing\n---\n\nnew body\n\nold body", open: false },
    { content: "---\nstatus: existing\n---\n\nold body", expected: "---\nstatus: existing\n---\n\nnew body\n\nold body", open: true },
  ])("inserts at the start of the body after properties: %j", async ({ content, expected, open }) => {
    const f = templateFixture("---\nstatus: template\n---\nnew body");
    const target = f.file("Notes/2026-10-12 14-05-09.md", content);
    const editor = open ? f.open(target, content) : null;
    const result = await f.service.createTemplateNote(template({ existingNoteInsertPosition: "start" }), now);
    expect(f.contents.get(target.path)).toBe(expected);
    expect(result.cursor).toEqual({ content: expected, offset: expected.indexOf("new body") + "new body".length });
    if (editor) expect(editor.replaceRange).toHaveBeenCalledOnce();
  });
  it("keeps the full template when creating a new note regardless of existing-note insert position", async () => {
    const content = "---\nstatus: template\n---\nnew body";
    const f = templateFixture(content);
    const result = await f.service.createTemplateNote(template({ existingNoteInsertPosition: "start" }), now);
    expect(result.created).toBe(true);
    expect(f.contents.get(result.file.path)).toBe(content);
    expect(result.cursor).toEqual({ content, offset: content.length });
  });
  it("uses unsaved template and target content when appending through the editor", async () => {
    const f = templateFixture("old template");
    const templateEditor = f.open(f.entries.get(template().filePath) as TFile, "new {{date}}");
    const target = f.file("Notes/2026-10-12 14-05-09.md", "old disk content");
    const targetEditor = f.open(target, "latest unsaved content");
    await f.service.createTemplateNote(template(), now);
    expect(f.contents.get(target.path)).toBe("latest unsaved content\n\nnew 2026-10-12");
    expect(targetEditor.replaceRange).toHaveBeenCalledOnce();
    expect(targetEditor.view.save).toHaveBeenCalledOnce();
    expect(templateEditor.getValue()).toBe("new {{date}}");
    expect(f.vault.process).not.toHaveBeenCalled();
    expect(f.vault.cachedRead).not.toHaveBeenCalled();
  });
  it.each(["", " \n", "---\nstatus: template\n---\n\n"])("opens an existing note without writing when the template has no body: %j", async (content) => {
    const f = templateFixture(content);
    const target = f.file("Notes/2026-10-12 14-05-09.md", "keep me");
    const editor = f.open(target, "unsaved content");
    expect(await f.service.createTemplateNote(template(), now)).toEqual({ file: target, created: false });
    expect(editor.getValue()).toBe("unsaved content");
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(editor.view.save).not.toHaveBeenCalled();
    expect(f.vault.process).not.toHaveBeenCalled();
  });
  it("preserves CRLF when appending to an existing note", async () => {
    const f = templateFixture("new body\r\nsecond line");
    const target = f.file("Notes/2026-10-12 14-05-09.md", "old body\r\n");
    await f.service.createTemplateNote(template(), now);
    expect(f.contents.get(target.path)).toBe("old body\r\n\r\nnew body\r\nsecond line");
  });
  it("appends when the target appears while reading the template", async () => {
    const f = templateFixture();
    f.vault.cachedRead.mockImplementationOnce(async () => {
      f.file("Notes/2026-10-12 14-05-09.md", "concurrent content");
      return "new template";
    });
    const result = await f.service.createTemplateNote(template(), now);
    expect(result.created).toBe(false);
    expect(f.contents.get(result.file.path)).toBe("concurrent content\n\nnew template");
    expect(f.vault.create).not.toHaveBeenCalled();
  });
  it("protects an editor opened while an append is waiting for vault.process", async () => {
    const f = templateFixture("new body");
    const target = f.file("Notes/2026-10-12 14-05-09.md", "disk");
    let editor!: ReturnType<typeof f.open>;
    f.vault.process.mockImplementationOnce(async (file, change) => {
      editor = f.open(file, "unsaved changes");
      const content = change(f.contents.get(file.path)!);
      f.contents.set(file.path, content);
      return content;
    });
    await expect(f.service.createTemplateNote(template(), now)).rejects.toMatchObject({ code: "target-changed" });
    expect(f.contents.get(target.path)).toBe("disk");
    expect(editor.getValue()).toBe("unsaved changes");
    await f.service.createTemplateNote(template(), now);
    expect(f.contents.get(target.path)).toBe("unsaved changes\n\nnew body");
  });
  it("propagates append failures without replacing the existing note", async () => {
    const f = templateFixture("new body");
    const target = f.file("Notes/2026-10-12 14-05-09.md", "keep me");
    f.vault.process.mockRejectedValueOnce(new Error("disk full"));
    await expect(f.service.createTemplateNote(template(), now)).rejects.toThrow("disk full");
    expect(f.contents.get(target.path)).toBe("keep me");
    expect(f.vault.create).not.toHaveBeenCalled();
  });
  it("uses unsaved template editor content", async () => {
    const f = templateFixture("old"); f.open(f.entries.get(template().filePath) as TFile, "new {{date}}");
    const result = await f.service.createTemplateNote(template(), now);
    expect(f.contents.get(result.file.path)).toBe("new 2026-10-12");
  });
  it("rejects self-targets, target folders and unavailable references", async () => {
    const f = templateFixture();
    f.folder("Notes/2026-10-12 14-05-09.md");
    await expect(f.service.createTemplateNote(template(), now)).rejects.toMatchObject({ code: "target-conflict" });
    f.file("Notes/Static.md");
    await expect(f.service.createTemplateNote(template({ filePath: "Notes/Static.md" }), now)).rejects.toMatchObject({ code: "target-conflict" });
    await expect(f.service.createTemplateNote(template({ filePath: "Missing.md" }), now)).rejects.toMatchObject({ code: "missing-template" });
    await expect(f.service.createTemplateNote(template({ targetFolderPath: null }), now)).rejects.toMatchObject({ code: "missing-template-folder" });
    await expect(f.service.createTemplateNote(template({ targetFolderPath: "Missing" }), now)).rejects.toMatchObject({ code: "missing-folder" });
    f.file("Templates/a.canvas");
    await expect(f.service.createTemplateNote(template({ filePath: "Templates/a.canvas" }), now)).rejects.toMatchObject({ code: "invalid-template" });
  });
  it("serializes clicks on the same target and inserts each click's template once", async () => {
    const f = templateFixture();
    const results = await Promise.all([f.service.createTemplateNote(template(), now), f.service.createTemplateNote(template(), now)]);
    expect(results.map((result) => result.created)).toEqual([true, false]); expect(results[0].file).toBe(results[1].file); expect(f.vault.create).toHaveBeenCalledTimes(1);
    expect(f.contents.get(results[0]!.file.path)).toBe("template 2026-10-12 14-05-09\n\ntemplate 2026-10-12 14-05-09");
  });
  it("serializes template clicks and quick input to preserve both insertions", async () => {
    const f = templateFixture("new template");
    const target = f.file("Notes/2026-10-12 14-05-09.md", "existing");
    await Promise.all([
      f.service.createTemplateNote(template(), now),
      f.service.submitQuickInput(request({ text: "quick input" })),
    ]);
    expect(f.contents.get(target.path)).toBe("existing\n\nnew template\n\nquick input");
  });
  it("uses defaults for unsupported format settings and rejects invalid dates", async () => {
    const f = templateFixture(); const result = await f.service.createTemplateNote(template({ dateFormat: "bogus", timeFormat: "bogus" }), now);
    expect(f.contents.get(result.file.path)).toBe("template 2026-10-12 14:05:09");
    await expect(f.service.createTemplateNote(template(), new Date(NaN))).rejects.toMatchObject({ code: "invalid-date" });
    expect(moment).toHaveBeenCalled();
  });
});

describe("NoteCreationService quick input", () => {
  it.each(["", "/"])("inserts into an existing root note with the host root normalization (%j)", async (folderPath) => {
    const f = templateFixture();
    const target = f.file("2026-10-12 14-05-09.md", "---\nstatus: existing\n---\noriginal body");
    const sent = request({ template: template({ targetFolderPath: folderPath }), text: "---\nstatus: draft\n---\nnew body" });
    expect(await f.service.submitQuickInput(sent)).toEqual({ file: target, created: false });
    expect(f.contents.get(target.path)).toBe("---\nstatus: existing\n---\noriginal body\n\nnew body");
    expect(f.vault.create).not.toHaveBeenCalled();
    expect(f.vault.process).toHaveBeenCalledOnce();
  });

  it("creates a template root note once and inserts later submissions into that same note", async () => {
    const f = templateFixture();
    const sent = request({ template: template({ targetFolderPath: "" }), text: "---\nstatus: draft\n---\nfirst body" });
    const first = await f.service.submitQuickInput(sent);
    const second = await f.service.submitQuickInput({ ...sent, submissionId: "second", text: "---\nstatus: ignored\n---\nsecond body" });
    expect(first).toMatchObject({ created: true, file: { path: "2026-10-12 14-05-09.md" } });
    expect(second).toEqual({ file: first.file, created: false });
    expect(f.contents.get(first.file.path)).toBe("---\nstatus: draft\n---\nfirst body\n\nsecond body");
    expect(f.vault.create).toHaveBeenCalledExactlyOnceWith(first.file.path, sent.text);
  });

  it("inserts into an unsaved root note through its editor instead of creating it again", async () => {
    const f = templateFixture();
    const target = f.file("2026-10-12 14-05-09.md", "disk content");
    const editor = f.open(target, "---\nstatus: existing\n---\nunsaved body");
    await f.service.submitQuickInput(request({ template: template({ targetFolderPath: "" }), text: "new body",
      config: { templateId: "daily", folderPath: "", insertPosition: "start" } }));
    expect(editor.getValue()).toBe("---\nstatus: existing\n---\n\nnew body\n\nunsaved body");
    expect(f.vault.create).not.toHaveBeenCalled();
    expect(editor.view.save).toHaveBeenCalledOnce();
  });

  it("prepares the same complete template as clicking it, including unsaved properties and body", async () => {
    const f = templateFixture("stale disk content");
    f.open(f.entries.get(template().filePath) as TFile, "---\nwhen: {{date}}\n---\n## {{time:HH:mm}}\nbody");
    const content = await f.service.prepareQuickInputTemplate(template(), now);
    expect(content).toBe("---\nwhen: 2026-10-12\n---\n## 14:05\nbody");
    expect(f.vault.create).not.toHaveBeenCalled();
    expect(f.vault.process).not.toHaveBeenCalled();
    const result = await f.service.createTemplateNote(template(), now);
    expect(f.contents.get(result.file.path)).toBe(content);
  });

  it.each(["start", "end"] as const)("inserts edited template body at %s while keeping existing properties, including unsaved targets", async (position) => {
    const f = templateFixture("---\nstatus: template\n---\n## Template body");
    const target = f.file("Notes/2026-10-12 14-05-09.md", "disk content");
    const editor = f.open(target, "---\nstatus: existing\n---\noriginal body");
    const text = (await f.service.prepareQuickInputTemplate(template(), now)).replace("Template body", "Edited body") + "\nmy input {{date}}";
    await f.service.submitQuickInput(request({ text, config: { templateId: "daily", folderPath: "", insertPosition: position } }));
    const body = "## Edited body\nmy input {{date}}";
    expect(editor.getValue()).toBe(position === "start"
      ? `---\nstatus: existing\n---\n\n${body}\n\noriginal body`
      : `---\nstatus: existing\n---\noriginal body\n\n${body}`);
    expect(editor.replaceRange).toHaveBeenCalledOnce();
  });

  it.each(["start", "end"] as const)("strips draft properties before %s insertion through vault.process", async (position) => {
    const f = templateFixture();
    const target = f.file("Notes/2026-10-12 14-05-09.md", "---\nstatus: existing\n---\noriginal body");
    await f.service.submitQuickInput(request({ text: "---\nstatus: edited\n---\nnew body", config: { templateId: "daily", folderPath: "", insertPosition: position } }));
    expect(f.contents.get(target.path)).toBe(position === "start"
      ? "---\nstatus: existing\n---\n\nnew body\n\noriginal body"
      : "---\nstatus: existing\n---\noriginal body\n\nnew body");
  });

  it("preserves an existing note when the edited draft contains only properties", async () => {
    const f = templateFixture();
    const target = f.file("Notes/2026-10-12 14-05-09.md", "keep existing content");
    await f.service.submitQuickInput(request({ text: "---\nstatus: draft\n---\n\n" }));
    expect(f.contents.get(target.path)).toBe("keep existing content");
    expect(f.vault.process).not.toHaveBeenCalled();
  });

  it("formats template overrides while preserving draft variables and captured content on retry", async () => {
    const f = templateFixture("{{date}} {{date:YYYY/MM/DD}} {{time:HH:mm}}");
    const text = "draft {{date:YYYY}} {{time:HH:mm}}";
    const expanded = await f.service.prepareQuickInputTemplate(template(), now);
    const sent = request({ text: `${expanded}\n\n${text}`, now: new Date(now.getTime()) });
    f.vault.create.mockRejectedValueOnce(new Error("disk full"));
    await expect(f.service.submitQuickInput(sent)).rejects.toThrow("disk full");
    sent.now.setFullYear(2040);
    const result = await f.service.submitQuickInput(sent);
    expect(result.file.path).toBe("Notes/2026-10-12 14-05-09.md");
    expect(f.contents.get(result.file.path)).toBe(`2026-10-12 2026/10/12 14:05\n\n${text}`);
    expect(f.vault.create.mock.calls[1]).toEqual(f.vault.create.mock.calls[0]);
  });
  it.each(["template", "plain"] as const)("recognizes a %s create that persisted before rejection without duplicating input or notes", async (kind) => {
    const f = templateFixture();
    if (kind === "plain") f.file("quick-note 2026-10-12 14-05-09.md", "existing");
    const sent = kind === "template" ? request({ text: "input" }) : request({ text: "input", template: null, config: { templateId: null, folderPath: "", insertPosition: "end" } });
    const create = f.vault.create.getMockImplementation()!;
    f.vault.create.mockImplementationOnce(async (path, content) => { await create(path, content); throw new Error("failed after create"); });
    await expect(f.service.submitQuickInput(sent)).rejects.toThrow("failed after create");
    const result = await f.service.submitQuickInput({ ...sent, text: "changed retry text", now: new Date(2040, 1, 1) });
    expect(result.created).toBe(true);
    expect(result.file.path).toBe(kind === "template" ? "Notes/2026-10-12 14-05-09.md" : "quick-note 2026-10-12 14-05-09 1.md");
    expect(f.contents.get(result.file.path)).toBe("input");
    expect(f.vault.create).toHaveBeenCalledTimes(1);
    expect(f.vault.process).not.toHaveBeenCalled();
    expect(await f.service.submitQuickInput(sent)).toBe(result);
  });
  it.each(["template", "plain"] as const)("retries an absent %s creation at the captured path with captured content", async (kind) => {
    const f = templateFixture();
    const sent = kind === "template" ? request({ text: "input" }) : request({ text: "input", template: null, config: { templateId: null, folderPath: "", insertPosition: "end" } });
    f.vault.create.mockRejectedValueOnce(new Error("disk full"));
    await expect(f.service.submitQuickInput(sent)).rejects.toThrow("disk full");
    f.contents.set(template().filePath, "edited template {{date}}");
    const result = await f.service.submitQuickInput({ ...sent, text: "changed retry text" });
    expect(result.created).toBe(true);
    expect(f.contents.get(result.file.path)).toBe("input");
    expect(f.vault.create.mock.calls[1]).toEqual(f.vault.create.mock.calls[0]);
  });
  it.each(["template", "plain"] as const)("blocks divergent content after an uncertain %s creation", async (kind) => {
    const f = templateFixture();
    const sent = kind === "template" ? request({ text: "input" }) : request({ text: "input", template: null, config: { templateId: null, folderPath: "", insertPosition: "end" } });
    const create = f.vault.create.getMockImplementation()!;
    f.vault.create.mockImplementationOnce(async (path, content) => { await create(path, content); throw new Error("failed after create"); });
    await expect(f.service.submitQuickInput(sent)).rejects.toThrow("failed after create");
    const path = f.vault.create.mock.calls[0]![0];
    f.contents.set(path, "later edits");
    await expect(f.service.submitQuickInput(sent)).rejects.toMatchObject({ code: "target-changed" });
    expect(f.contents.get(path)).toBe("later edits");
    expect(f.vault.create).toHaveBeenCalledTimes(1);
    expect(f.vault.process).not.toHaveBeenCalled();
  });
  it("keeps created:true through editor save failure while recovering an uncertain creation", async () => {
    const f = fixture();
    const sent = request({ text: "input", template: null, config: { templateId: null, folderPath: "", insertPosition: "end" } });
    const create = f.vault.create.getMockImplementation()!;
    f.vault.create.mockImplementationOnce(async (path, content) => { await create(path, content); throw new Error("failed after create"); });
    await expect(f.service.submitQuickInput(sent)).rejects.toThrow("failed after create");
    const target = f.entries.get("quick-note 2026-10-12 14-05-09.md") as TFile;
    const editor = f.open(target, "input");
    vi.mocked(editor.view.save).mockRejectedValueOnce(new Error("save failed"));
    await expect(f.service.submitQuickInput(sent)).rejects.toThrow("save failed");
    expect(await f.service.submitQuickInput(sent)).toEqual({ file: target, created: true });
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(editor.view.save).toHaveBeenCalledTimes(2);
    expect(f.vault.create).toHaveBeenCalledTimes(1);
  });
  it("saves the edited draft once without restoring deleted template content or replacing user variables", async () => {
    const f = templateFixture(); const sent = request();
    const pending = f.service.submitQuickInput(sent);
    expect(f.service.submitQuickInput(sent)).toBe(pending);
    const result = await pending;
    expect(f.contents.get(result.file.path)).toBe(sent.text);
    expect(f.vault.cachedRead).not.toHaveBeenCalled();
    expect(await f.service.submitQuickInput(sent)).toBe(result); expect(f.vault.create).toHaveBeenCalledTimes(1);
  });
  it("inserts the edited draft into an existing note with vault.process", async () => {
    const f = templateFixture(); f.file("Notes/2026-10-12 14-05-09.md", "existing");
    const result = await f.service.submitQuickInput(request());
    expect(result.created).toBe(false); expect(f.contents.get(result.file.path)).toBe("existing\n\nuser {{date}} {{time}}");
    expect(f.vault.process).toHaveBeenCalledTimes(1); expect(f.vault.cachedRead).not.toHaveBeenCalled();
  });
  it("recognizes a process write that reached disk before rejecting and does not insert twice", async () => {
    const f = templateFixture(); const target = f.file("Notes/2026-10-12 14-05-09.md", "body");
    f.vault.process.mockImplementationOnce(async (file, change) => {
      f.contents.set(file.path, change(f.contents.get(file.path)!));
      throw new Error("write reported failure");
    });
    await expect(f.service.submitQuickInput(request({ text: "input" }))).rejects.toThrow("write reported failure");
    expect(f.contents.get(target.path)).toBe("body\n\ninput");
    const result = await f.service.submitQuickInput(request({ text: "changed retry text", now: new Date(2040, 1, 1) }));
    expect(result).toEqual({ file: target, created: false });
    expect(f.contents.get(target.path)).toBe("body\n\ninput");
    expect(f.vault.process).toHaveBeenCalledTimes(1);
    expect(f.vault.read).toHaveBeenCalledWith(target);
  });
  it("safely retries when process transformed the original text but failed before writing", async () => {
    const f = templateFixture(); const target = f.file("Notes/2026-10-12 14-05-09.md", "body");
    f.vault.process.mockImplementationOnce(async (file, change) => {
      change(f.contents.get(file.path)!);
      throw new Error("disk full");
    });
    await expect(f.service.submitQuickInput(request({ text: "input" }))).rejects.toThrow("disk full");
    expect(f.contents.get(target.path)).toBe("body");
    await f.service.submitQuickInput(request({ text: "changed retry text" }));
    expect(f.contents.get(target.path)).toBe("body\n\ninput");
    expect(f.vault.process).toHaveBeenCalledTimes(2);
  });
  it("blocks retries after divergent disk edits without changing content", async () => {
    const f = templateFixture(); const target = f.file("Notes/2026-10-12 14-05-09.md", "body");
    f.vault.process.mockImplementationOnce(async (file, change) => {
      f.contents.set(file.path, change(f.contents.get(file.path)!));
      throw new Error("failed after writing");
    });
    await expect(f.service.submitQuickInput(request({ text: "input" }))).rejects.toThrow("failed after writing");
    f.contents.set(target.path, "body\n\ninput\nnew edit");
    await expect(f.service.submitQuickInput(request({ text: "input" }))).rejects.toMatchObject({ code: "target-changed" });
    expect(f.contents.get(target.path)).toBe("body\n\ninput\nnew edit");
    expect(f.vault.process).toHaveBeenCalledTimes(1);
  });
  it("uses unsaved editor content to guard a formerly unopened target retry", async () => {
    const f = templateFixture(); const target = f.file("Notes/2026-10-12 14-05-09.md", "body");
    f.vault.process.mockImplementationOnce(async (file, change) => {
      f.contents.set(file.path, change(f.contents.get(file.path)!));
      throw new Error("failed after writing");
    });
    await expect(f.service.submitQuickInput(request({ text: "input" }))).rejects.toThrow("failed after writing");
    const editor = f.open(target, "body\n\ninput\nunsaved change");
    await expect(f.service.submitQuickInput(request({ text: "input" }))).rejects.toMatchObject({ code: "target-changed" });
    expect(editor.getValue()).toBe("body\n\ninput\nunsaved change");
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(editor.view.save).not.toHaveBeenCalled();
    expect(f.vault.read).not.toHaveBeenCalled();
  });
  it("aborts a delayed process when the target opens and retries through its latest editor", async () => {
    const f = templateFixture(); const target = f.file("Notes/2026-10-12 14-05-09.md", "disk");
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    f.vault.process.mockImplementationOnce(async (file, change) => {
      entered();
      await gate;
      const content = change(f.contents.get(file.path)!);
      f.contents.set(file.path, content);
      return content;
    });
    const pending = f.service.submitQuickInput(request({ text: "input" }));
    await started;
    const editor = f.open(target, "latest unsaved edits");
    release();
    await expect(pending).rejects.toMatchObject({ code: "target-changed" });
    expect(f.contents.get(target.path)).toBe("disk");
    await f.service.submitQuickInput(request({ text: "input" }));
    expect(f.contents.get(target.path)).toBe("latest unsaved edits\n\ninput");
    expect(editor.replaceRange).toHaveBeenCalledTimes(1);
    expect(f.vault.process).toHaveBeenCalledTimes(1);
    expect(f.vault.read).not.toHaveBeenCalled();
  });
  it("saves an exact expected editor draft on recovery without reinserting it", async () => {
    const f = templateFixture(); const target = f.file("Notes/2026-10-12 14-05-09.md", "body");
    f.vault.process.mockImplementationOnce(async (file, change) => {
      change(f.contents.get(file.path)!);
      throw new Error("disk full");
    });
    await expect(f.service.submitQuickInput(request({ text: "input" }))).rejects.toThrow("disk full");
    const editor = f.open(target, "body\n\ninput");
    await f.service.submitQuickInput(request({ text: "input" }));
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(editor.view.save).toHaveBeenCalledTimes(1);
    expect(f.contents.get(target.path)).toBe("body\n\ninput");
  });
  it("rechecks the original inside the atomic process callback after recovery read", async () => {
    const f = templateFixture(); const target = f.file("Notes/2026-10-12 14-05-09.md", "body");
    f.vault.process.mockImplementationOnce(async (file, change) => {
      change(f.contents.get(file.path)!);
      throw new Error("disk full");
    });
    await expect(f.service.submitQuickInput(request({ text: "input" }))).rejects.toThrow("disk full");
    f.vault.read.mockImplementationOnce(async () => { f.contents.set(target.path, "new disk edit"); return "body"; });
    await expect(f.service.submitQuickInput(request({ text: "input" }))).rejects.toMatchObject({ code: "target-changed" });
    expect(f.contents.get(target.path)).toBe("new disk edit");
  });
  it.each(["existing", "template", "plain"] as const)("releases completed %s submission text and recovery snapshots while preserving ID deduplication", async (kind) => {
    const f = templateFixture();
    if (kind === "existing") f.file("Notes/2026-10-12 14-05-09.md", "body");
    const text = "large draft".repeat(10000);
    const sent = kind === "plain" ? request({ text, template: null, config: { templateId: null, folderPath: "", insertPosition: "end" } }) : request({ text });
    const result = await f.service.submitQuickInput(sent);
    const submissions = (f.service as unknown as { submissions: Map<string, { request: QuickInputRequest; attempted: unknown; inserted: unknown; creation: unknown }> }).submissions;
    expect(submissions.get(sent.submissionId)?.request.text).toBe("");
    expect(submissions.get(sent.submissionId)?.attempted).toBeNull();
    expect(submissions.get(sent.submissionId)?.inserted).toBeNull();
    expect(submissions.get(sent.submissionId)?.creation).toBeNull();
    expect(await f.service.submitQuickInput({ ...sent, text: "retry" })).toBe(result);
    expect(f.contents.get(result.file.path)).toBe(kind === "existing" ? `body\n\n${sent.text}` : sent.text);
    expect(f.vault.process.mock.calls.length + f.vault.create.mock.calls.length).toBe(1);
  });
  it.each(["start", "end"] as const)("preserves YAML and existing body on %s insertion", async (position) => {
    const f = templateFixture(); f.file("Notes/2026-10-12 14-05-09.md", "---\nstatus: true\n---\n\nbody\n");
    const result = await f.service.submitQuickInput(request({ text: "input", config: { templateId: "daily", folderPath: "", insertPosition: position } }));
    expect(f.contents.get(result.file.path)).toBe(position === "start" ? "---\nstatus: true\n---\n\ninput\n\nbody\n" : "---\nstatus: true\n---\n\nbody\n\ninput");
  });
  it("saves edited properties and body exactly when creating a new template target", async () => {
    const f = templateFixture("---\nwhen: {{date}}\n---\nbody");
    const text = "---\nwhen: edited\n---\nfirst\n\nedited body";
    const result = await f.service.submitQuickInput(request({ text, config: { templateId: "daily", folderPath: "", insertPosition: "start" } }));
    expect(f.contents.get(result.file.path)).toBe(text);
  });
  it("preserves CRLF content and inserts at the front of body-only notes", async () => {
    const f = templateFixture(); const target = f.file("Notes/2026-10-12 14-05-09.md", "body\r\n");
    await f.service.submitQuickInput(request({ text: "first", config: { templateId: "daily", folderPath: "", insertPosition: "start" } }));
    expect(f.contents.get(target.path)).toBe("first\r\n\r\nbody\r\n");
  });
  it("uses latest unsaved editor text, an insertion edit, and saves the view", async () => {
    const f = templateFixture(); const target = f.file("Notes/2026-10-12 14-05-09.md", "disk"); const editor = f.open(target, "unsaved edits");
    await f.service.submitQuickInput(request({ text: "input" }));
    expect(f.contents.get(target.path)).toBe("unsaved edits\n\ninput"); expect(editor.replaceRange).toHaveBeenCalledTimes(1); expect(editor.view.save).toHaveBeenCalledTimes(1); expect(f.vault.process).not.toHaveBeenCalled();
  });
  it("retries a failed editor save without duplicating insertion and preserves subsequent edits", async () => {
    const f = templateFixture(); const target = f.file("Notes/2026-10-12 14-05-09.md", "disk"); const editor = f.open(target, "draft");
    vi.mocked(editor.view.save).mockRejectedValueOnce(new Error("save failed"));
    await expect(f.service.submitQuickInput(request({ text: "input" }))).rejects.toThrow("save failed");
    expect(editor.getValue()).toBe("draft\n\ninput"); editor.setValue(`${editor.getValue()}\nmore editing`);
    const result = await f.service.submitQuickInput(request({ text: "changed retry text", now: new Date(2040, 1, 1) }));
    expect(result.file).toBe(target); expect(f.contents.get(target.path)).toBe("draft\n\ninput\nmore editing"); expect(editor.replaceRange).toHaveBeenCalledTimes(1); expect(editor.view.save).toHaveBeenCalledTimes(2);
  });
  it("does not save an unrelated file if the editor switches after a failed save", async () => {
    const f = templateFixture(); const target = f.file("Notes/2026-10-12 14-05-09.md"); const editor = f.open(target, "draft");
    vi.mocked(editor.view.save).mockRejectedValueOnce(new Error("failed"));
    await expect(f.service.submitQuickInput(request())).rejects.toThrow("failed"); editor.view.file = f.file("Other.md");
    await expect(f.service.submitQuickInput(request())).rejects.toMatchObject({ code: "pending-save-unavailable" });
    expect(editor.view.save).toHaveBeenCalledTimes(1); expect(f.vault.process).not.toHaveBeenCalled();
  });
  it("serializes different submissions to the same target and preserves both inputs", async () => {
    const f = templateFixture(); const target = f.file("Notes/2026-10-12 14-05-09.md", "body");
    await Promise.all([f.service.submitQuickInput(request({ text: "one" })), f.service.submitQuickInput(request({ submissionId: "two", text: "two" }))]);
    expect(f.contents.get(target.path)).toBe("body\n\none\n\ntwo");
  });
  it("creates unique timestamp notes with only input when no template is selected", async () => {
    const f = fixture(); f.file("quick-note 2026-10-12 14-05-09.md", "existing");
    const result = await f.service.submitQuickInput(request({ template: null, config: { templateId: null, folderPath: "", insertPosition: "start" }, text: "just {{date}}" }));
    expect(result.file.path).toBe("quick-note 2026-10-12 14-05-09 1.md"); expect(f.contents.get(result.file.path)).toBe("just {{date}}");
  });
  it("snapshots config and Date before the queued operation runs", async () => {
    const f = fixture(); f.folder("Notes"); const sent = request({ template: null, now: new Date(now), config: { templateId: null, folderPath: "Notes", insertPosition: "end" } });
    const pending = f.service.submitQuickInput(sent); sent.config.folderPath = "missing"; sent.now.setFullYear(2040); sent.text = "changed";
    const result = await pending;
    expect(result.file.path).toBe("Notes/quick-note 2026-10-12 14-05-09.md"); expect(f.contents.get(result.file.path)).toBe("user {{date}} {{time}}");
  });
  it("retains the original request on retry after creation failure", async () => {
    const f = fixture(); f.vault.create.mockRejectedValueOnce(new Error("disk full"));
    const sent = request({ template: null, config: { templateId: null, folderPath: "", insertPosition: "end" } });
    await expect(f.service.submitQuickInput(sent)).rejects.toThrow("disk full");
    const result = await f.service.submitQuickInput({ ...sent, text: "changed", now: new Date(2040, 1, 1) });
    expect(result.file.path).toBe("quick-note 2026-10-12 14-05-09.md"); expect(f.contents.get(result.file.path)).toBe(sent.text);
  });
  it("rejects whitespace, mismatched template references and missing folders without fallback", async () => {
    const f = templateFixture();
    await expect(f.service.submitQuickInput(request({ text: " \n\t" }))).rejects.toMatchObject({ code: "empty-input" });
    await expect(f.service.submitQuickInput(request({ template: null }))).rejects.toMatchObject({ code: "missing-template" });
    await expect(f.service.submitQuickInput(request({ template: null, config: { templateId: null, folderPath: "Missing", insertPosition: "end" } }))).rejects.toMatchObject({ code: "missing-folder" });
    expect(f.vault.create).not.toHaveBeenCalled();
  });
  it("normalizes non-Error setup failures while preserving Error instances", async () => {
    const f = templateFixture();
    const getFile = vi.spyOn(f.app.vault, "getAbstractFileByPath");
    getFile.mockImplementationOnce(() => { throw "vault unavailable"; });
    await expect(f.service.submitQuickInput(request())).rejects.toThrow("vault unavailable");
    const error = new Error("vault unavailable");
    getFile.mockImplementationOnce(() => { throw error; });
    await expect(f.service.submitQuickInput(request())).rejects.toBe(error);
    expect(f.vault.create).not.toHaveBeenCalled();
  });
});


it.each(["en", "zh"] as const)("blocks an unchanged template title in %s for note creation and quick input", async (language) => {
  const f = templateFixture();
  const path = `Templates/${getUiStrings(language).noteInput.initialTemplateTitle} 1.md`;
  f.file(path);
  await expect(f.service.createTemplateNote(template({ filePath: path }), now)).rejects.toMatchObject({ code: "unedited-template-title" });
  await expect(f.service.submitQuickInput(request({ template: template({ filePath: path }) }))).rejects.toMatchObject({ code: "unedited-template-title" });
  expect(f.vault.create).not.toHaveBeenCalled();
});
