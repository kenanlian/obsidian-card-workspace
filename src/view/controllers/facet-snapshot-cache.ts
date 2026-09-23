import { scopeIdentity, type CardScope } from "../scope";

/** Bounded per-view snapshot cache. Reading an entry makes it the newest. */
export class FacetSnapshotCache<Value> {
  private readonly entries = new Map<string, Value>();

  constructor(private readonly limit: number) {}

  get(key: string): Value | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) this.set(key, value);
    return value;
  }

  set(key: string, value: Value): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.limit) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  retain(key: string): void {
    const value = this.entries.get(key);
    this.entries.clear();
    if (value !== undefined) this.entries.set(key, value);
  }
}

/** Scope identity keeps snapshots distinct even across transient load states. */
export function facetSourceKey(
  scope: CardScope,
  loadKey: string | null,
  baseCount: number,
  vaultRevision: number,
): string {
  return JSON.stringify([scopeIdentity(scope), loadKey, baseCount, vaultRevision]);
}

export interface ScopeTagData {
  availableTags: string[];
  tagCounts: Record<string, number>;
}

/** Value equality for a scope tag snapshot; available-tag order is significant. */
export function scopeTagDataEqual(left: ScopeTagData, right: ScopeTagData): boolean {
  if (left.availableTags.length !== right.availableTags.length
    || left.availableTags.some((tag, index) => tag !== right.availableTags[index])) {
    return false;
  }
  const leftKeys = Object.keys(left.tagCounts);
  const rightKeys = Object.keys(right.tagCounts);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => left.tagCounts[key] === right.tagCounts[key]);
}
