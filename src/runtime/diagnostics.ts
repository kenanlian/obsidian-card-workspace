export type RuntimePhase = "replacement" | "ingest" | "persist" | "read-source" | "preview" | "thumbnail";
interface PhaseTiming { completed: number; lastMs: number; totalMs: number }
/** Six aggregate slots, read on demand. Durations include cooperative waits. */
export class RuntimePhaseTimings {
  private readonly phases = new Map<RuntimePhase, PhaseTiming>();
  start(phase: RuntimePhase): () => void {
    const started = performance.now(); let finished = false;
    return () => {
      if (finished) return; finished = true;
      const elapsed = Math.max(0, performance.now() - started);
      const previous = this.phases.get(phase);
      this.phases.set(phase, { completed: (previous?.completed ?? 0) + 1, lastMs: elapsed, totalMs: (previous?.totalMs ?? 0) + elapsed });
    };
  }
  snapshot(): Partial<Record<RuntimePhase, PhaseTiming>> {
    return Object.fromEntries([...this.phases].map(([phase, timing]) => [phase, { ...timing }]));
  }
}
