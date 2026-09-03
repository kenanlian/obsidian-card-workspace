import { Menu, Modal, Setting, TFile, TFolder } from "obsidian";
import type { UiStrings } from "../../i18n";
import { normalizePropertyFilterClauses } from "../../property-filter-settings";
import {
  addManualPaths,
  addRuleToBox,
  createCardBox,
  deleteCardBox,
  duplicateCardBox,
  findCardBox,
  getBoxMembershipSignature,
  removeMemberFromBox,
  renameCardBox,
  restoreExcludedPaths,
  translateBrowseScopeToRule,
  upsertCardBox,
  type BrowseScope,
} from "../card-boxes";
import { isBoxMember, matchesRule } from "../card-box-membership";
import { isSupportedCardFile } from "../file-kind";
import { pruneFavoriteBoxes } from "../favorites";
import { BoxConfigModal } from "../modals/BoxConfigModal";
import { BoxNameModal } from "../modals/BoxNameModal";
import type { BoxSummary } from "../panel-model";
import { createBoxScope, isBoxScope, scopeDisplayPath, type CardScope } from "../scope";
import type { CardBoxDefinition, FolderSelectionRequest, Rule, SelectionResult } from "../types";
import type { ViewContext } from "../view-context";
import {
  deriveDefaultBoxNameFromBrowseScope,
  describeBoxRule,
  stripCardFileExtension,
} from "./box-action-helpers";

export interface BoxActionsDeps {
  context: ViewContext;
  getSelectedPaths: () => Set<string>;
  getOrderedVisiblePaths: () => string[];
  isMouseEventLike: (event: unknown) => event is MouseEvent;
  resolveFolderFromUiPath: (folderPath: string) => TFolder | null;
  collectSupportedFiles: (folderPath: string, includeSubfolders: boolean) => TFile[];
  createProgrammaticSelectionRequest: (
    scope: CardScope,
    forceRefresh: boolean,
  ) => FolderSelectionRequest;
  handleScopeSelection: (request: FolderSelectionRequest) => Promise<SelectionResult>;
  moveScopeToFolder: (path: string) => Promise<SelectionResult>;
  returnToCardsViewIfSinglePane: () => void;
}

/** Card box mode: switching, CRUD, membership edits, and bulk box operations. */
export class BoxActions {
  private boxCardCountCache = new Map<string, { signature: string; count: number }>();

  constructor(private readonly deps: BoxActionsDeps) {}

  private get strings(): UiStrings {
    return this.deps.context.getUiStrings();
  }

  /** Owns `boxCardCountCache`; wiring must call this wherever the view called `invalidateNavCounts`. */
  invalidateCache(): void {
    this.boxCardCountCache.clear();
  }

  getActiveBox(): CardBoxDefinition | null {
    const scope = this.deps.context.store.getScope();
    if (!isBoxScope(scope)) return null;

    return findCardBox(this.deps.context.getSettings().boxes ?? [], scope.boxId);
  }

  isBoxMode(): boolean {
    return isBoxScope(this.deps.context.store.getScope());
  }

  /**
   * Enters a box: the runtime scope moves first, and the persisted projection is
   * written only after the load succeeds. A failed write leaves the view correct
   * and merely restores the previous scope on next launch.
   */
  async enterBoxScope(boxId: string): Promise<void> {
    const request = this.deps.createProgrammaticSelectionRequest(createBoxScope(boxId), false);
    const result = await this.deps.handleScopeSelection(request);
    if (result.action === "rejected_invalid") return;
    this.deps.returnToCardsViewIfSinglePane();
  }

  /** Leaves a box back to the last browsed folder, then clears the projection. */
  async exitBoxScope(): Promise<void> {
    const settings = this.deps.context.getSettings();
    const result = await this.deps.moveScopeToFolder(settings.lastFolderPath);
    if (result.action === "rejected_invalid") return;
    this.deps.returnToCardsViewIfSinglePane();
  }

