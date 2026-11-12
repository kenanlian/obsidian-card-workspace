<script lang="ts">
  import { Menu, setIcon, setTooltip } from "obsidian";
  import { tick, untrack } from "svelte";
  import type { RuntimeDevice } from "../runtime/platform";
  import type { AttachSearchHistorySuggest, SearchHistorySuggestHandle } from "./search-history-suggest";
  import { DEFAULT_GROUP_SPEC, type GroupSpec } from "../card-grouping-settings";
  import { getUiStrings, type ToolbarStrings, type UiStrings } from "../i18n";
  import { BULK_ADD_TO_BOX_ICON, BULK_REMOVE_FROM_BOX_ICON } from "../icons";
  import type { SortDirection, LinksSortField } from "../settings";
  import type {
    BoxSummary,
    PanelProjectionState,
    PanelScopeState,
    PanelSearchState,
  } from "./panel-model";
  import { buildSortGroupMenu, decorateSortGroupMenu } from "./menus/sort-group-menu";
  import { buildScopeLabel } from "./scope-label";
  import type { BulkRuntimePanelState, SearchStatus, SearchHistoryCommand, SearchQueryResetSource, ToolbarActionPayload } from "./types";
  import ToolbarBoxPicker from "./ToolbarBoxPicker.svelte";
  import ToolbarBulkStrip from "./ToolbarBulkStrip.svelte";
  interface BoxCommandPayload {
    command: string;
    boxId?: string;
  }
  interface SortChangePayload {
    field: string;
    direction: string;
  }
  interface GroupChangePayload {
    dimension: string;
    propertyKey?: string;
    timeGranularity?: import("../card-grouping-settings").TimeGroupGranularity;
    orderBy: string;
    orderDirection: string;
  }

  interface GroupCollapseCommandPayload {
    command: string;
    key?: string;
  }

  interface SearchQueryChangePayload {
    query: string;
  }

  interface SearchQueryResetPayload {
    source: SearchQueryResetSource;
  }

  const BULK_EDIT_TAGS_ICON = "tags";
  const BULK_EDIT_PROPERTIES_ICON = "list";

  interface ToolbarProps {
    attachSearchHistorySuggest?: AttachSearchHistorySuggest;
    strings?: UiStrings;
    scope?: PanelScopeState;
    search?: PanelSearchState;
    projection?: PanelProjectionState;
    visibleGroupProperties?: Array<{ key: string; label: string }>;
    bulk?: BulkRuntimePanelState;
    boxSummaries?: BoxSummary[];
    runtimeDevice?: RuntimeDevice;
    navVisible?: boolean;
    onToggleNavPane?: () => void;
    tooltipSide?: "top" | "right" | "bottom" | "left";
    onToolbarAction?: (payload: ToolbarActionPayload) => void;
    onSortChange?: (payload: SortChangePayload) => void;
    onGroupChange?: (payload: GroupChangePayload) => void;
    onGroupCollapseCommand?: (payload: GroupCollapseCommandPayload) => void;
    onSearchQueryChange?: (payload: SearchQueryChangePayload) => void;
    onSearchQueryReset?: (payload: SearchQueryResetPayload) => void;
    onSearchHistoryCommand?: (payload: SearchHistoryCommand) => void;
    onBoxCommand?: (payload: BoxCommandPayload) => void;
  }

  interface BulkActionOption {
    id: string;
    label: string;
    icon: string;
    disabled: boolean;
    danger?: boolean;
  }

  interface BulkActionSeparatorOption {
    type: "separator";
  }

  type BulkToolbarOption = BulkActionOption | BulkActionSeparatorOption;

  function getSearchStatusLabel(
    strings: ToolbarStrings["searchStatus"],
    status: SearchStatus,
    readiness: string,
    persistence: string,
    rebuildReason: string | null,
  ): string {
    if (status === "building") {
      return readiness === "restoring" ? strings.buildingRestoring : strings.building;
    }

    if (status === "rebuild-required") {
      if (rebuildReason === "version-drift") return strings.rebuildVersionDrift;
      if (rebuildReason === "corrupt") return strings.rebuildCorrupt;
      if (rebuildReason === "folder-rebuild-required") return strings.rebuildFolderChanged;
      return strings.rebuildRequired;
    }

    if (status === "storage-unavailable" || persistence === "storage-unavailable") {
      return strings.storageUnavailable;
    }

    if (status === "error") {
      return strings.error;
    }

    if (status === "unavailable") {
      return strings.unavailable;
    }

    if (status === "ready") {
      return strings.ready;
    }

    return strings.idle;
  }

  interface ToolbarActionOption {
    id: string;
    label: string;
    title: string;
    icon: string;
  }

  const DEFAULT_SCOPE: PanelScopeState = {
    displayPath: "", includeSubfolders: true, activeBoxId: null, activeBoxName: null,
    boxExcludedCount: 0, emptyStateMessage: "",
    sourceIdentity: "folder::true", browseTagFilterEnabled: true, browsePropertyFilterEnabled: true,
    supportsIncludeSubfolders: true, supportsBoxRuleSeeding: true,
  };
  const DEFAULT_SEARCH: PanelSearchState = { history: [], query: "", committedQuery: "", status: "idle", focusToken: 0 };
  const DEFAULT_PROJECTION: PanelProjectionState = { sortField: "mtime", sortDirection: "desc", availableTags: [], tagCounts: {}, activeFilterTags: [], pinnedPaths: [], group: DEFAULT_GROUP_SPEC, availableGroupDimensions: [], groupSegmentCount: 0, metadataStatus: "ready" };
  const DEFAULT_BULK: BulkRuntimePanelState = { bulkMode: false, selectedPaths: [], selectedCount: 0, bulkAnchorPath: null, canBulkSelectAll: false, canBulkClearSelection: false, canBulkMoveSelected: false, canBulkEditTagsSelected: false, canBulkEditPropertiesSelected: false, canBulkDeleteSelected: false, canBulkMergeSelected: false };

  let {
    attachSearchHistorySuggest,
    strings = getUiStrings("en"),
    scope = DEFAULT_SCOPE,
    search = DEFAULT_SEARCH,
    projection = DEFAULT_PROJECTION,
    visibleGroupProperties = [],
    bulk = DEFAULT_BULK,
    boxSummaries = [],
    runtimeDevice = "desktop",
    navVisible = false,
    onToggleNavPane,
    tooltipSide = "right",
    onToolbarAction,
    onSortChange,
    onGroupChange,
    onGroupCollapseCommand,
    onSearchQueryChange,
    onSearchQueryReset,
    onSearchHistoryCommand,
    onBoxCommand,
  }: ToolbarProps = $props();
  const toolbarStrings = $derived(strings.toolbar);
  const boxStrings = $derived(strings.box);
  const sortGroupStrings = $derived(strings.sortGroup);
  const activeBoxId = $derived(scope.activeBoxId);
  const activeFilterTags = $derived(projection.activeFilterTags);
  const sortField = $derived(projection.sortField);
  const sortDirection = $derived(projection.sortDirection);
  const group = $derived(projection.group);
  const availableGroupDimensions = $derived(projection.availableGroupDimensions);
  const hasSegments = $derived(projection.groupSegmentCount > 0);
  const searchQuery = $derived(search.query);
  const searchStatus = $derived(search.status);
  const searchFocusToken = $derived(search.focusToken);
  const searchIndexReadiness = $derived(search.readiness ?? "ready");
  const searchIndexPersistence = $derived(search.persistence ?? "healthy");
  const searchIndexRebuildReason = $derived(search.rebuildReason ?? null);
  const bulkMode = $derived(bulk.bulkMode);
  const selectedCount = $derived(bulk.selectedCount);
  const bulkAnchorPath = $derived(bulk.bulkAnchorPath);
  const canBulkSelectAll = $derived(bulk.canBulkSelectAll);
  const canBulkClearSelection = $derived(bulk.canBulkClearSelection);
  const canBulkMoveSelected = $derived(bulk.canBulkMoveSelected);
  const canBulkEditTagsSelected = $derived(bulk.canBulkEditTagsSelected);
  const canBulkEditPropertiesSelected = $derived(bulk.canBulkEditPropertiesSelected);
  const canBulkDeleteSelected = $derived(bulk.canBulkDeleteSelected);
  const canBulkMergeSelected = $derived(bulk.canBulkMergeSelected);

  const TOOLBAR_ACTIONS = $derived<ToolbarActionOption[]>([
    { id: "new-note", label: toolbarStrings.actions.newNote, title: toolbarStrings.actions.newNoteTitle, icon: "square-pen" },
    { id: "sort", label: toolbarStrings.actions.sort, title: toolbarStrings.actions.sortTitle, icon: "arrow-up-narrow-wide" },
    { id: "bulk", label: toolbarStrings.actions.bulk, title: toolbarStrings.actions.bulkTitle, icon: "check-check" },
  ]);
  const TRANSIENT_TOOLBAR_ACTION_IDS = new Set(["new-note"]);

  let activeToolbarAction = $state("");
  let boxPickerCloseNonce = $state(0);

  let sortButtonEl: HTMLElement | null = null;
  let toolbarWidth = $state(0);
  const compact = $derived(runtimeDevice === "phone" || (runtimeDevice === "tablet" && toolbarWidth < 640));
  let moreMenu = $state.raw<Menu | null>(null);

  function bindToolbarWidth(node: HTMLElement): { destroy: () => void } {
    if (runtimeDevice !== "tablet") return { destroy() {} };
    const measure = (): void => { toolbarWidth = node.clientWidth; };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  $effect(() => {
    // Close menus whose anchor or source is being replaced, including on unmount.
    compact; scope.sourceIdentity;
    return () => { moreMenu?.hide(); moreMenu = null; };
  });

  const isBoxMode = $derived(activeBoxId !== null);
  const isLinksMode = $derived(scope.linksDirection != null);
  const hasBoxes = $derived(boxSummaries.length > 0);
  const isSortGroupTriggerSelected = $derived(group.dimension !== "none");

  const scopeText = $derived(buildScopeLabel({ scope, activeFilterTags, strings: toolbarStrings }, "name"));
  const scopeTooltip = $derived(buildScopeLabel({ scope, activeFilterTags, strings: toolbarStrings }, "full"));

  let searchInputEl = $state<HTMLInputElement | null>(null);
  let searchExpanded = $state(false);
  let searchControlEl = $state<HTMLDivElement | null>(null);
  let searchToggleEl = $state<HTMLButtonElement | null>(null);
  let historySuggest = $state.raw<SearchHistorySuggestHandle | null>(null);
  let composing = false;
  const searchId = $props.id();
  const inputId = `${searchId}-input`;
  function bindSearchHistory(input: HTMLInputElement) {
    const handle = untrack(() => attachSearchHistorySuggest?.(input, {
      history: search.history,
      strings: toolbarStrings.search,
      onCommand: (command) => onSearchHistoryCommand?.(command),
    }));
    historySuggest = handle ?? null;
    return { destroy() { handle?.dispose(); historySuggest = null; } };
  }

  $effect(() => {
    historySuggest?.update({
      history: search.history,
      strings: toolbarStrings.search,
      onCommand: (command) => onSearchHistoryCommand?.(command),
    });
  });

  function handleSearchFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && (searchControlEl?.contains(next) || searchToggleEl?.contains(next) || historySuggest?.contains(next))) return;
    onSearchHistoryCommand?.({ command: "record", source: "blur" });
    historySuggest?.close();
  }

  function handleSearchKeydown(event: KeyboardEvent): void {
    if (event.isComposing || composing || event.key === "Process") return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      searchInputEl?.focus();
      historySuggest?.close();
      return;
    }
    if (event.target !== searchInputEl) return;
    if (event.key === "Enter" && !historySuggest?.isOpen()) {
      event.preventDefault();
      onSearchHistoryCommand?.({ command: "record", source: "enter" });
    }
  }

  // Plain `let`, not `$state`: the effect writes it, and a reactive read would
  // re-run the effect for no reason.
  let handledSearchFocusToken = 0;

  $effect(() => {
    if (searchFocusToken === handledSearchFocusToken) {
      return;
    }

    handledSearchFocusToken = searchFocusToken;
    if (searchFocusToken === 0) {
      return;
    }

    searchExpanded = true;
    tick().then(() => {
      searchInputEl?.focus();
    });
  });

  const bulkSelectionSummary = $derived(toolbarStrings.bulkSummary(selectedCount));
  const bulkActions = $derived<BulkToolbarOption[]>([
    { id: "bulk-select-all", label: toolbarStrings.bulkActionLabels.selectAll, icon: "check-square", disabled: !canBulkSelectAll },
    { id: "bulk-clear-selection", label: toolbarStrings.bulkActionLabels.clearSelection, icon: "x-square", disabled: !canBulkClearSelection },
    { type: "separator" },
    { id: "bulk-edit-tags-selected", label: toolbarStrings.bulkActionLabels.editTagsSelected, icon: BULK_EDIT_TAGS_ICON, disabled: !canBulkEditTagsSelected },
    { id: "bulk-edit-properties-selected", label: toolbarStrings.bulkActionLabels.editPropertiesSelected, icon: BULK_EDIT_PROPERTIES_ICON, disabled: !canBulkEditPropertiesSelected },
    { type: "separator" },
    { id: "bulk-background-color", label: strings.cardBackground.title, icon: "palette", disabled: !canBulkClearSelection },
    { type: "separator" },
    { id: "bulk-move-selected", label: toolbarStrings.bulkActionLabels.moveSelected, icon: "folder-input", disabled: !canBulkMoveSelected },
    { id: "bulk-add-to-box", label: boxStrings.bulkAddToBox, icon: BULK_ADD_TO_BOX_ICON, disabled: !canBulkClearSelection },
    ...(isBoxMode
      ? [{
          id: "bulk-remove-from-box",
          label: boxStrings.removeFromBox,
          icon: BULK_REMOVE_FROM_BOX_ICON,
          disabled: !canBulkClearSelection,
        } as BulkActionOption]
      : []),
    { id: "bulk-merge-selected", label: toolbarStrings.bulkActionLabels.mergeSelected, icon: "combine", disabled: !canBulkMergeSelected },
    { id: "bulk-delete-selected", label: toolbarStrings.bulkActionLabels.deleteSelected, icon: "trash-2", disabled: !canBulkDeleteSelected, danger: true },
  ]);

  const hasSearchQuery = $derived(searchQuery.trim().length > 0);
  const showSearchStatus = $derived(
    searchStatus === "building"
    || searchStatus === "rebuild-required"
    || searchStatus === "storage-unavailable"
    || searchStatus === "unavailable"
    || searchStatus === "error"
    || searchIndexPersistence === "storage-unavailable"
  );
  const searchStatusLabel = $derived(
    getSearchStatusLabel(toolbarStrings.searchStatus, searchStatus, searchIndexReadiness, searchIndexPersistence, searchIndexRebuildReason),
  );
  // Host-derived paused state (scope.browseFiltersPaused): active workspace filters kept dormant by a non-filterable scope.
  const showFiltersPaused = $derived(scope.browseFiltersPaused ?? false);
  const activeFilters = $derived(scope.browseFilterState?.items ?? []);
  const hasBrowseFilters = $derived(activeFilters.length > 0);
  const hasSummary = $derived(showSearchStatus || showFiltersPaused || hasBrowseFilters);

  function applyIcon(node: HTMLElement, iconName: string): { update: (nextIconName: string) => void } {
    setIcon(node, iconName);
    return {
      update(nextIconName: string) {
        setIcon(node, nextIconName);
      },
    };
  }

  function applyTooltip(node: HTMLElement, text: string): { update: (nextText: string) => void } {
    setTooltip(node, text, { placement: tooltipSide, gap: 8 });
    return {
      update(nextText: string) {
        setTooltip(node, nextText, { placement: tooltipSide, gap: 8 });
      },
    };
  }

  /**
   * Sort & group opens an Obsidian DOM menu anchored under the trigger
   * button. The Menu owns closing, keyboard navigation, and viewport fitting,
   * so the toolbar only builds the items and decorates the surface.
   */
  function openSortGroupMenu(event: MouseEvent, anchor?: DOMRect): void {
    closeBoxPickerMenu();

    const menu = new Menu().setUseNativeMenu(false);
    buildSortGroupMenu(
      menu,
      { sortField, sortDirection, group, availableGroupDimensions, visibleGroupProperties, hasSegments, supportsReferenceCount: isLinksMode },
      {
        strings: sortGroupStrings,
        onSelectSort: (field) => applySort(field, sortDirection),
        onSelectDirection: (direction) => applySort(sortField, direction),
        onSelectDimension: (dimension) => applyGroupSpec({ ...group, dimension }),
        onSelectTime: (dimension, timeGranularity) => applyGroupSpec({ ...group, dimension, timeGranularity }),
        onSelectProperty: (propertyKey) => applyGroupSpec({ ...group, dimension: "property", propertyKey }),
        onSelectOrderBy: (orderBy) => applyGroupSpec({ ...group, orderBy }),
        onSelectOrderDirection: (orderDirection) => applyGroupSpec({ ...group, orderDirection }),
        onCollapseAll: () => emitGroupCollapseCommand("collapse-all"),
        onExpandAll: () => emitGroupCollapseCommand("expand-all"),
      },
    );

    const triggerRect = anchor ?? sortButtonEl?.getBoundingClientRect();
    menu.showAtPosition({
      x: triggerRect?.left ?? event.clientX,
      y: triggerRect?.bottom ?? event.clientY,
      overlap: true,
    });
    decorateSortGroupMenu(menu, sortGroupStrings);
  }

  function openMoreMenu(event: MouseEvent): void {
    if (moreMenu) {
      moreMenu.hide();
      moreMenu = null;
      return;
    }
    closeBoxPickerMenu();
    const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const position = { x: anchor.left, y: anchor.bottom, overlap: true };
    const menu = new Menu().setUseNativeMenu(false);
    moreMenu = menu;
    menu.onHide(() => { if (moreMenu === menu) moreMenu = null; });
    const addAction = (label: string, icon: string, run: () => void, checked?: boolean): void => {
      menu.addItem((item) => {
        item.setTitle(label).setIcon(icon).onClick(() => {
          menu.hide(); moreMenu = null; run();
        });
        if (checked !== undefined) item.setChecked(checked);
      });
    };
    addAction(sortGroupStrings.title, "arrow-up-narrow-wide", () => openSortGroupMenu(event, anchor), isSortGroupTriggerSelected);
    addAction(bulkMode ? toolbarStrings.actions.exitBulk : toolbarStrings.actions.bulkTitle, "check-check", () => emitToolbarAction("bulk"), bulkMode);
    if (isBoxMode) {
      addAction(boxStrings.configureTitle, "settings-2", () => emitBoxCommand("configure"));
    }
    if (scope.supportsBoxRuleSeeding) {
      menu.addSeparator();
      addAction(boxStrings.saveScopeTitle, "package-plus", () => emitBoxCommand("save-scope-as-box"));
      if (hasBoxes) {
        addAction(boxStrings.addScopeToBox, "package-check", () => {
          const picker = new Menu().setUseNativeMenu(false);
          moreMenu = picker;
          picker.onHide(() => { if (moreMenu === picker) moreMenu = null; });
          for (const box of boxSummaries) {
            picker.addItem((item) => item.setTitle(box.name).setIcon("box").onClick(() => {
              picker.hide(); moreMenu = null; emitBoxCommand("add-scope-to-box", box.id);
            }));
          }
          picker.showAtPosition(position);
        });
      }
    }
    if (isLinksMode) {
      menu.addSeparator();
      addAction(scope.linksPinned ? strings.links.resumeFollow : strings.links.pinToNote, "pin", () => emitToolbarAction("links-pin-toggle"), scope.linksPinned ?? false);
      if (scope.supportsLinksSnapshot) {
        addAction(strings.links.saveSnapshot, "package-plus", () => emitToolbarAction("links-save-snapshot"));
      }
    }
    menu.showAtPosition(position);
  }

  function selectToolbarAction(actionId: string, event: MouseEvent): void {
    closeBoxPickerMenu();

    if (actionId === "sort") {
      openSortGroupMenu(event);
      return;
    }

    if (!TRANSIENT_TOOLBAR_ACTION_IDS.has(actionId)) {
      activeToolbarAction = actionId;
    }
    onToolbarAction?.({ action: actionId });
  }

  function applySort(field: LinksSortField, direction: SortDirection): void {
    if (field === sortField && direction === sortDirection) {
      return;
    }

    onSortChange?.({ field, direction });
  }

  function applyGroupSpec(next: GroupSpec): void {
    const { dimension, orderBy, orderDirection, propertyKey, timeGranularity } = next;
    if (timeGranularity === group.timeGranularity && dimension === group.dimension && propertyKey === group.propertyKey && orderBy === group.orderBy && orderDirection === group.orderDirection) {
      return;
    }

    onGroupChange?.({ dimension, timeGranularity, ...(propertyKey ? { propertyKey } : {}), orderBy, orderDirection });
  }

  function emitGroupCollapseCommand(command: string): void {
    onGroupCollapseCommand?.({ command });
  }

  function createElementCapture(assign: (node: HTMLElement | null) => void): (node: HTMLElement) => { destroy: () => void } {
    return (node: HTMLElement) => {
      assign(node);
      return {
        destroy() {
          assign(null);
        },
      };
    };
  }

  const captureSortButton = createElementCapture((node) => {
    sortButtonEl = node;
  });

  function closeBoxPickerMenu(): void {
    boxPickerCloseNonce += 1;
  }

  function emitBoxCommand(command: string, boxId?: string): void {
    onBoxCommand?.(boxId === undefined ? { command } : { command, boxId });
  }

  function handleSearchInput(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    onSearchQueryChange?.({ query: target.value });
  }

  function clearSearchQuery(): void {
    onSearchQueryReset?.({ source: "clear-button" });
    void tick().then(() => {
      searchInputEl?.focus();
      searchInputEl?.dispatchEvent(new FocusEvent("focus"));
    });
  }

  function emitToolbarAction(actionId: string): void {
    onToolbarAction?.({ action: actionId });
  }

  function toggleSearch(): void {
    if (searchExpanded) {
      onSearchQueryReset?.({ source: "collapse" });
      composing = false;
      historySuggest?.close();
      searchExpanded = false;
    } else {
      searchExpanded = true;
      void tick().then(() => searchInputEl?.focus());
    }
  }
