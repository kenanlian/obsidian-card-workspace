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

interface FileSystemAdapterLike {
  getFullPath?: (path: string) => string;
}

interface AppLike {
  vault: {
    adapter: FileSystemAdapterLike;
  };
}

function getPathAdapter(app: AppLike): FileSystemAdapterLike {
  return app.vault.adapter;
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

interface DesktopShell {
  openPath: (path: string) => Promise<string>;
  showItemInFolder: (path: string) => void;
}


async function loadShell(): Promise<DesktopShell> {
  const electronModule = await import("electron");
  return electronModule.shell;
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
    const shell = await loadShell();
    const error = await shell.openPath(systemPath);
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
    const shell = await loadShell();
    shell.showItemInFolder(systemPath);
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
