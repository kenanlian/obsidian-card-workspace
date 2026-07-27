<script lang="ts">
  import { setIcon, setTooltip } from "obsidian";
  import { getUiStrings, type BoxStrings, type ToolbarStrings } from "../i18n";
  import { NAV_PANE_WIDTH_MAX, NAV_PANE_WIDTH_MIN } from "../settings";
  import type { BoxSummary } from "./panel-model";
  import {
    buildTagTree,
    collectAncestorTagPaths,
    flattenVisibleTagTree,
    normalizeTagPath,
  } from "./tag-tree";
  import type { FolderActionPayload, FolderManagementAction, FolderTreeNode } from "./types";
  import TreeSection from "./TreeSection.svelte";

  type NavSection = "folders" | "tags" | "boxes";

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

  interface FolderActionOption {
    action: FolderManagementAction;
    icon: string;
    label: string;
  }

  interface NavigationPaneProps {
    strings?: ToolbarStrings;
    boxStrings?: BoxStrings;
    tooltipSide?: "top" | "right" | "bottom" | "left";
    folderTree?: FolderTreeNode[];
    folderPath?: string;
    includeSubfolders?: boolean;
    availableTags?: string[];
    activeFilterTags?: string[];
    boxSummaries?: BoxSummary[];
    activeBoxId?: string | null;
    navPaneWidth?: number;
    navPaneCollapsed?: boolean;
    folderSectionCollapsed?: boolean;
    tagSectionCollapsed?: boolean;
    boxSectionCollapsed?: boolean;
    onSelectFolder?: (payload: SelectFolderPayload) => void;
    onFilterChange?: (payload: FilterChangePayload) => void;
    onIncludeSubfoldersChange?: (payload: IncludeSubfoldersChangePayload) => void;
    onFolderAction?: (payload: FolderActionPayload) => void;
    onBoxCommand?: (payload: BoxCommandPayload) => void;
    onNavPaneResize?: (width: number) => void;
    onToggleNavPane?: () => void;
    onToggleNavSection?: (section: NavSection) => void;
  }

  let {
    strings = getUiStrings("en").toolbar,
    boxStrings = getUiStrings("en").box,
    tooltipSide = "right",
    folderTree = [],
    folderPath = "",
    includeSubfolders = true,
    availableTags = [],
    activeFilterTags = [],
    boxSummaries = [],
    activeBoxId = null,
    navPaneWidth = 240,
    navPaneCollapsed = false,
    folderSectionCollapsed = false,
    tagSectionCollapsed = false,
    boxSectionCollapsed = false,
    onSelectFolder,
    onFilterChange,
    onIncludeSubfoldersChange,
    onFolderAction,
    onBoxCommand,
    onNavPaneResize,
    onToggleNavPane,
    onToggleNavSection,
  }: NavigationPaneProps = $props();

  let expandedFolderPaths = $state<Set<string>>(new Set());
  let expandedTagPaths = $state<Set<string>>(new Set());
  let seededTagExpansion = $state(false);
  let dragWidth = $state<number | null>(null);

  const isBoxMode = $derived(activeBoxId !== null);
  const hasFolderScope = $derived(folderPath.length > 0);
  const paneWidth = $derived(dragWidth ?? navPaneWidth);

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

  const visibleFolderNodes = $derived(flattenVisibleTree(folderTree, expandedFolderPaths));

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
    return isRootFolderNode(node) ? strings.folderMenu.rootFolder : node.name;
  }

  function isFolderNodeSelected(node: FolderTreeNode): boolean {
    return !isBoxMode && node.path === folderPath;
  }

  function getFolderActionOptions(node: FolderTreeNode): FolderActionOption[] {
    const actions: FolderActionOption[] = [{
      action: "create-child-folder",
      icon: "folder-plus",
      label: strings.folderMenu.createChildFolder,
    }];

    if (!isRootFolderNode(node)) {
      actions.push(
        {
          action: "move-folder",
          icon: "folder-input",
          label: strings.folderMenu.moveFolder,
        },
        {
          action: "delete-folder",
          icon: "trash-2",
          label: strings.folderMenu.deleteFolder,
        },
      );
    }

    return actions;
  }

  function onFolderChevronClick(event: MouseEvent, path: string): void {
    event.stopPropagation();
    const next = new Set(expandedFolderPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    expandedFolderPaths = next;
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

  function selectFolder(path: string): void {
    onSelectFolder?.({ path });
  }

  function triggerFolderAction(event: MouseEvent, path: string, action: FolderManagementAction): void {
    event.stopPropagation();
    onFolderAction?.({ action, path });
  }

  function toggleTag(tag: string): void {
    if (isBoxMode) {
      return;
    }

    const normalizedTag = normalizeTagPath(tag);
    if (normalizedTag.length === 0) {
      return;
    }

    const nextTags: string[] = [];
    let removed = false;
    for (const existing of activeFilterTags) {
      if (normalizeTagPath(existing) === normalizedTag) {
        removed = true;
        continue;
      }
      nextTags.push(existing);
    }

    if (!removed) {
      nextTags.push(normalizedTag);
    }

    onFilterChange?.({ tags: nextTags });
  }

  function toggleIncludeSubfolders(): void {
    if (isBoxMode || !hasFolderScope) {
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

  function toggleSection(section: NavSection): void {
    onToggleNavSection?.(section);
  }

  function beginResize(event: PointerEvent): void {
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = navPaneWidth;

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
      dragWidth = null;
      if (finalWidth !== startWidth) {
        onNavPaneResize?.(finalWidth);
      }
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }
</script>

{#if navPaneCollapsed}
  <div class="fce-nav-pane is-collapsed">
    <button
      type="button"
      class="clickable-icon fce-nav-pane-toggle"
      aria-label={strings.navPane.expandPane}
      onclick={() => onToggleNavPane?.()}
      use:applyIcon={"panel-left-open"}
      use:applyTooltip={strings.navPane.expandPane}
    >
      <span class="fce-sr-only">{strings.navPane.expandPane}</span>
    </button>
  </div>
{:else}
  <nav class="fce-nav-pane" aria-label={strings.navPane.ariaLabel} style="width: {paneWidth}px;">
    <div class="fce-nav-pane-header">
      <button
        type="button"
        class="clickable-icon fce-nav-pane-toggle"
        aria-label={strings.navPane.collapsePane}
        onclick={() => onToggleNavPane?.()}
        use:applyIcon={"panel-left-close"}
        use:applyTooltip={strings.navPane.collapsePane}
      >
        <span class="fce-sr-only">{strings.navPane.collapsePane}</span>
      </button>
    </div>

    <div class="fce-nav-pane-sections">
      <TreeSection
        title={strings.navPane.foldersSection}
        collapsed={folderSectionCollapsed}
        collapseLabel={strings.navPane.collapseSection}
        expandLabel={strings.navPane.expandSection}
        onToggle={() => toggleSection("folders")}
      >
        {#snippet actions()}
          {#if hasFolderScope && !isBoxMode}
            <button
              type="button"
              class="clickable-icon fce-nav-section-action {includeSubfolders ? 'is-active' : ''}"
              aria-label={includeSubfolders ? strings.folderMenu.includeSubfolders : strings.folderMenu.directFolderOnly}
              aria-pressed={includeSubfolders}
              onclick={toggleIncludeSubfolders}
              use:applyIcon={"folder-tree"}
              use:applyTooltip={includeSubfolders ? strings.folderMenu.includeSubfolders : strings.folderMenu.directFolderOnly}
            >
              <span class="fce-sr-only">{strings.folderMenu.subfoldersSrLabel}</span>
            </button>
          {/if}
        {/snippet}
        {#snippet body()}
          <div class="fce-tree-menu fce-nav-tree fce-folder-menu" role="tree">
            {#each visibleFolderNodes as node (node.path)}
              {@const hasChildren = node.children.length > 0}
              {@const isSelected = isFolderNodeSelected(node)}
              {@const label = getFolderNodeLabel(node)}
              <div class="fce-popup-row fce-tree-row {isSelected ? 'is-selected' : ''}" style="padding-left: {node.depth * 16 + 8}px;">
                <div class="fce-popup-row-leading">
                  {#if hasChildren}
                    <button
                      type="button"
                      class="fce-tree-chevron"
                      aria-label={expandedFolderPaths.has(node.path) ? strings.folderMenu.collapse : strings.folderMenu.expand}
                      aria-expanded={expandedFolderPaths.has(node.path)}
                      onclick={(event) => onFolderChevronClick(event, node.path)}
                      use:applyIcon={expandedFolderPaths.has(node.path) ? "chevron-down" : "chevron-right"}
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
                    onclick={() => selectFolder(node.path)}
                    use:applyTooltip={label}
                  >
                    <span class="fce-tree-label">{label}</span>
                  </button>
                </div>
                <div class="fce-folder-row-end">
                  <div class="fce-folder-row-actions">
                    {#each getFolderActionOptions(node) as action}
                      <button
                        type="button"
                        class="fce-folder-row-action"
                        aria-label={action.label}
                        onclick={(event) => triggerFolderAction(event, node.path, action.action)}
                        use:applyIcon={action.icon}
                        use:applyTooltip={action.label}
                      >
                        <span class="fce-sr-only">{action.label}</span>
                      </button>
                    {/each}
                  </div>
                  <div class="fce-popup-row-trailing" aria-hidden={!isSelected}>
                    {#if isSelected}
                      <span class="fce-popup-row-selected-indicator fce-tree-row-check" use:applyIcon={"check"}></span>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/snippet}
      </TreeSection>

      <TreeSection
        title={strings.navPane.tagsSection}
        collapsed={tagSectionCollapsed}
        collapseLabel={strings.navPane.collapseSection}
        expandLabel={strings.navPane.expandSection}
        onToggle={() => toggleSection("tags")}
      >
        {#snippet body()}
          <div class="fce-tree-menu fce-nav-tree fce-tag-menu {isBoxMode ? 'is-disabled' : ''}" role="tree">
            {#if isBoxMode}
              <div class="fce-tree-empty">{strings.navPane.tagsDisabledInBox}</div>
            {:else if visibleTagNodes.length === 0}
              <div class="fce-tree-empty">{strings.filter.noTagsFound}</div>
            {:else}
              {#each visibleTagNodes as node (node.tag)}
                {@const isSelected = normalizedActiveTags.has(node.tag)}
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
                      onclick={() => toggleTag(node.tag)}
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
        {/snippet}
      </TreeSection>

      <TreeSection
        title={strings.navPane.boxesSection}
        collapsed={boxSectionCollapsed}
        collapseLabel={strings.navPane.collapseSection}
        expandLabel={strings.navPane.expandSection}
        onToggle={() => toggleSection("boxes")}
      >
        {#snippet body()}
          <div class="fce-nav-box-list">
            {#if boxSummaries.length === 0}
              <div class="fce-tree-empty">{strings.navPane.boxesEmpty}</div>
            {:else}
              {#each boxSummaries as box (box.id)}
                {@const isActive = box.id === activeBoxId}
                <button
                  type="button"
                  class="fce-nav-box-item {isActive ? 'is-active' : ''}"
                  aria-pressed={isActive}
                  onclick={() => selectBox(box.id)}
                  use:applyTooltip={isActive ? strings.navPane.exitBox : box.name}
                >
                  <span class="fce-nav-box-icon" aria-hidden="true" use:applyIcon={"gallery-horizontal"}></span>
                  <span class="fce-nav-box-label">{box.name}</span>
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
      aria-label={strings.navPane.resizeHandle}
      onpointerdown={beginResize}
    ></div>
  </nav>
{/if}
