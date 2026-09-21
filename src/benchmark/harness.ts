/**
 * Search performance benchmark harness.
 *
 * Measures the four stages a full-vault index build costs the renderer:
 * document read/prepare, MiniSearch `addAllAsync`, `toJSON()` serialization,
 * and persistence (structured clone). Every stage reuses the real production
 * code paths — `prepareSearchableDocument`, `createMiniSearchOptions`,
 * `tokenizeSearchIndexText` (through those options), and
 * `MINISEARCH_SEARCH_OPTIONS` — so the numbers reflect what the plugin
 * actually executes, never a detached fake tokenizer.
 *
 * The harness is diagnostic-only: it writes nothing, touches no vault, and
 * never opens IndexedDB. Persistence cost is simulated with `v8.serialize`
 * (the same V8 value-serializer machinery behind structured clone). The only
 * `JSON.stringify` on a whole index snapshot is the explicitly labeled
 * diagnostic experiment below and must never be copied into production code.
 */

import MiniSearch from "minisearch";
import { serialize as v8Serialize } from "node:v8";

import { prepareSearchableDocument } from "../search/document-preparation";
import { createMiniSearchOptions, MINISEARCH_SEARCH_OPTIONS } from "../search/minisearch-options";
import type { SearchableDocument } from "../search/types";
import { isMarkdownCardKind, resolveCardFileKindFromPath } from "../view/file-kind";
import {
  BENCHMARK_PROFILE_SPECS,
  ENGLISH_NEEDLE_PATH,
  ENGLISH_NEEDLE_QUERY,
  HAN_NEEDLE_PATH,
  HAN_NEEDLE_QUERY,
  NEAR_CAP_PATH,
  NEAR_CAP_TAIL_MARKER,
  OVER_CAP_HEAD_MARKER,
  OVER_CAP_PATH,
  OVER_CAP_TAIL_MARKER,
  computeFixtureDigest,
  generateSyntheticVault,
  type BenchmarkProfileId,
  type SyntheticFixtureFile,
} from "./fixtures";
import { BenchmarkRunTracker } from "./measurement";
import {
  PERSIST_RECORD_METADATA,
  PHASE_ADD_ALL_ASYNC,
  PHASE_JSON_STRINGIFY_DIAGNOSTIC,
  PHASE_PERSIST_CLONE,
  PHASE_READ_PREPARE,
  PHASE_SAMPLE_QUERIES,
  PHASE_TO_JSON,
  buildEnvironment,
  roundMs,
  summarizeFixtures,
  toReportPhases,
  SEARCH_BENCHMARK_REPORT_SCHEMA,
  type SearchBenchmarkCorrectnessCheck,
  type SearchBenchmarkReport,
} from "./report";

export { SEARCH_BENCHMARK_REPORT_SCHEMA } from "./report";

const SAMPLE_QUERIES: readonly string[] = [
  "vault", "search", "index", "snapshot", "rebuild", "preview", "markdown", "highlight", "memory", "benchmark",
  "搜索", "索引", "笔记", "标签", "快照", "预览",
  "card 卡片", "search 搜索",
  ENGLISH_NEEDLE_QUERY,
  HAN_NEEDLE_QUERY,
];

interface BenchmarkSearchResult {
  path?: string;
  score?: number;
}

export interface RunSearchBenchmarkOptions {
  profile: BenchmarkProfileId;
  seed?: number;
}

/**
 * Mirrors `SearchDocumentSource.prepareSearchDocument` minus the vault read:
 * Markdown card kinds get full text preparation, other supported kinds stay
 * title-only, and attachments never reach this function.
 */
function prepareFixtureDocument(file: SyntheticFixtureFile): SearchableDocument {
  const kind = resolveCardFileKindFromPath(file.path);
  if (kind !== null && isMarkdownCardKind(kind) && file.markdown !== null) {
    return prepareSearchableDocument({
      path: file.path,
      title: file.title,
      markdown: file.markdown,
      mtime: file.mtime,
      ctime: file.ctime,
    });
  }
  return prepareSearchableDocument({
    path: file.path,
    title: file.title,
    mtime: file.mtime,
    ctime: file.ctime,
  });
}

/**
 * Mirrors the core of `SearchIndexManager.search`: production query options,
 * then intersection with the candidate-path scope.
 */
