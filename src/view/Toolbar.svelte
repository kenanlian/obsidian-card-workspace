<script lang="ts">
  import { setIcon, setTooltip } from "obsidian";
  import { tick } from "svelte";
  import { getUiStrings, type BoxStrings, type ToolbarStrings } from "../i18n";
  import type { SearchStatus } from "./types";

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

  interface SearchQueryChangePayload {
    query: string;
  }

  interface SearchQueryResetPayload {
    source: "clear-button";
  }

  const BULK_ADD_TAG_ICON = "card-workspace-tag-plus";
  const BULK_REMOVE_TAG_ICON = "card-workspace-tag-minus";

  interface ToolbarProps {
    strings?: ToolbarStrings;
    boxStrings?: BoxStrings;
    activeBoxId?: string | null;
    activeBoxName?: string | null;
    folderPath?: string;
    activeFilterTags?: string[];
    navVisible?: boolean;
    onToggleNavPane?: () => void;
    sortField?: string;
    sortDirection?: string;
    tooltipSide?: "top" | "right" | "bottom" | "left";
    searchQuery?: string;
    searchStatus?: SearchStatus;
    searchIndexReadiness?: import("./types").SearchIndexReadinessState;
    searchIndexPersistence?: import("./types").SearchIndexPersistenceHealth;
    searchIndexRebuildReason?: import("./types").SearchIndexRebuildReason | null;
    bulkMode?: boolean;
    selectedCount?: number;
    bulkAnchorPath?: string | null;
    canBulkSelectAll?: boolean;
    canBulkClearSelection?: boolean;
    canBulkMoveSelected?: boolean;
    canBulkAddTagSelected?: boolean;
    canBulkRemoveTagSelected?: boolean;
    canBulkDeleteSelected?: boolean;
    canBulkMergeSelected?: boolean;
    onToolbarAction?: (payload: ToolbarActionPayload) => void;
    onSortChange?: (payload: SortChangePayload) => void;
    onSearchQueryChange?: (payload: SearchQueryChangePayload) => void;
    onSearchQueryReset?: (payload: SearchQueryResetPayload) => void;
    onBoxCommand?: (payload: BoxCommandPayload) => void;
  }

  interface SortOption {
    field: string;
    direction: string;
    label: string;
  }

  interface SortSeparatorOption {
    type: "separator";
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

  type SortMenuOption = SortOption | SortSeparatorOption;
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

  let {
    strings = getUiStrings("en").toolbar,
    boxStrings = getUiStrings("en").box,
    activeBoxId = null,
    activeBoxName = null,
    folderPath = "",
    activeFilterTags = [],
    navVisible = false,
    onToggleNavPane,
    sortField = "mtime",
    sortDirection = "desc",
    tooltipSide = "right",
    searchQuery = "",
    searchStatus = "idle",
    searchIndexReadiness = "ready",
    searchIndexPersistence = "healthy",
    searchIndexRebuildReason = null,
    bulkMode = false,
    selectedCount = 0,
    bulkAnchorPath = null,
    canBulkSelectAll = false,
    canBulkClearSelection = false,
    canBulkMoveSelected = false,
    canBulkAddTagSelected = false,
    canBulkRemoveTagSelected = false,
    canBulkDeleteSelected = false,
    canBulkMergeSelected = false,
    onToolbarAction,
    onSortChange,
    onSearchQueryChange,
    onSearchQueryReset,
    onBoxCommand,
  }: ToolbarProps = $props();
  const sortButtonId = "fce-sort-button";

  const SORT_OPTIONS = $derived<SortMenuOption[]>([
    { field: "name", direction: "asc", label: strings.sortOptions.nameAsc },
    { field: "name", direction: "desc", label: strings.sortOptions.nameDesc },
    { type: "separator" },
    { field: "mtime", direction: "desc", label: strings.sortOptions.mtimeDesc },
    { field: "mtime", direction: "asc", label: strings.sortOptions.mtimeAsc },
    { type: "separator" },
    { field: "ctime", direction: "desc", label: strings.sortOptions.ctimeDesc },
    { field: "ctime", direction: "asc", label: strings.sortOptions.ctimeAsc },
  ]);

  const TOOLBAR_ACTIONS = $derived<ToolbarActionOption[]>([
    { id: "new-note", label: strings.actions.newNote, title: strings.actions.newNoteTitle, icon: "square-pen" },
    { id: "sort", label: strings.actions.sort, title: strings.actions.sortTitle, icon: "arrow-up-narrow-wide" },
    { id: "bulk", label: strings.actions.bulk, title: strings.actions.bulkTitle, icon: "check-check" },
  ]);
  const TRANSIENT_TOOLBAR_ACTION_IDS = new Set(["new-note"]);

  function isSortSeparatorOption(option: SortMenuOption): option is SortSeparatorOption {
    return "type" in option;
  }

  let activeToolbarAction = $state("");
  let showSortMenu = $state(false);
  let sortMenuX = $state(0);
  let sortMenuY = $state(0);

  let sortButtonEl: HTMLElement | null = null;
  let sortMenuEl: HTMLElement | null = null;

  const isBoxMode = $derived(activeBoxId !== null);

  function formatScopeTag(tag: string): string {
    return tag.startsWith("#") ? tag : `#${tag}`;
  }

  const isVaultRootScope = $derived(folderPath === "/" || folderPath === "");
  const folderScopeName = $derived(
    isVaultRootScope ? strings.folderMenu.rootFolder : (folderPath.split("/").pop() ?? folderPath),
  );
  const folderScopeFullLabel = $derived(
    isVaultRootScope ? strings.folderMenu.rootFolder : folderPath,
  );
  const tagScopeLabel = $derived(activeFilterTags.map(formatScopeTag).join(", "));

  function joinScope(folderLabel: string): string {
    return tagScopeLabel.length > 0
      ? `${folderLabel}${strings.scope.separator}${tagScopeLabel}`
      : folderLabel;
  }

  const scopeText = $derived(isBoxMode ? (activeBoxName ?? "") : joinScope(folderScopeName));
  const scopeTooltip = $derived(isBoxMode ? (activeBoxName ?? "") : joinScope(folderScopeFullLabel));

  let searchInputEl = $state<HTMLInputElement | null>(null);
  let searchExpanded = $state(false);

  const bulkSelectionSummary = $derived(strings.bulkSummary(selectedCount));
  const bulkActions = $derived<BulkToolbarOption[]>([
    { id: "bulk-select-all", label: strings.bulkActionLabels.selectAll, icon: "check-square", disabled: !canBulkSelectAll },
    { id: "bulk-clear-selection", label: strings.bulkActionLabels.clearSelection, icon: "x-square", disabled: !canBulkClearSelection },
    { type: "separator" },
    { id: "bulk-add-tag-selected", label: strings.bulkActionLabels.addTagSelected, icon: BULK_ADD_TAG_ICON, disabled: !canBulkAddTagSelected },
    { id: "bulk-remove-tag-selected", label: strings.bulkActionLabels.removeTagSelected, icon: BULK_REMOVE_TAG_ICON, disabled: !canBulkRemoveTagSelected },
    { type: "separator" },
    { id: "bulk-move-selected", label: strings.bulkActionLabels.moveSelected, icon: "folder-input", disabled: !canBulkMoveSelected },
    { id: "bulk-add-to-box", label: boxStrings.bulkAddToBox, icon: "gallery-horizontal", disabled: !canBulkClearSelection },
    { id: "bulk-merge-selected", label: strings.bulkActionLabels.mergeSelected, icon: "combine", disabled: !canBulkMergeSelected },
    { id: "bulk-delete-selected", label: strings.bulkActionLabels.deleteSelected, icon: "trash-2", disabled: !canBulkDeleteSelected, danger: true },
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
    getSearchStatusLabel(strings.searchStatus, searchStatus, searchIndexReadiness, searchIndexPersistence, searchIndexRebuildReason),
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

  function selectToolbarAction(actionId: string, event: MouseEvent): void {
    if (actionId === "sort") {
      if (showSortMenu) {
        closeSortMenu();
      } else {
        sortMenuX = event.clientX;
        sortMenuY = event.clientY;
        showSortMenu = true;
      }
      return;
    }

    closeSortMenu();
    if (!TRANSIENT_TOOLBAR_ACTION_IDS.has(actionId)) {
      activeToolbarAction = actionId;
    }
    onToolbarAction?.({ action: actionId });
  }

  function selectSortOption(option: SortOption): void {
    closeSortMenu();
    if (option.field === sortField && option.direction === sortDirection) {
      return;
    }

    onSortChange?.({
      field: option.field,
      direction: option.direction,
    });
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

  function closeSortMenu(): void {
    showSortMenu = false;
  }

  function emitBoxCommand(command: string, boxId?: string): void {
    onBoxCommand?.(boxId === undefined ? { command } : { command, boxId });
  }

  const sortMenuAction = createPopupPortalAction({
    getButton: () => sortButtonEl,
    setMenu: (node) => {
      sortMenuEl = node;
    },
    close: closeSortMenu,
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
        closeSortMenu();
        tick().then(() => {
          searchInputEl?.focus();
        });
      }
    }
</script>

<header class="fce-header {bulkMode ? 'is-bulk-mode' : ''}">
  <div class="fce-toolbar" role="toolbar" aria-label={strings.actions.toolbarAriaLabel}>
    <div class="fce-toolbar-buttons">
      <button
        type="button"
        class="clickable-icon fce-toolbar-button"
        aria-label={navVisible ? strings.navPane.collapsePane : strings.navPane.expandPane}
        aria-pressed={navVisible}
        onclick={() => onToggleNavPane?.()}
        use:applyIcon={navVisible ? "panel-left-close" : "panel-left-open"}
        use:applyTooltip={navVisible ? strings.navPane.collapsePane : strings.navPane.expandPane}
      >
        <span class="fce-sr-only">{navVisible ? strings.navPane.collapsePane : strings.navPane.expandPane}</span>
      </button>
      <div class="fce-toolbar-scope {isBoxMode ? 'is-box' : ''}" use:applyTooltip={scopeTooltip}>
        <span class="fce-sr-only">{strings.scope.ariaLabel}</span>
        <span class="fce-toolbar-scope-text">{scopeText}</span>
      </div>
      <div class="fce-toolbar-actions">
        {#if isBoxMode}
          <button
            type="button"
            class="clickable-icon fce-toolbar-button {showSortMenu ? 'is-selected' : ''}"
            id={sortButtonId}
            aria-label={boxStrings.sortTitle}
            onclick={(event) => selectToolbarAction("sort", event)}
            use:applyIcon={"arrow-up-narrow-wide"}
            use:captureSortButton
          >
            <span class="fce-sr-only">{boxStrings.sortTitle}</span>
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
            aria-label={strings.actions.bulkTitle}
            onclick={(event) => selectToolbarAction("bulk", event)}
            use:applyIcon={"check-check"}
          >
            <span class="fce-sr-only">{strings.actions.bulk}</span>
          </button>
        {:else}
          {#each TOOLBAR_ACTIONS as action}
            {#if action.id === "sort"}
              <button
                type="button"
                class="clickable-icon fce-toolbar-button {showSortMenu ? 'is-selected' : ''}"
                id={sortButtonId}
                aria-label={action.title}
                onclick={(event) => selectToolbarAction(action.id, event)}
                use:applyIcon={action.icon}
                use:captureSortButton
              >
                <span class="fce-sr-only">{action.label}</span>
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
        {/if}
        <button
          type="button"
          class="clickable-icon fce-toolbar-button {(searchExpanded || hasSearchQuery) ? 'is-selected' : ''}"
          aria-label={strings.actions.toggleSearch}
          onclick={toggleSearch}
          use:applyIcon={"search"}
        >
          <span class="fce-sr-only">{strings.actions.toggleSearch}</span>
        </button>
      </div>
    </div>
  </div>

  {#if searchExpanded}
    <div class="fce-toolbar-search-row {bulkMode ? 'is-bulk-mode' : ''}">
      <div class="fce-toolbar-search" role="search">
        <label class="fce-sr-only" for="fce-search-input">{strings.search.inputLabel}</label>
        <input
          bind:this={searchInputEl}
          id="fce-search-input"
          class="fce-search-input"
          type="search"
          aria-label={strings.search.inputLabel}
          placeholder={strings.search.placeholder}
          value={searchQuery}
          oninput={handleSearchInput}
        />
        {#if hasSearchQuery}
          <button
            type="button"
            class="clickable-icon fce-search-clear"
            aria-label={strings.search.clear}
            onclick={clearSearchQuery}
            use:applyIcon={"x"}
          >
            <span class="fce-sr-only">{strings.search.clear}</span>
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
    <div class="fce-toolbar-bulk-strip" role="group" aria-label={strings.actions.bulkTitle}>
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

{#if showSortMenu}
  <div
    class="fce-popup-menu fce-sort-menu"
    role="menu"
    aria-labelledby={sortButtonId}
    style="left: {sortMenuX}px; top: {sortMenuY}px;"
    use:sortMenuAction
  >
    {#each SORT_OPTIONS as option}
      {#if isSortSeparatorOption(option)}
        <div class="fce-sort-menu-separator" role="separator" aria-hidden="true"></div>
      {:else}
        {@const selected = sortField === option.field && sortDirection === option.direction}
        <button
          type="button"
          class="fce-popup-row fce-sort-menu-item"
          role="menuitemradio"
          aria-checked={selected}
          onclick={() => selectSortOption(option)}
        >
          <span class="fce-popup-row-content">
            <span class="fce-sort-menu-item-label">{option.label}</span>
          </span>
          <span class="fce-popup-row-trailing" aria-hidden={!selected}>
            {#if selected}
              <span class="fce-popup-row-selected-indicator fce-sort-menu-item-check" use:applyIcon={"check"}></span>
            {/if}
          </span>
        </button>
      {/if}
    {/each}
  </div>
{/if}
