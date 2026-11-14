import { scopeIdentity } from "../scope";
import { normalizeBoxDraw, advanceBoxDraw, sampleBoxPaths, type BoxDrawConfig } from "../box-draw";
import { reconcileBoxDrawMembership } from "../card-box-membership";
import type { ViewContext } from "../view-context";
import { resolveSourceCapabilities } from "../source-capabilities";
import type { VaultMutationEvent } from "../../services/vault-events";

/** Per-view presentation; shared progress always comes from SettingsStore. */
export class BoxDrawController {
  private mode: BoxDrawConfig["mode"] | null = null;
  private pending = false;
  private disposed = false;
  private saveFailed = false;
  constructor(private readonly context: ViewContext, private readonly deps: {
    pool: () => string[]; query: () => string; reproject: () => void;
  }) {}
  get active(): boolean { return this.context.store.getDrawPaths() !== null; }
  get available(): boolean { return resolveSourceCapabilities(this.context.store.getScope()).supportsCardDraw; }
  get canNext(): boolean { return this.active && this.mode !== "daily" && !this.pending && !this.deps.query().trim() && this.deps.pool().length > 0; }
  private box() {
    const scope = this.context.store.getScope();
    return scope.kind === "box" ? (this.context.getSettings().boxes ?? []).find(box => box.id === scope.boxId) : undefined;
  }
  private publish(): void {
    if (this.disposed) return;
    this.deps.reproject();
    this.context.publishGroups("cards", "scope", "projection", "bulk", "nav");
  }
  async toggle(): Promise<void> { if (this.active) this.exit(); else await this.enter(); }
  exit(): void { this.context.store.setDrawPaths(null); this.mode = null; this.publish(); }
  async enter(): Promise<void> { if (this.available && !this.active) await this.generate(false); }
  async next(): Promise<void> { if (this.canNext) await this.generate(true); }
  private async generate(next: boolean): Promise<void> {
    if (this.pending || this.disposed) return;
    const identity = scopeIdentity(this.context.store.getScope());
    try { await this.context.waitForSettings?.(); }
    catch (error) {
      console.warn("Card Workspace: waiting for synced draw settings failed", error);
      this.context.notify(this.context.getUiStrings().box.drawSaveFailed);
      return;
    }
    if (identity !== scopeIdentity(this.context.store.getScope())) return;
    if (this.pending || this.disposed || !this.available) return;
    if (this.saveFailed) {
      try { await this.context.flushSettings?.(); this.saveFailed = false; }
      catch { this.context.notify(this.context.getUiStrings().box.drawSaveFailed); return; }
      this.publish(); return;
    }
    const box = this.box();
    if (!box) return;
    const config = normalizeBoxDraw(box.draw);
    this.mode = config.mode;
    const pool = this.deps.pool();
    this.context.store.advanceDrawRevision();
    this.pending = true;
    try {
      if (config.mode === "random") this.context.store.setDrawPaths(sampleBoxPaths(pool, config.count));
      else {
        const progress = advanceBoxDraw(pool, config, box.drawProgress, next);
        this.context.store.setDrawPaths(progress.currentGroup?.paths ?? []);
        if (progress !== box.drawProgress) {
          const write = this.context.saveSettings({ boxes: this.context.getSettings().boxes.map(entry => entry.id === box.id ? { ...entry, drawProgress: progress } : entry) });
          this.publish();
          await write;
        }
      }
    } catch (error) {
      this.saveFailed = true;
      console.warn("Card Workspace: draw persistence failed", error);
      this.context.notify(this.context.getUiStrings().box.drawSaveFailed);
    } finally { this.pending = false; this.sync(); this.publish(); }
  }
  /** Refreshes presentation from shared state without consuming a new group. */
  sync(): void {
    if (!this.active || this.disposed || this.pending) return;
    const box = this.box();
    if (!box) { this.context.store.setDrawPaths(null); return; }
    const mode = normalizeBoxDraw(box.draw).mode;
    if (this.mode !== mode) { void this.generate(false); return; }
    if (mode !== "random") {
      if (!box.drawProgress?.currentGroup) {
        if (this.deps.pool().length > 0) void this.generate(false);
        else this.context.store.setDrawPaths([]);
        return;
      }
      this.context.store.setDrawPaths(box.drawProgress.currentGroup.paths);
    }
  }
  reconcile(event?: VaultMutationEvent): void {
    if (!this.active || this.pending || this.disposed) return;
    const box = this.box();
    if (!box) return;
    const old = [...(this.context.store.getDrawPaths() ?? [])];
    const app = this.context.getApp();
    const renamed = old.flatMap(path => {
      if (event?.eventType === "delete" && (path === event.path || (event.isFolder && path.startsWith(`${event.path}/`)))) return [];
      if (event?.eventType === "rename" && event.oldPath && (path === event.oldPath || (event.isFolder && path.startsWith(`${event.oldPath}/`)))) return [event.path + path.slice(event.oldPath.length)];
      return [path];
    });
    const corrected = reconcileBoxDrawMembership(app, { ...box, drawProgress: {
      round: 1, drawnPaths: [], currentGroup: { paths: renamed },
    } });
    const paths = corrected.drawProgress?.currentGroup?.paths ?? [];
    this.context.store.setDrawPaths(paths);
    if ((old.length > 0 && paths.length === 0) || (old.length === 0 && this.deps.pool().length > 0)) void this.generate(false);
  }
  async retrySave(): Promise<void> {
    try { await this.context.flushSettings?.(); this.saveFailed = false; }
    catch { this.context.notify(this.context.getUiStrings().box.drawSaveFailed); }
    this.publish();
  }
  async reset(boxId: string): Promise<void> {
    await this.context.waitForSettings?.();
    const boxes = this.context.getSettings().boxes;
    await this.context.saveSettings({ boxes: boxes.map(box => box.id === boxId ? { ...box, drawProgress: undefined } : box) });
    if (this.active && this.box()?.id === boxId) await this.generate(false);
  }
  snapshot() {
    const box = this.box();
    const pool = this.deps.pool();
    const set = new Set(pool);
    const mode = normalizeBoxDraw(box?.draw).mode;
    const progress = mode === "random" ? undefined : box?.drawProgress;
    const paths = this.context.store.getDrawPaths() ?? [];
    return { revision: this.context.store.getDrawRevision(), saveFailed: this.saveFailed, available: this.available, active: this.active, mode,
      count: paths.filter(path => set.has(path)).length, total: pool.length, round: progress?.round ?? 1,
      drawn: progress?.drawnPaths.filter(path => set.has(path)).length ?? 0,
      date: progress?.currentGroup?.date, canNext: this.canNext, paused: Boolean(this.deps.query().trim()) };
  }
  dispose(): void { this.disposed = true; this.context.store.setDrawPaths(null); }
}
