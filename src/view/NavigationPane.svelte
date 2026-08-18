<script lang="ts">
  import { setIcon, setTooltip } from "obsidian";
  import { PLAIN_FOLDER_ICON } from "../icons";
  import { getUiStrings, type UiStrings } from "../i18n";
  import { NAV_PANE_WIDTH_MAX, NAV_PANE_WIDTH_MIN } from "../settings";
  import type { BoxSummary, PanelNavState, PanelScopeState } from "./panel-model";
  import {
    buildTagTree,
    collectAncestorTagPaths,
    collectExpandableTagPaths,
    flattenVisibleTagTree,
    normalizeTagPath,
    resolveTagSelection,
    type VisibleTagTreeNode,
  } from "./tag-tree";
  import type {
    FavoriteEntry,
    FolderActionPayload,
    FolderTreeNode,
    NavContextMenuPayload,
    NavMenuBridge,
    NavSectionId,
  } from "./types";
  import TreeSection from "./TreeSection.svelte";

  interface SelectFolderPayload {
    path: string;
  }

  interface FilterChangePayload {
    tags: string[];
  }

  interface IncludeSubfoldersChangePayload {
    value: boolean;
  }

  interface BoxCommandPayload {
    command: string;
    boxId?: string;
  }

  interface NavigationPaneProps {
    strings?: UiStrings;
    nav?: PanelNavState;
    scope?: PanelScopeState;
    availableTags?: string[];
    tagCounts?: Record<string, number>;
    activeFilterTags?: string[];
    onSelectFolder?: (payload: SelectFolderPayload) => void;
    onFolderAction?: (payload: FolderActionPayload) => void;
    onFilterChange?: (payload: FilterChangePayload) => void;
    onIncludeSubfoldersChange?: (payload: IncludeSubfoldersChangePayload) => void;
    onBoxCommand?: (payload: BoxCommandPayload) => void;
    onNavContextMenu?: (payload: NavContextMenuPayload) => void;
    onFavoriteActivate?: (payload: { favorite: FavoriteEntry }) => void;
    onNavPaneResize?: (width: number) => void;
    onToggleNavPane?: () => void;
    onToggleNavSection?: (section: NavSectionId) => void;
  }

  const DEFAULT_NAV: PanelNavState = { folderTree: [], favorites: [], boxSummaries: [], paneWidth: 240, layoutMode: "dual", visible: true, sectionCollapsed: { favorites: false, folders: false, tags: false, boxes: false }, showItemCounts: false, tooltipSide: "right" };
  const DEFAULT_SCOPE: PanelScopeState = { displayPath: "", includeSubfolders: true, activeBoxId: null, activeBoxName: null, boxExcludedCount: 0, emptyStateMessage: "" };

  let {
    strings = getUiStrings("en"),
    nav = DEFAULT_NAV,
    scope = DEFAULT_SCOPE,
    availableTags = [],
    tagCounts = {},
    activeFilterTags = [],
    onSelectFolder,
    onFolderAction,
    onFilterChange,
    onIncludeSubfoldersChange,
    onBoxCommand,
    onNavContextMenu,
    onFavoriteActivate,
    onNavPaneResize,
    onToggleNavPane,
    onToggleNavSection,
  }: NavigationPaneProps = $props();

  const toolbarStrings = $derived(strings.toolbar);
  const boxStrings = $derived(strings.box);
  const tooltipSide = $derived(nav.tooltipSide);
  const folderTree = $derived(nav.folderTree);
  const folderPath = $derived(scope.displayPath);
  const includeSubfolders = $derived(scope.includeSubfolders);
  const boxSummaries = $derived(nav.boxSummaries);
  const activeBoxId = $derived(scope.activeBoxId);
  const navPaneWidth = $derived(nav.paneWidth);
  const layoutMode = $derived(nav.layoutMode);
  const folderSectionCollapsed = $derived(nav.sectionCollapsed.folders);
  const tagSectionCollapsed = $derived(nav.sectionCollapsed.tags);
  const boxSectionCollapsed = $derived(nav.sectionCollapsed.boxes);
  const favorites = $derived(nav.favorites);
  const favoritesSectionCollapsed = $derived(nav.sectionCollapsed.favorites);
  const showNavItemCounts = $derived(nav.showItemCounts);

  let expandedFolderPaths = $state<Set<string>>(new Set());
  let expandedTagPaths = $state<Set<string>>(new Set());
  let seededTagExpansion = $state(false);
  let dragWidth = $state<number | null>(null);
  let hoveredFolderPath = $state<string | null>(null);
  let hoveredTagPath = $state<string | null>(null);

  const paneLabelId = $props.id();
  const resizeHandleLabelId = `${paneLabelId}-resize`;

  const isBoxMode = $derived(activeBoxId !== null);
  const paneWidth = $derived(dragWidth ?? navPaneWidth);
  $effect(() => {
    if (dragWidth === navPaneWidth) dragWidth = null;
  });

  const tagTree = $derived(buildTagTree(availableTags));
  const visibleTagNodes = $derived(flattenVisibleTagTree(tagTree, expandedTagPaths));
  const normalizedActiveTags = $derived(new Set(activeFilterTags.map((tag) => normalizeTagPath(tag))));

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

  function collectExpandableFolderPaths(nodes: FolderTreeNode[]): string[] {
    const paths: string[] = [];

    function walk(items: FolderTreeNode[]): void {
      for (const node of items) {
        if (node.children.length > 0) {
          paths.push(node.path);
          walk(node.children);
        }
      }
    }

    walk(nodes);
    return paths;
  }

  const visibleFolderNodes = $derived(flattenVisibleTree(folderTree, expandedFolderPaths));
  const expandableFolderPaths = $derived(collectExpandableFolderPaths(folderTree));
  const expandableTagPaths = $derived(collectExpandableTagPaths(tagTree));
  const hasExpandedNodes = $derived(expandedFolderPaths.size > 0 || expandedTagPaths.size > 0);

  function toggleAllFolderExpansion(): void {
    expandedFolderPaths =
      expandedFolderPaths.size > 0 ? new Set() : new Set(expandableFolderPaths);
  }

  function toggleAllTagExpansion(): void {
    expandedTagPaths = expandedTagPaths.size > 0 ? new Set() : new Set(expandableTagPaths);
  }

  function toggleExpandAll(): void {
    if (hasExpandedNodes) {
      expandedFolderPaths = new Set();
      expandedTagPaths = new Set();
      return;
    }

    expandedFolderPaths = new Set(expandableFolderPaths);
    expandedTagPaths = new Set(expandableTagPaths);
  }

  function createFolderAtRoot(): void {
    onFolderAction?.({ action: "create-child-folder", path: "/" });
  }

  $effect(() => {
    if (seededTagExpansion || activeFilterTags.length === 0) {
      return;
    }

    const next = new Set(expandedTagPaths);
    for (const tag of activeFilterTags) {
      for (const ancestor of collectAncestorTagPaths(tag)) {
        next.add(ancestor);
      }
    }
    expandedTagPaths = next;
    seededTagExpansion = true;
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

  function isRootFolderNode(node: FolderTreeNode): boolean {
    return node.path === "/";
  }

  function getFolderNodeLabel(node: FolderTreeNode): string {
    return isRootFolderNode(node) ? toolbarStrings.folderMenu.rootFolder : node.name;
  }

  function getFolderNodeIcon(node: FolderTreeNode): string {
    if (isRootFolderNode(node)) {
      return "house";
    }

    if (node.children.length === 0) {
      return PLAIN_FOLDER_ICON;
    }

    return expandedFolderPaths.has(node.path) ? "folder-open" : "folders";
  }

  function getTagNodeIcon(node: VisibleTagTreeNode): string {
    return node.hasChildren ? "tags" : "tag";
  }

  /**
   * The flattened tree renders every node as a flat sibling, so a descendant row
   * is not a DOM descendant of its parent row. Subtree hover therefore has to be
   * resolved from the hovered path instead of CSS `:hover`.
   */
  function isPathHovered(hoveredPath: string | null, path: string): boolean {
    if (hoveredPath === null) {
      return false;
    }

    return hoveredPath === path || hoveredPath.startsWith(`${path}/`);
  }

  interface HoverTracker {
    onEnter: () => void;
    onLeave: () => void;
  }

  function trackHover(
    node: HTMLElement,
    tracker: HoverTracker,
  ): { update: (nextTracker: HoverTracker) => void; destroy: () => void } {
    let current = tracker;
    const handleEnter = (): void => current.onEnter();
    const handleLeave = (): void => current.onLeave();
    node.addEventListener("pointerenter", handleEnter);
    node.addEventListener("pointerleave", handleLeave);

    return {
      update(nextTracker: HoverTracker) {
        current = nextTracker;
      },
      destroy() {
        node.removeEventListener("pointerenter", handleEnter);
        node.removeEventListener("pointerleave", handleLeave);
      },
    };
  }

  function enterFolderRow(path: string): void {
    hoveredFolderPath = path;
  }

  function leaveFolderRow(path: string): void {
    if (hoveredFolderPath === path) hoveredFolderPath = null;
  }

  function enterTagRow(tag: string): void {
    hoveredTagPath = tag;
  }

  function leaveTagRow(tag: string): void {
    if (hoveredTagPath === tag) hoveredTagPath = null;
  }

  /** Guards against a hovered row being unmounted before its leave event fires. */
  function resetHoveredRows(): void {
    hoveredFolderPath = null;
    hoveredTagPath = null;
  }

  function isFolderRowHovered(node: FolderTreeNode): boolean {
    if (isRootFolderNode(node)) {
      return hoveredFolderPath === node.path;
    }

    return isPathHovered(hoveredFolderPath, node.path);
  }

  function isTagRowHovered(node: VisibleTagTreeNode): boolean {
    return isPathHovered(hoveredTagPath, node.tag);
  }

  function getFolderNodeTooltip(node: FolderTreeNode): string {
    return toolbarStrings.navPane.folderCountsTooltip(node.recursiveCount, node.recursiveFolderCount);
  }

  function getTagNodeTooltip(node: VisibleTagTreeNode): string {
    return toolbarStrings.navPane.tagCountsTooltip(tagCounts[node.tag] ?? 0, node.descendantCount);
  }

  function getBoxTooltip(box: BoxSummary, isActive: boolean): string {
    return isActive ? toolbarStrings.navPane.exitBox : toolbarStrings.navPane.boxCountsTooltip(box.cardCount);
  }

  function getFolderNodeCount(node: FolderTreeNode): number {
    if (!showNavItemCounts) {
      return 0;
    }

    return includeSubfolders ? node.recursiveCount : node.directCount;
  }

  function getTagNodeCount(node: VisibleTagTreeNode): number {
    if (!showNavItemCounts) {
      return 0;
    }

    return tagCounts[node.tag] ?? 0;
  }

  function isFolderNodeSelected(node: FolderTreeNode): boolean {
    return !isBoxMode && node.path === folderPath;
  }

  function toggleFolderExpansion(event: MouseEvent, path: string): void {
    event.stopPropagation();
    const next = new Set(expandedFolderPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    expandedFolderPaths = next;
  }

  function toggleTagExpansionByPath(tag: string): void {
    const next = new Set(expandedTagPaths);
    if (next.has(tag)) {
      next.delete(tag);
    } else {
      next.add(tag);
    }
    expandedTagPaths = next;
  }

  function toggleTagExpansion(event: MouseEvent, tag: string): void {
    event.stopPropagation();
    toggleTagExpansionByPath(tag);
  }

  function selectFolder(path: string): void {
    onSelectFolder?.({ path });
  }

  function toggleTag(event: MouseEvent, tag: string): void {
    if (isBoxMode) {
      return;
    }

    const nextTags = resolveTagSelection(activeFilterTags, tag, event.ctrlKey || event.metaKey);
    if (nextTags === activeFilterTags) {
      return;
    }

    onFilterChange?.({ tags: nextTags });
  }

  function toggleIncludeSubfolders(): void {
    if (isBoxMode) {
      return;
    }

    onIncludeSubfoldersChange?.({ value: !includeSubfolders });
  }

  function selectBox(boxId: string): void {
    if (boxId === activeBoxId) {
      onBoxCommand?.({ command: "exit" });
      return;
    }

    onBoxCommand?.({ command: "switch", boxId });
  }

  function buildBridge(tagNode: VisibleTagTreeNode | null): NavMenuBridge {
    return {
      hasExpandedFolders: expandedFolderPaths.size > 0,
      hasExpandedTags: expandedTagPaths.size > 0,
      toggleAllFolders: () => toggleAllFolderExpansion(),
      toggleAllTags: () => toggleAllTagExpansion(),
      tagHasChildren: tagNode?.hasChildren ?? false,
      tagExpanded: tagNode !== null && expandedTagPaths.has(tagNode.tag),
      toggleTagExpansion: () => {
        if (tagNode !== null) {
          toggleTagExpansionByPath(tagNode.tag);
        }
      },
    };
  }

  function requestNavMenu(
    event: MouseEvent,
    section: NavSectionId,
    menuScope: "header" | "item",
    options: { itemId?: string; favorite?: FavoriteEntry; tagNode?: VisibleTagTreeNode } = {},
  ): void {
    event.preventDefault();
    event.stopPropagation();
    onNavContextMenu?.({
      section,
      scope: menuScope,
      itemId: options.itemId,
      favorite: options.favorite,
      bridge: buildBridge(options.tagNode ?? null),
      mouseEvent: event,
    });
  }

  function toggleSection(section: NavSectionId): void {
    onToggleNavSection?.(section);
  }

  function beginResize(event: PointerEvent): void {
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = dragWidth ?? navPaneWidth;

    const clamp = (value: number): number =>
      Math.max(NAV_PANE_WIDTH_MIN, Math.min(NAV_PANE_WIDTH_MAX, value));

    const onMove = (moveEvent: PointerEvent): void => {
      dragWidth = clamp(Math.round(startWidth + (moveEvent.clientX - startX)));
    };

    const onUp = (upEvent: PointerEvent): void => {
      handle.releasePointerCapture(upEvent.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      const finalWidth = dragWidth ?? startWidth;
      if (finalWidth !== startWidth) onNavPaneResize?.(finalWidth);
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }
</script>

<!--
  The accessible name is a hidden element rather than `aria-label`, because
  Obsidian renders a hover tooltip for every element carrying `aria-label`.
-->
<nav
  class="fce-nav-pane"
  aria-labelledby={paneLabelId}
  style={layoutMode === "single" ? "" : `width: ${paneWidth}px;`}
>
  <span class="fce-sr-only" id={paneLabelId}>{toolbarStrings.navPane.ariaLabel}</span>
  <div class="fce-nav-pane-header">
    <div class="fce-nav-pane-header-group">
      {#if layoutMode === "single"}
        <button
          type="button"
          class="clickable-icon fce-nav-header-button"
          aria-label={toolbarStrings.navPane.backToCards}
          onclick={() => onToggleNavPane?.()}
          use:applyIcon={"arrow-left"}
          use:applyTooltip={toolbarStrings.navPane.backToCards}
        >
          <span class="fce-sr-only">{toolbarStrings.navPane.backToCards}</span>
        </button>
      {/if}
    </div>
    <div class="fce-nav-pane-header-group">
      <button
        type="button"
        class="clickable-icon fce-nav-header-button"
        aria-label={hasExpandedNodes ? toolbarStrings.navPane.collapseAll : toolbarStrings.navPane.expandAll}
        onclick={toggleExpandAll}
        use:applyIcon={hasExpandedNodes ? "chevrons-down-up" : "chevrons-up-down"}
        use:applyTooltip={hasExpandedNodes ? toolbarStrings.navPane.collapseAll : toolbarStrings.navPane.expandAll}
      >
        <span class="fce-sr-only">{hasExpandedNodes ? toolbarStrings.navPane.collapseAll : toolbarStrings.navPane.expandAll}</span>
      </button>
      <button
        type="button"
        class="clickable-icon fce-nav-header-button"
        aria-label={toolbarStrings.navPane.newFolderAtRoot}
        onclick={createFolderAtRoot}
        use:applyIcon={"folder-plus"}
        use:applyTooltip={toolbarStrings.navPane.newFolderAtRoot}
      >
        <span class="fce-sr-only">{toolbarStrings.navPane.newFolderAtRoot}</span>
      </button>
      {#if !isBoxMode}
        <button
          type="button"
          class="clickable-icon fce-nav-header-button {includeSubfolders ? 'is-active' : ''}"
          aria-label={includeSubfolders ? toolbarStrings.folderMenu.includeSubfolders : toolbarStrings.folderMenu.directFolderOnly}
          aria-pressed={includeSubfolders}
          onclick={toggleIncludeSubfolders}
          use:applyIcon={"folder-tree"}
          use:applyTooltip={includeSubfolders ? toolbarStrings.folderMenu.includeSubfolders : toolbarStrings.folderMenu.directFolderOnly}
        >
          <span class="fce-sr-only">{toolbarStrings.folderMenu.subfoldersSrLabel}</span>
        </button>
      {/if}
    </div>
  </div>

  <div
    class="fce-nav-pane-sections"
    use:trackHover={{ onEnter: () => undefined, onLeave: resetHoveredRows }}
  >
    <TreeSection
      title={toolbarStrings.navPane.favoritesSection}
      icon="star"
      collapsed={favoritesSectionCollapsed}
      collapseLabel={toolbarStrings.navPane.collapseSection}
      expandLabel={toolbarStrings.navPane.expandSection}
      onToggle={() => toggleSection("favorites")}
      onHeaderContextMenu={(event) => requestNavMenu(event, "favorites", "header")}
    >
      {#snippet body()}
        <div
          class="fce-tree-menu fce-nav-tree fce-favorites-menu"
          role="tree"
          tabindex="-1"
          oncontextmenu={(event) => requestNavMenu(event, "favorites", "header")}
        >
          {#if favorites.length === 0}
            <div class="fce-tree-empty">{toolbarStrings.navPane.favoritesEmpty}</div>
          {:else}
            {#each favorites as row (`${row.kind}:${row.ref}`)}
              <div
                class="fce-popup-row fce-tree-row {row.selected ? 'is-selected' : ''} {row.missing ? 'is-missing' : ''}"
                style="padding-left: var(--fce-nav-indent-step);"
                role="presentation"
                oncontextmenu={(event) =>
                  requestNavMenu(event, "favorites", "item", {
                    favorite: { kind: row.kind, ref: row.ref },
                  })}
              >
                <div class="fce-popup-row-leading">
                  <span class="fce-tree-item-icon is-static" aria-hidden="true">
                    <span class="fce-tree-item-glyph" use:applyIcon={row.icon}></span>
                  </span>
                </div>
                <div class="fce-popup-row-content">
                  <button
                    type="button"
                    class="fce-tree-button"
                    onclick={() => onFavoriteActivate?.({ favorite: { kind: row.kind, ref: row.ref } })}
                    use:applyTooltip={row.missing ? `${row.label} ${toolbarStrings.navPane.favoriteMissing}` : row.label}
                  >
                    <span class="fce-tree-label">{row.label}</span>
                    {#if row.count > 0}
                      <span class="fce-nav-row-count">{row.count}</span>
                    {/if}
                  </button>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      {/snippet}
    </TreeSection>

    <TreeSection
      title={toolbarStrings.navPane.foldersSection}
      icon="folders"
      collapsed={folderSectionCollapsed}
      collapseLabel={toolbarStrings.navPane.collapseSection}
      expandLabel={toolbarStrings.navPane.expandSection}
      onToggle={() => toggleSection("folders")}
      onHeaderContextMenu={(event) => requestNavMenu(event, "folders", "header")}
    >
      {#snippet body()}
        <div
          class="fce-tree-menu fce-nav-tree fce-folder-menu"
          role="tree"
          tabindex="-1"
          oncontextmenu={(event) => requestNavMenu(event, "folders", "header")}
        >
          {#each visibleFolderNodes as node (node.path)}
            {@const hasChildren = node.children.length > 0}
            {@const isSelected = isFolderNodeSelected(node)}
            {@const label = getFolderNodeLabel(node)}
            {@const nodeCount = getFolderNodeCount(node)}
            <div
              class="fce-popup-row fce-tree-row {isSelected ? 'is-selected' : ''} {isFolderRowHovered(node) ? 'is-hovered' : ''}"
              style="padding-left: calc(var(--fce-nav-indent-step) * ({node.depth} + 1));"
              role="presentation"
              oncontextmenu={(event) => requestNavMenu(event, "folders", "item", { itemId: node.path })}
              use:trackHover={{
                onEnter: () => enterFolderRow(node.path),
                onLeave: () => leaveFolderRow(node.path),
              }}
            >
              <div class="fce-popup-row-leading">
                {#if hasChildren}
                  <button
                    type="button"
                    class="fce-tree-item-icon"
                    aria-label={expandedFolderPaths.has(node.path) ? toolbarStrings.folderMenu.collapse : toolbarStrings.folderMenu.expand}
                    aria-expanded={expandedFolderPaths.has(node.path)}
                    onclick={(event) => toggleFolderExpansion(event, node.path)}
                  >
                    <span class="fce-tree-item-glyph" aria-hidden="true" use:applyIcon={getFolderNodeIcon(node)}></span>
                    <span
                      class="fce-tree-item-chevron"
                      aria-hidden="true"
                      use:applyIcon={expandedFolderPaths.has(node.path) ? "chevron-down" : "chevron-right"}
                    ></span>
                  </button>
                {:else}
                  <span class="fce-tree-item-icon is-static" aria-hidden="true">
                    <span class="fce-tree-item-glyph" use:applyIcon={getFolderNodeIcon(node)}></span>
                  </span>
                {/if}
              </div>
              <div class="fce-popup-row-content">
                <button
                  type="button"
                  class="fce-tree-button"
                  onclick={() => selectFolder(node.path)}
                  use:applyTooltip={getFolderNodeTooltip(node)}
                >
                  <span class="fce-tree-label">{label}</span>
                  {#if nodeCount > 0}
                    <span class="fce-nav-row-count">{nodeCount}</span>
                  {/if}
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/snippet}
    </TreeSection>

    <TreeSection
      title={toolbarStrings.navPane.tagsSection}
      icon="tags"
      collapsed={tagSectionCollapsed}
      collapseLabel={toolbarStrings.navPane.collapseSection}
      expandLabel={toolbarStrings.navPane.expandSection}
      onToggle={() => toggleSection("tags")}
      onHeaderContextMenu={(event) => requestNavMenu(event, "tags", "header")}
    >
      {#snippet body()}
        <div
          class="fce-tree-menu fce-nav-tree fce-tag-menu {isBoxMode ? 'is-disabled' : ''}"
          role="tree"
          tabindex="-1"
          oncontextmenu={(event) => requestNavMenu(event, "tags", "header")}
        >
          {#if isBoxMode}
            <div class="fce-tree-empty">{toolbarStrings.navPane.tagsDisabledInBox}</div>
          {:else if visibleTagNodes.length === 0}
            <div class="fce-tree-empty">{toolbarStrings.filter.noTagsFound}</div>
          {:else}
            {#each visibleTagNodes as node (node.tag)}
              {@const isSelected = normalizedActiveTags.has(node.tag)}
              {@const nodeCount = getTagNodeCount(node)}
              <div
                class="fce-popup-row fce-tree-row {isSelected ? 'is-selected' : ''} {isTagRowHovered(node) ? 'is-hovered' : ''}"
                style="padding-left: calc(var(--fce-nav-indent-step) * ({node.depth} + 1));"
                role="presentation"
                oncontextmenu={(event) =>
                  requestNavMenu(event, "tags", "item", { itemId: node.tag, tagNode: node })}
                use:trackHover={{
                  onEnter: () => enterTagRow(node.tag),
                  onLeave: () => leaveTagRow(node.tag),
                }}
              >
                <div class="fce-popup-row-leading">
                  {#if node.hasChildren}
                    <button
                      type="button"
                      class="fce-tree-item-icon"
                      aria-label={expandedTagPaths.has(node.tag) ? toolbarStrings.folderMenu.collapse : toolbarStrings.folderMenu.expand}
                      aria-expanded={expandedTagPaths.has(node.tag)}
                      onclick={(event) => toggleTagExpansion(event, node.tag)}
                    >
                      <span class="fce-tree-item-glyph" aria-hidden="true" use:applyIcon={getTagNodeIcon(node)}></span>
                      <span
                        class="fce-tree-item-chevron"
                        aria-hidden="true"
                        use:applyIcon={expandedTagPaths.has(node.tag) ? "chevron-down" : "chevron-right"}
                      ></span>
                    </button>
                  {:else}
                    <span class="fce-tree-item-icon is-static" aria-hidden="true">
                      <span class="fce-tree-item-glyph" use:applyIcon={getTagNodeIcon(node)}></span>
                    </span>
                  {/if}
                </div>
                <div class="fce-popup-row-content">
                  <button
                    type="button"
                    class="fce-tree-button"
                    role="menuitemcheckbox"
                    aria-checked={isSelected}
                    onclick={(event) => toggleTag(event, node.tag)}
                    use:applyTooltip={getTagNodeTooltip(node)}
                  >
                    <span class="fce-tree-label">{node.label}</span>
                    {#if nodeCount > 0}
                      <span class="fce-nav-row-count">{nodeCount}</span>
                    {/if}
                  </button>
                </div>
                {#if isSelected}
                  <div class="fce-popup-row-trailing">
                    <span class="fce-popup-row-selected-indicator fce-tree-row-check" use:applyIcon={"check"}></span>
                  </div>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {/snippet}
    </TreeSection>

    <TreeSection
      title={toolbarStrings.navPane.boxesSection}
      icon="package"
      collapsed={boxSectionCollapsed}
      collapseLabel={toolbarStrings.navPane.collapseSection}
      expandLabel={toolbarStrings.navPane.expandSection}
      onToggle={() => toggleSection("boxes")}
      onHeaderContextMenu={(event) => requestNavMenu(event, "boxes", "header")}
    >
      {#snippet body()}
        <div
          class="fce-nav-box-list"
          role="presentation"
          oncontextmenu={(event) => requestNavMenu(event, "boxes", "header")}
        >
          {#if boxSummaries.length === 0}
            <div class="fce-tree-empty">{toolbarStrings.navPane.boxesEmpty}</div>
          {:else}
            {#each boxSummaries as box (box.id)}
              {@const isActive = box.id === activeBoxId}
              <button
                type="button"
                class="fce-nav-box-item {isActive ? 'is-active' : ''}"
                aria-pressed={isActive}
                onclick={() => selectBox(box.id)}
                oncontextmenu={(event) => requestNavMenu(event, "boxes", "item", { itemId: box.id })}
                use:applyTooltip={getBoxTooltip(box, isActive)}
              >
                <span class="fce-nav-box-icon" aria-hidden="true" use:applyIcon={"box"}></span>
                <span class="fce-nav-box-label">{box.name}</span>
                {#if showNavItemCounts && box.cardCount > 0}
                  <span class="fce-nav-row-count">{box.cardCount}</span>
                {/if}
                {#if isActive}
                  <span class="fce-nav-box-check" aria-hidden="true" use:applyIcon={"check"}></span>
                {/if}
              </button>
            {/each}
          {/if}
        </div>
      {/snippet}
    </TreeSection>
  </div>

  <div
    class="fce-nav-resize-handle"
    role="separator"
    aria-orientation="vertical"
    aria-labelledby={resizeHandleLabelId}
    onpointerdown={beginResize}
  >
    <span class="fce-sr-only" id={resizeHandleLabelId}>{toolbarStrings.navPane.resizeHandle}</span>
  </div>
</nav>
