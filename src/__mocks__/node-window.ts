import { beforeEach, vi } from "vitest";

// Production cooperative tasks use the main-window timer APIs. Node has no DOM.
beforeEach(() => {
  vi.stubGlobal("window", globalThis);
});
