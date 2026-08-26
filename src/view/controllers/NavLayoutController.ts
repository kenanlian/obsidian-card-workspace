import { CARD_PANE_MIN_WIDTH } from "../../settings";
import { normalizeScopePath } from "../scope";
import type { CardScope } from "../scope";
import {
  navigationFolderId,
  type NavigationFocusRequest,
  type NavigationProjection,
  type NavigationProjectionInput,
  type NavigationRevealRequest,
  type NavigationRow,
} from "../navigation-model";
import { projectNavigation, resolveNavigationFocus } from "../navigation-projection";
import type { NavSectionId } from "../types";
import type { FolderTreeNode } from "../types";
import type { DisposableController, DisposeReport, ViewContext } from "../view-context";
import { buildNavigationFolderTree, cacheNavigationFolderCounts } from "./nav-folder-tree";
import {
  captureNavigationQueryBaseline,
  queryBaselinesEqual,
  type NavigationQueryBaseline,
} from "./nav-query-session";
import { NavigationRequests } from "./navigation-requests";
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
  private query = "";
  private focusId: string | null = null;
  private focusEstablished = false;
  private projection: NavigationProjection = { normalizedQuery: "", querying: false, sections: [], rows: [], noResults: false };
  private revealFolderPaths = new Set<string>();
  private suppressedFolderPaths = new Set<string>();
  private queryFolderPaths = new Set<string>();
  private queryTagPaths = new Set<string>();
  private querySuppressedFolderPaths = new Set<string>();
  private querySuppressedTagPaths = new Set<string>();
  private queryCollapsedSections = new Set<NavSectionId>();
  private queryBaseline: NavigationQueryBaseline | null = null;
  private revealCurrentRangeAfterProjection = false;
  private revealFoldersSection = false;
  private lastScope: CardScope | null = null;
  private readonly requests = new NavigationRequests();
  private disposed = false;
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
  getQuery(): string { return this.query; }
  getFocusId(): string | null { return this.focusId; }
  getProjection(): NavigationProjection { return this.projection; }
  getRevealRequest(): NavigationRevealRequest | null { return this.requests.getReveal(); }
  getFocusRequest(): NavigationFocusRequest | null { return this.requests.getFocus(); }
  isDisposed(): boolean { return this.disposed; }
  getQueryBaseline(): NavigationQueryBaseline | null { return this.queryBaseline; }
  hasExpandedRows(kind: "folder" | "tag"): boolean {
    return this.projection.rows.some((row) => row.kind === kind && row.expanded);
  }
  getTagExpansion(tag: string): { hasChildren: boolean; expanded: boolean } {
    const row = this.projection.rows.find((candidate) => candidate.kind === "tag" && candidate.tagPath === tag);
    return { hasChildren: row?.expandable ?? false, expanded: row?.expanded ?? false };
  }
  async toggleById(rowId: string): Promise<void> {
    const row = this.projection.rows.find((candidate) => candidate.id === rowId);
    if (row) await this.setExpanded(row, !row.expanded);
  }
  async toggleAll(kind: "folder" | "tag"): Promise<void> {
    const rows = this.projection.rows.filter((row) => row.kind === kind && row.expandable);
    const collapse = rows.some((row) => row.expanded);
    for (const row of rows) await this.setExpanded(row, !collapse);
  }
  private requestReveal(rowId: string): void {
    if (this.disposed) return;
    this.requests.requestReveal(rowId);
  }
  consumeReveal(token: number): void {
    if (!this.disposed && this.requests.consumeReveal(token)) this.pushNavLayoutState();
  }
  consumeFocusReturn(token: number): void {
    if (!this.disposed && this.requests.consumeFocus(token)) this.pushNavLayoutState();
  }
  syncScope(scope: CardScope): void {
    if (this.disposed) return;
    const previous = this.lastScope;
    this.lastScope = scope;
    if (scope.kind !== "folder") { this.revealFoldersSection = false; return; }
    if (previous?.kind === "folder" && previous.path === scope.path) return;
    this.revealFolderPaths.clear();
    this.suppressedFolderPaths.clear();
    this.revealFoldersSection = true;
    const segments = normalizeScopePath(scope.path).split("/").filter(Boolean);
    for (let index = 1; index < segments.length; index += 1) {
      this.revealFolderPaths.add(segments.slice(0, index).join("/"));
    }
    this.requestReveal(navigationFolderId(scope.path));
  }
  /** Rename is identity continuity, not a distinct-scope reveal. */
  rewriteFolderIdentity(rewrite: (path: string) => string): void {
    const map = (values: Set<string>): Set<string> => new Set([...values].map(rewrite));
    this.revealFolderPaths = map(this.revealFolderPaths);
    this.suppressedFolderPaths = map(this.suppressedFolderPaths);
    this.queryFolderPaths = map(this.queryFolderPaths);
    this.querySuppressedFolderPaths = map(this.querySuppressedFolderPaths);
    if (this.queryBaseline) {
      this.queryBaseline = {
        ...this.queryBaseline,
        expandedFolderPaths: this.queryBaseline.expandedFolderPaths.map(rewrite),
      };
    }
    if (this.lastScope?.kind === "folder") {
      this.lastScope = { ...this.lastScope, path: rewrite(this.lastScope.path) };
    }
    if (this.focusId?.startsWith("folder:")) {
      this.focusId = navigationFolderId(rewrite(this.focusId.slice("folder:".length)));
    }
    this.requests.rewriteFolders(rewrite);
  }
  private readSharedBaseline(): NavigationQueryBaseline {
    return captureNavigationQueryBaseline(this.context.getSettings());
  }
  updateQuery(query: string): void {
    if (this.disposed || typeof query !== "string" || query === this.query) return;
    const wasQuerying = this.query.trim().length > 0;
    const willQuery = query.trim().length > 0;
    if (!wasQuerying && willQuery) this.queryBaseline = this.readSharedBaseline();
    this.query = query;
    if (wasQuerying && !willQuery) {
      this.queryFolderPaths.clear();
      this.queryTagPaths.clear();
      this.querySuppressedFolderPaths.clear();
      this.querySuppressedTagPaths.clear();
      this.queryCollapsedSections.clear();
      this.queryBaseline = null;
      this.revealCurrentRangeAfterProjection = true;
    }
    this.pushNavLayoutState();
  }
  clearQuery(): void { this.updateQuery(""); }
  setFocus(rowId: string | null): void {
    if (this.disposed || rowId === this.focusId) return;
    if (rowId !== null) this.focusEstablished = true; this.focusId = rowId;
    this.pushNavLayoutState();
  }
  restoreFocus(originId: string): void {
    if (this.disposed) return;
    this.focusEstablished = true; this.focusId = resolveNavigationFocus(this.projection.rows, this.projection.rows, originId);
    if (this.focusId) this.requests.requestFocus(this.focusId);
    this.pushNavLayoutState();
  }
  async setExpanded(row: NavigationRow, expanded: boolean): Promise<void> {
    if (this.disposed || !row.expandable || row.expanded === expanded) return;
    if (row.kind === "section") {
      if (this.query.trim()) {
        if (expanded) this.queryCollapsedSections.delete(row.section);
        else this.queryCollapsedSections.add(row.section);
        this.pushNavLayoutState();
      } else if (row.section === "folders" && !expanded && this.revealFoldersSection) {
        this.revealFoldersSection = false;
        if (this.context.getSettings().folderSectionCollapsed) this.pushNavLayoutState();
        else await this.onToggleNavSection(row.section);
      } else await this.onToggleNavSection(row.section);
      return;
    }
    if (row.kind !== "folder" && row.kind !== "tag") return;
    const identity = row.kind === "folder" ? row.folderPath : row.tagPath;
    if (this.query.trim()) {
      const target = row.kind === "folder" ? this.queryFolderPaths : this.queryTagPaths;
      const suppressed = row.kind === "folder"
        ? this.querySuppressedFolderPaths
        : this.querySuppressedTagPaths;
      if (expanded) { target.add(identity); suppressed.delete(identity); }
      else { target.delete(identity); suppressed.add(identity); }
      this.pushNavLayoutState();
      return;
    }
    if (row.kind === "folder" && !expanded) {
      for (const revealed of this.revealFolderPaths) {
        if (revealed === identity || revealed.startsWith(`${identity}/`)) {
          this.revealFolderPaths.delete(revealed);
        }
      }
      this.suppressedFolderPaths.add(identity);
    }
    if (row.kind === "folder" && expanded) this.suppressedFolderPaths.delete(identity);
    const settings = this.context.getSettings();
    const key = row.kind === "folder" ? "expandedFolderPaths" : "expandedTagPaths";
    const current = new Set<string>((settings[key] ?? []) as string[]);
    if (expanded) current.add(identity); else current.delete(identity);
    await this.context.saveSettings({ [key]: [...current].sort() });
  }
  project(input: Omit<NavigationProjectionInput, "query" | "expansion">): NavigationProjection {
    this.syncScope(input.scope);
    const settings = this.context.getSettings();
    if (this.query.trim().length > 0) {
      const shared = this.readSharedBaseline();
      if (!this.queryBaseline || !queryBaselinesEqual(this.queryBaseline, shared)) {
        this.queryBaseline = shared;
      }
    }
    const previous = this.projection;
    const sectionCollapsed = this.revealFoldersSection
      ? { ...input.sectionCollapsed, folders: false }
      : input.sectionCollapsed;
    const querying = this.query.trim().length > 0;
    this.projection = projectNavigation({
      ...input,
      sectionCollapsed,
      query: this.query,
      expansion: {
        folders: {
          manual: settings.expandedFolderPaths ?? [], reveal: [...this.revealFolderPaths],
          query: [...this.queryFolderPaths],
          suppressed: querying ? [...this.querySuppressedFolderPaths] : [...this.suppressedFolderPaths],
        },
        tags: { manual: settings.expandedTagPaths ?? [], reveal: [], query: [...this.queryTagPaths], suppressed: [...this.querySuppressedTagPaths] },
        queryCollapsedSections: [...this.queryCollapsedSections],
      },
    });
    if (this.focusEstablished) this.focusId = resolveNavigationFocus(previous.rows, this.projection.rows, this.focusId);
    if (this.revealCurrentRangeAfterProjection) {
      this.revealCurrentRangeAfterProjection = false;
      const current = this.projection.rows.find((row) => row.semanticState === "current-range");
      if (current) this.requestReveal(current.id);
    }
    return this.projection;
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
    return buildNavigationFolderTree(this.context.getApp());
  }
  cacheFolderTreeCounts(tree: FolderTreeNode[]): void {
    this.folderTreeCountsByPath = cacheNavigationFolderCounts(tree);
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
    this.disposed = true;
    this.query = "";
    this.focusId = null; this.focusEstablished = false;
    this.projection = { normalizedQuery: "", querying: false, sections: [], rows: [], noResults: false };
    this.revealFolderPaths.clear();
    this.suppressedFolderPaths.clear();
    this.queryFolderPaths.clear();
    this.queryTagPaths.clear();
    this.querySuppressedFolderPaths.clear();
    this.querySuppressedTagPaths.clear();
    this.queryCollapsedSections.clear();
    this.queryBaseline = null;
    this.revealCurrentRangeAfterProjection = false;
    this.revealFoldersSection = false;
    this.requests.clear();
    const clearedFolderTree = this.clearFolderTreeDebounce();
    const clearedNavCount = this.clearNavCountRefreshDebounce();
    return clearedFolderTree || clearedNavCount ? { cancelledDebounce: true } : {};
  }
}
