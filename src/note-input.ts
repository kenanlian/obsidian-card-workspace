import type { TFile } from "obsidian";

export interface NoteTemplateDefinition {
  id: string;
  /** Independent navigation label; absent on legacy registrations. */
  name?: string;
  filePath: string;
  targetFolderPath: string | null;
  dateFormat: string;
  timeFormat: string;
  /** Where clicking this template inserts its body into an existing note. Defaults to end. */
  existingNoteInsertPosition?: "start" | "end";
}

export interface QuickInputConfig {
  templateId: string | null;
  folderPath: string;
  insertPosition: "start" | "end";
}

export interface ScopeNoteRequest {
  folderPath: string;
  tags: string[];
  properties: Record<string, string | number | boolean>;
  baseName: string;
  emptyTags: boolean;
}

export interface NoteInputResult { file: TFile; created: boolean }

/** Runtime snapshot used to avoid positioning into a note edited after the write. */
export interface TemplateNoteCursor { content: string; offset: number }
export interface TemplateNoteResult extends NoteInputResult { cursor?: TemplateNoteCursor }

export interface QuickInputVisibility {
  title: boolean;
  folder: boolean;
  boxes: boolean;
  tags: boolean;
  properties: boolean;
}
export const DEFAULT_QUICK_INPUT_VISIBILITY: QuickInputVisibility = {
  title: false, folder: true, boxes: false, tags: false, properties: false,
};
export function normalizeQuickInputVisibility(value: unknown): QuickInputVisibility {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(DEFAULT_QUICK_INPUT_VISIBILITY).map(([key, fallback]) =>
    [key, typeof raw[key] === "boolean" ? raw[key] : fallback])) as unknown as QuickInputVisibility;
}
export interface QuickInputDestination { folderPath: string; title: string }
export interface PreparedQuickInput { text: string; title: string; folderPath: string; sourceFile?: TFile }
export type QuickInputMode = "create" | "append";

export interface QuickInputRequest {
  submissionId: string;
  target?: QuickInputDestination;
  /** Runtime identity protects the original template even after a rename. */
  templateSource?: TFile;
  boxIds?: string[];
  expectedMode?: QuickInputMode;
  /** Complete edited document; template variables were expanded when the draft opened. */
  text: string;
  config: QuickInputConfig;
  template: NoteTemplateDefinition | null;
  now: Date;
}

export const NOTE_TEMPLATE_DATE_FORMATS = [
  "YYYY-MM-DD", "YYYYMMDD", "YYYY/MM/DD", "YYYY.MM.DD", "YYYY年MM月DD日", "YYYY-MM", "YYYY年MM月", "YYYY",
] as const;
export const NOTE_TEMPLATE_TIME_FORMATS = [
  "HH:mm:ss", "HH:mm", "HH", "HH-mm-ss", "HH-mm", "HH时mm分ss秒", "HH时mm分", "HH时",
] as const;
export const DEFAULT_NOTE_TEMPLATE_DATE_FORMAT = "YYYY-MM-DD";
export const DEFAULT_NOTE_TEMPLATE_TIME_FORMAT = "HH:mm:ss";
export const DEFAULT_QUICK_INPUT: QuickInputConfig = { templateId: null, folderPath: "", insertPosition: "end" };
export const DEFAULT_TEMPLATE_STORAGE_FOLDER = "Card Workspace Templates";

export function resolveTemplateName(template: NoteTemplateDefinition): string {
  return template.name?.trim() || template.filePath.split("/").pop() || template.filePath;
}

/** Templates must remain ordinary vault files, accessible to the native editor. */
export function normalizeTemplateFolderPath(value: string): string | null {
  const path = normalizeInputPath(value);
  if (path === null || path.split("/").some((part) => part.startsWith(".") || /[:*?"<>|]/.test(part))) return null;
  return path;
}

export function isInitialTemplateTitle(title: string): boolean {
  return /^(?:请在此处编辑模板标题，支持通过\{\{date\}\}和\{\{time\}\}来显示当前日期和时间|Edit the template title here, use \{\{date\}\} and \{\{time\}\} for the current date and time)(?: \d+)?$/.test(title);
}

/** Structural normalization deliberately preserves references to missing vault entries. */
function normalizeInputPath(value: string): string | null {
  const path = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
  if (path.split("/").some((part) => part === "." || part === "..")) return null;
  for (const character of path) if (character.charCodeAt(0) < 32) return null;
  return path;
}

export function normalizeNoteTemplates(value: unknown): NoteTemplateDefinition[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  const result: NoteTemplateDefinition[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const raw = entry as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const filePath = typeof raw.filePath === "string" ? normalizeInputPath(raw.filePath) : null;
    if (!id || !filePath || ids.has(id) || paths.has(filePath)) continue;
    const targetFolderPath = typeof raw.targetFolderPath === "string" ? normalizeInputPath(raw.targetFolderPath) : null;
    ids.add(id); paths.add(filePath);
    result.push({
      id, filePath, targetFolderPath,
      ...(typeof raw.name === "string" && raw.name.trim() ? { name: raw.name.trim() } : {}),
      ...(raw.existingNoteInsertPosition === "start" || raw.existingNoteInsertPosition === "end"
        ? { existingNoteInsertPosition: raw.existingNoteInsertPosition } : {}),
      dateFormat: NOTE_TEMPLATE_DATE_FORMATS.includes(raw.dateFormat as typeof NOTE_TEMPLATE_DATE_FORMATS[number]) ? raw.dateFormat as string : DEFAULT_NOTE_TEMPLATE_DATE_FORMAT,
      timeFormat: NOTE_TEMPLATE_TIME_FORMATS.includes(raw.timeFormat as typeof NOTE_TEMPLATE_TIME_FORMATS[number]) ? raw.timeFormat as string : DEFAULT_NOTE_TEMPLATE_TIME_FORMAT,
    });
  }
  return result;
}

export function normalizeQuickInput(value: unknown): QuickInputConfig {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    templateId: typeof raw.templateId === "string" && raw.templateId.trim() ? raw.templateId.trim() : null,
    // Keep malformed authored paths unavailable; replacing them with root
    // would silently redirect a submission to a different destination.
    folderPath: typeof raw.folderPath === "string" ? normalizeInputPath(raw.folderPath) ?? raw.folderPath.trim() : "",
    insertPosition: raw.insertPosition === "start" ? "start" : "end",
  };
}
