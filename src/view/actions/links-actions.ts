import { TFile } from "obsidian";

import type { UiStrings } from "../../i18n";
import { createLinksScope, isLinksScope, type CardScope, type LinksScope } from "../scope";
import type { FolderSelectionRequest, SelectionResult } from "../types";
import type { ViewContext } from "../view-context";

export interface LinksActionsDeps {
  context: ViewContext;
  createProgrammaticSelectionRequest: (
    scope: CardScope,
    forceRefresh: boolean,
  ) => FolderSelectionRequest;
  handleScopeSelection: (request: FolderSelectionRequest) => Promise<SelectionResult>;
  openCreateBoxModalWithPaths: (paths: string[]) => void;
}

/**
 * Follow/pin and snapshot commands for the Links source.
 * Direction entry is navigation-owned; `enterOrSwitchLinks` stays public for that route.
 * `linksPinned` is runtime-only (C4); snapshot uses the existing box modal (C6).
 */
export class LinksActions {
  constructor(private readonly deps: LinksActionsDeps) {}

  private get strings(): UiStrings {
    return this.deps.context.getUiStrings();
  }

  handleToolbarCommand(action: string): boolean {
    if (action === "links-pin-toggle") {
      this.togglePinned();
      return true;
    }
    if (action === "links-save-snapshot") {
      this.saveSnapshot();
      return true;
    }
    return false;
  }

  enterOrSwitchLinks(direction: LinksScope["direction"]): void {
    const scope = this.deps.context.store.getScope();
    const alreadyLinks = isLinksScope(scope);
    const sourceFile = alreadyLinks
      ? this.resolveLiveFile(scope.notePath)
      : this.deps.context.getApp().workspace.getActiveFile();
    if (!(sourceFile instanceof TFile)) {
      this.deps.context.notify(this.strings.links.noActiveFileNotice);
      return;
    }
    if (!alreadyLinks) {
      this.deps.context.store.setLinksPinned(false);
    }
    this.selectLinksScope(createLinksScope(sourceFile.path, direction));
  }

  togglePinned(): void {
    const scope = this.deps.context.store.getScope();
    if (!isLinksScope(scope)) {
      return;
    }
    const store = this.deps.context.store;
    if (!store.getLinksPinned()) {
      store.setLinksPinned(true);
      this.deps.context.publishGroups("scope");
      return;
    }
    store.setLinksPinned(false);
    const active = this.deps.context.getApp().workspace.getActiveFile();
    if (active instanceof TFile && active.path !== scope.notePath) {
      // The re-point publishes the scope group through scope selection.
      this.selectLinksScope(createLinksScope(active.path, scope.direction));
      return;
    }
    this.deps.context.publishGroups("scope");
  }

  saveSnapshot(): void {
    if (!isLinksScope(this.deps.context.store.getScope())) {
      return;
    }
    const paths = this.deps.context.store.getVisibleCards().map((card) => card.path);
    if (paths.length === 0) {
      this.deps.context.notify(this.strings.links.emptySnapshotNotice);
      return;
    }
    this.deps.openCreateBoxModalWithPaths(paths);
  }

  private selectLinksScope(scope: CardScope): void {
    void this.deps.handleScopeSelection(
      this.deps.createProgrammaticSelectionRequest(scope, false),
    );
  }

  private resolveLiveFile(path: string): TFile | null {
    const file = this.deps.context.getApp().vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }
}
