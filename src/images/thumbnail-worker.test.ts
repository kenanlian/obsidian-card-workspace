import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThumbnailResult } from "./types";

const generate = vi.hoisted(() => vi.fn());
vi.mock("./thumbnail-render", () => ({ generateThumbnail: generate }));

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); generate.mockReset(); });

describe("thumbnail Worker message handling", () => {
  async function workerScope() {
    const scope = { onmessage: (_event: MessageEvent<ArrayBuffer>): void => {}, postMessage: vi.fn() };
    vi.stubGlobal("self", scope);
    vi.stubGlobal("window", undefined);
    await import("./thumbnail-worker");
    return scope;
  }

  it("publishes eligibility and the generated thumbnail without a window", async () => {
    const result: ThumbnailResult = { status: "ready", blob: new Blob(["thumb"]) };
    generate.mockImplementation(async (_buffer: ArrayBuffer, onEligible: () => void) => { onEligible(); return result; });
    const scope = await workerScope();
    const buffer = new ArrayBuffer(8);
    expect(scope.onmessage({ data: buffer } as MessageEvent<ArrayBuffer>)).toBeUndefined();
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledWith(result));
    expect(generate).toHaveBeenCalledWith(buffer, expect.any(Function));
    expect(scope.postMessage).toHaveBeenNthCalledWith(1, { status: "eligible" });
  });

  it("reports an unexpected async failure to the owner", async () => {
    generate.mockRejectedValue(new Error("unexpected failure"));
    const scope = await workerScope();
    scope.onmessage({ data: new ArrayBuffer(8) } as MessageEvent<ArrayBuffer>);
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledExactlyOnceWith({ status: "failed" }));
  });
});
