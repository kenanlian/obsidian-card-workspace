import type { GroupSpec } from "../../card-grouping-settings";
import { localDayOrdinal } from "../time-grouping";
import type { ViewContext } from "../view-context";

/** Owns only relative-period clock refreshes; all card work uses the normal projection. */
export class TimeGroupController {
  private timer: number | null = null;
  private day: number | null = null;
  private disposed = false;
  private readonly unsubscribe: (() => void) | undefined;

  constructor(private readonly context: ViewContext, private readonly deps: {
    getGroup: () => GroupSpec;
    isSearchActive: () => boolean;
    isSettled: () => boolean;
    refresh: () => void;
  }) {
    this.unsubscribe = context.workGate?.subscribe((active) => { if (active) this.sync(); else this.clearTimer(); });
  }

  sync(): void {
    this.clearTimer();
    if (this.disposed) return;
    const group = this.deps.getGroup();
    if ((group.dimension !== "ctime" && group.dimension !== "mtime") || group.timeGranularity !== "relative"
      || this.deps.isSearchActive()) { this.day = null; return; }
    const now = Date.now();
    const day = localDayOrdinal(now);
    // Remember the first projection even if the view opens while hidden.
    if (this.day === null) this.day = day;
    if (this.context.workGate?.isActive === false) return;
    const changed = this.day !== null && this.day !== day;
    // A pending scope load will publish fresh buckets itself. Keep the old day
    // until its commit so a wake cannot reproject the retained old scope.
    if (!this.deps.isSettled()) return;
    this.day = day;
    if (changed) this.deps.refresh();
    // refresh may synchronously publish and call sync again.
    this.clearTimer();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    this.timer = this.context.getViewWindow().setTimeout(() => this.sync(), Math.max(1, midnight.getTime() - now));
  }

  private clearTimer(): void {
    if (this.timer !== null) this.context.getViewWindow().clearTimeout(this.timer);
    this.timer = null;
  }
  dispose(): void { this.disposed = true; this.clearTimer(); this.unsubscribe?.(); }
}