function searchLikeManager(
  index: MiniSearch<SearchableDocument>,
  query: string,
  candidatePaths: readonly string[],
): string[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [...candidatePaths];
  }
  const allowed = new Set(candidatePaths);
  const results = index.search(trimmed, MINISEARCH_SEARCH_OPTIONS) as unknown as BenchmarkSearchResult[];
  const ordered: string[] = [];
  for (const result of results) {
    if (typeof result.path !== "string" || !allowed.has(result.path)) {
      continue;
    }
    ordered.push(result.path);
  }
  return ordered;
}

export async function runSearchBenchmark(
  options: RunSearchBenchmarkOptions,
): Promise<SearchBenchmarkReport> {
  const spec = BENCHMARK_PROFILE_SPECS[options.profile];
  const seed = options.seed ?? spec.defaultSeed;

  const files = generateSyntheticVault(options.profile, seed);
  const fixtureDigest = computeFixtureDigest(files);
  const regenerationDigest = computeFixtureDigest(generateSyntheticVault(options.profile, seed));

  const tracker = new BenchmarkRunTracker();
  tracker.start();

  // Phase 1: read/prepare. Fixture content is already in memory, so this is
  // the production text-preparation cost over the whole synthetic vault.
  tracker.beginPhase(PHASE_READ_PREPARE);
  const documents: SearchableDocument[] = [];
  const documentsByPath = new Map<string, SearchableDocument>();
  const excludedAttachmentPaths: string[] = [];
  for (const file of files) {
    if (resolveCardFileKindFromPath(file.path) === null) {
      excludedAttachmentPaths.push(file.path);
      continue;
    }
    const document = prepareFixtureDocument(file);
    documents.push(document);
    documentsByPath.set(document.path, document);
  }
  tracker.endPhase();

  // Phase 2: MiniSearch add. Production calls addAllAsync(documents) with the
  // default chunk size (cooperative yield every 10 documents).
  tracker.beginPhase(PHASE_ADD_ALL_ASYNC);
  const index = new MiniSearch<SearchableDocument>(createMiniSearchOptions());
  if (documents.length > 0) {
    await index.addAllAsync(documents);
  }
  tracker.endPhase();

  // Phase 3: toJSON — the synchronous snapshot production persists.
  tracker.beginPhase(PHASE_TO_JSON);
  const snapshot = index.toJSON();
  tracker.endPhase();

  // Phase 4: simulated persistence. Structured clone via the V8 value
  // serializer over the exact record shape IndexStore writes.
  tracker.beginPhase(PHASE_PERSIST_CLONE);
  const persistRecord = {
    metadata: { ...PERSIST_RECORD_METADATA, documentCount: documents.length, lastIndexedAt: 0 },
    serializedIndex: snapshot,
  };
  const structuredCloneBuffer = v8Serialize(persistRecord);
  tracker.endPhase();

  // Phase 5 (diagnostic-only): whole-index JSON.stringify. Labeled and
  // isolated; the production path persists structured-clone objects.
  tracker.beginPhase(PHASE_JSON_STRINGIFY_DIAGNOSTIC);
  const jsonStringifyBytes = JSON.stringify(snapshot).length;
  tracker.endPhase();

  // Phase 6: sample queries through production search options.
  tracker.beginPhase(PHASE_SAMPLE_QUERIES);
  const allPaths = documents.map((document) => document.path);
  for (const query of SAMPLE_QUERIES) {
    searchLikeManager(index, query, allPaths);
  }
  tracker.endPhase();

  const measurement = tracker.finish();

  const overCapDocument = documentsByPath.get(OVER_CAP_PATH) ?? null;
  const overCapFile = files.find((file) => file.path === OVER_CAP_PATH) ?? null;
  const nearCapDocument = documentsByPath.get(NEAR_CAP_PATH) ?? null;
  const canvasFile = files.find((file) => file.bucket === "canvas") ?? null;
  const canvasDocument = canvasFile === null ? null : documentsByPath.get(canvasFile.path) ?? null;

  const englishOrdered = searchLikeManager(index, ENGLISH_NEEDLE_QUERY, allPaths);
  const hanOrdered = searchLikeManager(index, HAN_NEEDLE_QUERY, allPaths);

  const checks: SearchBenchmarkCorrectnessCheck[] = [];
  const recordCheck = (id: string, passed: boolean, detail: string): void => {
    checks.push({ id, passed, detail });
  };

  recordCheck(
    "known-query-english-returns-expected-path",
    englishOrdered[0] === ENGLISH_NEEDLE_PATH,
    `query "${ENGLISH_NEEDLE_QUERY}" top result: ${englishOrdered[0] ?? "<none>"} (expected ${ENGLISH_NEEDLE_PATH})`,
  );
  recordCheck(
    "known-query-han-returns-expected-path",
    hanOrdered[0] === HAN_NEEDLE_PATH,
    `query "${HAN_NEEDLE_QUERY}" top result: ${hanOrdered[0] ?? "<none>"} (expected ${HAN_NEEDLE_PATH})`,
  );
  recordCheck(
    "oversize-cap-head-indexed",
    overCapDocument?.content.includes(OVER_CAP_HEAD_MARKER) === true,
    "the >512KB note's head marker survives the production 512KB slice",
  );
  recordCheck(
    "oversize-cap-tail-dropped",
    overCapDocument !== null
      && !overCapDocument.content.includes(OVER_CAP_TAIL_MARKER)
      && overCapFile !== null
      && overCapFile.markdown !== null
      && overCapDocument.content.length < overCapFile.markdown.length,
    "the >512KB note's tail marker is cut and content is shorter than the source Markdown",
  );
  recordCheck(
    "near-cap-fully-indexed",
    nearCapDocument?.content.includes(NEAR_CAP_TAIL_MARKER) === true,
    "the just-under-cap note is indexed through its final marker",
  );
  recordCheck(
    "non-markdown-kinds-title-only",
    canvasDocument !== null && canvasDocument.content === "" && canvasDocument.title === canvasFile?.title,
    "canvas (and by the same code path base/excalidraw) documents stay title-only with empty content",
  );
  recordCheck(
    "attachments-excluded-from-document-source",
    excludedAttachmentPaths.length === spec.buckets.attachment
      && excludedAttachmentPaths.every((path) => resolveCardFileKindFromPath(path) === null),
    `${excludedAttachmentPaths.length} attachment files were filtered before document preparation`,
  );
  recordCheck(
    "fixture-deterministic",
    fixtureDigest === regenerationDigest,
    `regenerating the fixture with seed ${seed} produced digest ${regenerationDigest}`,
  );
  recordCheck(
    "document-count-matches-index",
    index.documentCount === documents.length,
    `index.documentCount=${index.documentCount}, prepared documents=${documents.length}`,
  );

  const reportPhases = toReportPhases(measurement);
  const perPhaseMaxSliceMs: Record<string, number> = {};
  for (const phase of reportPhases) {
    perPhaseMaxSliceMs[phase.id] = phase.maxSliceMs;
  }

  return {
    schema: SEARCH_BENCHMARK_REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    profile: options.profile,
    seed,
    environment: buildEnvironment(),
    fixtures: summarizeFixtures(files, documents.length, excludedAttachmentPaths.length, fixtureDigest),
    stages: reportPhases,
    blocking: {
      method: "setImmediate-heartbeat-gap",
      maxSliceMs: roundMs(measurement.overallMaxSliceMs),
      perPhaseMaxSliceMs,
      note: "Largest observed gap between consecutive setImmediate heartbeats. While the event loop is blocked, heartbeats queue up, so the max gap approximates the longest run without a cooperative yield. Scheduler overhead gives unblocked gaps a small (>0) floor.",
    },
    memory: {
      method: "process.memoryUsage() sampled on heartbeat and phase boundaries; peak values are componentwise maxima",
      baseline: measurement.baselineMemory,
      peak: measurement.peakMemory,
      final: measurement.finalMemory,
      sampleCount: measurement.memorySampleCount,
    },
    index: {
      documentCount: index.documentCount,
      snapshotStructuredCloneBytes: structuredCloneBuffer.length,
      snapshotJsonStringifyBytes: {
        bytes: jsonStringifyBytes,
        diagnosticOnly: true,
        note: "Isolated labeled experiment for size comparison only. Production persist stores structured-clone objects and must never JSON.stringify a whole-vault index snapshot.",
      },
    },
    correctness: {
      allPassed: checks.every((check) => check.passed),
      checks,
    },
  };
}
