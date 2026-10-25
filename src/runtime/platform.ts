import type { WorkspaceLeaf } from "obsidian";
import type { DesktopShellStrings } from "../i18n";
import type { QuickInputDesktop } from "../input/quick-input-desktop";
import { UNSUPPORTED_CAPABILITIES, type RuntimeCapabilities } from "./capabilities";

export type RuntimeUnavailable = { outcome: "unavailable"; reason: "platform" | "host" };
export type RuntimeActionResult<T = void> = { outcome: "ok"; value: T } | RuntimeUnavailable;
export interface RuntimePlatformServices {
  readonly capabilities: RuntimeCapabilities;
  systemPath(path: string): string | null;
  reveal(path: string, strings: DesktopShellStrings): Promise<{ ok: boolean; error?: string }>;
  openExternal(path: string, strings: DesktopShellStrings): Promise<{ ok: boolean; error?: string }>;
  openWindow(): Promise<RuntimeActionResult<WorkspaceLeaf>>;
  quickInputDesktop(): RuntimeActionResult<QuickInputDesktop>;
}

/** Fail closed for consumers constructed without platform injection. */
export const UNAVAILABLE_PLATFORM: RuntimePlatformServices = Object.freeze({
  capabilities: UNSUPPORTED_CAPABILITIES,
  systemPath: () => null,
  reveal: (_path: string, strings: DesktopShellStrings) => Promise.resolve({ ok: false, error: strings.unavailable }),
  openExternal: (_path: string, strings: DesktopShellStrings) => Promise.resolve({ ok: false, error: strings.unavailable }),
  openWindow: () => Promise.resolve({ outcome: "unavailable" as const, reason: "platform" as const }),
  quickInputDesktop: () => ({ outcome: "unavailable" as const, reason: "platform" as const }),
});
