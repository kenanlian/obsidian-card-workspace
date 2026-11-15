import type { TaskFileEntry, TaskIndexChange, TaskIndexReader } from "../../tasks";
import { AsyncEpoch, type EpochToken } from "../async-epoch";
import { scopeIdentity } from "../scope";
import type { CardStreamMode, TaskViewStatus } from "../types";
import { resolveViewConfig } from "../view-config";
import type { DisposableController, DisposeReport, ViewContext } from "../view-context";

/** Coalesces bursts of task-index change notifications into one reprojection. */
const TASK_CHANGE_COALESCE_MS = 50;

export interface TaskViewControllerDeps {
  context: ViewContext;
  getTaskIndex: () => TaskIndexReader | null;
  /** When omitted, the scope is treated as settled. */
  isScopeSettled?: () => boolean;
  /** Runs after the controller has switched streams, so nested reprojections see the new state. */
  onStreamModeChanged?: (mode: CardStreamMode) => void;
  /** Reprojects visible rows; must not re-enter a publish. */
  reproject: () => void;
  publish: () => void;
}

/**
 * Owns task-mode runtime for one view: the task status of the current scope,
 * on-demand `TaskIndex.ensure` calls, and task-index change subscriptions.
 *
 * `sync()` runs at the start of every reprojection. In card mode it only tears
 * task state down and never reads files. In task mode the first projection of
 * a scope reports `building` and no task rows; the complete list is projected
 * once every Markdown base path has an entry. Paths that join the base set
 * later are ensured without leaving `ready`. Stale ensures are dropped by
 * scope epoch and aborted.
 */
export class TaskViewController implements DisposableController {
  private status: TaskViewStatus = "idle";
  /** Scope identity the task state belongs to; null outside task mode. */
  private activeKey: string | null = null;
  private readonly scopeEpoch = new AsyncEpoch();
  private abort: AbortController | null = null;
  /** Paths requested under the current scope epoch; never re-requested for that epoch. */
  private requested = new Set<string>();
  private unsubscribe: (() => void) | null = null;
  private changeTimer: ReturnType<Window["setTimeout"]> | null = null;
  private disposed = false;

  constructor(private readonly deps: TaskViewControllerDeps) {}

  private get context(): ViewContext {
    return this.deps.context;
  }

  isTaskMode(): boolean {
    return resolveViewConfig(this.context.store.getScope(), this.context.getSettings()).viewMode === "tasks";
  }

  /** `idle` outside task mode. */
  getStatus(): TaskViewStatus {
    return this.status;
  }

  getEntry(path: string): TaskFileEntry | null {
    return this.deps.getTaskIndex()?.get(path) ?? null;
  }

  sync(): void {
    if (this.disposed) return;
    if (!this.isTaskMode()) {
      if (this.activeKey === null) return;
      this.reset();
      this.deps.onStreamModeChanged?.("cards");
      return;
    }

    const key = scopeIdentity(this.context.store.getScope());
    if (this.activeKey === key) {
      this.ensureMissing();
      return;
    }
    const entering = this.activeKey === null;
    this.reset();
    this.activeKey = key;
    this.status = "building";
    this.subscribe();
    if (entering) this.deps.onStreamModeChanged?.("tasks");
    this.startInitialEnsure();
  }

  private markdownBasePaths(): string[] {
    return this.context.store.getBaseCards()
      .filter((card) => card.fileKind === "markdown")
      .map((card) => card.path);
  }

  private startInitialEnsure(): void {
    const index = this.deps.getTaskIndex();
    const paths = this.markdownBasePaths();
    for (const path of paths) this.requested.add(path);
    // Ensured entries are kept current by the index, so a revisited scope is ready at once.
    const missing = index === null ? [] : paths.filter((path) => index.get(path) === null);
    if (index === null || missing.length === 0) {
      this.status = "ready";
      return;
    }
    const token = this.scopeEpoch.token();
    void this.runEnsure(index, missing, token).then((current) => {
      if (!current) return;
      this.status = "ready";
      this.reprojectAndPublish();
    });
  }

  /** Base paths without an entry (created or renamed into scope) are read while staying `ready`. */
  private ensureMissing(): void {
    const index = this.deps.getTaskIndex();
    if (index === null) return;
    const missing = this.markdownBasePaths()
      .filter((path) => !this.requested.has(path) && index.get(path) === null);
    if (missing.length === 0) return;
    const token = this.scopeEpoch.token();
    for (const path of missing) this.requested.add(path);
    void this.runEnsure(index, missing, token).then((current) => {
      if (!current || this.status !== "ready") return;
      this.reprojectAndPublish();
    });
  }

  /** Resolves true only when the ensure finished for the still-current scope epoch. */
  private async runEnsure(index: TaskIndexReader, paths: readonly string[], token: EpochToken): Promise<boolean> {
    this.abort ??= new AbortController();
    const signal = this.abort.signal;
    try {
      await index.ensure(paths, signal);
    } catch (error) {
      if (!this.isCurrent(token) || signal.aborted) return false;
      // A failed read must not leave the stream building; project what exists.
      console.warn("[Card Workspace] Task index read failed.", error);
    }
    return this.isCurrent(token);
  }

  private isCurrent(token: EpochToken): boolean {
    return !this.disposed && this.scopeEpoch.isCurrent(token) && this.activeKey !== null;
  }

  private subscribe(): void {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = this.deps.getTaskIndex()?.subscribe((change) => this.handleTaskIndexChange(change)) ?? null;
  }

  private handleTaskIndexChange(change: TaskIndexChange): void {
    // The initial ensure projects once on completion; partial lists are never published.
    if (this.disposed || this.status !== "ready" || !this.isTaskMode()) return;
    const store = this.context.store;
    if (![...change.paths].some((path) => store.getBaseCard(path) !== undefined)) return;
    if (this.changeTimer !== null) return;
    this.changeTimer = this.context.getViewWindow().setTimeout(() => {
      this.changeTimer = null;
      if (this.disposed || this.status !== "ready" || !this.isTaskMode()) return;
      this.reprojectAndPublish();
    }, TASK_CHANGE_COALESCE_MS);
  }

  /** A pending scope load reprojects and publishes on commit with the new status. */
  private reprojectAndPublish(): void {
    if (this.deps.isScopeSettled?.() === false) return;
    this.deps.reproject();
    this.deps.publish();
  }

  private clearChangeTimer(): boolean {
    if (this.changeTimer === null) return false;
    this.context.getViewWindow().clearTimeout(this.changeTimer);
    this.changeTimer = null;
    return true;
  }

  private reset(): void {
    this.scopeEpoch.bump();
    this.abort?.abort();
    this.abort = null;
    this.requested = new Set<string>();
    this.clearChangeTimer();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.activeKey = null;
    this.status = "idle";
  }

  dispose(): DisposeReport {
    const cancelledDebounce = this.clearChangeTimer();
    this.reset();
    this.disposed = true;
    return { cancelledDebounce };
  }
}
