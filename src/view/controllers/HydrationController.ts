import type { EpochToken } from "../async-epoch";
import { getCardPlaceholderText, isMarkdownCardKind } from "../file-kind";
import { buildLightPreview, DEFAULT_PREVIEW_MAX_VISIBLE_CHARS } from "../markdown-utils";
import type { DisposableController, DisposeReport, ViewContext } from "../view-context";

const HYDRATION_BATCH_SIZE = 5;
const STARTUP_PREVIEW_CARD_COUNT = 6;
const STARTUP_PREVIEW_WAIT_MS = 120;

export interface HydrationControllerDeps {
  context: ViewContext;
  isLoading: () => boolean;
}

/** Hydrates card previews and rejects writes from stale scope loads. */
export class HydrationController implements DisposableController {
  private pendingHydration = new Set<string>();
  private readonly pendingOwners = new Map<string, symbol>();
  private startupWaitTimer: ReturnType<Window["setTimeout"]> | null = null;
  private disposed = false;

  constructor(private readonly deps: HydrationControllerDeps) {}

  private get context(): ViewContext {
    return this.deps.context;
  }

  static get startupCardCount(): number {
    return STARTUP_PREVIEW_CARD_COUNT;
  }

  hasPending(path: string): boolean {
    return this.pendingHydration.has(path);
  }

  addPending(path: string): void {
    this.pendingHydration.add(path);
  }

  deletePending(path: string): boolean {
    this.pendingOwners.delete(path);
    return this.pendingHydration.delete(path);
  }

  clearPending(): void {
    this.pendingHydration.clear();
    this.pendingOwners.clear();
  }

  schedulePath(path: string): void {
    if (this.disposed) {
      return;
    }
    const token = this.context.epochs.load.token();
    void this.hydrateCardPaths([path], token, {
      publish: true,
      batchSize: 1,
      force: true,
    });
  }

  async hydrateRange(start: number, end: number): Promise<void> {
    const visibleCards = this.context.store.getVisibleCards();
    if (visibleCards.length === 0 || this.deps.isLoading()) {
      return;
    }

    const safeStart = Math.max(0, start);
    const safeEnd = Math.min(visibleCards.length, end);
    const targets = visibleCards.slice(safeStart, safeEnd).map((card) => card.path);
    await this.hydrateCardPaths(targets, this.context.epochs.load.token(), {
      publish: true,
      batchSize: HYDRATION_BATCH_SIZE,
    });
  }

  async hydrateCardPaths(
    paths: string[],
    token: EpochToken,
    options: { publish: boolean; batchSize?: number; force?: boolean },
  ): Promise<void> {
    const loadEpoch = this.context.epochs.load;
    if (this.disposed || paths.length === 0 || !loadEpoch.isCurrent(token)) {
      return;
    }

    const targets: string[] = [];
    const owner = Symbol("hydration");
    for (const path of paths) {
      const card = this.context.store.getBaseCards().find((candidate) => candidate.path === path);
      if (!card || (!options.force && card.hydrated) || this.pendingHydration.has(path)) {
        continue;
      }
      this.pendingHydration.add(path);
      this.pendingOwners.set(path, owner);
      targets.push(path);
    }

    if (targets.length === 0) {
      return;
    }

    const batchSize = Math.max(1, options.batchSize ?? targets.length);
    try {
      for (let batchStart = 0; batchStart < targets.length; batchStart += batchSize) {
        if (!loadEpoch.isCurrent(token)) {
          return;
        }
        const batch = targets.slice(batchStart, batchStart + batchSize);
        await Promise.all(batch.map((path) => this.hydrateCard(path, token)));
        if (!loadEpoch.isCurrent(token)) {
          return;
        }
        batch.forEach((path) => this.clearPendingOwnedBy(path, owner));
      }
    } finally {
      targets.forEach((path) => this.clearPendingOwnedBy(path, owner));
    }

    if (options.publish && !this.disposed && loadEpoch.isCurrent(token)) {
      this.context.publishGroups("cards");
    }
  }

