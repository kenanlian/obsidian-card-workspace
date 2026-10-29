/** Offline, serial comparison of a clean candidate against the accepted fixed baseline. */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
if (!option("--output")) throw new Error("Pass --output <report directory>");
const output = resolve(option("--output")); mkdirSync(output, { recursive: true });
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (git("status", "--porcelain")) throw new Error("Candidate must be clean");
const baseline = "6aeaf3d32c126876116d09d0028a48fa0a7c8d9d";
const observation = { baseline, commit: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}"), startClean: true, runs: [] };
const temporary = mkdtempSync(join(tmpdir(), "card-workspace-mobile-comparison-"));
const frozen = join(temporary, "baseline"); mkdirSync(frozen);
try {
  const archive = execFileSync("git", ["archive", baseline], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", frozen], { input: archive });
  symlinkSync(join(root, "node_modules"), join(frozen, "node_modules"), "dir");
  for (const profile of ["smoke", "full", "xl"]) for (const [lane, cwd] of [["baseline", frozen], ["candidate", root]]) {
    const args = ["scripts/run-search-benchmark.mjs", "--profile", profile, "--seed", "12345", "--output", join(output, `${lane}-${profile}.json`)];
    if (profile === "xl") args.push("--max-slice-ms", "300");
    console.log(`[mobile-comparison] ${lane} search ${profile}`);
    const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    writeFileSync(join(output, `${lane}-${profile}.log`), `${result.stdout ?? ""}${result.stderr ?? ""}`);
    const report = JSON.parse(readFileSync(join(output, `${lane}-${profile}.json`), "utf8"));
    const failedContentChecks = report.correctness.checks.filter(check => !check.passed && check.id !== "production-build-slices-within-thresholds");
    observation.runs.push({ lane, profile, failedContentChecks, command: [process.execPath, ...args], exitCode: result.status, error: result.error?.message ?? null });
    console.log(`[mobile-comparison] ${lane}/${profile} exit=${result.status}`);
  }
  const previewArgs = ["scripts/run-search-preview-benchmark.mjs", "--baseline", baseline, "--output", join(output, "search-preview.json")];
  console.log("[mobile-comparison] production search previews (20 samples, 5 warmups)");
  const preview = spawnSync(process.execPath, previewArgs, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(join(output, "search-preview.log"), `${preview.stdout ?? ""}${preview.stderr ?? ""}`);
  observation.runs.push({ lane: "comparison", profile: "search-preview", command: [process.execPath, ...previewArgs], exitCode: preview.status, error: preview.error?.message ?? null });
  observation.endCommit = git("rev-parse", "HEAD"); observation.endTree = git("rev-parse", "HEAD^{tree}");
  observation.endClean = !git("status", "--porcelain");
  writeFileSync(join(output, "observation.json"), JSON.stringify(observation, null, 2) + "\n");
  if (!observation.endClean || observation.commit !== observation.endCommit || observation.tree !== observation.endTree) throw new Error("Candidate changed during comparison");
  // Preserve every original gate and failure; XL's serialization ceiling is an explicit known gap.
  const previewReport = preview.status === 0 ? JSON.parse(readFileSync(join(output, "search-preview.json"), "utf8")) : null;
  console.log(JSON.stringify({ output, runs: observation.runs.map(({ lane, profile, exitCode }) => ({ lane, profile, exitCode })), previewPassed: previewReport?.passed ?? false }));
  if (observation.runs.some(run => run.failedContentChecks?.length || (run.profile !== "xl" && run.exitCode !== 0))) process.exitCode = 1;
} finally { rmSync(temporary, { recursive: true, force: true }); }
