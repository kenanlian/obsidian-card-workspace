import { describe, expect, it, vi } from "vitest";
import { buildPanelProps, type PanelHost } from "./panel-props";

function createHost(): {
  host: PanelHost;
  arrangement: {
    onSortChange: ReturnType<typeof vi.fn>;
    onGroupChange: ReturnType<typeof vi.fn>;
    onGroupCollapseCommand: ReturnType<typeof vi.fn>;
    onPinToggle: ReturnType<typeof vi.fn>;
  };
} {
  const arrangement = {
    onSortChange: vi.fn(async () => undefined),
    onGroupChange: vi.fn(async () => undefined),
    onGroupCollapseCommand: vi.fn(),
    onPinToggle: vi.fn(async () => undefined),
  };
  const host = {
    panelModel: {},
    modules: {
      arrangementActions: arrangement,
      bulk: { isBulkMode: () => false, onBulkSelectCard: vi.fn() },
      cardMenu: { open: vi.fn() },
      hydration: { hydrateViewport: vi.fn() },
      tagActions: { onFilterChange: vi.fn() },
      propertyActions: { chooseVisibleProperties: vi.fn(), clearPropertyFilters: vi.fn() },
      search: { onQueryChange: vi.fn(), resetQuery: vi.fn() },
      boxActions: { handleBoxCommand: vi.fn() },
      favoriteActions: { handleFavoriteActivate: vi.fn() },
      navLayout: {
        onNavPaneResize: vi.fn(),
        onShellResize: vi.fn(),
        onToggleNavPane: vi.fn(),
        onToggleNavSection: vi.fn(),
      },
    },
    plugin: { openNoteFromCard: vi.fn(async () => undefined) },
    handleToolbarAction: vi.fn(),
    onIncludeSubfoldersChange: vi.fn(async () => undefined),
    onCardHoverLink: vi.fn(),
    selectFolderFromNav: vi.fn(async () => undefined),
    handleFolderActionRequest: vi.fn(),
    openNavContextMenu: vi.fn(),
    handleNavigationIntent: vi.fn(),
  } as unknown as PanelHost;
  return { host, arrangement };
}

describe("buildPanelProps arrangement routing", () => {
  it("routes sort/group/collapse/pin callbacks to ArrangementActions, not PanelHost methods", () => {
    const { host, arrangement } = createHost();
    const props = buildPanelProps(host) as unknown as {
      onSortChange: (detail: { field?: unknown; direction?: unknown }) => void;
      onGroupChange: (detail: { dimension?: unknown }) => void;
      onGroupCollapseCommand: (detail: { command?: unknown; key?: unknown }) => void;
      onPinToggle: (detail: { path?: unknown; pinned?: unknown }) => void;
    };

    expect("onSortChange" in host).toBe(false);
    expect("onGroupChange" in host).toBe(false);
    expect("onGroupCollapseCommand" in host).toBe(false);
    expect("onPinToggle" in host).toBe(false);

    const sort = { field: "name", direction: "asc" };
    const group = { dimension: "folder" };
    const collapse = { command: "toggle", key: "folder:notes" };
    const pin = { path: "notes/a.md", pinned: true };

    props.onSortChange(sort);
    props.onGroupChange(group);
    props.onGroupCollapseCommand(collapse);
    props.onPinToggle(pin);

    expect(arrangement.onSortChange).toHaveBeenCalledWith(sort);
    expect(arrangement.onGroupChange).toHaveBeenCalledWith(group);
    expect(arrangement.onGroupCollapseCommand).toHaveBeenCalledWith(collapse);
    expect(arrangement.onPinToggle).toHaveBeenCalledWith(pin);
  });
});
