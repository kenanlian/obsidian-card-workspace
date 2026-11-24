import type { Tile } from "./stream-tiles";
import type { PanelModel } from "./panel-model";
import type { StreamUiStrings } from "./stream-ui-strings";
export interface StreamPanelEntry {
  id: string;
  /** Complete display title, used by spines and menus. */
  title: string;
  /** The user's name for the stream; toolbars otherwise show their scope label. */
  customTitle: string | null;
  /** Distinguishes unnamed streams over the same source. */
  ordinal: number | null;
  display: "stream" | "spine" | "hidden";
  current: boolean;
  pending: boolean;
  error?: string;
  panelModel: PanelModel | null;
  props: Record<string, unknown>;
}
export interface StreamPanelState {
  layout: Tile | null;
  entries: readonly StreamPanelEntry[];
  currentStreamId: string | null;
  maximizedStreamId: string | null;
  navigationVisible: boolean;
  singlePane: boolean;
  navPanelModel: PanelModel | null;
  navProps: Record<string, unknown>;
  labels: StreamUiStrings;
  recentlyClosedCount: number;
  unsupported: boolean;
}
/** Stream identity and controls rendered inside a stream's own toolbar. */
export interface StreamToolbarState {
  title: string | null;
  ordinal: number | null;
  closable: boolean;
  showNavToggle: boolean;
  switcherLabel: string;
  closeLabel: string;
}
export type StreamCommand = "menu" | "maximize" | "collapse" | "duplicate" | "rename" | "close"
  | "move-left" | "move-right" | "move-to-pane" | "copy-to-pane";
export interface StreamPanelModel {
  getState(): StreamPanelState;
  subscribe(listener: (state: StreamPanelState) => void): () => void;
  setState(next: StreamPanelState): void;
}
/** The host replaces complete snapshots; presentation never mutates stream state. */
export function createStreamPanelModel(initial: StreamPanelState): StreamPanelModel {
  let state = initial;
  const listeners = new Set<(state: StreamPanelState) => void>();
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => { listeners.delete(listener); };
    },
    setState(next) {
      state = next;
      for (const listener of listeners) listener(state);
    },
  };
}
