import { TFile, TFolder } from "obsidian";

import { CARD_PANE_MIN_WIDTH } from "../../settings";
import { isSupportedCardFile } from "../file-kind";
import { normalizeScopePath } from "../scope";
import type { FolderTreeNode } from "../types";
import type { DisposableController, DisposeReport, ViewContext } from "../view-context";

const FOLDER_TREE_DEBOUNCE_MS = 250;
const NAV_COUNT_REFRESH_DEBOUNCE_MS = 250;

export interface NavLayoutControllerDeps {
  context: ViewContext;
  onNavCountsInvalidated: () => void;
  getTooltipSide: () => "left" | "right";
}

/** Owns navigation tree/count derivation, pane layout state, and navigation timers. */
export class NavLayoutController implements DisposableController {
  private shellWidth = 0;
  private singlePaneView: "nav" | "cards" = "cards";
  private folderTree: FolderTreeNode[] = [];
  private folderTreeCountsByPath = new Map<string, { direct: number; recursive: number }>();
  private folderTreeDebounceTimer: ReturnType<Window["setTimeout"]> | null = null;
  private navCountRefreshHandle: ReturnType<Window["setTimeout"]> | null = null;

  constructor(private readonly deps: NavLayoutControllerDeps) {}

  private get context(): ViewContext {
    return this.deps.context;
  }

  getFolderTree(): FolderTreeNode[] {
    return this.folderTree;
  }

  getFolderTreeCount(path: string): { direct: number; recursive: number } | undefined {
    return this.folderTreeCountsByPath.get(normalizeScopePath(path));
  }

  getTooltipSide(): "left" | "right" {
    return this.deps.getTooltipSide();
  }

  getLayoutMode(): "dual" | "single" {
    if (this.shellWidth <= 0) {
      return "dual";
    }
    return this.shellWidth < this.context.getSettings().navPaneWidth + CARD_PANE_MIN_WIDTH
      ? "single"
      : "dual";
  }

  getNavVisible(): boolean {
    if (this.getLayoutMode() === "single") {
      return this.singlePaneView === "nav";
    }
    return !this.context.getSettings().navPaneCollapsed;
  }

  pushNavLayoutState(): void {
    this.context.publishGroups("nav");
  }

  onShellResize(width: number): void {
    if (typeof width !== "number" || !Number.isFinite(width)) {
      return;
    }
    const nextWidth = Math.round(width);
    if (nextWidth === this.shellWidth) {
      return;
    }
    const previousMode = this.getLayoutMode();
    this.shellWidth = nextWidth;
    if (previousMode === "dual" && this.getLayoutMode() === "single") {
      this.singlePaneView = "cards";
    }
    this.pushNavLayoutState();
  }

  returnToCardsViewIfSinglePane(): void {
    if (this.getLayoutMode() !== "single" || this.singlePaneView === "cards") {
      return;
    }
    this.singlePaneView = "cards";
    this.pushNavLayoutState();
  }

  async onToggleNavPane(): Promise<void> {
    if (this.getLayoutMode() === "single") {
      this.singlePaneView = this.singlePaneView === "nav" ? "cards" : "nav";
      this.pushNavLayoutState();
      return;
    }
    const current = this.context.getSettings().navPaneCollapsed;
    await this.context.saveSettings({ navPaneCollapsed: !current });
  }

  async onToggleNavSection(section: unknown): Promise<void> {
    const settings = this.context.getSettings();
    if (section === "favorites") {
      await this.context.saveSettings({
        favoritesSectionCollapsed: !settings.favoritesSectionCollapsed,
      });
      return;
    }
    if (section === "folders") {
      await this.context.saveSettings({ folderSectionCollapsed: !settings.folderSectionCollapsed });
      return;
    }
    if (section === "tags") {
      await this.context.saveSettings({ tagSectionCollapsed: !settings.tagSectionCollapsed });
      return;
    }
    if (section === "boxes") {
      await this.context.saveSettings({ boxSectionCollapsed: !settings.boxSectionCollapsed });
    }
  }

  async onNavPaneResize(width: number): Promise<void> {
    if (typeof width !== "number" || !Number.isFinite(width)) {
      return;
    }
    const normalizedWidth = Math.round(width);
    if (this.context.getSettings().navPaneWidth === normalizedWidth) {
      return;
    }
    await this.context.saveSettings({ navPaneWidth: normalizedWidth });
  }

