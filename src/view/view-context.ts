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
  getApp: () => App;
  store: ViewStateStore;
  epochs: ViewEpochs;
  getSettings: () => PluginSettings;
  saveSettings: (patch: PartialPluginSettings) => Promise<void>;
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
