import type { App } from "obsidian";
import type { NoteTemplateDefinition } from "./note-input";

/** One predicate for registered and not-yet-registered template files. */
export function isTemplatePath(
  path: string,
  templates: readonly NoteTemplateDefinition[] | ReadonlySet<string>,
  reservedPaths: ReadonlySet<string> = new Set(),
): boolean {
  return reservedPaths.has(path) || ("has" in templates ? templates.has(path) : templates.some((template) => template.filePath === path));
}

// Vault helpers have no settings ownership. The plugin installs a live source
// for its App, keeping isolated vaults and secondary windows on the same policy.
const sources = new WeakMap<App, (path: string) => boolean>();
export function installTemplateExclusion(app: App, source: (path: string) => boolean): () => void {
  sources.set(app, source);
  return () => { if (sources.get(app) === source) sources.delete(app); };
}
export function isExcludedTemplatePath(app: App, path: string): boolean {
  return sources.get(app)?.(path) ?? false;
}