  buildFolderTree(): FolderTreeNode[] {
    const app = this.context.getApp();
    const vault = app.vault as unknown as { getRoot?: unknown };
    if (typeof vault.getRoot !== "function") {
      return [];
    }

    function countDirectFiles(folder: TFolder): number {
      let total = 0;
      for (const child of folder.children) {
        if (child instanceof TFile && isSupportedCardFile(child)) {
          total += 1;
        }
      }
      return total;
    }

    function buildNode(folder: TFolder, depth: number): FolderTreeNode {
      const subfolders = folder.children
        .filter((child): child is TFolder => child instanceof TFolder)
        .sort((left, right) => left.name.localeCompare(right.name));
      const children = subfolders.map((subfolder) => buildNode(subfolder, depth + 1));
      const directCount = countDirectFiles(folder);
      return {
        name: folder.name || "/",
        path: folder.path === "" ? "/" : folder.path,
        children,
        depth,
        directCount,
        recursiveCount: children.reduce((total, child) => total + child.recursiveCount, directCount),
        recursiveFolderCount: children.reduce(
          (total, child) => total + 1 + child.recursiveFolderCount,
          0,
        ),
      };
    }

    const root = app.vault.getRoot();
    const subfolders = root.children
      .filter((child): child is TFolder => child instanceof TFolder)
      .sort((left, right) => left.name.localeCompare(right.name));
    const topLevelNodes = subfolders.map((subfolder) => buildNode(subfolder, 0));
    const rootDirectCount = countDirectFiles(root);
    return [{
      name: root.name || "/",
      path: "/",
      children: [],
      depth: 0,
      directCount: rootDirectCount,
      recursiveCount: topLevelNodes.reduce(
        (total, node) => total + node.recursiveCount,
        rootDirectCount,
      ),
      recursiveFolderCount: topLevelNodes.reduce(
        (total, node) => total + 1 + node.recursiveFolderCount,
        0,
      ),
    }, ...topLevelNodes];
  }

  cacheFolderTreeCounts(tree: FolderTreeNode[]): void {
    this.folderTreeCountsByPath.clear();
    const visit = (node: FolderTreeNode): void => {
      this.folderTreeCountsByPath.set(normalizeScopePath(node.path), {
        direct: node.directCount,
        recursive: node.recursiveCount,
      });
      for (const child of node.children) {
        visit(child);
      }
    };
    for (const node of tree) {
      visit(node);
    }
  }

  refreshFolderTreeState(): void {
    const tree = this.buildFolderTree();
    this.cacheFolderTreeCounts(tree);
    this.folderTree = tree;
    this.pushNavLayoutState();
  }

  scheduleFolderTreeRefresh(): void {
    this.clearFolderTreeDebounce();
    this.folderTreeDebounceTimer = this.context.getViewWindow().setTimeout(() => {
      this.folderTreeDebounceTimer = null;
      this.refreshFolderTreeState();
    }, FOLDER_TREE_DEBOUNCE_MS);
  }

  clearFolderTreeDebounce(): boolean {
    if (this.folderTreeDebounceTimer === null) {
      return false;
    }
    this.context.getViewWindow().clearTimeout(this.folderTreeDebounceTimer);
    this.folderTreeDebounceTimer = null;
    return true;
  }

  invalidateNavCounts(): void {
    this.deps.onNavCountsInvalidated();
    this.context.epochs.navCount.bump();
  }

  scheduleNavCountRefresh(): void {
    const viewWindow = this.context.getViewWindow();
    if (this.navCountRefreshHandle !== null) {
      viewWindow.clearTimeout(this.navCountRefreshHandle);
    }
    this.navCountRefreshHandle = viewWindow.setTimeout(() => {
      this.navCountRefreshHandle = null;
      this.invalidateNavCounts();
      this.pushNavLayoutState();
    }, NAV_COUNT_REFRESH_DEBOUNCE_MS);
  }

  clearNavCountRefreshDebounce(): boolean {
    if (this.navCountRefreshHandle === null) {
      return false;
    }
    this.context.getViewWindow().clearTimeout(this.navCountRefreshHandle);
    this.navCountRefreshHandle = null;
    return true;
  }

  refreshNavState(): void {
    this.invalidateNavCounts();
    this.context.publishGroups("nav", "scope");
  }

  dispose(): DisposeReport {
    const clearedFolderTree = this.clearFolderTreeDebounce();
    const clearedNavCount = this.clearNavCountRefreshDebounce();
    return clearedFolderTree || clearedNavCount ? { cancelledDebounce: true } : {};
  }
}
