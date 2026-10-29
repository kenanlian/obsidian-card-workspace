import type { DefaultCardOpenBehavior } from "../settings";

/** Platform support, not a promise that optional host bridges are available. */
export interface RuntimeCapabilities {
  readonly systemPath: boolean;
  readonly systemFileManager: boolean;
  readonly newWindow: boolean;
  readonly quickInput: boolean;
  readonly globalShortcut: boolean;
  readonly nativeFileDrag: boolean;
  readonly editorDrop: boolean;
}

export function resolveRuntimeCapabilities(desktop: boolean): Readonly<RuntimeCapabilities> {
  return Object.freeze({ systemPath: desktop, systemFileManager: desktop,
    newWindow: desktop, quickInput: desktop, globalShortcut: desktop,
    nativeFileDrag: desktop, editorDrop: desktop });
}

export const UNSUPPORTED_CAPABILITIES = resolveRuntimeCapabilities(false);

/** Runtime preference only: never rewrite the user's persisted choice. */
export function resolveRuntimeOpenBehavior(
  value: DefaultCardOpenBehavior, capabilities: RuntimeCapabilities,
): DefaultCardOpenBehavior {
  return value === "new-window" && !capabilities.newWindow ? "smart" : value;
}
