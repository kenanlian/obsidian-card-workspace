import { describe, expect, it, vi } from "vitest";
import { createFolderScope } from "../scope";
import type { ViewContext } from "../view-context";
import { createViewEpochs } from "../view-epochs";
import { createViewStateStore } from "../view-state-store";
import type { NoteCardRecord } from "../types";
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
    getViewWindow: () => globalThis,
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

  it("cancels the owned startup wait without a shared epoch bump or late publish", async () => {
    vi.useFakeTimers();
    const context = createContext();
    let resolveRead!: (markdown: string) => void;
    const read = new Promise<string>((resolve) => {
      resolveRead = resolve;
    });
    const card = {
      file: { path: "notes/startup.md" },
      fileKind: "markdown",
      path: "notes/startup.md",
      title: "startup",
      ctime: 1,
      mtime: 2,
      excerpt: "",
      previewHtml: "",
      previewMode: "empty",
      hydrated: false,
    } as NoteCardRecord;
    context.store.replaceBaseCards([card]);
    (context.getApp as ReturnType<typeof vi.fn>).mockReturnValue({
      vault: { cachedRead: () => read },
    });
    const controller = new HydrationController({ context, isLoading: () => false });
    const token = context.epochs.load.token();
    const startup = controller.hydrateStartupCardPaths([card.path], token);

    expect(controller.dispose()).toEqual({
      clearedPendingHydration: true,
      cancelledDebounce: true,
    });
    expect(context.epochs.load.isCurrent(token)).toBe(true);
    vi.runAllTimers();
    resolveRead("preview");
    await startup;
    await Promise.resolve();

    expect(context.publishGroups).not.toHaveBeenCalled();
    expect(card.hydrated).toBe(false);
    vi.useRealTimers();
  });

  it("does not strand rejected or stale scheduled paths as pending", async () => {
    const context = createContext();
    const controller = new HydrationController({ context, isLoading: () => false });
    controller.schedulePath("notes/missing.md");
    expect(controller.hasPending("notes/missing.md")).toBe(false);

    let resolveRead!: (markdown: string) => void;
    const read = new Promise<string>((resolve) => {
      resolveRead = resolve;
    });
    const card = {
      file: { path: "notes/stale.md" },
      fileKind: "markdown",
      path: "notes/stale.md",
      title: "stale",
      ctime: 1,
      mtime: 2,
      excerpt: "",
      previewHtml: "",
      previewMode: "empty",
      hydrated: false,
    } as NoteCardRecord;
    context.store.replaceBaseCards([card]);
    (context.getApp as ReturnType<typeof vi.fn>).mockReturnValue({
      vault: { cachedRead: () => read },
    });
    const token = context.epochs.load.token();
    const hydration = controller.hydrateCardPaths([card.path], token, { publish: true });
    expect(controller.hasPending(card.path)).toBe(true);
    context.epochs.load.bump();
    resolveRead("preview");
    await hydration;
    expect(controller.hasPending(card.path)).toBe(false);
  });
});
