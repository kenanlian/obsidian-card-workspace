<script lang="ts">
  import { setIcon, setTooltip } from "obsidian";
  import { tick } from "svelte";
  import { DEFAULT_GROUP_SPEC, type GroupSpec } from "../card-grouping-settings";
  import { getUiStrings, type ToolbarStrings, type UiStrings } from "../i18n";
  import { BULK_ADD_TO_BOX_ICON, BULK_REMOVE_FROM_BOX_ICON } from "../icons";
  import type { SortDirection, SortField } from "../settings";
  import type {
    BoxSummary,
    PanelProjectionState,
    PanelScopeState,
    PanelSearchState,
  } from "./panel-model";
  import SortGroupPopover from "./SortGroupPopover.svelte";
  import type { BulkRuntimePanelState, SearchStatus } from "./types";

  interface ToolbarActionPayload {
    action: string;
  }

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
    source: "clear-button";
  }

  const BULK_ADD_TAG_ICON = "card-workspace-tag-plus";
  const BULK_REMOVE_TAG_ICON = "card-workspace-tag-minus";

  interface ToolbarProps {
    strings?: UiStrings;
    scope?: PanelScopeState;
    search?: PanelSearchState;
    projection?: PanelProjectionState;
    bulk?: BulkRuntimePanelState;
    boxSummaries?: BoxSummary[];
    navVisible?: boolean;
    onToggleNavPane?: () => void;
    tooltipSide?: "top" | "right" | "bottom" | "left";
    onToolbarAction?: (payload: ToolbarActionPayload) => void;
    onSortChange?: (payload: SortChangePayload) => void;
    onGroupChange?: (payload: GroupChangePayload) => void;
    onGroupCollapseCommand?: (payload: GroupCollapseCommandPayload) => void;
    onSearchQueryChange?: (payload: SearchQueryChangePayload) => void;
    onSearchQueryReset?: (payload: SearchQueryResetPayload) => void;
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

  interface PopupLifecycleOptions {
    getButton: () => HTMLElement | null;
    setMenu: (node: HTMLElement | null) => void;
    close: () => void;
    closeOnEscape?: boolean;
  }

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

  const DEFAULT_SCOPE: PanelScopeState = { displayPath: "", includeSubfolders: true, activeBoxId: null, activeBoxName: null, boxExcludedCount: 0, emptyStateMessage: "" };
  const DEFAULT_SEARCH: PanelSearchState = { query: "", status: "idle", focusToken: 0 };
  const DEFAULT_PROJECTION: PanelProjectionState = { sortField: "mtime", sortDirection: "desc", availableTags: [], tagCounts: {}, activeFilterTags: [], pinnedPaths: [], group: DEFAULT_GROUP_SPEC, availableGroupDimensions: [], groupSegmentCount: 0 };
  const DEFAULT_BULK: BulkRuntimePanelState = { bulkMode: false, selectedPaths: [], selectedCount: 0, bulkAnchorPath: null, canBulkSelectAll: false, canBulkClearSelection: false, canBulkMoveSelected: false, canBulkAddTagSelected: false, canBulkRemoveTagSelected: false, canBulkDeleteSelected: false, canBulkMergeSelected: false };

  let {
    strings = getUiStrings("en"),
    scope = DEFAULT_SCOPE,
    search = DEFAULT_SEARCH,
    projection = DEFAULT_PROJECTION,
    bulk = DEFAULT_BULK,
    boxSummaries = [],
    navVisible = false,
    onToggleNavPane,
    tooltipSide = "right",
    onToolbarAction,
    onSortChange,
    onGroupChange,
    onGroupCollapseCommand,
    onSearchQueryChange,
    onSearchQueryReset,
    onBoxCommand,
  }: ToolbarProps = $props();
  const toolbarStrings = $derived(strings.toolbar);
  const boxStrings = $derived(strings.box);
  const sortGroupStrings = $derived(strings.sortGroup);
  const activeBoxId = $derived(scope.activeBoxId);
  const activeBoxName = $derived(scope.activeBoxName);
  const folderPath = $derived(scope.displayPath);
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
  const canBulkAddTagSelected = $derived(bulk.canBulkAddTagSelected);
  const canBulkRemoveTagSelected = $derived(bulk.canBulkRemoveTagSelected);
  const canBulkDeleteSelected = $derived(bulk.canBulkDeleteSelected);
  const canBulkMergeSelected = $derived(bulk.canBulkMergeSelected);
  const sortButtonId = "fce-sort-button";
  const boxPickerButtonId = "fce-box-picker-button";

  const TOOLBAR_ACTIONS = $derived<ToolbarActionOption[]>([
    { id: "new-note", label: toolbarStrings.actions.newNote, title: toolbarStrings.actions.newNoteTitle, icon: "square-pen" },
    { id: "sort", label: toolbarStrings.actions.sort, title: toolbarStrings.actions.sortTitle, icon: "arrow-up-narrow-wide" },
    { id: "bulk", label: toolbarStrings.actions.bulk, title: toolbarStrings.actions.bulkTitle, icon: "check-check" },
  ]);
  const TRANSIENT_TOOLBAR_ACTION_IDS = new Set(["new-note"]);

  let activeToolbarAction = $state("");
  let showSortGroupMenu = $state(false);
  let sortMenuX = $state(0);
  let sortMenuY = $state(0);
  let sortMenuMaxHeight = $state(0);
  let showBoxPickerMenu = $state(false);
  let boxPickerMenuX = $state(0);
  let boxPickerMenuY = $state(0);

  let sortButtonEl: HTMLElement | null = null;
  let sortMenuEl: HTMLElement | null = null;
  let boxPickerButtonEl: HTMLElement | null = null;
  let boxPickerMenuEl: HTMLElement | null = null;

  const isBoxMode = $derived(activeBoxId !== null);
  const hasBoxes = $derived(boxSummaries.length > 0);
  const isSortGroupTriggerSelected = $derived(showSortGroupMenu || group.dimension !== "none");

  function formatScopeTag(tag: string): string {
    return tag.startsWith("#") ? tag : `#${tag}`;
  }

  const isVaultRootScope = $derived(folderPath === "/" || folderPath === "");
  const folderScopeName = $derived(
    isVaultRootScope ? toolbarStrings.folderMenu.rootFolder : (folderPath.split("/").pop() ?? folderPath),
  );
  const folderScopeFullLabel = $derived(
    isVaultRootScope ? toolbarStrings.folderMenu.rootFolder : folderPath,
  );
  const tagScopeLabel = $derived(activeFilterTags.map(formatScopeTag).join(", "));

  function joinScope(folderLabel: string): string {
    return tagScopeLabel.length > 0
      ? `${folderLabel}${toolbarStrings.scope.separator}${tagScopeLabel}`
      : folderLabel;
  }

  const scopeText = $derived(isBoxMode ? (activeBoxName ?? "") : joinScope(folderScopeName));
  const scopeTooltip = $derived(isBoxMode ? (activeBoxName ?? "") : joinScope(folderScopeFullLabel));

  let searchInputEl = $state<HTMLInputElement | null>(null);
  let searchExpanded = $state(false);

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
    closeSortGroupMenu();
    tick().then(() => {
      searchInputEl?.focus();
    });
  });

  const bulkSelectionSummary = $derived(toolbarStrings.bulkSummary(selectedCount));
  const bulkActions = $derived<BulkToolbarOption[]>([
    { id: "bulk-select-all", label: toolbarStrings.bulkActionLabels.selectAll, icon: "check-square", disabled: !canBulkSelectAll },
    { id: "bulk-clear-selection", label: toolbarStrings.bulkActionLabels.clearSelection, icon: "x-square", disabled: !canBulkClearSelection },
    { type: "separator" },
    { id: "bulk-add-tag-selected", label: toolbarStrings.bulkActionLabels.addTagSelected, icon: BULK_ADD_TAG_ICON, disabled: !canBulkAddTagSelected },
    { id: "bulk-remove-tag-selected", label: toolbarStrings.bulkActionLabels.removeTagSelected, icon: BULK_REMOVE_TAG_ICON, disabled: !canBulkRemoveTagSelected },
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
  const hasSummary = $derived(showSearchStatus);

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
   * The menu is `position: fixed` at the click point, so height alone cannot
   * keep it on screen: a vertically stacked sidebar leaf can put the toolbar
   * well down the window. Lift the top when the space below it is too small to
   * read, then bound the height by whatever space actually remains.
   */
  const SORT_MENU_VIEWPORT_MARGIN = 12;
  const SORT_MENU_MIN_HEIGHT = 220;

  function viewportHeight(): number {
    const height = typeof window === "undefined" ? 0 : window.innerHeight;
    return Number.isFinite(height) && height > 0 ? height : SORT_MENU_MIN_HEIGHT;
  }

  function clampSortMenuTop(clientY: number): number {
    const available = viewportHeight() - clientY - SORT_MENU_VIEWPORT_MARGIN;
    if (available >= SORT_MENU_MIN_HEIGHT) {
      return clientY;
    }
    const lifted = viewportHeight() - SORT_MENU_MIN_HEIGHT - SORT_MENU_VIEWPORT_MARGIN;
    return Math.max(SORT_MENU_VIEWPORT_MARGIN, lifted);
  }

  function selectToolbarAction(actionId: string, event: MouseEvent): void {
    closeBoxPickerMenu();

    if (actionId === "sort") {
      if (showSortGroupMenu) {
        closeSortGroupMenu();
      } else {
        sortMenuX = event.clientX;
        sortMenuY = clampSortMenuTop(event.clientY);
        sortMenuMaxHeight = viewportHeight() - sortMenuY - SORT_MENU_VIEWPORT_MARGIN;
        showSortGroupMenu = true;
      }
      return;
    }

    closeSortGroupMenu();
    if (!TRANSIENT_TOOLBAR_ACTION_IDS.has(actionId)) {
      activeToolbarAction = actionId;
    }
    onToolbarAction?.({ action: actionId });
  }

  function applySort(field: SortField, direction: SortDirection): void {
    closeSortGroupMenu();
    if (field === sortField && direction === sortDirection) {
      return;
    }

    onSortChange?.({ field, direction });
  }

  function applyGroupSpec(next: GroupSpec): void {
    closeSortGroupMenu();
    const { dimension, orderBy, orderDirection } = next;
    if (dimension === group.dimension && orderBy === group.orderBy && orderDirection === group.orderDirection) {
      return;
    }

    onGroupChange?.({ dimension, orderBy, orderDirection });
  }

  function emitGroupCollapseCommand(command: string): void {
    closeSortGroupMenu();
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

  function createPopupPortalAction(options: PopupLifecycleOptions): (node: HTMLElement) => { destroy: () => void } {
    return (node: HTMLElement) => {
      const onClickOutside = (event: MouseEvent): void => {
        const target = event.target;
        if (target instanceof Node) {
          const button = options.getButton();
          if (button && button.contains(target)) {
            return;
          }
          if (node.contains(target)) {
            return;
          }
        }
        options.close();
      };

      const onKeydown = (event: KeyboardEvent): void => {
        if (event.key === "Escape") {
          options.close();
        }
      };

      options.setMenu(node);
      document.body.appendChild(node);
      document.addEventListener("click", onClickOutside, true);
      if (options.closeOnEscape) {
        document.addEventListener("keydown", onKeydown, true);
      }

      return {
        destroy() {
          document.removeEventListener("click", onClickOutside, true);
          if (options.closeOnEscape) {
            document.removeEventListener("keydown", onKeydown, true);
          }
          options.setMenu(null);
          if (node.parentNode) {
            node.parentNode.removeChild(node);
          }
        },
      };
    };
  }

  const captureSortButton = createElementCapture((node) => {
    sortButtonEl = node;
  });

  const captureBoxPickerButton = createElementCapture((node) => {
    boxPickerButtonEl = node;
  });

  function closeSortGroupMenu(): void {
    showSortGroupMenu = false;
  }

  function closeBoxPickerMenu(): void {
    showBoxPickerMenu = false;
  }

  function emitBoxCommand(command: string, boxId?: string): void {
    onBoxCommand?.(boxId === undefined ? { command } : { command, boxId });
  }

  function toggleBoxPickerMenu(event: MouseEvent): void {
    if (showBoxPickerMenu) {
      closeBoxPickerMenu();
      return;
    }

    closeSortGroupMenu();
    boxPickerMenuX = event.clientX;
    boxPickerMenuY = event.clientY;
    showBoxPickerMenu = true;
  }

  function addScopeToBox(boxId: string): void {
    closeBoxPickerMenu();
    emitBoxCommand("add-scope-to-box", boxId);
  }

  const sortMenuAction = createPopupPortalAction({
    getButton: () => sortButtonEl,
    setMenu: (node) => {
      sortMenuEl = node;
    },
    close: closeSortGroupMenu,
    closeOnEscape: true,
  });

  const boxPickerMenuAction = createPopupPortalAction({
    getButton: () => boxPickerButtonEl,
    setMenu: (node) => {
      boxPickerMenuEl = node;
    },
    close: closeBoxPickerMenu,
    closeOnEscape: true,
  });

  function handleSearchInput(event: Event): void {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    onSearchQueryChange?.({ query: target.value });
  }

  function clearSearchQuery(): void {
    onSearchQueryReset?.({ source: "clear-button" });
  }

  function emitToolbarAction(actionId: string): void {
    onToolbarAction?.({ action: actionId });
  }

  function toggleSearch(): void {
    searchExpanded = !searchExpanded;
      if (searchExpanded) {
        closeSortGroupMenu();
        tick().then(() => {
          searchInputEl?.focus();
        });
      }
    }
</script>

<header class="fce-header {bulkMode ? 'is-bulk-mode' : ''}">
  <div class="fce-toolbar" role="toolbar" aria-label={toolbarStrings.actions.toolbarAriaLabel}>
    <div class="fce-toolbar-buttons">
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
      <div class="fce-toolbar-scope {isBoxMode ? 'is-box' : ''}" use:applyTooltip={scopeTooltip}>
        <span class="fce-sr-only">{toolbarStrings.scope.ariaLabel}</span>
        <span class="fce-toolbar-scope-text">{scopeText}</span>
      </div>
      <div class="fce-toolbar-actions">
        {#if isBoxMode}
          <button
            type="button"
            class="clickable-icon fce-toolbar-button {isSortGroupTriggerSelected ? 'is-selected' : ''}"
            id={sortButtonId}
            aria-label={sortGroupStrings.title}
            aria-expanded={showSortGroupMenu}
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
                class="clickable-icon fce-toolbar-button {isSortGroupTriggerSelected ? 'is-selected' : ''}"
                id={sortButtonId}
                aria-label={sortGroupStrings.title}
                aria-expanded={showSortGroupMenu}
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
          {#if hasBoxes}
            <button
              type="button"
              class="clickable-icon fce-toolbar-button {showBoxPickerMenu ? 'is-selected' : ''}"
              id={boxPickerButtonId}
              aria-label={boxStrings.addScopeToBox}
              aria-expanded={showBoxPickerMenu}
              onclick={toggleBoxPickerMenu}
              use:applyIcon={"package-check"}
              use:captureBoxPickerButton
            >
              <span class="fce-sr-only">{boxStrings.addScopeToBox}</span>
            </button>
          {/if}
        {/if}
        <button
          type="button"
          class="clickable-icon fce-toolbar-button {(searchExpanded || hasSearchQuery) ? 'is-selected' : ''}"
          aria-label={toolbarStrings.actions.toggleSearch}
          onclick={toggleSearch}
          use:applyIcon={"search"}
        >
          <span class="fce-sr-only">{toolbarStrings.actions.toggleSearch}</span>
        </button>
      </div>
    </div>
  </div>

  {#if searchExpanded}
    <div class="fce-toolbar-search-row {bulkMode ? 'is-bulk-mode' : ''}">
      <div class="fce-toolbar-search" role="search">
        <label class="fce-sr-only" for="fce-search-input">{toolbarStrings.search.inputLabel}</label>
        <input
          bind:this={searchInputEl}
          id="fce-search-input"
          class="fce-search-input"
          type="search"
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
      </div>
    </div>
  {/if}

  {#if bulkMode}
    <div class="fce-toolbar-bulk-strip" role="group" aria-label={toolbarStrings.actions.bulkTitle}>
      <div class="fce-toolbar-bulk-actions">
        {#each bulkActions as action}
          {#if "type" in action}
            <div class="fce-toolbar-bulk-separator" role="separator" aria-hidden="true"></div>
          {:else}
            <button
              type="button"
              class="clickable-icon fce-toolbar-bulk-button {action.danger ? 'is-destructive' : ''}"
              aria-label={action.label}
              disabled={action.disabled}
              onclick={() => emitToolbarAction(action.id)}
              use:applyIcon={action.icon}
              use:applyTooltip={action.label}
            >
              <span class="fce-sr-only">{action.label}</span>
            </button>
          {/if}
        {/each}
      </div>

      <div class="fce-toolbar-bulk-summary">
        <span>{bulkSelectionSummary}</span>
      </div>
    </div>
  {/if}

</header>

{#if showSortGroupMenu}
  <div
    class="fce-popup-menu fce-sort-menu"
    role="menu"
    aria-labelledby={sortButtonId}
    style="left: {sortMenuX}px; top: {sortMenuY}px; --fce-sort-menu-available: {sortMenuMaxHeight}px;"
    use:sortMenuAction
  >
    <SortGroupPopover
      strings={sortGroupStrings} {sortField} {sortDirection} {group} {availableGroupDimensions} {hasSegments}
      onSelectSort={(field) => applySort(field, sortDirection)}
      onSelectDirection={(direction) => applySort(sortField, direction)}
      onSelectDimension={(dimension) => applyGroupSpec({ ...group, dimension })}
      onSelectOrderBy={(orderBy) => applyGroupSpec({ ...group, orderBy })}
      onSelectOrderDirection={(orderDirection) => applyGroupSpec({ ...group, orderDirection })}
      onCollapseAll={() => emitGroupCollapseCommand("collapse-all")}
      onExpandAll={() => emitGroupCollapseCommand("expand-all")}
    />
  </div>
{/if}

{#if showBoxPickerMenu}
  <div
    class="fce-popup-menu fce-box-picker-menu"
    role="menu"
    aria-labelledby={boxPickerButtonId}
    style="left: {boxPickerMenuX}px; top: {boxPickerMenuY}px;"
    use:boxPickerMenuAction
  >
    {#each boxSummaries as box (box.id)}
      <button
        type="button"
        class="fce-popup-row fce-box-picker-item"
        role="menuitem"
        onclick={() => addScopeToBox(box.id)}
      >
        <span class="fce-popup-row-leading" aria-hidden="true" use:applyIcon={"box"}></span>
        <span class="fce-popup-row-content">
          <span class="fce-box-picker-item-label">{box.name}</span>
        </span>
      </button>
    {/each}
  </div>
{/if}
