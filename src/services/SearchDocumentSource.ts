import { TFile, type App } from "obsidian";

import { prepareSearchableDocument, type SearchableDocument } from "../search";
import { isMarkdownCardKind, resolveCardFileKind } from "../view/file-kind";

export const SEARCH_DOCUMENT_READ_CONCURRENCY = 8;

export async function prepareSearchDocument(app: App, file: TFile): Promise<SearchableDocument | null> {
  try {
    const title = file.basename;
    const fileKind = resolveCardFileKind(file);
    if (fileKind === null || !isMarkdownCardKind(fileKind)) {
      return prepareSearchableDocument({ path: file.path, title, mtime: file.stat.mtime, ctime: file.stat.ctime });
    }
    const cachedRead = (app.vault as { cachedRead?: (target: TFile) => Promise<string> }).cachedRead;
    if (typeof cachedRead !== "function") return null;
    const markdown = await cachedRead.call(app.vault, file);
    return prepareSearchableDocument({
      path: file.path,
      title,
      markdown,
      mtime: file.stat.mtime,
      ctime: file.stat.ctime,
    });
  } catch {
    return null;
  }
}

export function resolveSearchVaultNamespace(app: App): string {
  const adapter = app.vault.adapter as { getBasePath?: () => string; basePath?: string };
  const basePath = typeof adapter.getBasePath === "function"
    ? adapter.getBasePath()
    : typeof adapter.basePath === "string" ? adapter.basePath : "";
  if (basePath.trim()) return `path:${basePath}`;
  const getName = (app.vault as { getName?: () => string }).getName;
  return `name:${typeof getName === "function" ? getName.call(app.vault) : "unknown-vault"}`;
}

export interface SearchDocumentPreparer {
  (file: TFile): Promise<SearchableDocument | null>;
}

/** Reads vault documents in stable enumeration order with a fixed-size worker pool. */
export class SearchDocumentSource {
  constructor(
    private readonly app: App,
    private readonly prepare: SearchDocumentPreparer,
  ) {}

  async readAllDocuments(signal?: AbortSignal): Promise<SearchableDocument[]> {
    const getFiles = (this.app.vault as { getFiles?: () => unknown[] }).getFiles;
    if (typeof getFiles !== "function" || signal?.aborted) {
      return [];
    }

    const files = getFiles.call(this.app.vault).filter((file): file is TFile => file instanceof TFile);
    const results: Array<SearchableDocument | null> = Array.from({ length: files.length }, () => null);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        if (signal?.aborted) return;
        const index = cursor;
        if (index >= files.length) {
          return;
        }
        cursor += 1;
        try {
          const document = await this.prepare(files[index]);
          if (signal?.aborted) {
            return;
          }
          results[index] = document;
        } catch {
          results[index] = null;
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(SEARCH_DOCUMENT_READ_CONCURRENCY, files.length) }, worker),
    );
    if (signal?.aborted) {
      return [];
    }
    return results.filter((document): document is SearchableDocument => document !== null);
  }

  async readDocument(path: string): Promise<SearchableDocument | null> {
    const target = this.app.vault.getAbstractFileByPath(path);
    return target instanceof TFile ? this.prepare(target) : null;
  }
}
