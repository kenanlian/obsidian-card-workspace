/**
 * Report schema and assembly helpers for the search benchmark harness.
 *
 * The report is a diagnostic baseline: it records what happened, never whether
 * it was "fast enough" — no millisecond thresholds exist anywhere in the
 * schema.
 */

import { cpus, totalmem } from "node:os";

import type { BenchmarkProfileId, FixtureBucket, SyntheticFixtureFile } from "./fixtures";
import type { MemorySample, MeasuredPhase, RunMeasurement } from "./measurement";

export const SEARCH_BENCHMARK_REPORT_SCHEMA = "card-workspace.search-benchmark-report.v1";

export const PHASE_READ_PREPARE = "read-prepare";
export const PHASE_ADD_ALL_ASYNC = "minisearch-add-all-async";
export const PHASE_TO_JSON = "minisearch-to-json";
export const PHASE_PERSIST_CLONE = "persist-structured-clone";
export const PHASE_JSON_STRINGIFY_DIAGNOSTIC = "size-estimate-json-stringify";
export const PHASE_SAMPLE_QUERIES = "search-sample-queries";

export const PHASE_NOTES: Readonly<Record<string, string>> = {
  [PHASE_READ_PREPARE]:
    "Vault I/O is simulated (fixture Markdown already in memory), so this measures production text preparation (prepareSearchableDocument) with no awaited reads interleaving; treat its max slice as the total CPU upper bound.",
  [PHASE_ADD_ALL_ASYNC]:
    "MiniSearch.addAllAsync with production defaults: a cooperative yield (setTimeout 0) every 10 documents.",
  [PHASE_TO_JSON]:
    "Fully synchronous MiniSearch.toJSON() snapshot — the exact call the production persist path performs.",
  [PHASE_PERSIST_CLONE]:
    "v8.serialize of the IndexStore record shape ({ metadata, serializedIndex }); simulates structured-clone persistence cost without touching real IndexedDB.",
  [PHASE_JSON_STRINGIFY_DIAGNOSTIC]:
    "DIAGNOSTIC-ONLY ISOLATED EXPERIMENT: JSON.stringify of the whole snapshot, measured for byte-size comparison. The production persist path keeps structured-clone objects and must never stringify a whole-vault index.",
  [PHASE_SAMPLE_QUERIES]:
    "Sample queries executed with production MINISEARCH_SEARCH_OPTIONS against the in-memory index.",
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
    note: string;
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
  "markers",
  "canvas",
  "base",
  "excalidraw",
  "attachment",
];

export function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
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
