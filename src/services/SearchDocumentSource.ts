import { TFile, type App } from "obsidian";

import { prepareSearchableDocument, type IndexStoreDocumentCatalog, type SearchableDocument } from "../search";
import { isMarkdownCardKind, isSupportedCardFile, resolveCardFileKind } from "../view/file-kind";

export const SEARCH_DOCUMENT_READ_CONCURRENCY = 8;

/** Files read per stream window, so a full build holds one window of prepared documents at a time. */
export const SEARCH_DOCUMENT_BATCH_SIZE = 200;

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

  /**
   * Single source of enumeration for both the document read pass and the
   * catalog snapshot: if the two ever filtered differently, a vault change
   * would be silently mis-detected.
   */
  private listIndexableFiles(): TFile[] {
    const getFiles = (this.app.vault as { getFiles?: () => unknown[] }).getFiles;
    if (typeof getFiles !== "function") {
      return [];
    }

    // Queries are always intersected with card candidates, so an attachment
    // could never surface as a result; indexing one only inflates the index.
    return getFiles
      .call(this.app.vault)
      .filter((file): file is TFile => file instanceof TFile && isSupportedCardFile(file));
  }

  /** Synchronous path-to-mtime snapshot. Performs no file reads. */
  readCatalogSnapshot(): IndexStoreDocumentCatalog {
    const catalog: IndexStoreDocumentCatalog = {};
    for (const file of this.listIndexableFiles()) {
      catalog[file.path] = file.stat.mtime;
    }
    return catalog;
  }

  /**
   * Yields consecutive windows of the same enumeration `readAllDocuments`
   * walks, so global document order is identical to reading the whole vault at
   * once while only one window of prepared documents is alive at a time.
   */
  async *streamDocuments(signal?: AbortSignal): AsyncGenerator<SearchableDocument[]> {
    if (signal?.aborted) {
      return;
    }

    const files = this.listIndexableFiles();
    for (let start = 0; start < files.length; start += SEARCH_DOCUMENT_BATCH_SIZE) {
      const window = files.slice(start, start + SEARCH_DOCUMENT_BATCH_SIZE);
      const results: Array<SearchableDocument | null> = Array.from({ length: window.length }, () => null);
      let cursor = 0;
      const worker = async (): Promise<void> => {
        while (true) {
          if (signal?.aborted) return;
          const index = cursor;
          if (index >= window.length) {
            return;
          }
          cursor += 1;
          try {
            const document = await this.prepare(window[index]);
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
        Array.from({ length: Math.min(SEARCH_DOCUMENT_READ_CONCURRENCY, window.length) }, worker),
      );
      if (signal?.aborted) {
        return;
      }
      const batch = results.filter((document): document is SearchableDocument => document !== null);
      if (batch.length > 0) {
        yield batch;
      }
    }
  }

  /** Concatenation of `streamDocuments`, so the two can never diverge in enumeration, filtering, or order. */
  async readAllDocuments(signal?: AbortSignal): Promise<SearchableDocument[]> {
    const documents: SearchableDocument[] = [];
    for await (const batch of this.streamDocuments(signal)) {
      documents.push(...batch);
    }
    return signal?.aborted ? [] : documents;
  }

  async readDocument(path: string): Promise<SearchableDocument | null> {
    const target = this.app.vault.getAbstractFileByPath(path);
    if (!(target instanceof TFile) || !isSupportedCardFile(target)) {
      return null;
    }
    return this.prepare(target);
  }
}
