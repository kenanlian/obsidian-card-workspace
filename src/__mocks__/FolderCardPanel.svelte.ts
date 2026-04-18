// Vitest mock for FolderCardPanel.svelte dynamic import in FolderCardView.onOpen()
// Captures callback-prop wiring and records panel-model snapshots for assertions.
const mockState = (globalThis as any).__mockState || {};

interface PanelModelLike {
  subscribe: (listener: (state: unknown) => void) => () => void;
}

interface PanelProps {
  panelModel?: PanelModelLike;
  onOpenNote?: (payload: unknown) => void;
  onBulkSelectCard?: (payload: unknown) => void;
  onCardContextMenu?: (payload: unknown) => void;
  onPinToggle?: (payload: unknown) => void;
  onToolbarAction?: (payload: unknown) => void;
  onSortChange?: (payload: unknown) => void;
  onFilterChange?: (payload: unknown) => void;
  onIncludeSubfoldersChange?: (payload: unknown) => void;
  onSelectFolder?: (payload: unknown) => void;
  onHydrateRange?: (payload: unknown) => void;
}

interface PanelMountOptions {
  props?: PanelProps;
}

interface MockMountedPanel {
  teardown: () => void;
}

const CALLBACK_PROP_TO_EVENT: Record<string, string> = {
  onOpenNote: "open-note",
  onBulkSelectCard: "bulk-select-card",
  onCardContextMenu: "card-context-menu",
  onPinToggle: "pin-toggle",
  onToolbarAction: "toolbar-action",
  onSortChange: "sort-change",
  onFilterChange: "filter-change",
  onIncludeSubfoldersChange: "include-subfolders-change",
  onSelectFolder: "select-folder",
  onHydrateRange: "hydrate-range",
};

function createMountedPanel(options: PanelMountOptions = {}): MockMountedPanel {
  const panelModel = options.props?.panelModel;
  let unsubscribeModel: (() => void) | null = null;

  if (panelModel && typeof panelModel.subscribe === "function") {
    unsubscribeModel = panelModel.subscribe((state: unknown) => {
      (mockState.panelSnapshots ||= []).push(state);
    });
  }

  if (!mockState.panelEventHandlers) {
    mockState.panelEventHandlers = {};
  }

  const callbacks = options.props ?? {};
  for (const [callbackPropName, eventName] of Object.entries(CALLBACK_PROP_TO_EVENT)) {
    const callback = (callbacks as Record<string, unknown>)[callbackPropName];
    if (typeof callback !== "function") {
      continue;
    }

    mockState.panelEventHandlers[eventName] = (event: any) => {
      callback(event?.detail ?? event);
    };
  }

  return {
    teardown: () => {
      unsubscribeModel?.();
      unsubscribeModel = null;
    },
  };
}

export default function MockFolderCardPanel(options: PanelMountOptions = {}): MockMountedPanel {
  return createMountedPanel(options);
}