  /**
   * Member count for a box, cached per membership signature.
   *
   * Counting scans every rule's folder scope, so the cache keeps nav publishes
   * cheap; it is cleared on vault mutations and on box persistence.
   */
  countBoxCards(box: CardBoxDefinition): number {
    const signature = getBoxMembershipSignature(box);
    const cached = this.boxCardCountCache.get(box.id);
    if (cached && cached.signature === signature) {
      return cached.count;
    }

    const count = this.collectBoxFiles(box).length;
    this.boxCardCountCache.set(box.id, { signature, count });
    return count;
  }

  /**
   * Resolve the candidate member files for a box: the union of each rule's
   * folder scope plus manual paths, filtered down to actual box members.
   * Membership is metadata-based and never gated by search index readiness.
   */
  collectBoxFiles(box: CardBoxDefinition): TFile[] {
    const app = this.deps.context.getApp();
    const candidatePaths = new Set<string>();

    for (const rule of box.rules) {
      for (const file of this.deps.collectSupportedFiles(rule.folder, rule.includeSubfolders)) {
        candidatePaths.add(file.path);
      }
    }
    for (const path of box.manualPaths) {
      candidatePaths.add(path);
    }

    const files: TFile[] = [];
    for (const path of candidatePaths) {
      const file = app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile && isSupportedCardFile(file) && isBoxMember(app, path, box)) {
        files.push(file);
      }
    }

