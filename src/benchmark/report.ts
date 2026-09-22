/**
 * Report schema and assembly helpers for the search benchmark harness.
 *
 * The report is a diagnostic baseline by default: it records what happened and
 * judges nothing. The single exception is the opt-in `--max-slice-ms` gate,
 * the only millisecond threshold in the schema. With the flag absent
 * `blocking.threshold` is null and no timing check is recorded at all, which is
 * what keeps a machine-dependent wall-clock assertion out of the CI `smoke`
 * run that `harness.test.ts` shells out to.
 *
 * Schema v2 renamed the ingest phase from `minisearch-add-all-async` to
 * `minisearch-budgeted-ingest` when the harness stopped calling
 * `MiniSearch.addAllAsync` and started calling the production
 * `addDocumentsWithYield`, and added `blocking.threshold`. Both are
 * consumer-visible, hence the version bump rather than an additive change.
 */

import { cpus, totalmem } from "node:os";

import type { BenchmarkProfileId, FixtureBucket, SyntheticFixtureFile } from "./fixtures";
import type { MemorySample, MeasuredPhase, RunMeasurement } from "./measurement";

export const SEARCH_BENCHMARK_REPORT_SCHEMA = "card-workspace.search-benchmark-report.v2";

export const PHASE_READ_PREPARE = "read-prepare";
export const PHASE_BUDGETED_INGEST = "minisearch-budgeted-ingest";
export const PHASE_TO_JSON = "minisearch-to-json";
export const PHASE_PERSIST_CLONE = "persist-structured-clone";
export const PHASE_JSON_STRINGIFY_DIAGNOSTIC = "size-estimate-json-stringify";
export const PHASE_SAMPLE_QUERIES = "search-sample-queries";

export const PHASE_NOTES: Readonly<Record<string, string>> = {
  [PHASE_READ_PREPARE]:
    "Vault I/O is simulated (fixture Markdown already in memory), so this measures production text preparation (prepareSearchableDocument) with no awaited reads interleaving; treat its max slice as the total CPU upper bound.",
  [PHASE_BUDGETED_INGEST]:
    "The production full-build ingest path: addDocumentsWithYield from src/search/index-ingest.ts, adding documents in list order via the synchronous MiniSearch.add and yielding (setTimeout 0) whenever the accumulated term estimate reaches INGEST_YIELD_TERM_BUDGET. This is not MiniSearch.addAllAsync, whose 10-document chunking the production code deliberately abandoned. This is the phase the opt-in --max-slice-ms gate judges.",
  [PHASE_TO_JSON]:
    "Fully synchronous MiniSearch.toJSON() snapshot — the exact call the production persist path performs.",
  [PHASE_PERSIST_CLONE]:
    "v8.serialize of the IndexStore record shape ({ metadata, serializedIndex }); simulates structured-clone persistence cost without touching real IndexedDB.",
  [PHASE_JSON_STRINGIFY_DIAGNOSTIC]:
    "DIAGNOSTIC-ONLY ISOLATED EXPERIMENT: JSON.stringify of the whole snapshot, measured for byte-size comparison. The production persist path keeps structured-clone objects and must never stringify a whole-vault index.",
  [PHASE_SAMPLE_QUERIES]:
    "Sample queries executed with production MINISEARCH_SEARCH_OPTIONS against the in-memory index.",
};

export const MAX_SLICE_CHECK_ID = "production-build-slices-within-thresholds";

/**
 * The phase `--max-slice-ms` applies to directly: production budgeted
 * ingestion, the slice the per-field term cap and the ingest term budget exist
 * to bound.
 */
export const INGEST_GATED_PHASE_ID = PHASE_BUDGETED_INGEST;

/**
 * Fixed ceiling for the remaining production-relevant build phases.
 *
 * `toJSON()` and the structured-clone persist are unavoidably synchronous in
 * production and no contract in the current plan reduces them, so they cannot
 * share the ingest threshold. They still must not regress without notice,
 * hence a separate, deliberately looser ceiling. It is a constant rather than
 * a flag because nothing in a normal run should be tuning it.
 */
export const OTHER_BUILD_PHASE_MAX_SLICE_MS = 750;

export const OTHER_BUILD_PHASE_IDS: readonly string[] = [PHASE_TO_JSON, PHASE_PERSIST_CLONE];

/**
 * Phases held out of both ceilings, each with its reason, so a passing run
 * cannot be mistaken for a claim about phases the gate never examined.
 *
 * Note what is absent from this list: the global `blocking.maxSliceMs`. That
 * value is reported but never gated, because it is dominated by
 * `read-prepare`, a harness artifact (see below).
 */
