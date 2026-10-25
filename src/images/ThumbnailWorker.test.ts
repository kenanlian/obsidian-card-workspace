import { DESKTOP_RESOURCE_BUDGET } from "../runtime/resource-budget";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThumbnailService } from "./ThumbnailService";
import { ThumbnailWorker } from "./ThumbnailWorker";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("Worker lifecycle", () => {
  it("releases the decoder Worker after a completed cold task", async () => {
    const terminate = vi.fn(), workers: Array<{ onmessage?: (event: { data: unknown }) => void }> = [];
    vi.stubGlobal("URL", { createObjectURL: () => "blob:worker", revokeObjectURL: vi.fn() });
    vi.stubGlobal("OffscreenCanvas", class {}); vi.stubGlobal("createImageBitmap", vi.fn());
    vi.stubGlobal("Worker", class { terminate = terminate; constructor() { workers.push(this); } postMessage() {} onmessage?: (event: { data: unknown }) => void; });
    const worker = new ThumbnailWorker();
    const first = worker.generate(new ArrayBuffer(12), vi.fn());
    workers[0].onmessage?.({ data: { status: "ready", blob: new Blob(["thumb"]) } });
    expect((await first).status).toBe("ready"); expect(terminate).toHaveBeenCalledOnce();
    expect(worker.available()).toBe(true); expect(workers).toHaveLength(2);
    worker.dispose(); expect(terminate).toHaveBeenCalledTimes(2);
  });
  it("does not read an original when Worker construction is unavailable", async () => {
    vi.stubGlobal("OffscreenCanvas", class {}); vi.stubGlobal("createImageBitmap", vi.fn());
    vi.stubGlobal("Worker", class { constructor() { throw new Error("blocked"); } });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:worker", revokeObjectURL: vi.fn() });
    const read = vi.fn(), service = new ThumbnailService({ read, isCurrent: () => true,
      storage: { get: async () => null, put: async () => undefined, close: vi.fn() }, generator: new ThumbnailWorker() });
    expect(await service.request({ vault: "v", path: "a.png", mtime: 1, size: 100, version: 1 }, { signal: new AbortController().signal, canGenerate: () => true, onEligible: vi.fn() })).toEqual({ status: "skipped" });
    expect(read).not.toHaveBeenCalled(); service.dispose();
  });

  it("creates lazily, transfers the original buffer and terminates hung work after ten seconds", async () => {
    vi.useFakeTimers();
    const terminate = vi.fn(), postMessage = vi.fn(), createObjectURL = vi.fn(() => "blob:worker"), revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    vi.stubGlobal("OffscreenCanvas", class {}); vi.stubGlobal("createImageBitmap", vi.fn());
    vi.stubGlobal("Worker", class { terminate = terminate; postMessage = postMessage; });
    const worker = new ThumbnailWorker(); expect(createObjectURL).not.toHaveBeenCalled();
    const buffer = new ArrayBuffer(100), pending = worker.generate(buffer, vi.fn());
    expect(postMessage).toHaveBeenCalledWith({ buffer, budget: DESKTOP_RESOURCE_BUDGET.image }, [buffer]); expect(revokeObjectURL).toHaveBeenCalledWith("blob:worker");
    await vi.advanceTimersByTimeAsync(10_000); expect(await pending).toEqual({ status: "skipped" }); expect(terminate).toHaveBeenCalledOnce();
    worker.dispose();
  });
});
