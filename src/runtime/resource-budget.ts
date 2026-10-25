/** Internal policy. Never persisted or used as a search compatibility version. */
export interface RuntimeResourceBudget {
  readonly preview: Readonly<{ concurrency: number; startupCards: number; startupWaitMs: number; entries: number; diagramBytes: number }>;
  readonly searchPreview: Readonly<{ entries: number; bytes: number }>;
  readonly search: Readonly<{ readers: number; batchSize: number; ingestTerms: number }>;
  readonly thumbnails: Readonly<{ memoryEntries: number; memoryBytes: number; diskEntries: number; diskBytes: number }>;
  readonly image: Readonly<{ maxBytes: number; maxPixels: number; maxEdge: number; coldTasks: 1 }>;
}

export const DESKTOP_RESOURCE_BUDGET: RuntimeResourceBudget = Object.freeze({
  preview: Object.freeze({ concurrency: 5, startupCards: 6, startupWaitMs: 120, entries: 512, diagramBytes: 16 * 1024 * 1024 }),
  searchPreview: Object.freeze({ entries: 64, bytes: 16 * 1024 * 1024 }),
  search: Object.freeze({ readers: 8, batchSize: 200, ingestTerms: 20_000 }),
  thumbnails: Object.freeze({ memoryEntries: 64, memoryBytes: 16 * 1024 * 1024, diskEntries: 2000, diskBytes: 256 * 1024 * 1024 }),
  image: Object.freeze({ maxBytes: 50_000_000, maxPixels: 50_000_000, maxEdge: 1024, coldTasks: 1 as const }),
});

/** Validated and deeply frozen so a retained caller object cannot change policy. */
export function createRuntimeResourceBudget(overrides: {
  [K in keyof RuntimeResourceBudget]?: Partial<RuntimeResourceBudget[K]>;
} = {}): RuntimeResourceBudget {
  const result = { ...DESKTOP_RESOURCE_BUDGET };
  for (const key of Object.keys(result) as Array<keyof RuntimeResourceBudget>) {
    const group = { ...result[key], ...overrides[key] };
    for (const value of Object.values(group)) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("Resource budgets must be positive safe integers");
    }
    if (key === "image" && "coldTasks" in group && group.coldTasks !== 1) throw new RangeError("Only one cold image task is supported");
    Object.assign(result, { [key]: Object.freeze(group) });
  }
  return Object.freeze(result);
}
