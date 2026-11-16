import type { PanelModel } from "./panel-model";
import type { StreamUiStrings } from "./stream-ui-strings";
export interface StreamPanelEntry {
  id: string;
  title: string;
  sourceLabel: string;
  expanded: boolean;
  autoCollapsed: boolean;
  current: boolean;
  pending: boolean;
  error?: string;
  panelModel: PanelModel | null;
  props: Record<string, unknown>;
  weight: number;
  size?: number;
}
export interface StreamPanelState {
  entries: readonly StreamPanelEntry[];
  currentStreamId: string | null;
  direction: "horizontal" | "vertical";
  navigationVisible: boolean;
  singlePane: boolean;
  navPanelModel: PanelModel | null;
  navProps: Record<string, unknown>;
  labels: StreamUiStrings;
  recentlyClosedCount: number;
  unsupported: boolean;
}
export type StreamCommand = "show-only" | "tile" | "collapse" | "duplicate" | "rename" | "close" | "move-to-pane" | "copy-to-pane" | "manage";
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
