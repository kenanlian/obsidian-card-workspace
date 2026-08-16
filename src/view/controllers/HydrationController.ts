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
    return this.pendingHydration.delete(path);
  }

  clearPending(): void {
    this.pendingHydration.clear();
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
    options: { publish: boolean; batchSize?: number },
  ): Promise<void> {
    const loadEpoch = this.context.epochs.load;
    if (paths.length === 0 || !loadEpoch.isCurrent(token)) {
      return;
    }

    const targets: string[] = [];
    for (const path of paths) {
      const card = this.context.store.getBaseCards().find((candidate) => candidate.path === path);
      if (!card || card.hydrated || this.pendingHydration.has(path)) {
        continue;
      }
      this.pendingHydration.add(path);
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
        batch.forEach((path) => this.pendingHydration.delete(path));
      }
    } finally {
      if (loadEpoch.isCurrent(token)) {
        targets.forEach((path) => this.pendingHydration.delete(path));
      }
    }

    if (options.publish && loadEpoch.isCurrent(token)) {
      this.context.publishGroups("cards");
    }
  }

  async hydrateStartupCardPaths(paths: string[], token: EpochToken): Promise<void> {
    const loadEpoch = this.context.epochs.load;
    if (paths.length === 0 || !loadEpoch.isCurrent(token)) {
      return;
    }

    const hydration = this.hydrateCardPaths(paths, token, {
      publish: false,
      batchSize: HYDRATION_BATCH_SIZE,
    });
    const viewWindow = this.context.getViewWindow();
    let timeoutId: ReturnType<Window["setTimeout"]> | null = null;
    const waitBudget = new Promise<"timeout">((resolve) => {
      timeoutId = viewWindow.setTimeout(() => resolve("timeout"), STARTUP_PREVIEW_WAIT_MS);
    });
    const result = await Promise.race([hydration.then(() => "hydrated" as const), waitBudget]);
    if (timeoutId !== null) {
      viewWindow.clearTimeout(timeoutId);
    }

    if (result === "timeout") {
      void hydration.then(
        () => {
          if (loadEpoch.isCurrent(token)) {
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
    if (this.deps.isLoading() || visibleCards.length === 0) {
      return;
    }
    void this.hydrateRange(0, Math.min(visibleCards.length, STARTUP_PREVIEW_CARD_COUNT));
  }

  async hydrateCard(cardPath: string, token: EpochToken): Promise<void> {
    const loadEpoch = this.context.epochs.load;
    const card = this.context.store.getBaseCards().find((candidate) => candidate.path === cardPath);
    if (!card) {
      return;
    }

    if (!isMarkdownCardKind(card.fileKind)) {
      if (!loadEpoch.isCurrent(token)) {
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
      if (!loadEpoch.isCurrent(token)) {
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
      if (!loadEpoch.isCurrent(token)) {
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
    this.pendingHydration.clear();
    return { clearedPendingHydration };
  }
}
