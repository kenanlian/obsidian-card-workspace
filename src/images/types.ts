import { DESKTOP_RESOURCE_BUDGET } from "../runtime/resource-budget";
export const IMAGE_MAX_BYTES = DESKTOP_RESOURCE_BUDGET.image.maxBytes;
export const IMAGE_MAX_PIXELS = DESKTOP_RESOURCE_BUDGET.image.maxPixels;
export const SVG_MAX_BYTES = 512 * 1024;
export function maxImageBytes(path: string, budget = DESKTOP_RESOURCE_BUDGET.image): number { return /\.svg$/i.test(path) ? Math.min(SVG_MAX_BYTES, budget.maxBytes) : budget.maxBytes; }
export const THUMBNAIL_VERSION = 2;
export const THUMBNAIL_MAX_EDGE = DESKTOP_RESOURCE_BUDGET.image.maxEdge;
export const MEMORY_MAX_ENTRIES = DESKTOP_RESOURCE_BUDGET.thumbnails.memoryEntries;
export const MEMORY_MAX_BYTES = DESKTOP_RESOURCE_BUDGET.thumbnails.memoryBytes;
export const DISK_MAX_ENTRIES = DESKTOP_RESOURCE_BUDGET.thumbnails.diskEntries;
export const DISK_MAX_BYTES = DESKTOP_RESOURCE_BUDGET.thumbnails.diskBytes;
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
