import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import MiniSearch from "minisearch";
import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareSearchableDocument } from "../search/document-preparation";
import { INGEST_YIELD_TERM_BUDGET, addDocumentsWithYield } from "../search/index-ingest";
import { createMiniSearchOptions, MINISEARCH_SEARCH_OPTIONS } from "../search/minisearch-options";
import type { SearchableDocument } from "../search/types";
import { isMarkdownCardKind, resolveCardFileKindFromPath } from "../view/file-kind";
import { SEARCH_BENCHMARK_REPORT_SCHEMA, runSearchBenchmark } from "./harness";
import {
  INGEST_GATED_PHASE_ID,
  MAX_SLICE_CHECK_ID,
  OTHER_BUILD_PHASE_IDS,
  OTHER_BUILD_PHASE_MAX_SLICE_MS,
  evaluateBlockingThreshold,
} from "./report";
import {
  ENGLISH_NEEDLE_PATH,
  ENGLISH_NEEDLE_QUERY,
  HAN_NEEDLE_PATH,
  HAN_NEEDLE_QUERY,
  OVER_CAP_HEAD_MARKER,
  OVER_CAP_PATH,
  OVER_CAP_TAIL_MARKER,
  generateSyntheticVault,
  type SyntheticFixtureFile,
} from "./fixtures";

function tripwireTarget(): void {}

const createTripwire = (label: string): object =>
  new Proxy(tripwireTarget, {
    get(): never {
      throw new Error(`benchmark must not access ${label}`);
    },
    apply(): never {
      throw new Error(`benchmark must not call ${label}`);
    },
  });