export const THRESHOLD_EXCLUDED_PHASE_REASONS: Readonly<Record<string, string>> = {
  [PHASE_READ_PREPARE]:
    "Benchmark artifact: fixture Markdown is already in memory, so the whole corpus is prepared in one synchronous loop. Production interleaves awaited vault reads every 200 documents, which puts per-window preparation two orders of magnitude below this figure. No renderer experiences this slice.",
  [PHASE_JSON_STRINGIFY_DIAGNOSTIC]:
    "Diagnostic-only isolated experiment that production is forbidden to perform; gating it would gate code that does not ship.",
  [PHASE_SAMPLE_QUERIES]:
    "Query-time cost over a finished index, not a build phase at all.",
};

/**
 * Mirrors the persisted-record metadata shape. Values are benchmark-labeled so
 * the clone payload has realistic shape without importing the
 * Obsidian-dependent SearchCoordinator.
 */
export const PERSIST_RECORD_METADATA = {
  vaultNamespace: "benchmark://synthetic-fixture",
  schemaVersion: "benchmark-shape-only",
  tokenizerVersion: "benchmark-shape-only",
  pluginVersion: "benchmark",
} as const;

export interface SearchBenchmarkEnvironment {
  nodeVersion: string;
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCount: number;
  totalMemoryBytes: number;
  exposeGc: boolean;
}

export interface SearchBenchmarkFixturesSummary {
  filesTotal: number;
  indexedDocuments: number;
  excludedAttachments: number;
  digest: string;
  byBucket: Array<{ bucket: FixtureBucket; files: number; markdownChars: number }>;
}

export interface SearchBenchmarkPhase {
  id: string;
  wallMs: number;
  maxSliceMs: number;
  yieldsObserved: number;
  note: string;
  diagnosticOnly: boolean;
}

export interface SearchBenchmarkCorrectnessCheck {
  id: string;
  passed: boolean;
  detail: string;
}

/**
 * One phase's verdict. `maxSliceMs` is null when the phase did not run at all,
 * which fails rather than passing vacuously: a phase that produced no
 * measurement cannot be certified.
 */
export interface SearchBenchmarkPhaseVerdict {
  id: string;
  maxSliceMs: number | null;
  ceilingMs: number;
  passed: boolean;
}

/**
 * Present only when `--max-slice-ms` was supplied; null otherwise.
 *
 * Two ceilings, because the phases have different contracts behind them:
 * `ingestThresholdMs` is the caller's `--max-slice-ms` applied to production
 * budgeted ingestion, and `otherBuildPhaseCeilingMs` is the fixed
 * OTHER_BUILD_PHASE_MAX_SLICE_MS applied to the remaining synchronous build
 * phases. `passed` is the conjunction. Recording both ceilings, every observed
 * value, every per-phase verdict, and every exclusion with its reason keeps
 * the report self-describing, so a reader never has to guess what a pass
 * covered.
 */
export interface SearchBenchmarkBlockingThreshold {
  ingestThresholdMs: number;
  otherBuildPhaseCeilingMs: number;
  ingest: SearchBenchmarkPhaseVerdict;
  otherBuildPhases: SearchBenchmarkPhaseVerdict[];
  excludedPhases: Array<{ id: string; reason: string }>;
  passed: boolean;
}

export interface SearchBenchmarkReport {
  schema: typeof SEARCH_BENCHMARK_REPORT_SCHEMA;
  generatedAt: string;
  profile: BenchmarkProfileId;
  seed: number;
  environment: SearchBenchmarkEnvironment;
  fixtures: SearchBenchmarkFixturesSummary;
  stages: SearchBenchmarkPhase[];
  blocking: {
    method: string;
    maxSliceMs: number;
    perPhaseMaxSliceMs: Record<string, number>;
    /** The INGEST_YIELD_TERM_BUDGET the measured ingest phase actually ran under. */
    ingestTermBudget: number;
    note: string;
    threshold: SearchBenchmarkBlockingThreshold | null;
  };
  memory: {
    method: string;
    baseline: MemorySample;
    peak: MemorySample;
    final: MemorySample;
    sampleCount: number;
  };
  index: {
    documentCount: number;
    snapshotStructuredCloneBytes: number;
    snapshotJsonStringifyBytes: {
      bytes: number;
      diagnosticOnly: true;
      note: string;
    };
  };
  correctness: {
    allPassed: boolean;
    checks: SearchBenchmarkCorrectnessCheck[];
  };
}

