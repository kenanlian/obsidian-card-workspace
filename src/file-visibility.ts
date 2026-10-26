import type { App, TFile } from "obsidian";

export type FileVisibility = "documents" | "supported" | "all";
export function isFileVisibility(value: unknown): value is FileVisibility {
  return value === "documents" || value === "supported" || value === "all";
}
const documents = new Set(["md", "base", "canvas", "excalidraw"]);
const native = new Set(["md", "base", "canvas", "pdf", "avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp",
  "flac", "m4a", "mp3", "ogg", "wav", "webm", "3gp", "mkv", "mov", "mp4", "ogv"]);

function extension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}
/** The private host registry is optional, isolated here, and read afresh for each snapshot. */
function registeredExtensions(app: App): Set<string> {
  const result = new Set(native);
  try {
    const registry = (app as App & { viewRegistry?: { typeByExtension?: unknown } }).viewRegistry?.typeByExtension;
    if (registry && typeof registry === "object" && !Array.isArray(registry)) {
      for (const key of Object.keys(registry)) result.add(key.replace(/^\./, "").toLowerCase());
    }
  } catch { /* Native formats remain usable on hosts without this capability. */ }
  return result;
}
export interface FileVisibilityPolicy {
  readonly key: string;
  accepts(file: Pick<TFile, "path">): boolean;
}
export function createFileVisibilityPolicy(app: App, visibility: FileVisibility = "supported"): FileVisibilityPolicy {
  const supported = registeredExtensions(app);
  return {
    key: JSON.stringify([visibility, ...[...supported].sort()]),
    accepts: (file) => visibility === "all" || documents.has(extension(file.path))
      || (visibility === "supported" && supported.has(extension(file.path))),
  };
}
export function canOpenFileInObsidian(app: App, file: Pick<TFile, "path">): boolean {
  return registeredExtensions(app).has(extension(file.path));
}
