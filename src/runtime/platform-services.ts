import { Platform, type App } from "obsidian";
import { createQuickInputDesktop } from "../input/quick-input-desktop";
import { getSystemPath, openInDefaultApp, showInSystemExplorer } from "../view/desktop-shell";
import { resolveRuntimeCapabilities } from "./capabilities";
import type { RuntimePlatformServices } from "./platform";

/** Composition boundary. Importing adapters does not resolve any native module. */
export function createRuntimePlatformServices(getApp: () => App, win: Window): RuntimePlatformServices {
  const device = Platform.isDesktopApp ? "desktop" : Platform.isTablet ? "tablet" : "phone";
  const capabilities = resolveRuntimeCapabilities(Platform.isDesktopApp);
  const unavailable = { outcome: "unavailable", reason: "platform" } as const;
  let desktop: ReturnType<typeof createQuickInputDesktop> | null = null;
  return Object.freeze({
    device,
    quickInputPresentation: device === "desktop" ? "window" : "modal",
    navigateBack(leaf) {
      // Optional host bridge; the public View state contract remains usable without it.
      const history = (leaf as unknown as { history?: { back?: () => void } }).history;
      if (typeof history?.back !== "function") return { outcome: "unavailable", reason: "host" } as const;
      history.back();
      return { outcome: "ok", value: undefined } as const;
    },
    capabilities: Object.freeze({ ...capabilities, quickInput: true }),
    systemPath: (path: string) => capabilities.systemPath ? getSystemPath(getApp(), path) : null,
    reveal: (path, strings) => capabilities.systemFileManager ? showInSystemExplorer(getApp(), path, strings)
      : Promise.resolve({ ok: false, error: strings.unavailable }),
    openExternal: (path, strings) => capabilities.systemFileManager ? openInDefaultApp(getApp(), path, strings)
      : Promise.resolve({ ok: false, error: strings.unavailable }),
    async openWindow() {
      if (!capabilities.newWindow) return unavailable;
      const workspace = getApp().workspace as unknown as { openPopoutLeaf?: () => import("obsidian").WorkspaceLeaf | Promise<import("obsidian").WorkspaceLeaf> };
      if (!workspace.openPopoutLeaf) return { outcome: "unavailable", reason: "host" } as const;
      return { outcome: "ok", value: await workspace.openPopoutLeaf() } as const;
    },
    quickInputDesktop() {
      if (device !== "desktop") return unavailable;
      desktop ??= createQuickInputDesktop(win);
      return { outcome: "ok", value: desktop } as const;
    },
  } satisfies RuntimePlatformServices);
}