</script>

<header class="fce-header {bulkMode ? 'is-bulk-mode' : ''}" class:is-compact={compact}>
  <div class="fce-toolbar" role="toolbar" aria-label={toolbarStrings.actions.toolbarAriaLabel}>
    <div class="fce-toolbar-buttons" use:bindToolbarWidth>
      <button
        type="button"
        class="clickable-icon fce-toolbar-button"
        aria-label={navVisible ? toolbarStrings.navPane.collapsePane : toolbarStrings.navPane.expandPane}
        aria-pressed={navVisible}
        onclick={() => onToggleNavPane?.()}
        use:applyIcon={navVisible ? "panel-left-close" : "panel-left-open"}
        use:applyTooltip={navVisible ? toolbarStrings.navPane.collapsePane : toolbarStrings.navPane.expandPane}
      >
        <span class="fce-sr-only">{navVisible ? toolbarStrings.navPane.collapsePane : toolbarStrings.navPane.expandPane}</span>
      </button>
      <div class="fce-toolbar-scope {isLinksMode ? 'is-links' : isBoxMode ? 'is-box' : ''}" use:applyTooltip={scopeTooltip}>
        <span class="fce-sr-only">{toolbarStrings.scope.ariaLabel}</span>
        <span class="fce-toolbar-scope-text">{scopeText}</span>
      </div>
      <div class="fce-toolbar-actions">
        {#if compact}
          <button
            type="button"
            class="clickable-icon fce-toolbar-button {bulkMode ? 'is-selected' : ''}"
            aria-label={bulkMode ? toolbarStrings.actions.exitBulk : toolbarStrings.actions.newNoteTitle}
            onclick={() => emitToolbarAction(bulkMode ? "bulk" : "new-note")}
            use:applyIcon={bulkMode ? "x" : "square-pen"}
            use:applyTooltip={bulkMode ? toolbarStrings.actions.exitBulk : toolbarStrings.actions.newNoteTitle}
          ></button>
        {:else}
          {#if isLinksMode}
            <button
              type="button"
              class="clickable-icon fce-toolbar-button {scope.linksPinned ? 'is-selected' : ''}"
              aria-label={scope.linksPinned ? strings.links.resumeFollow : strings.links.pinToNote}
              aria-pressed={scope.linksPinned ?? false}
              onclick={() => emitToolbarAction("links-pin-toggle")}
              use:applyIcon={"pin"}
              use:applyTooltip={scope.linksPinned ? strings.links.resumeFollow : strings.links.pinToNote}
            >
              <span class="fce-sr-only">{scope.linksPinned ? strings.links.resumeFollow : strings.links.pinToNote}</span>
            </button>
          {/if}
          {#if isBoxMode}
            <button
              type="button"
              class="clickable-icon fce-toolbar-button"
              aria-label={toolbarStrings.actions.newNoteTitle}
              onclick={(event) => selectToolbarAction("new-note", event)}
              use:applyIcon={"square-pen"}
            >
              <span class="fce-sr-only">{toolbarStrings.actions.newNote}</span>
            </button>
            <button
              type="button"
              class="clickable-icon fce-toolbar-button fce-sort-trigger {isSortGroupTriggerSelected ? 'is-selected' : ''}"
              aria-label={sortGroupStrings.title}
              onclick={(event) => selectToolbarAction("sort", event)}
              use:applyIcon={"arrow-up-narrow-wide"}
              use:captureSortButton
            >
              <span class="fce-sr-only">{sortGroupStrings.title}</span>
            </button>
            <button
              type="button"
              class="clickable-icon fce-toolbar-button"
              aria-label={boxStrings.configureTitle}
              onclick={() => emitBoxCommand("configure")}
              use:applyIcon={"settings-2"}
              use:applyTooltip={boxStrings.configureTitle}
            >
              <span class="fce-sr-only">{boxStrings.configure}</span>
            </button>
            <button
              type="button"
              class="clickable-icon fce-toolbar-button {bulkMode ? 'is-selected' : ''}"
              aria-label={toolbarStrings.actions.bulkTitle}
              onclick={(event) => selectToolbarAction("bulk", event)}
              use:applyIcon={"check-check"}
            >
              <span class="fce-sr-only">{toolbarStrings.actions.bulk}</span>
            </button>
          {:else}
            {#each TOOLBAR_ACTIONS as action}
              {#if action.id === "sort"}
                <button
                  type="button"
                  class="clickable-icon fce-toolbar-button fce-sort-trigger {isSortGroupTriggerSelected ? 'is-selected' : ''}"
                  aria-label={sortGroupStrings.title}
                  onclick={(event) => selectToolbarAction(action.id, event)}
                  use:applyIcon={action.icon}
                  use:captureSortButton
                >
                  <span class="fce-sr-only">{sortGroupStrings.title}</span>
                </button>
              {:else}
                <button
                  type="button"
                  class="clickable-icon fce-toolbar-button {(action.id === 'bulk' ? bulkMode : activeToolbarAction === action.id) ? 'is-selected' : ''}"
                  aria-label={action.title}
                  onclick={(event) => selectToolbarAction(action.id, event)}
                  use:applyIcon={action.icon}
                >
                  <span class="fce-sr-only">{action.label}</span>
                </button>
              {/if}
            {/each}
            {#if scope.supportsBoxRuleSeeding}
              <button
                type="button"
                class="clickable-icon fce-toolbar-button"
                aria-label={boxStrings.saveScopeTitle}
                onclick={() => emitBoxCommand("save-scope-as-box")}
                use:applyIcon={"package-plus"}
                use:applyTooltip={boxStrings.saveScopeTitle}
              >
                <span class="fce-sr-only">{boxStrings.saveScopeTitle}</span>
              </button>
            {/if}
            {#if scope.supportsBoxRuleSeeding && hasBoxes}
              <ToolbarBoxPicker
                {boxSummaries}
                addScopeLabel={boxStrings.addScopeToBox}
                closeNonce={boxPickerCloseNonce}
                onAddToBox={(boxId) => emitBoxCommand("add-scope-to-box", boxId)}
              />
            {/if}
          {/if}
          {#if isLinksMode && scope.supportsLinksSnapshot}
            <button
              type="button"
              class="clickable-icon fce-toolbar-button"
              aria-label={strings.links.saveSnapshot}
              onclick={() => emitToolbarAction("links-save-snapshot")}
              use:applyIcon={"package-plus"}
              use:applyTooltip={strings.links.saveSnapshot}
            >
              <span class="fce-sr-only">{strings.links.saveSnapshot}</span>
            </button>
          {/if}
        {/if}
        <button
          type="button"
          class="clickable-icon fce-toolbar-button {(searchExpanded || hasSearchQuery) ? 'is-selected' : ''}"
          bind:this={searchToggleEl}
          aria-expanded={searchExpanded}
          onfocusout={handleSearchFocusOut}
          aria-label={toolbarStrings.actions.toggleSearch}
          aria-controls={inputId}
          onmousedown={(event) => event.preventDefault()}
          onclick={toggleSearch}
          use:applyIcon={"search"}
        >
          <span class="fce-sr-only">{toolbarStrings.actions.toggleSearch}</span>
        </button>
        {#if compact}
          <button
            type="button"
            class="clickable-icon fce-toolbar-button fce-toolbar-more {(bulkMode || isSortGroupTriggerSelected || scope.linksPinned) ? 'is-selected' : ''}"
            aria-label={toolbarStrings.actions.more}
            aria-haspopup="menu"
            aria-expanded={moreMenu !== null}
            onclick={openMoreMenu}
            use:applyIcon={"ellipsis"}
            use:applyTooltip={toolbarStrings.actions.more}
          ></button>
        {/if}
      </div>
    </div>
  </div>

  {#if searchExpanded}
    <div class="fce-toolbar-search-row {bulkMode ? 'is-bulk-mode' : ''}">
      <div class="fce-toolbar-search" role="search" bind:this={searchControlEl}
        onfocusout={handleSearchFocusOut}>
        <label class="fce-sr-only" for={inputId}>{toolbarStrings.search.inputLabel}</label>
        <input
          bind:this={searchInputEl}
          use:bindSearchHistory
          id={inputId}
          class="fce-search-input"
          type="search"
          role="combobox"
          aria-expanded="false"
          aria-controls={`${searchId}-history`}
          aria-autocomplete="list"
          aria-haspopup="grid"
          onkeydown={handleSearchKeydown}
          oncompositionstart={() => { composing = true; }}
          oncompositionend={() => { composing = false; }}
          aria-label={toolbarStrings.search.inputLabel}
          placeholder={toolbarStrings.search.placeholder}
          value={searchQuery}
          oninput={handleSearchInput}
        />
        {#if hasSearchQuery}
          <button
            type="button"
            class="clickable-icon fce-search-clear"
            aria-label={toolbarStrings.search.clear}
            onkeydown={handleSearchKeydown}
            onclick={clearSearchQuery}
            use:applyIcon={"x"}
          >
            <span class="fce-sr-only">{toolbarStrings.search.clear}</span>
          </button>
        {/if}
      </div>
    </div>
  {/if}

  {#if hasSummary}
    <div class="fce-toolbar-content-row {bulkMode ? 'is-bulk-mode' : ''}">
      <div class="fce-toolbar-content">
        {#if showSearchStatus}
          <span class="fce-toolbar-summary-segment fce-search-status" data-search-status={searchStatus}>{searchStatusLabel}</span>
        {/if}
        {#if hasBrowseFilters}
          <div class="fce-active-filters">
            <span class="fce-active-filters-label">{toolbarStrings.activeFilters}</span>
            {#each activeFilters as filter (filter.id)}
              <span class="fce-filter-chip" class:is-property={filter.property !== undefined} title={filter.label}>
                {#if filter.property}
                  <span class="fce-filter-chip-key"><span class="fce-filter-chip-label">{filter.property.name}</span></span>
                  <span class="fce-sr-only">: </span>
                {/if}
                <span class="fce-filter-chip-content">
                  <span class="fce-filter-chip-label">{filter.property?.value ?? filter.label}</span>
                  <button type="button" class="clickable-icon fce-filter-chip-remove"
                    aria-label={toolbarStrings.removeFilter(filter.label)}
                    use:applyTooltip={toolbarStrings.removeFilter(filter.label)}
                    onclick={() => onToolbarAction?.({ action: "remove-browse-filter", filter: filter.target })}
                    use:applyIcon={"x"}></button>
                </span>
              </span>
            {/each}
            <button type="button" class="clickable-icon fce-clear-browse-filters" aria-label={toolbarStrings.clearBrowseFilters}
              use:applyTooltip={toolbarStrings.clearBrowseFilters}
              onclick={() => emitToolbarAction("clear-browse-filters")} use:applyIcon={"filter-x"}></button>
          </div>
        {/if}
        {#if showFiltersPaused}<span class="fce-toolbar-summary-segment fce-filters-paused">{toolbarStrings.filtersPaused}</span>{/if}
      </div>
    </div>
  {/if}

  {#if bulkMode}
    <ToolbarBulkStrip
      {bulkActions}
      {bulkSelectionSummary}
      ariaLabel={toolbarStrings.actions.bulkTitle}
      {tooltipSide}
      {onToolbarAction}
    />
  {/if}

</header>
