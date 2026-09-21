/**
 * Runner for `npm run benchmark:search`.
 *
 * Bundles the benchmark CLI (src/benchmark/main.ts) with esbuild, aliasing the
 * `obsidian` external to an inert stub so production search modules load in
 * plain Node, then executes the bundle with the caller's arguments. The
 * production plugin build (esbuild.config.mjs, entry src/main.ts) is
 * completely unaffected: the benchmark is never part of it and never runs
 * automatically.
 */

import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bundleDirectory = mkdtempSync(join(tmpdir(), "card-workspace-search-benchmark-"));
const bundleFile = join(bundleDirectory, "benchmark.mjs");

try {
  await build({
    entryPoints: [join(repositoryRoot, "src/benchmark/main.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    outfile: bundleFile,
    sourcemap: false,
    minify: false,
    logLevel: "warning",
    alias: {
      obsidian: join(repositoryRoot, "src/benchmark/obsidian-stub.ts"),
    },
  });

  const spawned = spawnSync(process.execPath, [bundleFile, ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  if (spawned.error) {
    console.error("[benchmark:search] failed to run bundle:", spawned.error);
    process.exit(1);
  }
  process.exit(spawned.status === null ? 1 : spawned.status);
} catch (error) {
  console.error("[benchmark:search] bundle failed:", error);
  process.exit(1);
} finally {
  rmSync(bundleDirectory, { recursive: true, force: true });
}
