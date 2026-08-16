import { TFile } from "obsidian";

import {
  clearSelection,
  rangeSelect,
  reconcileToVisiblePaths,
  selectAll,
  toggleSelection,
} from "../bulk-selection";
import type { BulkRuntimePanelState } from "../types";
import type { DisposeReport, ViewContext } from "../view-context";

export interface BulkControllerDeps {
  context: ViewContext;
  getOrderedVisiblePaths: () => string[];
  resolveLiveMarkdownFile: (path: string) => TFile | null;
  publishSelection: () => void;
  openNote: (path: string) => void;
}

/** Owns per-view bulk mode and selection state. */
export class BulkController {
  private bulkMode = false;
  private selectedPaths = new Set<string>();
  private anchorPath: string | null = null;

  constructor(private readonly deps: BulkControllerDeps) {}

  isBulkMode(): boolean {
    return this.bulkMode;
  }

  getSelectedPaths(): Set<string> {
    return this.selectedPaths;
  }

  setSelectedPaths(paths: Set<string>): void {
    this.selectedPaths = paths;
  }

  getAnchorPath(): string | null {
    return this.anchorPath;
  }

  setAnchorPath(path: string | null): void {
    this.anchorPath = path;
  }

  clearSelectionState(): void {
    this.selectedPaths = new Set<string>();
    this.anchorPath = null;
  }

  toggleBulkMode(): void {
    this.bulkMode = !this.bulkMode;
    if (!this.bulkMode) {
      this.clearSelectionState();
    }
    this.deps.publishSelection();
  }

  bulkSelectAll(): void {
    if (!this.bulkMode) {
      return;
    }
    this.applySelectionResult(selectAll(
      { selectedPaths: this.selectedPaths, anchorPath: this.anchorPath },
      this.deps.getOrderedVisiblePaths(),
    ));
  }

  bulkClearSelection(): void {
    if (!this.bulkMode) {
      return;
    }
    this.applySelectionResult(clearSelection({
      selectedPaths: this.selectedPaths,
      anchorPath: this.anchorPath,
    }));
  }

  onBulkSelectCard(detail: { path?: unknown; shiftKey?: unknown }): void {
    const path = typeof detail.path === "string" ? detail.path : "";
    if (path.length === 0) {
      return;
    }
    if (!this.bulkMode) {
      this.deps.openNote(path);
      return;
    }
    const orderedVisiblePaths = this.deps.getOrderedVisiblePaths();
    if (!orderedVisiblePaths.includes(path)) {
      return;
    }
    const state = { selectedPaths: this.selectedPaths, anchorPath: this.anchorPath };
    const result = detail.shiftKey === true
      ? rangeSelect(state, this.anchorPath, path, orderedVisiblePaths)
      : toggleSelection(state, path);
    this.applySelectionResult(result);
  }

  applySelectionResult(result: {
    selectedPaths: Set<string>;
    anchorPath: string | null;
    changed: boolean;
  }): void {
    this.selectedPaths = result.selectedPaths;
    this.anchorPath = result.anchorPath;
    if (result.changed) {
      this.deps.publishSelection();
    }
  }

  reconcileToVisibleCards(): void {
    const result = reconcileToVisiblePaths(
      { selectedPaths: this.selectedPaths, anchorPath: this.anchorPath },
      this.deps.getOrderedVisiblePaths(),
    );
    this.selectedPaths = result.selectedPaths;
    this.anchorPath = result.anchorPath;
  }

  reconcileSelectionToOrderedPaths(pathsInOrder: string[]): void {
    this.selectedPaths = new Set(pathsInOrder);
    this.anchorPath = pathsInOrder[0] ?? null;
    this.deps.publishSelection();
  }

  resolveSelectedLiveFilesInOrder(): { selectedPathsInOrder: string[]; filesInOrder: TFile[] } {
    const selectedPathsInOrder = Array.from(this.selectedPaths);
    const filesInOrder: TFile[] = [];
    const vault = this.deps.context.getApp().vault;
    for (const path of selectedPathsInOrder) {
      const file = vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        filesInOrder.push(file);
      }
    }
    return { selectedPathsInOrder, filesInOrder };
  }

  resolveSelectedLiveMarkdownFilesInOrder(): {
    selectedPathsInOrder: string[];
    filesInOrder: TFile[];
  } {
    const selectedPathsInOrder = Array.from(this.selectedPaths);
    const filesInOrder: TFile[] = [];
    for (const path of selectedPathsInOrder) {
      const file = this.deps.resolveLiveMarkdownFile(path);
      if (file) {
        filesInOrder.push(file);
      }
    }
    return { selectedPathsInOrder, filesInOrder };
  }

  buildPanelState(): BulkRuntimePanelState {
    const selectedPaths = Array.from(this.selectedPaths);
    const selectedCount = selectedPaths.length;
    const hasSelection = selectedCount > 0;
    const selectedMarkdownCount = this.resolveSelectedLiveMarkdownFilesInOrder().filesInOrder.length;
    return {
      bulkMode: this.bulkMode,
      selectedPaths,
      selectedCount,
      bulkAnchorPath: this.anchorPath,
      canBulkSelectAll: this.deps.context.store.getVisibleCards().length > 0,
      canBulkClearSelection: hasSelection,
      canBulkMoveSelected: hasSelection,
      canBulkAddTagSelected: selectedMarkdownCount > 0,
      canBulkRemoveTagSelected: selectedMarkdownCount > 0,
      canBulkDeleteSelected: hasSelection,
      canBulkMergeSelected: selectedCount > 1 && selectedMarkdownCount === selectedCount,
    };
  }

  dispose(): DisposeReport {
    this.clearSelectionState();
    return {};
  }
}
