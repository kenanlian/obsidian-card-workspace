<script>
  import { setIcon, setTooltip } from "obsidian";
  import { createEventDispatcher } from "svelte";

  export let folderPath = "";
  export let sortField = "mtime";
  export let sortDirection = "desc";
  export let folderTree = [];
  export let tooltipSide = "right";
  export let availableTags = [];
  export let activeFilterTags = [];
  export let includeSubfolders = true;
  export let isAllNotesScope = false;
  export let bulkMode = false;
  export let selectedCount = 0;
  export let bulkAnchorPath = null;
  export let canBulkSelectAll = false;
  export let canBulkClearSelection = false;
  export let canBulkMoveSelected = false;
  export let canBulkTrashSelected = false;
  export let canBulkDeleteSelected = false;
  export let canBulkMergeSelected = false;
  
  let localActiveFilterTags = [];
  $: {
    if (!showFilterMenu) {
      localActiveFilterTags = activeFilterTags;
    }
  }

  const dispatch = createEventDispatcher();

  const SORT_OPTIONS = [
    { field: "mtime", direction: "desc", label: "编辑时间（从新到旧）" },
    { field: "mtime", direction: "asc", label: "编辑时间（从旧到新）" },
    { type: "separator" },
    { field: "ctime", direction: "desc", label: "创建时间（从新到旧）" },
    { field: "ctime", direction: "asc", label: "创建时间（从旧到新）" },
  ];

  const TOOLBAR_ACTIONS = [
    { id: "pick-folder", label: "Pick folder", title: "Folder scope", icon: "folder-open" },
    { id: "all-notes", label: "All notes", title: "All notes", icon: "library" },
    { id: "new-note", label: "New", title: "Create note", icon: "file-plus" },
    { id: "sort", label: "Sort", title: "Sort cards", icon: "arrow-up-down" },
    { id: "filter", label: "Filter", title: "Filter cards", icon: "list-filter" },
    { id: "bulk", label: "Bulk", title: "Bulk actions", icon: "check-check" },
  ];

  $: bulkSelectionSummary = selectedCount === 1 ? "1 selected" : `${selectedCount} selected`;
  $: bulkModeStatus = bulkMode ? "Bulk mode active" : "Browsing notes";
  $: bulkActionHint = selectedCount === 0
    ? "Select notes to enable move, trash, delete, and merge."
    : selectedCount === 1
      ? "Move, trash, and delete are ready. Merge unlocks with 2 notes."
      : "All bulk actions are ready.";
  $: bulkActions = [
    { id: "bulk-select-all", label: "Select all", disabled: !canBulkSelectAll },
    { id: "bulk-clear-selection", label: "Clear", disabled: !canBulkClearSelection },
    { id: "bulk-move-selected", label: "Move", disabled: !canBulkMoveSelected },
    { id: "bulk-trash-selected", label: "Trash", disabled: !canBulkTrashSelected },
    { id: "bulk-delete-selected", label: "Delete", disabled: !canBulkDeleteSelected },
    { id: "bulk-merge-selected", label: "Merge", disabled: !canBulkMergeSelected },
  ];

  let activeToolbarAction = TOOLBAR_ACTIONS[0].id;
  let showSortMenu = false;
  let sortButtonEl = null;
  let sortMenuX = 0;
  let sortMenuY = 0;
  let folderMenuX = 0;
  let folderMenuY = 0;
  let showFolderMenu = false;
  let showFilterMenu = false;
  let filterButtonEl = null;
  let filterMenuEl = null;
  let filterMenuX = 0;
  let filterMenuY = 0;
  let folderButtonEl = null;
  let folderMenuEl = null;
  let sortMenuEl = null;
  let expandedPaths = new Set();
  let folderMenuExpandedForPath = null;

  $: hasFolderScope = !isAllNotesScope && folderPath.length > 0;
  $: hasTagFilter = localActiveFilterTags.length > 0;
  $: scopeSummary = isAllNotesScope
    ? "All Notes"
    : hasFolderScope
      ? folderPath
      : "No folder selected";
  $: tagSummary = hasTagFilter
    ? `Tag filter: ${localActiveFilterTags.length} active`
    : "Tag filter: off";
  $: subfolderSummary = hasFolderScope
    ? `Subfolders: ${includeSubfolders ? "included" : "direct only"}`
    : "";

  function flattenVisibleTree(tree, expanded) {
    const result = [];
    function walk(nodes) {
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

  $: visibleFolderNodes = flattenVisibleTree(folderTree, expandedPaths);

  $: if (showFolderMenu && hasFolderScope && folderTree.length > 0 && folderMenuExpandedForPath !== folderPath) {
    folderMenuExpandedForPath = folderPath;
    const segments = folderPath.split("/").filter(Boolean);
    let cumPath = "";
    for (const seg of segments) {
      cumPath = cumPath ? `${cumPath}/${seg}` : seg;
      expandedPaths.add(cumPath);
    }
    expandedPaths = expandedPaths;
  }

  $: if (!showFolderMenu) {
    folderMenuExpandedForPath = null;
  }

  function applyIcon(node, iconName) {
    setIcon(node, iconName);
    return {
      update(nextIconName) {
        setIcon(node, nextIconName);
      },
    };
  }

  function applyTooltip(node, text) {
    setTooltip(node, text, { placement: tooltipSide, gap: 8 });
    return {
      update(nextText) {
        setTooltip(node, nextText, { placement: tooltipSide, gap: 8 });
      },
    };
  }

  function selectToolbarAction(actionId, event) {
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
        dispatch("toolbar-action", { action: actionId });
      }
      return;
    }
    showSortMenu = false;
    showFolderMenu = false;
    showFilterMenu = false;
    activeToolbarAction = actionId;
    dispatch("toolbar-action", { action: actionId });
  }

  function toggleFilterTag(tag) {
    const normalized = tag.trim().toLowerCase().replace(/^#/, "");
    let nextTags;
    if (localActiveFilterTags.includes(normalized)) {
      nextTags = localActiveFilterTags.filter((t) => t !== normalized);
    } else {
      nextTags = [...localActiveFilterTags, normalized];
    }
    localActiveFilterTags = nextTags;
    dispatch("filter-change", { tags: nextTags });
  }

  function selectSortOption(option) {
    showSortMenu = false;
    if (option.field === sortField && option.direction === sortDirection) {
      return;
    }
    dispatch("sort-change", {
      field: option.field,
      direction: option.direction,
    });
  }

  function onSortMenuClickOutside(event) {
    if (sortButtonEl && sortButtonEl.contains(event.target)) {
      return;
    }
    if (sortMenuEl && sortMenuEl.contains(event.target)) {
      return;
    }
    showSortMenu = false;
  }

  function captureSortButton(node) {
    sortButtonEl = node;
    return {
      destroy() {
        sortButtonEl = null;
      },
    };
  }

  function captureFolderButton(node) {
    folderButtonEl = node;
    return {
      destroy() {
        folderButtonEl = null;
      },
    };
  }

  function sortMenuAction(node) {
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

  function onFilterMenuClickOutside(event) {
    if (filterButtonEl && filterButtonEl.contains(event.target)) {
      return;
    }
    if (filterMenuEl && filterMenuEl.contains(event.target)) {
      return;
    }
    showFilterMenu = false;
  }

  function captureFilterButton(node) {
    filterButtonEl = node;
    return {
      destroy() {
        filterButtonEl = null;
      },
    };
  }

  function filterMenuAction(node) {
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

  function onFolderMenuClickOutside(event) {
    if (folderButtonEl && folderButtonEl.contains(event.target)) {
      return;
    }
    if (folderMenuEl && folderMenuEl.contains(event.target)) {
      return;
    }
    showFolderMenu = false;
  }

  function folderMenuAction(node) {
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

  function getFolderButtonText() {
    if (hasFolderScope) {
      return folderPath.split("/").filter(Boolean).pop() || folderPath;
    }

    return "Select folder";
  }

  function toggleIncludeSubfolders() {
    if (!hasFolderScope) {
      return;
    }

    dispatch("include-subfolders-change", { value: !includeSubfolders });
  }

  function dispatchToolbarAction(actionId) {
    dispatch("toolbar-action", { action: actionId });
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
            on:click={(e) => selectToolbarAction(action.id, e)}
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
            on:click={(e) => selectToolbarAction(action.id, e)}
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
            on:click={(e) => selectToolbarAction(action.id, e)}
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
            on:click={(e) => selectToolbarAction(action.id, e)}
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
        on:click={toggleIncludeSubfolders}
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
            on:click={() => dispatchToolbarAction(action.id)}
          >
            {action.label}
          </button>
        {/each}
        <button
          type="button"
          class="fce-toolbar-bulk-button is-exit"
          on:click={() => dispatchToolbarAction("bulk")}
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
      {#if option.type === "separator"}
        <div class="fce-sort-menu-separator"></div>
      {:else}
        {@const selected = sortField === option.field && sortDirection === option.direction}
        <button
          type="button"
          class="fce-sort-menu-item"
          role="menuitemradio"
          aria-checked={selected}
          on:click={() => selectSortOption(option)}
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
        on:click={() => {
          dispatch("select-folder", { path: node.path });
          showFolderMenu = false;
        }}
      >
        {#if node.children.length > 0}
          <span
            class="fce-folder-tree-chevron"
            on:click|stopPropagation={() => {
              const next = new Set(expandedPaths);
              if (next.has(node.path)) {
                next.delete(node.path);
              } else {
                next.add(node.path);
              }
              expandedPaths = next;
            }}
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
          on:click={() => toggleFilterTag(tag)}
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
