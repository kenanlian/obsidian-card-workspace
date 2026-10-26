export const IMAGE_MAX_BYTES = 50_000_000;
export const SVG_MAX_BYTES = 512 * 1024;
export function maxImageBytes(path: string): number { return /\.svg$/i.test(path) ? SVG_MAX_BYTES : IMAGE_MAX_BYTES; }
export const IMAGE_MAX_PIXELS = 50_000_000;
export const THUMBNAIL_VERSION = 2;
export const THUMBNAIL_MAX_EDGE = 1024;
export const MEMORY_MAX_ENTRIES = 64;
export const MEMORY_MAX_BYTES = 16 * 1024 * 1024;
export const DISK_MAX_ENTRIES = 2000;
export const DISK_MAX_BYTES = 256 * 1024 * 1024;
export interface ImageFingerprint {
  vault: string;
  path: string;
  mtime: number;
  size: number;
  version: number;
}
export function imageKey(fingerprint: ImageFingerprint): string {
  return JSON.stringify([fingerprint.vault, fingerprint.path, fingerprint.mtime, fingerprint.size, fingerprint.version]);
}
export type ThumbnailResult = { status: "ready"; blob: Blob } | { status: "failed" | "skipped" };
export type CardImageState = { status: "loading" | "failed" } | { status: "ready"; url: string; truncated?: boolean } | { status: "diagram"; reason: "empty" | "missing" | "invalid" | "oversized" };
export interface ThumbnailGenerator {
  available(): boolean;
  generate(buffer: ArrayBuffer, onEligible: () => void): Promise<ThumbnailResult>;
  dispose(): void;
}
export interface ThumbnailStorage {
  get(key: string): Promise<Blob | null>;
  put(key: string, blob: Blob): Promise<void>;
  invalidate?(paths: readonly string[], prefix: boolean): Promise<void>;
  touch?(key: string): Promise<void>;
  close(): void;
}