  private clearPendingOwnedBy(path: string, owner: symbol): void {
    if (this.pendingOwners.get(path) !== owner) {
      return;
    }
    this.pendingOwners.delete(path);
    this.pendingHydration.delete(path);
  }

  async hydrateStartupCardPaths(paths: string[], token: EpochToken): Promise<void> {
    const loadEpoch = this.context.epochs.load;
    if (this.disposed || paths.length === 0 || !loadEpoch.isCurrent(token)) {
      return;
    }

    const hydration = this.hydrateCardPaths(paths, token, {
      publish: false,
      batchSize: HYDRATION_BATCH_SIZE,
    });
    const viewWindow = this.context.getViewWindow();
    const waitBudget = new Promise<"timeout">((resolve) => {
      this.startupWaitTimer = viewWindow.setTimeout(() => {
        this.startupWaitTimer = null;
        resolve("timeout");
      }, STARTUP_PREVIEW_WAIT_MS);
    });
    const result = await Promise.race([hydration.then(() => "hydrated" as const), waitBudget]);
    if (this.startupWaitTimer !== null) {
      viewWindow.clearTimeout(this.startupWaitTimer);
      this.startupWaitTimer = null;
    }

    if (result === "timeout" && !this.disposed) {
      void hydration.then(
        () => {
          if (!this.disposed && loadEpoch.isCurrent(token)) {
            this.context.publishGroups("cards");
          }
        },
        (error: unknown) => {
          console.warn("[Card Workspace] Startup preview hydration failed.", error);
        },
      );
    }
  }

  hydrateVisibleCardsOnOpen(): void {
    const visibleCards = this.context.store.getVisibleCards();
    if (this.disposed || this.deps.isLoading() || visibleCards.length === 0) {
      return;
    }
    void this.hydrateRange(0, Math.min(visibleCards.length, STARTUP_PREVIEW_CARD_COUNT));
  }

  async hydrateCard(cardPath: string, token: EpochToken): Promise<void> {
    const loadEpoch = this.context.epochs.load;
    const card = this.context.store.getBaseCards().find((candidate) => candidate.path === cardPath);
    if (this.disposed || !card) {
      return;
    }

    if (!isMarkdownCardKind(card.fileKind)) {
      if (this.disposed || !loadEpoch.isCurrent(token)) {
        return;
      }
      const placeholder = getCardPlaceholderText(
        card.fileKind,
        this.context.getUiStrings().fileKind,
      );
      this.context.store.patchCard(cardPath, {
        excerpt: "",
        previewHtml: `<p class="fce-preview-placeholder">${placeholder}</p>`,
        previewMode: "placeholder",
        hydrated: true,
      });
      return;
    }

    try {
      const markdown = await this.context.getApp().vault.cachedRead(card.file);
      if (this.disposed || !loadEpoch.isCurrent(token)) {
        return;
      }
      const preview = buildLightPreview(
        markdown,
        DEFAULT_PREVIEW_MAX_VISIBLE_CHARS,
        this.context.getSettings().previewLines,
      );
      this.context.store.patchCard(cardPath, {
        previewHtml: preview.html,
        previewMode: preview.mode,
        hydrated: true,
      });
    } catch {
      if (this.disposed || !loadEpoch.isCurrent(token)) {
        return;
      }
      this.context.store.patchCard(cardPath, {
        excerpt: "",
        previewHtml: "",
        previewMode: "empty",
        hydrated: true,
      });
    }
  }

  dispose(): DisposeReport {
    const clearedPendingHydration = this.pendingHydration.size > 0;
    const cancelledDebounce = this.startupWaitTimer !== null;
    if (this.startupWaitTimer !== null) {
      this.context.getViewWindow().clearTimeout(this.startupWaitTimer);
      this.startupWaitTimer = null;
    }
    this.disposed = true;
    this.clearPending();
    return {
      clearedPendingHydration,
      ...(cancelledDebounce ? { cancelledDebounce: true } : {}),
    };
  }
}