const execFileAsync = promisify(execFile);
const benchmarkDirectory = fileURLToPath(new URL(".", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

const REQUIRED_PHASE_IDS = [
  "read-prepare",
  "minisearch-budgeted-ingest",
  "minisearch-to-json",
  "persist-structured-clone",
  "size-estimate-json-stringify",
  "search-sample-queries",
];

/** Mirrors the harness document-source filter: production kind resolution only. */
function prepareFixtureDocuments(files: readonly SyntheticFixtureFile[]): SearchableDocument[] {
  const documents: SearchableDocument[] = [];
  for (const file of files) {
    const kind = resolveCardFileKindFromPath(file.path);
    if (kind === null) {
      continue;
    }
    if (isMarkdownCardKind(kind) && file.markdown !== null) {
      documents.push(
        prepareSearchableDocument({
          path: file.path,
          title: file.title,
          markdown: file.markdown,
          mtime: file.mtime,
          ctime: file.ctime,
        }),
      );
    } else {
      documents.push(
        prepareSearchableDocument({
          path: file.path,
          title: file.title,
          mtime: file.mtime,
          ctime: file.ctime,
        }),
      );
    }
  }
  return documents;
}

function searchWithProductionOptions(
  index: MiniSearch<SearchableDocument>,
  query: string,
  candidatePaths: readonly string[],
): string[] {
  const allowed = new Set(candidatePaths);
  const results = index.search(query, MINISEARCH_SEARCH_OPTIONS) as unknown as Array<{ path?: string }>;
  return results
    .map((result) => result.path)
    .filter((path): path is string => typeof path === "string" && allowed.has(path));
}

describe("search benchmark harness", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("produces a complete structured report for the micro profile", { timeout: 60_000 }, async () => {
    const report = await runSearchBenchmark({ profile: "micro" });

    expect(report.schema).toBe(SEARCH_BENCHMARK_REPORT_SCHEMA);
    expect(report.profile).toBe("micro");
    expect(report.seed).toBeGreaterThan(0);
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.environment.nodeVersion).toMatch(/^v\d+/);

    const phaseIds = report.stages.map((phase) => phase.id);
    for (const requiredPhase of REQUIRED_PHASE_IDS) {
      expect(phaseIds).toContain(requiredPhase);
    }
    for (const phase of report.stages) {
      expect(phase.wallMs).toBeGreaterThanOrEqual(0);
      expect(phase.maxSliceMs).toBeGreaterThanOrEqual(0);
      expect(phase.note.length).toBeGreaterThan(0);
    }
    const stringifyPhase = report.stages.find((phase) => phase.id === "size-estimate-json-stringify");
    expect(stringifyPhase?.diagnosticOnly).toBe(true);

    for (const requiredPhase of REQUIRED_PHASE_IDS) {
      expect(report.blocking.perPhaseMaxSliceMs[requiredPhase]).toBeDefined();
    }
    expect(report.blocking.maxSliceMs).toBeGreaterThan(0);

    expect(report.memory.baseline.heapUsedBytes).toBeGreaterThan(0);
    expect(report.memory.peak.heapUsedBytes).toBeGreaterThanOrEqual(report.memory.baseline.heapUsedBytes);
    expect(report.memory.sampleCount).toBeGreaterThan(0);

    expect(report.fixtures.filesTotal).toBeGreaterThan(report.fixtures.indexedDocuments);
    expect(report.fixtures.excludedAttachments).toBeGreaterThan(0);
    expect(report.fixtures.digest).toMatch(/^fnv1a32-[0-9a-f]{8}$/);
    expect(report.index.documentCount).toBe(report.fixtures.indexedDocuments);
    expect(report.index.snapshotStructuredCloneBytes).toBeGreaterThan(0);
    expect(report.index.snapshotJsonStringifyBytes.diagnosticOnly).toBe(true);
    expect(report.index.snapshotJsonStringifyBytes.note).toContain("must never");

    expect(report.correctness.allPassed).toBe(true);
    expect(report.correctness.checks.length).toBeGreaterThanOrEqual(9);
    for (const check of report.correctness.checks) {
      expect(check.passed, check.detail).toBe(true);
    }
  });

  it("records no timing check at all when --max-slice-ms is absent", { timeout: 60_000 }, async () => {
    const report = await runSearchBenchmark({ profile: "micro" });

    expect(report.blocking.threshold).toBeNull();
    expect(report.correctness.checks.map((check) => check.id)).not.toContain(MAX_SLICE_CHECK_ID);
    // The CI smoke run asserts "9/9 checks passed"; the gate must not disturb it.
    expect(report.correctness.checks).toHaveLength(9);
    expect(report.correctness.allPassed).toBe(true);
    expect(report.blocking.maxSliceMs).toBeGreaterThan(0);
  });

  it("measures the production budgeted-ingest path, not addAllAsync", { timeout: 60_000 }, async () => {
    const report = await runSearchBenchmark({ profile: "micro" });

    const ingest = report.stages.find((phase) => phase.id === INGEST_GATED_PHASE_ID);
    expect(ingest).toBeDefined();
    expect(report.stages.map((phase) => phase.id)).not.toContain("minisearch-add-all-async");
    expect(report.blocking.ingestTermBudget).toBe(INGEST_YIELD_TERM_BUDGET);
    expect(ingest?.note).toContain("addDocumentsWithYield");
    expect(ingest?.note).toContain("not MiniSearch.addAllAsync");

    // `yieldsObserved` counts setImmediate heartbeats, not ingest yields, so it
    // cannot tell the two schedulers apart. The scheduler is pinned at the
    // source instead: the harness must call the production ingest helper and
    // must not have kept addAllAsync anywhere.
    const harnessSource = await readFile(join(benchmarkDirectory, "harness.ts"), "utf8");
    expect(harnessSource).toContain('from "../search/index-ingest"');
    expect(harnessSource).toContain("addDocumentsWithYield(index, documents");
    expect(harnessSource).not.toMatch(/\baddAllAsync\b/);

    // Ingestion must still produce a complete, correct index.
    expect(report.index.documentCount).toBe(report.fixtures.indexedDocuments);
    expect(report.correctness.allPassed).toBe(true);
  });

  it("fails the run when production ingest exceeds the supplied --max-slice-ms", { timeout: 60_000 }, async () => {
    // 0.001ms is the smallest value the report's 3-decimal rounding can
    // represent, and the micro profile's ingest slice is tens of milliseconds,
    // so the ~4-order-of-magnitude margin makes this failure
    // machine-independent rather than a wall-clock assertion in disguise.
    const report = await runSearchBenchmark({ profile: "micro", maxSliceMs: 0.001 });

    const threshold = report.blocking.threshold;
    expect(threshold?.ingestThresholdMs).toBe(0.001);
    expect(threshold?.ingest.id).toBe(INGEST_GATED_PHASE_ID);
    expect(threshold?.ingest.maxSliceMs).toBeGreaterThan(0.001);
    expect(threshold?.ingest.passed).toBe(false);
    expect(threshold?.passed).toBe(false);

    // The other ceiling is untouched by --max-slice-ms and still passed, so the
    // combined verdict failed on ingest alone.
    expect(threshold?.otherBuildPhaseCeilingMs).toBe(OTHER_BUILD_PHASE_MAX_SLICE_MS);
    expect(threshold?.otherBuildPhases.every((phase) => phase.passed)).toBe(true);

    const check = report.correctness.checks.find((candidate) => candidate.id === MAX_SLICE_CHECK_ID);
    expect(check?.passed).toBe(false);
    // main.ts prints the detail to stderr, so it carries observed vs expected
    // for every gated phase.
    expect(check?.detail).toContain(`${INGEST_GATED_PHASE_ID} observed ${threshold?.ingest.maxSliceMs}ms expected <= 0.001ms (FAIL)`);
    for (const phase of OTHER_BUILD_PHASE_IDS) {
      expect(check?.detail).toContain(`${phase} observed`);
    }

    expect(report.correctness.allPassed).toBe(false);
    expect(report.correctness.checks).toHaveLength(10);
    const others = report.correctness.checks.filter((candidate) => candidate.id !== MAX_SLICE_CHECK_ID);
    expect(others.every((candidate) => candidate.passed)).toBe(true);
  });

  it("passes both ceilings and keeps allPassed true when every gated slice is within budget", { timeout: 60_000 }, async () => {
    const report = await runSearchBenchmark({ profile: "micro", maxSliceMs: 300 });

    const threshold = report.blocking.threshold;
    expect(threshold?.passed).toBe(true);
    expect(threshold?.ingest.passed).toBe(true);
    expect(threshold?.otherBuildPhases.map((phase) => phase.id)).toEqual([...OTHER_BUILD_PHASE_IDS]);
    expect(threshold?.otherBuildPhases.every((phase) => phase.passed)).toBe(true);
    expect(report.correctness.checks).toHaveLength(10);
    expect(report.correctness.allPassed).toBe(true);
  });

  it("applies the ingest threshold and the fixed other-phase ceiling independently", () => {
    // The figures below are the xl profile's measured per-phase max slices.
    const measured = {
      "read-prepare": 1_408.677,
      [INGEST_GATED_PHASE_ID]: 55.1,
      "minisearch-to-json": 632.428,
      "persist-structured-clone": 340.917,
      "size-estimate-json-stringify": 542.578,
      "search-sample-queries": 257.972,
    };

    const verdict = evaluateBlockingThreshold(300, measured);
    expect(verdict.passed).toBe(true);
    expect(verdict.ingest.maxSliceMs).toBe(55.1);
    expect(verdict.ingest.ceilingMs).toBe(300);
    // toJSON is 632ms: over the ingest threshold, under the 750ms ceiling.
    // Gating it at 300 would be unpassable; ignoring it would hide a regression.
    expect(verdict.otherBuildPhases).toEqual([
      { id: "minisearch-to-json", maxSliceMs: 632.428, ceilingMs: 750, passed: true },
      { id: "persist-structured-clone", maxSliceMs: 340.917, ceilingMs: 750, passed: true },
    ]);

    // An other-phase regression past 750ms fails even though ingest is fine.
    const regressed = evaluateBlockingThreshold(300, { ...measured, "minisearch-to-json": 750.001 });
    expect(regressed.ingest.passed).toBe(true);
    expect(regressed.passed).toBe(false);

    // read-prepare's 1408ms never participates, in either direction.
    const excludedIds = verdict.excludedPhases.map((phase) => phase.id);
    expect(excludedIds).toEqual(["read-prepare", "size-estimate-json-stringify", "search-sample-queries"]);
    const gatedIds = [verdict.ingest.id, ...verdict.otherBuildPhases.map((phase) => phase.id)];
    for (const requiredPhase of REQUIRED_PHASE_IDS) {
      expect([...gatedIds, ...excludedIds]).toContain(requiredPhase);
    }
    for (const phase of verdict.excludedPhases) {
      expect(phase.reason.length, phase.id).toBeGreaterThan(0);
    }
  });

  it("treats both ceilings as inclusive and refuses to certify a phase that never ran", () => {
    const allPhases = (ingestMs: number) => ({
      [INGEST_GATED_PHASE_ID]: ingestMs,
      "minisearch-to-json": 1,
      "persist-structured-clone": 1,
    });
    expect(evaluateBlockingThreshold(300, allPhases(300)).passed).toBe(true);
    expect(evaluateBlockingThreshold(300, allPhases(300.001)).passed).toBe(false);

    const atOtherCeiling = evaluateBlockingThreshold(300, {
      [INGEST_GATED_PHASE_ID]: 1,
      "minisearch-to-json": OTHER_BUILD_PHASE_MAX_SLICE_MS,
      "persist-structured-clone": OTHER_BUILD_PHASE_MAX_SLICE_MS,
    });
    expect(atOtherCeiling.passed).toBe(true);

    // A missing phase must not pass as zero-cost.
    const nothingRan = evaluateBlockingThreshold(300, { "read-prepare": 9_999 });
    expect(nothingRan.ingest.maxSliceMs).toBeNull();
    expect(nothingRan.ingest.passed).toBe(false);
    expect(nothingRan.otherBuildPhases.every((phase) => phase.maxSliceMs === null)).toBe(true);
    expect(nothingRan.passed).toBe(false);
  });

  it("returns the expected paths for known queries through the production index pipeline", { timeout: 60_000 }, async () => {
    const files = generateSyntheticVault("micro");
    const documents = prepareFixtureDocuments(files);
    const index = new MiniSearch<SearchableDocument>(createMiniSearchOptions());
    await addDocumentsWithYield(index, documents, 0, () => true);

    const allPaths = documents.map((document) => document.path);
    expect(searchWithProductionOptions(index, ENGLISH_NEEDLE_QUERY, allPaths)[0]).toBe(ENGLISH_NEEDLE_PATH);
    expect(searchWithProductionOptions(index, HAN_NEEDLE_QUERY, allPaths)[0]).toBe(HAN_NEEDLE_PATH);

    // Candidate scoping must still gate results, mirroring SearchIndexManager.search.
    const scoped = searchWithProductionOptions(index, ENGLISH_NEEDLE_QUERY, [allPaths[0] ?? "none.md"]);
    expect(scoped).toEqual([]);
  });

  it("applies the 512KB markdown cap through production preparation", () => {
    const files = generateSyntheticVault("micro");
    const overCapFile = files.find((file) => file.path === OVER_CAP_PATH);
    const overCapMarkdown = overCapFile?.markdown;
    if (overCapFile === undefined || typeof overCapMarkdown !== "string") {
      throw new Error("over-cap fixture is missing from the micro profile");
    }

    const document = prepareSearchableDocument({
      path: overCapFile.path,
      title: overCapFile.title,
      markdown: overCapMarkdown,
      mtime: overCapFile.mtime,
      ctime: overCapFile.ctime,
    });

    expect(document.content).toContain(OVER_CAP_HEAD_MARKER);
    expect(document.content).not.toContain(OVER_CAP_TAIL_MARKER);
    expect(document.content.length).toBeLessThan(overCapMarkdown.length);
  });

  it("excludes unsupported attachments from the prepared document source", () => {
    const files = generateSyntheticVault("micro");
    const documents = prepareFixtureDocuments(files);
    const documentPaths = new Set(documents.map((document) => document.path));

    const attachments = files.filter((file) => file.bucket === "attachment");
    expect(attachments.length).toBeGreaterThan(0);
    for (const attachment of attachments) {
      expect(resolveCardFileKindFromPath(attachment.path)).toBeNull();
      expect(documentPaths.has(attachment.path)).toBe(false);
    }
    expect(documents.length).toBe(files.length - attachments.length);
  });

  it("runs without touching a real vault or real IndexedDB", { timeout: 60_000 }, async () => {
    vi.stubGlobal("indexedDB", createTripwire("indexedDB"));
    vi.stubGlobal("IDBFactory", createTripwire("IDBFactory"));
    vi.stubGlobal("window", createTripwire("window"));

    const report = await runSearchBenchmark({ profile: "micro" });
    expect(report.correctness.allPassed).toBe(true);
  });

  it("keeps benchmark sources free of vault, IndexedDB, and filesystem access", async () => {
    const entries = await readdir(benchmarkDirectory);
    const sourceFiles = entries.filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts"));

    expect(sourceFiles.length).toBeGreaterThanOrEqual(5);
    for (const entry of sourceFiles) {
      const source = await readFile(join(benchmarkDirectory, entry), "utf8");

      // Case-sensitive patterns: prose may mention "IndexedDB", code may not.
      expect(source, entry).not.toMatch(/from ["']obsidian["']/);
      expect(source, entry).not.toMatch(/\bindexedDB\b/);
      expect(source, entry).not.toMatch(/\bcachedRead\b/);
      expect(source, entry).not.toMatch(/\bgetAbstractFileByPath\b/);
      expect(source, entry).not.toMatch(/\bapp\.vault\b/);

      if (entry !== "main.ts") {
        // Only the CLI writer may touch the filesystem, and only for the report.
        expect(source, entry).not.toMatch(/node:fs/);
      } else {
        expect(source, entry).toMatch(/node:fs\/promises/);
        expect(source, entry).not.toMatch(/node:fs"|"fs"/);
      }
    }
  });

  it("runs the npm-equivalent CLI end to end with --profile smoke and --output", { timeout: 240_000 }, async () => {
    const scratchDirectory = mkdtempSync(join(tmpdir(), "cw-benchmark-cli-"));
    const outputPath = join(scratchDirectory, "nested", "card-workspace-search-benchmark-smoke.json");
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        ["scripts/run-search-benchmark.mjs", "--profile", "smoke", "--output", outputPath],
        { cwd: repositoryRoot, timeout: 200_000 },
      );

      expect(stdout).toContain("correctness: 9/9 checks passed");
      expect(stdout).toContain("report written to");

      const report = JSON.parse(await readFile(outputPath, "utf8")) as {
        schema: string;
        profile: string;
        correctness: { allPassed: boolean };
        stages: Array<{ id: string }>;
      };
      expect(report.schema).toBe(SEARCH_BENCHMARK_REPORT_SCHEMA);
      expect(report.profile).toBe("smoke");
      expect(report.correctness.allPassed).toBe(true);
      expect(report).toHaveProperty("stages");
      expect(report.stages.map((phase) => phase.id)).toEqual(expect.arrayContaining(REQUIRED_PHASE_IDS));
    } finally {
      rmSync(scratchDirectory, { recursive: true, force: true });
    }
  });

  it("exits 1 but still writes the report when the CLI gate trips", { timeout: 240_000 }, async () => {
    const scratchDirectory = mkdtempSync(join(tmpdir(), "cw-benchmark-gate-"));
    const outputPath = join(scratchDirectory, "gate-failure.json");
    try {
      let exitCode: number | undefined;
      let stderr = "";
      try {
        await execFileAsync(
          process.execPath,
          ["scripts/run-search-benchmark.mjs", "--profile", "smoke", "--max-slice-ms", "0.001", "--output", outputPath],
          { cwd: repositoryRoot, timeout: 200_000 },
        );
      } catch (error) {
        const failure = error as { code?: number; stderr?: string };
        exitCode = failure.code;
        stderr = failure.stderr ?? "";
      }

      expect(exitCode).toBe(1);
      expect(stderr).toContain(MAX_SLICE_CHECK_ID);
      expect(stderr).toContain(`${INGEST_GATED_PHASE_ID} observed`);
      expect(stderr).toContain("expected <= 0.001ms");

      // A tripped gate must stay diagnosable from its report.
      const report = JSON.parse(await readFile(outputPath, "utf8")) as {
        correctness: { allPassed: boolean };
        blocking: {
          threshold: {
            passed: boolean;
            ingestThresholdMs: number;
            otherBuildPhaseCeilingMs: number;
            ingest: { passed: boolean };
          } | null;
        };
      };
      expect(report.correctness.allPassed).toBe(false);
      expect(report.blocking.threshold?.passed).toBe(false);
      expect(report.blocking.threshold?.ingestThresholdMs).toBe(0.001);
      expect(report.blocking.threshold?.ingest.passed).toBe(false);
      expect(report.blocking.threshold?.otherBuildPhaseCeilingMs).toBe(OTHER_BUILD_PHASE_MAX_SLICE_MS);
    } finally {
      rmSync(scratchDirectory, { recursive: true, force: true });
    }
  });
});
