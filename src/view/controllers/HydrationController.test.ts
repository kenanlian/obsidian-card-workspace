import { describe, expect, it, vi } from "vitest";
import { createFolderScope } from "../scope";
import type { ViewContext } from "../view-context";
import { createViewEpochs } from "../view-epochs";
import { createViewStateStore } from "../view-state-store";
import { HydrationController } from "./HydrationController";

function createContext(): ViewContext {
  return {
    getApp: vi.fn(),
    store: createViewStateStore(createFolderScope("", true)),
    epochs: createViewEpochs(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    getUiStrings: vi.fn(),
    publishGroups: vi.fn(),
    requestUpdate: vi.fn(),
    notify: vi.fn(),
    getViewWindow: () => window,
  } as unknown as ViewContext;
}

describe("HydrationController", () => {
  it("exposes the six-card startup budget", () => {
    expect(HydrationController.startupCardCount).toBe(6);
  });

  it("clears pending paths without invalidating the shared load token on dispose", () => {
    const context = createContext();
    const controller = new HydrationController({ context, isLoading: () => false });
    const token = context.epochs.load.token();
    controller.addPending("notes/pending.md");

    expect(controller.dispose()).toEqual({ clearedPendingHydration: true });
    expect(controller.hasPending("notes/pending.md")).toBe(false);
    expect(context.epochs.load.isCurrent(token)).toBe(true);
  });
});
