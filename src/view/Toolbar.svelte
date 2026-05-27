<script lang="ts">
  import { setIcon, setTooltip } from "obsidian";
  import { tick } from "svelte";
  import { getUiStrings, type ToolbarStrings } from "../i18n";
  import {
    buildTagTree,
    collectAncestorTagPaths,
    flattenVisibleTagTree,
    normalizeTagPath,
    type TagTreeNode,
  } from "./tag-tree";
  import type { FolderTreeNode, SearchStatus } from "./types";

  interface ToolbarActionPayload {
    action: string;
  }

  interface SortChangePayload {
    field: string;
    direction: string;
  }

  interface IncludeSubfoldersChangePayload {
    value: boolean;
  }

  interface SearchQueryChangePayload {
    query: string;
  }

  interface SearchQueryResetPayload {
    source: "clear-button";
  }

  interface FilterChangePayload {
    tags: string[];
  }

  interface SelectFolderPayload {
    path: string;
  }

  interface ToolbarProps {
    strings?: ToolbarStrings;
    folderPath?: string;
    sortField?: string;
    sortDirection?: string;
    folderTree?: FolderTreeNode[];
    availableTags?: string[];
    tooltipSide?: "top" | "right" | "bottom" | "left";
    activeFilterTags?: string[];
    includeSubfolders?: boolean;
    searchQuery?: string;
    searchStatus?: SearchStatus;
    searchIndexReadiness?: import("./types").SearchIndexReadinessState;
    searchIndexPersistence?: import("./types").SearchIndexPersistenceHealth;
    searchIndexRebuildReason?: import("./types").SearchIndexRebuildReason | null;
    isAllNotesScope?: boolean;
    bulkMode?: boolean;
    selectedCount?: number;
    bulkAnchorPath?: string | null;
    canBulkSelectAll?: boolean;
    canBulkClearSelection?: boolean;
    canBulkMoveSelected?: boolean;
    canBulkDeleteSelected?: boolean;
    canBulkMergeSelected?: boolean;
    onToolbarAction?: (payload: ToolbarActionPayload) => void;
    onFilterChange?: (payload: FilterChangePayload) => void;
    onSortChange?: (payload: SortChangePayload) => void;
    onIncludeSubfoldersChange?: (payload: IncludeSubfoldersChangePayload) => void;
    onSearchQueryChange?: (payload: SearchQueryChangePayload) => void;
    onSearchQueryReset?: (payload: SearchQueryResetPayload) => void;
    onSelectFolder?: (payload: SelectFolderPayload) => void;
  }

  interface SortOption {
    field: string;
    direction: string;
    label: string;
  }

  interface SortSeparatorOption {
    type: "separator";
  }

  type SortMenuOption = SortOption | SortSeparatorOption;

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
    folderPath = "",
    sortField = "mtime",
    sortDirection = "desc",
    folderTree = [],
    availableTags = [],
    tooltipSide = "right",
    activeFilterTags = [],
    includeSubfolders = true,
    searchQuery = "",
    searchStatus = "idle",
    searchIndexReadiness = "ready",
    searchIndexPersistence = "healthy",
    searchIndexRebuildReason = null,
    isAllNotesScope = false,
    bulkMode = false,
    selectedCount = 0,
    bulkAnchorPath = null,
    canBulkSelectAll = false,
    canBulkClearSelection = false,
    canBulkMoveSelected = false,
    canBulkDeleteSelected = false,
    canBulkMergeSelected = false,
    onToolbarAction,
    onFilterChange,
    onSortChange,
    onIncludeSubfoldersChange,
    onSearchQueryChange,
    onSearchQueryReset,
    onSelectFolder,
  }: ToolbarProps = $props();
  const folderScopeButtonId = "fce-folder-scope-button";
  const sortButtonId = "fce-sort-button";
  const tagFilterButtonId = "fce-tag-filter-button";

  const SORT_OPTIONS = $derived<SortMenuOption[]>([
    { field: "mtime", direction: "desc", label: strings.sortOptions.mtimeDesc },
    { field: "mtime", direction: "asc", label: strings.sortOptions.mtimeAsc },
    { type: "separator" },
    { field: "ctime", direction: "desc", label: strings.sortOptions.ctimeDesc },
    { field: "ctime", direction: "asc", label: strings.sortOptions.ctimeAsc },
  ]);

  const TOOLBAR_ACTIONS = $derived<ToolbarActionOption[]>([
    { id: "pick-folder", label: strings.actions.pickFolder, title: strings.actions.pickFolderTitle, icon: "folder-open" },
    { id: "new-note", label: strings.actions.newNote, title: strings.actions.newNoteTitle, icon: "square-pen" },
    { id: "sort", label: strings.actions.sort, title: strings.actions.sortTitle, icon: "arrow-up-narrow-wide" },
    { id: "filter", label: strings.actions.filter, title: strings.actions.filterTitle, icon: "tags" },
    { id: "bulk", label: strings.actions.bulk, title: strings.actions.bulkTitle, icon: "check-check" },
  ]);
  const TRANSIENT_TOOLBAR_ACTION_IDS = new Set(["new-note"]);

  function isSortSeparatorOption(option: SortMenuOption): option is SortSeparatorOption {
    return "type" in option;
  }

  let activeToolbarAction = $state("pick-folder");
  let showSortMenu = $state(false);
  let sortMenuX = $state(0);
  let sortMenuY = $state(0);
  let folderMenuX = $state(0);
  let folderMenuY = $state(0);
  let showFolderMenu = $state(false);
  let tagMenuX = $state(0);
  let tagMenuY = $state(0);
  let showTagMenu = $state(false);
  let expandedPaths = $state<Set<string>>(new Set());
  let expandedTagPaths = $state<Set<string>>(new Set());
  let folderMenuExpandedForPath = $state<string | null>(null);

  let sortButtonEl: HTMLElement | null = null;
  let folderButtonEl: HTMLElement | null = null;
  let filterButtonEl: HTMLElement | null = null;
  let folderMenuEl: HTMLElement | null = null;
  let sortMenuEl: HTMLElement | null = null;
  let tagMenuEl: HTMLElement | null = null;

  let searchInputEl = $state<HTMLInputElement | null>(null);
  let searchExpanded = $state(false);

  const bulkSelectionSummary = $derived(strings.bulkSummary(selectedCount));
  const bulkActions = $derived([
    { id: "bulk-select-all", label: strings.bulkActionLabels.selectAll, icon: "check-square", disabled: !canBulkSelectAll },
    { id: "bulk-clear-selection", label: strings.bulkActionLabels.clearSelection, icon: "x-square", disabled: !canBulkClearSelection },
    { id: "bulk-move-selected", label: strings.bulkActionLabels.moveSelected, icon: "folder-input", disabled: !canBulkMoveSelected },
    { id: "bulk-delete-selected", label: strings.bulkActionLabels.deleteSelected, icon: "trash-2", disabled: !canBulkDeleteSelected },
    { id: "bulk-merge-selected", label: strings.bulkActionLabels.mergeSelected, icon: "combine", disabled: !canBulkMergeSelected },
  ]);

  const hasFolderScope = $derived(!isAllNotesScope && folderPath.length > 0);
  const hasTagFilter = $derived(activeFilterTags.length > 0);
  const selectedTag = $derived(activeFilterTags[0] ?? "");
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
  const hasSummary = $derived(hasTagFilter || showSearchStatus);
  const tagTree = $derived(buildTagTree(availableTags));
  const selectedTagDisplay = $derived(findDisplayTag(tagTree, selectedTag) ?? selectedTag);
  const selectedTagSummary = $derived(selectedTagDisplay ? strings.filter.selectedTagSummary(selectedTagDisplay) : "");
  const visibleTagNodes = $derived(flattenVisibleTagTree(tagTree, expandedTagPaths));

  function findDisplayTag(nodes: TagTreeNode[], tag: string): string | null {
    const normalizedTag = normalizeTagPath(tag);
    if (normalizedTag.length === 0) {
      return null;
    }

    const pendingNodes = [...nodes];
    while (pendingNodes.length > 0) {
      const node = pendingNodes.shift();
      if (!node) {
        continue;
      }

      if (node.tag === normalizedTag) {
        return node.displayTag;
      }

      pendingNodes.push(...node.children);
    }

    return null;
  }

  function flattenVisibleTree(tree: FolderTreeNode[], expanded: Set<string>): FolderTreeNode[] {
    const result: FolderTreeNode[] = [];

    function walk(nodes: FolderTreeNode[]): void {
      for (const node of nodes) {
        result.push(node);
        if (node.children.length > 0 && expanded.has(node.path)) {
          walk(node.children);
        }
      }
    }

    walk(tree);
    return result;
  }

  const visibleFolderNodes = $derived(flattenVisibleTree(folderTree, expandedPaths));
  function isRootFolderNode(node: FolderTreeNode): boolean {
    return node.path === "/";
  }

  function getFolderNodeLabel(node: FolderTreeNode): string {
    return isRootFolderNode(node) ? strings.folderMenu.rootFolder : node.name;
  }

  function isFolderNodeSelected(node: FolderTreeNode): boolean {
    return node.path === folderPath;
  }
  $effect(() => {
    if (!showFolderMenu) {
      folderMenuExpandedForPath = null;
      return;
    }

    if (!hasFolderScope || folderTree.length === 0 || folderMenuExpandedForPath === folderPath) {
      return;
    }

    folderMenuExpandedForPath = folderPath;
    const segments = folderPath.split("/").filter(Boolean);
    let cumPath = "";
    const nextExpanded = new Set(expandedPaths);
    for (const seg of segments) {
      cumPath = cumPath ? `${cumPath}/${seg}` : seg;
      nextExpanded.add(cumPath);
    }
    expandedPaths = nextExpanded;
  });

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
        closeFolderMenu();
        closeTagMenu();
      }
      return;
    }

    if (actionId === "filter") {
      if (showTagMenu) {
        closeTagMenu();
      } else {
        tagMenuX = event.clientX;
        tagMenuY = event.clientY;
        expandedTagPaths = new Set(collectAncestorTagPaths(selectedTag));
        showTagMenu = true;
        closeSortMenu();
        closeFolderMenu();
      }
      return;
    }

    if (actionId === "pick-folder") {
      if (showFolderMenu) {
        closeFolderMenu();
      } else {
        folderMenuX = event.clientX;
        folderMenuY = event.clientY;
        showFolderMenu = true;
        closeSortMenu();
        closeTagMenu();
        onToolbarAction?.({ action: actionId });
      }
      return;
    }

    closeSortMenu();
    closeFolderMenu();
    closeTagMenu();
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

  const captureFolderButton = createElementCapture((node) => {
    folderButtonEl = node;
  });

  const captureFilterButton = createElementCapture((node) => {
    filterButtonEl = node;
  });

  function closeSortMenu(): void {
    showSortMenu = false;
  }

  function closeFolderMenu(): void {
    showFolderMenu = false;
  }

  function closeTagMenu(): void {
    showTagMenu = false;
  }

  const sortMenuAction = createPopupPortalAction({
    getButton: () => sortButtonEl,
    setMenu: (node) => {
      sortMenuEl = node;
    },
    close: closeSortMenu,
    closeOnEscape: true,
  });

  const folderMenuAction = createPopupPortalAction({
    getButton: () => folderButtonEl,
    setMenu: (node) => {
      folderMenuEl = node;
    },
    close: closeFolderMenu,
    closeOnEscape: true,
  });

  const tagMenuAction = createPopupPortalAction({
    getButton: () => filterButtonEl,
    setMenu: (node) => {
      tagMenuEl = node;
    },
    close: closeTagMenu,
    closeOnEscape: true,
  });

  function getFolderButtonText(): string {
    if (hasFolderScope) {
      if (folderPath === "/") {
        return strings.folderMenu.rootFolder;
      }

      return folderPath.split("/").filter(Boolean).pop() || folderPath;
    }

    return strings.actions.selectFolder;
  }

  function toggleIncludeSubfolders(): void {
    if (!hasFolderScope) {
      return;
    }

    onIncludeSubfoldersChange?.({ value: !includeSubfolders });
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
  }

  function emitToolbarAction(actionId: string): void {
    onToolbarAction?.({ action: actionId });
  }

  function onFolderChevronClick(event: MouseEvent, path: string): void {
    event.stopPropagation();
    const next = new Set(expandedPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    expandedPaths = next;
  }

  function onTagChevronClick(event: MouseEvent, tag: string): void {
    event.stopPropagation();
    const next = new Set(expandedTagPaths);
    if (next.has(tag)) {
      next.delete(tag);
    } else {
      next.add(tag);
    }
    expandedTagPaths = next;
  }

  function selectTag(tag: string): void {
    const normalizedTag = normalizeTagPath(tag);
    const normalizedSelectedTag = normalizeTagPath(selectedTag);
    onFilterChange?.({
      tags: normalizedTag.length > 0 && normalizedTag === normalizedSelectedTag ? [] : [normalizedTag],
    });
    closeTagMenu();
  }

  function selectFolder(path: string): void {
    onSelectFolder?.({ path });
    closeFolderMenu();
  }

  function clearSelectedTag(): void {
    onFilterChange?.({ tags: [] });
  }

  function toggleSearch(): void {
    searchExpanded = !searchExpanded;
      if (searchExpanded) {
        closeSortMenu();
        closeFolderMenu();
        closeTagMenu();
        tick().then(() => {
          searchInputEl?.focus();
        });
      }
    }
</script>

<header class="fce-header {bulkMode ? 'is-bulk-mode' : ''}">
  <div class="fce-toolbar" role="toolbar" aria-label={strings.actions.toolbarAriaLabel}>
    <div class="fce-toolbar-buttons">
      {#each TOOLBAR_ACTIONS as action}
        {#if action.id === "pick-folder"}
          <div class="fce-toolbar-folder-group">
            <button
              type="button"
              class="fce-folder-button {showFolderMenu || hasFolderScope ? 'is-selected' : ''}"
              id={folderScopeButtonId}
              aria-label={action.title}
              onclick={(event) => selectToolbarAction(action.id, event)}
              use:captureFolderButton
            >
              <span class="fce-folder-button-text">
                {getFolderButtonText()}
              </span>
              <span class="fce-folder-button-chevron" use:applyIcon={"chevron-down"}></span>
            </button>
          </div>
          {#if hasFolderScope}
            <button
              type="button"
              class="clickable-icon fce-toolbar-button {includeSubfolders ? 'is-selected' : ''}"
              aria-label={includeSubfolders ? strings.folderMenu.includeSubfolders : strings.folderMenu.directFolderOnly}
              aria-pressed={includeSubfolders}
              onclick={toggleIncludeSubfolders}
              use:applyIcon={"folder-tree"}
              use:applyTooltip={includeSubfolders ? strings.folderMenu.includeSubfolders : strings.folderMenu.directFolderOnly}
            >
              <span class="fce-sr-only">{strings.folderMenu.subfoldersSrLabel}</span>
            </button>
          {/if}
        {:else if action.id === "sort"}
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
        {:else if action.id === "filter"}
          <button
            type="button"
            class="clickable-icon fce-toolbar-button {(showTagMenu || activeFilterTags.length > 0) ? 'is-selected' : ''}"
            id={tagFilterButtonId}
            aria-label={action.title}
            onclick={(event) => selectToolbarAction(action.id, event)}
            use:applyIcon={action.icon}
            use:captureFilterButton
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
        class="clickable-icon fce-toolbar-button {(searchExpanded || hasSearchQuery) ? 'is-selected' : ''}"
        aria-label={strings.actions.toggleSearch}
        onclick={toggleSearch}
        use:applyIcon={"search"}
      >
        <span class="fce-sr-only">{strings.actions.toggleSearch}</span>
      </button>
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
        {#if hasTagFilter}
          <span class="fce-toolbar-summary-segment fce-tag-summary"><strong>{selectedTagSummary}</strong></span>
          <button
            type="button"
            class="clickable-icon fce-tag-clear"
            aria-label={strings.filter.selectedTagClearLabel}
            onclick={clearSelectedTag}
            use:applyIcon={"x"}
          >
            <span class="fce-sr-only">{strings.filter.selectedTagClearLabel}</span>
          </button>
        {/if}
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
          <button
            type="button"
            class="clickable-icon fce-toolbar-bulk-button"
            aria-label={action.label}
            disabled={action.disabled}
            onclick={() => emitToolbarAction(action.id)}
            use:applyIcon={action.icon}
            use:applyTooltip={action.label}
          >
            <span class="fce-sr-only">{action.label}</span>
          </button>
        {/each}
        <div style="width: 1px; height: 16px; background: var(--fce-border); margin: 0 4px;"></div>
        <button
          type="button"
          class="clickable-icon fce-toolbar-bulk-button is-exit"
          aria-label={strings.bulkActionLabels.exitBulkMode}
          onclick={() => emitToolbarAction("bulk")}
          use:applyIcon={"x"}
          use:applyTooltip={strings.bulkActionLabels.exitBulkMode}
        >
          <span class="fce-sr-only">{strings.bulkActionLabels.exitBulkMode}</span>
        </button>
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
          <span class="fce-popup-row-leading" aria-hidden="true"></span>
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

{#if showTagMenu}
  <div
    class="fce-popup-menu fce-tag-menu fce-tree-menu"
    role="menu"
    aria-labelledby={tagFilterButtonId}
    style="position: fixed; left: {tagMenuX}px; top: {tagMenuY}px;"
    use:tagMenuAction
  >
    {#if visibleTagNodes.length === 0}
      <div class="fce-tree-empty">{strings.filter.noTagsFound}</div>
    {:else}
      {#each visibleTagNodes as node}
        {@const isSelected = normalizeTagPath(selectedTag) === node.tag}
        <div class="fce-popup-row fce-tree-row {isSelected ? 'is-selected' : ''}" style="padding-left: {node.depth * 16 + 8}px;">
          <div class="fce-popup-row-leading">
            {#if node.hasChildren}
              <button
                type="button"
                class="fce-tree-chevron"
                aria-label={expandedTagPaths.has(node.tag) ? strings.folderMenu.collapse : strings.folderMenu.expand}
                aria-expanded={expandedTagPaths.has(node.tag)}
                onclick={(event) => onTagChevronClick(event, node.tag)}
                use:applyIcon={expandedTagPaths.has(node.tag) ? "chevron-down" : "chevron-right"}
              ></button>
            {:else}
              <span class="fce-tree-chevron is-placeholder" aria-hidden="true"></span>
            {/if}
          </div>
          <div class="fce-popup-row-content">
            <button
              type="button"
              class="fce-tree-button"
              role="menuitemcheckbox"
              aria-checked={isSelected}
              onclick={() => selectTag(node.tag)}
              use:applyTooltip={node.displayTag}
            >
              <span class="fce-tree-label">{node.label}</span>
            </button>
          </div>
          <div class="fce-popup-row-trailing" aria-hidden={!isSelected}>
            {#if isSelected}
              <span class="fce-popup-row-selected-indicator fce-tree-row-check" use:applyIcon={"check"}></span>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>
{/if}

{#if showFolderMenu}
  <div
    class="fce-popup-menu fce-folder-menu fce-tree-menu"
    role="menu"
    aria-labelledby={folderScopeButtonId}
    style="position: fixed; left: {folderMenuX}px; top: {folderMenuY}px;"
    use:folderMenuAction
  >
    {#each visibleFolderNodes as node}
      {@const hasChildren = node.children.length > 0}
      {@const isSelected = isFolderNodeSelected(node)}
      {@const label = getFolderNodeLabel(node)}
      <div class="fce-popup-row fce-tree-row {isSelected ? 'is-selected' : ''}" style="padding-left: {node.depth * 16 + 8}px;">
        <div class="fce-popup-row-leading">
          {#if hasChildren}
            <button
              type="button"
              class="fce-tree-chevron"
              aria-label={expandedPaths.has(node.path) ? strings.folderMenu.collapse : strings.folderMenu.expand}
              aria-expanded={expandedPaths.has(node.path)}
              onclick={(event) => onFolderChevronClick(event, node.path)}
              use:applyIcon={expandedPaths.has(node.path) ? "chevron-down" : "chevron-right"}
            ></button>
          {:else if isRootFolderNode(node)}
            <span class="fce-tree-node-icon" aria-hidden="true" use:applyIcon={"house"}></span>
          {:else}
            <span class="fce-tree-chevron is-placeholder" aria-hidden="true"></span>
          {/if}
        </div>
        <div class="fce-popup-row-content">
          <button
            type="button"
            class="fce-tree-button"
            role="menuitem"
            onclick={() => selectFolder(node.path)}
            use:applyTooltip={label}
          >
            <span class="fce-tree-label">{label}</span>
          </button>
        </div>
        <div class="fce-popup-row-trailing" aria-hidden={!isSelected}>
          {#if isSelected}
            <span class="fce-popup-row-selected-indicator fce-tree-row-check" use:applyIcon={"check"}></span>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