    return files;
  }

  private async persistBoxes(boxes: CardBoxDefinition[]): Promise<void> {
    const favorites = pruneFavoriteBoxes(
      this.deps.context.getSettings().favorites ?? [],
      boxes.map((box) => box.id),
    );
    await this.deps.context.saveSettings({ boxes, favorites });
  }
  /** Box-scope resolution for the loader, which only knows the box id. */
  collectBoxFilesById(boxId: string): TFile[] {
    const box = findCardBox(this.deps.context.getSettings().boxes ?? [], boxId);
    return box ? this.collectBoxFiles(box) : [];
  }

  isPathInBox(path: string, boxId: string): boolean {
    const box = findCardBox(this.deps.context.getSettings().boxes ?? [], boxId);
    return box ? isBoxMember(this.deps.context.getApp(), path, box) : false;
  }

  async updateActiveBox(
    mutate: (box: CardBoxDefinition) => CardBoxDefinition,
  ): Promise<void> {
    const settings = this.deps.context.getSettings();
    const box = this.getActiveBox();
    if (box === null) {
      return;
    }
    const nextBox = mutate(box);
    if (nextBox === box) {
      return;
    }
    await this.persistBoxes(upsertCardBox(settings.boxes, nextBox));
  }
  /** Counting walks each box's rule scopes, so only the nav group pays for this. */
  buildBoxSummaries(): BoxSummary[] {
    return (this.deps.context.getSettings().boxes ?? []).map((entry) => ({
      id: entry.id,
      name: entry.name,
      cardCount: this.countBoxCards(entry),
    }));
  }

  getBrowseScope(): BrowseScope {
    const scope = this.deps.context.store.getScope();
    const settings = this.deps.context.getSettings();
    return {
      folder: scopeDisplayPath(scope),
      includeSubfolders: scope.kind === "folder" ? scope.includeSubfolders : settings.includeSubfolders,
      tags: [...settings.filter.tags],
      properties: normalizePropertyFilterClauses(settings.filter.properties),
    };
  }

  describeRule(rule: Rule): string {
    return describeBoxRule(this.strings, rule);
  }

  handleBoxCommand(detail: { command?: unknown; boxId?: unknown }): void {
    const command = typeof detail.command === "string" ? detail.command : "";
    const boxId = typeof detail.boxId === "string" ? detail.boxId : null;

    switch (command) {
      case "switch":
        if (boxId && this.getActiveBox()?.id !== boxId) {
          void this.enterBoxScope(boxId);
        }
        return;
      case "exit":
        void this.exitBoxScope();
        return;
      case "create":
        this.openCreateBoxModal();
        return;
      case "rename":
        this.openRenameBoxModal(boxId ?? this.getActiveBox()?.id ?? null);
        return;
      case "duplicate":
        this.duplicateBoxById(boxId ?? this.getActiveBox()?.id ?? null);
        return;
      case "delete":
        this.openDeleteBoxConfirm(boxId ?? this.getActiveBox()?.id ?? null);
        return;
      case "save-scope-as-box":
        this.openSaveScopeAsBoxModal();
        return;
      case "add-scope-to-box":
        this.addScopeToBox(boxId);
        return;
      case "configure":
        this.openBoxConfig(boxId ?? this.getActiveBox()?.id ?? null);
        return;
      default:
        return;
    }
  }

  openCreateBoxModal(): void {
    const strings = this.strings.box;
    new BoxNameModal(this.deps.context.getApp(), {
      strings: this.strings,
      title: strings.nameModalCreateTitle,
      initialName: "",
      submitLabel: strings.create,
      onSubmit: async (name) => {
        const settings = this.deps.context.getSettings();
        const box = createCardBox(name, settings.boxes);
        await this.persistBoxes(upsertCardBox(settings.boxes, box));
        await this.enterBoxScope(box.id);
      },
    }).open();
  }

  private openRenameBoxModal(boxId: string | null): void {
    const settings = this.deps.context.getSettings();
    const box = findCardBox(settings.boxes, boxId);
    if (box === null) return;
    const strings = this.strings.box;
    new BoxNameModal(this.deps.context.getApp(), {
      strings: this.strings,
      title: strings.nameModalRenameTitle,
      initialName: box.name,
      submitLabel: strings.save,
      onSubmit: async (name) => {
        const current = this.deps.context.getSettings();
        await this.persistBoxes(renameCardBox(current.boxes, box.id, name));
      },
    }).open();
  }

  private duplicateBoxById(boxId: string | null): void {
    if (boxId === null) return;
    const settings = this.deps.context.getSettings();
    void this.persistBoxes(duplicateCardBox(settings.boxes, boxId));
  }

  private openDeleteBoxConfirm(boxId: string | null): void {
    const settings = this.deps.context.getSettings();
    const box = findCardBox(settings.boxes, boxId);
    if (box === null) {
      return;
    }
    const strings = this.strings.box;
    const modal = new Modal(this.deps.context.getApp());
    modal.setTitle(strings.deleteConfirmTitle);
    modal.contentEl.createEl("p", { text: strings.deleteConfirmBody(box.name) });
    new Setting(modal.contentEl)
      .addButton((button) => {
        button.setButtonText(strings.cancel).onClick(() => {
          modal.close();
        });
      })
      .addButton((button) => {
        button
          .setWarning()
          .setButtonText(strings.deleteConfirm)
          .onClick(async () => {
            const current = this.deps.context.getSettings();
            const scope = this.deps.context.store.getScope();
            if (isBoxScope(scope) && scope.boxId === box.id) {
              const result = await this.deps.moveScopeToFolder(current.lastFolderPath);
              if (result.action === "rejected_invalid") {
                return;
              }
            }
            const nextBoxes = deleteCardBox(current.boxes, box.id);
            await this.persistBoxes(nextBoxes);
            modal.close();
          });
      });
    modal.open();
  }

  openSaveScopeAsBoxModal(): void {
    const strings = this.strings.box;
    const rule = translateBrowseScopeToRule(this.getBrowseScope());
    const hitCount = this.countRuleQualifiedFiles(rule);
    new BoxNameModal(this.deps.context.getApp(), {
      strings: this.strings,
      title: strings.saveScopeTitle,
      initialName: this.deriveDefaultBoxNameFromScope(),
      submitLabel: strings.create,
      previewText: strings.hitCountPreview(hitCount),
      onSubmit: async (name) => {
        const settings = this.deps.context.getSettings();
        const box = createCardBox(name, settings.boxes, { rules: [rule] });
        await this.persistBoxes(upsertCardBox(settings.boxes, box));
        await this.enterBoxScope(box.id);
      },
    }).open();
  }

  private deriveDefaultBoxNameFromScope(): string {
    return deriveDefaultBoxNameFromBrowseScope(this.getBrowseScope());
  }

  private countRuleQualifiedFiles(rule: Rule): number {
    const files = this.deps.collectSupportedFiles(rule.folder, rule.includeSubfolders);
    if (rule.tags.length === 0 && rule.properties.length === 0) return files.length;
    const app = this.deps.context.getApp();
    return files.filter((file) => matchesRule(app, file.path, rule)).length;
  }

  canAddScopeToBox(): boolean {
    return !this.isBoxMode() && this.deps.context.getSettings().boxes.length > 0;
  }

  appendScopeTargetBoxItems(menu: Menu): void {
    for (const box of this.deps.context.getSettings().boxes) {
      menu.addItem((item) => {
        item
          .setTitle(box.name)
          .setIcon("box")
          .onClick(() => {
            this.addScopeToBox(box.id);
          });
      });
    }
  }

  /** Flat target picker for entry points that cannot host a submenu. */
  openAddScopeToBoxPicker(mouseEvent: unknown): void {
    if (!this.canAddScopeToBox() || !this.deps.isMouseEventLike(mouseEvent)) {
      return;
    }

    const menu = new Menu();
    this.appendScopeTargetBoxItems(menu);
    menu.showAtMouseEvent(mouseEvent);
  }

  appendAddScopeToBoxMenu(menu: Menu): void {
    if (!this.canAddScopeToBox()) {
      return;
    }

    menu.addItem((item) => {
      item.setTitle(this.strings.box.addScopeToBox).setIcon("package-check");
      const submenu = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
      if (submenu && typeof submenu.addItem === "function") {
        this.appendScopeTargetBoxItems(submenu);
        return;
      }

      item.onClick((event) => {
        this.openAddScopeToBoxPicker(event);
      });
    });
  }

  private addScopeToBox(boxId: string | null): void {
    const settings = this.deps.context.getSettings();
    const box = findCardBox(settings.boxes, boxId);
    if (box === null) {
      return;
    }
    const rule = translateBrowseScopeToRule(this.getBrowseScope());
    void this.persistBoxes(upsertCardBox(settings.boxes, addRuleToBox(box, rule)));
  }

  openBoxConfig(boxId: string | null): void {
    const settings = this.deps.context.getSettings();
    const box = findCardBox(settings.boxes, boxId);
    if (box === null) {
      return;
    }
    new BoxConfigModal(this.deps.context.getApp(), {
      box,
      strings: this.strings,
      describeRule: (rule) => this.describeRule(rule),
      isRuleFolderMissing: (rule) => this.deps.resolveFolderFromUiPath(rule.folder) === null,
      describeMemberPath: (path) => stripCardFileExtension(path.slice(path.lastIndexOf("/") + 1)),
      onConfirm: async (nextBox) => {
        const current = this.deps.context.getSettings();
        await this.persistBoxes(upsertCardBox(current.boxes, nextBox));
      },
    }).open();
  }

  /** Add one or more cards to a box (via context menu / bulk). */
  async addPathsToBox(boxId: string, paths: string[]): Promise<void> {
    const settings = this.deps.context.getSettings();
    const box = findCardBox(settings.boxes, boxId);
    if (box === null || paths.length === 0) {
      return;
    }
    const nextBox = addManualPaths(box, paths);
    await this.persistBoxes(upsertCardBox(settings.boxes, nextBox));
    this.deps.context.notify(this.strings.box.addedToBox(paths.length, box.name));
  }

  openCreateBoxModalWithPaths(paths: string[]): void {
    const strings = this.strings.box;
    new BoxNameModal(this.deps.context.getApp(), {
      strings: this.strings,
      title: strings.nameModalCreateTitle,
      initialName: "",
      submitLabel: strings.create,
      onSubmit: async (name) => {
        const settings = this.deps.context.getSettings();
        const box = createCardBox(name, settings.boxes, { manualPaths: paths });
        await this.persistBoxes(upsertCardBox(settings.boxes, box));
        this.deps.context.notify(strings.addedToBox(paths.length, box.name));
      },
    }).open();
  }

  /** Remove a single card entirely from the active box (manual delete or exclude). */
  async removeMemberFromActiveBox(path: string): Promise<void> {
    const settings = this.deps.context.getSettings();
    const box = this.getActiveBox();
    if (box === null) {
      return;
    }
    const nextBox = removeMemberFromBox(this.deps.context.getApp(), box, path);
    await this.persistBoxes(upsertCardBox(settings.boxes, nextBox));
    this.deps.context.notify(this.strings.box.removedFromBox(box.name));
  }

  appendAddToBoxMenu(menu: Menu, paths: string[]): void {
    if (paths.length === 0) {
      return;
    }
    const strings = this.strings.box;
    const settings = this.deps.context.getSettings();
    menu.addItem((item) => {
      item.setTitle(strings.addToBox).setIcon("box");
      const boxes = settings.boxes ?? [];
      const submenu = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
      if (submenu && typeof submenu.addItem === "function") {
        for (const summary of boxes) {
          submenu.addItem((sub) => {
            sub.setTitle(summary.name).setIcon("box").onClick(() => {
              void this.addPathsToBox(summary.id, paths);
            });
          });
        }
        if (boxes.length > 0) {
          submenu.addSeparator();
        }
        submenu.addItem((sub) => {
          sub.setTitle(strings.addToNewBox).setIcon("plus").onClick(() => {
            this.openCreateBoxModalWithPaths(paths);
          });
        });
        return;
      }

      // Fallback when submenus are unavailable: create a new box directly.
      item.onClick(() => {
        this.openCreateBoxModalWithPaths(paths);
      });
    });
  }

  getBoxExcludedCount(boxId: string): number {
    return findCardBox(this.deps.context.getSettings().boxes, boxId)?.excludedPaths.length ?? 0;
  }

  async restoreBoxExcluded(boxId: string): Promise<void> {
    const settings = this.deps.context.getSettings();
    const box = findCardBox(settings.boxes, boxId);
    if (box === null) {
      return;
    }

    await this.persistBoxes(upsertCardBox(settings.boxes, restoreExcludedPaths(box)));
  }

  bulkAddToBox(): void {
    const selectedPaths = this.deps
      .getOrderedVisiblePaths()
      .filter((path) => this.deps.getSelectedPaths().has(path));
    if (selectedPaths.length === 0) {
      return;
    }

    const settings = this.deps.context.getSettings();
    if (settings.boxes.length === 0) {
      this.openCreateBoxModalWithPaths(selectedPaths);
      return;
    }

    const strings = this.strings.box;
    const modal = new Modal(this.deps.context.getApp());
    modal.setTitle(strings.bulkAddToBoxTitle);
    for (const box of settings.boxes) {
      new Setting(modal.contentEl).setName(box.name).addButton((button) => {
        button.setButtonText(strings.addToBox).onClick(() => {
          void this.addPathsToBox(box.id, selectedPaths);
          modal.close();
        });
      });
    }
    new Setting(modal.contentEl).addButton((button) => {
      button
        .setCta()
        .setButtonText(strings.addToNewBox)
        .onClick(() => {
          modal.close();
          this.openCreateBoxModalWithPaths(selectedPaths);
        });
    });
    modal.open();
  }

  async bulkRemoveFromBox(): Promise<void> {
    const settings = this.deps.context.getSettings();
    const box = this.getActiveBox();
    if (box === null) {
      return;
    }

    const selectedPaths = this.deps
      .getOrderedVisiblePaths()
      .filter((path) => this.deps.getSelectedPaths().has(path));
    if (selectedPaths.length === 0) {
      return;
    }

    let nextBox = box;
    const app = this.deps.context.getApp();
    for (const path of selectedPaths) {
      nextBox = removeMemberFromBox(app, nextBox, path);
    }
    if (nextBox === box) {
      return;
    }

    await this.persistBoxes(upsertCardBox(settings.boxes, nextBox));
    this.deps.context.notify(this.strings.box.removedFromBoxCount(selectedPaths.length, box.name));
  }
}
