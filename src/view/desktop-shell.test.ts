import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const openPath = vi.fn(async (_path: string) => "");
  const showItemInFolder = vi.fn();
  let isDesktopApp = true;
  let getFullPath = vi.fn((path: string) => `/vault/${path}`);

  return {
    openPath,
    showItemInFolder,
    get isDesktopApp(): boolean {
      return isDesktopApp;
    },
    set isDesktopApp(value: boolean) {
      isDesktopApp = value;
    },
    getFullPath: () => getFullPath,
    setGetFullPath: (next: typeof getFullPath) => {
      getFullPath = next;
    },
  };
});

vi.mock("obsidian", () => ({
  Platform: {
    get isDesktopApp(): boolean {
      return mockState.isDesktopApp;
    },
  },
}));

vi.mock("electron", () => ({
  shell: {
    openPath: mockState.openPath,
    showItemInFolder: mockState.showItemInFolder,
  },
}));

import { canResolveSystemPath, getSystemPath, openInDefaultApp, showInSystemExplorer } from "./desktop-shell";

type MockApp = {
  vault: {
    adapter: {
      getFullPath?: (path: string) => string;
    };
  };
};

function createApp(): MockApp {
  return {
    vault: {
      adapter: {
        getFullPath: mockState.getFullPath(),
      },
    },
  };
}

describe("desktop-shell", () => {
  beforeEach(() => {
    mockState.isDesktopApp = true;
    mockState.setGetFullPath(vi.fn((path: string) => `/vault/${path}`));
    mockState.openPath.mockReset();
    mockState.openPath.mockResolvedValue("");
    mockState.showItemInFolder.mockReset();
  });

  it("openInDefaultApp resolves the system path and calls shell.openPath", async () => {
    const app = createApp();

    await expect(openInDefaultApp(app as never, "notes/example.md")).resolves.toEqual({
      ok: true,
    });

    expect(canResolveSystemPath(app as never)).toBe(true);
    expect(getSystemPath(app as never, "notes/example.md")).toBe("/vault/notes/example.md");
    expect(mockState.openPath).toHaveBeenCalledTimes(1);
    expect(mockState.openPath).toHaveBeenCalledWith("/vault/notes/example.md");
    expect(mockState.showItemInFolder).not.toHaveBeenCalled();
  });

  it("returns a failure result when desktop shell support is unavailable", async () => {
    mockState.isDesktopApp = false;
    const app = createApp();

    await expect(openInDefaultApp(app as never, "notes/example.md")).resolves.toEqual({
      ok: false,
      error: "Desktop shell support is unavailable.",
    });

    await expect(showInSystemExplorer(app as never, "notes/example.md")).resolves.toEqual({
      ok: false,
      error: "Desktop shell support is unavailable.",
    });
    expect(canResolveSystemPath(app as never)).toBe(false);
    expect(getSystemPath(app as never, "notes/example.md")).toBeNull();
    expect(mockState.openPath).not.toHaveBeenCalled();
    expect(mockState.showItemInFolder).not.toHaveBeenCalled();
  });

  it("openInDefaultApp returns a failure result when shell.openPath returns an error string", async () => {
    const app = createApp();
    mockState.openPath.mockResolvedValueOnce("permission denied");

    await expect(openInDefaultApp(app as never, "notes/example.md")).resolves.toEqual({
      ok: false,
      error: "permission denied",
    });

    expect(mockState.openPath).toHaveBeenCalledTimes(1);
    expect(mockState.openPath).toHaveBeenCalledWith("/vault/notes/example.md");
  });

  it("maps thrown non-Error values to Unknown error", async () => {
    const app = createApp();
    mockState.openPath.mockRejectedValueOnce({ code: "EACCES" });

    await expect(openInDefaultApp(app as never, "notes/example.md")).resolves.toEqual({
      ok: false,
      error: "Unknown error",
    });
  });

  it("returns null/unavailable behavior when getFullPath throws or returns blank", async () => {
    mockState.setGetFullPath(vi.fn(() => {
      throw new Error("adapter unavailable");
    }));
    const throwingPathApp = createApp();

    expect(getSystemPath(throwingPathApp as never, "notes/example.md")).toBeNull();
    await expect(openInDefaultApp(throwingPathApp as never, "notes/example.md")).resolves.toEqual({
      ok: false,
      error: "Desktop shell support is unavailable.",
    });

    mockState.setGetFullPath(vi.fn(() => "   "));
    const blankPathApp = createApp();

    expect(getSystemPath(blankPathApp as never, "notes/example.md")).toBeNull();
    await expect(showInSystemExplorer(blankPathApp as never, "notes/example.md")).resolves.toEqual({
      ok: false,
      error: "Desktop shell support is unavailable.",
    });

    expect(mockState.openPath).not.toHaveBeenCalled();
    expect(mockState.showItemInFolder).not.toHaveBeenCalled();
  });
});
