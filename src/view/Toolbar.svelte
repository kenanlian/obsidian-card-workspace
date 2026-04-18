<script lang="ts">
  import { setIcon, setTooltip } from "obsidian";
  import type { FolderTreeNode } from "./types";

  interface ToolbarActionPayload {
    action: string;
  }

  interface SortChangePayload {
    field: string;
    direction: string;
  }

  interface FilterChangePayload {
    tags: string[];
  }

  interface IncludeSubfoldersChangePayload {
    value: boolean;
  }

  interface SelectFolderPayload {
    path: string;
  }

  interface ToolbarProps {
    folderPath?: string;
    sortField?: string;
    sortDirection?: string;
    folderTree?: FolderTreeNode[];
    tooltipSide?: "top" | "right" | "bottom" | "left";
    availableTags?: string[];
    activeFilterTags?: string[];
    includeSubfolders?: boolean;
    isAllNotesScope?: boolean;
    bulkMode?: boolean;
    selectedCount?: number;
    bulkAnchorPath?: string | null;
    canBulkSelectAll?: boolean;
    canBulkClearSelection?: boolean;
    canBulkMoveSelected?: boolean;
    canBulkTrashSelected?: boolean;
    canBulkDeleteSelected?: boolean;
    canBulkMergeSelected?: boolean;
    onToolbarAction?: (payload: ToolbarActionPayload) => void;
    onSortChange?: (payload: SortChangePayload) => void;
    onFilterChange?: (payload: FilterChangePayload) => void;
    onIncludeSubfoldersChange?: (payload: IncludeSubfoldersChangePayload) => void;
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

  interface ToolbarActionOption {
    id: string;
    label: string;
    title: string;
    icon: string;
  }

  let {
    folderPath = "",
    sortField = "mtime",
    sortDirection = "desc",
    folderTree = [],
    tooltipSide = "right",
    availableTags = [],
    activeFilterTags = [],
    includeSubfolders = true,
    isAllNotesScope = false,
    bulkMode = false,
    selectedCount = 0,
    bulkAnchorPath = null,
    canBulkSelectAll = false,
    canBulkClearSelection = false,
    canBulkMoveSelected = false,
    canBulkTrashSelected = false,
    canBulkDeleteSelected = false,
    canBulkMergeSelected = false,
    onToolbarAction,
    onSortChange,
    onFilterChange,
    onIncludeSubfoldersChange,
    onSelectFolder,
  }: ToolbarProps = $props();

  const SORT_OPTIONS: SortMenuOption[] = [
    { field: "mtime", direction: "desc", label: "编辑时间（从新到旧）" },
    { field: "mtime", direction: "asc", label: "编辑时间（从旧到新）" },
    { type: "separator" },
    { field: "ctime", direction: "desc", label: "创建时间（从新到旧）" },
    { field: "ctime", direction: "asc", label: "创建时间（从旧到新）" },
  ];

  const TOOLBAR_ACTIONS: ToolbarActionOption[] = [
    { id: "pick-folder", label: "Pick folder", title: "Folder scope", icon: "folder-open" },
    { id: "all-notes", label: "All notes", title: "All notes", icon: "library" },
    { id: "new-note", label: "New", title: "Create note", icon: "file-plus" },
    { id: "sort", label: "Sort", title: "Sort cards", icon: "arrow-up-down" },
    { id: "filter", label: "Filter", title: "Filter cards", icon: "list-filter" },
    { id: "bulk", label: "Bulk", title: "Bulk actions", icon: "check-check" },
  ];

  function isSortSeparatorOption(option: SortMenuOption): option is SortSeparatorOption {
    return "type" in option;
  }

  let localActiveFilterTags = $state<string[]>([]);
  let activeToolbarAction = $state(TOOLBAR_ACTIONS[0].id);
  let showSortMenu = $state(false);
  let sortMenuX = $state(0);
  let sortMenuY = $state(0);
  let folderMenuX = $state(0);
  let folderMenuY = $state(0);
  let showFolderMenu = $state(false);
  let showFilterMenu = $state(false);
  let filterMenuX = $state(0);
  let filterMenuY = $state(0);
  let expandedPaths = $state<Set<string>>(new Set());
  let folderMenuExpandedForPath = $state<string | null>(null);

  let sortButtonEl: HTMLElement | null = null;
  let filterButtonEl: HTMLElement | null = null;
  let filterMenuEl: HTMLElement | null = null;
  let folderButtonEl: HTMLElement | null = null;
  let folderMenuEl: HTMLElement | null = null;
  let sortMenuEl: HTMLElement | null = null;

  const bulkSelectionSummary = $derived(selectedCount === 1 ? "1 selected" : `${selectedCount} selected`);
  const bulkModeStatus = $derived(bulkMode ? "Bulk mode active" : "Browsing notes");
  const bulkActionHint = $derived(
    selectedCount === 0
      ? "Select notes to enable move, trash, delete, and merge."
      : selectedCount === 1
        ? "Move, trash, and delete are ready. Merge unlocks with 2 notes."
        : "All bulk actions are ready.",
  );
  const bulkActions = $derived([
    { id: "bulk-select-all", label: "Select all", disabled: !canBulkSelectAll },
    { id: "bulk-clear-selection", label: "Clear", disabled: !canBulkClearSelection },
    { id: "bulk-move-selected", label: "Move", disabled: !canBulkMoveSelected },
    { id: "bulk-trash-selected", label: "Trash", disabled: !canBulkTrashSelected },
    { id: "bulk-delete-selected", label: "Delete", disabled: !canBulkDeleteSelected },
    { id: "bulk-merge-selected", label: "Merge", disabled: !canBulkMergeSelected },
  ]);

  const hasFolderScope = $derived(!isAllNotesScope && folderPath.length > 0);
  const hasTagFilter = $derived(localActiveFilterTags.length > 0);
  const scopeSummary = $derived(
    isAllNotesScope
      ? "All Notes"
      : hasFolderScope
        ? folderPath
        : "No folder selected",
  );
  const tagSummary = $derived(
    hasTagFilter
      ? `Tag filter: ${localActiveFilterTags.length} active`
      : "Tag filter: off",
  );
  const subfolderSummary = $derived(
    hasFolderScope
      ? `Subfolders: ${includeSubfolders ? "included" : "direct only"}`
      : "",
  );

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

  $effect(() => {
    if (!showFilterMenu) {
      localActiveFilterTags = activeFilterTags;
    }
  });

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
        showSortMenu = false;
      } else {
        sortMenuX = event.clientX;
        sortMenuY = event.clientY;
        showSortMenu = true;
        showFolderMenu = false;
        showFilterMenu = false;
      }
      return;
    }

    if (actionId === "filter") {
      if (showFilterMenu) {
        showFilterMenu = false;
      } else {
        filterMenuX = event.clientX;
        filterMenuY = event.clientY;
        localActiveFilterTags = [...activeFilterTags];
        showFilterMenu = true;
        showSortMenu = false;
        showFolderMenu = false;
      }
      return;
    }

    if (actionId === "pick-folder") {
      if (showFolderMenu) {
        showFolderMenu = false;
      } else {
        folderMenuX = event.clientX;
        folderMenuY = event.clientY;
        showFolderMenu = true;
        showSortMenu = false;
        showFilterMenu = false;
        onToolbarAction?.({ action: actionId });
      }
      return;
    }

    showSortMenu = false;
    showFolderMenu = false;
    showFilterMenu = false;
    activeToolbarAction = actionId;
    onToolbarAction?.({ action: actionId });
  }

  function toggleFilterTag(tag: string): void {
    const normalized = tag.trim().toLowerCase().replace(/^#/, "");
    let nextTags: string[];
    if (localActiveFilterTags.includes(normalized)) {
      nextTags = localActiveFilterTags.filter((candidateTag) => candidateTag !== normalized);
    } else {
      nextTags = [...localActiveFilterTags, normalized];
    }
    localActiveFilterTags = nextTags;
    onFilterChange?.({ tags: nextTags });
  }

  function selectSortOption(option: SortOption): void {
    showSortMenu = false;
    if (option.field === sortField && option.direction === sortDirection) {
      return;
    }

    onSortChange?.({
      field: option.field,
      direction: option.direction,
    });
  }

  function onSortMenuClickOutside(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Node) {
      if (sortButtonEl && sortButtonEl.contains(target)) {
        return;
      }
      if (sortMenuEl && sortMenuEl.contains(target)) {
        return;
      }
    }
    showSortMenu = false;
  }

  function captureSortButton(node: HTMLElement): { destroy: () => void } {
    sortButtonEl = node;
    return {
      destroy() {
        sortButtonEl = null;
      },
    };
  }

  function captureFolderButton(node: HTMLElement): { destroy: () => void } {
    folderButtonEl = node;
    return {
      destroy() {
        folderButtonEl = null;
      },
    };
  }

  function sortMenuAction(node: HTMLElement): { destroy: () => void } {
    sortMenuEl = node;
    document.body.appendChild(node);
    document.addEventListener("click", onSortMenuClickOutside, true);
    return {
      destroy() {
        document.removeEventListener("click", onSortMenuClickOutside, true);
        sortMenuEl = null;
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      },
    };
  }

  function onFilterMenuClickOutside(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Node) {
      if (filterButtonEl && filterButtonEl.contains(target)) {
        return;
      }
      if (filterMenuEl && filterMenuEl.contains(target)) {
        return;
      }
    }
    showFilterMenu = false;
  }

  function captureFilterButton(node: HTMLElement): { destroy: () => void } {
    filterButtonEl = node;
    return {
      destroy() {
        filterButtonEl = null;
      },
    };
  }

  function filterMenuAction(node: HTMLElement): { destroy: () => void } {
    filterMenuEl = node;
    document.body.appendChild(node);
    document.addEventListener("click", onFilterMenuClickOutside, true);
    return {
      destroy() {
        document.removeEventListener("click", onFilterMenuClickOutside, true);
        filterMenuEl = null;
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      },
    };
  }

  function onFolderMenuClickOutside(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Node) {
      if (folderButtonEl && folderButtonEl.contains(target)) {
        return;
      }
      if (folderMenuEl && folderMenuEl.contains(target)) {
        return;
      }
    }
    showFolderMenu = false;
  }

  function folderMenuAction(node: HTMLElement): { destroy: () => void } {
    folderMenuEl = node;
    document.body.appendChild(node);
    document.addEventListener("click", onFolderMenuClickOutside, true);
    return {
      destroy() {
        document.removeEventListener("click", onFolderMenuClickOutside, true);
        folderMenuEl = null;
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      },
    };
  }

  function getFolderButtonText(): string {
    if (hasFolderScope) {
      return folderPath.split("/").filter(Boolean).pop() || folderPath;
    }

    return "Select folder";
  }

  function toggleIncludeSubfolders(): void {
    if (!hasFolderScope) {
      return;
    }

    onIncludeSubfoldersChange?.({ value: !includeSubfolders });
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
</script>

<header class="fce-header {bulkMode ? 'is-bulk-mode' : ''}">
  <div class="fce-toolbar" role="toolbar" aria-label="Folder card actions">
    <div class="fce-toolbar-buttons">
      {#each TOOLBAR_ACTIONS as action}
        {#if action.id === "pick-folder"}
          <button
            type="button"
            class="fce-folder-button {showFolderMenu || hasFolderScope ? 'is-selected' : ''}"
            aria-label={action.title}
            onclick={(event) => selectToolbarAction(action.id, event)}
            use:captureFolderButton
          >
            <span class="fce-folder-button-text">
              {getFolderButtonText()}
            </span>
            <span use:applyIcon={"chevron-down"}></span>
          </button>
        {:else if action.id === "sort"}
          <button
            type="button"
            class="clickable-icon fce-toolbar-button {showSortMenu ? 'is-selected' : ''}"
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
            class="clickable-icon fce-toolbar-button {showFilterMenu || localActiveFilterTags.length > 0 ? 'is-selected' : ''}"
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
            class="clickable-icon fce-toolbar-button {(action.id === 'all-notes' ? isAllNotesScope : action.id === 'bulk' ? bulkMode : activeToolbarAction === action.id) ? 'is-selected' : ''}"
            aria-label={action.title}
            onclick={(event) => selectToolbarAction(action.id, event)}
            use:applyIcon={action.icon}
          >
            <span class="fce-sr-only">{action.label}</span>
          </button>
        {/if}
      {/each}
    </div>
  </div>

  <div class="fce-toolbar-content-row {bulkMode ? 'is-bulk-mode' : ''}">
    <div class="fce-toolbar-content">
      <span class="fce-toolbar-summary-segment"><strong>Scope:</strong> {scopeSummary}</span>
      <span class="fce-toolbar-summary-segment"><strong>{tagSummary}</strong></span>
      {#if bulkMode}
        <span class="fce-toolbar-summary-segment"><strong>Status:</strong> {bulkModeStatus}</span>
      {/if}
      {#if hasFolderScope}
        <span class="fce-toolbar-summary-segment">{subfolderSummary}</span>
      {/if}
    </div>

    {#if hasFolderScope}
      <button
        type="button"
        class="fce-toolbar-toggle {includeSubfolders ? 'is-selected' : ''}"
        aria-label={includeSubfolders ? 'Including subfolders' : 'Direct folder only'}
        aria-pressed={includeSubfolders}
        onclick={toggleIncludeSubfolders}
      >
        <span class="fce-toolbar-toggle-label">Subfolders</span>
        <span class="fce-toolbar-toggle-value">{includeSubfolders ? "On" : "Off"}</span>
      </button>
    {/if}
  </div>

  {#if bulkMode}
    <div class="fce-toolbar-bulk-strip" role="group" aria-label="Bulk actions">
      <div class="fce-toolbar-bulk-summary">
        <span class="fce-toolbar-bulk-mode-pill">Bulk mode</span>
        <span class="fce-toolbar-bulk-count">{selectedCount}</span>
        <span>{bulkSelectionSummary}</span>
        <span class="fce-toolbar-summary-segment">{bulkAnchorPath ? "Range anchor ready" : "Range anchor idle"}</span>
        <span class="fce-toolbar-summary-segment">{bulkActionHint}</span>
      </div>

      <div class="fce-toolbar-bulk-actions">
        {#each bulkActions as action}
          <button
            type="button"
            class="fce-toolbar-bulk-button"
            disabled={action.disabled}
            onclick={() => emitToolbarAction(action.id)}
          >
            {action.label}
          </button>
        {/each}
        <button
          type="button"
          class="fce-toolbar-bulk-button is-exit"
          onclick={() => emitToolbarAction("bulk")}
        >
          Exit Bulk
        </button>
      </div>
    </div>
  {/if}
</header>

{#if showSortMenu}
  <div
    class="fce-sort-menu"
    role="menu"
    style="left: {sortMenuX}px; top: {sortMenuY}px;"
    use:sortMenuAction
  >
    {#each SORT_OPTIONS as option}
      {#if isSortSeparatorOption(option)}
        <div class="fce-sort-menu-separator"></div>
      {:else}
        {@const selected = sortField === option.field && sortDirection === option.direction}
        <button
          type="button"
          class="fce-sort-menu-item"
          role="menuitemradio"
          aria-checked={selected}
          onclick={() => selectSortOption(option)}
        >
          <span class="fce-sort-menu-item-label">{option.label}</span>
          {#if selected}
            <span class="fce-sort-menu-item-check" use:applyIcon={"check"}></span>
          {/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

{#if showFolderMenu}
  <div
    class="fce-folder-menu"
    role="menu"
    style="left: {folderMenuX}px; top: {folderMenuY}px;"
    use:folderMenuAction
  >
    {#each visibleFolderNodes as node}
      <div
        class="fce-folder-tree-item {node.path === folderPath ? 'is-selected' : ''}"
        role="menuitem"
        style="padding-left: {node.depth * 16 + 8}px;"
        use:applyTooltip={node.name}
        onclick={() => {
          onSelectFolder?.({ path: node.path });
          showFolderMenu = false;
        }}
      >
        {#if node.children.length > 0}
          <span
            class="fce-folder-tree-chevron"
            onclick={(event) => onFolderChevronClick(event, node.path)}
            use:applyIcon={expandedPaths.has(node.path) ? "chevron-down" : "chevron-right"}
          ></span>
        {:else}
          <span class="fce-folder-tree-chevron" style="pointer-events: none; visibility: hidden;"></span>
        {/if}
        <span class="fce-folder-tree-name">{node.name}</span>
      </div>
    {/each}
  </div>
{/if}


{#if showFilterMenu}
  <div
    class="fce-filter-menu fce-sort-menu"
    role="menu"
    style="left: {filterMenuX}px; top: {filterMenuY}px;"
    use:filterMenuAction
  >
    {#if availableTags.length === 0}
      <div class="fce-sort-menu-item" style="cursor: default; color: var(--text-muted);">
        <span class="fce-sort-menu-item-label">No tags found</span>
      </div>
    {:else}
      {#each availableTags as tag}
        {@const normalizedTag = tag.trim().toLowerCase().replace(/^#/, "")}
        {@const selected = localActiveFilterTags.includes(normalizedTag)}
        <button
          type="button"
          class="fce-sort-menu-item"
          role="menuitemcheckbox"
          aria-checked={selected}
          onclick={() => toggleFilterTag(tag)}
        >
          <span class="fce-sort-menu-item-label">{tag}</span>
          {#if selected}
            <span class="fce-sort-menu-item-check" use:applyIcon={"check"}></span>
          {/if}
        </button>
      {/each}
    {/if}
  </div>
{/if}
