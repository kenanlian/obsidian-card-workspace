/**
 * Measurement utilities for the search benchmark harness.
 *
 * `BenchmarkRunTracker` measures two things per phase:
 * - wall time (`performance.now()` deltas), and
 * - the longest continuous blocking slice, via a `setImmediate` heartbeat:
 *   while the event loop is blocked (synchronous regex prep, `toJSON()`,
 *   serialization), heartbeats queue up, so the largest gap between two
 *   consecutive heartbeats approximates the longest time the run went without
 *   a cooperative yield. This mirrors what the production renderer
 *   experiences during an index build.
 *
 * Heap metrics come from `process.memoryUsage()` sampled on every heartbeat
 * and at phase boundaries; peak values are componentwise maxima.
 */

import { performance } from "node:perf_hooks";

export interface MemorySample {
  heapUsedBytes: number;
  heapTotalBytes: number;
  rssBytes: number;
  externalBytes: number;
}

export interface MeasuredPhase {
  id: string;
  wallMs: number;
  maxSliceMs: number;
  yieldsObserved: number;
}

export interface RunMeasurement {
  phases: MeasuredPhase[];
  overallMaxSliceMs: number;
  baselineMemory: MemorySample;
  peakMemory: MemorySample;
  finalMemory: MemorySample;
  memorySampleCount: number;
}

export function readMemorySample(): MemorySample {
  const usage = process.memoryUsage();
  return {
    heapUsedBytes: usage.heapUsed,
    heapTotalBytes: usage.heapTotal,
    rssBytes: usage.rss,
    externalBytes: usage.external,
  };
}

function maxSample(left: MemorySample, right: MemorySample): MemorySample {
  return {
    heapUsedBytes: Math.max(left.heapUsedBytes, right.heapUsedBytes),
    heapTotalBytes: Math.max(left.heapTotalBytes, right.heapTotalBytes),
    rssBytes: Math.max(left.rssBytes, right.rssBytes),
    externalBytes: Math.max(left.externalBytes, right.externalBytes),
  };
}

export class BenchmarkRunTracker {
  private immediate: ReturnType<typeof setImmediate> | null = null;
  private lastTickAt = 0;
  private readonly baselineMemory = readMemorySample();
  private peakMemory = this.baselineMemory;
  private memorySampleCount = 0;
  private overallMaxSliceMs = 0;
  private readonly phases: MeasuredPhase[] = [];
  private activePhase: MeasuredPhase | null = null;
  private phaseStartedAt = 0;

  start(): void {
    this.lastTickAt = performance.now();
    this.sampleMemory();
    this.scheduleTick();
  }

  /** Accounts for a heartbeat gap measured up to `now` (may span a total event-loop block). */
  private recordPendingGap(now: number): void {
    const sliceMs = now - this.lastTickAt;
    if (sliceMs > this.overallMaxSliceMs) {
      this.overallMaxSliceMs = sliceMs;
    }
    if (this.activePhase !== null && sliceMs > this.activePhase.maxSliceMs) {
      this.activePhase.maxSliceMs = sliceMs;
    }
    this.lastTickAt = now;
  }

  beginPhase(id: string): void {
    const now = performance.now();
    // A gap still pending when a new phase starts covers synchronous work that
    // ran between phases; count it toward the overall maximum only.
    this.recordPendingGap(now);
    this.activePhase = { id, wallMs: 0, maxSliceMs: 0, yieldsObserved: 0 };
    this.phaseStartedAt = now;
    this.scheduleTick();
  }

  endPhase(): void {
    if (this.activePhase === null) {
      return;
    }
    const now = performance.now();
    // No heartbeat can fire while the loop is blocked, so a gap still pending
    // at phase end IS the synchronous slice: attribute it to this phase
    // instead of losing it (a fully synchronous phase records zero yields).
    this.recordPendingGap(now);
    this.activePhase.wallMs = now - this.phaseStartedAt;
    this.phases.push(this.activePhase);
    this.activePhase = null;
    this.sampleMemory();
  }

  finish(): RunMeasurement {
    this.endPhase();
    if (this.immediate !== null) {
      clearImmediate(this.immediate);
      this.immediate = null;
    }
    const finalMemory = readMemorySample();
    return {
      phases: [...this.phases],
      overallMaxSliceMs: this.overallMaxSliceMs,
      baselineMemory: this.baselineMemory,
      peakMemory: maxSample(this.peakMemory, finalMemory),
      finalMemory,
      memorySampleCount: this.memorySampleCount,
    };
  }

  private scheduleTick(): void {
    if (this.immediate === null) {
      this.immediate = setImmediate(this.observeTick);
    }
  }

  private readonly observeTick = (): void => {
    this.immediate = null;
    this.recordPendingGap(performance.now());
    if (this.activePhase !== null) {
      this.activePhase.yieldsObserved += 1;
    }
    this.sampleMemory();
    this.scheduleTick();
  };

  private sampleMemory(): void {
    this.peakMemory = maxSample(this.peakMemory, readMemorySample());
    this.memorySampleCount += 1;
  }
}
