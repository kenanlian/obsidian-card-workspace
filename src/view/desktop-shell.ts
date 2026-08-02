// Static import so esbuild emits CJS `require("electron")`.
// Dynamic `import("electron")` fails at runtime with a bare-specifier error.
import { shell as rendererShell } from "electron";
import { Platform } from "obsidian";
import { getUiStrings, type DesktopShellStrings } from "../i18n";

export interface DesktopShellFailure {
  ok: false;
  error: string;
}

export interface DesktopShellSuccess {
  ok: true;
}

export type DesktopShellResult = DesktopShellSuccess | DesktopShellFailure;

interface DesktopShell {
  openPath: (path: string) => Promise<string>;
  showItemInFolder: (path: string) => void;
}

interface ElectronBridge {
  remote?: {
    shell?: DesktopShell;
  };
  shell?: DesktopShell;
}

interface FileSystemAdapterLike {
  getFullPath?: (path: string) => string;
}

/**
 * `adapter` stays `unknown` so the real Obsidian `App` (whose `DataAdapter` only
 * exposes `getFullPath` on the desktop `FileSystemAdapter` subtype) is accepted.
 */
interface AppLike {
  vault: {
    adapter: unknown;
  };
}

function getPathAdapter(app: AppLike): FileSystemAdapterLike {
  return app.vault.adapter as FileSystemAdapterLike;
}

function getErrorMessage(error: unknown, strings: DesktopShellStrings): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return strings.unknownError;
}

function isDesktopShell(value: unknown): value is DesktopShell {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as DesktopShell;
  return typeof candidate.openPath === "function" && typeof candidate.showItemInFolder === "function";
}

/**
 * Prefer Obsidian's main-process `window.electron.remote.shell`.
 * Renderer `shell.showItemInFolder` often opens Explorer behind Obsidian on Windows
 * because background processes cannot steal foreground focus.
 */
function getDesktopShell(): DesktopShell {
  const bridge = (globalThis as typeof globalThis & { electron?: ElectronBridge }).electron;
  if (isDesktopShell(bridge?.remote?.shell)) {
    return bridge.remote.shell;
  }

  return rendererShell;
}

export function canResolveSystemPath(app: AppLike): boolean {
  return Platform.isDesktopApp && typeof getPathAdapter(app).getFullPath === "function";
}

export function getSystemPath(app: AppLike, filePath: string): string | null {
  if (!canResolveSystemPath(app)) {
    return null;
  }

  try {
    const systemPath = getPathAdapter(app).getFullPath?.(filePath) ?? null;
    return typeof systemPath === "string" && systemPath.trim().length > 0 ? systemPath : null;
  } catch {
    return null;
  }
}

export async function openInDefaultApp(
  app: AppLike,
  filePath: string,
  strings: DesktopShellStrings = getUiStrings("en").desktopShell,
): Promise<DesktopShellResult> {
  const systemPath = getSystemPath(app, filePath);
  if (!systemPath) {
    return {
      ok: false,
      error: strings.unavailable,
    };
  }

  try {
    const error = await getDesktopShell().openPath(systemPath);
    if (typeof error === "string" && error.length > 0) {
      return {
        ok: false,
        error,
      };
    }

    return {
      ok: true,
    };
  } catch (error) {
    return {
      ok: false,
      error: getErrorMessage(error, strings),
    };
  }
}

export async function showInSystemExplorer(
  app: AppLike,
  filePath: string,
  strings: DesktopShellStrings = getUiStrings("en").desktopShell,
): Promise<DesktopShellResult> {
  const systemPath = getSystemPath(app, filePath);
  if (!systemPath) {
    return {
      ok: false,
      error: strings.unavailable,
    };
  }

  try {
    getDesktopShell().showItemInFolder(systemPath);
    return {
      ok: true,
    };
  } catch (error) {
    return {
      ok: false,
      error: getErrorMessage(error, strings),
    };
  }
}
