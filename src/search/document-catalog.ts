import type { IndexStoreDocumentCatalog } from "./index-record";

/**
 * Vault-relative path to `TFile.stat.mtime` for every indexed document. Kept in
 * lockstep with the index so a reconcile can tell whether the vault changed
 * without reading a single file.
 */
export class SearchDocumentCatalog {
  private readonly entries = new Map<string, number>();

  get size(): number {
    return this.entries.size;
  }

  set(path: string, mtime: number): void {
    this.entries.set(path, mtime);
  }

  delete(path: string): void {
    this.entries.delete(path);
  }

  rename(oldPath: string, newPath: string): void {
    const mtime = this.entries.get(oldPath);
    if (mtime === undefined) {
      return;
    }
    this.entries.delete(oldPath);
    this.entries.set(newPath, mtime);
  }

  clear(): void {
    this.entries.clear();
  }

  replaceAll(entries: Iterable<readonly [string, number]>): void {
    this.entries.clear();
    for (const [path, mtime] of entries) {
      this.entries.set(path, mtime);
    }
  }

  loadFrom(catalog: IndexStoreDocumentCatalog): void {
    this.entries.clear();
    for (const [path, mtime] of Object.entries(catalog)) {
      this.entries.set(path, mtime);
    }
  }

  toSerializable(): IndexStoreDocumentCatalog {
    const catalog: IndexStoreDocumentCatalog = {};
    for (const [path, mtime] of this.entries) {
      catalog[path] = mtime;
    }
    return catalog;
  }

  /**
   * Equal entry count, then a strict per-entry mtime comparison with an early
   * exit. This runs on every reconcile over a map that can hold six-figure
   * entry counts, so it walks the live map rather than materializing a copy;
   * `toSerializable` is reserved for the persistence path.
   */
  matches(snapshot: IndexStoreDocumentCatalog): boolean {
    if (Object.keys(snapshot).length !== this.entries.size) {
      return false;
    }
    for (const [path, mtime] of this.entries) {
      if (snapshot[path] !== mtime) {
        return false;
      }
    }
    return true;
  }
}
