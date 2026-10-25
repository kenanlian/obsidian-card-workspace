import { Platform, type App } from "obsidian";
import { createQuickInputDesktop } from "../input/quick-input-desktop";
import { getSystemPath, openInDefaultApp, showInSystemExplorer } from "../view/desktop-shell";
import { resolveRuntimeCapabilities } from "./capabilities";
import type { RuntimePlatformServices } from "./platform";

/** Composition boundary. Importing adapters does not resolve any native module. */
export function createRuntimePlatformServices(getApp: () => App, win: Window): RuntimePlatformServices {
  const capabilities = resolveRuntimeCapabilities(Platform.isDesktopApp);
  const unavailable = { outcome: "unavailable", reason: "platform" } as const;
  let desktop: ReturnType<typeof createQuickInputDesktop> | null = null;
  return Object.freeze({
    capabilities,
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
      if (!capabilities.quickInput) return unavailable;
      desktop ??= createQuickInputDesktop(win);
      return { outcome: "ok", value: desktop } as const;
    },
  } satisfies RuntimePlatformServices);
}
