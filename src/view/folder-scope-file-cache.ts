import type { TFile } from "obsidian";

/** Per-view LRU of sorted folder candidates. Records and previews are never retained. */
export class FolderScopeFileCache {
  private readonly entries = new Map<string, readonly TFile[]>();

  constructor(private readonly limit = 3) {}

  get(key: string): readonly TFile[] | null {
    const files = this.entries.get(key);
    if (!files) return null;
    this.entries.delete(key);
    this.entries.set(key, files);
    return files;
  }

  set(key: string, files: readonly TFile[]): void {
    this.entries.delete(key);
    this.entries.set(key, [...files]);
    if (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  delete(key: string): void { this.entries.delete(key); }
  clear(): void { this.entries.clear(); }
}
