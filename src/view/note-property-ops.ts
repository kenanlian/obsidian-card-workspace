import type { App, TFile } from "obsidian";
import { editablePropertyKey, validPropertiesDraft, type BulkPropertiesDraft } from "./bulk-metadata";
import { isMarkdownFile } from "./note-ops";
import type { TagMutationResult } from "./note-tag-ops";

function equalValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((entry, index) => entry === right[index]);
  }
  return left === right;
}

/** A single host transaction combines all property sets and removals. */
export async function editPropertiesInFile(app: App, file: TFile, draft: BulkPropertiesDraft): Promise<TagMutationResult> {
  if (!isMarkdownFile(file) || !validPropertiesDraft(draft)) {
    return { ok: false, path: file.path, error: "Invalid property operation." };
  }
  try {
    let changed = false;
    await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      for (const remove of draft.removeKeys) {
        for (const raw of Object.keys(frontmatter)) {
          if (editablePropertyKey(raw) === editablePropertyKey(remove)) {
            delete frontmatter[raw];
            changed = true;
          }
        }
      }
      for (const entry of draft.setProperties) {
        const existing = Object.keys(frontmatter).filter((raw) => editablePropertyKey(raw) === editablePropertyKey(entry.name));
        for (const raw of existing.length ? existing : [entry.name.trim()]) {
          if (!Object.prototype.hasOwnProperty.call(frontmatter, raw) || !equalValue(frontmatter[raw], entry.value)) {
            // Own-property definition also handles names such as __proto__ safely.
            Object.defineProperty(frontmatter, raw, {
              value: Array.isArray(entry.value) ? [...entry.value] : entry.value,
              enumerable: true,
              configurable: true,
              writable: true,
            });
            changed = true;
          }
        }
      }
    });
    return { ok: true, changed, file };
  } catch (error) {
    return { ok: false, path: file.path, error: String(error) };
  }
}
