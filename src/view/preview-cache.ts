import { DEFAULT_PREVIEW_LINES, PREVIEW_LINES_MAX, PREVIEW_LINES_MIN } from "../settings";
import type { LightPreviewResult } from "./markdown-utils";

export const PREVIEW_CACHE_CAPACITY = 512;

export interface PreviewFingerprint {
  readonly path: string;
  readonly mtime: number;
  readonly previewLines: number;
  readonly maxVisibleChars: number;
}

interface PreviewCacheEntry extends PreviewFingerprint {
  readonly preview: LightPreviewResult;
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
): PreviewFingerprint {
  return { path, mtime, previewLines: normalizePreviewLines(previewLines), maxVisibleChars };
}

export function fingerprintsEqual(
  left: PreviewFingerprint,
  right: PreviewFingerprint,
): boolean {
  return left.path === right.path
    && left.mtime === right.mtime
    && left.previewLines === right.previewLines
    && left.maxVisibleChars === right.maxVisibleChars;
}

export class PreviewCache {
  private readonly entries = new Map<string, PreviewCacheEntry>();

  get size(): number {
    return this.entries.size;
  }

  get(fingerprint: PreviewFingerprint): LightPreviewResult | undefined {
    const entry = this.entries.get(fingerprint.path);
    if (!entry || !fingerprintsEqual(entry, fingerprint)) return undefined;
    this.entries.delete(fingerprint.path);
    this.entries.set(fingerprint.path, entry);
    return entry.preview;
  }

  set(fingerprint: PreviewFingerprint, preview: LightPreviewResult): void {
    this.entries.delete(fingerprint.path);
    this.entries.set(fingerprint.path, { ...fingerprint, preview });
    if (this.entries.size > PREVIEW_CACHE_CAPACITY) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  invalidateExact(path: string): void {
    this.entries.delete(path);
  }

  invalidatePrefix(prefix: string): void {
    for (const path of this.entries.keys()) {
      if (path === prefix || path.startsWith(`${prefix}/`)) this.entries.delete(path);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
