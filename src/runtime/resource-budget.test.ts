import { RuntimeWorkGate } from "./work-gate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeResourceBudget, DESKTOP_RESOURCE_BUDGET } from "./resource-budget";
import { PreviewCache, createPreviewFingerprint } from "../view/preview-cache";
import { readImageHeader, thumbnailDimensions } from "../images/image-header";
import { ThumbnailService } from "../images/ThumbnailService";
import { addDocumentsWithYield } from "../search/index-ingest";

afterEach(() => { vi.useRealTimers(); });

describe("internal resource budgets", () => {
  it("copies, validates and freezes every group", () => {
    const preview = { concurrency: 1 };
    const budget = createRuntimeResourceBudget({ preview }); preview.concurrency = 9;
    expect(budget.preview.concurrency).toBe(1);
    expect(Object.isFrozen(budget)).toBe(true);
    expect(Object.values(budget).every(Object.isFrozen)).toBe(true);
    expect(DESKTOP_RESOURCE_BUDGET.preview.concurrency).toBe(5);
    expect(() => createRuntimeResourceBudget({ search: { batchSize: 0 } })).toThrow(RangeError);
  });

  it("evicts diagram blobs against the injected byte and entry caps", () => {
    const cache = new PreviewCache(2, 5);
    const put = (path: string, size: number) => cache.set(createPreviewFingerprint(path, 1, 5, 500, "diagram:"), {
      html: "", mode: "empty", diagramPreview: { status: "ready", truncated: false, blob: new Blob(["x".repeat(size)]) },
    });
    put("a", 3); put("b", 3);
    expect(cache.paths()).toEqual(["b"]); expect(cache.diagramBytes).toBe(3);
    put("c", 1); put("d", 1); expect(cache.paths()).toEqual(["c", "d"]);
  });

  it("applies the injected byte/pixel and output dimensions inside decoding", () => {
    const buffer = new ArrayBuffer(45), v = new DataView(buffer);
    v.setUint32(0, 0x89504e47); v.setUint32(4, 0x0d0a1a0a); v.setUint32(8, 13);
    new Uint8Array(buffer, 12, 4).set([73, 72, 68, 82]);
    v.setUint32(16, 10); v.setUint32(20, 10);
    new Uint8Array(buffer, 37, 4).set([73, 69, 78, 68]);
    const budget = createRuntimeResourceBudget({ image: { maxBytes: 100, maxPixels: 100, maxEdge: 4 } }).image;
    const header = readImageHeader(buffer, budget)!;
    expect(thumbnailDimensions(header, budget)).toEqual({ width: 4, height: 4 });
    expect(readImageHeader(buffer, { ...budget, maxPixels: 99 })).toBeNull();
    expect(readImageHeader(buffer, { ...budget, maxBytes: 44 })).toBeNull();
  });

  it("bounds plugin thumbnail memory and runs a single cold task with a low budget", async () => {
    vi.useFakeTimers();
    const budget = createRuntimeResourceBudget({ thumbnails: { memoryEntries: 2, memoryBytes: 5 } });
    let active = 0, peak = 0;
    const service = new ThumbnailService({ resourceBudget: budget, isCurrent: () => true,
      read: async () => new ArrayBuffer(1), storage: { get: async () => null, put: async () => {}, close: () => {} },
      generator: { available: () => true, dispose: () => {}, generate: async () => {
        active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return { status: "ready", blob: new Blob(["abc"]) };
      } },
    });
    const requests = ["a", "b", "c"].map(path => service.request({ vault: "v", path, mtime: 1, size: 1, version: 1 },
      { signal: new AbortController().signal, canGenerate: () => true, onEligible: () => {} }));
    await vi.runAllTimersAsync(); await Promise.all(requests);
    expect(peak).toBe(1); expect(service.getDiagnostics()).toMatchObject({ entries: 1, bytes: 3, jobs: 0 });
    service.dispose();
  });

  it("starts no cold thumbnail tasks while paused and releases pending demand on close", async () => {
    vi.useFakeTimers(); const gate = new RuntimeWorkGate(); gate.setActive(false);
    const available = vi.fn(() => true), read = vi.fn(async () => new ArrayBuffer(1));
    const service = new ThumbnailService({ workGate: gate, read, isCurrent: () => true,
      storage: { get: async () => null, put: async () => {}, close: () => {} },
      generator: { available, dispose: () => {}, generate: async () => ({ status: "ready", blob: new Blob(["x"]) }) },
    });
    const request = service.request({ vault: "v", path: "a", mtime: 1, size: 1, version: 1 },
      { signal: new AbortController().signal, canGenerate: () => true, onEligible: () => {} });
    await vi.runAllTimersAsync(); expect(available).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    gate.setActive(true); await vi.runAllTimersAsync(); expect((await request).status).toBe("ready");
    expect(read).toHaveBeenCalledOnce(); service.dispose(); gate.close();
  });

  it("uses a low ingest budget across batch boundaries in original order", async () => {
    const paths: string[] = [], index = { add: (doc: { path: string }) => paths.push(doc.path) };
    const timer = vi.spyOn(window, "setTimeout");
    const doc = (path: string) => ({ path, title: "a", content: "b" });
    const current = () => true;
    let carry = await addDocumentsWithYield(index as never, [doc("a")] as never, 0, current, undefined, 6);
    expect(carry).toBe(4);
    carry = await addDocumentsWithYield(index as never, [doc("b"), doc("c")] as never, carry, current, undefined, 6);
    expect(paths).toEqual(["a", "b", "c"]); expect(carry).toBe(4);
    expect(timer).toHaveBeenCalledOnce(); timer.mockRestore();
  });
});
