<script>
  import { setIcon, setTooltip } from "obsidian";
  import { createEventDispatcher } from "svelte";

  export let folderPath = "";
  export let sortField = "mtime";
  export let sortDirection = "desc";
  export let folderTree = [];
  export let tooltipSide = "right";

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

  let activeToolbarAction = TOOLBAR_ACTIONS[0].id;
  let showSortMenu = false;
  let sortButtonEl = null;
  let sortMenuX = 0;
  let sortMenuY = 0;
  let folderMenuX = 0;
  let folderMenuY = 0;
  let showFolderMenu = false;
  let folderButtonEl = null;
  let folderMenuEl = null;
  let sortMenuEl = null;
  let expandedPaths = new Set();
  let folderMenuExpandedForPath = null;

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

  $: if (showFolderMenu && folderTree.length > 0 && folderPath && folderMenuExpandedForPath !== folderPath) {
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
        dispatch("toolbar-action", { action: actionId });
      }
      return;
    }
    showSortMenu = false;
    showFolderMenu = false;
    activeToolbarAction = actionId;
    dispatch("toolbar-action", { action: actionId });
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
</script>

<header class="fce-header">
  <div class="fce-toolbar" role="toolbar" aria-label="Folder card actions">
    <div class="fce-toolbar-buttons">
      {#each TOOLBAR_ACTIONS as action}
        {#if action.id === "pick-folder"}
          <button
            type="button"
            class="fce-folder-button {showFolderMenu ? 'is-selected' : ''}"
            aria-label={action.title}
            on:click={(e) => selectToolbarAction(action.id, e)}
            use:captureFolderButton
          >
            <span class="fce-folder-button-text">
              {#if folderPath && folderPath !== "All Notes"}
                {folderPath.split("/").filter(Boolean).pop() || folderPath}
              {:else}
                Select folder
              {/if}
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
        {:else}
          <button
            type="button"
            class="clickable-icon fce-toolbar-button {activeToolbarAction === action.id ? 'is-selected' : ''}"
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

  <div class="fce-toolbar-content">
    {#if folderPath}
      {folderPath}
    {:else}
      Pick a folder to preview notes.
    {/if}
  </div>
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
