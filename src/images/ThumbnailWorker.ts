import workerSource from "./thumbnail-worker-source";
import type { ThumbnailGenerator, ThumbnailResult } from "./types";
export class ThumbnailWorker implements ThumbnailGenerator {
  private worker: Worker | null = null;
  private finish: ((result: ThumbnailResult) => void) | null = null;
  private disabled = false;
  available(): boolean {
    if (this.disabled || typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return false;
    try {
      if (!this.worker) {
        const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
        try { this.worker = new Worker(url); } finally { URL.revokeObjectURL(url); }
        this.worker.onerror = () => { this.disabled = true; this.dispose(); };
      }
      return true;
    } catch { this.disabled = true; return false; }
  }
  generate(buffer: ArrayBuffer, onEligible: () => void): Promise<ThumbnailResult> {
    if (!this.available()) return Promise.resolve({ status: "skipped" });
    return new Promise((resolve) => {
      let eligible = false;
      const timer = window.setTimeout(() => { this.dispose(); }, 10_000);
      this.finish = (result) => {
        window.clearTimeout(timer); this.finish = null;
        // A decoder may retain native buffers after bitmap.close(). A cold
        // task owns its Worker so those buffers cannot survive into UI work.
        this.worker?.terminate(); this.worker = null;
        resolve(result.status === "failed" && !eligible ? { status: "skipped" } : result);
      };
      this.worker!.onmessage = (event: MessageEvent<ThumbnailResult | { status: "eligible" }>) => {
        if (event.data.status === "eligible") { eligible = true; onEligible(); }
        else this.finish?.(event.data);
      };
      this.worker!.onerror = () => {
        this.disabled = true;
        this.finish?.({ status: eligible ? "failed" : "skipped" });
        this.dispose();
      };
      try { this.worker!.postMessage(buffer, [buffer]); }
      catch { this.dispose(); }
    });
  }
  dispose(): void { this.worker?.terminate(); this.worker = null; this.finish?.({ status: "failed" }); }
}