const BUCKET_ORDER: readonly FixtureBucket[] = [
  "english-small",
  "han",
  "mixed",
  "tiny",
  "near-cap",
  "over-cap",
  "near-cap-han",
  "over-cap-han",
  "markers",
  "canvas",
  "base",
  "excalidraw",
  "attachment",
];

export function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function judgePhase(
  id: string,
  ceilingMs: number,
  perPhaseMaxSliceMs: Readonly<Record<string, number>>,
): SearchBenchmarkPhaseVerdict {
  const sliceMs = perPhaseMaxSliceMs[id];
  if (sliceMs === undefined) {
    return { id, maxSliceMs: null, ceilingMs, passed: false };
  }
  const maxSliceMs = roundMs(sliceMs);
  return { id, maxSliceMs, ceilingMs, passed: maxSliceMs <= ceilingMs };
}

/**
 * Applies the caller's threshold to production ingestion and the fixed
 * OTHER_BUILD_PHASE_MAX_SLICE_MS ceiling to the remaining build phases. Both
 * ceilings are inclusive, matching R3's "must not block for longer than".
 */
export function evaluateBlockingThreshold(
  ingestThresholdMs: number,
  perPhaseMaxSliceMs: Readonly<Record<string, number>>,
): SearchBenchmarkBlockingThreshold {
  const ingest = judgePhase(INGEST_GATED_PHASE_ID, ingestThresholdMs, perPhaseMaxSliceMs);
  const otherBuildPhases = OTHER_BUILD_PHASE_IDS.map((id) =>
    judgePhase(id, OTHER_BUILD_PHASE_MAX_SLICE_MS, perPhaseMaxSliceMs),
  );
  return {
    ingestThresholdMs,
    otherBuildPhaseCeilingMs: OTHER_BUILD_PHASE_MAX_SLICE_MS,
    ingest,
    otherBuildPhases,
    excludedPhases: Object.entries(THRESHOLD_EXCLUDED_PHASE_REASONS).map(([id, reason]) => ({
      id,
      reason,
    })),
    passed: ingest.passed && otherBuildPhases.every((phase) => phase.passed),
  };
}

function describePhaseVerdict(verdict: SearchBenchmarkPhaseVerdict): string {
  return `${verdict.id} observed ${verdict.maxSliceMs ?? "<did not run>"}ms`
    + ` expected <= ${verdict.ceilingMs}ms (${verdict.passed ? "pass" : "FAIL"})`;
}

/** Single-line observed-versus-expected summary; main.ts prints it to stderr. */
export function describeBlockingThreshold(threshold: SearchBenchmarkBlockingThreshold): string {
  const phases = [threshold.ingest, ...threshold.otherBuildPhases].map(describePhaseVerdict).join("; ");
  const excluded = threshold.excludedPhases.map((phase) => phase.id).join(", ");
  return `${phases}; excluded: ${excluded}`;
}

export function buildEnvironment(): SearchBenchmarkEnvironment {
  const cpuInfos = cpus();
  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpuInfos[0]?.model ?? "unknown",
    cpuCount: cpuInfos.length,
    totalMemoryBytes: totalmem(),
    exposeGc: typeof (globalThis as { gc?: unknown }).gc === "function",
  };
}

export function summarizeFixtures(
  files: readonly SyntheticFixtureFile[],
  indexedDocuments: number,
  excludedAttachments: number,
  digest: string,
): SearchBenchmarkFixturesSummary {
  return {
    filesTotal: files.length,
    indexedDocuments,
    excludedAttachments,
    digest,
    byBucket: BUCKET_ORDER.map((bucket) => {
      const bucketFiles = files.filter((file) => file.bucket === bucket);
      return {
        bucket,
        files: bucketFiles.length,
        markdownChars: bucketFiles.reduce((total, file) => total + (file.markdown?.length ?? 0), 0),
      };
    }),
  };
}

export function toReportPhases(measurement: RunMeasurement): SearchBenchmarkPhase[] {
  return measurement.phases.map((phase: MeasuredPhase) => ({
    id: phase.id,
    wallMs: roundMs(phase.wallMs),
    maxSliceMs: roundMs(phase.maxSliceMs),
    yieldsObserved: phase.yieldsObserved,
    note: PHASE_NOTES[phase.id] ?? "",
    diagnosticOnly: phase.id === PHASE_JSON_STRINGIFY_DIAGNOSTIC,
  }));
}
