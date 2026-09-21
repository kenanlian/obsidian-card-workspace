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
import { createMiniSearchOptions, MINISEARCH_SEARCH_OPTIONS } from "../search/minisearch-options";
import type { SearchableDocument } from "../search/types";
import { isMarkdownCardKind, resolveCardFileKindFromPath } from "../view/file-kind";
import { SEARCH_BENCHMARK_REPORT_SCHEMA, runSearchBenchmark } from "./harness";
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
  "minisearch-add-all-async",
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

  it("returns the expected paths for known queries through the production index pipeline", { timeout: 60_000 }, async () => {
    const files = generateSyntheticVault("micro");
    const documents = prepareFixtureDocuments(files);
    const index = new MiniSearch<SearchableDocument>(createMiniSearchOptions());
    await index.addAllAsync(documents);

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
});
