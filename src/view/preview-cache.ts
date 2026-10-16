import { DEFAULT_PREVIEW_LINES, PREVIEW_LINES_MAX, PREVIEW_LINES_MIN } from "../settings";
import type { LightPreviewResult } from "./markdown-utils";
import type { SearchPreview } from "../search";

export type CachedPreview = LightPreviewResult & { readonly diagramPreview?: import("./diagram-preview").DiagramPreviewResult; readonly searchPreview?: SearchPreview; readonly linkPreview?: import("./link-reference-preview").LinkReferencePreview };

export const PREVIEW_CACHE_CAPACITY = 512;
export const DIAGRAM_CACHE_MAX_BYTES = 16 * 1024 * 1024;

export interface PreviewFingerprint {
  readonly path: string;
  readonly mtime: number;
  readonly previewLines: number;
  readonly maxVisibleChars: number;
  readonly contextKey: string;
}

interface PreviewCacheValue { fingerprint: PreviewFingerprint; preview: CachedPreview }
interface PreviewCacheEntry {
  ordinary?: PreviewCacheValue;
  contextual?: PreviewCacheValue;
  diagram?: PreviewCacheValue;
}

export function normalizePreviewLines(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PREVIEW_LINES;
  return Math.min(PREVIEW_LINES_MAX, Math.max(PREVIEW_LINES_MIN, Math.round(value)));
}

export function createPreviewFingerprint(
  path: string,
  mtime: number,
  previewLines: number,
  maxVisibleChars: number,
  contextKey = "",
): PreviewFingerprint {
  return { path, mtime, previewLines: normalizePreviewLines(previewLines), maxVisibleChars, contextKey };
}

export function fingerprintsEqual(
  left: PreviewFingerprint,
  right: PreviewFingerprint,
): boolean {
  return left.path === right.path
    && left.mtime === right.mtime
    && left.previewLines === right.previewLines
    && left.maxVisibleChars === right.maxVisibleChars
    && left.contextKey === right.contextKey;
}

export class PreviewCache {
  private readonly entries = new Map<string, PreviewCacheEntry>();
  private blobBytes = 0;

  get size(): number {
    return this.entries.size;
  }

  hasPath(path: string): boolean {
    return this.entries.has(path);
  }

  get(fingerprint: PreviewFingerprint): CachedPreview | undefined {
    const entry = this.entries.get(fingerprint.path);
    const value = [entry?.ordinary, entry?.contextual, entry?.diagram].find((candidate) =>
      candidate && fingerprintsEqual(candidate.fingerprint, fingerprint));
    if (!entry || !value) return undefined;
    this.entries.delete(fingerprint.path);
    this.entries.set(fingerprint.path, entry);
    return value.preview;
  }

  set(fingerprint: PreviewFingerprint, preview: CachedPreview): void {
    const previous = this.entries.get(fingerprint.path);
    if (fingerprint.contextKey.startsWith("diagram:")) {
      this.replace(fingerprint.path, { ...previous, diagram: { fingerprint, preview } });
      this.evict();
      return;
    }
    // Both slots belong to the same file/settings version; only the contextual
    // slot is replaced when the query changes.
    const value = previous?.ordinary ?? previous?.contextual;
    const base = value?.fingerprint;
    const compatible = base && fingerprintsEqual(
      { ...base, contextKey: base.contextKey.match(/\|(?:file|live):.*$/)?.[0] ?? "" },
      { ...fingerprint, contextKey: fingerprint.contextKey.match(/\|(?:file|live):.*$/)?.[0] ?? "" });
    const entry: PreviewCacheEntry = compatible ? { ...previous } : { diagram: previous?.diagram };
    const slot = fingerprint.contextKey.startsWith("search:") || fingerprint.contextKey.startsWith("link:") || fingerprint.contextKey.includes("|links:")
      ? "contextual" : "ordinary";
    entry[slot] = { fingerprint, preview };
    this.replace(fingerprint.path, entry);
    this.evict();
  }

  paths(): string[] { return [...this.entries.keys()]; }

  get diagramBytes(): number { return this.blobBytes; }

  private entryBytes(entry?: PreviewCacheEntry): number {
    const result = entry?.diagram?.preview.diagramPreview;
    return result?.status === "ready" ? result.blob.size : 0;
  }
  private remove(path: string): void {
    this.blobBytes -= this.entryBytes(this.entries.get(path));
    this.entries.delete(path);
  }
  private replace(path: string, entry: PreviewCacheEntry): void {
    this.remove(path);
    this.entries.set(path, entry);
    this.blobBytes += this.entryBytes(entry);
  }

  private evict(): void {
    while (this.entries.size > PREVIEW_CACHE_CAPACITY || this.diagramBytes > DIAGRAM_CACHE_MAX_BYTES) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.remove(oldest.value);
    }
  }

  invalidateExact(path: string): void {
    this.remove(path);
  }

  invalidatePrefix(prefix: string): void {
    for (const path of this.entries.keys()) {
      if (path === prefix || path.startsWith(`${prefix}/`)) this.remove(path);
    }
  }

  clear(): void {
    this.entries.clear();
    this.blobBytes = 0;
  }
}
