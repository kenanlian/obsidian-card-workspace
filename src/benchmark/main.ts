/**
 * CLI entry for `npm run benchmark:search`.
 *
 * The only filesystem access in the whole benchmark is here: writing the JSON
 * report to the caller-provided --output path. The harness itself touches no
 * vault, no IndexedDB, and no files.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { BENCHMARK_CLI_USAGE, BenchmarkCliArgumentError, parseBenchmarkCliArgs } from "./cli-args";
import { runSearchBenchmark } from "./harness";

function formatMebibytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MiB`;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(BENCHMARK_CLI_USAGE);
    return 0;
  }

  let options;
  try {
    options = parseBenchmarkCliArgs(argv);
  } catch (error) {
    if (error instanceof BenchmarkCliArgumentError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }

  console.log(
    `[benchmark:search] profile=${options.profile} seed=${options.seed ?? "profile-default"} fixtures generating...`,
  );
  const report = await runSearchBenchmark({
    profile: options.profile,
    seed: options.seed ?? undefined,
    maxSliceMs: options.maxSliceMs,
  });

  const outputPath = resolve(options.output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const stageLine = report.stages
    .map((phase) => `${phase.id}=${phase.wallMs}ms`)
    .join(" | ");
  const failedChecks = report.correctness.checks.filter((check) => !check.passed);

  console.log(`[benchmark:search] documents=${report.index.documentCount} excluded-attachments=${report.fixtures.excludedAttachments}`);
  console.log(`[benchmark:search] stages: ${stageLine}`);
  console.log(
    `[benchmark:search] max blocking slice=${report.blocking.maxSliceMs}ms | peak heap=${formatMebibytes(report.memory.peak.heapUsedBytes)} | snapshot (structured clone)=${formatMebibytes(report.index.snapshotStructuredCloneBytes)}`,
  );
  const threshold = report.blocking.threshold;
  if (threshold !== null) {
    console.log(
      `[benchmark:search] slice gate: ${threshold.passed ? "PASS" : "FAIL"} | ingest ceiling=${threshold.ingestThresholdMs}ms (--max-slice-ms) | other build phase ceiling=${threshold.otherBuildPhaseCeilingMs}ms`,
    );
    for (const verdict of [threshold.ingest, ...threshold.otherBuildPhases]) {
      console.log(
        `[benchmark:search]   ${verdict.passed ? "pass" : "FAIL"} ${verdict.id}: observed=${verdict.maxSliceMs ?? "<did not run>"}ms expected<=${verdict.ceilingMs}ms`,
      );
    }
    console.log(
      `[benchmark:search]   not gated: global max slice (${report.blocking.maxSliceMs}ms) and ${threshold.excludedPhases.map((phase) => phase.id).join(", ")}`,
    );
  }
  // Written before the verdict on purpose: a run that trips the gate must stay
  // diagnosable from its report.
  console.log(`[benchmark:search] report written to ${outputPath}`);

  if (failedChecks.length > 0) {
    console.error(`[benchmark:search] correctness checks FAILED (${failedChecks.length}):`);
    for (const check of failedChecks) {
      console.error(`[benchmark:search]   - ${check.id}: ${check.detail}`);
    }
    return 1;
  }
  console.log(`[benchmark:search] correctness: ${report.correctness.checks.length}/${report.correctness.checks.length} checks passed`);
  return 0;
}

main().then(
  (code) => {
    process.exit(code);
  },
  (error) => {
    console.error("[benchmark:search] fatal:", error);
    process.exit(3);
  },
);
