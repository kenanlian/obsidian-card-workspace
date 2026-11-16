import type { App } from "obsidian";
import type { UiStrings } from "../i18n";
import type { PartialPluginSettings, PluginSettings } from "../settings";
import type { PanelGroup } from "./panel-model";
import type { RefreshReason } from "./types";
import type { ViewUpdateIntent } from "./update-intent";
import type { ViewEpochs } from "./view-epochs";
import type { ViewStateStore } from "./view-state-store";

/** The only host capabilities controllers and actions may access. */
export interface ViewContext {
  /** Present only for independently owned desktop streams. */
  browse?: {
    get(): import("./stream-browse-state").StreamBrowseState;
    update(patch: Partial<import("./stream-browse-state").StreamBrowseState>): void;
    /** Reset source defaults while retaining filters until the complete scope commit. */
    reset(scope: import("./scope").CardScope): void;
  };
  /** Desktop streams retain a missing source identity so the host can show a recovery surface. */
  onMissingScope?: (scope: import("./scope").CardScope) => void;
  workGate?: import("../runtime/work-gate").RuntimeWorkGate;
  resourceBudget?: import("../runtime/resource-budget").RuntimeResourceBudget;
  runtimePlatform?: import("../runtime/platform").RuntimePlatformServices;
  getApp: () => App;
  store: ViewStateStore;
  epochs: ViewEpochs;
  waitForSettings?: () => Promise<void>;
  flushSettings?: () => Promise<void>;
  getSettings: () => PluginSettings;
  /** Settings memory updates synchronously; a scope commit can publish its own view update. */
  saveSettings: (patch: PartialPluginSettings, options?: { skipViewUpdate: boolean }) => Promise<void>;
  getUiStrings: () => UiStrings;
  publishGroups: (...groups: PanelGroup[]) => void;
  requestUpdate: (intent: ViewUpdateIntent, reason: RefreshReason) => Promise<void>;
  notify: (message: string) => void;
  /** Timers use the view window so component tests can control them. */
  getViewWindow: () => Pick<Window, "setTimeout" | "clearTimeout">;
}

export interface DisposableController {
  dispose(): DisposeReport;
}

export interface DisposeReport {
  cancelledDebounce?: boolean;
  clearedQueuedRequest?: boolean;
  clearedPendingHydration?: boolean;
}
